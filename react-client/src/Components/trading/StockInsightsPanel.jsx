/**
 * StockInsightsPanel - AI-powered stock analysis and trade signals
 */

import { useState, useEffect } from 'react';
import theme from '../../theme';
import Card from '../common/Card';

const StockInsightsPanel = ({ symbol, currentPrice }) => {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!symbol) return;

    const fetchAnalysis = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/stock/${symbol}/analysis`);
        if (res.ok) {
          const data = await res.json();
          setAnalysis(data);
        } else {
          // Generate basic analysis if API fails
          setAnalysis(generateBasicAnalysis(symbol, currentPrice));
        }
      } catch (err) {
        console.error('Failed to fetch analysis:', err);
        setAnalysis(generateBasicAnalysis(symbol, currentPrice));
      } finally {
        setLoading(false);
      }
    };

    fetchAnalysis();
  }, [symbol, currentPrice]);

  // Generate basic analysis when API unavailable
  const generateBasicAnalysis = (sym, price) => ({
    recommendation: 'HOLD',
    confidence: 50,
    reasoning: 'Insufficient data for analysis. Review technical indicators.',
    signals: {
      rsi: { value: 50, signal: 'Neutral' },
      trend: 'Sideways',
      support: price ? price * 0.95 : null,
      resistance: price ? price * 1.05 : null
    }
  });

  if (loading) {
    return (
      <Card style={{ padding: theme.spacing.lg }}>
        <div style={{ color: theme.colors.gray500, textAlign: 'center' }}>
          Analyzing {symbol}...
        </div>
      </Card>
    );
  }

  const getRecommendationColor = (rec) => {
    switch (rec?.toUpperCase()) {
      case 'BUY':
      case 'STRONG BUY':
        return theme.colors.success;
      case 'SELL':
      case 'STRONG SELL':
        return theme.colors.error;
      default:
        return theme.colors.warning;
    }
  };

  const getRSIColor = (rsi) => {
    if (rsi >= 70) return theme.colors.error;
    if (rsi <= 30) return theme.colors.success;
    return theme.colors.gray600;
  };

  const formatPrice = (p) => p ? `$${p.toFixed(2)}` : '--';

  return (
    <Card style={{ padding: theme.spacing.lg }}>
      <h3 style={{
        margin: 0,
        marginBottom: theme.spacing.md,
        fontSize: theme.typography.fontSize.lg,
        fontWeight: theme.typography.fontWeight.bold
      }}>
        AI Analysis
      </h3>

      {/* Recommendation Badge */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.md,
        marginBottom: theme.spacing.lg,
        padding: theme.spacing.md,
        backgroundColor: theme.colors.gray50,
        borderRadius: theme.borderRadius.md
      }}>
        <div style={{
          padding: `${theme.spacing.sm} ${theme.spacing.md}`,
          backgroundColor: getRecommendationColor(analysis?.recommendation),
          color: theme.colors.white,
          borderRadius: theme.borderRadius.md,
          fontWeight: theme.typography.fontWeight.bold,
          fontSize: theme.typography.fontSize.lg
        }}>
          {analysis?.recommendation || 'HOLD'}
        </div>
        <div>
          <div style={{
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray500
          }}>
            Confidence
          </div>
          <div style={{
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold
          }}>
            {analysis?.confidence || 50}%
          </div>
        </div>
      </div>

      {/* Reasoning */}
      {analysis?.reasoning && (
        <div style={{
          marginBottom: theme.spacing.lg,
          padding: theme.spacing.md,
          backgroundColor: theme.colors.gray50,
          borderRadius: theme.borderRadius.md,
          fontSize: theme.typography.fontSize.sm,
          color: theme.colors.gray700,
          lineHeight: 1.5
        }}>
          {analysis.reasoning}
        </div>
      )}

      {/* Technical Signals */}
      <div style={{ marginBottom: theme.spacing.md }}>
        <div style={{
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.fontWeight.bold,
          color: theme.colors.gray700,
          marginBottom: theme.spacing.sm
        }}>
          Technical Signals
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: theme.spacing.sm
        }}>
          {/* RSI */}
          <SignalItem
            label="RSI (14)"
            value={analysis?.signals?.rsi?.value?.toFixed(0) || '--'}
            signal={analysis?.signals?.rsi?.signal || 'Neutral'}
            color={getRSIColor(analysis?.signals?.rsi?.value)}
          />

          {/* Trend */}
          <SignalItem
            label="Trend"
            value={analysis?.signals?.trend || 'Sideways'}
            color={
              analysis?.signals?.trend === 'Bullish' ? theme.colors.success :
              analysis?.signals?.trend === 'Bearish' ? theme.colors.error :
              theme.colors.gray600
            }
          />

          {/* Support */}
          <SignalItem
            label="Support"
            value={formatPrice(analysis?.signals?.support)}
            color={theme.colors.success}
          />

          {/* Resistance */}
          <SignalItem
            label="Resistance"
            value={formatPrice(analysis?.signals?.resistance)}
            color={theme.colors.error}
          />
        </div>
      </div>

      {/* Trade Ideas Preview */}
      {analysis?.tradeIdeas && analysis.tradeIdeas.length > 0 && (
        <div>
          <div style={{
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.gray700,
            marginBottom: theme.spacing.sm
          }}>
            Trade Ideas
          </div>

          {analysis.tradeIdeas.slice(0, 2).map((idea, idx) => (
            <div
              key={idx}
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.sm,
                marginBottom: theme.spacing.xs,
                fontSize: theme.typography.fontSize.sm
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: theme.spacing.xs
              }}>
                <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
                  {idea.type}
                </span>
                <span style={{ color: theme.colors.primary }}>
                  {idea.confidence}% conf
                </span>
              </div>
              <div style={{ color: theme.colors.gray600 }}>
                Entry: {formatPrice(idea.entry)} | Target: {formatPrice(idea.target)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

const SignalItem = ({ label, value, signal, color }) => (
  <div style={{
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.gray50,
    borderRadius: theme.borderRadius.sm
  }}>
    <div style={{
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.gray500,
      marginBottom: '2px'
    }}>
      {label}
    </div>
    <div style={{
      fontSize: theme.typography.fontSize.md,
      fontWeight: theme.typography.fontWeight.bold,
      color: color || theme.colors.text
    }}>
      {value}
    </div>
    {signal && (
      <div style={{
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.gray500
      }}>
        {signal}
      </div>
    )}
  </div>
);

export default StockInsightsPanel;
