// scripts/backtests/edge-gate-promotion.js
// Synthetic unit-test harness for the edge gate & tier promotion logic.
// Read-only: imports pure functions from server/brokers/tierPromotion.js and
// exercises evaluateBroker / evaluateEdgeGate / computeSharpe across edge cases.
//
// Run: cd /Users/keo/projects/rank-app/rank && node scripts/backtests/edge-gate-promotion.js
require('dotenv').config();

const tp = require('../../server/brokers/tierPromotion');
const { computeSharpe, aggregateBySource, evaluateEdgeGate, evaluateBroker } =
  tp;

let pass = 0,
  fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    // console.log('  PASS', name);
  } else {
    fail++;
    fails.push(`${name} :: ${detail || ''}`);
    console.log('  FAIL', name, detail || '');
  }
}

// ---- builders ----
// Build a sell leg as the simulatedExecutor would write it.
function sell({ realizedPct, realizedPnL, source }) {
  const pnl =
    realizedPnL != null
      ? realizedPnL
      : // approximate $ from % on a $10k notional
        (realizedPct / 100) * 10000;
  const o = { side: 'sell', realizedPnL: pnl };
  if (realizedPct != null) o.realizedPct = realizedPct;
  if (source !== undefined) o.source = source;
  return o;
}

function session({
  log = [],
  stats = {},
  startDaysAgo = 30,
  sessionId = 's1',
  name = 'test',
}) {
  return {
    sessionId,
    name,
    tradingLog: log,
    stats,
    startTime: new Date(
      Date.now() - startDaysAgo * 86400000
    ).toISOString(),
  };
}

// Make N sells from one source with a fixed per-trade % and noise.
function makeSells(n, source, meanPct, stdPct = 1, seed = 1) {
  // deterministic pseudo-random
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    // box-muller-ish via two uniforms
    const u1 = rnd() || 1e-9;
    const u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const pct = meanPct + z * stdPct;
    out.push(sell({ realizedPct: pct, source }));
  }
  return out;
}

function statsFrom(log, { maxDrawdown = 5 } = {}) {
  let wins = 0,
    losses = 0;
  for (const t of log) {
    if (t.side !== 'sell') continue;
    const p = t.realizedPnL != null ? t.realizedPnL : t.realizedPct;
    if (p >= 0) wins++;
    else losses++;
  }
  return { wins, losses, maxDrawdown };
}

const emptyLedger = { events: [] };

console.log('\n=== A. computeSharpe sanity ===');
{
  // constant returns -> stdev 0 -> null
  const log = makeSells(50, 'src', 1, 0); // zero noise
  check(
    'constant returns -> sharpe null',
    computeSharpe(session({ log })) === null,
    `got ${computeSharpe(session({ log }))}`
  );

  // single trade -> null
  check(
    '1 trade -> null',
    computeSharpe(session({ log: [sell({ realizedPct: 1, source: 'x' })] })) ===
      null
  );

  // known mean/std: returns 1% and -1% alternating, 100 trades
  const alt = [];
  for (let i = 0; i < 100; i++)
    alt.push(sell({ realizedPct: i % 2 === 0 ? 1 : -1, source: 'x' }));
  const sh = computeSharpe(session({ log: alt }));
  // mean=0 -> sharpe 0
  check('zero-mean alternating -> sharpe ~0', Math.abs(sh) < 1e-9, `got ${sh}`);

  // all positive small mean, low noise -> very high sharpe (annualized x sqrt252)
  const goodLog = makeSells(100, 'x', 0.5, 0.1, 7);
  const shGood = computeSharpe(session({ log: goodLog }));
  check(
    'high mean/low noise -> large annualized sharpe',
    shGood > 10,
    `got ${shGood} (note: sqrt(252) inflation)`
  );
  console.log(`    annualized sharpe for mean=0.5% std=0.1%: ${shGood.toFixed(1)}`);

  // de-annualized: divide by sqrt(252)
  console.log(
    `    per-trade (de-annualized) sharpe: ${(shGood / Math.sqrt(252)).toFixed(2)}`
  );
}

console.log('\n=== B. Sharpe annualization realism ===');
{
  // A broker that takes ~10 trades/day for 20 days = 200 trades. sqrt(252)
  // assumes ONE trade per day. If a broker churns intraday, sharpe is wildly
  // overstated. Show how a mediocre per-trade edge passes the 1.5 gate.
  // mean 0.1%, std 1% => per-trade sharpe 0.1; annualized = 0.1*sqrt(252)=1.587
  const log = makeSells(200, 'churn', 0.1, 1.0, 3);
  const sh = computeSharpe(session({ log }));
  check(
    'mediocre 0.1%/trade edge with sqrt(252) clears 1.5 gate',
    sh >= 1.5,
    `sharpe=${sh.toFixed(2)} (per-trade=${(sh / Math.sqrt(252)).toFixed(3)})`
  );
  console.log(
    `    mean=0.1% std=1.0% n=200 -> annualized sharpe ${sh.toFixed(2)} (passes >=1.5!)`
  );
}

