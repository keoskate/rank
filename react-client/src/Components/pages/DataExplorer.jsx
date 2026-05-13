import { useState, useEffect, useCallback, useMemo } from 'react';
import theme from '../../theme';

const POLL_INTERVAL = 15000;

// Master endpoint catalog. Add a row to surface new data.
// Each row: { group, label, url }
//
// To make this dynamic per running session/watchlist, swap in values from
// state. For v1, EXP-B's sessionId and SOXL/SOXS are hardcoded since
// that's what's actively running.
const EXP_B_SESSION_ID = 'db5db409-c6b2-4299-a3b5-b3b8014ab93d';

const ENDPOINTS = [
  // Broker (Alpaca)
  { group: 'Broker', label: 'Account', url: '/api/alpaca/account?mode=paper' },
  {
    group: 'Broker',
    label: 'Positions',
    url: '/api/alpaca/positions?mode=paper',
  },
  {
    group: 'Broker',
    label: 'Orders (recent 30)',
    url: '/api/alpaca/orders?mode=paper&status=all&limit=30',
  },
  {
    group: 'Broker',
    label: 'Portfolio History (1D / 15min)',
    url: '/api/alpaca/portfolio-history?mode=paper&period=1D&timeframe=15Min',
  },
  {
    group: 'Broker',
    label: 'Portfolio History (1W / 1H)',
    url: '/api/alpaca/portfolio-history?mode=paper&period=1W&timeframe=1H',
  },
  {
    group: 'Broker',
    label: 'PDT Status',
    url: '/api/alpaca/pdt-status?mode=paper',
  },
  { group: 'Broker', label: 'Stream Status', url: '/api/alpaca/stream/status' },
  { group: 'Broker', label: 'Trading Mode', url: '/api/trading/mode' },

  // Engine sessions
  {
    group: 'Sessions',
    label: 'All Sessions (default_user)',
    url: '/api/ai/sessions/default_user',
  },
  { group: 'Sessions', label: 'Engine Health', url: '/api/ai/health' },
  {
    group: 'Sessions',
    label: 'EXP-B Detail',
    url: `/api/ai/session/detail/${EXP_B_SESSION_ID}`,
  },
  {
    group: 'Sessions',
    label: 'EXP-B Decisions',
    url: `/api/ai/decisions/${EXP_B_SESSION_ID}`,
  },

  // Sentiment / market context
  {
    group: 'Market Context',
    label: 'Semiconductor Sentiment',
    url: '/api/semiconductor/sentiment',
  },
  {
    group: 'Market Context',
    label: 'Market Phase',
    url: '/api/semiconductor/phase',
  },
  {
    group: 'Market Context',
    label: 'Auto-trader Status',
    url: '/api/semiconductor/auto-trader/status',
  },

  // Per-symbol — SOXL
  { group: 'SOXL', label: 'Quote', url: '/api/alpaca/quotes/SOXL?mode=paper' },
  {
    group: 'SOXL',
    label: 'Real-time Price (cached)',
    url: '/api/realtime/price/SOXL',
  },
  { group: 'SOXL', label: 'Indicators (full)', url: '/api/indicators/SOXL' },
  {
    group: 'SOXL',
    label: 'Signals (summary)',
    url: '/api/indicators/SOXL/signals',
  },
  { group: 'SOXL', label: 'Regime', url: '/api/regime/SOXL' },
  { group: 'SOXL', label: 'Regime Timeline', url: '/api/regime/SOXL/timeline' },
  {
    group: 'SOXL',
    label: 'Leveraged ETF Analysis',
    url: '/api/leveraged-etf/analyze/SOXL',
  },
  {
    group: 'SOXL',
    label: 'Leveraged Family',
    url: '/api/leveraged-etf/family/SOXL',
  },
  { group: 'SOXL', label: 'Costs / Fees', url: '/api/costs/SOXL' },
  { group: 'SOXL', label: 'Decay Estimate', url: '/api/leveraged/SOXL/decay' },

  // Per-symbol — SOXS
  { group: 'SOXS', label: 'Quote', url: '/api/alpaca/quotes/SOXS?mode=paper' },
  { group: 'SOXS', label: 'Real-time Price', url: '/api/realtime/price/SOXS' },
  { group: 'SOXS', label: 'Indicators (full)', url: '/api/indicators/SOXS' },
  {
    group: 'SOXS',
    label: 'Signals (summary)',
    url: '/api/indicators/SOXS/signals',
  },
  { group: 'SOXS', label: 'Regime', url: '/api/regime/SOXS' },

  // Watchlist-level regime
  {
    group: 'Cross-symbol',
    label: 'Regime Watchlist',
    url: '/api/regime/watchlist',
  },
  {
    group: 'Cross-symbol',
    label: 'Leveraged ETF Families',
    url: '/api/leveraged-etf/families',
  },
  { group: 'Cross-symbol', label: 'All Costs', url: '/api/costs' },
  { group: 'Cross-symbol', label: 'All Strategies', url: '/api/strategies' },

  // Activity / logs
  {
    group: 'Activity',
    label: 'Trading Logs (recent 30)',
    url: '/api/trading/logs?limit=30',
  },
  {
    group: 'Activity',
    label: 'Executions only (20)',
    url: '/api/trading/logs?level=EXEC&limit=20',
  },
  {
    group: 'Activity',
    label: 'Risk events (10)',
    url: '/api/trading/logs?level=RISK&limit=10',
  },
  {
    group: 'Activity',
    label: 'Errors (10)',
    url: '/api/trading/logs?level=ERROR&limit=10',
  },
  {
    group: 'Activity',
    label: 'Signals (20)',
    url: '/api/trading/logs?level=SIGNAL&limit=20',
  },

  // Self-improvement
  {
    group: 'Self-Improvement',
    label: 'Status',
    url: '/api/ai/improvements/status',
  },
  {
    group: 'Self-Improvement',
    label: 'Latest Cycle',
    url: '/api/ai/improvements/latest',
  },
  {
    group: 'Self-Improvement',
    label: 'All Improvements',
    url: '/api/ai/improvements',
  },

  // Tournament / scoreboards
  {
    group: 'Tournament',
    label: 'Scoreboard',
    url: '/api/ai/tournament/scoreboard',
  },
  { group: 'Tournament', label: 'Status', url: '/api/ai/tournament/status' },

  // Strategy library / presets
  { group: 'Strategy Library', label: 'Presets', url: '/api/ai/presets' },
  {
    group: 'Strategy Library',
    label: 'Strategy Versions',
    url: '/api/strategy-versions',
  },

  // Monitors
  { group: 'Monitors', label: 'All Monitors', url: '/api/monitors' },
  { group: 'Monitors', label: 'Active Alerts', url: '/api/monitors/alerts' },
];

