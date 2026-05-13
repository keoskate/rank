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

const formatPct = n => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const formatQty = n => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  // crypto qtys are decimal; equity qtys are whole
  return Math.abs(num) < 1 ? num.toFixed(6) : num.toLocaleString('en-US');
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

const OpenPositionsTable = ({ positions, loading, error }) => {
  const totals = useMemo(() => {
    if (!positions || positions.length === 0)
      return { unrealizedPL: 0, marketValue: 0 };
    return positions.reduce(
      (acc, p) => ({
        unrealizedPL: acc.unrealizedPL + (Number(p.unrealizedPL) || 0),
        marketValue: acc.marketValue + (Number(p.marketValue) || 0),
      }),
      { unrealizedPL: 0, marketValue: 0 }
    );
  }, [positions]);

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
          Open Positions
          {positions && positions.length > 0 && (
            <span
              style={{
                marginLeft: 8,
                color: theme.colors.gray500,
                fontWeight: theme.typography.fontWeight.normal,
              }}
            >
              ({positions.length})
            </span>
          )}
        </div>
        {positions && positions.length > 0 && (
          <div
            style={{
              fontSize: theme.typography.fontSize.sm,
              fontFamily: 'monospace',
              color:
                totals.unrealizedPL > 0
                  ? theme.colors.success
                  : totals.unrealizedPL < 0
                    ? theme.colors.error
                    : theme.colors.gray700,
            }}
          >
            Unrealized: {formatMoney(totals.unrealizedPL, { showSign: true })}
          </div>
        )}
      </div>

      {error ? (
        <div
          style={{
            padding: theme.spacing.md,
            color: theme.colors.error,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          Positions unavailable: {String(error)}
        </div>
      ) : loading ? (
        <div
          style={{
            padding: theme.spacing.md,
            color: theme.colors.gray500,
            fontSize: theme.typography.fontSize.sm,
            fontFamily: 'monospace',
          }}
        >
          Loading positions…
        </div>
      ) : !positions || positions.length === 0 ? (
        <div
          style={{
            padding: theme.spacing.md,
            color: theme.colors.gray500,
            fontSize: theme.typography.fontSize.sm,
            fontStyle: 'italic',
          }}
        >
          No open positions
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...headerCell, textAlign: 'left' }}>Symbol</th>
                <th style={{ ...headerCell, textAlign: 'right' }}>Qty</th>
                <th style={{ ...headerCell, textAlign: 'right' }}>Entry</th>
                <th style={{ ...headerCell, textAlign: 'right' }}>Current</th>
                <th style={{ ...headerCell, textAlign: 'right' }}>
                  Market Value
                </th>
                <th style={{ ...headerCell, textAlign: 'right' }}>
                  Unrealized
                </th>
                <th style={{ ...headerCell, textAlign: 'right' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => {
                const pl = Number(p.unrealizedPL);
                const plColor =
                  pl > 0
                    ? theme.colors.success
                    : pl < 0
                      ? theme.colors.error
                      : theme.colors.gray700;
                return (
                  <tr key={p.symbol}>
                    <td
                      style={{
                        ...cell,
                        fontWeight: theme.typography.fontWeight.semibold,
                      }}
                    >
                      {p.symbol}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {formatQty(p.quantity)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {formatMoney(p.avgEntryPrice)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {formatMoney(p.currentPrice)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {formatMoney(p.marketValue)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', color: plColor }}>
                      {formatMoney(p.unrealizedPL, { showSign: true })}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', color: plColor }}>
                      {formatPct(p.unrealizedPLPercent)}
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

export default memo(OpenPositionsTable);
