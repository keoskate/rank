import { memo, useMemo } from 'react';
import theme from '../../theme';

const formatMoney = (n, opts = {}) => {
  const { showSign = false, decimals = 2 } = opts;
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const sign = showSign && num >= 0 ? '+' : '';
  return `${sign}$${num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

const formatQty = n => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return Math.abs(num) < 1 ? num.toFixed(6) : num.toLocaleString('en-US');
};

const formatTime = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const cell = {
  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
  fontSize: theme.typography.fontSize.sm,
  fontFamily: 'monospace',
  borderBottom: `1px solid ${theme.colors.gray100}`,
  whiteSpace: 'nowrap',
};

const headerCell = {
  ...cell,
  fontWeight: theme.typography.fontWeight.semibold,
  fontSize: theme.typography.fontSize.xs,
  color: theme.colors.gray500,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontFamily: 'inherit',
  borderBottom: `2px solid ${theme.colors.gray200}`,
  backgroundColor: theme.colors.gray50 || theme.colors.gray100,
};

const TodaysTradeLedger = ({ orders, loading, error }) => {
  // Filter to today's filled orders (local-time today midnight onward)
  const todays = useMemo(() => {
    if (!orders || orders.length === 0) return [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    return orders
      .filter(o => {
        if (o.status !== 'filled') return false;
        const t = new Date(
          o.createdAt || o.created_at || o.filledAt || o.filled_at
        ).getTime();
        return Number.isFinite(t) && t >= startMs;
      })
      .sort((a, b) => {
        const ta = new Date(a.createdAt || a.created_at).getTime();
        const tb = new Date(b.createdAt || b.created_at).getTime();
        return tb - ta; // most recent first
      });
  }, [orders]);

  const summary = useMemo(() => {
    const buys = todays.filter(o => o.side === 'buy').length;
    const sells = todays.filter(o => o.side === 'sell').length;
    return { count: todays.length, buys, sells };
  }, [todays]);

  return (
    <div
      style={{
        marginBottom: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        border: `1px solid ${theme.colors.gray200}`,
        borderRadius: theme.borderRadius.md,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: `${theme.spacing.sm} ${theme.spacing.md}`,
          borderBottom: `1px solid ${theme.colors.gray200}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.semibold,
            color: theme.colors.gray700,
          }}
        >
          Today&apos;s Trades
          {summary.count > 0 && (
            <span
              style={{
                marginLeft: 8,
                color: theme.colors.gray500,
                fontWeight: theme.typography.fontWeight.normal,
              }}
            >
              ({summary.count} fill{summary.count !== 1 ? 's' : ''}:{' '}
              {summary.buys} buy / {summary.sells} sell)
            </span>
          )}
        </div>
      </div>

      {error ? (
        <div
          style={{
            padding: theme.spacing.md,
            color: theme.colors.error,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          Orders unavailable: {String(error)}
        </div>
      ) : loading && todays.length === 0 ? (
        <div
          style={{
            padding: theme.spacing.md,
            color: theme.colors.gray500,
            fontSize: theme.typography.fontSize.sm,
            fontFamily: 'monospace',
          }}
        >
          Loading orders…
        </div>
      ) : todays.length === 0 ? (
        <div
          style={{
            padding: theme.spacing.md,
            color: theme.colors.gray500,
            fontSize: theme.typography.fontSize.sm,
            fontStyle: 'italic',
          }}
        >
          No fills today
        </div>
      ) : (
        <div style={{ maxHeight: 360, overflowY: 'auto', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ ...headerCell, textAlign: 'left' }}>Time</th>
                <th style={{ ...headerCell, textAlign: 'left' }}>Symbol</th>
                <th style={{ ...headerCell, textAlign: 'left' }}>Side</th>
                <th style={{ ...headerCell, textAlign: 'right' }}>Qty</th>
                <th style={{ ...headerCell, textAlign: 'right' }}>
                  Fill Price
                </th>
                <th style={{ ...headerCell, textAlign: 'right' }}>Notional</th>
              </tr>
            </thead>
            <tbody>
              {todays.map(o => {
                const qty = Number(o.filledQty || o.filled_qty || o.quantity);
                const fillPrice = Number(
                  o.filledAvgPrice || o.filled_avg_price
                );
                const notional =
                  Number.isFinite(qty) && Number.isFinite(fillPrice)
                    ? qty * fillPrice
                    : NaN;
                const side = (o.side || '').toLowerCase();
                const sideColor =
                  side === 'buy'
                    ? theme.colors.success
                    : side === 'sell'
                      ? theme.colors.error
                      : theme.colors.gray700;
                return (
                  <tr key={o.id}>
                    <td style={cell}>
                      {formatTime(o.createdAt || o.created_at)}
                    </td>
                    <td
                      style={{
                        ...cell,
                        fontWeight: theme.typography.fontWeight.semibold,
                      }}
                    >
                      {o.symbol}
                    </td>
                    <td
                      style={{
                        ...cell,
                        color: sideColor,
                        textTransform: 'uppercase',
                        fontWeight: theme.typography.fontWeight.semibold,
                      }}
                    >
                      {side}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {formatQty(qty)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {formatMoney(fillPrice)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {formatMoney(notional)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default memo(TodaysTradeLedger);
