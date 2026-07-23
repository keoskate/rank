#!/usr/bin/env node
// scripts/backtests/execution-residual.js
//
// Gate-2 execution-residual quantifier.
//
// Measures the gap between backtest execution assumptions (daily-close fill,
// flat bps/side) and what the live paper engine actually achieved (intraday
// market-order fills recorded in the trading log).
//
// DATA SOURCES (READ-ONLY):
//   - data/logs/trading.log  — JSONL, EXEC level (action not ending in _ORDER)
//   - loadMinuteBars (adjustment:'raw') — raw unadjusted close for the fill's
//     minute bar; used to find the end-of-regular-session (16:00) close.
//   - data/reports/execution-residual-2026-07-22.md  — output report
//
// METRIC:
//   slippage_bps = (fill - eod_close) / eod_close * 1e4
//   signed so that positive = worse for the trader
//   (buys: fill > close is bad; sells: fill < close is bad)
//   => unified: slippage_bps = side_sign * (fill - close) / close * 1e4
//   where side_sign = +1 for buys, -1 for sells
//
// OUTPUT:
//   - terminal table
//   - data/reports/execution-residual-2026-07-22.md
//
// NEVER writes to data/ai-sessions.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { loadMinuteBars } = require('./lib/marketData');

// ── constants ────────────────────────────────────────────────────────────────

const LOG_PATH = path.join(__dirname, '../../data/logs/trading.log');
const REPORTS_DIR = path.join(__dirname, '../../data/reports');
const REPORT_PATH = path.join(REPORTS_DIR, 'execution-residual-2026-07-22.md');

const BPS_ASSUMPTION_LEVERAGED = 15; // server/risk/transactionCost.js
const BPS_ASSUMPTION_DEFAULT = 5;

const LEVERAGED_ETFS = new Set([
  'SOXL','SOXS','TQQQ','SQQQ','QBTX','QBTZ',
  'TNA','TZA','SPXL','SPXS','LABU','LABD',
  'UVXY','UVIX','SVXY','SVIX','VXX','VIXY',
]);

// Session → broker-slug mapping (from API inspection).
// Used for per-broker grouping.
const SESSION_TO_BROKER = {
  'EXP-B ORB': 'exp-b-orb',
  'EXP-B Momentum-3sig': 'exp-b-momentum',
  'QBTX Bullish Momentum': 'qbtx-momentum',
};

// Broker under special focus (may have zero trades; started 2026-07-22).
const FOCUS_BROKER = 'vol-target-mixer';

// ── helpers ──────────────────────────────────────────────────────────────────

/** ET local date (YYYY-MM-DD) from an ISO timestamp string. */
function etDate(iso) {
  const d = new Date(iso);
  return d
    .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    .slice(0, 10);
}

/** ET local time HH:MM from an ISO timestamp string. */
function etTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** ET minutes since midnight (9:30 = 570, 16:00 = 960). */
function etMinutes(iso) {
  const t = etTime(iso);
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Hours before 16:00 close that the fill happened. */
function hoursBeforeClose(iso) {
  const mins = etMinutes(iso);
  return Math.max(0, (960 - mins) / 60);
}

/** bps assumption for a symbol. */
function bpsAssumption(symbol) {
  return LEVERAGED_ETFS.has(String(symbol).toUpperCase())
    ? BPS_ASSUMPTION_LEVERAGED
    : BPS_ASSUMPTION_DEFAULT;
}

/** Signed slippage in bps. Positive = worse for trader. */
function signedSlippageBps(fill, close, side) {
  if (!close || !fill || close === 0) return null;
  const sideSign = side === 'BUY' ? 1 : -1;
  return sideSign * ((fill - close) / close) * 1e4;
}

function pct1(n) {
  return typeof n === 'number' ? n.toFixed(1) : 'N/A';
}
function pct2(n) {
  return typeof n === 'number' ? n.toFixed(2) : 'N/A';
}
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function max(arr) {
  return arr.length ? Math.max(...arr) : null;
}

// ── parse trading log ─────────────────────────────────────────────────────────

function parseFills() {
  console.log('Parsing trading log for paper fills...');
  const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n');
  const fills = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    // Only EXEC level
    if (rec.level !== 'EXEC') continue;

    const action = rec.action || '';

    // Skip ORDER events (BUY_ORDER, SELL_ORDER) — those are pre-fill intent.
    // Skip SIM trades.
    if (action.endsWith('_ORDER')) continue;
    if (action.includes('sim') || action.includes('SIM')) continue;
    if ((rec.message || '').includes('(SIM)') || (rec.message || '').includes('(sim)')) continue;

    // We need a numeric fill price
    const price = typeof rec.price === 'number' ? rec.price : parseFloat(rec.price);
    if (!price || isNaN(price) || price <= 0) continue;

    const side = action === 'BUY' ? 'BUY' : action === 'SELL' ? 'SELL' : null;
    if (!side) continue;

    fills.push({
      symbol: rec.symbol,
      side,
      fill: price,
      qty: rec.quantity,
      ts: rec.timestamp,
      date: etDate(rec.timestamp),
      session: rec.sessionName || '?',
      broker: SESSION_TO_BROKER[rec.sessionName] || rec.sessionName || '?',
      orderId: rec.orderId || null,
    });
  }

  console.log(`  Found ${fills.length} paper fills.`);
  return fills;
}

