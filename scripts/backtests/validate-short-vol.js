#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-short-vol.js
//
// Five-gate validation of the SHORT-VOLATILITY-SPIKE claim (the publicly
// documented core of Michael Listman's UVXY approach, per uvxy.pro /
// civolatility.com): leveraged long-vol ETPs (UVXY, UVIX) structurally decay
// via contango roll + daily-rebalance drag; ~4-6x/year they spike 30%+ off a
// low; short the spike and hold "until it comes back down" — duration is the
// hedge, not a stop.
//
// WHY THIS RUNS BEFORE ANY OPTIONS INFRA IS BUILT: the options implementation
// (puts / call spreads for defined risk) is an execution vehicle. The edge,
// if any, is in the underlying decay-after-spike economics — which daily
// share data can test. If the share-level edge doesn't survive the gates,
// options (which ADD premium costs, especially post-spike when UVXY IV is
// 150%+) cannot resurrect it.
//
// INSTRUMENT FIDELITY: window starts 2018-03-01 — both UVXY (2x -> 1.5x) and
// SVXY (-1x -> -0.5x) deleveraged after Volmageddon (2018-02), so earlier
// data describes different instruments. The window still contains COVID
// (2020-03), the 2022 bear, Aug-2024, and Apr-2025 vol spikes.
//
// SHORT MECHANICS modeled honestly:
//  - 'rebal' variants: -1x daily-rebalanced short (loss bounded per day; the
//    realistic continuously-managed share short).
//  - 'static' variants: fixed short notional f of equity at entry, held
//    without rebalance — the naive share short; a +100%/f spike wipes you.
//  - Borrow fee charged while short (UVXY is chronically hard-to-borrow):
//    8%/yr base, with a 15%/yr stress sensitivity in extra.
//  - SVXY variants: LONG shares (the ETF does the shorting internally) — the
//    zero-new-infra implementation our engine could trade TODAY.
//  - Margin calls / forced buy-ins are NOT modeled — noted; they only make
//    real-world shorting worse than this backtest.

require('dotenv').config();
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');

const START = '2018-03-01';
const UNIVERSE = ['SPY', 'UVXY', 'UVIX', 'SVXY'];
const BORROW_APR = 0.08;
const SPIKE_LOOKBACK = 20; // spike measured off the trailing 20d low
const EXIT_LOOKBACK = 10; // exit when UVXY prints a fresh 10d low ("came back down")

/**
 * Spike state machine on the SIGNAL symbol (UVXY): in-trade from the day
 * after close[t-1] >= trailingLow20[t-1] * (1+spikePct), until the day after
 * close[t-1] sets a fresh 10d low. All decisions use completed closes
 * through t-1; positions change at t's close.
 * Returns an array aligned to `dates`: true = hold short-vol exposure into
 * day t... (state evaluated for day t).
 */
function spikeStateSeries(sigBars, dates, spikePct) {
  const byDate = new Map(sigBars.map((b, k) => [b.date, k]));
  const closes = sigBars.map(b => b.close);
  const state = new Array(dates.length).fill(false);
  let inTrade = false;
  for (let i = 0; i < dates.length; i++) {
    const k = byDate.get(dates[i]);
    if (k == null || k < SPIKE_LOOKBACK + 2) {
      state[i] = inTrade;
      continue;
    }
    // signal from data through k-1
    const yest = closes[k - 1];
    const low20 = Math.min(...closes.slice(k - 1 - SPIKE_LOOKBACK, k - 1));
    const low10 = Math.min(...closes.slice(k - 1 - EXIT_LOOKBACK, k - 1));
    if (!inTrade && yest >= low20 * (1 + spikePct)) inTrade = true;
    else if (inTrade && yest <= low10) inTrade = false;
    state[i] = inTrade;
  }
  return state;
}

/**
 * Build a candidate's daily returns (aligned to dates).
 * kind:
 *  'rebalShort'  — -1x daily-rebalanced short of `sym` while state on
 *  'staticShort' — short f x equity notional at entry, fixed shares, no
 *                  rebalance until exit (naive share short)
 *  'long'        — long `sym` while state on (SVXY implementation)
 * stateAlways=true ignores spikes (always-on controls).
 */
