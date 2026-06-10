#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-trend.js
//
// Five-gate validation of the DEPLOYED trend-following spec — the
// trend-follower broker as it actually runs:
//
//   Universe: its 18-ETF watchlist. Hold up to 5 names equal-sized (20% of
//   equity at entry). A name is eligible while trendCore says uptrend
//   (price > 200d SMA AND 12-1 momentum > 0, decided on closes through
//   yesterday). Exit to cash the day the trend breaks; refill free slots
//   with the highest-momentum eligible names. No leverage.
//
// FAITHFULNESS: the per-name decision is quant-core trendCore — the same
// function the live plugin calls, certified zero-divergence by
// certify-trend-core.js. The portfolio loop emulates the engine's
// slot/refill/sizing mechanics; that emulation (and live's intraday
// execution timing) is the recorded residual.
//
// NO PARAMETER SELECTION: the deployed params (200/252/21, top-5) are fixed
// convention, not tuned here — so the walk-forward has a single candidate
// and the stitched OOS is simply unseen data under the fixed rule. A
// neighbor-parameter sensitivity table is recorded (and every neighbor is a
// ledger trial) to show the result is not an isolated parameter island.
//
// Outputs:
//   - verdict artifact (headline = OOS equity, gates filled)
//   - instrumented full-period artifact (every trade, bars, exact ledger)
//     for the terminal/web viewers