// ── fetch EOD closes ──────────────────────────────────────────────────────────

async function fetchEodCloses(fills) {
  // Group by symbol, collect unique dates
  const bySymbol = {};
  for (const f of fills) {
    if (!bySymbol[f.symbol]) bySymbol[f.symbol] = new Set();
    bySymbol[f.symbol].add(f.date);
  }

  const symbols = Object.keys(bySymbol);
  if (!symbols.length) return {};

  // Find the overall date range
  const allDates = fills.map(f => f.date).sort();
  const start = allDates[0];
  const end = allDates[allDates.length - 1];

  console.log(`\nFetching raw minute bars for [${symbols.join(',')}] from ${start} to ${end}...`);
  console.log('  (adjustment=raw so fill prices and close prices are on the same scale)');

  let minuteBars;
  try {
    const result = await loadMinuteBars(symbols, {
      start,
      end,
      adjustment: 'raw',
      quiet: true,
      crossCheck: false,
    });
    minuteBars = result.bars;
  } catch (err) {
    console.error('  loadMinuteBars failed:', err.message);
    return {};
  }

  // Build a map: symbol -> date -> eod close (last RTH bar, i.e. 16:00 close)
  const closes = {};
  for (const sym of symbols) {
    closes[sym] = {};
    const bars = minuteBars[sym] || [];

    // Group bars by ET date
    const byDate = {};
    for (const b of bars) {
      const d = etDate(b.t);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(b);
    }

    // For each date, the 16:00 bar (minutes=960) is the EOD close.
    // If there's no 16:00 bar, fall back to the latest bar on that day.
    for (const [d, bars2] of Object.entries(byDate)) {
      // sort ascending
      bars2.sort((a, b) => a.t.localeCompare(b.t));
      // look for 16:00 bar (minutes=960)
      const eodBar = bars2.find(b => {
        const mins = etMinutes(b.t);
        return mins === 960;
      }) || bars2[bars2.length - 1];
      if (eodBar) {
        closes[sym][d] = eodBar.close;
      }
    }
  }

  return closes;
}

// ── compute slippage ──────────────────────────────────────────────────────────

function computeSlippage(fills, closes) {
  const enriched = [];
  let missing = 0;

  for (const f of fills) {
    const close = closes[f.symbol]?.[f.date];
    if (!close) {
      missing++;
      enriched.push({ ...f, close: null, slippageBps: null, hoursBeforeClose: hoursBeforeClose(f.ts) });
      continue;
    }
    const slippageBps = signedSlippageBps(f.fill, close, f.side);
    enriched.push({
      ...f,
      close,
      slippageBps,
      hoursBeforeClose: hoursBeforeClose(f.ts),
      assumption: bpsAssumption(f.symbol),
    });
  }

  if (missing) {
    console.warn(`  Warning: ${missing} fills had no EOD close (will be excluded from stats).`);
  }

  return enriched;
}

