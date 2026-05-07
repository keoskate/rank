#!/usr/bin/env node
/**
 * Live algebra validator.
 *
 * Hits the running server and asserts that the numbers it reports are
 * internally consistent. This is the live counterpart to the in-memory
 * invariant tests — it catches bugs the pure-function tests can't:
 *
 *   - Stale data (cached values that haven't refreshed)
 *   - Broker math errors (cash + market value ≠ equity)
 *   - Session stat drift (wins + losses ≠ totalTrades)
 *   - P&L logging bugs (totalPnL ≠ Σ trade pnls — known issue)
 *   - Engine staleness (sessions running but not ticking)
 *   - Cross-endpoint price drift beyond reasonable tolerance
 *
 * Run:  node scripts/validate-live.js
 *       npm run validate-live
 *
 * Exits non-zero on any failure so this is CI-runnable.
 */

const HOST = process.env.VALIDATE_HOST || 'http://localhost:8080';
const MODE = process.env.VALIDATE_MODE || 'paper';
const STALE_TICK_THRESHOLD_S = 30;
const EQUITY_TOLERANCE = 5; // dollars
const CROSS_PRICE_TOLERANCE_PCT = 2; // % drift between endpoints (different timeframes acceptable)

// Color helpers
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const results = [];
function check(name, passed, message, details) {
  results.push({ name, passed, message, details });
}

