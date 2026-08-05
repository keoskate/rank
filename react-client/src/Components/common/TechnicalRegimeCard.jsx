/**
 * TechnicalRegimeCard - Compact card for market regime display
 *
 * Shows current technical regime (BULL/BEAR/SIDEWAYS) with key indicators.
 * Lighter weight than RegimeConfigPanel for dashboard use.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Card from './Card';
import Button from './Button';
import theme from '../../theme';

const REGIME_INFO = {
  bull: {
    label: 'BULL',
    color: '#22c55e',
    bgColor: '#dcfce7',
    icon: '📈',
    description: 'Momentum up - let winners run',
  },
  bear: {
    label: 'BEAR',
    color: '#ef4444',
    bgColor: '#fee2e2',
    icon: '📉',
    description: 'Momentum down - protect capital',
  },
  sideways: {
    label: 'SIDEWAYS',
    color: '#eab308',
    bgColor: '#fef9c3',
    icon: '↔️',
    description: 'Choppy - be selective',
  },
};

const TechnicalRegimeCard = ({ symbol = 'QBTS', date, onRegimeChange, embedded = false }) => {
  const [regime, setRegime] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detection, setDetection] = useState(null);
  const [lastFetchedKey, setLastFetchedKey] = useState(null);

  // Store callback in ref to avoid re-triggering effect
  const onRegimeChangeRef = useRef(onRegimeChange);
  onRegimeChangeRef.current = onRegimeChange;

  const detectRegime = useCallback(async () => {
    if (!symbol) return;

    setLoading(true);
    setError(null);

    try {
      const dateParam = date ? `&date=${date}` : '';
      const response = await fetch(`/api/regime/${symbol}?days=90${dateParam}`);

      if (response.ok) {
        const data = await response.json();
        setRegime(data.regime);
        setDetection(data);
        setLastFetchedKey(`${symbol}-${date || 'now'}`);
        // Use ref to avoid dependency on callback
        if (onRegimeChangeRef.current) onRegimeChangeRef.current(data);
      } else {
        setError('Failed to detect regime');
      }
    } catch (err) {
      setError('Could not connect');
    } finally {
      setLoading(false);
    }
  }, [symbol, date]);

  // Only fetch when symbol or date actually changes
  useEffect(() => {
    const fetchKey = `${symbol}-${date || 'now'}`;
    if (fetchKey !== lastFetchedKey) {
      detectRegime();
    }
  }, [symbol, date, lastFetchedKey, detectRegime]);

  const currentRegime = regime ? REGIME_INFO[regime] : null;

  const inner = (
    <>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.sm,
        paddingBottom: theme.spacing.xs,
        borderBottom: `1px solid ${theme.colors.gray200}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
          <span style={{ fontSize: '18px' }}>🎯</span>
          <span style={{ fontWeight: 'bold', fontSize: theme.typography.fontSize.sm }}>
            Technical Regime
          </span>
        </div>
        <Button
          size="small"
          variant="outline"
          onClick={detectRegime}
          disabled={loading}
          style={{ padding: '2px 8px', fontSize: '11px' }}
        >
          {loading ? '...' : '↻'}
        </Button>
      </div>

      {/* Symbol being tracked */}
      <div style={{
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.textMuted,
        marginBottom: theme.spacing.sm,
      }}>
        Analyzing: <strong>{symbol}</strong>
        {date && <span> ({date})</span>}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: theme.spacing.xs,
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: theme.borderRadius.sm,
          marginBottom: theme.spacing.sm,
          fontSize: '11px',
        }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !regime && (
        <div style={{
          padding: theme.spacing.md,
          textAlign: 'center',
          color: theme.colors.textMuted,
          fontSize: theme.typography.fontSize.sm,
        }}>
          Detecting...
        </div>
      )}

      {/* Regime Display */}
      {currentRegime && !loading && (
        <div>
          {/* Main regime badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.sm,
          }}>
            <span style={{
              padding: '8px 16px',
              borderRadius: theme.borderRadius.md,
              backgroundColor: currentRegime.bgColor,
              color: currentRegime.color,
              fontWeight: 'bold',
              fontSize: theme.typography.fontSize.lg,
            }}>
              {currentRegime.icon} {currentRegime.label}
            </span>
            {detection?.confidence && (
              <span style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.textMuted,
              }}>
                {detection.confidence.toFixed(0)}% conf
              </span>
            )}
          </div>

          {/* Description */}
          <div style={{
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.textSecondary,
            marginBottom: theme.spacing.sm,
          }}>
            {detection?.description || currentRegime.description}
          </div>

          {/* Key Indicators */}
          {detection?.indicators && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: theme.spacing.xs,
              fontSize: '11px',
            }}>
              {detection.indicators.fiveDayReturn && (
                <span style={{
                  padding: '2px 6px',
                  backgroundColor: parseFloat(detection.indicators.fiveDayReturn) > 0
                    ? '#dcfce7'
                    : '#fee2e2',
                  borderRadius: theme.borderRadius.sm,
                  color: parseFloat(detection.indicators.fiveDayReturn) > 0
                    ? '#166534'
                    : '#991b1b',
                }}>
                  5d: {detection.indicators.fiveDayReturn}
                </span>
              )}
              {detection.indicators.tenDayReturn && (
                <span style={{
                  padding: '2px 6px',
                  backgroundColor: parseFloat(detection.indicators.tenDayReturn) > 0
                    ? '#dcfce7'
                    : '#fee2e2',
                  borderRadius: theme.borderRadius.sm,
                  color: parseFloat(detection.indicators.tenDayReturn) > 0
                    ? '#166534'
                    : '#991b1b',
                }}>
                  10d: {detection.indicators.tenDayReturn}
                </span>
              )}
              {typeof detection.indicators.priceVs50MA === 'number' && (
                <span style={{
                  padding: '2px 6px',
                  backgroundColor: detection.indicators.priceVs50MA > 0
                    ? '#dcfce7'
                    : '#fee2e2',
                  borderRadius: theme.borderRadius.sm,
                  color: detection.indicators.priceVs50MA > 0
                    ? '#166534'
                    : '#991b1b',
                }}>
                  vs 50MA: {detection.indicators.priceVs50MA > 0 ? '+' : ''}{detection.indicators.priceVs50MA.toFixed(1)}%
                </span>
              )}
              {detection.indicators.adx && (
                <span style={{
                  padding: '2px 6px',
                  backgroundColor: theme.colors.gray100,
                  borderRadius: theme.borderRadius.sm,
                  color: theme.colors.textSecondary,
                }}>
                  ADX: {parseFloat(detection.indicators.adx).toFixed(0)}
                </span>
              )}
              {detection.indicators.volatility && (
                <span style={{
                  padding: '2px 6px',
                  backgroundColor: theme.colors.gray100,
                  borderRadius: theme.borderRadius.sm,
                  color: theme.colors.textSecondary,
                }}>
                  Vol: {detection.indicators.volatility}
                </span>
              )}
            </div>
          )}

          {/* Signal breakdown */}
          {detection?.indicators?.signals && (
            <div style={{
              marginTop: theme.spacing.sm,
              fontSize: '10px',
              color: theme.colors.textMuted,
            }}>
              Signals: 📈{detection.indicators.signals.bullish} / 📉{detection.indicators.signals.bearish} / ↔️{detection.indicators.signals.sideways}
            </div>
          )}
        </div>
      )}

      {/* No data */}
      {!regime && !loading && !error && (
        <div style={{
          padding: theme.spacing.md,
          textAlign: 'center',
          color: theme.colors.textMuted,
          fontSize: theme.typography.fontSize.sm,
        }}>
          <div style={{ marginBottom: theme.spacing.sm }}>No regime data</div>
          <Button
            size="small"
            variant="primary"
            onClick={detectRegime}
          >
            Detect Regime
          </Button>
        </div>
      )}
    </>
  );

  if (embedded) return <div>{inner}</div>;
  return <Card>{inner}</Card>;
};

export default TechnicalRegimeCard;
