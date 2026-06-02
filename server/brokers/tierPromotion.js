// server/brokers/tierPromotion.js
// Survival mechanics for AI broker agents: promotion, demotion, firing, breeding.
//
// Promote sim → paper when:
//   sharpe ≥ 1.5, win rate ≥ 52%, max drawdown ≤ 15%, ≥ 100 trades, ≥ 20 days
// Demote paper → sim when over rolling 10 days:
//   max drawdown > 20%, OR sharpe < 0.5
// Fire when:
//   drawdown > 30% from peak, OR two demotions in 30 days
//
// Optional: breed a child config from a top-decile broker when one is fired,
// with parameter jitter — survival-of-the-fittest at the persona level.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const { validateBroker } = require('./brokerSchema');
const { loadAllBrokers } = require('./brokerLoader');
const { writeBroker, archiveBroker, brokerPath } = require('./brokerWriter');

const LEDGER_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'data',
  'broker-ledger.json'
);

// Thresholds (per the plan; live in one place for easy tuning).
const PROMOTE = {
  minSharpe: 1.5,
  minWinRate: 0.52,
  maxDrawdownPct: 15,
  minTrades: 100,
  minDays: 20,
};
// Edge gate: a broker may not graduate sim → paper until the SIGNAL SOURCE it
// trades has proven positive expectancy on its own. This stops a broker whose
// aggregate stats look acceptable from risking real money on a source that
// doesn't actually have an edge. Checked per-source, not just in aggregate.
const EDGE_GATE = {
  minTrades: 50, // closed trades attributed to the broker's primary source
  // Mean per-trade % return must clear a COST-AWARE floor, not just zero. ~10bps
  // round-trip on a normal stock, more on 3x ETFs — a sub-cost "edge" is a loss.
  minExpectancyPct: 0.15,
  // Require statistical significance too: the one-sided 95% lower bound on
  // expectancy (mean − 1.64·stdev/√n) must also be positive, so a few lucky
  // trades can't certify a source.
  requireSignificant: true,
};
const DEMOTE = {
  maxDrawdownPct: 20,
  minSharpe: 0.5,
  minDays: 10,
};
const FIRE = {
  maxDrawdownPct: 30,
  demotionsIn30Days: 2,
};

// ---------- ledger ----------

async function _loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return { events: [] };
  try {
    const raw = await fsp.readFile(LEDGER_PATH, 'utf8');
    const j = JSON.parse(raw);
    return j && Array.isArray(j.events) ? j : { events: [] };
  } catch {
    return { events: [] };
  }
}

