const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const {
    polygonClient,
    alpacaClient,
    tradingModeManager,
    technicalIndicatorsService,
    patternRecognitionService,
    schwabImportService,
    assetUtils,
    leveragedEtfStrategy,
    CheddarFlowScraper,
    regimeDetector,
    RegimeDetector,
    StrategyBacktester,
    upload,
    PORT,
    getCachedHistoricalData,
    // Helper functions from index.js
    analyzeMarketSentiment,
    analyzeIntradayPattern,
    analyzeIntradaySwings,
    generateTradingRecommendations,
    findSimilarPatterns,
    executeStrategy,
    calculateMarketMetrics,
    calculateRSI,
    calculateSMA,
    // In-memory state
    simulationResults,
  } = deps;

  // Mutable state for cheddarflow scraper
  let cheddarFlowScraper = deps.cheddarFlowScraper || null;

  // Get CheddarFlow credentials from environment
  const CHEDDARFLOW_EMAIL = process.env.CHEDDARFLOW_EMAIL;
  const CHEDDARFLOW_PASSWORD = process.env.CHEDDARFLOW_PASSWORD;

  // Initialize backtester with dependencies
  const regimeDetectorInstance = new RegimeDetector();
  const strategyBacktester = new StrategyBacktester(
    polygonClient,
    regimeDetectorInstance
  );

  // ================================
  // INTRADAY TRADING ANALYZER
  // ================================

  // 15. Intraday Trading Analyzer - Day trading analysis with market sentiment
  router.get('/api/intraday/:symbol', async (req, res) => {
    const { symbol } = req.params;
    try {
      const { date } = req.query; // Optional: analyze specific date (YYYY-MM-DD), defaults to today

      console.log(
        `📈 Analyzing intraday trading for ${symbol}${date ? ` on ${date}` : ''}...`
      );

      // Get today's date or specified date
      const targetDate = date ? new Date(date) : new Date();
      const targetDateStr = targetDate.toISOString().split('T')[0];

      // Calculate date range for analysis (7 days history for pattern matching)
      const startDate = new Date(targetDate);
      startDate.setDate(startDate.getDate() - 7);
      const startDateStr = startDate.toISOString().split('T')[0];

      // Fetch 5-minute candles for the target day (market hours: 9:30 AM - 4:00 PM ET = 78 candles)
      const intradayCandles = await polygonClient
        .getHistoricalAggregates(symbol, targetDateStr, targetDateStr, 'minute')
        .catch(e => {
          console.log(`⚠️  Could not fetch intraday candles: ${e.message}`);
          return [];
        });

      // Fetch daily bars for historical context and pattern matching
      const dailyBars = await polygonClient
        .getHistoricalAggregates(symbol, startDateStr, targetDateStr, 'day')
        .catch(e => {
          console.error(`❌ Error fetching daily bars: ${e.message}`);
          return [];
        });

      // Fetch market indicators (S&P 500 and VIX for sentiment)
      const [spyBars, vixBars] = await Promise.all([
        polygonClient
          .getHistoricalAggregates('SPY', startDateStr, targetDateStr, 'day')
          .catch(() => []),
        polygonClient
          .getHistoricalAggregates('VIX', startDateStr, targetDateStr, 'day')
          .catch(() => []),
      ]);

      // Also fetch intraday SPY and VIX candles for correlation analysis
      const [spyIntradayCandles, vixIntradayCandles] = await Promise.all([
        polygonClient
          .getHistoricalAggregates('SPY', targetDateStr, targetDateStr, 'minute')
          .catch(e => {
            console.log(`⚠️  Could not fetch SPY intraday candles: ${e.message}`);
            return [];
          }),
        polygonClient
          .getHistoricalAggregates('VIX', targetDateStr, targetDateStr, 'minute')
          .catch(e => {
            console.log(`⚠️  Could not fetch VIX intraday candles: ${e.message}`);
            return [];
          }),
      ]);

      // Calculate market sentiment
      const marketSentiment = analyzeMarketSentiment(
        spyBars,
        vixBars,
        spyIntradayCandles,
        vixIntradayCandles
      );

      // Calculate technical indicators
      const technicals = polygonClient.calculateTechnicalIndicators(dailyBars);

      // Analyze intraday pattern
      const intradayAnalysis = analyzeIntradayPattern(intradayCandles, dailyBars);

      // Analyze intraday swings (open, +30min, +3hr, close)
      const swingAnalysis = analyzeIntradaySwings(intradayCandles);

      // Generate entry/exit recommendations
      const recommendations = generateTradingRecommendations(
        symbol,
        intradayCandles,
        dailyBars,
        marketSentiment,
        technicals
      );

      // Find historical patterns similar to current setup
      const similarPatterns = await findSimilarPatterns(
        symbol,
        dailyBars,
        marketSentiment
      );

      res.json({
        success: true,
        symbol,
        date: targetDateStr,
        intraday: {
          candles: intradayCandles,
          openPrice: intradayCandles[0]?.open || null,
          currentPrice:
            intradayCandles[intradayCandles.length - 1]?.close || null,
          highOfDay: Math.max(...intradayCandles.map(c => c.high)),
          lowOfDay: Math.min(...intradayCandles.map(c => c.low)),
          volume: intradayCandles.reduce((sum, c) => sum + c.volume, 0),
          analysis: intradayAnalysis,
          swingAnalysis: swingAnalysis,
        },
        marketSentiment,
        technicals,
        recommendations,
        similarPatterns,
      });
    } catch (error) {
      console.error(`❌ Error analyzing intraday for ${symbol}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // STRATEGY BACKTEST/OPTIMIZE/EXECUTE (legacy day-trading endpoints)
  // ================================

  // 16. Strategy Backtesting - Test trading strategies on historical data
  router.post('/api/strategy/backtest', async (req, res) => {
    try {
      const { symbol, strategy, startDate, endDate } = req.body;

      console.log(
        `🧪 Backtesting strategy for ${symbol} from ${startDate} to ${endDate}...`
      );

      // Validate strategy parameters
      if (!strategy || !strategy.type) {
        return res.status(400).json({ error: 'Strategy type is required' });
      }

      // Define ranking list stocks (COVID_19 default list)
      const rankingStocks = [
        'WM',
        'ADSK',
        'NKE',
        'LSCC',
        'DIS',
        'LRCX',
        'XRAY',
        'RTX',
        'YETI',
        'ENPH',
        'TEVA',
        'MGNI',
        'RUN',
        'DAL',
        'LRMR',
        'RCL',
        'SHOP',
        'HIMX',
        'PI',
        'PENN',
      ];

      // Remove the target symbol if it's in the list to avoid duplication
      const marketStocks = rankingStocks.filter(s => s !== symbol);

      // Detect if this is a crypto symbol (crypto trades 24/7, including weekends)
      const upperSymbol = symbol.toUpperCase();
      const isCryptoSymbol =
        assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
        upperSymbol.includes('/USD') ||
        upperSymbol.startsWith('X:');

      // Fetch historical intraday data for the date range
      const start = new Date(startDate);
      const end = new Date(endDate);
      const tradingDays = [];

      // Get all trading days in range
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        // Skip weekends for stocks only - crypto trades 24/7
        if (isCryptoSymbol || (dayOfWeek !== 0 && dayOfWeek !== 6)) {
          tradingDays.push(d.toISOString().split('T')[0]);
        }
      }

      console.log(`📅 Testing ${tradingDays.length} trading days...`);

      // Run backtest on each trading day
      const trades = [];
      const dailyLogs = []; // Track ALL days for comprehensive analysis
      let totalReturn = 0;
      let winningTrades = 0;
      let losingTrades = 0;
      let totalProfit = 0;
      let totalLoss = 0;

      for (const date of tradingDays) {
        try {
          // Fetch intraday candles for this day - using cache
          const [candles, spyCandles, vixCandles] = await Promise.all([
            getCachedHistoricalData(symbol, date),
            getCachedHistoricalData('SPY', date),
            getCachedHistoricalData('VIX', date),
          ]);

          if (candles.length === 0) {
            dailyLogs.push({
              date,
              status: 'no_data',
              reason: 'No intraday data available',
            });
            continue;
          }

          // Fetch ranking stocks data using cache
          // Sample 10 stocks to keep API usage reasonable
          const sampledStocks = marketStocks.slice(0, 10);
          const rankingCandles = await Promise.all(
            sampledStocks.map(ticker => getCachedHistoricalData(ticker, date))
          );

          // Calculate market-wide metrics from ranking stocks
          const marketMetrics = calculateMarketMetrics(
            rankingCandles,
            sampledStocks
          );

          // Run strategy on this day with enhanced market context
          const trade = executeStrategy(
            candles,
            strategy,
            date,
            spyCandles,
            vixCandles,
            marketMetrics
          );

          if (trade && trade.executed) {
            trades.push(trade);
            dailyLogs.push({
              date,
              status: trade.profitLoss > 0 ? 'win' : 'loss',
              executed: true,
              entryPrice: trade.entryPrice,
              exitPrice: trade.exitPrice,
              profitLoss: trade.profitLoss,
              profitPercent: trade.profitPercent,
              reason: trade.reason,
              momentum: trade.momentum,
              marketBreadth: trade.marketBreadth,
            });

            if (trade.profitLoss > 0) {
              winningTrades++;
              totalProfit += trade.profitLoss;
            } else {
              losingTrades++;
              totalLoss += Math.abs(trade.profitLoss);
            }

            totalReturn += trade.profitLoss;
          } else if (trade) {
            // Trade signal did NOT trigger - log why
            dailyLogs.push({
              date,
              status: 'no_signal',
              executed: false,
              reason: trade.reason,
              momentum: trade.momentum,
              actualDayReturn: trade.actualDayReturn, // How much stock moved that day
              missedOpportunity: trade.actualDayReturn > 5, // Flag if we missed a big move
            });
          }
        } catch (err) {
          console.log(`⚠️  Could not test ${date}: ${err.message}`);
          dailyLogs.push({ date, status: 'error', reason: err.message });
        }
      }

      // Calculate metrics
      const totalTrades = trades.length;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
      const avgWin = winningTrades > 0 ? totalProfit / winningTrades : 0;
      const avgLoss = losingTrades > 0 ? totalLoss / losingTrades : 0;
      // Better profit factor display: use 999 as max instead of Infinity
      const profitFactor =
        totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;
      const avgReturnPerTrade = totalTrades > 0 ? totalReturn / totalTrades : 0;

      // Calculate average entry/exit prices for successful trades
      const successfulTrades = trades.filter(t => t.profitLoss > 0);
      const avgEntryPrice =
        successfulTrades.length > 0
          ? (
              successfulTrades.reduce((sum, t) => sum + t.entryPrice, 0) /
              successfulTrades.length
            ).toFixed(2)
          : 'N/A';
      const avgExitPrice =
        successfulTrades.length > 0
          ? (
              successfulTrades.reduce((sum, t) => sum + t.exitPrice, 0) /
              successfulTrades.length
            ).toFixed(2)
          : 'N/A';

      res.json({
        success: true,
        symbol,
        strategy,
        period: {
          start: startDate,
          end: endDate,
          tradingDays: tradingDays.length,
        },
        results: {
          totalTrades,
          winningTrades,
          losingTrades,
          winRate: winRate.toFixed(2),
          totalReturn: totalReturn.toFixed(2),
          avgReturnPerTrade: avgReturnPerTrade.toFixed(2),
          profitFactor: profitFactor >= 999 ? '999+' : profitFactor.toFixed(2),
          avgWin: avgWin.toFixed(2),
          avgLoss: avgLoss.toFixed(2),
          totalProfit: totalProfit.toFixed(2),
          totalLoss: totalLoss.toFixed(2),
          avgEntryPrice,
          avgExitPrice,
        },
        trades: trades.slice(-20), // Return last 20 trades for review
        dailyLogs, // Return ALL daily logs for comprehensive analysis
      });
    } catch (error) {
      console.error('❌ Error running backtest:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 17. Optimize Strategy - Find optimal parameters for a strategy
  router.post('/api/strategy/optimize', async (req, res) => {
    try {
      const { symbol, startDate, endDate } = req.body;

      console.log(`🔍 Optimizing strategy for ${symbol}...`);
      console.log(`⚡ Pre-caching historical data for parallel execution...`);

      // Detect if this is a crypto symbol (crypto trades 24/7, including weekends)
      const upperSymbol = symbol.toUpperCase();
      const isCryptoSymbol =
        assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
        upperSymbol.includes('/USD') ||
        upperSymbol.startsWith('X:');

      // Get all trading days in range
      const start = new Date(startDate);
      const end = new Date(endDate);
      const tradingDays = [];

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        // Skip weekends for stocks only - crypto trades 24/7
        if (isCryptoSymbol || (dayOfWeek !== 0 && dayOfWeek !== 6)) {
          tradingDays.push(d.toISOString().split('T')[0]);
        }
      }

      // Pre-fetch all historical data into cache (parallelized)
      const rankingStocks = [
        'WM',
        'ADSK',
        'NKE',
        'LSCC',
        'DIS',
        'LRCX',
        'XRAY',
        'RTX',
        'YETI',
        'ENPH',
      ];
      const allSymbols = [symbol, 'SPY', 'VIX', ...rankingStocks];

      await Promise.all(
        tradingDays.flatMap(date =>
          allSymbols.map(sym => getCachedHistoricalData(sym, date))
        )
      );

      console.log(
        `✅ Cache warmed with ${tradingDays.length} days × ${allSymbols.length} symbols`
      );

      // Test multiple strategy variations
      // BREAKOUT MODE: Lower momentum thresholds + higher profit targets for QBTS-style runners
      const strategies = [
        // Conservative strategies (original)
        { type: 'first-3hr-momentum', minMomentum3Hr: 1.0, profitTarget: 10 },
        { type: 'first-3hr-momentum', minMomentum3Hr: 1.5, profitTarget: 10 },
        { type: 'first-3hr-momentum', minMomentum3Hr: 2.0, profitTarget: 10 },

        // BREAKOUT strategies - catch big runners like QBTS
        {
          type: 'first-3hr-momentum',
          minMomentum3Hr: 0.3,
          profitTarget: 15,
          minMarketBreadth: 30,
        }, // Ultra-aggressive
        {
          type: 'first-3hr-momentum',
          minMomentum3Hr: 0.5,
          profitTarget: 15,
          minMarketBreadth: 35,
        }, // QBTS-style
        {
          type: 'first-3hr-momentum',
          minMomentum3Hr: 0.8,
          profitTarget: 12,
          minMarketBreadth: 40,
        },
        {
          type: 'first-3hr-momentum',
          minMomentum3Hr: 1.0,
          profitTarget: 12,
          minMarketBreadth: 40,
        },

        // Balanced
        { type: 'first-3hr-momentum', minMomentum3Hr: 0.5, profitTarget: 8 },
      ];

      console.log(`🚀 Running ${strategies.length} strategies in PARALLEL...`);

      // Run all backtests in parallel (data already cached)
      const backtestPromises = strategies.map(strategy =>
        fetch(`http://localhost:${PORT}/api/strategy/backtest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, strategy, startDate, endDate }),
        }).then(r => r.json())
      );

      const backtestResults = await Promise.all(backtestPromises);

      const results = backtestResults
        .filter(data => data.success)
        .map((data, idx) => ({
          strategy: strategies[idx],
          metrics: data.results,
        }));

      // Sort by win rate * profit factor to find best strategy
      results.sort((a, b) => {
        const pfA =
          a.metrics.profitFactor === '999+'
            ? 999
            : parseFloat(a.metrics.profitFactor);
        const pfB =
          b.metrics.profitFactor === '999+'
            ? 999
            : parseFloat(b.metrics.profitFactor);
        const scoreA = parseFloat(a.metrics.winRate) * pfA;
        const scoreB = parseFloat(b.metrics.winRate) * pfB;
        return scoreB - scoreA;
      });

      res.json({
        success: true,
        symbol,
        period: { start: startDate, end: endDate },
        optimalStrategy: results[0] || null,
        allResults: results,
        cacheStats: {
          tradingDays: tradingDays.length,
          symbolsCached: allSymbols.length,
          strategiesTested: strategies.length,
        },
      });
    } catch (error) {
      console.error('❌ Error optimizing strategy:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 18. Execute Strategy Trade - Place a paper trade based on current day strategy analysis
  router.post('/api/strategy/execute-trade', async (req, res) => {
    try {
      const { symbol, strategy, profitTargetDollars } = req.body;

      console.log(
        `💵 Executing strategy trade for ${symbol} with $${profitTargetDollars} profit target...`
      );

      // Get today's date
      const today = new Date().toISOString().split('T')[0];

      // Fetch today's intraday data
      const [candles, spyCandles, vixCandles] = await Promise.all([
        polygonClient.getHistoricalAggregates(symbol, today, today, 'minute'),
        polygonClient
          .getHistoricalAggregates('SPY', today, today, 'minute')
          .catch(() => []),
        polygonClient
          .getHistoricalAggregates('VIX', today, today, 'minute')
          .catch(() => []),
      ]);

      if (candles.length === 0) {
        return res
          .status(400)
          .json({ error: 'No intraday data available for today' });
      }

      // Fetch ranking stocks for market context
      const rankingStocks = [
        'WM',
        'ADSK',
        'NKE',
        'LSCC',
        'DIS',
        'LRCX',
        'XRAY',
        'RTX',
        'YETI',
        'ENPH',
        'TEVA',
        'MGNI',
        'RUN',
        'DAL',
        'LRMR',
        'RCL',
        'SHOP',
        'HIMX',
        'PI',
        'PENN',
      ];
      const marketStocks = rankingStocks.filter(s => s !== symbol).slice(0, 10);

      const rankingCandles = await Promise.all(
        marketStocks.map(ticker =>
          polygonClient
            .getHistoricalAggregates(ticker, today, today, 'minute')
            .catch(() => [])
        )
      );

      const marketMetrics = calculateMarketMetrics(rankingCandles, marketStocks);

      // Evaluate strategy for today
      const analysis = executeStrategy(
        candles,
        strategy,
        today,
        spyCandles,
        vixCandles,
        marketMetrics
      );

      // Calculate quantity based on profit target
      const currentPrice = candles[candles.length - 1].close;
      const profitTargetPercent = strategy.profitTarget || 10;
      const profitPerShare = currentPrice * (profitTargetPercent / 100);
      const quantity = Math.floor(profitTargetDollars / profitPerShare);

      console.log(
        `📊 Calculated quantity: ${quantity} shares (price: $${currentPrice}, profit/share: $${profitPerShare.toFixed(2)})`
      );

      if (quantity < 1) {
        return res.status(400).json({
          success: false,
          error: `Profit target too low. Need at least $${profitPerShare.toFixed(2)} to buy 1 share (${profitTargetPercent}% of $${currentPrice}).`,
        });
      }

      if (!analysis || !analysis.executed) {
        const limitPrice = (
          currentPrice *
          (1 + profitTargetPercent / 100)
        ).toFixed(2);
        const actualProfit = (quantity * profitPerShare).toFixed(2);

        return res.json({
          success: false,
          shouldEnter: false,
          reason: analysis?.reason || 'Entry criteria not met',
          analysis: analysis?.analysis || {},
          currentPrice,
          quantity,
          // Show what the trade WOULD have been
          intendedTrade: {
            symbol,
            quantity,
            type: 'market buy',
            entryPrice: currentPrice,
            profitTarget: `${profitTargetPercent}% ($${actualProfit})`,
            targetPrice: limitPrice,
            sellOrder: `limit sell ${quantity} shares at $${limitPrice}`,
            strategy: {
              type: strategy.type,
              minMomentum3Hr: strategy.minMomentum3Hr,
              minMarketBreadth: strategy.minMarketBreadth || 40,
            },
          },
          // Specific failure details
          failureDetails: {
            stockMomentum: analysis?.analysis?.stockChange3Hr || 'N/A',
            spyPerformance: analysis?.analysis?.spyChange3Hr || 'N/A',
            vixChange: analysis?.analysis?.vixChange3Hr || 'N/A',
            marketBreadth: analysis?.analysis?.positiveStocksPercent || 'N/A',
            avgMarketChange: analysis?.analysis?.avgMarketChange3Hr || 'N/A',
          },
        });
      }

      // Strategy says to enter - place the trade
      const limitPrice = (currentPrice * (1 + profitTargetPercent / 100)).toFixed(
        2
      );
      const actualProfit = (quantity * profitPerShare).toFixed(2);

      // Place market buy order
      const buyOrder = await fetch(
        'http://localhost:' + PORT + '/api/alpaca/orders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            qty: quantity,
            side: 'buy',
            type: 'market',
            time_in_force: 'day',
          }),
        }
      );

      const buyResult = await buyOrder.json();

      if (!buyResult.success) {
        throw new Error('Failed to place buy order: ' + buyResult.error);
      }

      // Place limit sell order at profit target
      const sellOrder = await fetch(
        'http://localhost:' + PORT + '/api/alpaca/orders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            qty: quantity,
            side: 'sell',
            type: 'limit',
            limit_price: limitPrice,
            time_in_force: 'day',
          }),
        }
      );

      const sellResult = await sellOrder.json();

      res.json({
        success: true,
        shouldEnter: true,
        quantity,
        buyOrder: buyResult.order,
        sellOrder: sellResult.success ? sellResult.order : null,
        analysis: analysis.analysis,
        entryPrice: currentPrice,
        targetPrice: limitPrice,
        profitTarget: `${profitTargetPercent}% ($${actualProfit})`,
        profitTargetDollars,
        marketMetrics,
      });
    } catch (error) {
      console.error('❌ Error executing strategy trade:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // STOCK ANALYSIS & INVESTIGATION
  // ================================

  // 27. Get comprehensive stock analysis for trading decisions
  router.get('/api/stock/analysis/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      console.log(`📊 Fetching comprehensive analysis for ${symbol}...`);

      // Detect if this is a crypto symbol (BTC, ETH, etc.)
      const upperSymbol = symbol.toUpperCase();
      const isCryptoSymbol = assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
                             upperSymbol.includes('/USD') ||
                             upperSymbol.startsWith('X:');

      // Calculate date range for historical data (100 days)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 100);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Use Polygon for historical data - route to crypto or stocks API
      let bars;

      if (isCryptoSymbol) {
        console.log(`🪙 Routing ${symbol} analysis to crypto API`);
        bars = await polygonClient
          .getCryptoHistoricalAggregates(symbol, startDateStr, endDateStr, 'day', 1)
          .catch(e => {
            console.error(`❌ Polygon crypto bars fetch failed for ${symbol}:`, e.message);
            return { error: e.message };
          });
      } else {
        bars = await polygonClient
          .getHistoricalAggregates(symbol, startDateStr, endDateStr)
          .catch(e => {
            console.error(`❌ Polygon bars fetch failed for ${symbol}:`, e.message);
            return { error: e.message };
          });
      }

      // We need at least bars data to provide analysis
      if (bars.error || !bars || bars.length === 0) {
        throw new Error(
          `Unable to fetch historical data for ${symbol}. The symbol may be invalid or market data unavailable.`
        );
      }

      // Get latest quote from Polygon for current price
      let latestQuote;
      if (isCryptoSymbol) {
        const cryptoData = await polygonClient.getCryptoPreviousClose(symbol).catch(e => {
          console.log(`⚠️  Polygon crypto quote fetch failed for ${symbol}`);
          return null;
        });
        if (cryptoData) {
          latestQuote = {
            price: cryptoData.close,
            bidPrice: null,
            askPrice: null,
          };
        } else {
          latestQuote = { error: 'No crypto quote available' };
        }
      } else {
        latestQuote = await polygonClient.getLatestQuote(symbol).catch(e => {
          console.log(
            `⚠️  Polygon quote fetch failed for ${symbol} (may be normal if market closed)`
          );
          return { error: e.message };
        });
      }

      // Extract current price - use latest bar close price if real-time data unavailable
      const latestBar = bars[bars.length - 1];
      const currentPrice =
        (!latestQuote.error && latestQuote.price) || latestBar.close;
      const bidPrice = (!latestQuote.error && latestQuote.bidPrice) || null;
      const askPrice = (!latestQuote.error && latestQuote.askPrice) || null;
      const spread = bidPrice && askPrice ? askPrice - bidPrice : null;

      // Volume analysis
      const dailyVolume =
        bars && bars.length > 0 ? bars[bars.length - 1].volume : null;
      const prevVolume =
        bars && bars.length > 1 ? bars[bars.length - 2].volume : null;
      const volumeChange =
        prevVolume && dailyVolume
          ? ((dailyVolume - prevVolume) / prevVolume) * 100
          : null;

      // Calculate technical indicators from historical data
      let technicals = null;
      if (bars && bars.length >= 14) {
        // RSI calculation (14-period)
        const rsi = calculateRSI(bars, 14);

        // Moving averages
        const sma20 = calculateSMA(bars, 20);
        const sma50 = calculateSMA(bars, 50);

        // Price momentum
        const priceChange1D =
          bars.length >= 2
            ? ((bars[bars.length - 1].close - bars[bars.length - 2].close) /
                bars[bars.length - 2].close) *
              100
            : null;
        const priceChange1W =
          bars.length >= 7
            ? ((bars[bars.length - 1].close - bars[bars.length - 7].close) /
                bars[bars.length - 7].close) *
              100
            : null;
        const priceChange1M =
          bars.length >= 30
            ? ((bars[bars.length - 1].close - bars[bars.length - 30].close) /
                bars[bars.length - 30].close) *
              100
            : null;

        // 52-week high/low
        const prices = bars.map(b => b.high);
        const high52w = Math.max(...prices);
        const low52w = Math.min(...prices);
        const distanceFromHigh = ((currentPrice - high52w) / high52w) * 100;
        const distanceFromLow = ((currentPrice - low52w) / low52w) * 100;

        technicals = {
          rsi: rsi ? rsi.toFixed(2) : null,
          rsiSignal: rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral',
          sma20: sma20 ? sma20.toFixed(2) : null,
          sma50: sma50 ? sma50.toFixed(2) : null,
          trendSignal:
            currentPrice > sma20 && sma20 > sma50
              ? 'Bullish'
              : currentPrice < sma20 && sma20 < sma50
                ? 'Bearish'
                : 'Neutral',
          priceChange1D: priceChange1D ? priceChange1D.toFixed(2) : null,
          priceChange1W: priceChange1W ? priceChange1W.toFixed(2) : null,
          priceChange1M: priceChange1M ? priceChange1M.toFixed(2) : null,
          high52w: high52w.toFixed(2),
          low52w: low52w.toFixed(2),
          distanceFromHigh: distanceFromHigh.toFixed(2),
          distanceFromLow: distanceFromLow.toFixed(2),
        };
      }

      // ============================================
      // ENHANCED AI ANALYSIS WITH FULL TRANSPARENCY
      // ============================================
      // This shows exactly how each signal contributes to the final recommendation

      let recommendation = 'Neutral';
      let reasons = [];
      let totalScore = 0;
      const maxPossibleScore = 10; // Maximum possible positive/negative score

      // Signal breakdown for transparency
      const signalBreakdown = [];

      if (technicals) {
        // ---- RSI SIGNAL (Weight: 25%) ----
        const rsiValue = parseFloat(technicals.rsi);
        let rsiScore = 0;
        let rsiSignal = 'Neutral';
        let rsiExplanation = '';

        if (rsiValue < 30) {
          rsiScore = 2.5;
          rsiSignal = 'Bullish';
          rsiExplanation = `RSI at ${rsiValue.toFixed(1)} indicates oversold conditions - historically a buying opportunity`;
        } else if (rsiValue < 40) {
          rsiScore = 1;
          rsiSignal = 'Slightly Bullish';
          rsiExplanation = `RSI at ${rsiValue.toFixed(1)} is approaching oversold territory`;
        } else if (rsiValue > 70) {
          rsiScore = -2.5;
          rsiSignal = 'Bearish';
          rsiExplanation = `RSI at ${rsiValue.toFixed(1)} indicates overbought conditions - may see pullback`;
        } else if (rsiValue > 60) {
          rsiScore = -1;
          rsiSignal = 'Slightly Bearish';
          rsiExplanation = `RSI at ${rsiValue.toFixed(1)} is approaching overbought territory`;
        } else {
          rsiExplanation = `RSI at ${rsiValue.toFixed(1)} is in neutral range (30-70)`;
        }

        signalBreakdown.push({
          indicator: 'RSI (14)',
          value: rsiValue.toFixed(1),
          signal: rsiSignal,
          score: rsiScore,
          maxScore: 2.5,
          weight: '25%',
          explanation: rsiExplanation,
          formula:
            'RSI = 100 - (100 / (1 + RS)), where RS = Avg Gain / Avg Loss over 14 periods',
        });
        totalScore += rsiScore;
        if (rsiScore !== 0) reasons.push(rsiExplanation);

        // ---- TREND SIGNAL (Weight: 20%) ----
        let trendScore = 0;
        let trendExplanation = '';

        if (technicals.trendSignal === 'Bullish') {
          trendScore = 2;
          trendExplanation = `Price ($${currentPrice.toFixed(2)}) > SMA20 ($${technicals.sma20}) > SMA50 ($${technicals.sma50}) - Strong uptrend`;
        } else if (technicals.trendSignal === 'Bearish') {
          trendScore = -2;
          trendExplanation = `Price ($${currentPrice.toFixed(2)}) < SMA20 ($${technicals.sma20}) < SMA50 ($${technicals.sma50}) - Downtrend`;
        } else {
          trendExplanation = `Mixed signals: Price/MA alignment unclear - sideways market`;
        }

        signalBreakdown.push({
          indicator: 'Trend (MA Cross)',
          value: technicals.trendSignal,
          signal: technicals.trendSignal,
          score: trendScore,
          maxScore: 2,
          weight: '20%',
          explanation: trendExplanation,
          formula:
            'Bullish if Price > SMA20 > SMA50; Bearish if Price < SMA20 < SMA50',
          details: {
            price: currentPrice.toFixed(2),
            sma20: technicals.sma20,
            sma50: technicals.sma50,
          },
        });
        totalScore += trendScore;
        if (trendScore !== 0) reasons.push(trendExplanation);

        // ---- 52-WEEK POSITION (Weight: 15%) ----
        const distFromHigh = parseFloat(technicals.distanceFromHigh);
        const distFromLow = parseFloat(technicals.distanceFromLow);
        let positionScore = 0;
        let positionSignal = 'Neutral';
        let positionExplanation = '';

        if (distFromHigh > -10) {
          positionScore = -1.5;
          positionSignal = 'Bearish';
          positionExplanation = `Trading ${Math.abs(distFromHigh).toFixed(1)}% from 52-week high ($${technicals.high52w}) - limited upside`;
        } else if (distFromHigh < -30) {
          positionScore = 1.5;
          positionSignal = 'Bullish';
          positionExplanation = `Trading ${Math.abs(distFromHigh).toFixed(1)}% below 52-week high - significant discount`;
        } else {
          positionExplanation = `Trading in middle of 52-week range (${distFromHigh.toFixed(1)}% from high)`;
        }

        signalBreakdown.push({
          indicator: '52-Week Position',
          value: `${distFromHigh.toFixed(1)}% from high`,
          signal: positionSignal,
          score: positionScore,
          maxScore: 1.5,
          weight: '15%',
          explanation: positionExplanation,
          details: {
            high52w: technicals.high52w,
            low52w: technicals.low52w,
            distanceFromHigh: distFromHigh.toFixed(2) + '%',
            distanceFromLow: distFromLow.toFixed(2) + '%',
          },
        });
        totalScore += positionScore;
        if (positionScore !== 0) reasons.push(positionExplanation);

        // ---- MOMENTUM (Weight: 15%) ----
        const priceChange1W = parseFloat(technicals.priceChange1W || 0);
        const priceChange1M = parseFloat(technicals.priceChange1M || 0);
        let momentumScore = 0;
        let momentumSignal = 'Neutral';
        let momentumExplanation = '';

        if (priceChange1W > 5 && priceChange1M > 10) {
          momentumScore = 1.5;
          momentumSignal = 'Strong Bullish';
          momentumExplanation = `Strong momentum: +${priceChange1W.toFixed(1)}% (1W), +${priceChange1M.toFixed(1)}% (1M)`;
        } else if (priceChange1W > 2) {
          momentumScore = 0.75;
          momentumSignal = 'Bullish';
          momentumExplanation = `Positive momentum: +${priceChange1W.toFixed(1)}% this week`;
        } else if (priceChange1W < -5 && priceChange1M < -10) {
          momentumScore = -1.5;
          momentumSignal = 'Strong Bearish';
          momentumExplanation = `Negative momentum: ${priceChange1W.toFixed(1)}% (1W), ${priceChange1M.toFixed(1)}% (1M)`;
        } else if (priceChange1W < -2) {
          momentumScore = -0.75;
          momentumSignal = 'Bearish';
          momentumExplanation = `Weak momentum: ${priceChange1W.toFixed(1)}% this week`;
        } else {
          momentumExplanation = `Flat momentum: ${priceChange1W.toFixed(1)}% (1W)`;
        }

        signalBreakdown.push({
          indicator: 'Price Momentum',
          value: `${priceChange1W >= 0 ? '+' : ''}${priceChange1W.toFixed(1)}% (1W)`,
          signal: momentumSignal,
          score: momentumScore,
          maxScore: 1.5,
          weight: '15%',
          explanation: momentumExplanation,
          details: {
            change1D: technicals.priceChange1D + '%',
            change1W: technicals.priceChange1W + '%',
            change1M: technicals.priceChange1M + '%',
          },
        });
        totalScore += momentumScore;
        if (momentumScore !== 0) reasons.push(momentumExplanation);

        // ---- VOLUME SIGNAL (Weight: 15%) ----
        let volumeScore = 0;
        let volumeSignal = 'Neutral';
        let volumeExplanation = '';

        if (volumeChange !== null) {
          if (volumeChange > 100) {
            volumeScore = 1.5;
            volumeSignal = 'High Interest';
            volumeExplanation = `Volume surged +${volumeChange.toFixed(0)}% vs yesterday - significant market interest`;
          } else if (volumeChange > 50) {
            volumeScore = 0.75;
            volumeSignal = 'Elevated';
            volumeExplanation = `Volume up +${volumeChange.toFixed(0)}% - above average activity`;
          } else if (volumeChange < -50) {
            volumeScore = -0.5;
            volumeSignal = 'Low';
            volumeExplanation = `Volume down ${volumeChange.toFixed(0)}% - lack of conviction`;
          } else {
            volumeExplanation = `Volume change ${volumeChange >= 0 ? '+' : ''}${volumeChange.toFixed(0)}% - normal activity`;
          }
        } else {
          volumeExplanation = 'Volume data unavailable';
        }

        signalBreakdown.push({
          indicator: 'Volume',
          value: dailyVolume ? dailyVolume.toLocaleString() : 'N/A',
          signal: volumeSignal,
          score: volumeScore,
          maxScore: 1.5,
          weight: '15%',
          explanation: volumeExplanation,
          details: {
            current: dailyVolume,
            previous: prevVolume,
            changePercent: volumeChange ? volumeChange.toFixed(1) + '%' : 'N/A',
          },
        });
        totalScore += volumeScore;
        if (volumeScore !== 0) reasons.push(volumeExplanation);

        // ---- VOLATILITY ASSESSMENT (Weight: 10%) ----
        // Calculate recent volatility from price swings
        let volatilityScore = 0;
        let volatilitySignal = 'Normal';
        let volatilityExplanation = '';

        if (bars.length >= 20) {
          const recentBars = bars.slice(-20);
          const dailyReturns = recentBars
            .slice(1)
            .map(
              (b, i) =>
                Math.abs((b.close - recentBars[i].close) / recentBars[i].close) *
                100
            );
          const avgDailySwing =
            dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;

          if (avgDailySwing > 3) {
            volatilityScore = -1;
            volatilitySignal = 'High Risk';
            volatilityExplanation = `High volatility: avg daily swing ${avgDailySwing.toFixed(1)}% - increased risk`;
          } else if (avgDailySwing < 1) {
            volatilityScore = 0.5;
            volatilitySignal = 'Low Risk';
            volatilityExplanation = `Low volatility: avg daily swing ${avgDailySwing.toFixed(1)}% - stable`;
          } else {
            volatilityExplanation = `Normal volatility: avg daily swing ${avgDailySwing.toFixed(1)}%`;
          }

          signalBreakdown.push({
            indicator: 'Volatility',
            value: avgDailySwing.toFixed(1) + '%',
            signal: volatilitySignal,
            score: volatilityScore,
            maxScore: 1,
            weight: '10%',
            explanation: volatilityExplanation,
          });
          totalScore += volatilityScore;
        }

        // ============================================
        // FINAL RECOMMENDATION CALCULATION
        // ============================================
        const normalizedScore = (totalScore / maxPossibleScore) * 100; // -100 to +100 scale
        const confidence = Math.min(
          95,
          Math.max(30, 50 + Math.abs(normalizedScore) / 2)
        );

        if (totalScore >= 5) recommendation = 'Strong Buy';
        else if (totalScore >= 2.5) recommendation = 'Buy';
        else if (totalScore >= 0.5) recommendation = 'Lean Buy';
        else if (totalScore <= -5) recommendation = 'Strong Sell';
        else if (totalScore <= -2.5) recommendation = 'Sell';
        else if (totalScore <= -0.5) recommendation = 'Lean Sell';
        else recommendation = 'Neutral';

        // Add confidence explanation
        const confidenceExplanation =
          totalScore > 0
            ? `${signalBreakdown.filter(s => s.score > 0).length} of ${signalBreakdown.length} signals are bullish`
            : totalScore < 0
              ? `${signalBreakdown.filter(s => s.score < 0).length} of ${signalBreakdown.length} signals are bearish`
              : 'Signals are mixed - no clear direction';

        // Store enhanced analysis data
        technicals.signalBreakdown = signalBreakdown;
        technicals.totalScore = totalScore.toFixed(2);
        technicals.maxPossibleScore = maxPossibleScore;
        technicals.normalizedScore = normalizedScore.toFixed(1);
        technicals.confidence = confidence.toFixed(0);
        technicals.confidenceExplanation = confidenceExplanation;
      }

      // Calculate expected returns (simple projections based on historical volatility)
      let projections = null;
      if (bars && bars.length >= 30 && currentPrice) {
        const returns = [];
        for (let i = 1; i < bars.length; i++) {
          returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
        }

        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const stdDev = Math.sqrt(
          returns.reduce((sq, n) => sq + Math.pow(n - avgReturn, 2), 0) /
            returns.length
        );

        // Project forward (annualized then scaled down)
        const annualReturn = avgReturn * 252; // 252 trading days
        const annualVol = stdDev * Math.sqrt(252);

        const return1W = (annualReturn / 52) * 100;
        const return1M = (annualReturn / 12) * 100;
        const vol1W = (annualVol / Math.sqrt(52)) * 100;
        const vol1M = (annualVol / Math.sqrt(12)) * 100;

        projections = {
          oneWeek: {
            expectedReturn: return1W.toFixed(2),
            expectedPrice: (currentPrice * (1 + return1W / 100)).toFixed(2),
            volatility: vol1W.toFixed(2),
            range: {
              low: (currentPrice * (1 + return1W / 100 - vol1W / 100)).toFixed(2),
              high: (currentPrice * (1 + return1W / 100 + vol1W / 100)).toFixed(
                2
              ),
            },
          },
          oneMonth: {
            expectedReturn: return1M.toFixed(2),
            expectedPrice: (currentPrice * (1 + return1M / 100)).toFixed(2),
            volatility: vol1M.toFixed(2),
            range: {
              low: (currentPrice * (1 + return1M / 100 - vol1M / 100)).toFixed(2),
              high: (currentPrice * (1 + return1M / 100 + vol1M / 100)).toFixed(
                2
              ),
            },
          },
        };
      }

      const analysisResult = {
        symbol,
        timestamp: new Date().toISOString(),
        price: {
          current: currentPrice,
          bid: bidPrice,
          ask: askPrice,
          spread: spread ? spread.toFixed(4) : null,
          change24h: technicals?.priceChange1D || null,
        },
        volume: {
          current: dailyVolume,
          previous: prevVolume,
          changePercent: volumeChange ? volumeChange.toFixed(2) : null,
        },
        technicals,
        recommendation: {
          action: recommendation,
          score: totalScore,
          maxScore: maxPossibleScore,
          normalizedScore: technicals?.normalizedScore || 0,
          confidence: technicals?.confidence || 50,
          confidenceExplanation: technicals?.confidenceExplanation || '',
          reasons,
          signalBreakdown: technicals?.signalBreakdown || [],
        },
        projections,
      };

      console.log(`✅ Analysis complete for ${symbol}: ${recommendation}`);
      res.json({ success: true, analysis: analysisResult });
    } catch (error) {
      console.error(`❌ Error analyzing ${req.params.symbol}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 27b. Deep investigation endpoint — aggregates all analysis for a symbol
  router.get('/api/investigate/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      console.log(`🔍 Running deep investigation for ${symbol}...`);

      // Date range for historical data (100 days)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 100);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Fetch everything in parallel
      const [stockDetails, bars, latestQuote] = await Promise.all([
        polygonClient.getStockDetails(symbol).catch(() => null),
        polygonClient.getHistoricalAggregates(symbol, startDateStr, endDateStr).catch(e => {
          console.error(`❌ Investigation bars fetch failed for ${symbol}:`, e.message);
          return null;
        }),
        polygonClient.getLatestQuote(symbol).catch(() => null),
      ]);

      if (!bars || bars.length === 0) {
        return res.status(400).json({ error: `No historical data for ${symbol}` });
      }

      // Current price from quote or last bar
      const latestBar = bars[bars.length - 1];
      const currentPrice = (latestQuote && latestQuote.price) || latestBar.close;

      // Build candles array for technicalIndicatorsService
      const candles = bars.map(b => ({
        open: b.open || b.o,
        high: b.high || b.h,
        low: b.low || b.l,
        close: b.close || b.c,
        volume: b.volume || b.v,
        timestamp: b.timestamp || b.t,
      }));

      // Technical indicators (need 50+ candles)
      let indicators = null;
      let patterns = null;
      if (candles.length >= 50) {
        indicators = technicalIndicatorsService.getAllIndicators(candles);
        patterns = patternRecognitionService.detectHeuristicPatterns(candles, indicators);
      }

      // Volume analysis
      const dailyVolume = latestBar.volume || latestBar.v || null;
      const prevVolume = bars.length > 1 ? (bars[bars.length - 2].volume || bars[bars.length - 2].v) : null;
      const volumeChange = prevVolume && dailyVolume ? ((dailyVolume - prevVolume) / prevVolume) * 100 : null;

      // ── Scoring (reuses existing signal breakdown logic) ──
      let recommendation = 'Neutral';
      let reasons = [];
      let totalScore = 0;
      const maxPossibleScore = 10;
      const signalBreakdown = [];

      // Calculate basic technicals for scoring
      const rsi = calculateRSI(bars, 14);
      const sma20 = calculateSMA(bars, 20);
      const sma50 = calculateSMA(bars, 50);

      const priceChange1W = bars.length >= 7
        ? ((bars[bars.length - 1].close - bars[bars.length - 7].close) / bars[bars.length - 7].close) * 100
        : 0;
      const priceChange1M = bars.length >= 30
        ? ((bars[bars.length - 1].close - bars[bars.length - 30].close) / bars[bars.length - 30].close) * 100
        : 0;
      const prices = bars.map(b => b.high || b.h);
      const lows = bars.map(b => b.low || b.l);
      const high52w = Math.max(...prices);
      const low52w = Math.min(...lows);
      const distFromHigh = ((currentPrice - high52w) / high52w) * 100;

      // RSI signal
      if (rsi !== null) {
        let rsiScore = 0;
        let rsiExplanation = `RSI at ${rsi.toFixed(1)} is in neutral range`;
        if (rsi < 30) { rsiScore = 2.5; rsiExplanation = `RSI at ${rsi.toFixed(1)} indicates oversold`; }
        else if (rsi < 40) { rsiScore = 1; rsiExplanation = `RSI approaching oversold at ${rsi.toFixed(1)}`; }
        else if (rsi > 70) { rsiScore = -2.5; rsiExplanation = `RSI at ${rsi.toFixed(1)} indicates overbought`; }
        else if (rsi > 60) { rsiScore = -1; rsiExplanation = `RSI approaching overbought at ${rsi.toFixed(1)}`; }
        signalBreakdown.push({ indicator: 'RSI', score: rsiScore, explanation: rsiExplanation });
        totalScore += rsiScore;
        if (rsiScore !== 0) reasons.push(rsiExplanation);
      }

      // Trend signal
      if (sma20 && sma50) {
        let trendScore = 0;
        let trendExplanation = 'Mixed trend signals';
        if (currentPrice > sma20 && sma20 > sma50) { trendScore = 2; trendExplanation = `Uptrend: Price > SMA20 > SMA50`; }
        else if (currentPrice < sma20 && sma20 < sma50) { trendScore = -2; trendExplanation = `Downtrend: Price < SMA20 < SMA50`; }
        signalBreakdown.push({ indicator: 'Trend', score: trendScore, explanation: trendExplanation });
        totalScore += trendScore;
        if (trendScore !== 0) reasons.push(trendExplanation);
      }

      // 52-week position
      let positionScore = 0;
      if (distFromHigh > -10) { positionScore = -1.5; reasons.push(`Only ${Math.abs(distFromHigh).toFixed(1)}% from 52wk high`); }
      else if (distFromHigh < -30) { positionScore = 1.5; reasons.push(`${Math.abs(distFromHigh).toFixed(1)}% below 52wk high — discount`); }
      signalBreakdown.push({ indicator: '52-Week', score: positionScore });
      totalScore += positionScore;

      // Momentum
      let momentumScore = 0;
      if (priceChange1W > 5 && priceChange1M > 10) { momentumScore = 1.5; reasons.push(`Strong momentum: +${priceChange1W.toFixed(1)}% (1W)`); }
      else if (priceChange1W > 2) { momentumScore = 0.75; reasons.push(`Positive momentum: +${priceChange1W.toFixed(1)}% this week`); }
      else if (priceChange1W < -5 && priceChange1M < -10) { momentumScore = -1.5; reasons.push(`Negative momentum: ${priceChange1W.toFixed(1)}% (1W)`); }
      else if (priceChange1W < -2) { momentumScore = -0.75; reasons.push(`Weak momentum: ${priceChange1W.toFixed(1)}% this week`); }
      signalBreakdown.push({ indicator: 'Momentum', score: momentumScore });
      totalScore += momentumScore;

      // Volume signal
      if (volumeChange !== null) {
        let volScore = 0;
        if (volumeChange > 100) { volScore = 1.5; }
        else if (volumeChange > 50) { volScore = 0.75; }
        else if (volumeChange < -50) { volScore = -0.5; }
        signalBreakdown.push({ indicator: 'Volume', score: volScore });
        totalScore += volScore;
      }

      // Volatility
      if (bars.length >= 20) {
        const recentBars = bars.slice(-20);
        const dailyReturns = recentBars.slice(1).map((b, i) =>
          Math.abs(((b.close || b.c) - (recentBars[i].close || recentBars[i].c)) / (recentBars[i].close || recentBars[i].c)) * 100
        );
        const avgDailySwing = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        let volScore = 0;
        if (avgDailySwing > 3) volScore = -1;
        else if (avgDailySwing < 1) volScore = 0.5;
        signalBreakdown.push({ indicator: 'Volatility', score: volScore, avgSwing: avgDailySwing.toFixed(1) + '%' });
        totalScore += volScore;
      }

      // Final recommendation
      const normalizedScore = (totalScore / maxPossibleScore) * 100;
      const confidence = Math.min(95, Math.max(30, 50 + Math.abs(normalizedScore) / 2));

      if (totalScore >= 5) recommendation = 'STRONG BUY';
      else if (totalScore >= 2.5) recommendation = 'BUY';
      else if (totalScore >= 0.5) recommendation = 'LEAN BUY';
      else if (totalScore <= -5) recommendation = 'STRONG SELL';
      else if (totalScore <= -2.5) recommendation = 'SELL';
      else if (totalScore <= -0.5) recommendation = 'LEAN SELL';
      else recommendation = 'NEUTRAL';

      // ── Projections ──
      let projections = null;
      if (bars.length >= 30) {
        const returns = [];
        for (let i = 1; i < bars.length; i++) {
          const prev = bars[i - 1].close || bars[i - 1].c;
          const curr = bars[i].close || bars[i].c;
          returns.push((curr - prev) / prev);
        }
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const stdDev = Math.sqrt(returns.reduce((sq, n) => sq + Math.pow(n - avgReturn, 2), 0) / returns.length);
        const annualReturn = avgReturn * 252;
        const annualVol = stdDev * Math.sqrt(252);
        const r1W = (annualReturn / 52) * 100;
        const r1M = (annualReturn / 12) * 100;
        const v1W = (annualVol / Math.sqrt(52)) * 100;
        const v1M = (annualVol / Math.sqrt(12)) * 100;

        projections = {
          oneWeek: {
            expected: (currentPrice * (1 + r1W / 100)).toFixed(2),
            low: (currentPrice * (1 + r1W / 100 - v1W / 100)).toFixed(2),
            high: (currentPrice * (1 + r1W / 100 + v1W / 100)).toFixed(2),
          },
          oneMonth: {
            expected: (currentPrice * (1 + r1M / 100)).toFixed(2),
            low: (currentPrice * (1 + r1M / 100 - v1M / 100)).toFixed(2),
            high: (currentPrice * (1 + r1M / 100 + v1M / 100)).toFixed(2),
          },
        };
      }

      // ── Entry/Exit Targets ──
      let entryExit = null;
      if (indicators) {
        const bbLower = indicators.bollingerBands?.lower;
        const vwapValue = indicators.vwap?.value;
        const sma20Value = indicators.ema?.ema21 || sma20;
        const atrValue = indicators.atr?.value;
        const atrPct = indicators.atr?.percent;

        const entryLow = Math.min(...[bbLower, vwapValue, sma20Value].filter(v => v != null));
        const entryHigh = Math.max(...[bbLower, vwapValue, sma20Value].filter(v => v != null && v <= currentPrice));

        // Use ATR for stop/target levels
        const atr = atrValue || currentPrice * 0.02;
        const stopTight = currentPrice - atr;
        const stopNormal = currentPrice - atr * 1.5;
        const tpConservative = currentPrice + atr * 1.5;
        const tpModerate = currentPrice + atr * 2.5;
        const tpAggressive = currentPrice + atr * 4;
        const riskReward = atr > 0 ? ((tpModerate - currentPrice) / (currentPrice - stopTight)).toFixed(1) : null;

        // Detect leveraged ETFs
        const leveragedPatterns = /^(SOXL|SOXS|TQQQ|SQQQ|UPRO|SPXU|LABU|LABD|QBTX|QBTZ|FNGU|FNGD|TNA|TZA|UDOW|SDOW|TECL|TECS)/i;
        const isLeveraged = leveragedPatterns.test(symbol);

        entryExit = {
          entryZone: { low: entryLow.toFixed(2), high: (entryHigh || currentPrice).toFixed(2), ideal: (vwapValue || sma20Value || currentPrice).toFixed(2) },
          stopLoss: { tight: stopTight.toFixed(2), normal: stopNormal.toFixed(2) },
          takeProfit: { conservative: tpConservative.toFixed(2), moderate: tpModerate.toFixed(2), aggressive: tpAggressive.toFixed(2) },
          riskReward,
          atr: atrValue ? atrValue.toFixed(2) : null,
          atrPercent: atrPct ? atrPct.toFixed(1) : null,
          isLeveraged,
        };
      }

      const result = {
        symbol,
        name: stockDetails?.name || symbol,
        timestamp: new Date().toISOString(),
        price: {
          current: currentPrice,
          change1D: bars.length >= 2 ? ((currentPrice - (bars[bars.length - 2].close || bars[bars.length - 2].c)) / (bars[bars.length - 2].close || bars[bars.length - 2].c) * 100) : null,
          change1W: priceChange1W,
          high52w,
          low52w,
        },
        volume: {
          current: dailyVolume,
          ratio: indicators?.volume?.ratio ? indicators.volume.ratio.toFixed(2) + 'x' : null,
        },
        recommendation: { verdict: recommendation, score: totalScore.toFixed(2), maxScore: maxPossibleScore, confidence: confidence.toFixed(0), reasons, signalBreakdown },
        indicators: indicators ? {
          rsi: { value: indicators.rsi?.value?.toFixed(1), signal: indicators.rsi?.oversold ? 'oversold' : indicators.rsi?.overbought ? 'overbought' : 'neutral' },
          macd: { value: indicators.macd?.value?.toFixed(3), signal: indicators.macd?.bullish ? 'bullish' : 'bearish', histogram: indicators.macd?.histogram?.toFixed(3) },
          bollingerBands: { percentB: indicators.bollingerBands?.percentB?.toFixed(2), squeeze: indicators.bollingerBands?.squeeze },
          atr: { value: indicators.atr?.value?.toFixed(2), percent: indicators.atr?.percent?.toFixed(1) },
          stochastic: { k: indicators.stochastic?.k?.toFixed(1), d: indicators.stochastic?.d?.toFixed(1), bullishCross: indicators.stochastic?.bullishCross },
          adx: { value: indicators.adx?.value?.toFixed(1), trending: indicators.adx?.trending, bullishDI: indicators.adx?.bullishDI },
          vwap: { value: indicators.vwap?.value?.toFixed(2), position: indicators.vwap?.pricePosition?.toFixed(2) },
          ema: { ema9: indicators.ema?.ema9?.toFixed(2), ema21: indicators.ema?.ema21?.toFixed(2), goldenCross: indicators.ema?.goldenCross, deathCross: indicators.ema?.deathCross },
          volume: { ratio: indicators.volume?.ratio?.toFixed(2), aboveAvg: indicators.volume?.aboveAverage },
          trend: indicators.trend,
        } : null,
        patterns: patterns ? {
          signal: patterns.signal,
          confidence: patterns.confidence,
          names: (patterns.patterns || []).map(p => p.name || p),
        } : null,
        entryExit,
        projections,
      };

      console.log(`✅ Investigation complete for ${symbol}: ${recommendation}`);
      res.json({ success: true, investigation: result });
    } catch (error) {
      console.error(`❌ Error investigating ${req.params.symbol}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // TRADING MODE MANAGEMENT
  // ================================

  // 28. Get current trading mode info
  router.get('/api/trading/mode', (req, res) => {
    try {
      const modeInfo = tradingModeManager.getModeInfo();
      res.json({ success: true, mode: modeInfo });
    } catch (error) {
      console.error('❌ Error getting trading mode:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 28. Set trading mode (paper or live)
  router.post('/api/trading/mode', (req, res) => {
    try {
      const { mode } = req.body;

      if (!mode) {
        return res
          .status(400)
          .json({ error: 'mode is required (paper or live)' });
      }

      const result = tradingModeManager.setTradingMode(mode);
      const modeInfo = tradingModeManager.getModeInfo();

      res.json({
        success: true,
        result,
        mode: modeInfo,
        message: `Trading mode switched to ${mode.toUpperCase()}`,
      });
    } catch (error) {
      console.error('❌ Error setting trading mode:', error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // ================================
  // DATA VALIDATION
  // ================================

  // 29. Validate current price between Alpaca and Polygon
  router.get('/api/validate/price/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const validation = await alpacaClient.validatePriceWithPolygon(
        symbol,
        polygonClient
      );
      res.json({ success: true, validation });
    } catch (error) {
      console.error(
        `❌ Error validating price for ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // 28. Validate historical data between Alpaca and Polygon
  router.post('/api/validate/historical', async (req, res) => {
    try {
      const { symbol, startDate, endDate } = req.body;

      if (!symbol || !startDate || !endDate) {
        return res
          .status(400)
          .json({ error: 'symbol, startDate, and endDate are required' });
      }

      const validation = await alpacaClient.validateHistoricalDataWithPolygon(
        symbol,
        startDate,
        endDate,
        polygonClient
      );

      res.json({ success: true, validation });
    } catch (error) {
      console.error('❌ Error validating historical data:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 29. Batch validate prices for multiple symbols
  router.post('/api/validate/prices/batch', async (req, res) => {
    try {
      const { symbols } = req.body;

      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: 'symbols array is required' });
      }

      const validations = [];

      for (const symbol of symbols) {
        try {
          const validation = await alpacaClient.validatePriceWithPolygon(
            symbol,
            polygonClient
          );
          validations.push(validation);
        } catch (error) {
          validations.push({
            symbol,
            error: error.message,
            isValid: false,
            timestamp: new Date().toISOString(),
          });
        }
      }

      const validCount = validations.filter(v => v.isValid).length;
      const validPercent = (validCount / validations.length) * 100;

      console.log(`\n📊 Batch Validation Summary:`);
      console.log(`   Total symbols: ${validations.length}`);
      console.log(`   Valid: ${validCount} (${validPercent.toFixed(1)}%)`);
      console.log(`   Invalid: ${validations.length - validCount}`);

      res.json({
        success: true,
        summary: {
          total: validations.length,
          valid: validCount,
          invalid: validations.length - validCount,
          validPercent,
        },
        validations,
      });
    } catch (error) {
      console.error('❌ Error in batch validation:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // TECHNICAL INDICATORS & PATTERNS
  // ================================

  // Get all indicators for a symbol
  router.get('/api/indicators/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const timeframe = req.query.timeframe || '5';
      const unit = req.query.unit || 'minute';

      // Calculate appropriate date range based on timeframe
      // Shorter timeframes should fetch less history to stay zoomed in
      const toDate = new Date();
      let daysBack;
      let maxCandles;

      if (unit === 'minute') {
        const tf = parseInt(timeframe);
        if (tf <= 1) {
          daysBack = 1; // 1 minute: today's full session
          maxCandles = 500;
        } else if (tf <= 5) {
          daysBack = 1; // 5 minute: today's full session
          maxCandles = 100;
        } else if (tf <= 15) {
          daysBack = 5; // 15 minute: ~5 trading days
          maxCandles = 130;
        } else if (tf <= 30) {
          daysBack = 10; // 30 minute: ~2 weeks
          maxCandles = 130;
        } else {
          daysBack = 20; // 1 hour+: ~1 month
          maxCandles = 140;
        }
      } else if (unit === 'hour') {
        daysBack = 20; // Hourly: ~1 month
        maxCandles = 140;
      } else {
        daysBack = 180; // Daily: ~6 months
        maxCandles = 120;
      }

      const fromDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

      // Detect if this is a crypto symbol (BTC, ETH, etc.)
      const upperSymbol = symbol.toUpperCase();
      const isCryptoSymbol = assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
                             upperSymbol.includes('/USD') ||
                             upperSymbol.startsWith('X:');

      // Fetch candles and previous close in parallel
      const candlePromise = isCryptoSymbol
        ? (console.log(`🪙 Indicators: Routing ${symbol} to crypto aggregates API`),
           polygonClient.getCryptoAggregates(symbol, parseInt(timeframe), unit, {
             from: fromDate.toISOString().split('T')[0],
             to: toDate.toISOString().split('T')[0],
           }))
        : polygonClient.getAggregates(symbol, parseInt(timeframe), unit, {
            from: fromDate.toISOString().split('T')[0],
            to: toDate.toISOString().split('T')[0],
          });

      const prevClosePromise = isCryptoSymbol
        ? Promise.resolve(null)
        : polygonClient.getPreviousClose(symbol);

      const [candles, prevCloseData] = await Promise.all([candlePromise, prevClosePromise]);

      if (!candles || candles.length < 20) {
        return res.status(400).json({ error: 'Insufficient data' });
      }

      // Compute indicators on full unfiltered data (needs 50+ bars for accuracy)
      const indicators = technicalIndicatorsService.getAllIndicators(candles);

      // Filter out extended hours for minute-level intervals (avoid visual gaps)
      let filteredCandles = candles;
      if (unit === 'minute') {
        filteredCandles = candles.filter(c => {
          const ts = c.t || c.timestamp;
          if (!ts) return true;
          const etTime = new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' });
          const etDate = new Date(etTime);
          const hours = etDate.getHours();
          const minutes = etDate.getMinutes();
          const timeInMinutes = hours * 60 + minutes;
          // Regular trading hours: 9:30 AM (570 min) to 4:00 PM (960 min)
          return timeInMinutes >= 570 && timeInMinutes <= 960;
        });
        // Fall back to unfiltered if filtering removes too much data
        if (filteredCandles.length < 10) {
          filteredCandles = candles;
        }
      }

      res.json({
        symbol,
        candles: filteredCandles.slice(-maxCandles),
        indicators,
        prevClose: prevCloseData?.close || null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error getting indicators:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get composite trading signals for a symbol
  router.get('/api/indicators/:symbol/signals', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { timeframe = '1D', bars = 100 } = req.query;

      // Fetch historical data for indicator calculation.
      // Note: a previous version of this route called polygonClient.getDailyBars(),
      // which doesn't exist on the client — every signal request silently
      // threw, caught nothing, and returned "Insufficient data" forever.
      // Use getHistoricalAggregates (the same call /api/regime/:symbol uses)
      // which returns a normalized candle array directly.
      let candles = [];
      try {
        const endDate = new Date();
        const startDate = new Date();
        // Need >= 50 bars after fetching — fetch enough trading days
        // (calendar days * 5/7 ≈ trading days) plus a buffer.
        const requestedDays = Math.max(Math.ceil((Number(bars) || 100) * 1.6), 90);
        startDate.setDate(startDate.getDate() - requestedDays);

        candles = await polygonClient.getHistoricalAggregates(
          symbol,
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
          'day'
        );
        if (!Array.isArray(candles)) candles = [];
      } catch (dataError) {
        console.warn(`Could not fetch data for ${symbol}:`, dataError.message);
      }

      // If we have enough data, calculate indicators
      if (candles.length >= 50) {
        const indicators = technicalIndicatorsService.getAllIndicators(candles);
        res.json({
          success: true,
          symbol,
          timeframe,
          signal: indicators.signals?.signal || 'HOLD',
          confidence: indicators.signals?.confidence || 50,
          bullishScore: indicators.signals?.bullishScore || 0,
          bearishScore: indicators.signals?.bearishScore || 0,
          reasons: indicators.signals?.reasons || [],
          indicators: {
            rsi: indicators.rsi?.value,
            macd: indicators.macd,
            bollingerBands: indicators.bollingerBands,
            ema: indicators.ema,
            vwap: indicators.vwap,
            adx: indicators.adx,
            stochastic: indicators.stochastic,
            volume: indicators.volume,
          },
          trend: indicators.trend,
          timestamp: indicators.timestamp,
        });
      } else {
        // Return default values if not enough data
        res.json({
          success: true,
          symbol,
          timeframe,
          signal: 'HOLD',
          confidence: 50,
          bullishScore: 0,
          bearishScore: 0,
          reasons: ['Insufficient data for analysis'],
          indicators: {},
          trend: {},
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error(
        `Error fetching signals for ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // Detect patterns for a symbol
  router.get('/api/patterns/:symbol/detect', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { timeframe = '1D', bars = 100 } = req.query;

      // Fetch historical data for pattern detection
      let candles = [];
      let indicators = {};

      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - Math.ceil(bars / 7));

        const data = await polygonClient.getDailyBars(
          symbol,
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0]
        );

        if (data && data.results) {
          candles = data.results.map(bar => ({
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
            timestamp: bar.t,
          }));
        }

        // Calculate indicators for pattern detection
        if (candles.length >= 50) {
          indicators = technicalIndicatorsService.getAllIndicators(candles);
        }
      } catch (dataError) {
        console.warn(`Could not fetch data for ${symbol}:`, dataError.message);
      }

      // Detect patterns
      if (candles.length >= 20) {
        const patternResult = patternRecognitionService.detectHeuristicPatterns(
          candles,
          indicators
        );

        res.json({
          success: true,
          symbol,
          timeframe,
          signal: patternResult.signal,
          confidence: patternResult.confidence,
          patterns: patternResult.patterns || [],
          probabilities: patternResult.probabilities || {
            BUY_SIGNAL: 33,
            HOLD: 34,
            SELL_SIGNAL: 33,
          },
          bullishScore: patternResult.bullishScore || 0,
          bearishScore: patternResult.bearishScore || 0,
          isMLPrediction: false,
          timestamp: patternResult.timestamp || new Date(),
        });
      } else {
        res.json({
          success: true,
          symbol,
          timeframe,
          signal: 'HOLD',
          confidence: 50,
          patterns: [],
          probabilities: { BUY_SIGNAL: 33, HOLD: 34, SELL_SIGNAL: 33 },
          bullishScore: 0,
          bearishScore: 0,
          isMLPrediction: false,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      console.error(
        `Error detecting patterns for ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // Get ML pattern prediction (uses TensorFlow.js model)
  router.post('/api/patterns/:symbol/predict', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { candles, indicators } = req.body;

      if (!candles || candles.length < 60) {
        return res.status(400).json({
          error: 'Need at least 60 candles for ML prediction',
        });
      }

      const prediction = await patternRecognitionService.predictPattern(
        candles,
        indicators
      );

      res.json({
        success: true,
        symbol,
        ...prediction,
        isMLPrediction: true,
      });
    } catch (error) {
      console.error(
        `Error predicting patterns for ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // Get ML model info
  router.get('/api/patterns/model/info', (req, res) => {
    try {
      const info = patternRecognitionService.getModelInfo();
      res.json({ success: true, ...info });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // SCHWAB IMPORT
  // ================================

  // Upload and parse Schwab CSV
  router.post('/api/import/schwab', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const result = schwabImportService.parseCSV(
        req.file.buffer,
        'default_user'
      );
      res.json(result);
    } catch (error) {
      console.error('Error importing Schwab CSV:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get imported trades for user
  router.get('/api/import/schwab/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const trades = schwabImportService.getTrades(userId);
      const summary =
        trades.length > 0 ? schwabImportService.generateSummary(trades) : null;
      res.json({ trades, summary });
    } catch (error) {
      console.error('Error getting imported trades:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Train AI model from imported trades
  router.post('/api/import/schwab/train', async (req, res) => {
    try {
      const { userId = 'default_user' } = req.body;
      const trades = schwabImportService.getTrades(userId);

      if (trades.length < 50) {
        return res.status(400).json({
          error: 'Need at least 50 trades for training',
          currentCount: trades.length,
        });
      }

      // Create training dataset and train model
      const trainingData = schwabImportService.createTrainingDataset(userId);
      const result = await patternRecognitionService.trainModel(trainingData, {
        epochs: 30,
        batchSize: 16,
      });

      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Error training from trades:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // SIMULATION RESULTS STORAGE
  // ================================

  // Save simulation results for learning/analysis
  router.post('/api/simulation/results', async (req, res) => {
    try {
      const { analysis, aiDecisions, events, config, savedAt } = req.body;

      if (!analysis) {
        return res.status(400).json({ error: 'Analysis data required' });
      }

      const resultId = `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const result = {
        id: resultId,
        analysis,
        aiDecisions: aiDecisions || [],
        events: events || [],
        config: config || {},
        savedAt: savedAt || new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      // Store result
      const userId = 'default_user';
      if (!simulationResults.has(userId)) {
        simulationResults.set(userId, []);
      }
      simulationResults.get(userId).push(result);

      // Keep only last 100 simulations per user
      const userResults = simulationResults.get(userId);
      if (userResults.length > 100) {
        simulationResults.set(userId, userResults.slice(-100));
      }

      console.log(
        `✅ Saved simulation result: ${resultId} for ${analysis.symbol} on ${analysis.date}`
      );

      res.json({
        success: true,
        resultId,
        message: 'Simulation results saved for learning',
      });
    } catch (error) {
      console.error('Error saving simulation results:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all simulation results for a user
  router.get('/api/simulation/results', async (req, res) => {
    try {
      const userId = req.query.userId || 'default_user';
      const results = simulationResults.get(userId) || [];

      // Return summary without full decision data
      const summaries = results.map(r => ({
        id: r.id,
        date: r.analysis.date,
        symbol: r.analysis.symbol,
        returnPercent: r.analysis.returnPercent,
        winRate: r.analysis.winRate,
        totalTrades: r.analysis.totalTrades,
        savedAt: r.savedAt,
      }));

      res.json({ results: summaries, total: summaries.length });
    } catch (error) {
      console.error('Error getting simulation results:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific simulation result by ID
  router.get('/api/simulation/results/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.query.userId || 'default_user';
      const results = simulationResults.get(userId) || [];

      const result = results.find(r => r.id === id);

      if (!result) {
        return res.status(404).json({ error: 'Simulation result not found' });
      }

      res.json(result);
    } catch (error) {
      console.error('Error getting simulation result:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Aggregate learning from all simulations
  router.get('/api/simulation/insights', async (req, res) => {
    try {
      const userId = req.query.userId || 'default_user';
      const results = simulationResults.get(userId) || [];

      if (results.length === 0) {
        return res.json({
          message: 'No simulation data yet',
          insights: null,
        });
      }

      // Calculate aggregate stats
      const totalSimulations = results.length;
      const avgReturn =
        results.reduce((s, r) => s + r.analysis.returnPercent, 0) /
        totalSimulations;
      const avgWinRate =
        results.reduce((s, r) => s + r.analysis.winRate, 0) / totalSimulations;
      const avgTrades =
        results.reduce((s, r) => s + r.analysis.totalTrades, 0) /
        totalSimulations;

      const profitableSimulations = results.filter(
        r => r.analysis.returnPercent > 0
      ).length;
      const profitabilityRate = (profitableSimulations / totalSimulations) * 100;

      // Find best and worst days
      const bestDay = results.reduce((best, r) =>
        r.analysis.returnPercent > best.analysis.returnPercent ? r : best
      );
      const worstDay = results.reduce((worst, r) =>
        r.analysis.returnPercent < worst.analysis.returnPercent ? r : worst
      );

      // Collect all improvements mentioned
      const allImprovements = results.flatMap(r => r.analysis.improvements || []);
      const improvementCounts = {};
      allImprovements.forEach(imp => {
        improvementCounts[imp] = (improvementCounts[imp] || 0) + 1;
      });
      const topImprovements = Object.entries(improvementCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([improvement, count]) => ({ improvement, count }));

      res.json({
        insights: {
          totalSimulations,
          avgReturn: avgReturn.toFixed(2),
          avgWinRate: avgWinRate.toFixed(1),
          avgTradesPerDay: avgTrades.toFixed(1),
          profitabilityRate: profitabilityRate.toFixed(1),
          bestDay: {
            date: bestDay.analysis.date,
            symbol: bestDay.analysis.symbol,
            return: bestDay.analysis.returnPercent.toFixed(2),
          },
          worstDay: {
            date: worstDay.analysis.date,
            symbol: worstDay.analysis.symbol,
            return: worstDay.analysis.returnPercent.toFixed(2),
          },
          topImprovements,
        },
      });
    } catch (error) {
      console.error('Error getting simulation insights:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // POLYGON API ROUTES
  // ================================

  // Get latest quote for a symbol
  router.get('/api/polygon/quote/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;

      // Detect if this is a crypto symbol (BTC, ETH, etc.)
      const upperSymbol = symbol.toUpperCase();
      const isCryptoSymbol = assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
                             upperSymbol.includes('/USD') ||
                             upperSymbol.startsWith('X:');

      let quote = null;

      if (isCryptoSymbol) {
        // For crypto, use crypto previous close which has current data
        console.log(`🪙 Routing ${symbol} quote to crypto API`);
        const cryptoData = await polygonClient
          .getCryptoPreviousClose(symbol)
          .catch(e => {
            console.error(`Error fetching crypto quote for ${symbol}:`, e.message);
            return null;
          });

        if (cryptoData) {
          quote = {
            last: cryptoData.close,
            close: cryptoData.close,
            open: cryptoData.open,
            high: cryptoData.high,
            low: cryptoData.low,
            volume: cryptoData.volume,
            prevClose: cryptoData.close,
            timestamp: cryptoData.timestamp,
          };
        }
      } else {
        // For stocks: Try getLatestQuote first, fallback to getPreviousClose
        quote = await polygonClient.getLatestQuote(symbol).catch(e => {
          console.log(
            `Real-time quote unavailable for ${symbol}, trying previous close`
          );
          return null;
        });

        if (!quote) {
          // Fallback to previous close (works with free Polygon API)
          const prevClose = await polygonClient
            .getPreviousClose(symbol)
            .catch(e => {
              console.error(
                `Error fetching previous close for ${symbol}:`,
                e.message
              );
              return null;
            });

          if (prevClose) {
            quote = {
              last: prevClose.close,
              close: prevClose.close,
              open: prevClose.open,
              high: prevClose.high,
              low: prevClose.low,
              volume: prevClose.volume,
              prevClose: prevClose.close,
              timestamp: prevClose.timestamp,
            };
          }
        }
      }

      if (!quote) {
        return res.status(404).json({ error: 'Quote not found' });
      }

      res.json(quote);
    } catch (error) {
      console.error('Error fetching quote:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get historical OHLCV bars from Polygon — chart-ready format
  router.get('/api/polygon/bars/:symbol/:multiplier/:timespan', async (req, res) => {
    try {
      const { symbol, multiplier, timespan } = req.params;
      const { from, to, limit } = req.query;
      const mult = parseInt(multiplier, 10) || 5;
      const bars = await polygonClient.getAggregates(symbol.toUpperCase(), mult, timespan || 'minute', {
        from: from || undefined,
        to: to || undefined,
        limit: limit ? parseInt(limit, 10) : 5000,
      });
      res.json({ symbol: symbol.toUpperCase(), multiplier: mult, timespan, count: bars.length, bars });
    } catch (error) {
      console.error('Error fetching Polygon bars:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get real-time price for a symbol (combines multiple sources)
  router.get('/api/realtime/price/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;

      // Try Alpaca latest trade first (most real-time)
      let price = null;
      let source = 'unknown';

      try {
        const trade = await alpacaClient.getLatestTrade(symbol);
        if (trade && trade.price) {
          price = trade.price;
          source = 'alpaca_trade';
        }
      } catch (e) {
        console.log(`Alpaca latest trade unavailable for ${symbol}`);
      }

      // Fallback to Polygon quote
      if (!price) {
        try {
          const quote = await polygonClient.getLatestQuote(symbol);
          if (quote && quote.price) {
            price = quote.price;
            source = 'polygon_quote';
          }
        } catch (e) {
          console.log(`Polygon quote unavailable for ${symbol}`);
        }
      }

      // Get previous close for change calculation
      let prevClose = null;
      try {
        const prev = await polygonClient.getPreviousClose(symbol);
        if (prev && prev.close) {
          prevClose = prev.close;
        }
      } catch (e) {
        console.log(`Previous close unavailable for ${symbol}`);
      }

      if (!price) {
        return res.status(404).json({ error: 'Price not available' });
      }

      const change = prevClose ? ((price - prevClose) / prevClose) * 100 : null;

      res.json({
        symbol,
        price,
        prevClose,
        change,
        source,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error fetching real-time price:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get aggregates (OHLCV bars) for a symbol
  router.get('/api/polygon/aggregates/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const { multiplier = 5, timespan = 'minute', limit = 78 } = req.query;

      // Calculate date range based on timespan
      const now = new Date();
      const from = new Date(now);

      if (timespan === 'day') {
        // For daily bars, go back enough days to get the requested limit
        from.setDate(from.getDate() - parseInt(limit) - 5); // Extra buffer for weekends
      } else {
        // For intraday, use today
        from.setHours(0, 0, 0, 0);
      }

      const aggregates = await polygonClient.getAggregates(
        symbol,
        parseInt(multiplier),
        timespan,
        { from, to: now, limit: parseInt(limit) }
      );

      res.json({
        success: true,
        symbol,
        results: aggregates || [],
        count: aggregates?.length || 0,
      });
    } catch (error) {
      console.error('Error fetching aggregates:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get company details
  router.get('/api/polygon/details/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const details = await polygonClient.getStockDetails(symbol).catch(e => {
        console.error(`Error fetching details for ${symbol}:`, e.message);
        return null;
      });

      if (!details) {
        return res.status(404).json({ error: 'Details not found' });
      }

      res.json(details);
    } catch (error) {
      console.error('Error fetching details:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get aggregates (OHLCV bars) - auto-detects crypto vs stock symbols
  router.get(
    '/api/polygon/aggregates/:symbol/:multiplier/:timespan',
    async (req, res) => {
      try {
        const { symbol, multiplier, timespan } = req.params;
        const { from, to } = req.query;

        // Detect if this is a crypto symbol (BTC, ETH, etc.)
        const upperSymbol = symbol.toUpperCase();
        const isCryptoSymbol = assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
                               upperSymbol.includes('/USD') ||
                               upperSymbol.startsWith('X:');

        let bars;
        if (isCryptoSymbol) {
          console.log(`🪙 Routing ${symbol} to crypto aggregates API`);
          bars = await polygonClient
            .getCryptoAggregates(symbol, parseInt(multiplier), timespan, {
              from,
              to,
            })
            .catch(e => {
              console.error(`Error fetching crypto aggregates for ${symbol}:`, e.message);
              return [];
            });
        } else {
          bars = await polygonClient
            .getAggregates(symbol, parseInt(multiplier), timespan, {
              from,
              to,
            })
            .catch(e => {
              console.error(`Error fetching aggregates for ${symbol}:`, e.message);
              return [];
            });
        }

        res.json({ results: bars });
      } catch (error) {
        console.error('Error fetching aggregates:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // ================================
  // LEVERAGED ETF STRATEGY
  // ================================

  // Get all supported leveraged ETF families
  router.get('/api/leveraged-etf/families', (req, res) => {
    try {
      const families = leveragedEtfStrategy.getSupportedFamilies();
      res.json({
        families,
        totalFamilies: families.length,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get family info for a symbol
  router.get('/api/leveraged-etf/family/:symbol', (req, res) => {
    const { symbol } = req.params;

    try {
      const family = leveragedEtfStrategy.getFamily(symbol);
      if (!family) {
        return res.status(404).json({
          error: `Symbol ${symbol} is not part of a supported leveraged ETF family`,
          supportedFamilies: Object.keys(leveragedEtfStrategy.families),
        });
      }
      res.json(family);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get full analysis and recommendation for a symbol
  router.get('/api/leveraged-etf/analyze/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { date } = req.query;

    try {
      // Check if symbol is supported
      const family = leveragedEtfStrategy.getFamily(symbol);
      if (!family) {
        return res.status(400).json({
          error: `Symbol ${symbol} is not supported. Use one of: QBTS, SOXX, PLTR (or their leveraged variants)`,
        });
      }

      // Get technical regime
      const endDate = date ? new Date(date) : new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 90);

      const formatDate = d => d.toISOString().split('T')[0];
      const candles = await polygonClient
        .getHistoricalAggregates(
          family.baseSymbol,
          formatDate(startDate),
          formatDate(endDate),
          'day'
        )
        .catch(() => []);

      let technicalRegime = { regime: 'unknown', confidence: 0 };
      if (candles && candles.length >= 50) {
        technicalRegime = regimeDetector.detectRegime(candles);
      }

      // Try to get flow sentiment (if CheddarFlow scraper is available)
      let flowSentiment = {
        sentiment: 'neutral',
        confidence: 0,
        reasons: ['Flow data not available'],
      };
      // Note: CheddarFlow scraping requires browser - skip for now in basic analysis
      // Use manual flow input via POST endpoint instead

      // Make decision
      const decision = leveragedEtfStrategy.makeDecision(
        technicalRegime,
        flowSentiment,
        family
      );

      // Get position sizing recommendation
      const positionSizing = leveragedEtfStrategy.getPositionSizing(
        decision,
        25000,
        2
      );

      res.json({
        symbol: symbol.toUpperCase(),
        family,
        analysis: {
          technical: technicalRegime,
          flow: flowSentiment,
        },
        decision,
        positionSizing,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`Error analyzing ${symbol}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Analyze with manual flow sentiment input
  router.post('/api/leveraged-etf/analyze/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { flowData, accountValue = 25000, riskPercent = 2, date } = req.body;

    try {
      // Check if symbol is supported
      const family = leveragedEtfStrategy.getFamily(symbol);
      if (!family) {
        return res.status(400).json({
          error: `Symbol ${symbol} is not supported. Use one of: QBTS, SOXX, PLTR (or their leveraged variants)`,
        });
      }

      // Get technical regime - use provided date or current date
      const endDate = date ? new Date(date) : new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 90);

      const formatDate = d => d.toISOString().split('T')[0];
      const candles = await polygonClient
        .getHistoricalAggregates(
          family.baseSymbol,
          formatDate(startDate),
          formatDate(endDate),
          'day'
        )
        .catch(() => []);

      let technicalRegime = { regime: 'unknown', confidence: 0 };
      if (candles && candles.length >= 50) {
        technicalRegime = regimeDetector.detectRegime(candles);
      }

      // Analyze provided flow data
      const flowSentiment = leveragedEtfStrategy.analyzeFlowSentiment(flowData);

      // Make decision
      const decision = leveragedEtfStrategy.makeDecision(
        technicalRegime,
        flowSentiment,
        family
      );

      // Get position sizing recommendation
      const positionSizing = leveragedEtfStrategy.getPositionSizing(
        decision,
        accountValue,
        riskPercent
      );

      res.json({
        symbol: symbol.toUpperCase(),
        family,
        analysis: {
          technical: technicalRegime,
          flow: flowSentiment,
        },
        decision,
        positionSizing,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`Error analyzing ${symbol}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // CHEDDARFLOW
  // ================================

  // Get flow sentiment from CheddarFlow (scraping)
  // Query params: date, stale (return stale cache immediately), refresh (force refresh)
  router.get('/api/cheddarflow/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { date, stale, refresh } = req.query;

    try {
      // Lazy initialize the scraper
      if (!cheddarFlowScraper) {
        const hasCredentials = CHEDDARFLOW_EMAIL && CHEDDARFLOW_PASSWORD;
        console.log(
          `[CheddarFlow] Initializing scraper (credentials: ${hasCredentials ? 'yes' : 'no'})`
        );

        cheddarFlowScraper = new CheddarFlowScraper({
          headless: true, // Always headless with credentials
          useExistingProfile: false,
          credentials: hasCredentials
            ? {
                email: CHEDDARFLOW_EMAIL,
                password: CHEDDARFLOW_PASSWORD,
              }
            : null,
        });
      }

      // Options for fetching
      const fetchOptions = {
        allowStale: stale === 'true',
        forceRefresh: refresh === 'true',
      };

      let flowData = await cheddarFlowScraper.getFlowSentiment(
        symbol,
        date,
        fetchOptions
      );

      // If auth needed and we have credentials, try to login and retry
      if (flowData.needsAuth && CHEDDARFLOW_EMAIL && CHEDDARFLOW_PASSWORD) {
        console.log('[CheddarFlow] Session expired, attempting auto-login...');

        const loginSuccess = await cheddarFlowScraper.login(
          CHEDDARFLOW_EMAIL,
          CHEDDARFLOW_PASSWORD
        );

        if (loginSuccess) {
          // Save cookies for next time
          try {
            const cookies = await cheddarFlowScraper.exportCookies();
            CheddarFlowScraper.saveCookies(cookies);
            console.log('[CheddarFlow] Saved new session cookies');
          } catch (e) {
            console.log('[CheddarFlow] Could not save cookies:', e.message);
          }

          // Retry the fetch (force refresh since we just logged in)
          flowData = await cheddarFlowScraper.getFlowSentiment(symbol, date, {
            forceRefresh: true,
          });
        } else {
          flowData.error =
            'Auto-login failed. Check CHEDDARFLOW_EMAIL and CHEDDARFLOW_PASSWORD in .env';
        }
      }

      const sentiment = cheddarFlowScraper.analyzeSentiment(flowData);

      res.json({
        symbol: symbol.toUpperCase(),
        date: date || new Date().toISOString().split('T')[0],
        flowData,
        sentiment,
        fromCache: flowData.fromCache || false,
        isStale: flowData.isStale || false,
        cacheTimestamp: flowData.cacheTimestamp || null,
      });
    } catch (error) {
      console.error(`Error fetching CheddarFlow for ${symbol}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Initialize CheddarFlow with credentials (POST)
  router.post('/api/cheddarflow/auth', async (req, res) => {
    const { email, password, cookies } = req.body;

    try {
      // Close existing scraper
      if (cheddarFlowScraper) {
        await cheddarFlowScraper.close();
      }

      // Create new scraper with auth
      cheddarFlowScraper = new CheddarFlowScraper({
        headless: true,
        credentials: email && password ? { email, password } : null,
        cookies: cookies || null,
      });

      // Initialize and attempt login
      await cheddarFlowScraper.init();

      // Export cookies for future use
      const sessionCookies = await cheddarFlowScraper.exportCookies();

      res.json({
        success: true,
        message: 'CheddarFlow scraper initialized',
        cookieCount: sessionCookies.length,
        // Return cookies so user can save them
        cookies: sessionCookies,
      });
    } catch (error) {
      console.error('Error initializing CheddarFlow:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Take screenshot of CheddarFlow page
  router.get('/api/cheddarflow/:symbol/screenshot', async (req, res) => {
    const { symbol } = req.params;
    const { date, useProfile } = req.query;

    try {
      // Lazy initialize the scraper with profile option
      if (
        !cheddarFlowScraper ||
        (useProfile === 'true' && !cheddarFlowScraper.useExistingProfile)
      ) {
        if (cheddarFlowScraper) {
          await cheddarFlowScraper.close();
        }
        cheddarFlowScraper = new CheddarFlowScraper({
          headless: useProfile !== 'true',
          useExistingProfile: useProfile === 'true',
        });
      }

      const screenshotPath = await cheddarFlowScraper.takeScreenshot(
        symbol,
        date
      );
      if (screenshotPath) {
        res.json({
          success: true,
          path: screenshotPath,
          message: `Screenshot saved to ${screenshotPath}`,
        });
      } else {
        res.status(500).json({ error: 'Failed to take screenshot' });
      }
    } catch (error) {
      console.error(`Error taking screenshot for ${symbol}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // UNUSUAL WHALES
  // ================================

  const unusualWhalesClient = require('../unusualWhalesClient');

  // Get market-wide sentiment (Market Tide)
  router.get('/api/unusual-whales/market-tide', async (req, res) => {
    try {
      const tideData = await unusualWhalesClient.getMarketTide();
      res.json(tideData);
    } catch (error) {
      console.error('Error fetching market tide:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get flow sentiment for a specific symbol
  router.get('/api/unusual-whales/flow/:symbol', async (req, res) => {
    const { symbol } = req.params;

    try {
      const flowData = await unusualWhalesClient.getFlowSentiment(symbol);
      res.json(flowData);
    } catch (error) {
      console.error(`Error fetching UW flow for ${symbol}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Check if Unusual Whales is configured
  router.get('/api/unusual-whales/status', (req, res) => {
    res.json({
      configured: unusualWhalesClient.isConfigured(),
      message: unusualWhalesClient.isConfigured()
        ? 'Unusual Whales API is configured'
        : 'Add UNUSUAL_WHALES_API_KEY to .env to enable',
    });
  });

  // ================================
  // STRATEGY VALIDATOR
  // ================================

  /**
   * Run multi-day strategy validation
   * POST /api/strategy-validator/run
   * Body: { symbol, startDate, endDate, config }
   */
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

  /**
   * Get quick stats for a date range (without full simulation)
   * GET /api/strategy-validator/range/:symbol?startDate=X&endDate=Y
   */
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
