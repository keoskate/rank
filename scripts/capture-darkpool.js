#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/capture-darkpool.js — manually capture one dark-pool snapshot to
// data/darkpool-archive/. The server also does this automatically every 15 min
// during market hours; this is the ad-hoc / cron-fallback entry point (a
// server outage during RTH otherwise loses the day's evidence forever — UW
// keeps no history).
//
// Usage:
//   node scripts/capture-darkpool.js              # capture one snapshot
//   node scripts/capture-darkpool.js --finalize   # capture, then finalize today

require('dotenv').config();
const { captureOnce, finalizeDay } = require('../server/darkPoolArchive');

const doFinalize = process.argv.includes('--finalize');

(async () => {
  try {
    const r = await captureOnce();
    console.log('dark-pool snapshot:', JSON.stringify(r));
    if (doFinalize) {
      const f = await finalizeDay();
      console.log('finalize:', JSON.stringify(f));
    }
    process.exit(0);
  } catch (e) {
    console.error('capture failed:', e.message);
    process.exit(1);
  }
})();
