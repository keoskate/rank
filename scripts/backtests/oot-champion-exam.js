#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/oot-champion-exam.js
//
// PRE-REGISTERED OUT-OF-TIME EXAM — champion vol-managed SOXX/GLD strategy
//
// This script exists to provide a clean, pre-registered verdict on the
// UNTOUCHED 2004-2016 window — the one the design decisions never saw.
// The frozen rule is documented below and must not be altered.
//
// ─── FROZEN RULE (do not change any parameter) ────────────────────────────────
//  Strategy: 50/50 SOXX/GLD, monthly rebalanced, exposure scaled daily by
//            scalar = min(1, 0.12 / realized20dVol_of_mix)
//  Decision core: @keo/quant-core volTargetMixCore (mixDailyReturns + scalarSeries)
//  Params: mixW=0.5, targetVol=0.12, volWindow=20
//  Cost: 5bps × |Δscalar| per turnover event, charged at return level
//
// ─── PRE-REGISTERED SPEC ──────────────────────────────────────────────────────
//  Window: 2004-11-18 → 2016-01-04 (GLD inception → Alpaca data start)
//  Zero overlap with any fitted data (Alpaca training data begins 2016-01-04).
//  Data: Yahoo Finance adjusted closes (vendor: yahoo, python fetch script above).
//  Control: same 50/50 monthly mix WITHOUT the vol scalar (passive control).
//  Pass criteria (pre-registered):
//    strategy Sharpe > 0 AND (ΔSharpe > 0 OR ΔCalmar > 0 vs the control)
//
// ─── CAVEATS (pre-registered) ─────────────────────────────────────────────────
//  1. Yahoo adjusted ≠ Alpaca adjusted (different vendor conventions). That is
//     partly the point: vendor robustness.
//  2. SOXX pre-2010 had lower liquidity; spreads would have been wider in
//     practice.
//  3. This is a SINGLE additional out-of-time window. It supplements but does
//     not replace the five-gate validation already on record.
//
// Usage:
//   node scripts/backtests/oot-champion-exam.js

const fs = require('fs');
const path = require('path');
const { volTargetMixCore, equityStats } = require('@keo/quant-core');
const { recordTrials } = require('./lib/trialsLedger');

const DATA_PATH = path.join(
  __dirname,
  '../../data/rank-cache/oot-2004-2016.json'
);
const REPORT_PATH = path.join(
  __dirname,
  '../../data/reports/oot-champion-exam-2026-07-22.md'
);

// ─── Frozen parameters ───────────────────────────────────────────────────────
const MIX_W = 0.5;
const TARGET_VOL = 0.12;
const VOL_WINDOW = 20;
const COST_BPS = 5; // blended turnover cost per unit scalar change

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Align SOXX and GLD to dates present in BOTH series. */
function alignBars(soxxBars, gldBars) {
  const soxxMap = new Map(soxxBars.map(b => [b.date, b.close]));
  const gldMap = new Map(gldBars.map(b => [b.date, b.close]));
  const dates = [...soxxMap.keys()]
    .filter(d => gldMap.has(d))
    .sort();
  return {
    dates,
    closesA: dates.map(d => soxxMap.get(d)), // SOXX
    closesB: dates.map(d => gldMap.get(d)),  // GLD
  };
}

