#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/soxx-ladder.js
//
// The "5% ladder" mean-reversion strategy on SOXX (user idea).
//
// Rules (as specified):
//   - Start with 1 share of SOXX + a fixed cash buffer.
//   - anchor = the price of your LAST trade (starts = first close).
//   - Each day, on the close:
//       drift = close / anchor - 1
//       drift >= +threshold  -> SELL 1 share (only if shares >= 1)
//       drift <= -threshold  -> BUY  1 share (only if cash covers price+cost)
//     On a trade, reset anchor = the trade price. At most ONE trade/day.
//   - No shorting (shares floor at 0). No borrowing (cash floor at 0).
//
// This is a discrete, fixed-SHARE mean-reversion ladder — the mirror image of
// the trend strategies. It sells into strength and buys into weakness.
//
// Benchmarks:
//   - HOLD-1-SHARE+CASH: hold the initial 1 share and leave the buffer idle.
//     This is the FAIR yardstick — same starting capital, same cash drag — so
//     it isolates whether the trading ACTIVITY added value.
//   - 100% SOXX buy&hold: put the whole starting capital into SOXX at day 0.
//     Context only (it has full equity beta; the ladder is mostly cash).
//
// Prices are Alpaca split+dividend adjusted (the one data path). "Shares" are
// therefore in adjusted-share units (constant economic exposure across splits).
//
//   node scripts/backtests/soxx-ladder.js [--threshold 0.05] [--buffer-buys 10]

require('dotenv').config();
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { equityStats } = require('@keo/quant-core');
const { loadDailyBars } = require('./lib/marketData');
const { writeRunArtifact } = require('./lib/runArtifact');

const SYMBOL = 'SOXX';
const START = '2016-01-04';

/**
 * Simulate the fixed-share ladder.
 * @param {Array} series - [{date, close, ...}] daily bars (adjusted)
 * @param {object} opts
 * @param {number} opts.threshold   - drift fraction to trigger (default 0.05)
 * @param {number} opts.buffer      - starting cash buffer in dollars
 * @param {number} opts.costMultiplier - cost stress multiplier (default 1)
 * @returns {object} { dates, equity, hold1, allIn, sharesSeries, cashSeries,
 *                     trades, openPositions, capital, finalShares, finalCash,
 *                     buys, sells, minShares, maxShares }
 */
function simulateLadder(
  series,
  { threshold = 0.05, buffer, costMultiplier = 1, reanchorWhenIdle = false } = {}
) {
  const bps = (bpsPerSide(SYMBOL) / 10000) * costMultiplier;
  const P0 = series[0].close;
  if (buffer == null) buffer = 10 * P0; // default: room for ~10 buys at the start price
  const capital = P0 + buffer; // initial account value

  let shares = 1;
  let cash = buffer;
  let heldBasis = P0; // cost basis $ of currently-held shares (initial share = P0)
  let anchor = P0;

  const dates = [];
  const equity = [];
  const hold1 = []; // hold 1 share + idle buffer
  const allIn = []; // 100% SOXX of the same starting capital
  const sharesSeries = [];
  const cashSeries = [];
  const trades = [];
  let buys = 0;
  let sells = 0;
  let minShares = shares;
  let maxShares = shares;

  const allInShares = capital / P0; // fractional shares if fully invested day 0

  for (let i = 0; i < series.length; i++) {
    const { date, close: px } = series[i];

    // decide + act on the close (skip day 0 — that just sets the anchor)
    if (i > 0) {
      const drift = px / anchor - 1;
      if (drift >= threshold) {
        if (shares >= 1) {
          const cost = px * bps;
          const proceeds = px - cost;
          const avgCost = heldBasis / shares;
          cash += proceeds;
          heldBasis -= avgCost;
          shares -= 1;
          anchor = px;
          sells++;
          trades.push({
            date,
            symbol: SYMBOL,
            side: 'sell',
            price: px,
            qty: 1,
            notional: px,
            pnl: proceeds - avgCost, // realized (avg-cost) net of fee
            pnlPct: avgCost > 0 ? proceeds / avgCost - 1 : null,
            reason: `+${(drift * 100).toFixed(1)}% from anchor → sell 1 (→${shares} sh)`,
          });
        } else if (reanchorWhenIdle) {
          // flat and can't sell — ratchet the anchor up so a later 5% pullback
          // re-engages instead of stranding forever at a stale anchor.
          anchor = px;
        }
      } else if (drift <= -threshold) {
        if (cash >= px * (1 + bps)) {
          const cost = px * bps;
          const spent = px + cost;
          cash -= spent;
          heldBasis += spent;
          shares += 1;
          anchor = px;
          buys++;
          trades.push({
            date,
            symbol: SYMBOL,
            side: 'buy',
            price: px,
            qty: 1,
            notional: px,
            pnl: null,
            pnlPct: null,
            reason: `${(drift * 100).toFixed(1)}% from anchor → buy 1 (→${shares} sh)`,
          });
        } else if (reanchorWhenIdle) {
          anchor = px; // out of cash — ratchet anchor down to re-engage on a bounce
        }
      }
    }

    minShares = Math.min(minShares, shares);
    maxShares = Math.max(maxShares, shares);
    dates.push(date);
    equity.push((shares * px + cash) / capital);
    hold1.push((1 * px + buffer) / capital);
    allIn.push((allInShares * px) / capital);
    sharesSeries.push(shares);
    cashSeries.push(cash);
  }

  const lastPx = series[series.length - 1].close;
  const openPositions =
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
      : [];

  return {
    dates,
    equity,
    hold1,
    allIn,
    sharesSeries,
    cashSeries,
    trades,
    openPositions,
    capital,
    P0,
    buffer,
    finalShares: shares,
    finalCash: cash,
    buys,
    sells,
    minShares,
    maxShares,
  };
}

