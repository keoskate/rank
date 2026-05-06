const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { snapshotManager, historicalDataManager } = deps;

  // 11. Get available snapshot dates
  router.get('/api/snapshots/dates', async (req, res) => {
    try {
      const dates = await snapshotManager.getAvailableSnapshots();
      res.json({
        success: true,
        dates,
        count: dates.length,
        message: 'Snapshot dates retrieved successfully',
      });
    } catch (error) {
      console.error('❌ Error retrieving snapshot dates:', error.message);
      res.status(500).json({ error: 'Failed to retrieve snapshot dates' });
    }
  });

  // 12. Get snapshot for specific date
  router.get('/api/snapshots/:date', async (req, res) => {
    try {
      const { date } = req.params;
      const snapshot = await snapshotManager.loadSnapshot(date);

      if (!snapshot) {
        return res
          .status(404)
          .json({ error: 'Snapshot not found for specified date' });
      }

      res.json({
        success: true,
        snapshot,
        message: 'Snapshot retrieved successfully',
      });
    } catch (error) {
      console.error('❌ Error retrieving snapshot:', error.message);
      res.status(500).json({ error: 'Failed to retrieve snapshot' });
    }
  });

  // 13. Get snapshot range
  router.get('/api/snapshots/range/:startDate/:endDate', async (req, res) => {
    try {
      const { startDate, endDate } = req.params;
      const snapshots = await snapshotManager.loadSnapshotRange(
        startDate,
        endDate
      );

      res.json({
        success: true,
        snapshots,
        count: snapshots.length,
        startDate,
        endDate,
        message: 'Snapshot range retrieved successfully',
      });
    } catch (error) {
      console.error('❌ Error retrieving snapshot range:', error.message);
      res.status(500).json({ error: 'Failed to retrieve snapshot range' });
    }
  });

  // 14. Generate synthetic historical snapshots
  router.post('/api/snapshots/generate-history', async (req, res) => {
    try {
      let { stocks, days = 90, stockListName = 'Default' } = req.body;

      // If no stocks provided, use default mock stocks for testing
      if (!stocks || !Array.isArray(stocks) || stocks.length === 0) {
        console.log('No stocks provided, using default mock stocks for testing');
        stocks = [
          {
            ticker: 'NVDA',
            score: 95.2,
            price: 150.0,
            rsi: 68.5,
            volume: 45000000,
          },
          {
            ticker: 'AAPL',
            score: 92.1,
            price: 185.0,
            rsi: 62.3,
            volume: 52000000,
          },
          {
            ticker: 'MSFT',
            score: 89.5,
            price: 375.0,
            rsi: 58.7,
            volume: 28000000,
          },
          {
            ticker: 'GOOGL',
            score: 87.3,
            price: 140.0,
            rsi: 55.2,
            volume: 22000000,
          },
          {
            ticker: 'AMZN',
            score: 85.1,
            price: 170.0,
            rsi: 60.1,
            volume: 48000000,
          },
          {
            ticker: 'META',
            score: 83.4,
            price: 485.0,
            rsi: 65.4,
            volume: 18000000,
          },
          {
            ticker: 'TSLA',
            score: 81.2,
            price: 250.0,
            rsi: 52.8,
            volume: 95000000,
          },
          {
            ticker: 'AMD',
            score: 79.8,
            price: 145.0,
            rsi: 59.3,
            volume: 38000000,
          },
          {
            ticker: 'CRM',
            score: 77.5,
            price: 290.0,
            rsi: 54.6,
            volume: 14000000,
          },
          {
            ticker: 'NFLX',
            score: 75.2,
            price: 665.0,
            rsi: 61.2,
            volume: 11000000,
          },
        ];
      }

      const snapshots = await snapshotManager.generateSyntheticHistory(
        stocks,
        days,
        stockListName
      );

      res.json({
        success: true,
        snapshotsGenerated: snapshots.length,
        days,
        message: 'Synthetic historical snapshots generated successfully',
      });
    } catch (error) {
      console.error('❌ Error generating synthetic history:', error.message);
      res.status(500).json({ error: 'Failed to generate synthetic history' });
    }
  });

  // 14b. Backfill REAL historical data from Polygon API
  router.post('/api/snapshots/backfill-real-history', async (req, res) => {
    try {
      let { symbols, days = 90, stockListName = 'Real Data' } = req.body;

      // Use default symbols if none provided
      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        symbols = [
          'NVDA',
          'AAPL',
          'MSFT',
          'GOOGL',
          'AMZN',
          'META',
          'TSLA',
          'AMD',
          'CRM',
          'NFLX',
        ];
        console.log(`No symbols provided, using defaults: ${symbols.join(', ')}`);
      }

      console.log(
        `\n🚀 Starting real data backfill for ${symbols.length} symbols, ${days} days...`
      );

      const snapshots = await historicalDataManager.backfillRealHistory(
        symbols,
        days,
        stockListName
      );

      res.json({
        success: true,
        snapshotsGenerated: snapshots.length,
        symbols: symbols.length,
        days,
        dataSource: 'Polygon.io',
        message: `Real historical data backfilled successfully from Polygon API`,
      });
    } catch (error) {
      console.error('❌ Error backfilling real history:', error.message);
      res.status(500).json({
        error: 'Failed to backfill real historical data',
        details: error.message,
      });
    }
  });

  // 14c. Get current rankings from live data
  router.get('/api/rankings/current', async (req, res) => {
    try {
      const symbols = req.query.symbols
        ? req.query.symbols.split(',')
        : [
            'NVDA',
            'AAPL',
            'MSFT',
            'GOOGL',
            'AMZN',
            'META',
            'TSLA',
            'AMD',
            'CRM',
            'NFLX',
          ];

      const rankings = await historicalDataManager.getCurrentRankings(symbols);

      res.json({
        success: true,
        rankings,
        count: rankings.length,
        message: 'Current rankings fetched successfully',
      });
    } catch (error) {
      console.error('❌ Error fetching current rankings:', error.message);
      res.status(500).json({ error: 'Failed to fetch current rankings' });
    }
  });

  // 14d. Save today's snapshot from live data
  router.post('/api/snapshots/save-today', async (req, res) => {
    try {
      let { symbols, stockListName = 'Real Data' } = req.body;

      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        symbols = [
          'NVDA',
          'AAPL',
          'MSFT',
          'GOOGL',
          'AMZN',
          'META',
          'TSLA',
          'AMD',
          'CRM',
          'NFLX',
        ];
      }

      const snapshot = await historicalDataManager.saveTodaySnapshot(
        symbols,
        stockListName
      );

      res.json({
        success: true,
        snapshot,
        message: "Today's snapshot saved successfully",
      });
    } catch (error) {
      console.error("❌ Error saving today's snapshot:", error.message);
      res.status(500).json({ error: "Failed to save today's snapshot" });
    }
  });

  // 14e. Check historical data availability
  router.get('/api/snapshots/availability', async (req, res) => {
    try {
      const requiredDays = parseInt(req.query.days) || 90;
      const availability =
        await historicalDataManager.checkHistoricalDataAvailability(requiredDays);

      res.json({
        success: true,
        ...availability,
        message: availability.available
          ? 'Sufficient historical data available'
          : 'Insufficient historical data - backfill recommended',
      });
    } catch (error) {
      console.error('❌ Error checking availability:', error.message);
      res.status(500).json({ error: 'Failed to check data availability' });
    }
  });

  // 16. Get quarterly data for a stock
  router.get('/api/quarterly/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const data = await snapshotManager.loadQuarterlyData(symbol);

      if (!data) {
        return res
          .status(404)
          .json({ error: 'Quarterly data not found for symbol' });
      }

      res.json({
        success: true,
        data,
        message: 'Quarterly data retrieved successfully',
      });
    } catch (error) {
      console.error('❌ Error retrieving quarterly data:', error.message);
      res.status(500).json({ error: 'Failed to retrieve quarterly data' });
    }
  });

  // 16. Calculate QoQ for a stock metric
  router.get('/api/quarterly/:symbol/qoq/:metric', async (req, res) => {
    try {
      const { symbol, metric } = req.params;
      const qoq = await snapshotManager.calculateQoQ(symbol, metric);

      if (!qoq) {
        return res.status(404).json({ error: 'QoQ data not available' });
      }

      res.json({
        success: true,
        qoq,
        message: 'QoQ calculation retrieved successfully',
      });
    } catch (error) {
      console.error('❌ Error calculating QoQ:', error.message);
      res.status(500).json({ error: 'Failed to calculate QoQ' });
    }
  });

  // 17. Calculate YoY for a stock metric
  router.get('/api/quarterly/:symbol/yoy/:metric', async (req, res) => {
    try {
      const { symbol, metric } = req.params;
      const yoy = await snapshotManager.calculateYoY(symbol, metric);

      if (!yoy) {
        return res.status(404).json({ error: 'YoY data not available' });
      }

      res.json({
        success: true,
        yoy,
        message: 'YoY calculation retrieved successfully',
      });
    } catch (error) {
      console.error('❌ Error calculating YoY:', error.message);
      res.status(500).json({ error: 'Failed to calculate YoY' });
    }
  });

  return router;
};