require('dotenv').config();
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { trendCore, equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const { writeRunArtifact } = require('./lib/runArtifact');
const { recordTrials } = require('./lib/trialsLedger');

const START = '2016-01-04';
const CAPITAL = 100000;

// trend-follower broker watchlist (agents/brokers/trend-follower.md)
const UNIVERSE = [
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  'XLK',
  'SMH',
  'XLF',
  'XLE',
  'XLV',
  'XLY',
  'XLP',
  'XLI',
  'XLU',
  'XLB',
  'XLRE',
  'XLC',
  'EEM',
  'EFA',
];

const DEPLOYED = {
  smaWindow: 200,
  momLookback: 252,
  momSkip: 21,
  maxPositions: 5,
  sizePct: 0.2,
};

/**
 * Deployed-spec portfolio simulation with an exact dollar ledger.
 *
 * Decision timing: positions held into day i are decided from closes through
 * day i-1 (trendCore on each symbol's own completed bars); trades execute at
 * day i's close. Engine emulation: exit on trend break, then refill free
 * slots with the highest-momentum eligible names at 20% of current equity
 * (or remaining cash).
 */
// Anti-fishing sidecar (manifest R0): every 1x-cost invocation of the engine
// is logged with a params+universe+window hash. The morning audit diffs this
// log against the trials ledger — params computed but never recorded as a
// trial = caught fishing. (Catches only callers of THIS engine; a copied
// engine is invisible — narrowing the hole, not closing it.)
function _logEngineInvocation(params, universe, dates) {
  try {
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const entry = {
      hash: crypto
        .createHash('sha1')
        .update(
          JSON.stringify({
            params,
            universe: [...universe].sort(),
            window: [dates[0], dates[dates.length - 1]],
          })
        )
        .digest('hex')
        .slice(0, 12),
      params,
      universe: universe.length,
      window: [dates[0], dates[dates.length - 1]],
      at: new Date().toISOString(),
    };
    const p = path.join(
      __dirname,
      '../../data/backtests/engine-invocations.log'
    );
    fs.appendFileSync(p, JSON.stringify(entry) + '\n');
  } catch (e) {
    /* sidecar must never break a run */
  }
}

function simulateDeployed(
  { dates, series, bars },
  params,
  costMultiplier,
  universe = UNIVERSE
) {
  if (costMultiplier === 1) _logEngineInvocation(params, universe, dates);
  const {
    smaWindow,
    momLookback,
    momSkip,
    maxPositions,
    sizePct,
    rankBy = 'momentum', // 'momentum' (deployed) | 'volAdjusted' (mom/vol63)
    sizing = 'fixed', // 'fixed' (20% slots) | 'invVol' (manifest PC1)
    sizeCap = 0.35, // per-slot cap for invVol sizing
  } = params;
  // 'placeboShuffle' (manifest R1): deterministic seeded pseudo-random
  // ranking among ELIGIBLE names — isolates whether the ranking stage adds
  // value over a random pick of trend-eligible names. Never deployable.
  const placeboHash = (sym, date) => {
    let h = params.placeboSeed || 404;
    const s = sym + date;
    for (let c = 0; c < s.length; c++) h = (h * 31 + s.charCodeAt(c)) >>> 0;
    return h / 4294967296;
  };
  const scoreOf = (st, sym, date) =>
    rankBy === 'placeboShuffle'
      ? placeboHash(sym, date)
      : rankBy === 'volAdjusted'
        ? (st.rankScore ?? -Infinity)
        : (st.momentum ?? 0);

  // Per-symbol clean closes + map from calendar index -> "bars through that
  // date" length (forward-filled aligned series can hold leading nulls that
  // would poison the SMA).
  const clean = {};
  const upTo = {}; // upTo[sym][i] = number of completed bars at calendar day i
  for (const sym of universe) {
    if (!bars[sym]) continue;
    clean[sym] = bars[sym].map(b => b.close);
    const dateIdx = new Map(bars[sym].map((b, k) => [b.date, k]));
    const arr = new Array(dates.length).fill(0);
    let last = 0;
    for (let i = 0; i < dates.length; i++) {
      const k = dateIdx.get(dates[i]);
      if (k != null) last = k + 1;
      arr[i] = last;
    }
    upTo[sym] = arr;
  }
  const syms = Object.keys(clean);

  const decide = (sym, i) => {
    // decision for day i uses bars completed through day i-1
    const n = upTo[sym][i - 1];
    if (!n) return { ok: false, uptrend: false, momentum: null };
    return trendCore.evaluateTrend(clean[sym].slice(0, n), {
      smaWindow,
      momLookback,
      momSkip,
      volWindow: params.volWindow,
    });
  };

  const positions = new Map(); // sym -> { qty, basis, entryDate, entryPrice }
  let cash = CAPITAL;
  const trades = [];
  const returns = new Array(dates.length).fill(null);
  const eq = [];
  const eqDates = [];
  const startI = Math.max(momLookback, smaWindow) + 2;

  const px = (sym, i) => series[sym][i]; // aligned, forward-filled

  let prevEquity = CAPITAL;
  for (let i = startI; i < dates.length; i++) {
    const date = dates[i];

    // 1) decisions from yesterday's completed closes
    const states = new Map();
    for (const sym of syms) states.set(sym, decide(sym, i));

    // 2) exits at today's close: trend broken
    for (const [sym, pos] of [...positions]) {
      const st = states.get(sym);
      if (!st || !st.ok) continue; // no data -> hold (engine backstop analog)
      if (st.uptrend) continue;
      const price = px(sym, i);
      if (!(price > 0)) continue;
      const gross = pos.qty * price;
      const cost = gross * (bpsPerSide(sym) / 10000) * costMultiplier;
      const proceeds = gross - cost;
      cash += proceeds;
      trades.push({
        date,
        symbol: sym,
        side: 'sell',
        price,
        qty: pos.qty,
        notional: gross,
        pnl: proceeds - pos.basis,
        pnlPct: pos.basis > 0 ? proceeds / pos.basis - 1 : null,
        holdingDays: Math.round(
          (new Date(date) - new Date(pos.entryDate)) / 864e5
        ),
        reason:
          st.aboveSma === false
            ? 'trend break: below SMA'
            : 'trend break: momentum <= 0',
      });
      positions.delete(sym);
    }

    // 3) refill free slots with highest-momentum eligible names
    if (positions.size < maxPositions) {
      const eligible = syms
        .filter(sym => !positions.has(sym))
        .map(sym => ({ sym, st: states.get(sym) }))
        .filter(x => x.st && x.st.ok && x.st.uptrend && px(x.sym, i) > 0)
        .sort(
          (a, b) => scoreOf(b.st, b.sym, date) - scoreOf(a.st, a.sym, date)
        );
      // equity right now (after sells, before buys)
      let equityNow = cash;
      for (const [sym, pos] of positions) equityNow += pos.qty * px(sym, i);

      // Manifest PC1 (pre-registered formula): for invVol sizing, weights are
      // normalized 1/vol over the WOULD-BE top-N book (current holdings +
      // best fills), capped per slot, funded from cash only (gross <= 100%
      // by construction), entries never resized later. Vol comes exclusively
      // from trendCore st.vol in the day's states map (bars through i-1).
      let invVolShare = null;
      if (sizing === 'invVol') {
        const wouldBe = [
          ...[...positions.keys()],
          ...eligible
            .slice(0, Math.max(0, maxPositions - positions.size))
            .map(c => c.sym),
        ];
        let denom = 0;
        const inv = new Map();
        for (const sym of wouldBe) {
          const st = states.get(sym);
          if (st && st.ok && st.vol > 0) {
            inv.set(sym, 1 / st.vol);
            denom += 1 / st.vol;
          }
        }
        invVolShare = sym =>
          denom > 0 && inv.has(sym) ? inv.get(sym) / denom : 1 / maxPositions;
      }

      for (const cand of eligible) {
        if (positions.size >= maxPositions) break;
        const share =
          sizing === 'invVol'
            ? Math.min(sizeCap, invVolShare(cand.sym))
            : sizePct;
        const target = Math.min(share * equityNow, cash);
        if (target < 1) break;
        const price = px(cand.sym, i);
        const cost = target * (bpsPerSide(cand.sym) / 10000) * costMultiplier;
        const qty = (target - cost) / price;
        if (!(qty > 0)) continue;
        cash -= target;
        positions.set(cand.sym, {
          qty,
          basis: target,
          entryDate: date,
          entryPrice: price,
        });
        trades.push({
          date,
          symbol: cand.sym,
          side: 'buy',
          price,
          qty,
          notional: target,
          pnl: null,
          pnlPct: null,
          reason: `uptrend, momentum ${((cand.st.momentum ?? 0) * 100).toFixed(1)}% (rank fill)`,
        });
      }
    }

    // 4) mark to market (+ manifest assertions: no negative cash, no leverage)
    if (cash < -1e-6) {
      throw new Error(`negative cash ${cash} at ${date} — sizing bug`);
    }
    let equity = cash;
    for (const [sym, pos] of positions) equity += pos.qty * px(sym, i);
    if (equity - cash > equity * (1 + 1e-9)) {
      throw new Error(`gross exposure > 100% at ${date} — sizing bug`);
    }
    returns[i] = equity / prevEquity - 1;
    prevEquity = equity;
    eq.push(equity / CAPITAL);
    eqDates.push(date);
  }

  const openPositions = [...positions].map(([sym, pos]) => ({
    symbol: sym,
    qty: pos.qty,
    avgCost: pos.basis / pos.qty,
    lastPrice: px(sym, dates.length - 1),
    unrealizedPnl: pos.qty * px(sym, dates.length - 1) - pos.basis,
  }));

  return { returns, trades, openPositions, eq, eqDates };
}

async function main() {
  let stash = null; // instrumented full-period sim, captured during gate 3

  const result = await validateStrategy({
    family: 'trend-following',
    strategyId: 'deployed-top5-WF-OOS',
    script: 'scripts/backtests/validate-trend.js',
    description:
      'The trend-follower broker AS DEPLOYED: top-5 of 18 ETFs while price > 200d SMA and 12-1 momentum > 0 (quant-core trendCore, certified vs live), exit on trend break, 20% slots, no leverage. Fixed params — no selection. Headline equity is out-of-sample under the fixed rule.',
    universe: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      const sim = simulateDeployed(ctx, DEPLOYED, ctx.costMultiplier);
      if (ctx.costMultiplier === 1 && !stash) {
        // tooling self-check: the dollar ledger must tie to the equity curve
        const realized = sim.trades.reduce((a, t) => a + (t.pnl || 0), 0);
        const unreal = sim.openPositions.reduce(
          (a, p) => a + p.unrealizedPnl,
          0
        );
        const equityPnl = sim.eq[sim.eq.length - 1] * CAPITAL - CAPITAL;
        const gap = equityPnl - (realized + unreal);
        console.log(
          `[ledger-check] realized ${realized.toFixed(2)} + unrealized ${unreal.toFixed(2)} vs equity Δ ${equityPnl.toFixed(2)} → gap ${gap.toFixed(2)}`
        );
        if (Math.abs(gap) > 1) {
          throw new Error(
            'deployed-sim ledger does not tie to its equity curve — fix before trusting any verdict'
          );
        }
        stash = { sim, ctx };
      }
      return [{ params: DEPLOYED, returns: sim.returns }];
    },
    faithfulness: { certification: 'trend-core' },
    benchmarkSymbol: 'SPY',
    notes: [
      'Deployed spec under test: agents/brokers/trend-follower.md (fixed rules, not self-mutable).',
      'Decision core certified vs live plugin (certifications/trend-core.json). Residuals: live decides intraday with a realtime price (backtest decides on yesterday close, executes at today close) and live sizing uses engine mechanics emulated here.',
      'No parameter selection in this run: walk-forward has a single fixed candidate, so the OOS window is simply unseen data under the deployed rule. See extra.sensitivity for the neighbor-parameter table.',
    ],
    extraReport: {},
  });

  // ---- neighbor-parameter sensitivity (every neighbor = a ledger trial) ----
  console.log(
    '\n[sensitivity] neighbor parameters (full-period, in-sample, for robustness only)'
  );
  const { ctx } = stash;
  const neighbors = [];
  for (const smaWindow of [150, 200, 250]) {
    for (const momLookback of [126, 252]) {
      for (const maxPositions of [3, 5]) {
        if (
          smaWindow === DEPLOYED.smaWindow &&
          momLookback === DEPLOYED.momLookback &&
          maxPositions === DEPLOYED.maxPositions
        )
          continue;
        neighbors.push({ ...DEPLOYED, smaWindow, momLookback, maxPositions });
      }
    }
  }
  const sensitivity = [];
  for (const p of neighbors) {
    const sim = simulateDeployed(ctx, p, 1);
    const stats = equityStats.statsFromEquity(sim.eqDates, sim.eq);
    sensitivity.push({
      params: {
        smaWindow: p.smaWindow,
        momLookback: p.momLookback,
        maxPositions: p.maxPositions,
      },
      sharpe: stats.sharpe,
      cagr: stats.cagr,
      maxDD: stats.maxDD,
    });
    console.log(
      `  sma${p.smaWindow}/mom${p.momLookback}/top${p.maxPositions}: Sharpe ${stats.sharpe.toFixed(2)}  CAGR ${(stats.cagr * 100).toFixed(1)}%  maxDD ${(stats.maxDD * 100).toFixed(1)}%`
    );
  }
  recordTrials(
    sensitivity.map(s => ({
      family: 'trend-following',
      strategyId: 'deployed-top5-WF-OOS',
      params: s.params,
      sharpe: s.sharpe,
      window: { start: START, end: ctx.dates[ctx.dates.length - 1] },
      kind: 'sensitivity-grid',
    }))
  );

  // ---- instrumented full-period artifact (the watchable one) ----
  const { sim } = stash;
  const tradedSymbols = [...new Set(sim.trades.map(t => t.symbol))];
  const variantBars = {};
  for (const s of tradedSymbols) if (ctx.bars[s]) variantBars[s] = ctx.bars[s];
  const benchStart = ctx.dates.indexOf(sim.eqDates[0]);
  const spyPx = ctx.series['SPY'];
  const benchVals = sim.eqDates.map(
    (d, k) => spyPx[benchStart + k] / spyPx[benchStart]
  );
  const { runId: instRunId } = writeRunArtifact({
    family: 'trend-following',
    strategyId: 'deployed-top5-instrumented',
    script: 'scripts/backtests/validate-trend.js',
    description:
      'Full-period instrumented run of the deployed trend-follower spec (every trade, exact ledger). The VERDICT lives in the companion WF-OOS artifact — this one exists to be watched.',
    params: DEPLOYED,
    capital: CAPITAL,
    dates: sim.eqDates,
    equity: sim.eq,
    benchmark: { symbol: 'SPY', values: benchVals },
    trades: sim.trades,
    openPositions: sim.openPositions,
    bars: variantBars,
    data: {
      source: 'alpaca',
      adjustment: 'all',
      timeframe: '1Day',
      window: {
        start: sim.eqDates[0],
        end: sim.eqDates[sim.eqDates.length - 1],
      },
      symbols: UNIVERSE,
    },
    notes: [
      `Companion verdict artifact: ${result.runId}`,
      'IN-SAMPLE full period — gates intentionally left not_run here; the five-gate verdict is in the companion artifact.',
    ],
    extra: { sensitivity },
  });
  console.log(`\ninstrumented artifact: ${instRunId}`);
  console.log(`view:                  npm run backtest:view ${instRunId}`);
}

// Exported so spec variants (e.g. validate-trend-breadth.js) run the SAME
// portfolio engine — one implementation, no drift between spec tests.
module.exports = { simulateDeployed, DEPLOYED, UNIVERSE, CAPITAL };

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
