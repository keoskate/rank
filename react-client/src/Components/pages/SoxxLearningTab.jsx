import { useState, useEffect, useRef, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';

// Learning view for the SOXX self-improving systems — the hourly predictor, the
// next-day predictor, and the AI analyst. Each is a pre-registered forward-test;
// this is where you watch it converge: accuracy over N, the learning curve
// (cumulative accuracy over evaluated calls), calibration, and — for the AI — its
// edge vs the base engine. Reads /api/semiconductor/learning. Display only.

const pctColor = v => (v == null ? theme.colors.gray500 : v >= 0 ? theme.colors.success : theme.colors.error);
const accColor = a => (a == null ? theme.colors.gray500 : a >= 0.5 ? theme.colors.success : theme.colors.error);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Cumulative-accuracy line: is it trending up as it learns? 50% = coin flip.
const AccuracyCurve = ({ points, height = 120 }) => {
  const ref = useRef(null);
  const [w, setW] = useState(380);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setW(Math.max(240, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!points || points.length < 2) return null;
  const padL = 30;
  const padR = 10;
  const padT = 8;
  const padB = 14;
  const H = height;
  const plotW = Math.max(20, w - padL - padR);
  const plotH = H - padT - padB;
  const n = points.length;
  const xAt = i => padL + (i / (n - 1)) * plotW;
  const yAt = a => padT + (1 - a) * plotH;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.acc).toFixed(1)}`).join(' ');
  const last = points[n - 1].acc;
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={H} style={{ display: 'block' }}>
        <line x1={padL} y1={yAt(0.5)} x2={padL + plotW} y2={yAt(0.5)} stroke={theme.colors.gray300} strokeWidth="1" strokeDasharray="3 3" />
        <text x={padL - 4} y={yAt(0.5) + 3} textAnchor="end" fontSize="8" fill={theme.colors.gray400} fontFamily="monospace">50%</text>
        <text x={padL - 4} y={padT + 4} textAnchor="end" fontSize="8" fill={theme.colors.gray400} fontFamily="monospace">100</text>
        <text x={padL - 4} y={padT + plotH} textAnchor="end" fontSize="8" fill={theme.colors.gray400} fontFamily="monospace">0</text>
        <path d={d} fill="none" stroke={accColor(last)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xAt(n - 1)} cy={yAt(last)} r="2.6" fill={accColor(last)} />
      </svg>
    </div>
  );
};

// Predicted vs realized win-rate per confidence bin — is the confidence honest?
const ReliabilityBars = ({ bins }) => {
  if (!bins || !bins.length) return null;
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {bins.map(b => (
        <div key={b.lo} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 30px', gap: 8, alignItems: 'center', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
          <span style={{ color: theme.colors.gray600 }}>{(b.lo * 100).toFixed(0)}–{(b.hi * 100).toFixed(0)}%</span>
          <div style={{ position: 'relative', height: 12, background: theme.colors.gray100, borderRadius: 2 }}>
            {/* predicted = grey outline marker */}
            <div style={{ position: 'absolute', left: `${b.predicted * 100}%`, top: -1, width: 2, height: 14, background: theme.colors.gray500 }} title={`predicted ${(b.predicted * 100).toFixed(0)}%`} />
            {/* actual = filled bar */}
            <div style={{ width: `${b.actual * 100}%`, height: 12, background: accColor(b.actual), borderRadius: 2, opacity: 0.6 }} title={`actual ${(b.actual * 100).toFixed(0)}%`} />
          </div>
          <span style={{ color: theme.colors.gray400, textAlign: 'right' }}>{b.n}</span>
        </div>
      ))}
    </div>
  );
};

// by-hour / by-weekday / by-risk win-rate bars.
const BreakdownBars = ({ data, kind }) => {
  if (!data || !Object.keys(data).length) return null;
  const rows = Object.entries(data)
    .map(([k, v]) => ({ k, n: v.n, acc: v.n ? v.correct / v.n : null }))
    .filter(r => r.n > 0);
  if (kind === 'byHour' || kind === 'byWeekday') rows.sort((a, b) => Number(a.k) - Number(b.k));
  const label = r => (kind === 'byHour' ? `${r.k}:00` : kind === 'byWeekday' ? WD[Number(r.k)] || r.k : r.k);
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {rows.map(r => (
        <div key={r.k} style={{ display: 'grid', gridTemplateColumns: '46px 1fr 44px 24px', gap: 8, alignItems: 'center', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
          <span style={{ color: theme.colors.gray600 }}>{label(r)}</span>
          <div style={{ height: 10, background: theme.colors.gray100, borderRadius: 2 }}>
            <div style={{ width: `${(r.acc || 0) * 100}%`, height: 10, background: accColor(r.acc), borderRadius: 2 }} />
          </div>
          <span style={{ color: accColor(r.acc), textAlign: 'right', fontWeight: 600 }}>{r.acc != null ? `${(r.acc * 100).toFixed(0)}%` : '—'}</span>
          <span style={{ color: theme.colors.gray400, textAlign: 'right' }}>{r.n}</span>
        </div>
      ))}
    </div>
  );
};

const Stat = ({ label, value, color }) => (
  <div>
    <div style={{ fontSize: '9px', color: theme.colors.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'monospace' }}>{label}</div>
    <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: 700, fontFamily: 'monospace', color: color || theme.colors.gray800 }}>{value}</div>
  </div>
);

const SectionLabel = ({ children }) => (
  <div style={{ fontSize: '9px', color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '10px 0 4px' }}>{children}</div>
);

const SystemCard = ({ s }) => {
  const isAI = s.key === 'ai';
  const acc = s.accuracy;
  const enough = s.directional > 0;
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          {s.label}{' '}
          <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray400, fontWeight: 'normal' }}>· {s.horizon}</span>
        </h3>
        <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: 'monospace' }}>{s.evaluated}/{s.total} graded · {s.pending} pending</span>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: theme.spacing.lg, flexWrap: 'wrap' }}>
        <Stat label="Accuracy" value={enough ? `${(acc * 100).toFixed(0)}%` : '—'} color={accColor(enough ? acc : null)} />
        <Stat label="over N" value={enough ? s.directional : '0'} />
        {s.brier != null && <Stat label="Brier" value={s.brier.toFixed(2)} />}
        {isAI && s.edgeVsBase != null && (
          <Stat label="edge vs base" value={`${s.edgeVsBase >= 0 ? '+' : ''}${(s.edgeVsBase * 100).toFixed(0)}%`} color={pctColor(s.edgeVsBase)} />
        )}
        {isAI && s.diverged != null && <Stat label="diverged" value={`${s.divergedAiWins}/${s.diverged}`} />}
      </div>

      {!enough ? (
        <div style={{ marginTop: 10, fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          Warming up — {s.total} recorded, {s.pending} awaiting their first evaluation. The curve appears once calls resolve.
        </div>
      ) : (
        <>
          <SectionLabel>Learning curve — cumulative accuracy over graded calls</SectionLabel>
          {s.curve && s.curve.length >= 2 ? (
            <AccuracyCurve points={s.curve} />
          ) : (
            <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>needs ≥2 graded calls to chart the trend</div>
          )}

          {s.reliability && s.reliability.length > 0 && (
            <>
              <SectionLabel>Calibration — predicted (▏) vs realized win-rate</SectionLabel>
              <ReliabilityBars bins={s.reliability} />
            </>
          )}

          {s[s.breakdownKey] && Object.keys(s[s.breakdownKey]).length > 0 && (
            <>
              <SectionLabel>Accuracy {s.breakdownLabel}</SectionLabel>
              <BreakdownBars data={s[s.breakdownKey]} kind={s.breakdownKey} />
            </>
          )}

          {s.recent && s.recent.length > 0 && (
            <>
              <SectionLabel>Recent graded calls</SectionLabel>
              <div style={{ display: 'grid', gap: 2 }}>
                {s.recent.slice(0, 8).map((r, i) => {
                  const dir = isAI ? r.ai : r.direction;
                  const correct = isAI ? r.aiCorrect : r.correct;
                  const ret = r.realizedReturn;
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '16px 64px 1fr 64px', gap: 8, alignItems: 'center', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                      <span style={{ color: correct ? theme.colors.success : theme.colors.error }}>{correct ? '✓' : '✗'}</span>
                      <span style={{ color: dir === 'bullish' ? theme.colors.success : dir === 'bearish' ? theme.colors.error : theme.colors.gray600 }}>{(dir || '—').toUpperCase()}</span>
                      <span style={{ color: theme.colors.gray400 }}>
                        {isAI && r.base ? `vs base ${r.base}` : ''}{isAI && r.adj != null ? ` · adj ${r.adj >= 0 ? '+' : ''}${r.adj}` : ''}
                      </span>
                      <span style={{ textAlign: 'right', color: pctColor(ret) }}>{ret != null ? `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%` : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
};

const SoxxLearningTab = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/semiconductor/learning');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      <Card>
        <h2 style={{ margin: 0, fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold }}>Semiconductor — Learning</h2>
        <div style={{ marginTop: 6, fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
          Three pre-registered forward-tests, each recorded immutably and graded against what SOXX actually did. Watch them converge: accuracy should climb above the 50% coin-flip line, the confidence should calibrate, and the AI should show a positive <strong>edge vs base</strong> if it's adding value. Early numbers are honest and small — that's the point.
        </div>
        {data?.asOf && (
          <div style={{ marginTop: 4, fontSize: theme.typography.fontSize.xs, color: theme.colors.gray400, fontFamily: 'monospace' }}>{fmtET(new Date(data.asOf))} ET</div>
        )}
      </Card>

      {error ? (
        <Card variant="error"><div style={{ fontSize: theme.typography.fontSize.sm }}>Learning data unavailable ({error}).</div></Card>
      ) : !data ? (
        <Card><div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray500 }}>loading…</div></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: theme.spacing.md }}>
          {data.systems.map(s => <SystemCard key={s.key} s={s} />)}
        </div>
      )}
    </div>
  );
};

export default memo(SoxxLearningTab);
