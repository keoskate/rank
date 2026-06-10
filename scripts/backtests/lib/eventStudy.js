// scripts/backtests/lib/eventStudy.js
//
// The event-study harness (ROADMAP B6): honest validation for EVENT-driven
// strategies (insider-following, dark-pool, options-flow), where the unit of
// evidence is "entry events + an exit policy → a trade list", not a
// continuously-invested equity curve.
//
// A SIBLING of validateStrategy — it reuses the same primitives (one data
// path loadDailyBars, runDataIntegrityGate, recordTrials, writeRunArtifact,
// quant-core significance/equityStats) and emits the same run.json artifact,
// so every existing viewer works unchanged.
//
// ── GATE MAPPING FOR EVENT STRATEGIES (pre-registered; the doc copy lives at
//    data/reports/event-study-gates-preregistration-2026-06-10.md and must be
//    committed BEFORE the first run) ─────────────────────────────────────────
//  1 dataIntegrity   APPLIES UNCHANGED — runDataIntegrityGate over the event
//                    symbols' daily bars (waivers via known-data-issues.json).
//  2 faithfulness    APPLIES, same semantics: not_run unless a fresh
//                    certify-*.js report proves the live plugin shares the
//                    decision core. An event strategy with no certified core
//                    can never reach VALIDATED — that is honest, not a bug.
//  3 outOfSample     REDEFINED for events: chronological event split — the
//                    exit policy is CHOSEN on the train events (first
//                    trainFrac by event date), an embargo of embargoDays
//                    calendar days is skipped, and the chosen policy is
//                    SCORED on the test events. not_run when total events <
//                    minEvents or test trades < minTestEvents. Pass = test
//                    mean net return > 0.
//  4 realisticCosts  APPLIES — the chosen policy's TEST trades rebuilt at
//                    2x costBpsPerSide must keep a positive mean.
//  5 multipleTesting BOOTSTRAP FORM — for EVERY policy in the exit grid:
//                    p = P(null mean >= observed test mean) under a
//                    hold-matched null that applies the SAME exit policy at
//                    RANDOM entry dates on the SAME symbols (10k resamples,
//                    seeded LCG). Benjamini-Hochberg across the grid at
//                    q = 0.05; pass iff the CHOSEN policy is rejected
//                    (significant). Deflated Sharpe is reported in the notes
//                    informationally only — sparse-event SR is ill-behaved.
//                    EVERY grid point is recorded in the trials ledger
//                    (kind 'event-grid'), never deleted.
// ──────────────────────────────────────────────────────────────────────────
//
// Trade construction: entry at the OPEN of the first session strictly after
// the event's public-information date. Exits walk daily OHLC with the
// CONSERVATIVE convention: gap-through opens fill at the open; when stop and
// target are both touchable within one bar, the STOP fills (worst case).
// Portfolio aggregation: fixed slots — each active trade gets 1/maxConcurrent
// of equity, surplus events beyond maxConcurrent are skipped oldest-first
// (deterministic), idle capital earns 0.
//
// On VALIDATED verdicts (all five gates) the harness writes
// data/backtests/validated-sources.json — the registry tierPromotion's
// validation gate reads. Nothing else may write that file.

const fs = require('fs');
const path = require('path');
const { significance, equityStats } = require('@keo/quant-core');
const { loadDailyBars } = require('./marketData');
const { runDataIntegrityGate } = require('./dataIntegrity');
const { recordTrials, trialStats } = require('./trialsLedger');
const { writeRunArtifact } = require('./runArtifact');

const VALIDATED_SOURCES_PATH = path.join(
  __dirname,
  '../../../data/backtests/validated-sources.json'
);

const DEFAULTS = {
  entry: 'nextOpen',
  maxConcurrent: 10,
  costBpsPerSide: 5,
  minEvents: 60,
  minTestEvents: 20,
  trainFrac: 0.6,
  embargoDays: 21,
  bootstrapIter: 10000,
  bhQ: 0.05,
  seed: 42,
};

