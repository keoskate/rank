/**
 * SimulatorResults Component
 *
 * Displays analysis results, recommendations, config used, and optimizer
 * comparison after a simulation completes.
 */

import Button from '../common/Button';
import theme from '../../theme';

const SimulatorResults = ({
  analysis,
  usedConfig,
  recommendations,
  optimizerPrediction,
  debugLog,
  showDebugLog,
  setShowDebugLog,
  realizedPnL,
  onApplyRecommendation,
  onApplyAllRecommendations,
  onRestoreConfig,
  onSaveResults,
}) => {
  if (!analysis) return null;

  return (
    <div
      style={{
        borderTop: `1px solid ${theme.colors.gray200}`,
        paddingTop: theme.spacing.md,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.md,
        }}
      >
        <h4 style={{ margin: 0 }}>Simulation Analysis</h4>
        <Button size="small" variant="outline" onClick={onSaveResults}>
          Save Results
        </Button>
      </div>

      {/* Config Used - CRITICAL for knowing what settings produced these results */}
      {usedConfig && (
        <div
          style={{
            marginBottom: theme.spacing.md,
            padding: theme.spacing.sm,
            backgroundColor: '#e0f2fe',
            borderRadius: theme.borderRadius.md,
            border: '1px solid #0ea5e9',
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontWeight: 'bold', color: '#0369a1' }}>
              Config Used in This Simulation:
            </span>
            <Button
              size="small"
              variant="primary"
              onClick={() => onRestoreConfig(usedConfig)}
              style={{ backgroundColor: '#0ea5e9', border: 'none', fontSize: '12px', padding: '4px 12px' }}
            >
              Restore This Config
            </Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.md }}>
            <span><strong>Strategy:</strong> {usedConfig.entryStrategy}</span>
            <span><strong>TP:</strong> {usedConfig.takeProfitPercent}%</span>
            <span><strong>SL:</strong> {usedConfig.stopLossPercent}%</span>
            <span><strong>Signals:</strong> {usedConfig.minSignalsRequired}</span>
            <span><strong>Confidence:</strong> {usedConfig.minConfidence}%</span>
            <span><strong>Volume Spike:</strong> {usedConfig.requireVolumeSpike ? 'Yes' : 'No'}</span>
            <span><strong>Trend Align:</strong> {usedConfig.requireTrendAlignment ? 'Yes' : 'No'}</span>
            <span><strong>RSI Signal:</strong> {usedConfig.requireRsiSignal ? 'Yes' : 'No'}</span>
          </div>
        </div>
      )}

      {/* OPTIMIZER vs ACTUAL COMPARISON */}
      {optimizerPrediction && (
        <OptimizerComparison
          optimizerPrediction={optimizerPrediction}
          analysis={analysis}
          realizedPnL={realizedPnL}
          debugLog={debugLog}
          showDebugLog={showDebugLog}
          setShowDebugLog={setShowDebugLog}
        />
      )}

      {/* Summary Stats Grid */}
      <SummaryStats analysis={analysis} />

      {/* Feedback */}
      <FeedbackSection analysis={analysis} />

      {/* AI RECOMMENDATIONS */}
      {recommendations && recommendations.length > 0 && (
        <RecommendationsPanel
          recommendations={recommendations}
          onApplyRecommendation={onApplyRecommendation}
          onApplyAllRecommendations={onApplyAllRecommendations}
        />
      )}
    </div>
  );
};

