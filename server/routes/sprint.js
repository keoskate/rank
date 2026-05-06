const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const {
    transactionCostModel,
    leveragedEtfRules,
    regimeDetector,
    strategyVersionControl,
    regimeAwareConfigStore,
    abTestingEngine,
    strategyMonitor,
    selfImprovementEngine,
    polygonClient,
  } = deps;

  // ================================
  // TRANSACTION COST MODEL APIs
  // ================================

  // Get transaction costs for a symbol
  router.get('/api/costs/:symbol', (req, res) => {
    const { symbol } = req.params;
    const { price } = req.query;

    try {
      const profile = transactionCostModel.getProfile(symbol);
      const roundTripCost = transactionCostModel.getRoundTripCost(
        symbol,
        parseFloat(price) || 100
      );

      res.json({
        symbol: symbol.toUpperCase(),
        profile,
        roundTripCost,
        executionPrices: {
          buy: transactionCostModel.getExecutionPrice(
            symbol,
            parseFloat(price) || 100,
            'BUY'
          ),
          sell: transactionCostModel.getExecutionPrice(
            symbol,
            parseFloat(price) || 100,
            'SELL'
          ),
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all symbol costs
  router.get('/api/costs', (req, res) => {
    try {
      res.json(transactionCostModel.getAllSymbolCosts());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Adjust strategy config for transaction costs
  router.post('/api/costs/adjust', (req, res) => {
    const { symbol, config } = req.body;

    if (!symbol || !config) {
      return res.status(400).json({ error: 'symbol and config required' });
    }

    try {
      const adjusted = transactionCostModel.adjustTargetsForCosts(symbol, config);
      res.json(adjusted);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Apply costs to a trade
  router.post('/api/costs/apply-trade', (req, res) => {
    const { symbol, trade } = req.body;

    if (!symbol || !trade) {
      return res.status(400).json({ error: 'symbol and trade required' });
    }

    try {
      const result = transactionCostModel.applyToTrade(trade, symbol);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // LEVERAGED ETF RULES APIs
  // ================================

  // Check if symbol is leveraged ETF
  router.get('/api/leveraged/:symbol', (req, res) => {
    const { symbol } = req.params;

    try {
      const isLeveraged = leveragedEtfRules.isLeveraged(symbol);
      const info = leveragedEtfRules.getInfo(symbol);

      if (isLeveraged) {
        const decay = leveragedEtfRules.calculateExpectedDecay(symbol, 1);
        const backtest = leveragedEtfRules.getBacktestProxy(symbol);

        res.json({
          symbol: symbol.toUpperCase(),
          isLeveraged: true,
          info,
          decay,
          backtestProxy: backtest,
          rules: leveragedEtfRules.getRulesSummary(),
        });
      } else {
        res.json({
          symbol: symbol.toUpperCase(),
          isLeveraged: false,
          message: `${symbol} is not a leveraged ETF - no special rules apply`,
        });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all leveraged ETFs with their details
  router.get('/api/leveraged', (req, res) => {
    try {
      res.json({
        etfs: leveragedEtfRules.getAllLeveragedEtfs(),
        rules: leveragedEtfRules.getRulesSummary(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Apply leveraged ETF constraints to a trading decision
  router.post('/api/leveraged/apply-constraints', (req, res) => {
    const { symbol, decision, currentTime, currentPosition, vix } = req.body;

    if (!symbol || !decision) {
      return res.status(400).json({ error: 'symbol and decision required' });
    }

    try {
      const time = currentTime ? new Date(currentTime) : new Date();
      const result = leveragedEtfRules.applyConstraints(
        symbol,
        decision,
        time,
        currentPosition,
        vix
      );

      // Add timing info
      result.timing = {
        currentTime: time.toISOString(),
        isMarketHours: leveragedEtfRules.isMarketHours(time),
        timeUntilForcedExit: leveragedEtfRules.getTimeUntilForcedExit(time),
      };

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get expected decay for holding a leveraged ETF
  router.get('/api/leveraged/:symbol/decay', (req, res) => {
    const { symbol } = req.params;
    const { days } = req.query;

    try {
      const decay = leveragedEtfRules.calculateExpectedDecay(
        symbol,
        parseInt(days) || 1
      );

      if (!decay) {
        return res
          .status(404)
          .json({ error: `${symbol} is not a leveraged ETF` });
      }

      res.json(decay);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // REGIME DETECTION APIs
  // ================================

  // Detect current regime for a symbol
  router.get('/api/regime/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { days, date } = req.query;
    const lookbackDays = parseInt(days) || 90;

    try {
      const endDate = date ? new Date(date) : new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - lookbackDays);

      const formatDate = d => d.toISOString().split('T')[0];

      const candles = await polygonClient
        .getHistoricalAggregates(
          symbol,
          formatDate(startDate),
          formatDate(endDate),
          'day'
        )
        .catch(() => []);

      if (!candles || candles.length < 50) {
        return res.status(400).json({
          error: 'Insufficient data for regime detection',
          candlesAvailable: candles?.length || 0,
          required: 50,
        });
      }

      const regime = regimeDetector.detectRegime(candles);
      regime.defaultConfig = regimeDetector.getDefaultConfigForRegime(
        regime.regime
      );

      res.json({
        symbol: symbol.toUpperCase(),
        ...regime,
        dataRange: {
          start: formatDate(startDate),
          end: formatDate(endDate),
          candlesUsed: candles.length,
        },
      });
    } catch (error) {
      console.error(`Error detecting regime for ${symbol}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get regime timeline for visualization
  router.get('/api/regime/:symbol/timeline', async (req, res) => {
    const { symbol } = req.params;
    const { days } = req.query;
    const lookbackDays = parseInt(days) || 180;

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - lookbackDays);

      const formatDate = d => d.toISOString().split('T')[0];

      const candles = await polygonClient
        .getHistoricalAggregates(
          symbol,
          formatDate(startDate),
          formatDate(endDate),
          'day'
        )
        .catch(() => []);

      if (!candles || candles.length < 60) {
        return res.status(400).json({
          error: 'Insufficient data for timeline',
          candlesAvailable: candles?.length || 0,
          required: 60,
        });
      }

      const timeline = regimeDetector.getRegimeTimeline(candles);
      const analysis = regimeDetector.analyzeRegimes(timeline);

      res.json({
        symbol: symbol.toUpperCase(),
        timeline,
        analysis,
        dataRange: {
          start: formatDate(startDate),
          end: formatDate(endDate),
          totalDays: candles.length,
        },
      });
    } catch (error) {
      console.error(`Error getting regime timeline for ${symbol}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Detect regime from provided candles (for backtesting)
  router.post('/api/regime/detect', (req, res) => {
    const { candles, options } = req.body;

    if (!candles || !Array.isArray(candles)) {
      return res.status(400).json({ error: 'candles array required' });
    }

    try {
      const regime = regimeDetector.detectRegime(candles, options);
      regime.defaultConfig = regimeDetector.getDefaultConfigForRegime(
        regime.regime
      );
      res.json(regime);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get default config for a specific regime
  router.get('/api/regime/config/:regime', (req, res) => {
    const { regime } = req.params;

    const validRegimes = ['bull', 'bear', 'sideways'];
    if (!validRegimes.includes(regime.toLowerCase())) {
      return res.status(400).json({
        error: `Invalid regime. Must be one of: ${validRegimes.join(', ')}`,
      });
    }

    try {
      const config = regimeDetector.getDefaultConfigForRegime(
        regime.toLowerCase()
      );
      const recommendation = regimeDetector.getStrategyRecommendation(
        regime.toLowerCase(),
        'moderate',
        0.015
      );

      res.json({
        regime: regime.toLowerCase(),
        config,
        recommendation,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // STRATEGY VERSION CONTROL ENDPOINTS (Sprint 2)
  // ================================

  // Get all versions for a symbol
  router.get('/api/versions/:symbol', (req, res) => {
    try {
      const { symbol } = req.params;
      const versions = strategyVersionControl.getVersions(symbol);
      res.json(versions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all symbols with versions
  router.get('/api/versions', (req, res) => {
    try {
      const symbols = strategyVersionControl.getAllSymbols();
      res.json({ symbols });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new version
  router.post('/api/versions/:symbol', (req, res) => {
    try {
      const { symbol } = req.params;
      const { config, description, tag, metrics, walkForwardResults } = req.body;

      if (!config) {
        return res.status(400).json({ error: 'Config is required' });
      }

      const result = strategyVersionControl.createVersion(symbol, config, {
        description,
        tag,
        metrics,
        walkForwardResults,
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific version
  router.get('/api/versions/:symbol/:versionId', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const version = strategyVersionControl.getVersion(symbol, versionId);

      if (!version) {
        return res.status(404).json({ error: 'Version not found' });
      }

      res.json(version);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get active config for a symbol
  router.get('/api/versions/:symbol/active/config', (req, res) => {
    try {
      const { symbol } = req.params;
      const config = strategyVersionControl.getActiveConfig(symbol);

      if (!config) {
        return res.status(404).json({ error: 'No active config found' });
      }

      res.json({ symbol: symbol.toUpperCase(), config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get production config for a symbol
  router.get('/api/versions/:symbol/production/config', (req, res) => {
    try {
      const { symbol } = req.params;
      const config = strategyVersionControl.getProductionConfig(symbol);

      if (!config) {
        return res.status(404).json({ error: 'No production config found' });
      }

      res.json({ symbol: symbol.toUpperCase(), config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Set active version
  router.put('/api/versions/:symbol/active', (req, res) => {
    try {
      const { symbol } = req.params;
      const { versionId } = req.body;

      if (!versionId) {
        return res.status(400).json({ error: 'versionId is required' });
      }

      const result = strategyVersionControl.setActiveVersion(symbol, versionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Promote version to production
  router.put('/api/versions/:symbol/promote', (req, res) => {
    try {
      const { symbol } = req.params;
      const { versionId } = req.body;

      if (!versionId) {
        return res.status(400).json({ error: 'versionId is required' });
      }

      const result = strategyVersionControl.promoteToProduction(
        symbol,
        versionId
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rollback to a previous version
  router.post('/api/versions/:symbol/rollback', (req, res) => {
    try {
      const { symbol } = req.params;
      const { versionId } = req.body;

      if (!versionId) {
        return res.status(400).json({ error: 'versionId is required' });
      }

      const result = strategyVersionControl.rollback(symbol, versionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update metrics for a version
  router.put('/api/versions/:symbol/:versionId/metrics', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const { metrics } = req.body;

      if (!metrics) {
        return res.status(400).json({ error: 'metrics is required' });
      }

      const result = strategyVersionControl.updateMetrics(
        symbol,
        versionId,
        metrics
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Compare two versions
  router.get('/api/versions/:symbol/compare', (req, res) => {
    try {
      const { symbol } = req.params;
      const { versionA, versionB } = req.query;

      if (!versionA || !versionB) {
        return res
          .status(400)
          .json({ error: 'versionA and versionB query params required' });
      }

      const result = strategyVersionControl.compareVersions(
        symbol,
        versionA,
        versionB
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Clone a version
  router.post('/api/versions/:symbol/:versionId/clone', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const { modifications, description, tag } = req.body;

      const result = strategyVersionControl.cloneVersion(
        symbol,
        versionId,
        modifications,
        {
          description,
          tag,
        }
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Archive a version
  router.delete('/api/versions/:symbol/:versionId', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const result = strategyVersionControl.archiveVersion(symbol, versionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // REGIME-AWARE CONFIG STORE ENDPOINTS
  // ================================

  // Get config for symbol (optionally with regime adjustment)
  router.get('/api/config/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { regime, applyAdjustments } = req.query;

      const config = regimeAwareConfigStore.getConfig(
        symbol,
        regime || null,
        applyAdjustments !== 'false'
      );

      res.json({ symbol: symbol.toUpperCase(), config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get config with live regime detection
  router.post('/api/config/:symbol/detect', async (req, res) => {
    try {
      const { symbol } = req.params;
      let { candles } = req.body;

      // If no candles provided, fetch recent data
      if (!candles || candles.length === 0) {
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
        candles = await polygonClient.getHistoricalAggregates(
          symbol,
          startDate,
          endDate,
          'day'
        );
      }

      const result = regimeAwareConfigStore.getConfigWithDetection(
        symbol,
        candles
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Set base config for a symbol
  router.post('/api/config/:symbol/base', (req, res) => {
    try {
      const { symbol } = req.params;
      const { config } = req.body;

      if (!config) {
        return res.status(400).json({ error: 'config is required' });
      }

      const result = regimeAwareConfigStore.setBaseConfig(symbol, config);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Set regime-specific config for a symbol
  router.post('/api/config/:symbol/regime/:regime', (req, res) => {
    try {
      const { symbol, regime } = req.params;
      const { config } = req.body;

      if (!config) {
        return res.status(400).json({ error: 'config is required' });
      }

      const result = regimeAwareConfigStore.setRegimeConfig(
        symbol,
        regime,
        config
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all configs for a symbol
  router.get('/api/config/:symbol/all', (req, res) => {
    try {
      const { symbol } = req.params;
      const configs = regimeAwareConfigStore.getAllConfigs(symbol);
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Preview regime configs
  router.get('/api/config/:symbol/preview', (req, res) => {
    try {
      const { symbol } = req.params;
      const preview = regimeAwareConfigStore.previewRegimeConfigs(symbol);
      res.json(preview);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Enable/disable regime adaptation
  router.put('/api/config/:symbol/adaptation', (req, res) => {
    try {
      const { symbol } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled (boolean) is required' });
      }

      const result = regimeAwareConfigStore.setRegimeAdaptation(symbol, enabled);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get config store summary
  router.get('/api/config', (req, res) => {
    try {
      const summary = regimeAwareConfigStore.getSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete config for a symbol
  router.delete('/api/config/:symbol', (req, res) => {
    try {
      const { symbol } = req.params;
      const result = regimeAwareConfigStore.deleteConfig(symbol);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // A/B TESTING ENDPOINTS (Sprint 3)
  // ================================

  router.get('/api/ab-tests', (req, res) => {
    try {
      const tests = abTestingEngine.getAllTests();
      res.json({ tests, count: tests.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ab-tests/active', (req, res) => {
    try {
      const tests = abTestingEngine.getActiveTests();
      res.json({ tests, count: tests.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ab-tests/symbol/:symbol', (req, res) => {
    try {
      const { symbol } = req.params;
      const tests = abTestingEngine.getTestsForSymbol(symbol);
      res.json({ symbol: symbol.toUpperCase(), tests, count: tests.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ab-tests', (req, res) => {
    try {
      const {
        name,
        symbol,
        variants,
        primaryMetric,
        minTrades,
        confidenceThreshold,
        description,
      } = req.body;

      if (!name || !symbol || !variants || variants.length < 2) {
        return res.status(400).json({
          error: 'name, symbol, and at least 2 variants are required',
        });
      }

      const result = abTestingEngine.createTest({
        name,
        symbol,
        variants,
        primaryMetric,
        minTrades,
        confidenceThreshold,
        description,
      });

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ab-tests/:testId', (req, res) => {
    try {
      const { testId } = req.params;
      const test = abTestingEngine.getTest(testId);
      if (!test) {
        return res.status(404).json({ error: 'Test not found' });
      }
      res.json(test);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ab-tests/:testId/summary', (req, res) => {
    try {
      const { testId } = req.params;
      const summary = abTestingEngine.getTestSummary(testId);
      if (!summary) {
        return res.status(404).json({ error: 'Test not found' });
      }
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ab-tests/:testId/start', (req, res) => {
    try {
      const { testId } = req.params;
      const result = abTestingEngine.startTest(testId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ab-tests/:testId/pause', (req, res) => {
    try {
      const { testId } = req.params;
      const result = abTestingEngine.pauseTest(testId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ab-tests/:testId/cancel', (req, res) => {
    try {
      const { testId } = req.params;
      const result = abTestingEngine.cancelTest(testId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ab-tests/:testId/variants/:variantId/trade', (req, res) => {
    try {
      const { testId, variantId } = req.params;
      const trade = req.body;
      if (!trade || typeof trade.pnl === 'undefined') {
        return res.status(400).json({ error: 'Trade with pnl is required' });
      }
      const result = abTestingEngine.recordTrade(testId, variantId, trade);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ab-tests/:testId/variants/:variantId/backtest', (req, res) => {
    try {
      const { testId, variantId } = req.params;
      const { trades } = req.body;
      if (!trades || !Array.isArray(trades)) {
        return res.status(400).json({ error: 'trades array is required' });
      }
      const result = abTestingEngine.recordBacktestResults(
        testId,
        variantId,
        trades
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ab-tests/:testId/evaluate', (req, res) => {
    try {
      const { testId } = req.params;
      const result = abTestingEngine.evaluateTest(testId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ab-tests/:testId/declare-winner', (req, res) => {
    try {
      const { testId } = req.params;
      const { variantId } = req.body;
      const result = abTestingEngine.declareWinner(testId, variantId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ab-tests/:testId/clone', (req, res) => {
    try {
      const { testId } = req.params;
      const { newName } = req.body;
      const result = abTestingEngine.cloneTest(testId, newName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/api/ab-tests/:testId', (req, res) => {
    try {
      const { testId } = req.params;
      const result = abTestingEngine.deleteTest(testId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // STRATEGY MONITOR ENDPOINTS (Sprint 3)
  // ================================

  router.get('/api/monitors', (req, res) => {
    try {
      const monitors = strategyMonitor.getActiveMonitors();
      res.json({ monitors, count: monitors.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/monitors/symbol/:symbol', (req, res) => {
    try {
      const { symbol } = req.params;
      const monitors = strategyMonitor.getMonitorsForSymbol(symbol);
      res.json({
        symbol: symbol.toUpperCase(),
        monitors,
        count: monitors.length,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/monitors/:symbol/:versionId/start', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const { thresholds, historicalMetrics, startingEquity } = req.body;
      const result = strategyMonitor.startMonitoring(symbol, versionId, {
        thresholds,
        historicalMetrics,
        startingEquity,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/monitors/:symbol/:versionId/stop', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const result = strategyMonitor.stopMonitoring(symbol, versionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/monitors/:symbol/:versionId', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const monitor = strategyMonitor.getMonitor(symbol, versionId);
      if (!monitor) {
        return res.status(404).json({ error: 'Monitor not found' });
      }
      res.json(monitor);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/monitors/:symbol/:versionId/report', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const report = strategyMonitor.getPerformanceReport(symbol, versionId);
      if (!report) {
        return res.status(404).json({ error: 'Monitor not found' });
      }
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/monitors/:symbol/:versionId/daily', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const { date } = req.query;
      const summary = strategyMonitor.getDailySummary(symbol, versionId, date);
      if (!summary) {
        return res.status(404).json({ error: 'Monitor not found' });
      }
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/monitors/:symbol/:versionId/trade', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const trade = req.body;
      if (!trade || typeof trade.pnl === 'undefined') {
        return res.status(400).json({ error: 'Trade with pnl is required' });
      }
      const result = strategyMonitor.recordTrade(symbol, versionId, trade);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/monitors/alerts', (req, res) => {
    try {
      const { symbol, versionId } = req.query;
      const alerts = strategyMonitor.getUnacknowledgedAlerts(symbol, versionId);
      res.json({ alerts, count: alerts.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post(
    '/api/monitors/:symbol/:versionId/alerts/:alertId/acknowledge',
    (req, res) => {
      try {
        const { symbol, versionId, alertId } = req.params;
        const result = strategyMonitor.acknowledgeAlert(
          symbol,
          versionId,
          alertId
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }
  );

  router.put('/api/monitors/:symbol/:versionId/thresholds', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const { thresholds } = req.body;
      if (!thresholds) {
        return res.status(400).json({ error: 'thresholds object is required' });
      }
      const result = strategyMonitor.updateThresholds(
        symbol,
        versionId,
        thresholds
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/monitors/:symbol/:versionId/baseline', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const { metrics } = req.body;
      if (!metrics) {
        return res.status(400).json({ error: 'metrics object is required' });
      }
      const result = strategyMonitor.setHistoricalBaseline(
        symbol,
        versionId,
        metrics
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/monitors/:symbol/:versionId/reset', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const result = strategyMonitor.resetMonitor(symbol, versionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/api/monitors/:symbol/:versionId', (req, res) => {
    try {
      const { symbol, versionId } = req.params;
      const result = strategyMonitor.deleteMonitor(symbol, versionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // SELF-IMPROVEMENT ENGINE ENDPOINTS
  // ================================

  router.get('/api/ai/improvements', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      res.json(selfImprovementEngine.getHistory(limit, offset));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ai/improvements/latest', (req, res) => {
    try {
      const latest = selfImprovementEngine.getLatestCycle();
      res.json({ success: true, cycle: latest });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ai/improvements/status', (req, res) => {
    try {
      res.json({ success: true, ...selfImprovementEngine.getStatus() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ai/improvements/revert/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      const result = selfImprovementEngine.manualRevert(sessionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ai/improvements/run-now', async (req, res) => {
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const result = await selfImprovementEngine.runNightlyCycle(dateStr);
      res.json({ success: true, cycle: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // TOURNAMENT ENDPOINTS
  // ================================

  router.post('/api/ai/tournament/start', (req, res) => {
    try {
      const { preset, count, baseOverrides, liveSessionId } = req.body;
      const result = selfImprovementEngine.startTournament({
        preset,
        count,
        baseOverrides,
        liveSessionId,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/ai/tournament/stop', (req, res) => {
    try {
      const { keepBest } = req.body;
      const result = selfImprovementEngine.stopTournament({ keepBest });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ai/tournament/status', (req, res) => {
    try {
      res.json({ success: true, ...selfImprovementEngine.getTournamentStatus() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ai/tournament/scoreboard', (req, res) => {
    try {
      res.json(selfImprovementEngine.getScoreboard());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/ai/tournament/daily/:date', (req, res) => {
    try {
      const { date } = req.params;
      const report = selfImprovementEngine.getDailyReport(date);
      if (!report) {
        return res.status(404).json({ error: `No data for ${date}` });
      }
      res.json({ success: true, ...report });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
