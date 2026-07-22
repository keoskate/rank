#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/soxx-band-rebalance.js
//
// The SOUND version of the SOXX ladder: threshold (band) rebalancing.
//
// The original ladder (soxx-ladder.js) had three structural flaws: fixed
// 1-share rungs (arbitrary drifting dollar size), an absolute last-trade-price
// anchor (goes stale → strands in cash on a trending asset), and no target
// exposure (drifted to ~90% cash). This keeps the same reflex — sell after
// rises, buy after falls, checked daily — but anchors on PORTFOLIO WEIGHT:
//
//   - Target mix: w in SOXX, 1−w in cash.
//   - Each day at the close, if |actual weight − w| > band, trade back to
//     exactly w. Rallies push the weight up → sell; drops pull it down → buy.
//
// This is classic volatility harvesting (the rebalancing premium,
// ≈ ½·w(1−w)·σ² per year gross for an asset-vs-cash mix). It cannot strand
// (the anchor is the weight itself) and sizes trades in dollars.
//
// Benchmarks (same capital):
//   - static drift mix: buy w day 0, never touch — isolates what TRADING adds
//   - monthly calendar rebalance to w — the standard alternative cadence
//   - 100% SOXX buy & hold — full-exposure context (and the gate-3 control)
//
// Cash earns 0% (conservative — a real account would earn T-bill yield on the
// cash sleeve, which HELPS this strategy; noted in the artifact).
//
//   node scripts/backtests/soxx-band-rebalance.js [--w 0.5] [--band 0.02]

require('dotenv').config();
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { equityStats } = require('@keo/quant-core');
const { loadDailyBars } = require('./lib/marketData');
const { writeRunArtifact } = require('./lib/runArtifact');
const { asciiChart } = require('./soxx-ladder');

const SYMBOL = 'SOXX';
const START = '2016-01-04';
const CAPITAL = 100000;

/**
 * Threshold-rebalancing simulation.
 * @param {Array} series - [{date, close}] adjusted daily bars
 * @param {object} opts  - { targetW, band, costMultiplier }
 * @returns {object} { dates, equity, weightSeries, trades, openPositions, ... }
 */
function simulateBandRebalance(
  series,
  { targetW = 0.5, band = 0.02, costMultiplier = 1 } = {}
) {
  const bps = (bpsPerSide(SYMBOL) / 10000) * costMultiplier;
  const P0 = series[0].close;

  // day 0: establish the target position at the close (entry cost charged)
  let shares = (targetW * CAPITAL) / P0;
  let heldBasis = shares * P0;
  let cash = CAPITAL - shares * P0 - shares * P0 * bps;

  const dates = [];
  const equity = [];
  const weightSeries = [];
  const trades = [];
  let buys = 0;
  let sells = 0;

  for (let i = 0; i < series.length; i++) {
    const { date, close: px } = series[i];
    let eq = shares * px + cash;

    if (i > 0) {
      const wNow = (shares * px) / eq;
      if (Math.abs(wNow - targetW) > band) {
        const targetDollars = targetW * eq;
        const delta = targetDollars - shares * px; // >0 buy, <0 sell
        const qty = delta / px;
        const cost = Math.abs(delta) * bps;
        if (qty < 0) {
          // sell |qty| shares back to target
          const avgCost = heldBasis / shares;
          const soldQty = -qty;
          const proceeds = soldQty * px - cost;
          cash += proceeds;
          heldBasis -= avgCost * soldQty;
          shares += qty;
          sells++;
          trades.push({
            date,
            symbol: SYMBOL,
            side: 'sell',
            price: px,
            qty: soldQty,
            notional: soldQty * px,
            pnl: proceeds - avgCost * soldQty,
            pnlPct: avgCost > 0 ? (px * (1 - bps)) / avgCost - 1 : null,
            reason: `weight ${(wNow * 100).toFixed(1)}% > ${(targetW * 100).toFixed(0)}%+${(band * 100).toFixed(0)} → trim to target`,
          });
        } else {
          const spent = delta + cost;
          cash -= spent;
          heldBasis += spent;
          shares += qty;
          buys++;
          trades.push({
            date,
            symbol: SYMBOL,
            side: 'buy',
            price: px,
            qty,
            notional: delta,
            pnl: null,
            pnlPct: null,
            reason: `weight ${(wNow * 100).toFixed(1)}% < ${(targetW * 100).toFixed(0)}%−${(band * 100).toFixed(0)} → add to target`,
          });
        }
        eq = shares * px + cash;
      }
    }

    dates.push(date);
    equity.push(eq / CAPITAL);
    weightSeries.push((shares * px) / eq);
  }

  const lastPx = series[series.length - 1].close;
  return {
    dates,
    equity,
    weightSeries,
    trades,
    buys,
    sells,
    finalShares: shares,
    finalCash: cash,
    openPositions:
      shares > 0
        ? [
            {
              symbol: SYMBOL,
              qty: shares,
              avgCost: heldBasis / shares,
              lastPrice: lastPx,
              unrealizedPnl: shares * lastPx - heldBasis,
            },
          ]
        : [],
  };
}

