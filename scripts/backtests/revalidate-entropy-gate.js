#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/revalidate-entropy-gate.js
//
// Re-validation of the entropy-gate EDGE claim (distinct from faithfulness):
// "filtering entries by Shannon-entropy regime improves expectancy."
//
// The original entropy-regime-gate.js measured this on Polygon data (silent
// 2021-06 floor), with NO transaction costs, and with regime logic that
// diverged from live. This version fixes all three:
//   - data: Alpaca split+dividend-adjusted 2016+ (the validated path)
//   - regime: the CERTIFIED shared core (entropyGateCore) — zero divergence
//     from the live module, so what we measure here is what production does
//   - costs: bpsPerSide round-trip per trade (leveraged ETFs 30bps RT)
//
// Harness (same trade mechanics as the original): 5-day breakout on each
// traded symbol; enter next open; exit TP +8% / SL -4% / time 10 bars.
// Gate variants filter the SAME signal population, so the comparison is a
// two-sample test of "trades the gate kept" vs baseline.
//
// Statistics: Welch t-test on the expectancy difference (gated vs baseline).
// A gate that merely keeps a random subset shows diff ≈ 0. We report net
// expectancy, win rate, and the p-value — and we do NOT call it an edge
// unless the difference is significant.
//
// Output: data/backtests/certifications/entropy-gate-effect.json

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { entropyGateCore } = require('@keo/quant-core');
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { loadDailyBars, maxSafeEnd } = require('./lib/marketData');

const SYMBOLS = ['SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'SPXL', 'NVDA', 'AMD', 'QQQ'];
const REF = 'SOXX';
const START = '2016-01-04';
const END = maxSafeEnd();
const LOOKBACK = 5;
const TP = 8;
const SL = 4;
const HOLD = 10;
const OUT = path.join(
  __dirname,
  '../../data/backtests/certifications/entropy-gate-effect.json'
);

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const variance = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
};
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;

/** Welch two-sample t-test (approximate p via normal — dfs are large). */
function welch(a, b) {
  if (a.length < 8 || b.length < 8) return { t: null, p: null };
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  if (va + vb === 0) return { t: null, p: null };
  const t = (mean(a) - mean(b)) / Math.sqrt(va + vb);
  const { normCdf } = require('@keo/quant-core').significance;
  return { t, p: 2 * (1 - normCdf(Math.abs(t))) };
}

function brokerExit(bars, idx, costRT) {
  const entry = bars[idx]?.open;
  if (!(entry > 0)) return null;
  const tpPx = entry * (1 + TP / 100);
  const slPx = entry * (1 - SL / 100);
  let ret = null;
  for (let n = 0; n < HOLD; n++) {
    const b = bars[idx + n];
    if (!b) break;
    if (b.low <= slPx) {
      ret = -SL / 100;
      break;
    }
    if (b.high >= tpPx) {
      ret = TP / 100;
      break;
    }
    ret = b.close / entry - 1;
  }
  return ret == null ? null : ret - costRT;
}

async function main() {
  console.log(
    `Entropy-gate effect re-validation ${START}..${END} (validated data, certified core, net of costs)`
  );
  const { bars } = await loadDailyBars([REF, ...SYMBOLS], {
    start: START,
    end: END,
  });
  if (!bars[REF]) throw new Error('no reference bars');

  // PIT regime per reference date using the certified shared core
  const refCloses = bars[REF].map(b => b.close);
  const refDates = bars[REF].map(b => b.date);
  const regimeByDate = new Map();
  for (let i = 254; i < refCloses.length; i++) {
    const d = entropyGateCore.evaluateEntropyGate(refCloses.slice(0, i + 1), {
      preferredRegime: 'any',
    });
    regimeByDate.set(refDates[i], d.regime);
  }
  console.log(`PIT regimes computed for ${regimeByDate.size} days`);

  const V = {
    A_none: [],
    B_low: [],
    C_high: [],
    D_noTransition: [],
    E_neutral: [],
  };
  for (const sym of SYMBOLS) {
    const sBars = bars[sym];
    if (!sBars || sBars.length < LOOKBACK + 2) continue;
    const costRT = (bpsPerSide(sym) * 2) / 10000;
    for (let t = LOOKBACK; t < sBars.length - 1; t++) {
      let hi = -Infinity;
      for (let k = 1; k <= LOOKBACK; k++) hi = Math.max(hi, sBars[t - k].close);
      if (!(sBars[t].close > hi)) continue;
      const ret = brokerExit(sBars, t + 1, costRT);
      if (ret == null) continue;
      V.A_none.push(ret);
      const reg = regimeByDate.get(sBars[t].date);
      if (!reg || reg.state === 'unknown') continue;
      if (reg.state !== 'transitioning') {
        V.D_noTransition.push(ret);
        if (reg.state === 'low-entropy') V.B_low.push(ret);
        if (reg.state === 'high-entropy') V.C_high.push(ret);
        if (reg.state === 'neutral') V.E_neutral.push(ret);
      }
    }
  }

  const rows = [];
  console.log(
    '\nvariant                       n     exp/trade(net)  win%   Δ vs baseline   p(Welch)'
  );
  for (const [name, xs] of Object.entries(V)) {
    const w = name === 'A_none' ? { t: null, p: null } : welch(xs, V.A_none);
    const row = {
      variant: name,
      n: xs.length,
      expectancyNet: mean(xs),
      winRate: xs.filter(x => x > 0).length / (xs.length || 1),
      deltaVsBaseline: name === 'A_none' ? null : mean(xs) - mean(V.A_none),
      welchT: w.t,
      pValue: w.p,
    };
    rows.push(row);
    console.log(
      `${name.padEnd(26)} ${String(row.n).padStart(5)}   ${pct(row.expectancyNet).padStart(10)}   ${(row.winRate * 100).toFixed(0).padStart(4)}%   ${row.deltaVsBaseline == null ? '      —' : pct(row.deltaVsBaseline).padStart(8)}   ${row.pValue == null ? '    —' : row.pValue.toFixed(3).padStart(6)}`
    );
  }

  const significant = rows.filter(r => r.pValue != null && r.pValue < 0.05);
  const verdict = significant.length
    ? `SIGNIFICANT differences: ${significant.map(r => r.variant).join(', ')} — inspect direction before believing`
    : 'NO statistically significant expectancy edge from any gate variant (net of costs, certified core, 2016+ data)';

  const report = {
    generatedAt: new Date().toISOString(),
    window: { start: START, end: END },
    data: 'alpaca adjusted (validated path)',
    regimeCore: 'quant-core entropyGateCore (certified vs live)',
    costs: 'bpsPerSide round-trip per trade',
    harness: {
      signal: `${LOOKBACK}d breakout`,
      tp: TP,
      sl: SL,
      holdBars: HOLD,
      symbols: SYMBOLS,
      reference: REF,
    },
    rows,
    verdict,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nVERDICT: ${verdict}`);
  console.log(`wrote ${OUT}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
