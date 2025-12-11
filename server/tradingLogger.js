/**
 * Trading Logger Service
 *
 * Structured logging for live trading diagnostics.
 * Captures decisions, indicators, executions, and errors in a format
 * optimized for debugging and sharing with AI assistants.
 *
 * Log Levels:
 * - EXEC: Trade executions (buy/sell orders)
 * - SIGNAL: Entry/exit signals detected
 * - INDICATOR: Key indicator changes
 * - CONFIG: Configuration changes
 * - RISK: Risk management events (circuit breaker, limits)
 * - ERROR: Errors and failures
 * - INFO: General information
 */

const fs = require('fs');
const path = require('path');

// In-memory log buffer (most recent logs)
const MAX_MEMORY_LOGS = 500;
let logBuffer = [];

// Log file path
const LOG_DIR = path.join(__dirname, '../data/logs');
const LOG_FILE = path.join(LOG_DIR, 'trading.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Log levels with priorities
const LOG_LEVELS = {
  EXEC: { priority: 1, emoji: '💰', color: '#22c55e' },
  SIGNAL: { priority: 2, emoji: '📊', color: '#3b82f6' },
  INDICATOR: { priority: 3, emoji: '📈', color: '#8b5cf6' },
  CONFIG: { priority: 4, emoji: '⚙️', color: '#6b7280' },
  RISK: { priority: 5, emoji: '🛡️', color: '#f59e0b' },
  ERROR: { priority: 6, emoji: '❌', color: '#ef4444' },
  INFO: { priority: 7, emoji: 'ℹ️', color: '#64748b' },
};

/**
 * Format a log entry for display
 */
function formatLogEntry(entry) {
  const level = LOG_LEVELS[entry.level] || LOG_LEVELS.INFO;
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  let formatted = `[${time}] ${level.emoji} [${entry.level}]`;

  if (entry.sessionName) {
    formatted += ` (${entry.sessionName})`;
  }

  if (entry.symbol) {
    formatted += ` ${entry.symbol}`;
  }

  formatted += ` ${entry.message}`;

  return formatted;
}

/**
 * Create a log entry
 */
function createLogEntry(level, message, data = {}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...data,
  };

  // Add to memory buffer
  logBuffer.push(entry);
  if (logBuffer.length > MAX_MEMORY_LOGS) {
    logBuffer = logBuffer.slice(-MAX_MEMORY_LOGS);
  }

  // Write to file
  try {
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }

  // Also console log with formatting
  const formatted = formatLogEntry(entry);
  if (entry.level === 'ERROR') {
    console.error(formatted);
  } else if (entry.level === 'EXEC' || entry.level === 'RISK') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  return entry;
}

/**
 * Log trade execution
 */
function logExecution(action, symbol, data) {
  const { quantity, price, orderId, sessionName, reason, pnl, pnlPercent } = data;

  let message = `${action.toUpperCase()} ${quantity} shares @ $${price?.toFixed(2) || 'market'}`;

  if (pnl !== undefined) {
    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    const pctStr = pnlPercent !== undefined ? ` (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)` : '';
    message += ` | P/L: ${pnlStr}${pctStr}`;
  }

  if (reason) {
    message += ` | Reason: ${reason}`;
  }

  return createLogEntry('EXEC', message, {
    symbol,
    sessionName,
    action,
    quantity,
    price,
    orderId,
    reason,
    pnl,
    pnlPercent,
  });
}

/**
 * Log trading signal
 */
function logSignal(type, symbol, data) {
  const { confidence, reasons, currentPrice, profitTarget, stopLoss, sessionName, shouldEnter, shouldExit, exitScore } = data;

  let message = `${type.toUpperCase()} signal`;

  if (confidence !== undefined) {
    message += ` (${confidence}% confidence)`;
  }

  if (exitScore !== undefined) {
    message += ` (score: ${exitScore})`;
  }

  message += ` @ $${currentPrice?.toFixed(2) || '?'}`;

  if (profitTarget && stopLoss) {
    message += ` | TP: $${profitTarget.toFixed(2)} SL: $${stopLoss.toFixed(2)}`;
  }

  if (reasons && reasons.length > 0) {
    message += ` | ${reasons.slice(0, 3).join(', ')}`;
    if (reasons.length > 3) {
      message += ` (+${reasons.length - 3} more)`;
    }
  }

  return createLogEntry('SIGNAL', message, {
    symbol,
    sessionName,
    signalType: type,
    confidence,
    reasons,
    currentPrice,
    profitTarget,
    stopLoss,
    shouldEnter,
    shouldExit,
    exitScore,
  });
}

/**
 * Log indicator state
 */
function logIndicators(symbol, indicators, sessionName = null) {
  const { rsi, macd, adx, volumeRatio, bbPercentB, vwapPosition } = indicators;

  const parts = [];
  if (rsi !== undefined) parts.push(`RSI:${rsi.toFixed(1)}`);
  if (macd !== undefined) parts.push(`MACD:${macd >= 0 ? '+' : ''}${macd.toFixed(3)}`);
  if (adx !== undefined) parts.push(`ADX:${adx.toFixed(1)}`);
  if (volumeRatio !== undefined) parts.push(`Vol:${volumeRatio.toFixed(2)}x`);
  if (bbPercentB !== undefined) parts.push(`BB%:${(bbPercentB * 100).toFixed(0)}%`);
  if (vwapPosition !== undefined) parts.push(`VWAP:${vwapPosition >= 0 ? '+' : ''}${vwapPosition.toFixed(2)}%`);

  const message = parts.join(' | ');

  return createLogEntry('INDICATOR', message, {
    symbol,
    sessionName,
    indicators,
  });
}

