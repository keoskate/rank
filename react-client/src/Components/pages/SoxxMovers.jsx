import { useState, useEffect, useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';
import { SOXX_TOP, pctFromOpen } from './soxxConstituents';

// How many rows to show before the user expands.
const COLLAPSED_COUNT = 12;

const rate = pct => {
  if (pct == null || !Number.isFinite(pct)) return { label: '—', color: theme.colors.gray500, bg: 'transparent' };
  if (pct >= 2.0) return { label: 'BUY',   color: '#fff', bg: theme.colors.success };
  if (pct >= 0.5) return { label: 'BUY?',  color: theme.colors.successDark, bg: theme.colors.successLight };
  if (pct <= -2.0) return { label: 'SELL', color: '#fff', bg: theme.colors.error };
  if (pct <= -0.5) return { label: 'SELL?', color: theme.colors.errorDark, bg: theme.colors.errorLight };
  return { label: 'HOLD', color: theme.colors.gray700, bg: theme.colors.gray200 };
};

const fmtMcap = b => {
  if (b == null) return '—';
  if (b >= 1000) return `$${(b / 1000).toFixed(2)}T`;
  return `$${b}B`;
};

const REFRESH_MS = 30000;

const Bar = memo(({ pct, magnitude }) => {
  const widthPct = Math.min(100, Math.abs(magnitude) / 0.4 * 100);
  const color = pct >= 0 ? theme.colors.success : theme.colors.error;
  return (
    <div style={{ position: 'relative', height: 4, background: theme.colors.gray200, borderRadius: 2, marginTop: 2 }}>
      <div
        style={{
          position: 'absolute',
          left: pct >= 0 ? '50%' : `${50 - widthPct / 2}%`,
          width: `${widthPct / 2}%`,
          height: 4,
          background: color,
          borderRadius: 2,
        }}
      />
    </div>
  );
});

// Accepts a shared `quotes` map from the parent (Command Center fetches the 30
// constituent quotes once for both this and SoxxInternals). Falls back to
// fetching them itself when rendered standalone.
const SoxxMovers = ({ quotes: quotesProp, updatedAt: updatedAtProp } = {}) => {
  const usingProp = quotesProp != null;
  const [selfQuotes, setSelfQuotes] = useState({});
  const [selfUpdatedAt, setSelfUpdatedAt] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const quotes = usingProp ? quotesProp : selfQuotes;
  const updatedAt = usingProp ? updatedAtProp : selfUpdatedAt;
  const loading = Object.keys(quotes || {}).length === 0;

  useEffect(() => {
    if (usingProp) return; // parent supplies the quotes
    let cancelled = false;
    const fetchAll = async () => {
      const results = await Promise.all(
        SOXX_TOP.map(async ({ sym }) => {
          try {
            const res = await fetch(`/api/quote/${sym}`);
            if (!res.ok) return [sym, null];
            const data = await res.json();
            return [sym, data];
          } catch {
            return [sym, null];
          }
        })
      );
      if (cancelled) return;
      setSelfQuotes(Object.fromEntries(results));
      setSelfUpdatedAt(new Date());
    };
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [usingProp]);

  const rows = useMemo(() => {
    return SOXX_TOP.map(({ sym, weight, mcapB }) => {
      const q = quotes[sym];
      const pct = pctFromOpen(q);
      const contribution = pct == null ? null : (pct * weight) / 100;
      return { sym, weight, mcapB, last: q?.last ?? q?.close, pct, contribution };
    }).sort((a, b) => {
      if (a.contribution == null && b.contribution == null) return 0;
      if (a.contribution == null) return 1;
      if (b.contribution == null) return -1;
      return Math.abs(b.contribution) - Math.abs(a.contribution);
    });
  }, [quotes]);

  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);
  const totalContribution = visibleRows.reduce(
    (sum, r) => sum + (r.contribution || 0),
    0
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          SOXX Movers
        </h3>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: 'monospace' }}>
          {loading ? 'loading…' : (
            <>
              top-{visibleRows.length} sum:{' '}
              <span style={{ color: totalContribution >= 0 ? theme.colors.success : theme.colors.error, fontWeight: 700 }}>
                {totalContribution >= 0 ? '+' : ''}{totalContribution.toFixed(2)}%
              </span>
              {' '}· {updatedAt ? `${fmtET(updatedAt)} ET` : ''}
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '55px 50px 60px 65px 70px 60px 1fr', gap: 6, fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, paddingBottom: 4, borderBottom: `1px solid ${theme.colors.gray200}` }}>
        <div>Ticker</div>
        <div style={{ textAlign: 'right' }}>Wt%</div>
        <div style={{ textAlign: 'right' }}>Mcap</div>
        <div style={{ textAlign: 'right' }}>Last</div>
        <div style={{ textAlign: 'right' }}>Day%</div>
        <div style={{ textAlign: 'center' }}>Sig</div>
        <div style={{ textAlign: 'right' }}>Contrib %</div>
      </div>
      <div>
        {visibleRows.map(({ sym, weight, mcapB, last, pct, contribution }) => {
          const pctColor = pct == null ? theme.colors.gray500 : pct >= 0 ? theme.colors.success : theme.colors.error;
          const r = rate(pct);
          return (
            <div key={sym} style={{ display: 'grid', gridTemplateColumns: '55px 50px 60px 65px 70px 60px 1fr', gap: 6, padding: '4px 0', alignItems: 'center', fontFamily: 'monospace', fontSize: theme.typography.fontSize.sm }}>
              <div style={{ fontWeight: 700 }}>{sym}</div>
              <div style={{ textAlign: 'right', color: theme.colors.gray600, fontSize: theme.typography.fontSize.xs }}>
                {weight.toFixed(1)}
              </div>
              <div style={{ textAlign: 'right', color: theme.colors.gray600, fontSize: theme.typography.fontSize.xs }}>
                {fmtMcap(mcapB)}
              </div>
              <div style={{ textAlign: 'right', color: theme.colors.gray700, fontSize: theme.typography.fontSize.xs }}>
                {last != null ? `$${Number(last).toFixed(2)}` : '—'}
              </div>
              <div style={{ textAlign: 'right', color: pctColor, fontWeight: 600 }}>
                {pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
              </div>
              <div style={{ textAlign: 'center' }}>
                <span
                  title="Heuristic: day% bands (>=2% BUY, >=0.5% BUY?, <=-0.5% SELL?, <=-2% SELL, else HOLD)"
                  style={{ background: r.bg, color: r.color, padding: '2px 6px', borderRadius: 3, fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em' }}
                >
                  {r.label}
                </span>
              </div>
              <div>
                <div style={{ textAlign: 'right', color: pctColor, fontWeight: 600, fontSize: theme.typography.fontSize.xs }}>
                  {contribution == null ? '—' : `${contribution >= 0 ? '+' : ''}${contribution.toFixed(3)}`}
                </div>
                {contribution != null && <Bar pct={pct} magnitude={contribution} />}
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: theme.spacing.sm,
            width: '100%',
            padding: '6px',
            border: `1px solid ${theme.colors.gray200}`,
            borderRadius: 4,
            background: 'transparent',
            color: theme.colors.gray600,
            cursor: 'pointer',
            fontSize: theme.typography.fontSize.xs,
            fontFamily: 'monospace',
            letterSpacing: '0.04em',
          }}
        >
          {expanded
            ? '▲ Show top 12'
            : `▼ Show all ${rows.length} constituents`}
        </button>
      )}
    </Card>
  );
};

export default memo(SoxxMovers);
