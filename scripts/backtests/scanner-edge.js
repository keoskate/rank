/**
 * Backtest for the Local Probability Scanner (key: scanner-edge).
 *
 * Replicates the EXACT scoring path used by server/scanner/scanRunner.js:
 *   getAllIndicators -> evaluateSymbolStateless -> computeProbability -> deriveTargets
 *   -> EV filter (prob>=minProb, EV>0.2, RR>=1.5)
 * by reusing the real server modules against historical trailing windows.
 *
 * predictPattern (patternRecognitionService) is SKIPPED — in the live scanner
 * it is wrapped in try/catch and treated as optional; components.pattern=0 when
 * absent. We faithfully reproduce the "no pattern model" path, which is also the
 * common live case.
 *
 * Strategy as a mechanical rule (long-only, since the scanner's positive-EV
 * picks are overwhelmingly LONG oversold-dip entries):
 *   - Each trading day t, build trailing 120-calendar-day window per symbol.
 *   - Score the universe exactly as the scanner does.
 *   - Keep opportunities: probability>=0.55, EV>0.2, RR>=1.5, direction LONG.
 *   - Rank by EV desc; take top N (default 5) as that day's picks.
 *   - Enter at next day's OPEN. Exit when: stop hit (intraday low<=stop),
 *     target hit (intraday high>=target), or after horizonDays bars at close.
 *     If both stop & target in same bar, assume stop first (conservative).
 *   - Equal-weight across concurrent open slots; max N concurrent positions.
 *   - Costs: transactionCost.bpsPerSide(sym) per side, applied on entry & exit.
 *
 * Benchmarks: buy-and-hold SPY and QQQ over the same window.
 *
 * Bounded: one full-history fetch per symbol (<=42 symbols), 200ms sleep
 * between fetches, graceful 429/error handling.
 */

require('dotenv').config();
const polygon = require('../../server/polygonClient');
const ti = require('../../server/technicalIndicatorsService');
const signalEvaluator = require('../../server/signalEvaluator');
const { computeProbability } = require('../../server/scanner/probabilityModel');
const { deriveTargets } = require('../../server/scanner/targetModel');
const { bpsPerSide } = require('../../server/risk/transactionCost');

const START = '2018-01-01';
const END = new Date().toISOString().slice(0, 10);
const HORIZON = 5;
const MIN_PROB = 0.55;
const MIN_EV = 0.2;
const MAX_CONCURRENT = 5;
const TOP_N_PER_DAY = 5;
const LOOKBACK_BARS = 80; // ~120 cal days of trading bars; scanner needs 50+
const SLEEP_MS = 220;

// 42-symbol survivorship-aware subset of the scanner universe with full
// 2018-present daily history (drops post-2018 IPOs like PLTR/UBER/IONQ/RGTI/
// QBTS/PATH/RR/SOXL/SOXS/CRWD/ZM that would bias toward the recent bull).
const UNIVERSE = [
  'WM','ADSK','NKE','LSCC','DIS','LRCX','XRAY','RTX','YETI','ENPH','TEVA','MGNI','RCL',
  'SHOP','HIMX','PI','PENN','AAPL','MSFT','GOOGL','AMZN','META','TSLA','NVDA','NFLX',
  'CRM','ORCL','JNJ','PG','KO','PFE','WMT','JPM','V','MA','HD','MCD','XOM','CVX',
  'SOXX','AMD','INTC',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAll(symbol, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const bars = await polygon.getHistoricalAggregates(symbol, START, END, 'day');
      if (Array.isArray(bars) && bars.length > 0) return bars;
      return null;
    } catch (e) {
      if (String(e.message).includes('429') && i < retries) {
        await sleep(2000 * (i + 1));
        continue;
      }
      if (i < retries) { await sleep(1000); continue; }
      console.error(`  fetch fail ${symbol}: ${e.message}`);
      return null;
    }
  }
  return null;
}

