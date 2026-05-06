const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { sentimentEngine, phaseTracker, aiAnalyst, semiconductorAutoTrader } = deps;

  // Get current semiconductor sentiment (SOXX-based)
  router.get('/api/semiconductor/sentiment', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const sentiment = await sentimentEngine.getSentiment(forceRefresh);
      res.json(sentiment);
    } catch (error) {
      console.error('Error getting semiconductor sentiment:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get current market phase
  router.get('/api/semiconductor/phase', (req, res) => {
    try {
      const phase = phaseTracker.getCurrentPhase();
      res.json(phase);
    } catch (error) {
      console.error('Error getting market phase:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger AI analysis (force refresh)
  router.post('/api/semiconductor/analyze', async (req, res) => {
    try {
      const { trigger = 'manual' } = req.body;

      // First get current sentiment
      const sentiment = await sentimentEngine.getSentiment(true); // Force refresh

      // Then run AI analysis
      const analysis = await aiAnalyst.forceRefresh(sentiment, trigger);

      res.json({
        success: true,
        sentiment,
        analysis,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error in semiconductor AI analysis:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get cached AI analysis (without triggering new analysis)
  router.get('/api/semiconductor/ai-analysis', (req, res) => {
    try {
      const analysis = aiAnalyst.getCached();
      res.json({
        available: !!analysis,
        analysis: analysis || null,
        aiEnabled: aiAnalyst.isAvailable(),
      });
    } catch (error) {
      console.error('Error getting AI analysis:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ================================
  // SEMICONDUCTOR AUTO-TRADER ENDPOINTS
  // ================================

  // Get auto-trader status
  router.get('/api/semiconductor/auto-trader/status', (req, res) => {
    try {
      const status = semiconductorAutoTrader.getStatus();
      res.json(status);
    } catch (error) {
      console.error('Error getting auto-trader status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Start the auto-trader
  router.post('/api/semiconductor/auto-trader/start', (req, res) => {
    try {
      const result = semiconductorAutoTrader.start();
      res.json(result);
    } catch (error) {
      console.error('Error starting auto-trader:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Stop the auto-trader
  router.post('/api/semiconductor/auto-trader/stop', (req, res) => {
    try {
      const result = semiconductorAutoTrader.stop();
      res.json(result);
    } catch (error) {
      console.error('Error stopping auto-trader:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update auto-trader configuration
  router.patch('/api/semiconductor/auto-trader/config', (req, res) => {
    try {
      const config = semiconductorAutoTrader.updateConfig(req.body);
      res.json({ success: true, config });
    } catch (error) {
      console.error('Error updating auto-trader config:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
