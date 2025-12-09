import React, { useState, useEffect } from 'react';

/**
 * PatternDetectionPanel - Displays detected chart patterns from ML/heuristic analysis
 *
 * Surfaces pattern detection from patternRecognitionService.js
 */
const PatternDetectionPanel = ({ symbol, onPatternUpdate }) => {
  const [patternData, setPatternData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!symbol) return;

    const fetchPatterns = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/patterns/${symbol}/detect`);
        if (!response.ok) throw new Error('Failed to fetch patterns');
        const data = await response.json();
        setPatternData(data);
        if (onPatternUpdate) onPatternUpdate(data);
        setError(null);
      } catch (err) {
        setError(err.message);
        // Use fallback data
        setPatternData({
          signal: 'HOLD',
          confidence: 50,
          patterns: [],
          probabilities: { BUY_SIGNAL: 33, HOLD: 34, SELL_SIGNAL: 33 },
        });
      } finally {
        setLoading(false);
      }
    };

    fetchPatterns();
    const interval = setInterval(fetchPatterns, 60000); // Refresh every 60s

    return () => clearInterval(interval);
  }, [symbol, onPatternUpdate]);

  const getPatternIcon = (pattern) => {
    const p = pattern.toLowerCase();
    if (p.includes('breakout') || p.includes('bullish') || p.includes('bottom'))
      return { icon: '↗', color: '#22c55e', bg: '#dcfce7' };
    if (p.includes('breakdown') || p.includes('bearish') || p.includes('top'))
      return { icon: '↘', color: '#ef4444', bg: '#fee2e2' };
    if (p.includes('squeeze') || p.includes('flag'))
      return { icon: '◆', color: '#f59e0b', bg: '#fef3c7' };
    if (p.includes('divergence'))
      return { icon: '⟷', color: '#8b5cf6', bg: '#f3e8ff' };
    return { icon: '●', color: '#6b7280', bg: '#f3f4f6' };
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
    patternCount: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '20px',
      height: '20px',
      padding: '0 6px',
      borderRadius: '10px',
      fontSize: '11px',
      fontWeight: '600',
      background: '#e0e7ff',
      color: '#4f46e5',
    },
    content: {
      padding: '16px',
    },
    probabilityContainer: {
      display: 'flex',
      gap: '8px',
      marginBottom: '16px',
    },
    probabilityBar: {
      flex: 1,
      borderRadius: '6px',
      padding: '8px',
      textAlign: 'center',
    },
    probabilityLabel: {
      fontSize: '10px',
      textTransform: 'uppercase',
      marginBottom: '4px',
      opacity: 0.8,
    },
    probabilityValue: {
      fontSize: '16px',
      fontWeight: '700',
    },
    patternsGrid: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    },
    patternCard: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 12px',
      borderRadius: '6px',
      background: '#f9fafb',
      border: '1px solid #e5e7eb',
    },
    patternIcon: {
      width: '28px',
      height: '28px',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '14px',
      fontWeight: '600',
    },
    patternInfo: {
      flex: 1,
    },
    patternName: {
      fontSize: '13px',
      fontWeight: '500',
      color: '#374151',
    },
    patternType: {
      fontSize: '11px',
      color: '#9ca3af',
    },
    noPatterns: {
      padding: '24px',
      textAlign: 'center',
      color: '#9ca3af',
      fontSize: '13px',
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
    mlStatus: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '11px',
      color: '#9ca3af',
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid #e5e7eb',
    },
    mlDot: {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
    },
  };

  if (loading && !patternData) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingState}>Analyzing patterns...</div>
      </div>
    );
  }

  const patterns = patternData?.patterns || [];
  const probabilities = patternData?.probabilities || { BUY_SIGNAL: 33, HOLD: 34, SELL_SIGNAL: 33 };
  const isMLActive = patternData?.isMLPrediction || false;

  return (
    <div style={styles.container}>
      <div style={styles.header} onClick={() => setExpanded(!expanded)}>
        <span style={styles.title}>
          Pattern Detection
          {patterns.length > 0 && <span style={styles.patternCount}>{patterns.length}</span>}
        </span>
        <button style={styles.expandButton}>{expanded ? '−' : '+'}</button>
      </div>

      {error && <div style={styles.errorState}>{error}</div>}

      {expanded && (
        <div style={styles.content}>
          {/* Probability Bars */}
          <div style={styles.probabilityContainer}>
            <div
              style={{
                ...styles.probabilityBar,
                background: 'rgba(34, 197, 94, 0.15)',
                color: '#16a34a',
              }}
            >
              <div style={styles.probabilityLabel}>Buy</div>
              <div style={styles.probabilityValue}>{probabilities.BUY_SIGNAL}%</div>
            </div>
            <div
              style={{
                ...styles.probabilityBar,
                background: 'rgba(107, 114, 128, 0.15)',
                color: '#4b5563',
              }}
            >
              <div style={styles.probabilityLabel}>Hold</div>
              <div style={styles.probabilityValue}>{probabilities.HOLD}%</div>
            </div>
            <div
              style={{
                ...styles.probabilityBar,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#dc2626',
              }}
            >
              <div style={styles.probabilityLabel}>Sell</div>
              <div style={styles.probabilityValue}>{probabilities.SELL_SIGNAL}%</div>
            </div>
          </div>

          {/* Detected Patterns */}
          {patterns.length > 0 ? (
            <div style={styles.patternsGrid}>
              {patterns.map((pattern, index) => {
                const iconStyle = getPatternIcon(pattern);
                return (
                  <div key={index} style={styles.patternCard}>
                    <div
                      style={{
                        ...styles.patternIcon,
                        background: iconStyle.bg,
                        color: iconStyle.color,
                      }}
                    >
                      {iconStyle.icon}
                    </div>
                    <div style={styles.patternInfo}>
                      <div style={styles.patternName}>{pattern}</div>
                      <div style={styles.patternType}>
                        {pattern.toLowerCase().includes('bullish') ||
                        pattern.toLowerCase().includes('breakout') ||
                        pattern.toLowerCase().includes('bottom')
                          ? 'Bullish Pattern'
                          : pattern.toLowerCase().includes('bearish') ||
                              pattern.toLowerCase().includes('breakdown') ||
                              pattern.toLowerCase().includes('top')
                            ? 'Bearish Pattern'
                            : 'Neutral Pattern'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={styles.noPatterns}>No patterns detected at this time</div>
          )}

          {/* ML Status */}
          <div style={styles.mlStatus}>
            <span
              style={{
                ...styles.mlDot,
                background: isMLActive ? '#22c55e' : '#f59e0b',
              }}
            />
            {isMLActive ? 'ML Model Active' : 'Using Heuristic Analysis'}
          </div>
        </div>
      )}
    </div>
  );
};

export default PatternDetectionPanel;
