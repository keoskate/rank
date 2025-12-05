/**
 * StockInsightsPanel - AI-powered stock analysis with full transparency
 *
 * Shows EXACTLY how the AI recommendation is calculated with:
 * - Signal breakdown (RSI, Trend, Momentum, Volume, etc.)
 * - Score contribution from each signal
 * - Explanation of WHY each signal matters
 */

import { useState, useEffect } from 'react';
import theme from '../../theme';
import Card from '../common/Card';

const StockInsightsPanel = ({ symbol, currentPrice }) => {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!symbol) return;

    const fetchAnalysis = async () => {
      setLoading(true);

      try {
        const res = await fetch(`/api/stock/analysis/${symbol}`);
        if (res.ok) {
          const data = await res.json();
          setAnalysis(data.analysis || data);
        } else {
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

  const generateBasicAnalysis = (sym, price) => ({
    recommendation: {
      action: 'Neutral',
      score: 0,
      confidence: 50,
      reasons: ['Insufficient data for analysis'],
    },
    technicals: { rsi: 50, rsiSignal: 'Neutral', trendSignal: 'Neutral' },
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

  const rec = analysis?.recommendation;
  const technicals = analysis?.technicals;
  const signalBreakdown =
    rec?.signalBreakdown || technicals?.signalBreakdown || [];

  const getRecommendationColor = action => {
    if (!action) return theme.colors.warning;
    const a = action.toLowerCase();
    if (a.includes('buy')) return theme.colors.success;
    if (a.includes('sell')) return theme.colors.error;
    return theme.colors.warning;
  };

  const getSignalColor = signal => {
    if (!signal) return theme.colors.gray500;
    const s = signal.toLowerCase();
    if (
      s.includes('bullish') ||
      s.includes('high interest') ||
      s.includes('low risk')
    )
      return theme.colors.success;
    if (s.includes('bearish') || s.includes('high risk') || s.includes('low'))
      return theme.colors.error;
    return theme.colors.gray600;
  };

  const getScoreColor = score => {
    if (score > 0) return theme.colors.success;
    if (score < 0) return theme.colors.error;
    return theme.colors.gray500;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
      }}
    >
      <Card style={{ padding: theme.spacing.lg }}>
        <h3
          style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold,
          }}
        >
          AI Analysis
        </h3>

        {/* Main Recommendation */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.md,
            marginBottom: theme.spacing.md,
            padding: theme.spacing.md,
            backgroundColor: `${getRecommendationColor(rec?.action)}15`,
            borderRadius: theme.borderRadius.md,
            border: `2px solid ${getRecommendationColor(rec?.action)}`,
          }}
        >
          <div
            style={{
              padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
              backgroundColor: getRecommendationColor(rec?.action),
              color: theme.colors.white,
              borderRadius: theme.borderRadius.md,
              fontWeight: theme.typography.fontWeight.bold,
              fontSize: theme.typography.fontSize.lg,
            }}
          >
            {rec?.action || 'HOLD'}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray500,
              }}
            >
              Confidence
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.xl,
                fontWeight: theme.typography.fontWeight.bold,
              }}
            >
              {rec?.confidence || technicals?.confidence || 50}%
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray500,
              }}
            >
              Score
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.xl,
                fontWeight: theme.typography.fontWeight.bold,
                color: getScoreColor(rec?.score || 0),
              }}
            >
              {rec?.score >= 0 ? '+' : ''}
              {parseFloat(rec?.score || 0).toFixed(1)} / {rec?.maxScore || 10}
            </div>
          </div>
        </div>

        {/* Confidence Explanation */}
        {(rec?.confidenceExplanation || technicals?.confidenceExplanation) && (
          <div
            style={{
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.md,
              marginBottom: theme.spacing.md,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray600,
            }}
          >
            {rec?.confidenceExplanation || technicals?.confidenceExplanation}
          </div>
        )}

        {/* Key Reasons */}
        {rec?.reasons && rec.reasons.length > 0 && (
          <div style={{ marginBottom: theme.spacing.md }}>
            <div
              style={{
                fontSize: theme.typography.fontSize.sm,
                fontWeight: theme.typography.fontWeight.bold,
                marginBottom: theme.spacing.xs,
              }}
            >
              Key Factors
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: theme.spacing.md,
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray700,
              }}
            >
              {rec.reasons.map((reason, i) => (
                <li key={i} style={{ marginBottom: '4px' }}>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Toggle Signal Details */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{
            width: '100%',
            padding: theme.spacing.sm,
            border: `1px solid ${theme.colors.gray300}`,
            borderRadius: theme.borderRadius.md,
            backgroundColor: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.medium,
            color: theme.colors.primary,
          }}
        >
          <span>
            {showDetails ? 'Hide' : 'Show'} Signal Breakdown (
            {signalBreakdown.length} indicators)
          </span>
          <span style={{ fontSize: theme.typography.fontSize.lg }}>
            {showDetails ? '▲' : '▼'}
          </span>
        </button>
      </Card>

      {/* Signal Breakdown Detail */}
      {showDetails && signalBreakdown.length > 0 && (
        <Card style={{ padding: theme.spacing.lg }}>
          <h4
            style={{
              margin: 0,
              marginBottom: theme.spacing.md,
              fontSize: theme.typography.fontSize.md,
            }}
          >
            Signal Breakdown (How Score is Calculated)
          </h4>

          {signalBreakdown.map((signal, idx) => (
            <div
              key={idx}
              style={{
                padding: theme.spacing.md,
                backgroundColor:
                  signal.score > 0
                    ? `${theme.colors.success}08`
                    : signal.score < 0
                      ? `${theme.colors.error}08`
                      : theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
                marginBottom: theme.spacing.sm,
                borderLeft: `4px solid ${getScoreColor(signal.score)}`,
              }}
            >
              {/* Header Row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: theme.spacing.xs,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.md,
                      fontWeight: theme.typography.fontWeight.bold,
                    }}
                  >
                    {signal.indicator}
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: getSignalColor(signal.signal),
                    }}
                  >
                    {signal.signal} • {signal.value}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.lg,
                      fontWeight: theme.typography.fontWeight.bold,
                      color: getScoreColor(signal.score),
                    }}
                  >
                    {signal.score >= 0 ? '+' : ''}
                    {signal.score.toFixed(1)}
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    max: ±{signal.maxScore} ({signal.weight})
                  </div>
                </div>
              </div>

              {/* Explanation */}
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray700,
                  marginTop: theme.spacing.xs,
                  paddingTop: theme.spacing.xs,
                  borderTop: `1px solid ${theme.colors.gray200}`,
                }}
              >
                {signal.explanation}
              </div>

              {/* Formula (if available) */}
              {signal.formula && (
                <div
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.gray500,
                    fontFamily: 'monospace',
                    marginTop: theme.spacing.xs,
                    padding: theme.spacing.xs,
                    backgroundColor: theme.colors.gray100,
                    borderRadius: theme.borderRadius.sm,
                  }}
                >
                  Formula: {signal.formula}
                </div>
              )}

              {/* Details (if available) */}
              {signal.details && (
                <div
                  style={{
                    display: 'flex',
                    gap: theme.spacing.md,
                    flexWrap: 'wrap',
                    marginTop: theme.spacing.xs,
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.gray500,
                  }}
                >
                  {Object.entries(signal.details).map(([key, value]) => (
                    <span key={key}>
                      {key}: <strong>{value}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Score Summary */}
          <div
            style={{
              marginTop: theme.spacing.md,
              padding: theme.spacing.md,
              backgroundColor: theme.colors.gray100,
              borderRadius: theme.borderRadius.md,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray600,
                }}
              >
                Total Score
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                Sum of all signal scores
              </div>
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
                color: getScoreColor(rec?.score || 0),
              }}
            >
              {parseFloat(rec?.score || 0) >= 0 ? '+' : ''}
              {parseFloat(rec?.score || 0).toFixed(1)}
            </div>
          </div>

          {/* Scoring Legend */}
          <div
            style={{
              marginTop: theme.spacing.md,
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.sm,
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.gray500,
            }}
          >
            <strong>Scoring Scale:</strong> Strong Sell (&lt;-5) → Sell (-5 to
            -2.5) → Lean Sell (-2.5 to -0.5) → Neutral (-0.5 to 0.5) → Lean Buy
            (0.5 to 2.5) → Buy (2.5 to 5) → Strong Buy (&gt;5)
          </div>
        </Card>
      )}

      {/* Technical Signals Summary */}
      <Card style={{ padding: theme.spacing.lg }}>
        <h4
          style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            fontSize: theme.typography.fontSize.md,
          }}
        >
          Technical Signals
        </h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: theme.spacing.sm,
          }}
        >
          <SignalItem
            label="RSI (14)"
            value={technicals?.rsi || '--'}
            signal={technicals?.rsiSignal || 'Neutral'}
            color={
              parseFloat(technicals?.rsi) >= 70
                ? theme.colors.error
                : parseFloat(technicals?.rsi) <= 30
                  ? theme.colors.success
                  : theme.colors.gray600
            }
          />
          <SignalItem
            label="Trend"
            value={technicals?.trendSignal || 'Neutral'}
            color={
              technicals?.trendSignal === 'Bullish'
                ? theme.colors.success
                : technicals?.trendSignal === 'Bearish'
                  ? theme.colors.error
                  : theme.colors.gray600
            }
          />
          <SignalItem
            label="Support"
            value={technicals?.low52w ? `$${technicals.low52w}` : '--'}
            color={theme.colors.success}
          />
          <SignalItem
            label="Resistance"
            value={technicals?.high52w ? `$${technicals.high52w}` : '--'}
            color={theme.colors.error}
          />
        </div>
      </Card>
    </div>
  );
};

const SignalItem = ({ label, value, signal, color }) => (
  <div
    style={{
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.gray50,
      borderRadius: theme.borderRadius.sm,
    }}
  >
    <div
      style={{
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.gray500,
        marginBottom: '2px',
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: theme.typography.fontSize.md,
        fontWeight: theme.typography.fontWeight.bold,
        color: color || theme.colors.text,
      }}
    >
      {value}
    </div>
    {signal && (
      <div
        style={{
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.gray500,
        }}
      >
        {signal}
      </div>
    )}
  </div>
);

export default StockInsightsPanel;
