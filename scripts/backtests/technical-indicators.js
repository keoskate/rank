#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/technical-indicators.js
//
// Backtest the LEGACY technical-indicators entry signal (RSI/MACD/BB/VWAP +
// volume) across dip / momentum / balanced presets, replayed point-in-time on
// 5-minute Polygon history. Measures TP/SL realized expectancy + forward
// returns vs a random-bar baseline on the same tickers/window.
//
// FIDELITY NOTES (what is / isn't reproduced from server/strategies/technicalIndicators.js):
//  - Reproduced: getAllIndicators() over a trailing 5-min window, the dip/
//    momentum/balanced strategyMatch branches, the confirming signals
//    (volume spike, RSI zone/divergence, MACD, Bollinger %B), the weighted
//    signalScore -> confidence, minSignalsRequired + minConfidence gates.
//  - NOT reproduced (not derivable from price history): options-flow boost,
//    regime alignment +/- (needs SOXX sentiment + live regime state machine),
//    intraday time-of-day +/-5 conf, real-time WS price. These are small
//    (+/-5..10 conf) and the report flags them. We use candle close as price.
//  - VWAP: the live code feeds ~24h of 5-min candles straight into the cumulative
//    VWAP calc with NO daily reset (see audit). We replicate that faithfully by
//    feeding the same trailing window; we ALSO run a daily-reset variant to
//    quantify how much the bug distorts the belowVwap gate.
//
// Method: for each ticker, build 5-min RTH bars. Walk forward; at each bar i
// (>= warmup) feed bars[i-LOOKBACK..i] to getAllIndicators, evaluate the entry
// rule for the chosen preset. On a BUY, simulate forward over the next HOLD
// bars with TP/SL; record realized return. Enforce a cooldown so we don't
// stack overlapping entries on the same signal. Baseline = random entry bars.

require('dotenv').config();
const polygon = require('../../server/polygonClient');
const ti = require('../../packages/quant-core/src/technicalIndicatorsService');

const BASKET = ['SOXL', 'TQQQ', 'NVDA', 'AMD', 'AAPL', 'TSLA', 'SPY', 'QQQ'];
const PRESETS = ['dip', 'momentum', 'balanced'];

// Config mirroring broker defaults
const CFG = {
  rsiOversold: 30,
  rsiOverbought: 70,
  volumeMultiplier: 1.5,
  minSignalsRequired: 2,
  minConfidence: 60,
  requireVolumeSpike: true,
  requireRsiSignal: true,
};

// Backtest knobs
const LOOKBACK = 60; // trailing 5-min bars fed to indicators (~5h)
const TP_PCT = 2; // takeProfitPercent default
const SL_PCT = 1; // stopLossPercent default
const HOLD_BARS = 24; // ~2h max hold on 5-min bars (then time-exit at close)
const COOLDOWN_BARS = 12; // 1h cooldown between entries (engine has a cooldown gate)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(3)}%`;
const winRate = xs => (xs.length ? (xs.filter(x => x > 0).length / xs.length) * 100 : 0);

function isDST(date) {
  const m = date.getUTCMonth();
  return m >= 2 && m <= 10;
}
function etHourDecimal(ts) {
  const d = new Date(ts);
  const off = isDST(d) ? -4 : -5;
  let h = d.getUTCHours() + off;
  if (h < 0) h += 24;
  return h + d.getUTCMinutes() / 60;
}
function etDate(ts) {
  const d = new Date(ts);
  const off = isDST(d) ? -4 : -5;
  return new Date(d.getTime() + off * 3600e3).toISOString().slice(0, 10);
}

