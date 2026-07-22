#!/usr/bin/env node
// scripts/monitor.js
//
// Live monitor for AI trading sessions + broker agents — one screen showing
// everything happening right now: status, P&L, positions, last decision.
//
//   npm run monitor              # live view, refreshes every 5s (Ctrl-C to quit)
//   npm run monitor -- --once    # single snapshot (good for logs / a quick check)
//   MONITOR_URL=http://host:port npm run monitor
//
// Reads only the read-only APIs the web dashboard uses — never places or
// changes a trade. Safe to leave running.

const http = require('http');
const { URL } = require('url');

const BASE = process.env.MONITOR_URL || 'http://localhost:8080';
const USER = process.env.MONITOR_USER || 'default_user';
const ONCE = process.argv.includes('--once') || process.argv.includes('-1');
const INTERVAL = Number(process.env.MONITOR_INTERVAL || 5000);

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m', mag: '\x1b[35m',
};

function getJson(path) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(BASE + path); } catch (e) { return resolve({ __error: e.message }); }
    const req = http.get(u, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ __error: 'bad JSON' }); }
      });
    });
    req.on('error', (e) => resolve({ __error: e.message }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ __error: 'timeout' }); });
  });
}

const pad = (s, w) => { s = String(s); return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length); };
const padL = (s, w) => { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; };
const pnlOf = (st) => (st && (st.totalPnLWithUnrealized != null ? st.totalPnLWithUnrealized : st.totalPnL)) || 0;

function moneyCell(n, w) {
  n = Math.round(n || 0);
  const s = (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString();
  return (n >= 0 ? c.green : c.red) + padL(s, w) + c.reset;
}

function statusCell(status, w) {
  const label =
    status === 'running' ? '● running' :
    status === 'paused' ? '❚❚ paused' :
    '○ ' + (status || '—');
  const col = status === 'running' ? c.green : status === 'paused' ? c.yellow : c.gray;
  return col + pad(label, w) + c.reset;
}

function lastDecision(s) {
  const arr = s.recentDecisions || [];
  const d = arr[arr.length - 1];
  if (!d) return c.gray + '—' + c.reset;
  const act = d.action || d.decision || d.type || d.signal || '?';
  const sym = d.symbol ? ' ' + d.symbol : '';
  return pad((String(act) + sym).slice(0, 22), 22);
}

function marketState(etDate) {
  // etDate is a Date rendered in ET; derive weekday + minutes-of-day.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(etDate);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wd = get('weekday');
  const min = Number(get('hour')) * 60 + Number(get('minute'));
  const weekday = !['Sat', 'Sun'].includes(wd);
  const open = weekday && min >= 570 && min < 960; // 9:30–16:00 ET
  return open ? c.green + 'OPEN' + c.reset : c.gray + 'closed' + c.reset;
}

async function render() {
  const [sj, bj] = await Promise.all([
    getJson('/api/ai/sessions/' + USER),
    getJson('/api/brokers'),
  ]);

  const now = new Date();
  const et = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const out = [];
  out.push('');
  out.push('  ' + c.bold + 'TRADING MONITOR' + c.reset +
    c.gray + '   ' + et + ' ET   market ' + c.reset + marketState(now) +
    c.gray + '   ' + BASE + c.reset);
  out.push('');

  // ---- AI sessions ----
  out.push('  ' + c.cyan + c.bold + 'AI SESSIONS' + c.reset);
  if (sj.__error) {
    out.push('  ' + c.red + 'unreachable: ' + sj.__error + c.reset + c.gray + '  (server down? npm run server-dev)' + c.reset);
  } else {
    const sessions = (sj.sessions || []).slice().sort((a, b) => pnlOf(b.stats) - pnlOf(a.stats));
    out.push('  ' + c.gray + pad('NAME', 24) + pad('STATUS', 11) + padL('P&L', 10) + padL('WIN%', 7) + padL('POS', 5) + padL('TRD', 5) + '  ' + 'LAST DECISION' + c.reset);
    let total = 0;
    for (const s of sessions) {
      const st = s.stats || {};
      const p = pnlOf(st); total += p;
      const posCount = s.positionCount != null ? s.positionCount : (s.openPositions || []).length;
      out.push('  ' +
        pad(s.name, 24) +
        statusCell(s.status, 11) +
        moneyCell(p, 10) +
        padL((st.winRate != null ? st.winRate : '—') + '%', 7) +
        padL(posCount, 5) +
        padL(st.totalTrades || 0, 5) + '  ' +
        lastDecision(s));
    }
    out.push('  ' + c.gray + '─'.repeat(64) + c.reset);
    out.push('  ' + pad('NET (all sessions)', 24) + pad('', 11) + moneyCell(total, 10));
  }
  out.push('');

  // ---- broker agents ----
  out.push('  ' + c.mag + c.bold + 'BROKER AGENTS' + c.reset);
  if (bj.__error) {
    out.push('  ' + c.red + 'unreachable: ' + bj.__error + c.reset);
  } else {
    const brokers = bj.brokers || [];
    out.push('  ' + c.gray + pad('NAME', 20) + pad('TIER', 11) + pad('STRATEGY', 24) + pad('STATUS', 11) + padL('P&L', 10) + c.reset);
    for (const b of brokers) {
      const sess = b.session || {};
      const st = sess.stats || {};
      const tierCol = b.tier === 'paper' ? c.cyan : b.tier === 'live' ? c.red : c.gray;
      out.push('  ' +
        pad(b.name, 20) +
        tierCol + pad(b.tier || '—', 11) + c.reset +
        pad(b.strategy || '—', 24) +
        statusCell(sess.status, 11) +
        moneyCell(pnlOf(st), 10));
    }
  }
  out.push('');
  if (!ONCE) out.push('  ' + c.gray + 'refreshing every ' + INTERVAL / 1000 + 's — Ctrl-C to quit' + c.reset);

  return out.join('\n');
}

async function loop() {
  const frame = await render();
  if (ONCE) { console.log(frame); return; }
  process.stdout.write('\x1b[H\x1b[2J' + frame + '\n');
  setTimeout(loop, INTERVAL);
}

process.on('SIGINT', () => { process.stdout.write(c.reset + '\n'); process.exit(0); });
loop();