// ── two-asset pair mode (e.g. SOXX/SPY): the sleeve is a second RISKY asset,
// not cash. Both legs earn their premium; rebalancing harvests the RELATIVE
// swing between them. Costs charged on both legs; a residual cash bucket
// absorbs cost-estimate rounding and must stay ~0 (asserted). ──────────────

/** Align B onto A's calendar (forward-fill B; drop A days before B exists). */
function alignPair(seriesA, seriesB) {
  const mapB = new Map(seriesB.map(b => [b.date, b.close]));
  const A = [];
  const B = [];
  let lastB = null;
  for (const bar of seriesA) {
    const pb = mapB.get(bar.date) ?? lastB;
    if (pb == null) continue;
    lastB = pb;
    A.push(bar);
    B.push({ date: bar.date, close: pb });
  }
  return { A, B };
}

/**
 * Band rebalancing between two risky assets: w in A, 1−w in B; trade both legs
 * back to target when A's weight drifts beyond ±band.
 */
function simulateBandRebalancePair(
  seriesA,
  seriesB,
  { targetW = 0.5, band = 0.02, costMultiplier = 1, symA = SYMBOL, symB = 'SPY' } = {}
) {
  const bpsA = (bpsPerSide(symA) / 10000) * costMultiplier;
  const bpsB = (bpsPerSide(symB) / 10000) * costMultiplier;
  const pA0 = seriesA[0].close;
  const pB0 = seriesB[0].close;

  // day 0: establish both legs (entry costs shrink the invested amount)
  const wbps = bpsA * targetW + bpsB * (1 - targetW);
  let eqNet = CAPITAL * (1 - wbps);
  let sA = (targetW * eqNet) / pA0;
  let sB = ((1 - targetW) * eqNet) / pB0;
  let basisA = sA * pA0;
  let basisB = sB * pB0;
  let cash = CAPITAL - sA * pA0 * (1 + bpsA) - sB * pB0 * (1 + bpsB);

  const dates = [];
  const equity = [];
  const weightSeries = [];
  const trades = [];
  let rebalances = 0;

  const legTrade = (sym, px, delta, cost, leg) => {
    // delta>0 buy, delta<0 sell; updates shares/basis via closures below
    if (delta >= 0) {
      trades.push({
        date: leg.date, symbol: sym, side: 'buy', price: px,
        qty: delta / px, notional: delta, pnl: null, pnlPct: null,
        reason: leg.reason,
      });
      return { dShares: delta / px, dBasis: delta + cost, realized: null };
    }
    const soldQty = -delta / px;
    const avgCost = leg.shares > 0 ? leg.basis / leg.shares : px;
    const proceeds = -delta - cost;
    const realized = proceeds - avgCost * soldQty;
    trades.push({
      date: leg.date, symbol: sym, side: 'sell', price: px,
      qty: soldQty, notional: -delta, pnl: realized,
      pnlPct: avgCost > 0 ? (px * (1 - (cost / -delta || 0))) / avgCost - 1 : null,
      reason: leg.reason,
    });
    return { dShares: delta / px, dBasis: -avgCost * soldQty, realized };
  };

  for (let i = 0; i < seriesA.length; i++) {
    const date = seriesA[i].date;
    const pA = seriesA[i].close;
    const pB = seriesB[i].close;
    let valA = sA * pA;
    let valB = sB * pB;
    let eq = valA + valB + cash;

    if (i > 0) {
      const wNow = valA / eq;
      if (Math.abs(wNow - targetW) > band) {
        const estCost =
          bpsA * Math.abs(targetW * eq - valA) +
          bpsB * Math.abs((1 - targetW) * eq - valB);
        const net = eq - estCost;
        const deltaA = targetW * net - valA;
        const deltaB = (1 - targetW) * net - valB;
        const costA = bpsA * Math.abs(deltaA);
        const costB = bpsB * Math.abs(deltaB);
        const reason = `weight ${(wNow * 100).toFixed(1)}% vs target ${(targetW * 100).toFixed(0)}% ±${(band * 100).toFixed(0)} → rebalance pair`;

        const rA = legTrade(symA, pA, deltaA, costA, { date, reason, shares: sA, basis: basisA });
        sA += rA.dShares;
        basisA += rA.dBasis;
        const rB = legTrade(symB, pB, deltaB, costB, { date, reason, shares: sB, basis: basisB });
        sB += rB.dShares;
        basisB += rB.dBasis;

        // cash flow: buying leg X consumes deltaX + costX; selling returns −deltaX − costX
        cash += -(deltaA + costA) - (deltaB + costB);
        rebalances++;
        valA = sA * pA;
        valB = sB * pB;
        eq = valA + valB + cash;
        if (Math.abs(cash) > 5) {
          throw new Error(`pair-rebalance cash residual ${cash.toFixed(4)} at ${date} — bookkeeping bug`);
        }
      }
    }

    dates.push(date);
    equity.push(eq / CAPITAL);
    weightSeries.push(valA / eq);
  }

  const lastA = seriesA[seriesA.length - 1].close;
  const lastB = seriesB[seriesB.length - 1].close;
  return {
    dates,
    equity,
    weightSeries,
    trades,
    rebalances,
    openPositions: [
      { symbol: symA, qty: sA, avgCost: basisA / sA, lastPrice: lastA, unrealizedPnl: sA * lastA - basisA },
      { symbol: symB, qty: sB, avgCost: basisB / sB, lastPrice: lastB, unrealizedPnl: sB * lastB - basisB },
    ],
  };
}

