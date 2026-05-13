const express = require('express');
const router = express.Router();
const { runScan } = require('../scanner/scanRunner');
const scanStore = require('../scanner/scanStore');

module.exports = function () {
  router.post('/api/scanner/scan', async (req, res) => {
    try {
      const { symbols, horizonDays, minProbability, maxResults } = req.body || {};
      const result = await runScan({
        symbols: Array.isArray(symbols) ? symbols : undefined,
        horizonDays: Number.isFinite(+horizonDays) ? +horizonDays : undefined,
        minProbability: Number.isFinite(+minProbability) ? +minProbability : undefined,
        maxResults: Number.isFinite(+maxResults) ? +maxResults : undefined,
      });
      res.json(result);
    } catch (err) {
      console.error('Scanner /scan error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/scanner/last', (req, res) => {
    try {
      const latest = scanStore.loadLatest();
      if (!latest) return res.status(404).json({ error: 'No scans yet' });
      res.json(latest);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/scanner/history', (req, res) => {
    try {
      const limit = Number.isFinite(+req.query.limit) ? +req.query.limit : 10;
      res.json({ history: scanStore.listHistory(limit) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
