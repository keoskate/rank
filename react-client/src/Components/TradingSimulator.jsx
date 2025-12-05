/**
 * TradingSimulator - Visual backtesting simulation
 *
 * Compresses a full trading day (6.5 hours) into a configurable duration
 * with real-time visualization of price movement and AI decisions.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Card from './common/Card';
import Button from './common/Button';
import theme from '../theme';

// Simulation constants
const MARKET_OPEN_HOUR = 9.5; // 9:30 AM
const MARKET_CLOSE_HOUR = 16; // 4:00 PM
const DEFAULT_SIMULATION_DURATION = 6000; // 6 seconds in ms

const TradingSimulator = ({ config, onComplete }) => {
  // Simulation state
  const [simulationDate, setSimulationDate] = useState('');
  const [symbol, setSymbol] = useState('AAPL');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState('09:30');
  const [simulationSpeed, setSimulationSpeed] = useState(1);

  // Market data
  const [candles, setCandles] = useState([]);
  const [currentCandleIndex, setCurrentCandleIndex] = useState(0);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [dayOpen, setDayOpen] = useState(0);
  const [dayHigh, setDayHigh] = useState(0);
  const [dayLow, setDayLow] = useState(Infinity);

  // Trading state
  const [portfolio, setPortfolio] = useState({
    cash: 100000,
    startingCash: 100000,
    positions: [],
    trades: []
  });
  const [realizedPnL, setRealizedPnL] = useState(0);
  const [aiDecisions, setAiDecisions] = useState([]);
  const [events, setEvents] = useState([]);

  // Analysis results
  const [analysis, setAnalysis] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Refs for simulation control
  const simulationRef = useRef(null);
  const indexRef = useRef(0);
  const candlesRef = useRef([]);
  const isPausedRef = useRef(false);

  // Get yesterday's date as default
  useEffect(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
      yesterday.setDate(yesterday.getDate() - 1);
    }
    setSimulationDate(yesterday.toISOString().split('T')[0]);
  }, []);

  // Calculate unrealized P&L
  const getUnrealizedPnL = useCallback(() => {
    if (portfolio.positions.length === 0) return 0;
    const pos = portfolio.positions[0];
    return (currentPrice - pos.entryPrice) * pos.quantity;
  }, [portfolio.positions, currentPrice]);

  // Total P&L (realized + unrealized)
  const totalPnL = realizedPnL + getUnrealizedPnL();

  // Fetch historical intraday data
  const fetchSimulationData = async () => {
    if (!simulationDate || !symbol) return null;

    try {
      const res = await fetch(
        `/api/polygon/aggregates/${symbol}/1/minute?from=${simulationDate}&to=${simulationDate}`
      );

      if (!res.ok) throw new Error('Failed to fetch market data');

      const data = await res.json();

      if (!data.results || data.results.length === 0) {
        throw new Error('No market data available for this date');
      }

      // Filter to market hours and validate data
      const marketCandles = data.results
        .filter(candle => {
          if (!candle) return false;
          const timestamp = candle.timestamp || candle.t;
          if (!timestamp) return false;
          const time = new Date(timestamp);
          const hour = time.getHours() + time.getMinutes() / 60;
          return hour >= MARKET_OPEN_HOUR && hour < MARKET_CLOSE_HOUR;
        })
        .filter(candle => {
          // Ensure all required fields exist
          const close = candle.close ?? candle.c;
          const high = candle.high ?? candle.h;
          const low = candle.low ?? candle.l;
          const open = candle.open ?? candle.o;
          return close !== undefined && high !== undefined && low !== undefined && open !== undefined;
        })
        .sort((a, b) => (a.timestamp || a.t) - (b.timestamp || b.t));

      return marketCandles;
    } catch (err) {
      console.error('Failed to fetch simulation data:', err);
      addEvent('error', 'Data Error', err.message);
      return null;
    }
  };

  // Safe getter for candle properties
  const getCandle = (candle) => {
    if (!candle) return null;
    return {
      close: candle.close ?? candle.c ?? 0,
      open: candle.open ?? candle.o ?? 0,
      high: candle.high ?? candle.h ?? 0,
      low: candle.low ?? candle.l ?? 0,
      volume: candle.volume ?? candle.v ?? 0,
      timestamp: candle.timestamp ?? candle.t ?? Date.now()
    };
  };

  // Simple AI decision logic with null checks
  // Uses config for profit target, stop loss, min confidence, etc.
  const makeAiDecision = (candle, index, allCandles, currentPosition) => {
    const c = getCandle(candle);
    if (!c) return { action: 'HOLD', confidence: 0, reasons: ['Invalid candle data'] };

    const { close: price, volume, open, high, low, timestamp } = c;

    // Get config values with defaults
    // Config may use takeProfitPercent, profitTarget, or profitTargetPercent
    const profitTargetPercent = config?.takeProfitPercent || config?.profitTarget || config?.profitTargetPercent || 2;
    const stopLossPercent = config?.stopLossPercent || config?.stopLoss || 1;
    const minConfidence = config?.minConfidence || 70;

    // Debug log on first candle to verify config is being used
    if (index === 0) {
      console.log('[Simulator] Using config:', { profitTargetPercent, stopLossPercent, minConfidence, rawConfig: config });
    }

    // Calculate price change from previous candle
    let priceChange = 0;
    if (index > 0) {
      const prevCandle = getCandle(allCandles[index - 1]);
      if (prevCandle && prevCandle.close > 0) {
        priceChange = (price - prevCandle.close) / prevCandle.close;
      }
    }

    // Calculate RSI-like momentum (simplified)
    let gains = 0, losses = 0;
    const lookback = Math.min(14, index);
    for (let i = index - lookback; i < index; i++) {
      if (i > 0 && allCandles[i] && allCandles[i - 1]) {
        const curr = getCandle(allCandles[i]);
        const prev = getCandle(allCandles[i - 1]);
        if (curr && prev && prev.close > 0) {
          const change = curr.close - prev.close;
          if (change > 0) gains += change;
          else losses -= change;
        }
      }
    }
    const avgGain = lookback > 0 ? gains / lookback : 0;
    const avgLoss = lookback > 0 ? losses / lookback : 0.001;
    const rs = avgGain / Math.max(avgLoss, 0.001);
    const rsi = 100 - (100 / (1 + rs));

    // Calculate VWAP (simplified) with null checks
    let cumulativeTPV = 0, cumulativeVol = 0;
    for (let i = 0; i <= index; i++) {
      const candleData = getCandle(allCandles[i]);
      if (candleData && candleData.volume > 0) {
        const tp = (candleData.high + candleData.low + candleData.close) / 3;
        cumulativeTPV += tp * candleData.volume;
        cumulativeVol += candleData.volume;
      }
    }
    const vwap = cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : price;

    const decision = {
      timestamp,
      price,
      rsi: Math.round(rsi),
      vwap: vwap.toFixed(2),
      priceVsVwap: ((price / vwap - 1) * 100).toFixed(2),
      action: 'HOLD',
      confidence: 50,
      reasons: []
    };

    // BUY signals
    if (!currentPosition) {
      let buyScore = 0;
      const buyReasons = [];

      if (rsi < 35) {
        buyScore += 25;
        buyReasons.push(`RSI oversold (${Math.round(rsi)})`);
      }
      if (price < vwap * 0.995) {
        buyScore += 20;
        buyReasons.push(`Price below VWAP ($${vwap.toFixed(2)})`);
      }
      if (priceChange < -0.005 && priceChange > -0.02) {
        buyScore += 15;
        buyReasons.push('Minor pullback detected');
      }

      // Volume spike check with null safety
      const recentCandles = allCandles.slice(Math.max(0, index - 10), index);
      const avgVolume = recentCandles.reduce((s, c) => {
        const cd = getCandle(c);
        return s + (cd ? cd.volume : 0);
      }, 0) / Math.max(recentCandles.length, 1);

      if (volume > avgVolume * 1.5) {
        buyScore += 15;
        buyReasons.push('Volume spike detected');
      }

      decision.confidence = Math.min(95, 50 + buyScore);

      if (decision.confidence >= minConfidence) {
        decision.action = 'BUY';
        decision.reasons = buyReasons;
      }
    }

    // SELL signals - using config values for profit target and stop loss
    if (currentPosition) {
      let sellScore = 0;
      const sellReasons = [];
      const entryPrice = currentPosition.entryPrice;
      const pnlPercent = ((price - entryPrice) / entryPrice) * 100;

      // Profit target from config (default 2%)
      if (pnlPercent >= profitTargetPercent) {
        sellScore += 30;
        sellReasons.push(`Profit target hit (+${pnlPercent.toFixed(2)}%)`);
      }

      // Stop loss from config (default 1%)
      if (pnlPercent <= -stopLossPercent) {
        sellScore += 40;
        sellReasons.push(`Stop loss triggered (${pnlPercent.toFixed(2)}%)`);
      }

      if (rsi > 70) {
        sellScore += 20;
        sellReasons.push(`RSI overbought (${Math.round(rsi)})`);
      }

      if (price > vwap * 1.01 && priceChange < 0) {
        sellScore += 15;
        sellReasons.push('Momentum fading above VWAP');
      }

      // End of day check
      const time = new Date(timestamp);
      const hour = time.getHours() + time.getMinutes() / 60;
      if (hour >= 15.75) {
        sellScore += 50;
        sellReasons.push('End of day liquidation');
      }

      decision.confidence = Math.min(95, 50 + sellScore);

      if (decision.confidence >= minConfidence || hour >= 15.75) {
        decision.action = 'SELL';
        decision.reasons = sellReasons;
      }
    }

    return decision;
  };

  // Execute trade
  const executeTrade = useCallback((decision, candle) => {
    const c = getCandle(candle);
    if (!c) return;

    const { close: price, timestamp } = c;
    const reasons = decision.reasons || [];
    const reasonsText = reasons.length > 0 ? reasons.join(', ') : 'Manual signal';

    setPortfolio(prev => {
      const newPortfolio = { ...prev };

      if (decision.action === 'BUY' && prev.positions.length === 0) {
        const positionSize = Math.floor(prev.cash * 0.5 / price);

        if (positionSize > 0) {
          const cost = positionSize * price;
          newPortfolio.cash = prev.cash - cost;
          newPortfolio.positions = [{
            symbol,
            quantity: positionSize,
            entryPrice: price,
            entryTime: timestamp,
            reasons: reasons
          }];

          newPortfolio.trades = [...prev.trades, {
            type: 'BUY',
            symbol,
            quantity: positionSize,
            price,
            timestamp,
            value: cost,
            confidence: decision.confidence,
            reasons: reasons
          }];

          addEvent(
            'trade',
            'BUY Order Filled',
            `Bought ${positionSize} ${symbol} @ $${price.toFixed(2)}`,
            reasonsText,
            decision.confidence
          );
        }
      } else if (decision.action === 'SELL' && prev.positions.length > 0) {
        const position = prev.positions[0];
        const proceeds = position.quantity * price;
        const pnl = proceeds - (position.quantity * position.entryPrice);

        newPortfolio.cash = prev.cash + proceeds;
        newPortfolio.positions = [];

        newPortfolio.trades = [...prev.trades, {
          type: 'SELL',
          symbol,
          quantity: position.quantity,
          price,
          timestamp,
          value: proceeds,
          pnl,
          pnlPercent: ((price - position.entryPrice) / position.entryPrice * 100),
          confidence: decision.confidence,
          reasons: reasons
        }];

        setRealizedPnL(prev => prev + pnl);
        addEvent(
          pnl >= 0 ? 'success' : 'error',
          'SELL Order Filled',
          `Sold ${position.quantity} ${symbol} @ $${price.toFixed(2)} (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`,
          reasonsText,
          decision.confidence
        );
      }

      return newPortfolio;
    });
  }, [symbol]);

  // Add event to timeline
  const addEvent = (type, title, message, reason = null, confidence = null) => {
    setEvents(prev => [...prev, {
      id: Date.now() + Math.random(),
      type,
      title,
      reason,
      confidence,
      message,
      timestamp: new Date()
    }]);
  };

  // Process single candle
  const processCandle = useCallback((index, data) => {
    if (index >= data.length) {
      completeSimulation(data);
      return;
    }

    const candle = data[index];
    const c = getCandle(candle);
    if (!c) {
      // Skip invalid candle
      indexRef.current = index + 1;
      return;
    }

    const { close: price, high, low, timestamp } = c;

    setCurrentPrice(price);
    setCurrentCandleIndex(index);
    setProgress((index / data.length) * 100);

    setDayHigh(prev => Math.max(prev, high));
    setDayLow(prev => Math.min(prev === Infinity ? low : prev, low));

    const time = new Date(timestamp);
    setCurrentTime(time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

    // Make AI decision
    setPortfolio(prev => {
      const currentPosition = prev.positions[0] || null;
      const decision = makeAiDecision(candle, index, data, currentPosition);

      setAiDecisions(prevDecisions => [...prevDecisions, decision]);

      if (decision.action !== 'HOLD') {
        executeTrade(decision, candle);
      }

      return prev;
    });

    indexRef.current = index + 1;
  }, [executeTrade]);

  // Start simulation
  const startSimulation = async () => {
    setIsRunning(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setProgress(0);
    setCurrentCandleIndex(0);
    indexRef.current = 0;
    setAiDecisions([]);
    setEvents([]);
    setAnalysis(null);
    setShowAnalysis(false);
    setRealizedPnL(0);
    setPortfolio({
      cash: 100000,
      startingCash: 100000,
      positions: [],
      trades: []
    });
    setDayHigh(0);
    setDayLow(Infinity);

    addEvent('info', 'Simulation Started', `Running backtest for ${symbol} on ${simulationDate}`);

    const data = await fetchSimulationData();

    if (!data || data.length === 0) {
      setIsRunning(false);
      addEvent('error', 'Simulation Failed', 'No valid data available');
      return;
    }

    setCandles(data);
    candlesRef.current = data;

    const firstCandle = getCandle(data[0]);
    if (firstCandle) {
      setDayOpen(firstCandle.open);
      setCurrentPrice(firstCandle.close);
    }

    const totalDuration = DEFAULT_SIMULATION_DURATION / simulationSpeed;
    const intervalMs = totalDuration / data.length;

    simulationRef.current = setInterval(() => {
      if (isPausedRef.current) return;

      const currentIndex = indexRef.current;
      if (currentIndex >= data.length) {
        clearInterval(simulationRef.current);
        return;
      }

      processCandle(currentIndex, data);
    }, intervalMs);
  };

  // Complete simulation
  const completeSimulation = (data) => {
    clearInterval(simulationRef.current);
    setIsRunning(false);
    setProgress(100);

    addEvent('success', 'Simulation Complete', 'Generating analysis...');

    // Generate analysis
    setTimeout(() => {
      setPortfolio(prev => {
        const totalTrades = prev.trades.length;
        const sellTrades = prev.trades.filter(t => t.type === 'SELL').length;
        const profitableTrades = prev.trades.filter(t => t.pnl && t.pnl > 0).length;
        const losingTrades = prev.trades.filter(t => t.pnl && t.pnl < 0).length;

        const totalPnLCalc = prev.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const winRate = sellTrades > 0 ? (profitableTrades / sellTrades * 100) : 0;

        const finalValue = prev.cash + prev.positions.reduce((sum, p) => sum + p.quantity * currentPrice, 0);
        const returnPercent = ((finalValue - prev.startingCash) / prev.startingCash * 100);

        const positives = [];
        const negatives = [];
        const improvements = [];

        if (returnPercent > 0) {
          positives.push(`Generated positive return of +${returnPercent.toFixed(2)}%`);
        } else if (returnPercent < 0) {
          negatives.push(`Generated negative return of ${returnPercent.toFixed(2)}%`);
        }

        if (winRate >= 50) {
          positives.push(`Win rate of ${winRate.toFixed(0)}% is above 50%`);
        } else if (winRate > 0) {
          negatives.push(`Win rate of ${winRate.toFixed(0)}% is below 50%`);
          improvements.push('Consider tighter stop losses or wider profit targets');
        }

        if (totalTrades === 0) {
          negatives.push('No trades executed - confidence threshold may be too high');
          improvements.push('Lower minimum confidence threshold to increase trading activity');
        } else if (totalTrades > 10) {
          negatives.push('High number of trades may indicate overtrading');
          improvements.push('Increase confidence threshold to reduce noise trades');
        }

        const analysisResult = {
          date: simulationDate,
          symbol,
          startingCash: prev.startingCash,
          finalValue,
          totalPnL: totalPnLCalc,
          returnPercent,
          totalTrades,
          profitableTrades,
          losingTrades,
          winRate,
          dayOpen,
          dayHigh,
          dayLow,
          dayClose: currentPrice,
          priceChangePercent: dayOpen > 0 ? ((currentPrice - dayOpen) / dayOpen * 100) : 0,
          positives,
          negatives,
          improvements
        };

        setAnalysis(analysisResult);
        setShowAnalysis(true);

        return prev;
      });
    }, 100);
  };

  // Pause/resume with proper ref tracking
  const togglePause = () => {
    if (isPaused) {
      isPausedRef.current = false;
      setIsPaused(false);
      addEvent('info', 'Resumed', 'Simulation resumed');
    } else {
      isPausedRef.current = true;
      setIsPaused(true);
      addEvent('info', 'Paused', 'Simulation paused');
    }
  };

  // Stop simulation
  const stopSimulation = () => {
    clearInterval(simulationRef.current);
    setIsRunning(false);
    setIsPaused(false);
    isPausedRef.current = false;
    addEvent('warning', 'Simulation Stopped', 'Simulation was manually stopped');
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
      }
    };
  }, []);

  // Mini price chart
  const renderMiniChart = () => {
    if (candles.length === 0) return null;

    const visibleCandles = candles.slice(0, currentCandleIndex + 1);
    if (visibleCandles.length === 0) return null;

    const width = 600;
    const height = 180;
    const padding = 40;

    const prices = visibleCandles.map(c => getCandle(c)?.close || 0).filter(p => p > 0);
    if (prices.length === 0) return null;

    const minPrice = Math.min(...prices) * 0.999;
    const maxPrice = Math.max(...prices) * 1.001;

    const xScale = (i) => padding + (i / candles.length) * (width - padding * 2);
    const yScale = (p) => height - padding - ((p - minPrice) / (maxPrice - minPrice)) * (height - padding * 2);

    const pathPoints = visibleCandles.map((candle, i) => {
      const c = getCandle(candle);
      if (!c) return null;
      const x = xScale(i);
      const y = yScale(c.close);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).filter(Boolean).join(' ');

    const buyTrades = portfolio.trades.filter(t => t.type === 'BUY');
    const sellTrades = portfolio.trades.filter(t => t.type === 'SELL');

    return (
      <svg width={width} height={height} style={{ backgroundColor: theme.colors.gray50, borderRadius: theme.borderRadius.md }}>
        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
          <line
            key={pct}
            x1={padding}
            y1={height - padding - pct * (height - padding * 2)}
            x2={width - padding}
            y2={height - padding - pct * (height - padding * 2)}
            stroke={theme.colors.gray200}
            strokeDasharray="2,2"
          />
        ))}

        <text x={5} y={padding} fontSize={10} fill={theme.colors.gray500}>
          ${maxPrice.toFixed(2)}
        </text>
        <text x={5} y={height - padding} fontSize={10} fill={theme.colors.gray500}>
          ${minPrice.toFixed(2)}
        </text>

        <path
          d={pathPoints}
          fill="none"
          stroke={currentPrice >= dayOpen ? theme.colors.success : theme.colors.error}
          strokeWidth={2}
        />

        {visibleCandles.length > 0 && (
          <circle
            cx={xScale(visibleCandles.length - 1)}
            cy={yScale(currentPrice)}
            r={4}
            fill={currentPrice >= dayOpen ? theme.colors.success : theme.colors.error}
          />
        )}

        {buyTrades.map((trade, i) => {
          const tradeIndex = candles.findIndex(c => (c.timestamp || c.t) >= trade.timestamp);
          if (tradeIndex < 0 || tradeIndex > currentCandleIndex) return null;
          return (
            <polygon
              key={`buy-${i}`}
              points={`${xScale(tradeIndex)},${yScale(trade.price) + 8} ${xScale(tradeIndex) - 5},${yScale(trade.price) + 16} ${xScale(tradeIndex) + 5},${yScale(trade.price) + 16}`}
              fill={theme.colors.success}
            />
          );
        })}
        {sellTrades.map((trade, i) => {
          const tradeIndex = candles.findIndex(c => (c.timestamp || c.t) >= trade.timestamp);
          if (tradeIndex < 0 || tradeIndex > currentCandleIndex) return null;
          return (
            <polygon
              key={`sell-${i}`}
              points={`${xScale(tradeIndex)},${yScale(trade.price) - 8} ${xScale(tradeIndex) - 5},${yScale(trade.price) - 16} ${xScale(tradeIndex) + 5},${yScale(trade.price) - 16}`}
              fill={theme.colors.error}
            />
          );
        })}

        <text x={padding} y={height - 5} fontSize={10} fill={theme.colors.gray500}>9:30</text>
        <text x={width / 2} y={height - 5} fontSize={10} fill={theme.colors.gray500} textAnchor="middle">12:00</text>
        <text x={width - padding} y={height - 5} fontSize={10} fill={theme.colors.gray500} textAnchor="end">4:00</text>
      </svg>
    );
  };

  // Save results
  const saveResults = async () => {
    if (!analysis) return;

    try {
      const res = await fetch('/api/simulation/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis,
          aiDecisions,
          events,
          config,
          savedAt: new Date().toISOString()
        })
      });

      if (res.ok) {
        addEvent('success', 'Results Saved', 'Simulation results saved');
      }
    } catch (err) {
      console.error('Failed to save results:', err);
    }
  };

  return (
    <Card style={{ marginBottom: theme.spacing.lg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
        <h3 style={{ margin: 0 }}>Trading Day Simulator</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md }}>
          <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, display: 'flex', gap: theme.spacing.sm }}>
            <span style={{ backgroundColor: theme.colors.success + '20', padding: '2px 6px', borderRadius: theme.borderRadius.sm }}>
              +{config?.takeProfitPercent || 2}% TP
            </span>
            <span style={{ backgroundColor: theme.colors.error + '20', padding: '2px 6px', borderRadius: theme.borderRadius.sm }}>
              -{config?.stopLossPercent || 1}% SL
            </span>
          </div>
          <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray500 }}>
            6.5 hours → {(6 / simulationSpeed).toFixed(1)} seconds
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: theme.spacing.md,
        marginBottom: theme.spacing.lg
      }}>
        <div>
          <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
            Date
          </label>
          <input
            type="date"
            value={simulationDate}
            onChange={(e) => setSimulationDate(e.target.value)}
            disabled={isRunning}
            max={new Date().toISOString().split('T')[0]}
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.gray300}`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.md
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
            Symbol
          </label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            disabled={isRunning}
            placeholder="AAPL"
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.gray300}`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.md
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
            Speed
          </label>
          <select
            value={simulationSpeed}
            onChange={(e) => setSimulationSpeed(parseFloat(e.target.value))}
            disabled={isRunning}
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.gray300}`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.md
            }}
          >
            <option value={0.5}>0.5x (12s)</option>
            <option value={1}>1x (6s)</option>
            <option value={2}>2x (3s)</option>
            <option value={4}>4x (1.5s)</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: theme.spacing.sm }}>
          {!isRunning ? (
            <Button onClick={startSimulation} disabled={!simulationDate || !symbol}>
              Run Simulation
            </Button>
          ) : (
            <>
              <Button variant={isPaused ? 'primary' : 'outline'} onClick={togglePause}>
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="danger" onClick={stopSimulation}>
                Stop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* PROMINENT P&L DISPLAY */}
      {(isRunning || progress > 0) && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: theme.spacing.lg,
          marginBottom: theme.spacing.md,
          backgroundColor: totalPnL >= 0 ? `${theme.colors.success}15` : `${theme.colors.error}15`,
          borderRadius: theme.borderRadius.lg,
          border: `2px solid ${totalPnL >= 0 ? theme.colors.success : theme.colors.error}`
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600, marginBottom: theme.spacing.xs }}>
              Total P&L
            </div>
            <div style={{
              fontSize: '48px',
              fontWeight: theme.typography.fontWeight.bold,
              color: totalPnL >= 0 ? theme.colors.success : theme.colors.error,
              lineHeight: 1
            }}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
            </div>
            <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600, marginTop: theme.spacing.xs }}>
              {portfolio.startingCash > 0 ? `${((totalPnL / portfolio.startingCash) * 100).toFixed(2)}%` : '0.00%'} return
            </div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {(isRunning || progress > 0) && (
        <div style={{ marginBottom: theme.spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.xs }}>
            <span style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
              {currentTime} {isPaused && <span style={{ color: theme.colors.warning }}>(PAUSED)</span>}
            </span>
            <span style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
              {progress.toFixed(0)}%
            </span>
          </div>
          <div style={{
            height: 8,
            backgroundColor: theme.colors.gray200,
            borderRadius: theme.borderRadius.full,
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              backgroundColor: isPaused ? theme.colors.warning : isRunning ? theme.colors.primary : theme.colors.success,
              transition: 'width 0.1s linear'
            }} />
          </div>
        </div>
      )}

      {/* Live Stats */}
      {(isRunning || progress > 0) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.md
        }}>
          <div style={{ padding: theme.spacing.sm, backgroundColor: theme.colors.gray50, borderRadius: theme.borderRadius.sm, textAlign: 'center' }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>Price</div>
            <div style={{
              fontSize: theme.typography.fontSize.lg,
              fontWeight: theme.typography.fontWeight.bold,
              color: currentPrice >= dayOpen ? theme.colors.success : theme.colors.error
            }}>
              ${currentPrice.toFixed(2)}
            </div>
          </div>
          <div style={{ padding: theme.spacing.sm, backgroundColor: theme.colors.gray50, borderRadius: theme.borderRadius.sm, textAlign: 'center' }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>Day %</div>
            <div style={{
              fontSize: theme.typography.fontSize.lg,
              fontWeight: theme.typography.fontWeight.bold,
              color: currentPrice >= dayOpen ? theme.colors.success : theme.colors.error
            }}>
              {dayOpen > 0 ? `${((currentPrice - dayOpen) / dayOpen * 100).toFixed(2)}%` : '--'}
            </div>
          </div>
          <div style={{ padding: theme.spacing.sm, backgroundColor: theme.colors.gray50, borderRadius: theme.borderRadius.sm, textAlign: 'center' }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>Cash</div>
            <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold }}>
              ${portfolio.cash.toFixed(0)}
            </div>
          </div>
          <div style={{ padding: theme.spacing.sm, backgroundColor: theme.colors.gray50, borderRadius: theme.borderRadius.sm, textAlign: 'center' }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>Trades</div>
            <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold }}>
              {portfolio.trades.length}
            </div>
          </div>
          <div style={{ padding: theme.spacing.sm, backgroundColor: portfolio.positions.length > 0 ? `${theme.colors.info}15` : theme.colors.gray50, borderRadius: theme.borderRadius.sm, textAlign: 'center' }}>
            <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>Position</div>
            <div style={{ fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold, color: portfolio.positions.length > 0 ? theme.colors.info : theme.colors.gray400 }}>
              {portfolio.positions.length > 0 ? `${portfolio.positions[0].quantity} shs` : 'None'}
            </div>
          </div>
        </div>
      )}

      {/* Mini Chart */}
      {candles.length > 0 && (
        <div style={{ marginBottom: theme.spacing.md }}>
          {renderMiniChart()}
        </div>
      )}

      {/* Events Feed */}
      {events.length > 0 && (
        <div style={{ marginBottom: theme.spacing.md }}>
          <h4 style={{ margin: 0, marginBottom: theme.spacing.sm }}>Event Log</h4>
          <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: theme.typography.fontSize.sm }}>
            {events.slice().reverse().slice(0, 10).map(event => (
              <div
                key={event.id}
                style={{
                  padding: theme.spacing.sm,
                  marginBottom: theme.spacing.xs,
                  backgroundColor: event.type === 'error' ? `${theme.colors.error}10`
                    : event.type === 'success' ? `${theme.colors.success}10`
                    : event.type === 'trade' ? `${theme.colors.info}10`
                    : theme.colors.gray50,
                  borderLeft: `3px solid ${
                    event.type === 'error' ? theme.colors.error
                    : event.type === 'success' ? theme.colors.success
                    : event.type === 'trade' ? theme.colors.info
                    : theme.colors.gray300
                  }`,
                  borderRadius: theme.borderRadius.sm
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ color: event.type === 'error' ? theme.colors.error : event.type === 'success' ? theme.colors.success : theme.colors.info }}>
                      {event.title}
                    </strong>
                    <span>: {event.message}</span>
                  </div>
                  {event.confidence && (
                    <span style={{
                      fontSize: theme.typography.fontSize.xs,
                      backgroundColor: theme.colors.gray200,
                      padding: '2px 6px',
                      borderRadius: theme.borderRadius.sm,
                      marginLeft: theme.spacing.sm,
                      whiteSpace: 'nowrap'
                    }}>
                      {event.confidence}% conf
                    </span>
                  )}
                </div>
                {event.reason && (
                  <div style={{
                    marginTop: theme.spacing.xs,
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.gray600,
                    fontStyle: 'italic',
                    paddingLeft: theme.spacing.sm,
                    borderLeft: `2px solid ${theme.colors.gray300}`
                  }}>
                    Trigger: {event.reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analysis Results */}
      {showAnalysis && analysis && (
        <div style={{ borderTop: `1px solid ${theme.colors.gray200}`, paddingTop: theme.spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
            <h4 style={{ margin: 0 }}>Simulation Analysis</h4>
            <Button size="small" variant="outline" onClick={saveResults}>
              Save Results
            </Button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: theme.spacing.md,
            marginBottom: theme.spacing.lg
          }}>
            <div style={{
              padding: theme.spacing.md,
              backgroundColor: analysis.returnPercent >= 0 ? `${theme.colors.success}10` : `${theme.colors.error}10`,
              borderRadius: theme.borderRadius.md,
              textAlign: 'center'
            }}>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>Return</div>
              <div style={{
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
                color: analysis.returnPercent >= 0 ? theme.colors.success : theme.colors.error
              }}>
                {analysis.returnPercent >= 0 ? '+' : ''}{analysis.returnPercent.toFixed(2)}%
              </div>
            </div>

            <div style={{ padding: theme.spacing.md, backgroundColor: theme.colors.gray50, borderRadius: theme.borderRadius.md, textAlign: 'center' }}>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>Win Rate</div>
              <div style={{
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
                color: analysis.winRate >= 50 ? theme.colors.success : theme.colors.warning
              }}>
                {analysis.winRate.toFixed(0)}%
              </div>
            </div>

            <div style={{ padding: theme.spacing.md, backgroundColor: theme.colors.gray50, borderRadius: theme.borderRadius.md, textAlign: 'center' }}>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>Trades</div>
              <div style={{ fontSize: theme.typography.fontSize.xxl, fontWeight: theme.typography.fontWeight.bold }}>
                {analysis.totalTrades}
              </div>
            </div>

            <div style={{ padding: theme.spacing.md, backgroundColor: theme.colors.gray50, borderRadius: theme.borderRadius.md, textAlign: 'center' }}>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>Stock %</div>
              <div style={{
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
                color: analysis.priceChangePercent >= 0 ? theme.colors.success : theme.colors.error
              }}>
                {analysis.priceChangePercent >= 0 ? '+' : ''}{analysis.priceChangePercent.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Feedback */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.spacing.md }}>
            {analysis.positives.length > 0 && (
              <div style={{ padding: theme.spacing.md, backgroundColor: `${theme.colors.success}08`, borderRadius: theme.borderRadius.md, border: `1px solid ${theme.colors.success}30` }}>
                <h5 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.success }}>Positives</h5>
                <ul style={{ margin: 0, paddingLeft: theme.spacing.md, fontSize: theme.typography.fontSize.sm }}>
                  {analysis.positives.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}

            {analysis.negatives.length > 0 && (
              <div style={{ padding: theme.spacing.md, backgroundColor: `${theme.colors.error}08`, borderRadius: theme.borderRadius.md, border: `1px solid ${theme.colors.error}30` }}>
                <h5 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.error }}>Concerns</h5>
                <ul style={{ margin: 0, paddingLeft: theme.spacing.md, fontSize: theme.typography.fontSize.sm }}>
                  {analysis.negatives.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}

            {analysis.improvements.length > 0 && (
              <div style={{ padding: theme.spacing.md, backgroundColor: `${theme.colors.info}08`, borderRadius: theme.borderRadius.md, border: `1px solid ${theme.colors.info}30` }}>
                <h5 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.info }}>Improvements</h5>
                <ul style={{ margin: 0, paddingLeft: theme.spacing.md, fontSize: theme.typography.fontSize.sm }}>
                  {analysis.improvements.map((imp, i) => <li key={i}>{imp}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};

export default TradingSimulator;
