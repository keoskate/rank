import { useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';

const GATE_PATTERNS = [
  { match: /Phase OPEN/i,       short: 'Phase OPEN',        why: 'Pre-10am — no entries' },
  { match: /Phase SETTLE/i,     short: 'Phase SETTLE',      why: 'Pre-10am — confirming direction' },
  { match: /WIND_DOWN/i,        short: 'WIND_DOWN',         why: '3:30+ ET — exits only' },
  { match: /AFTER_HOURS/i,      short: 'AFTER_HOURS',       why: 'Market closed' },
  { match: /PRE_MARKET/i,       short: 'PRE_MARKET',        why: 'Before 9:30 ET' },
  { match: /CLOSED/i,           short: 'CLOSED',            why: 'Outside trading hours' },
  { match: /SOXS.*after 2:30 PM/i, short: 'SOXS time cutoff', why: 'Volatility decay protection' },
  { match: /requires bullish sentiment/i, short: 'Bullish gate', why: 'Symbol needs bullish regime' },
  { match: /requires bearish sentiment/i, short: 'Bearish gate', why: 'Symbol needs bearish regime' },
  { match: /Cooldown/i,         short: 'Cooldown',          why: 'Re-entry too soon after sell' },
  { match: /counter-trend/i,    short: 'Counter-trend',     why: 'Regime mismatch' },
  { match: /Hard filter blocked/i, short: 'F1/F2 block',    why: 'Marginal-conf counter-trend' },
];

const classifyGate = msg => {
  for (const g of GATE_PATTERNS) {
    if (g.match.test(msg || '')) return g;
  }
  return null;
};

const fmtIndicator = (label, val, opts = {}) => {
  const { fixed = 1, suffix = '' } = opts;
  if (val == null || !Number.isFinite(+val)) return { label, value: '—', neutral: true };
  return { label, value: `${Number(val).toFixed(fixed)}${suffix}` };
};

const indicatorColor = (label, val) => {
  if (val == null || !Number.isFinite(+val)) return theme.colors.gray500;
  if (label === 'RSI') {
    if (val > 70) return theme.colors.error;
    if (val < 30) return theme.colors.success;
    if (val >= 50 && val <= 65) return theme.colors.info;
    return theme.colors.gray700;
  }
  if (label === 'Vol') return val >= 1.5 ? theme.colors.success : theme.colors.gray700;
  if (label === 'MACD') return val >= 0 ? theme.colors.success : theme.colors.error;
  return theme.colors.gray700;
};

const SymbolIndicators = memo(({ symbol, indicators }) => {
  if (!indicators) {
    return (
      <div style={{ flex: 1, minWidth: 220, padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray200}`, borderRadius: 4 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{symbol}</div>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>awaiting first evaluation…</div>
      </div>
    );
  }
  const row = [
    fmtIndicator('RSI', indicators.rsi, { fixed: 1 }),
    fmtIndicator('MACD', indicators.macd, { fixed: 3 }),
    fmtIndicator('Vol', indicators.volumeRatio, { fixed: 2, suffix: 'x' }),
    fmtIndicator('ADX', indicators.adx, { fixed: 1 }),
    fmtIndicator('BB%', indicators.bbPercentB != null ? indicators.bbPercentB * 100 : null, { fixed: 0, suffix: '%' }),
  ];
  return (
    <div style={{ flex: 1, minWidth: 220, padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray200}`, borderRadius: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontWeight: 700 }}>{symbol}</div>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: 'monospace' }}>
          {indicators.updatedAt ? new Date(indicators.updatedAt).toLocaleTimeString('en-US', { hour12: false }) : '—'}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
        {row.map(({ label, value }) => (
          <div key={label}>
            <div style={{ color: theme.colors.gray500 }}>{label}</div>
            <div style={{ color: indicatorColor(label, indicators[label === 'BB%' ? 'bbPercentB' : label === 'Vol' ? 'volumeRatio' : label.toLowerCase()]), fontWeight: 600 }}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

const GatesAndIndicatorsPanel = ({ logs, indicators, sentiment }) => {
  const recentGates = useMemo(() => {
    const counts = new Map();
    const ttl = 60 * 1000;
    const now = Date.now();
    for (const l of logs || []) {
      const t = l.timestamp ? new Date(l.timestamp).getTime() : 0;
      if (now - t > ttl) continue;
      const gate = classifyGate(l.message);
      if (!gate) continue;
      const entry = counts.get(gate.short) || { ...gate, count: 0, lastAt: 0 };
      entry.count++;
      entry.lastAt = Math.max(entry.lastAt, t);
      counts.set(gate.short, entry);
    }
    return Array.from(counts.values()).sort((a, b) => b.lastAt - a.lastAt);
  }, [logs]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          Gates &amp; Indicators
        </h3>
        {sentiment && (
          <div style={{ fontSize: theme.typography.fontSize.xs, fontFamily: 'monospace' }}>
            Regime:{' '}
            <span style={{ color: sentiment.direction === 'bullish' ? theme.colors.success : sentiment.direction === 'bearish' ? theme.colors.error : theme.colors.gray600, fontWeight: 700 }}>
              {sentiment.direction || '—'}
            </span>{' '}
            <span style={{ color: theme.colors.gray500 }}>
              {sentiment.confidence != null ? `(${Math.round(sentiment.confidence)}%)` : ''}
            </span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
        {Object.entries(indicators || {}).map(([sym, ind]) => (
          <SymbolIndicators key={sym} symbol={sym} indicators={ind} />
        ))}
        {(!indicators || Object.keys(indicators).length === 0) && (
          <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
            awaiting indicator data…
          </div>
        )}
      </div>
      <div style={{ borderTop: `1px solid ${theme.colors.gray200}`, paddingTop: theme.spacing.sm }}>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          Active blockers (last 60s)
        </div>
        {recentGates.length === 0 ? (
          <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
            nothing blocking — system is free to trade
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {recentGates.map(g => (
              <div
                key={g.short}
                title={g.why}
                style={{
                  padding: '4px 10px',
                  fontSize: theme.typography.fontSize.xs,
                  background: theme.colors.warningLight,
                  color: theme.colors.warningDark,
                  border: `1px solid ${theme.colors.warningBorder}`,
                  borderRadius: 12,
                  fontFamily: 'monospace',
                }}
              >
                {g.short} <span style={{ color: theme.colors.gray600 }}>×{g.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

export default memo(GatesAndIndicatorsPanel);