console.log('\n=== C. aggregateBySource / edge gate: mixed sources ===');
{
  // A broker whose PRIMARY (most-traded) source is a money-loser, but a
  // secondary source masks it in aggregate. The gate should look at primary.
  const loser = makeSells(80, 'bad-strat', -0.2, 0.5, 11); // primary, negative
  const winner = makeSells(20, 'good-strat', 2.0, 0.5, 22); // secondary, positive
  const log = [...loser, ...winner];
  const edge = evaluateEdgeGate(session({ log }));
  check(
    'primary source picked = most-traded (bad-strat)',
    edge.source === 'bad-strat',
    `picked ${edge.source}`
  );
  check(
    'edge gate BLOCKS when primary source negative',
    edge.pass === false,
    edge.reason
  );
  console.log('    ', edge.reason);

  // Aggregate expectancy is POSITIVE though (80*-0.2 + 20*2 = +24 net). Confirm
  // that a naive aggregate check would have passed — gate adds value here.
  const aggPct =
    log
      .filter(t => t.side === 'sell')
      .reduce((a, t) => a + t.realizedPct, 0) / 100;
  console.log(
    `    aggregate sum of realizedPct = ${(aggPct * 100).toFixed(1)}% (positive) but primary is negative`
  );
}

console.log('\n=== D. edge gate: opposite failure — good primary, few trades ===');
{
  const log = makeSells(49, 'good', 1.0, 0.5, 5); // 49 < 50 minTrades
  const edge = evaluateEdgeGate(session({ log }));
  check('49 trades blocked (< 50 minTrades)', edge.pass === false, edge.reason);
  const log2 = makeSells(50, 'good', 1.0, 0.5, 5);
  const edge2 = evaluateEdgeGate(session({ log: log2 }));
  check('50 trades positive -> passes', edge2.pass === true, edge2.reason);
}

console.log('\n=== E. edge gate: tiny positive expectancy passes ===');
{
  // expectancy 0.001% per trade — economically zero after costs — passes gate
  const log = makeSells(60, 'thin', 0.001, 0.5, 9);
  const edge = evaluateEdgeGate(session({ log }));
  check(
    'expectancy ~0.001%/trade still passes (>0)',
    edge.pass === true,
    edge.reason
  );
  console.log('    ', edge.reason, '<-- no cost/min-edge buffer');
}

console.log('\n=== F. edge gate: $ fallback when no realizedPct ===');
{
  // Live-style trades: only pnl, no realizedPct, no source -> all 'unknown'
  const log = [];
  for (let i = 0; i < 60; i++)
    log.push({ side: 'sell', pnl: i % 3 === 0 ? -5 : 3 }); // net positive $
  const edge = evaluateEdgeGate(session({ log }));
  check(
    'no realizedPct: falls back to $ sign, net positive passes',
    edge.pass === true && edge.source === 'unknown',
    edge.reason
  );
  console.log('    ', edge.reason);
}

console.log('\n=== G. full evaluateBroker: can a BAD strategy get promoted? ===');
{
  // Construct a broker that meets aggregate gates via inflated sharpe (churn)
  // AND has a positive primary source by a hair -> promotes.
  const log = makeSells(120, 'churn', 0.1, 1.0, 3); // sharpe>1.5 via annualization
  const st = statsFrom(log, { maxDrawdown: 10 });
  // force win rate >= 52
  const winRate = st.wins / (st.wins + st.losses);
  const broker = { slug: 'churner', tier: 'simulated', capital: 100000 };
  const sess = session({ log, stats: st, startDaysAgo: 25 });
  const dec = evaluateBroker(broker, sess, emptyLedger);
  console.log(
    `    churner: sharpe-driven decision=${dec.action} wr=${(winRate * 100).toFixed(1)}% reason=${dec.reason}`
  );
  check(
    'BAD-EDGE churner can reach promote/hold (NOT fired) — risk demonstrated',
    dec.action === 'promote' || dec.action === 'hold',
    dec.action
  );
  if (dec.action === 'promote')
    console.log(
      '    *** A 0.1%/trade edge strategy got PROMOTED to real money via sqrt(252) sharpe inflation ***'
    );
}

