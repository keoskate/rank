/**
 * Live Market Trading Test
 *
 * Tests the complete live trading flow with real market data:
 * 1. Create a new trading session with specific watchlist
 * 2. Update configuration
 * 3. Verify AI decisions are being generated
 * 4. Test session lifecycle (pause, resume, stop)
 * 5. Validate data consistency
 *
 * Run: node tests/liveMarketTradingTest.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:8080';
const TEST_USER = 'keo';
const TEST_WATCHLIST = ['SOXL', 'SOXS', 'QBTX', 'QBTZ'];

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function logResult(testName, passed, details = '') {
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${testName}${details ? ` - ${details}` : ''}`);
  results.tests.push({ name: testName, passed, details });
  if (passed) results.passed++;
  else results.failed++;
}

async function httpRequest(endpoint, method = 'GET', data = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: { 'Content-Type': 'application/json' },
    };
    if (data) config.data = data;
    const response = await axios(config);
    return { status: response.status, data: response.data };
  } catch (error) {
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { error: error.message },
    };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// TEST 1: Server Health Check
// ==========================================
async function testServerHealth() {
  console.log('\n========================================');
  console.log('TEST 1: Server Health Check');
  console.log('========================================\n');

  // Check Alpaca account
  const accountRes = await httpRequest('/api/alpaca/account');
  const accountActive = accountRes.status === 200 &&
    accountRes.data.account?.status === 'ACTIVE';
  logResult(
    'Alpaca account active',
    accountActive,
    accountActive ? `Portfolio: $${accountRes.data.account.portfolio_value}` : 'Failed'
  );

  // Check trading mode
  const modeRes = await httpRequest('/api/trading/mode');
  const isPaper = modeRes.status === 200;
  logResult('Trading mode API responsive', isPaper);

  return accountActive;
}

// ==========================================
// TEST 2: Create Trading Session
// ==========================================
async function testCreateSession() {
  console.log('\n========================================');
  console.log('TEST 2: Create Trading Session');
  console.log('========================================\n');

  const sessionConfig = {
    userId: TEST_USER,
    name: 'Live Market Test - ' + new Date().toISOString().slice(0, 16),
    config: {
      watchlist: TEST_WATCHLIST,
      allocatedCapital: 10000,
      maxPositions: 4,
      takeProfitPercent: 3,
      stopLossPercent: 1.5,
      minConfidence: 60,
      tradingStyle: 'dayTrading',
    },
  };

  const createRes = await httpRequest('/api/ai/session/start', 'POST', sessionConfig);
  const sessionCreated = createRes.status === 200 && createRes.data.sessionId;
  logResult(
    'Create trading session',
    sessionCreated,
    sessionCreated ? `ID: ${createRes.data.sessionId}` : createRes.data.error || 'Failed'
  );

  if (!sessionCreated) return null;

  const sessionId = createRes.data.sessionId;

  // Verify watchlist
  const watchlistCorrect = createRes.data.config?.watchlist?.length === TEST_WATCHLIST.length &&
    TEST_WATCHLIST.every(s => createRes.data.config.watchlist.includes(s));
  logResult(
    'Watchlist configured correctly',
    watchlistCorrect,
    `Symbols: ${createRes.data.config?.watchlist?.join(', ') || 'none'}`
  );

  // Verify config
  const configCorrect = createRes.data.config?.takeProfitPercent === 3 &&
    createRes.data.config?.stopLossPercent === 1.5;
  logResult('Trading config applied', configCorrect);

  return sessionId;
}

// ==========================================
// TEST 3: Verify AI Decisions
// ==========================================
async function testAIDecisions(sessionId) {
  console.log('\n========================================');
  console.log('TEST 3: Verify AI Decisions');
  console.log('========================================\n');

  if (!sessionId) {
    logResult('AI decisions test', false, 'No session ID');
    return;
  }

  // Wait for AI to analyze watchlist (trading loop runs every 30 seconds)
  // Wait up to 35 seconds for first analysis
  console.log('Waiting for AI analysis (up to 35 seconds)...');
  let decisions = [];
  for (let i = 0; i < 7; i++) {
    await sleep(5000);
    const checkRes = await httpRequest(`/api/ai/session/detail/${sessionId}`);
    const session = checkRes.data.session || checkRes.data;
    decisions = session.recentDecisions || [];
    if (decisions.length > 0) {
      console.log(`   Found ${decisions.length} decisions after ${(i + 1) * 5} seconds`);
      break;
    }
    console.log(`   No decisions yet... (${(i + 1) * 5}s)`);
  }

  // Get session details
  const sessionRes = await httpRequest(`/api/ai/session/detail/${sessionId}`);
  const hasSession = sessionRes.status === 200;
  logResult('Session details retrieved', hasSession);

  if (!hasSession) return;

  const session = sessionRes.data.session || sessionRes.data;

  // Update decisions from final session check
  decisions = session.recentDecisions || decisions;
  const hasDecisions = decisions.length > 0;
  logResult(
    'AI generated decisions',
    hasDecisions,
    `${decisions.length} decisions for watchlist`
  );

  if (hasDecisions) {
    // Analyze decision quality
    const decisionsWithIndicators = decisions.filter(d =>
      d.indicators && Object.keys(d.indicators).length > 0
    );
    logResult(
      'Decisions have indicators',
      decisionsWithIndicators.length > 0,
      `${decisionsWithIndicators.length}/${decisions.length} with RSI/MACD/etc`
    );

    // Check that most symbols got analyzed (at least 50% - timing dependent)
    const analyzedSymbols = [...new Set(decisions.map(d => d.symbol))];
    const minExpected = Math.ceil(TEST_WATCHLIST.length / 2);
    const mostAnalyzed = analyzedSymbols.length >= minExpected;
    logResult(
      'Most watchlist symbols analyzed',
      mostAnalyzed,
      `Analyzed: ${analyzedSymbols.length}/${TEST_WATCHLIST.length} (${analyzedSymbols.join(', ')})`
    );

    // Log sample decision
    if (decisions[0]) {
      const d = decisions[0];
      console.log(`\n   Sample decision for ${d.symbol}:`);
      console.log(`   - Action: ${d.action}`);
      console.log(`   - Confidence: ${d.confidence}%`);
      console.log(`   - Should Enter: ${d.shouldEnter}`);
      console.log(`   - Price: $${d.currentPrice}`);
      if (d.indicators) {
        console.log(`   - RSI: ${d.indicators.rsi?.toFixed(2)}`);
        console.log(`   - MACD: ${d.indicators.macd?.toFixed(4)}`);
        console.log(`   - ADX: ${d.indicators.adx?.toFixed(2)}`);
      }
      console.log(`   - Reasons: ${d.reasons?.slice(0, 3).join(', ')}`);
    }
  }
}

// ==========================================
// TEST 4: Update Session Config
// ==========================================
async function testUpdateConfig(sessionId) {
  console.log('\n========================================');
  console.log('TEST 4: Update Session Config');
  console.log('========================================\n');

  if (!sessionId) {
    logResult('Config update test', false, 'No session ID');
    return;
  }

  // Update take profit
  const updateRes = await httpRequest(`/api/ai/session/${sessionId}/config`, 'PUT', {
    takeProfitPercent: 4,
    stopLossPercent: 2,
    minConfidence: 70,
  });
  logResult('Update session config', updateRes.status === 200);

  // Verify update
  const verifyRes = await httpRequest(`/api/ai/session/detail/${sessionId}`);
  const session = verifyRes.data.session || verifyRes.data;
  const configUpdated = session.config?.takeProfitPercent === 4 &&
    session.config?.stopLossPercent === 2;
  logResult(
    'Config changes persisted',
    configUpdated,
    `TP: ${session.config?.takeProfitPercent}%, SL: ${session.config?.stopLossPercent}%`
  );
}

// ==========================================
// TEST 5: Session Lifecycle
// ==========================================
async function testSessionLifecycle(sessionId) {
  console.log('\n========================================');
  console.log('TEST 5: Session Lifecycle');
  console.log('========================================\n');

  if (!sessionId) {
    logResult('Lifecycle test', false, 'No session ID');
    return;
  }

  // Pause
  const pauseRes = await httpRequest('/api/ai/session/pause', 'POST', { sessionId });
  logResult('Pause session', pauseRes.status === 200);

  await sleep(500);

  // Check paused state
  const pausedCheck = await httpRequest(`/api/ai/session/detail/${sessionId}`);
  const isPaused = (pausedCheck.data.session || pausedCheck.data).status === 'paused';
  logResult('Session state is paused', isPaused);

  // Resume
  const resumeRes = await httpRequest('/api/ai/session/resume', 'POST', { sessionId });
  logResult('Resume session', resumeRes.status === 200);

  await sleep(500);

  // Check running state
  const runningCheck = await httpRequest(`/api/ai/session/detail/${sessionId}`);
  const isRunning = (runningCheck.data.session || runningCheck.data).status === 'running';
  logResult('Session state is running', isRunning);

  // Stop
  const stopRes = await httpRequest('/api/ai/session/stop', 'POST', { sessionId });
  logResult('Stop session', stopRes.status === 200);

  await sleep(500);

  // Check stopped state
  const stoppedCheck = await httpRequest(`/api/ai/session/detail/${sessionId}`);
  const isStopped = (stoppedCheck.data.session || stoppedCheck.data).status === 'stopped';
  logResult('Session state is stopped', isStopped);
}

// ==========================================
// TEST 6: Technical Indicators API
// ==========================================
async function testIndicatorsAPI() {
  console.log('\n========================================');
  console.log('TEST 6: Technical Indicators API');
  console.log('========================================\n');

  for (const symbol of TEST_WATCHLIST) {
    const signalsRes = await httpRequest(`/api/indicators/${symbol}/signals`);
    const hasSignals = signalsRes.status === 200 && signalsRes.data.signal;
    logResult(
      `Signals API for ${symbol}`,
      hasSignals,
      hasSignals ? `Signal: ${signalsRes.data.signal}` : 'Failed'
    );

    const patternsRes = await httpRequest(`/api/patterns/${symbol}/detect`);
    const hasPatterns = patternsRes.status === 200;
    logResult(
      `Patterns API for ${symbol}`,
      hasPatterns,
      hasPatterns ? `Patterns: ${patternsRes.data.patterns?.length || 0}` : 'Failed'
    );
  }
}

// ==========================================
// TEST 7: Session Persistence
// ==========================================
async function testSessionPersistence(sessionId) {
  console.log('\n========================================');
  console.log('TEST 7: Session Persistence (JSON Save)');
  console.log('========================================\n');

  if (!sessionId) {
    logResult('Persistence test', false, 'No session ID');
    return;
  }

  // Check server logs for save errors
  // The fix should prevent "Converting circular structure to JSON"

  // Create a new session to trigger save
  const testSession = await httpRequest('/api/ai/session/start', 'POST', {
    userId: 'persistence-test',
    name: 'Persistence Test Session',
    config: {
      watchlist: ['AAPL'],
      allocatedCapital: 1000,
    },
  });

  logResult(
    'Create session without JSON error',
    testSession.status === 200,
    testSession.data.sessionId ? 'Session saved successfully' : testSession.data.error
  );

  // Cleanup
  if (testSession.data.sessionId) {
    await httpRequest(`/api/ai/session/${testSession.data.sessionId}`, 'DELETE');
  }
}

// ==========================================
// TEST 8: Cleanup
// ==========================================
async function testCleanup(sessionId) {
  console.log('\n========================================');
  console.log('TEST 8: Cleanup');
  console.log('========================================\n');

  if (!sessionId) {
    logResult('Cleanup', true, 'No session to clean up');
    return;
  }

  const deleteRes = await httpRequest(`/api/ai/session/${sessionId}`, 'DELETE');
  logResult('Delete test session', deleteRes.status === 200);

  // Verify deletion
  const verifyRes = await httpRequest(`/api/ai/session/detail/${sessionId}`);
  const deleted = verifyRes.status !== 200 || !verifyRes.data.session;
  logResult('Session removed', deleted);
}

// ==========================================
// Main Test Runner
// ==========================================
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          LIVE MARKET TRADING TEST                              ║');
  console.log('║          Testing AI Trading with Real Market Data              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Test User: ${TEST_USER}`);
  console.log(`Watchlist: ${TEST_WATCHLIST.join(', ')}`);
  console.log(`Time: ${new Date().toISOString()}`);

  let sessionId = null;

  try {
    // Run tests in sequence
    const serverOk = await testServerHealth();
    if (!serverOk) {
      console.log('\n⚠️  Server health check failed. Some tests may fail.\n');
    }

    sessionId = await testCreateSession();
    await testAIDecisions(sessionId);
    await testUpdateConfig(sessionId);
    await testSessionLifecycle(sessionId);
    await testIndicatorsAPI();
    await testSessionPersistence(sessionId);
    await testCleanup(sessionId);

  } catch (error) {
    console.error('\n❌ Test suite error:', error.message);
    results.failed++;
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST RESULTS SUMMARY                        ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total: ${results.passed + results.failed}   Passed: ${results.passed}   Failed: ${results.failed}                             ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (results.failed > 0) {
    console.log('❌ Failed Tests:');
    results.tests.filter(t => !t.passed).forEach(t => {
      console.log(`   - ${t.name}: ${t.details}`);
    });
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

runTests();
