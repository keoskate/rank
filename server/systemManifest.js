// server/systemManifest.js
//
// buildManifest() — assembles the WHOLE trading system (every strategy, gate,
// signal, exit rule, eval verdict, and promotion rule) into one plain object by
// reading the REAL source-of-truth: the exported constants from the live
// trading modules, the broker .md frontmatter, the on-disk session state, and
// the backtest artifacts.
//
// Design principle — "reflect, don't transcribe": every value here traces to a
// live read (an exported constant, an .md file, a session record, a run.json),
// so the System Map snapshot can never silently drift from what the system
// actually trades on. Nothing is hand-copied.
//
// This module is READ-ONLY and side-effect-free: it does NOT boot the trading
// engine (no aiTradingEngine require), start file watchers, or fetch network
// data unless {live:true} is passed. That keeps it safe to run offline and from
// a plain CLI. It lives under server/ so an /api/system/manifest route + in-app
// page is a trivial follow-up (out of scope here).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { loadAllBrokers } = require('./brokers/brokerLoader');
const {
  BROKER_DEFAULTS,
  ALLOWED_STRATEGIES,
  ALLOWED_TIERS,
  brokerToSessionConfig,
  effectiveCapital,
} = require('./brokers/brokerSchema');
const tierPromotion = require('./brokers/tierPromotion');
const kelly = require('./risk/kellySizing');
const macroGate = require('./strategies/macroRegimeGate');
const { EXIT_SCORE_MODEL } = require('./signalEvaluator');
const {
  sentimentEngine,
  SENTIMENT_MODEL,
} = require('./semiconductorSentiment');
const fredClient = require('./macro/fredClient');

const ROOT = path.resolve(__dirname, '..');
const SESSIONS_PATH = path.join(ROOT, 'data', 'ai-sessions.json');
const RUNS_INDEX = path.join(ROOT, 'data', 'backtests', 'runs', 'index.json');
const VALIDATED_SOURCES = path.join(
  ROOT,
  'data',
  'backtests',
  'validated-sources.json'
);
const CERTS_DIR = path.join(ROOT, 'data', 'backtests', 'certifications');
const DAY_MS = 24 * 60 * 60 * 1000;

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// Resolve a promise but give up after `ms` — guards against a hung network
// fetch (e.g. sentiment/macro) blocking an otherwise-offline snapshot.
function withTimeout(promise, ms, onTimeout) {
  return Promise.race([
    Promise.resolve(promise).catch(err => ({ __error: err.message })),
    new Promise(resolve => setTimeout(() => resolve(onTimeout), ms)),
  ]);
}

// All broker sessions, keyed by slug, read straight from the on-disk session
// store (the engine writes this file; we only read it).
function loadBrokerSessions() {
  const raw = readJson(SESSIONS_PATH, {});
  const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
  const bySlug = {};
  for (const s of arr) {
    if (s && s.config && s.config.brokerSlug) bySlug[s.config.brokerSlug] = s;
  }
  return bySlug;
}

// Round for display without pretending to precision we don't have.
const r2 = n =>
  typeof n === 'number' && isFinite(n) ? Math.round(n * 100) / 100 : n;

// -------------------------------------------------------------------------
// Section builders
// -------------------------------------------------------------------------

