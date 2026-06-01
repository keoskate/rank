#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/exchange.js — Terminal "Exchange Floor" for AI Broker Agents.
//
// Connects to the running server via socket.io for live trading_log and
// trade_executed events, and polls /api/brokers every 2s for portfolio + P&L
// snapshots. Renders a blessed TUI with a leaderboard, per-agent log stream,
// and a regime/positions detail panel.
//
// Usage:
//   npm run exchange [-- --host http://localhost:8080]
//
// Non-TTY fallback: prints JSON lines (one /api/brokers snapshot per 2s) so
// the output can be piped to `jq` or appended to a log file.

const blessed = require('blessed');
const io = require('socket.io-client');
const http = require('http');

const HOST = process.env.EXCHANGE_HOST || 'http://localhost:8080';
const POLL_MS = 2000;
const MAX_LOG_LINES = 500;

// ---------- helpers ----------

function fetchBrokers(host) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/brokers', host);
    const req = http.get(url, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
  });
}

function color(text, c) {
  return `{${c}-fg}${text}{/${c}-fg}`;
}

function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Number(n);
  const sign = v >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(v).toFixed(0).padStart(6)}`;
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function totalPnL(broker) {
  const s = broker.session?.stats || {};
  return (s.totalPnL || 0) + (s.unrealizedPnL || 0);
}

function regimeBadge(state) {
  switch (state) {
    case 'low-entropy':
      return color('LOW ', 'green');
    case 'high-entropy':
      return color('HIGH', 'magenta');
    case 'transitioning':
      return color('TRNS', 'yellow');
    case 'neutral':
      return color('NEUT', 'gray');
    case 'unknown':
      return color('UNK ', 'gray');
    default:
      return '—   ';
  }
}

function tierBadge(tier) {
  if (tier === 'paper') return color('paper', 'cyan');
  return color('sim  ', 'gray');
}

// ---------- non-TTY fallback ----------

if (!process.stdout.isTTY) {
  console.log(
    `# exchange floor — non-TTY mode, polling ${HOST}/api/brokers every ${POLL_MS}ms`
  );
  const tick = async () => {
    try {
      const j = await fetchBrokers(HOST);
      console.log(JSON.stringify({ t: Date.now(), brokers: j.brokers }));
    } catch (err) {
      console.error(JSON.stringify({ t: Date.now(), error: err.message }));
    }
  };
  tick();
  setInterval(tick, POLL_MS);
  // Stop here — the rest of the file is TTY-only. We can't use `return` at
  // module scope, so we throw an empty error and catch it implicitly via the
  // `if/else` guarding all subsequent code paths.
} else {
  startTtyUI();
}

