#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/crosscheck-external.js
//
// SECONDARY-CHANNEL VALIDATION: compare our entire data+stats stack against
// an INDEPENDENT vendor (Yahoo Finance v8 chart API — no key, adjusted
// closes) and against the S&P 500 Total Return index (^SP500TR).
//
// What this validates end-to-end:
//   1. Data: Alpaca split+dividend-adjusted bars vs Yahoo adjclose — daily
//      return correlation (expect > 0.999), CAGR delta (expect < ~30bps/yr),
//      worst single-day disagreement (expect < ~50bps outside data faults).
//   2. Stats: our equityStats CAGR/Sharpe/maxDD computed on BOTH vendors'
//      series — vendor-invariant within tolerance, or our math is the bug.
//   3. Precision: SPY B&H (our data, our math) vs ^SP500TR — should differ
//      by roughly the ETF expense ratio (~9bps/yr) + tracking noise. A
//      large gap here would indict adjustment handling (the dividend path).
//
// Read-only: no trials recorded, no artifacts written, no ledger impact.

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');
const { equityStats } = require('@keo/quant-core');

const SYMBOLS = ['SPY', 'QQQ', 'TLT', 'GLD'];
const START = '2016-01-04';

function yahooFetch(symbol) {
  const p1 = Math.floor(new Date(START).getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit`;
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            const r = j.chart.result[0];
            const ts = r.timestamp;
            const adj = r.indicators.adjclose[0].adjclose;
            const out = [];
            for (let i = 0; i < ts.length; i++) {
              if (adj[i] == null) continue;
              const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
              out.push({ date, close: adj[i] });
            }
            resolve(out);
          } catch (e) {
            reject(new Error(`yahoo parse failed for ${symbol}: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function ourBars(symbol) {
  const dir = path.join(__dirname, '../../data/backtests/bars-cache');
  const f = fs
    .readdirSync(dir)
    .filter(
      x => x.startsWith(`${symbol}_2016-01-04_`) && x.endsWith('_all.json')
    )
    .sort()
    .pop();
  if (!f) throw new Error(`no cached bars for ${symbol}`);
  return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
}

function compare(symbol, ours, theirs) {
  const oursBy = new Map(ours.map(b => [b.date, b.close]));
  const common = theirs.filter(b => oursBy.has(b.date));
  // daily returns on common dates
  const rA = [];
  const rB = [];
  const dDates = [];
  let worst = { date: null, diff: 0 };
  for (let i = 1; i < common.length; i++) {
    const a1 = oursBy.get(common[i].date);
    const a0 = oursBy.get(common[i - 1].date);
    const b1 = common[i].close;
    const b0 = common[i - 1].close;
    const ra = a1 / a0 - 1;
    const rb = b1 / b0 - 1;
    rA.push(ra);
    rB.push(rb);
    dDates.push(common[i].date);
    const diff = Math.abs(ra - rb);
    if (diff > worst.diff) worst = { date: common[i].date, diff };
  }
  // correlation
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  const mA = mean(rA);
  const mB = mean(rB);
  let num = 0;
  let dA = 0;
  let dB = 0;
  for (let i = 0; i < rA.length; i++) {
    num += (rA[i] - mA) * (rB[i] - mB);
    dA += (rA[i] - mA) ** 2;
    dB += (rB[i] - mB) ** 2;
  }
  const corr = num / Math.sqrt(dA * dB);
  // stats both ways through OUR math
  const eqOf = rets => {
    const eq = [1];
    for (const r of rets) eq.push(eq[eq.length - 1] * (1 + r));
    return eq.slice(1);
  };
  const sA = equityStats.statsFromEquity(dDates, eqOf(rA));
  const sB = equityStats.statsFromEquity(dDates, eqOf(rB));
  return { symbol, n: rA.length, corr, worst, alpaca: sA, yahoo: sB };
}

async function main() {
  console.log(
    '# Secondary-channel validation — Alpaca(+our stats) vs Yahoo vs SP500TR\n'
  );
  const rows = [];
  for (const sym of SYMBOLS) {
    const theirs = await yahooFetch(sym);
    const ours = ourBars(sym);
    const c = compare(sym, ours, theirs);
    rows.push(c);
    console.log(
      `${sym}: n=${c.n}  return-corr=${c.corr.toFixed(6)}  ` +
        `CAGR alpaca ${(c.alpaca.cagr * 100).toFixed(2)}% vs yahoo ${(c.yahoo.cagr * 100).toFixed(2)}% (Δ ${((c.alpaca.cagr - c.yahoo.cagr) * 1e4).toFixed(0)}bps/yr)  ` +
        `Sharpe ${c.alpaca.sharpe.toFixed(3)} vs ${c.yahoo.sharpe.toFixed(3)}  ` +
        `maxDD ${(c.alpaca.maxDD * 100).toFixed(1)}% vs ${(c.yahoo.maxDD * 100).toFixed(1)}%  ` +
        `worst-day Δ ${(c.worst.diff * 1e4).toFixed(0)}bps @ ${c.worst.date}`
    );
    await new Promise(r => setTimeout(r, 800));
  }

  // SPY (ours) vs S&P 500 Total Return index
  const tr = await yahooFetch('^SP500TR');
  const spy = ourBars('SPY');
  const c = compare('SPY-vs-SP500TR', spy, tr);
  console.log(
    `\nSPY(ours) vs ^SP500TR: return-corr=${c.corr.toFixed(6)}  ` +
      `CAGR ${(c.alpaca.cagr * 100).toFixed(2)}% vs ${(c.yahoo.cagr * 100).toFixed(2)}% ` +
      `(Δ ${((c.alpaca.cagr - c.yahoo.cagr) * 1e4).toFixed(0)}bps/yr — expectation: ≈ -9bps expense ratio ± tracking)`
  );

  console.log(
    '\nInterpretation thresholds: corr > 0.999 and |CAGR Δ| < 30bps/yr = stack validated; ' +
      'larger gaps = investigate (adjustment basis, calendar alignment, or stats math).'
  );
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
