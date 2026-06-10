// server/routes/darkpoolArchive.js
//
// Read-only API over the dark-pool print archive
// (data/darkpool-archive/YYYY-MM-DD/<SYMBOL>.json, written by
// server/darkPoolArchive.js).
//
// Serves the /darkpool-diagnostics page. Diagnostics only — the 2026-06-01
// audit measured NO EDGE, and the B6 event study needs >= 60 archived days
// before any verdict. This router never re-derives classification locally:
// per-day decomposition comes from @keo/quant-core darkPoolCore, the single
// classifier shared with the live wrapper and the future event study.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { darkPoolCore } = require('@keo/quant-core');

const router = express.Router();

const ARCHIVE_DIR = path.join(__dirname, '../../data/darkpool-archive');

const EVENT_STUDY_THRESHOLD = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL_RE = /^[A-Z.]{1,10}$/;

// log10 premium buckets for the block-size histogram (per-print premium $).
const HISTOGRAM_BUCKETS = ['<10k', '10k-100k', '100k-1M', '1M-10M', '>=10M'];
const HISTOGRAM_EDGES = [1e4, 1e5, 1e6, 1e7]; // bucket i = [edge[i-1], edge[i])

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Sorted archived day dirs (ascending). Empty array when nothing archived. */
function listDayDirs() {
  try {
    return fs
      .readdirSync(ARCHIVE_DIR)
      .filter(d => DATE_RE.test(d))
      .sort();
  } catch {
    return [];
  }
}

/** Symbol files in one day dir (validated names only, sans extension). */
function listDaySymbols(dayDir) {
  try {
    return fs
      .readdirSync(dayDir)
      .filter(f => f.endsWith('.json') && SYMBOL_RE.test(f.slice(0, -5)))
      .map(f => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/** Count prints into log10 premium buckets. */
function blockSizeHistogram(prints) {
  const counts = HISTOGRAM_BUCKETS.map(bucket => ({ bucket, count: 0 }));
  for (const p of prints || []) {
    const prem = parseFloat(p.premium);
    if (!Number.isFinite(prem) || prem <= 0) continue;
    let i = HISTOGRAM_EDGES.findIndex(edge => prem < edge);
    if (i === -1) i = HISTOGRAM_BUCKETS.length - 1;
    counts[i].count++;
  }
  return counts;
}

module.exports = function () {
  // Archive index: one row per archived day + B6 progress denominator.
  router.get('/api/darkpool-archive', (req, res) => {
    try {
      const days = listDayDirs().map(date => {
        const dayDir = path.join(ARCHIVE_DIR, date);
        const meta = readJson(path.join(dayDir, '_meta.json'), {});
        return {
          date,
          symbols: listDaySymbols(dayDir),
          finalized: Boolean(meta.finalizedAt),
          captureCount: meta.captureCount || 0,
        };
      });
      res.json({
        days,
        totalDays: days.length,
        eventStudyThreshold: EVENT_STUDY_THRESHOLD,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Per-symbol daily decomposition via THE classifier (darkPoolCore).
  // maxSinglePrintShare: 1 disables the mega-print cap so buy/sell premium
  // reflect the RAW tape; lookbackMinutes: 1440 spans the whole day.
  router.get('/api/darkpool-archive/summary/:symbol', (req, res) => {
    try {
      const symbol = String(req.params.symbol || '').toUpperCase();
      if (!SYMBOL_RE.test(symbol)) {
        return res.status(400).json({ error: `invalid symbol: ${symbol}` });
      }
      const maxDays = Math.min(
        Math.max(parseInt(req.query.days, 10) || 90, 1),
        365
      );
      const days = [];
      for (const date of listDayDirs().slice(-maxDays)) {
        const day = readJson(
          path.join(ARCHIVE_DIR, date, `${symbol}.json`),
          null
        );
        if (!day || !Array.isArray(day.prints)) continue;
        const coverage = day.coverage || {};
        const c = darkPoolCore.classifyDarkPool(day.prints, {
          asOf: coverage.lastExecutedAt || undefined,
          lookbackMinutes: 1440,
          dropAtMid: true,
          maxSinglePrintShare: 1,
          minPrints: 1,
          rthOnly: true,
        });
        days.push({
          date,
          buyPremium: c.buyPremium,
          sellPremium: c.sellPremium,
          atMidPremium: c.atMidPremium,
          buyCount: c.buyCount,
          sellCount: c.sellCount,
          droppedAtMid: c.droppedAtMid,
          droppedAfterHours: c.droppedAfterHours,
          printCount: coverage.uniquePrints || 0,
          capHit: (coverage.cappedFetches || 0) > 0,
          lastPrintEt: coverage.lastExecutedAt || null,
          sentiment: c.sentiment,
          blockSizeHistogram: blockSizeHistogram(day.prints),
        });
      }
      res.json({ symbol, days, dayCount: days.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Raw day view: meta + per-symbol day files WITHOUT the prints arrays
  // (a liquid day can hold thousands of rows per symbol).
  router.get('/api/darkpool-archive/:date', (req, res) => {
    try {
      const { date } = req.params;
      if (!DATE_RE.test(date)) {
        return res.status(400).json({ error: `invalid date: ${date}` });
      }
      const dayDir = path.join(ARCHIVE_DIR, date);
      if (!fs.existsSync(dayDir)) {
        return res.status(404).json({ error: `no archive for ${date}` });
      }
      const meta = readJson(path.join(dayDir, '_meta.json'), null);
      const symbols = {};
      for (const sym of listDaySymbols(dayDir)) {
        const day = readJson(path.join(dayDir, `${sym}.json`), null);
        if (!day) continue;
        const { prints, ...rest } = day;
        symbols[sym] = {
          ...rest,
          printCount: Array.isArray(prints) ? prints.length : 0,
        };
      }
      res.json({ date, meta, symbols });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
