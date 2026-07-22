import { useState, useEffect, memo } from 'react';
import theme from '../../theme';

const SYMBOLS = [
  { sym: 'SPY',  label: 'S&P' },
  { sym: 'QQQ',  label: 'NDX' },
  { sym: 'IWM',  label: 'RUT' },
  { sym: 'DIA',  label: 'DJI' },
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
  const color = pct == null
    ? theme.colors.gray500
    : pct >= 0 ? theme.colors.successMuted : theme.colors.errorMuted;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '0 16px',
        position: 'relative',
      }}
    >
      <span
        style={{
          fontSize: '0.7rem',
          color: theme.colors.gray500,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: theme.typography.fontFamilyMono,
          fontWeight: 600,
          color: theme.colors.charcoal,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {loading || last == null ? '—' : Number(last).toFixed(2)}
      </span>
      <span
        style={{
          fontFamily: theme.typography.fontFamilyMono,
          fontSize: '0.85rem',
          color,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
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
            const res = await fetch(`/api/quote/${encodeURIComponent(target)}`);
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
        alignItems: 'baseline',
        padding: '10px 0',
        borderTop: `1px solid ${theme.colors.ruler}`,
        borderBottom: `1px solid ${theme.colors.ruler}`,
        gap: 0,
      }}
    >
      {SYMBOLS.map(({ sym, label }, idx) => (
        <span key={sym} style={{ display: 'inline-flex', alignItems: 'baseline' }}>
          <Cell label={label} quote={quotes[sym]} loading={loading} />
          {idx < SYMBOLS.length - 1 && (
            <span style={{ color: theme.colors.ruler, fontFamily: theme.typography.fontFamilyMono }}>│</span>
          )}
        </span>
      ))}
    </div>
  );
};

export default memo(MarketStrip);