function shortVolReturns(bars, dates, sym, kind, opts, costMultiplier) {
  const {
    f = 1,
    spikePct = 0.3,
    stateAlways = false,
    borrowApr = BORROW_APR,
    signalBars,
  } = opts;
  const series = bars[sym];
  if (!series) return new Array(dates.length).fill(null);
  const byDate = new Map(series.map((b, k) => [b.date, k]));
  const state = stateAlways
    ? new Array(dates.length).fill(true)
    : spikeStateSeries(signalBars, dates, spikePct);
  const cost = (bpsPerSide(sym) / 10000) * costMultiplier; // per side
  const borrowDaily = borrowApr / 252;

  const out = new Array(dates.length).fill(null);
  let active = false;
  let shares = 0; // static-short shares per $1 of entry equity (signed +)
  let eq = 1; // running equity for the static path
  let warm = 0;
  for (let i = 0; i < dates.length; i++) {
    const k = byDate.get(dates[i]);
    if (k == null || k === 0) continue;
    warm++;
    if (warm < SPIKE_LOOKBACK + 3) continue;
    const p0 = series[k - 1].close;
    const p1 = series[k].close;
    const r = p1 / p0 - 1;
    let ret = 0;

    const want = state[i];
    if (kind === 'long') {
      if (active) ret += r;
      if (want !== active) ret -= cost; // one side on the switch day
    } else if (kind === 'rebalShort') {
      if (active) ret += -f * r - f * borrowDaily;
      if (want !== active) ret -= f * cost;
    } else {
      // staticShort: shares fixed at entry; P&L = -shares * dP on equity base
      if (active) {
        const pnl = -shares * (p1 - p0) - f * borrowDaily * eq;
        ret = pnl / eq;
      }
      if (want && !active) {
        shares = (f * eq) / p1; // sized off equity at entry close
        ret -= f * cost;
      } else if (!want && active) {
        shares = 0;
        ret -= f * cost;
      }
    }
    active = want;
    eq *= 1 + ret;
    if (eq <= 0) {
      // ruin: equity gone — record total loss and flatline (honest ruin)
      out[i] = -1;
      for (let j = i + 1; j < dates.length; j++) out[j] = 0;
      return out;
    }
    out[i] = ret;
  }
  return out;
}

function statsOf(dates, returns) {
  const eq = [];
  const ds = [];
  let e = 1;
  for (let i = 0; i < dates.length; i++) {
    if (returns[i] == null) continue;
    e *= 1 + returns[i];
    eq.push(e);
    ds.push(dates[i]);
  }
  return equityStats.statsFromEquity(ds, eq);
}

function buildCandidates({ dates, bars, costMultiplier }) {
  const uvxy = bars.UVXY;
  const mk = (label, sym, kind, opts) => ({
    params: { symbol: sym, ...label },
    returns: shortVolReturns(
      bars,
      dates,
      sym,
      kind,
      { ...opts, signalBars: uvxy },
      costMultiplier
    ),
  });
  return [
    // controls: always-on decay capture
    mk({ kind: 'rebalShort-always' }, 'UVXY', 'rebalShort', {
      stateAlways: true,
    }),
    mk({ kind: 'long-always' }, 'SVXY', 'long', { stateAlways: true }),
    // the Listman rule: short the spike, exit when it comes back down
    mk({ kind: 'rebalShort-spike30' }, 'UVXY', 'rebalShort', { spikePct: 0.3 }),
    mk({ kind: 'rebalShort-spike50' }, 'UVXY', 'rebalShort', { spikePct: 0.5 }),
    mk({ kind: 'staticShort-spike30-f0.5' }, 'UVXY', 'staticShort', {
      spikePct: 0.3,
      f: 0.5,
    }),
    mk({ kind: 'staticShort-spike30-f1.0' }, 'UVXY', 'staticShort', {
      spikePct: 0.3,
      f: 1.0,
    }),
    // zero-infra implementation: long SVXY on UVXY spikes
    mk({ kind: 'svxyLong-spike30' }, 'SVXY', 'long', { spikePct: 0.3 }),
    // NOTE: UVIX (2x, listed 2022-03) is deliberately NOT a walk-forward
    // candidate — the fair common-start rule would clip every candidate's
    // race to 2022+, collapsing the fold count. Its stats are computed in
    // extra.shortVolDetail and recorded as a ledger trial instead.
  ];
}

