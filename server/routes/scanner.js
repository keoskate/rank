const express = require('express');
const router = express.Router();
const { runScan } = require('../scanner/scanRunner');
const { runOptionsScan, requoteLatest } = require('../scanner/optionsScanRunner');
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

  router.post('/api/scanner/options/scan', async (req, res) => {
    try {
      const {
        symbols, horizonDays, minProbability, maxUnderlyings,
        dteMin, dteMax, maxSpreadPct, minOpenInterest, minDelta, maxDebit,
        earningsMode, maxResults, reuseStockScan,
      } = req.body || {};
      const num = v => (Number.isFinite(+v) ? +v : undefined);
      const result = await runOptionsScan({
        symbols: Array.isArray(symbols) ? symbols : undefined,
        horizonDays: num(horizonDays),
        minProbability: num(minProbability),
        maxUnderlyings: num(maxUnderlyings),
        dteMin: num(dteMin),
        dteMax: num(dteMax),
        maxSpreadPct: num(maxSpreadPct),
        minOpenInterest: num(minOpenInterest),
        minDelta: num(minDelta),
        maxDebit: num(maxDebit) ?? null,
        earningsMode: ['all', 'exclude', 'only'].includes(earningsMode) ? earningsMode : undefined,
        maxResults: num(maxResults),
        reuseStockScan: reuseStockScan !== false,
      });
      res.json(result);
    } catch (err) {
      console.error('Scanner /options/scan error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/scanner/options/requote', async (req, res) => {
    try {
      res.json(await requoteLatest());
    } catch (err) {
      console.error('Scanner /options/requote error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/scanner/options/track-record', async (req, res) => {
    try {
      const limit = Number.isFinite(+req.query.limit) ? +req.query.limit : 50;
      res.json(await require('../scanner/optionsTrackRecord').getReport({ limit }));
    } catch (err) {
      console.error('Scanner /options/track-record error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/scanner/options/last', (req, res) => {
    try {
      const latest = scanStore.loadLatest('options-scan');
      if (!latest) return res.status(404).json({ error: 'No options scans yet' });
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
