// server/flowCapture.js — Forward-capture of options-flow snapshots.
//
// Options flow can't be backtested from history (UW's flow-alerts is
// recent-only). The only way to get a backtestable dataset is to snapshot it
// ourselves, intraday, going forward. This appends a timestamped per-symbol
// flow snapshot (raw aggregates, no threshold applied) to a daily JSONL file
// under data/flow-history/. Later, a backtest replays these snapshots against
// subsequent prices to measure whether the flow signal predicted the move.
//
// Driven by a 15-min interval in server/index.js during market hours, plus a
// manual CLI: node scripts/capture-flow.js

const fs = require('fs');
const path = require('path');
const uw = require('./unusualWhalesClient');

const DIR = path.resolve(__dirname, '..', 'data', 'flow-history');

// High-options-volume names — the universe worth capturing for flow study.
const DEFAULT_SYMBOLS = [
  'NVDA',
  'AMD',
  'SMCI',
  'TSLA',
  'AAPL',
  'PLTR',
  'META',
  'MSFT',
  'AMZN',
];

const etDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/**
 * Capture one flow snapshot for `symbols` + market tide, appended as JSONL.
 * Stores RAW aggregates (minPremium:0) so a backtest can apply any threshold
 * after the fact. Never throws — returns a small status object.
 */
async function captureSnapshot(symbols = DEFAULT_SYMBOLS) {
  if (!uw.isConfigured()) return { captured: 0, skipped: 'no-uw-key' };
  const ts = new Date().toISOString();
  const lines = [];

  try {
    const tide = await uw.getMarketTide();
    lines.push(
      JSON.stringify({
        ts,
        type: 'tide',
        sentiment: tide.sentiment,
        callShare: tide.callShare,
        netCall: tide.netCallPremium,
        netPut: tide.netPutPremium,
      })
    );
  } catch {
    /* tide is optional */
  }

  for (const symbol of symbols) {
    try {
      const f = await uw.analyzeTickerFlow(symbol, {
        lookbackMinutes: 30,
        minPremium: 0, // capture raw flow; thresholds are applied at backtest time
        minSkew: 0.6,
      });
      lines.push(
        JSON.stringify({
          ts,
          type: 'flow',
          symbol,
          sentiment: f.sentiment,
          score: f.score,
          callShare: f.callShare,
          callPremium: f.callPremium,
          putPremium: f.putPremium,
          totalPremium: f.totalPremium,
          sweeps: f.sweepCount,
          alerts: f.alertCount,
          underlyingPrice: f.underlyingPrice,
        })
      );
    } catch {
      /* skip this symbol on transient error */
    }
  }

  if (lines.length === 0) return { captured: 0, skipped: 'no-data' };
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${etDate()}.jsonl`);
  fs.appendFileSync(file, lines.join('\n') + '\n');
  return { captured: symbols.length, file: `${etDate()}.jsonl`, ts };
}

module.exports = { captureSnapshot, DEFAULT_SYMBOLS, DIR };