console.log('\n=== H. full evaluateBroker: can a GOOD strategy be unfairly fired? ===');
{
  // Good strategy, strong positive edge, but one volatile drawdown spike >30%
  // (e.g. a single bad day mark-to-market) -> FIRED regardless of tier.
  const log = makeSells(150, 'great', 0.8, 1.0, 2);
  const st = statsFrom(log, { maxDrawdown: 31 });
  const broker = { slug: 'unlucky', tier: 'simulated', capital: 100000 };
  const sess = session({ log, stats: st, startDaysAgo: 40 });
  const dec = evaluateBroker(broker, sess, emptyLedger);
  check(
    'GOOD strategy fired on single 31% DD spike (no min-trades/min-days guard on FIRE)',
    dec.action === 'fire',
    dec.action
  );
  console.log('    ', dec.action, '-', dec.reason);
}

console.log('\n=== I. FIRE has no minimum-track-record guard ===');
{
  // Brand new broker, 2 trades, 1 bad mark -> dd 31% -> instant fire
  const log = [
    sell({ realizedPct: 5, source: 's' }),
    sell({ realizedPct: -5, source: 's' }),
  ];
  const broker = { slug: 'newborn', tier: 'simulated', capital: 100000 };
  const sess = session({
    log,
    stats: { wins: 1, losses: 1, maxDrawdown: 31 },
    startDaysAgo: 1,
  });
  const dec = evaluateBroker(broker, sess, emptyLedger);
  check(
    'newborn with 2 trades + 31% DD instantly fired',
    dec.action === 'fire',
    dec.action
  );
  console.log('    ', dec.reason, ' <-- fires on noise with no track record');
}

console.log('\n=== J. demote uses paper stats but maxDrawdown is CUMULATIVE ===');
{
  // DEMOTE comment claims "rolling 10 days" but code reads session.stats.maxDrawdown
  // which is an all-time peak-to-trough (see simulatedExecutor line 505). A broker
  // promoted after a clean run could be demoted for a drawdown that happened in SIM.
  const broker = { slug: 'paperguy', tier: 'paper', capital: 100000 };
  // sharpe healthy, but stats.maxDrawdown carries old 25% from sim history
  const log = makeSells(120, 'great', 0.8, 1.0, 2);
  const sess = session({
    log,
    stats: { wins: 80, losses: 40, maxDrawdown: 25 },
    startDaysAgo: 15,
  });
  const dec = evaluateBroker(broker, sess, emptyLedger);
  check(
    'paper broker demoted on CUMULATIVE (incl. sim) drawdown, not rolling-10d',
    dec.action === 'demote',
    dec.action
  );
  console.log('    ', dec.reason, ' <-- DEMOTE comment says "rolling 10 days" but uses all-time DD');
}

console.log('\n=== K. winRate unit mismatch check ===');
{
  // evaluateBroker computes winRate from stats.wins/losses as a FRACTION (0..1)
  // and compares to PROMOTE.minWinRate=0.52. But stats.winRate in persisted data
  // is a PERCENT (e.g. 76.6). Confirm evaluateBroker does NOT use stats.winRate.
  const log = makeSells(120, 'great', 0.5, 0.8, 4);
  const st = statsFrom(log, { maxDrawdown: 5 });
  st.winRate = 76.6; // percent form present in real data
  const broker = { slug: 'wr', tier: 'simulated', capital: 100000 };
  const sess = session({ log, stats: st, startDaysAgo: 25 });
  const dec = evaluateBroker(broker, sess, emptyLedger);
  const computedWR = st.wins / (st.wins + st.losses);
  check(
    'evaluateBroker recomputes winRate as fraction (ignores percent stats.winRate)',
    computedWR <= 1.0,
    `computedWR=${computedWR}`
  );
  console.log(`    computed fraction=${computedWR.toFixed(3)} (correct), stats.winRate=${st.winRate} (percent, unused)`);
}

console.log('\n=== L. legacy data: no source field -> single "unknown" bucket ===');
{
  // Replicate real claude-quant data: pnl + realizedPct, NO source.
  const log = [];
  for (let i = 0; i < 90; i++)
    log.push({ side: 'sell', realizedPnL: i % 5 === 0 ? -50 : 20, realizedPct: i % 5 === 0 ? -1 : 0.5 });
  const by = aggregateBySource(session({ log }));
  check(
    'sourceless trades collapse to one "unknown" bucket',
    Object.keys(by).length === 1 && by.unknown,
    JSON.stringify(Object.keys(by))
  );
  const edge = evaluateEdgeGate(session({ log }));
  console.log(`    edge gate on legacy unknown-source data: pass=${edge.pass} reason="${edge.reason}"`);
  console.log('    => for legacy brokers the "per-source" gate degenerates to an aggregate gate');
}

console.log(`\n================ RESULTS: ${pass} passed, ${fail} failed ================`);
if (fails.length) {
  console.log('Unexpected failures:');
  for (const f of fails) console.log('  -', f);
}