function startTtyUI() {
  // ---------- blessed UI ----------

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'Exchange Floor',
    dockBorders: true,
  });

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    tags: true,
    content: ` {bold}EXCHANGE FLOOR{/bold}   host=${HOST}   {gray-fg}↑/↓ select · l log · p positions · q quit{/gray-fg}`,
    style: { bg: 'blue', fg: 'white' },
  });

  const leaderboard = blessed.listtable({
    parent: screen,
    top: 1,
    left: 0,
    right: 0,
    height: '40%',
    keys: true,
    mouse: true,
    vi: true,
    tags: true,
    align: 'left',
    border: 'line',
    label: ' Brokers ',
    style: {
      header: { bold: true, fg: 'white', bg: 'black' },
      cell: { fg: 'white' },
      selected: { bg: 'blue', fg: 'white', bold: true },
      border: { fg: 'gray' },
    },
  });

  const logPane = blessed.log({
    parent: screen,
    top: '40%',
    left: 0,
    width: '60%',
    bottom: 0,
    label: ' Log (selected broker) ',
    tags: true,
    border: 'line',
    scrollback: MAX_LOG_LINES,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { inverse: true } },
    style: { fg: 'white', border: { fg: 'gray' } },
  });

  const detail = blessed.box({
    parent: screen,
    top: '40%',
    left: '60%',
    right: 0,
    bottom: 0,
    label: ' Regime & Positions ',
    tags: true,
    border: 'line',
    style: { fg: 'white', border: { fg: 'gray' } },
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
  });

  const status = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    right: 0,
    height: 0, // hidden until we want it
  });

  // ---------- state ----------

  let brokers = [];
  let selectedSlug = null;
  const logs = new Map(); // slug → array of formatted log lines

  function ensureLogBuf(slug) {
    if (!logs.has(slug)) logs.set(slug, []);
    return logs.get(slug);
  }

  function appendLog(slug, line) {
    const buf = ensureLogBuf(slug);
    buf.push(line);
    if (buf.length > MAX_LOG_LINES) buf.splice(0, buf.length - MAX_LOG_LINES);
    if (slug === selectedSlug) {
      logPane.log(line);
    }
  }

  function renderLeaderboard() {
    const rows = [
      [
        'BROKER',
        'TIER',
        'STRATEGY',
        'P&L',
        'TRADES',
        'WR%',
        'FUNNEL',
        'POS',
        'CASH',
        'REGIME',
      ],
    ];
    for (const b of brokers) {
      const stats = b.session?.stats || {};
      const cash = b.session?.portfolio?.cash;
      const pnl = totalPnL(b);
      const pnlCell =
        pnl >= 0 ? color(fmtUsd(pnl), 'green') : color(fmtUsd(pnl), 'red');
      const positionsCount = b.session?.portfolio?.positionsCount || 0;
      const wrCell =
        stats.totalTrades && stats.totalTrades > 0
          ? `${(stats.winRate || 0).toFixed(0)}%`
          : '—';
      // Signal funnel: evaluated / passed / entered (entry-eval breakdown)
      const funnelCell = `${stats.signalsEvaluated || 0}/${stats.signalsPassed || 0}/${stats.signalsEntered || 0}`;
      rows.push([
        b.name || b.slug,
        tierBadge(b.tier),
        b.strategy || '—',
        pnlCell,
        String(stats.totalTrades || 0).padStart(4),
        wrCell.padStart(4),
        funnelCell.padStart(8),
        String(positionsCount).padStart(2),
        cash != null ? `$${cash.toFixed(0)}` : '—',
        regimeBadge(b.session?.regimeState?.state),
      ]);
    }
    leaderboard.setData(rows);
    // Maintain selection across redraws
    if (selectedSlug) {
      const idx = brokers.findIndex(b => b.slug === selectedSlug);
      if (idx >= 0) leaderboard.select(idx + 1); // +1 for header row
    } else if (brokers[0]) {
      selectedSlug = brokers[0].slug;
      leaderboard.select(1);
    }
  }

  function renderDetail() {
    const b = brokers.find(x => x.slug === selectedSlug);
    if (!b) {
      detail.setContent('{gray-fg}no broker selected{/gray-fg}');
      return;
    }
    const reg = b.session?.regimeState || {};
    const portfolio = b.session?.portfolio || {};
    const stats = b.session?.stats || {};
    const open = b.session?.openPositions || [];

    const lines = [];
    lines.push(`{bold}${b.name}{/bold}  ${tierBadge(b.tier)}`);
    lines.push(`strategy: ${b.strategy}`);
    lines.push(`watchlist: ${(b.watchlist || []).join(', ')}`);
    lines.push('');
    lines.push('{bold}Regime{/bold}');
    if (reg.state) {
      lines.push(`  state:    ${regimeBadge(reg.state)} (${reg.state})`);
      lines.push(`  normH:    ${(reg.normH || 0).toFixed(3)} / 1.000`);
      lines.push(`  ΔH:       ${(reg.deltaH || 0).toFixed(3)}`);
      lines.push(`  conf:     ${(reg.confidence || 0).toFixed(2)}`);
    } else {
      lines.push(
        '  {gray-fg}no regime data yet — waiting for first signal{/gray-fg}'
      );
    }
    lines.push('');
    lines.push('{bold}Portfolio{/bold}');
    lines.push(`  cash:     $${(portfolio.cash || 0).toFixed(2)}`);
    lines.push(`  initial:  $${(portfolio.initialValue || 0).toFixed(2)}`);
    lines.push(
      `  realized: ${color(fmtUsd(stats.totalPnL), stats.totalPnL >= 0 ? 'green' : 'red')}`
    );
    lines.push(
      `  unreal:   ${color(fmtUsd(stats.unrealizedPnL), stats.unrealizedPnL >= 0 ? 'green' : 'red')}`
    );
    lines.push(`  peak:     $${(stats.peakValue || 0).toFixed(0)}`);
    lines.push(`  maxDD:    ${fmtPct(stats.maxDrawdown)}`);
    lines.push('');
    lines.push(`{bold}Open Positions (${open.length}){/bold}`);
    if (open.length === 0) {
      lines.push('  {gray-fg}none{/gray-fg}');
    } else {
      for (const p of open) {
        const pnlC = (p.unrealizedPnL || 0) >= 0 ? 'green' : 'red';
        lines.push(
          `  ${p.symbol.padEnd(6)} qty=${String(p.quantity).padStart(3)}  px=$${(p.currentPrice || 0).toFixed(2)}  ${color(fmtUsd(p.unrealizedPnL), pnlC)} ${color(fmtPct(p.unrealizedPnLPercent), pnlC)}`
        );
      }
    }

    detail.setContent(lines.join('\n'));
  }

  function selectSlug(slug) {
    selectedSlug = slug;
    logPane.setLabel(` Log (${slug}) `);
    logPane.setContent('');
    const buf = ensureLogBuf(slug);
    for (const line of buf) logPane.log(line);
    renderDetail();
    screen.render();
  }

  function rerender() {
    renderLeaderboard();
    renderDetail();
    screen.render();
  }

  // ---------- polling ----------

  async function pollBrokers() {
    try {
      const j = await fetchBrokers(HOST);
      brokers = j.brokers || [];
      if (!selectedSlug && brokers[0]) selectedSlug = brokers[0].slug;
      rerender();
    } catch (err) {
      header.setContent(
        ` {bold}EXCHANGE FLOOR{/bold}   {red-fg}offline (${err.message}){/red-fg}   reconnecting…`
      );
      screen.render();
    }
  }

  pollBrokers();
  setInterval(pollBrokers, POLL_MS);

  // ---------- socket.io live events ----------

  const socket = io(HOST, {
    reconnection: true,
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    socket.emit('authenticate', { userId: 'brokers' });
    appendLog('_system', '{green-fg}socket connected{/green-fg}');
  });

  socket.on('disconnect', () => {
    appendLog('_system', '{red-fg}socket disconnected{/red-fg}');
  });

  socket.on('trading_log', entry => {
    const slug = _findSlugForSession(entry.sessionId);
    if (!slug) return;
    const ts = new Date(entry.timestamp).toLocaleTimeString();
    const levelTag = (entry.level || 'INFO').padEnd(8);
    const sym = (entry.symbol || '').padEnd(5);
    const line = `{gray-fg}${ts}{/gray-fg} {bold}${levelTag}{/bold} ${sym}  ${entry.message}`;
    appendLog(slug, line);
  });

  socket.on('trade_executed', t => {
    const slug = _findSlugForSession(t.sessionId);
    if (!slug) return;
    const ts = new Date(t.timestamp).toLocaleTimeString();
    const sideColor = t.side === 'buy' ? 'green' : 'cyan';
    const pnlText =
      t.pnl != null
        ? `  P&L=${color(fmtUsd(t.pnl), t.pnl >= 0 ? 'green' : 'red')}`
        : '';
    const line = `{gray-fg}${ts}{/gray-fg} {bold}TRADE   {/bold} ${color(t.side.toUpperCase(), sideColor)} ${(t.symbol || '').padEnd(5)} qty=${t.quantity} @ $${(t.price || 0).toFixed(2)}${pnlText}`;
    appendLog(slug, line);
    // Force a refresh so the leaderboard P&L updates immediately
    pollBrokers();
  });

  socket.on('trading_alert', a => {
    const slug = _findSlugForSession(a.sessionId);
    if (!slug) return;
    const ts = new Date(a.timestamp).toLocaleTimeString();
    const line = `{gray-fg}${ts}{/gray-fg} {bold}ALERT   {/bold} ${color(a.title || '', 'yellow')} — ${a.message || ''}`;
    appendLog(slug, line);
  });

  function _findSlugForSession(sessionId) {
    if (!sessionId) return null;
    const b = brokers.find(x => x.session?.sessionId === sessionId);
    return b?.slug || null;
  }

  // ---------- keybindings ----------

  leaderboard.focus();
  leaderboard.on('select', (_item, idx) => {
    // idx-1 because of header row
    const broker = brokers[Math.max(0, idx - 1)];
    if (broker) selectSlug(broker.slug);
  });
  leaderboard.on('keypress', () => {
    setImmediate(() => {
      const sel = leaderboard.selected; // 1-based index
      const broker = brokers[Math.max(0, sel - 1)];
      if (broker && broker.slug !== selectedSlug) selectSlug(broker.slug);
    });
  });

  screen.key(['q', 'C-c'], () => process.exit(0));
  screen.key(['l'], () => logPane.focus());
  screen.key(['p'], () => detail.focus());
  screen.key(['tab'], () => leaderboard.focus());

  screen.render();
} // end startTtyUI
