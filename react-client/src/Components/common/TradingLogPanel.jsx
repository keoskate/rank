/**
 * TradingLogPanel - Real-time trading diagnostics display
 *
 * Shows structured logs for debugging and monitoring live trading.
 * Optimized for quick diagnosis and easy copy/paste for AI assistance.
 *
 * Log Levels:
 * - EXEC: Trade executions (green)
 * - SIGNAL: Entry/exit signals (blue)
 * - INDICATOR: Key indicator changes (purple)
 * - CONFIG: Configuration changes (gray)
 * - RISK: Risk management events (amber)
 * - ERROR: Errors and failures (red)
 * - INFO: General information (slate)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import Card from './Card';
import theme from '../../theme';

// Log level colors and icons
const LOG_STYLES = {
  EXEC: { color: '#22c55e', bg: '#dcfce7', icon: '💰' },
  OUTCOME: { color: '#f97316', bg: '#ffedd5', icon: '🎯' }, // ML learning - trade outcomes
  SIGNAL: { color: '#3b82f6', bg: '#dbeafe', icon: '📊' },
  INDICATOR: { color: '#8b5cf6', bg: '#ede9fe', icon: '📈' },
  CONFIG: { color: '#6b7280', bg: '#f3f4f6', icon: '⚙️' },
  RISK: { color: '#f59e0b', bg: '#fef3c7', icon: '🛡️' },
  ERROR: { color: '#ef4444', bg: '#fee2e2', icon: '❌' },
  INFO: { color: '#64748b', bg: '#f1f5f9', icon: 'ℹ️' },
};

// Format timestamp for display
const formatTime = timestamp => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

// Format log entry for clipboard
const formatLogForClipboard = log => {
  const style = LOG_STYLES[log.level] || LOG_STYLES.INFO;
  let line = `[${formatTime(log.timestamp)}] ${style.icon} [${log.level}]`;

  if (log.sessionName) {
    line += ` (${log.sessionName})`;
  }

  if (log.symbol) {
    line += ` ${log.symbol}`;
  }

  line += ` ${log.message}`;

  return line;
};

const TradingLogPanel = ({
  sessionId = null,
  symbol = null,
  maxLogs = 100,
  autoRefresh = true,
  refreshInterval = 5000,
  defaultCollapsed = false,
}) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [filter, setFilter] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef(null);
  const refreshTimerRef = useRef(null);

  // Fetch logs from server (only on initial load, not periodically)
  // Real-time updates come via WebSocket, so we don't want to overwrite them
  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append('limit', maxLogs);
      if (sessionId) params.append('sessionId', sessionId);
      if (symbol) params.append('symbol', symbol);
      if (filter !== 'ALL') params.append('level', filter);

      const response = await fetch(`/api/trading/logs?${params}`);
      const data = await response.json();

      if (data.success && data.logs && data.logs.length > 0) {
        // Only set logs if we got some from the server (historical logs)
        // This preserves WebSocket logs if the API returns empty
        setLogs(prev => {
          // Merge server logs with existing, avoiding duplicates by id
          const existingIds = new Set(prev.map(l => l.id));
          const newLogs = data.logs.filter(l => !existingIds.has(l.id));
          return [...newLogs, ...prev].slice(-maxLogs);
        });
        setError(null);
      }
    } catch (err) {
      // Don't show error for logs - they're optional
      console.warn('Failed to fetch trading logs:', err.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, symbol, maxLogs, filter]);

  // Initial fetch only (no periodic refresh - WebSocket handles real-time updates)
  useEffect(() => {
    setLoading(true);
    fetchLogs();
    // No interval refresh - WebSocket provides real-time updates
  }, [fetchLogs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current && !isCollapsed) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, isCollapsed]);

  // WebSocket real-time log updates
  useEffect(() => {
    const socket = io(window.location.origin);

    // Authenticate with a default user ID (for trading logs)
    socket.emit('authenticate', { userId: 'trading-log-panel' });

    // Listen for real-time trading log entries
    socket.on('trading_log', logEntry => {
      // Filter by session if specified
      if (sessionId && logEntry.sessionId && logEntry.sessionId !== sessionId) {
        return;
      }
      // Filter by symbol if specified
      if (symbol && logEntry.symbol && logEntry.symbol !== symbol) {
        return;
      }
      // Filter by level if not ALL
      if (filter !== 'ALL' && logEntry.level !== filter) {
        return;
      }

      // Add to logs, keeping maxLogs limit
      setLogs(prev => {
        const updated = [...prev, logEntry].slice(-maxLogs);
        return updated;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionId, symbol, filter, maxLogs]);

  // Copy logs to clipboard
  const copyLogs = () => {
    const header = [
      '=== Trading Log Export ===',
      `Generated: ${new Date().toISOString()}`,
      `Entries: ${logs.length}`,
      `Filter: ${filter}`,
      '========================',
      '',
    ];

    const logLines = logs.map(formatLogForClipboard);
    const text = header.concat(logLines).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Clear logs
  const clearLogs = async () => {
    try {
      await fetch('/api/trading/logs/clear', { method: 'POST' });
      setLogs([]);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  // Filter logs by level
  const filteredLogs =
    filter === 'ALL' ? logs : logs.filter(log => log.level === filter);

  // Render individual log entry
  const renderLogEntry = log => {
    const style = LOG_STYLES[log.level] || LOG_STYLES.INFO;

    return (
      <div
        key={log.id}
        style={{
          padding: '6px 10px',
          marginBottom: '2px',
          backgroundColor: style.bg,
          borderLeft: `3px solid ${style.color}`,
          borderRadius: '2px',
          fontSize: theme.typography.fontSize.xs,
          fontFamily: 'monospace',
          lineHeight: 1.4,
        }}
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          {/* Timestamp */}
          <span style={{ color: theme.colors.textMuted, flexShrink: 0 }}>
            {formatTime(log.timestamp)}
          </span>

          {/* Icon & Level */}
          <span style={{ flexShrink: 0 }}>{style.icon}</span>

          {/* Symbol badge */}
          {log.symbol && (
            <span
              style={{
                backgroundColor: style.color,
                color: '#fff',
                padding: '1px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 'bold',
                flexShrink: 0,
              }}
            >
              {log.symbol}
            </span>
          )}

          {/* Message */}
          <span style={{ color: theme.colors.text, flex: 1 }}>
            {log.message}
          </span>
        </div>

        {/* Session name (if different from filter) */}
        {log.sessionName && !sessionId && (
          <div
            style={{
              marginTop: '2px',
              marginLeft: '80px',
              fontSize: '10px',
              color: theme.colors.textMuted,
            }}
          >
            Session: {log.sessionName}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isCollapsed ? 0 : theme.spacing.sm,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.lg,
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <span style={{ fontSize: '20px' }}>📋</span>
            Trading Log
          </h3>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.textMuted,
              backgroundColor: theme.colors.gray100,
              padding: '2px 8px',
              borderRadius: theme.borderRadius.sm,
            }}
          >
            {filteredLogs.length} entries
          </span>
          {autoRefresh && (
            <span
              style={{
                fontSize: '10px',
                color: '#22c55e',
              }}
              title="Auto-refreshing"
            >
              ● LIVE
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          {/* Filter dropdown */}
          {!isCollapsed && (
            <select
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                padding: '4px 8px',
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.border}`,
                fontSize: theme.typography.fontSize.xs,
                backgroundColor: theme.colors.background,
              }}
            >
              <option value="ALL">All Levels</option>
              <option value="EXEC">Executions</option>
              <option value="OUTCOME">ML Outcomes</option>
              <option value="SIGNAL">Signals</option>
              <option value="INDICATOR">Indicators</option>
              <option value="RISK">Risk</option>
              <option value="ERROR">Errors</option>
              <option value="CONFIG">Config</option>
              <option value="INFO">Info</option>
            </select>
          )}

          {/* Copy button */}
          {!isCollapsed && (
            <button
              onClick={copyLogs}
              style={{
                padding: '4px 10px',
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.border}`,
                backgroundColor: copied ? '#22c55e' : 'transparent',
                color: copied ? '#fff' : theme.colors.text,
                fontSize: theme.typography.fontSize.xs,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              title="Copy logs for sharing/debugging"
            >
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
          )}

          {/* Clear button */}
          {!isCollapsed && (
            <button
              onClick={clearLogs}
              style={{
                padding: '4px 10px',
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.border}`,
                backgroundColor: 'transparent',
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSize.xs,
                cursor: 'pointer',
              }}
              title="Clear log buffer"
            >
              Clear
            </button>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{
              padding: '4px 8px',
              borderRadius: theme.borderRadius.sm,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.xs,
            }}
          >
            {isCollapsed ? '▼ Expand' : '▲ Collapse'}
          </button>
        </div>
      </div>

      {/* Collapsed summary */}
      {isCollapsed && filteredLogs.length > 0 && (
        <div
          style={{
            marginTop: theme.spacing.sm,
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.gray50,
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.xs,
            fontFamily: 'monospace',
          }}
        >
          {/* Show last log entry */}
          <span style={{ color: theme.colors.textMuted }}>Latest: </span>
          {formatLogForClipboard(filteredLogs[filteredLogs.length - 1])}
        </div>
      )}

      {/* Log content */}
      {!isCollapsed && (
        <>
          {/* Auto-scroll toggle */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: theme.spacing.xs,
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textMuted,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
          </div>

          {/* Log container */}
          <div
            ref={logContainerRef}
            style={{
              maxHeight: '300px',
              overflowY: 'auto',
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.sm,
              padding: theme.spacing.xs,
            }}
          >
            {loading && logs.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: theme.spacing.md,
                  color: theme.colors.textMuted,
                }}
              >
                Loading logs...
              </div>
            ) : error ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: theme.spacing.md,
                  color: theme.colors.error,
                }}
              >
                Error: {error}
              </div>
            ) : filteredLogs.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: theme.spacing.md,
                  color: theme.colors.textMuted,
                }}
              >
                No logs yet. Start a trading session to see activity.
              </div>
            ) : (
              filteredLogs.map(renderLogEntry)
            )}
          </div>

          {/* Level legend */}
          <div
            style={{
              display: 'flex',
              gap: theme.spacing.md,
              marginTop: theme.spacing.sm,
              fontSize: '10px',
              color: theme.colors.textMuted,
              flexWrap: 'wrap',
            }}
          >
            {Object.entries(LOG_STYLES).map(([level, style]) => (
              <span
                key={level}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '2px',
                    backgroundColor: style.color,
                  }}
                />
                {level}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
};

export default TradingLogPanel;
