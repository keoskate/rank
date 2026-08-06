import { memo, useState, useEffect } from 'react';
import theme from '../../theme';
import { fmtET } from '../../utils/timeFormat';

const formatMoney = (value, opts = {}) => {
  const { showSign = false, decimals = 2 } = opts;
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = showSign && num >= 0 ? '+' : '';
  return `${sign}$${num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

const formatPct = value => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const signColor = v =>
  !Number.isFinite(v) ? theme.colors.gray500 : v > 0 ? theme.colors.success : v < 0 ? theme.colors.error : theme.colors.gray700;

const Stat = memo(({ label, value, sub, valueColor, big }) => (
  <div style={{ flex: 1, minWidth: 150, padding: `${theme.spacing.sm} ${theme.spacing.md}` }}>
    <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
      {label}
    </div>
    <div style={{ fontSize: big ? theme.typography.fontSize.xxl : theme.typography.fontSize.xl, fontWeight: theme.typography.fontWeight.bold, color: valueColor || theme.colors.gray900, fontFamily: theme.typography.fontFamilyMono, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </div>
    {sub && (
      <div style={{ fontSize: theme.typography.fontSize.xs, color: valueColor || theme.colors.gray500, marginTop: 2, fontFamily: theme.typography.fontFamilyMono }}>
        {sub}
      </div>
    )}
  </div>
));

// "Tap to refresh" + live data-age (turns amber when stale). Account/positions
// are on a slow poll to spare the rate limit, so surfacing freshness matters.
const RefreshBar = ({ lastUpdated, onRefresh, now }) => {
  const ageSec = lastUpdated ? Math.max(0, Math.round((now - lastUpdated.getTime()) / 1000)) : null;
  const stale = ageSec != null && ageSec > 90;
  const ageLabel = ageSec == null ? '' : ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`;
  return (
    <button
      onClick={onRefresh}
      title="Tap to refresh account data"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: theme.typography.fontFamilyMono,
        fontSize: theme.typography.fontSize.xs,
        color: stale ? theme.colors.warningDark : theme.colors.gray500,
        padding: 0,
      }}
    >
      <span>{lastUpdated ? `as of ${fmtET(lastUpdated)} ET · ${ageLabel}` : 'tap to load'}</span>
      <span style={{ fontSize: '13px' }}>↻</span>
    </button>
  );
};

const cardStyle = {
  backgroundColor: theme.colors.surface,
  border: `1px solid ${theme.colors.gray200}`,
  borderRadius: theme.borderRadius.md,
  marginBottom: theme.spacing.md,
  overflow: 'hidden',
};

const AccountSummaryPanel = ({ account, baseValue, loading, error, lastUpdated, onRefresh }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <div style={{ ...cardStyle, padding: theme.spacing.md, color: theme.colors.error, fontSize: theme.typography.fontSize.sm, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Account unavailable: {String(error)}</span>
        <RefreshBar lastUpdated={lastUpdated} onRefresh={onRefresh} now={now} />
      </div>
    );
  }
  if (loading || !account) {
    return (
      <div style={{ ...cardStyle, padding: theme.spacing.md, color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm, fontFamily: 'monospace' }}>
        Loading account…
      </div>
    );
  }

  const equity = parseFloat(account.equity);
  const lastEquity = parseFloat(account.last_equity);
  const bv = Number(baseValue);
  const dayChange = Number.isFinite(equity) && Number.isFinite(lastEquity) ? equity - lastEquity : NaN;
  const dayChangePct = Number.isFinite(dayChange) && lastEquity > 0 ? (dayChange / lastEquity) * 100 : NaN;
  const lifetimePnL = Number.isFinite(equity) && Number.isFinite(bv) && bv > 0 ? equity - bv : NaN;
  const lifetimePnLPct = Number.isFinite(lifetimePnL) && bv > 0 ? (lifetimePnL / bv) * 100 : NaN;

  const cash = parseFloat(account.cash);
  const buyingPower = parseFloat(account.buying_power);
  const daytradeCount = Number(account.daytrade_count) || 0;
  const isPDT = !!account.pattern_day_trader;

  return (
    <div style={cardStyle}>
      {/* Freshness / tap-to-refresh */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: `6px ${theme.spacing.md} 0` }}>
        <RefreshBar lastUpdated={lastUpdated} onRefresh={onRefresh} now={now} />
      </div>

      {/* Investor snapshot — the three numbers that matter */}
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <Stat label="Fund Value" value={formatMoney(equity)} big />
        <Stat
          label="Day Change"
          value={formatMoney(dayChange, { showSign: true })}
          sub={Number.isFinite(dayChangePct) ? formatPct(dayChangePct) : null}
          valueColor={signColor(dayChange)}
          big
        />
        <Stat
          label="Lifetime P&L"
          value={Number.isFinite(lifetimePnL) ? formatMoney(lifetimePnL, { showSign: true }) : '—'}
          sub={Number.isFinite(lifetimePnLPct) ? formatPct(lifetimePnLPct) : 'since inception'}
          valueColor={signColor(lifetimePnL)}
          big
        />
      </div>

      {/* Trader detail — hidden by default (clean for sharing) */}
      <div style={{ borderTop: `1px solid ${theme.colors.gray100}` }}>
        <button
          onClick={() => setShowDetails(s => !s)}
          style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: `6px ${theme.spacing.md}`, color: theme.colors.gray500, fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.medium }}
        >
          {showDetails ? '▴ Hide account detail' : '▾ Account detail (cash · buying power · day trades)'}
        </button>
        {showDetails && (
          <div style={{ display: 'flex', flexWrap: 'wrap', paddingBottom: theme.spacing.xs }}>
            <Stat label="Cash" value={formatMoney(cash)} />
            <Stat label="Buying Power" value={formatMoney(buyingPower)} />
            <Stat
              label="Day Trades (5d)"
              value={`${daytradeCount}${isPDT ? ' / 4 PDT' : ''}`}
              sub={isPDT && daytradeCount >= 4 ? 'PDT limit hit' : isPDT && daytradeCount === 3 ? '1 trade left' : null}
              valueColor={isPDT && daytradeCount >= 4 ? theme.colors.error : isPDT && daytradeCount === 3 ? theme.colors.warningDark : theme.colors.gray900}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(AccountSummaryPanel);