/** Deterministic LCG in [0,1) — bootstrap results must reproduce exactly. */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Walk one trade from entryIdx under a tp/sl/maxHold policy.
 * Conservative: gap-through opens fill at the open; stop beats target
 * within a bar. Returns null when there is no entry bar.
 */
function walkTrade(bars, entryIdx, policy) {
  if (entryIdx == null || entryIdx < 0 || entryIdx >= bars.length) return null;
  const entry = bars[entryIdx].open;
  if (!(entry > 0)) return null;
  const stopPx = entry * (1 - policy.slPct / 100);
  const targetPx = entry * (1 + policy.tpPct / 100);
  const lastIdx = Math.min(entryIdx + policy.maxHoldDays - 1, bars.length - 1);
  for (let i = entryIdx; i <= lastIdx; i++) {
    const b = bars[i];
    if (i > entryIdx) {
      if (b.open <= stopPx) return _exit(bars, entryIdx, i, b.open, 'gap-stop');
      if (b.open >= targetPx) {
        return _exit(bars, entryIdx, i, b.open, 'gap-target');
      }
    }
    if (b.low <= stopPx) return _exit(bars, entryIdx, i, stopPx, 'stop');
    if (b.high >= targetPx) return _exit(bars, entryIdx, i, targetPx, 'target');
  }
  return _exit(bars, entryIdx, lastIdx, bars[lastIdx].close, 'time');
}

function _exit(bars, entryIdx, exitIdx, exitPx, reason) {
  const entry = bars[entryIdx].open;
  return {
    entryIdx,
    exitIdx,
    entryDate: bars[entryIdx].date,
    exitDate: bars[exitIdx].date,
    entryPrice: entry,
    exitPrice: exitPx,
    holdDays: exitIdx - entryIdx + 1,
    grossPct: (exitPx / entry - 1) * 100,
    exitReason: reason,
  };
}

const netPct = (grossPct, costBpsPerSide) =>
  grossPct - (2 * costBpsPerSide) / 100;

/** First bar index whose date is strictly after `date` (entry = next open). */
function nextBarIdx(bars, date) {
  for (let i = 0; i < bars.length; i++) if (bars[i].date > date) return i;
  return null;
}

/** Build the trade list for one policy over all events. */
function buildTrades(events, barsBySym, policy, costBpsPerSide) {
  const trades = [];
  let skippedNoBars = 0;
  for (const ev of events) {
    const bars = barsBySym[ev.symbol];
    if (!bars || !bars.length) {
      skippedNoBars++;
      continue;
    }
    const idx = nextBarIdx(bars, ev.date);
    const t = idx == null ? null : walkTrade(bars, idx, policy);
    if (!t) {
      skippedNoBars++;
      continue;
    }
    trades.push({
      ...t,
      symbol: ev.symbol,
      eventDate: ev.date,
      netPct: netPct(t.grossPct, costBpsPerSide),
      meta: ev.meta || null,
    });
  }
  trades.sort(
    (a, b) =>
      a.entryDate.localeCompare(b.entryDate) || a.symbol.localeCompare(b.symbol)
  );
  return { trades, skippedNoBars };
}

/**
 * Fixed-slot portfolio: every active trade runs 1/maxConcurrent of equity;
 * events arriving while all slots are busy are skipped (oldest-first wins,
 * deterministic). Daily mark from closes; entry/exit days use entry open /
 * exit price. Returns {dates, equity (1.0 base), taken, skippedFull}.
 */
