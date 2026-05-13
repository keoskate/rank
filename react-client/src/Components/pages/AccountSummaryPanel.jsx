import { memo } from 'react';
import theme from '../../theme';

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

const Stat = memo(({ label, value, sub, valueColor, mono = true }) => (
  <div
    style={{
      flex: 1,
      minWidth: 140,
      padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    }}
  >
    <div
      style={{
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.gray500,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 4,
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: theme.typography.fontSize.xl,
        fontWeight: theme.typography.fontWeight.semibold,
        color: valueColor || theme.colors.gray900,
        fontFamily: mono ? 'monospace' : 'inherit',
        lineHeight: 1.2,
      }}
    >
      {value}
    </div>
    {sub && (
      <div
        style={{
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.gray500,
          marginTop: 2,
          fontFamily: mono ? 'monospace' : 'inherit',
        }}
      >
        {sub}
      </div>
    )}
  </div>
));

const AccountSummaryPanel = ({ account, loading, error }) => {
  if (error) {
    return (
      <div
        style={{
          padding: theme.spacing.md,
          backgroundColor: `${theme.colors.error}15`,
          borderRadius: theme.borderRadius.md,
          marginBottom: theme.spacing.md,
          color: theme.colors.error,
          fontSize: theme.typography.fontSize.sm,
        }}
      >
        Account unavailable: {String(error)}
      </div>
    );
  }

  if (loading || !account) {
    return (
      <div
        style={{
          padding: theme.spacing.md,
          backgroundColor: theme.colors.gray100,
          borderRadius: theme.borderRadius.md,
          marginBottom: theme.spacing.md,
          color: theme.colors.gray500,
          fontSize: theme.typography.fontSize.sm,
          fontFamily: 'monospace',
        }}
      >
        Loading account…
      </div>
    );
  }

  const equity = parseFloat(account.equity);
  const lastEquity = parseFloat(account.last_equity);
  const cash = parseFloat(account.cash);
  const buyingPower = parseFloat(account.buying_power);
  const dayChange =
    Number.isFinite(equity) && Number.isFinite(lastEquity)
      ? equity - lastEquity
      : NaN;
  const dayChangePct =
    Number.isFinite(dayChange) && lastEquity > 0
      ? (dayChange / lastEquity) * 100
      : NaN;
  const daytradeCount = Number(account.daytrade_count) || 0;
  const isPDT = !!account.pattern_day_trader;

  const dayColor = !Number.isFinite(dayChange)
    ? theme.colors.gray500
    : dayChange > 0
      ? theme.colors.success
      : dayChange < 0
        ? theme.colors.error
        : theme.colors.gray700;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0,
        backgroundColor: theme.colors.surface,
        border: `1px solid ${theme.colors.gray200}`,
        borderRadius: theme.borderRadius.md,
        marginBottom: theme.spacing.md,
        overflow: 'hidden',
      }}
    >
      <Stat label="Equity" value={formatMoney(equity)} />
      <Stat
        label="Day Change"
        value={formatMoney(dayChange, { showSign: true })}
        sub={Number.isFinite(dayChangePct) ? formatPct(dayChangePct) : null}
        valueColor={dayColor}
      />
      <Stat label="Cash" value={formatMoney(cash)} />
      <Stat label="Buying Power" value={formatMoney(buyingPower)} />
      <Stat
        label="Day Trades (5d)"
        value={`${daytradeCount}${isPDT ? ' / 4 PDT' : ''}`}
        sub={
          isPDT && daytradeCount >= 4
            ? 'PDT limit hit'
            : isPDT && daytradeCount === 3
              ? '1 trade left'
              : null
        }
        valueColor={
          isPDT && daytradeCount >= 4
            ? theme.colors.error
            : isPDT && daytradeCount === 3
              ? theme.colors.warning
              : theme.colors.gray900
        }
      />
    </div>
  );
};

export default memo(AccountSummaryPanel);
