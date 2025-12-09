/**
 * Strategy Monitor
 *
 * Monitors live strategy performance and detects degradation.
 * Triggers alerts when performance drops below thresholds.
 *
 * Features:
 * - Real-time metrics tracking
 * - Rolling window performance calculation
 * - Degradation detection with alerts
 * - Auto-pause when performance drops
 * - Daily/weekly/monthly reporting
 * - Integration with version control for auto-rollback
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class StrategyMonitor extends EventEmitter {
  constructor(dataDir = path.join(__dirname, '..', 'data')) {
    super();
    this.dataDir = dataDir;
    this.monitorFile = path.join(dataDir, 'strategy-monitor.json');
    this.monitors = this.loadMonitors();

    // Alert thresholds
    this.defaultThresholds = {
      minWinRate: 40, // Alert if win rate drops below 40%
      minExpectancy: 0, // Alert if expectancy goes negative
      maxDrawdown: 15, // Alert if drawdown exceeds 15%
      maxConsecutiveLosses: 5, // Alert after 5 consecutive losses
      minProfitFactor: 0.8, // Alert if profit factor below 0.8
      degradationThreshold: 25, // Alert if 25% worse than historical
    };

    // Rolling window sizes
    this.windowSizes = {
      short: 10, // Last 10 trades
      medium: 30, // Last 30 trades
      long: 100, // Last 100 trades
    };
  }

  /**
   * Load monitors from disk
   */
  loadMonitors() {
    try {
      if (fs.existsSync(this.monitorFile)) {
        const data = JSON.parse(fs.readFileSync(this.monitorFile, 'utf8'));
        return data.monitors || {};
      }
    } catch (error) {
      console.error('Error loading strategy monitors:', error.message);
    }
    return {};
  }

  /**
   * Save monitors to disk
   */
  saveMonitors() {
    try {
      const data = {
        _meta: {
          description: 'Strategy performance monitoring data',
          lastUpdated: new Date().toISOString(),
          version: '1.0',
        },
        monitors: this.monitors,
      };
      fs.writeFileSync(this.monitorFile, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving strategy monitors:', error.message);
      return false;
    }
  }

  /**
   * Start monitoring a strategy
   *
   * @param {string} symbol - Symbol to monitor
   * @param {string} versionId - Strategy version ID
   * @param {Object} options - Monitoring options
   */
  startMonitoring(symbol, versionId, options = {}) {
    const key = `${symbol.toUpperCase()}_${versionId}`;

    const monitor = {
      symbol: symbol.toUpperCase(),
      versionId,
      status: 'active',
      thresholds: { ...this.defaultThresholds, ...options.thresholds },
      trades: [],
      alerts: [],
      metrics: {
        current: null,
        rolling: {},
        historical: options.historicalMetrics || null,
      },
      stats: {
        consecutiveLosses: 0,
        consecutiveWins: 0,
        peakEquity: 0,
        currentEquity: options.startingEquity || 0,
        maxDrawdown: 0,
      },
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    this.monitors[key] = monitor;
    this.saveMonitors();

    return {
      success: true,
      key,
      message: `Started monitoring ${symbol} version ${versionId}`,
    };
  }

  /**
   * Stop monitoring a strategy
   */
  stopMonitoring(symbol, versionId) {
    const key = `${symbol.toUpperCase()}_${versionId}`;

    if (!this.monitors[key]) {
      return { success: false, error: 'Monitor not found' };
    }

    this.monitors[key].status = 'stopped';
    this.monitors[key].stoppedAt = new Date().toISOString();
    this.saveMonitors();

    return {
      success: true,
      message: `Stopped monitoring ${symbol} version ${versionId}`,
    };
  }

  /**
   * Record a trade and check for alerts
   *
   * @param {string} symbol - Symbol
   * @param {string} versionId - Strategy version
   * @param {Object} trade - Trade details { pnl, pnlPercent, entryPrice, exitPrice, ... }
   */
  recordTrade(symbol, versionId, trade) {
    const key = `${symbol.toUpperCase()}_${versionId}`;
    const monitor = this.monitors[key];

    if (!monitor) {
      return { success: false, error: 'Monitor not found' };
    }

    if (monitor.status !== 'active') {
      return { success: false, error: 'Monitor is not active' };
    }

    // Add trade
    const tradeRecord = {
      ...trade,
      recordedAt: new Date().toISOString(),
    };
    monitor.trades.push(tradeRecord);

    // Update stats
    this.updateStats(monitor, trade);

    // Calculate rolling metrics
    this.calculateRollingMetrics(monitor);

    // Check thresholds and generate alerts
    const alerts = this.checkThresholds(monitor);

    // Add any new alerts
    for (const alert of alerts) {
      monitor.alerts.push(alert);
      this.emit('alert', { symbol, versionId, alert });
    }

    monitor.lastUpdated = new Date().toISOString();
    this.saveMonitors();

    return {
      success: true,
      trade: tradeRecord,
      metrics: monitor.metrics.current,
      alerts,
      stats: monitor.stats,
    };
  }

  /**
   * Update running stats after a trade
   */
  updateStats(monitor, trade) {
    const stats = monitor.stats;

    // Update consecutive wins/losses
    if (trade.pnl > 0) {
      stats.consecutiveWins++;
      stats.consecutiveLosses = 0;
    } else {
      stats.consecutiveLosses++;
      stats.consecutiveWins = 0;
    }

    // Update equity
    stats.currentEquity += trade.pnl;

    // Update peak and drawdown
    if (stats.currentEquity > stats.peakEquity) {
      stats.peakEquity = stats.currentEquity;
    }

    const currentDrawdown =
      stats.peakEquity > 0
        ? ((stats.peakEquity - stats.currentEquity) / stats.peakEquity) * 100
        : 0;

    if (currentDrawdown > stats.maxDrawdown) {
      stats.maxDrawdown = currentDrawdown;
    }

    stats.currentDrawdown = currentDrawdown;
  }

  /**
   * Calculate rolling window metrics
   */
  calculateRollingMetrics(monitor) {
    const trades = monitor.trades;

    // Calculate metrics for each window size
    for (const [windowName, size] of Object.entries(this.windowSizes)) {
      if (trades.length >= size) {
        const windowTrades = trades.slice(-size);
        monitor.metrics.rolling[windowName] = this.calculateMetrics(windowTrades);
      }
    }

    // Current metrics (all trades)
    if (trades.length > 0) {
      monitor.metrics.current = this.calculateMetrics(trades);
    }
  }

  /**
   * Calculate metrics from trades
   */
  calculateMetrics(trades) {
    if (!trades || trades.length === 0) {
      return null;
    }

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);

    const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: +winRate.toFixed(2),
      expectancy: +expectancy.toFixed(2),
      profitFactor: +profitFactor.toFixed(2),
      avgWin: +avgWin.toFixed(2),
      avgLoss: +avgLoss.toFixed(2),
      totalPnl: +(totalWins - totalLosses).toFixed(2),
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Check thresholds and generate alerts
   */
  checkThresholds(monitor) {
    const alerts = [];
    const thresholds = monitor.thresholds;
    const metrics = monitor.metrics.rolling.short || monitor.metrics.current;
    const stats = monitor.stats;

    if (!metrics) return alerts;

    // Win rate check
    if (metrics.winRate < thresholds.minWinRate) {
      alerts.push(this.createAlert(
        'LOW_WIN_RATE',
        `Win rate ${metrics.winRate}% below threshold ${thresholds.minWinRate}%`,
        'WARNING'
      ));
    }

    // Expectancy check
    if (metrics.expectancy < thresholds.minExpectancy) {
      alerts.push(this.createAlert(
        'NEGATIVE_EXPECTANCY',
        `Expectancy ${metrics.expectancy} below threshold ${thresholds.minExpectancy}`,
        'CRITICAL'
      ));
    }

    // Drawdown check
    if (stats.currentDrawdown > thresholds.maxDrawdown) {
      alerts.push(this.createAlert(
        'MAX_DRAWDOWN_EXCEEDED',
        `Drawdown ${stats.currentDrawdown.toFixed(2)}% exceeds limit ${thresholds.maxDrawdown}%`,
        'CRITICAL'
      ));
    }

    // Consecutive losses check
    if (stats.consecutiveLosses >= thresholds.maxConsecutiveLosses) {
      alerts.push(this.createAlert(
        'CONSECUTIVE_LOSSES',
        `${stats.consecutiveLosses} consecutive losses`,
        'WARNING'
      ));
    }

    // Profit factor check
    if (metrics.profitFactor < thresholds.minProfitFactor && metrics.totalTrades >= 10) {
      alerts.push(this.createAlert(
        'LOW_PROFIT_FACTOR',
        `Profit factor ${metrics.profitFactor} below threshold ${thresholds.minProfitFactor}`,
        'WARNING'
      ));
    }

    // Degradation check (vs historical)
    if (monitor.metrics.historical) {
      const degradation = this.calculateDegradation(metrics, monitor.metrics.historical);
      if (degradation > thresholds.degradationThreshold) {
        alerts.push(this.createAlert(
          'PERFORMANCE_DEGRADATION',
          `Performance degraded ${degradation.toFixed(1)}% vs historical`,
          'WARNING'
        ));
      }
    }

    return alerts;
  }

  /**
   * Create an alert object
   */
  createAlert(type, message, severity) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      type,
      message,
      severity, // INFO, WARNING, CRITICAL
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };
  }

  /**
   * Calculate performance degradation percentage
   */
  calculateDegradation(current, historical) {
    if (!historical || !current) return 0;

    // Compare expectancy as primary metric
    if (historical.expectancy && historical.expectancy > 0) {
      return ((historical.expectancy - current.expectancy) / historical.expectancy) * 100;
    }

    return 0;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(symbol, versionId, alertId) {
    const key = `${symbol.toUpperCase()}_${versionId}`;
    const monitor = this.monitors[key];

    if (!monitor) {
      return { success: false, error: 'Monitor not found' };
    }

    const alert = monitor.alerts.find(a => a.id === alertId);
    if (!alert) {
      return { success: false, error: 'Alert not found' };
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();
    this.saveMonitors();

    return { success: true, message: 'Alert acknowledged' };
  }

  /**
   * Get monitor status
   */
  getMonitor(symbol, versionId) {
    const key = `${symbol.toUpperCase()}_${versionId}`;
    return this.monitors[key] || null;
  }

  /**
   * Get all monitors for a symbol
   */
  getMonitorsForSymbol(symbol) {
    const symbolKey = symbol.toUpperCase();
    return Object.entries(this.monitors)
      .filter(([key]) => key.startsWith(symbolKey + '_'))
      .map(([key, monitor]) => ({ key, ...monitor }));
  }

  /**
   * Get all active monitors
   */
  getActiveMonitors() {
    return Object.entries(this.monitors)
      .filter(([, monitor]) => monitor.status === 'active')
      .map(([key, monitor]) => ({ key, ...monitor }));
  }

  /**
   * Get unacknowledged alerts
   */
  getUnacknowledgedAlerts(symbol = null, versionId = null) {
    const alerts = [];

    for (const [key, monitor] of Object.entries(this.monitors)) {
      if (symbol && !key.startsWith(symbol.toUpperCase())) continue;
      if (versionId && !key.endsWith('_' + versionId)) continue;

      const unackedAlerts = monitor.alerts.filter(a => !a.acknowledged);
      for (const alert of unackedAlerts) {
        alerts.push({
          monitorKey: key,
          symbol: monitor.symbol,
          versionId: monitor.versionId,
          ...alert,
        });
      }
    }

    return alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Get daily summary
   */
  getDailySummary(symbol, versionId, date = null) {
    const key = `${symbol.toUpperCase()}_${versionId}`;
    const monitor = this.monitors[key];

    if (!monitor) return null;

    const targetDate = date || new Date().toISOString().split('T')[0];

    const dayTrades = monitor.trades.filter(t => {
      const tradeDate = t.recordedAt.split('T')[0];
      return tradeDate === targetDate;
    });

    if (dayTrades.length === 0) {
      return {
        date: targetDate,
        trades: 0,
        message: 'No trades for this date',
      };
    }

    const metrics = this.calculateMetrics(dayTrades);

    return {
      date: targetDate,
      symbol: monitor.symbol,
      versionId: monitor.versionId,
      trades: dayTrades.length,
      metrics,
    };
  }

  /**
   * Get performance report
   */
  getPerformanceReport(symbol, versionId) {
    const key = `${symbol.toUpperCase()}_${versionId}`;
    const monitor = this.monitors[key];

    if (!monitor) return null;

    // Group trades by date
    const tradesByDate = {};
    for (const trade of monitor.trades) {
      const date = trade.recordedAt.split('T')[0];
      if (!tradesByDate[date]) {
        tradesByDate[date] = [];
      }
      tradesByDate[date].push(trade);
    }

    // Calculate daily P&L
    const dailyPnl = Object.entries(tradesByDate).map(([date, trades]) => ({
      date,
      trades: trades.length,
      pnl: trades.reduce((sum, t) => sum + t.pnl, 0),
    }));

    // Calculate weekly P&L
    const weeklyPnl = this.aggregateByWeek(dailyPnl);

    return {
      symbol: monitor.symbol,
      versionId: monitor.versionId,
      status: monitor.status,
      totalTrades: monitor.trades.length,
      metrics: {
        current: monitor.metrics.current,
        rolling: monitor.metrics.rolling,
        historical: monitor.metrics.historical,
      },
      stats: monitor.stats,
      alerts: {
        total: monitor.alerts.length,
        unacknowledged: monitor.alerts.filter(a => !a.acknowledged).length,
        bySeverity: this.groupAlertsBySeverity(monitor.alerts),
      },
      dailyPnl: dailyPnl.slice(-30), // Last 30 days
      weeklyPnl: weeklyPnl.slice(-12), // Last 12 weeks
      createdAt: monitor.createdAt,
      lastUpdated: monitor.lastUpdated,
    };
  }

  /**
   * Aggregate daily P&L by week
   */
  aggregateByWeek(dailyPnl) {
    const weeklyMap = {};

    for (const day of dailyPnl) {
      const date = new Date(day.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weeklyMap[weekKey]) {
        weeklyMap[weekKey] = { weekStart: weekKey, trades: 0, pnl: 0 };
      }
      weeklyMap[weekKey].trades += day.trades;
      weeklyMap[weekKey].pnl += day.pnl;
    }

    return Object.values(weeklyMap).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }

  /**
   * Group alerts by severity
   */
  groupAlertsBySeverity(alerts) {
    return {
      CRITICAL: alerts.filter(a => a.severity === 'CRITICAL').length,
      WARNING: alerts.filter(a => a.severity === 'WARNING').length,
      INFO: alerts.filter(a => a.severity === 'INFO').length,
    };
  }

  /**
   * Clear all trades and reset monitor (for testing)
   */
  resetMonitor(symbol, versionId) {
    const key = `${symbol.toUpperCase()}_${versionId}`;
    const monitor = this.monitors[key];

    if (!monitor) {
      return { success: false, error: 'Monitor not found' };
    }

    monitor.trades = [];
    monitor.alerts = [];
    monitor.metrics = {
      current: null,
      rolling: {},
      historical: monitor.metrics.historical,
    };
    monitor.stats = {
      consecutiveLosses: 0,
      consecutiveWins: 0,
      peakEquity: 0,
      currentEquity: 0,
      maxDrawdown: 0,
    };
    monitor.lastUpdated = new Date().toISOString();

    this.saveMonitors();

    return { success: true, message: 'Monitor reset' };
  }

  /**
   * Delete a monitor
   */
  deleteMonitor(symbol, versionId) {
    const key = `${symbol.toUpperCase()}_${versionId}`;

    if (!this.monitors[key]) {
      return { success: false, error: 'Monitor not found' };
    }

    delete this.monitors[key];
    this.saveMonitors();

    return { success: true, message: 'Monitor deleted' };
  }

  /**
   * Update thresholds for a monitor
   */
  updateThresholds(symbol, versionId, thresholds) {
    const key = `${symbol.toUpperCase()}_${versionId}`;
    const monitor = this.monitors[key];

    if (!monitor) {
      return { success: false, error: 'Monitor not found' };
    }

    monitor.thresholds = { ...monitor.thresholds, ...thresholds };
    this.saveMonitors();

    return {
      success: true,
      message: 'Thresholds updated',
      thresholds: monitor.thresholds,
    };
  }

  /**
   * Set historical baseline metrics
   */
  setHistoricalBaseline(symbol, versionId, metrics) {
    const key = `${symbol.toUpperCase()}_${versionId}`;
    const monitor = this.monitors[key];

    if (!monitor) {
      return { success: false, error: 'Monitor not found' };
    }

    monitor.metrics.historical = metrics;
    this.saveMonitors();

    return {
      success: true,
      message: 'Historical baseline set',
    };
  }
}

module.exports = StrategyMonitor;
