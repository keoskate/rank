import { useMemo, useState, useEffect, useRef, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import Sparkline from '../common/Sparkline';
import { fmtET } from '../../utils/timeFormat';
import {
  SOXX_TOP,
  GROUP_ORDER,
  MEGA_CAP_SYMS,
  pctFromOpen,
} from './soxxConstituents';

const pctColor = pct =>
  pct == null
    ? theme.colors.gray500
    : pct >= 0
      ? theme.colors.success
      : theme.colors.error;

// Small centered bar for a signed % (mirrors the SoxxMovers Bar aesthetic).
const HeatBar = memo(({ pct, scale = 1.5 }) => {
  const w = Math.min(100, (Math.abs(pct) / scale) * 100);
  return (
    <div style={{ position: 'relative', height: 4, background: theme.colors.gray200, borderRadius: 2 }}>
      <div
        style={{
          position: 'absolute',
          left: pct >= 0 ? '50%' : `${50 - w / 2}%`,
          width: `${w / 2}%`,
          height: 4,
          background: pctColor(pct),
          borderRadius: 2,
        }}
      />
    </div>
  );
});

const Section = ({ label, children }) => (
  <div style={{ marginBottom: theme.spacing.md }}>
    <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
      {label}
    </div>
    {children}
  </div>
);

const ROT_WINDOWS = ['30d', '1Q', '2Q', '1Y']; // trailing windows for the rotation trend

// Fixed per-sub-sector colors so the overlaid chart and the legend below agree.
const SECTOR_COLORS = {
  'GPU/AI': '#16a34a',
  Memory: '#9333ea',
  Equipment: '#ea580c',
  Connectivity: '#0891b2',
  'Analog/Power': '#dc2626',
  'Foundry/CPU': '#ca8a04',
};
const SECTOR_ABBR = {
  'GPU/AI': 'GPU',
  Memory: 'Mem',
  Equipment: 'Equip',
  Connectivity: 'Conn',
  'Analog/Power': 'Analog',
  'Foundry/CPU': 'Foundry',
};
const SPY_COLOR = '#64748b';

// Overlaid multi-line rotation chart — every sub-sector + SPY on ONE set of axes
// (rebased to 0 at the window start), colored, with de-overlapped end labels
// carrying each line's total return. Reads the rotation story at a glance:
// divergence, crossovers, who's pulling away vs rolling over. Width auto-fits.
const SectorRotationChart = ({ sectors, benchmark, min, max }) => {
  const ref = useRef(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setW(Math.max(280, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 210;
  const padL = 34;
  const padR = 88;
  const padT = 12;
  const padB = 18;
  const n = (benchmark && benchmark.series && benchmark.series.length) || 0;
  const plotW = Math.max(20, w - padL - padR);
  const plotH = H - padT - padB;
  const span = max - min || 1;
  const xAt = i => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = v => padT + (1 - (v - min) / span) * plotH;
  const pathOf = s => s.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.pct).toFixed(1)}`).join(' ');

  const lines = [
    { name: 'SPY', abbr: 'SPY', color: SPY_COLOR, dashed: true, series: benchmark.series, cum: benchmark.cum },
    ...sectors.map(s => ({ name: s.name, abbr: SECTOR_ABBR[s.name] || s.name, color: SECTOR_COLORS[s.name] || '#475569', dashed: false, series: s.series, cum: s.cum })),
  ];
  // de-overlap the end labels vertically
  const labels = lines.map(l => ({ ...l, ly: yAt(l.series[l.series.length - 1].pct) })).sort((a, b) => a.ly - b.ly);
  const gap = 13;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].ly - labels[i - 1].ly < gap) labels[i].ly = labels[i - 1].ly + gap;
  }
  const overflow = labels.length ? labels[labels.length - 1].ly - (padT + plotH) : 0;
  if (overflow > 0) labels.forEach(l => (l.ly -= overflow));
  const zeroY = yAt(0);

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {n < 2 ? (
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>not enough history</div>
      ) : (
        <svg width={w} height={H} style={{ display: 'block' }}>
          {min < 0 && max > 0 && (
            <line x1={padL} y1={zeroY} x2={padL + plotW} y2={zeroY} stroke={theme.colors.gray300} strokeWidth="1" strokeDasharray="3 3" />
          )}
          <text x={padL - 5} y={padT + 3} textAnchor="end" fontSize="9" fill={theme.colors.gray400} fontFamily="monospace">
            {max >= 0 ? '+' : ''}{max.toFixed(0)}%
          </text>
          <text x={padL - 5} y={padT + plotH} textAnchor="end" fontSize="9" fill={theme.colors.gray400} fontFamily="monospace">
            {min.toFixed(0)}%
          </text>
          {lines.map(l => (
            <path
              key={l.name}
              d={pathOf(l.series)}
              fill="none"
              stroke={l.color}
              strokeWidth={l.dashed ? 1.5 : 2}
              strokeDasharray={l.dashed ? '4 3' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={l.dashed ? 0.75 : 0.95}
            />
          ))}
          {labels.map(l => (
            <text key={l.name} x={padL + plotW + 6} y={l.ly + 3} fontSize="10" fontWeight="700" fill={l.color} fontFamily="monospace">
              {l.abbr} {l.cum >= 0 ? '+' : ''}{l.cum.toFixed(0)}%
            </text>
          ))}
        </svg>
      )}
    </div>
  );
};

// SOXX Internals — breadth, sub-sector rotation, and leadership/concentration,
// all derived from the shared constituent quotes. Answers "what's driving SOXX".
const SoxxInternals = ({ quotes = {}, updatedAt }) => {
  const stats = useMemo(() => {
    let up = 0;
    let down = 0;
    let scored = 0;
    let wUp = 0;
    let wTotal = 0;
    let absContribTotal = 0;
    let megaAbsContrib = 0;
    const groups = new Map(); // group -> { wSum, wPctSum }

    for (const { sym, weight, group } of SOXX_TOP) {
      const pct = pctFromOpen(quotes[sym]);
      if (pct == null) continue;
      scored++;
      if (pct > 0) up++;
      else if (pct < 0) down++;
      wTotal += weight;
      if (pct > 0) wUp += weight;
      const contrib = (pct * weight) / 100;
      absContribTotal += Math.abs(contrib);
      if (MEGA_CAP_SYMS.includes(sym)) megaAbsContrib += Math.abs(contrib);
      const g = groups.get(group) || { wSum: 0, wPctSum: 0 };
      g.wSum += weight;
      g.wPctSum += weight * pct;
      groups.set(group, g);
    }

    const rotation = GROUP_ORDER.map(name => {
      const g = groups.get(name);
      return { name, pct: g && g.wSum > 0 ? g.wPctSum / g.wSum : null };
    })
      .filter(r => r.pct != null)
      .sort((a, b) => b.pct - a.pct);

    const megaShare = absContribTotal > 0 ? megaAbsContrib / absContribTotal : 0;

    return {
      up,
      down,
      scored,
      pctGreen: scored > 0 ? (up / scored) * 100 : null,
      wPctGreen: wTotal > 0 ? (wUp / wTotal) * 100 : null,
      rotation,
      megaShare,
      narrow: megaShare >= 0.5,
    };
  }, [quotes]);

  const loading = stats.scored === 0;

  // Rolling intraday breadth history (client-accumulated since page open; one
  // sample per 30s poll, capped ~1hr) → shows if participation is building or
  // rolling over.
  const [history, setHistory] = useState([]);
  useEffect(() => {
    if (!updatedAt || stats.pctGreen == null) return;
    const t = updatedAt.getTime ? updatedAt.getTime() : Date.now();
    setHistory(h =>
      h.length && h[h.length - 1].t === t
        ? h
        : [...h, { t, pct: stats.pctGreen }].slice(-120)
    );
  }, [updatedAt, stats.pctGreen]);

  const trend = useMemo(() => {
    if (history.length < 4) return null;
    const now = history[history.length - 1];
    const target = now.t - 20 * 60 * 1000; // ~20 min ago (or oldest we have)
    let past = history[0];
    for (const h of history) {
      if (h.t <= target) past = h;
      else break;
    }
    const delta = now.pct - past.pct;
    const label = delta > 5 ? 'building' : delta < -5 ? 'fading' : 'stable';
    const color =
      delta > 5 ? theme.colors.success : delta < -5 ? theme.colors.error : theme.colors.gray600;
    return {
      delta,
      label,
      color,
      mins: Math.max(1, Math.round((now.t - past.t) / 60000)),
      points: history.map(h => h.pct),
    };
  }, [history]);

  // Sub-sector rotation OVER TIME (vs SPY) — lazily fetched only when expanded.
  const [showDetails, setShowDetails] = useState(false);
  const [sectorWindow, setSectorWindow] = useState('30d');
  const [sectorHist, setSectorHist] = useState(null);
  const [histErr, setHistErr] = useState(null);
  useEffect(() => {
    if (!showDetails) return undefined;
    let cancelled = false;
    setSectorHist(null); // show loading while the new window fetches
    setHistErr(null);
    (async () => {
      try {
        const res = await fetch(`/api/soxx/sector-history?window=${sectorWindow}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setSectorHist(json);
      } catch (e) {
        if (!cancelled) setHistErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showDetails, sectorWindow]);

  const histView = useMemo(() => {
    if (!sectorHist || !sectorHist.sectors?.length || !sectorHist.benchmark) return null;
    const spy = sectorHist.benchmark;
    const secs = sectorHist.sectors;
    const allPts = [spy.series, ...secs.map(s => s.series)].flatMap(sr => sr.map(p => p.pct));
    return {
      spy,
      secs,
      min: Math.min(0, ...allPts),
      max: Math.max(0, ...allPts),
      beat: secs.filter(s => s.vsSpy > 0).length,
      leader: secs[0],
      laggard: secs[secs.length - 1],
    };
  }, [sectorHist]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          SOXX Internals
        </h3>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: 'monospace' }}>
          {loading ? 'loading…' : `${stats.scored}/30 · ${updatedAt ? `${fmtET(updatedAt)} ET` : ''}`}
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          awaiting constituent quotes…
        </div>
      ) : (
        <>
          {/* Breadth */}
          <Section label="Breadth (advance / decline)">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.md, fontFamily: 'monospace', marginBottom: 6 }}>
              <span style={{ color: theme.colors.success, fontWeight: 700 }}>{stats.up} ▲</span>
              <span style={{ color: theme.colors.error, fontWeight: 700 }}>{stats.down} ▼</span>
              <span style={{ color: theme.colors.gray600, fontSize: theme.typography.fontSize.xs }}>
                {stats.pctGreen.toFixed(0)}% green · {stats.wPctGreen.toFixed(0)}% by weight
              </span>
            </div>
            <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: theme.colors.error }}>
              <div style={{ width: `${stats.pctGreen}%`, background: theme.colors.success }} />
            </div>
          </Section>

          {/* Intraday breadth trend */}
          <Section label="Breadth trend (intraday)">
            {trend ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md }}>
                <Sparkline points={trend.points} min={0} max={100} midline={50} />
                <div style={{ fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                  <span style={{ color: trend.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {trend.label}
                  </span>
                  <div style={{ color: theme.colors.gray500, marginTop: 2 }}>
                    {trend.delta >= 0 ? '+' : ''}{trend.delta.toFixed(0)} pts vs {trend.mins}m ago
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                gathering… (builds over the session)
              </div>
            )}
          </Section>

          {/* Sub-sector rotation */}
          <Section label="Sub-sector rotation (weighted)">
            <div style={{ display: 'grid', gap: 4 }}>
              {stats.rotation.map(({ name, pct }) => (
                <div key={name} style={{ display: 'grid', gridTemplateColumns: '110px 60px 1fr', gap: 8, alignItems: 'center', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                  <div style={{ color: theme.colors.gray700 }}>{name}</div>
                  <div style={{ textAlign: 'right', color: pctColor(pct), fontWeight: 600 }}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </div>
                  <HeatBar pct={pct} />
                </div>
              ))}
            </div>
          </Section>

          {/* Leadership / concentration */}
          <Section label="Leadership">
            <div style={{ fontSize: theme.typography.fontSize.sm }}>
              <span
                style={{
                  fontWeight: 700,
                  color: stats.narrow ? theme.colors.warningDark : theme.colors.success,
                }}
              >
                {stats.narrow ? 'Narrow — mega-cap led' : 'Broad participation'}
              </span>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600, marginTop: 2, fontFamily: 'monospace' }}>
                NVDA/AVGO/AMD drive {(stats.megaShare * 100).toFixed(0)}% of the move
                {stats.narrow ? ' — fragile if they roll' : ' — broad-based'}
              </div>
            </div>
          </Section>

          {/* Sub-sector rotation over time (expandable) — the trajectory behind the
              snapshot above: which pockets are being bought vs sold, and vs SPY. */}
          <button
            onClick={() => setShowDetails(v => !v)}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderTop: `1px solid ${theme.colors.gray200}`,
              paddingTop: theme.spacing.sm,
              color: theme.colors.gray600,
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.xs,
              fontWeight: theme.typography.fontWeight.medium,
              textAlign: 'left',
            }}
          >
            {showDetails ? '▴ Hide sub-sector trend' : '▾ Show sub-sector trend over time (vs SPY)'}
          </button>
          {showDetails && (
            <div style={{ marginTop: theme.spacing.sm }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
                {ROT_WINDOWS.map(w => {
                  const active = sectorWindow === w;
                  return (
                    <button
                      key={w}
                      onClick={() => setSectorWindow(w)}
                      style={{
                        padding: '2px 10px',
                        fontSize: theme.typography.fontSize.xs,
                        fontWeight: active ? 700 : 500,
                        color: active ? '#fff' : theme.colors.gray700,
                        background: active ? theme.colors.primary : theme.colors.gray100,
                        border: 'none',
                        borderRadius: 10,
                        cursor: 'pointer',
                      }}
                    >
                      {w}
                    </button>
                  );
                })}
                <span style={{ fontSize: '10px', color: theme.colors.gray400, marginLeft: 2 }}>trailing window</span>
              </div>
              {histErr ? (
                <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                  rotation history unavailable ({histErr})
                </div>
              ) : !histView ? (
                <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                  loading rotation history…
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '9px', color: theme.colors.gray400, fontFamily: 'monospace', marginBottom: 2 }}>
                    cumulative % since {sectorHist.from}, rebased to 0 · {sectorHist.window} ({sectorHist.sessions}d)
                  </div>
                  <SectorRotationChart sectors={histView.secs} benchmark={histView.spy} min={histView.min} max={histView.max} />
                  {/* color-matched ranked legend with the precise numbers */}
                  <div style={{ marginTop: 4 }}>
                    {[{ name: 'SPY', cum: histView.spy.cum, vsSpy: null, members: null }, ...histView.secs].map(r => {
                      const color = r.name === 'SPY' ? SPY_COLOR : SECTOR_COLORS[r.name] || theme.colors.gray500;
                      return (
                        <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '14px 1fr 58px 56px', gap: 8, alignItems: 'center', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs, padding: '1px 0' }}>
                          <span style={{ width: 11, height: 3, borderRadius: 2, background: color, opacity: r.name === 'SPY' ? 0.75 : 1 }} />
                          <span style={{ color: theme.colors.gray700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.name === 'SPY' ? 'SPY' : r.name}
                            {r.members != null && <span style={{ color: theme.colors.gray400 }}> ({r.members})</span>}
                            {r.name === 'SPY' && <span style={{ color: theme.colors.gray400 }}> mkt</span>}
                          </span>
                          <span style={{ textAlign: 'right', color: pctColor(r.cum), fontWeight: 600 }}>{r.cum >= 0 ? '+' : ''}{r.cum.toFixed(1)}%</span>
                          <span style={{ textAlign: 'right', color: r.vsSpy == null ? theme.colors.gray400 : pctColor(r.vsSpy) }} title={r.vsSpy == null ? 'benchmark' : 'lead/lag vs SPY'}>
                            {r.vsSpy == null ? 'bench' : `${r.vsSpy >= 0 ? '+' : ''}${r.vsSpy.toFixed(1)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: '10px', color: theme.colors.gray500, fontFamily: 'monospace', marginTop: 6 }}>
                    {histView.leader.name} leading · {histView.laggard.name} lagging · {histView.beat}/{histView.secs.length} beat SPY over {sectorHist.window}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export default memo(SoxxInternals);
