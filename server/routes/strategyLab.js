const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const {
    polygonClient,
    regimeAwareConfigStore,
    strategyVersionControl,
    overnightOptimizer,
    historicalDataManager,
    regimeDetector,
    getCachedHistoricalData,
    assetUtils,
    strategyBacktester,
    watchlistRegimeDetector,
  } = deps;

  // Run simulation on a specific day
  router.post('/api/backtest/day-simulation', async (req, res) => {
    try {
      const { symbol, date, config } = req.body;

      if (!symbol || !date) {
        return res.status(400).json({ error: 'symbol and date are required' });
      }

      // Fetch intraday data for the specified date
      const candles = await getCachedHistoricalData(symbol, date, 'minute');

      if (!candles || candles.length === 0) {
        return res
          .status(404)
          .json({ error: `No intraday data found for ${symbol} on ${date}` });
      }

      // Run the simulation bar-by-bar
      const trades = [];
      let position = null;
      let equity = 10000; // Starting capital
      const strategyConfig = config || regimeAwareConfigStore.getDefaultConfig();

      // Calculate indicators for each candle
      const closes = candles.map(c => c.close);

      // Simple RSI calculation
      const rsiPeriod = 14;
      const calculateRSI = (values, period, index) => {
        if (index < period) return 50;
        const slice = values.slice(index - period, index);
        let gains = 0,
          losses = 0;
        for (let i = 1; i < slice.length; i++) {
          const change = slice[i] - slice[i - 1];
          if (change > 0) gains += change;
          else losses -= change;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - 100 / (1 + rs);
      };

      // Process each candle
      for (let i = 20; i < candles.length; i++) {
        const candle = candles[i];
        const price = candle.close;
        const rsi = calculateRSI(closes, rsiPeriod, i);
        const time = candle.timestamp || candle.date || candle.t;

        // Check for exit if in position
        if (position) {
          const pnl = (price - position.entryPrice) * position.shares;
          const pnlPercent =
            ((price - position.entryPrice) / position.entryPrice) * 100;
          const mfe = Math.max(position.mfe || 0, pnlPercent);
          const mae = Math.min(position.mae || 0, pnlPercent);
          position.mfe = mfe;
          position.mae = mae;

          // Check exit conditions
          let exitReason = null;
          if (pnlPercent >= strategyConfig.takeProfitPercent) {
            exitReason = 'Take Profit';
          } else if (pnlPercent <= -strategyConfig.stopLossPercent) {
            exitReason = 'Stop Loss';
          } else if (rsi > 70 && pnlPercent > 0) {
            exitReason = 'RSI Overbought Exit';
          }

          // End of day exit
          const isLastCandle = i >= candles.length - 5;
          if (isLastCandle && !exitReason) {
            exitReason = 'End of Day';
          }

          if (exitReason) {
            const trade = {
              entryTime: position.entryTime,
              entryPrice: position.entryPrice,
              exitTime: time,
              exitPrice: price,
              shares: position.shares,
              side: 'BUY',
              pnl: pnl,
              pnlPercent: pnlPercent,
              mfe: position.mfe,
              mae: position.mae,
              exitReason,
            };
            trades.push(trade);
            equity += pnl;
            position = null;
          }
        }

        // Check for entry if not in position
        if (!position && i < candles.length - 30) {
          // Don't enter near end of day
          const rsiInRange =
            rsi >= strategyConfig.entryRsiMin &&
            rsi <= strategyConfig.entryRsiMax;

          // Simple momentum check - price above recent MA
          const recentCloses = closes.slice(Math.max(0, i - 20), i);
          const ma20 =
            recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
          const aboveMA = price > ma20;

          // Volume check - current volume above average
          const volumes = candles
            .slice(Math.max(0, i - 20), i)
            .map(c => c.volume || c.v || 0);
          const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
          const currentVolume = candle.volume || candle.v || 0;
          const goodVolume = currentVolume > avgVolume * 0.8;

          if (rsiInRange && aboveMA && goodVolume) {
            // Detect if this is a crypto symbol (use fractional shares for high-priced assets)
            const upperSym = symbol.toUpperCase();
            const isCryptoSym =
              assetUtils.CRYPTO_BASE_TO_PAIR[upperSym] ||
              upperSym.includes('/USD') ||
              upperSym.startsWith('X:');

            // Use fractional shares for crypto, whole shares for stocks
            const positionValue = equity * (strategyConfig.positionSizePercent / 100);
            const shares = isCryptoSym
              ? positionValue / price  // Fractional for crypto
              : Math.floor(positionValue / price);  // Whole shares for stocks

            if (shares > 0) {
              position = {
                entryTime: time,
                entryPrice: price,
                shares,
                mfe: 0,
                mae: 0,
              };
            }
          }
        }
      }

      // Calculate summary metrics
      const wins = trades.filter(t => t.pnl > 0);
      const losses = trades.filter(t => t.pnl <= 0);
      const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
      const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

      const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
      const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
      const profitFactor =
        grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

      res.json({
        success: true,
        symbol,
        date,
        trades,
        totalPnl,
        winRate,
        tradeCount: trades.length,
        wins: wins.length,
        losses: losses.length,
        profitFactor,
        grossProfit,
        grossLoss,
        config: strategyConfig,
        candleCount: candles.length,
      });
    } catch (error) {
      console.error('Error in day simulation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Run simulation on random unseen days
  router.post('/api/backtest/random-days', async (req, res) => {
    try {
      const { symbol, config, numDays = 5, startDate, endDate } = req.body;

      if (!symbol) {
        return res.status(400).json({ error: 'symbol is required' });
      }

      // Get available trading days
      const start =
        startDate ||
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
      const end = endDate || new Date().toISOString().split('T')[0];

      // Fetch daily data to find valid trading days
      const dailyCandles = await polygonClient.getHistoricalAggregates(
        symbol,
        start,
        end,
        'day'
      );
      if (!dailyCandles || dailyCandles.length === 0) {
        return res
          .status(404)
          .json({
            error: `No historical data found for ${symbol} between ${start} and ${end}`,
          });
      }

      // Get available dates (weekdays with data)
      const availableDates = dailyCandles
        .map(c => {
          const d = c.date || c.t;
          return typeof d === 'number'
            ? new Date(d).toISOString().split('T')[0]
            : d.split('T')[0];
        })
        .filter(d => {
          const day = new Date(d).getDay();
          return day !== 0 && day !== 6; // Exclude weekends
        });

      // Randomly select dates
      const shuffled = [...availableDates].sort(() => Math.random() - 0.5);
      const selectedDates = shuffled.slice(
        0,
        Math.min(numDays, availableDates.length)
      );

      // Run simulation on each date
      const dailyResults = [];
      let totalPnl = 0;
      let totalTrades = 0;
      let totalWins = 0;
      let profitableDays = 0;

      for (const date of selectedDates) {
        try {
          // Directly run the simulation logic
          const dayCandles = await getCachedHistoricalData(symbol, date, 'minute');
          if (!dayCandles || dayCandles.length === 0) {
            dailyResults.push({
              date,
              trades: 0,
              pnl: 0,
              winRate: 0,
              error: 'No data',
            });
            continue;
          }

          // Simple result for now
          dailyResults.push({
            date,
            trades: 0,
            pnl: 0,
            winRate: 0,
          });
        } catch (dayError) {
          console.error(`Error simulating ${date}:`, dayError.message);
          dailyResults.push({
            date,
            trades: 0,
            pnl: 0,
            winRate: 0,
            error: dayError.message,
          });
        }
      }

      const avgDailyPnl =
        dailyResults.length > 0 ? totalPnl / dailyResults.length : 0;
      const overallWinRate = totalTrades > 0 ? totalWins / totalTrades : 0;

      res.json({
        success: true,
        symbol,
        daysAnalyzed: dailyResults.length,
        totalDays: numDays,
        dateRange: { start, end },
        dailyResults,
        totalPnl,
        profitableDays,
        losingDays: dailyResults.length - profitableDays,
        avgDailyPnl,
        overallWinRate,
        totalTrades,
        config: config || regimeAwareConfigStore.getDefaultConfig(),
      });
    } catch (error) {
      console.error('Error in random days validation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get market regime using watchlist
  router.post('/api/regime/watchlist', async (req, res) => {
    try {
      const { watchlist, lookbackDays = 50 } = req.body;

      // Get symbols to analyze
      const symbolsToFetch = [];
      const wl = watchlist || watchlistRegimeDetector.getWatchlist();
      for (const category of Object.values(wl)) {
        if (category.symbols) {
          symbolsToFetch.push(...category.symbols);
        }
      }

      // Fetch historical data for each symbol
      const symbolData = {};
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      for (const symbol of symbolsToFetch) {
        try {
          const candles = await polygonClient.getHistoricalAggregates(
            symbol,
            startDate,
            endDate,
            'day'
          );
          if (candles && candles.length > 0) {
            symbolData[symbol] = candles.map(c => ({
              open: c.open || c.o,
              high: c.high || c.h,
              low: c.low || c.l,
              close: c.close || c.c,
              volume: c.volume || c.v,
              date: c.date || c.t,
            }));
          }
        } catch (err) {
          console.log(`Could not fetch ${symbol}: ${err.message}`);
        }
      }

      const result = watchlistRegimeDetector.detectMarketRegime(symbolData);
      res.json(result);
    } catch (error) {
      console.error('Error detecting watchlist regime:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get/update watchlist
  router.get('/api/regime/watchlist', (req, res) => {
    try {
      res.json({ watchlist: watchlistRegimeDetector.getWatchlist() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/api/regime/watchlist', (req, res) => {
    try {
      const { watchlist } = req.body;
      const result = watchlistRegimeDetector.setWatchlist(watchlist);
      res.json({ success: true, watchlist: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get list of all strategies
  router.get('/api/strategies', (req, res) => {
    try {
      const symbols = strategyVersionControl.getAllSymbols();
      const allStrategies = [];

      for (const sym of symbols) {
        const versions = strategyVersionControl.getVersions(sym.symbol);
        if (versions.versions) {
          versions.versions.forEach(v => {
            allStrategies.push({
              id: v.id,
              name: v.versionString,
              symbol: sym.symbol,
              description: v.description,
              config: v.config,
              tag: v.tag,
              isProduction: v.isProduction,
              createdAt: v.createdAt,
              metrics: v.metrics,
            });
          });
        }
      }

      res.json({ strategies: allStrategies, count: allStrategies.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get strategy versions for a symbol
  router.get('/api/strategy-versions', (req, res) => {
    try {
      const symbols = strategyVersionControl.getAllSymbols();
      res.json({ symbols });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/strategy-versions/:symbol', (req, res) => {
    try {
      const { symbol } = req.params;
      const versions = strategyVersionControl.getVersions(symbol);
      res.json(versions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create new strategy version
  router.post('/api/strategy-versions', (req, res) => {
    try {
      const { symbol, config, options } = req.body;
      if (!symbol || !config) {
        return res.status(400).json({ error: 'symbol and config are required' });
      }
      const result = strategyVersionControl.createVersion(
        symbol,
        config,
        options
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Promote strategy to production
  router.post('/api/strategy-versions/:symbol/promote', (req, res) => {
    try {
      const { symbol } = req.params;
      const { versionId } = req.body;
      const result = strategyVersionControl.promoteToProduction(
        symbol,
        versionId
      );
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // OVERNIGHT OPTIMIZATION ENDPOINTS
  // ================================

  // Create a new overnight optimization job
  router.post('/api/overnight/jobs', async (req, res) => {
    try {
      const { symbols, config, name, description } = req.body;

      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: 'symbols array is required' });
      }

      const job = await overnightOptimizer.createJob(symbols, config || {});

      // Optionally add name/description
      if (name) job.name = name;
      if (description) job.description = description;

      res.json({
        success: true,
        job: {
          id: job.id,
          status: job.status,
          symbols: job.symbols,
          config: job.config,
          createdAt: job.createdAt,
        },
      });
    } catch (error) {
      console.error('Error creating overnight job:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // List all overnight optimization jobs
  router.get('/api/overnight/jobs', async (req, res) => {
    try {
      const jobs = await overnightOptimizer.getJobs();

      // Return summary without full results
      const jobSummaries = jobs.map(job => ({
        id: job.id,
        status: job.status,
        symbols: job.symbols,
        progress: job.progress,
        name: job.name,
        description: job.description,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
      }));

      res.json({ jobs: jobSummaries });
    } catch (error) {
      console.error('Error listing overnight jobs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get details of a specific overnight optimization job
  router.get('/api/overnight/jobs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const job = await overnightOptimizer.getJob(id);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({ job });
    } catch (error) {
      console.error('Error getting overnight job:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Start an overnight optimization job
  router.post('/api/overnight/jobs/:id/start', async (req, res) => {
    try {
      const { id } = req.params;
      const job = await overnightOptimizer.getJob(id);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (job.status !== 'pending') {
        return res.status(400).json({
          error: `Job cannot be started - current status: ${job.status}`,
        });
      }

      // Create a data fetcher function that uses our existing infrastructure
      const dataFetcher = async (symbol, startDate, endDate) => {
        try {
          // Try to get from historicalDataManager first
          const data = await historicalDataManager.getDailyBars(
            symbol,
            startDate,
            endDate
          );
          if (data && data.length > 0) return data;

          // Fallback to polygon
          const polygonData = await polygonClient.getHistoricalBars(
            symbol,
            startDate,
            endDate,
            'day'
          );
          return polygonData || [];
        } catch (error) {
          console.error(`Error fetching data for ${symbol}:`, error.message);
          return [];
        }
      };

      // Start job in background (non-blocking)
      overnightOptimizer.startJob(id, dataFetcher).catch(err => {
        console.error(`Overnight job ${id} failed:`, err);
      });

      res.json({
        success: true,
        message: 'Job started successfully',
        jobId: id,
        status: 'running',
      });
    } catch (error) {
      console.error('Error starting overnight job:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel a running overnight optimization job
  router.post('/api/overnight/jobs/:id/cancel', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await overnightOptimizer.cancelJob(id);

      if (!result) {
        return res
          .status(404)
          .json({ error: 'Job not found or cannot be cancelled' });
      }

      res.json({
        success: true,
        message: 'Job cancelled',
        jobId: id,
      });
    } catch (error) {
      console.error('Error cancelling overnight job:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get results for a completed overnight optimization job
  router.get('/api/overnight/results/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const results = await overnightOptimizer.getResults(id);

      if (!results) {
        return res.status(404).json({ error: 'Results not found' });
      }

      res.json({ results });
    } catch (error) {
      console.error('Error getting overnight results:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete an overnight optimization job
  router.delete('/api/overnight/jobs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await overnightOptimizer.deleteJob(id);

      if (!result) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({
        success: true,
        message: 'Job deleted',
        jobId: id,
      });
    } catch (error) {
      console.error('Error deleting overnight job:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Apply best results from overnight optimization to strategy version control
  router.post('/api/overnight/jobs/:id/apply', async (req, res) => {
    try {
      const { id } = req.params;
      const results = await overnightOptimizer.getResults(id);

      if (!results) {
        return res.status(404).json({ error: 'Results not found' });
      }

      const applied = [];

      // Apply best config for each symbol that was optimized
      for (const [symbol, symbolResults] of Object.entries(
        results.symbolResults || {}
      )) {
        if (symbolResults.bestConfig) {
          try {
            // Save as a new strategy version
            const version = strategyVersionControl.saveVersion(symbol, {
              ...symbolResults.bestConfig,
              source: 'overnight-optimization',
              optimizationJobId: id,
              performance: symbolResults.performance,
            });
            applied.push({ symbol, versionId: version.versionId });
          } catch (err) {
            console.error(`Error applying config for ${symbol}:`, err.message);
          }
        }
      }

      res.json({
        success: true,
        message: `Applied ${applied.length} optimized configs`,
        applied,
      });
    } catch (error) {
      console.error('Error applying overnight results:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Strategy Validator endpoints
  router.post('/api/strategy-validator/run', async (req, res) => {
    try {
      const { symbol, startDate, endDate, config } = req.body;

      if (!symbol || !startDate || !endDate) {
        return res.status(400).json({
          error: 'Missing required fields: symbol, startDate, endDate',
        });
      }

      // Validate date range (max 90 days to prevent timeout)
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysDiff = (end - start) / (1000 * 60 * 60 * 24);

      if (daysDiff > 90) {
        return res.status(400).json({
          error: 'Date range too large. Maximum 90 days per backtest.',
        });
      }

      if (daysDiff < 5) {
        return res.status(400).json({
          error:
            'Date range too small. Minimum 5 days for meaningful statistics.',
        });
      }

      console.log(
        `[Backtest API] Running backtest for ${symbol} from ${startDate} to ${endDate}`
      );

      const results = await strategyBacktester.runBacktest(
        symbol.toUpperCase(),
        startDate,
        endDate,
        config || {}
      );

      res.json(results);
    } catch (error) {
      console.error('[Backtest API] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/strategy-validator/range/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate required' });
      }

      const tradingDays = await strategyBacktester.getTradingDays(
        symbol,
        startDate,
        endDate
      );
      const buyAndHold = await strategyBacktester.calculateBuyAndHold(
        symbol,
        startDate,
        endDate
      );

      res.json({
        symbol,
        startDate,
        endDate,
        tradingDays: tradingDays.length,
        buyAndHold,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
