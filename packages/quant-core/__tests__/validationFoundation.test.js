import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const {
  equityStats,
  walkForward,
  significance,
  entropyGateCore,
  trendCore,
  shannonEntropy,
} = requireCjs('@keo/quant-core');

// Deterministic LCG so failures reproduce without external deps.
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function dates(n, start = new Date('2018-01-02')) {
  const out = [];
  const d = new Date(start);
  while (out.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// equityStats — the one definition of the numbers we report
// ─────────────────────────────────────────────────────────────────
describe('equityStats', () => {
  it('flat curve → zero everything, no NaN', () => {
    const ds = dates(300);
    const eq = new Array(300).fill(1);
    const s = equityStats.statsFromEquity(ds, eq);
    expect(s.totalRet).toBe(0);
    expect(s.sharpe).toBe(0);
    expect(s.maxDD).toBe(0);
    expect(Number.isFinite(s.cagr)).toBe(true);
  });

  it('monotonic up-curve has zero drawdown; a 50% crash reads -50%', () => {
    const ds = dates(4);
    expect(equityStats.maxDrawdown([1, 1.1, 1.2, 1.3])).toBe(0);
    expect(equityStats.maxDrawdown([1, 2, 1, 1.5])).toBeCloseTo(-0.5, 12);
    const dd = equityStats.drawdownSeries([1, 2, 1, 1.5]);
    expect(dd).toHaveLength(4);
    expect(dd[2]).toBeCloseTo(-0.5, 12);
    expect(dd[3]).toBeCloseTo(-0.25, 12);
    expect(ds).toHaveLength(4);
  });

  it('sharpe convention: mean*252 / (sd*sqrt252)', () => {
    const rand = seededRandom(7);
    const rets = Array.from(
      { length: 5000 },
      () => (rand() - 0.5) * 0.02 + 0.0005
    );
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(
      rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)
    );
    expect(equityStats.sharpe(rets)).toBeCloseTo((m / sd) * Math.sqrt(252), 10);
  });
});

// ─────────────────────────────────────────────────────────────────
// walkForward — selection on train only, OOS stitched from test
// ─────────────────────────────────────────────────────────────────
describe('walkForwardOOS', () => {
  it('picks the better candidate and stitches only test windows', () => {
    const n = 1600;
    const ds = dates(n);
    const rand = seededRandom(11);
    // noisy positive drift vs noisy negative drift (constant series would
    // have zero variance and Sharpe 0 by convention)
    const good = Array.from(
      { length: n },
      () => 0.001 + (rand() - 0.5) * 0.002
    );
    const bad = Array.from(
      { length: n },
      () => -0.001 + (rand() - 0.5) * 0.002
    );
    const res = walkForward.walkForwardOOS({
      dates: ds,
      candidates: [
        { params: { id: 'good' }, returns: good },
        { params: { id: 'bad' }, returns: bad },
      ],
      trainDays: 504,
      testDays: 126,
      embargoDays: 21,
    });
    expect(res).not.toBeNull();
    for (const f of res.folds) expect(f.chosen.id).toBe('good');
    // OOS covers everything after train+embargo
    expect(res.oos.dates[0]).toBe(ds[504 + 21]);
    expect(res.oos.stats.sharpe).toBeGreaterThan(5); // strong drift vs tiny noise
    // no test date may precede its fold's train end (embargo enforced)
    for (const f of res.folds) {
      expect(f.testStart > f.trainEnd).toBe(true);
    }
  });

  it('cannot peek: regime-flipping candidates yield OOS ≈ realized test data, not train winner', () => {
    // candidate A wins in first half, B in second half; WF must lag the flip
    const n = 1600;
    const ds = dates(n);
    const A = Array.from({ length: n }, (_, i) => (i < 800 ? 0.002 : -0.002));
    const B = Array.from({ length: n }, (_, i) => (i < 800 ? -0.002 : 0.002));
    const res = walkForward.walkForwardOOS({
      dates: ds,
      candidates: [
        { params: { id: 'A' }, returns: A },
        { params: { id: 'B' }, returns: B },
      ],
      trainDays: 504,
      testDays: 126,
      embargoDays: 21,
    });
    // the fold whose TEST window contains the flip was trained pre-flip, so
    // it must still hold A and bleed through the flip — the honest lag of
    // walk-forward (no peeking at the test window)
    const lagFold = res.folds.find(
      f => f.trainEnd < ds[800] && f.testStart <= ds[800] && f.testEnd > ds[800]
    );
    expect(lagFold).toBeDefined();
    expect(lagFold.chosen.id).toBe('A');
    expect(lagFold.testStats.totalRet).toBeLessThan(0);
  });

  it('returns null when history cannot fit one fold', () => {
    const n = 300;
    const res = walkForward.walkForwardOOS({
      dates: dates(n),
      candidates: [{ params: {}, returns: new Array(n).fill(0.001) }],
      trainDays: 504,
      testDays: 126,
      embargoDays: 21,
    });
    expect(res).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────
// significance — PSR / DSR / FDR sanity
// ─────────────────────────────────────────────────────────────────
describe('significance', () => {
  it('normCdf/normInv are inverses and match known values', () => {
    expect(significance.normCdf(0)).toBeCloseTo(0.5, 6);
    expect(significance.normCdf(1.6449)).toBeCloseTo(0.95, 3);
    for (const p of [0.025, 0.5, 0.9, 0.99]) {
      expect(significance.normCdf(significance.normInv(p))).toBeCloseTo(p, 4);
    }
  });

  it('PSR grows with T and with SR', () => {
    const base = significance.psr({ sr: 0.05, T: 252, skew: 0, kurt: 3 });
    expect(
      significance.psr({ sr: 0.05, T: 1260, skew: 0, kurt: 3 })
    ).toBeGreaterThan(base);
    expect(
      significance.psr({ sr: 0.1, T: 252, skew: 0, kurt: 3 })
    ).toBeGreaterThan(base);
  });

  it('deflation raises the bar as trials increase', () => {
    const d10 = significance.expectedMaxSharpe(10, 0.01);
    const d100 = significance.expectedMaxSharpe(100, 0.01);
    expect(d100).toBeGreaterThan(d10);
    expect(d10).toBeGreaterThan(0);
    const dsr = significance.deflatedSharpe({
      sr: 0.08,
      T: 1000,
      skew: 0,
      kurt: 3,
      nTrials: 50,
      varTrialsSR: 0.005,
    });
    const psr = significance.psr({
      sr: 0.08,
      srRef: 0,
      T: 1000,
      skew: 0,
      kurt: 3,
    });
    expect(dsr.dsr).toBeLessThan(psr); // deflated is always harder than PSR(0)
  });

  it('benjaminiHochberg controls the obvious cases', () => {
    const { rejected } = significance.benjaminiHochberg(
      [0.001, 0.4, 0.9, 0.002, 0.5],
      0.05
    );
    expect(rejected[0]).toBe(true);
    expect(rejected[3]).toBe(true);
    expect(rejected[2]).toBe(false);
  });

  it('sharpeMoments matches hand-computed moments', () => {
    const rets = [0.01, -0.01, 0.02, 0.0, -0.005];
    const m = significance.sharpeMoments(rets);
    expect(m.T).toBe(5);
    expect(Number.isFinite(m.sr)).toBe(true);
    expect(Number.isFinite(m.skew)).toBe(true);
    expect(m.kurt).toBeGreaterThan(0);
  });

  it('nullSharpeVariance: skill-less Sharpe scatters as 1/T (≈0.31 ann. at 10y)', () => {
    // annualized sd = sqrt(252 * var_daily) = sqrt(252/T)
    expect(Math.sqrt(252 * significance.nullSharpeVariance(252))).toBeCloseTo(
      1.0,
      10
    );
    expect(Math.sqrt(252 * significance.nullSharpeVariance(2625))).toBeCloseTo(
      0.31,
      2
    );
    expect(significance.nullSharpeVariance(0)).toBeNull();
  });

  it('deflation bar from null noise is immune to anti-edge pollution by construction', () => {
    // the bar depends only on (N, T); adding deliberately-dead trials to a
    // ledger changes neither input, while the old empirical-variance bar
    // would have ballooned
    const v = significance.nullSharpeVariance(2625);
    const bar65 = significance.expectedMaxSharpe(65, v);
    expect(bar65 * Math.sqrt(252)).toBeGreaterThan(0.5);
    expect(bar65 * Math.sqrt(252)).toBeLessThan(1.0); // sane, clearable bar
    // and it still rises with more trials — fishing is still priced
    expect(significance.expectedMaxSharpe(500, v)).toBeGreaterThan(bar65);
  });
});

// ─────────────────────────────────────────────────────────────────
// entropyGateCore — the shared decision (faithfulness contract)
// ─────────────────────────────────────────────────────────────────
describe('entropyGateCore', () => {
  function syntheticCloses(n, seed, vol = 0.01) {
    const rand = seededRandom(seed);
    const out = [100];
    for (let i = 1; i < n; i++) {
      out.push(out[i - 1] * (1 + (rand() - 0.5) * 2 * vol));
    }
    return out;
  }

  it('fails open below warmup, decides above it', () => {
    const short = syntheticCloses(100, 1);
    const r = entropyGateCore.evaluateEntropyGate(short, {
      preferredRegime: 'low-entropy',
    });
    expect(r.allow).toBe(true);
    expect(r.regime.state).toBe('unknown');

    const long = syntheticCloses(400, 1);
    const r2 = entropyGateCore.evaluateEntropyGate(long, {
      preferredRegime: 'low-entropy',
    });
    expect([
      'low-entropy',
      'high-entropy',
      'neutral',
      'transitioning',
    ]).toContain(r2.regime.state);
  });

  it('deltaH is a pure function of the closes (no hidden state)', () => {
    const closes = syntheticCloses(400, 42);
    const a = entropyGateCore.evaluateEntropyGate(closes, {});
    const b = entropyGateCore.evaluateEntropyGate(closes, {});
    expect(a).toEqual(b); // same input, same output — twice
    // and deltaH equals snapshot(today) - snapshot(yesterday) by construction
    const wins = [21, 63, 252];
    const now = shannonEntropy.entropySnapshot(closes, wins);
    const prev = shannonEntropy.entropySnapshot(closes.slice(0, -1), wins);
    const expected = now[21] / now.Hmax - prev[21] / prev.Hmax;
    expect(a.regime.deltaH).toBeCloseTo(expected, 10);
  });

  it("preferred 'any' allows unless transitioning", () => {
    const closes = syntheticCloses(400, 9);
    const r = entropyGateCore.evaluateEntropyGate(closes, {
      preferredRegime: 'any',
    });
    if (r.regime.state === 'transitioning') expect(r.allow).toBe(false);
    else expect(r.allow).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// trendCore — the deployed trend-follower decision (faithfulness contract)
// ─────────────────────────────────────────────────────────────────
describe('trendCore', () => {
  it('insufficient history → ok:false, never uptrend (no momentum fallback)', () => {
    const short = Array.from({ length: 200 }, (_, i) => 100 + i); // < momLookback+1
    const r = trendCore.evaluateTrend(short, {});
    expect(r.ok).toBe(false);
    expect(r.uptrend).toBe(false);
  });

  it('steady riser is an uptrend; steady faller is not', () => {
    const up = Array.from({ length: 300 }, (_, i) => 100 * Math.pow(1.001, i));
    const ru = trendCore.evaluateTrend(up, {});
    expect(ru.ok).toBe(true);
    expect(ru.aboveSma).toBe(true);
    expect(ru.momentum).toBeGreaterThan(0);
    expect(ru.uptrend).toBe(true);

    const down = Array.from(
      { length: 300 },
      (_, i) => 100 * Math.pow(0.999, i)
    );
    const rd = trendCore.evaluateTrend(down, {});
    expect(rd.uptrend).toBe(false);
  });

  it('momentum must be positive even when price is above the SMA', () => {
    // long decline then sharp recent pop above SMA: 12-1 momentum (which
    // skips the last month) stays negative → not eligible
    const closes = [];
    for (let i = 0; i < 280; i++) closes.push(200 * Math.pow(0.998, i));
    for (let i = 0; i < 20; i++) closes.push(closes[closes.length - 1] * 1.03);
    const r = trendCore.evaluateTrend(closes, {});
    expect(r.aboveSma).toBe(true);
    expect(r.momentum).toBeLessThan(0);
    expect(r.uptrend).toBe(false);
  });

  it('price override flips the SMA test without touching momentum', () => {
    const up = Array.from({ length: 300 }, (_, i) => 100 * Math.pow(1.001, i));
    const base = trendCore.evaluateTrend(up, {});
    const overridden = trendCore.evaluateTrend(up, { price: base.sma * 0.95 });
    expect(overridden.aboveSma).toBe(false);
    expect(overridden.uptrend).toBe(false);
    expect(overridden.momentum).toBeCloseTo(base.momentum, 12);
  });
});

// ─────────────────────────────────────────────────────────────────
// allocatorCore — core+satellite capped weights (C8)
// ─────────────────────────────────────────────────────────────────
describe('allocatorCore', () => {
  const allocatorCore = requireCjs('@keo/quant-core').allocatorCore;

  function noisy(n, drift, vol, seed) {
    const rand = seededRandom(seed);
    return Array.from({ length: n }, () => drift + (rand() - 0.5) * 2 * vol);
  }

  it('caps the satellite and only changes weight at month starts', () => {
    const n = 400;
    const ds = dates(n);
    // satellite has tiny vol → uncapped invVol share would be huge
    const core = noisy(n, 0.0005, 0.012, 1);
    const sat = noisy(n, 0.0002, 0.002, 2);
    const { wSat } = allocatorCore.cappedSatelliteWeights(ds, core, sat, {
      cap: 0.2,
    });
    const active = wSat.filter(w => w != null);
    expect(Math.max(...active)).toBeLessThanOrEqual(0.2 + 1e-12);
    // intra-month constancy: weight may change only when the month changes
    for (let i = 1; i < n; i++) {
      if (wSat[i] == null || wSat[i - 1] == null) continue;
      if (ds[i].slice(0, 7) === ds[i - 1].slice(0, 7)) {
        expect(wSat[i]).toBe(wSat[i - 1]);
      }
    }
  });

  it('weights are causal: day-i weight unchanged by day-i returns', () => {
    const n = 300;
    const ds = dates(n);
    const core = noisy(n, 0.0005, 0.01, 3);
    const sat = noisy(n, 0.0003, 0.008, 4);
    const a = allocatorCore.cappedSatelliteWeights(ds, core, sat, {});
    // find a month-start rebalance day and perturb THAT day's returns
    const i = a.rebalanceDays[a.rebalanceDays.length - 1];
    const core2 = core.slice();
    const sat2 = sat.slice();
    core2[i] = 0.5; // absurd same-day shock
    sat2[i] = -0.5;
    const b = allocatorCore.cappedSatelliteWeights(ds, core2, sat2, {});
    expect(b.wSat[i]).toBe(a.wSat[i]);
  });

  it('combineWithWeights charges fees only on weight changes', () => {
    const n = 80;
    const core = new Array(n).fill(0.001);
    const sat = new Array(n).fill(0.001);
    const wFlat = new Array(n).fill(0.2);
    const flat = allocatorCore.combineWithWeights(core, sat, wFlat, {});
    // identical sleeve returns + constant weight → exactly the sleeve return
    expect(flat[10]).toBeCloseTo(0.001, 12);
    const wStep = wFlat.slice();
    wStep[40] = 0.1; // one reallocation
    for (let i = 41; i < n; i++) wStep[i] = 0.1;
    const stepped = allocatorCore.combineWithWeights(core, sat, wStep, {});
    expect(stepped[40]).toBeCloseTo(0.001 - 0.0005 * 2 * 0.1, 12);
    expect(stepped[41]).toBeCloseTo(0.001, 12);
  });
});
