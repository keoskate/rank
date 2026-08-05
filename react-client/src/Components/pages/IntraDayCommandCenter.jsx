import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import theme from '../../theme';
import SystemHealthBar from './SystemHealthBar';
import SessionCardGrid from './SessionCardGrid';
import CommandCenterLogFeed from './CommandCenterLogFeed';
import AccountSummaryPanel from './AccountSummaryPanel';
import OpenPositionsTable from './OpenPositionsTable';
import TodaysTradeLedger from './TodaysTradeLedger';
import LivePriceTickers from './LivePriceTickers';
import SignalActivityPanel from './SignalActivityPanel';
import GatesAndIndicatorsPanel from './GatesAndIndicatorsPanel';
import MarketStrip from './MarketStrip';
import SoxxMovers from './SoxxMovers';
import SoxxInternals from './SoxxInternals';
import SoxxEarnings from './SoxxEarnings';
import MacroContextPanel from './MacroContextPanel';
import { SOXX_TOP } from './soxxConstituents';
import MultiTimeframeTechnicals from './MultiTimeframeTechnicals';
import SoxlChart from './SoxlChart';
import SemiconductorSentimentPanel from '../trading/SemiconductorSentimentPanel';
import TechnicalRegimeCard from '../common/TechnicalRegimeCard';

// Defined at module scope so referential identity is stable across parent
// re-renders (5s poll cycle). Previously defined inline → new function
// reference each render → forced remount of every SectionHeader + TwoCol.
const SectionHeader = ({ index, label }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: theme.spacing.md,
      marginTop: theme.spacing.lg,
      marginBottom: 4,
    }}
  >
    <span
      style={{
        fontFamily: theme.typography.fontFamilyMono,
        fontSize: '0.75rem',
        fontWeight: 700,
        color: theme.colors.gray400,
        letterSpacing: '0.08em',
      }}
    >
      {String(index).padStart(2, '0')}
    </span>
    <span
      style={{
        fontSize: '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.22em',
        color: theme.colors.charcoal,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
    <div style={{ flex: 1, height: 1, background: theme.colors.ruler }} />
  </div>
);

const TwoCol = ({ children, align }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
      gap: theme.spacing.md,
      // Default (stretch) matches equal-height pairs; align="start" lets a short
      // card size to its content instead of stretching into empty whitespace.
      alignItems: align,
    }}
  >
    {children}
  </div>
);

const MAX_LOGS = 200;
const POLL_INTERVAL = 5000;
const TRACKED_SYMBOLS = ['SOXL', 'SOXS'];
// Symbols whose indicators belong on this SOXX/semis command center. Fetched
// directly from /api/indicators so the cards always have data — the old
// socket-log source only populated when a session happened to broadcast (and
// leaked the Crypto session's BTC/ETH, which are irrelevant here).
const INDICATOR_SYMBOLS = ['SOXL', 'SOXS', 'SOXX'];

// Flatten /api/indicators' nested shape into the panel's simple fields.
const mapIndicators = ind => {
  if (!ind) return null;
  return {
    rsi: ind.rsi?.value ?? null,
    macd: ind.macd?.value ?? ind.macd?.histogram ?? null,
    volumeRatio: ind.volume?.ratio ?? null,
    adx: ind.adx?.value ?? null,
    // panel multiplies by 100; endpoint returns %B as a 0–1 fraction
    bbPercentB: ind.bollingerBands?.percentB ?? null,
    updatedAt: ind.timestamp || new Date().toISOString(),
  };
};