// ── tiny ASCII line chart (share count over time) ─────────────────────────
function asciiChart(values, dates, { height = 12, width = 90, label = '' } = {}) {
  const n = values.length;
  const step = Math.max(1, Math.floor(n / width));
  const xs = [];
  const ds = [];
  for (let i = 0; i < n; i += step) {
    xs.push(values[i]);
    ds.push(dates[i]);
  }
  if (xs[xs.length - 1] !== values[n - 1]) {
    xs.push(values[n - 1]);
    ds.push(dates[n - 1]);
  }
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = hi - lo || 1;
  const grid = Array.from({ length: height }, () => new Array(xs.length).fill(' '));
  for (let c = 0; c < xs.length; c++) {
    const norm = (xs[c] - lo) / span; // 0..1
    const row = height - 1 - Math.round(norm * (height - 1));
    grid[row][c] = '●';
  }
  const out = [];
  if (label) out.push(label);
  for (let r = 0; r < height; r++) {
    const val = lo + ((height - 1 - r) / (height - 1)) * span;
    out.push(`${val.toFixed(1).padStart(6)} │${grid[r].join('')}`);
  }
  out.push(`${' '.repeat(6)} └${'─'.repeat(xs.length)}`);
  out.push(`${' '.repeat(8)}${ds[0]}${' '.repeat(Math.max(1, xs.length - 20))}${ds[ds.length - 1]}`);
  return out.join('\n');
}

