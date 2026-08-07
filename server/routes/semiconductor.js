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

  // AI analyst track record — is the AI adding value? Accuracy + edge-vs-base
  // (when the AI diverges from the engine, does it win more?). Self-improving proof.
  router.get('/api/semiconductor/ai-analysis/record', (req, res) => {
    try {
      const ledger = require('../aiAnalysisLedger');
      const days = Math.min(120, parseInt(req.query.days, 10) || 45);
      const recs = ledger.loadRecent(days);
      res.json({ ...ledger.computeStats(recs), asOf: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  // Test-only: force-evaluate any pending AI-analysis records off the loop clock.
  router.post('/api/semiconductor/ai-analysis/evaluate', async (req, res) => {
    try {
      await require('../aiAnalysisLedger').evaluatePending();
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Learning view — all three forward-tests (hourly / next-day / AI) with learning
  // curves + calibration, for the Command Center "Learning" tab.
  router.get('/api/semiconductor/learning', (req, res) => {
    try {
      res.json(require('../semiLearning').build());
    } catch (error) {
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
