#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/daily-summary.js — Capture a structured daily snapshot of the broker
// exchange and append it to a persistent history, so we can track over time
// whether the system is evolving in the right direction.
//
// Unlike morning-brief.js (a human-readable per-broker narrative), this writes
// a machine-readable record to data/daily-history.json keyed by date, with a
// PER-SOURCE breakdown (the whole point of the plugin architecture: which
// signal source actually has edge), the signal funnel, and the edge-gate state.
//
// Reads data/ai-sessions.json + data/broker-ledger.json directly — works
// offline, no server required.
//
// Usage:
//   node scripts/daily-summary.js                # snapshot today → history + markdown
//   node scripts/daily-summary.js --print        # print, don't persist
//   node scripts/daily-summary.js --date 2026-06-02
//   node scripts/daily-summary.js --trend        # show P&L + expectancy over time
//   node scripts/daily-summary.js --trend 30     # last 30 recorded days

const fs = require('fs');
const path = require('path');

// Reuse the canonical edge-gate logic so the daily record and the promotion
// decision never drift apart.
const {
  evaluateEdgeGate,
  EDGE_GATE,
} = require('../server/brokers/tierPromotion');

const ROOT = path.resolve(__dirname, '..');
const SESSIONS_PATH = path.join(ROOT, 'data', 'ai-sessions.json');
const LEDGER_PATH = path.join(ROOT, 'data', 'broker-ledger.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'daily-history.json');
const REPORTS_DIR = path.join(ROOT, 'data', 'reports');
const HISTORY_CAP = 400; // keep ~13 months of daily records

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print') args.print = true;
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--trend') {
      args.trend = true;
      const n = parseInt(argv[i + 1], 10);
      if (Number.isFinite(n)) {
        args.trendDays = n;
        i++;
      }
    }
  }
  return args;
}

