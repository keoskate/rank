#!/usr/bin/env node
// ORB strategy backtest — replays last N days of SOXL/SOXS 5m bars,
// simulates Opening Range Breakout entries with the same logic as
// signalEvaluator.js, and reports win rate / expectancy / max drawdown.
//
// Usage: node scripts/backtestORB.js [--days 60] [--symbol SOXL,SOXS]

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const polygonClient = require('../server/polygonClient');
const openingRange = require('../server/openingRange');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

const DAYS_BACK = parseInt(arg('days', '60'), 10);
const SYMBOLS = arg('symbol', 'SOXL,SOXS').split(',');
const VOLUME_MULTIPLIER = parseFloat(arg('volMult', '1.5'));
const STOP_PCT = parseFloat(arg('stop', '1.5'));
const TP_PCT = parseFloat(arg('tp', '3.0'));
const FORCE_EXIT_ET = 15.5;
const VOLUME_LOOKBACK = 20;

function pnlPct(entry, exit) {
  if (entry.side === 'long') return ((exit.price - entry.price) / entry.price) * 100;
  return ((entry.price - exit.price) / entry.price) * 100;
}

async function fetchHistory(symbol, daysBack) {
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 86400000);
  return polygonClient.getAggregates(symbol, 5, 'minute', { from, to });
}

function groupByEtDate(bars) {
  const groups = new Map();
  for (const b of bars) {
    const date = openingRange.etDateString(new Date(b.timestamp));
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(b);
  }
  return groups;
}

function simulateDay(bars, allBarsContext) {
  bars.sort((a, b) => a.timestamp - b.timestamp);

  const orBars = bars.filter(b => {
    const t = openingRange.etTimeDecimal(new Date(b.timestamp));
    return t >= openingRange.OR_WINDOW_START && t < openingRange.OR_WINDOW_END;
  });
  if (orBars.length < openingRange.MIN_OR_BARS) {
    return { skipped: true, reason: `only ${orBars.length} OR bars` };
  }
  const orHigh = Math.max(...orBars.map(b => b.high));
  const orLow = Math.min(...orBars.map(b => b.low));
  const range = { high: orHigh, low: orLow, height: orHigh - orLow, finalized: true };

  const entryBars = bars.filter(b => {
    const t = openingRange.etTimeDecimal(new Date(b.timestamp));
    return t >= openingRange.OR_WINDOW_END && t < openingRange.ENTRY_WINDOW_END;
  });

  let entry = null;
  for (const bar of entryBars) {
    const idx = allBarsContext.indexOf(bar);
    const prev20 = allBarsContext.slice(Math.max(0, idx - VOLUME_LOOKBACK + 1), idx + 1);
    if (prev20.length === 0) continue;
    const avgVol = prev20.reduce((s, b) => s + b.volume, 0) / prev20.length;
    const volRatio = avgVol > 0 ? bar.volume / avgVol : 0;
    if (volRatio < VOLUME_MULTIPLIER) continue;

    if (bar.close > orHigh) {
      entry = { side: 'long', price: bar.close, ts: bar.timestamp, volRatio, idx };
      break;
    }
    if (bar.close < orLow) {
      entry = { side: 'short', price: bar.close, ts: bar.timestamp, volRatio, idx };
      break;
    }
  }

  if (!entry) return { skipped: true, reason: 'no qualifying breakout', range };

  const targets = openingRange.getStrategyTargets({
    currentPrice: entry.price,
    range,
    direction: entry.side,
    fixedStopPct: STOP_PCT,
    fixedTpPct: TP_PCT,
  });

  for (let i = entry.idx + 1; i < allBarsContext.length; i++) {
    const bar = allBarsContext[i];
    const barDate = openingRange.etDateString(new Date(bar.timestamp));
    const entryDate = openingRange.etDateString(new Date(entry.ts));
    if (barDate !== entryDate) {
      const last = allBarsContext[i - 1];
      return { entry, exit: { reason: 'EOD', price: last.close, ts: last.timestamp }, range, targets };
    }
    const t = openingRange.etTimeDecimal(new Date(bar.timestamp));

    if (entry.side === 'long') {
      if (bar.low <= targets.stopLoss) {
        return { entry, exit: { reason: 'SL', price: targets.stopLoss, ts: bar.timestamp }, range, targets };
      }
      if (bar.high >= targets.profitTarget) {
        return { entry, exit: { reason: 'TP', price: targets.profitTarget, ts: bar.timestamp }, range, targets };
      }
    } else {
      if (bar.high >= targets.stopLoss) {
        return { entry, exit: { reason: 'SL', price: targets.stopLoss, ts: bar.timestamp }, range, targets };
      }
      if (bar.low <= targets.profitTarget) {
        return { entry, exit: { reason: 'TP', price: targets.profitTarget, ts: bar.timestamp }, range, targets };
      }
    }

    if (t >= FORCE_EXIT_ET) {
      return { entry, exit: { reason: 'TIME', price: bar.close, ts: bar.timestamp }, range, targets };
    }
  }

  const last = allBarsContext[allBarsContext.length - 1];
  return { entry, exit: { reason: 'EOD', price: last.close, ts: last.timestamp }, range, targets };
}

