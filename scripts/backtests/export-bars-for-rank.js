#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/export-bars-for-rank.js
//
// The single-data-path bridge into the Python research layer.
//
// The Python GBDT producer (python/research/build_rank_scores.py) must NOT
// fetch its own bars — that would be a second data path and re-open every bug
// marketData.js closed (Polygon floors, unadjusted splits, contaminated
// tickers). Instead this Node script loads the SAME Alpaca split+dividend-
// adjusted daily bars every backtest uses (via loadDailyBars) and dumps them to
// data/rank-cache/_bars.json for Python to consume read-only.
//
//   node scripts/backtests/export-bars-for-rank.js
//
// Output:
//   data/rank-cache/_bars.json  { sym: [{date,open,high,low,close,volume}] }
//   data/rank-cache/_meta.json  { window, symbols, integrity summary, source }

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { loadDailyBars } = require('./lib/marketData');
const { resolveUniverse } = require('./lib/rankUniverse');

async function main() {
  const { name, START, UNIVERSE, ALL, bench, benchTradable, RANK_CACHE_DIR } =
    resolveUniverse();
  fs.mkdirSync(RANK_CACHE_DIR, { recursive: true });
  console.log(
    `[export] universe '${name}': loading ${ALL.length} symbols (alpaca adjusted, ${START}+)`
  );
  const { bars, integrity } = await loadDailyBars(ALL, { start: START });

  const missing = ALL.filter(s => !bars[s] || !bars[s].length);
  if (missing.length) {
    throw new Error(
      `refusing to export a shrunken universe — fetch failed for: ${missing.join(', ')}`
    );
  }

  const barsPath = path.join(RANK_CACHE_DIR, '_bars.json');
  const metaPath = path.join(RANK_CACHE_DIR, '_meta.json');
  fs.writeFileSync(barsPath, JSON.stringify(bars));
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        universe: name,
        source: integrity.source,
        adjustment: integrity.adjustment,
        timeframe: integrity.timeframe,
        window: integrity.window,
        bench, // calendar anchor + market-relative reference
        benchTradable, // is the bench also a rankable asset in this universe?
        tradables: UNIVERSE, // the names the ranker is allowed to hold
        symbols: ALL,
        barCounts: Object.fromEntries(ALL.map(s => [s, bars[s].length])),
      },
      null,
      2
    )
  );

  const totalBars = ALL.reduce((a, s) => a + bars[s].length, 0);
  console.log(
    `[export] wrote ${ALL.length} symbols / ${totalBars} bars → ${path.relative(process.cwd(), barsPath)}`
  );
  console.log(`[export] window ${integrity.window.start}..${integrity.window.end}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
