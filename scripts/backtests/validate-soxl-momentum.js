#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-soxl-momentum.js
//
// Five-gate validation of the LIVE "EXP-B Momentum-3sig" session: the technical
// `momentum` entry (RSI in the 50-65 momentum zone + MACD confirmation, ~3
// confirming signals => >=85% confidence) trading the 3x semiconductor pair
// SOXL/SOXS, take-profit +5.5% / stop-loss -2.5%, max 1 position. The card
// shows 64% win rate / +$6.2k — this asks whether that is EDGE or LUCK.
//
// FAITHFULNESS CAVEAT (stated honestly, not hidden): the live session runs
// INTRADAY (tick/5-min) with VWAP/Bollinger/ORB intraday context. The validated
// data path is DAILY bars. So this is a daily-resolution reproduction of the
// momentum CORE (RSI-zone + MACD), with the 5.5%/2.5% TP/SL modeled against each
// day's OHLC (a TP/SL "touch" inside the bar exits at that level). A certified
// faithfulness pass would require minute-bar replay of the live plugin — so
// faithfulness here is NOT certified, and the verdict rests on the other four
// gates (data-integrity, out-of-sample, realistic-cost, multiple-testing).
//
// The control (D16): buy-and-hold SOXL — does the timing add anything over just
// holding the leveraged ETF it trades?

require('dotenv').config();
const { RSI, MACD } = require('technicalindicators');
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { validateStrategy } = require('./lib/validateStrategy');

const START = '2016-01-01';
const UNIVERSE = ['SPY', 'SOXL', 'SOXS'];

// RSI(14) + MACD(12,26,9) keyed by date, aligned to each symbol's own bars.
function indicatorsByDate(barArr) {
  const closes = barArr.map(b => b.close);
  const rsi = RSI.calculate({ period: 14, values: closes });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const rsiByDate = new Map();
  const macdByDate = new Map();
  const rOff = barArr.length - rsi.length;
  for (let i = rOff; i < barArr.length; i++) rsiByDate.set(barArr[i].date, rsi[i - rOff]);
  const mOff = barArr.length - macd.length;
  for (let i = mOff; i < barArr.length; i++) macdByDate.set(barArr[i].date, macd[i - mOff]);
  return { rsiByDate, macdByDate };
}

// Per-trade sim -> daily return series aligned to `dates`.
// mode: 'soxlOnly' (long SOXL on bullish momentum, else cash) |
//       'switch'   (also long SOXS when ITS own momentum is bullish = semis down)
function stratReturns(bars, dates, opts, costMultiplier) {
  const { mode = 'switch', rsiLo = 50, rsiHi = 65, tp = 0.055, sl = 0.025 } = opts;
  const syms = mode === 'switch' ? ['SOXL', 'SOXS'] : ['SOXL'];
  const ind = {};
  const ohlc = {};
  for (const s of syms) {
    if (!bars[s] || !bars[s].length) return new Array(dates.length).fill(null);
    ind[s] = indicatorsByDate(bars[s]);
    ohlc[s] = new Map(bars[s].map(b => [b.date, b]));
  }
  const cost = sym => (bpsPerSide(sym) / 10000) * costMultiplier; // per side
  const out = new Array(dates.length).fill(null);
  let pos = null; // { sym, entry }
  let warm = 0;
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i];
    const dPrev = dates[i - 1];
    warm++;
    let ret = 0;

    // 1) manage an open position: TP/SL touch (SL checked first = conservative), else hold
    if (pos) {
      const bar = ohlc[pos.sym].get(d);
      const prevC = ohlc[pos.sym].get(dPrev)?.close;
      if (bar && prevC) {
        const tpLvl = pos.entry * (1 + tp);
        const slLvl = pos.entry * (1 - sl);
        if (bar.low <= slLvl) {
          ret += slLvl / prevC - 1 - cost(pos.sym);
          pos = null;
        } else if (bar.high >= tpLvl) {
          ret += tpLvl / prevC - 1 - cost(pos.sym);
          pos = null;
        } else {
          ret += bar.close / prevC - 1;
        }
      }
    }

    // 2) if flat, look for an entry using ONLY data through dPrev (no lookahead)
    if (!pos) {
      for (const s of syms) {
        const r = ind[s].rsiByDate.get(dPrev);
        const m = ind[s].macdByDate.get(dPrev);
        if (r != null && m && r > rsiLo && r < rsiHi && m.histogram > 0) {
          const bar = ohlc[s].get(d);
          if (bar) {
            pos = { sym: s, entry: bar.close }; // enter at today's close
            ret -= cost(s);
          }
          break;
        }
      }
    }

    if (warm < 35) {
      out[i] = null; // indicator warmup
      continue;
    }
    out[i] = ret;
  }
  return out;
}

function buildCandidates({ dates, bars, costMultiplier }) {
  const mk = (label, opts) => ({
    params: label,
    returns: stratReturns(bars, dates, opts, costMultiplier),
  });
  const cands = [];
  // The LIVE config is the headline: RSI 50-65, TP 5.5%, SL 2.5%.
  // A small neighborhood lets walk-forward select + exposes param stability;
  // every variant is recorded as a trial (multiple-testing is counted).
  for (const mode of ['switch', 'soxlOnly']) {
    for (const tp of [0.04, 0.055, 0.07]) {
      for (const sl of [0.02, 0.025, 0.035]) {
        cands.push(mk({ mode, tp, sl, rsiLo: 50, rsiHi: 65 }, { mode, tp, sl }));
      }
    }
  }
  return cands;
}

async function main() {
  await validateStrategy({
    family: 'leveraged-momentum',
    strategyId: 'soxl-momentum-3sig-WF-OOS',
    script: 'scripts/backtests/validate-soxl-momentum.js',
    description:
      'EXP-B Momentum-3sig reproduction: technical momentum (RSI 50-65 + MACD) on the SOXL/SOXS 3x semi pair, TP +5.5% / SL -2.5%, max 1 position, SOXL<->SOXS switch. Net of 15bps/side leveraged-ETF cost. Daily-resolution proxy of an intraday strategy (faithfulness NOT certified — needs minute-bar replay).',
    universe: UNIVERSE,
    controlUniverse: ['SOXL'], // does the timing beat just HOLDING the 3x ETF it trades?
    start: START,
    buildCandidates,
    benchmarkSymbol: 'SPY',
    notes: [
      'Live config under test: strategy=momentum, watchlist SOXL/SOXS, TP 5.5%, SL 2.5%, minConfidence 85 (~3 confirming signals = "3sig").',
      'FAITHFULNESS not certified: live runs intraday (VWAP/Bollinger/ORB context); this is a daily-bar reproduction of the RSI-zone + MACD core with TP/SL modeled on daily OHLC touches. A certified pass needs minute-bar replay of the live technicalIndicators plugin.',
      'TP/SL: when a daily bar trades through the level, the trade exits at the level (SL checked before TP on the same bar = conservative). Gap-through fills at the level, not worse — so real slippage is at least this bad.',
      'Control = buy-and-hold SOXL: the timing must beat passively holding the leveraged ETF risk-adjusted, out-of-sample, to mean anything. Leveraged-ETF volatility decay is already inside the adjusted prices.',
    ],
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
