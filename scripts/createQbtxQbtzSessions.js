#!/usr/bin/env node
/**
 * Create QBTX/QBTZ momentum trading sessions
 *
 * Clones the SOXL/SOXS strategy for quantum computing ETFs:
 * - QBTX = Bull (3x long QBTS)
 * - QBTZ = Bear (3x short QBTS)
 *
 * Key differences from SOXL/SOXS:
 * - No semiconductorMode (QBTS doesn't correlate with SOXX)
 * - Uses pure technical analysis for entry/exit
 * - Same stop loss/take profit appropriate for 3x leverage
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SESSION_FILE = path.join(__dirname, '../data/ai-sessions.json');

// QBTX Bullish config (clone of SOXL Bullish Momentum)
const QBTX_BULLISH_CONFIG = {
  name: 'QBTX Bullish Momentum',
  assetType: 'stocks',
  watchlist: ['QBTX'],

  // Entry settings - buy dips
  entryStrategy: 'dip',
  minSignalsRequired: 2,
  rsiOversold: 35,
  rsiOverbought: 75,
  requireVolumeSpike: false,
  requireTrendAlignment: true,
  requireRsiSignal: true,
  minConfidence: 70,

  // Exit settings - appropriate for 3x leverage
  stopLossPercent: 4,
  takeProfitPercent: 5,
  trailingStopPercent: 40,
  trailingStopMinProfitPercent: 2,

  // Risk management
  maxPositions: 1,
  maxPositionSizePercent: 25,
  dailyLossLimitPercent: 8,
  maxConsecutiveLosses: 3,

  // Timing
  minHoldMinutes: 5,
  exitBeforeClose: true,
  exitBeforeCloseMinutes: 15,

  // NO semiconductor mode - use pure technicals
  semiconductorMode: false,
  marketGate: null,

  // Execution
  autoTrade: true,
  allowStopLossExit: true,
  paperTradeOnly: true,
};

// QBTZ Bearish config (clone of SOXS Bearish Hedge)
const QBTZ_BEARISH_CONFIG = {
  name: 'QBTZ Bearish Hedge',
  assetType: 'stocks',
  watchlist: ['QBTZ'],

  // Entry settings - buy dips (for inverse, this means when it dips from selling pressure)
  entryStrategy: 'dip',
  minSignalsRequired: 2,
  rsiOversold: 35,
  rsiOverbought: 75,
  requireVolumeSpike: false,
  requireTrendAlignment: true,
  requireRsiSignal: true,
  minConfidence: 70,

  // Exit settings - tighter for inverse ETF (decay)
  stopLossPercent: 3,
  takeProfitPercent: 4,
  trailingStopPercent: 50,
  trailingStopMinProfitPercent: 1.5,

  // Risk management
  maxPositions: 1,
  maxPositionSizePercent: 20,  // Smaller for inverse
  dailyLossLimitPercent: 6,
  maxConsecutiveLosses: 3,

  // Timing - shorter hold for inverse ETF
  minHoldMinutes: 3,
  exitBeforeClose: true,
  exitBeforeCloseMinutes: 15,

  // NO semiconductor mode
  semiconductorMode: false,
  marketGate: null,

  // Execution
  autoTrade: true,
  allowStopLossExit: true,
  paperTradeOnly: true,
};

function createSession(config, userId = 'default_user') {
  const sessionId = uuidv4();
  return {
    sessionId,
    userId,
    name: config.name,
    status: 'running',
    startTime: new Date().toISOString(),
    config: { ...config },
    portfolio: {
      cash: 100000,
      positions: [],
      initialValue: 100000,
    },
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      consecutiveLosses: 0,
      peakValue: 100000,
      maxDrawdown: 0,
      winRate: 0,
    },
    decisions: [],
    alerts: [],
    tradingLog: [],
    circuitBreakerTriggered: false,
  };
}

function main() {
  console.log('Creating QBTX/QBTZ momentum trading sessions...\n');

  // Load existing sessions
  const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));

  // Check if sessions already exist
  const existingNames = Object.values(data).map(s => s.name);

  if (existingNames.includes('QBTX Bullish Momentum')) {
    console.log('⚠️  QBTX Bullish Momentum already exists - skipping');
  } else {
    const qbtxSession = createSession(QBTX_BULLISH_CONFIG);
    data[qbtxSession.sessionId] = qbtxSession;
    console.log('✅ Created: QBTX Bullish Momentum');
    console.log(`   Session ID: ${qbtxSession.sessionId}`);
    console.log(`   Watchlist: ${QBTX_BULLISH_CONFIG.watchlist.join(', ')}`);
    console.log(`   Stop Loss: ${QBTX_BULLISH_CONFIG.stopLossPercent}%`);
    console.log(`   Take Profit: ${QBTX_BULLISH_CONFIG.takeProfitPercent}%`);
  }

  console.log('');

  if (existingNames.includes('QBTZ Bearish Hedge')) {
    console.log('⚠️  QBTZ Bearish Hedge already exists - skipping');
  } else {
    const qbtzSession = createSession(QBTZ_BEARISH_CONFIG);
    data[qbtzSession.sessionId] = qbtzSession;
    console.log('✅ Created: QBTZ Bearish Hedge');
    console.log(`   Session ID: ${qbtzSession.sessionId}`);
    console.log(`   Watchlist: ${QBTZ_BEARISH_CONFIG.watchlist.join(', ')}`);
    console.log(`   Stop Loss: ${QBTZ_BEARISH_CONFIG.stopLossPercent}%`);
    console.log(`   Take Profit: ${QBTZ_BEARISH_CONFIG.takeProfitPercent}%`);
  }

  // Save
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));

  console.log('\n========================================');
  console.log('Sessions created! Restart server to activate.');
  console.log('========================================\n');

  // Summary of all running sessions
  console.log('All sessions that will be running:');
  const runningSessions = Object.values(data).filter(s => s.status === 'running');
  runningSessions.forEach(s => {
    console.log(`  - ${s.name} (${s.config?.watchlist?.join(', ') || 'no watchlist'})`);
  });
}

main();