function timeAgo(date) {
  if (!date) return 'never';
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function statusColor(r, themeRef) {
  if (!r) return themeRef.colors.gray400;
  if (r.error) return themeRef.colors.error;
  if (r.ok) return themeRef.colors.success;
  return themeRef.colors.warning;
}

const DataExplorer = () => {
  // url → { json, status, ok, latencyMs, fetchedAt, error, parseError }
  const [data, setData] = useState({});
  const [filter, setFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFullRefresh, setLastFullRefresh] = useState(null);
  const [tick, setTick] = useState(0); // forces "X seconds ago" to update

  const fetchOne = useCallback(async url => {
    const start = performance.now();
    try {
      const res = await fetch(url);
      const latencyMs = Math.round(performance.now() - start);
      let json = null;
      let parseError = null;
      const text = await res.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch (e) {
          parseError = e.message;
          json = text.slice(0, 500); // surface first 500 chars of non-JSON
        }
      }
      return {
        url,
        status: res.status,
        ok: res.ok,
        latencyMs,
        json,
        parseError,
        fetchedAt: new Date(),
        error: null,
      };
    } catch (err) {
      return {
        url,
        status: 0,
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        json: null,
        fetchedAt: new Date(),
        error: err.message,
      };
    }
  }, []);

  const fetchAll = useCallback(async () => {
    // Fire all fetches in parallel; update each result as it lands so the
    // page populates incrementally rather than waiting for the slowest one.
    const promises = ENDPOINTS.map(e =>
      fetchOne(e.url).then(r => {
        setData(prev => ({ ...prev, [r.url]: r }));
        return r;
      })
    );
    await Promise.all(promises);
    setLastFullRefresh(new Date());
  }, [fetchOne]);

  useEffect(() => {
    fetchAll();
    if (!autoRefresh) return undefined;
    const id = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchAll, autoRefresh]);

  // Re-render every 1s so the "X seconds ago" stamps stay live
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ENDPOINTS;
    return ENDPOINTS.filter(
      e =>
        e.label.toLowerCase().includes(q) ||
        e.group.toLowerCase().includes(q) ||
        e.url.toLowerCase().includes(q)
    );
  }, [filter]);

  const grouped = useMemo(() => {
    const out = new Map();
    for (const e of filtered) {
      if (!out.has(e.group)) out.set(e.group, []);
      out.get(e.group).push(e);
    }
    return out;
  }, [filtered]);

  // Aggregate counts for the header
  const stats = useMemo(() => {
    const total = ENDPOINTS.length;
    const fetched = ENDPOINTS.filter(e => data[e.url]).length;
    const ok = ENDPOINTS.filter(e => data[e.url]?.ok).length;
    const failed = ENDPOINTS.filter(e => data[e.url] && !data[e.url].ok).length;
    return { total, fetched, ok, failed };
  }, [data, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        padding: theme.spacing.md,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: theme.typography.fontSize.sm,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: theme.typography.fontSize.lg,
            fontFamily: 'inherit',
          }}
        >
          Data Explorer
        </h2>
        <input
          type="text"
          placeholder="Filter by group, label, or URL..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            flex: '1 1 240px',
            maxWidth: 480,
            padding: '6px 10px',
            border: `1px solid ${theme.colors.gray300}`,
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.sm,
            fontFamily: 'inherit',
          }}
        />
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh (15s)
        </label>
        <button
          type="button"
          onClick={fetchAll}
          style={{
            padding: '6px 12px',
            border: `1px solid ${theme.colors.gray300}`,
            borderRadius: theme.borderRadius.sm,
            cursor: 'pointer',
            fontSize: theme.typography.fontSize.sm,
            backgroundColor: theme.colors.surface,
          }}
        >
          Refresh now
        </button>
      </div>

      <div
        style={{
          marginBottom: theme.spacing.md,
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.gray100,
          borderRadius: theme.borderRadius.sm,
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.gray700,
          display: 'flex',
          gap: theme.spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <span>
          <strong>{stats.fetched}</strong>/{stats.total} endpoints fetched
        </span>
        <span style={{ color: theme.colors.success }}>{stats.ok} ok</span>
        <span style={{ color: theme.colors.error }}>{stats.failed} failed</span>
        <span>{filtered.length} shown after filter</span>
        <span style={{ marginLeft: 'auto' }}>
          last full refresh:{' '}
          {lastFullRefresh ? timeAgo(lastFullRefresh) : 'never'}
        </span>
      </div>

      {[...grouped.entries()].map(([group, items]) => (
        <details key={group} open style={{ marginBottom: theme.spacing.sm }}>
          <summary
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              backgroundColor: theme.colors.gray100,
              borderRadius: theme.borderRadius.sm,
              cursor: 'pointer',
              fontWeight: theme.typography.fontWeight.semibold,
              fontFamily: 'inherit',
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            {group}{' '}
            <span
              style={{
                color: theme.colors.gray500,
                fontWeight: theme.typography.fontWeight.normal,
              }}
            >
              ({items.length})
            </span>
          </summary>
          <div
            style={{
              paddingLeft: theme.spacing.sm,
              marginTop: theme.spacing.xs,
            }}
          >
            {items.map(e => {
              const r = data[e.url];
              const color = statusColor(r, theme);
              return (
                <details
                  key={e.url}
                  style={{
                    marginBottom: theme.spacing.xs,
                    border: `1px solid ${theme.colors.gray200}`,
                    borderRadius: theme.borderRadius.sm,
                    backgroundColor: theme.colors.surface,
                  }}
                >
                  <summary
                    style={{
                      padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      fontFamily: 'inherit',
                      fontSize: theme.typography.fontSize.sm,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{ fontWeight: theme.typography.fontWeight.medium }}
                    >
                      {e.label}
                    </span>
                    <span
                      style={{
                        color: theme.colors.gray500,
                        fontSize: theme.typography.fontSize.xs,
                      }}
                    >
                      {e.url}
                    </span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        fontSize: theme.typography.fontSize.xs,
                      }}
                    >
                      {r ? (
                        <>
                          <span
                            style={{
                              color,
                              fontWeight: theme.typography.fontWeight.semibold,
                            }}
                          >
                            {r.error ? 'ERR' : r.status}
                          </span>
                          <span style={{ color: theme.colors.gray500 }}>
                            {r.latencyMs}ms
                          </span>
                          <span
                            style={{
                              color: theme.colors.gray500,
                              minWidth: 70,
                              textAlign: 'right',
                            }}
                          >
                            {timeAgo(r.fetchedAt)}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: theme.colors.gray400 }}>
                          loading…
                        </span>
                      )}
                    </span>
                  </summary>
                  <div
                    style={{
                      padding: theme.spacing.sm,
                      backgroundColor:
                        theme.colors.gray50 || theme.colors.gray100,
                      borderTop: `1px solid ${theme.colors.gray200}`,
                    }}
                  >
                    {r?.error ? (
                      <div style={{ color: theme.colors.error }}>
                        Network error: {r.error}
                      </div>
                    ) : r?.parseError ? (
                      <div>
                        <div
                          style={{
                            color: theme.colors.warning,
                            marginBottom: theme.spacing.xs,
                          }}
                        >
                          Non-JSON response: {r.parseError}
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontSize: theme.typography.fontSize.xs,
                          }}
                        >
                          {String(r.json)}
                        </pre>
                      </div>
                    ) : (
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontSize: theme.typography.fontSize.xs,
                          maxHeight: 600,
                          overflow: 'auto',
                        }}
                      >
                        {r?.json !== null && r?.json !== undefined
                          ? JSON.stringify(r.json, null, 2)
                          : '(empty body)'}
                      </pre>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
};

export default DataExplorer;
