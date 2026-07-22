import { useState, useEffect, useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';

// Market caps in $B — approximate, refreshed periodically. Used for context only.
const SOXX_TOP = [
  { sym: 'NVDA', weight: 9.5, mcapB: 5300 },
  { sym: 'AVGO', weight: 8.0, mcapB: 2000 },
  { sym: 'AMD',  weight: 7.5, mcapB: 750 },
  { sym: 'QCOM', weight: 5.0, mcapB: 270 },
  { sym: 'MU',   weight: 4.5, mcapB: 90 },
  { sym: 'INTC', weight: 4.5, mcapB: 600 },
  { sym: 'TXN',  weight: 4.5, mcapB: 270 },
  { sym: 'AMAT', weight: 4.0, mcapB: 360 },
  { sym: 'LRCX', weight: 4.0, mcapB: 390 },
  { sym: 'ADI',  weight: 4.0, mcapB: 200 },
  { sym: 'KLAC', weight: 4.0, mcapB: 250 },
  { sym: 'MRVL', weight: 3.5, mcapB: 150 },
];

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

const pctChange = quote => {
  if (!quote) return null;
  const last = Number(quote.last ?? quote.close);
  const ref = Number(quote.open ?? quote.prevClose);
  if (!Number.isFinite(last) || !Number.isFinite(ref) || ref === 0) return null;
  return ((last - ref) / ref) * 100;
};

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

const SoxxMovers = () => {
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
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
      setQuotes(Object.fromEntries(results));
      setLoading(false);
      setUpdatedAt(new Date());
    };
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const rows = useMemo(() => {
    return SOXX_TOP.map(({ sym, weight, mcapB }) => {
      const q = quotes[sym];
      const pct = pctChange(q);
      const contribution = pct == null ? null : (pct * weight) / 100;
      return { sym, weight, mcapB, last: q?.last ?? q?.close, pct, contribution };
    }).sort((a, b) => {
      if (a.contribution == null && b.contribution == null) return 0;
      if (a.contribution == null) return 1;
      if (b.contribution == null) return -1;
      return Math.abs(b.contribution) - Math.abs(a.contribution);
    });
  }, [quotes]);

  const totalContribution = rows.reduce(
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
              top-12 sum:{' '}
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
        {rows.map(({ sym, weight, mcapB, last, pct, contribution }) => {
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
    </Card>
  );
};

export default memo(SoxxMovers);