function fmt$(x) {
  return `$${Math.round(x).toLocaleString()}`;
}
function statLine(name, eq, dates, capital) {
  const s = equityStats.statsFromEquity(dates, eq);
  return `  ${name.padEnd(24)} ${fmt$(eq[eq.length - 1] * capital).padStart(12)}   CAGR ${(s.cagr * 100).toFixed(1).padStart(5)}%   Sharpe ${s.sharpe.toFixed(2).padStart(5)}   maxDD ${(s.maxDD * 100).toFixed(1).padStart(6)}%`;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : def;
  };
  const threshold = getArg('--threshold', 0.05);
  const bufferBuys = getArg('--buffer-buys', 10);
  const reanchorWhenIdle = args.includes('--reanchor');

  console.log(`Loading ${SYMBOL} (alpaca adjusted, ${START}+)…`);
  const { bars } = await loadDailyBars([SYMBOL], { start: START });
  const series = bars[SYMBOL];
  if (!series || !series.length) throw new Error('no SOXX bars');

  const buffer = bufferBuys * series[0].close;
  const sim = simulateLadder(series, { threshold, buffer, reanchorWhenIdle });
  if (reanchorWhenIdle) console.log('(re-anchor-when-idle ON: anchor tracks price even when flat/capped)');

  const years =
    (new Date(sim.dates[sim.dates.length - 1]) - new Date(sim.dates[0])) /
    (365.25 * 864e5);

  console.log(`\n=== ${SYMBOL} ${(threshold * 100).toFixed(0)}% ladder — mean reversion ===`);
  console.log(
    `window: ${sim.dates[0]} → ${sim.dates[sim.dates.length - 1]} (${sim.dates.length} days, ${years.toFixed(1)}y)`
  );
  console.log(
    `start:  1 share @ ${fmt$(sim.P0)} + ${fmt$(sim.buffer)} cash  = ${fmt$(sim.capital)} capital ` +
      `(${((sim.buffer / sim.capital) * 100).toFixed(0)}% cash)`
  );
  console.log(
    `rule:   ±${(threshold * 100).toFixed(0)}% from last-trade price; ≤1 trade/day; no shorting, no borrowing`
  );
  console.log(
    `\ntrades: ${sim.buys} buys / ${sim.sells} sells (${sim.buys + sim.sells} total)`
  );
  console.log(
    `shares: started 1, ranged ${sim.minShares}–${sim.maxShares}, ended ${sim.finalShares}   |   ended cash ${fmt$(sim.finalCash)}`
  );

  console.log(`\n--- final account value (${fmt$(sim.capital)} start) ---`);
  console.log(statLine('LADDER (the strategy)', sim.equity, sim.dates, sim.capital));
  console.log(statLine('hold 1 share + cash', sim.hold1, sim.dates, sim.capital) + '   ← fair benchmark');
  console.log(statLine('100% SOXX buy & hold', sim.allIn, sim.dates, sim.capital) + '   (context)');

  const ladderEnd = sim.equity[sim.equity.length - 1] * sim.capital;
  const hold1End = sim.hold1[sim.hold1.length - 1] * sim.capital;
  const beat = ladderEnd - hold1End;
  console.log(
    `\nverdict vs fair benchmark: ladder ${beat >= 0 ? 'BEAT' : 'LAGGED'} hold-1-share+cash by ${fmt$(Math.abs(beat))} (${((ladderEnd / hold1End - 1) * 100).toFixed(1)}%)`
  );

  console.log('\n' + asciiChart(sim.sharesSeries, sim.dates, { label: 'SHARE COUNT over time:' }));

  // ── artifact (fair benchmark embedded; extra carries share/cash series) ──
  const { runId, path: artifactPath } = writeRunArtifact({
    family: 'mean-reversion',
    strategyId: `soxx-ladder-${(threshold * 100).toFixed(0)}pct`,
    script: 'scripts/backtests/soxx-ladder.js',
    description: `SOXX ${(threshold * 100).toFixed(0)}% fixed-share ladder: start 1 share + ${bufferBuys}×price cash buffer; sell 1 on +${(threshold * 100).toFixed(0)}% from last trade, buy 1 on −${(threshold * 100).toFixed(0)}%; no shorting/borrowing. Benchmark = hold 1 share + idle cash (same capital).`,
    params: { threshold, bufferBuys, symbol: SYMBOL },
    capital: sim.capital,
    dates: sim.dates,
    equity: sim.equity,
    benchmark: { symbol: `${SYMBOL} hold-1sh+cash`, values: sim.hold1 },
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
      'IN-SAMPLE, single asset, single path. Not a five-gate verdict — see validate-soxx-ladder.js.',
      'Embedded benchmark is HOLD-1-SHARE+CASH (fair: same capital/cash drag). 100% SOXX buy&hold shown in terminal for context.',
      'Fixed-SHARE sizing: each trade is 1 share regardless of price, so dollar risk scales with price. Prices split/div adjusted.',
    ],
    extra: {
      shareCount: { dates: sim.dates, values: sim.sharesSeries },
      cash: sim.cashSeries,
    },
  });

  console.log(`\nartifact: ${artifactPath}`);
  console.log(`view:     npm run backtest:view ${runId}`);
}

module.exports = { simulateLadder, asciiChart, SYMBOL, START };

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