async function _appendLedger(event) {
  const ledger = await _loadLedger();
  ledger.events.push({ ...event, timestamp: new Date().toISOString() });
  // Keep only last 1000 events to bound the file
  if (ledger.events.length > 1000) {
    ledger.events = ledger.events.slice(-1000);
  }
  await fsp.mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  const tmp = `${LEDGER_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  await fsp.rename(tmp, LEDGER_PATH);
}

async function getLedger() {
  return _loadLedger();
}

// ---------- metrics ----------

/**
 * Per-trade Sharpe: mean(per-trade return) / stdev(per-trade return) annualized
 * by sqrt(trades-per-year). For agents that take many small trades, this is a
 * reasonable proxy for daily-return Sharpe.
 */
function computeSharpe(session, opts = {}) {
  const tradesPerYear = opts.tradesPerYear || 252;
  const log = (session && session.tradingLog) || [];
  const exits = log.filter(
    t => t && t.side === 'sell' && typeof t.realizedPct === 'number'
  );
  if (exits.length < 2) return null;
  const returns = exits.map(t => t.realizedPct / 100);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  let sq = 0;
  for (const r of returns) sq += (r - mean) ** 2;
  const stdev = Math.sqrt(sq / returns.length);
  // Guard against float residue: constant returns (e.g. a fixed-TP scalper)
  // produce stdev ~1e-16, which would yield a ~1e16 "Sharpe" and auto-promote a
  // noise/constant strategy. Treat anything below 1e-9 as zero variance.
  if (!isFinite(stdev) || stdev < 1e-9) return null;
  // Annualization assumes one trade per "day" — for higher turnover this would
  // need adjustment. Good enough for the demo + relative ranking across brokers.
  return (mean / stdev) * Math.sqrt(tradesPerYear);
}

/**
 * Aggregate realized P&L by signal source (the strategy plugin that opened the
 * position). Reads closed (sell) legs from the session trade log. Handles both
 * simulated trades (realizedPnL/realizedPct) and live trades (pnl).
 *
 * @param {object} session
 * @returns {object} map of source -> { trades, totalPnL, wins, losses, winRate,
 *   expectancyUsd (mean $ per trade), expectancyPct (mean % per trade, or null) }
 */
function aggregateBySource(session) {
  const log = (session && session.tradingLog) || [];
  const bySource = {};
  for (const t of log) {
    if (!t || t.side !== 'sell') continue;
    const pnl =
      typeof t.realizedPnL === 'number'
        ? t.realizedPnL
        : typeof t.pnl === 'number'
          ? t.pnl
          : null;
    if (pnl == null) continue; // not a realized round-trip
    const source = t.source || 'unknown';
    const s =
      bySource[source] ||
      (bySource[source] = {
        trades: 0,
        totalPnL: 0,
        wins: 0,
        losses: 0,
        _pct: [],
      });
    s.trades++;
    s.totalPnL += pnl;
    if (pnl >= 0) s.wins++;
    else s.losses++;
    if (typeof t.realizedPct === 'number') {
      s._pct.push(t.realizedPct);
    }
  }
  for (const source of Object.keys(bySource)) {
    const s = bySource[source];
    s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
    s.expectancyUsd = s.trades > 0 ? s.totalPnL / s.trades : 0;
    const pcts = s._pct;
    if (pcts.length > 0) {
      const m = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      s.expectancyPct = m;
      // Sample stdev + one-sided 95% lower confidence bound on the mean.
      if (pcts.length > 1) {
        const v =
          pcts.reduce((a, b) => a + (b - m) ** 2, 0) / (pcts.length - 1);
        s.expectancyStdev = Math.sqrt(v);
        s.expectancyLowerCB =
          m - 1.64 * (s.expectancyStdev / Math.sqrt(pcts.length));
      } else {
        s.expectancyStdev = null;
        s.expectancyLowerCB = null;
      }
    } else {
      s.expectancyPct = null;
      s.expectancyStdev = null;
      s.expectancyLowerCB = null;
    }
    delete s._pct;
  }
  return bySource;
}

/**
 * Pick the broker's primary source: the one with the most closed trades.
 * (A broker runs one plugin, so this is its signal source in practice.)
 * @returns {{ source: string, metrics: object } | null}
 */
function primarySource(bySource) {
  const entries = Object.entries(bySource || {});
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1].trades - a[1].trades);
  return { source: entries[0][0], metrics: entries[0][1] };
}

/**
 * Edge gate: does the broker's primary source clear the bar for real money?
 * Passes only with enough closed trades AND positive expectancy from that one
 * source. Returns { pass, source, reason, trades, expectancyPct }.
 */
function evaluateEdgeGate(session) {
  const bySource = aggregateBySource(session);
  const primary = primarySource(bySource);
  if (!primary) {
    return {
      pass: false,
      source: null,
      reason: 'no closed trades yet',
      bySource,
    };
  }
  const { source, metrics } = primary;
  const expStr =
    metrics.expectancyPct != null
      ? metrics.expectancyPct.toFixed(3) + '%'
      : '$' + metrics.expectancyUsd.toFixed(2);

  const enoughTrades = metrics.trades >= EDGE_GATE.minTrades;
  // Prefer % expectancy; fall back to $ expectancy sign when % is unavailable.
  const expectancy =
    metrics.expectancyPct != null
      ? metrics.expectancyPct
      : metrics.expectancyUsd > 0
        ? 1
        : metrics.expectancyUsd < 0
          ? -1
          : 0;
  // Cost-aware floor: mean expectancy must clear minExpectancyPct, not just 0.
  const clearsFloor = expectancy > EDGE_GATE.minExpectancyPct;
  // Significance: the 95% lower bound on expectancy must also be positive (skip
  // when % series unavailable, i.e. live-only $ trades).
  const significant =
    !EDGE_GATE.requireSignificant ||
    metrics.expectancyLowerCB == null ||
    metrics.expectancyLowerCB > 0;

  const pass = enoughTrades && clearsFloor && significant;
  let reason;
  if (pass) {
    reason = `${source}: ${metrics.trades} trades, expectancy ${expStr}/trade (lcb ${metrics.expectancyLowerCB != null ? metrics.expectancyLowerCB.toFixed(3) + '%' : 'n/a'})`;
  } else if (!enoughTrades) {
    reason = `${source}: only ${metrics.trades}/${EDGE_GATE.minTrades} source trades`;
  } else if (!clearsFloor) {
    reason = `${source}: expectancy ${expStr}/trade below ${EDGE_GATE.minExpectancyPct}% cost floor`;
  } else {
    reason = `${source}: not significant (lower bound ${metrics.expectancyLowerCB?.toFixed(3)}% ≤ 0)`;
  }
  return {
    pass,
    source,
    reason,
    trades: metrics.trades,
    expectancyPct: metrics.expectancyPct,
    expectancyUsd: metrics.expectancyUsd,
    expectancyLowerCB: metrics.expectancyLowerCB ?? null,
    bySource,
  };
}

/**
 * Days since session started. Used to gate promotion (need a track record).
 */
function daysSinceStart(session) {
  if (!session || !session.startTime) return 0;
  const start = new Date(session.startTime).getTime();
  return Math.max(0, (Date.now() - start) / (24 * 60 * 60 * 1000));
}

/**
 * Counts demotions for a broker in the last N days from the ledger.
 */
function countRecentDemotions(ledger, slug, days = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return ledger.events.filter(
    e =>
      e.slug === slug &&
      e.action === 'demote' &&
      new Date(e.timestamp).getTime() >= since
  ).length;
}

// ---------- evaluation ----------

/**
 * Decide what (if anything) to do to this broker.
 * @returns {{ action: 'promote'|'demote'|'fire'|'hold', reason: string, metrics: object }}
 */
function evaluateBroker(broker, session, ledger) {
  const stats = (session && session.stats) || {};
  const sharpe = computeSharpe(session);
  const days = daysSinceStart(session);
  const totalTrades = (stats.wins || 0) + (stats.losses || 0);
  const winRate = totalTrades > 0 ? (stats.wins || 0) / totalTrades : 0;
  const maxDD = stats.maxDrawdown || 0;
  const tier = broker.tier;

  // Per-source edge: realized expectancy of the broker's primary signal source.
  const edge = evaluateEdgeGate(session);

  const metrics = {
    sharpe,
    winRate,
    maxDD,
    totalTrades,
    days,
    edge,
  };

  // FIRE: catastrophic drawdown wipes the broker regardless of tier
  if (maxDD > FIRE.maxDrawdownPct) {
    return {
      action: 'fire',
      reason: `drawdown ${maxDD.toFixed(1)}% > ${FIRE.maxDrawdownPct}% threshold`,
      metrics,
    };
  }
  if (countRecentDemotions(ledger, broker.slug, 30) >= FIRE.demotionsIn30Days) {
    return {
      action: 'fire',
      reason: `${FIRE.demotionsIn30Days}+ demotions in 30 days`,
      metrics,
    };
  }

  // PROMOTE: sim → paper
  if (tier === 'simulated') {
    const meetsAggregate =
      sharpe != null &&
      sharpe >= PROMOTE.minSharpe &&
      winRate >= PROMOTE.minWinRate &&
      maxDD <= PROMOTE.maxDrawdownPct &&
      totalTrades >= PROMOTE.minTrades &&
      days >= PROMOTE.minDays;

    if (meetsAggregate && edge.pass) {
      return {
        action: 'promote',
        reason: `sharpe=${sharpe.toFixed(2)} wr=${(winRate * 100).toFixed(1)}% dd=${maxDD.toFixed(1)}% trades=${totalTrades} days=${days.toFixed(1)} | edge ${edge.reason}`,
        metrics,
      };
    }
    // Aggregate stats qualify but the signal source hasn't proven an edge:
    // hold at sim and say so explicitly. This is the edge gate doing its job.
    if (meetsAggregate && !edge.pass) {
      return {
        action: 'hold',
        reason: `sim — edge gate blocked promotion: ${edge.reason}`,
        metrics,
      };
    }
    return { action: 'hold', reason: 'sim — not yet promoted', metrics };
  }

  // DEMOTE: paper → sim
  if (tier === 'paper') {
    if (days >= DEMOTE.minDays) {
      if (maxDD > DEMOTE.maxDrawdownPct) {
        return {
          action: 'demote',
          reason: `drawdown ${maxDD.toFixed(1)}% > ${DEMOTE.maxDrawdownPct}%`,
          metrics,
        };
      }
      if (sharpe != null && sharpe < DEMOTE.minSharpe) {
        return {
          action: 'demote',
          reason: `sharpe ${sharpe.toFixed(2)} < ${DEMOTE.minSharpe}`,
          metrics,
        };
      }
    }
    return {
      action: 'hold',
      reason: 'paper — performing within tolerance',
      metrics,
    };
  }

  return { action: 'hold', reason: 'unknown tier', metrics };
}

// ---------- breeding ----------

/**
 * Build a "child" broker by jittering parameters from a top performer. The
 * personality body is copied verbatim from the parent — the child gets the
 * parent's voice but slightly different risk knobs. Adds a `bred-from` note.
 */
function jitterChild(parent, parentPersona, childSlug) {
  const jitter = (v, magnitude) =>
    Math.max(0.001, v * (1 + (Math.random() * 2 - 1) * magnitude));

  const child = {
    ...parent,
    slug: childSlug,
    name: `${parent.name} (gen2)`,
    tier: 'simulated', // children always start sim
    risk: {
      ...parent.risk,
      perTrade: Math.min(0.1, jitter(parent.risk.perTrade, 0.25)),
      kellyFraction: Math.min(1, jitter(parent.risk.kellyFraction, 0.25)),
      maxPositionSizePercent: Math.min(
        100,
        jitter(parent.risk.maxPositionSizePercent, 0.2)
      ),
    },
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const note = `\n\n## Heritage\n\nBred ${stamp} from \`${parent.slug}\` with parameter jitter.`;
  return { broker: child, persona: parentPersona + note };
}

