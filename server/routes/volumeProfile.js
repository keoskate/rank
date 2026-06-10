// server/routes/volumeProfile.js
//
// Read-only volume-profile endpoint for chart overlays.
//
// GET /api/volume-profile/:symbol?days=20&bins=40
//
// Fetches 1-minute Alpaca bars, filters to regular trading hours
// (09:30-16:00 ET, weekdays), keeps the last `days` distinct ET sessions,
// and bins volume at per-bar vwap (HLC/3 fallback) via @keo/quant-core.
// This endpoint supersedes the Polygon-5Min indicators.volumeProfile for
// chart display.

const express = require('express');

const alpacaClient = require('../alpacaClient');
const { volumeProfile } = require('@keo/quant-core');

const router = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // symbol|days|bins -> { at, payload }

const RTH_START_MIN = 570; // 09:30 ET
const RTH_END_MIN = 960; // 16:00 ET

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function etParts(date) {
  const parts = {};
  for (const { type, value } of etFormatter.formatToParts(date)) {
    parts[type] = value;
  }
  return parts;
}

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

module.exports = function () {
  router.get('/api/volume-profile/:symbol', async (req, res) => {
    try {
      const rawSymbol = req.params.symbol || '';
      if (!/^[A-Za-z.]{1,10}$/.test(rawSymbol)) {
        return res.status(400).json({ error: `invalid symbol: ${rawSymbol}` });
      }
      const symbol = rawSymbol.toUpperCase();
      const days = clampInt(req.query.days, 1, 30, 20);
      const bins = clampInt(req.query.bins, 10, 100, 40);

      const cacheKey = `${symbol}|${days}|${bins}`;
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return res.json(cached.payload);
      }

      // Calendar lookback wide enough to cover `days` sessions across
      // weekends/holidays.
      const now = new Date();
      const from = new Date(now.getTime() - (days * 1.6 + 5) * 86400000);
      const bars = await alpacaClient.getBars(
        symbol,
        '1Min',
        from.toISOString(),
        now.toISOString(),
        100000
      );

      if (!Array.isArray(bars) || bars.length === 0) {
        return res
          .status(404)
          .json({ error: `no 1Min bars returned for ${symbol}` });
      }

      // RTH filter (09:30-16:00 ET inclusive, weekdays), tagging each bar
      // with its ET session date.
      const rthBars = [];
      for (const bar of bars) {
        const parts = etParts(new Date(bar.timestamp));
        if (parts.weekday === 'Sat' || parts.weekday === 'Sun') continue;
        const minutes = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
        if (minutes < RTH_START_MIN || minutes > RTH_END_MIN) continue;
        rthBars.push({
          ...bar,
          session: `${parts.year}-${parts.month}-${parts.day}`,
        });
      }

      if (rthBars.length === 0) {
        return res
          .status(404)
          .json({ error: `no RTH bars for ${symbol} in lookback window` });
      }

      // Keep only the last `days` distinct ET sessions.
      const sessionKeys = [...new Set(rthBars.map(b => b.session))].sort();
      const kept = new Set(sessionKeys.slice(-days));
      const windowBars = rthBars.filter(b => kept.has(b.session));

      const profile = volumeProfile.buildVolumeProfile(windowBars, { bins });
      if (!profile.ok) {
        return res.status(422).json({
          error: `volume profile computation failed for ${symbol}`,
          reason: profile.reason || null,
        });
      }

      const payload = {
        symbol,
        days,
        bins: profile.bins,
        pocPrice: profile.pocPrice,
        vah: profile.vah,
        val: profile.val,
        totalVolume: profile.totalVolume,
        barCount: windowBars.length,
        sessions: kept.size,
        timeframe: '1Min',
        rth: '09:30-16:00 ET',
        source: 'alpaca',
        computedAt: new Date().toISOString(),
        notes: [
          'volume binned at per-bar vwap (HLC/3 fallback)',
          'this endpoint supersedes the Polygon-5Min indicators.volumeProfile for chart display',
        ],
      };

      cache.set(cacheKey, { at: Date.now(), payload });
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
