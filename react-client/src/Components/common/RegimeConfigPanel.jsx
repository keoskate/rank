/**
 * RegimeConfigPanel - Market regime-aware configuration
 *
 * Shows current market regime and allows different configs per regime:
 * - BULL: Wider targets, standard stops, more aggressive
 * - BEAR: Tighter targets, tighter stops, more defensive
 * - SIDEWAYS: Very tight targets, minimal position sizes
 *
 * Can auto-adapt config based on detected regime.
 */

import { useState, useEffect, useCallback } from 'react';
import Card from './Card';
import Button from './Button';
import theme from '../../theme';
import { useTradingConfig } from '../../contexts/TradingConfigContext';

const REGIME_INFO = {
  bull: {
    label: 'Bull Market',
    color: theme.colors.success,
    icon: '📈',
    description: 'Momentum continues, let winners run',
    adjustments: {
      takeProfitPercent: '+25%',
      stopLossPercent: 'standard',
      positionSize: 'full',
      confidence: '-5%',
    },
  },
  bear: {
    label: 'Bear Market',
    color: theme.colors.error,
    icon: '📉',
    description: 'Take profits quickly, protect capital',
    adjustments: {
      takeProfitPercent: '-25%',
      stopLossPercent: '-20%',
      positionSize: '-30%',
      confidence: '+10%',
    },
  },
  sideways: {
    label: 'Sideways/Choppy',
    color: theme.colors.warning,
    icon: '↔️',
    description: 'Mean reversion, be very selective',
    adjustments: {
      takeProfitPercent: '-40%',
      stopLossPercent: '-30%',
      positionSize: '-50%',
      confidence: '+15%',
    },
  },
};