// Faithful reproduction of scanRunner._scoreSymbol on a window of bars.
function scoreWindow(symbol, window) {
  if (!window || window.length < 30) return null;
  let indicators;
  try { indicators = ti.getAllIndicators(window); } catch { return null; }
  if (!indicators || indicators.error) return null;

  const signalEval = signalEvaluator.evaluateSymbolStateless(symbol, window, indicators);
  // patternPred skipped (optional in live scanner)
  const probResult = computeProbability({ indicators, signalEval, patternPred: null });
  if (!probResult.hasEdge) return null;

  const currentPrice = window[window.length - 1].close;
  const atr = indicators.atr && indicators.atr.value;
  if (!Number.isFinite(atr) || atr <= 0) return null;

  const targets = deriveTargets({
    currentPrice, atr, candles: window, direction: probResult.direction, horizonDays: HORIZON,
  });
  if (!targets.viable) return null;

  const expectedValue = probResult.probability * targets.riskReward - (1 - probResult.probability);

  return {
    symbol,
    direction: probResult.direction,
    probability: probResult.probability,
    targetPrice: targets.targetPrice,
    stopPrice: targets.stopPrice,
    expectedValue,
  };
}

function cagr(start, end, years) {
  if (start <= 0 || years <= 0) return 0;
  return Math.pow(end / start, 1 / years) - 1;
}

