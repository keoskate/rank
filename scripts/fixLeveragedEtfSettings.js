#!/usr/bin/env node
/**
 * Fix settings for leveraged ETF trading
 *
 * Problem: 1.5% stop loss on a 3x leveraged ETF is too tight
 * SOXL/SOXS regularly swing 3-5% daily
 *
 * Fix: Widen stops and targets appropriately for leverage
 */

const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '../data/ai-sessions.json');

// Appropriate settings for 3x leveraged ETFs
const LEVERAGED_ETF_SETTINGS = {
  // SOXL - 3x Bull
  'SOXL Bullish Momentum': {
    stopLossPercent: 4,        // Was 1.5% - too tight for 3x leverage
    takeProfitPercent: 5,      // Was 3% - can aim higher with momentum
    trailingStopPercent: 40,   // Lock in 40% of gains after profit
    minHoldMinutes: 5,         // Don't exit too fast
  },
  // SOXS - 3x Bear (decay risk, tighter management)
  'SOXS Bearish Hedge': {
    stopLossPercent: 3,        // Was 1% - too tight
    takeProfitPercent: 4,      // Was 2% - quick profits due to decay
    trailingStopPercent: 50,   // Tighter trailing for inverse ETF
    minHoldMinutes: 3,
  },
  // Dynamic strategy
  'SOXL/SOXS Dynamic': {
    stopLossPercent: 3.5,
    takeProfitPercent: 4.5,
    trailingStopPercent: 45,
    minHoldMinutes: 5,
  }
};

function main() {
  console.log('Loading sessions...');
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));

  let updated = 0;
  for (const [sessionId, session] of Object.entries(data)) {
    const settings = LEVERAGED_ETF_SETTINGS[session.name];
    if (settings && session.status === 'running') {
      console.log(`\nUpdating "${session.name}":`);
      console.log(`  stopLoss: ${session.config.stopLossPercent}% -> ${settings.stopLossPercent}%`);
      console.log(`  takeProfit: ${session.config.takeProfitPercent}% -> ${settings.takeProfitPercent}%`);
      console.log(`  trailingStop: ${session.config.trailingStopPercent || 0}% -> ${settings.trailingStopPercent}%`);

      session.config.stopLossPercent = settings.stopLossPercent;
      session.config.takeProfitPercent = settings.takeProfitPercent;
      session.config.trailingStopPercent = settings.trailingStopPercent;
      session.config.minHoldMinutes = settings.minHoldMinutes;
      updated++;
    }
  }

  if (updated > 0) {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
    console.log(`\n✅ Updated ${updated} session(s)`);
  }

  // Show final state
  console.log('\nFinal settings:');
  for (const [sessionId, session] of Object.entries(data)) {
    if (session.status === 'running') {
      console.log(`  ${session.name}:`);
      console.log(`    SL: ${session.config.stopLossPercent}% | TP: ${session.config.takeProfitPercent}% | Trailing: ${session.config.trailingStopPercent || 0}%`);
    }
  }
}

main();
