const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { backtestEngine, enhancedBacktestEngine, walkForwardOptimizer, regimeAwareConfigStore, polygonClient, WalkForwardOptimizer } = deps;

  // 30. Run backtest
  router.post('/api/backtest/run', async (req, res) => {
    try {
      const {
        startDate,
        endDate,
        topN = 5,
        rebalanceFrequency = 'daily',
        initialCapital = 100000,
      } = req.body;

      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ error: 'startDate and endDate are required' });
      }

      console.log(
        `🧪 Running backtest: ${startDate} to ${endDate}, top ${topN}, ${rebalanceFrequency}`
      );

      const results = await backtestEngine.backtestTopNStrategy({
        startDate,
        endDate,
        topN,
        rebalanceFrequency,
        initialCapital,
      });

      console.log(
        `✅ Backtest completed: ${results.performance.totalReturn.toFixed(2)}% return`
      );

      res.json({
        success: true,
        results,
        message: 'Backtest completed successfully',
      });
    } catch (error) {
      console.error('❌ Error running backtest:', error.message);
      res.status(500).json({ error: error.message || 'Failed to run backtest' });
    }
  });

  // Run enhanced backtest with what-if scenarios
  router.post('/api/backtest/enhanced', async (req, res) => {
    try {
      const result = await enhancedBacktestEngine.runEnhancedBacktest(req.body);
      res.json(result);
    } catch (error) {
      console.error('Error running enhanced backtest:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Run what-if scenario
  router.post('/api/backtest/what-if', async (req, res) => {
    try {
      const result = await enhancedBacktestEngine.runEnhancedBacktest(req.body);
      res.json({
        whatIfResults: result.whatIfResults,
        recommendations: result.recommendations,
      });
    } catch (error) {
      console.error('Error running what-if analysis:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Optimize strategy parameters
  router.post('/api/backtest/optimize', async (req, res) => {
    try {
      const result = await enhancedBacktestEngine.optimizeStrategy(req.body);
      res.json(result);
    } catch (error) {
      console.error('Error optimizing strategy:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Run Monte Carlo simulation
  router.post('/api/backtest/monte-carlo', async (req, res) => {
    try {
      const { trades, simulations = 1000 } = req.body;
      const result = enhancedBacktestEngine.runMonteCarloSimulation(
        trades,
        simulations
      );
      res.json(result);
    } catch (error) {
      console.error('Error running Monte Carlo:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Run walk-forward optimization
  router.post('/api/optimize/walk-forward', async (req, res) => {
    try {
      const { symbol, baseStrategy, historicalData, options } = req.body;

      if (!symbol) {
        return res.status(400).json({ error: 'symbol is required' });
      }

      // Get historical data if not provided
      let data = historicalData;
      if (!data || data.length === 0) {
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
        const candles = await polygonClient.getHistoricalAggregates(
          symbol,
          startDate,
          endDate,
          'day'
        );
        data = candles.map(c => ({ date: c.date || c.t, ...c }));
      }

      // Create optimizer with custom options if provided
      const optimizer = options
        ? new WalkForwardOptimizer(options)
        : walkForwardOptimizer;

      // Define backtest function using existing backtest engine
      const backtestFn = async (config, windowData) => {
        const result = await backtestEngine.runBacktest({
          symbol,
          ...config,
          historicalData: windowData,
        });
        return {
          trades: result.trades || [],
          metrics: result.metrics || {},
        };
      };

      const result = await optimizer.runOptimization(
        data,
        baseStrategy || regimeAwareConfigStore.getDefaultConfig(),
        backtestFn
      );

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Quick validation
  router.post('/api/optimize/quick-validate', async (req, res) => {
    try {
      const { symbol, config, historicalData } = req.body;

      if (!symbol || !config) {
        return res.status(400).json({ error: 'symbol and config are required' });
      }

      // Get historical data if not provided
      let data = historicalData;
      if (!data || data.length === 0) {
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
        const candles = await polygonClient.getHistoricalAggregates(
          symbol,
          startDate,
          endDate,
          'day'
        );
        data = candles.map(c => ({ date: c.date || c.t, ...c }));
      }

      // Define backtest function
      const backtestFn = async (cfg, windowData) => {
        const result = await backtestEngine.runBacktest({
          symbol,
          ...cfg,
          historicalData: windowData,
        });
        return {
          trades: result.trades || [],
          metrics: result.metrics || {},
        };
      };

      const result = await walkForwardOptimizer.quickValidation(
        data,
        config,
        backtestFn
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get optimizer default parameter ranges
  router.get('/api/optimize/parameters', (req, res) => {
    try {
      const ranges = walkForwardOptimizer.getDefaultParameterRanges();
      res.json({ parameterRanges: ranges });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
