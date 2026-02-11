/**
 * Semiconductor Sentiment Panel
 *
 * Visualizes SOXX-based sentiment for SOXL/SOXS momentum trading.
 * Shows direction, confidence, market phase, and AI analysis.
 */

import React, { useState, useEffect, useCallback } from 'react';

// Styles
const styles = {
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: '12px',
    padding: '20px',
    color: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    borderBottom: '1px solid #333',
    paddingBottom: '12px',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  refreshButton: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: '6px',
    padding: '6px 12px',
    color: '#aaa',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.2s',
  },
  mainDisplay: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '20px',
  },
  card: {
    backgroundColor: '#252542',
    borderRadius: '8px',
    padding: '16px',
  },
  cardLabel: {
    fontSize: '12px',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  cardValue: {
    fontSize: '24px',
    fontWeight: '600',
  },
  cardSubtext: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
  },
  directionBullish: {
    color: '#00c853',
  },
  directionBearish: {
    color: '#ff5252',
  },
  directionNeutral: {
    color: '#ffc107',
  },
  confidenceBar: {
    height: '8px',
    backgroundColor: '#333',
    borderRadius: '4px',
    marginTop: '8px',
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.5s ease',
  },
  phaseIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  phaseDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  signalsContainer: {
    backgroundColor: '#252542',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '20px',
  },
  signalsList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  signalItem: {
    padding: '8px 0',
    borderBottom: '1px solid #333',
    fontSize: '13px',
    color: '#ccc',
  },
  aiSection: {
    backgroundColor: '#1e1e3f',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #3f3f8f',
  },
  aiHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  aiBadge: {
    backgroundColor: '#6366f1',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: '600',
  },
  aiReasoning: {
    fontSize: '13px',
    color: '#aaa',
    fontStyle: 'italic',
    marginTop: '8px',
    padding: '8px',
    backgroundColor: '#252542',
    borderRadius: '4px',
  },
  tradingRecommendation: {
    marginTop: '20px',
    padding: '16px',
    borderRadius: '8px',
    textAlign: 'center',
  },
  recommendBuy: {
    backgroundColor: 'rgba(0, 200, 83, 0.15)',
    border: '1px solid #00c853',
  },
  recommendSell: {
    backgroundColor: 'rgba(255, 82, 82, 0.15)',
    border: '1px solid #ff5252',
  },
  recommendWait: {
    backgroundColor: 'rgba(255, 193, 7, 0.15)',
    border: '1px solid #ffc107',
  },
  recommendSymbol: {
    fontSize: '28px',
    fontWeight: '700',
    marginBottom: '8px',
  },
  thresholdsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    marginTop: '12px',
  },
  thresholdItem: {
    textAlign: 'center',
    padding: '8px',
    backgroundColor: '#333',
    borderRadius: '4px',
  },
  thresholdLabel: {
    fontSize: '10px',
    color: '#888',
    textTransform: 'uppercase',
  },
  thresholdValue: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#fff',
  },
  error: {
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    border: '1px solid #ff5252',
    borderRadius: '8px',
    padding: '16px',
    color: '#ff5252',
    textAlign: 'center',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    color: '#666',
  },
};

// Phase colors
const phaseColors = {
  PRE_MARKET: '#666',
  OPEN: '#ffc107',
  SETTLE: '#ff9800',
  ACTIVE: '#00c853',
  WIND_DOWN: '#ff5722',
  CLOSE: '#f44336',
  AFTER_HOURS: '#666',
  CLOSED: '#444',
};

// Direction to color
const getDirectionColor = direction => {
  switch (direction) {
    case 'bullish':
      return '#00c853';
    case 'bearish':
      return '#ff5252';
    default:
      return '#ffc107';
  }
};

// Confidence bar color
const getConfidenceColor = (confidence, direction) => {
  if (confidence >= 80) return getDirectionColor(direction);
  if (confidence >= 60) return '#ffc107';
  return '#ff5722';
};

