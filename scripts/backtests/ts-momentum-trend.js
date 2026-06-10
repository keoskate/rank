#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/ts-momentum-trend.js
//
// Time-series momentum / trend-following backtest, 2016-01-04 -> today.
// The academic edge: be long when above trend, in cash (or defensive) when below.
// The question: does trend-following beat buy-and-hold RISK-ADJUSTED by
// sidestepping the 2022 bear and 2020 crash? Or is it just diluted beta?
//
// We test, on a diversified ETF universe (index/sector/factor + GLD/TLT):
//  (A) SMA200 trend filter: long when close > 200d SMA, else cash.
//  (B) 50/200 golden/death cross (Donchian-ish trend): long when SMA50 > SMA200.
//  (D) Dual-momentum portfolio: each month, rank universe by 12-1 return; hold
//      the top-N that ALSO have positive 12-1 return AND are above SMA200, else
//      that sleeve goes to cash (or TLT as defensive). Rebalance monthly.
//
// Signals are computed on daily closes and acted on the NEXT bar's close to
// avoid lookahead. Transaction cost (bpsPerSide) is charged round-trip on every
// position change. Benchmarks: buy-and-hold SPY and QQQ over the same window.
//
// DATA PATH: lib/marketData (Alpaca, split+dividend adjusted, 2016-01-04+).
//   The previous version fetched from Polygon, which silently floors at
//   ~2021-06 — so its "2018+" results were actually 2021-06+ results.
//
// ARTIFACTS: every variant emits a standardized run.json (equity curve,
//   drawdown, per-trade ledger, OHLC bars for traded names) via
//   lib/runArtifact, viewable with scripts/backtests/view-run.js and the
//   web Backtest page. The artifact is the source of truth; this console
//   report is a convenience view of the same numbers.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { equityStats } = require('@keo/quant-core');
const {
  loadDailyBars,
  buildCalendar,
  alignCloses,
  maxSafeEnd,
} = require('./lib/marketData');
const { writeRunArtifact } = require('./lib/runArtifact');

const START = '2016-01-04';
const END = maxSafeEnd();
const CAPITAL = 100000;

// Diversified universe: broad index, sectors, factors, and non-equity diversifiers.
const UNIVERSE = [
  'SPY',
  'QQQ',
  'IWM',
  'DIA', // broad index
  'XLK',
  'SMH',
  'XLF',
  'XLE',
  'XLV',
  'XLY',
  'XLP',
  'XLI',
  'XLU',
  'XLB', // sectors
  'XLRE',
  'XLC',
  'GLD',
  'TLT',
  'IEF', // diversifiers (gold, long/intermediate treasuries)
  'EEM',
  'EFA', // intl
];
const DEFENSIVE = 'TLT'; // dual-momentum "out" asset (also tested as cash)
const BENCHMARKS = ['SPY', 'QQQ'];

const { statsFromEquity, yearlyReturns, windowReturn } = equityStats;

function sma(arr, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
}

