import React, { useState, useEffect } from 'react';

/**
 * SignalSummaryPanel - Displays AI trading signals with confidence and reasoning
 *
 * Surfaces the composite signal generation from technicalIndicatorsService.js
 */
const SignalSummaryPanel = ({ symbol, onSignalUpdate }) => {
  const [signalData, setSignalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!symbol) return;

    const fetchSignals = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/indicators/${symbol}/signals`);
        if (!response.ok) throw new Error('Failed to fetch signals');
        const data = await response.json();
        setSignalData(data);
        if (onSignalUpdate) onSignalUpdate(data);
        setError(null);
      } catch (err) {
        setError(err.message);
        // Use fallback data structure
        setSignalData({
          signal: 'HOLD',
          confidence: 50,
          bullishScore: 0,
          bearishScore: 0,
          reasons: [],
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSignals();
    const interval = setInterval(fetchSignals, 30000); // Refresh every 30s

    return () => clearInterval(interval);
  }, [symbol, onSignalUpdate]);

  const getSignalColor = (signal) => {
    switch (signal) {
      case 'BUY':
        return '#22c55e';
      case 'SELL':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  const getSignalBgColor = (signal) => {
    switch (signal) {
      case 'BUY':
        return 'rgba(34, 197, 94, 0.1)';
      case 'SELL':
        return 'rgba(239, 68, 68, 0.1)';
      default:
        return 'rgba(107, 114, 128, 0.1)';
    }
  };

  const styles = {
    container: {
      background: '#ffffff',
      borderRadius: '8px',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
      overflow: 'hidden',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 16px',
      borderBottom: '1px solid #e5e7eb',
      cursor: 'pointer',
    },
    title: {
      fontSize: '14px',
      fontWeight: '600',
      color: '#374151',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    signalBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '4px 12px',
      borderRadius: '16px',
      fontSize: '12px',
      fontWeight: '700',
      letterSpacing: '0.5px',
    },
    content: {
      padding: '16px',
    },
    confidenceContainer: {
      marginBottom: '16px',
    },
    confidenceLabel: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '6px',
      fontSize: '13px',
      color: '#6b7280',
    },
    confidenceBar: {
      height: '8px',
      background: '#e5e7eb',
      borderRadius: '4px',
      overflow: 'hidden',
    },
    confidenceFill: {
      height: '100%',
      borderRadius: '4px',
      transition: 'width 0.3s ease',
    },
    scoreContainer: {
      display: 'flex',
      gap: '16px',
      marginBottom: '16px',
    },
    scoreBox: {
      flex: 1,
      padding: '12px',
      borderRadius: '6px',
      textAlign: 'center',
    },
    scoreLabel: {
      fontSize: '11px',
      color: '#6b7280',
      marginBottom: '4px',
      textTransform: 'uppercase',
    },
    scoreValue: {
      fontSize: '20px',
      fontWeight: '700',
    },
    reasonsSection: {
      borderTop: '1px solid #e5e7eb',
      paddingTop: '12px',
    },
    reasonsTitle: {
      fontSize: '12px',
      fontWeight: '600',
      color: '#374151',
      marginBottom: '8px',
    },
    reasonsList: {
      listStyle: 'none',
      padding: 0,
      margin: 0,
    },
    reasonItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 0',
      fontSize: '13px',
      color: '#4b5563',
    },
    reasonIcon: {
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '10px',
    },
    loadingState: {
      padding: '24px',
      textAlign: 'center',
      color: '#9ca3af',
    },
    errorState: {
      padding: '16px',
      background: '#fef2f2',
      color: '#991b1b',
      fontSize: '13px',
      textAlign: 'center',
    },
    expandButton: {
      background: 'none',
      border: 'none',
      color: '#6b7280',
      cursor: 'pointer',
      fontSize: '18px',
      padding: '4px',
    },
  };

  if (loading && !signalData) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingState}>Loading signals...</div>
      </div>
    );
  }

  const signal = signalData?.signal || 'HOLD';
  const confidence = signalData?.confidence || 50;
  const bullishScore = signalData?.bullishScore || 0;
  const bearishScore = signalData?.bearishScore || 0;
  const reasons = signalData?.reasons || [];

  return (
    <div style={styles.container}>
      <div style={styles.header} onClick={() => setExpanded(!expanded)}>
        <span style={styles.title}>
          AI Signal
          <span
            style={{
              ...styles.signalBadge,
              color: getSignalColor(signal),
              background: getSignalBgColor(signal),
            }}
          >
            {signal}
          </span>
        </span>
        <button style={styles.expandButton}>{expanded ? '−' : '+'}</button>
      </div>

      {error && <div style={styles.errorState}>{error}</div>}

      {expanded && (
        <div style={styles.content}>
          {/* Confidence Bar */}
          <div style={styles.confidenceContainer}>
            <div style={styles.confidenceLabel}>
              <span>Confidence</span>
              <span>{confidence}%</span>
            </div>
            <div style={styles.confidenceBar}>
              <div
                style={{
                  ...styles.confidenceFill,
                  width: `${confidence}%`,
                  background:
                    confidence >= 70
                      ? '#22c55e'
                      : confidence >= 50
                        ? '#f59e0b'
                        : '#ef4444',
                }}
              />
            </div>
          </div>

          {/* Bullish vs Bearish Score */}
          <div style={styles.scoreContainer}>
            <div style={{ ...styles.scoreBox, background: 'rgba(34, 197, 94, 0.1)' }}>
              <div style={styles.scoreLabel}>Bullish</div>
              <div style={{ ...styles.scoreValue, color: '#22c55e' }}>{bullishScore}</div>
            </div>
            <div style={{ ...styles.scoreBox, background: 'rgba(239, 68, 68, 0.1)' }}>
              <div style={styles.scoreLabel}>Bearish</div>
              <div style={{ ...styles.scoreValue, color: '#ef4444' }}>{bearishScore}</div>
            </div>
          </div>

          {/* Reasons */}
          {reasons.length > 0 && (
            <div style={styles.reasonsSection}>
              <div style={styles.reasonsTitle}>Contributing Factors</div>
              <ul style={styles.reasonsList}>
                {reasons.map((reason, index) => {
                  const isBullish =
                    reason.toLowerCase().includes('bullish') ||
                    reason.toLowerCase().includes('oversold') ||
                    reason.toLowerCase().includes('above vwap');
                  return (
                    <li key={index} style={styles.reasonItem}>
                      <span
                        style={{
                          ...styles.reasonIcon,
                          background: isBullish ? '#dcfce7' : '#fee2e2',
                          color: isBullish ? '#22c55e' : '#ef4444',
                        }}
                      >
                        {isBullish ? '↑' : '↓'}
                      </span>
                      {reason}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SignalSummaryPanel;