async function main() {
  let extras = null;

  await validateStrategy({
    family: 'short-vol-spike',
    strategyId: 'uvxy-spike-short-WF-OOS',
    script: 'scripts/backtests/validate-short-vol.js',
    description:
      'Short leveraged VIX ETPs after a 30%+ spike off the 20d low, hold until a fresh 10d low ("duration is the hedge"); SVXY-long as the zero-infra implementation. Net of 15bps/side + 8%/yr borrow while short. Window 2018-03+ (post-deleverage instruments).',
    universe: UNIVERSE,
    controlUniverse: ['SVXY'], // D16: investable passive short-vol expression (EW incl. long-UVXY would be a trivially-losing control)
    start: START,
    buildCandidates: ctx => {
      const candidates = buildCandidates(ctx);
      if (ctx.costMultiplier === 1 && !extras) {
        // gross/borrow sensitivities for the headline variant
        extras = {};
        for (const [label, opts] of [
          ['spike30_gross_noBorrow', { spikePct: 0.3, borrowApr: 0 }],
          ['spike30_borrow15', { spikePct: 0.3, borrowApr: 0.15 }],
        ]) {
          const rets = shortVolReturns(
            ctx.bars,
            ctx.dates,
            'UVXY',
            'rebalShort',
            { ...opts, signalBars: ctx.bars.UVXY },
            label.includes('gross') ? 0 : 1
          );
          extras[label] = statsOf(ctx.dates, rets);
        }
        // UVIX (2022+, too short for WF): informational stats + ledger trial
        const uvixRets = shortVolReturns(
          ctx.bars,
          ctx.dates,
          'UVIX',
          'rebalShort',
          { spikePct: 0.3, signalBars: ctx.bars.UVXY },
          1
        );
        extras.uvixSpike30_insample = statsOf(ctx.dates, uvixRets);
        const { recordTrials } = require('./lib/trialsLedger');
        recordTrials([
          {
            family: 'short-vol-spike',
            strategyId: 'uvxy-spike-short-WF-OOS',
            params: { symbol: 'UVIX', kind: 'rebalShort-spike30-uvix' },
            sharpe: extras.uvixSpike30_insample
              ? extras.uvixSpike30_insample.sharpe
              : null,
            window: {
              start: '2022-03-30',
              end: ctx.dates[ctx.dates.length - 1],
            },
            kind: 'grid',
          },
        ]);

        // spike frequency reality-check vs the "4-6x/year" claim
        const st = spikeStateSeries(ctx.bars.UVXY, ctx.dates, 0.3);
        let episodes = 0;
        for (let i = 1; i < st.length; i++) if (st[i] && !st[i - 1]) episodes++;
        const years = ctx.dates.length / 252;
        extras.spikeEpisodesPerYear = episodes / years;
        extras.timeInTradePct = st.filter(Boolean).length / ctx.dates.length;
        console.log(
          `[reality-check] spike30 episodes/yr: ${extras.spikeEpisodesPerYear.toFixed(1)} (claim: 4-6); time in trade ${(extras.timeInTradePct * 100).toFixed(0)}%`
        );
        console.log(
          `[sensitivity] spike30 gross/no-borrow Sharpe ${extras.spike30_gross_noBorrow.sharpe.toFixed(2)} | at 15%/yr borrow ${extras.spike30_borrow15.sharpe.toFixed(2)}`
        );
      }
      return candidates;
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Claim under test (uvxy.pro / civolatility.com): UVXY spikes 30%+ off a low ~4-6x/yr; short the spike, hold until it comes back down — duration is the hedge, no stop.',
      'Share-short proxy with explicit 8%/yr borrow (UVXY is chronically hard-to-borrow; 15%/yr sensitivity in extra). Margin calls and forced buy-ins NOT modeled — real shorting is strictly worse than this.',
      'Window 2018-03+ only: UVXY/SVXY deleveraged after Volmageddon (2018-02); earlier data describes different instruments. Pre-2018 -1x SVXY lost 92% in one session — the tail this trade carries.',
      'staticShort variants model naive fixed-share shorts: a +100%/f move from entry is RUIN; the sim flatlines the curve at zero if equity is wiped (no respawn).',
      'The options implementation (puts/call spreads) is NOT tested — no historical options data path exists in this repo. Options add premium costs (post-spike UVXY IV is extreme); they cannot improve a share-level edge that fails, only bound its tail.',
      'Faithfulness not_run: no live plugin can short or trade options; SVXY-long variants ARE engine-executable today.',
    ],
    extraReport: {
      get shortVolDetail() {
        return extras;
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
