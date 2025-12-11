/**
 * CheddarFlowCard - Standalone card for CheddarFlow options sentiment data
 *
 * Displays options flow data from CheddarFlow including:
 * - Sentiment (Bullish/Bearish/Neutral)
 * - Put/Call Ratio
 * - Call/Put flow percentages and volumes
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Card from './Card';
import Button from './Button';
import theme from '../../theme';

const CheddarFlowCard = ({ symbol = 'QBTS', date, onSentimentChange }) => {
  // CheddarFlow state
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowError, setFlowError] = useState(null);
  const [flowData, setFlowData] = useState(null);
  const [autoFetchFlow, setAutoFetchFlow] = useState(true);
  const [lastFetchedKey, setLastFetchedKey] = useState(null);
  const [dataDate, setDataDate] = useState(null); // The actual date of the data
  const [isLiveData, setIsLiveData] = useState(false); // Is this today's data?

  // Store callback in ref to avoid re-triggering effect
  const onSentimentChangeRef = useRef(onSentimentChange);
  onSentimentChangeRef.current = onSentimentChange;

  // Helper to check if data has meaningful content
  const hasFlowActivity = (data) => {
    if (!data?.flowData) return false;
    const fd = data.flowData;
    // Check if there's any actual flow data (not just zeros)
    return fd.sentimentText ||
           (fd.callFlow && fd.callFlow > 0) ||
           (fd.putFlow && fd.putFlow > 0) ||
           (fd.callContracts && fd.callContracts > 0) ||
           (fd.putContracts && fd.putContracts > 0);
  };

  // Get previous business day
  const getPreviousBusinessDay = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00'); // Noon to avoid timezone issues
    d.setDate(d.getDate() - 1);
    // Skip weekends
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
    return d.toISOString().split('T')[0];
  };

  // Fetch CheddarFlow data with fallback to previous day
  const fetchCheddarFlow = useCallback(async (sym, targetDate = null, isRetry = false) => {
    if (!isRetry) {
      setFlowLoading(true);
      setFlowError(null);
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const requestDate = targetDate || date || today;
      const isToday = requestDate === today;

      const response = await fetch(
        `/api/cheddarflow/${sym}?date=${requestDate}&useProfile=true`
      );

      if (response.ok) {
        const data = await response.json();

        // Check if data indicates auth is needed
        if (data.flowData?.needsAuth || data.flowData?.error?.includes('expired')) {
          setFlowError('Session expired. Please check your CheddarFlow credentials in .env');
          setFlowLoading(false);
          return null;
        }

        // Check if we got actual data
        if (hasFlowActivity(data)) {
          setFlowData(data);
          setDataDate(requestDate);
          setIsLiveData(isToday);
          setLastFetchedKey(`${sym}-${requestDate}`);

          // Notify parent of sentiment change
          if (data.flowData && onSentimentChangeRef.current) {
            const sentimentText = data.flowData.sentimentText?.toLowerCase() || '';
            let sentiment = 'neutral';
            if (sentimentText.includes('bullish')) sentiment = 'bullish';
            else if (sentimentText.includes('bearish')) sentiment = 'bearish';

            onSentimentChangeRef.current({
              sentiment,
              putCallRatio: data.flowData.putCallRatio,
              callFlowPercent: data.flowData.callFlowPercent,
              data: data.flowData,
              date: requestDate,
              isLive: isToday,
            });
          }

          setFlowLoading(false);
          return data;
        } else if (isToday && !isRetry) {
          // No data for today, try previous business day
          console.log('[CheddarFlow] No data for today, trying previous day...');
          const prevDay = getPreviousBusinessDay(requestDate);
          return fetchCheddarFlow(sym, prevDay, true);
        } else {
          // Either it's a specific date request or retry failed - show what we have
          setFlowData(data);
          setDataDate(requestDate);
          setIsLiveData(false);
          setLastFetchedKey(`${sym}-${requestDate}`);
          setFlowLoading(false);
          return data;
        }
      } else {
        const err = await response.json();
        if (err.error?.includes('Chrome') || err.error?.includes('auth') || err.error?.includes('expired')) {
          setFlowError('Session expired. Please check your CheddarFlow credentials in .env');
        } else {
          setFlowError(err.error || 'Failed to fetch flow data');
        }
        setFlowLoading(false);
        return null;
      }
    } catch (err) {
      setFlowError('Could not connect to CheddarFlow');
      setFlowLoading(false);
      return null;
    }
  }, [date]);

  // Auto-fetch when symbol or date changes
  useEffect(() => {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const fetchKey = `${symbol}-${targetDate}`;
    if (autoFetchFlow && symbol && fetchKey !== lastFetchedKey) {
      // If a specific date is provided (sync with chart), use that date directly
      // Otherwise, let fetchCheddarFlow handle today with fallback
      fetchCheddarFlow(symbol, date || null);
    }
  }, [symbol, date, autoFetchFlow, fetchCheddarFlow, lastFetchedKey]);

  const getSentimentColor = (sentimentText) => {
    const s = sentimentText?.toLowerCase() || '';
    if (s.includes('bullish')) return { bg: '#dcfce7', text: '#166534' };
    if (s.includes('bearish')) return { bg: '#fee2e2', text: '#991b1b' };
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
          <span style={{ fontSize: '18px' }}>📊</span>
          <span style={{ fontWeight: 'bold', fontSize: theme.typography.fontSize.sm }}>
            CheddarFlow
          </span>
          {flowData && (
            <span style={{
              fontSize: '10px',
              color: '#22c55e',
              fontWeight: 'normal',
            }}>
              ✓
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '10px',
            color: theme.colors.textMuted,
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={autoFetchFlow}
              onChange={(e) => setAutoFetchFlow(e.target.checked)}
              style={{ width: '12px', height: '12px' }}
            />
            Auto
          </label>
          <Button
            size="small"
            variant="outline"
            onClick={() => fetchCheddarFlow(symbol)}
            disabled={flowLoading}
            style={{ padding: '2px 8px', fontSize: '11px' }}
          >
            {flowLoading ? '...' : '↻'}
          </Button>
        </div>
      </div>

      {/* Symbol and date being tracked */}
      <div style={{
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.textMuted,
        marginBottom: theme.spacing.sm,
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        flexWrap: 'wrap',
      }}>
        <span>Tracking: <strong>{symbol}</strong></span>
        {dataDate && (
          <span style={{
            padding: '2px 6px',
            borderRadius: theme.borderRadius.sm,
            backgroundColor: isLiveData ? '#dcfce7' : theme.colors.gray100,
            color: isLiveData ? '#166534' : theme.colors.textMuted,
            fontSize: '10px',
            fontWeight: isLiveData ? 'bold' : 'normal',
          }}>
            {isLiveData ? '🔴 LIVE' : `📅 ${dataDate}`}
          </span>
        )}
        {date && date !== dataDate && (
          <span style={{ fontSize: '10px', color: theme.colors.textMuted }}>
            (synced to {date})
          </span>
        )}
      </div>

      {/* Error */}
      {flowError && (
        <div style={{
          padding: theme.spacing.xs,
          backgroundColor: '#fef3c7',
          color: '#92400e',
          borderRadius: theme.borderRadius.sm,
          marginBottom: theme.spacing.sm,
          fontSize: '11px',
        }}>
          {flowError}
        </div>
      )}

      {/* Loading */}
      {flowLoading && (
        <div style={{
          padding: theme.spacing.md,
          textAlign: 'center',
          color: theme.colors.textMuted,
          fontSize: theme.typography.fontSize.sm,
        }}>
          Fetching...
        </div>
      )}

      {/* Flow Data Display */}
      {flowData?.flowData && !flowLoading && (
        <div>
          {/* Main Sentiment Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.sm,
          }}>
            <span style={{
              padding: '6px 14px',
              borderRadius: theme.borderRadius.md,
              backgroundColor: getSentimentColor(flowData.flowData.sentimentText).bg,
              color: getSentimentColor(flowData.flowData.sentimentText).text,
              fontWeight: 'bold',
              fontSize: theme.typography.fontSize.md,
            }}>
              {flowData.flowData.sentimentText?.toLowerCase().includes('bullish') && '📈 '}
              {flowData.flowData.sentimentText?.toLowerCase().includes('bearish') && '📉 '}
              {flowData.flowData.sentimentText || 'Unknown'}
            </span>
          </div>

          {/* P/C Ratio */}
          <div style={{
            fontSize: theme.typography.fontSize.sm,
            marginBottom: theme.spacing.sm,
            color: theme.colors.textSecondary,
          }}>
            P/C Ratio: <strong style={{ fontSize: theme.typography.fontSize.md }}>
              {flowData.flowData.putCallRatio?.toFixed(3) || 'N/A'}
            </strong>
            <span style={{ marginLeft: theme.spacing.sm, fontSize: '10px', color: theme.colors.textMuted }}>
              (&lt;0.5 bullish, &gt;1.2 bearish)
            </span>
          </div>

          {/* Call/Put Breakdown */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: theme.spacing.xs,
            fontSize: '11px',
          }}>
            {/* Calls */}
            <div style={{
              padding: theme.spacing.xs,
              backgroundColor: '#dcfce7',
              borderRadius: theme.borderRadius.sm,
            }}>
              <div style={{ color: '#166534', fontWeight: 'bold', marginBottom: '2px' }}>
                📈 CALLS
              </div>
              <div>Flow: <strong>{flowData.flowData.callFlowPercent?.toFixed(1) || 0}%</strong></div>
              {flowData.flowData.totalCallFlow && (
                <div>Vol: <strong>${(flowData.flowData.totalCallFlow / 1000000).toFixed(2)}M</strong></div>
              )}
              {flowData.flowData.callContracts && (
                <div>Contracts: <strong>{flowData.flowData.callContracts.toLocaleString()}</strong></div>
              )}
            </div>

            {/* Puts */}
            <div style={{
              padding: theme.spacing.xs,
              backgroundColor: '#fee2e2',
              borderRadius: theme.borderRadius.sm,
            }}>
              <div style={{ color: '#991b1b', fontWeight: 'bold', marginBottom: '2px' }}>
                📉 PUTS
              </div>
              <div>Flow: <strong>{flowData.flowData.putFlowPercent?.toFixed(1) || 0}%</strong></div>
              {flowData.flowData.totalPutFlow && (
                <div>Vol: <strong>${(flowData.flowData.totalPutFlow / 1000000).toFixed(2)}M</strong></div>
              )}
              {flowData.flowData.putContracts && (
                <div>Contracts: <strong>{flowData.flowData.putContracts.toLocaleString()}</strong></div>
              )}
            </div>
          </div>

          {/* Analysis summary */}
          {flowData.sentiment && (
            <div style={{
              marginTop: theme.spacing.sm,
              padding: theme.spacing.xs,
              backgroundColor: theme.colors.gray100,
              borderRadius: theme.borderRadius.sm,
              fontSize: '10px',
              color: theme.colors.textSecondary,
            }}>
              <strong>Analysis:</strong> {flowData.sentiment.sentiment} ({flowData.sentiment.confidence}% conf)
              {flowData.sentiment.reasons?.length > 0 && (
                <div style={{ marginTop: '2px', color: theme.colors.textMuted }}>
                  {flowData.sentiment.reasons.slice(0, 2).join(' • ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* No data state */}
      {!flowData && !flowLoading && !flowError && (
        <div style={{
          padding: theme.spacing.md,
          textAlign: 'center',
          color: theme.colors.textMuted,
          fontSize: theme.typography.fontSize.sm,
        }}>
          <div style={{ marginBottom: theme.spacing.sm }}>No flow data loaded</div>
          <Button
            size="small"
            variant="primary"
            onClick={() => fetchCheddarFlow(symbol)}
          >
            Fetch CheddarFlow
          </Button>
        </div>
      )}
    </Card>
  );
};

export default CheddarFlowCard;
