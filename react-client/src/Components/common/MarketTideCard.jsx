/**
 * MarketTideCard - Unusual Whales Market Sentiment Display
 *
 * Shows market-wide sentiment from Unusual Whales API:
 * - Overall market tide (bullish/bearish percentage)
 * - Call vs Put flow balance
 * - Shows placeholder when API key not configured
 */

import { useState, useEffect, useCallback } from 'react';
import Card from './Card';
import Button from './Button';
import theme from '../../theme';

const MarketTideCard = ({ onSentimentChange }) => {
  const [loading, setLoading] = useState(true); // Start as loading
  const [error, setError] = useState(null);
  const [tideData, setTideData] = useState(null);
  const [configured, setConfigured] = useState(null); // null = unknown, true/false = known

  const fetchMarketTide = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/unusual-whales/market-tide');

      if (response.ok) {
        const data = await response.json();
        setTideData(data);
        setConfigured(data.configured !== false);

        // Notify parent of sentiment
        if (onSentimentChange) {
          onSentimentChange({
            sentiment: data.sentiment,
            callPercent: data.callPercent,
            putPercent: data.putPercent,
            configured: data.configured !== false,
          });
        }
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to fetch market tide');
        setConfigured(false);
        if (onSentimentChange) {
          onSentimentChange({ configured: false });
        }
      }
    } catch (err) {
      setError('Could not connect to server');
      setConfigured(false);
      if (onSentimentChange) {
        onSentimentChange({ configured: false });
      }
    } finally {
      setLoading(false);
    }
  }, []); // Remove onSentimentChange from deps to prevent re-fetch loops

  // Fetch once on mount
  useEffect(() => {
    fetchMarketTide();
  }, []);

  const getSentimentColor = (sentiment) => {
    if (sentiment === 'bullish') return { bg: '#dcfce7', text: '#166534' };
    if (sentiment === 'bearish') return { bg: '#fee2e2', text: '#991b1b' };
    return { bg: '#fef9c3', text: '#854d0e' };
  };

  return (
    <Card style={{ height: '100%' }}>
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
          <span style={{ fontSize: '18px' }}>🐋</span>
          <span style={{ fontWeight: 'bold', fontSize: theme.typography.fontSize.sm }}>
            Market Tide
          </span>
          <span style={{
            fontSize: '9px',
            color: theme.colors.textMuted,
            backgroundColor: theme.colors.gray100,
            padding: '1px 4px',
            borderRadius: '2px',
          }}>
            UW
          </span>
        </div>
        <Button
          size="small"
          variant="outline"
          onClick={fetchMarketTide}
          disabled={loading}
          style={{ padding: '2px 8px', fontSize: '11px' }}
        >
          {loading ? '...' : '↻'}
        </Button>
      </div>

      {/* Not Configured State */}
      {configured === false && !loading && (
        <div style={{
          padding: theme.spacing.md,
          backgroundColor: '#f3f4f6',
          borderRadius: theme.borderRadius.md,
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '24px',
            marginBottom: theme.spacing.sm,
          }}>
            🔑
          </div>
          <div style={{
            fontSize: theme.typography.fontSize.sm,
            fontWeight: 'bold',
            color: theme.colors.textMuted,
            marginBottom: theme.spacing.xs,
          }}>
            API Key Required
          </div>
          <div style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.textMuted,
          }}>
            Add <code style={{ backgroundColor: '#e5e7eb', padding: '1px 4px', borderRadius: '2px' }}>UNUSUAL_WHALES_API_KEY</code> to .env
          </div>
          <a
            href="https://unusualwhales.com/pricing?product=api"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: theme.spacing.sm,
              fontSize: theme.typography.fontSize.xs,
              color: '#3b82f6',
              textDecoration: 'none',
            }}
          >
            Get API Key →
          </a>
        </div>
      )}

      {/* Error State */}
      {error && configured !== false && (
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

      {/* Loading State - shown during initial load or when configured is unknown */}
      {(loading || configured === null) && !tideData && configured !== false && (
        <div style={{
          padding: theme.spacing.md,
          textAlign: 'center',
          color: theme.colors.textMuted,
          fontSize: theme.typography.fontSize.sm,
        }}>
          Checking API configuration...
        </div>
      )}

      {/* Data Display */}
      {tideData && configured !== false && !loading && (
        <div>
          {/* Main Sentiment Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: theme.spacing.sm,
          }}>
            <span style={{
              padding: '8px 16px',
              borderRadius: theme.borderRadius.md,
              backgroundColor: getSentimentColor(tideData.sentiment).bg,
              color: getSentimentColor(tideData.sentiment).text,
              fontWeight: 'bold',
              fontSize: theme.typography.fontSize.lg,
            }}>
              {tideData.sentiment === 'bullish' && '📈 '}
              {tideData.sentiment === 'bearish' && '📉 '}
              {tideData.sentiment?.toUpperCase() || 'NEUTRAL'}
            </span>
          </div>

          {/* Call/Put Bar */}
          <div style={{
            marginBottom: theme.spacing.sm,
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: theme.typography.fontSize.xs,
              marginBottom: '4px',
            }}>
              <span style={{ color: '#166534' }}>Calls {tideData.callPercent?.toFixed(1) || 50}%</span>
              <span style={{ color: '#991b1b' }}>Puts {tideData.putPercent?.toFixed(1) || 50}%</span>
            </div>
            <div style={{
              display: 'flex',
              height: '8px',
              borderRadius: '4px',
              overflow: 'hidden',
              backgroundColor: '#e5e7eb',
            }}>
              <div style={{
                width: `${tideData.callPercent || 50}%`,
                backgroundColor: '#22c55e',
              }} />
              <div style={{
                width: `${tideData.putPercent || 50}%`,
                backgroundColor: '#ef4444',
              }} />
            </div>
          </div>

          {/* Additional Stats */}
          {(tideData.totalVolume || tideData.netFlow) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: theme.spacing.xs,
              fontSize: '11px',
            }}>
              {tideData.totalVolume && (
                <div style={{
                  padding: theme.spacing.xs,
                  backgroundColor: theme.colors.gray100,
                  borderRadius: theme.borderRadius.sm,
                  textAlign: 'center',
                }}>
                  <div style={{ color: theme.colors.textMuted }}>Volume</div>
                  <div style={{ fontWeight: 'bold' }}>{tideData.totalVolume}</div>
                </div>
              )}
              {tideData.netFlow && (
                <div style={{
                  padding: theme.spacing.xs,
                  backgroundColor: tideData.netFlow > 0 ? '#dcfce7' : '#fee2e2',
                  borderRadius: theme.borderRadius.sm,
                  textAlign: 'center',
                }}>
                  <div style={{ color: theme.colors.textMuted }}>Net Flow</div>
                  <div style={{
                    fontWeight: 'bold',
                    color: tideData.netFlow > 0 ? '#166534' : '#991b1b',
                  }}>
                    {tideData.netFlow > 0 ? '+' : ''}{tideData.netFlow}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Timestamp */}
          {tideData.timestamp && (
            <div style={{
              marginTop: theme.spacing.sm,
              fontSize: '10px',
              color: theme.colors.textMuted,
              textAlign: 'center',
            }}>
              Last updated: {new Date(tideData.timestamp).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export default MarketTideCard;
