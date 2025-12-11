import React, { useState } from 'react';
import Card from './Card';
import theme from '../../theme';

/**
 * Strategy Validator Panel
 *
 * Runs multi-day backtests to validate strategy consistency.
 * Shows risk metrics, regime breakdown, and verdict.
 */
const StrategyValidatorPanel = ({ symbol: propSymbol, config, onConfigApply }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [localSymbol, setLocalSymbol] = useState('');
  const [dateRange, setDateRange] = useState({
    startDate: getDefaultStartDate(),
    endDate: getDefaultEndDate(),
  });

  // Use prop symbol if provided, otherwise use local input
  const symbol = propSymbol || localSymbol;

  function getDefaultStartDate() {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }

  function getDefaultEndDate() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  const runBacktest = async () => {
    if (!symbol) {
      setError('Please select a symbol first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const requestBody = {
        symbol,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        config: config || {},
      };

      // Debug: log what's being sent
      console.log('[StrategyValidator] Request:', JSON.stringify(requestBody, null, 2));

      const response = await fetch('/api/strategy-validator/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      // Debug: log what's received
      console.log('[StrategyValidator] Response statistics:', data.statistics);

      if (!response.ok) {
        throw new Error(data.error || 'Backtest failed');
      }

      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const getVerdictColor = (verdict) => {
    switch (verdict) {
      case 'READY_FOR_PAPER_TRADING': return '#22c55e';
      case 'PROMISING_NEEDS_REFINEMENT': return '#eab308';
      case 'NEEDS_WORK': return '#f97316';
      default: return '#ef4444';
    }
  };

  const getVerdictLabel = (verdict) => {
    switch (verdict) {
      case 'READY_FOR_PAPER_TRADING': return 'Ready for Paper Trading';
      case 'PROMISING_NEEDS_REFINEMENT': return 'Promising - Needs Refinement';
      case 'NEEDS_WORK': return 'Needs Work';
      default: return 'Not Ready';
    }
  };

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <div style={{ padding: theme.spacing.md }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.md,
        }}>
          <h3 style={{
            margin: 0,
            fontSize: theme.typography.fontSize.lg,
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}>
            <span style={{ fontSize: '20px' }}>🔬</span>
            Strategy Validator
          </h3>
          <span style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.textMuted,
          }}>
            Multi-day backtesting
          </span>
        </div>

        {/* Description */}
        <p style={{
          margin: 0,
          marginBottom: theme.spacing.md,
          fontSize: theme.typography.fontSize.sm,
          color: theme.colors.textMuted,
        }}>
          Test your strategy across multiple days to validate consistency.
          A good strategy should work across different market conditions, not just one lucky day.
        </p>

        {/* Symbol and Date Range Selection */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: propSymbol ? '1fr 1fr auto' : '100px 1fr 1fr auto',
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.md,
        }}>
          {/* Symbol input - only show if no prop symbol */}
          {!propSymbol && (
            <div>
              <label style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.textMuted }}>
                Symbol
              </label>
              <input
                type="text"
                value={localSymbol}
                onChange={(e) => setLocalSymbol(e.target.value.toUpperCase())}
                placeholder="QBTS"
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  borderRadius: theme.borderRadius.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  fontSize: theme.typography.fontSize.sm,
                  textTransform: 'uppercase',
                }}
              />
            </div>
          )}
          <div>
            <label style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.textMuted }}>
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.gray300}`,
                fontSize: theme.typography.fontSize.sm,
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.textMuted }}>
              End Date
            </label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.gray300}`,
                fontSize: theme.typography.fontSize.sm,
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={runBacktest}
              disabled={isLoading || !symbol}
              style={{
                padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                backgroundColor: isLoading ? theme.colors.gray400 : theme.colors.primary,
                color: 'white',
                border: 'none',
                borderRadius: theme.borderRadius.sm,
                cursor: isLoading || !symbol ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              {isLoading ? 'Running...' : 'Run Validation'}
            </button>
          </div>
        </div>

        {/* Symbol Display */}
        <div style={{
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.gray100,
          borderRadius: theme.borderRadius.sm,
          marginBottom: theme.spacing.md,
          fontSize: theme.typography.fontSize.sm,
        }}>
          <strong>Symbol:</strong> {symbol || 'None selected'} |{' '}
          <strong>Strategy:</strong> {config?.entryStrategy || 'Default'} |{' '}
          <strong>Position:</strong> {config?.maxPositionSizePercent || 15}%
        </div>

        {/* Error Display */}
        {error && (
          <div style={{
            padding: theme.spacing.md,
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            borderRadius: theme.borderRadius.sm,
            marginBottom: theme.spacing.md,
          }}>
            {error}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div style={{
            padding: theme.spacing.xl,
            textAlign: 'center',
            color: theme.colors.textMuted,
          }}>
            <div style={{ fontSize: '24px', marginBottom: theme.spacing.sm }}>
              🔄
            </div>
            Running backtest... This may take 30-60 seconds.
          </div>
        )}

        {/* Results */}
        {results && !isLoading && (
          <div>
            {/* Verdict Banner */}
            <div style={{
              padding: theme.spacing.md,
              backgroundColor: getVerdictColor(results.verdict?.verdict),
              color: 'white',
              borderRadius: theme.borderRadius.md,
              marginBottom: theme.spacing.md,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: theme.typography.fontSize.xl, fontWeight: 'bold' }}>
                    {getVerdictLabel(results.verdict?.verdict)}
                  </div>
                  <div style={{ fontSize: theme.typography.fontSize.sm, opacity: 0.9 }}>
                    Confidence: {results.verdict?.confidence}
                  </div>
                </div>
                <div style={{ fontSize: '32px' }}>
                  {results.verdict?.verdict === 'READY_FOR_PAPER_TRADING' && '🎉'}
                  {results.verdict?.verdict === 'PROMISING_NEEDS_REFINEMENT' && '🔧'}
                  {results.verdict?.verdict === 'NEEDS_WORK' && '⚠️'}
                  {results.verdict?.verdict === 'NOT_READY' && '❌'}
                </div>
              </div>
            </div>

            {/* Key Statistics Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: theme.spacing.sm,
              marginBottom: theme.spacing.md,
            }}>
              <StatBox
                label="Days Tested"
                value={results.statistics?.totalDays || 0}
                suffix="days"
              />
              <StatBox
                label="Total Trades"
                value={results.statistics?.totalTrades || 0}
                suffix="trades"
              />
              <StatBox
                label="Avg Daily Return"
                value={results.statistics?.avgDailyReturn || '0'}
                suffix="%"
                color={parseFloat(results.statistics?.avgDailyReturn) > 0 ? '#22c55e' : '#ef4444'}
              />
              <StatBox
                label="Sharpe Ratio"
                value={results.statistics?.sharpeRatio || '0'}
                color={parseFloat(results.statistics?.sharpeRatio) >= 1 ? '#22c55e'
                  : parseFloat(results.statistics?.sharpeRatio) >= 0 ? '#eab308' : '#ef4444'}
              />
              <StatBox
                label="Max Drawdown"
                value={results.statistics?.maxDrawdown || '0'}
                suffix="%"
                color="#ef4444"
              />
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: theme.spacing.sm,
              marginBottom: theme.spacing.md,
            }}>
              <StatBox
                label="Day Win Rate"
                value={results.statistics?.dayWinRate || '0'}
                suffix="%"
                color={parseFloat(results.statistics?.dayWinRate) >= 50 ? '#22c55e' : '#ef4444'}
              />
              <StatBox
                label="Trade Win Rate"
                value={results.statistics?.tradeWinRate || '0'}
                suffix="%"
                color={parseFloat(results.statistics?.tradeWinRate) >= 50 ? '#22c55e' : '#ef4444'}
              />
              <StatBox
                label="Avg Alpha"
                value={results.statistics?.avgAlpha || '0'}
                suffix="%"
                color={parseFloat(results.statistics?.avgAlpha) > 0 ? '#22c55e' : '#ef4444'}
              />
              <StatBox
                label="Consistency"
                value={results.statistics?.consistencyScore || '0'}
                suffix="%"
                color={parseFloat(results.statistics?.consistencyScore) >= 50 ? '#22c55e' : '#ef4444'}
              />
            </div>

            {/* Buy and Hold Comparison */}
            {results.buyAndHold && (
              <div style={{
                padding: theme.spacing.md,
                backgroundColor: '#dbeafe',
                borderRadius: theme.borderRadius.md,
                marginBottom: theme.spacing.md,
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: theme.spacing.xs }}>
                  vs Buy-and-Hold Comparison
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: theme.spacing.md,
                  fontSize: theme.typography.fontSize.sm,
                }}>
                  <div>
                    <div style={{ color: theme.colors.textMuted }}>B&H Return</div>
                    <div style={{ fontWeight: 'bold' }}>{results.buyAndHold.returnPercent}%</div>
                  </div>
                  <div>
                    <div style={{ color: theme.colors.textMuted }}>Strategy Return</div>
                    <div style={{
                      fontWeight: 'bold',
                      color: parseFloat(results.statistics?.avgDailyReturn) * results.statistics?.totalDays > parseFloat(results.buyAndHold.returnPercent)
                        ? '#22c55e' : '#ef4444'
                    }}>
                      {(parseFloat(results.statistics?.avgDailyReturn) * results.statistics?.totalDays).toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ color: theme.colors.textMuted }}>Outperformance</div>
                    <div style={{
                      fontWeight: 'bold',
                      color: parseFloat(results.statistics?.avgAlpha) > 0 ? '#22c55e' : '#ef4444'
                    }}>
                      {parseFloat(results.statistics?.avgAlpha) > 0 ? '+' : ''}{(parseFloat(results.statistics?.avgAlpha) * results.statistics?.totalDays).toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Regime Breakdown */}
            {results.regimeBreakdown && (
              <div style={{ marginBottom: theme.spacing.md }}>
                <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, fontSize: theme.typography.fontSize.sm }}>
                  Performance by Market Regime
                </h4>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: theme.spacing.sm,
                }}>
                  {['bull', 'bear', 'sideways'].map(regime => (
                    <div
                      key={regime}
                      style={{
                        padding: theme.spacing.sm,
                        backgroundColor: regime === 'bull' ? '#dcfce7'
                          : regime === 'bear' ? '#fee2e2' : '#fef9c3',
                        borderRadius: theme.borderRadius.sm,
                        fontSize: theme.typography.fontSize.xs,
                      }}
                    >
                      <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                        {regime === 'bull' && '📈'} {regime === 'bear' && '📉'} {regime === 'sideways' && '↔️'}
                        {regime}
                      </div>
                      <div>Days: {results.regimeBreakdown[regime]?.days || 0}</div>
                      <div>Avg Return: {results.regimeBreakdown[regime]?.avgReturn || 0}%</div>
                      <div>Win Rate: {results.regimeBreakdown[regime]?.winRate || 0}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strengths and Issues */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: theme.spacing.md,
              marginBottom: theme.spacing.md,
            }}>
              {/* Strengths */}
              <div style={{
                padding: theme.spacing.md,
                backgroundColor: '#dcfce7',
                borderRadius: theme.borderRadius.md,
              }}>
                <div style={{ fontWeight: 'bold', color: '#166534', marginBottom: theme.spacing.xs }}>
                  Strengths
                </div>
                {results.verdict?.strengths?.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: theme.typography.fontSize.xs }}>
                    {results.verdict.strengths.map((s, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ fontSize: theme.typography.fontSize.xs, color: '#166534' }}>
                    No clear strengths identified
                  </div>
                )}
              </div>

              {/* Issues */}
              <div style={{
                padding: theme.spacing.md,
                backgroundColor: '#fee2e2',
                borderRadius: theme.borderRadius.md,
              }}>
                <div style={{ fontWeight: 'bold', color: '#991b1b', marginBottom: theme.spacing.xs }}>
                  Issues to Address
                </div>
                {results.verdict?.issues?.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: theme.typography.fontSize.xs }}>
                    {results.verdict.issues.map((s, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ fontSize: theme.typography.fontSize.xs, color: '#991b1b' }}>
                    No major issues found
                  </div>
                )}
              </div>
            </div>

            {/* Recommendation */}
            {results.verdict?.recommendation && (
              <div style={{
                padding: theme.spacing.md,
                backgroundColor: '#eff6ff',
                borderRadius: theme.borderRadius.md,
                borderLeft: `4px solid ${theme.colors.primary}`,
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: theme.spacing.xs }}>
                  Recommendation
                </div>
                <div style={{ fontSize: theme.typography.fontSize.sm }}>
                  {results.verdict.recommendation}
                </div>
              </div>
            )}

            {/* Daily Results Table (collapsed by default) */}
            <details style={{ marginTop: theme.spacing.md, marginBottom: theme.spacing.md }}>
              <summary style={{
                cursor: 'pointer',
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.gray100,
                borderRadius: theme.borderRadius.sm,
                fontWeight: 'bold',
              }}>
                View Daily Results ({results.dailyResults?.length || 0} days)
              </summary>
              <div style={{
                marginTop: theme.spacing.sm,
              }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: theme.typography.fontSize.xs,
                }}>
                  <thead>
                    <tr style={{ backgroundColor: theme.colors.gray100 }}>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Regime</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Return</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Alpha</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Trades</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.dailyResults?.map((day, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.gray200}` }}>
                        <td style={{ padding: '8px' }}>{day.date}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: day.regime === 'bull' ? '#dcfce7'
                              : day.regime === 'bear' ? '#fee2e2' : '#fef9c3',
                            fontSize: '10px',
                          }}>
                            {day.regime}
                          </span>
                        </td>
                        <td style={{
                          padding: '8px',
                          textAlign: 'right',
                          color: day.returnPercent > 0 ? '#22c55e' : '#ef4444',
                        }}>
                          {day.returnPercent?.toFixed(2)}%
                        </td>
                        <td style={{
                          padding: '8px',
                          textAlign: 'right',
                          color: day.alpha > 0 ? '#22c55e' : '#ef4444',
                        }}>
                          {day.alpha?.toFixed(2)}%
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{day.trades}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{day.winRate?.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </div>
    </Card>
  );
};

// Helper component for stat boxes
const StatBox = ({ label, value, suffix = '', color }) => (
  <div style={{
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.gray50,
    borderRadius: theme.borderRadius.sm,
    textAlign: 'center',
  }}>
    <div style={{
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.textMuted,
      marginBottom: '4px',
    }}>
      {label}
    </div>
    <div style={{
      fontSize: theme.typography.fontSize.lg,
      fontWeight: 'bold',
      color: color || 'inherit',
    }}>
      {value}{suffix}
    </div>
  </div>
);

export default StrategyValidatorPanel;
