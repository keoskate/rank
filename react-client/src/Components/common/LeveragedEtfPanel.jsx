/**
 * LeveragedEtfPanel - Specialized strategy for leveraged ETF trading
 *
 * Supports ETF families:
 * - QBTS: QBTX (2x bull), QBTZ (2x bear)
 * - SOXX: SOXL (3x bull), SOXS (3x bear)
 * - PLTR: PLTU (2x bull), PLTZ (2x bear)
 *
 * Combines technical regime + flow sentiment for trading decisions.
 * Automatically fetches CheddarFlow data when possible.
 */

import { useState, useEffect, useCallback } from 'react';
import Card from './Card';
import Button from './Button';
import theme from '../../theme';

const ETF_FAMILIES = [
  { base: 'QBTS', name: 'Defiance Quantum ETF', bull: 'QBTX', bear: 'QBTZ', leverage: '2x' },
  { base: 'SOXX', name: 'iShares Semiconductor', bull: 'SOXL', bear: 'SOXS', leverage: '3x' },
  { base: 'PLTR', name: 'Palantir Technologies', bull: 'PLTU', bear: 'PLTZ', leverage: '2x' },
];

const LeveragedEtfPanel = ({ onSymbolSelect }) => {
  const [selectedFamily, setSelectedFamily] = useState(ETF_FAMILIES[0]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // CheddarFlow state
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowError, setFlowError] = useState(null);
  const [flowData, setFlowData] = useState(null);
  const [autoFetchFlow, setAutoFetchFlow] = useState(true);

  // Manual flow sentiment input (populated by auto-fetch or manual entry)
  const [flowSentiment, setFlowSentiment] = useState('neutral');
  const [putCallRatio, setPutCallRatio] = useState('');
  const [callFlowPercent, setCallFlowPercent] = useState('');

  // Fetch CheddarFlow data automatically
  const fetchCheddarFlow = useCallback(async (symbol) => {
    setFlowLoading(true);
    setFlowError(null);

    try {
      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];

      // Use Chrome profile for authentication
      const response = await fetch(
        `/api/cheddarflow/${symbol}?date=${today}&useProfile=true`
      );

      if (response.ok) {
        const data = await response.json();
        setFlowData(data);

        // Auto-populate the form fields
        if (data.flowData) {
          const fd = data.flowData;

          // Set sentiment
          if (fd.sentimentText) {
            const sentiment = fd.sentimentText.toLowerCase();
            if (sentiment.includes('bullish')) setFlowSentiment('bullish');
            else if (sentiment.includes('bearish')) setFlowSentiment('bearish');
            else setFlowSentiment('neutral');
          }

          // Set P/C ratio
          if (fd.putCallRatio !== undefined) {
            setPutCallRatio(fd.putCallRatio.toString());
          }

          // Set call flow %
          if (fd.callFlowPercent !== undefined) {
            setCallFlowPercent(fd.callFlowPercent.toString());
          }
        }

        return data;
      } else {
        const err = await response.json();
        // Don't show error for auth issues - just means Chrome isn't available
        if (err.error?.includes('Chrome') || err.error?.includes('auth')) {
          setFlowError('CheddarFlow requires Chrome to be closed. Close Chrome and retry.');
        } else {
          setFlowError(err.error || 'Failed to fetch flow data');
        }
        return null;
      }
    } catch (err) {
      setFlowError('Could not connect to CheddarFlow');
      return null;
    } finally {
      setFlowLoading(false);
    }
  }, []);

  // Fetch full analysis with flow data
  const fetchAnalysis = useCallback(async (withFlow = false) => {
    setLoading(true);
    setError(null);

    try {
      let response;

      if (withFlow && (flowSentiment !== 'neutral' || putCallRatio || callFlowPercent)) {
        // POST with flow data
        const flowDataPayload = {
          sentimentText: flowSentiment.charAt(0).toUpperCase() + flowSentiment.slice(1),
          putCallRatio: putCallRatio ? parseFloat(putCallRatio) : undefined,
          callFlowPercent: callFlowPercent ? parseFloat(callFlowPercent) : undefined,
          putFlowPercent: callFlowPercent ? 100 - parseFloat(callFlowPercent) : undefined,
        };

        response = await fetch(`/api/leveraged-etf/analyze/${selectedFamily.base}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flowData: flowDataPayload }),
        });
      } else {
        // GET without flow data
        response = await fetch(`/api/leveraged-etf/analyze/${selectedFamily.base}`);
      }

      if (response.ok) {
        const data = await response.json();
        setAnalysis(data);
      } else {
        const err = await response.json();
        setError(err.error || 'Failed to fetch analysis');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedFamily, flowSentiment, putCallRatio, callFlowPercent]);

  // Auto-fetch flow and analysis when family changes
  useEffect(() => {
    const fetchAll = async () => {
      // First fetch technical analysis
      await fetchAnalysis(false);

      // Then try to fetch CheddarFlow data if auto-fetch is enabled
      if (autoFetchFlow) {
        const flowResult = await fetchCheddarFlow(selectedFamily.base);

        // If we got flow data, re-fetch analysis with it
        if (flowResult?.flowData) {
          // Small delay to let state update
          setTimeout(() => fetchAnalysis(true), 100);
        }
      }
    };

    fetchAll();
  }, [selectedFamily, autoFetchFlow]);

  // Re-analyze when flow inputs change
  useEffect(() => {
    if (flowSentiment !== 'neutral' || putCallRatio || callFlowPercent) {
      fetchAnalysis(true);
    }
  }, [flowSentiment, putCallRatio, callFlowPercent]);

  // Handle applying the recommendation
  const applyRecommendation = () => {
    if (analysis?.decision?.symbol && analysis.decision.symbol !== 'CASH') {
      onSymbolSelect?.(analysis.decision.symbol);
    }
  };

  const getDecisionColor = (direction) => {
    if (direction === 'long') return '#22c55e';
    if (direction === 'short') return '#ef4444';
    return '#eab308';
  };

  const getDecisionBg = (direction) => {
    if (direction === 'long') return '#dcfce7';
    if (direction === 'short') return '#fee2e2';
    return '#fef9c3';
  };

  return (
    <Card>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
        borderBottom: `1px solid ${theme.colors.gray200}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <span style={{ fontSize: '20px' }}>🎯</span>
          <span style={{ fontWeight: 'bold', fontSize: theme.typography.fontSize.md }}>
            Leveraged ETF Strategy
          </span>
        </div>
        <div style={{ display: 'flex', gap: theme.spacing.xs }}>
          <Button
            size="small"
            variant="outline"
            onClick={() => fetchCheddarFlow(selectedFamily.base)}
            disabled={flowLoading}
            title="Fetch latest CheddarFlow data"
          >
            {flowLoading ? '...' : '📊'}
          </Button>
          <Button
            size="small"
            variant="outline"
            onClick={() => fetchAnalysis(true)}
            disabled={loading}
          >
            {loading ? 'Analyzing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* ETF Family Selector */}
      <div style={{ marginBottom: theme.spacing.md }}>
        <div style={{
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.textMuted,
          textTransform: 'uppercase',
          marginBottom: theme.spacing.xs,
        }}>
          Select ETF Family
        </div>
        <div style={{ display: 'flex', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          {ETF_FAMILIES.map((family) => (
            <button
              key={family.base}
              onClick={() => setSelectedFamily(family)}
              style={{
                padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                borderRadius: theme.borderRadius.md,
                border: `2px solid ${selectedFamily.base === family.base ? theme.colors.primary : theme.colors.gray300}`,
                backgroundColor: selectedFamily.base === family.base ? `${theme.colors.primary}10` : 'white',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontWeight: 'bold' }}>{family.base}</div>
              <div style={{ fontSize: '10px', color: theme.colors.textMuted }}>
                {family.bull}/{family.bear} ({family.leverage})
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{
          padding: theme.spacing.sm,
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: theme.borderRadius.md,
          marginBottom: theme.spacing.md,
          fontSize: theme.typography.fontSize.sm,
        }}>
          {error}
        </div>
      )}

      {/* Technical Regime */}
      {analysis?.analysis?.technical && (
        <div style={{
          marginBottom: theme.spacing.md,
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.background,
          borderRadius: theme.borderRadius.md,
        }}>
          <div style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.textMuted,
            textTransform: 'uppercase',
            marginBottom: theme.spacing.xs,
          }}>
            Technical Regime
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{
                padding: '4px 12px',
                borderRadius: theme.borderRadius.sm,
                backgroundColor: analysis.analysis.technical.regime === 'bull' ? '#dcfce7'
                  : analysis.analysis.technical.regime === 'bear' ? '#fee2e2' : '#fef9c3',
                color: analysis.analysis.technical.regime === 'bull' ? '#166534'
                  : analysis.analysis.technical.regime === 'bear' ? '#991b1b' : '#854d0e',
                fontWeight: 'bold',
                fontSize: theme.typography.fontSize.sm,
              }}>
                {analysis.analysis.technical.regime === 'bull' && '📈 '}
                {analysis.analysis.technical.regime === 'bear' && '📉 '}
                {analysis.analysis.technical.regime === 'sideways' && '↔️ '}
                {analysis.analysis.technical.regime.toUpperCase()}
              </span>
              <span style={{
                marginLeft: theme.spacing.sm,
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.textMuted,
              }}>
                {analysis.analysis.technical.confidence}% confidence
              </span>
            </div>
            <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.textMuted }}>
              5d: {analysis.analysis.technical.indicators?.fiveDayReturn}
            </div>
          </div>
          <div style={{
            marginTop: theme.spacing.xs,
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.textSecondary,
          }}>
            {analysis.analysis.technical.description}
          </div>
        </div>
      )}

      {/* CheddarFlow Data Section */}
      <div style={{
        marginBottom: theme.spacing.md,
        padding: theme.spacing.sm,
        backgroundColor: flowData ? '#dcfce7' : '#f0f9ff',
        border: `1px solid ${flowData ? '#22c55e' : '#0ea5e9'}`,
        borderRadius: theme.borderRadius.md,
      }}>
        <div style={{
          fontSize: theme.typography.fontSize.xs,
          color: flowData ? '#166534' : '#0369a1',
          textTransform: 'uppercase',
          marginBottom: theme.spacing.sm,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
            <span>📊</span>
            CheddarFlow Sentiment
            {flowData && <span style={{ marginLeft: '4px' }}>✓ Auto-fetched</span>}
          </div>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '10px',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={autoFetchFlow}
              onChange={(e) => setAutoFetchFlow(e.target.checked)}
            />
            Auto-fetch
          </label>
        </div>

        {/* Flow Error */}
        {flowError && (
          <div style={{
            padding: theme.spacing.xs,
            backgroundColor: '#fef3c7',
            color: '#92400e',
            borderRadius: theme.borderRadius.sm,
            marginBottom: theme.spacing.sm,
            fontSize: theme.typography.fontSize.xs,
          }}>
            {flowError}
          </div>
        )}

        {/* Flow Loading */}
        {flowLoading && (
          <div style={{
            padding: theme.spacing.sm,
            textAlign: 'center',
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSize.sm,
          }}>
            Fetching CheddarFlow data...
          </div>
        )}

        {/* Flow Data Display (when auto-fetched) */}
        {flowData?.flowData && (
          <div style={{
            marginBottom: theme.spacing.sm,
            padding: theme.spacing.xs,
            backgroundColor: 'white',
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.xs,
          }}>
            <div style={{ display: 'flex', gap: theme.spacing.md, flexWrap: 'wrap' }}>
              <span><strong>Sentiment:</strong> {flowData.flowData.sentimentText}</span>
              <span><strong>P/C:</strong> {flowData.flowData.putCallRatio?.toFixed(3)}</span>
              <span><strong>Calls:</strong> {flowData.flowData.callFlowPercent?.toFixed(1)}%</span>
              {flowData.flowData.totalCallFlow && (
                <span><strong>Call $:</strong> ${(flowData.flowData.totalCallFlow / 1000000).toFixed(2)}M</span>
              )}
            </div>
          </div>
        )}

        {/* Manual Input Fields */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: theme.spacing.sm,
          opacity: flowData ? 0.7 : 1,
        }}>
          {/* Sentiment Dropdown */}
          <div>
            <label style={{ fontSize: '10px', color: theme.colors.textMuted }}>Sentiment</label>
            <select
              value={flowSentiment}
              onChange={(e) => setFlowSentiment(e.target.value)}
              style={{
                width: '100%',
                padding: theme.spacing.xs,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.gray300}`,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              <option value="bullish">Bullish</option>
              <option value="neutral">Neutral</option>
              <option value="bearish">Bearish</option>
            </select>
          </div>

          {/* Put/Call Ratio */}
          <div>
            <label style={{ fontSize: '10px', color: theme.colors.textMuted }}>Put/Call Ratio</label>
            <input
              type="number"
              step="0.01"
              placeholder="e.g., 0.046"
              value={putCallRatio}
              onChange={(e) => setPutCallRatio(e.target.value)}
              style={{
                width: '100%',
                padding: theme.spacing.xs,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.gray300}`,
                fontSize: theme.typography.fontSize.sm,
              }}
            />
          </div>

          {/* Call Flow % */}
          <div>
            <label style={{ fontSize: '10px', color: theme.colors.textMuted }}>Call Flow %</label>
            <input
              type="number"
              step="1"
              placeholder="e.g., 95"
              value={callFlowPercent}
              onChange={(e) => setCallFlowPercent(e.target.value)}
              style={{
                width: '100%',
                padding: theme.spacing.xs,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.gray300}`,
                fontSize: theme.typography.fontSize.sm,
              }}
            />
          </div>
        </div>

        {!flowData && (
          <Button
            size="small"
            variant="primary"
            onClick={() => fetchCheddarFlow(selectedFamily.base)}
            style={{ marginTop: theme.spacing.sm, width: '100%' }}
            disabled={flowLoading}
          >
            {flowLoading ? 'Fetching...' : 'Fetch from CheddarFlow'}
          </Button>
        )}
      </div>

      {/* Trading Recommendation */}
      {analysis?.decision && (
        <div style={{
          padding: theme.spacing.md,
          backgroundColor: getDecisionBg(analysis.decision.direction),
          border: `2px solid ${getDecisionColor(analysis.decision.direction)}`,
          borderRadius: theme.borderRadius.md,
          marginBottom: theme.spacing.md,
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
              }}>
                Recommendation
              </div>
              <div style={{
                fontSize: theme.typography.fontSize.xl,
                fontWeight: 'bold',
                color: getDecisionColor(analysis.decision.direction),
              }}>
                {analysis.decision.direction === 'long' && '📈 BUY '}
                {analysis.decision.direction === 'short' && '📉 SHORT '}
                {analysis.decision.direction === 'neutral' && '⏸️ '}
                {analysis.decision.symbol}
              </div>
            </div>
            {analysis.decision.leverage !== 'none' && (
              <div style={{
                padding: '6px 16px',
                backgroundColor: getDecisionColor(analysis.decision.direction),
                color: 'white',
                borderRadius: theme.borderRadius.md,
                fontWeight: 'bold',
              }}>
                {analysis.decision.leverage}
              </div>
            )}
          </div>

          {/* Confidence */}
          <div style={{
            display: 'flex',
            gap: theme.spacing.md,
            marginBottom: theme.spacing.sm,
            fontSize: theme.typography.fontSize.sm,
          }}>
            <span>Combined Confidence: <strong>{analysis.decision.combinedConfidence}%</strong></span>
            <span>Score: <strong>{analysis.decision.combinedScore?.toFixed(2)}</strong></span>
          </div>

          {/* Reasons */}
          <ul style={{
            margin: 0,
            paddingLeft: theme.spacing.md,
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.textSecondary,
          }}>
            {analysis.decision.reasons?.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>

          {/* Signal Conflict Warning */}
          {analysis.decision.signalsConflict && (
            <div style={{
              marginTop: theme.spacing.sm,
              padding: theme.spacing.xs,
              backgroundColor: '#fef3c7',
              borderRadius: theme.borderRadius.sm,
              fontSize: theme.typography.fontSize.xs,
              color: '#92400e',
            }}>
              ⚠️ Technical and flow signals conflict - consider reduced position size
            </div>
          )}

          {/* Apply Button */}
          {analysis.decision.symbol !== 'CASH' && (
            <Button
              variant="primary"
              size="small"
              onClick={applyRecommendation}
              style={{
                marginTop: theme.spacing.sm,
                width: '100%',
                backgroundColor: getDecisionColor(analysis.decision.direction),
              }}
            >
              Trade {analysis.decision.symbol} in Simulator
            </Button>
          )}
        </div>
      )}

      {/* Position Sizing */}
      {analysis?.positionSizing && analysis.positionSizing.positionPercent > 0 && (
        <div style={{
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.background,
          borderRadius: theme.borderRadius.md,
          fontSize: theme.typography.fontSize.sm,
        }}>
          <div style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.textMuted,
            textTransform: 'uppercase',
            marginBottom: theme.spacing.xs,
          }}>
            Suggested Position Size
          </div>
          <div>{analysis.positionSizing.reason}</div>
        </div>
      )}

      {/* Quick Tips */}
      <div style={{
        marginTop: theme.spacing.md,
        padding: theme.spacing.sm,
        backgroundColor: '#f5f3ff',
        borderRadius: theme.borderRadius.md,
        fontSize: theme.typography.fontSize.xs,
        color: '#5b21b6',
      }}>
        <strong>Tips:</strong>
        <ul style={{ margin: '4px 0 0 0', paddingLeft: theme.spacing.md }}>
          <li><strong>First time:</strong> Close Chrome, fetch once to save session (works automatically after)</li>
          <li>P/C ratio &lt; 0.5 = bullish, &gt; 1.2 = bearish</li>
          <li>Leveraged ETFs decay in sideways markets - avoid holding overnight</li>
        </ul>
      </div>
    </Card>
  );
};

export default LeveragedEtfPanel;
