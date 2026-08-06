import { describe, it, expect } from 'vitest';
import { computeTimeline, partitionForArchive } from '../scanner/optionsTrackRecord.js';
import { renderProgressSnapshot } from '../scanner/optionsDailyLoop.js';

const mkPick = ({
  underlying = 'NVDA', day = '2026-07-22', dte = 9, delta = 0.3, spansEarnings = false,
  direction = 'LONG', popModel = 0.5, exitDay = '2026-07-24', returnPct = null, holdReturnPct = null,
  evaluatedAt = null,
}) => ({
  id: `${underlying}-${day}-${dte}-${Math.random()}`,
  recordedAt: `${day}T14:00:00.000Z`,
  evaluatedAt,
  card: {
    contractSymbol: `${underlying}X`, underlying, direction, dte, popModel,
    type: direction === 'LONG' ? 'call' : 'put',
    breakeven: 100, expiration: '2026-09-18', costPerContract: 100, entryDebit: 1,
    greeks: { delta: direction === 'LONG' ? delta : -delta },
    earnings: spansEarnings ? { spansEarnings: true } : null,
    scenarioValues: { target: 2, flat: 0.5, stop: 0.1 },
    popMarket: 0.3, underlyingPrice: 100,
  },
  ...(returnPct != null
    ? {
        status: returnPct > 0 ? 'win' : 'loss',
        exit: { exitDate: exitDay, returnPct, plPerContract: returnPct * 100, win: returnPct > 0, exitReason: 'planExit' },
      }
    : { status: 'open' }),
  ...(holdReturnPct != null
    ? { exitHold: { exitDate: exitDay, returnPct: holdReturnPct, plPerContract: holdReturnPct * 100, win: holdReturnPct > 0 } }
    : {}),
});

const ledger = [
  mkPick({ day: '2026-07-22', exitDay: '2026-07-24', returnPct: -0.5, holdReturnPct: -0.3, dte: 8, popModel: 0.6, evaluatedAt: '2026-07-25T10:00:00Z' }),
  mkPick({ day: '2026-07-22', underlying: 'NVDA', exitDay: '2026-07-24', returnPct: 1.0, holdReturnPct: 1.2, dte: 8, popModel: 0.6, evaluatedAt: '2026-07-25T10:00:00Z' }),
  mkPick({ day: '2026-07-23', underlying: 'TSLA', direction: 'SHORT', exitDay: '2026-07-28', returnPct: 0.4, holdReturnPct: 0.4, dte: 45, delta: 0.2, popModel: 0.4 }),
  mkPick({ day: '2026-07-23', underlying: 'AMD', exitDay: '2026-07-28', returnPct: -0.2, holdReturnPct: 0.1, dte: 20, spansEarnings: true, popModel: 0.5 }),
  mkPick({ day: '2026-07-24', underlying: 'META' }), // open — excluded everywhere
];

describe('computeTimeline', () => {
  const t = computeTimeline(ledger);

  it('builds cumulative $100-ticket curves bucketed by exit day', () => {
    expect(t.gradedPicks).toBe(4);
    expect(t.equityCurves.withStops.map(d => d.date)).toEqual(['2026-07-24', '2026-07-28']);
    // Day 1: -50 + 100 = +50; day 2: +40 - 20 = +20 → cumulative 70
    expect(t.equityCurves.withStops[0].cumulativePer100).toBeCloseTo(50, 2);
    expect(t.equityCurves.withStops[1].cumulativePer100).toBeCloseTo(70, 2);
    // Hold curve independent: -30+120=90; +40+10=50 → 140
    expect(t.equityCurves.holdToPlan[1].cumulativePer100).toBeCloseTo(140, 2);
  });

  it('computes calibration per entry day and flags partially graded days', () => {
    expect(t.calibrationByDay).toEqual([
      { day: '2026-07-22', n: 2, total: 2, partial: false, predicted: 0.6, realized: 0.5 },
      { day: '2026-07-23', n: 2, total: 2, partial: false, predicted: 0.45, realized: 0.5 },
    ]);
    const withOpen = computeTimeline([
      ...ledger,
      mkPick({ day: '2026-07-23', underlying: 'MU' }), // open pick, same entry day
    ]);
    expect(withOpen.calibrationByDay.find(c => c.day === '2026-07-23').partial).toBe(true);
  });

  it('slices sum to the graded count and carry cluster Ns', () => {
    const dteTotal = t.slices.byDte.reduce((s, b) => s + (b.graded || 0), 0);
    expect(dteTotal).toBe(4);
    const under10 = t.slices.byDte.find(b => b.label === '≤10d');
    expect(under10.graded).toBe(2);
    expect(under10.clusterN).toBe(1); // both NVDA on the same day = one cluster
    expect(t.slices.byEarnings.find(b => b.label === 'spans earnings').graded).toBe(1);
    expect(t.slices.byDirection.find(b => b.label === 'puts (short)').graded).toBe(1);
  });

  it('cluster-weighted stats give one vote per underlying-day', () => {
    // Clusters: NVDA|22 (avg +0.25), TSLA|23 (+0.4), AMD|23 (−0.2) → 3 clusters, 2 winners
    expect(t.clusterStats.clusters).toBe(3);
    expect(t.clusterStats.winRate).toBeCloseTo(2 / 3, 4);
  });

  it('records the grading methodology', () => {
    expect(t.methodology.gradeVersion).toBe(2);
  });
});

describe('partitionForArchive', () => {
  it('archives only fully-graded picks older than the cutoff', () => {
    const fullyGraded = { exit: { exitDate: '2026-05-01' }, exitHold: {}, stockLeg: {} };
    const picks = [
      { id: 'old-complete', ...fullyGraded },
      { id: 'old-missing-hold', exit: { exitDate: '2026-05-01' }, stockLeg: {} },
      { id: 'recent-complete', exit: { exitDate: '2026-07-30' }, exitHold: {}, stockLeg: {} },
      { id: 'open', status: 'open' },
    ];
    const { keep, archive } = partitionForArchive(picks, '2026-06-01');
    expect(archive.map(p => p.id)).toEqual(['old-complete']);
    expect(keep).toHaveLength(3);
  });
});

describe('renderProgressSnapshot', () => {
  it('renders batch, curves, and calibration trend from the timeline', () => {
    const t = computeTimeline(ledger);
    const text = renderProgressSnapshot(t, ledger, '2026-07-25');
    expect(text).toMatch(/Today's graded batch: 2 picks → 1W\/1L/);
    expect(text).toMatch(/Best: NVDA above/);
    expect(text).toMatch(/\$100\/pick cumulative: hold-to-plan \+140 · stops \+70/);
    expect(text).toMatch(/Calibration .*: 60→50 · 45→50/);
  });

  it('degrades to empty on an ungraded ledger', () => {
    expect(renderProgressSnapshot(computeTimeline([]), [], '2026-07-25')).toBe('');
  });
});
