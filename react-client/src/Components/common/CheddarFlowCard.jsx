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

  // Fetch CheddarFlow data with stale-while-revalidate pattern
  const fetchCheddarFlow = useCallback(async (sym, targetDate = null, options = {}) => {
    const { isRetry = false, useStale = true, forceRefresh = false } = options;

    if (!isRetry && !useStale) {
      setFlowLoading(true);
    }
    if (!isRetry) {
      setFlowError(null);
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const requestDate = targetDate || date || today;
      const isToday = requestDate === today;
      const allowFallback = !date;

      // Build query params
      const params = new URLSearchParams({
        date: requestDate,
        ...(useStale && { stale: 'true' }),
        ...(forceRefresh && { refresh: 'true' }),
      });

      const response = await fetch(`/api/cheddarflow/${sym}?${params}`);

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
          setIsLiveData(isToday && !isRetry);
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
              isLive: isToday && !isRetry,
            });
          }

          setFlowLoading(false);

          // If we got stale data, trigger a background refresh
          if (data.isStale && !forceRefresh) {
            console.log('[CheddarFlow] Got stale data, refreshing in background...');
            // Fire off background refresh (don't await)
            fetchCheddarFlow(sym, requestDate, { useStale: false, forceRefresh: true }).catch(() => {});
          }

          return data;
        } else if (isToday && allowFallback && !isRetry) {
          console.log('[CheddarFlow] No data for today, falling back to previous day...');
          const prevDay = getPreviousBusinessDay(requestDate);
          return fetchCheddarFlow(sym, prevDay, { isRetry: true, useStale });
        } else {
          // No meaningful data - only update state if we don't already have good data
          // This prevents clearing good cached data with empty responses
          if (!flowData || !hasFlowActivity(flowData)) {
            setFlowData(data);
            setDataDate(requestDate);
            setIsLiveData(false);
          }
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
              color: flowData.isStale ? '#f59e0b' : '#22c55e',
              fontWeight: 'normal',
            }}>
              {flowData.isStale ? '⟳' : '✓'}
            </span>
          )}
          {flowData?.fromCache && (
            <span style={{
              fontSize: '9px',
              color: theme.colors.textMuted,
              backgroundColor: theme.colors.gray100,
              padding: '1px 4px',
              borderRadius: '3px',
            }}>
              cached
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
            onClick={() => fetchCheddarFlow(symbol, null, { useStale: false, forceRefresh: true })}
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
        {/* Only show "synced to" when a date prop is explicitly provided and differs from data */}
        {date && dataDate && date !== dataDate && (
          <span style={{ fontSize: '10px', color: '#f59e0b' }}>
            (requested {date})
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

      {/* Flow Data Display - Light Theme */}
      {flowData?.flowData && !flowLoading && (
        <div>
          {/* Flow Sentiment Bar - Full Width on Top */}
          <div style={{
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.gray50,
            borderRadius: theme.borderRadius.md,
            marginBottom: theme.spacing.sm,
            border: `1px solid ${theme.colors.gray200}`,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '6px',
            }}>
              <span style={{ fontSize: '11px', color: theme.colors.textMuted }}>
                Flow sentiment
              </span>
              <span style={{
                fontSize: theme.typography.fontSize.md,
                fontWeight: 'bold',
                color: flowData.flowData.sentimentText?.toLowerCase().includes('bullish') ? '#16a34a' :
                       flowData.flowData.sentimentText?.toLowerCase().includes('bearish') ? '#dc2626' : '#ca8a04',
              }}>
                {flowData.flowData.sentimentText || 'N/A'}
              </span>
            </div>
            {/* Progress Bar - Full Width */}
            <div style={{
              width: '100%',
              height: '12px',
              backgroundColor: '#e5e7eb',
              borderRadius: '6px',
              overflow: 'hidden',
            }}>
              <div style={{
                // Clamp between 0 and 100, default to 50 if invalid
                width: `${Math.min(100, Math.max(0, flowData.flowData.callFlowPercent ?? 50))}%`,
                height: '100%',
                backgroundColor: flowData.flowData.sentimentText?.toLowerCase().includes('bullish') ? '#22c55e' :
                                 flowData.flowData.sentimentText?.toLowerCase().includes('bearish') ? '#ef4444' : '#eab308',
                borderRadius: '6px',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* Three Indicators Row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: theme.spacing.xs,
          }}>
            {/* Put/Call Ratio */}
            <div style={{
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.md,
              border: `1px solid ${theme.colors.gray200}`,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '10px', color: theme.colors.textMuted, marginBottom: '4px' }}>
                P/C Ratio
              </div>
              <div style={{
                fontSize: theme.typography.fontSize.lg,
                fontWeight: 'bold',
                color: flowData.flowData.putCallRatio < 0.7 ? '#16a34a' :
                       flowData.flowData.putCallRatio > 1.0 ? '#dc2626' : theme.colors.text,
              }}>
                {flowData.flowData.putCallRatio?.toFixed(2) || 'N/A'}
              </div>
            </div>

            {/* Call Flow */}
            <div style={{
              padding: theme.spacing.sm,
              backgroundColor: '#f0fdf4',
              borderRadius: theme.borderRadius.md,
              border: '1px solid #bbf7d0',
              textAlign: 'center',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '2px',
              }}>
                <span style={{ fontSize: '10px', color: '#166534' }}>Calls</span>
                <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 'bold' }}>
                  ${flowData.flowData.callFlow ? (flowData.flowData.callFlow >= 1000000 ?
                    (flowData.flowData.callFlow / 1000000).toFixed(1) + 'M' :
                    (flowData.flowData.callFlow / 1000).toFixed(1) + 'K') : '0'}
                </span>
              </div>
              <div style={{
                fontSize: theme.typography.fontSize.md,
                fontWeight: 'bold',
                color: '#166534',
              }}>
                {flowData.flowData.callContracts?.toLocaleString() || '0'}
              </div>
              <div style={{ fontSize: '10px', color: '#16a34a', fontWeight: '600' }}>
                {flowData.flowData.callFlowPercent?.toFixed(1) || '0'}%
              </div>
            </div>

            {/* Put Flow */}
            <div style={{
              padding: theme.spacing.sm,
              backgroundColor: '#fef2f2',
              borderRadius: theme.borderRadius.md,
              border: '1px solid #fecaca',
              textAlign: 'center',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '2px',
              }}>
                <span style={{ fontSize: '10px', color: '#991b1b' }}>Puts</span>
                <span style={{ fontSize: '10px', color: '#dc2626', fontWeight: 'bold' }}>
                  ${flowData.flowData.putFlow ? (flowData.flowData.putFlow >= 1000000 ?
                    (flowData.flowData.putFlow / 1000000).toFixed(1) + 'M' :
                    (flowData.flowData.putFlow / 1000).toFixed(1) + 'K') : '0'}
                </span>
              </div>
              <div style={{
                fontSize: theme.typography.fontSize.md,
                fontWeight: 'bold',
                color: '#991b1b',
              }}>
                {flowData.flowData.putContracts?.toLocaleString() || '0'}
              </div>
              <div style={{ fontSize: '10px', color: '#dc2626', fontWeight: '600' }}>
                {flowData.flowData.putFlowPercent?.toFixed(1) || '0'}%
              </div>
            </div>
          </div>
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