/** Static drift pair: buy both legs day 0, never touch. */
function simulateStaticPair(seriesA, seriesB, targetW, costMultiplier = 1, symA = SYMBOL, symB = 'SPY') {
  const bpsA = (bpsPerSide(symA) / 10000) * costMultiplier;
  const bpsB = (bpsPerSide(symB) / 10000) * costMultiplier;
  const eqNet = CAPITAL * (1 - (bpsA * targetW + bpsB * (1 - targetW)));
  const sA = (targetW * eqNet) / seriesA[0].close;
  const sB = ((1 - targetW) * eqNet) / seriesB[0].close;
  return seriesA.map((b, i) => (sA * b.close + sB * seriesB[i].close) / CAPITAL);
}

/** Calendar pair: rebalance to w on the first trading day of each month. */
function simulateMonthlyPair(seriesA, seriesB, targetW, costMultiplier = 1, symA = SYMBOL, symB = 'SPY') {
  const bpsA = (bpsPerSide(symA) / 10000) * costMultiplier;
  const bpsB = (bpsPerSide(symB) / 10000) * costMultiplier;
  const eqNet0 = CAPITAL * (1 - (bpsA * targetW + bpsB * (1 - targetW)));
  let sA = (targetW * eqNet0) / seriesA[0].close;
  let sB = ((1 - targetW) * eqNet0) / seriesB[0].close;
  const out = [];
  for (let i = 0; i < seriesA.length; i++) {
    const pA = seriesA[i].close;
    const pB = seriesB[i].close;
    if (i > 0 && seriesA[i].date.slice(0, 7) !== seriesA[i - 1].date.slice(0, 7)) {
      const eq = sA * pA + sB * pB;
      const estCost =
        bpsA * Math.abs(targetW * eq - sA * pA) + bpsB * Math.abs((1 - targetW) * eq - sB * pB);
      const net = eq - estCost;
      sA = (targetW * net) / pA;
      sB = ((1 - targetW) * net) / pB;
    }
    out.push((sA * pA + sB * pB) / CAPITAL);
  }
  return out;
}

