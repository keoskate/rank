/**
 * Semiconductor Auto Trader
 *
 * Automatically manages SOXL/SOXS trading sessions based on
 * real-time semiconductor sentiment. No manual intervention required.
 *
 * - Monitors SOXX sentiment continuously
 * - Starts SOXL session on bullish days
 * - Starts SOXS session on bearish days
 * - Switches automatically when direction changes
 * - Respects market phases and time restrictions
 */

const { SemiconductorSentimentEngine } = require('./semiconductorSentiment');

class SemiconductorAutoTrader {
  constructor(aiTradingEngine, options = {}) {
    this.aiEngine = aiTradingEngine;
    this.sentimentEngine = new SemiconductorSentimentEngine();

    // Configuration
    this.config = {
      enabled: false,
      userId: 'default_user',
      checkIntervalMs: 30000,        // Check every 30 seconds
      minConfidenceToStart: 65,      // Min confidence to start a session
      minConfidenceToSwitch: 70,     // Min confidence to switch direction
      autoTrade: false,              // Safety: manual trade execution by default
      ...options,
    };

    // State
    this.currentSession = null;
    this.currentDirection = null;
    this.checkInterval = null;
    this.lastCheck = null;
    this.stats = {
      checks: 0,
      sessionsStarted: 0,
      directionSwitches: 0,
      lastActivity: null,
    };

    // Activity log (last 50 entries)
    this.activityLog = [];
  }