function maxDrawdown(equitySeries) {
  let peak = -Infinity, mdd = 0;
  for (const e of equitySeries) {
    if (e.v > peak) peak = e.v;
    const dd = (peak - e.v) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

function sharpe(dailyReturns) {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyReturns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}

async function main() {
  console.log(`Backtest scanner-edge ${START} -> ${END}, ${UNIVERSE.length} symbols`);

  // Fetch all symbol histories + benchmarks
  const data = {};
  const symbolsToFetch = [...UNIVERSE, 'SPY', 'QQQ'];
  for (const sym of symbolsToFetch) {
    const bars = await fetchAll(sym);
    if (bars && bars.length > 100) {
      data[sym] = bars;
      // index by date
      data[sym].byDate = new Map(bars.map((b, i) => [b.date, i]));
    } else {
      console.error(`  DROP ${sym} (insufficient: ${bars ? bars.length : 0})`);
    }
    await sleep(SLEEP_MS);
  }

  const universe = UNIVERSE.filter((s) => data[s]);
  console.log(`Usable symbols: ${universe.length}`);

  // Build master trading-day calendar from SPY.
  const spy = data['SPY'];
  const qqq = data['QQQ'];
  if (!spy || !qqq) { console.error('Missing SPY/QQQ benchmark'); process.exit(1); }
  const calendar = spy.map((b) => b.date);

  // ---- Simulate strategy ----
  const INITIAL = 100000;
  let cash = INITIAL;
  const openPositions = []; // {symbol, entryIdxBySym, entryPrice, target, stop, shares, exitByDate, costEntry}
  const equityCurve = []; // {date, v}
  const dailyReturns = [];
  let prevEquity = INITIAL;
  const trades = [];

  // Pre-compute per-symbol arrays for fast intraday checks.
  // We iterate the SPY calendar; for each symbol we map date->index in its own series.

  function markToMarket(dateIdx, date) {
    let positionsValue = 0;
    for (const p of openPositions) {
      const sd = data[p.symbol];
      const idx = sd.byDate.get(date);
      const px = idx != null ? sd[idx].close : p.lastPx;
      p.lastPx = px;
      positionsValue += p.shares * px;
    }
    return cash + positionsValue;
  }

  // start after we have enough lookback (find first date where SPY index >= LOOKBACK_BARS)
  const startIdx = Math.max(LOOKBACK_BARS + 1, 0);

  for (let di = startIdx; di < calendar.length; di++) {
    const date = calendar[di];

    // 1. Process exits for open positions whose bar today is within/at horizon or hits stop/target.
    for (let pi = openPositions.length - 1; pi >= 0; pi--) {
      const p = openPositions[pi];
      const sd = data[p.symbol];
      const idx = sd.byDate.get(date);
      if (idx == null) continue; // symbol didn't trade today; hold
      const bar = sd[idx];
      let exitPx = null, reason = null;
      // conservative: stop checked before target
      if (bar.low <= p.stop) { exitPx = p.stop; reason = 'stop'; }
      else if (bar.high >= p.target) { exitPx = p.target; reason = 'target'; }
      else if (date >= p.exitByDate || (bar.barsHeld != null)) { /* handled below */ }

      // horizon exit: count trading bars held
      p.barsHeld = (p.barsHeld || 0) + 1;
      if (exitPx == null && p.barsHeld >= HORIZON) { exitPx = bar.close; reason = 'horizon'; }

      if (exitPx != null) {
        const costExit = exitPx * p.shares * (bpsPerSide(p.symbol) / 10000);
        const proceeds = exitPx * p.shares - costExit;
        cash += proceeds;
        const pnl = proceeds - p.costBasis;
        trades.push({ symbol: p.symbol, entryDate: p.entryDate, exitDate: date, reason,
          retPct: (exitPx - p.entryPrice) / p.entryPrice, pnl });
        openPositions.splice(pi, 1);
      }
    }

    // 2. Score universe on trailing window ending at YESTERDAY (decision made on close of di-1),
    //    enter at today's OPEN. Use window of bars up to and including di-1 per symbol.
    const slotsFree = MAX_CONCURRENT - openPositions.length;
    if (slotsFree > 0) {
      const prevDate = calendar[di - 1];
      const candidates = [];
      for (const sym of universe) {
        if (openPositions.some((p) => p.symbol === sym)) continue;
        const sd = data[sym];
        const pIdx = sd.byDate.get(prevDate);
        if (pIdx == null || pIdx < LOOKBACK_BARS) continue;
        const window = sd.slice(pIdx - LOOKBACK_BARS + 1, pIdx + 1);
        const scored = scoreWindow(sym, window);
        if (scored && scored.direction === 'LONG'
            && scored.probability >= MIN_PROB && scored.expectedValue > MIN_EV) {
          candidates.push(scored);
        }
      }
      candidates.sort((a, b) => b.expectedValue - a.expectedValue);
      const picks = candidates.slice(0, Math.min(TOP_N_PER_DAY, slotsFree));

      // entry at today's open
      const equityNow = markToMarket(di, date);
      const perSlotCapital = equityNow / MAX_CONCURRENT;
      for (const pick of picks) {
        const sd = data[pick.symbol];
        const idx = sd.byDate.get(date);
        if (idx == null) continue;
        const entryPrice = sd[idx].open;
        if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;
        const alloc = Math.min(perSlotCapital, cash);
        if (alloc < 100) continue;
        const shares = Math.floor(alloc / entryPrice);
        if (shares <= 0) continue;
        const gross = shares * entryPrice;
        const costEntry = gross * (bpsPerSide(pick.symbol) / 10000);
        cash -= (gross + costEntry);
        openPositions.push({
          symbol: pick.symbol, entryDate: date, entryPrice,
          target: pick.targetPrice, stop: pick.stopPrice, shares,
          costBasis: gross + costEntry, barsHeld: 0, lastPx: entryPrice,
        });
      }
    }

    // 3. Mark to market end of day
    const eq = markToMarket(di, date);
    equityCurve.push({ date, v: eq });
    dailyReturns.push(prevEquity > 0 ? (eq - prevEquity) / prevEquity : 0);
    prevEquity = eq;
  }

  // ---- Benchmark buy & hold (SPY, QQQ) over same calendar window ----
  function buyHold(series) {
    const first = series[startIdx];
    const eq = [];
    const rets = [];
    let prev = INITIAL;
    for (let di = startIdx; di < calendar.length; di++) {
      const date = calendar[di];
      const idx = series.byDate.get(date);
      const px = idx != null ? series[idx].close : null;
      if (px == null) { eq.push({ date, v: prev }); rets.push(0); continue; }
      const v = INITIAL * (px / first.close);
      eq.push({ date, v });
      rets.push(prev > 0 ? (v - prev) / prev : 0);
      prev = v;
    }
    return { eq, rets };
  }
  const spyBH = buyHold(spy);
  const qqqBH = buyHold(qqq);

  const years = (new Date(END) - new Date(calendar[startIdx])) / (365.25 * 86400000);

  function stats(name, eqCurve, rets) {
    const finalV = eqCurve[eqCurve.length - 1].v;
    return {
      name,
      finalV: Math.round(finalV),
      totalReturnPct: ((finalV / INITIAL - 1) * 100).toFixed(1),
      cagrPct: (cagr(INITIAL, finalV, years) * 100).toFixed(2),
      sharpe: sharpe(rets).toFixed(2),
      maxDDpct: (maxDrawdown(eqCurve) * 100).toFixed(1),
    };
  }

  const stratStats = stats('SCANNER', equityCurve, dailyReturns);
  const spyStats = stats('SPY B&H', spyBH.eq, spyBH.rets);
  const qqqStats = stats('QQQ B&H', qqqBH.eq, qqqBH.rets);

  console.log('\n=== OVERALL ' + calendar[startIdx] + ' -> ' + END + ' (' + years.toFixed(2) + 'y) ===');
  console.table([stratStats, spyStats, qqqStats]);

  // ---- Per-year / per-regime breakdown ----
  const regimes = {
    '2018 (Q4 selloff)': ['2018-01-01', '2018-12-31'],
    '2019 (bull)':       ['2019-01-01', '2019-12-31'],
    '2020 (COVID)':      ['2020-01-01', '2020-12-31'],
    '2020 crash only':   ['2020-02-15', '2020-04-15'],
    '2021 (bull)':       ['2021-01-01', '2021-12-31'],
    '2022 (BEAR)':       ['2022-01-01', '2022-12-31'],
    '2023 (bull)':       ['2023-01-01', '2023-12-31'],
    '2024 (bull)':       ['2024-01-01', '2024-12-31'],
    '2025-26':           ['2025-01-01', END],
  };

  function windowReturn(eqCurve, from, to) {
    const seg = eqCurve.filter((e) => e.date >= from && e.date <= to);
    if (seg.length < 2) return { ret: null, mdd: null };
    const r = (seg[seg.length - 1].v / seg[0].v - 1) * 100;
    let peak = -Infinity, mdd = 0;
    for (const e of seg) { if (e.v > peak) peak = e.v; const dd = (peak - e.v) / peak; if (dd > mdd) mdd = dd; }
    return { ret: r, mdd: mdd * 100 };
  }

  console.log('\n=== BY YEAR / REGIME (period return %, maxDD %) ===');
  const rows = [];
  for (const [label, [from, to]] of Object.entries(regimes)) {
    const s = windowReturn(equityCurve, from, to);
    const sp = windowReturn(spyBH.eq, from, to);
    const qq = windowReturn(qqqBH.eq, from, to);
    rows.push({
      regime: label,
      scanner: s.ret == null ? 'n/a' : s.ret.toFixed(1),
      scannerDD: s.mdd == null ? '' : s.mdd.toFixed(1),
      SPY: sp.ret == null ? 'n/a' : sp.ret.toFixed(1),
      QQQ: qq.ret == null ? 'n/a' : qq.ret.toFixed(1),
    });
  }
  console.table(rows);

  // ---- Trade stats ----
  const wins = trades.filter((t) => t.retPct > 0).length;
  const byReason = {};
  for (const t of trades) byReason[t.reason] = (byReason[t.reason] || 0) + 1;
  const avgRet = trades.length ? (trades.reduce((a, t) => a + t.retPct, 0) / trades.length * 100) : 0;
  console.log('\n=== TRADE STATS ===');
  console.log('total trades:', trades.length);
  console.log('win rate:', trades.length ? ((wins / trades.length) * 100).toFixed(1) + '%' : 'n/a');
  console.log('avg trade return (gross of overlap):', avgRet.toFixed(2) + '%');
  console.log('exit reasons:', JSON.stringify(byReason));

  // trades per year
  const tradesByYear = {};
  for (const t of trades) {
    const y = t.entryDate.slice(0, 4);
    tradesByYear[y] = (tradesByYear[y] || 0) + 1;
  }
  console.log('trades/year:', JSON.stringify(tradesByYear));

  console.log('\nDONE');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
