#!/usr/bin/env node
// Live trading dashboard — refreshes every 5s, no external deps.
// Run: node scripts/dashboard.js
// Stop: Ctrl-C

const fs = require('fs');
const path = require('path');

const API_BASE = process.env.DASHBOARD_API || 'http://localhost:8080';
const USER_ID = process.env.DASHBOARD_USER || 'default_user';
const LOG_PATH = path.join(__dirname, '..', 'data', 'logs', 'trading.log');
const REFRESH_MS = 5000;
const LOG_TAIL_BYTES = 200_000;
const ONCE = process.argv.includes('--once');
const USE_COLOR = process.stdout.isTTY && !process.argv.includes('--no-color');

const C = USE_COLOR ? {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m',
  bgBlue: '\x1b[44m', bgGreen: '\x1b[42m', bgRed: '\x1b[41m',
} : new Proxy({}, { get: () => '' });
const clearScreen = USE_COLOR ? '\x1b[2J\x1b[H' : '\n\n';

function pnl(n) {
  if (n == null || isNaN(n)) return C.gray + '   --   ' + C.reset;
  const sign = n >= 0 ? '+' : '';
  const color = n >= 0 ? C.green : C.red;
  return color + sign + '$' + n.toFixed(2).padStart(7) + C.reset;
}
function pad(s, n, right = false) {
  s = String(s ?? '');
  if (s.length >= n) return s.slice(0, n);
  const padding = ' '.repeat(n - s.length);
  return right ? padding + s : s + padding;
}
function fmtTime(iso) {
  if (!iso) return '--:--:--';
  return new Date(iso).toISOString().slice(11, 19);
}
function etNow() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const isDST = (() => {
    const m = now.getUTCMonth();
    return m >= 2 && m <= 10;
  })();
  const offset = isDST ? 4 : 5;
  let hr = utcHour - offset;
  if (hr < 0) hr += 24;
  return `${String(hr).padStart(2, '0')}:${String(utcMin).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
}
function marketPhase() {
  const now = new Date();
  const isDST = (now.getUTCMonth() >= 2 && now.getUTCMonth() <= 10);
  const offset = isDST ? 4 : 5;
  let etHr = now.getUTCHours() - offset;
  if (etHr < 0) etHr += 24;
  const etMin = now.getUTCMinutes();
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6) return { label: 'WEEKEND', color: C.gray };
  const totalMin = etHr * 60 + etMin;
  if (totalMin < 4 * 60) return { label: 'OVERNIGHT', color: C.gray };
  if (totalMin < 9 * 60 + 30) return { label: 'PRE-MARKET', color: C.yellow };
  if (totalMin < 16 * 60) return { label: 'OPEN', color: C.green };
  if (totalMin < 20 * 60) return { label: 'AFTER-HOURS', color: C.yellow };
  return { label: 'OVERNIGHT', color: C.gray };
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return { __error: err.message };
  }
}

function readLogTail() {
  try {
    const stat = fs.statSync(LOG_PATH);
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
    const fd = fs.openSync(LOG_PATH, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
    if (start > 0) lines.shift();
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

function countFiltersFiredToday(logs) {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  let f1 = 0, f2 = 0, both = 0;
  for (const l of logs) {
    if (!l.timestamp?.startsWith(todayPrefix)) continue;
    if (!l.message?.includes('Hard filter blocked entry')) continue;
    const reason = l.reason || '';
    if (reason === 'F1+F2') both++;
    else if (reason === 'F1') f1++;
    else if (reason === 'F2') f2++;
  }
  return { f1, f2, both };
}

function recentNotableLogs(logs, n = 8) {
  const notable = logs.filter(l => {
    const m = l.message || '';
    if (l.level === 'SIGNAL' || l.level === 'RISK') return true;
    if (/Portfolio synced|Analyzing \d+ symbols/.test(m)) return false;
    return /BUY|SELL|EXIT|signal|filter blocked|Counter-trend|circuit|Cannot enter|Skipping|Cooldown/i.test(m);
  });
  // Collapse consecutive identical messages
  const collapsed = [];
  for (const l of notable) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.message === l.message && last.level === l.level) {
      last.count = (last.count || 1) + 1;
      last.lastTimestamp = l.timestamp;
    } else {
      collapsed.push({ ...l, count: 1, lastTimestamp: l.timestamp });
    }
  }
  return collapsed.slice(-n);
}

function render(state) {
  const out = [];
  const phase = marketPhase();

  // Header
  const title = ' EXP-B LIVE DASHBOARD ';
  const time = `  ${etNow()} ET   MARKET: ${phase.color}${phase.label}${C.reset}  `;
  out.push(C.bold + C.cyan + title + C.reset + C.dim + time + C.reset);
  out.push(C.dim + '─'.repeat(76) + C.reset);
  out.push('');

  // Account
  if (state.account?.__error) {
    out.push(C.red + `  API unreachable: ${state.account.__error}` + C.reset);
  } else if (state.account?.account) {
    const a = state.account.account;
    const fmt = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    out.push(C.bold + 'ACCOUNT' + C.reset + C.dim + ` (Alpaca ${state.account.mode || 'paper'})` + C.reset);
    out.push(`  Portfolio ${C.green}$${fmt(a.portfolio_value)}${C.reset}` +
             `   Cash $${fmt(a.cash)}` +
             `   BP $${fmt(a.buying_power)}` +
             `   Status: ${a.status === 'ACTIVE' ? C.green : C.red}${a.status}${C.reset}`);
  }
  out.push('');

  // Sessions
  out.push(C.bold + 'SESSIONS' + C.reset);
  out.push(C.gray + '  Name                       Status      W   L   Win%       P&L' + C.reset);
  for (const s of state.sessions || []) {
    const statusColor = s.status === 'running' ? C.green : (s.status === 'paused' ? C.yellow : C.gray);
    const statusBox = statusColor + pad(s.status, 9) + C.reset;
    out.push(`  ${pad(s.name, 26)} ${statusBox} ${pad(s.stats?.wins ?? '-', 3, true)} ${pad(s.stats?.losses ?? '-', 3, true)}  ${pad((s.stats?.winRate ?? 0).toFixed(1) + '%', 6, true)}  ${pnl(s.stats?.totalPnL)}`);
  }
  out.push('');

  // Open positions
  out.push(C.bold + 'OPEN POSITIONS' + C.reset);
  const allPositions = (state.sessions || []).flatMap(s => (s.openPositions || []).map(p => ({ ...p, sessionName: s.name })));
  if (allPositions.length === 0) {
    out.push(C.gray + '  (none)' + C.reset);
  } else {
    out.push(C.gray + '  Symbol    Qty    Avg Cost   Current     Unrlz P&L      Session' + C.reset);
    for (const p of allPositions) {
      out.push(`  ${pad(p.symbol, 8)}  ${pad(p.quantity, 5, true)}  $${pad((+p.averageCost).toFixed(2), 7, true)}  $${pad((+p.currentPrice).toFixed(2), 7, true)}    ${pnl(+p.unrealizedPnL)}    ${C.dim}${p.sessionName}${C.reset}`);
    }
  }
  out.push('');

  // Filter activity
  const f = state.filterCounts || { f1: 0, f2: 0, both: 0 };
  const total = f.f1 + f.f2 + f.both;
  const filterColor = total > 0 ? C.green : C.gray;
  out.push(C.bold + 'F1/F2 HARD FILTERS (today)' + C.reset);
  out.push(`  ${filterColor}F1 fires: ${f.f1}   F2 fires: ${f.f2}   F1+F2: ${f.both}   Total: ${total}${C.reset}` +
           (total === 0 ? C.dim + '   (no counter-trend entries reached the gate)' + C.reset : ''));
  out.push('');

  // Recent decisions per session (last 1 each)
  out.push(C.bold + 'LATEST DECISIONS' + C.reset);
  for (const s of state.sessions || []) {
    if (s.status === 'paused') continue;
    const last = s.recentDecisions?.[s.recentDecisions.length - 1];
    if (!last) {
      out.push(`  ${C.dim}${pad(s.name, 26)} (no decisions yet)${C.reset}`);
      continue;
    }
    const actionColor = last.action === 'BUY' ? C.green : (last.action === 'SELL' ? C.red : C.yellow);
    out.push(`  ${pad(s.name, 26)} ${actionColor}${pad(last.action, 5)}${C.reset} ${pad(last.symbol, 6)} $${pad((+last.currentPrice).toFixed(2), 8, true)}  conf:${last.confidence}  ${C.dim}${fmtTime(last.timestamp)}${C.reset}`);
  }
  out.push('');

  // Recent log activity
  out.push(C.bold + 'RECENT ACTIVITY' + C.reset);
  if ((state.notableLogs || []).length === 0) {
    out.push(C.gray + '  (no recent BUY/SELL/SIGNAL/RISK events)' + C.reset);
  } else {
    for (const l of state.notableLogs.slice(-8)) {
      const lvl = l.level || 'INFO';
      const lvlColor = lvl === 'RISK' ? C.red : (lvl === 'SIGNAL' ? C.green : C.gray);
      const t = fmtTime(l.timestamp);
      const msg = (l.message || '').slice(0, 80);
      const repeat = l.count > 1
        ? C.cyan + ` (×${l.count} thru ${fmtTime(l.lastTimestamp)})` + C.reset
        : '';
      out.push(`  ${C.dim}${t}${C.reset} ${lvlColor}${pad(lvl, 6)}${C.reset} ${msg}${repeat}`);
    }
  }
  out.push('');

  out.push(C.dim + `─ refresh every ${REFRESH_MS / 1000}s ─ ctrl-c to exit ─` + C.reset);
  return out.join('\n');
}

async function tick() {
  const [account, sessionsResp] = await Promise.all([
    fetchJSON(`${API_BASE}/api/alpaca/account`),
    fetchJSON(`${API_BASE}/api/ai/sessions/${USER_ID}`),
  ]);

  const logs = readLogTail();
  const state = {
    account,
    sessions: (sessionsResp?.sessions || []).filter(s => s.name?.startsWith('EXP-B')),
    filterCounts: countFiltersFiredToday(logs),
    notableLogs: recentNotableLogs(logs, 8),
  };

  process.stdout.write(clearScreen + render(state));
}

(async () => {
  if (ONCE) {
    await tick();
    process.exit(0);
  }
  console.log('Starting dashboard...');
  await tick();
  setInterval(tick, REFRESH_MS);
})();