/** Static drift mix: buy w at day 0 (with cost), never trade again. */
function simulateStaticMix(series, targetW, costMultiplier = 1) {
  const bps = (bpsPerSide(SYMBOL) / 10000) * costMultiplier;
  const P0 = series[0].close;
  const shares = (targetW * CAPITAL) / P0;
  const cash = CAPITAL - shares * P0 - shares * P0 * bps;
  return series.map(b => (shares * b.close + cash) / CAPITAL);
}

/** Calendar rebalance to w on the first trading day of each month. */
function simulateMonthlyMix(series, targetW, costMultiplier = 1) {
  const bps = (bpsPerSide(SYMBOL) / 10000) * costMultiplier;
  const P0 = series[0].close;
  let shares = (targetW * CAPITAL) / P0;
  let cash = CAPITAL - shares * P0 - shares * P0 * bps;
  const out = [];
  for (let i = 0; i < series.length; i++) {
    const px = series[i].close;
    if (i > 0 && series[i].date.slice(0, 7) !== series[i - 1].date.slice(0, 7)) {
      const eq = shares * px + cash;
      const delta = targetW * eq - shares * px;
      cash -= delta + Math.abs(delta) * bps;
      shares += delta / px;
    }
    out.push((shares * px + cash) / CAPITAL);
  }
  return out;
}