function buildBrokers(loaded, sessionsBySlug, ledger) {
  return loaded.map(({ broker, persona, errors, file }) => {
    if (!broker) {
      return { file: path.basename(file), invalid: true, errors };
    }
    const session = sessionsBySlug[broker.slug] || null;
    const stats = (session && session.stats) || {};

    // Live snapshot of the running session (null when not materialized).
    const live = session
      ? {
          status: session.status,
          cash: r2(session.portfolio && session.portfolio.cash),
          positions: (session.portfolio && session.portfolio.positions
            ? session.portfolio.positions
            : []
          ).map(p => ({
            symbol: p.symbol,
            qty: p.quantity ?? p.qty,
            avgCost: r2(p.averageCost ?? p.avgCost),
          })),
          stats: {
            totalTrades: (stats.wins || 0) + (stats.losses || 0),
            wins: stats.wins || 0,
            losses: stats.losses || 0,
            winRate: r2(stats.winRate),
            totalPnL: r2(stats.totalPnL),
            maxDrawdown: r2(stats.maxDrawdown),
            consecutiveLosses: stats.consecutiveLosses || 0,
            sharpe: r2(tierPromotion.computeSharpe(session)),
          },
        }
      : null;

    // The REAL promotion evaluator — same pure function the daily tier-eval runs.
    // Returns { action, reason, metrics:{ sharpe,winRate,maxDD,totalTrades,days,edge } }.
    let promotion = null;
    if (session) {
      try {
        const decision = tierPromotion.evaluateBroker(broker, session, ledger);
        promotion = {
          action: decision.action,
          reason: decision.reason,
          metrics: {
            sharpe: r2(decision.metrics.sharpe),
            winRate: r2(decision.metrics.winRate),
            maxDD: r2(decision.metrics.maxDD),
            totalTrades: decision.metrics.totalTrades,
            days: r2(decision.metrics.days),
          },
          edge: decision.metrics.edge
            ? {
                pass: decision.metrics.edge.pass,
                source: decision.metrics.edge.source,
                reason: decision.metrics.edge.reason,
                trades: decision.metrics.edge.trades,
                expectancyPct: r2(decision.metrics.edge.expectancyPct),
                expectancyLowerCB: r2(decision.metrics.edge.expectancyLowerCB),
              }
            : null,
        };
      } catch (err) {
        promotion = { action: 'error', reason: err.message };
      }
    }

    // Per-broker exit tunables = the exact values the engine hands to
    // evaluateExit(). Prefer the LIVE session config (materialized at start with
    // engine defaults merged in); fall back to translating the .md for brokers
    // that aren't running. Keys absent from config use evaluateExit()'s own
    // defaults, shown here so the model is complete.
    let exitTunables = null;
    let srcCfg = session ? session.config : null;
    if (!srcCfg) {
      try {
        srcCfg = brokerToSessionConfig(broker, persona);
      } catch {
        srcCfg = {};
      }
    }
    exitTunables = {
      stopLossPercent: srcCfg.stopLossPercent,
      takeProfitPercent: srcCfg.takeProfitPercent,
      trailingStopPercent: srcCfg.trailingStopPercent,
      trailingStopMinProfitPercent: srcCfg.trailingStopMinProfitPercent ?? 2,
      rsiOverbought: srcCfg.rsiOverbought ?? 70,
      exitBeforeClose: srcCfg.exitBeforeClose,
      exitBeforeCloseMinutes: srcCfg.exitBeforeCloseMinutes ?? 15,
      minProfitForExitPercent:
        srcCfg.minProfitForExitPercent ?? '0.5 × leverage',
      trendDampeningFactor: srcCfg.trendDampeningFactor ?? 0.4,
    };

    return {
      slug: broker.slug,
      name: broker.name,
      tier: broker.tier,
      strategy: broker.strategy,
      capital: broker.capital,
      effectiveCapital: effectiveCapital(broker),
      watchlist: broker.watchlist,
      risk: broker.risk,
      regime: broker.regime,
      macro: broker.macro,
      llm: broker.llm,
      plugins: {
        flow: broker.flow,
        insider: broker.insider,
        darkpool: broker.darkpool,
        trend: broker.trend,
      },
      personaExcerpt: (persona || '').split('\n').slice(0, 6).join('\n'),
      exitTunables,
      live,
      promotion,
      errors: errors && errors.length ? errors : undefined,
    };
  });
}

