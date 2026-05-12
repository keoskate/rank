import { useState, useEffect, memo } from 'react';
import theme from '../../theme';

const SYMBOLS = [
  { sym: 'SPY',  label: 'S&P' },
  { sym: 'QQQ',  label: 'NDX' },
  { sym: 'IWM',  label: 'Russ' },
  { sym: 'DIA',  label: 'Dow' },
  { sym: 'VIX',  label: 'VIX',  polygonOverride: 'I:VIX' },
  { sym: 'SOXX', label: 'SOXX' },
];

const REFRESH_MS = 30000;

const pctChange = quote => {
  if (!quote) return null;
  const last = Number(quote.last ?? quote.close);
  const ref = Number(quote.open ?? quote.prevClose);
  if (!Number.isFinite(last) || !Number.isFinite(ref) || ref === 0) return null;
  return ((last - ref) / ref) * 100;
};

const Cell = memo(({ label, quote, loading }) => {
  const last = quote?.last ?? quote?.close;
  const pct = pctChange(quote);
  const color = pct == null ? theme.colors.gray500 : pct >= 0 ? theme.colors.success : theme.colors.error;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingRight: theme.spacing.md, borderRight: `1px solid ${theme.colors.gray200}` }}>
      <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600, fontWeight: 600, letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ fontSize: theme.typography.fontSize.sm, fontFamily: 'monospace', fontWeight: 600 }}>
        {loading || last == null ? '—' : Number(last).toFixed(2)}
      </span>
      <span style={{ fontSize: theme.typography.fontSize.xs, fontFamily: 'monospace', color, fontWeight: 600 }}>
        {pct == null ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
      </span>
    </div>
  );
});

const MarketStrip = () => {
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const results = await Promise.all(
        SYMBOLS.map(async ({ sym, polygonOverride }) => {
          try {
            const target = polygonOverride || sym;
            const res = await fetch(`/api/polygon/quote/${encodeURIComponent(target)}`);
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
    };
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: theme.spacing.md,
        padding: `${theme.spacing.sm} ${theme.spacing.md}`,
        background: theme.colors.gray100,
        borderRadius: 4,
        border: `1px solid ${theme.colors.gray200}`,
      }}
    >
      {SYMBOLS.map(({ sym, label }) => (
        <Cell key={sym} label={label} quote={quotes[sym]} loading={loading} />
      ))}
    </div>
  );
};

export default memo(MarketStrip);