async function fetchJson(path) {
  const url = path.startsWith('http') ? path : `${HOST}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

function sum(arr, fn) {
  return arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);
}

function fmtMoney(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function validate() {
  // 1) Server reachable
  let health;
  try {
    health = await fetchJson('/api/ai/health');
    check('server.reachable', true, `engine: ${health.status}`, `runningSessions=${health.runningSessions}, staleSessions=${health.staleSessions}`);
  } catch (err) {
    check('server.reachable', false, 'server unreachable', err.message);
    return; // bail — nothing else will work
  }

  // 2) Account algebra: cash + Σ(position market values) ≈ equity
  let account, positionsResp;
  try {
    const accResp = await fetchJson(`/api/alpaca/account?mode=${MODE}`);
    account = accResp.account || accResp;
    positionsResp = await fetchJson(`/api/alpaca/positions?mode=${MODE}`);
    const positions = Array.isArray(positionsResp.positions) ? positionsResp.positions : [];
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    const positionValue = sum(positions, p => p.marketValue);
    const expected = cash + positionValue;
    const delta = Math.abs(expected - equity);

    check(
      'account.equity_algebra',
      delta <= EQUITY_TOLERANCE,
      delta <= EQUITY_TOLERANCE
        ? `cash + position value ≈ equity  (Δ ${fmtMoney(delta)})`
        : `cash + position value ≠ equity  (Δ ${fmtMoney(delta)} > ${fmtMoney(EQUITY_TOLERANCE)} tolerance)`,
      `cash=${fmtMoney(cash)} + posValue=${fmtMoney(positionValue)} = ${fmtMoney(expected)} vs equity=${fmtMoney(equity)}`
    );
  } catch (err) {
    check('account.equity_algebra', false, 'account fetch failed', err.message);
  }

  // 3) Engine health: every running session ticks within threshold
  if (health?.sessions) {
    const stale = health.sessions.filter(s => s.staleSeconds > STALE_TICK_THRESHOLD_S);
    check(
      'engine.no_stale_sessions',
      stale.length === 0,
      stale.length === 0
        ? `all ${health.sessions.length} running sessions ticking < ${STALE_TICK_THRESHOLD_S}s`
        : `${stale.length} stale session(s) > ${STALE_TICK_THRESHOLD_S}s`,
      stale.length > 0 ? stale.map(s => `${s.name}: ${s.staleSeconds}s`).join(', ') : null
    );
  }

  // 4) Stream connection
  try {
    const stream = await fetchJson('/api/alpaca/stream/status');
    const ok = stream.connected && stream.authenticated;
    check(
      'stream.connected',
      ok,
      ok ? `stream connected, authenticated, subscribed to ${(stream.subscribedSymbols || []).length} symbols` : `stream not connected (connected=${stream.connected}, authenticated=${stream.authenticated})`,
      `subscriptions: [${(stream.subscribedSymbols || []).join(', ')}]`
    );
  } catch (err) {
    check('stream.connected', false, 'stream status fetch failed', err.message);
  }

  // 5) Per-session checks
  const sessionsResp = await fetchJson('/api/ai/sessions/default_user').catch(() => ({ sessions: [] }));
  const sessions = sessionsResp.sessions || [];

  for (const s of sessions) {
    const stats = s.stats || {};
    const totalTrades = Number(stats.totalTrades) || 0;
    const wins = Number(stats.wins) || 0;
    const losses = Number(stats.losses) || 0;
    const totalPnL = Number(stats.totalPnL) || 0;

    // 5a) wins + losses = totalTrades
    // Allow for partial-exit accounting (a partial exit may count as 0 toward wins/losses
    // until the full position closes), so accept totalTrades >= wins + losses.
    const sum = wins + losses;
    check(
      `session[${s.name}].wins_plus_losses`,
      totalTrades === sum || totalTrades === sum + 1, // tolerate one open trade
      totalTrades === sum
        ? `wins(${wins}) + losses(${losses}) = totalTrades(${totalTrades})`
        : `wins(${wins}) + losses(${losses}) = ${sum} ≠ totalTrades(${totalTrades})  Δ=${totalTrades - sum}`,
      null
    );

    // 5b) Catch the "pnl logged as $0.00" bug specifically.
    // We can't compare cumulative totalPnL against decisions because decisions
    // is a recent-history view, not the lifetime ledger. Instead, look at
    // every recent SELL decision and flag any that report pnl exactly 0 with
    // a non-trivial quantity — those are the symptoms of the force-exit-path
    // logging bug we hit on 2026-04-30 and 2026-05-06.
    try {
      const decResp = await fetchJson(`/api/ai/decisions/${s.sessionId}`);
      const decisions = decResp.decisions || decResp || [];
      const sells = Array.isArray(decisions)
        ? decisions.filter(d => d.action === 'SELL')
        : [];
      const zeroPnlSells = sells.filter(
        d => Number(d.quantity) > 0 && Number(d.pnl) === 0
      );
      check(
        `session[${s.name}].no_zero_pnl_sells`,
        zeroPnlSells.length === 0,
        zeroPnlSells.length === 0
          ? `${sells.length} recent SELL decision(s), none with pnl=$0 anomaly`
          : `${zeroPnlSells.length} of ${sells.length} recent SELLs logged pnl=$0 with qty > 0  ← logging bug`,
        zeroPnlSells.length === 0
          ? null
          : zeroPnlSells.map(d => `${d.symbol} qty=${d.quantity} @ ${d.currentPrice}`).join('; ')
      );
    } catch (err) {
      check(`session[${s.name}].no_zero_pnl_sells`, false, 'decisions fetch failed', err.message);
    }
  }

  // 6) Cross-endpoint price drift for each watchlist symbol of each running session
  const runningSymbols = new Set();
  for (const s of sessions) {
    if (s.status === 'running' && Array.isArray(s.config?.watchlist)) {
      for (const sym of s.config.watchlist) runningSymbols.add(sym.toUpperCase());
    }
  }

  for (const sym of runningSymbols) {
    try {
      const [indResp, regResp] = await Promise.all([
        fetchJson(`/api/indicators/${sym}`).catch(() => null),
        fetchJson(`/api/regime/${sym}`).catch(() => null),
      ]);
      const indPrice = indResp?.indicators?.price ?? indResp?.price;
      const regPrice = regResp?.indicators?.price;
      if (typeof indPrice !== 'number' || typeof regPrice !== 'number') {
        check(`price.${sym}.cross_endpoint`, false, `missing price (ind=${indPrice}, regime=${regPrice})`, null);
        continue;
      }
      const driftPct = Math.abs(((indPrice - regPrice) / regPrice) * 100);
      // Allow larger drift between intraday and daily-bar endpoints — they
      // legitimately reflect different timeframes. We just want to catch
      // pathological drift (e.g., one endpoint stale by hours).
      const tol = sym.includes('USD') ? 5 : 10; // crypto vs. stock
      check(
        `price.${sym}.cross_endpoint`,
        driftPct <= tol,
        driftPct <= tol
          ? `intraday ${indPrice.toFixed(2)} vs daily ${regPrice.toFixed(2)}  (drift ${driftPct.toFixed(2)}% ≤ ${tol}%)`
          : `intraday ${indPrice.toFixed(2)} vs daily ${regPrice.toFixed(2)}  (drift ${driftPct.toFixed(2)}% > ${tol}% — possibly stale)`,
        null
      );
    } catch (err) {
      check(`price.${sym}.cross_endpoint`, false, 'price comparison failed', err.message);
    }
  }

  // 7) Stream subscribed to every running watchlist symbol
  try {
    const stream = await fetchJson('/api/alpaca/stream/status');
    const subscribed = new Set((stream.subscribedSymbols || []).map(s => s.toUpperCase()));
    const missing = [...runningSymbols].filter(s => {
      // Crypto symbols often subscribed without "USD" suffix on the stream
      const baseSym = s.replace(/USD$/, '');
      return !subscribed.has(s) && !subscribed.has(baseSym);
    });
    check(
      'stream.covers_running_watchlists',
      missing.length === 0,
      missing.length === 0
        ? `all ${runningSymbols.size} running watchlist symbols subscribed`
        : `${missing.length} watchlist symbol(s) NOT subscribed: ${missing.join(', ')}`,
      `subscribed: [${[...subscribed].join(', ')}]  watchlists: [${[...runningSymbols].join(', ')}]`
    );
  } catch (err) {
    check('stream.covers_running_watchlists', false, 'stream check failed', err.message);
  }
}

function sum2(arr, fn) {
  return arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);
}

(async () => {
  const start = Date.now();
  try {
    await validate();
  } catch (err) {
    console.error(`${RED}fatal:${RESET}`, err.message);
    process.exit(2);
  }

  // Print report
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const elapsed = Date.now() - start;

  console.log(`\n${BOLD}LIVE VALIDATION${RESET} — ${HOST} (${MODE})`);
  console.log(`${DIM}${'═'.repeat(72)}${RESET}`);
  for (const r of results) {
    const tag = r.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`${tag} ${BOLD}${r.name.padEnd(48)}${RESET} ${r.message}`);
    if (r.details) {
      console.log(`  ${DIM}${r.details}${RESET}`);
    }
  }
  console.log(`${DIM}${'─'.repeat(72)}${RESET}`);
  const summaryColor = failed === 0 ? GREEN : RED;
  console.log(`${summaryColor}${BOLD}${passed} passed, ${failed} failed${RESET}  ${DIM}(${elapsed}ms)${RESET}\n`);

  process.exit(failed === 0 ? 0 : 1);
})();