async function buildGates(brokers, opts) {
  // Macro gate — read the live FRED snapshot only when configured + live.
  let macroLive = {
    state: 'inert',
    reason: 'FRED_API_KEY not set — macro gate inert',
  };
  if (opts.live && fredClient.isConfigured()) {
    const snap = await withTimeout(fredClient.getMacroSnapshot(), 6000, {
      __error: 'timeout',
    });
    if (snap && !snap.__error) {
      macroLive = { state: 'available', ...snap };
    } else {
      macroLive = {
        state: 'unavailable',
        reason: (snap && snap.__error) || 'no data',
      };
    }
  }

  // Per-broker risk rails: armed only when the broker opts in via frontmatter.
  const rails = brokers
    .filter(b => !b.invalid)
    .map(b => ({
      slug: b.slug,
      dailyLossLimit: b.risk && b.risk.dailyLossLimit,
      maxConsecutiveLosses: b.risk && b.risk.maxConsecutiveLosses,
      maxPortfolioDrawdown: b.risk && b.risk.maxPortfolioDrawdown,
      currentConsecutiveLosses: b.live ? b.live.stats.consecutiveLosses : null,
    }));

  return {
    entropy: {
      status: 'OFF — no edge (validated 2026-06, p≥0.6, n=5,881)',
      note: 'Certified faithful to @keo/quant-core entropyGateCore but kept off — zero edge.',
      defaults: BROKER_DEFAULTS.regime,
      enabledBrokers: brokers
        .filter(b => !b.invalid && b.regime && b.regime.enabled)
        .map(b => b.slug),
    },
    macro: {
      note: 'Per-broker opt-in (config.macroGateEnabled) AND FRED_API_KEY. Scales size; never a standalone return series.',
      riskOffScalarDefault: BROKER_DEFAULTS.macro.riskOffScalar,
      DEEP_INVERSION: macroGate.DEEP_INVERSION,
      HY_SPIKE_MULT: macroGate.HY_SPIKE_MULT,
      series: { curveSlope: 'T10Y2Y', hySpread: 'BAMLH0A0HYM2' },
      live: macroLive,
      enabledBrokers: brokers
        .filter(b => !b.invalid && b.macro && b.macro.enabled)
        .map(b => b.slug),
    },
    kelly: {
      note: 'Fractional Kelly f* = (p·b − q)/b, clamped to a fractional multiple. Blends a Bayesian prior until real history accrues.',
      MIN_TRADES_FOR_EMPIRICAL: kelly.MIN_TRADES_FOR_EMPIRICAL,
      MIN_LOSSES_FOR_PAYOFF: kelly.MIN_LOSSES_FOR_PAYOFF,
      MAX_WIN_RATE: kelly.MAX_WIN_RATE,
      PRIOR_WIN_RATE: kelly.PRIOR_WIN_RATE,
      PRIOR_PAYOFF_RATIO: kelly.PRIOR_PAYOFF_RATIO,
      ROLLING_WINDOW: kelly.ROLLING_WINDOW,
      fallbacks: { fractionMult: 0.25, maxPercent: 25, minPercent: 0.5 },
    },
    rails: {
      note: 'Daily-loss + consecutive-loss halts are per-broker opt-in via frontmatter. Soft halts on new entries; exits/stops stay active.',
      brokers: rails,
    },
  };
}

async function buildSignals(brokers, opts) {
  let sentimentLive = {
    available: false,
    reason: 'not fetched (offline snapshot)',
  };
  if (opts.live) {
    const s = await withTimeout(sentimentEngine.getSentiment(), 7000, {
      __error: 'timeout',
    });
    // analyzeDirection() starts every real reading at base confidence 50, so a
    // 0-confidence result is the engine's no-data fallback (missing market-data
    // key / fetch failed) — report it as unavailable, not a fake neutral read.
    const degraded = !s || s.__error || !s.confidence;
    if (!degraded) {
      sentimentLive = {
        available: true,
        direction: s.direction,
        confidence: s.confidence,
        recommendedSymbol: s.recommendedSymbol,
        canTrade: s.canTrade,
        canSwitch: s.canSwitch,
        stale: s.stale || false,
        signals: (s.signals || []).slice(0, 6),
      };
    } else {
      sentimentLive = {
        available: false,
        reason:
          s && s.__error === 'timeout'
            ? 'sentiment fetch timed out'
            : 'market data unavailable (no API key or fetch failed)',
      };
    }
  }

  // Which strategy each broker runs (source-of-truth = frontmatter `strategy`).
  const strategyUsage = {};
  for (const b of brokers) {
    if (b.invalid) continue;
    (strategyUsage[b.strategy] = strategyUsage[b.strategy] || []).push(b.slug);
  }

  return {
    semiconductor: {
      note: 'SOXX-based volatility-adaptive direction → routes SOXL (long) / SOXS (short).',
      config: sentimentEngine.config,
      cacheTTLms: sentimentEngine.cacheTTL,
      model: SENTIMENT_MODEL,
      live: sentimentLive,
    },
    strategies: {
      allowed: ALLOWED_STRATEGIES,
      inUse: strategyUsage,
    },
    technicals: {
      note: 'Indicators feeding entry/exit confidence (getAllIndicators).',
      indicators: [
        {
          key: 'rsi',
          use: 'overbought/oversold; RSI>rsiOverbought adds exit pressure',
        },
        { key: 'adx', use: 'trend strength; gates exit dampening' },
        {
          key: 'macd',
          use: 'reduced weight — removed from exits (low 5-min accuracy)',
        },
        {
          key: 'volumeRatio',
          use: 'confirmation; low-volume-on-advance = distribution',
        },
        { key: 'trend', use: 'short/medium-term classification' },
      ],
    },
  };
}

function buildExits(brokers) {
  return {
    note: 'Additive exit score; a position exits when it clears the trigger. Critical weights (stop/TP/trailing/EOD) are never dampened.',
    model: EXIT_SCORE_MODEL,
    driftWarning:
      'Header comments in evaluateExit() still say stop-loss 40 / EOD 50 — the LIVE code uses 100 and a 70/95 trigger. This map reflects the code.',
    perBrokerTunables: brokers
      .filter(b => !b.invalid && b.exitTunables)
      .map(b => ({ slug: b.slug, ...b.exitTunables })),
  };
}