function fmt(n, places = 2) {
  if (n == null || isNaN(n)) return '   --   ';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(places)}`;
}

async function main() {
  const allResults = {};

  for (const symbol of SYMBOLS) {
    console.log(`\n📊 ${symbol}: fetching ${DAYS_BACK}d of 5m bars...`);
    const bars = await fetchHistory(symbol, DAYS_BACK);
    console.log(`   ${bars.length} bars retrieved`);

    const days = groupByEtDate(bars);
    const dayResults = [];

    for (const [date, dayBars] of days) {
      const result = simulateDay(dayBars, bars);
      if (result.skipped) {
        dayResults.push({ date, status: 'skipped', reason: result.reason });
        continue;
      }
      const pnl = pnlPct(result.entry, result.exit);
      dayResults.push({
        date,
        side: result.entry.side,
        entryPrice: result.entry.price,
        entryTs: result.entry.ts,
        exitPrice: result.exit.price,
        exitReason: result.exit.reason,
        exitTs: result.exit.ts,
        pnlPct: pnl,
        win: pnl > 0,
        rangeHeight: result.range.height,
        volRatio: result.entry.volRatio,
      });
    }
    allResults[symbol] = dayResults;
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('               ORB BACKTEST RESULTS');
  console.log(`               window: last ${DAYS_BACK} days`);
  console.log(`               stop ${STOP_PCT}% / TP ${TP_PCT}% / vol ≥ ${VOLUME_MULTIPLIER}x`);
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const symbol of SYMBOLS) {
    const days = allResults[symbol];
    const trades = days.filter(d => !d.status);
    const skipped = days.filter(d => d.status === 'skipped');
    const wins = trades.filter(t => t.win);
    const losses = trades.filter(t => !t.win);
    const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
    const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
    const avgWinPct = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgLossPct = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
    const expectancy = trades.length ? totalPnl / trades.length : 0;

    let runningPnl = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of trades) {
      runningPnl += t.pnlPct;
      if (runningPnl > peak) peak = runningPnl;
      const dd = peak - runningPnl;
      if (dd > maxDd) maxDd = dd;
    }

    const exitReasonCounts = trades.reduce((acc, t) => {
      acc[t.exitReason] = (acc[t.exitReason] || 0) + 1;
      return acc;
    }, {});

    console.log(`${symbol}`);
    console.log(`  Trading days       : ${days.length}  (${trades.length} traded, ${skipped.length} skipped)`);
    console.log(`  W / L / Win rate   : ${wins.length} / ${losses.length} / ${winRate.toFixed(1)}%`);
    console.log(`  Avg win / loss     : ${fmt(avgWinPct)}% / ${fmt(avgLossPct)}%`);
    console.log(`  Expectancy / trade : ${fmt(expectancy)}%`);
    console.log(`  Cumulative P&L     : ${fmt(totalPnl)}%`);
    console.log(`  Max drawdown       : ${maxDd.toFixed(2)}%`);
    console.log(`  Exit reasons       : ${JSON.stringify(exitReasonCounts)}`);
    console.log('');
  }

  for (const symbol of SYMBOLS) {
    const recent = allResults[symbol].filter(d => !d.status).slice(-15);
    if (recent.length === 0) continue;
    console.log(`Last ${recent.length} ${symbol} trades:`);
    console.log(`  Date        Side    Entry     Exit      Why     Range    P&L%`);
    for (const t of recent) {
      console.log(
        `  ${t.date}  ${t.side.padEnd(5)}  $${t.entryPrice.toFixed(2).padStart(7)}  $${t.exitPrice.toFixed(2).padStart(7)}  ${t.exitReason.padEnd(6)}  $${t.rangeHeight.toFixed(2).padStart(5)}  ${fmt(t.pnlPct)}%`
      );
    }
    console.log('');
  }
}

main().catch(err => {
  console.error('Backtest failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
