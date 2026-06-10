// server/routes/backtestRuns.js
//
// Read-only API over standardized backtest run artifacts
// (data/backtests/runs/<runId>/run.json, produced by
// scripts/backtests/lib/runArtifact.js).
//
// The web Backtest page renders these artifacts directly — same numbers as
// the terminal viewer and the sim itself. This router deliberately has no
// "run a backtest" endpoint: runs are produced by the audited scripts, not
// by a second server-side engine.

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const RUNS_DIR = path.join(__dirname, '../../data/backtests/runs');

function safeRunPath(runId) {
  // runIds are slugs (alnum, dash, underscore); reject anything else so this
  // can't be used to read arbitrary files.
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) return null;
  const p = path.join(RUNS_DIR, runId, 'run.json');
  return fs.existsSync(p) ? p : null;
}

module.exports = function () {
  // List runs (lightweight catalog)
  router.get('/api/backtest-runs', (req, res) => {
    try {
      const indexPath = path.join(RUNS_DIR, 'index.json');
      if (!fs.existsSync(indexPath)) {
        return res.json({ runs: [] });
      }
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      res.json({ runs: index.runs || [] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Full artifact for one run
  router.get('/api/backtest-runs/:runId', (req, res) => {
    try {
      const p = safeRunPath(req.params.runId);
      if (!p) {
        return res
          .status(404)
          .json({ error: `run not found: ${req.params.runId}` });
      }
      res.setHeader('Content-Type', 'application/json');
      fs.createReadStream(p).pipe(res);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
