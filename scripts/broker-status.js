#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/broker-status.js — One-shot terminal snapshot of broker state.
// Works without launching the full blessed TUI. Pulls from /api/brokers or
// falls back to reading data/ai-sessions.json directly if the server is down.

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.EXCHANGE_HOST || 'http://localhost:8080';
const SESSIONS_PATH = path.resolve(__dirname, '..', 'data', 'ai-sessions.json');

function fetchBrokers(host) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/brokers', host);
    const req = http.get(url, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

function fallbackFromDisk() {
  if (!fs.existsSync(SESSIONS_PATH)) return { brokers: [] };
  const data = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
  const brokers = Object.values(data)
    .filter(s => s.userId === 'brokers')
    .map(s => ({
      slug: s.config?.brokerSlug,
      name: s.name,
      tier: s.config?.tier || 'simulated',
      strategy: s.config?.strategyKey,
      session: {
        portfolio: {
          cash: s.portfolio?.cash,
          positionsCount: (s.portfolio?.positions || []).length,
        },
        stats: s.stats || {},
      },
    }));
  return { brokers, _fromDisk: true };
}

function color(text, c) {
  const codes = { red: 31, green: 32, yellow: 33, blue: 34, gray: 90, bold: 1 };
  return `\x1b[${codes[c] || 0}m${text}\x1b[0m`;
}

function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toFixed(2).padStart(8)}`;
}

async function main() {
  let data;
  let source = HOST;
  try {
    data = await fetchBrokers(HOST);
  } catch {
    data = fallbackFromDisk();
    source = `disk (${SESSIONS_PATH}) — server unreachable`;
  }
  const brokers = data.brokers || [];
  console.log(`\n${color('═'.repeat(72), 'gray')}`);
  console.log(
    `  ${color('AI Broker Status', 'bold')}  ${color(`@ ${new Date().toLocaleString()}`, 'gray')}`
  );
  console.log(`  ${color(`source: ${source}`, 'gray')}`);
  console.log(`${color('═'.repeat(72), 'gray')}\n`);

  const header =
    ' BROKER                 TIER      P&L          TRADES  WR%   CASH        POS  FUNNEL(e/p/x)';
  console.log(color(header, 'gray'));
  console.log(color(' ' + '─'.repeat(84), 'gray'));

  const sorted = [...brokers].sort(
    (a, b) =>
      (b.session?.stats?.totalPnL || 0) - (a.session?.stats?.totalPnL || 0)
  );

  for (const b of sorted) {
    const s = b.session?.stats || {};
    const p = b.session?.portfolio || {};
    const pnl = s.totalPnL || 0;
    const pnlStr = fmtUsd(pnl);
    const pnlColored =
      pnl > 0
        ? color(pnlStr, 'green')
        : pnl < 0
          ? color(pnlStr, 'red')
          : color(pnlStr, 'gray');
    const trades = String(s.totalTrades || 0).padStart(4);
    const wr = (s.winRate || 0).toFixed(0).padStart(3) + '%';
    const cash =
      p.cash != null ? `$${p.cash.toFixed(0).padStart(8)}` : '—'.padStart(9);
    const pos = String(p.positionsCount || 0).padStart(3);
    const tier = (b.tier || '—').padEnd(8);
    const name = (b.name || b.slug || '?').padEnd(22);
    // Signal funnel: evaluated / passed / entered
    const funnel =
      `${s.signalsEvaluated || 0}/${s.signalsPassed || 0}/${s.signalsEntered || 0}`.padStart(
        11
      );
    console.log(
      ` ${name} ${tier}  ${pnlColored}  ${trades}   ${wr}  ${cash}  ${pos}  ${funnel}`
    );
    // Per-source edge gate (sim→paper promotion): show the broker's primary
    // signal source, its expectancy, and whether it clears the bar for real money.
    const edge = b.session?.edge;
    if (edge && edge.source) {
      const gate = edge.pass
        ? color('✓ edge', 'green')
        : color('✗ no-edge', 'yellow');
      const exp =
        edge.expectancyPct != null
          ? `${edge.expectancyPct >= 0 ? '+' : ''}${edge.expectancyPct.toFixed(3)}%/trade`
          : `$${(edge.expectancyUsd || 0).toFixed(2)}/trade`;
      console.log(
        color(
          `     └ ${gate}  ${edge.source}  ${exp}  (${edge.trades} trades)`,
          'gray'
        )
      );
    }
  }
  console.log();
}

main().catch(err => {
  console.error('broker-status failed:', err.message);
  process.exit(1);
});
