/**
 * MVP SERVER MODULES - Critical Trading Logic
 *
 * These files require HIGH RIGOR before changes:
 * - Full testing before merging
 * - Code review for trading logic
 * - Consider edge cases and error handling
 * - Test with paper trading before live
 *
 * ============================================
 * TIER 1 - CRITICAL PATH (Must be stable)
 * ============================================
 *
 * aiTradingEngine.js (2,732 lines)
 *   - Core autonomous trading system
 *   - Manages buy/sell decisions, sessions, positions
 *   - Regime-aware ETF trading
 *   - Entry context tracking for ML
 *
 * alpacaClient.js (1,142 lines)
 *   - Alpaca API integration for trading
 *   - Order execution, position management
 *   - Account status and portfolio queries
 *
 * index.js (7,020 lines)
 *   - Express server with all API endpoints
 *   - WebSocket server for real-time updates
 *   - Route handlers for trading operations
 *
 * ============================================
 * TIER 2 - HIGH IMPACT (Important for accuracy)
 * ============================================
 *
 * technicalIndicatorsService.js (675 lines)
 *   - Technical indicator calculations
 *   - RSI, MACD, Bollinger Bands, etc.
 *
 * regimeDetector.js
 *   - Market regime detection (bullish/bearish/neutral)
 *   - Drives ETF selection (TQQQ vs SQQQ)
 *
 * strategyBacktester.js (765 lines)
 *   - Strategy validation engine
 *   - Backtesting with historical data
 *
 * enhancedBacktestEngine.js (919 lines)
 *   - Multi-day backtest support
 *   - Used by Strategy Validator panel
 *
 * polygonClient.js (785 lines)
 *   - Polygon API for market data
 *   - Price quotes, aggregates, news
 *
 * ============================================
 * TIER 3 - SUPPORTING (Important but secondary)
 * ============================================
 *
 * websocketServer.js
 *   - Real-time updates to frontend
 *   - Trading log emissions
 *
 * tradingLogger.js
 *   - Diagnostics and logging
 *
 * strategyMonitor.js (670 lines)
 *   - Real-time strategy performance tracking
 *
 * leveragedEtfStrategy.js / leveragedEtfRules.js
 *   - Leveraged ETF specific logic
 *
 * regimeAwareConfigStore.js
 *   - Regime-aware strategy configuration
 *
 * cheddarFlowScraper.js (866 lines)
 *   - CheddarFlow signal scraping
 *
 * ============================================
 * NON-MVP (Can be modified freely)
 * ============================================
 *
 * - walkForwardOptimizer.js (optimization tools)
 * - abTestingEngine.js (A/B testing framework)
 * - overnightOptimizer.js (overnight optimization)
 * - strategyVersionControl.js (versioning)
 * - patternRecognitionService.js (ML patterns)
 * - transactionCostModel.js (cost modeling)
 * - snapshotManager.js (historical snapshots)
 * - unusualWhalesClient.js (external API)
 */

// This file is documentation only - not executable code
module.exports = {
  tier1: [
    'aiTradingEngine.js',
    'alpacaClient.js',
    'index.js',
  ],
  tier2: [
    'technicalIndicatorsService.js',
    'regimeDetector.js',
    'strategyBacktester.js',
    'enhancedBacktestEngine.js',
    'polygonClient.js',
  ],
  tier3: [
    'websocketServer.js',
    'tradingLogger.js',
    'strategyMonitor.js',
    'leveragedEtfStrategy.js',
    'leveragedEtfRules.js',
    'regimeAwareConfigStore.js',
    'cheddarFlowScraper.js',
  ],
};
