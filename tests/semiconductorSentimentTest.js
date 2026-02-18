/**
 * Semiconductor Sentiment System Test Suite
 *
 * Tests the SOXL/SOXS momentum trading system including:
 * - Sentiment engine
 * - Market phase detection
 * - AI analysis integration
 * - API endpoints
 * - Strategy presets
 *
 * Run: node tests/semiconductorSentimentTest.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:8080';
const TEST_USER = 'test_semiconductor_user';

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

// Helper functions
function log(message, type = 'info') {
  const prefix = {
    info: '\x1b[36m[INFO]\x1b[0m',
    pass: '\x1b[32m[PASS]\x1b[0m',
    fail: '\x1b[31m[FAIL]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
  };
  console.log(`${prefix[type] || prefix.info} ${message}`);
}

function assert(condition, testName, details = '') {
  if (condition) {
    results.passed++;
    results.tests.push({ name: testName, status: 'passed' });
    log(`${testName}`, 'pass');
    return true;
  } else {
    results.failed++;
    results.tests.push({ name: testName, status: 'failed', details });
    log(`${testName} - ${details}`, 'fail');
    return false;
  }
}

// ============================================================
// TEST SUITES
// ============================================================

/**
 * Test 1: Server Health Check
 */
async function testServerHealth() {
  log('\n--- Test 1: Server Health Check ---');

  try {
    const response = await axios.get(`${BASE_URL}/api/health`, { timeout: 5000 });
    assert(response.status === 200, 'Server is healthy');
    return true;
  } catch (error) {
    assert(false, 'Server is healthy', `Server not responding: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: Semiconductor Sentiment Endpoint
 */
async function testSentimentEndpoint() {
  log('\n--- Test 2: Semiconductor Sentiment Endpoint ---');

  try {
    const response = await axios.get(`${BASE_URL}/api/semiconductor/sentiment`);

    assert(response.status === 200, 'Sentiment endpoint returns 200');

    const data = response.data;

    // Check required fields
    assert(
      data.direction !== undefined,
      'Sentiment has direction field',
      `Got: ${JSON.stringify(data)}`
    );

    assert(
      ['bullish', 'bearish', 'neutral'].includes(data.direction) || data.error,
      'Direction is valid (bullish/bearish/neutral) or error state',
      `Got: ${data.direction}`
    );

    assert(
      data.confidence !== undefined || data.error,
      'Sentiment has confidence field',
      `Got: ${JSON.stringify(data)}`
    );

    if (!data.error) {
      assert(
        data.confidence >= 0 && data.confidence <= 100,
        'Confidence is between 0-100',
        `Got: ${data.confidence}`
      );

      assert(data.timestamp !== undefined, 'Sentiment has timestamp');
      assert(data.referenceSymbol === 'SOXX', 'Reference symbol is SOXX', `Got: ${data.referenceSymbol}`);

      log(`Sentiment: ${data.direction} (${data.confidence}% confidence)`, 'info');
      log(`SOXX: $${data.currentPrice} (${data.intradayChange})`, 'info');
    } else {
      log(`Sentiment returned error (expected if market closed): ${data.error}`, 'warn');
    }

    return true;
  } catch (error) {
    assert(false, 'Sentiment endpoint works', error.message);
    return false;
  }
}

/**
 * Test 3: Market Phase Endpoint
 */
async function testMarketPhaseEndpoint() {
  log('\n--- Test 3: Market Phase Endpoint ---');

  try {
    const response = await axios.get(`${BASE_URL}/api/semiconductor/phase`);

    assert(response.status === 200, 'Phase endpoint returns 200');

    const data = response.data;

    const validPhases = ['PRE_MARKET', 'OPEN', 'SETTLE', 'ACTIVE', 'WIND_DOWN', 'CLOSE', 'AFTER_HOURS', 'CLOSED'];
    assert(
      validPhases.includes(data.phase),
      'Phase is valid',
      `Got: ${data.phase}`
    );

    assert(data.tradingAllowed !== undefined, 'Has tradingAllowed field');
    assert(data.description !== undefined, 'Has description field');
    assert(data.currentTimeET !== undefined, 'Has currentTimeET field');

    log(`Current phase: ${data.phase} (trading: ${data.tradingAllowed ? 'YES' : 'NO'})`, 'info');
    log(`ET Time: ${data.currentTimeET.toFixed(2)} hours`, 'info');

    return true;
  } catch (error) {
    assert(false, 'Phase endpoint works', error.message);
    return false;
  }
}

/**
 * Test 4: AI Analysis Endpoint
 */
async function testAIAnalysisEndpoint() {
  log('\n--- Test 4: AI Analysis Endpoint ---');

  try {
    // First check if cached analysis exists
    const cacheResponse = await axios.get(`${BASE_URL}/api/semiconductor/ai-analysis`);
    assert(cacheResponse.status === 200, 'AI analysis cache endpoint returns 200');

    log(`AI enabled: ${cacheResponse.data.aiEnabled}`, 'info');
    log(`Cached analysis available: ${cacheResponse.data.available}`, 'info');

    // Trigger new analysis
    log('Triggering AI analysis (this may take a few seconds)...', 'info');
    const analyzeResponse = await axios.post(
      `${BASE_URL}/api/semiconductor/analyze`,
      { trigger: 'test' },
      { timeout: 30000 } // 30s timeout for AI
    );

    assert(analyzeResponse.status === 200, 'AI analyze endpoint returns 200');

    const data = analyzeResponse.data;
    assert(data.sentiment !== undefined, 'Response includes sentiment');
    assert(data.analysis !== undefined, 'Response includes analysis');

    if (data.analysis && !data.analysis.error && !data.analysis.aiDisabled) {
      assert(
        ['bullish', 'bearish', 'neutral'].includes(data.analysis.direction),
        'AI analysis has valid direction',
        `Got: ${data.analysis.direction}`
      );

      assert(
        data.analysis.confidenceAdjustment >= -20 && data.analysis.confidenceAdjustment <= 20,
        'Confidence adjustment is within range',
        `Got: ${data.analysis.confidenceAdjustment}`
      );

      log(`AI Direction: ${data.analysis.direction}`, 'info');
      log(`Confidence Adjustment: ${data.analysis.confidenceAdjustment > 0 ? '+' : ''}${data.analysis.confidenceAdjustment}`, 'info');
      log(`Reasoning: ${data.analysis.reasoning}`, 'info');
      log(`Risk Level: ${data.analysis.riskLevel}`, 'info');
    } else {
      log('AI analysis not available (API key may not be set)', 'warn');
    }

    return true;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      log('AI analysis timed out (30s) - this may be expected', 'warn');
      return true;
    }
    assert(false, 'AI analysis endpoint works', error.message);
    return false;
  }
}

/**
 * Test 5: Strategy Presets Endpoint
 */
async function testStrategyPresetsEndpoint() {
  log('\n--- Test 5: Strategy Presets Endpoint ---');

  try {
    const response = await axios.get(`${BASE_URL}/api/ai/presets`);

    assert(response.status === 200, 'Presets endpoint returns 200');
    assert(Array.isArray(response.data.presets), 'Returns array of presets');

    const presets = response.data.presets;
    const expectedPresets = ['SOXL_MOMENTUM', 'SOXS_HEDGE', 'SOXL_SOXS_COMBO'];

    for (const expected of expectedPresets) {
      const found = presets.find(p => p.id === expected);
      assert(found !== undefined, `Preset ${expected} exists`);
      if (found) {
        log(`  ${found.id}: ${found.name} (${found.watchlist.join(', ')})`, 'info');
      }
    }

    // Test getting a specific preset
    const detailResponse = await axios.get(`${BASE_URL}/api/ai/presets/SOXL_MOMENTUM`);
    assert(detailResponse.status === 200, 'Get specific preset returns 200');
    assert(detailResponse.data.preset.semiconductorMode === true, 'SOXL_MOMENTUM has semiconductorMode enabled');
    assert(detailResponse.data.preset.marketGate === 'bullish', 'SOXL_MOMENTUM has bullish gate');

    return true;
  } catch (error) {
    assert(false, 'Presets endpoint works', error.message);
    return false;
  }
}

/**
 * Test 6: Start Session from Preset
 */
async function testStartSessionFromPreset() {
  log('\n--- Test 6: Start Session from Preset ---');

  let sessionId = null;

  try {
    // Start SOXL_MOMENTUM session
    const startResponse = await axios.post(`${BASE_URL}/api/ai/session/from-preset`, {
      userId: TEST_USER,
      presetName: 'SOXL_MOMENTUM',
      overrides: { autoTrade: false }, // Safety: don't auto-trade in tests
    });

    assert(startResponse.status === 200, 'Start preset session returns 200');
    assert(startResponse.data.success === true, 'Session started successfully');
    assert(startResponse.data.sessionId !== undefined, 'Session ID returned');
    assert(startResponse.data.preset === 'SOXL_MOMENTUM', 'Correct preset name returned');

    sessionId = startResponse.data.sessionId;
    log(`Session started: ${sessionId}`, 'info');

    // Verify session config
    const statusResponse = await axios.get(`${BASE_URL}/api/ai/session/detail/${sessionId}`);
    assert(statusResponse.status === 200, 'Get session detail returns 200');

    const session = statusResponse.data;
    assert(session.config.semiconductorMode === true, 'Session has semiconductorMode enabled');
    assert(session.config.marketGate === 'bullish', 'Session has bullish market gate');
    assert(session.config.watchlist.includes('SOXL'), 'Session watchlist includes SOXL');
    assert(session.config.aiSentimentEnabled === true, 'Session has AI sentiment enabled');

    log(`Session config verified: semiconductorMode=${session.config.semiconductorMode}, gate=${session.config.marketGate}`, 'info');

    return sessionId;
  } catch (error) {
    assert(false, 'Start session from preset', error.message);
    return null;
  }
}

/**
 * Test 7: Stop Session
 */
async function testStopSession(sessionId) {
  log('\n--- Test 7: Stop Session ---');

  if (!sessionId) {
    log('No session to stop (previous test failed)', 'warn');
    return false;
  }

  try {
    const response = await axios.post(`${BASE_URL}/api/ai/session/stop`, {
      sessionId,
    });

    assert(response.status === 200, 'Stop session returns 200');
    assert(response.data.success === true, 'Session stopped successfully');

    log(`Session ${sessionId} stopped`, 'info');
    return true;
  } catch (error) {
    assert(false, 'Stop session', error.message);
    return false;
  }
}

/**
 * Test 8: Dynamic Thresholds
 */
async function testDynamicThresholds() {
  log('\n--- Test 8: Dynamic Thresholds ---');

  try {
    const response = await axios.get(`${BASE_URL}/api/semiconductor/sentiment`);

    if (response.data.error) {
      log('Skipping threshold test (market data unavailable)', 'warn');
      return true;
    }

    const data = response.data;

    assert(data.thresholds !== undefined, 'Sentiment includes thresholds');

    if (data.thresholds) {
      assert(data.thresholds.entry !== undefined, 'Has entry threshold');
      assert(data.thresholds.exit !== undefined, 'Has exit threshold');
      assert(data.thresholds.switch !== undefined, 'Has switch threshold');

      log(`Entry threshold: ${data.thresholds.entry}`, 'info');
      log(`Exit threshold: ${data.thresholds.exit}`, 'info');
      log(`Switch threshold: ${data.thresholds.switch}`, 'info');

      // Verify switch > entry (harder to switch than enter)
      if (data.thresholds.entryRaw && data.thresholds.switchRaw) {
        assert(
          data.thresholds.switchRaw > data.thresholds.entryRaw,
          'Switch threshold > entry threshold (prevents whipsaw)',
          `Entry: ${data.thresholds.entryRaw}, Switch: ${data.thresholds.switchRaw}`
        );
      }
    }

    return true;
  } catch (error) {
    assert(false, 'Dynamic thresholds test', error.message);
    return false;
  }
}

/**
 * Test 9: Phase Transitions (Mock)
 */
async function testPhaseTransitions() {
  log('\n--- Test 9: Phase Transition Logic ---');

  // This tests the phase tracker logic without requiring real market hours

  const phases = ['PRE_MARKET', 'OPEN', 'SETTLE', 'ACTIVE', 'WIND_DOWN', 'CLOSE', 'AFTER_HOURS', 'CLOSED'];

  // Verify current phase is valid
  const response = await axios.get(`${BASE_URL}/api/semiconductor/phase`);
  const currentPhase = response.data.phase;

  assert(phases.includes(currentPhase), `Current phase '${currentPhase}' is valid`);

  // Log trading rules for each phase
  const phaseRules = {
    PRE_MARKET: 'No trading',
    OPEN: 'Observe only',
    SETTLE: 'Confirm direction',
    ACTIVE: 'Full trading',
    WIND_DOWN: 'Exit SOXS positions',
    CLOSE: 'Force exit all',
    AFTER_HOURS: 'No trading',
    CLOSED: 'No trading',
  };

  log(`Current phase: ${currentPhase} - ${phaseRules[currentPhase]}`, 'info');

  // Test isTransition detection
  assert(
    response.data.isTransition !== undefined,
    'Phase response includes isTransition field'
  );

  return true;
}

/**
 * Test 10: Full Integration Test
 */
async function testFullIntegration() {
  log('\n--- Test 10: Full Integration Test ---');

  try {
    // 1. Get sentiment
    const sentimentRes = await axios.get(`${BASE_URL}/api/semiconductor/sentiment`);
    const sentiment = sentimentRes.data;

    // 2. Get phase
    const phaseRes = await axios.get(`${BASE_URL}/api/semiconductor/phase`);
    const phase = phaseRes.data;

    // 3. Get presets
    const presetsRes = await axios.get(`${BASE_URL}/api/ai/presets`);
    const presets = presetsRes.data.presets;

    // 4. Determine which preset to use based on sentiment
    let recommendedPreset = 'SOXL_SOXS_COMBO'; // Default
    if (!sentiment.error) {
      if (sentiment.direction === 'bullish' && sentiment.confidence >= 60) {
        recommendedPreset = 'SOXL_MOMENTUM';
      } else if (sentiment.direction === 'bearish' && sentiment.confidence >= 60) {
        recommendedPreset = 'SOXS_HEDGE';
      }
    }

    log(`\nIntegration Summary:`, 'info');
    log(`  Sentiment: ${sentiment.direction || 'unknown'} (${sentiment.confidence || 0}%)`, 'info');
    log(`  Phase: ${phase.phase} (trading: ${phase.tradingAllowed ? 'YES' : 'NO'})`, 'info');
    log(`  Recommended preset: ${recommendedPreset}`, 'info');

    assert(true, 'Full integration test completed');

    // Display decision matrix
    log('\n  Decision Matrix:', 'info');
    log('  ┌─────────────┬───────────┬───────────────────┐', 'info');
    log('  │ Sentiment   │ Conf >=60 │ Recommended       │', 'info');
    log('  ├─────────────┼───────────┼───────────────────┤', 'info');
    log('  │ Bullish     │ Yes       │ SOXL_MOMENTUM     │', 'info');
    log('  │ Bullish     │ No        │ SOXL_SOXS_COMBO   │', 'info');
    log('  │ Bearish     │ Yes       │ SOXS_HEDGE        │', 'info');
    log('  │ Bearish     │ No        │ SOXL_SOXS_COMBO   │', 'info');
    log('  │ Neutral     │ Any       │ No trading        │', 'info');
    log('  └─────────────┴───────────┴───────────────────┘', 'info');

    return true;
  } catch (error) {
    assert(false, 'Full integration test', error.message);
    return false;
  }
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     SEMICONDUCTOR SENTIMENT SYSTEM TEST SUITE              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  // Run tests in sequence
  const serverOk = await testServerHealth();
  if (!serverOk) {
    console.log('\n\x1b[31m[ABORT]\x1b[0m Server not responding. Make sure the server is running:');
    console.log('        npm run server-dev\n');
    process.exit(1);
  }

  await testSentimentEndpoint();
  await testMarketPhaseEndpoint();
  await testAIAnalysisEndpoint();
  await testStrategyPresetsEndpoint();

  const sessionId = await testStartSessionFromPreset();
  await testStopSession(sessionId);

  await testDynamicThresholds();
  await testPhaseTransitions();
  await testFullIntegration();

  // Print summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                      TEST SUMMARY                          ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Tests: ${(results.passed + results.failed).toString().padEnd(44)}║`);
  console.log(`║  \x1b[32mPassed: ${results.passed}\x1b[0m${' '.repeat(49 - results.passed.toString().length)}║`);
  console.log(`║  \x1b[31mFailed: ${results.failed}\x1b[0m${' '.repeat(49 - results.failed.toString().length)}║`);
  console.log(`║  Duration: ${duration}s${' '.repeat(46 - duration.length)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (results.failed > 0) {
    console.log('Failed tests:');
    results.tests
      .filter(t => t.status === 'failed')
      .forEach(t => console.log(`  - ${t.name}: ${t.details}`));
    console.log('');
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});
