#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/morning-brief.js — Generate a markdown summary of yesterday's broker
// activity. Reads data/ai-sessions.json + data/broker-ledger.json directly,
// so it works without the server running.
//
// Usage:
//   npm run brief                    # today's date, write to data/reports/YYYY-MM-DD.md
//   npm run brief -- --date YYYY-MM-DD
//   npm run brief -- --print         # print to stdout, don't write
//
// Wired into the daily EOD cron in server/index.js — runs automatically.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SESSIONS_PATH = path.join(ROOT, 'data', 'ai-sessions.json');
const LEDGER_PATH = path.join(ROOT, 'data', 'broker-ledger.json');
const REPORTS_DIR = path.join(ROOT, 'data', 'reports');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print') args.print = true;
    else if (a === '--date') args.date = argv[++i];
  }
  return args;
}

function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return '$0';
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function loadSessions() {
  if (!fs.existsSync(SESSIONS_PATH)) return {};
  return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return { events: [] };
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  } catch {
    return { events: [] };
  }
}

function summarizeBroker(session, dateStr) {
  const stats = session.stats || {};
  const log = session.tradingLog || [];

  // Trades that happened on this date
  const todayTrades = log.filter(t => t.timestamp?.slice(0, 10) === dateStr);
  const todayClosed = todayTrades.filter(
    t => t.side === 'sell' && typeof t.realizedPnL === 'number'
  );
  const todayPnL = todayClosed.reduce((a, b) => a + b.realizedPnL, 0);
  const todayWins = todayClosed.filter(t => t.realizedPnL >= 0).length;
  const todayLosses = todayClosed.length - todayWins;

  // Open positions right now
  const positions = session.portfolio?.positions || [];
  const openPositions = Array.isArray(positions) ? positions : [];

  // Best / worst trade of the day
  const sorted = [...todayClosed].sort((a, b) => b.realizedPnL - a.realizedPnL);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  return {
    slug: session.config?.brokerSlug,
    name: session.name,
    tier: session.config?.tier || 'simulated',
    cashNow: session.portfolio?.cash,
    todayTradesCount: todayTrades.length,
    todayClosedCount: todayClosed.length,
    todayWins,
    todayLosses,
    todayPnL,
    lifetimePnL: stats.totalPnL || 0,
    lifetimeTrades: stats.totalTrades || 0,
    lifetimeWinRate: stats.winRate || 0,
    maxDrawdownPct: stats.maxDrawdown || 0,
    openPositions,
    best,
    worst,
  };
}

