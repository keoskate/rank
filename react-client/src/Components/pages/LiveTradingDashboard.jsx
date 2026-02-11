/**
 * Live Trading Dashboard
 *
 * Main page for autonomous AI trading simulation.
 * Features: Start/Stop controls, active positions, AI decision feed,
 * performance metrics, TradingView charts, and strategy configuration.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import TradingViewChart from '../common/TradingViewChart';
import WatchlistCharts from '../common/WatchlistCharts';
import TradingSimulator from '../TradingSimulator';
import Button from '../common/Button';
import Card from '../common/Card';
import MetricCard from '../common/MetricCard';
import StrategyMonitorPanel from '../common/StrategyMonitorPanel';
import RegimeConfigPanel from '../common/RegimeConfigPanel';
import LeveragedEtfPanel from '../common/LeveragedEtfPanel';
import CheddarFlowCard from '../common/CheddarFlowCard';
import TechnicalRegimeCard from '../common/TechnicalRegimeCard';
import MarketTideCard from '../common/MarketTideCard';
import StrategyValidatorPanel from '../common/StrategyValidatorPanel';
import TradingLogPanel from '../common/TradingLogPanel';
import ErrorBoundary from '../common/ErrorBoundary';
import { TradingConfigPanel, TradingSessionSummary } from '../trading';
// LiveTradingChart removed - now using TradingViewChart
import theme from '../../theme';
import {
  useTradingConfig,
  DEFAULT_TRADING_CONFIG,
} from '../../contexts/TradingConfigContext';
import {
  loadAudioSettings,
  saveAudioSettings,
  announceTrade,
  announceAIDecision,
  announcePriceAlert,
  testAudioSystem,
  playBuySound,
  playSellSound,
} from '../../utils/audioNotifications';
import { getStockListNames, getStockList } from '../../config/stockLists';

// Socket connection
let socket = null;

// Trading config is now managed by TradingConfigContext (../contexts/TradingConfigContext.jsx)
// Use useTradingConfig() hook to access config, updateConfig, resetConfig
// DEFAULT_CONFIG is now DEFAULT_TRADING_CONFIG from the context

const LiveTradingDashboard = ({
  sessionId: propSessionId,
  onSessionUpdate,
  isMultiSessionMode = false,
}) => {
  // Get sessionId from props (multi-session mode) or URL params (standalone mode)
  const { sessionId: urlParamSessionId } = useParams();
  const urlSessionId = propSessionId || urlParamSessionId;
  const navigate = useNavigate();

  // Session state - now driven by URL
  const [sessionStatus, setSessionStatus] = useState('stopped'); // 'running', 'paused', 'stopped'
  const [sessionName, setSessionName] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  // Track if user is actively editing config to prevent auto-refresh overwrites
  // Use both state (for React re-renders) and ref (for interval callbacks)
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const isEditingConfigRef = useRef(false);
  const showSimulatorRef = useRef(false); // Track if simulator is open (prevents config overwrite)
  const configEditTimeoutRef = useRef(null);

  // Portfolio state
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [selectedPosition, setSelectedPosition] = useState(null);

  // AI state
  const [decisions, setDecisions] = useState([]);
  const [alerts, setAlerts] = useState([]);

  // Performance state
  const [stats, setStats] = useState({
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnL: 0,
    totalPnLPercent: 0,
  });

  // Real order stats from Alpaca (today's filled orders)
  const [orderStats, setOrderStats] = useState({
    todayOrders: 0,
    todayBuys: 0,
    todaySells: 0,
    pendingOrders: 0,
  });

  // Recent trades for LiveTradingChart
  const [recentTrades, setRecentTrades] = useState([]);

  // Chart state
  const [chartData, setChartData] = useState([]);
  const [chartSymbol, setChartSymbol] = useState('');
  const [chartIndicators, setChartIndicators] = useState({});

  // Configuration state - use shared context
  const {
    config,
    updateConfig: contextUpdateConfig,
    resetConfig: resetConfigContext,
    lastSaved,
  } = useTradingConfig();
  const [showConfig, setShowConfig] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [configSection, setConfigSection] = useState('none'); // Old tabs removed - using TradingConfigPanel now
  const [configLoaded, setConfigLoaded] = useState(false); // Track if we've loaded config from server
  const [savedConfigs, setSavedConfigs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('saved-trading-configs') || '{}');
    } catch {
      return {};
    }
  });
  const [showLoadConfigDropdown, setShowLoadConfigDropdown] = useState(false);

  // Loading states - separate for each section to avoid full page re-renders
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [positionsLoading, setPositionsLoading] = useState(true);

  // Simulation mode
  const [showSimulator, setShowSimulator] = useState(false);
  const [simulationDate, setSimulationDate] = useState(null);
  const [simulationSymbol, setSimulationSymbol] = useState(null);

  // Leveraged ETF Strategy mode
  const [leveragedEtfEnabled, setLeveragedEtfEnabled] = useState(false);
  const [selectedEtfFamily, setSelectedEtfFamily] = useState(null);

  // Experimental panels visibility (Market Regime + Leveraged ETF) - collapsed by default
  const [showExperimentalPanels, setShowExperimentalPanels] = useState(() => {
    try {
      return localStorage.getItem('show-experimental-panels') === 'true';
    } catch {
      return false;
    }
  });
  const toggleExperimentalPanels = () => {
    const newValue = !showExperimentalPanels;
    setShowExperimentalPanels(newValue);
    try {
      localStorage.setItem('show-experimental-panels', String(newValue));
    } catch {}
  };

  // Sync preference first (needed to determine initial research symbol)
  const [syncResearchWithChart, setSyncResearchWithChart] = useState(() => {
    try {
      return localStorage.getItem('sync-research-with-chart') === 'true';
    } catch {
      return false;
    }
  });

  // Research symbol for experimental analysis
  // If sync is enabled, default to first watchlist symbol; otherwise use localStorage
  const [researchSymbol, setResearchSymbol] = useState(() => {
    try {
      const syncEnabled =
        localStorage.getItem('sync-research-with-chart') === 'true';
      if (syncEnabled) {
        // Will be overwritten by useEffect when chart/simulation symbol loads
        return 'QBTS';
      }
      return localStorage.getItem('research-symbol') || 'QBTS';
    } catch {
      return 'QBTS';
    }
  });

  // Signal data from experimental cards (for checklist aggregation)
  const [signalData, setSignalData] = useState({
    regime: null,
    flow: null,
    marketTide: null,
  });

  // Get locked symbols when ETF mode is enabled
  const lockedSymbols =
    leveragedEtfEnabled && selectedEtfFamily
      ? [selectedEtfFamily.base, selectedEtfFamily.bull, selectedEtfFamily.bear]
      : null;

  // Sync showSimulator state to ref (for use in polling interval without re-creating interval)
  // Also manage editing protection: when simulator is open, mark as editing
  // When simulator closes, keep editing protection for 15 seconds (grace period)
  useEffect(() => {
    showSimulatorRef.current = showSimulator;

    if (showSimulator) {
      // Simulator opened - mark as editing to prevent config overwrite
      isEditingConfigRef.current = true;
      setIsEditingConfig(true);
      // Clear any pending timeout
      if (configEditTimeoutRef.current) {
        clearTimeout(configEditTimeoutRef.current);
        configEditTimeoutRef.current = null;
      }
    } else {
      // Simulator closed - keep protection for 15 seconds grace period
      // This prevents immediate overwrite when hiding simulator
      configEditTimeoutRef.current = setTimeout(() => {
        isEditingConfigRef.current = false;
        setIsEditingConfig(false);
      }, 15000);
    }
  }, [showSimulator]);

  // Persist research symbol to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('research-symbol', researchSymbol);
    } catch {}
  }, [researchSymbol]);

  // Persist sync with chart preference
  useEffect(() => {
    try {
      localStorage.setItem(
        'sync-research-with-chart',
        syncResearchWithChart.toString()
      );
    } catch {}
  }, [syncResearchWithChart]);

  // Sync research symbol with chart/simulation symbol when enabled
  // Priority: simulationSymbol (if simulator is shown) > chartSymbol > first watchlist item
  useEffect(() => {
    if (!syncResearchWithChart) return;

    // Determine the active symbol to sync with
    const activeSymbol =
      simulationSymbol || chartSymbol || config.watchlist?.[0];
    if (activeSymbol && activeSymbol !== researchSymbol) {
      setResearchSymbol(activeSymbol);
    }
  }, [syncResearchWithChart, simulationSymbol, chartSymbol, config.watchlist]);

  // Audio notification settings
  const [audioSettings, setAudioSettings] = useState(() => loadAudioSettings());

  const decisionsEndRef = useRef(null);

  // Config is now saved automatically by TradingConfigContext

  // Initialize socket connection
  useEffect(() => {
    socket = io('http://localhost:8080', {
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      socket.emit('authenticate', { userId: 'default_user' });
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    });

    socket.on('authenticated', data => {
      console.log('Authenticated:', data);
    });

    socket.on('simulation_started', data => {
      // Navigate to the new session URL
      navigate(`/live-trading/${data.sessionId}`);
      setSessionStatus('running');
      addAlert(
        'success',
        'Trading Started',
        'AI trading simulation is now active'
      );
    });

    socket.on('simulation_stopped', () => {
      setSessionStatus('stopped');
      addAlert(
        'info',
        'Trading Stopped',
        'AI trading simulation has been stopped'
      );
    });

    socket.on('simulation_paused', () => {
      setSessionStatus('paused');
      addAlert('warning', 'Trading Paused', 'AI trading simulation is paused');
    });

    socket.on('simulation_resumed', () => {
      setSessionStatus('running');
      addAlert('success', 'Trading Resumed', 'AI trading simulation resumed');
    });

    socket.on('ai_decision', decision => {
      // Filter by session - only process if from current session or no session filter
      if (decision.sessionId && urlSessionId && decision.sessionId !== urlSessionId) {
        return; // Ignore decisions from other sessions
      }
      setDecisions(prev => [...prev.slice(-49), decision]);
      // Announce AI decisions if enabled
      if (decision.action === 'BUY' || decision.action === 'SELL') {
        announceAIDecision(decision);
      }
    });

    socket.on('position_update', position => {
      setPositions(prev => {
        const idx = prev.findIndex(p => p.symbol === position.symbol);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = position;
          return updated;
        }
        return [...prev, position];
      });
    });

    socket.on('trade_executed', trade => {
      // Filter by session - only process if from current session or no session filter
      if (trade.sessionId && urlSessionId && trade.sessionId !== urlSessionId) {
        return; // Ignore trades from other sessions
      }
      // Build alert message - include P&L for sell trades
      let alertMessage = `${trade.quantity} ${trade.symbol} @ $${trade.price.toFixed(2)}`;
      if (trade.side?.toLowerCase() === 'sell' && trade.pnl !== undefined && trade.pnl !== null) {
        const pnlSign = trade.pnl >= 0 ? '+' : '';
        alertMessage += ` (${pnlSign}$${trade.pnl.toFixed(2)})`;
      }
      addAlert(
        trade.status === 'filled' ? 'success' : 'info',
        `Trade ${trade.side.toUpperCase()}`,
        alertMessage
      );
      // Announce trade via audio
      announceTrade(trade);
      // Refresh positions
      fetchPositions();
      // Also refresh order stats to update trade markers on chart
      fetchOrderStats();
    });

    socket.on('alert', alert => {
      // Filter by session - only process if from current session or no session filter
      if (alert.sessionId && urlSessionId && alert.sessionId !== urlSessionId) {
        return; // Ignore alerts from other sessions
      }
      addAlert(alert.type, alert.title, alert.message);
    });

    socket.on('daily_summary', summary => {
      setStats(summary);
    });

    socket.on('price_update', data => {
      // Update chart if it's the selected symbol
      if (data.symbol === chartSymbol) {
        // Update last candle
      }
    });

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [chartSymbol, urlSessionId]); // Include urlSessionId to re-register handlers when session changes

  // Fetch session details when URL sessionId changes
  useEffect(() => {
    if (urlSessionId) {
      // Reset configLoaded when switching sessions
      setConfigLoaded(false);
      fetchSessionDetails(urlSessionId, true);
      // Fetch chart data for the first watchlist symbol
      const firstSymbol = config.watchlist?.[0];
      if (firstSymbol && !chartSymbol) {
        fetchChartData(firstSymbol);
      }
    }
  }, [urlSessionId]);

  // Fetch initial data and set up live polling
  // CRITICAL: Wait for config to be loaded from session before fetching account/positions
  // This ensures we use the correct trading mode (paper vs live) for this session
  useEffect(() => {
    // Don't fetch account data until we have a session and config is loaded
    // This prevents using stale localStorage config before session config is applied
    if (!configLoaded && urlSessionId) {
      console.log(
        '[LiveTrading] Waiting for session config before fetching account data...'
      );
      return;
    }

    fetchAccount();
    fetchPositions();
    fetchOrderStats();

    // Live polling every 10 seconds for real-time updates
    // Only poll session details if we have a sessionId and user isn't editing
    // Use ref instead of state to avoid closure issues and interval recreation
    const pollInterval = setInterval(() => {
      fetchAccount();
      fetchPositions();
      fetchOrderStats();
      // Don't fetch session details (which can overwrite config) if user is editing or simulator is open
      if (
        urlSessionId &&
        !isEditingConfigRef.current &&
        !showSimulatorRef.current
      ) {
        fetchSessionDetails(urlSessionId);
      }
    }, 10000);

    return () => clearInterval(pollInterval);
  }, [urlSessionId, configLoaded]); // Include configLoaded to re-run when config is ready

  // Re-fetch account data when paperTradeOnly mode changes
  // This ensures we show the correct account balance for Paper vs Live
  // Also updates allocatedCapital to match the new account's available cash
  useEffect(() => {
    // Only re-fetch if config is loaded (to avoid initial double-fetch)
    if (configLoaded) {
      console.log(
        `[LiveTrading] Trading mode changed to ${config.paperTradeOnly ? 'PAPER' : 'LIVE'}, refreshing account data...`
      );

      // Fetch account and update allocated capital to match
      const fetchAndUpdateCapital = async () => {
        const mode = config.paperTradeOnly === false ? 'live' : 'paper';
        try {
          const res = await fetch(`/api/alpaca/account?mode=${mode}`);
          const data = await res.json();
          if (res.ok) {
            const accountData = data.account || data;
            setAccount(accountData);
            setAccountLoading(false);

            // Auto-update allocated capital to match the account's available cash
            const availableCash = parseFloat(accountData.cash || 0);
            if (availableCash > 0) {
              console.log(
                `[LiveTrading] Updating allocated capital to $${availableCash.toLocaleString()} (${mode} account)`
              );
              updateConfig('allocatedCapital', Math.floor(availableCash));
            }
          }
        } catch (err) {
          console.error('Failed to fetch account:', err);
          setAccountLoading(false);
        }
      };

      fetchAndUpdateCapital();
      fetchPositions();
      fetchOrderStats();
    }
  }, [config.paperTradeOnly, configLoaded]);

  // Auto-scroll decisions - DISABLED to prevent UI jumping while user configures
  // useEffect(() => {
  //   decisionsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  // }, [decisions]);

  const fetchAccount = async () => {
    try {
      // Determine trading mode based on session config
      // paperTradeOnly: true = paper, false = live, undefined = paper (safe default)
      const mode = config.paperTradeOnly === false ? 'live' : 'paper';
      const res = await fetch(`/api/alpaca/account?mode=${mode}`);
      const data = await res.json();
      if (res.ok) {
        // API returns {success: true, account: {...}}
        setAccount(data.account || data);
      }
    } catch (err) {
      console.error('Failed to fetch account:', err);
    } finally {
      setAccountLoading(false);
    }
  };

  const fetchPositions = async () => {
    try {
      // Determine trading mode based on session config
      // paperTradeOnly: true = paper, false = live, undefined = paper (safe default)
      const mode = config.paperTradeOnly === false ? 'live' : 'paper';
      const res = await fetch(`/api/alpaca/positions?mode=${mode}`);
      const data = await res.json();
      if (res.ok) {
        // API may return {success: true, positions: [...]} or direct array
        const positionsArray = data.positions || data;
        setPositions(Array.isArray(positionsArray) ? positionsArray : []);
      }
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    } finally {
      setPositionsLoading(false);
    }
  };

  // Fetch order statistics from Alpaca
  const fetchOrderStats = async () => {
    try {
      // Determine trading mode based on session config
      // paperTradeOnly: true = paper, false = live
      // Default to paper for safety
      const mode = config.paperTradeOnly === false ? 'live' : 'paper';

      // Fetch filled orders (today's completed trades) from the correct account
      const filledRes = await fetch(
        `/api/alpaca/orders?status=filled&limit=100&mode=${mode}`
      );
      const filledData = await filledRes.json();

      // Fetch pending/open orders from the correct account
      const pendingRes = await fetch(
        `/api/alpaca/orders?status=open&limit=50&mode=${mode}`
      );
      const pendingData = await pendingRes.json();

      if (filledRes.ok && pendingRes.ok) {
        const filledOrders = filledData.orders || [];
        const pendingOrders = pendingData.orders || [];

        // Filter to today's orders
        // API returns camelCase field names: createdAt, filledAvgPrice, filledQty
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayOrders = filledOrders.filter(order => {
          // Use createdAt from our API (camelCase) or fall back to snake_case from raw Alpaca
          const orderDate = new Date(
            order.createdAt || order.filled_at || order.submitted_at
          );
          return orderDate >= today;
        });

        const todayBuys = todayOrders.filter(o => o.side === 'buy').length;
        const todaySells = todayOrders.filter(o => o.side === 'sell').length;

        setOrderStats({
          todayOrders: todayOrders.length,
          todayBuys,
          todaySells,
          pendingOrders: pendingOrders.length,
        });

        // Update recentTrades for LiveTradingChart
        // Format trades with needed fields for chart markers
        // API returns camelCase: filledAvgPrice, filledQty, quantity, createdAt
        const formattedTrades = todayOrders.map(order => ({
          symbol: order.symbol,
          side: order.side,
          price: parseFloat(
            order.filledAvgPrice ||
              order.filled_avg_price ||
              order.limit_price ||
              0
          ),
          quantity: parseInt(
            order.filledQty ||
              order.filled_qty ||
              order.quantity ||
              order.qty ||
              0
          ),
          timestamp: order.createdAt || order.filled_at || order.submitted_at,
          orderId: order.id,
        }));
        setRecentTrades(formattedTrades);
      }
    } catch (err) {
      console.error('Failed to fetch order stats:', err);
    }
  };

  // Fetch details for a specific session
  const fetchSessionDetails = async (sessionId, forceLoadConfig = false) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/ai/session/detail/${sessionId}`);
      const data = await res.json();
      if (res.ok && data && data.status !== 'not_found') {
        setSessionStatus(data.status);
        setSessionName(data.name || '');
        setStats(data.stats || stats);
        if (data.recentDecisions) {
          setDecisions(data.recentDecisions);
        }
        // Notify parent of session updates (for multi-session tab bar)
        if (onSessionUpdate) {
          onSessionUpdate({
            name: data.name || '',
            status: data.status,
            stats: data.stats || {},
          });
        }
        // Only load config from server on initial load OR when explicitly requested
        // Never overwrite when user is editing to prevent losing their changes
        // Use ref to get current editing state (avoids closure issues)
        // CRITICAL: Also don't overwrite when simulator is open - it uses its own config edits
        // BUG FIX: Use showSimulatorRef.current instead of showSimulator state to avoid stale closure
        if (
          data.config &&
          !isEditingConfigRef.current &&
          !showSimulatorRef.current &&
          (!configLoaded || forceLoadConfig)
        ) {
          contextUpdateConfig(data.config);
          setConfigLoaded(true);
        }
        // Restore alerts from server session (only on initial load)
        if (data.alerts && data.alerts.length > 0 && !configLoaded) {
          setAlerts(data.alerts.map((a, i) => ({ ...a, id: Date.now() + i })));
        }
        // Restore trading log from server session (only on initial load)
        if (data.tradingLog && data.tradingLog.length > 0 && !configLoaded) {
          setRecentTrades(data.tradingLog);
        }
        console.log(
          `[LiveTrading] Loaded session "${data.name}" (${data.status})`
        );
      } else if (data.status === 'not_found') {
        // Session doesn't exist, redirect to sessions list (only in standalone mode)
        if (!isMultiSessionMode) {
          navigate('/live-trading');
        }
      }
    } catch (err) {
      console.error('Failed to fetch session details:', err);
    }
  };

  const addAlert = (type, title, message) => {
    const alert = {
      id: Date.now(),
      type,
      title,
      message,
      timestamp: new Date(),
    };
    setAlerts(prev => [...prev.slice(-9), alert]);
  };

  // Start trading for current session (resume if stopped, or create new if no session)
  const startTrading = async () => {
    setLoading(true);
    setError(null);

    try {
      const sessionConfig = {
        ...config,
        name: sessionName || config.name || 'New Strategy',
      };

      // If we have a URL sessionId, try to resume it
      if (urlSessionId && sessionStatus === 'stopped') {
        // Resume existing session with updated config
        const res = await fetch('/api/ai/session/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: urlSessionId,
            config: sessionConfig,
          }),
        });
        if (res.ok) {
          setSessionStatus('running');
          addAlert(
            'success',
            'Session Resumed',
            `"${sessionConfig.name}" is now running`
          );
          socket?.emit('start_simulation', {
            userId: 'default_user',
            sessionId: urlSessionId,
            config: sessionConfig,
          });
        }
      } else if (!urlSessionId) {
        // Create a new session and navigate to it
        const res = await fetch('/api/ai/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: 'default_user',
            config: sessionConfig,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to start trading');
        }

        setSessionStatus('running');
        addAlert(
          'success',
          'Session Started',
          `"${sessionConfig.name}" is now running`
        );

        // Navigate to the new session URL
        navigate(`/live-trading/${data.sessionId}`);

        // Notify via socket
        socket?.emit('start_simulation', {
          userId: 'default_user',
          sessionId: data.sessionId,
          config: sessionConfig,
        });
      }
    } catch (err) {
      setError(err.message);
      addAlert('error', 'Start Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Stop trading for current session
  const stopTrading = async () => {
    if (!urlSessionId) return;

    setLoading(true);

    try {
      const res = await fetch('/api/ai/session/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: urlSessionId }),
      });

      if (res.ok) {
        setSessionStatus('stopped');
        addAlert('info', 'Session Stopped', 'Trading session has been stopped');
        socket?.emit('stop_simulation', { sessionId: urlSessionId });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Pause trading for current session
  const pauseTrading = async () => {
    if (!urlSessionId) return;

    try {
      const res = await fetch('/api/ai/session/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: urlSessionId }),
      });

      if (res.ok) {
        setSessionStatus('paused');
        addAlert('warning', 'Session Paused', 'Trading session is paused');
        socket?.emit('pause_simulation', { sessionId: urlSessionId });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Resume trading for current session
  const resumeTrading = async () => {
    if (!urlSessionId) return;

    try {
      const res = await fetch('/api/ai/session/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: urlSessionId }),
      });

      if (res.ok) {
        setSessionStatus('running');
        addAlert(
          'success',
          'Session Resumed',
          'Trading session is now running'
        );
        socket?.emit('resume_simulation', { sessionId: urlSessionId });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Panic sell - immediately close all positions for this session
  const [panicSelling, setPanicSelling] = useState(false);
  const panicSell = async () => {
    if (!urlSessionId) return;

    // Confirmation dialog
    if (!window.confirm('PANIC SELL: This will immediately sell ALL positions at market price. Are you sure?')) {
      return;
    }

    setPanicSelling(true);
    try {
      const res = await fetch(`/api/ai/session/${urlSessionId}/panic-sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (res.ok) {
        const soldCount = data.results?.length || 0;
        addAlert(
          'warning',
          'PANIC SELL Executed',
          `Closed ${soldCount} position(s) at market price`
        );
        // Refresh positions
        fetchPositions();
        fetchAccount();
      } else {
        addAlert('error', 'Panic Sell Failed', data.error || 'Unknown error');
      }
    } catch (err) {
      setError(err.message);
      addAlert('error', 'Panic Sell Failed', err.message);
    } finally {
      setPanicSelling(false);
    }
  };

  const fetchChartData = async symbol => {
    try {
      const res = await fetch(`/api/indicators/${symbol}`);
      const data = await res.json();

      if (res.ok) {
        setChartData(data.candles || []);
        setChartIndicators(data.indicators || {});
        setChartSymbol(symbol);
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
    }
  };

  const selectPosition = position => {
    setSelectedPosition(position);
    fetchChartData(position.symbol);
  };

  const closePosition = async symbol => {
    try {
      // Use session's trading mode for the close position call
      const mode = config.paperTradeOnly === false ? 'live' : 'paper';
      const res = await fetch(`/api/alpaca/positions/${symbol}?mode=${mode}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        addAlert(
          'success',
          'Position Closed',
          `Closed position in ${symbol} (${mode.toUpperCase()})`
        );
        fetchPositions();
      }
    } catch (err) {
      addAlert('error', 'Close Failed', err.message);
    }
  };

  const updateConfig = (key, value) => {
    // Mark as editing to prevent auto-refresh from overwriting changes
    // Update both state and ref - ref is used by interval callbacks
    setIsEditingConfig(true);
    isEditingConfigRef.current = true;

    // Clear any existing timeout
    if (configEditTimeoutRef.current) {
      clearTimeout(configEditTimeoutRef.current);
    }

    // Set a timeout to reset editing flag after 60 seconds of no changes (increased from 30)
    configEditTimeoutRef.current = setTimeout(() => {
      setIsEditingConfig(false);
      isEditingConfigRef.current = false;
    }, 60000);

    // Use context to update config (auto-saves to localStorage)
    contextUpdateConfig({ [key]: value });

    // Immediately sync critical settings to backend if we have an active session
    // These settings affect live trading decisions and should update immediately
    const criticalSettings = [
      'autoTrade',
      'minConfidence',
      'watchlist',
      'maxPositions',
      // Exit protection settings - critical for preventing premature exits
      'stopLossPercent',
      'takeProfitPercent',
      'trailingStopPercent',
      'trailingStopMinProfitPercent',
      'minProfitForExitPercent',
      'minHoldMinutes',
    ];
    if (urlSessionId && criticalSettings.includes(key)) {
      fetch(`/api/ai/session/${urlSessionId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
        .then(res => {
          if (res.ok) {
            console.log(`[Config] Synced ${key}=${value} to server`);
          }
        })
        .catch(err => console.error('[Config] Sync failed:', err));
    }
  };

  // Load a saved config from localStorage (from simulator ConfigPanel)
  const loadSavedConfig = configName => {
    const loaded = savedConfigs[configName];
    if (loaded) {
      // Apply all fields from the saved config EXCEPT 'name' and 'allocatedCapital'
      // - 'name': preserve session name
      // - 'allocatedCapital': should be based on the selected account's available cash, not saved config
      Object.entries(loaded).forEach(([key, value]) => {
        if (key === 'name' || key === 'allocatedCapital') return;
        contextUpdateConfig({ [key]: value });
      });
      addAlert(
        'success',
        'Config Loaded',
        `Loaded "${configName}" configuration (capital unchanged)`
      );
      setShowLoadConfigDropdown(false);
    }
  };

  // Refresh saved configs from localStorage
  const refreshSavedConfigs = () => {
    try {
      const configs = JSON.parse(
        localStorage.getItem('saved-trading-configs') || '{}'
      );
      setSavedConfigs(configs);
    } catch (e) {
      console.error('Failed to load saved configs:', e);
    }
  };

  const saveConfig = async () => {
    // Clear editing flag when saving
    setIsEditingConfig(false);
    isEditingConfigRef.current = false;
    if (configEditTimeoutRef.current) {
      clearTimeout(configEditTimeoutRef.current);
    }

    if (!urlSessionId) {
      // No active session, just save to localStorage (already happens automatically)
      addAlert(
        'success',
        'Config Saved',
        'Configuration saved (will be used for new sessions)'
      );
      setShowConfig(false);
      return;
    }

    try {
      // Exclude 'name' from config updates - session name should only be set explicitly,
      // not overwritten by config syncs (which may contain stale names from localStorage)
      const { name: _excludedName, ...configWithoutName } = config;
      const res = await fetch(`/api/ai/session/${urlSessionId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configWithoutName),
      });

      if (res.ok) {
        addAlert('success', 'Config Saved', 'Trading configuration updated');
        socket?.emit('update_config', { sessionId: urlSessionId, config: configWithoutName });
        setShowConfig(false);
      }
    } catch (err) {
      addAlert('error', 'Save Failed', err.message);
    }
  };

  const getStatusColor = () => {
    switch (sessionStatus) {
      case 'running':
        return theme.colors.success;
      case 'paused':
        return theme.colors.warning;
      default:
        return theme.colors.gray400;
    }
  };

  const formatCurrency = value => {
    if (value === undefined || value === null) return '$0.00';
    const num = parseFloat(value);
    if (isNaN(num)) return '$0.00';
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = value => {
    if (value === undefined || value === null) return '0.00%';
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00%';
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
  };

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.lg,
        }}
      >
        <div>
          {!isMultiSessionMode && (
            <Link
              to="/live-trading"
              style={{
                color: theme.colors.gray500,
                fontSize: theme.typography.fontSize.sm,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginBottom: theme.spacing.xs,
              }}
            >
              ← Back to Sessions
            </Link>
          )}
          <h1 style={{ margin: 0, fontSize: theme.typography.fontSize.xxl }}>
            {sessionName || 'New Session'}
          </h1>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              marginTop: theme.spacing.xs,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: getStatusColor(),
                animation:
                  sessionStatus === 'running' ? 'pulse 2s infinite' : 'none',
              }}
            />
            <span
              style={{
                color: theme.colors.gray600,
                textTransform: 'capitalize',
              }}
            >
              {sessionStatus}
            </span>
            {isConnected && (
              <span
                style={{
                  color: theme.colors.success,
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                Connected
              </span>
            )}
            {urlSessionId && (
              <span
                style={{
                  color: theme.colors.gray400,
                  fontSize: theme.typography.fontSize.xs,
                  fontFamily: 'monospace',
                }}
              >
                {urlSessionId.slice(0, 8)}...
              </span>
            )}
            {/* Paper/Live Trading Mode Indicator */}
            {!config.paperTradeOnly && (
              <span
                style={{
                  backgroundColor: '#dc2626',
                  color: 'white',
                  fontSize: theme.typography.fontSize.xs,
                  fontWeight: 'bold',
                  padding: '2px 8px',
                  borderRadius: theme.borderRadius.sm,
                  marginLeft: theme.spacing.sm,
                  animation: 'pulse 2s infinite',
                  textTransform: 'uppercase',
                }}
              >
                LIVE TRADING
              </span>
            )}
            {/* Asset Type Indicator */}
            <span
              style={{
                backgroundColor: config.assetType === 'crypto'
                  ? theme.colors.info
                  : theme.colors.gray500,
                color: 'white',
                fontSize: theme.typography.fontSize.xs,
                fontWeight: 'bold',
                padding: '2px 8px',
                borderRadius: theme.borderRadius.sm,
                marginLeft: theme.spacing.sm,
                textTransform: 'uppercase',
              }}
            >
              {config.assetType === 'crypto' ? 'CRYPTO' : 'STOCKS'}
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: theme.spacing.sm,
            alignItems: 'center',
          }}
        >
          {/* Audio Toggle Button */}
          <Button
            variant={audioSettings.enabled ? 'primary' : 'outline'}
            onClick={() => {
              const newSettings = {
                ...audioSettings,
                enabled: !audioSettings.enabled,
              };
              setAudioSettings(newSettings);
              saveAudioSettings(newSettings);
              if (newSettings.enabled) {
                testAudioSystem();
              }
            }}
            style={{
              backgroundColor: audioSettings.enabled
                ? theme.colors.success
                : 'transparent',
              borderColor: audioSettings.enabled
                ? theme.colors.success
                : theme.colors.gray400,
              color: audioSettings.enabled ? '#fff' : theme.colors.gray600,
              minWidth: 'auto',
              padding: `${theme.spacing.sm} ${theme.spacing.md}`,
            }}
            title={
              audioSettings.enabled
                ? 'Audio alerts ON - Click to mute'
                : 'Audio alerts OFF - Click to enable'
            }
          >
            {audioSettings.enabled ? '🔊' : '🔇'}
          </Button>

          {/* Simulate Trading Button */}
          <Button
            variant={showSimulator ? 'primary' : 'outline'}
            onClick={() => setShowSimulator(!showSimulator)}
            style={{
              backgroundColor: showSimulator
                ? theme.colors.info
                : 'transparent',
              borderColor: theme.colors.info,
              color: showSimulator ? '#fff' : theme.colors.info,
            }}
          >
            {showSimulator ? 'Hide Simulator' : 'Simulate Trading'}
          </Button>

          {/* Experimental Analysis Toggle */}
          <Button
            variant="ghost"
            onClick={toggleExperimentalPanels}
            style={{
              backgroundColor: showExperimentalPanels
                ? '#fef3c7'
                : 'transparent',
              borderColor: showExperimentalPanels
                ? '#f59e0b'
                : theme.colors.gray300,
              color: showExperimentalPanels ? '#b45309' : theme.colors.gray500,
              fontSize: theme.typography.fontSize.sm,
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              minWidth: 'auto',
            }}
            title="Toggle experimental analysis panels (Market Regime & Leveraged ETF)"
          >
            🧪 {showExperimentalPanels ? 'ON' : 'OFF'}
          </Button>

          {/* Session controls - based on current status */}
          {urlSessionId && sessionStatus === 'stopped' && (
            <Button variant="primary" onClick={startTrading} disabled={loading}>
              {loading ? 'Starting...' : 'Start Trading'}
            </Button>
          )}
          {urlSessionId && sessionStatus === 'running' && (
            <>
              <Button variant="outline" onClick={pauseTrading}>
                Pause
              </Button>
              <Button variant="danger" onClick={stopTrading}>
                Stop
              </Button>
              <Button
                variant="danger"
                onClick={panicSell}
                disabled={panicSelling}
                style={{
                  backgroundColor: '#7f1d1d',
                  borderColor: '#991b1b',
                  fontWeight: 'bold',
                }}
                title="Emergency: Immediately sell ALL positions at market price"
              >
                {panicSelling ? 'Selling...' : 'PANIC SELL'}
              </Button>
            </>
          )}
          {urlSessionId && sessionStatus === 'paused' && (
            <>
              <Button variant="primary" onClick={resumeTrading}>
                Resume
              </Button>
              <Button variant="danger" onClick={stopTrading}>
                Stop
              </Button>
              <Button
                variant="danger"
                onClick={panicSell}
                disabled={panicSelling}
                style={{
                  backgroundColor: '#7f1d1d',
                  borderColor: '#991b1b',
                  fontWeight: 'bold',
                }}
                title="Emergency: Immediately sell ALL positions at market price"
              >
                {panicSelling ? 'Selling...' : 'PANIC SELL'}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => setShowSummary(true)}
            title="View session summary"
          >
            Summary
          </Button>
          <Button variant="ghost" onClick={() => setShowConfig(!showConfig)}>
            Config
          </Button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: theme.spacing.md,
            backgroundColor: theme.colors.error + '20',
            border: `1px solid ${theme.colors.error}`,
            borderRadius: theme.borderRadius.md,
            marginBottom: theme.spacing.md,
            color: theme.colors.error,
          }}
        >
          {error}
        </div>
      )}

      {/* Empty Watchlist Warning Banner - Always visible when watchlist is empty and session is running */}
      {config.watchlist.length === 0 &&
        sessionStatus === 'running' &&
        !showConfig && (
          <Card
            style={{
              marginBottom: theme.spacing.lg,
              padding: theme.spacing.md,
              backgroundColor: `${theme.colors.warning}15`,
              border: `2px solid ${theme.colors.warning}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.md,
              }}
            >
              <span style={{ fontSize: '28px' }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <h4
                  style={{
                    margin: 0,
                    color: theme.colors.warning,
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  No Symbols in Watchlist - Trading Disabled
                </h4>
                <p
                  style={{
                    margin: 0,
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.gray600,
                  }}
                >
                  Your trading session is running but has no symbols to analyze.
                  Add symbols to the watchlist to enable trading.
                </p>
              </div>
              <Button
                variant="warning"
                size="small"
                onClick={() => setShowConfig(true)}
              >
                Configure Watchlist
              </Button>
            </div>
          </Card>
        )}

      {/* Configuration Panel - Enhanced */}
      {showConfig && (
        <Card
          style={{ marginBottom: theme.spacing.lg, padding: theme.spacing.lg }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: theme.spacing.md,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.md,
              }}
            >
              <h3 style={{ margin: 0 }}>Trading Configuration</h3>
              {isEditingConfig && (
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.warning,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    backgroundColor: `${theme.colors.warning}15`,
                    border: `1px solid ${theme.colors.warning}30`,
                  }}
                >
                  Auto-refresh paused while editing
                </span>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                gap: theme.spacing.sm,
                alignItems: 'center',
              }}
            >
              {/* Load Config Dropdown */}
              <div style={{ position: 'relative' }}>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    refreshSavedConfigs();
                    setShowLoadConfigDropdown(!showLoadConfigDropdown);
                  }}
                >
                  Load Config
                </Button>
                {showLoadConfigDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: theme.spacing.xs,
                      backgroundColor: '#fff',
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.md,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      zIndex: 100,
                      minWidth: '200px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                    }}
                  >
                    {Object.keys(savedConfigs).length === 0 ? (
                      <div
                        style={{
                          padding: theme.spacing.md,
                          color: theme.colors.gray500,
                          fontSize: theme.typography.fontSize.sm,
                        }}
                      >
                        No saved configs found. Save a config from the Simulator
                        to import it here.
                      </div>
                    ) : (
                      Object.keys(savedConfigs).map(name => (
                        <button
                          key={name}
                          onClick={() => loadSavedConfig(name)}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: theme.spacing.sm,
                            border: 'none',
                            background: 'transparent',
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontSize: theme.typography.fontSize.sm,
                          }}
                          onMouseEnter={e =>
                            (e.target.style.backgroundColor =
                              theme.colors.gray100)
                          }
                          onMouseLeave={e =>
                            (e.target.style.backgroundColor = 'transparent')
                          }
                        >
                          {name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <Button onClick={saveConfig} size="small">
                Save Configuration
              </Button>
              <Button
                variant="ghost"
                size="small"
                onClick={() => setShowConfig(false)}
              >
                Cancel
              </Button>
            </div>
          </div>

          {/* Empty Watchlist Warning */}
          {config.watchlist.length === 0 && (
            <div
              style={{
                marginBottom: theme.spacing.md,
                padding: theme.spacing.md,
                backgroundColor: `${theme.colors.error}10`,
                borderRadius: theme.borderRadius.md,
                border: `1px solid ${theme.colors.error}30`,
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.sm,
              }}
            >
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div>
                <strong style={{ color: theme.colors.error }}>
                  No symbols in watchlist!
                </strong>
                <p
                  style={{
                    margin: 0,
                    marginTop: '4px',
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.gray600,
                  }}
                >
                  Add symbols below to enable trading. Without a watchlist, the
                  AI has no stocks to analyze.
                </p>
              </div>
            </div>
          )}

          {/* Simplified Config Panel */}
          <TradingConfigPanel
            config={config}
            onUpdateConfig={contextUpdateConfig}
          />

          {/* CAPITAL ALLOCATION SECTION - REMOVED */}
          {configSection === 'capital' && (
            <div>
              <div
                style={{
                  marginBottom: theme.spacing.lg,
                  padding: theme.spacing.md,
                  backgroundColor: `${theme.colors.info}10`,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.info}30`,
                }}
              >
                <h4
                  style={{
                    margin: 0,
                    marginBottom: theme.spacing.xs,
                    color: theme.colors.info,
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  Capital Summary
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      padding: '2px 8px',
                      borderRadius: theme.borderRadius.sm,
                      backgroundColor: config.paperTradeOnly
                        ? theme.colors.warning
                        : theme.colors.error,
                      color: '#fff',
                    }}
                  >
                    {config.paperTradeOnly ? 'PAPER' : 'LIVE'}
                  </span>
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      padding: '2px 8px',
                      borderRadius: theme.borderRadius.sm,
                      backgroundColor: config.assetType === 'crypto'
                        ? theme.colors.info
                        : theme.colors.gray500,
                      color: '#fff',
                    }}
                  >
                    {config.assetType === 'crypto' ? 'CRYPTO' : 'STOCKS'}
                  </span>
                  {account && (
                    <span
                      style={{
                        fontSize: theme.typography.fontSize.sm,
                        color: theme.colors.gray500,
                        fontWeight: 'normal',
                      }}
                    >
                      (Account: $
                      {parseFloat(account.cash || 0).toLocaleString()}{' '}
                      available)
                    </span>
                  )}
                </h4>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: theme.spacing.md,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray500,
                      }}
                    >
                      Allocated Capital
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xl,
                        fontWeight: theme.typography.fontWeight.bold,
                      }}
                    >
                      ${config.allocatedCapital.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray500,
                      }}
                    >
                      With Leverage ({config.maxLeverage}x)
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xl,
                        fontWeight: theme.typography.fontWeight.bold,
                      }}
                    >
                      $
                      {(
                        config.allocatedCapital * config.maxLeverage
                      ).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray500,
                      }}
                    >
                      Deployable ({100 - config.reserveCashPercent}%)
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xl,
                        fontWeight: theme.typography.fontWeight.bold,
                      }}
                    >
                      $
                      {(
                        config.allocatedCapital *
                        config.maxLeverage *
                        (1 - config.reserveCashPercent / 100)
                      ).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray500,
                      }}
                    >
                      Max Per Position
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xl,
                        fontWeight: theme.typography.fontWeight.bold,
                      }}
                    >
                      $
                      {Math.min(
                        config.maxPositionSize,
                        (config.allocatedCapital *
                          config.maxPositionSizePercent) /
                          100
                      ).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: theme.spacing.md,
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Allocated Capital ($)
                  </label>
                  <input
                    type="number"
                    min="1000"
                    max="10000000"
                    step="1000"
                    value={config.allocatedCapital}
                    onChange={e =>
                      updateConfig(
                        'allocatedCapital',
                        parseInt(e.target.value) || 0
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Total capital for AI trading
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Max Leverage
                  </label>
                  <select
                    value={config.maxLeverage}
                    onChange={e =>
                      updateConfig('maxLeverage', parseFloat(e.target.value))
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  >
                    <option value={1.0}>1x (No Leverage)</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2.0}>2x</option>
                    <option value={3.0}>3x</option>
                    <option value={4.0}>4x (Aggressive)</option>
                  </select>
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color:
                        config.maxLeverage > 2
                          ? theme.colors.error
                          : theme.colors.gray500,
                    }}
                  >
                    {config.maxLeverage > 2
                      ? '⚠️ High leverage increases risk'
                      : 'Buying power multiplier'}
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Cash Reserve %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={config.reserveCashPercent}
                    onChange={e =>
                      updateConfig(
                        'reserveCashPercent',
                        parseInt(e.target.value) || 0
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Keep as emergency cash
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Max Positions
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={config.maxPositions}
                    onChange={e =>
                      updateConfig('maxPositions', parseInt(e.target.value))
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Concurrent open positions
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Max Position Size %
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={config.maxPositionSizePercent}
                    onChange={e =>
                      updateConfig(
                        'maxPositionSizePercent',
                        parseInt(e.target.value)
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Max % of capital per position
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Max Position Size ($)
                  </label>
                  <div
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      backgroundColor: theme.colors.gray100,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                      fontWeight: theme.typography.fontWeight.semibold,
                      color: theme.colors.gray700,
                    }}
                  >
                    $
                    {Math.floor(
                      config.allocatedCapital *
                        (config.maxPositionSizePercent / 100)
                    ).toLocaleString()}
                  </div>
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Calculated: {config.maxPositionSizePercent}% of $
                    {config.allocatedCapital.toLocaleString()}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: theme.spacing.lg }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: theme.spacing.xs,
                    fontWeight: theme.typography.fontWeight.medium,
                    fontSize: theme.typography.fontSize.sm,
                  }}
                >
                  Watchlist
                </label>

                {/* Preset Watchlist Dropdown */}
                <div style={{ marginBottom: theme.spacing.sm }}>
                  <select
                    onChange={e => {
                      const presetId = e.target.value;
                      if (presetId) {
                        const preset = getStockList(presetId);
                        if (preset && preset.stocks) {
                          contextUpdateConfig({ watchlist: preset.stocks });
                        }
                      }
                    }}
                    value=""
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.sm,
                      backgroundColor: theme.colors.surface,
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">Select preset watchlist...</option>
                    {getStockListNames().map(list => (
                      <option key={list.id} value={list.id}>
                        {list.name} ({list.count} stocks)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Manual Edit Input */}
                <input
                  type="text"
                  defaultValue={config.watchlist.join(', ')}
                  key={isEditingConfig ? 'editing' : config.watchlist.join(',')}
                  placeholder="Or enter symbols manually: AAPL, TSLA, NVDA..."
                  onFocus={() => {
                    setIsEditingConfig(true);
                    isEditingConfigRef.current = true;
                  }}
                  onBlur={e => {
                    // Parse and update watchlist on blur
                    const newWatchlist = e.target.value
                      .split(',')
                      .map(s => s.trim().toUpperCase())
                      .filter(s => s);
                    contextUpdateConfig({ watchlist: newWatchlist });
                    // Keep editing flag for a bit longer to allow saves
                    setTimeout(() => {
                      setIsEditingConfig(false);
                      isEditingConfigRef.current = false;
                    }, 2000);
                  }}
                  onChange={e => {
                    // Keep editing flag active while typing
                    setIsEditingConfig(true);
                    isEditingConfigRef.current = true;
                    if (configEditTimeoutRef.current)
                      clearTimeout(configEditTimeoutRef.current);
                    configEditTimeoutRef.current = setTimeout(() => {
                      setIsEditingConfig(false);
                      isEditingConfigRef.current = false;
                    }, 60000);
                  }}
                  style={{
                    width: '100%',
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.gray300}`,
                    borderRadius: theme.borderRadius.sm,
                    fontSize: theme.typography.fontSize.md,
                  }}
                />
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.gray500,
                  }}
                >
                  Symbols to monitor: {config.watchlist.length} stocks
                </span>
              </div>
            </div>
          )}

          {/* RISK MANAGEMENT SECTION */}
          {configSection === 'risk' && (
            <div>
              <div
                style={{
                  marginBottom: theme.spacing.lg,
                  padding: theme.spacing.md,
                  backgroundColor: `${theme.colors.warning}10`,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.warning}30`,
                }}
              >
                <h4
                  style={{
                    margin: 0,
                    marginBottom: theme.spacing.xs,
                    color: theme.colors.warning,
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  Risk Profile
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      padding: '2px 8px',
                      borderRadius: theme.borderRadius.sm,
                      backgroundColor: config.paperTradeOnly
                        ? theme.colors.warning
                        : theme.colors.error,
                      color: '#fff',
                    }}
                  >
                    {config.paperTradeOnly ? 'PAPER' : 'LIVE'}
                  </span>
                </h4>
                <p
                  style={{
                    margin: 0,
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.gray600,
                  }}
                >
                  Max risk per trade: $
                  {(
                    (config.allocatedCapital * config.riskPerTradePercent) /
                    100
                  ).toLocaleString()}{' '}
                  | Daily stop: $
                  {(
                    (config.allocatedCapital * config.dailyLossLimitPercent) /
                    100
                  ).toLocaleString()}{' '}
                  | Weekly stop: $
                  {(
                    (config.allocatedCapital * config.weeklyLossLimitPercent) /
                    100
                  ).toLocaleString()}
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: theme.spacing.md,
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Risk Per Trade %
                  </label>
                  <input
                    type="number"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={config.riskPerTradePercent}
                    onChange={e =>
                      updateConfig(
                        'riskPerTradePercent',
                        parseFloat(e.target.value)
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Max loss per trade
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Daily Loss Limit %
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={config.dailyLossLimitPercent}
                    onChange={e =>
                      updateConfig(
                        'dailyLossLimitPercent',
                        parseInt(e.target.value)
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Stop trading for day
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Weekly Loss Limit %
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={config.weeklyLossLimitPercent}
                    onChange={e =>
                      updateConfig(
                        'weeklyLossLimitPercent',
                        parseInt(e.target.value)
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Stop trading for week
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Max Consecutive Losses
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={config.maxConsecutiveLosses}
                    onChange={e =>
                      updateConfig(
                        'maxConsecutiveLosses',
                        parseInt(e.target.value)
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Pause after X losses in a row
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Trailing Stop (% of TP)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="10"
                    value={config.trailingStopPercent}
                    onChange={e =>
                      updateConfig(
                        'trailingStopPercent',
                        parseFloat(e.target.value)
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    0 = disabled
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={config.paperTradeOnly}
                      onChange={e =>
                        updateConfig('paperTradeOnly', e.target.checked)
                      }
                    />
                    <span
                      style={{
                        fontWeight: theme.typography.fontWeight.medium,
                        color: config.paperTradeOnly
                          ? theme.colors.success
                          : theme.colors.error,
                      }}
                    >
                      Paper Trading Only
                    </span>
                  </label>
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                      marginTop: '4px',
                    }}
                  >
                    {config.paperTradeOnly
                      ? '✅ Safe mode - no real money'
                      : '⚠️ Real trading enabled!'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* AI MODEL PARAMETERS SECTION */}
          {configSection === 'ai' && (
            <div>
              <div
                style={{
                  marginBottom: theme.spacing.lg,
                  padding: theme.spacing.md,
                  backgroundColor: `${theme.colors.primary}10`,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.primary}30`,
                }}
              >
                <h4
                  style={{
                    margin: 0,
                    marginBottom: theme.spacing.xs,
                    color: theme.colors.primary,
                  }}
                >
                  AI Signal Thresholds
                </h4>
                <p
                  style={{
                    margin: 0,
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.gray600,
                  }}
                >
                  Fine-tune how the AI model evaluates trading opportunities
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: theme.spacing.md,
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Min Confidence %
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="95"
                    value={config.minConfidence}
                    onChange={e =>
                      updateConfig('minConfidence', parseInt(e.target.value))
                    }
                    style={{ width: '100%' }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    <span>50% (More trades)</span>
                    <span
                      style={{
                        fontWeight: theme.typography.fontWeight.bold,
                        color: theme.colors.primary,
                      }}
                    >
                      {config.minConfidence}%
                    </span>
                    <span>95% (Fewer trades)</span>
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    RSI Oversold Level
                  </label>
                  <input
                    type="number"
                    min="20"
                    max="40"
                    value={config.rsiOversold}
                    onChange={e =>
                      updateConfig('rsiOversold', parseInt(e.target.value))
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.success,
                    }}
                  >
                    Buy signal when RSI &lt; {config.rsiOversold}
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    RSI Overbought Level
                  </label>
                  <input
                    type="number"
                    min="60"
                    max="80"
                    value={config.rsiOverbought}
                    onChange={e =>
                      updateConfig('rsiOverbought', parseInt(e.target.value))
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.error,
                    }}
                  >
                    Sell signal when RSI &gt; {config.rsiOverbought}
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    VWAP Deviation %
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    max="2"
                    step="0.1"
                    value={config.vwapDeviationPercent}
                    onChange={e =>
                      updateConfig(
                        'vwapDeviationPercent',
                        parseFloat(e.target.value)
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Entry when price deviates from VWAP
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Volume Multiplier
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="3"
                    step="0.1"
                    value={config.volumeMultiplier}
                    onChange={e =>
                      updateConfig(
                        'volumeMultiplier',
                        parseFloat(e.target.value)
                      )
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Entry on volume &gt; {config.volumeMultiplier}x average
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    ADX Min Strength
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="40"
                    value={config.adxMinStrength}
                    onChange={e =>
                      updateConfig('adxMinStrength', parseInt(e.target.value))
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  />
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Minimum trend strength
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      marginBottom: theme.spacing.xs,
                      fontWeight: theme.typography.fontWeight.medium,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    MACD Sensitivity
                  </label>
                  <select
                    value={config.macdSensitivity}
                    onChange={e =>
                      updateConfig('macdSensitivity', e.target.value)
                    }
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.md,
                    }}
                  >
                    <option value="conservative">
                      Conservative (fewer signals)
                    </option>
                    <option value="normal">Normal</option>
                    <option value="aggressive">
                      Aggressive (more signals)
                    </option>
                  </select>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: theme.spacing.sm,
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={config.patternRecognition}
                      onChange={e =>
                        updateConfig('patternRecognition', e.target.checked)
                      }
                    />
                    <span
                      style={{ fontWeight: theme.typography.fontWeight.medium }}
                    >
                      ML Pattern Recognition
                    </span>
                  </label>
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    {config.patternRecognition
                      ? 'Using TensorFlow.js CNN model'
                      : 'Pattern detection disabled'}
                  </span>
                </div>
              </div>
            </div>
          )}

        </Card>
      )}

      {/* Trading Day Simulator - Shows when enabled */}
      {showSimulator && (
        <TradingSimulator
          onComplete={results => {
            // Optionally handle simulation results
            console.log('Simulation completed:', results);
          }}
          onDateChange={setSimulationDate}
          onSymbolChange={setSimulationSymbol}
          initialSymbol={
            leveragedEtfEnabled && lockedSymbols ? lockedSymbols[0] : undefined
          }
          lockedSymbols={lockedSymbols}
        />
      )}

      {/* Experimental Analysis Panels - Only when enabled via header button */}
      {showExperimentalPanels && (
        <div
          style={{
            marginBottom: theme.spacing.md,
            padding: theme.spacing.md,
            backgroundColor: '#fffbeb',
            borderRadius: theme.borderRadius.lg,
            border: '1px solid #fde047',
          }}
        >
          {/* Header with Research Symbol Input */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: theme.spacing.md,
              paddingBottom: theme.spacing.sm,
              borderBottom: '1px solid #fde047',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.md,
              }}
            >
              <span
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: '#92400e',
                  fontWeight: 'bold',
                }}
              >
                🧪 Research Symbol
              </span>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                }}
              >
                <input
                  type="text"
                  value={researchSymbol}
                  onChange={e =>
                    setResearchSymbol(e.target.value.toUpperCase())
                  }
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.target.blur();
                    }
                  }}
                  disabled={syncResearchWithChart}
                  style={{
                    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                    fontSize: theme.typography.fontSize.md,
                    fontWeight: 'bold',
                    width: '80px',
                    border: `2px solid ${syncResearchWithChart ? theme.colors.gray300 : '#f59e0b'}`,
                    borderRadius: theme.borderRadius.md,
                    backgroundColor: syncResearchWithChart
                      ? theme.colors.gray100
                      : 'white',
                    color: syncResearchWithChart
                      ? theme.colors.textMuted
                      : theme.colors.text,
                    textAlign: 'center',
                    textTransform: 'uppercase',
                  }}
                  placeholder="QBTS"
                />
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.textMuted,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={syncResearchWithChart}
                  onChange={e => setSyncResearchWithChart(e.target.checked)}
                  style={{ width: '14px', height: '14px' }}
                />
                Sync with chart
              </label>
            </div>
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: '#92400e',
              }}
            >
              Informational only - does not affect trading signals
            </span>
          </div>

          {/* Signal Checklist + Detail Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '280px 1fr',
              gap: theme.spacing.md,
            }}
          >
            {/* Signal Checklist - Left Column */}
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: theme.borderRadius.md,
                padding: theme.spacing.md,
                border: '1px solid #e5e7eb',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  fontWeight: 'bold',
                  marginBottom: theme.spacing.sm,
                  color: theme.colors.text,
                }}
              >
                📊 Signal Checklist
              </div>
              {/* Regime Signal */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: theme.spacing.xs,
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <span style={{ fontSize: theme.typography.fontSize.sm }}>
                  Technical Regime
                </span>
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    backgroundColor:
                      signalData.regime?.regime === 'bull'
                        ? '#dcfce7'
                        : signalData.regime?.regime === 'bear'
                          ? '#fee2e2'
                          : signalData.regime
                            ? '#fef9c3'
                            : '#f3f4f6',
                    color:
                      signalData.regime?.regime === 'bull'
                        ? '#166534'
                        : signalData.regime?.regime === 'bear'
                          ? '#991b1b'
                          : signalData.regime
                            ? '#854d0e'
                            : '#6b7280',
                  }}
                >
                  {signalData.regime?.regime === 'bull'
                    ? '✅ BULL'
                    : signalData.regime?.regime === 'bear'
                      ? '❌ BEAR'
                      : signalData.regime?.regime === 'sideways'
                        ? '⚠️ SIDEWAYS'
                        : '⏳ Loading'}
                </span>
              </div>
              {/* CheddarFlow Signal */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: theme.spacing.xs,
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <span style={{ fontSize: theme.typography.fontSize.sm }}>
                  CheddarFlow
                </span>
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    backgroundColor:
                      signalData.flow?.sentiment === 'bullish'
                        ? '#dcfce7'
                        : signalData.flow?.sentiment === 'bearish'
                          ? '#fee2e2'
                          : signalData.flow
                            ? '#fef9c3'
                            : '#f3f4f6',
                    color:
                      signalData.flow?.sentiment === 'bullish'
                        ? '#166534'
                        : signalData.flow?.sentiment === 'bearish'
                          ? '#991b1b'
                          : signalData.flow
                            ? '#854d0e'
                            : '#6b7280',
                  }}
                >
                  {signalData.flow?.sentiment === 'bullish'
                    ? '✅ Bullish'
                    : signalData.flow?.sentiment === 'bearish'
                      ? '❌ Bearish'
                      : signalData.flow?.sentiment === 'neutral'
                        ? '⚠️ Neutral'
                        : '⏳ Loading'}
                </span>
              </div>
              {/* Market Tide Signal */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: theme.spacing.xs,
                  borderBottom: '1px solid #f3f4f6',
                }}
              >
                <span style={{ fontSize: theme.typography.fontSize.sm }}>
                  Market Tide (UW)
                </span>
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    backgroundColor:
                      signalData.marketTide?.sentiment === 'bullish'
                        ? '#dcfce7'
                        : signalData.marketTide?.sentiment === 'bearish'
                          ? '#fee2e2'
                          : signalData.marketTide
                            ? '#fef9c3'
                            : '#f3f4f6',
                    color:
                      signalData.marketTide?.sentiment === 'bullish'
                        ? '#166534'
                        : signalData.marketTide?.sentiment === 'bearish'
                          ? '#991b1b'
                          : signalData.marketTide
                            ? '#854d0e'
                            : '#6b7280',
                  }}
                >
                  {signalData.marketTide?.sentiment === 'bullish'
                    ? '✅ Bullish'
                    : signalData.marketTide?.sentiment === 'bearish'
                      ? '❌ Bearish'
                      : signalData.marketTide?.configured === false
                        ? '🔑 No API Key'
                        : '⏳ Loading'}
                </span>
              </div>
              {/* Overall Summary */}
              <div
                style={{
                  marginTop: theme.spacing.sm,
                  padding: theme.spacing.sm,
                  backgroundColor: '#f9fafb',
                  borderRadius: theme.borderRadius.sm,
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.textMuted,
                    marginBottom: '4px',
                  }}
                >
                  Overall Sentiment
                </div>
                <div
                  style={{
                    fontSize: theme.typography.fontSize.lg,
                    fontWeight: 'bold',
                    color: (() => {
                      const signals = [
                        signalData.regime?.regime,
                        signalData.flow?.sentiment,
                        signalData.marketTide?.sentiment,
                      ];
                      const bullish = signals.filter(
                        s => s === 'bull' || s === 'bullish'
                      ).length;
                      const bearish = signals.filter(
                        s => s === 'bear' || s === 'bearish'
                      ).length;
                      const total = signals.filter(s => s).length;
                      if (total === 0) return theme.colors.textMuted;
                      if (bullish > bearish) return '#166534';
                      if (bearish > bullish) return '#991b1b';
                      return '#854d0e';
                    })(),
                  }}
                >
                  {(() => {
                    const signals = [
                      signalData.regime?.regime,
                      signalData.flow?.sentiment,
                      signalData.marketTide?.sentiment,
                    ];
                    const bullish = signals.filter(
                      s => s === 'bull' || s === 'bullish'
                    ).length;
                    const bearish = signals.filter(
                      s => s === 'bear' || s === 'bearish'
                    ).length;
                    const total = signals.filter(s => s).length;
                    if (total === 0) return 'Analyzing...';
                    return `${bullish}/${total} Bullish`;
                  })()}
                </div>
              </div>
            </div>

            {/* Detail Cards - Right Column */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: theme.spacing.md,
              }}
            >
              <ErrorBoundary message="Technical Regime unavailable">
                <TechnicalRegimeCard
                  symbol={researchSymbol}
                  date={syncResearchWithChart ? simulationDate : null}
                  onRegimeChange={data => {
                    setSignalData(prev => ({ ...prev, regime: data }));
                  }}
                />
              </ErrorBoundary>
              <ErrorBoundary message="CheddarFlow unavailable">
                <CheddarFlowCard
                  symbol={researchSymbol}
                  date={syncResearchWithChart ? simulationDate : null}
                  onSentimentChange={data => {
                    setSignalData(prev => ({ ...prev, flow: data }));
                  }}
                />
              </ErrorBoundary>
              <ErrorBoundary message="Market Tide unavailable">
                <MarketTideCard
                  onSentimentChange={data => {
                    setSignalData(prev => ({ ...prev, marketTide: data }));
                  }}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Tools Row - Monitor & Validator */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.md,
        }}
      >
        <ErrorBoundary message="Strategy Monitor unavailable">
          <StrategyMonitorPanel
            symbol={chartSymbol || config.watchlist?.[0] || 'AAPL'}
            versionId={'default'}
            sessionStats={
              urlSessionId
                ? {
                    winRate: stats.winRate,
                    totalPnL: stats.totalPnL,
                    totalTrades: stats.totalTrades,
                    consecutiveLosses: 0,
                    maxDrawdown: 0,
                    profitFactor:
                      stats.wins > 0
                        ? stats.wins / Math.max(1, stats.losses)
                        : 0,
                  }
                : null
            }
            onAlert={alertsList => {
              alertsList.forEach(alert => {
                addAlert({
                  type: 'warning',
                  title: 'Strategy Alert',
                  message: alert.message,
                });
              });
            }}
          />
        </ErrorBoundary>
        <ErrorBoundary message="Strategy Validator unavailable">
          <StrategyValidatorPanel
            symbol={simulationSymbol || chartSymbol}
            config={config}
          />
        </ErrorBoundary>
      </div>

      {/* Trading Log Panel - Diagnostics and debugging */}
      <ErrorBoundary message="Trading Log panel encountered an error. Trading continues normally.">
        <TradingLogPanel
          sessionId={urlSessionId}
          autoRefresh={sessionStatus === 'running'}
          refreshInterval={3000}
          defaultCollapsed={false}
        />
      </ErrorBoundary>

      {/* Performance Metrics - Connected to real account data */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.lg,
        }}
      >
        <MetricCard
          title="Account Equity"
          value={formatCurrency(account?.equity || account?.portfolio_value)}
          subtitle={
            account?.buying_power
              ? `Cash: ${formatCurrency(account.buying_power)}`
              : 'Loading...'
          }
        />
        <MetricCard
          title="Today's P&L"
          value={formatCurrency(
            account?.equity && account?.last_equity
              ? parseFloat(account.equity) - parseFloat(account.last_equity)
              : stats.totalPnL
          )}
          subtitle={
            account?.equity && account?.last_equity
              ? `${(((parseFloat(account.equity) - parseFloat(account.last_equity)) / parseFloat(account.last_equity)) * 100).toFixed(2)}% change`
              : 'vs yesterday close'
          }
          variant={
            (account?.equity && account?.last_equity
              ? parseFloat(account.equity) - parseFloat(account.last_equity)
              : stats.totalPnL) >= 0
              ? 'success'
              : 'error'
          }
        />
        <MetricCard
          title="Today's Orders"
          value={orderStats.todayOrders}
          subtitle={`${orderStats.todayBuys} buy / ${orderStats.todaySells} sell`}
          variant={orderStats.todayOrders > 0 ? 'info' : 'default'}
        />
        <MetricCard
          title="Pending Orders"
          value={orderStats.pendingOrders}
          subtitle={
            orderStats.pendingOrders > 0 ? 'Awaiting fill' : 'None queued'
          }
          variant={orderStats.pendingOrders > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          title="Open Positions"
          value={positions.length}
          subtitle={`Limit: ${config.maxPositions} max`}
          variant={
            positions.length >= config.maxPositions
              ? 'warning'
              : positions.length > 0
                ? 'info'
                : 'default'
          }
        />
        {urlSessionId && stats.totalTrades > 0 && (
          <MetricCard
            title="AI Session"
            value={`${stats.winRate || 0}%`}
            subtitle={`${stats.wins}W/${stats.losses}L (${stats.totalTrades} trades)`}
            variant={
              stats.winRate >= 50
                ? 'success'
                : stats.winRate > 0
                  ? 'warning'
                  : 'default'
            }
          />
        )}
      </div>

      {/* Main Content Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 350px',
          gap: theme.spacing.lg,
        }}
      >
        {/* Left Column - Chart and Positions */}
        <div>
          {/* Watchlist Panel - Quick overview of all stocks */}
          <WatchlistPanel
            watchlist={config.watchlist}
            onSelectSymbol={symbol => fetchChartData(symbol)}
            sessionStatus={sessionStatus}
            onReorderWatchlist={newWatchlist =>
              updateConfig('watchlist', newWatchlist)
            }
          />

          {/* Charts for all watchlist symbols - shows trades in real-time */}
          {urlSessionId && config.watchlist?.length > 0 && (
            <div style={{ marginTop: theme.spacing.md }}>
              <WatchlistCharts
                watchlist={config.watchlist}
                trades={recentTrades || []}
                positions={positions || []}
                height={300}
                refreshInterval={sessionStatus === 'running' ? 10000 : 60000}
                maxCharts={5}
              />
            </div>
          )}

          {/* Active Positions */}
          <Card style={{ marginTop: theme.spacing.lg }}>
            <h3 style={{ marginTop: 0 }}>Active Positions</h3>
            {positions.length === 0 ? (
              <p style={{ color: theme.colors.gray500 }}>
                No open positions. AI is monitoring {config.watchlist.length}{' '}
                stocks for opportunities.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr
                      style={{
                        borderBottom: `1px solid ${theme.colors.gray200}`,
                      }}
                    >
                      <th
                        style={{ textAlign: 'left', padding: theme.spacing.sm }}
                      >
                        Symbol
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: theme.spacing.sm,
                        }}
                      >
                        Qty
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: theme.spacing.sm,
                        }}
                      >
                        Avg Cost
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: theme.spacing.sm,
                        }}
                      >
                        Current
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: theme.spacing.sm,
                        }}
                      >
                        P&L
                      </th>
                      <th
                        style={{
                          textAlign: 'right',
                          padding: theme.spacing.sm,
                        }}
                      >
                        P&L %
                      </th>
                      <th
                        style={{
                          textAlign: 'center',
                          padding: theme.spacing.sm,
                        }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(positions) ? positions : []).map(pos => {
                      // Handle both camelCase (from alpacaClient) and snake_case (raw API) field names
                      const rawQty = pos.quantity || pos.qty;
                      // Detect if this is a crypto position (symbol contains USD or / like BTCUSD or BTC/USD)
                      const isCrypto = pos.symbol?.includes('USD') || pos.symbol?.includes('/') || pos.assetClass === 'crypto';
                      // Format qty: show 8 decimal places for crypto (fractional), whole numbers for stocks
                      const qty = isCrypto && rawQty < 1 ? rawQty.toFixed(8) : (Number.isInteger(rawQty) ? rawQty : rawQty.toFixed(4));
                      const avgPrice = pos.avgEntryPrice || pos.avg_entry_price;
                      const currentPrice =
                        pos.currentPrice || pos.current_price;
                      const unrealizedPL =
                        pos.unrealizedPL || pos.unrealized_pl;
                      // unrealizedPLPercent is already multiplied by 100 in alpacaClient, unrealized_plpc is decimal
                      const unrealizedPLPercent =
                        pos.unrealizedPLPercent !== undefined
                          ? pos.unrealizedPLPercent
                          : parseFloat(pos.unrealized_plpc || 0) * 100;
                      const isPositive = parseFloat(unrealizedPL) >= 0;

                      return (
                        <tr
                          key={pos.symbol}
                          onClick={() => selectPosition(pos)}
                          style={{
                            cursor: 'pointer',
                            backgroundColor:
                              selectedPosition?.symbol === pos.symbol
                                ? theme.colors.gray100
                                : 'transparent',
                            borderBottom: `1px solid ${theme.colors.gray100}`,
                          }}
                        >
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              fontWeight: theme.typography.fontWeight.bold,
                            }}
                          >
                            {pos.symbol}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              padding: theme.spacing.sm,
                            }}
                          >
                            {qty}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              padding: theme.spacing.sm,
                            }}
                          >
                            {formatCurrency(avgPrice)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              padding: theme.spacing.sm,
                            }}
                          >
                            {formatCurrency(currentPrice)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              padding: theme.spacing.sm,
                              color: isPositive
                                ? theme.colors.success
                                : theme.colors.error,
                            }}
                          >
                            {formatCurrency(unrealizedPL)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              padding: theme.spacing.sm,
                              color: isPositive
                                ? theme.colors.success
                                : theme.colors.error,
                            }}
                          >
                            {formatPercent(unrealizedPLPercent)}
                          </td>
                          <td
                            style={{
                              textAlign: 'center',
                              padding: theme.spacing.sm,
                            }}
                          >
                            <Button
                              size="small"
                              variant="danger"
                              onClick={e => {
                                e.stopPropagation();
                                closePosition(pos.symbol);
                              }}
                            >
                              Close
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right Column - AI Decisions and Alerts */}
        <div>
          {/* AI Decision Feed - Expanded height */}
          <Card style={{ marginBottom: theme.spacing.lg }}>
            <h3 style={{ marginTop: 0 }}>AI Decision Feed</h3>
            <div
              style={{
                height: 450,
                overflowY: 'auto',
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              {/* Filter to only show actionable decisions (shouldEnter=true or shouldExit=true) */}
              {decisions.filter(d => d.shouldEnter || d.shouldExit).length ===
              0 ? (
                <p style={{ color: theme.colors.gray500 }}>
                  No trade signals yet. AI is analyzing but waiting for entry
                  criteria to be met.
                </p>
              ) : (
                decisions
                  .filter(d => d.shouldEnter || d.shouldExit)
                  .map((decision, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: theme.spacing.sm,
                        marginBottom: theme.spacing.sm,
                        backgroundColor:
                          decision.action === 'BUY'
                            ? theme.colors.success + '10'
                            : decision.action === 'SELL'
                              ? theme.colors.error + '10'
                              : theme.colors.gray100,
                        borderRadius: theme.borderRadius.sm,
                        borderLeft: `3px solid ${
                          decision.action === 'BUY'
                            ? theme.colors.success
                            : decision.action === 'SELL'
                              ? theme.colors.error
                              : theme.colors.gray300
                        }`,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span
                          style={{
                            fontWeight: theme.typography.fontWeight.bold,
                          }}
                        >
                          {decision.symbol}
                        </span>
                        <span
                          style={{
                            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                            backgroundColor:
                              decision.action === 'BUY'
                                ? theme.colors.success
                                : decision.action === 'SELL'
                                  ? theme.colors.error
                                  : theme.colors.gray400,
                            color: '#fff',
                            borderRadius: theme.borderRadius.sm,
                            fontSize: theme.typography.fontSize.xs,
                          }}
                        >
                          {decision.action}
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: theme.spacing.xs,
                          color: theme.colors.gray600,
                        }}
                      >
                        Confidence: {decision.confidence}%
                      </div>
                      {decision.reasons && decision.reasons.length > 0 && (
                        <ul
                          style={{
                            margin: `${theme.spacing.xs} 0 0 0`,
                            paddingLeft: theme.spacing.md,
                            color: theme.colors.gray600,
                          }}
                        >
                          {decision.reasons.slice(0, 3).map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      )}
                      <div
                        style={{
                          marginTop: theme.spacing.xs,
                          fontSize: theme.typography.fontSize.xs,
                          color: theme.colors.gray400,
                        }}
                      >
                        {new Date(decision.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
              )}
              <div ref={decisionsEndRef} />
            </div>
          </Card>

          {/* Alerts */}
          <Card>
            <h3 style={{ marginTop: 0 }}>Alerts</h3>
            <div style={{ maxHeight: 250, overflowY: 'auto' }}>
              {alerts.length === 0 ? (
                <p style={{ color: theme.colors.gray500 }}>No alerts</p>
              ) : (
                alerts
                  .slice()
                  .reverse()
                  .map(alert => (
                    <div
                      key={alert.id}
                      style={{
                        padding: theme.spacing.sm,
                        marginBottom: theme.spacing.sm,
                        backgroundColor:
                          alert.type === 'error'
                            ? theme.colors.error + '10'
                            : alert.type === 'success'
                              ? theme.colors.success + '10'
                              : alert.type === 'warning'
                                ? theme.colors.warning + '10'
                                : theme.colors.info + '10',
                        borderRadius: theme.borderRadius.sm,
                        borderLeft: `3px solid ${
                          alert.type === 'error'
                            ? theme.colors.error
                            : alert.type === 'success'
                              ? theme.colors.success
                              : alert.type === 'warning'
                                ? theme.colors.warning
                                : theme.colors.info
                        }`,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: theme.typography.fontWeight.medium,
                        }}
                      >
                        {alert.title}
                      </div>
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.sm,
                          color: theme.colors.gray600,
                        }}
                      >
                        {alert.message}
                      </div>
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.xs,
                          color: theme.colors.gray400,
                          marginTop: theme.spacing.xs,
                        }}
                      >
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </Card>

          {/* Quick Stats */}
          <Card style={{ marginTop: theme.spacing.lg }}>
            <h3 style={{ marginTop: 0 }}>Market Status</h3>
            <div style={{ fontSize: theme.typography.fontSize.sm }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: theme.spacing.sm,
                }}
              >
                <span>Market Hours</span>
                <span style={{ color: theme.colors.gray600 }}>
                  9:30 AM - 4:00 PM ET
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: theme.spacing.sm,
                }}
              >
                <span>Watchlist</span>
                <span style={{ color: theme.colors.gray600 }}>
                  {config.watchlist.length} symbols
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Auto-Trade</span>
                <span
                  style={{
                    color: config.autoTrade
                      ? theme.colors.success
                      : theme.colors.gray400,
                  }}
                >
                  {config.autoTrade ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>

      {/* Session Summary Modal */}
      <TradingSessionSummary
        isOpen={showSummary}
        onClose={() => setShowSummary(false)}
        stats={stats}
        trades={recentTrades}
        positions={positions}
        sessionName={sessionName}
        decisions={decisions}
      />
    </div>
  );
};

// Animated value display - flashes when value changes
const AnimatedValue = ({ value, isAnimating, direction }) => {
  return (
    <span
      style={{
        display: 'inline-block',
        transition: 'all 0.2s ease',
        transform: isAnimating ? 'scale(1.05)' : 'scale(1)',
        opacity: isAnimating ? 0.8 : 1,
      }}
    >
      {value}
    </span>
  );
};

// Watchlist Panel Component - Split-Flap Display with real-time updates
const WatchlistPanel = ({
  watchlist,
  onSelectSymbol,
  sessionStatus,
  onReorderWatchlist,
}) => {
  const [stockData, setStockData] = useState({});
  const [prevStockData, setPrevStockData] = useState({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [animatingSymbols, setAnimatingSymbols] = useState(new Set());
  const [localWatchlist, setLocalWatchlist] = useState(watchlist);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Sync local watchlist with prop when it changes externally
  useEffect(() => {
    setLocalWatchlist(watchlist);
  }, [watchlist]);

  useEffect(() => {
    const fetchAllStocks = async (isInitial = false) => {
      if (isInitial) {
        setInitialLoading(true);
      }

      const data = {};
      const changed = new Set();

      // Fetch data for all watchlist symbols in parallel
      await Promise.all(
        localWatchlist.map(async symbol => {
          try {
            const res = await fetch(`/api/stock/analysis/${symbol}`);
            if (res.ok) {
              const result = await res.json();
              const newData = result.analysis || result;
              data[symbol] = newData;

              // Check if data changed
              const oldData = stockData[symbol];
              if (oldData) {
                const oldPrice = oldData?.price?.current;
                const newPrice = newData?.price?.current;
                if (oldPrice !== newPrice) {
                  changed.add(symbol);
                }
              }
            }
          } catch (err) {
            console.error(`Failed to fetch ${symbol}:`, err);
          }
        })
      );

      // Trigger flip animation for changed symbols
      if (changed.size > 0) {
        setAnimatingSymbols(changed);
        setTimeout(() => setAnimatingSymbols(new Set()), 500);
      }

      setPrevStockData(stockData);
      setStockData(prev => ({ ...prev, ...data }));
      setInitialLoading(false);
      setLastUpdate(new Date());
    };

    if (localWatchlist.length > 0) {
      // Initial fetch
      const hasData = Object.keys(stockData).length > 0;
      fetchAllStocks(!hasData);

      // Real-time updates every 10 seconds for that live feel
      const interval = setInterval(() => fetchAllStocks(false), 10000);
      return () => clearInterval(interval);
    }
  }, [localWatchlist]);

  const getSignalColor = action => {
    if (!action) return theme.colors.gray400;
    const a = action.toLowerCase();
    if (a.includes('buy')) return theme.colors.success;
    if (a.includes('sell')) return theme.colors.error;
    return theme.colors.warning;
  };

  // Get RSI background color with gradient based on value
  const getRsiBackground = rsi => {
    if (!rsi) return theme.colors.gray100;
    const val = parseFloat(rsi);
    if (val <= 30) return `rgba(34, 197, 94, ${0.2 + (30 - val) / 100})`;
    if (val >= 70) return `rgba(239, 68, 68, ${0.2 + (val - 70) / 100})`;
    return theme.colors.gray100;
  };

  const getRsiTextColor = rsi => {
    if (!rsi) return theme.colors.gray600;
    const val = parseFloat(rsi);
    if (val <= 30) return theme.colors.success;
    if (val >= 70) return theme.colors.error;
    return theme.colors.gray700;
  };

  const formatPrice = price => {
    if (!price) return '---.--';
    return `$${parseFloat(price).toFixed(2)}`;
  };

  const formatChange = change => {
    if (!change) return '+0.00%';
    const val = parseFloat(change);
    return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
  };

  // Determine if price went up or down
  const getPriceDirection = symbol => {
    const oldData = prevStockData[symbol];
    const newData = stockData[symbol];
    if (!oldData || !newData) return 'neutral';
    const oldPrice = parseFloat(oldData?.price?.current) || 0;
    const newPrice = parseFloat(newData?.price?.current) || 0;
    if (newPrice > oldPrice) return 'up';
    if (newPrice < oldPrice) return 'down';
    return 'neutral';
  };

  return (
    <Card style={{ padding: theme.spacing.md }}>
      {/* Split-Flap Display CSS */}
      <style>{`
        @keyframes priceFlash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes flashGreen {
          0%, 100% { background-color: transparent; }
          50% { background-color: rgba(34, 197, 94, 0.15); }
        }
        @keyframes flashRed {
          0%, 100% { background-color: transparent; }
          50% { background-color: rgba(239, 68, 68, 0.15); }
        }
        .split-flap-card {
          perspective: 1000px;
          transform-style: preserve-3d;
        }
        .split-flap-card.flash-up {
          animation: flashGreen 0.4s ease-in-out 2;
        }
        .split-flap-card.flash-down {
          animation: flashRed 0.4s ease-in-out 2;
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.md,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md }}>
            Live Quotes
          </h3>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor:
                sessionStatus === 'running'
                  ? theme.colors.success
                  : theme.colors.gray400,
              animation:
                sessionStatus === 'running' ? 'pulse 1.5s infinite' : 'none',
            }}
          />
        </div>
        <div
          style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.gray500,
          }}
        >
          {lastUpdate
            ? `Updated ${lastUpdate.toLocaleTimeString()}`
            : 'Loading...'}
        </div>
      </div>

      {initialLoading ? (
        <div
          style={{
            textAlign: 'center',
            padding: theme.spacing.xl,
            color: theme.colors.gray500,
          }}
        >
          Loading market data...
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: theme.spacing.xs,
          }}
        >
          {localWatchlist.map(symbol => {
            const data = stockData[symbol];
            const rec = data?.recommendation;
            const price = data?.price?.current;
            const change = data?.price?.change24h;
            const rsi = data?.technicals?.rsi;
            const trend = data?.technicals?.trendSignal;
            const changeVal = parseFloat(change) || 0;
            const isAnimating = animatingSymbols.has(symbol);
            const direction = getPriceDirection(symbol);

            return (
              <div
                key={symbol}
                onClick={() => onSelectSymbol(symbol)}
                className={`split-flap-card ${isAnimating ? (direction === 'up' ? 'flash-up' : direction === 'down' ? 'flash-down' : '') : ''}`}
                style={{
                  padding: theme.spacing.sm,
                  backgroundColor: getRsiBackground(rsi),
                  borderRadius: theme.borderRadius.md,
                  cursor: 'pointer',
                  border: `1px solid ${theme.colors.gray200}`,
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow =
                    '0 4px 12px rgba(0,0,0,0.15)';
                  e.currentTarget.style.borderColor = theme.colors.primary;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.borderColor = theme.colors.gray200;
                }}
              >
                {/* Flash bar indicator for price changes */}
                {isAnimating && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: '3px',
                      backgroundColor:
                        direction === 'up'
                          ? theme.colors.success
                          : direction === 'down'
                            ? theme.colors.error
                            : theme.colors.warning,
                      animation: 'priceFlash 0.3s ease-in-out 3',
                    }}
                  />
                )}

                {/* Symbol & Signal Badge */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '4px',
                  }}
                >
                  <Link
                    to={`/stock/${symbol}`}
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontWeight: theme.typography.fontWeight.bold,
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.gray800,
                      textDecoration: 'none',
                    }}
                  >
                    {symbol}
                  </Link>
                  <span
                    style={{
                      padding: '2px 6px',
                      backgroundColor: getSignalColor(rec?.action),
                      color: '#fff',
                      borderRadius: theme.borderRadius.sm,
                      fontSize: '10px',
                      fontWeight: theme.typography.fontWeight.bold,
                    }}
                  >
                    {rec?.action?.replace('Lean ', '').replace('Strong ', '') ||
                      'Hold'}
                  </span>
                </div>

                {/* Price with direction indicator */}
                <div
                  style={{
                    fontSize: theme.typography.fontSize.md,
                    fontWeight: theme.typography.fontWeight.bold,
                    color: theme.colors.gray900,
                    marginBottom: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <AnimatedValue
                    value={formatPrice(price)}
                    isAnimating={isAnimating}
                    direction={direction}
                  />
                  {isAnimating && direction !== 'neutral' && (
                    <span
                      style={{
                        fontSize: '10px',
                        color:
                          direction === 'up'
                            ? theme.colors.success
                            : theme.colors.error,
                        fontWeight: 'bold',
                      }}
                    >
                      {direction === 'up' ? '▲' : '▼'}
                    </span>
                  )}
                </div>

                {/* Change */}
                <div
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color:
                      changeVal >= 0
                        ? theme.colors.success
                        : theme.colors.error,
                    fontWeight: theme.typography.fontWeight.medium,
                    marginBottom: '4px',
                  }}
                >
                  {formatChange(change)}
                </div>

                {/* RSI & Trend Row */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: theme.typography.fontSize.xs,
                    borderTop: `1px solid ${theme.colors.gray200}`,
                    paddingTop: '4px',
                    marginTop: '2px',
                  }}
                >
                  <span
                    style={{
                      color: getRsiTextColor(rsi),
                      fontWeight: theme.typography.fontWeight.bold,
                    }}
                  >
                    RSI {rsi ? parseFloat(rsi).toFixed(0) : '--'}
                  </span>
                  <span
                    style={{
                      color:
                        trend === 'Bullish'
                          ? theme.colors.success
                          : trend === 'Bearish'
                            ? theme.colors.error
                            : theme.colors.gray500,
                      fontSize: '10px',
                    }}
                  >
                    {trend || 'Neutral'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          marginTop: theme.spacing.sm,
          padding: theme.spacing.xs,
          backgroundColor: theme.colors.gray50,
          borderRadius: theme.borderRadius.sm,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '10px',
          color: theme.colors.gray500,
        }}
      >
        <span>{localWatchlist.length} symbols • Live • 10s refresh</span>
        <span
          style={{
            color:
              sessionStatus === 'running'
                ? theme.colors.success
                : theme.colors.gray500,
          }}
        >
          {sessionStatus === 'running' ? 'AI Active' : 'Standby'}
        </span>
      </div>
    </Card>
  );
};

export default LiveTradingDashboard;