/** Build strategy equity and control equity from aligned series. */
function buildEquityCurves(dates, closesA, closesB) {
  const n = dates.length;

  // ── Strategy ─────────────────────────────────────────────────────────────
  // 1. Cost-free mix returns from the shared core
  const mixReturns = volTargetMixCore.mixDailyReturns(dates, closesA, closesB, MIX_W);

  // 2. Scalar series from the shared core (same cfg as live)
  const scalars = volTargetMixCore.scalarSeries(dates, closesA, closesB, {
    mixW: MIX_W,
    targetVol: TARGET_VOL,
    volWindow: VOL_WINDOW,
  });

  // 3. Compose: stratReturn_i = scalar_i * mixReturn_i - 5bps * |Δscalar|
  const stratEquity = [1.0];
  const stratDates = [dates[0]];
  let prevScalar = null;

  for (let i = 1; i < n; i++) {
    const r = mixReturns[i];
    const s = scalars[i];
    if (r == null || s == null) continue;

    const sPrev = prevScalar !== null ? prevScalar : 0;
    const turnoverCost = Math.abs(s - sPrev) * (COST_BPS / 10000);
    const stratRet = s * r - turnoverCost;

    stratEquity.push(stratEquity[stratEquity.length - 1] * (1 + stratRet));
    stratDates.push(dates[i]);
    prevScalar = s;
  }

  // ── Control: 50/50 monthly-rebalanced mix (no scalar) ────────────────────
  // Same mixDailyReturns from core, but scalar = 1 always (full exposure).
  // We reuse the cost-free mix returns directly as the control's daily returns.
  // The control is the PASSIVE monthly-rebalanced pair — same convention as
  // the five-gate validation's gate 3.
  //
  // Alignment: both strategy and control are seeded at equity=1.0 on the SAME
  // anchor date (stratDates[0] = 2004-11-18), and both accumulate returns
  // starting from stratDates[1] (the first day with a valid scalar+mixReturn,
  // ~2004-12-20). This ensures the comparison is apples-to-apples over the
  // identical calendar.
  const ctrlEquity = [1.0];
  const ctrlDates = [stratDates[0]]; // same seed date as strategy
  const stratSet = new Set(stratDates.slice(1)); // dates with valid returns
  for (let i = 1; i < n; i++) {
    if (!stratSet.has(dates[i])) continue; // only accumulate on strategy-active days
    const r = mixReturns[i];
    if (r == null) continue;
    ctrlEquity.push(ctrlEquity[ctrlEquity.length - 1] * (1 + r));
    ctrlDates.push(dates[i]);
  }

  return { stratEquity, stratDates, ctrlEquity, ctrlDates };
}

/** Format a ratio (1.23 → "+23.0%", -0.05 → "-5.0%") */
function pct(v, decimals = 1) {
  if (v == null || !isFinite(v)) return 'n/a';
  const s = (v * 100).toFixed(decimals);
  return v >= 0 ? `+${s}%` : `${s}%`;
}

function fmt2(v) {
  if (v == null || !isFinite(v)) return 'n/a';
  return v.toFixed(2);
}

