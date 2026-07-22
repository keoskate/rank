#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/dark-pool.js — Audit/backtest the dark-pool accumulation signal.
//
// HONEST LIMITATION (verified live): GET /api/darkpool/{ticker}?date=YYYY-MM-DD
// returns at most the LAST 500 prints of that session, newest-first. For liquid
// large-caps that 500-cap only reaches back to ~15:40 ET — i.e. the endpoint
// CANNOT give us a true "midday" snapshot. The earliest reconstructable
// point-in-time decision is at/near the regular-session close (~16:00 ET).
//
// So we reconstruct the signal AS-OF the regular-session close using only prints
// with executed_at <= cutoff (no after-hours leakage, no look-ahead), then
// measure the NEXT session's open->close return. Baseline = the same forward
// return on every (ticker, day) cell regardless of signal. This mirrors a broker
// that polls dark-pool near the close and enters next open.
//
// Window is short (~6 sessions x ~20 names) — treat as a smoke test, not proof.

require('dotenv').config();
const uw = require('../../server/unusualWhalesClient');
const polygon = require('../../server/polygonClient');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = xs => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : 0);
const pctStr = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(3)}%`;
const winRate = xs => (xs.filter(x => x > 0).length / (xs.length || 1)) * 100;
const _num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Large-cap basket (liquid enough to have plenty of dark-pool prints).
const BASKET = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD',
  'AVGO', 'NFLX', 'JPM', 'XOM', 'WMT', 'COST', 'CRM', 'ORCL',
  'QCOM', 'MU', 'INTC', 'BAC',
];

// Recent trading days (we measure forward into the next one, so the last day
// in the list must have a following session in the bar series).
const DAYS = [
  '2026-05-20', '2026-05-21', '2026-05-22', '2026-05-26',
  '2026-05-27', '2026-05-28',
];

// Reconstruct analyzeDarkPool() faithfully, but only on prints at/before cutoff.
// cutoffUtc = '2026-05-20T20:00:00Z' (16:00 ET regular-session close).
function reconstruct(prints, cutoffMs, { minPremium, minBuyShare }) {
  let buyPremium = 0;
  let sellPremium = 0;
  let printCount = 0;
  let atMidPremium = 0;
  for (const p of prints) {
    const ts = p.executed_at ? Date.parse(p.executed_at) : NaN;
    if (!Number.isFinite(ts) || ts > cutoffMs) continue; // point-in-time
    const prem = _num(p.premium);
    if (prem <= 0) continue;
    printCount++;
    const price = _num(p.price);
    const ask = _num(p.nbbo_ask);
    const bid = _num(p.nbbo_bid);
    const mid = ask > 0 && bid > 0 ? (ask + bid) / 2 : price;
    if (Math.abs(price - mid) < 1e-9) atMidPremium += prem;
    if (price >= mid) buyPremium += prem; // strategy's exact rule (>=)
    else sellPremium += prem;
  }
  const totalPremium = buyPremium + sellPremium;
  if (totalPremium <= 0) return { sentiment: 'neutral', printCount, atMidPremium };
  const buyShare = buyPremium / totalPremium;
  const bullish = buyShare >= minBuyShare && totalPremium >= minPremium;
  const bearish = buyShare <= 1 - minBuyShare && totalPremium >= minPremium;
  return {
    sentiment: bullish ? 'bullish' : bearish ? 'bearish' : 'neutral',
    buyShare,
    totalPremium,
    printCount,
    atMidPremium,
    atMidShare: atMidPremium / totalPremium,
  };
}

const barCache = new Map();
async function getBars(ticker) {
  if (barCache.has(ticker)) return barCache.get(ticker);
  let bars = [];
  try {
    bars = await polygon.getHistoricalAggregates(
      ticker, '2026-05-15', '2026-06-01', 'day'
    );
  } catch {
    bars = [];
  }
  const arr = Array.isArray(bars) ? bars : [];
  barCache.set(ticker, arr);
  return arr;
}

// next-session open->close return after `date`
function nextSessionRet(bars, date) {
  const idx = bars.findIndex(b => b.date > date);
  if (idx < 0) return null;
  const b = bars[idx];
  if (!(b.open > 0)) return null;
  return { ret: b.close / b.open - 1, retCloseClose: null, date: b.date };
}

async function main() {
  if (!uw.isConfigured() || !process.env.POLYGON_API_KEY) {
    console.error('Need UNUSUAL_WHALES_API_KEY and POLYGON_API_KEY');
    process.exit(1);
  }
  const minPremium = 1_000_000;
  const minBuyShare = 0.6;

  console.log(`\n🌑 Dark-pool backtest — ${BASKET.length} names × ${DAYS.length} days`);
  console.log(`   signal as-of 16:00 ET (close); enter NEXT session open; measure open→close.`);
  console.log(`   thresholds: minBuyShare=${minBuyShare}, minPremium=$${minPremium.toLocaleString()}\n`);

  const signalRets = [];   // bullish cells
  const bearishRets = [];  // bearish cells (for symmetry check)
  const baselineRets = []; // ALL cells
  let cells = 0, bullish = 0, bearish = 0, neutral = 0;
  let atMidShareSum = 0, atMidN = 0;
  const buyShares = [];

  for (const ticker of BASKET) {
    const bars = await getBars(ticker);
    for (const day of DAYS) {
      const cutoffMs = Date.parse(`${day}T20:00:00Z`); // 16:00 ET
      let res = await uw.makeRequest(`/api/darkpool/${ticker}?date=${day}`, 30 * 60 * 1000);
      await sleep(700);
      // backoff on 429
      let tries = 0;
      while (res.error && /429/.test(res.error) && tries < 4) {
        await sleep(2500 * (tries + 1));
        res = await uw.makeRequest(`/api/darkpool/${ticker}?date=${day}`, 30 * 60 * 1000);
        tries++;
      }
      const prints = Array.isArray(res.data) ? res.data : [];
      if (res.error) { console.log(`   ! ${ticker} ${day}: ${res.error}`); continue; }
      const sig = reconstruct(prints, cutoffMs, { minPremium, minBuyShare });
      const fwd = nextSessionRet(bars, day);
      if (!fwd) continue;
      cells++;
      baselineRets.push(fwd.ret);
      if (sig.buyShare != null) buyShares.push(sig.buyShare);
      if (sig.atMidShare != null) { atMidShareSum += sig.atMidShare; atMidN++; }
      if (sig.sentiment === 'bullish') { bullish++; signalRets.push(fwd.ret); }
      else if (sig.sentiment === 'bearish') { bearish++; bearishRets.push(fwd.ret); }
      else neutral++;
    }
    process.stdout.write('.');
  }
  console.log('\n');

  const row = (label, xs) =>
    `   ${label.padEnd(22)} n=${String(xs.length).padStart(3)}  mean ${pctStr(mean(xs)).padStart(9)}  win ${winRate(xs).toFixed(0).padStart(3)}%`;

  console.log(`📊 RESULTS  (${cells} ticker-day cells with a forward session)\n`);
  console.log(`   classified: bullish=${bullish}  bearish=${bearish}  neutral=${neutral}`);
  console.log(`   mean reconstructed buyShare = ${(mean(buyShares) * 100).toFixed(1)}%`);
  console.log(`   mean at-mid premium share   = ${atMidN ? (atMidShareSum / atMidN * 100).toFixed(1) : 'n/a'}%  (these are counted as BUY by the >= rule)\n`);
  console.log('   Next-session open→close return:');
  console.log(row('BULLISH signal', signalRets));
  console.log(row('BEARISH signal', bearishRets));
  console.log(row('BASELINE (all cells)', baselineRets));

  const edge = mean(signalRets) - mean(baselineRets);
  console.log(`\n   ▶ Bullish edge vs baseline: ${pctStr(edge)}  →  ${edge > 0.001 ? 'positive' : edge < -0.001 ? 'NEGATIVE' : 'inconclusive'}`);
  console.log(`   ▶ Sample is tiny (n=${signalRets.length} bullish); not statistically meaningful.\n`);
}

main().catch(e => { console.error('Backtest failed:', e); process.exit(1); });