const RegimeConfigPanel = ({ symbol, onRegimeChange }) => {
  const { config, updateConfig } = useTradingConfig();
  const [regime, setRegime] = useState(null);
  const [regimeConfig, setRegimeConfig] = useState(null);
  const [autoAdapt, setAutoAdapt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastDetection, setLastDetection] = useState(null);

  // Fetch current regime for symbol
  const detectRegime = useCallback(async () => {
    if (!symbol) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/regime/${symbol}`);
      if (response.ok) {
        const data = await response.json();
        setRegime(data.regime);
        setLastDetection(data);
        if (onRegimeChange) onRegimeChange(data);
      }
    } catch (err) {
      console.error('Error detecting regime:', err);
    } finally {
      setLoading(false);
    }
  }, [symbol, onRegimeChange]);

  // Fetch regime-specific config
  const fetchRegimeConfig = useCallback(async () => {
    if (!symbol || !regime) return;

    try {
      const response = await fetch(`/api/regime/config/${regime}?symbol=${symbol}`);
      if (response.ok) {
        const data = await response.json();
        setRegimeConfig(data);
      }
    } catch (err) {
      console.error('Error fetching regime config:', err);
    }
  }, [symbol, regime]);

  // Apply regime-specific config to global trading config
  const applyRegimeConfig = async () => {
    if (!regimeConfig?.adjustedConfig) return;

    const adjusted = regimeConfig.adjustedConfig;
    updateConfig({
      takeProfitPercent: adjusted.takeProfitPercent,
      stopLossPercent: adjusted.stopLossPercent,
      maxPositionSizePercent: adjusted.positionSizePercent,
      minConfidence: adjusted.minConfidence,
    });
  };

  // Toggle auto-adaptation
  const toggleAutoAdapt = async () => {
    try {
      const response = await fetch(`/api/regime-config/${symbol}/adaptation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autoAdapt }),
      });
      if (response.ok) {
        setAutoAdapt(!autoAdapt);
        if (!autoAdapt) {
          // When enabling, immediately apply regime config
          applyRegimeConfig();
        }
      }
    } catch (err) {
      console.error('Error toggling auto-adapt:', err);
      // Toggle anyway for UI feedback
      setAutoAdapt(!autoAdapt);
    }
  };

  useEffect(() => {
    detectRegime();
    const interval = setInterval(detectRegime, 60000); // Re-detect every minute
    return () => clearInterval(interval);
  }, [detectRegime]);

  useEffect(() => {
    fetchRegimeConfig();
  }, [fetchRegimeConfig]);

  useEffect(() => {
    if (autoAdapt && regimeConfig) {
      applyRegimeConfig();
    }
  }, [regime, autoAdapt, regimeConfig]);

  const currentRegime = regime ? REGIME_INFO[regime] : null;

  return (
    <Card>
      {/* Card Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
        borderBottom: `1px solid ${theme.colors.gray200}`,
      }}>
        <span style={{ fontWeight: 'bold', fontSize: theme.typography.fontSize.md }}>Market Regime</span>
        {currentRegime && (
          <span style={{
            fontSize: theme.typography.fontSize.sm,
            padding: `2px ${theme.spacing.sm}`,
            backgroundColor: `${currentRegime.color}20`,
            color: currentRegime.color,
            borderRadius: theme.borderRadius.sm,
          }}>
            {currentRegime.icon} {currentRegime.label}
          </span>
        )}
      </div>

      {loading && !regime ? (
        <p style={{ color: theme.colors.textMuted }}>Detecting market regime...</p>
      ) : !symbol ? (
        <p style={{ color: theme.colors.textMuted }}>Select a symbol to detect market regime.</p>
      ) : (
        <>
          {/* Regime Detection Info */}
          {lastDetection && (
            <div style={{
              marginBottom: theme.spacing.md,
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.background,
              borderRadius: theme.borderRadius.md,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: theme.spacing.xs,
              }}>
                <span style={{ fontWeight: 'bold', color: currentRegime?.color }}>
                  {currentRegime?.label || 'Unknown'}
                </span>
                <span style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.textMuted,
                }}>
                  Confidence: {lastDetection.confidence?.toFixed(0) || 0}%
                </span>
              </div>
              <p style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.textSecondary,
                margin: 0,
              }}>
                {lastDetection.description || currentRegime?.description}
              </p>
            </div>
          )}

          {/* Leveraged ETF Recommendation */}
          {lastDetection?.leveragedRecommendation && (
            <div style={{
              marginBottom: theme.spacing.md,
              padding: theme.spacing.md,
              backgroundColor: lastDetection.leveragedRecommendation.direction === 'long'
                ? '#dcfce7'
                : lastDetection.leveragedRecommendation.direction === 'short'
                ? '#fee2e2'
                : '#fef9c3',
              border: `2px solid ${
                lastDetection.leveragedRecommendation.direction === 'long'
                  ? '#22c55e'
                  : lastDetection.leveragedRecommendation.direction === 'short'
                  ? '#ef4444'
                  : '#eab308'
              }`,
              borderRadius: theme.borderRadius.md,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: theme.spacing.sm,
              }}>
                <div>
                  <div style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.textMuted,
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}>
                    Recommended Trade
                  </div>
                  <div style={{
                    fontSize: theme.typography.fontSize.xl,
                    fontWeight: 'bold',
                    color: lastDetection.leveragedRecommendation.direction === 'long'
                      ? '#166534'
                      : lastDetection.leveragedRecommendation.direction === 'short'
                      ? '#991b1b'
                      : '#854d0e',
                  }}>
                    {lastDetection.leveragedRecommendation.direction === 'long' && '📈 '}
                    {lastDetection.leveragedRecommendation.direction === 'short' && '📉 '}
                    {lastDetection.leveragedRecommendation.direction === 'neutral' && '⏸️ '}
                    {lastDetection.leveragedRecommendation.symbol}
                  </div>
                </div>
                {lastDetection.leveragedRecommendation.leverage !== 'none' && (
                  <div style={{
                    padding: '4px 12px',
                    backgroundColor: lastDetection.leveragedRecommendation.direction === 'long'
                      ? '#22c55e'
                      : '#ef4444',
                    color: '#fff',
                    borderRadius: theme.borderRadius.sm,
                    fontWeight: 'bold',
                    fontSize: theme.typography.fontSize.sm,
                  }}>
                    {lastDetection.leveragedRecommendation.leverage} {lastDetection.leveragedRecommendation.direction.toUpperCase()}
                  </div>
                )}
              </div>
              <p style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.textSecondary,
                margin: 0,
                marginBottom: theme.spacing.sm,
              }}>
                {lastDetection.leveragedRecommendation.reason}
              </p>
              {lastDetection.leveragedRecommendation.tips && (
                <ul style={{
                  margin: 0,
                  paddingLeft: theme.spacing.md,
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.textMuted,
                }}>
                  {lastDetection.leveragedRecommendation.tips.map((tip, i) => (
                    <li key={i} style={{ marginBottom: '2px' }}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Auto-Adapt Toggle */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: theme.spacing.md,
            padding: theme.spacing.sm,
            backgroundColor: autoAdapt ? `${theme.colors.primary}10` : 'transparent',
            border: `1px solid ${autoAdapt ? theme.colors.primary : theme.colors.border}`,
            borderRadius: theme.borderRadius.md,
          }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>Auto-Adapt Config</div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.textMuted }}>
                Automatically adjust trading config based on regime
              </div>
            </div>
            <Button
              variant={autoAdapt ? 'primary' : 'secondary'}
              size="small"
              onClick={toggleAutoAdapt}
            >
              {autoAdapt ? 'ON' : 'OFF'}
            </Button>
          </div>

          {/* Regime Adjustments */}
          {currentRegime && (
            <div>
              <div style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textMuted,
                textTransform: 'uppercase',
                marginBottom: theme.spacing.sm,
              }}>
                Regime Adjustments
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: theme.spacing.sm,
              }}>
                {Object.entries(currentRegime.adjustments).map(([key, value]) => (
                  <div key={key} style={{
                    padding: theme.spacing.sm,
                    backgroundColor: theme.colors.background,
                    borderRadius: theme.borderRadius.sm,
                    fontSize: theme.typography.fontSize.sm,
                  }}>
                    <div style={{ color: theme.colors.textMuted, fontSize: '10px' }}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </div>
                    <div style={{
                      fontWeight: 'bold',
                      color: value.includes('+') ? theme.colors.error
                        : value.includes('-') ? theme.colors.success
                        : theme.colors.text,
                    }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual Apply Button */}
          {!autoAdapt && regimeConfig && (
            <div style={{ marginTop: theme.spacing.md }}>
              <Button
                variant="secondary"
                onClick={applyRegimeConfig}
                style={{ width: '100%' }}
              >
                Apply {currentRegime?.label} Config
              </Button>
            </div>
          )}

          {/* Detection Details */}
          {lastDetection?.indicators && (
            <div style={{ marginTop: theme.spacing.md }}>
              <div style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textMuted,
                textTransform: 'uppercase',
                marginBottom: theme.spacing.xs,
              }}>
                Detection Signals
              </div>
              <div style={{
                display: 'flex',
                gap: theme.spacing.sm,
                fontSize: theme.typography.fontSize.sm,
                flexWrap: 'wrap',
              }}>
                {typeof lastDetection.indicators.priceVs50MA === 'number' && (
                  <span style={{
                    padding: `2px ${theme.spacing.xs}`,
                    backgroundColor: lastDetection.indicators.priceVs50MA > 0
                      ? `${theme.colors.success}20`
                      : `${theme.colors.error}20`,
                    borderRadius: theme.borderRadius.sm,
                  }}>
                    50MA: {lastDetection.indicators.priceVs50MA > 0 ? '+' : ''}{parseFloat(lastDetection.indicators.priceVs50MA).toFixed(1)}%
                  </span>
                )}
                {lastDetection.indicators.fiveDayReturn && (
                  <span style={{
                    padding: `2px ${theme.spacing.xs}`,
                    backgroundColor: parseFloat(lastDetection.indicators.fiveDayReturn) > 0
                      ? `${theme.colors.success}20`
                      : `${theme.colors.error}20`,
                    borderRadius: theme.borderRadius.sm,
                  }}>
                    5d: {lastDetection.indicators.fiveDayReturn}
                  </span>
                )}
                {lastDetection.indicators.tenDayReturn && (
                  <span style={{
                    padding: `2px ${theme.spacing.xs}`,
                    backgroundColor: parseFloat(lastDetection.indicators.tenDayReturn) > 0
                      ? `${theme.colors.success}20`
                      : `${theme.colors.error}20`,
                    borderRadius: theme.borderRadius.sm,
                  }}>
                    10d: {lastDetection.indicators.tenDayReturn}
                  </span>
                )}
                {lastDetection.indicators.adx && (
                  <span style={{
                    padding: `2px ${theme.spacing.xs}`,
                    backgroundColor: parseFloat(lastDetection.indicators.adx) >= 20
                      ? `${theme.colors.primary}20`
                      : theme.colors.surface,
                    borderRadius: theme.borderRadius.sm,
                  }}>
                    ADX: {parseFloat(lastDetection.indicators.adx).toFixed(0)}
                  </span>
                )}
                {lastDetection.indicators.volatility && (
                  <span style={{
                    padding: `2px ${theme.spacing.xs}`,
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.borderRadius.sm,
                  }}>
                    Vol: {lastDetection.indicators.volatility}
                  </span>
                )}
              </div>
              {/* Signal breakdown */}
              {lastDetection.indicators.signals && (
                <div style={{
                  marginTop: theme.spacing.sm,
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.textMuted,
                }}>
                  Signals: Bull {lastDetection.indicators.signals.bullish} / Bear {lastDetection.indicators.signals.bearish} / Sideways {lastDetection.indicators.signals.sideways}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export default RegimeConfigPanel;
