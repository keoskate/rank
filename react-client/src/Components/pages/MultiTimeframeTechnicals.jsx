import { useState, useEffect, useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import DotHistory from '../common/DotHistory';

// Close-to-close daily direction from the 1D candles the panel already fetches.
// Neutral band ±0.15% matches server/scanner/recentDays.js so the dot strip
// reads the same up/flat/down as the options scanner.
const NEUTRAL_DAY_PCT = 0.15;
const dailyFromCandles = candles => {
  if (!Array.isArray(candles) || candles.length < 2) return [];
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const close = candles[i].close;
    if (!Number.isFinite(prev) || !Number.isFinite(close) || prev <= 0) continue;
    const pct = ((close - prev) / prev) * 100;
    out.push({
      date: candles[i].date,
      close,
      pct,
      dir: pct > NEUTRAL_DAY_PCT ? 1 : pct < -NEUTRAL_DAY_PCT ? -1 : 0,
    });
  }
  return out;
};

const TIMEFRAMES = [
  { label: '5m',  timeframe: '5',  unit: 'minute' },
  { label: '15m', timeframe: '15', unit: 'minute' },
  { label: '1H',  timeframe: '1',  unit: 'hour' },
  // 4H removed: the indicator engine returns no values for 4-hour bars.
  { label: '1D',  timeframe: '1',  unit: 'day' },
];

const REFRESH_MS = 60000;

const rsiColor = v => {
  if (v == null || !Number.isFinite(v)) return theme.colors.gray500;
  if (v >= 70) return theme.colors.error;
  if (v <= 30) return theme.colors.success;
  if (v >= 50 && v <= 65) return theme.colors.info;
  return theme.colors.gray700;
};

const trendBadge = side => {
  const isBull = side === 'bullish';
  const color = side === 'bullish' ? theme.colors.success : side === 'bearish' ? theme.colors.error : theme.colors.gray500;
  return (
    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color, marginRight: 4 }} />
  );
};

const MultiTimeframeTechnicals = ({ symbol = 'SOXL' }) => {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // Daily direction history from the 1D candles already in the response.
  const daily = useMemo(() => dailyFromCandles(data['1D']?.candles), [data]);
  const breakdown = useMemo(() => daily.slice(-20).reverse(), [daily]); // newest first

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const results = await Promise.all(
        TIMEFRAMES.map(async ({ label, timeframe, unit }) => {
          try {
            const res = await fetch(`/api/indicators/${symbol}?timeframe=${timeframe}&unit=${unit}`);
            if (!res.ok) return [label, null];
            const json = await res.json();
            return [label, json];
          } catch {
            return [label, null];
          }
        })
      );
      if (cancelled) return;
      setData(Object.fromEntries(results));
      setLoading(false);
    };
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          {symbol} Multi-Timeframe
        </h3>
        {loading && (
          <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>loading…</span>
        )}
      </div>
      {/* Daily direction — weekly-grouped, bright up/down shaded by move size;
          hover to expand into a ~6-month calendar. */}
      {daily.length > 1 && (
        <div style={{ marginBottom: theme.spacing.sm }}>
          <DotHistory series={daily} stripDays={30} weekly expandable maxMagnitude={8} size={12} gap={4} label="30d" />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '50px 60px 80px 80px 90px 90px', gap: 8, fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, paddingBottom: 4, borderBottom: `1px solid ${theme.colors.gray200}` }}>
        <div>TF</div>
        <div style={{ textAlign: 'right' }}>RSI</div>
        <div style={{ textAlign: 'right' }}>MACD</div>
        <div style={{ textAlign: 'right' }}>ADX</div>
        <div>Trend ST</div>
        <div>Trend Med</div>
      </div>
      {TIMEFRAMES.map(({ label }) => {
        const d = data[label];
        const indicators = d?.indicators;
        const rsi = indicators?.rsi?.value;
        const macdHist = indicators?.macd?.histogram;
        const adx = indicators?.adx?.value;
        const trendShort = indicators?.trend?.shortTerm;
        const trendMed = indicators?.trend?.mediumTerm;
        return (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '50px 60px 80px 80px 90px 90px', gap: 8, padding: '4px 0', alignItems: 'center', fontFamily: 'monospace', fontSize: theme.typography.fontSize.sm }}>
            <div style={{ fontWeight: 700 }}>{label}</div>
            <div style={{ textAlign: 'right', color: rsiColor(rsi), fontWeight: 600 }}>
              {rsi != null && Number.isFinite(rsi) ? rsi.toFixed(1) : '—'}
            </div>
            <div style={{ textAlign: 'right', color: macdHist == null ? theme.colors.gray500 : macdHist >= 0 ? theme.colors.success : theme.colors.error, fontWeight: 600 }}>
              {macdHist != null && Number.isFinite(macdHist) ? (macdHist >= 0 ? '+' : '') + macdHist.toFixed(3) : '—'}
            </div>
            <div style={{ textAlign: 'right', color: adx == null ? theme.colors.gray500 : adx >= 25 ? theme.colors.info : theme.colors.gray700, fontWeight: 600 }}>
              {adx != null && Number.isFinite(adx) ? adx.toFixed(1) : '—'}
            </div>
            <div style={{ color: theme.colors.gray800, fontSize: theme.typography.fontSize.xs, fontFamily: 'inherit' }}>
              {trendBadge(trendShort)} {trendShort || '—'}
            </div>
            <div style={{ color: theme.colors.gray800, fontSize: theme.typography.fontSize.xs, fontFamily: 'inherit' }}>
              {trendBadge(trendMed)} {trendMed || '—'}
            </div>
          </div>
        );
      })}

      {/* Expandable daily breakdown — "see more days" */}
      {breakdown.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              marginTop: theme.spacing.sm,
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
            {expanded ? '▴ Hide daily breakdown' : `▾ Daily breakdown (last ${breakdown.length} days)`}
          </button>
          {expanded && (
            <div style={{ marginTop: 6, display: 'grid', gap: 2 }}>
              {breakdown.map(d => (
                <div
                  key={d.date}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 70px 64px',
                    gap: 8,
                    alignItems: 'baseline',
                    fontFamily: theme.typography.fontFamilyMono,
                    fontSize: theme.typography.fontSize.xs,
                  }}
                >
                  <span style={{ color: theme.colors.gray600 }}>{d.date}</span>
                  <span style={{ textAlign: 'right', color: theme.colors.gray700 }}>
                    ${Number.isFinite(d.close) ? d.close.toFixed(2) : '—'}
                  </span>
                  <span
                    style={{
                      textAlign: 'right',
                      fontWeight: 700,
                      color: d.dir > 0 ? theme.colors.success : d.dir < 0 ? theme.colors.error : theme.colors.gray500,
                    }}
                  >
                    {d.pct >= 0 ? '+' : ''}{d.pct.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export default memo(MultiTimeframeTechnicals);