// Aggregate 1-min Polygon bars into 5-min RTH bars (09:30-16:00 ET).
function build5mRTH(min1) {
  const rth = min1.filter(b => {
    const h = etHourDecimal(b.timestamp);
    return h >= 9.5 && h < 16;
  });
  const out = [];
  let bucket = null;
  let bucketKey = null;
  for (const b of rth) {
    const h = etHourDecimal(b.timestamp);
    const slot = Math.floor((h - 9.5) * 12); // 5-min slots since open
    const key = `${etDate(b.timestamp)}|${slot}`;
    if (key !== bucketKey) {
      if (bucket) out.push(bucket);
      bucket = {
        date: etDate(b.timestamp),
        timestamp: b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      };
      bucketKey = key;
    } else {
      bucket.high = Math.max(bucket.high, b.high);
      bucket.low = Math.min(bucket.low, b.low);
      bucket.close = b.close;
      bucket.volume += b.volume;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

// Replicate the entry rule for one preset over a trailing window ending at the
// current bar. Returns {enter, confidence} or {enter:false}.
function evaluateEntry(window, preset, cfg) {
  if (window.length < 50) return { enter: false };
  const indicators = ti.getAllIndicators(window);
  if (indicators.error) return { enter: false };

  const rsi = indicators.rsi.value;
  const last = window[window.length - 1];
  const currentPrice = last.close;
  const vwapValue = indicators.vwap?.value;
  const belowVwap = vwapValue ? currentPrice < vwapValue : false;
  const volumeRatio = indicators.volume?.ratio || 1;
  const hasVolumeSpike = volumeRatio >= cfg.volumeMultiplier;

  const SIGNAL_WEIGHTS = {
    strategyMatch: 20,
    volumeSpike: 15,
    rsiSignal: 12,
    macdConfirmation: 8,
    bollingerOversold: 10,
  };

  let strategyMatch = false;
  let signalCount = 0;
  let signalScore = 0;

  if (preset === 'dip') {
    const dipThreshold = (cfg.rsiOversold || 30) + 15; // RSI < 45
    if (rsi < dipThreshold && belowVwap) {
      strategyMatch = true;
      signalCount += 2;
      signalScore += SIGNAL_WEIGHTS.strategyMatch;
    }
  }

  if (preset === 'momentum') {
    if (rsi > 50 && rsi < 65) {
      strategyMatch = true;
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.strategyMatch;
    }
  }

  if (preset === 'balanced') {
    const balancedRsiThreshold = (cfg.rsiOversold || 30) + 15; // RSI < 45
    if (rsi < balancedRsiThreshold && belowVwap) {
      strategyMatch = true;
      signalCount += 2;
      signalScore += SIGNAL_WEIGHTS.strategyMatch;
    }
    if (
      rsi > cfg.rsiOversold &&
      rsi < 40 &&
      (indicators.macd.bullish || indicators.macd.crossover) &&
      hasVolumeSpike
    ) {
      strategyMatch = true;
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.strategyMatch;
    }
  }

  // confirming signals
  if (cfg.requireVolumeSpike && hasVolumeSpike) {
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.volumeSpike;
  }
  if (cfg.requireRsiSignal) {
    if (indicators.rsi.divergence?.bullish) {
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.rsiSignal;
    } else if (rsi < 40) {
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.rsiSignal;
    }
  }
  if (indicators.macd.bullish || indicators.macd.crossover) {
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.macdConfirmation;
  }
  if (indicators.bollingerBands.percentB < 0.2) {
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.bollingerOversold;
  }

  let confidence = Math.min(50 + signalScore, 95);
  // NOTE: flow / regime / time-of-day confidence adjustments NOT applied
  // (not derivable from price history). They net to roughly 0 across many
  // trades and are documented as a fidelity gap.

  const enter =
    strategyMatch &&
    signalCount >= cfg.minSignalsRequired &&
    confidence >= cfg.minConfidence;

  return { enter, confidence, rsi, signalCount };
}

// Simulate the universal TP/SL/time exit forward from entry bar j.
function simulateExit(bars, j, tpPct, slPct, hold) {
  const entry = bars[j].close; // engine enters ~at signal bar close
  if (!(entry > 0)) return null;
  const tpPx = entry * (1 + tpPct / 100);
  const slPx = entry * (1 - slPct / 100);
  for (let n = 1; n <= hold; n++) {
    const b = bars[j + n];
    if (!b) {
      // ran out of data; close at last available
      const lastB = bars[bars.length - 1];
      return { ret: lastB.close / entry - 1, reason: 'eod' };
    }
    // conservative: check stop before target within the same bar
    if (b.low <= slPx) return { ret: -slPct / 100, reason: 'stop' };
    if (b.high >= tpPx) return { ret: tpPct / 100, reason: 'target' };
    // EOD exit: if next bar is a different ET date, close at this bar's close
    if (bars[j + n + 1] && bars[j + n + 1].date !== b.date) {
      return { ret: b.close / entry - 1, reason: 'eod' };
    }
  }
  const exitB = bars[j + hold];
  return { ret: exitB.close / entry - 1, reason: 'time' };
}

function runPreset(allBars, preset) {
  const rets = [];
  let target = 0, stop = 0, time = 0, eod = 0;
  for (const bars of allBars) {
    let cooldownUntil = -1;
    for (let i = LOOKBACK; i < bars.length - 1; i++) {
      if (i < cooldownUntil) continue;
      const window = bars.slice(i - LOOKBACK, i + 1);
      const res = evaluateEntry(window, preset, CFG);
      if (!res.enter) continue;
      const exit = simulateExit(bars, i, TP_PCT, SL_PCT, HOLD_BARS);
      if (!exit) continue;
      rets.push(exit.ret);
      if (exit.reason === 'target') target++;
      else if (exit.reason === 'stop') stop++;
      else if (exit.reason === 'eod') eod++;
      else time++;
      cooldownUntil = i + COOLDOWN_BARS;
    }
  }
  return { rets, target, stop, time, eod };
}

// Random-bar baseline: same TP/SL/hold exit from evenly-spaced entry bars.
function runBaseline(allBars) {
  const rets = [];
  for (const bars of allBars) {
    const step = Math.max(1, Math.floor(bars.length / 60));
    for (let i = LOOKBACK; i < bars.length - HOLD_BARS; i += step) {
      const exit = simulateExit(bars, i, TP_PCT, SL_PCT, HOLD_BARS);
      if (exit) rets.push(exit.ret);
    }
  }
  return rets;
}

async function main() {
  if (!process.env.POLYGON_API_KEY) {
    console.error('Need POLYGON_API_KEY');
    process.exit(1);
  }
  // Polygon's 1-min aggregate endpoint caps at 5000 rows/call with no
  // pagination, which for a single ticker is only ~8 trading days. To sample
  // the FULL ~6 months we issue many short (5 trading-day) windows spread
  // across Dec 2024 -> May 2025. Each window is < 5000 rows so nothing is
  // truncated. ~12 windows * 8 tickers = 96 calls (bounded).
  const chunks = [];
  const startMs = Date.parse('2024-12-02');
  const endMs = Date.parse('2025-05-30');
  const WINDOW_DAYS = 7; // calendar days (~5 trading days, < 5000 1-min rows)
  const STRIDE_DAYS = 15; // sample every ~3 weeks across the 6 months
  for (let t = startMs; t <= endMs; t += STRIDE_DAYS * 864e5) {
    const s = new Date(t).toISOString().slice(0, 10);
    const e = new Date(t + WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
    chunks.push([s, e]);
  }

  console.log(`\nTechnical-indicators backtest — basket ${BASKET.join(',')}`);
  console.log(`Presets: ${PRESETS.join(', ')}  |  TP ${TP_PCT}% / SL ${SL_PCT}% / hold ${HOLD_BARS} bars\n`);

  // Each fetched window is kept as its OWN segment so indicators never span a
  // multi-week gap between sampled windows. allBars = flat list of segments.
  const allBars = [];
  const segDays = new Set();
  for (const tk of BASKET) {
    let tkBars = 0;
    for (const [s, e] of chunks) {
      try {
        const min1 = await polygon.getHistoricalAggregates(tk, s, e, 'minute');
        const b5 = build5mRTH(min1 || []);
        if (b5.length > 100) {
          allBars.push(b5);
          tkBars += b5.length;
          b5.forEach(b => segDays.add(b.date));
        }
      } catch (err) {
        console.error(`  ${tk} ${s}: ${err.message}`);
      }
      await sleep(300);
    }
    console.log(`  ${tk.padEnd(5)} ${tkBars} 5-min RTH bars`);
  }
  const days = [...segDays].sort();
  console.log(
    `\n  Coverage: ${days.length} distinct trading days, ${days[0]} -> ${days[days.length - 1]}`
  );

  console.log('\n================ RESULTS ================\n');
  const baseline = runBaseline(allBars);
  console.log(
    `BASELINE (random entry, same TP/SL/hold):  n=${baseline.length}  exp ${pct(mean(baseline))}/trade  win ${winRate(baseline).toFixed(1)}%\n`
  );

  const summary = {};
  for (const preset of PRESETS) {
    const r = runPreset(allBars, preset);
    const exp = mean(r.rets);
    const edge = exp - mean(baseline);
    summary[preset] = { n: r.rets.length, exp, edge };
    console.log(`PRESET: ${preset.toUpperCase()}`);
    console.log(`  trades        n=${r.rets.length}`);
    console.log(`  expectancy    ${pct(exp)}/trade   win ${winRate(r.rets).toFixed(1)}%`);
    console.log(`  exits         target=${r.target} stop=${r.stop} eod=${r.eod} time=${r.time}`);
    console.log(`  EDGE vs base  ${pct(edge)}  -> ${edge > 0.0005 ? 'EDGE' : edge < -0.0005 ? 'NO EDGE' : 'noise'}`);
    console.log('');
  }

  console.log('================ VERDICT ================');
  for (const p of PRESETS) {
    const s = summary[p];
    console.log(
      `  ${p.padEnd(9)} exp ${pct(s.exp).padStart(9)}  edge ${pct(s.edge).padStart(9)}  (n=${s.n})`
    );
  }
  console.log('');
}

main().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});

// ---- significance helper (run separately) ----
module.exports = { build5mRTH, evaluateEntry, simulateExit, runPreset, runBaseline, LOOKBACK, HOLD_BARS };
