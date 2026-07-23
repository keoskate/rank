#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/capture-insider.js — pull the UW insider-transactions feed once and
// merge every filing into data/insider-archive/ (verbatim, deduped, sharded by
// filing date). The feed reaches back only ~3 weeks, so ONE run per day loses
// nothing; a missed WEEK starts losing the oldest days forever.
//
// Usage:
//   node scripts/capture-insider.js          # capture + print archive stats
//   npm run capture:insider

require('dotenv').config();
const { captureOnce, archiveStats } = require('../server/insiderArchive');

(async () => {
  try {
    const r = await captureOnce();
    if (r.error) {
      console.error('capture failed:', r.error);
      process.exit(1);
    }
    console.log(
      `insider capture: ${r.pagesFetched} pages, ${r.rowsSeen} rows seen, ${r.rowsAdded} new — filings ${r.oldestFiling}..${r.newestFiling}`
    );
    const s = archiveStats();
    console.log(
      `archive: ${s.days} filing-days, ${s.rows} rows, ${s.first}..${s.last}`
    );
    process.exit(0);
  } catch (e) {
    console.error('capture failed:', e.message);
    process.exit(1);
  }
})();