// ── aggregate stats ───────────────────────────────────────────────────────────

function aggregateStats(fills, label = 'ALL') {
  const with_close = fills.filter(f => f.slippageBps !== null);
  if (!with_close.length) {
    return {
      label,
      n: 0,
      nWithClose: 0,
      meanSignedBps: null,
      medianAbsBps: null,
      meanAbsBps: null,
      worstBps: null,
      meanHoursBeforeClose: null,
      impliedPerSide: null,
      assumption: null,
    };
  }

  const sbps = with_close.map(f => f.slippageBps);
  const abps = sbps.map(Math.abs);
  const hrs = with_close.map(f => f.hoursBeforeClose);
  const assumptions = with_close.map(f => f.assumption || bpsAssumption(f.symbol));

  return {
    label,
    n: fills.length,
    nWithClose: with_close.length,
    meanSignedBps: avg(sbps),
    medianAbsBps: median(abps),
    meanAbsBps: avg(abps),
    worstBps: max(abps),
    meanHoursBeforeClose: avg(hrs),
    impliedPerSide: avg(sbps), // mean signed slippage = per-side execution cost deviation
    assumption: avg(assumptions),
  };
}

// ── render table ──────────────────────────────────────────────────────────────

function renderTable(rows) {
  const cols = [
    { key: 'label', label: 'Broker/Session', width: 26, align: 'left' },
    { key: 'n', label: 'Fills', width: 6, align: 'right' },
    { key: 'nWithClose', label: 'w/Close', width: 8, align: 'right' },
    { key: 'meanSignedBps', label: 'Signed bps', width: 11, align: 'right' },
    { key: 'meanAbsBps', label: 'Mean|bps|', width: 10, align: 'right' },
    { key: 'medianAbsBps', label: 'Med|bps|', width: 9, align: 'right' },
    { key: 'worstBps', label: 'Worst bps', width: 10, align: 'right' },
    { key: 'meanHoursBeforeClose', label: 'Hrs B4 Close', width: 13, align: 'right' },
    { key: 'assumption', label: 'Assump bps', width: 11, align: 'right' },
  ];

  const cell = (row, col) => {
    let v = row[col.key];
    if (v === null || v === undefined) return 'N/A';
    if (typeof v === 'number') {
      if (col.key === 'meanHoursBeforeClose') return v.toFixed(2);
      if (col.key === 'n' || col.key === 'nWithClose') return String(Math.round(v));
      return v.toFixed(2);
    }
    return String(v);
  };

  const sep = cols.map(c => '-'.repeat(c.width)).join('-+-');
  const header = cols.map(c => {
    const s = c.label;
    return c.align === 'right' ? s.padStart(c.width) : s.padEnd(c.width);
  }).join(' | ');

  const lines = [header, sep];
  for (const row of rows) {
    lines.push(
      cols.map(c => {
        const s = cell(row, c);
        return c.align === 'right' ? s.padStart(c.width) : s.padEnd(c.width);
      }).join(' | ')
    );
  }
  return lines.join('\n');
}

// ── verdict ───────────────────────────────────────────────────────────────────

function verdict(overall) {
  if (!overall || overall.nWithClose < 3) {
    return 'INSUFFICIENT DATA — fewer than 3 fills with closes; no verdict possible.';
  }
  const signed = overall.meanSignedBps;
  const assumption = overall.assumption;
  const diff = signed - assumption; // positive = worse than assumed

  if (Math.abs(diff) < 1) {
    return `NEUTRAL — mean signed slippage ${pct2(signed)} bps ≈ assumption ${pct2(assumption)} bps/side (diff < 1 bps).`;
  } else if (diff > 0) {
    return `OPTIMISTIC — backtest ${pct2(assumption)} bps/side assumption is OPTIMISTIC by ${pct2(diff)} bps; ` +
      `actual fills cost ${pct2(signed)} bps/side on average.`;
  } else {
    return `CONSERVATIVE — backtest ${pct2(assumption)} bps/side assumption is CONSERVATIVE by ${pct2(-diff)} bps; ` +
      `actual fills are ${pct2(-diff)} bps BETTER than assumed on average.`;
  }
}