function aggregateEquity(trades, barsBySym, calendar, maxConcurrent) {
  const open = []; // active positions
  const queue = [...trades];
  let equity = 1;
  const out = { dates: [], equity: [], taken: 0, skippedFull: 0 };
  const idxBySymDate = {};
  for (const sym of Object.keys(barsBySym)) {
    idxBySymDate[sym] = new Map(barsBySym[sym].map((b, i) => [b.date, i]));
  }
  for (const d of calendar) {
    // exits first (free the slot on the exit day's mark)
    let dayPnl = 0;
    for (let i = open.length - 1; i >= 0; i--) {
      const p = open[i];
      const bars = barsBySym[p.symbol];
      const bi = idxBySymDate[p.symbol].get(d);
      if (bi == null) continue;
      if (d === p.exitDate) {
        dayPnl += ((p.exitPriceNet - p.lastMark) / p.lastMark) * p.weight;
        open.splice(i, 1);
      } else if (bi > p.entryIdx) {
        const close = bars[bi].close;
        dayPnl += ((close - p.lastMark) / p.lastMark) * p.weight;
        p.lastMark = close;
      }
    }
    // entries (at the open, marked to the entry day's close below)
    while (queue.length && queue[0].entryDate === d) {
      const t = queue.shift();
      if (open.length >= maxConcurrent) {
        out.skippedFull++;
        continue;
      }
      out.taken++;
      const bars = barsBySym[t.symbol];
      const bi = idxBySymDate[t.symbol].get(d);
      const weight = 1 / maxConcurrent;
      const entryNet = t.entryPrice;
      // net exit price embeds round-trip costs so the curve is cost-aware
      const exitPriceNet = t.entryPrice * (1 + t.netPct / 100);
      if (t.exitDate === d) {
        dayPnl += ((exitPriceNet - entryNet) / entryNet) * weight;
      } else {
        open.push({
          ...t,
          weight,
          lastMark: bars[bi] ? bars[bi].close : entryNet,
          exitPriceNet,
        });
        const close = bars[bi] ? bars[bi].close : entryNet;
        dayPnl += ((close - entryNet) / entryNet) * weight;
      }
    }
    equity *= 1 + dayPnl;
    out.dates.push(d);
    out.equity.push(equity);
  }
  return out;
}

/** Weekly compounded returns of the test-period curve (oosFingerprint). */
function weeklyFingerprint(dates, equity, fromDate) {
  const pts = dates
    .map((d, i) => ({ d, e: equity[i] }))
    .filter(p => p.d >= fromDate);
  if (pts.length < 6) return null;
  const out = [];
  let weekStart = pts[0].e;
  for (let i = 1; i < pts.length; i++) {
    if (i % 5 === 0 || i === pts.length - 1) {
      out.push(Math.round((pts[i].e / weekStart - 1) * 1e6) / 1e6);
      weekStart = pts[i].e;
    }
  }
  return out;
}

/**
 * Bootstrap p-value for one policy: apply the SAME exit policy at random
 * entry dates on the same symbols (hold-matched by construction — the policy
 * dictates the hold), compare null means of nTest-trade samples against the
 * observed test mean. One-sided: p = P(nullMean >= observedMean).
 */
function bootstrapP(testTrades, barsBySym, policy, costBpsPerSide, iter, rng) {
  if (!testTrades.length) return 1;
  const observed =
    testTrades.reduce((s, t) => s + t.netPct, 0) / testTrades.length;
  let ge = 0;
  for (let k = 0; k < iter; k++) {
    let sum = 0;
    let n = 0;
    for (const t of testTrades) {
      const bars = barsBySym[t.symbol];
      const maxEntry = bars.length - 2;
      if (maxEntry < 1) continue;
      const idx = 1 + Math.floor(rng() * maxEntry);
      const w = walkTrade(bars, idx, policy);
      if (!w) continue;
      sum += netPct(w.grossPct, costBpsPerSide);
      n++;
    }
    if (n && sum / n >= observed) ge++;
  }
  return (ge + 1) / (iter + 1); // add-one: a bootstrap p is never exactly 0
}

/**
 * Run the full event-study validation. See module header for the gate
 * mapping. Returns { runId, artifact, verdict, chosen, gates }.
 */