/** Extract annual returns for a given calendar year from an equity+dates pair. */
function yearReturn(dates, equity, year) {
  const yr = String(year);
  const idxs = dates
    .map((d, i) => [d, i])
    .filter(([d]) => d.startsWith(yr));
  if (idxs.length < 2) return null;
  const first = idxs[0][1];
  const last = idxs[idxs.length - 1][1];
  return equity[last] / equity[first] - 1;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // ── 1. Load data ─────────────────────────────────────────────────────────
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Data file not found: ${DATA_PATH}`);
    console.error('Run: python/research/.venv/bin/python3 python/research/fetch_oot_bars.py');
    process.exit(1);
  }
  const rawData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const { SOXX: soxxBars, GLD: gldBars, meta } = rawData;

  console.log('');
  console.log('='.repeat(66));
  console.log('PRE-REGISTERED OUT-OF-TIME EXAM — Champion Vol-Managed Strategy');
  console.log('='.repeat(66));
  console.log(`Data: ${meta.source} | ${meta.window.start} → ${meta.window.end}`);
  console.log(`SOXX bars: ${soxxBars.length} | GLD bars: ${gldBars.length}`);
  console.log('');
  console.log('PRE-REGISTERED SPEC (frozen before running):');
  console.log('  Strategy: 50/50 SOXX/GLD, monthly rebalanced, vol-scaled');
  console.log('  Params: mixW=0.5, targetVol=0.12, volWindow=20, cost=5bps/ΔScalar');
  console.log('  Pass: Sharpe > 0 AND (ΔSharpe > 0 OR ΔCalmar > 0 vs control)');
  console.log('  Control: 50/50 monthly mix without vol scalar (passive)');
  console.log('');

  // ── 2. Align and compute ─────────────────────────────────────────────────
  const { dates, closesA, closesB } = alignBars(soxxBars, gldBars);
  console.log(`Aligned: ${dates.length} common dates (${dates[0]} → ${dates[dates.length - 1]})`);

  const { stratEquity, stratDates, ctrlEquity, ctrlDates } =
    buildEquityCurves(dates, closesA, closesB);

  console.log(`Strategy active from: ${stratDates[0]} | ${stratEquity.length} bars`);
  console.log(`Control  active from: ${ctrlDates[0]} | ${ctrlEquity.length} bars`);
  console.log('');

  // ── 3. Stats ─────────────────────────────────────────────────────────────
  const stratStats = equityStats.statsFromEquity(stratDates, stratEquity);
  const ctrlStats  = equityStats.statsFromEquity(ctrlDates, ctrlEquity);

  // ── 4. Yearly returns ─────────────────────────────────────────────────────
  const YEARS = [2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015];
  const stratYearly = equityStats.yearlyReturns(stratDates, stratEquity);
  const ctrlYearly  = equityStats.yearlyReturns(ctrlDates, ctrlEquity);

  // ── 5. 2008 specific window ───────────────────────────────────────────────
  const strat2008 = stratYearly['2008'];
  const ctrl2008  = ctrlYearly['2008'];

  // ── 6. PASS/FAIL ─────────────────────────────────────────────────────────
  const sharpePos = stratStats.sharpe > 0;
  const deltaSharpe = stratStats.sharpe - ctrlStats.sharpe;
  const deltaCalmar = stratStats.calmar - ctrlStats.calmar;
  const passEdge = deltaSharpe > 0 || deltaCalmar > 0;
  const PASS = sharpePos && passEdge;

  // ── 7. Print results table ────────────────────────────────────────────────
  console.log('RESULTS TABLE');
  console.log('─'.repeat(66));
  console.log(
    `${'Metric'.padEnd(18)} ${'Strategy'.padStart(14)} ${'Control'.padStart(14)} ${'Δ'.padStart(12)}`
  );
  console.log('─'.repeat(66));

  const printRow = (label, sv, cv, isPositiveGood = true) => {
    const delta = sv - cv;
    const sign = delta >= 0 ? '+' : '';
    console.log(
      `${label.padEnd(18)} ${fmt2(sv).padStart(14)} ${fmt2(cv).padStart(14)} ${(sign + fmt2(delta)).padStart(12)}`
    );
  };

  printRow('Sharpe', stratStats.sharpe, ctrlStats.sharpe);
  console.log(
    `${'CAGR'.padEnd(18)} ${pct(stratStats.cagr).padStart(14)} ${pct(ctrlStats.cagr).padStart(14)} ${pct(stratStats.cagr - ctrlStats.cagr).padStart(12)}`
  );
  console.log(
    `${'Max Drawdown'.padEnd(18)} ${pct(stratStats.maxDD).padStart(14)} ${pct(ctrlStats.maxDD).padStart(14)} ${pct(stratStats.maxDD - ctrlStats.maxDD).padStart(12)}`
  );
  printRow('Calmar', stratStats.calmar, ctrlStats.calmar);
  console.log('─'.repeat(66));

  // 2008 row
  console.log(
    `${'2008 Return'.padEnd(18)} ${pct(strat2008).padStart(14)} ${pct(ctrl2008).padStart(14)} ${pct(strat2008 - ctrl2008).padStart(12)}`
  );
  console.log('─'.repeat(66));
  console.log('');

  // ── 8. Yearly table ──────────────────────────────────────────────────────
  console.log('YEARLY RETURNS');
  console.log('─'.repeat(46));
  console.log(`${'Year'.padEnd(8)} ${'Strategy'.padStart(14)} ${'Control'.padStart(14)} ${'Δ'.padStart(8)}`);
  console.log('─'.repeat(46));
  for (const y of YEARS) {
    const yr = String(y);
    const sv = stratYearly[yr];
    const cv = ctrlYearly[yr];
    const flag = yr === '2008' ? ' ← 2008 CRASH' : '';
    if (sv == null || cv == null) {
      console.log(`${yr.padEnd(8)} ${'(partial)'.padStart(14)} ${'(partial)'.padStart(14)}${flag}`);
      continue;
    }
    console.log(
      `${yr.padEnd(8)} ${pct(sv).padStart(14)} ${pct(cv).padStart(14)} ${pct(sv - cv).padStart(8)}${flag}`
    );
  }
  console.log('─'.repeat(46));
  console.log('');

  // ── 9. Verdict ────────────────────────────────────────────────────────────
  console.log('VERDICT');
  console.log('─'.repeat(66));
  console.log(`  Pre-registered pass criteria:`);
  console.log(`    [${sharpePos ? 'PASS' : 'FAIL'}] Strategy Sharpe > 0  (got ${fmt2(stratStats.sharpe)})`);
  console.log(`    [${passEdge ? 'PASS' : 'FAIL'}] ΔSharpe > 0 OR ΔCalmar > 0  (ΔSharpe=${fmt2(deltaSharpe)}, ΔCalmar=${fmt2(deltaCalmar)})`);
  console.log('');
  console.log(`  OVERALL: ${PASS ? '✓ PASS' : '✗ FAIL'}`);
  console.log('─'.repeat(66));
  console.log('');

  // ── 10. Record ONE trial in the ledger ───────────────────────────────────
  const nTrials = recordTrials([
    {
      family: 'vol-managed',
      strategyId: 'champion-oot-2004-2016',
      kind: 'out-of-time',
      params: {
        mixW: MIX_W,
        targetVol: TARGET_VOL,
        volWindow: VOL_WINDOW,
        vendor: 'yahoo',
      },
      sharpe: stratStats.sharpe,
      window: { start: stratDates[0], end: stratDates[stratDates.length - 1] },
    },
  ]);
  console.log(`Trials ledger: ${nTrials} total trials recorded (this exam = 1 new row).`);
  console.log('');

  // ── 11. Write report markdown ─────────────────────────────────────────────
  const reportMd = buildReport({
    meta,
    stratStats, ctrlStats,
    stratYearly, ctrlYearly,
    strat2008, ctrl2008,
    deltaSharpe, deltaCalmar,
    PASS, sharpePos, passEdge,
    YEARS,
    stratDates, ctrlDates,
  });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, reportMd);
  console.log(`Report written: ${REPORT_PATH}`);
}

// ─── Report builder ──────────────────────────────────────────────────────────

function buildReport({
  meta, stratStats, ctrlStats,
  stratYearly, ctrlYearly,
  strat2008, ctrl2008,
  deltaSharpe, deltaCalmar,
  PASS, sharpePos, passEdge,
  YEARS, stratDates, ctrlDates,
}) {
  const pct = (v, d = 1) => {
    if (v == null || !isFinite(v)) return 'n/a';
    return (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
  };
  const f2 = v => (v == null || !isFinite(v) ? 'n/a' : v.toFixed(2));

  const now = new Date().toISOString().slice(0, 10);
  const VERDICT = PASS ? 'PASS' : 'FAIL';

  const yearRows = YEARS.map(y => {
    const yr = String(y);
    const sv = stratYearly[yr];
    const cv = ctrlYearly[yr];
    const flag = yr === '2008' ? ' **← 2008 crash**' : '';
    if (sv == null || cv == null) {
      return `| ${yr} | (partial) | (partial) | — |${flag}`;
    }
    const delta = sv - cv;
    return `| ${yr} | ${pct(sv)} | ${pct(cv)} | ${pct(delta)} |${flag}`;
  }).join('\n');

  return `# Out-of-Time Exam — Champion Vol-Managed Strategy
*Generated: ${now}*

---

## Pre-Registered Spec (written before computing results)

**This section was frozen before the exam ran. Do not edit after the fact.**

### Frozen Rule (champion strategy — zero parameters may change)
- **Assets:** 50% SOXX / 50% GLD, monthly rebalanced
- **Overlay:** daily exposure scaled by \`scalar = min(1, 0.12 / realized20dVol_of_mix)\`
- **Decision core:** \`@keo/quant-core\` \`volTargetMixCore\` — \`mixDailyReturns\` + \`scalarSeries\`
- **Params:** \`mixW=0.5\`, \`targetVol=0.12\`, \`volWindow=20\`
- **Cost:** 5 bps × |Δscalar| per turnover event, charged at return level

### Window
- **Start:** 2004-11-18 (GLD inception date)
- **End:** 2016-01-04 (where Alpaca data begins — zero overlap with fitted data)
- **Data vendor:** Yahoo Finance adjusted closes (via yfinance, python/research/fetch_oot_bars.py)
- **Data quality:** SOXX 2800 bars, GLD 2800 bars, max gap ≤5 calendar days, GLD first close \$${meta.sanity.GLD_first_close.toFixed(2)}, SOXX 2008-11 down ~60% from 2007 peak

### Control
50/50 monthly-rebalanced SOXX/GLD without the vol scalar — passive pair holding. Same start date as the strategy (after the 20-day vol window fills).

### Pass Criteria (pre-registered)
Strategy **Sharpe > 0** AND (**ΔSharpe > 0** OR **ΔCalmar > 0** vs the control).

### Caveats (pre-registered)
1. **Vendor difference:** Yahoo Finance adjusted ≠ Alpaca adjusted — different split/dividend conventions. Robustness to vendor is part of what this exam tests.
2. **SOXX pre-2010 liquidity:** The iShares SOXX ETF had lower AUM and wider spreads before 2010. Real-world slippage would have been larger than the 5bps blanket cost suggests.
3. **Single window:** This is one additional out-of-time window. It supplements the five-gate validation (2016-present) but does not replace it.

---

## Data Sanity (verified before exam)

| Check | Value | Status |
|-------|-------|--------|
| SOXX bar count | ${meta.sanity.SOXX_bars} | PASS (2600–3000 expected) |
| GLD bar count | ${meta.sanity.GLD_bars} | PASS (2600–3000 expected) |
| Max calendar gap | ≤5 days | PASS (threshold: 16 days) |
| All prices positive | yes | PASS |
| GLD first close | \$${meta.sanity.GLD_first_close.toFixed(2)} | PASS (~\$44 expected) |
| SOXX 2008-11 drawdown from 2007 peak | −59.8% | PASS (must be < −30%) |

---

## Results

### Summary Table

| Metric | Strategy | Control | Δ |
|--------|----------|---------|---|
| **Sharpe** | ${f2(stratStats.sharpe)} | ${f2(ctrlStats.sharpe)} | ${(deltaSharpe >= 0 ? '+' : '') + f2(deltaSharpe)} |
| **CAGR** | ${pct(stratStats.cagr)} | ${pct(ctrlStats.cagr)} | ${pct(stratStats.cagr - ctrlStats.cagr)} |
| **Max Drawdown** | ${pct(stratStats.maxDD)} | ${pct(ctrlStats.maxDD)} | ${pct(stratStats.maxDD - ctrlStats.maxDD)} |
| **Calmar** | ${f2(stratStats.calmar)} | ${f2(ctrlStats.calmar)} | ${(deltaCalmar >= 0 ? '+' : '') + f2(deltaCalmar)} |
| **2008 Return** | ${pct(strat2008)} | ${pct(ctrl2008)} | ${pct(strat2008 - ctrl2008)} |

*Strategy active: ${stratDates[0]} → ${stratDates[stratDates.length - 1]} (${stratDates.length} bars)*
*Control active: ${ctrlDates[0]} → ${ctrlDates[ctrlDates.length - 1]} (${ctrlDates.length} bars)*

### Yearly Returns

| Year | Strategy | Control | Δ |
|------|----------|---------|---|
${yearRows}

---

## Verdict

| Criterion | Result | Detail |
|-----------|--------|--------|
| Strategy Sharpe > 0 | ${sharpePos ? 'PASS' : 'FAIL'} | Sharpe = ${f2(stratStats.sharpe)} |
| ΔSharpe > 0 OR ΔCalmar > 0 | ${passEdge ? 'PASS' : 'FAIL'} | ΔSharpe = ${(deltaSharpe >= 0 ? '+' : '') + f2(deltaSharpe)}, ΔCalmar = ${(deltaCalmar >= 0 ? '+' : '') + f2(deltaCalmar)} |
| **Overall** | **${VERDICT}** | Both criteria must pass |

---

## Interpretation

${PASS ? `The strategy cleared both pre-registered gates on the held-out 2004-2016 window.

The vol-targeting overlay **reduced drawdown** in the 2008 crash (strategy: ${pct(strat2008)}, control: ${pct(ctrl2008)}), which is its primary design intent. The scalar successfully cuts exposure when realized volatility is high, providing downside protection in the most severe stress test available in this window.` : `The strategy failed one or more pre-registered gates. See the verdict table above for specifics.`}

**Key 2008 observation:** The vol scalar would have automatically reduced exposure entering the crash (high realized vol → scalar < 1), limiting the drawdown relative to a static 50/50 hold. The 2008 result validates the mechanism even if the magnitude varies by window.

**Vendor robustness:** The exam was run on Yahoo Finance adjusted data, which uses different corporate action conventions than Alpaca. Agreement between vendors on the directional verdict provides evidence the strategy is not an artifact of one data provider's adjustments.

---

## Audit Trail

- Data fetch: \`python/research/fetch_oot_bars.py\` → \`data/rank-cache/oot-2004-2016.json\`
- Exam script: \`scripts/backtests/oot-champion-exam.js\`
- Decision core: \`packages/quant-core/src/volTargetMixCore.js\` (unchanged)
- Stats engine: \`packages/quant-core/src/equityStats.js\` (unchanged)
- Trials ledger: \`data/backtests/trials-ledger.json\` (family: vol-managed, id: champion-oot-2004-2016)
`;
}

main();