  /**
   * Log activity
   */
  log(message, type = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      message,
      type,
    };
    this.activityLog.unshift(entry);
    if (this.activityLog.length > 50) {
      this.activityLog.pop();
    }
    console.log(`[SemiAutoTrader] [${type.toUpperCase()}] ${message}`);
    this.stats.lastActivity = entry;
  }

  /**
   * Start the auto-trader
   */
  start() {
    if (this.checkInterval) {
      this.log('Already running', 'warn');
      return { success: false, message: 'Already running' };
    }

    this.config.enabled = true;
    this.log('Starting semiconductor auto-trader');

    // Run immediately, then on interval
    this.checkAndTrade();
    this.checkInterval = setInterval(() => this.checkAndTrade(), this.config.checkIntervalMs);

    return { success: true, message: 'Auto-trader started' };
  }

  /**
   * Stop the auto-trader
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.config.enabled = false;
    this.log('Stopped semiconductor auto-trader');

    return { success: true, message: 'Auto-trader stopped' };
  }

  /**
   * Main check and trade logic
   */
  async checkAndTrade() {
    if (!this.config.enabled) return;

    this.stats.checks++;
    this.lastCheck = new Date().toISOString();

    try {
      // Get current sentiment
      const sentiment = await this.sentimentEngine.getSentiment(true); // Force refresh

      // Check if trading is allowed in current phase
      if (!sentiment.tradingAllowed) {
        this.log(`Trading not allowed: ${sentiment.phaseDescription}`, 'info');
        return;
      }

      // Check market phase restrictions
      if (sentiment.phase === 'OPEN' || sentiment.phase === 'SETTLE') {
        this.log(`Waiting for market to settle (${sentiment.phase})`, 'info');
        return;
      }

      // Force exit in CLOSE phase
      if (sentiment.phase === 'CLOSE' && this.currentSession) {
        await this.stopCurrentSession('Market close - force exit');
        return;
      }

      // Wind down phase - exit SOXS positions
      if (sentiment.phase === 'WIND_DOWN' && this.currentDirection === 'bearish') {
        await this.stopCurrentSession('Wind down phase - exiting SOXS');
        return;
      }

      const { direction, confidence, canTrade } = sentiment;

      // Log current state
      this.log(`Sentiment: ${direction} (${confidence}%), Current: ${this.currentDirection || 'none'}`, 'debug');

      // No position and sentiment is tradeable
      if (!this.currentSession && canTrade && confidence >= this.config.minConfidenceToStart) {
        await this.startSession(direction, sentiment);
        return;
      }

      // Have position but direction changed
      if (this.currentSession && direction !== this.currentDirection && direction !== 'neutral') {
        if (confidence >= this.config.minConfidenceToSwitch) {
          this.log(`Direction change detected: ${this.currentDirection} -> ${direction} (${confidence}%)`);
          await this.switchDirection(direction, sentiment);
          return;
        } else {
          this.log(`Direction changing but confidence too low (${confidence}% < ${this.config.minConfidenceToSwitch}%)`, 'info');
        }
      }

      // Have position and direction went neutral - consider exiting
      if (this.currentSession && direction === 'neutral' && confidence < 40) {
        this.log(`Direction lost confidence, exiting position`);
        await this.stopCurrentSession('Sentiment turned neutral');
        return;
      }

    } catch (error) {
      this.log(`Error in check cycle: ${error.message}`, 'error');
    }
  }

  /**
   * Start a new session based on direction
   */
  async startSession(direction, sentiment) {
    const presetName = direction === 'bullish' ? 'SOXL_MOMENTUM' : 'SOXS_HEDGE';

    // Check SOXS time restriction
    if (direction === 'bearish') {
      const phase = this.sentimentEngine.phaseTracker.getCurrentPhase();
      if (phase.currentTimeET >= 14.5) {
        this.log('SOXS blocked: After 2:30 PM ET cutoff', 'warn');
        return;
      }
    }

    try {
      const preset = this.aiEngine.getStrategyPreset(presetName);
      if (!preset) {
        this.log(`Preset ${presetName} not found`, 'error');
        return;
      }

      // Create session with auto-trade setting from config
      const session = await this.aiEngine.createSession(this.config.userId, {
        ...preset.config,
        autoTrade: this.config.autoTrade,
      });

      this.currentSession = session;
      this.currentDirection = direction;
      this.stats.sessionsStarted++;

      this.log(`Started ${presetName} session: ${session.id} (autoTrade: ${this.config.autoTrade})`, 'success');

    } catch (error) {
      this.log(`Failed to start session: ${error.message}`, 'error');
    }
  }

  /**
   * Stop current session
   */
  async stopCurrentSession(reason) {
    if (!this.currentSession) return;

    try {
      await this.aiEngine.stopSession(this.currentSession.id);
      this.log(`Stopped session ${this.currentSession.id}: ${reason}`, 'info');

      this.currentSession = null;
      this.currentDirection = null;

    } catch (error) {
      this.log(`Failed to stop session: ${error.message}`, 'error');
    }
  }

  /**
   * Switch direction - stop current, start new
   */
  async switchDirection(newDirection, sentiment) {
    this.stats.directionSwitches++;

    await this.stopCurrentSession(`Switching to ${newDirection}`);

    // Small delay before starting new session
    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.startSession(newDirection, sentiment);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      running: !!this.checkInterval,
      currentSession: this.currentSession ? {
        id: this.currentSession.id,
        name: this.currentSession.config?.name,
        direction: this.currentDirection,
      } : null,
      config: {
        checkIntervalMs: this.config.checkIntervalMs,
        minConfidenceToStart: this.config.minConfidenceToStart,
        minConfidenceToSwitch: this.config.minConfidenceToSwitch,
        autoTrade: this.config.autoTrade,
      },
      stats: this.stats,
      lastCheck: this.lastCheck,
      recentActivity: this.activityLog.slice(0, 10),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    const allowedKeys = ['minConfidenceToStart', 'minConfidenceToSwitch', 'autoTrade', 'checkIntervalMs'];

    for (const key of allowedKeys) {
      if (newConfig[key] !== undefined) {
        this.config[key] = newConfig[key];
        this.log(`Config updated: ${key} = ${newConfig[key]}`);
      }
    }

    // Restart interval if changed
    if (newConfig.checkIntervalMs && this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = setInterval(() => this.checkAndTrade(), this.config.checkIntervalMs);
    }

    return this.config;
  }
}

module.exports = { SemiconductorAutoTrader };
