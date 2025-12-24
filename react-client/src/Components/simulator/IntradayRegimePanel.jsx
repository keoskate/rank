/**
 * IntradayRegimePanel Component
 *
 * Displays the current intraday regime (bull/bear/sideways) with metrics
 * and history of regime changes.
 */

import theme from '../../theme';

const IntradayRegimePanel = ({ intradayRegime, lockedSymbols }) => {
  if (intradayRegime.regime === 'unknown') return null;

  const regimeColors = {
    bull: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
    bear: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
    sideways: { bg: '#fef9c3', border: '#eab308', text: '#854d0e' },
  };

  const colors = regimeColors[intradayRegime.regime] || regimeColors.sideways;

  return (
    <div
      style={{
        marginBottom: theme.spacing.md,
        padding: theme.spacing.md,
        backgroundColor: colors.bg,
        borderRadius: theme.borderRadius.md,
        border: `2px solid ${colors.border}`,
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing.sm,
      }}>
        <h4 style={{
          margin: 0,
          fontSize: theme.typography.fontSize.sm,
          color: colors.text,
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}>
          {intradayRegime.regime === 'bull' && '📈'}
          {intradayRegime.regime === 'bear' && '📉'}
          {intradayRegime.regime === 'sideways' && '↔️'}
          Intraday Regime: <strong>{intradayRegime.regime.toUpperCase()}</strong>
          <span style={{
            padding: '2px 8px',
            borderRadius: theme.borderRadius.sm,
            backgroundColor: 'white',
            fontSize: theme.typography.fontSize.xs,
          }}>
            {intradayRegime.confidence}% conf
          </span>
        </h4>
        <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.textMuted }}>
          Updated: {intradayRegime.lastUpdate || 'Pending'}
        </span>
      </div>

      {/* Regime Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: theme.spacing.sm,
        fontSize: theme.typography.fontSize.xs,
      }}>
        <MetricBox
          label="vs Open"
          value={`${intradayRegime.priceVsOpen > 0 ? '+' : ''}${intradayRegime.priceVsOpen}%`}
          valueColor={parseFloat(intradayRegime.priceVsOpen) > 0 ? '#22c55e' : parseFloat(intradayRegime.priceVsOpen) < 0 ? '#ef4444' : 'inherit'}
        />
        <MetricBox
          label="vs VWAP"
          value={`${intradayRegime.priceVsVwap > 0 ? '+' : ''}${intradayRegime.priceVsVwap}%`}
          valueColor={parseFloat(intradayRegime.priceVsVwap) > 0 ? '#22c55e' : parseFloat(intradayRegime.priceVsVwap) < 0 ? '#ef4444' : 'inherit'}
        />
        <MetricBox
          label="20m Mom"
          value={`${intradayRegime.momentum20 > 0 ? '+' : ''}${intradayRegime.momentum20}%`}
          valueColor={parseFloat(intradayRegime.momentum20) > 0 ? '#22c55e' : parseFloat(intradayRegime.momentum20) < 0 ? '#ef4444' : 'inherit'}
        />
        <MetricBox
          label="Trend"
          value={
            intradayRegime.trend === 'uptrend' ? '⬆️ Up' :
            intradayRegime.trend === 'downtrend' ? '⬇️ Down' : '➡️ Flat'
          }
        />
      </div>

      {/* Regime History */}
      {intradayRegime.history?.length > 1 && (
        <div style={{
          marginTop: theme.spacing.sm,
          padding: theme.spacing.xs,
          backgroundColor: 'white',
          borderRadius: theme.borderRadius.sm,
          fontSize: '10px',
        }}>
          <strong>Regime Changes:</strong>{' '}
          {intradayRegime.history.map((h, i) => (
            <span key={i} style={{
              padding: '2px 6px',
              marginLeft: '4px',
              borderRadius: '4px',
              backgroundColor: h.regime === 'bull' ? '#dcfce7' : h.regime === 'bear' ? '#fee2e2' : '#fef9c3',
            }}>
              {h.time}: {h.regime.toUpperCase()}
            </span>
          ))}
        </div>
      )}

      {/* ETF Mode Symbol Suggestion */}
      {lockedSymbols && lockedSymbols.length > 0 && (
        <div style={{
          marginTop: theme.spacing.sm,
          padding: theme.spacing.xs,
          backgroundColor: '#dbeafe',
          borderRadius: theme.borderRadius.sm,
          fontSize: theme.typography.fontSize.xs,
          color: '#1e40af',
        }}>
          <strong>ETF Mode Suggestion:</strong>{' '}
          {intradayRegime.regime === 'bull' && `Consider ${lockedSymbols[1] || lockedSymbols[0]} (bull ETF)`}
          {intradayRegime.regime === 'bear' && `Consider ${lockedSymbols[2] || lockedSymbols[0]} (bear ETF)`}
          {intradayRegime.regime === 'sideways' && 'Consider staying in cash - sideways regime detected'}
        </div>
      )}
    </div>
  );
};

// Helper component for metric boxes
const MetricBox = ({ label, value, valueColor }) => (
  <div style={{
    textAlign: 'center',
    padding: theme.spacing.xs,
    backgroundColor: 'white',
    borderRadius: theme.borderRadius.sm,
  }}>
    <div style={{ color: theme.colors.textMuted }}>{label}</div>
    <div style={{ fontWeight: 'bold', color: valueColor || 'inherit' }}>
      {value}
    </div>
  </div>
);

export default IntradayRegimePanel;