async function pickTopPerformer(brokers, getSessionForSlug) {
  // Pick the highest-Sharpe simulated or paper broker (excluding any flagged
  // for fire/demote in the same cycle).
  let best = null;
  let bestSharpe = -Infinity;
  for (const b of brokers) {
    const session = getSessionForSlug(b.slug);
    if (!session) continue;
    const sharpe = computeSharpe(session);
    if (sharpe != null && sharpe > bestSharpe) {
      bestSharpe = sharpe;
      best = b;
    }
  }
  return best;
}

// ---------- driver ----------

/**
 * Iterate every broker, evaluate, apply decisions, log to ledger and broadcast.
 *
 * @param {object} deps
 * @param {object} deps.engine — aiTradingEngine module
 * @param {object} deps.bridge — brokerSessionBridge module (for re-sync after writes)
 * @param {boolean} [opts.dryRun] — if true, evaluate but don't mutate files
 * @param {boolean} [opts.breed] — if true, spawn a child when an agent is fired
 */
async function runTierEvaluation(deps, opts = {}) {
  const { engine, bridge } = deps;
  const dryRun = !!opts.dryRun;
  const breed = !!opts.breed;

  const ledger = await _loadLedger();
  const brokerResults = await loadAllBrokers();
  const validBrokers = brokerResults
    .filter(r => r.broker)
    .map(r => ({ broker: r.broker, persona: r.persona, file: r.file }));

  const getSessionForSlug = slug => {
    const all = engine.getAllUserSessions('brokers') || [];
    const proj = all.find(s => s.config && s.config.brokerSlug === slug);
    if (!proj) return null;
    return engine.getSession(proj.sessionId);
  };

  const decisions = [];
  for (const { broker, persona } of validBrokers) {
    const session = getSessionForSlug(broker.slug);
    if (!session) continue;
    const decision = evaluateBroker(broker, session, ledger);
    decisions.push({ broker, persona, session, decision });
  }

  const summary = {
    evaluated: decisions.length,
    promoted: 0,
    demoted: 0,
    fired: 0,
    bred: 0,
  };

  for (const { broker, persona, session, decision } of decisions) {
    if (decision.action === 'hold') continue;
    if (dryRun) continue;

    if (decision.action === 'promote') {
      const updated = { ...broker, tier: 'paper' };
      await writeBroker(broker.slug, updated, persona);
      // Switch the live session over: simulationMode off, fresh paper cash.
      // Stats history is preserved so demote-eligibility still works.
      const { effectiveCapital } = require('./brokerSchema');
      const paperAlloc = effectiveCapital(updated);
      const transition = engine.transitionToPaperTier(
        session.sessionId,
        paperAlloc
      );
      summary.promoted++;
      await _appendLedger({
        slug: broker.slug,
        action: 'promote',
        from: 'simulated',
        to: 'paper',
        paperAllocation: paperAlloc,
        reason: decision.reason,
        metrics: decision.metrics,
        transition,
      });
      websocketServer.broadcastToAll('broker_tier_change', {
        slug: broker.slug,
        from: 'simulated',
        to: 'paper',
        paperAllocation: paperAlloc,
        reason: decision.reason,
      });
      tradingLogger.logInfo(
        `[Tier] promoted ${broker.slug} → paper ($${paperAlloc} allocation): ${decision.reason}`,
        {
          sessionId: session.sessionId,
          sessionName: session.name,
        }
      );
    } else if (decision.action === 'demote') {
      const updated = { ...broker, tier: 'simulated' };
      await writeBroker(broker.slug, updated, persona);
      // Switch back to sim: panic-close any open real positions, fresh sim cash.
      const transition = await engine.transitionToSimulatedTier(
        session.sessionId,
        broker.capital
      );
      summary.demoted++;
      await _appendLedger({
        slug: broker.slug,
        action: 'demote',
        from: 'paper',
        to: 'simulated',
        simCapital: broker.capital,
        reason: decision.reason,
        metrics: decision.metrics,
        transition,
      });
      websocketServer.broadcastToAll('broker_tier_change', {
        slug: broker.slug,
        from: 'paper',
        to: 'simulated',
        reason: decision.reason,
      });
      tradingLogger.logInfo(
        `[Tier] demoted ${broker.slug} → simulated: ${decision.reason}`,
        {
          sessionId: session.sessionId,
          sessionName: session.name,
        }
      );
    } else if (decision.action === 'fire') {
      const archived = await archiveBroker(broker.slug);
      try {
        engine.stopSession(session.sessionId);
      } catch {
        // best-effort
      }
      summary.fired++;
      await _appendLedger({
        slug: broker.slug,
        action: 'fire',
        from: broker.tier,
        to: 'fired',
        reason: decision.reason,
        metrics: decision.metrics,
        archive: archived,
      });
      websocketServer.broadcastToAll('broker_tier_change', {
        slug: broker.slug,
        from: broker.tier,
        to: 'fired',
        reason: decision.reason,
      });
      tradingLogger.logInfo(`[Tier] fired ${broker.slug}: ${decision.reason}`, {
        sessionId: session.sessionId,
        sessionName: session.name,
      });

      if (breed) {
        const parent = await pickTopPerformer(
          validBrokers
            .filter(v => v.broker.slug !== broker.slug)
            .map(v => v.broker),
          getSessionForSlug
        );
        if (parent) {
          const childSlug = `${parent.slug}-gen2-${Date.now().toString(36).slice(-4)}`;
          // Look up the parent's persona body from the loaded results
          const parentEntry = validBrokers.find(
            v => v.broker.slug === parent.slug
          );
          const parentPersona = parentEntry ? parentEntry.persona : '';
          const { broker: child, persona: childPersona } = jitterChild(
            parent,
            parentPersona,
            childSlug
          );
          const validated = validateBroker(child, `${childSlug}.md`);
          if (validated.broker) {
            await writeBroker(childSlug, validated.broker, childPersona, {
              skipSnapshot: true,
            });
            summary.bred++;
            await _appendLedger({
              slug: childSlug,
              action: 'breed',
              parent: parent.slug,
              fromFired: broker.slug,
              reason: 'replacement for fired agent',
            });
            websocketServer.broadcastToAll('broker_tier_change', {
              slug: childSlug,
              from: 'born',
              to: 'simulated',
              reason: `bred from ${parent.slug} after ${broker.slug} fired`,
            });
            tradingLogger.logInfo(
              `[Tier] bred ${childSlug} from ${parent.slug}`,
              {}
            );
          }
        }
      }
    }
  }

  // If anything changed, ask the bridge to reconcile so sessions match the
  // freshly-written .md files. The file watcher would also pick this up, but
  // an explicit sync avoids races.
  if (
    !dryRun &&
    bridge &&
    typeof bridge.syncBrokersToSessions === 'function' &&
    summary.promoted + summary.demoted + summary.fired + summary.bred > 0
  ) {
    try {
      await bridge.syncBrokersToSessions();
    } catch (err) {
      tradingLogger.logError('[Tier] post-eval sync failed', {
        error: err.message,
      });
    }
  }

  return {
    summary,
    decisions: decisions.map(d => ({ slug: d.broker.slug, ...d.decision })),
  };
}

module.exports = {
  PROMOTE,
  DEMOTE,
  FIRE,
  EDGE_GATE,
  LEDGER_PATH,
  computeSharpe,
  daysSinceStart,
  aggregateBySource,
  evaluateEdgeGate,
  evaluateBroker,
  runTierEvaluation,
  getLedger,
  jitterChild,
};