/**
 * Log position update
 */
function logPosition(action, symbol, data) {
  const { quantity, avgCost, currentPrice, unrealizedPnL, unrealizedPnLPercent, sessionName, highWaterMark } = data;

  let message = `${action}: ${quantity} shares @ avg $${avgCost?.toFixed(2) || '?'}`;

  if (currentPrice) {
    message += ` | Now: $${currentPrice.toFixed(2)}`;
  }

  if (unrealizedPnL !== undefined) {
    const pnlStr = unrealizedPnL >= 0 ? `+$${unrealizedPnL.toFixed(2)}` : `-$${Math.abs(unrealizedPnL).toFixed(2)}`;
    const pctStr = unrealizedPnLPercent !== undefined ? ` (${unrealizedPnLPercent >= 0 ? '+' : ''}${unrealizedPnLPercent.toFixed(2)}%)` : '';
    message += ` | Unrealized: ${pnlStr}${pctStr}`;
  }

  if (highWaterMark && highWaterMark > avgCost) {
    message += ` | High: $${highWaterMark.toFixed(2)}`;
  }

  return createLogEntry('INFO', message, {
    symbol,
    sessionName,
    action,
    quantity,
    avgCost,
    currentPrice,
    unrealizedPnL,
    unrealizedPnLPercent,
    highWaterMark,
  });
}

/**
 * Log configuration change
 */
function logConfig(action, data) {
  const { sessionName, field, oldValue, newValue, config } = data;

  let message = action;

  if (field) {
    message += `: ${field} changed from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`;
  }

  return createLogEntry('CONFIG', message, {
    sessionName,
    field,
    oldValue,
    newValue,
    config,
  });
}

/**
 * Log risk management event
 */
function logRisk(event, data) {
  const { sessionName, reason, value, threshold, action } = data;

  let message = event;

  if (reason) {
    message += `: ${reason}`;
  }

  if (value !== undefined && threshold !== undefined) {
    message += ` (${value} vs limit ${threshold})`;
  }

  if (action) {
    message += ` | Action: ${action}`;
  }

  return createLogEntry('RISK', message, {
    sessionName,
    event,
    reason,
    value,
    threshold,
    action,
  });
}

/**
 * Log error
 */
function logError(message, data = {}) {
  const { sessionName, symbol, error, stack } = data;

  let fullMessage = message;
  if (error) {
    fullMessage += `: ${error}`;
  }

  return createLogEntry('ERROR', fullMessage, {
    sessionName,
    symbol,
    error,
    stack,
  });
}

/**
 * Log info message
 */
function logInfo(message, data = {}) {
  return createLogEntry('INFO', message, data);
}

/**
 * Get recent logs
 * @param {object} options - Filter options
 * @returns {Array} Log entries
 */
function getLogs(options = {}) {
  const { limit = 100, level = null, sessionId = null, symbol = null, since = null } = options;

  let filtered = [...logBuffer];

  if (level) {
    const levels = Array.isArray(level) ? level : [level];
    filtered = filtered.filter(log => levels.includes(log.level));
  }

  if (sessionId) {
    filtered = filtered.filter(log => log.sessionId === sessionId || log.sessionName);
  }

  if (symbol) {
    filtered = filtered.filter(log => log.symbol === symbol);
  }

  if (since) {
    const sinceDate = new Date(since);
    filtered = filtered.filter(log => new Date(log.timestamp) >= sinceDate);
  }

  return filtered.slice(-limit);
}

/**
 * Get logs formatted for clipboard/sharing
 * Returns a compact, easy-to-paste format
 */
function getLogsForSharing(options = {}) {
  const logs = getLogs(options);

  const lines = logs.map(formatLogEntry);

  const header = [
    '=== Trading Log Export ===',
    `Generated: ${new Date().toISOString()}`,
    `Entries: ${logs.length}`,
    '========================',
    '',
  ];

  return header.concat(lines).join('\n');
}

/**
 * Clear logs (memory only, file is preserved)
 */
function clearLogs() {
  logBuffer = [];
  logInfo('Log buffer cleared');
}

/**
 * Export logs to JSON file
 */
function exportLogs(filename = null) {
  const exportFile = filename || path.join(LOG_DIR, `trading-log-${Date.now()}.json`);
  fs.writeFileSync(exportFile, JSON.stringify(logBuffer, null, 2));
  return exportFile;
}

module.exports = {
  // Core logging functions
  logExecution,
  logSignal,
  logIndicators,
  logPosition,
  logConfig,
  logRisk,
  logError,
  logInfo,

  // Log retrieval
  getLogs,
  getLogsForSharing,
  clearLogs,
  exportLogs,

  // Constants
  LOG_LEVELS,
};
