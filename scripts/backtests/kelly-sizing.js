// Numeric verification harness for server/risk/kellySizing.js
// Pure-math audit: no market data needed. Verifies the sizing curve, prior
// behavior, edge cases (zero/negative edge, extreme edge), the dollars-vs-pct
// payoff-ratio issue, and the blend/clamp logic.
require('dotenv').config();
const k = require('../../server/risk/kellySizing.js');

const mkSession = (trades) => ({ tradingLog: trades });
const sell = (pnl) => ({ side: 'sell', realizedPnL: pnl });

function fmt(n, d = 4) {
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

console.log('=== 1) kellyFraction(p, b) full-Kelly sanity ===');
const cases = [
  [0.51, 1.0, 'prior'],
  [0.55, 1.0, ''],
  [0.6, 1.0, ''],
  [0.6, 2.0, ''],
  [0.9, 5.0, 'huge edge'],
  [0.99, 10.0, 'extreme edge'],
  [0.5, 1.0, 'zero edge'],
  [0.4, 1.0, 'negative edge'],
  [1.0, 1.0, 'degenerate p=1'],
  [0.0, 1.0, 'degenerate p=0'],
  [0.7, 0, 'payoff=0'],
];
for (const [p, b, note] of cases) {
  console.log(`p=${p} b=${b} -> fullKelly=${fmt(k.kellyFraction(p, b))}  ${note}`);
}

console.log('\n=== 2) computeKellySize on synthetic sessions (100k portfolio, mult=0.25, cap 20%, min 0.5%) ===');
const opts = { portfolioValue: 100000, kellyFraction: 0.25, maxPercent: 20, minPercent: 0.5 };

function show(label, trades) {
  const r = k.computeKellySize(mkSession(trades), opts);
  console.log(
    `${label}: ${fmt(r.percent, 3)}% ($${r.dollars.toFixed(0)})  src=${r.source} ` +
      `wr=${fmt(r.stats.winRate, 3)} payoff=${fmt(r.stats.payoffRatio, 3)} fullKelly=${fmt(r.stats.fullKelly)} n=${r.stats.sample}`
  );
}

show('PRIOR (no trades)', []);

// 20 trades, p=0.6, equal $1000 win/loss -> b=1, fullK=0.2, *0.25 => 5%
let t = [];
for (let i = 0; i < 12; i++) t.push(sell(1000));
for (let i = 0; i < 8; i++) t.push(sell(-1000));
show('p=0.6 b=1 (equal $)', t);

// SAME percent edge but bigger dollar trades on wins. If positions are
// re-sized as Kelly grows, $ pnl grows too -> b inflates spuriously.
t = [];
for (let i = 0; i < 12; i++) t.push(sell(5000)); // wins bigger $ (bigger positions)
for (let i = 0; i < 8; i++) t.push(sell(-1000));
show('p=0.6, win$=5000 loss$=1000 (b=5 in $)', t);

// All wins (no losses) -> payoffRatio fallback path
t = [];
for (let i = 0; i < 20; i++) t.push(sell(500));
show('20 wins 0 losses', t);

// All losses
t = [];
for (let i = 0; i < 20; i++) t.push(sell(-500));
show('20 losses 0 wins', t);

// One tiny loss, many big wins -> avgLoss ~ tiny -> payoff explodes
t = [];
for (let i = 0; i < 19; i++) t.push(sell(2000));
t.push(sell(-1)); // single $1 loss
show('19 wins $2000, 1 loss $1 (payoff blows up)', t);

console.log('\n=== 3) realizedPnL >= 0 classifies break-even (0) as a WIN ===');
t = [];
for (let i = 0; i < 10; i++) t.push(sell(0)); // exactly break-even
for (let i = 0; i < 10; i++) t.push(sell(-100));
show('10 breakeven(0) + 10 losses', t);

console.log('\n=== 4) Blend region (sample between 1 and 19) ===');
for (const n of [1, 5, 10, 19]) {
  // n trades all winners of $1000 vs none -> empirical wr=1, payoff fallback=2
  const tr = [];
  for (let i = 0; i < n; i++) tr.push(sell(1000));
  const r = k.computeKellySize(mkSession(tr), opts);
  console.log(
    `n=${n} allwins: ${fmt(r.percent, 3)}% src=${r.source} wr=${fmt(r.stats.winRate, 3)} payoff=${fmt(r.stats.payoffRatio, 3)} fullKelly=${fmt(r.stats.fullKelly)}`
  );
}

console.log('\n=== 5) Dangerous-sizing stress: max multiplier=1.0, huge measured edge ===');
const opts2 = { portfolioValue: 100000, kellyFraction: 1.0, maxPercent: 100, minPercent: 0.5 };
t = [];
for (let i = 0; i < 19; i++) t.push(sell(10000));
t.push(sell(-100)); // payoff ~ 100, wr=0.95
const r5 = k.computeKellySize(mkSession(t), opts2);
console.log(
  `full-Kelly, no real cap: ${fmt(r5.percent, 2)}% ($${r5.dollars.toFixed(0)}) fullKelly=${fmt(r5.stats.fullKelly)} payoff=${fmt(r5.stats.payoffRatio, 2)}`
);

console.log('\n=== 6) NaN / dirty input handling ===');
console.log('NaN winRate fullK:', k.kellyFraction(NaN, 1));
console.log('Infinity payoff fullK:', k.kellyFraction(0.6, Infinity));
const rDirty = k.computeKellySize(mkSession([{ side: 'sell', realizedPnL: NaN }]), opts);
console.log('session w/ NaN pnl:', fmt(rDirty.percent, 3) + '%', 'src=' + rDirty.source);