const IntraDayCommandCenter = ({ tradingMode }) => {
  const [sessions, setSessions] = useState([]);
  const [sentiment, setSentiment] = useState(null);
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [accountError, setAccountError] = useState(null);
  const [positionsError, setPositionsError] = useState(null);
  const [ordersError, setOrdersError] = useState(null);
  const [health, setHealth] = useState({
    server: 'unknown',
    alpaca: 'unknown',
    sentiment: 'unknown',
  });
  const [logs, setLogs] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [flashTrades, setFlashTrades] = useState(new Set());
  const [indicatorData, setIndicatorData] = useState({});
  const [constituentQuotes, setConstituentQuotes] = useState({});
  const [constituentUpdatedAt, setConstituentUpdatedAt] = useState(null);
  const [socket, setSocket] = useState(null);

  // Poll the 30 SOXX constituent quotes ONCE here and feed both SoxxMovers and
  // SoxxInternals (breadth/rotation), so we don't fetch them twice.
  useEffect(() => {
    let cancelled = false;
    const fetchConstituents = async () => {
      const results = await Promise.all(
        SOXX_TOP.map(async ({ sym }) => {
          try {
            const res = await fetch(`/api/quote/${sym}`);
            if (!res.ok) return [sym, null];
            return [sym, await res.json()];
          } catch {
            return [sym, null];
          }
        })
      );
      if (cancelled) return;
      setConstituentQuotes(Object.fromEntries(results));
      setConstituentUpdatedAt(new Date());
    };
    fetchConstituents();
    const id = setInterval(fetchConstituents, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Poll indicators for the semis symbols directly — reliable, always populated.
  useEffect(() => {
    let cancelled = false;
    const fetchIndicators = async () => {
      const entries = await Promise.all(
        INDICATOR_SYMBOLS.map(async sym => {
          try {
            const res = await fetch(
              `/api/indicators/${sym}?timeframe=5&unit=minute`
            );
            if (!res.ok) return [sym, null];
            const data = await res.json();
            return [sym, mapIndicators(data.indicators)];
          } catch {
            return [sym, null];
          }
        })
      );
      if (cancelled) return;
      const next = {};
      for (const [sym, ind] of entries) if (ind) next[sym] = ind;
      setIndicatorData(next);
    };
    fetchIndicators();
    const id = setInterval(fetchIndicators, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Guards setState calls in fetchData from firing after unmount — critical
  // because the page polls 5s with a Promise.all of 5 endpoints; navigating
  // away mid-fetch otherwise triggers "setState on unmounted" warnings.
  const mountedRef = useRef(true);
  // Tracks pending setTimeouts (flashTrade clear, post-trade refresh) so we
  // can cancel them on unmount instead of leaking + writing to dead state.
  const timeoutsRef = useRef(new Set());
  // Ref keeps the latest fetchData callable from inside the WebSocket
  // useEffect without forcing the socket to tear down + reconnect every
  // time tradingMode changes (fetchData identity is gated on tradingMode).
  const fetchDataRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Returns prev if structurally equal to next so memo'd children skip
  // re-render. JSON.stringify is sub-ms for our data sizes (~10 positions
  // × ~10 fields, ~5 sessions, etc.) and cheaper than the child reconcile.
  const stableSet = (setter, next) => {
    setter(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };

  const addLog = useCallback((level, message, session) => {
    setLogs(prev => {
      const next = [
        ...prev,
        { level, message, session, timestamp: new Date().toISOString() },
      ];
      return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
    });
  }, []);

  // REST polling
  const fetchData = useCallback(async () => {
    const newHealth = {
      server: 'unknown',
      alpaca: 'unknown',
      sentiment: 'unknown',
    };

    try {
      const [sessionsRes, sentimentRes, accountRes, positionsRes, ordersRes] =
        await Promise.all([
          fetch('/api/ai/sessions/default_user'),
          fetch('/api/semiconductor/sentiment'),
          fetch(`/api/alpaca/account?mode=${tradingMode}`),
          fetch(`/api/alpaca/positions?mode=${tradingMode}`),
          fetch(`/api/alpaca/orders?mode=${tradingMode}&status=all&limit=100`),
        ]);

      if (!mountedRef.current) return; // unmounted during Promise.all → bail

      // Server is reachable if any request succeeded
      newHealth.server = sessionsRes.ok ? 'ok' : 'degraded';

      if (sessionsRes.ok) {
        const data = await sessionsRes.json();
        stableSet(setSessions, data.sessions || []);
      }

      if (sentimentRes.ok) {
        const data = await sentimentRes.json();
        stableSet(setSentiment, data);
        newHealth.sentiment = 'ok';
      } else {
        newHealth.sentiment = 'degraded';
      }

      if (accountRes.ok) {
        newHealth.alpaca = 'ok';
        const data = await accountRes.json();
        // The route wraps the body as { success: true, account: {...} }
        stableSet(setAccount, data.account || data);
        setAccountError(null);
      } else {
        newHealth.alpaca = 'degraded';
        setAccountError(`HTTP ${accountRes.status}`);
      }

      if (positionsRes.ok) {
        const data = await positionsRes.json();
        stableSet(setPositions, Array.isArray(data.positions) ? data.positions : []);
        setPositionsError(null);
      } else {
        setPositionsError(`HTTP ${positionsRes.status}`);
      }

      if (ordersRes.ok) {
        const data = await ordersRes.json();
        stableSet(setOrders, Array.isArray(data.orders) ? data.orders : []);
        setOrdersError(null);
      } else {
        setOrdersError(`HTTP ${ordersRes.status}`);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      newHealth.server = 'down';
      newHealth.alpaca = 'down';
      newHealth.sentiment = 'down';
      setAccountError(err?.message || 'fetch failed');
      setPositionsError(err?.message || 'fetch failed');
      setOrdersError(err?.message || 'fetch failed');
    }

    if (!mountedRef.current) return;
    setHealth(newHealth);
    setLastRefresh(new Date());
  }, [tradingMode]);

  // Keep the ref pointing at the latest fetchData so the WebSocket effect
  // can call it without depending on fetchData identity.
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

  // Initial fetch + polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // WebSocket connection
  useEffect(() => {
    const sock = io(window.location.origin, {
      transports: ['websocket', 'polling'],
    });
    setSocket(sock);

    const trackedTimeout = (cb, ms) => {
      const id = setTimeout(() => {
        timeoutsRef.current.delete(id);
        cb();
      }, ms);
      timeoutsRef.current.add(id);
      return id;
    };

    sock.on('connect', () => {
      setWsConnected(true);
      sock.emit('authenticate', { userId: 'default_user' });
      addLog('INFO', 'WebSocket connected');
    });

    sock.on('disconnect', () => {
      setWsConnected(false);
      addLog('ERROR', 'WebSocket disconnected');
    });

    sock.on('trading_log', log => {
      // Indicators for the Gates panel come from /api/indicators (polled above),
      // not the socket — this handler just streams log messages to the feed.
      if (log.message) {
        addLog(log.level || 'INFO', log.message, log.sessionName || log.sessionId);
      }
    });

    sock.on('ai_decision', decision => {
      const action = decision.action || 'HOLD';
      const confidence = decision.confidence
        ? ` (${(decision.confidence * 100).toFixed(0)}%)`
        : '';
      addLog(
        action === 'BUY' || action === 'SELL' || action === 'EXIT'
          ? 'SIGNAL'
          : 'DECISION',
        `${action} ${decision.symbol}${confidence}${decision.reasons?.[0] ? ' - ' + decision.reasons[0] : ''}`,
        decision.sessionName || decision.sessionId
      );
    });

    sock.on('trade_executed', trade => {
      addLog(
        'EXEC',
        `${trade.side?.toUpperCase()} ${trade.quantity} ${trade.symbol} @ ${trade.price ? '$' + parseFloat(trade.price).toFixed(2) : 'market'}${trade.pnl ? ' P&L: $' + parseFloat(trade.pnl).toFixed(2) : ''}`,
        trade.sessionName || trade.sessionId
      );

      // Flash the session card
      if (trade.sessionId) {
        setFlashTrades(prev => new Set(prev).add(trade.sessionId));
        trackedTimeout(() => {
          setFlashTrades(prev => {
            const next = new Set(prev);
            next.delete(trade.sessionId);
            return next;
          });
        }, 2000);
      }

      // Refresh data after trade (via ref so we don't depend on fetchData
      // identity in the WebSocket effect's deps)
      trackedTimeout(() => fetchDataRef.current?.(), 1000);
    });

    sock.on('alert', alert => {
      addLog(
        alert.severity === 'critical' || alert.severity === 'high'
          ? 'ALERT'
          : 'INFO',
        `${alert.title || 'Alert'}: ${alert.message}`,
        alert.sessionName || alert.sessionId
      );
    });

    sock.on('position_update', pos => {
      addLog(
        'INFO',
        `Position update: ${pos.symbol} qty=${pos.quantity} unrealized=${pos.unrealizedPnL ? '$' + parseFloat(pos.unrealizedPnL).toFixed(2) : 'N/A'}`,
        pos.sessionName
      );
    });

    return () => {
      sock.disconnect();
      setSocket(null);
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current.clear();
    };
    // Intentionally omit fetchData from deps — accessed via fetchDataRef
    // so socket persists across tradingMode changes. addLog is stable
    // (useCallback []) so it's safe to omit too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningSessions = sessions.filter(s => s.status === 'running').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      <MarketStrip />

      <SystemHealthBar
        health={health}
        runningSessions={runningSessions}
        lastRefresh={lastRefresh}
        wsConnected={wsConnected}
      />

      <SectionHeader index={1} label="At a glance" />
      <AccountSummaryPanel
        account={account}
        loading={!account && !accountError}
        error={accountError}
      />

      <SectionHeader index={2} label="Active trading" />
      <LivePriceTickers socket={socket} symbols={TRACKED_SYMBOLS} positions={positions} />
      <SoxlChart symbol="SOXL" />
      <TwoCol>
        <OpenPositionsTable
          positions={positions}
          loading={positions.length === 0 && !positionsError}
          error={positionsError}
        />
        <GatesAndIndicatorsPanel
          logs={logs}
          indicators={indicatorData}
          sentiment={sentiment}
        />
      </TwoCol>

      <SectionHeader index={3} label="Market context" />
      {/* High-level read first: macro cross-asset + SOXX internals (what's
          driving semis), then the constituent detail + technicals below. */}
      <TwoCol align="start">
        <MacroContextPanel />
        <SoxxInternals
          quotes={constituentQuotes}
          updatedAt={constituentUpdatedAt}
        />
      </TwoCol>
      <TwoCol align="start">
        <SoxxMovers
          quotes={constituentQuotes}
          updatedAt={constituentUpdatedAt}
        />
        <SoxxEarnings />
      </TwoCol>
      <MultiTimeframeTechnicals symbol="SOXL" />
      <TwoCol align="start">
        <SemiconductorSentimentPanel />
        <TechnicalRegimeCard symbol="SOXL" />
      </TwoCol>

      <SectionHeader index={4} label="Activity" />
      <SessionCardGrid sessions={sessions} flashTrades={flashTrades} />
      <TwoCol>
        <SignalActivityPanel logs={logs} />
        <TodaysTradeLedger
          orders={orders}
          loading={orders.length === 0 && !ordersError}
          error={ordersError}
        />
      </TwoCol>
      <CommandCenterLogFeed logs={logs} sentiment={sentiment} />
    </div>
  );
};

export default IntraDayCommandCenter;
