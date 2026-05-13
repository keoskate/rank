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
import MultiTimeframeTechnicals from './MultiTimeframeTechnicals';
import SoxlChart from './SoxlChart';
import SemiconductorSentimentPanel from '../trading/SemiconductorSentimentPanel';
import TechnicalRegimeCard from '../common/TechnicalRegimeCard';
import LeveragedEtfPanel from '../common/LeveragedEtfPanel';

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

const TwoCol = ({ children }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
      gap: theme.spacing.md,
    }}
  >
    {children}
  </div>
);

const MAX_LOGS = 200;
const POLL_INTERVAL = 5000;
const TRACKED_SYMBOLS = ['SOXL', 'SOXS'];

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
  const [liveIndicators, setLiveIndicators] = useState({});
  const [socket, setSocket] = useState(null);

  const socketRef = useRef(null);

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

      // Server is reachable if any request succeeded
      newHealth.server = sessionsRes.ok ? 'ok' : 'degraded';

      if (sessionsRes.ok) {
        const data = await sessionsRes.json();
        setSessions(data.sessions || []);
      }

      if (sentimentRes.ok) {
        const data = await sentimentRes.json();
        setSentiment(data);
        newHealth.sentiment = 'ok';
      } else {
        newHealth.sentiment = 'degraded';
      }

      if (accountRes.ok) {
        newHealth.alpaca = 'ok';
        const data = await accountRes.json();
        // The route wraps the body as { success: true, account: {...} }
        setAccount(data.account || data);
        setAccountError(null);
      } else {
        newHealth.alpaca = 'degraded';
        setAccountError(`HTTP ${accountRes.status}`);
      }

      if (positionsRes.ok) {
        const data = await positionsRes.json();
        setPositions(Array.isArray(data.positions) ? data.positions : []);
        setPositionsError(null);
      } else {
        setPositionsError(`HTTP ${positionsRes.status}`);
      }

      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        setOrdersError(null);
      } else {
        setOrdersError(`HTTP ${ordersRes.status}`);
      }
    } catch (err) {
      newHealth.server = 'down';
      newHealth.alpaca = 'down';
      newHealth.sentiment = 'down';
      setAccountError(err?.message || 'fetch failed');
      setPositionsError(err?.message || 'fetch failed');
      setOrdersError(err?.message || 'fetch failed');
    }

    setHealth(newHealth);
    setLastRefresh(new Date());
  }, [tradingMode]);

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
    socketRef.current = sock;
    setSocket(sock);

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
      if (log.symbol && log.data?.indicators) {
        const ind = log.data.indicators;
        setLiveIndicators(prev => ({
          ...prev,
          [log.symbol]: {
            rsi: parseFloat(ind.rsi),
            macd: parseFloat(ind.macd),
            volumeRatio: parseFloat(ind.volumeRatio),
            adx: parseFloat(ind.adx),
            bbPercentB: ind.bbPercentB != null ? parseFloat(ind.bbPercentB) / 100 : null,
            regime: log.data.regime,
            updatedAt: log.timestamp || new Date().toISOString(),
          },
        }));
      }
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
        setTimeout(() => {
          setFlashTrades(prev => {
            const next = new Set(prev);
            next.delete(trade.sessionId);
            return next;
          });
        }, 2000);
      }

      // Refresh data after trade
      setTimeout(fetchData, 1000);
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
    };
  }, [addLog, fetchData]);

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
          indicators={liveIndicators}
          sentiment={sentiment}
        />
      </TwoCol>

      <SectionHeader index={3} label="Market context" />
      <TwoCol>
        <SoxxMovers />
        <MultiTimeframeTechnicals symbol="SOXL" />
      </TwoCol>
      <TwoCol>
        <SemiconductorSentimentPanel />
        <TechnicalRegimeCard symbol="SOXL" />
      </TwoCol>
      <LeveragedEtfPanel enabled={true} />

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
