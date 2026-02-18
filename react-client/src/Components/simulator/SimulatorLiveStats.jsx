/**
 * SimulatorLiveStats Component
 *
 * Real-time display of price, day %, cash, trades, and position during simulation.
 */

import theme from '../../theme';

const SimulatorLiveStats = ({
  currentPrice,
  dayOpen,
  preMarketInfo,
  portfolio,
}) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.md,
      }}
    >
      {/* Price */}
      <div
        style={{
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.gray50,
          borderRadius: theme.borderRadius.sm,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          Price
        </div>
        <div
          style={{
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold,
            color: currentPrice >= dayOpen ? theme.colors.success : theme.colors.error,
          }}
        >
          ${currentPrice.toFixed(2)}
        </div>
      </div>

      {/* Day % */}
      <div
        style={{
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.gray50,
          borderRadius: theme.borderRadius.sm,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          Day %
        </div>
        <div
          style={{
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold,
            color: currentPrice >= dayOpen ? theme.colors.success : theme.colors.error,
          }}
        >
          {dayOpen > 0
            ? `${(((currentPrice - dayOpen) / dayOpen) * 100).toFixed(2)}%`
            : '--'}
        </div>
        {preMarketInfo?.hasGap && (
          <div
            style={{
              fontSize: '10px',
              color: parseFloat(preMarketInfo.gapPercent) > 0 ? theme.colors.success : theme.colors.error,
              marginTop: '2px',
            }}
          >
            Gap: {preMarketInfo.gapPercent > 0 ? '+' : ''}{preMarketInfo.gapPercent}%
          </div>
        )}
      </div>

      {/* Cash */}
      <div
        style={{
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.gray50,
          borderRadius: theme.borderRadius.sm,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          Cash
        </div>
        <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold }}>
          ${portfolio.cash.toFixed(0)}
        </div>
      </div>

      {/* Trades */}
      <div
        style={{
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.gray50,
          borderRadius: theme.borderRadius.sm,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          Trades
        </div>
        <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold }}>
          {portfolio.trades.length}
        </div>
      </div>

      {/* Position */}
      <div
        style={{
          padding: theme.spacing.sm,
          backgroundColor:
            portfolio.positions.length > 0
              ? `${theme.colors.info}15`
              : theme.colors.gray50,
          borderRadius: theme.borderRadius.sm,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          Position
        </div>
        <div
          style={{
            fontSize: theme.typography.fontSize.md,
            fontWeight: theme.typography.fontWeight.bold,
            color: portfolio.positions.length > 0 ? theme.colors.info : theme.colors.gray400,
          }}
        >
          {portfolio.positions.length > 0 ? `${portfolio.positions[0].quantity} shs` : 'None'}
        </div>
      </div>
    </div>
  );
};

export default SimulatorLiveStats;
