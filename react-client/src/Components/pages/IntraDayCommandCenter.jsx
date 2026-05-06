import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import theme from '../../theme';
import SystemHealthBar from './SystemHealthBar';
import SessionCardGrid from './SessionCardGrid';
import CommandCenterLogFeed from './CommandCenterLogFeed';

const MAX_LOGS = 30;
const POLL_INTERVAL = 15000;

const IntraDayCommandCenter = ({ tradingMode }) => {
  const [sessions, setSessions] = useState([]);
  const [sentiment, setSentiment] = useState(null);
  const [health, setHealth] = useState({
    server: 'unknown',
    alpaca: 'unknown',
    sentiment: 'unknown',
  });
  const [logs, setLogs] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [flashTrades, setFlashTrades] = useState(new Set());

  const socketRef = useRef(null);

  const addLog = useCallback((level, message, session) => {
    setLogs((prev) => {
      const next = [...prev, { level, message, session, timestamp: new Date().toISOString() }];
      return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
    });
  }, []);

  // REST polling
  const fetchData = useCallback(async () => {
    const newHealth = { server: 'unknown', alpaca: 'unknown', sentiment: 'unknown' };

    try {
      const [sessionsRes, sentimentRes, accountRes] = await Promise.all([
        fetch('/api/ai/sessions/default_user'),
        fetch('/api/semiconductor/sentiment'),
        fetch(`/api/alpaca/account?mode=${tradingMode}`),
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
      } else {
        newHealth.alpaca = 'degraded';
      }
    } catch {
      newHealth.server = 'down';
      newHealth.alpaca = 'down';
      newHealth.sentiment = 'down';
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
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setWsConnected(true);
      socket.emit('authenticate', { userId: 'default_user' });
      addLog('INFO', 'WebSocket connected');
    });

    socket.on('disconnect', () => {
      setWsConnected(false);
      addLog('ERROR', 'WebSocket disconnected');
    });

    socket.on('ai_decision', (decision) => {
      const action = decision.action || 'HOLD';
      const confidence = decision.confidence
        ? ` (${(decision.confidence * 100).toFixed(0)}%)`
        : '';
      addLog(
        action === 'BUY' || action === 'SELL' || action === 'EXIT' ? 'SIGNAL' : 'DECISION',
        `${action} ${decision.symbol}${confidence}${decision.reasons?.[0] ? ' - ' + decision.reasons[0] : ''}`,
        decision.sessionName || decision.sessionId
      );
    });

    socket.on('trade_executed', (trade) => {
      addLog(
        'EXEC',
        `${trade.side?.toUpperCase()} ${trade.quantity} ${trade.symbol} @ ${trade.price ? '$' + parseFloat(trade.price).toFixed(2) : 'market'}${trade.pnl ? ' P&L: $' + parseFloat(trade.pnl).toFixed(2) : ''}`,
        trade.sessionName || trade.sessionId
      );

      // Flash the session card
      if (trade.sessionId) {
        setFlashTrades((prev) => new Set(prev).add(trade.sessionId));
        setTimeout(() => {
          setFlashTrades((prev) => {
            const next = new Set(prev);
            next.delete(trade.sessionId);
            return next;
          });
        }, 2000);
      }

      // Refresh data after trade
      setTimeout(fetchData, 1000);
    });

    socket.on('alert', (alert) => {
      addLog(
        alert.severity === 'critical' || alert.severity === 'high' ? 'ALERT' : 'INFO',
        `${alert.title || 'Alert'}: ${alert.message}`,
        alert.sessionName || alert.sessionId
      );
    });

    socket.on('position_update', (pos) => {
      addLog(
        'INFO',
        `Position update: ${pos.symbol} qty=${pos.quantity} unrealized=${pos.unrealizedPnL ? '$' + parseFloat(pos.unrealizedPnL).toFixed(2) : 'N/A'}`,
        pos.sessionName
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [addLog, fetchData]);

  const runningSessions = sessions.filter((s) => s.status === 'running').length;

  return (
    <div>
      <SystemHealthBar
        health={health}
        runningSessions={runningSessions}
        lastRefresh={lastRefresh}
        wsConnected={wsConnected}
      />

      <SessionCardGrid sessions={sessions} flashTrades={flashTrades} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: theme.spacing.md,
        }}
      >
        <CommandCenterLogFeed logs={logs} sentiment={sentiment} />
      </div>
    </div>
  );
};

export default IntraDayCommandCenter;