// Canonical trading-day key: the Eastern-time calendar date. Market-hours
// trades carry UTC timestamps whose date matches the ET date, so filtering by
// this string against timestamp.slice(0,10) is correct intraday.
const etDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const fmtUsd = n => {
  if (n == null || Number.isNaN(n)) return '$0.00';
  const s = n >= 0 ? '+' : '-';
  return `${s}$${Math.abs(n).toFixed(2)}`;
};
const pct = n => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(3)}%`);

function loadJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

const pnlOf = t =>
  typeof t.realizedPnL === 'number'
    ? t.realizedPnL
    : typeof t.pnl === 'number'
      ? t.pnl
      : null;

// Per-source stats over an arbitrary list of closed (sell) legs.
function sourceStats(legs) {
  const by = {};
  for (const t of legs) {
    const p = pnlOf(t);
    if (p == null) continue;
    const src = t.source || 'unknown';
    const s =
      by[src] ||
      (by[src] = { trades: 0, pnl: 0, wins: 0, pctSum: 0, pctCount: 0 });
    s.trades++;
    s.pnl += p;
    if (p >= 0) s.wins++;
    if (typeof t.realizedPct === 'number') {
      s.pctSum += t.realizedPct;
      s.pctCount++;
    }
  }
  for (const src of Object.keys(by)) {
    const s = by[src];
    s.winRate = s.trades ? s.wins / s.trades : 0;
    s.expectancyPct = s.pctCount ? s.pctSum / s.pctCount : null;
    s.expectancyUsd = s.trades ? s.pnl / s.trades : 0;
    delete s.pctSum;
    delete s.pctCount;
  }
  return by;
}

function closedSellLegs(session) {
  return (session.tradingLog || []).filter(
    t => t && t.side === 'sell' && pnlOf(t) != null
  );
}

function buildRecord(dateStr) {
  const sessions = loadJson(SESSIONS_PATH, {});
  const ledger = loadJson(LEDGER_PATH, { events: [] });
  const brokerSessions = Object.values(sessions).filter(
    s => s.userId === 'brokers'
  );

  const allLegs = [];
  const allTodayLegs = [];
  const brokers = [];

  for (const session of brokerSessions) {
    const stats = session.stats || {};
    const legs = closedSellLegs(session);
    const todayLegs = legs.filter(t => t.timestamp?.slice(0, 10) === dateStr);
    allLegs.push(...legs);
    allTodayLegs.push(...todayLegs);

    const todayPnL = todayLegs.reduce((a, b) => a + (pnlOf(b) || 0), 0);
    const edge = evaluateEdgeGate(session); // primary-source edge gate
    const positions = Array.isArray(session.portfolio?.positions)
      ? session.portfolio.positions
      : [];

    brokers.push({
      slug: session.config?.brokerSlug || session.name,
      name: session.name,
      tier: session.config?.tier || 'simulated',
      strategy: session.config?.strategyKey || session.config?.entryStrategy,
      todayPnL,
      todayClosed: todayLegs.length,
      lifetimePnL: stats.totalPnL || 0,
      lifetimeTrades: stats.totalTrades || 0,
      winRate: stats.winRate || 0,
      maxDrawdownPct: stats.maxDrawdown || 0,
      openPositions: positions.length,
      funnel: {
        evaluated: stats.signalsEvaluated || 0,
        passed: stats.signalsPassed || 0,
        entered: stats.signalsEntered || 0,
      },
      edge: {
        source: edge.source,
        pass: edge.pass,
        trades: edge.trades || 0,
        expectancyPct: edge.expectancyPct ?? null,
        reason: edge.reason,
      },
    });
  }

  // Exchange-wide per-source roll-up (lifetime + today).
  const lifetimeBySource = sourceStats(allLegs);
  const todayBySource = sourceStats(allTodayLegs);
  const sources = {};
  for (const src of new Set([
    ...Object.keys(lifetimeBySource),
    ...Object.keys(todayBySource),
  ])) {
    const lt = lifetimeBySource[src] || {};
    const td = todayBySource[src] || {};
    sources[src] = {
      lifetimePnL: lt.pnl || 0,
      lifetimeTrades: lt.trades || 0,
      lifetimeWinRate: lt.winRate ?? null,
      expectancyPct: lt.expectancyPct ?? null,
      todayPnL: td.pnl || 0,
      todayTrades: td.trades || 0,
      // Same bar the promotion gate uses, applied to this source exchange-wide.
      edgeReady:
        (lt.trades || 0) >= EDGE_GATE.minTrades &&
        (lt.expectancyPct ?? -1) > EDGE_GATE.minExpectancyPct,
    };
  }

  const todayEvents = (ledger.events || []).filter(
    e => e.timestamp?.slice(0, 10) === dateStr
  );

  return {
    date: dateStr,
    generatedAt: new Date().toISOString(),
    exchange: {
      todayPnL: allTodayLegs.reduce((a, b) => a + (pnlOf(b) || 0), 0),
      todayClosed: allTodayLegs.length,
      lifetimePnL: brokers.reduce((a, b) => a + b.lifetimePnL, 0),
      brokerCount: brokers.length,
      byTier: brokers.reduce((m, b) => {
        m[b.tier] = (m[b.tier] || 0) + 1;
        return m;
      }, {}),
    },
    sources,
    brokers,
    tierEvents: todayEvents.filter(e =>
      ['promote', 'demote', 'fire', 'breed'].includes(e.action)
    ),
    mutations: todayEvents
      .filter(e => e.action === 'self-mutation')
      .map(e => ({
        slug: e.slug,
        applied: (e.applied || []).length,
        rejected: (e.rejected || []).length,
      })),
  };
}

function upsertHistory(record) {
  const history = loadJson(HISTORY_PATH, []);
  const arr = Array.isArray(history) ? history : [];
  const next = arr.filter(r => r.date !== record.date);
  next.push(record);
  next.sort((a, b) => a.date.localeCompare(b.date));
  const capped = next.slice(-HISTORY_CAP);
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  const tmp = `${HISTORY_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(capped, null, 2));
  fs.renameSync(tmp, HISTORY_PATH);
  return capped;
}