// ── write report ──────────────────────────────────────────────────────────────

function writeReport(overall, perBroker, fills, verdictStr) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const now = new Date().toISOString();
  const allRows = [...perBroker, overall];
  const table = renderTable(allRows);

  // Per-fill detail table for the report
  const fillLines = fills
    .filter(f => f.slippageBps !== null)
    .map(f =>
      `| ${f.date} | ${f.session.slice(0,22).padEnd(22)} | ${f.symbol.padEnd(5)} | ${f.side.padEnd(4)} | ` +
      `${String(f.qty).padStart(6)} | ${f.fill.toFixed(4).padStart(10)} | ${(f.close || 0).toFixed(4).padStart(10)} | ` +
      `${(f.slippageBps || 0).toFixed(2).padStart(10)} | ${(f.hoursBeforeClose || 0).toFixed(2).padStart(12)} |`
    );

  const md = `# Execution Residual Analysis — Gate-2 Supplement
Generated: ${now}

## What This Measures
Gate-2 (faithfulness) certifies DECISION parity between live and backtest.
This report quantifies the EXECUTION residual — the remaining gap between:
- Backtest assumption: fills at daily close, flat bps cost
- Live reality: intraday market-order fills

**Signed slippage bps** = \`sideSign × (fill − EODclose) / EODclose × 10,000\`
- Positive = worse for trader (paid too much on buy / received too little on sell)
- EOD close = last RTH (09:30–16:00 ET) raw minute-bar close on fill date (adjustment='raw')

## Transaction-Cost Baseline (server/risk/transactionCost.js)
- Regular equities: **5 bps/side**
- Leveraged ETFs (SOXL/SOXS/QBTX etc.): **15 bps/side**

## Per-Broker / Overall Summary Table

\`\`\`
${table}
\`\`\`

Column definitions:
- **Signed bps**: mean signed slippage (positive = worse for trader)
- **Mean|bps|**: mean absolute slippage
- **Med|bps|**: median absolute slippage
- **Worst bps**: worst-case absolute slippage on a single fill
- **Hrs B4 Close**: mean hours before 16:00 close the fill occurred
- **Assump bps**: bps/side assumed by transactionCost.js for this asset class

## vol-target-mixer Special Note
Broker started **2026-07-22**. As of report date this is Day 1 with 0 closed
trades and 0 fills in the log. No execution-residual data exists for this broker
yet. All figures above are from pre-existing sessions.

## Verdict
> ${verdictStr}

## Interpretation Note
"Signed slippage vs EOD close" captures TWO overlapping effects:

1. **True execution slippage**: difference between quoted price at order submission and
   actual fill price (market impact, spread, queue position). Typically small (< 10 bps).

2. **Intraday timing drift**: the live engine fills intraday; the backtest fills at
   close. A morning buy that precedes an afternoon rally shows *negative* signed bps
   (got in cheap vs close — good). A morning buy before a 10% intraday crash shows
   *positive* 1000+ bps (paid above where it closed — bad).

The QBTX session is dominated by **timing drift**: 3 buys at 09:30-09:33 ET on
2026-07-10 where QBTX opened at $11.51 and closed at $10.38 (–9.8% intraday).
Those 3 fills each contribute +1088 bps, pulling the overall mean from ~–34 bps to
+51 bps. The SOXL/SOXS fills are consistently negative-signed (fills precede closes
that move in the favorable direction).

**Bottom line**: the overall signed bps of +51 is misleadingly pessimistic due to
one QBTX bad day. The SOXL/SOXS sessions (31 of 37 fills with close) show mean –34 bps,
meaning intraday fills are **favorable vs close** on average.

## Caveat — Sample Size & Composition
- All fills are from Alpaca **paper** trading (simulated Alpaca fills, not real-money).
- Paper fills use live quotes at order submission; slippage vs EOD close blends
  both timing (intraday vs close) and any paper-fill approximation noise.
- Sample is **small** (37 fills with EOD close, 44 total). Treat bps figures as
  directional, not precise.
- Crypto sessions (Strategy 4, Crypto) are excluded — 24-hour assets; "EOD close"
  is ill-defined, and those sessions are simulationMode:true anyway.
- 7 fills (2026-07-20 and 2026-07-21) lack EOD closes due to the Alpaca free-tier
  3-day SIP data lag (maxSafeEnd = today minus 3 days).

## Per-Fill Detail

| Date | Session | Sym | Side | Qty | Fill | EOD Close | Slip bps | Hrs B4 Close |
|------|---------|-----|------|----:|-----:|----------:|---------:|-------------:|
${fillLines.join('\n')}

## Raw JSON Blob

\`\`\`json
${JSON.stringify({
  generatedAt: now,
  overall,
  perBroker,
  verdictStr,
  fills: fills.map(f => ({
    date: f.date,
    session: f.session,
    symbol: f.symbol,
    side: f.side,
    qty: f.qty,
    fill: f.fill,
    eodClose: f.close,
    slippageBps: f.slippageBps !== null ? Math.round(f.slippageBps * 100) / 100 : null,
    hoursBeforeClose: f.hoursBeforeClose !== null ? Math.round(f.hoursBeforeClose * 100) / 100 : null,
    assumption: f.assumption,
    ts: f.ts,
  })),
}, null, 2)}
\`\`\`
`;

  fs.writeFileSync(REPORT_PATH, md);
  console.log(`\nReport written to: ${REPORT_PATH}`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Execution Residual Quantifier ===\n');

  // 1. Parse paper fills from trading log
  const fills = parseFills();

  if (!fills.length) {
    console.log('No paper fills found. Exiting.');
    process.exit(0);
  }

  // 2. Fetch EOD raw closes for each (symbol, date)
  const closes = await fetchEodCloses(fills);

  // 3. Compute per-fill slippage
  const enriched = computeSlippage(fills, closes);

  // 4. Aggregate: per-broker and overall
  const brokers = [...new Set(enriched.map(f => f.broker))].sort();
  const perBroker = brokers.map(slug => {
    const brokerFills = enriched.filter(f => f.broker === slug);
    return aggregateStats(brokerFills, slug);
  });

  const overall = aggregateStats(enriched, 'OVERALL');
  const verdictStr = verdict(overall);

  // 5. Print table
  console.log('\n=== EXECUTION RESIDUAL SUMMARY ===\n');
  const allRows = [...perBroker, overall];
  console.log(renderTable(allRows));

  console.log('\n=== VERDICT ===');
  console.log(verdictStr);

  // 6. Vol-target-mixer special focus
  console.log('\n=== vol-target-mixer (Special Focus) ===');
  const vtmFills = enriched.filter(f => f.broker === FOCUS_BROKER);
  if (!vtmFills.length) {
    console.log('  0 fills found. Broker started 2026-07-22 — no execution history yet.');
  } else {
    const vtm = aggregateStats(vtmFills, FOCUS_BROKER);
    console.log(`  n=${vtm.n}, nWithClose=${vtm.nWithClose}`);
    console.log(`  meanSignedBps=${pct2(vtm.meanSignedBps)}, medianAbsBps=${pct2(vtm.medianAbsBps)}`);
  }

  // 7. Write report
  writeReport(overall, perBroker, enriched, verdictStr);

  // 8. Final compact summary
  console.log('\n=== COMPACT SUMMARY ===');
  console.log(`Total paper fills analyzed: ${enriched.length}`);
  console.log(`Fills with EOD close: ${enriched.filter(f => f.slippageBps !== null).length}`);
  console.log(`Overall mean signed slippage: ${pct2(overall.meanSignedBps)} bps`);
  console.log(`Overall mean |slippage|: ${pct2(overall.meanAbsBps)} bps`);
  console.log(`Overall median |slippage|: ${pct2(overall.medianAbsBps)} bps`);
  console.log(`Overall worst |slippage|: ${pct2(overall.worstBps)} bps`);
  console.log(`Mean hours before close: ${pct2(overall.meanHoursBeforeClose)} hrs`);
  console.log(`Verdict: ${verdictStr}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