async function validateEventStrategy(spec) {
  const cfg = { ...DEFAULTS, ...spec };
  const {
    family,
    strategyId,
    script,
    events,
    exitPolicies,
    start,
    end,
    sourceKey = null, // tierPromotion registry key, e.g. 'insider-following'
  } = cfg;
  if (!family || !strategyId || !script) {
    throw new Error('eventStudy: family/strategyId/script required');
  }
  if (!Array.isArray(events) || !events.length) {
    throw new Error('eventStudy: events[] required');
  }
  if (!Array.isArray(exitPolicies) || !exitPolicies.length) {
    throw new Error('eventStudy: exitPolicies[] required');
  }

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const symbols = [...new Set(sorted.map(e => e.symbol))];
  const loadSyms = symbols.includes('SPY') ? symbols : ['SPY', ...symbols];

  console.log(
    `event-study ${strategyId}: ${sorted.length} events, ${symbols.length} symbols, ${exitPolicies.length} exit policies`
  );
  const { bars, integrity } = await loadDailyBars(loadSyms, {
    start,
    end,
    quiet: true,
  });
  const calendar = (bars.SPY || []).map(b => b.date);
  if (!calendar.length) throw new Error('eventStudy: no SPY calendar bars');

  // ---- gate 1: data integrity (full gate, waivers applied inside) ----
  const g1 = await runDataIntegrityGate(bars, { symbols, start, end });
  const gate1 = {
    status: g1.status === 'fail' ? 'fail' : 'pass',
    note: `dataIntegrity ${g1.status}: ${g1.summary.pass} pass / ${g1.summary.warn} warn / ${g1.summary.fail} fail of ${symbols.length} symbols`,
  };

  // ---- chronological split ----
  const nTrain = Math.floor(sorted.length * cfg.trainFrac);
  const trainEvents = sorted.slice(0, nTrain);
  const lastTrainDate = trainEvents.length
    ? trainEvents[trainEvents.length - 1].date
    : null;
  const embargoEnd = lastTrainDate
    ? new Date(
        new Date(`${lastTrainDate}T00:00:00Z`).getTime() +
          cfg.embargoDays * 864e5
      )
        .toISOString()
        .slice(0, 10)
    : null;
  const testEvents = embargoEnd
    ? sorted.slice(nTrain).filter(e => e.date > embargoEnd)
    : [];

  // ---- per-policy trade lists + train/test scoring ----
  const rng = makeRng(cfg.seed);
  const policies = exitPolicies.map(p => {
    const all = buildTrades(sorted, bars, p, cfg.costBpsPerSide);
    const train = buildTrades(trainEvents, bars, p, cfg.costBpsPerSide);
    const test = buildTrades(testEvents, bars, p, cfg.costBpsPerSide);
    const mean = xs =>
      xs.length ? xs.reduce((s, t) => s + t.netPct, 0) / xs.length : null;
    return {
      policy: p,
      all: all.trades,
      skippedNoBars: all.skippedNoBars,
      train: train.trades,
      test: test.trades,
      trainMean: mean(train.trades),
      testMean: mean(test.trades),
      winRateTest: test.trades.length
        ? test.trades.filter(t => t.netPct > 0).length / test.trades.length
        : null,
    };
  });

  // choose on TRAIN only (highest mean net; deterministic tie-break by id)
  const choosable = policies.filter(p => p.trainMean != null);
  choosable.sort(
    (a, b) =>
      b.trainMean - a.trainMean ||
      String(a.policy.id).localeCompare(String(b.policy.id))
  );
  const chosen = choosable[0] || policies[0];

  // ---- gate 3: out-of-sample ----
  const enough =
    sorted.length >= cfg.minEvents && chosen.test.length >= cfg.minTestEvents;
  const gate3 = enough
    ? {
        status: chosen.testMean > 0 ? 'pass' : 'fail',
        note: `chronological event split: policy ${chosen.policy.id} chosen on ${chosen.train.length} train trades (mean ${fmtPct(chosen.trainMean)}), scored on ${chosen.test.length} test trades (mean ${fmtPct(chosen.testMean)}, embargo ${cfg.embargoDays}d)`,
      }
    : {
        status: 'not_run',
        note: `insufficient events for an honest split: ${sorted.length}/${cfg.minEvents} events, ${chosen.test.length}/${cfg.minTestEvents} test trades — verdict cannot exceed UNVALIDATED until more events accrue`,
      };

  // ---- gate 4: 2x costs on the chosen policy's TEST trades ----
  let gate4;
  if (enough) {
    const test2x = buildTrades(
      testEvents,
      bars,
      chosen.policy,
      cfg.costBpsPerSide * 2
    ).trades;
    const mean2x = test2x.length
      ? test2x.reduce((s, t) => s + t.netPct, 0) / test2x.length
      : null;
    gate4 = {
      status: mean2x != null && mean2x > 0 ? 'pass' : 'fail',
      note: `test mean at 2x costs (${cfg.costBpsPerSide * 2}bps/side): ${fmtPct(mean2x)}`,
    };
  } else {
    gate4 = { status: 'not_run', note: 'pending gate 3 sample' };
  }

  // ---- gate 5: bootstrap + BH across the grid ----
  let gate5;
  let bootstrap = null;
  if (enough) {
    const pvals = policies.map(p =>
      p.test.length
        ? bootstrapP(
            p.test,
            bars,
            p.policy,
            cfg.costBpsPerSide,
            cfg.bootstrapIter,
            rng
          )
        : 1
    );
    const bh = significance.benjaminiHochberg(pvals, cfg.bhQ);
    const chosenIdx = policies.indexOf(chosen);
    bootstrap = {
      iterations: cfg.bootstrapIter,
      seed: cfg.seed,
      q: cfg.bhQ,
      perPolicy: policies.map((p, i) => ({
        id: p.policy.id,
        testMean: p.testMean,
        p: pvals[i],
        significant: bh.rejected[i],
      })),
      null: 'same exit policy at seeded-random entry dates on the same symbols (hold-matched by construction)',
    };
    gate5 = {
      status: bh.rejected[chosenIdx] ? 'pass' : 'fail',
      note: `bootstrap p=${pvals[chosenIdx].toFixed(4)} for chosen policy; BH(q=${cfg.bhQ}) across ${policies.length} grid policies → ${bh.rejected[chosenIdx] ? 'significant' : 'NOT significant'}`,
    };
  } else {
    gate5 = { status: 'not_run', note: 'pending gate 3 sample' };
  }

  // ---- gate 2: faithfulness (cert required; event strategies start without) ----
  const gate2 = cfg.faithfulness || {
    status: 'not_run',
    note: 'no certified live core for this event source yet — cannot reach VALIDATED until a certify-*.js report exists (<=30d old)',
  };

  // ---- portfolio curve for the artifact (chosen policy, full period) ----
  const agg = aggregateEquity(chosen.all, bars, calendar, cfg.maxConcurrent);
  const fullStats = equityStats.statsFromEquity(agg.dates, agg.equity);

  // ---- ledger: EVERY grid point is a trial ----
  const firstTestDate = testEvents.length ? testEvents[0].date : null;
  const ledgerN = recordTrials(
    policies.map(p => {
      const pa = aggregateEquity(p.all, bars, calendar, cfg.maxConcurrent);
      const st = equityStats.statsFromEquity(pa.dates, pa.equity);
      return {
        family,
        strategyId: `${strategyId}:${p.policy.id}`,
        params: { ...p.policy, costBpsPerSide: cfg.costBpsPerSide },
        sharpe: st.sharpe,
        window: { start: agg.dates[0], end: agg.dates[agg.dates.length - 1] },
        kind: 'event-grid',
        oosFingerprint: firstTestDate
          ? weeklyFingerprint(pa.dates, pa.equity, firstTestDate)
          : null,
      };
    })
  );
  const ledger = trialStats(family);

  // ---- artifact ----
  const tradedSyms = [...new Set(chosen.all.map(t => t.symbol))];
  const barsOut = {};
  for (const s of tradedSyms) barsOut[s] = bars[s];
  const { runId, artifact } = writeRunArtifact({
    family,
    strategyId,
    script,
    description: cfg.description || '',
    params: {
      exitGrid: exitPolicies,
      chosenPolicy: chosen.policy,
      entry: cfg.entry,
      maxConcurrent: cfg.maxConcurrent,
      costBpsPerSide: cfg.costBpsPerSide,
      nEvents: sorted.length,
    },
    dates: agg.dates,
    equity: agg.equity,
    trades: chosen.all.map(t => ({
      date: t.entryDate,
      side: 'buy',
      symbol: t.symbol,
      price: t.entryPrice,
      qty: null,
      notional: null,
      pnl: null,
      pnlPct: t.netPct / 100,
      note: `event ${t.eventDate} → exit ${t.exitDate} (${t.exitReason})`,
    })),
    bars: barsOut,
    data: {
      source: integrity.source,
      adjustment: integrity.adjustment,
      timeframe: integrity.timeframe,
      window: integrity.window,
      symbols,
      integrity,
    },
    notes: [
      `Event study: ${sorted.length} events (${sorted[0].date} → ${sorted[sorted.length - 1].date}); ${chosen.all.length} trades for the chosen policy; ${chosen.skippedNoBars} events skipped (no bars/next session); ${agg.skippedFull} skipped (slots full).`,
      `Exit convention: conservative — gap opens fill at the open, stop beats target inside a bar.`,
      `Portfolio: ${cfg.maxConcurrent} fixed slots, idle capital earns 0; equity Sharpe ${fullStats.sharpe?.toFixed(2)} (full period, informational).`,
      `Trials ledger: ${ledgerN} total trials after recording this grid (${ledger.n} in family ${family}).`,
      ...(cfg.notes || []),
    ],
    gates: {
      dataIntegrity: gate1,
      faithfulness: gate2,
      outOfSample: gate3,
      realisticCosts: gate4,
      multipleTesting: gate5,
    },
    extra: {
      eventStudy: {
        events: sorted,
        split: {
          trainEvents: trainEvents.length,
          testEvents: testEvents.length,
          embargoDays: cfg.embargoDays,
          embargoEnd,
        },
        grid: policies.map(p => ({
          id: p.policy.id,
          policy: p.policy,
          nTrades: p.all.length,
          trainMean: p.trainMean,
          testMean: p.testMean,
          winRateTest: p.winRateTest,
        })),
        chosen: chosen.policy.id,
        bootstrap,
      },
    },
  });

  // ---- registry: only a full VALIDATED verdict unlocks tierPromotion ----
  if (artifact.validation.verdict === 'VALIDATED' && sourceKey) {
    let reg = {};
    try {
      reg = JSON.parse(fs.readFileSync(VALIDATED_SOURCES_PATH, 'utf8')) || {};
    } catch {
      /* fresh registry */
    }
    reg[sourceKey] = {
      verdict: 'VALIDATED',
      runId,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(VALIDATED_SOURCES_PATH, JSON.stringify(reg, null, 2));
    console.log(`validated-sources.json updated for ${sourceKey}`);
  }

  return {
    runId,
    artifact,
    verdict: artifact.validation.verdict,
    chosen: chosen.policy,
    gates: artifact.validation.gates,
  };
}

function fmtPct(x) {
  return x == null ? 'n/a' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
}

module.exports = {
  validateEventStrategy,
  walkTrade,
  buildTrades,
  aggregateEquity,
  bootstrapP,
  makeRng,
  DEFAULTS,
  VALIDATED_SOURCES_PATH,
};