function renderBrief(dateStr, brokerSummaries, ledgerEvents) {
  const lines = [];
  lines.push(`# AI Broker Morning Brief — ${dateStr}`);
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push('');

  // Headline: total P&L today across all brokers
  const totalToday = brokerSummaries.reduce((a, b) => a + b.todayPnL, 0);
  const totalClosed = brokerSummaries.reduce(
    (a, b) => a + b.todayClosedCount,
    0
  );
  lines.push(`## Headline`);
  lines.push('');
  lines.push(
    `**${fmtUsd(totalToday)}** across **${totalClosed}** closed trades today.`
  );
  lines.push('');

  // Tier events
  const todayEvents = ledgerEvents.filter(
    e => e.timestamp?.slice(0, 10) === dateStr
  );
  const tierEvents = todayEvents.filter(e =>
    ['promote', 'demote', 'fire', 'breed'].includes(e.action)
  );
  if (tierEvents.length > 0) {
    lines.push('## Tier changes today');
    lines.push('');
    for (const e of tierEvents) {
      const icon =
        e.action === 'promote'
          ? '⬆️'
          : e.action === 'demote'
            ? '⬇️'
            : e.action === 'fire'
              ? '🔥'
              : e.action === 'breed'
                ? '🌱'
                : '•';
      lines.push(`- ${icon} **${e.slug}** ${e.action}: ${e.reason || ''}`);
    }
    lines.push('');
  }

  // Self-mutation events
  const mutationEvents = todayEvents.filter(e => e.action === 'self-mutation');
  if (mutationEvents.length > 0) {
    lines.push('## Self-mutations today');
    lines.push('');
    for (const e of mutationEvents) {
      const applied = (e.applied || []).length;
      const rejected = (e.rejected || []).length;
      const conf =
        e.confidence != null ? ` conf=${e.confidence.toFixed(2)}` : '';
      lines.push(
        `- **${e.slug}**: ${applied} applied · ${rejected} rejected${conf}`
      );
      if (e.assessment) {
        lines.push(
          `  > ${e.assessment.slice(0, 280)}${e.assessment.length > 280 ? '…' : ''}`
        );
      }
      for (const a of e.applied || []) {
        lines.push(
          `  - \`${a.field}\`: ${JSON.stringify(a.before)} → ${JSON.stringify(a.proposedValue)} — ${a.rationale}`
        );
      }
    }
    lines.push('');
  }

  // Per-broker table
  lines.push('## Brokers');
  lines.push('');
  lines.push(
    '| Broker | Tier | Today P&L | Today W/L | Lifetime P&L | WR | Max DD | Open |'
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  const sorted = [...brokerSummaries].sort((a, b) => b.todayPnL - a.todayPnL);
  for (const b of sorted) {
    lines.push(
      `| ${b.name} | ${b.tier} | ${fmtUsd(b.todayPnL)} | ${b.todayWins}/${b.todayLosses} | ` +
        `${fmtUsd(b.lifetimePnL)} | ${b.lifetimeWinRate.toFixed(0)}% | ` +
        `${b.maxDrawdownPct.toFixed(2)}% | ${b.openPositions.length} |`
    );
  }
  lines.push('');

  // Highlights — best/worst trade of the day across the population
  const allClosed = brokerSummaries
    .flatMap(b => (b.best ? [{ ...b.best, slug: b.slug }] : []))
    .concat(
      brokerSummaries.flatMap(b =>
        b.worst && b.worst !== b.best ? [{ ...b.worst, slug: b.slug }] : []
      )
    );
  const dayBest = allClosed.reduce(
    (a, c) => (!a || c.realizedPnL > a.realizedPnL ? c : a),
    null
  );
  const dayWorst = allClosed.reduce(
    (a, c) => (!a || c.realizedPnL < a.realizedPnL ? c : a),
    null
  );
  if (dayBest || dayWorst) {
    lines.push('## Highlights');
    lines.push('');
    if (dayBest) {
      lines.push(
        `- 🟢 Best: **${dayBest.slug}** ${fmtUsd(dayBest.realizedPnL)} on ${dayBest.symbol} (${fmtPct(dayBest.realizedPct)})`
      );
    }
    if (dayWorst && dayWorst !== dayBest) {
      lines.push(
        `- 🔴 Worst: **${dayWorst.slug}** ${fmtUsd(dayWorst.realizedPnL)} on ${dayWorst.symbol} (${fmtPct(dayWorst.realizedPct)})`
      );
    }
    lines.push('');
  }

  // Open positions across the population
  const allOpen = brokerSummaries.flatMap(b =>
    b.openPositions.map(p => ({ ...p, broker: b.name }))
  );
  if (allOpen.length > 0) {
    lines.push('## Open positions');
    lines.push('');
    lines.push('| Broker | Symbol | Qty | Avg cost | Current | Unreal P&L |');
    lines.push('|---|---|---|---|---|---|');
    for (const p of allOpen) {
      lines.push(
        `| ${p.broker} | ${p.symbol} | ${p.quantity} | $${(p.averageCost || 0).toFixed(2)} | ` +
          `$${(p.currentPrice || 0).toFixed(2)} | ${fmtUsd(p.unrealizedPnL || 0)} |`
      );
    }
    lines.push('');
  }

  if (
    totalClosed === 0 &&
    tierEvents.length === 0 &&
    mutationEvents.length === 0
  ) {
    lines.push('## Nothing happened today');
    lines.push('');
    lines.push(
      'No closed trades, no tier changes, no self-mutations. Server may have been down, ' +
        'markets may have been closed, or entry gates were too strict for the conditions.'
    );
  }

  return lines.join('\n');
}

function generateBrief(dateStr) {
  const sessions = loadSessions();
  const ledger = loadLedger();
  const brokerSessions = Object.values(sessions).filter(
    s => s.userId === 'brokers'
  );
  const summaries = brokerSessions.map(s => summarizeBroker(s, dateStr));
  return renderBrief(dateStr, summaries, ledger.events || []);
}

function main() {
  const args = parseArgs(process.argv);
  const dateStr = args.date || new Date().toISOString().slice(0, 10);
  const brief = generateBrief(dateStr);
  if (args.print) {
    console.log(brief);
    return;
  }
  if (!fs.existsSync(REPORTS_DIR))
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, `${dateStr}.md`);
  fs.writeFileSync(outPath, brief);
  console.log(`✓ Brief written to ${outPath}`);
  console.log(`  (also: npm run brief -- --print to view in terminal)`);
}

if (require.main === module) {
  main();
}

module.exports = { generateBrief };
