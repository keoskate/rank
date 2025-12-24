/**
 * OptimizerResults Component
 *
 * Displays the top 10 config results from the optimizer with apply buttons.
 */

import Button from '../common/Button';
import theme from '../../theme';

const OptimizerResults = ({
  results,
  symbol,
  simulationDate,
  onApply,
  onClose,
}) => {
  if (!results || results.length === 0) return null;

  return (
    <div
      style={{
        marginBottom: theme.spacing.lg,
        padding: theme.spacing.md,
        backgroundColor: '#f5f3ff',
        borderRadius: theme.borderRadius.lg,
        border: '2px solid #8b5cf6',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
        <h4 style={{ margin: 0, color: '#5b21b6' }}>
          Optimizer Results - Top 10 Configs for {symbol} on {simulationDate}
        </h4>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '18px',
            cursor: 'pointer',
            color: '#5b21b6',
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm }}>
          <thead>
            <tr style={{ backgroundColor: '#ede9fe' }}>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>#</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Return</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>P&L</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Win Rate</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Trades</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Strategy</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Signals</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>TP%</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>SL%</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Conf%</th>
              <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Pos%</th>
              <th style={{ padding: '8px', textAlign: 'center', borderBottom: '2px solid #8b5cf6' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr
                key={index}
                style={{
                  backgroundColor: index === 0 ? '#ddd6fe' : index % 2 === 0 ? '#faf5ff' : 'white',
                }}
              >
                <td style={{ padding: '8px', fontWeight: index === 0 ? 'bold' : 'normal' }}>
                  {index === 0 ? '🏆' : index + 1}
                </td>
                <td style={{
                  padding: '8px',
                  fontWeight: 'bold',
                  color: result.returnPercent >= 0 ? '#16a34a' : '#dc2626',
                }}>
                  {result.returnPercent >= 0 ? '+' : ''}{result.returnPercent.toFixed(2)}%
                </td>
                <td style={{
                  padding: '8px',
                  color: result.totalPnL >= 0 ? '#16a34a' : '#dc2626',
                }}>
                  ${result.totalPnL.toFixed(0)}
                </td>
                <td style={{ padding: '8px' }}>{result.winRate.toFixed(0)}%</td>
                <td style={{ padding: '8px' }}>{result.numTrades}</td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor:
                      result.config.entryStrategy === 'momentum' ? '#8b5cf6' :
                      result.config.entryStrategy === 'aggressive' ? '#ef4444' :
                      result.config.entryStrategy === 'conservative' ? '#22c55e' : '#3b82f6',
                    color: '#fff',
                    fontSize: '11px',
                  }}>
                    {result.config.entryStrategy}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>{result.config.minSignalsRequired}</td>
                <td style={{ padding: '8px' }}>{result.config.takeProfitPercent}%</td>
                <td style={{ padding: '8px' }}>{result.config.stopLossPercent}%</td>
                <td style={{ padding: '8px' }}>{result.config.minConfidence}%</td>
                <td style={{ padding: '8px' }}>{result.config.maxPositionSizePercent}%</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  <Button
                    size="small"
                    variant={index === 0 ? 'primary' : 'outline'}
                    onClick={() => onApply(result)}
                    style={index === 0 ? { backgroundColor: '#8b5cf6', border: 'none' } : {}}
                  >
                    Apply
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, marginTop: theme.spacing.md, fontSize: theme.typography.fontSize.xs, color: '#5b21b6' }}>
        Click "Apply" on the best config, then run a full simulation to verify the results.
      </p>
    </div>
  );
};

export default OptimizerResults;