async function main() {
  console.log(
    `Loading ${UNIVERSE.length} tickers ${START}..${END} (alpaca, adjusted)`
  );
  const { bars, integrity } = await loadDailyBars(UNIVERSE, {
    start: START,
    end: END,
  });
  const syms = Object.keys(bars).filter(s => bars[s].length > 250);
  console.log(`Loaded ${syms.length} tickers.`);

  const dates = buildCalendar(bars, 'SPY');
  const series = alignCloses(
    Object.fromEntries(syms.map(s => [s, bars[s]])),
    dates
  );

  // -------- Benchmarks: buy and hold --------
  const benchResults = {};
  for (const bm of BENCHMARKS) {
    const px = series[bm];
    let s0 = 0;
    while (px[s0] == null) s0++;
    const eq = [1];
    const eqDates = [dates[s0]];
    for (let i = s0 + 1; i < px.length; i++) {
      eq.push(eq[eq.length - 1] * (px[i] / px[i - 1]));
      eqDates.push(dates[i]);
    }
    benchResults[bm] = {
      stats: statsFromEquity(eqDates, eq),
      yearly: yearlyReturns(eqDates, eq),
      eqDates,
      eq,
    };
  }

  // SPY buy&hold equity normalized to 1.0 at an arbitrary calendar index —
  // used as the benchmark overlay in every artifact (same data, same dates).
  function benchmarkSlice(startI) {
    const px = series['SPY'];
    const base = px[startI];
    const out = [];
    for (let i = startI; i < px.length; i++) out.push(px[i] / base);
    return out;
  }

  // ============================================================
  // STRATEGY A: SMA200 trend filter, single-asset, applied to SPY and QQQ.
  // Long when close > SMA200 (signal at t, act at t+1 close). Else cash (0%)
  // or a cash-asset (e.g. TLT).
  //
  // Trade ledger is EXACT for these variants: the portfolio is 100% in one
  // asset (or flat) at all times, so each leg's P&L is the equity change over
  // its holding period, net of all costs charged while it was on.
  // ============================================================
  function smaFilterSingle(sym, n, cashAsset = null) {
    const px = series[sym];
    let s0 = 0;
    while (px[s0] == null) s0++;
    const startI = Math.max(s0 + n, s0 + 1);
    const eq = [1];
    const eqDates = [dates[startI - 1]];
    let invested = false; // current state (position held into bar i)
    let daysInvested = 0;
    let tradeFlips = 0;
    const cost = bpsPerSide(sym) / 10000; // per side
    const cashPx = cashAsset ? series[cashAsset] : null;

    // Cost attribution rule (so the ledger ties to the equity curve exactly):
    // each leg's P&L = equity at its close (after its exit cost) minus equity
    // at its open BEFORE its entry cost was charged. Every cost dollar is
    // attributed to exactly one leg; the reconciliation gap is then ~0.
    const trades = [];
    let leg = null; // { symbol, qty, entryDate, entryPrice, entryEquity }
    const openLeg = (symbol, price, date, investedD, entryEquityD, reason) => {
      if (!price) return;
      leg = {
        symbol,
        qty: investedD / price,
        entryDate: date,
        entryPrice: price,
        entryEquity: entryEquityD,
      };
      trades.push({
        date,
        symbol,
        side: 'buy',
        price,
        qty: investedD / price,
        notional: investedD,
        pnl: null,
        pnlPct: null,
        reason,
      });
    };
    const closeLeg = (price, date, equityD, reason) => {
      if (!leg) return;
      const holdingDays = Math.round(
        (new Date(date) - new Date(leg.entryDate)) / 864e5
      );
      trades.push({
        date,
        symbol: leg.symbol,
        side: 'sell',
        price,
        qty: leg.qty,
        notional: equityD,
        pnl: equityD - leg.entryEquity,
        pnlPct: equityD / leg.entryEquity - 1,
        holdingDays,
        reason,
      });
      leg = null;
    };

    // If there is a cash asset we hold it from day one (the strategy is never
    // flat in that configuration).
    if (cashAsset) {
      openLeg(
        cashAsset,
        cashPx[startI - 1],
        dates[startI - 1],
        CAPITAL,
        CAPITAL,
        'initial defensive position'
      );
    }

    for (let i = startI; i < px.length; i++) {
      // signal computed on close[i-1]
      const ma = sma(px, i - 1, n);
      const wantInvested = ma != null && px[i - 1] > ma;
      // realize return of the position we HELD from i-1 to i
      let r;
      if (invested) {
        r = px[i] / px[i - 1] - 1;
        daysInvested++;
      } else if (cashAsset) {
        r = cashPx[i] / cashPx[i - 1] - 1;
      } else {
        r = 0; // cash
      }
      let mult = 1 + r;
      const flipped = wantInvested !== invested;
      // rebalance at close[i] if state changes -> charge round trip on the leg(s)
      if (flipped) {
        tradeFlips++;
        mult *= 1 - cost; // exit/enter one leg
        if (cashAsset) mult *= 1 - cost; // the other leg also turns over
      }
      eq.push(eq[eq.length - 1] * mult);
      eqDates.push(dates[i]);

      if (flipped) {
        const date = dates[i];
        const ePreD = eq[eq.length - 2] * (1 + r) * CAPITAL; // before flip costs
        const newEqD = eq[eq.length - 1] * CAPITAL; // after flip costs
        if (invested) {
          // exit risk leg: charge it its exit cost; if rotating into a cash
          // asset, that leg's entry cost is borne by the cash leg at its close
          closeLeg(px[i], date, ePreD * (1 - cost), `close < SMA${n} -> exit`);
          if (cashAsset)
            openLeg(
              cashAsset,
              cashPx[i],
              date,
              newEqD,
              ePreD * (1 - cost),
              `rotate to ${cashAsset}`
            );
        } else {
          if (cashAsset) {
            closeLeg(cashPx[i], date, ePreD * (1 - cost), `rotate to ${sym}`);
            openLeg(
              sym,
              px[i],
              date,
              newEqD,
              ePreD * (1 - cost),
              `close > SMA${n} -> long`
            );
          } else {
            // entering from flat: the single cost charged is this leg's entry
            openLeg(sym, px[i], date, newEqD, ePreD, `close > SMA${n} -> long`);
          }
        }
        invested = wantInvested;
      }
    }

    const openPositions = [];
    if (leg) {
      const lastPrice = (leg.symbol === sym ? px : cashPx)[px.length - 1];
      openPositions.push({
        symbol: leg.symbol,
        qty: leg.qty,
        avgCost: leg.entryPrice,
        lastPrice,
        unrealizedPnl: eq[eq.length - 1] * CAPITAL - leg.entryEquity,
      });
    }

    return {
      stats: statsFromEquity(eqDates, eq),
      yearly: yearlyReturns(eqDates, eq),
      eqDates,
      eq,
      exposure: daysInvested / (eq.length - 1),
      trades: tradeFlips,
      tradeLog: trades,
      openPositions,
      startIdx: startI - 1,
      tradedSymbols: cashAsset ? [sym, cashAsset] : [sym],
      params: { symbol: sym, smaLen: n, cashAsset },
      ledgerExact: true,
    };
  }

  // ============================================================
  // STRATEGY B: 50/200 cross, single-asset (SPY, QQQ). Long when SMA50>SMA200.
  // ============================================================
  function crossSingle(sym, fast = 50, slow = 200, cashAsset = null) {
    const px = series[sym];
    let s0 = 0;
    while (px[s0] == null) s0++;
    const startI = s0 + slow;
    const eq = [1];
    const eqDates = [dates[startI - 1]];
    let invested = false;
    let daysInvested = 0;
    let tradeFlips = 0;
    const cost = bpsPerSide(sym) / 10000;
    const cashPx = cashAsset ? series[cashAsset] : null;

    // Same cost-attribution rule as smaFilterSingle (see comment there).
    const trades = [];
    let leg = null;
    const openLeg = (symbol, price, date, investedD, entryEquityD, reason) => {
      if (!price) return;
      leg = {
        symbol,
        qty: investedD / price,
        entryDate: date,
        entryPrice: price,
        entryEquity: entryEquityD,
      };
      trades.push({
        date,
        symbol,
        side: 'buy',
        price,
        qty: investedD / price,
        notional: investedD,
        pnl: null,
        pnlPct: null,
        reason,
      });
    };
    const closeLeg = (price, date, equityD, reason) => {
      if (!leg) return;
      const holdingDays = Math.round(
        (new Date(date) - new Date(leg.entryDate)) / 864e5
      );
      trades.push({
        date,
        symbol: leg.symbol,
        side: 'sell',
        price,
        qty: leg.qty,
        notional: equityD,
        pnl: equityD - leg.entryEquity,
        pnlPct: equityD / leg.entryEquity - 1,
        holdingDays,
        reason,
      });
      leg = null;
    };
    if (cashAsset) {
      openLeg(
        cashAsset,
        cashPx[startI - 1],
        dates[startI - 1],
        CAPITAL,
        CAPITAL,
        'initial defensive position'
      );
    }

    for (let i = startI; i < px.length; i++) {
      const f = sma(px, i - 1, fast);
      const s = sma(px, i - 1, slow);
      const wantInvested = f != null && s != null && f > s;
      let r;
      if (invested) {
        r = px[i] / px[i - 1] - 1;
        daysInvested++;
      } else if (cashAsset) {
        r = cashPx[i] / cashPx[i - 1] - 1;
      } else r = 0;
      let mult = 1 + r;
      const flipped = wantInvested !== invested;
      if (flipped) {
        tradeFlips++;
        mult *= 1 - cost;
        if (cashAsset) mult *= 1 - cost;
      }
      eq.push(eq[eq.length - 1] * mult);
      eqDates.push(dates[i]);

      if (flipped) {
        const date = dates[i];
        const ePreD = eq[eq.length - 2] * (1 + r) * CAPITAL;
        const newEqD = eq[eq.length - 1] * CAPITAL;
        if (invested) {
          closeLeg(
            px[i],
            date,
            ePreD * (1 - cost),
            `SMA${fast} < SMA${slow} (death cross) -> exit`
          );
          if (cashAsset)
            openLeg(
              cashAsset,
              cashPx[i],
              date,
              newEqD,
              ePreD * (1 - cost),
              `rotate to ${cashAsset}`
            );
        } else {
          if (cashAsset) {
            closeLeg(cashPx[i], date, ePreD * (1 - cost), `rotate to ${sym}`);
            openLeg(
              sym,
              px[i],
              date,
              newEqD,
              ePreD * (1 - cost),
              `SMA${fast} > SMA${slow} (golden cross) -> long`
            );
          } else {
            openLeg(
              sym,
              px[i],
              date,
              newEqD,
              ePreD,
              `SMA${fast} > SMA${slow} (golden cross) -> long`
            );
          }
        }
        invested = wantInvested;
      }
    }

    const openPositions = [];
    if (leg) {
      const lastPrice = (leg.symbol === sym ? px : cashPx)[px.length - 1];
      openPositions.push({
        symbol: leg.symbol,
        qty: leg.qty,
        avgCost: leg.entryPrice,
        lastPrice,
        unrealizedPnl: eq[eq.length - 1] * CAPITAL - leg.entryEquity,
      });
    }

    return {
      stats: statsFromEquity(eqDates, eq),
      yearly: yearlyReturns(eqDates, eq),
      eqDates,
      eq,
      exposure: daysInvested / (eq.length - 1),
      trades: tradeFlips,
      tradeLog: trades,
      openPositions,
      startIdx: startI - 1,
      tradedSymbols: cashAsset ? [sym, cashAsset] : [sym],
      params: { symbol: sym, fast, slow, cashAsset },
      ledgerExact: true,
    };
  }

  // ============================================================
  // STRATEGY D: Dual-momentum portfolio across the full universe.
  // Monthly rebalance. Each month-end, for each asset compute 12-1 momentum =
  // P[t-21]/P[t-252]-1. Eligible = momentum>0 AND close>SMA200. Rank eligible by
  // momentum, hold equal-weight top-N. Empty slots -> DEFENSIVE (TLT) if its own
  // momentum>0 else cash. Returns realized daily; rebalance cost charged on
  // turnover. This is the "real" trend-following portfolio.
  //
  // LEDGER CAVEAT (honest): this engine is weight-based and implicitly
  // rebalances to fixed weights daily between monthly rebalances. The trade
  // log below reconstructs dollar trades from the weight deltas at each
  // rebalance, so per-trade P&L is an approximation; the equity curve is
  // authoritative and the artifact's reconciliation block quantifies the gap.
  // ============================================================
  function dualMomentum(topN, useDefensive = true) {
    // exclude defensive + treasuries from the momentum sleeve selection so it's
    // an equity/sector trend portfolio; TLT/IEF are the safe harbor.
    const pickable = syms.filter(s => !['TLT', 'IEF', 'GLD'].includes(s));
    // find first index where 252 lookback available for SPY-like coverage
    const startI = 252 + 1;
    const eq = [1];
    const eqDates = [dates[startI - 1]];
    let holdings = {}; // sym -> weight (target as of last rebalance)
    let daysInvested = 0;
    let rebalances = 0;
    let totalTurnover = 0;

    const trades = [];
    const positions = {}; // sym -> { qty, avgCost } dollar ledger
    const costPerSide = 5 / 10000;

    // identify month-end indices
    const isMonthEnd = new Array(dates.length).fill(false);
    for (let i = 0; i < dates.length - 1; i++) {
      if (dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7))
        isMonthEnd[i] = true;
    }
    isMonthEnd[dates.length - 1] = true;

    for (let i = startI; i < dates.length; i++) {
      // realize return from i-1 -> i using holdings (set at prior rebalance)
      let r = 0;
      let invsExposure = 0;
      for (const [sym, w] of Object.entries(holdings)) {
        if (sym === 'CASH' || !series[sym]) continue; // cash earns 0
        const pPrev = series[sym][i - 1];
        const pNow = series[sym][i];
        if (pPrev != null && pNow != null) {
          r += w * (pNow / pPrev - 1);
          if (sym !== 'CASH') invsExposure += w;
        }
      }
      daysInvested += invsExposure;
      eq.push(eq[eq.length - 1] * (1 + r));
      eqDates.push(dates[i]);

      // rebalance at month-end (signal on close[i], act same close — approximated;
      // to avoid lookahead we use data through i and apply weights to i->i+1).
      if (isMonthEnd[i]) {
        const ranked = [];
        for (const sym of pickable) {
          const px = series[sym];
          if (px[i] == null || px[i - 252] == null) continue;
          const mom = px[i - 21] / px[i - 252] - 1; // 12-1 momentum
          const ma200 = sma(px, i, 200);
          const aboveTrend = ma200 != null && px[i] > ma200;
          if (mom > 0 && aboveTrend) ranked.push({ sym, mom });
        }
        ranked.sort((a, b) => b.mom - a.mom);
        const picks = ranked.slice(0, topN).map(x => x.sym);
        const newHoldings = {};
        const wEach = 1 / topN;
        for (const p of picks) newHoldings[p] = wEach;
        // fill remaining slots with defensive or cash
        const filled = picks.length;
        const remainW = (topN - filled) * wEach;
        if (remainW > 0) {
          if (useDefensive) {
            const dpx = series[DEFENSIVE];
            const dmom =
              dpx[i - 21] != null && dpx[i - 252] != null
                ? dpx[i - 21] / dpx[i - 252] - 1
                : -1;
            const dma = sma(dpx, i, 200);
            if (dmom > 0 && dma != null && dpx[i] != null && dpx[i] > dma) {
              newHoldings[DEFENSIVE] = (newHoldings[DEFENSIVE] || 0) + remainW;
            } else {
              newHoldings['CASH'] = (newHoldings['CASH'] || 0) + remainW;
            }
          } else {
            newHoldings['CASH'] = (newHoldings['CASH'] || 0) + remainW;
          }
        }
        // turnover = sum |new - old| over union of symbols
        const allSyms = new Set([
          ...Object.keys(holdings),
          ...Object.keys(newHoldings),
        ]);
        let turnover = 0;
        for (const s of allSyms) {
          turnover += Math.abs((newHoldings[s] || 0) - (holdings[s] || 0));
        }
        totalTurnover += turnover;
        // charge cost: turnover is one-directional notional changed; round trip
        // cost ~ turnover * costPerSide (each side of a switch is a trade). Use
        // a representative cost (avg of equity ETFs = 5bps/side).
        const costHit = turnover * costPerSide;
        eq[eq.length - 1] *= 1 - costHit;

        // ---- dollar-ledger trade reconstruction (approximate, see caveat) ----
        const equityD = eq[eq.length - 1] * CAPITAL;
        const union = new Set([
          ...Object.keys(positions),
          ...Object.keys(newHoldings),
        ]);
        union.delete('CASH');
        for (const s of union) {
          const price = series[s] ? series[s][i] : null;
          if (!price) continue;
          const targetD = (newHoldings[s] || 0) * equityD;
          const curQty = positions[s] ? positions[s].qty : 0;
          const delta = targetD - curQty * price;
          if (Math.abs(delta) < 1) continue;
          if (delta > 0) {
            const qty = delta / price;
            const costD = delta * costPerSide;
            const pos = positions[s] || { qty: 0, avgCost: 0 };
            pos.avgCost =
              (pos.qty * pos.avgCost + delta + costD) / (pos.qty + qty);
            pos.qty += qty;
            positions[s] = pos;
            trades.push({
              date: dates[i],
              symbol: s,
              side: 'buy',
              price,
              qty,
              notional: delta,
              pnl: null,
              pnlPct: null,
              reason: 'monthly rebalance',
            });
          } else {
            const qty = Math.min(curQty, -delta / price);
            if (qty <= 0) continue;
            const proceeds = qty * price;
            const costD = proceeds * costPerSide;
            const basis = positions[s].avgCost * qty;
            const pnl = proceeds - costD - basis;
            positions[s].qty -= qty;
            if (positions[s].qty * price < 1) delete positions[s];
            trades.push({
              date: dates[i],
              symbol: s,
              side: 'sell',
              price,
              qty,
              notional: proceeds,
              pnl,
              pnlPct: basis > 0 ? pnl / basis : null,
              reason: 'monthly rebalance',
            });
          }
        }

        holdings = newHoldings;
        rebalances++;
      }
    }

    const openPositions = Object.entries(positions).map(([s, p]) => ({
      symbol: s,
      qty: p.qty,
      avgCost: p.avgCost,
      lastPrice: series[s][dates.length - 1],
      unrealizedPnl: (series[s][dates.length - 1] - p.avgCost) * p.qty,
    }));

    const tradedSymbols = [...new Set(trades.map(t => t.symbol))];

    return {
      stats: statsFromEquity(eqDates, eq),
      yearly: yearlyReturns(eqDates, eq),
      eqDates,
      eq,
      exposure: daysInvested / (eq.length - 1),
      rebalances,
      avgTurnover: totalTurnover / Math.max(1, rebalances),
      tradeLog: trades,
      openPositions,
      startIdx: startI - 1,
      tradedSymbols,
      params: {
        topN,
        useDefensive,
        defensive: DEFENSIVE,
        momLookback: 252,
        momSkip: 21,
        smaLen: 200,
      },
      ledgerExact: false,
    };
  }

  // -------- Run everything --------
  const results = {};
  results['SPY_SMA200_cash'] = smaFilterSingle('SPY', 200, null);
  results['SPY_SMA200_TLT'] = smaFilterSingle('SPY', 200, 'TLT');
  results['QQQ_SMA200_cash'] = smaFilterSingle('QQQ', 200, null);
  results['QQQ_SMA200_TLT'] = smaFilterSingle('QQQ', 200, 'TLT');
  results['SPY_50_200_cash'] = crossSingle('SPY', 50, 200, null);
  results['QQQ_50_200_cash'] = crossSingle('QQQ', 50, 200, null);
  results['DualMom_top3_TLT'] = dualMomentum(3, true);
  results['DualMom_top5_TLT'] = dualMomentum(5, true);
  results['DualMom_top3_cash'] = dualMomentum(3, false);
  results['DualMom_top5_cash'] = dualMomentum(5, false);

  // -------- Emit run artifacts (one per variant) --------
  console.log('\nWriting run artifacts…');
  const emitted = [];
  for (const [name, r] of Object.entries(results)) {
    const variantBars = {};
    for (const s of r.tradedSymbols) {
      if (bars[s]) variantBars[s] = bars[s];
    }
    const benchVals = benchmarkSlice(r.startIdx);
    const notes = [
      'IN-SAMPLE backtest. Parameters were not tuned on a train fold; no out-of-sample evidence exists yet.',
      "Universe is survivorship-tinted: today's liquid ETFs, though all existed for most of the window.",
      `Window is the true ${START}+ Alpaca-adjusted history (the prior Polygon run silently started 2021-06).`,
    ];
    if (!r.ledgerExact) {
      notes.push(
        'Trade log is reconstructed from weight deltas at monthly rebalances; the engine implicitly rebalances to fixed weights daily, so per-trade P&L is approximate. Equity curve is authoritative (see reconciliation).'
      );
    }
    const { runId } = writeRunArtifact({
      family: 'ts-momentum-trend',
      strategyId: name,
      script: 'scripts/backtests/ts-momentum-trend.js',
      description: describeVariant(name, r.params),
      params: r.params,
      capital: CAPITAL,
      dates: r.eqDates,
      equity: r.eq,
      benchmark: { symbol: 'SPY', values: benchVals },
      trades: r.tradeLog,
      openPositions: r.openPositions,
      bars: variantBars,
      data: {
        source: integrity.source,
        adjustment: integrity.adjustment,
        timeframe: integrity.timeframe,
        window: { start: r.eqDates[0], end: r.eqDates[r.eqDates.length - 1] },
        symbols: r.tradedSymbols,
        integrity: {
          checkedAt: integrity.checkedAt,
          failures: integrity.failures,
          symbols: Object.fromEntries(
            r.tradedSymbols
              .filter(s => integrity.symbols[s])
              .map(s => [s, integrity.symbols[s]])
          ),
        },
      },
      notes,
    });
    emitted.push(runId);
    console.log(`  ✓ ${runId}`);
  }

  // -------- Report --------
  const regimes = {
    '2018Q4 selloff': ['2018-09-20', '2018-12-24'],
    '2020 COVID crash': ['2020-02-19', '2020-03-23'],
    '2020 full': ['2020-01-01', '2020-12-31'],
    '2022 bear': ['2022-01-01', '2022-12-31'],
    '2022 bear (peak-trough)': ['2022-01-03', '2022-10-12'],
  };

  function fmtPct(x) {
    return x == null ? 'n/a' : (x * 100).toFixed(1) + '%';
  }

  const lines = [];
  const log = s => {
    lines.push(s);
    console.log(s);
  };

  log('\n================ BENCHMARKS (buy & hold) ================');
  for (const bm of BENCHMARKS) {
    const b = benchResults[bm];
    log(
      `${bm}: CAGR ${fmtPct(b.stats.cagr)} | Vol ${fmtPct(b.stats.vol)} | Sharpe ${b.stats.sharpe.toFixed(2)} | MaxDD ${fmtPct(b.stats.maxDD)} | Calmar ${b.stats.calmar.toFixed(2)}`
    );
  }

  log('\n================ STRATEGIES ================');
  log(
    'name'.padEnd(22) +
      'CAGR'.padStart(8) +
      'Vol'.padStart(8) +
      'Sharpe'.padStart(8) +
      'MaxDD'.padStart(9) +
      'Calmar'.padStart(8) +
      'Expos'.padStart(8) +
      'Trades'.padStart(8)
  );
  for (const [name, r] of Object.entries(results)) {
    const t = r.trades != null ? r.trades : r.rebalances;
    log(
      name.padEnd(22) +
        fmtPct(r.stats.cagr).padStart(8) +
        fmtPct(r.stats.vol).padStart(8) +
        r.stats.sharpe.toFixed(2).padStart(8) +
        fmtPct(r.stats.maxDD).padStart(9) +
        r.stats.calmar.toFixed(2).padStart(8) +
        fmtPct(r.exposure).padStart(8) +
        String(t).padStart(8)
    );
  }

  // Per-year table
  const allYears = [
    ...new Set(
      Object.values(results)
        .concat(Object.values(benchResults))
        .flatMap(r => Object.keys(r.yearly))
    ),
  ].sort();
  log('\n================ CALENDAR YEAR RETURNS ================');
  const hdr = 'name'.padEnd(22) + allYears.map(y => y.padStart(8)).join('');
  log(hdr);
  for (const bm of BENCHMARKS) {
    log(
      ('BH ' + bm).padEnd(22) +
        allYears
          .map(y => fmtPct(benchResults[bm].yearly[y]).padStart(8))
          .join('')
    );
  }
  for (const [name, r] of Object.entries(results)) {
    log(
      name.padEnd(22) +
        allYears.map(y => fmtPct(r.yearly[y]).padStart(8)).join('')
    );
  }

  // Regime windows
  log(
    '\n================ REGIME STRESS (return / maxDD in window) ================'
  );
  log(
    'name'.padEnd(22) +
      Object.keys(regimes)
        .map(k => k.slice(0, 14).padStart(16))
        .join('')
  );
  const allStrat = {};
  for (const bm of BENCHMARKS) allStrat['BH ' + bm] = benchResults[bm];
  Object.assign(allStrat, results);
  for (const [name, r] of Object.entries(allStrat)) {
    let row = name.padEnd(22);
    for (const [, [from, to]] of Object.entries(regimes)) {
      const w = windowReturn(r.eqDates, r.eq, from, to);
      row += (w ? `${fmtPct(w.ret)}/${fmtPct(w.maxDD)}` : 'n/a').padStart(16);
    }
    log(row);
  }

  // dump machine-readable summary (back-compat; run.json artifacts are the
  // full-fidelity output)
  const out = {
    window: { START, END },
    universe: syms,
    dataPath: { source: 'alpaca', adjustment: 'all' },
    runArtifacts: emitted,
    benchmarks: Object.fromEntries(
      Object.entries(benchResults).map(([k, v]) => [
        k,
        { stats: v.stats, yearly: v.yearly },
      ])
    ),
    strategies: Object.fromEntries(
      Object.entries(results).map(([k, v]) => [
        k,
        {
          stats: v.stats,
          yearly: v.yearly,
          exposure: v.exposure,
          trades: v.trades,
          rebalances: v.rebalances,
          avgTurnover: v.avgTurnover,
        },
      ])
    ),
  };
  const outPath = path.join(__dirname, 'ts-momentum-trend.results.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`\nWrote ${outPath}`);
  log(
    `Run artifacts: ${emitted.length} (view: node scripts/backtests/view-run.js <runId>)`
  );
}

function describeVariant(name, params) {
  if (name.includes('SMA200')) {
    return `${params.symbol} long when close > 200d SMA, else ${params.cashAsset || 'cash'}. Signal on close, act next close.`;
  }
  if (name.includes('50_200')) {
    return `${params.symbol} long when SMA50 > SMA200 (golden cross), else ${params.cashAsset || 'cash'}.`;
  }
  return `Dual momentum: monthly top-${params.topN} by 12-1 momentum, must be >0 and above SMA200; empty slots -> ${params.useDefensive ? params.defensive + ' (if trending) or cash' : 'cash'}.`;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