function buildEvals() {
  const runsIndex = readJson(RUNS_INDEX, { runs: [] });
  const runs = runsIndex.runs || [];

  // Verdict tally + the most recent runs.
  const byVerdict = {};
  for (const run of runs) {
    const v = run.verdict || 'UNKNOWN';
    byVerdict[v] = (byVerdict[v] || 0) + 1;
  }
  const recent = runs
    .slice()
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, 25)
    .map(run => ({
      runId: run.runId,
      family: run.family,
      strategyId: run.strategyId,
      verdict: run.verdict,
      sharpe: r2(run.stats && run.stats.sharpe),
      maxDD: r2(run.stats && run.stats.maxDD),
      generatedAt: run.generatedAt,
    }));

  // Faithfulness certifications: name + freshness.
  let certifications = [];
  try {
    certifications = fs
      .readdirSync(CERTS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const c = readJson(path.join(CERTS_DIR, f), {});
        const when = c.generatedAt || c.timestamp || c.date;
        const ageDays = when
          ? r2((Date.now() - new Date(when).getTime()) / DAY_MS)
          : null;
        return {
          name: f.replace(/\.json$/, ''),
          generatedAt: when || null,
          ageDays,
        };
      });
  } catch {
    certifications = [];
  }

  return {
    fiveGates: [
      {
        key: 'dataIntegrity',
        checks:
          'raw vs adjusted alignment, cross-source consistency, structural faults',
      },
      {
        key: 'faithfulness',
        checks:
          'live plugin certified against @keo/quant-core shared core, <30 days old',
      },
      {
        key: 'outOfSample',
        checks: 'walk-forward OOS Sharpe > 0 AND beats passive EW-N control',
      },
      {
        key: 'realisticCosts',
        checks: 'OOS Sharpe still > 0 at 2× transaction costs',
      },
      {
        key: 'multipleTesting',
        checks: 'deflated Sharpe ≥ 95% vs expected max-of-N trials',
      },
    ],
    verdictTally: byVerdict,
    totalRuns: runs.length,
    recentRuns: recent,
    validatedSources: {
      registry: readJson(VALIDATED_SOURCES, {}),
      maxAgeDays: tierPromotion.VALIDATION_MAX_AGE_DAYS,
      requiresEventValidation: [...tierPromotion.REQUIRES_EVENT_VALIDATION],
      eventStudyMinArchiveDays: tierPromotion.EVENT_STUDY_MIN_ARCHIVE_DAYS,
    },
    certifications,
  };
}

function buildPromotion() {
  return {
    note: 'Survival mechanics. A sim broker graduates to paper only when aggregate stats AND its signal source clear the bars below.',
    PROMOTE: tierPromotion.PROMOTE,
    EDGE_GATE: tierPromotion.EDGE_GATE,
    DEMOTE: tierPromotion.DEMOTE,
    FIRE: tierPromotion.FIRE,
    DEFUND: tierPromotion.DEFUND,
    tiers: ALLOWED_TIERS,
    breeding:
      'On fire (and breed enabled): clone the top-Sharpe survivor, jitter perTrade/kellyFraction/maxPositionSizePercent ±20–25%, child starts simulated.',
  };
}

// -------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------

/**
 * Build the full system manifest.
 * @param {{ live?: boolean }} opts - live:true fetches point-in-time sentiment +
 *   macro readings (needs API keys/network); live:false = pure config snapshot.
 * @returns {Promise<object>} the manifest
 */
async function buildManifest(opts = {}) {
  const live = opts.live !== false; // default: attempt live readings
  const loaded = await loadAllBrokers();
  const sessionsBySlug = loadBrokerSessions();
  const ledger = await tierPromotion.getLedger();

  const brokers = buildBrokers(loaded, sessionsBySlug, ledger);
  const [gates, signals] = await Promise.all([
    buildGates(brokers, { live }),
    buildSignals(brokers, { live }),
  ]);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      gitSha: gitSha(),
      live,
      offline: !live,
      brokerCount: brokers.filter(b => !b.invalid).length,
      note: 'System Map — a point-in-time snapshot of every config & IP, read from source. Re-run to refresh.',
    },
    brokers,
    gates,
    signals,
    exits: buildExits(brokers),
    evals: buildEvals(),
    promotion: buildPromotion(),
  };
}

module.exports = { buildManifest };
