import { useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
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
        </>
      )}
    </Card>
  );
};

export default memo(SoxxInternals);
