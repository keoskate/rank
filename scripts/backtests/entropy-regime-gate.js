#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/entropy-regime-gate.js
//
// Does the Shannon-entropy regime gate IMPROVE a simple signal?
//
// Method (point-in-time, no look-ahead):
//   - Universe: a small set of liquid ETFs the brokers actually trade
//     (SOXL/SOXS/SOXX-adjacent + broad leveraged/benchmarks).
//   - Base signal: simple 5-day breakout momentum on the TRADED symbol.
//       enter long next-day-open if close[t] > max(close[t-5..t-1]).
//   - Exit: TP/SL/time identical to the insider harness.
//   - Gate variants computed PIT from the reference symbol's daily closes
//     up to and including day t (the info available before the next-open entry):
//       (A) no gate (baseline)
//       (B) low-entropy only (broker preferring trend continuation)
//       (C) high-entropy only (broker preferring chop / mean-reversion)
//       (D) block-on-transition (veto when regime is transitioning)
//   - For each variant we measure realized broker-exit expectancy + win rate,
//     and report how many entries each variant ALLOWED.
//
// This isolates the gate's effect: same signal, same exits, only the gate filter
// differs. If the gate has edge, the filtered variants should beat (A) on
// expectancy/trade or risk-adjusted terms.
//
// Bounded: <=8 symbols, daily bars only, 1 polygon call per symbol.

require('dotenv').config();
const polygon = require('../../server/polygonClient');
const { shannonEntropy } = require('@keo/quant-core');

const SYMBOLS = ['SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'SPXL', 'NVDA', 'AMD', 'QQQ'];
const REF = 'SOXX'; // brokers reference SOXX for regime
const WINDOWS = [21, 63, 252];
const START = '2021-01-01';
const END = '2024-12-31';
const LOOKBACK = 5; // breakout lookback
const TP = 8;
const SL = 4;
const HOLD = 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
};
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
const winRate = xs => (xs.filter(x => x > 0).length / (xs.length || 1)) * 100;

async function getBars(sym) {
  try {
    const b = await polygon.getHistoricalAggregates(sym, START, END, 'day');
    return Array.isArray(b) ? b : [];
  } catch (e) {
    console.error(`bars failed ${sym}: ${e.message}`);
    return [];
  }
}

// Broker-style exit walk starting at idx (entry = open at idx).
function brokerExit(bars, idx) {
  const entry = bars[idx]?.open;
  if (!(entry > 0)) return null;
  const tpPx = entry * (1 + TP / 100);
  const slPx = entry * (1 - SL / 100);
  let ret = null;
  let reason = 'time';
  for (let n = 0; n < HOLD; n++) {
    const b = bars[idx + n];
    if (!b) break;
    if (b.low <= slPx) {
      ret = -SL / 100;
      reason = 'stop';
      break;
    }
    if (b.high >= tpPx) {
      ret = TP / 100;
      reason = 'target';
      break;
    }
    ret = b.close / entry - 1;
  }
  return ret == null ? null : { ret, reason };
}

async function main() {
  if (!process.env.POLYGON_API_KEY) {
    console.error('Need POLYGON_API_KEY');
    process.exit(1);
  }

  // Reference closes for regime, aligned by date.
  console.log(`Fetching reference ${REF}…`);
  const refBars = await getBars(REF);
  if (refBars.length < 300) {
    console.error('insufficient ref bars');
    process.exit(1);
  }
  const refCloses = refBars.map(b => b.close);
  // Precompute PIT regime per ref index (using closes[0..i]). Cache by date.
  // To keep it bounded, compute regime at each ref index once.
  console.log(`Computing PIT regime for ${refBars.length} ref days…`);
  const regimeByDate = new Map();
  let prevNorm = null;
  for (let i = 0; i < refCloses.length; i++) {
    if (i < Math.max(...WINDOWS)) {
      regimeByDate.set(refBars[i].date, null);
      continue;
    }
    const snap = shannonEntropy.entropySnapshot(
      refCloses.slice(0, i + 1),
      WINDOWS
    );
    const aw = Math.min(...WINDOWS);
    const reg = shannonEntropy.classifyRegime(
      snap[aw],
      snap.Hmax,
      prevNorm != null ? prevNorm * snap.Hmax : null
    );
    if (reg.normH > 0) prevNorm = reg.normH;
    regimeByDate.set(refBars[i].date, reg);
  }

  // variant accumulators
  const V = {
    A_none: [],
    B_low: [],
    C_high: [],
    D_noTransition: [],
    E_neutral: [],
  };
  let totalSignals = 0;

  for (const sym of SYMBOLS) {
    await sleep(300);
    const bars = await getBars(sym);
    if (bars.length < LOOKBACK + 2) continue;
    process.stdout.write(`${sym}(${bars.length}) `);
    for (let t = LOOKBACK; t < bars.length - 1; t++) {
      // breakout signal on day t
      let hi = -Infinity;
      for (let k = 1; k <= LOOKBACK; k++) hi = Math.max(hi, bars[t - k].close);
      if (!(bars[t].close > hi)) continue;
      // entry at next session open = idx t+1
      const ex = brokerExit(bars, t + 1);
      if (!ex) continue;
      totalSignals++;
      V.A_none.push(ex.ret);

      // regime known as of day t (entry decided after close[t], before open[t+1])
      const reg = regimeByDate.get(bars[t].date);
      if (!reg) continue; // ref had no PIT regime that day (early / non-aligned)
      const transitioning = reg.state === 'transitioning';
      if (!transitioning) {
        if (reg.state === 'low-entropy') V.B_low.push(ex.ret);
        if (reg.state === 'high-entropy') V.C_high.push(ex.ret);
        if (reg.state === 'neutral') V.E_neutral.push(ex.ret);
        V.D_noTransition.push(ex.ret); // anything not transitioning
      }
    }
  }
  console.log('\n');

  const row = (label, xs) => {
    const m = mean(xs);
    const s = std(xs);
    const sharpe = s > 0 ? m / s : 0;
    return `${label.padEnd(26)} n=${String(xs.length).padStart(5)}  exp/trade ${pct(m).padStart(8)}  win ${winRate(xs).toFixed(0).padStart(3)}%  ret/risk ${sharpe.toFixed(3).padStart(6)}`;
  };

  console.log('=== ENTROPY GATE BACKTEST (5d breakout, broker TP/SL/time exit) ===');
  console.log(`signal events (all): ${totalSignals}`);
  console.log('');
  console.log(row('A: NO GATE (baseline)', V.A_none));
  console.log(row('B: low-entropy only', V.B_low));
  console.log(row('C: high-entropy only', V.C_high));
  console.log(row('D: block-on-transition', V.D_noTransition));
  console.log(row('E: neutral only', V.E_neutral));
  console.log('');

  const base = mean(V.A_none);
  const edge = (label, xs) =>
    `  ${label}: exp edge vs baseline ${pct(mean(xs) - base)}  (kept ${((xs.length / (V.A_none.length || 1)) * 100).toFixed(0)}% of trades)`;
  console.log(edge('low-entropy', V.B_low));
  console.log(edge('high-entropy', V.C_high));
  console.log(edge('block-on-transition', V.D_noTransition));
  console.log(edge('neutral', V.E_neutral));
}

main().catch(e => {
  console.error('failed', e);
  process.exit(1);
});