function renderMarkdown(rec) {
  const L = [];
  L.push(`# Daily Summary — ${rec.date}`, '');
  L.push(`_Generated ${rec.generatedAt}_`, '');
  L.push('## Exchange');
  L.push('');
  L.push(
    `**${fmtUsd(rec.exchange.todayPnL)}** today across **${rec.exchange.todayClosed}** closed trades · ` +
      `lifetime **${fmtUsd(rec.exchange.lifetimePnL)}** · ${rec.exchange.brokerCount} brokers ` +
      `(${Object.entries(rec.exchange.byTier)
        .map(([t, n]) => `${n} ${t}`)
        .join(', ')})`
  );
  L.push('');

  L.push('## By signal source');
  L.push('');
  L.push(
    '| Source | Today P&L | Today # | Lifetime P&L | Trades | Expectancy/trade | Edge? |'
  );
  L.push('|---|---|---|---|---|---|---|');
  const srcRows = Object.entries(rec.sources).sort(
    (a, b) => b[1].lifetimePnL - a[1].lifetimePnL
  );
  for (const [src, s] of srcRows) {
    L.push(
      `| ${src} | ${fmtUsd(s.todayPnL)} | ${s.todayTrades} | ${fmtUsd(s.lifetimePnL)} | ` +
        `${s.lifetimeTrades} | ${pct(s.expectancyPct)} | ${s.edgeReady ? '✅' : '—'} |`
    );
  }
  L.push('');

  L.push('## Brokers');
  L.push('');
  L.push(
    '| Broker | Tier | Source | Today | Lifetime | Trades | WR | Funnel e/p/x | Edge |'
  );
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const b of [...rec.brokers].sort((a, c) => c.todayPnL - a.todayPnL)) {
    const f = b.funnel;
    const edge = b.edge.pass
      ? `✅ ${pct(b.edge.expectancyPct)}`
      : `— ${b.edge.trades}/${EDGE_GATE.minTrades}`;
    L.push(
      `| ${b.name} | ${b.tier} | ${b.strategy || '—'} | ${fmtUsd(b.todayPnL)} | ` +
        `${fmtUsd(b.lifetimePnL)} | ${b.lifetimeTrades} | ${b.winRate.toFixed(0)}% | ` +
        `${f.evaluated}/${f.passed}/${f.entered} | ${edge} |`
    );
  }
  L.push('');

  if (rec.tierEvents.length) {
    L.push('## Tier changes', '');
    for (const e of rec.tierEvents)
      L.push(`- **${e.slug}** ${e.action}: ${e.reason || ''}`);
    L.push('');
  }
  if (rec.mutations.length) {
    L.push('## Self-mutations', '');
    for (const m of rec.mutations)
      L.push(`- **${m.slug}**: ${m.applied} applied · ${m.rejected} rejected`);
    L.push('');
  }
  return L.join('\n');
}

function printSummary(rec) {
  console.log(`\n📊 Daily Summary — ${rec.date}`);
  console.log(
    `   Exchange: ${fmtUsd(rec.exchange.todayPnL)} today / ${fmtUsd(rec.exchange.lifetimePnL)} lifetime · ${rec.exchange.todayClosed} closed today`
  );
  console.log('\n   By source (lifetime):');
  const rows = Object.entries(rec.sources).sort(
    (a, b) => b[1].lifetimePnL - a[1].lifetimePnL
  );
  if (!rows.length) console.log('     (no closed trades yet)');
  for (const [src, s] of rows) {
    console.log(
      `     ${src.padEnd(20)} ${fmtUsd(s.lifetimePnL).padStart(12)}  ` +
        `${String(s.lifetimeTrades).padStart(4)} trades  exp ${pct(s.expectancyPct).padStart(9)}  ${s.edgeReady ? 'EDGE✅' : ''}`
    );
  }
}

function renderTrend(days) {
  const history = loadJson(HISTORY_PATH, []);
  const arr = (Array.isArray(history) ? history : []).slice(-(days || 14));
  if (!arr.length) {
    console.log('No history yet. Run a daily snapshot first (npm run daily).');
    return;
  }
  console.log(`\n📈 Trend — last ${arr.length} recorded day(s)\n`);
  console.log('   Exchange P&L by day (today / lifetime):');
  for (const r of arr) {
    console.log(
      `     ${r.date}  today ${fmtUsd(r.exchange.todayPnL).padStart(12)}   lifetime ${fmtUsd(r.exchange.lifetimePnL).padStart(12)}  (${r.exchange.todayClosed} closed)`
    );
  }
  // Per-source expectancy evolution — the real question: is any source's edge improving?
  const srcs = new Set();
  arr.forEach(r => Object.keys(r.sources || {}).forEach(s => srcs.add(s)));
  console.log('\n   Per-source lifetime expectancy/trade over time:');
  for (const src of srcs) {
    const series = arr
      .map(r => {
        const s = r.sources?.[src];
        return s && s.expectancyPct != null
          ? `${r.date.slice(5)}:${pct(s.expectancyPct)}`
          : null;
      })
      .filter(Boolean);
    if (series.length)
      console.log(`     ${src.padEnd(20)} ${series.join('  ')}`);
  }
  console.log('');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.trend) return renderTrend(args.trendDays);

  const dateStr = args.date || etDate();
  const rec = buildRecord(dateStr);

  if (args.print) {
    printSummary(rec);
    return;
  }
  upsertHistory(rec);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const mdPath = path.join(REPORTS_DIR, `daily-${dateStr}.md`);
  fs.writeFileSync(mdPath, renderMarkdown(rec));
  printSummary(rec);
  console.log(`\n✓ Record appended to data/daily-history.json`);
  console.log(`✓ Markdown written to ${mdPath}`);
  console.log(`  (trend over time: npm run trend)`);
}

if (require.main === module) main();

module.exports = { buildRecord, upsertHistory, renderMarkdown };