// Optimizer vs Actual Comparison Sub-component
const OptimizerComparison = ({
  optimizerPrediction,
  analysis,
  realizedPnL,
  debugLog,
  showDebugLog,
  setShowDebugLog,
}) => (
  <div
    style={{
      marginBottom: theme.spacing.md,
      padding: theme.spacing.sm,
      backgroundColor: '#fef3c7',
      borderRadius: theme.borderRadius.md,
      border: '1px solid #f59e0b',
      fontSize: theme.typography.fontSize.sm,
    }}
  >
    <div style={{ fontWeight: 'bold', color: '#92400e', marginBottom: '8px' }}>
      Optimizer vs Actual Comparison:
    </div>
    <table style={{ width: '100%', fontSize: '12px' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #f59e0b' }}>
          <th style={{ textAlign: 'left', padding: '4px' }}>Metric</th>
          <th style={{ textAlign: 'right', padding: '4px' }}>Predicted</th>
          <th style={{ textAlign: 'right', padding: '4px' }}>Actual</th>
          <th style={{ textAlign: 'right', padding: '4px' }}>Diff</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={{ padding: '4px' }}>Return %</td>
          <td style={{ textAlign: 'right', padding: '4px', color: '#16a34a' }}>+{optimizerPrediction.returnPercent.toFixed(2)}%</td>
          <td style={{ textAlign: 'right', padding: '4px', color: analysis.returnPercent >= 0 ? '#16a34a' : '#dc2626' }}>
            {analysis.returnPercent >= 0 ? '+' : ''}{analysis.returnPercent.toFixed(2)}%
          </td>
          <td style={{ textAlign: 'right', padding: '4px', color: '#dc2626', fontWeight: 'bold' }}>
            {(analysis.returnPercent - optimizerPrediction.returnPercent).toFixed(2)}%
          </td>
        </tr>
        <tr>
          <td style={{ padding: '4px' }}>P&L</td>
          <td style={{ textAlign: 'right', padding: '4px' }}>${optimizerPrediction.totalPnL.toFixed(0)}</td>
          <td style={{ textAlign: 'right', padding: '4px' }}>${analysis.totalPnL?.toFixed(0) || realizedPnL.toFixed(0)}</td>
          <td style={{ textAlign: 'right', padding: '4px' }}>${((analysis.totalPnL || realizedPnL) - optimizerPrediction.totalPnL).toFixed(0)}</td>
        </tr>
        <tr>
          <td style={{ padding: '4px' }}>Trades</td>
          <td style={{ textAlign: 'right', padding: '4px' }}>{optimizerPrediction.numTrades}</td>
          <td style={{ textAlign: 'right', padding: '4px' }}>{analysis.totalTrades}</td>
          <td style={{ textAlign: 'right', padding: '4px', color: analysis.totalTrades !== optimizerPrediction.numTrades ? '#dc2626' : '#16a34a', fontWeight: 'bold' }}>
            {analysis.totalTrades - optimizerPrediction.numTrades}
          </td>
        </tr>
        <tr>
          <td style={{ padding: '4px' }}>Win Rate</td>
          <td style={{ textAlign: 'right', padding: '4px' }}>{optimizerPrediction.winRate.toFixed(0)}%</td>
          <td style={{ textAlign: 'right', padding: '4px' }}>{analysis.winRate?.toFixed(0) || 0}%</td>
          <td style={{ textAlign: 'right', padding: '4px' }}>{((analysis.winRate || 0) - optimizerPrediction.winRate).toFixed(0)}%</td>
        </tr>
      </tbody>
    </table>
    {debugLog && debugLog.length > 0 && (
      <div style={{ marginTop: '8px' }}>
        <button
          onClick={() => setShowDebugLog(!showDebugLog)}
          style={{
            padding: '4px 12px',
            backgroundColor: '#f59e0b',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {showDebugLog ? 'Hide' : 'Show'} Debug Log ({debugLog.length} entries)
        </button>
      </div>
    )}

    {/* Debug Log Panel */}
    {showDebugLog && debugLog && debugLog.length > 0 && (
      <DebugLogPanel debugLog={debugLog} />
    )}
  </div>
);

// Debug Log Panel Sub-component
const DebugLogPanel = ({ debugLog }) => (
  <div
    style={{
      marginTop: theme.spacing.sm,
      padding: theme.spacing.sm,
      backgroundColor: '#1e1e1e',
      borderRadius: theme.borderRadius.md,
      maxHeight: '400px',
      overflow: 'auto',
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#d4d4d4',
    }}
  >
    <div style={{ marginBottom: '8px', color: '#4ec9b0', fontWeight: 'bold' }}>
      Full Simulation Decision Log ({debugLog.length} trades):
    </div>
    {debugLog.map((entry, idx) => (
      <div key={idx} style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '8px' }}>
        <div style={{ color: entry.type === 'BUY' ? '#4ec9b0' : '#ce9178' }}>
          #{idx + 1} {entry.type} @ ${entry.price?.toFixed(2)} (idx: {entry.index})
        </div>
        {entry.type === 'BUY' ? (
          <div style={{ color: '#9cdcfe', marginLeft: '12px' }}>
            signals: {entry.signalCount}/{entry.minSignalsRequired} | conf: {entry.confidence}%/{entry.minConfidence}% |
            RSI:{entry.indicators?.rsi?.toFixed(0)} | VWAP:{entry.indicators?.vwap?.toFixed(2)} | Vol:{entry.indicators?.volumeRatio?.toFixed(1)}x
            <br/>
            strategy: {entry.entryStrategy} | meetsReq: {entry.meetsRequirements ? 'Y' : 'N'} |
            reqVol: {entry.requireVolumeSpike ? 'Y' : 'N'}({entry.hasVolumeSpike ? '✓' : '✗'}) |
            reqTrend: {entry.requireTrendAlign ? 'Y' : 'N'}({entry.hasTrendSignal ? '✓' : '✗'}) |
            reqRSI: {entry.requireRsiSignal ? 'Y' : 'N'}({entry.hasRsiSignal ? '✓' : '✗'})
            <br/>
            <span style={{ color: '#6a9955' }}>reasons: {entry.reasons?.join(', ')}</span>
          </div>
        ) : (
          <div style={{ color: '#9cdcfe', marginLeft: '12px' }}>
            entry: ${entry.entryPrice?.toFixed(2)} | pnl: {entry.pnlPercent?.toFixed(2)}% |
            sellScore: {entry.sellScore} | conf: {entry.confidence}%/{entry.minConfidence}%
            <br/>
            TP: {entry.profitTargetPercent}% | SL: {entry.stopLossPercent}% | RSI: {entry.indicators?.rsi?.toFixed(0)} | hour: {entry.estHour?.toFixed(2)}
            <br/>
            <span style={{ color: '#6a9955' }}>reasons: {entry.reasons?.join(', ')}</span>
          </div>
        )}
      </div>
    ))}
  </div>
);

// Summary Stats Grid Sub-component
const SummaryStats = ({ analysis }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    }}
  >
    <div
      style={{
        padding: theme.spacing.md,
        backgroundColor:
          analysis.returnPercent >= 0
            ? `${theme.colors.success}10`
            : `${theme.colors.error}10`,
        borderRadius: theme.borderRadius.md,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
        Return
      </div>
      <div
        style={{
          fontSize: theme.typography.fontSize.xxl,
          fontWeight: theme.typography.fontWeight.bold,
          color: analysis.returnPercent >= 0 ? theme.colors.success : theme.colors.error,
        }}
      >
        {analysis.returnPercent >= 0 ? '+' : ''}{analysis.returnPercent.toFixed(2)}%
      </div>
    </div>

    <div
      style={{
        padding: theme.spacing.md,
        backgroundColor: theme.colors.gray50,
        borderRadius: theme.borderRadius.md,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
        Win Rate
      </div>
      <div
        style={{
          fontSize: theme.typography.fontSize.xxl,
          fontWeight: theme.typography.fontWeight.bold,
          color: analysis.winRate >= 50 ? theme.colors.success : theme.colors.warning,
        }}
      >
        {analysis.winRate.toFixed(0)}%
      </div>
    </div>

    <div
      style={{
        padding: theme.spacing.md,
        backgroundColor: theme.colors.gray50,
        borderRadius: theme.borderRadius.md,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
        Trades
      </div>
      <div style={{ fontSize: theme.typography.fontSize.xxl, fontWeight: theme.typography.fontWeight.bold }}>
        {analysis.totalTrades}
      </div>
    </div>

    <div
      style={{
        padding: theme.spacing.md,
        backgroundColor: theme.colors.gray50,
        borderRadius: theme.borderRadius.md,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
        Stock %
      </div>
      <div
        style={{
          fontSize: theme.typography.fontSize.xxl,
          fontWeight: theme.typography.fontWeight.bold,
          color: analysis.priceChangePercent >= 0 ? theme.colors.success : theme.colors.error,
        }}
      >
        {analysis.priceChangePercent >= 0 ? '+' : ''}{analysis.priceChangePercent.toFixed(2)}%
      </div>
    </div>
  </div>
);

// Feedback Section (Positives/Negatives/Improvements)
const FeedbackSection = ({ analysis }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: theme.spacing.md,
    }}
  >
    {analysis.positives && analysis.positives.length > 0 && (
      <div
        style={{
          padding: theme.spacing.md,
          backgroundColor: `${theme.colors.success}08`,
          borderRadius: theme.borderRadius.md,
          border: `1px solid ${theme.colors.success}30`,
        }}
      >
        <h5 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.success }}>
          Positives
        </h5>
        <ul style={{ margin: 0, paddingLeft: theme.spacing.md, fontSize: theme.typography.fontSize.sm }}>
          {analysis.positives.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </div>
    )}

    {analysis.negatives && analysis.negatives.length > 0 && (
      <div
        style={{
          padding: theme.spacing.md,
          backgroundColor: `${theme.colors.error}08`,
          borderRadius: theme.borderRadius.md,
          border: `1px solid ${theme.colors.error}30`,
        }}
      >
        <h5 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.error }}>
          Concerns
        </h5>
        <ul style={{ margin: 0, paddingLeft: theme.spacing.md, fontSize: theme.typography.fontSize.sm }}>
          {analysis.negatives.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </div>
    )}

    {analysis.improvements && analysis.improvements.length > 0 && (
      <div
        style={{
          padding: theme.spacing.md,
          backgroundColor: `${theme.colors.info}08`,
          borderRadius: theme.borderRadius.md,
          border: `1px solid ${theme.colors.info}30`,
        }}
      >
        <h5 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.info }}>
          Improvements
        </h5>
        <ul style={{ margin: 0, paddingLeft: theme.spacing.md, fontSize: theme.typography.fontSize.sm }}>
          {analysis.improvements.map((imp, i) => (
            <li key={i}>{imp}</li>
          ))}
        </ul>
      </div>
    )}
  </div>
);

// Recommendations Panel Sub-component
const RecommendationsPanel = ({
  recommendations,
  onApplyRecommendation,
  onApplyAllRecommendations,
}) => (
  <div
    style={{
      marginTop: theme.spacing.lg,
      padding: theme.spacing.md,
      backgroundColor: '#fef3c7',
      borderRadius: theme.borderRadius.md,
      border: `2px solid #f59e0b`,
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
      <h4 style={{ margin: 0, color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
        Recommended Optimizations
        <span style={{
          fontSize: theme.typography.fontSize.xs,
          backgroundColor: '#ef4444',
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '10px',
        }}>
          {recommendations.length} suggestions
        </span>
      </h4>
      <Button
        size="small"
        variant="primary"
        onClick={onApplyAllRecommendations}
        style={{ backgroundColor: '#22c55e', border: 'none' }}
      >
        Apply All Optimizations
      </Button>
    </div>
    <div style={{ display: 'grid', gap: theme.spacing.md }}>
      {recommendations.map((rec) => (
        <div
          key={rec.id}
          style={{
            padding: theme.spacing.md,
            backgroundColor: rec.priority === 'high' ? '#fef9c3' : theme.colors.surface,
            borderRadius: theme.borderRadius.md,
            border: rec.priority === 'high' ? `2px solid #eab308` : `1px solid ${theme.colors.gray200}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h5 style={{ margin: 0, marginBottom: theme.spacing.xs, color: theme.colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {rec.title}
                {rec.priority === 'high' && (
                  <span style={{
                    fontSize: '10px',
                    backgroundColor: '#ef4444',
                    color: '#fff',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}>
                    HIGH IMPACT
                  </span>
                )}
              </h5>
              <p style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.gray600, fontSize: theme.typography.fontSize.sm }}>
                {rec.description}
              </p>
              <div style={{ display: 'flex', gap: theme.spacing.lg, fontSize: theme.typography.fontSize.sm, flexWrap: 'wrap' }}>
                <span style={{ color: theme.colors.error }}>
                  <strong>Current:</strong> {typeof rec.currentValue === 'boolean' ? (rec.currentValue ? 'Yes' : 'No') : rec.currentValue}
                  {typeof rec.currentValue === 'number' && (rec.field.includes('Percent') || rec.field.includes('Confidence')) ? '%' : ''}
                </span>
                <span style={{ color: theme.colors.success }}>
                  <strong>Suggested:</strong> {typeof rec.suggestedValue === 'boolean' ? (rec.suggestedValue ? 'Yes' : 'No') : (typeof rec.suggestedValue === 'number' ? rec.suggestedValue.toFixed(2) : rec.suggestedValue)}
                  {typeof rec.suggestedValue === 'number' && (rec.field.includes('Percent') || rec.field.includes('Confidence')) ? '%' : ''}
                </span>
                <span style={{ color: '#8b5cf6' }}>
                  <strong>Impact:</strong> {rec.impact}
                </span>
              </div>
            </div>
            <Button
              size="small"
              variant="primary"
              onClick={() => onApplyRecommendation(rec)}
              style={{ marginLeft: theme.spacing.md }}
            >
              Apply
            </Button>
          </div>
        </div>
      ))}
    </div>
    <p style={{ margin: 0, marginTop: theme.spacing.md, color: '#92400e', fontSize: theme.typography.fontSize.xs }}>
      Click "Apply All Optimizations" to apply all suggestions, then re-run the simulation to see improvements.
    </p>
  </div>
);

export default SimulatorResults;