function fmt$(x) {
  return `$${Math.round(x).toLocaleString()}`;
}
function statLine(name, eq, dates) {
  const s = equityStats.statsFromEquity(dates, eq);
  return `  ${name.padEnd(28)} ${fmt$(eq[eq.length - 1] * CAPITAL).padStart(12)}   CAGR ${(s.cagr * 100).toFixed(1).padStart(5)}%   Sharpe ${s.sharpe.toFixed(2).padStart(5)}   maxDD ${(s.maxDD * 100).toFixed(1).padStart(6)}%   Calmar ${s.calmar.toFixed(2).padStart(5)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : def;
  };
  const targetW = getArg('--w', 0.5);
  const band = getArg('--band', 0.02);
  const sleeveIdx = args.indexOf('--sleeve');
  const sleeve = sleeveIdx >= 0 ? args[sleeveIdx + 1].toUpperCase() : null;

  if (sleeve) return mainPair({ targetW, band, sleeve });

  console.log(`Loading ${SYMBOL} (alpaca adjusted, ${START}+)…`);
  const { bars } = await loadDailyBars([SYMBOL], { start: START });
  const series = bars[SYMBOL];
  if (!series || !series.length) throw new Error('no SOXX bars');

  const sim = simulateBandRebalance(series, { targetW, band });
  const staticMix = simulateStaticMix(series, targetW);
  const monthly = simulateMonthlyMix(series, targetW);
  const P0 = series[0].close;
  const allIn = series.map(b => b.close / P0);

  const years =
    (new Date(sim.dates[sim.dates.length - 1]) - new Date(sim.dates[0])) /
    (365.25 * 864e5);

  console.log(
    `\n=== ${SYMBOL} band rebalancing — target ${(targetW * 100).toFixed(0)}% / band ±${(band * 100).toFixed(0)}pts ===`
  );
  console.log(
    `window: ${sim.dates[0]} → ${sim.dates[sim.dates.length - 1]} (${years.toFixed(1)}y)   capital ${fmt$(CAPITAL)}`
  );
  console.log(
    `trades: ${sim.buys} buys / ${sim.sells} sells (${sim.buys + sim.sells} total, ~${((sim.buys + sim.sells) / years).toFixed(1)}/yr)`
  );

  console.log('\n--- final account value ---');
  console.log(statLine(`BAND REBALANCE ${(targetW * 100).toFixed(0)}/${(100 - targetW * 100).toFixed(0)}`, sim.equity, sim.dates) + '   ← the strategy');
  console.log(statLine('static drift mix (no trades)', staticMix, sim.dates) + '   ← isolates trading value');
  console.log(statLine('monthly calendar rebalance', monthly, sim.dates));
  console.log(statLine('100% SOXX buy & hold', allIn, sim.dates));

  const stratEnd = sim.equity[sim.equity.length - 1];
  const staticEnd = staticMix[staticMix.length - 1];
  console.log(
    `\nrebalancing added ${fmt$((stratEnd - staticEnd) * CAPITAL)} vs never touching the same mix (${(((stratEnd / staticEnd) - 1) * 100).toFixed(1)}%)`
  );

  console.log(
    '\n' +
      asciiChart(
        sim.weightSeries.map(w => w * 100),
        sim.dates,
        { label: `SOXX WEIGHT %  (target ${(targetW * 100).toFixed(0)}, band ±${(band * 100).toFixed(0)}pts):`, height: 10 }
      )
  );

  const { runId, path: artifactPath } = writeRunArtifact({
    family: 'mean-reversion',
    strategyId: `soxx-band-rebalance-w${targetW * 100}-b${band * 100}`,
    script: 'scripts/backtests/soxx-band-rebalance.js',
    description: `SOXX threshold rebalancing: hold ${(targetW * 100).toFixed(0)}% SOXX / ${(100 - targetW * 100).toFixed(0)}% cash, trade back to target when weight drifts ±${(band * 100).toFixed(0)}pts. The sound reformulation of the fixed-share ladder (volatility harvesting). Benchmark = static drift mix (isolates what trading adds).`,
    params: { targetW, band, symbol: SYMBOL },
    capital: CAPITAL,
    dates: sim.dates,
    equity: sim.equity,
    benchmark: { symbol: `${SYMBOL} static ${(targetW * 100).toFixed(0)}/${(100 - targetW * 100).toFixed(0)}`, values: staticMix },
    trades: sim.trades,
    openPositions: sim.openPositions,
    bars: { [SYMBOL]: series },
    data: {
      source: 'alpaca',
      adjustment: 'all',
      timeframe: '1Day',
      window: { start: sim.dates[0], end: sim.dates[sim.dates.length - 1] },
      symbols: [SYMBOL],
    },
    notes: [
      'IN-SAMPLE single-path run — the five-gate verdict lives in validate-soxx-band-rebalance.js.',
      'Cash sleeve earns 0% (conservative): a real account earns T-bill yield on it, which would flatter every mix line equally.',
      'Embedded benchmark = static drift mix bought day 0 and never touched — the delta is the value of the rebalancing activity itself.',
    ],
    extra: { weightPct: { dates: sim.dates, values: sim.weightSeries.map(w => Math.round(w * 10000) / 100) } },
  });

  console.log(`\nartifact: ${artifactPath}`);
  console.log(`view:     npm run backtest:view ${runId}`);
}

async function mainPair({ targetW, band, sleeve }) {
  console.log(`Loading ${SYMBOL} + ${sleeve} (alpaca adjusted, ${START}+)…`);
  const { bars } = await loadDailyBars([SYMBOL, sleeve], { start: START });
  if (!bars[SYMBOL] || !bars[sleeve]) throw new Error('missing bars');
  const { A, B } = alignPair(bars[SYMBOL], bars[sleeve]);

  const sim = simulateBandRebalancePair(A, B, { targetW, band, symB: sleeve });
  const staticP = simulateStaticPair(A, B, targetW, 1, SYMBOL, sleeve);
  const monthlyP = simulateMonthlyPair(A, B, targetW, 1, SYMBOL, sleeve);
  const allInA = A.map(b => b.close / A[0].close);
  const allInB = B.map(b => b.close / B[0].close);

  const years =
    (new Date(sim.dates[sim.dates.length - 1]) - new Date(sim.dates[0])) / (365.25 * 864e5);

  console.log(
    `\n=== ${SYMBOL}/${sleeve} pair band rebalancing — target ${(targetW * 100).toFixed(0)}/${(100 - targetW * 100).toFixed(0)}, band ±${(band * 100).toFixed(0)}pts ===`
  );
  console.log(
    `window: ${sim.dates[0]} → ${sim.dates[sim.dates.length - 1]} (${years.toFixed(1)}y)   capital ${fmt$(CAPITAL)}`
  );
  console.log(`rebalances: ${sim.rebalances} (~${(sim.rebalances / years).toFixed(1)}/yr, both legs traded each time)`);

  console.log('\n--- final account value ---');
  console.log(statLine(`BAND PAIR ${(targetW * 100).toFixed(0)}/${(100 - targetW * 100).toFixed(0)} ${SYMBOL}/${sleeve}`, sim.equity, sim.dates) + '   ← the strategy');
  console.log(statLine('static drift pair (no trades)', staticP, sim.dates));
  console.log(statLine('monthly calendar pair', monthlyP, sim.dates));
  console.log(statLine(`100% ${SYMBOL} buy & hold`, allInA, sim.dates));
  console.log(statLine(`100% ${sleeve} buy & hold`, allInB, sim.dates));

  console.log(
    '\n' +
      asciiChart(
        sim.weightSeries.map(w => w * 100),
        sim.dates,
        { label: `${SYMBOL} WEIGHT %  (target ${(targetW * 100).toFixed(0)}, band ±${(band * 100).toFixed(0)}pts):`, height: 10 }
      )
  );

  const { runId, path: artifactPath } = writeRunArtifact({
    family: 'mean-reversion',
    strategyId: `soxx-${sleeve.toLowerCase()}-band-w${targetW * 100}-b${band * 100}`,
    script: 'scripts/backtests/soxx-band-rebalance.js',
    description: `${SYMBOL}/${sleeve} pair band rebalancing: ${(targetW * 100).toFixed(0)}% ${SYMBOL} / ${(100 - targetW * 100).toFixed(0)}% ${sleeve}, trade both legs to target when ${SYMBOL} weight drifts ±${(band * 100).toFixed(0)}pts. No cash sleeve — both legs earn premium; harvests the ${SYMBOL}−${sleeve} relative swing.`,
    params: { targetW, band, symbolA: SYMBOL, symbolB: sleeve },
    capital: CAPITAL,
    dates: sim.dates,
    equity: sim.equity,
    benchmark: { symbol: `static ${SYMBOL}/${sleeve} drift`, values: staticP },
    trades: sim.trades,
    openPositions: sim.openPositions,
    bars: { [SYMBOL]: A, [sleeve]: B },
    data: {
      source: 'alpaca',
      adjustment: 'all',
      timeframe: '1Day',
      window: { start: sim.dates[0], end: sim.dates[sim.dates.length - 1] },
      symbols: [SYMBOL, sleeve],
    },
    notes: [
      'IN-SAMPLE single-path run — five-gate verdict lives in validate-soxx-spy-band-rebalance.js.',
      'Both sleeves risky (no cash drag). Embedded benchmark = static drift pair (isolates what the trading adds).',
    ],
    extra: { weightPct: { dates: sim.dates, values: sim.weightSeries.map(w => Math.round(w * 10000) / 100) } },
  });

  console.log(`\nartifact: ${artifactPath}`);
  console.log(`view:     npm run backtest:view ${runId}`);
}

module.exports = {
  simulateBandRebalance,
  simulateStaticMix,
  simulateMonthlyMix,
  simulateBandRebalancePair,
  simulateStaticPair,
  simulateMonthlyPair,
  alignPair,
  SYMBOL,
  START,
  CAPITAL,
};

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
