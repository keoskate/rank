const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { tradingLogger } = deps;

  // Get trading logs
  router.get('/api/trading/logs', (req, res) => {
    try {
      const { limit, level, sessionId, symbol, since } = req.query;

      const logs = tradingLogger.getLogs({
        limit: limit ? parseInt(limit) : 100,
        level: level || null,
        sessionId: sessionId || null,
        symbol: symbol || null,
        since: since || null,
      });

      res.json({ success: true, logs });
    } catch (error) {
      console.error('Error getting trading logs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get logs formatted for sharing
  router.get('/api/trading/logs/export', (req, res) => {
    try {
      const { limit, level, sessionId, symbol } = req.query;

      const formatted = tradingLogger.getLogsForSharing({
        limit: limit ? parseInt(limit) : 100,
        level: level || null,
        sessionId: sessionId || null,
        symbol: symbol || null,
      });

      res.type('text/plain').send(formatted);
    } catch (error) {
      console.error('Error exporting trading logs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear log buffer
  router.post('/api/trading/logs/clear', (req, res) => {
    try {
      tradingLogger.clearLogs();
      res.json({ success: true, message: 'Logs cleared' });
    } catch (error) {
      console.error('Error clearing trading logs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
