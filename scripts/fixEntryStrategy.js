#!/usr/bin/env node
/**
 * Fix entry strategy for leveraged ETFs
 *
 * Problem: "momentum" strategy chases rising prices = buying highs
 * Solution: Use "dip" strategy to buy pullbacks
 */

const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '../data/ai-sessions.json');

function main() {
  console.log('Loading sessions...');
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));

  for (const [sessionId, session] of Object.entries(data)) {
    if (session.status === 'running') {
      const oldStrategy = session.config.entryStrategy;

      // For leveraged ETFs, buy dips not momentum
      if (session.name.includes('SOXL') || session.name.includes('SOXS')) {
        session.config.entryStrategy = 'dip';
        session.config.rsiOversold = 35;     // Buy when RSI dips below 35
        session.config.rsiOverbought = 75;   // Sell when RSI above 75
        session.config.requireVolumeSpike = false;  // Don't require volume spike for dips
        session.config.minSignalsRequired = 2;      // Lower bar for entry on clear dips

        console.log(`${session.name}: ${oldStrategy} -> dip`);
        console.log(`  RSI oversold: 35, overbought: 75`);
      }
    }
  }

  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  console.log('\n✅ Entry strategies updated to buy dips instead of chasing momentum');
}

main();