const SemiconductorSentimentPanel = ({ onPresetSelect }) => {
  const [sentiment, setSentiment] = useState(null);
  const [phase, setPhase] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Fetch sentiment data
  const fetchSentiment = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      const [sentimentRes, phaseRes, aiRes] = await Promise.all([
        fetch(`/api/semiconductor/sentiment${forceRefresh ? '?refresh=true' : ''}`),
        fetch('/api/semiconductor/phase'),
        fetch('/api/semiconductor/ai-analysis'),
      ]);

      const sentimentData = await sentimentRes.json();
      const phaseData = await phaseRes.json();
      const aiData = await aiRes.json();

      setSentiment(sentimentData);
      setPhase(phaseData);
      setAiAnalysis(aiData);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Trigger AI analysis
  const triggerAIAnalysis = async () => {
    try {
      const response = await fetch('/api/semiconductor/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual' }),
      });
      const data = await response.json();

      if (data.sentiment) setSentiment(data.sentiment);
      if (data.analysis) setAiAnalysis({ available: true, analysis: data.analysis });
      setLastUpdate(new Date());
    } catch (err) {
      console.error('AI analysis failed:', err);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchSentiment();

    // Poll every 30 seconds
    const interval = setInterval(() => fetchSentiment(), 30000);
    return () => clearInterval(interval);
  }, [fetchSentiment]);

  if (loading && !sentiment) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading semiconductor sentiment...</div>
      </div>
    );
  }

  if (error && !sentiment) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <div style={{ fontSize: '16px', marginBottom: '8px' }}>Failed to load sentiment</div>
          <div style={{ fontSize: '12px' }}>{error}</div>
          <button
            style={{ ...styles.refreshButton, marginTop: '12px' }}
            onClick={() => fetchSentiment(true)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const directionStyle =
    sentiment?.direction === 'bullish'
      ? styles.directionBullish
      : sentiment?.direction === 'bearish'
        ? styles.directionBearish
        : styles.directionNeutral;

  const recommendedSymbol = sentiment?.recommendedSymbol || 'WAIT';
  const canTrade = sentiment?.canTrade && phase?.tradingAllowed;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>
          <span>Semiconductor Sentiment</span>
          <span style={{ fontSize: '12px', color: '#666' }}>SOXX</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            style={styles.refreshButton}
            onClick={() => fetchSentiment(true)}
            title="Refresh sentiment"
          >
            Refresh
          </button>
          <button
            style={{ ...styles.refreshButton, backgroundColor: '#3f3f8f', borderColor: '#6366f1' }}
            onClick={triggerAIAnalysis}
            title="Run AI analysis"
          >
            AI Analyze
          </button>
        </div>
      </div>

      {/* Main Display */}
      <div style={styles.mainDisplay}>
        {/* Direction Card */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>Direction</div>
          <div style={{ ...styles.cardValue, ...directionStyle }}>
            {sentiment?.direction?.toUpperCase() || 'UNKNOWN'}
          </div>
          <div style={styles.cardSubtext}>{sentiment?.intradayChange || 'N/A'}</div>
        </div>

        {/* Confidence Card */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>Confidence</div>
          <div style={styles.cardValue}>{sentiment?.confidence || 0}%</div>
          <div style={styles.confidenceBar}>
            <div
              style={{
                ...styles.confidenceFill,
                width: `${sentiment?.confidence || 0}%`,
                backgroundColor: getConfidenceColor(sentiment?.confidence, sentiment?.direction),
              }}
            />
          </div>
          {sentiment?.aiEnhanced && (
            <div style={{ ...styles.cardSubtext, color: '#6366f1' }}>AI Enhanced</div>
          )}
        </div>

        {/* Phase Card */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>Market Phase</div>
          <div style={styles.phaseIndicator}>
            <div
              style={{
                ...styles.phaseDot,
                backgroundColor: phaseColors[phase?.phase] || '#666',
              }}
            />
            <span style={styles.cardValue}>{phase?.phase || 'UNKNOWN'}</span>
          </div>
          <div style={styles.cardSubtext}>
            {phase?.tradingAllowed ? 'Trading Allowed' : 'No Trading'}
          </div>
        </div>

        {/* SOXX Price Card */}
        <div style={styles.card}>
          <div style={styles.cardLabel}>SOXX Price</div>
          <div style={styles.cardValue}>${sentiment?.currentPrice || 'N/A'}</div>
          <div style={styles.cardSubtext}>Open: ${sentiment?.openPrice || 'N/A'}</div>
        </div>
      </div>

      {/* Dynamic Thresholds */}
      {sentiment?.thresholds && (
        <div style={styles.card}>
          <div style={styles.cardLabel}>Dynamic Thresholds (Volatility-Scaled)</div>
          <div style={styles.thresholdsGrid}>
            <div style={styles.thresholdItem}>
              <div style={styles.thresholdLabel}>Entry</div>
              <div style={styles.thresholdValue}>{sentiment.thresholds.entry}</div>
            </div>
            <div style={styles.thresholdItem}>
              <div style={styles.thresholdLabel}>Exit</div>
              <div style={styles.thresholdValue}>{sentiment.thresholds.exit}</div>
            </div>
            <div style={styles.thresholdItem}>
              <div style={styles.thresholdLabel}>Switch</div>
              <div style={styles.thresholdValue}>{sentiment.thresholds.switch}</div>
            </div>
          </div>
          <div style={{ ...styles.cardSubtext, marginTop: '8px' }}>
            Volatility: {sentiment.volatility}
          </div>
        </div>
      )}

      {/* Signals */}
      {sentiment?.signals && sentiment.signals.length > 0 && (
        <div style={styles.signalsContainer}>
          <div style={styles.cardLabel}>Active Signals</div>
          <ul style={styles.signalsList}>
            {sentiment.signals.map((signal, idx) => (
              <li key={idx} style={styles.signalItem}>
                {signal}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI Analysis Section */}
      {aiAnalysis?.available && aiAnalysis.analysis && (
        <div style={styles.aiSection}>
          <div style={styles.aiHeader}>
            <span style={styles.aiBadge}>AI</span>
            <span style={{ fontWeight: '600' }}>Claude Analysis</span>
            <span style={{ fontSize: '11px', color: '#888', marginLeft: 'auto' }}>
              {aiAnalysis.analysis.timestamp
                ? new Date(aiAnalysis.analysis.timestamp).toLocaleTimeString()
                : ''}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div>
              <div style={styles.cardLabel}>AI Direction</div>
              <div style={{ ...styles.cardValue, fontSize: '16px', color: getDirectionColor(aiAnalysis.analysis.direction) }}>
                {aiAnalysis.analysis.direction?.toUpperCase()}
              </div>
            </div>
            <div>
              <div style={styles.cardLabel}>Confidence Adj.</div>
              <div
                style={{
                  ...styles.cardValue,
                  fontSize: '16px',
                  color:
                    aiAnalysis.analysis.confidenceAdjustment > 0
                      ? '#00c853'
                      : aiAnalysis.analysis.confidenceAdjustment < 0
                        ? '#ff5252'
                        : '#fff',
                }}
              >
                {aiAnalysis.analysis.confidenceAdjustment > 0 ? '+' : ''}
                {aiAnalysis.analysis.confidenceAdjustment}
              </div>
            </div>
            <div>
              <div style={styles.cardLabel}>Risk Level</div>
              <div
                style={{
                  ...styles.cardValue,
                  fontSize: '16px',
                  color:
                    aiAnalysis.analysis.riskLevel === 'low'
                      ? '#00c853'
                      : aiAnalysis.analysis.riskLevel === 'high'
                        ? '#ff5252'
                        : '#ffc107',
                }}
              >
                {aiAnalysis.analysis.riskLevel?.toUpperCase()}
              </div>
            </div>
          </div>

          {aiAnalysis.analysis.reasoning && (
            <div style={styles.aiReasoning}>"{aiAnalysis.analysis.reasoning}"</div>
          )}

          {aiAnalysis.analysis.keyFactors && aiAnalysis.analysis.keyFactors.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
              Key factors: {aiAnalysis.analysis.keyFactors.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Trading Recommendation */}
      <div
        style={{
          ...styles.tradingRecommendation,
          ...(recommendedSymbol === 'SOXL'
            ? styles.recommendBuy
            : recommendedSymbol === 'SOXS'
              ? styles.recommendSell
              : styles.recommendWait),
        }}
      >
        <div style={styles.cardLabel}>Recommended Action</div>
        <div
          style={{
            ...styles.recommendSymbol,
            color:
              recommendedSymbol === 'SOXL'
                ? '#00c853'
                : recommendedSymbol === 'SOXS'
                  ? '#ff5252'
                  : '#ffc107',
          }}
        >
          {recommendedSymbol === 'CASH' ? 'WAIT' : recommendedSymbol}
        </div>
        <div style={{ fontSize: '12px', color: '#888' }}>
          {canTrade
            ? `${sentiment?.confidence}% confidence - Ready to trade`
            : phase?.tradingAllowed
              ? 'Confidence too low - Wait for stronger signal'
              : `${phase?.phase} - Trading not allowed`}
        </div>

        {onPresetSelect && canTrade && recommendedSymbol !== 'CASH' && (
          <button
            style={{
              marginTop: '12px',
              padding: '10px 20px',
              backgroundColor: recommendedSymbol === 'SOXL' ? '#00c853' : '#ff5252',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
            }}
            onClick={() =>
              onPresetSelect(recommendedSymbol === 'SOXL' ? 'SOXL_MOMENTUM' : 'SOXS_HEDGE')
            }
          >
            Start {recommendedSymbol === 'SOXL' ? 'SOXL_MOMENTUM' : 'SOXS_HEDGE'} Session
          </button>
        )}
      </div>

      {/* Last Update */}
      <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '11px', color: '#555' }}>
        Last updated: {lastUpdate?.toLocaleTimeString() || 'Never'}
      </div>
    </div>
  );
};

export default SemiconductorSentimentPanel;
