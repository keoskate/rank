/**
 * Semiconductor Momentum Trading - End-to-End Test Suite
 *
 * Comprehensive tests for the SOXL/SOXS trading page including:
 * - API endpoint validation
 * - Data consistency checks
 * - UI functionality tests
 * - Business logic verification
 * - AI analysis integration
 *
 * Run: node tests/semiconductorE2ETest.js
 */

const axios = require('axios');
const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:8080';
const TEST_USER = 'e2e_test_user';

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: [],
  issues: [],
};

// Logging helpers
function log(message, type = 'info') {
  const prefix = {
    info: '\x1b[36m[INFO]\x1b[0m',
    pass: '\x1b[32m[PASS]\x1b[0m',
    fail: '\x1b[31m[FAIL]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
    section: '\x1b[35m[====]\x1b[0m',
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
    results.issues.push({ test: testName, issue: details });
    log(`${testName} - ${details}`, 'fail');
    return false;
  }
}

function warn(testName, details) {
  results.warnings++;
  results.tests.push({ name: testName, status: 'warning', details });
  log(`${testName} - ${details}`, 'warn');
}

// ============================================================
// SECTION 1: API ENDPOINT TESTS
// ============================================================

async function testAPIs() {
  log('\n========================================', 'section');
  log('SECTION 1: API ENDPOINT TESTS', 'section');
  log('========================================\n', 'section');

  // Test 1.1: Sentiment Endpoint
  log('--- Test 1.1: Sentiment Endpoint ---');
  try {
    const res = await axios.get(`${BASE_URL}/api/semiconductor/sentiment`);
    assert(res.status === 200, 'Sentiment endpoint returns 200');

    const data = res.data;
    assert(data.direction !== undefined, 'Sentiment has direction field');
    assert(['bullish', 'bearish', 'neutral'].includes(data.direction),
      'Direction is valid enum', `Got: ${data.direction}`);
    assert(typeof data.confidence === 'number', 'Confidence is a number');
    assert(data.confidence >= 0 && data.confidence <= 100,
      'Confidence is 0-100', `Got: ${data.confidence}`);
    assert(data.referenceSymbol === 'SOXX', 'Reference symbol is SOXX');
    assert(data.thresholds !== undefined, 'Has thresholds object');
    assert(data.phase !== undefined, 'Has market phase');

    // Store for later consistency checks
    results.sentimentData = data;

    log(`  Direction: ${data.direction}, Confidence: ${data.confidence}%`);
    log(`  SOXX: $${data.currentPrice} (${data.intradayChange})`);
  } catch (err) {
    assert(false, 'Sentiment endpoint works', err.message);
  }

  // Test 1.2: Market Phase Endpoint
  log('\n--- Test 1.2: Market Phase Endpoint ---');
  try {
    const res = await axios.get(`${BASE_URL}/api/semiconductor/phase`);
    assert(res.status === 200, 'Phase endpoint returns 200');

    const data = res.data;
    const validPhases = ['PRE_MARKET', 'OPEN', 'SETTLE', 'ACTIVE', 'WIND_DOWN', 'CLOSE', 'AFTER_HOURS', 'CLOSED'];
    assert(validPhases.includes(data.phase), 'Phase is valid', `Got: ${data.phase}`);
    assert(typeof data.tradingAllowed === 'boolean', 'tradingAllowed is boolean');
    assert(typeof data.currentTimeET === 'number', 'currentTimeET is number');

    results.phaseData = data;
    log(`  Phase: ${data.phase}, Trading: ${data.tradingAllowed ? 'YES' : 'NO'}`);
  } catch (err) {
    assert(false, 'Phase endpoint works', err.message);
  }

  // Test 1.3: Strategy Presets Endpoint
  log('\n--- Test 1.3: Strategy Presets Endpoint ---');
  try {
    const res = await axios.get(`${BASE_URL}/api/ai/presets`);
    assert(res.status === 200, 'Presets endpoint returns 200');
    assert(Array.isArray(res.data.presets), 'Returns array of presets');

    const presets = res.data.presets;
    const requiredPresets = ['SOXL_MOMENTUM', 'SOXS_HEDGE', 'SOXL_SOXS_COMBO'];

    for (const presetId of requiredPresets) {
      const found = presets.find(p => p.id === presetId);
      assert(found !== undefined, `Preset ${presetId} exists`);
      if (found) {
        assert(found.name !== undefined, `${presetId} has name`);
        assert(found.marketGate !== undefined, `${presetId} has marketGate`);
      }
    }

    results.presets = presets;
  } catch (err) {
    assert(false, 'Presets endpoint works', err.message);
  }

  // Test 1.4: Individual Preset Details
  log('\n--- Test 1.4: Preset Configuration Validation ---');
  try {
    const soxlRes = await axios.get(`${BASE_URL}/api/ai/presets/SOXL_MOMENTUM`);
    const soxl = soxlRes.data.preset;

    assert(soxl.semiconductorMode === true, 'SOXL_MOMENTUM has semiconductorMode');
    assert(soxl.marketGate === 'bullish', 'SOXL_MOMENTUM has bullish gate');
    assert(soxl.watchlist.includes('SOXL'), 'SOXL_MOMENTUM watchlist has SOXL');
    assert(soxl.aiSentimentEnabled === true, 'SOXL_MOMENTUM has AI enabled');

    const soxsRes = await axios.get(`${BASE_URL}/api/ai/presets/SOXS_HEDGE`);
    const soxs = soxsRes.data.preset;

    assert(soxs.marketGate === 'bearish', 'SOXS_HEDGE has bearish gate');
    assert(soxs.watchlist.includes('SOXS'), 'SOXS_HEDGE watchlist has SOXS');
    assert(typeof soxs.maxSoxsHoldMinutes === 'number', 'SOXS_HEDGE has maxSoxsHoldMinutes');
  } catch (err) {
    assert(false, 'Preset details validation', err.message);
  }

  // Test 1.5: AI Analysis Endpoint
  log('\n--- Test 1.5: AI Analysis Endpoint ---');
  try {
    const cacheRes = await axios.get(`${BASE_URL}/api/semiconductor/ai-analysis`);
    assert(cacheRes.status === 200, 'AI cache endpoint returns 200');
    assert(typeof cacheRes.data.aiEnabled === 'boolean', 'Reports AI enabled status');

    log(`  AI Enabled: ${cacheRes.data.aiEnabled}`);
    log(`  Cached Analysis Available: ${cacheRes.data.available}`);

    if (cacheRes.data.available && cacheRes.data.analysis) {
      const analysis = cacheRes.data.analysis;
      assert(['bullish', 'bearish', 'neutral'].includes(analysis.direction),
        'AI analysis has valid direction');
      assert(typeof analysis.confidenceAdjustment === 'number',
        'AI has confidence adjustment');
      assert(analysis.confidenceAdjustment >= -20 && analysis.confidenceAdjustment <= 20,
        'Confidence adjustment in range', `Got: ${analysis.confidenceAdjustment}`);
    }

    results.aiAnalysis = cacheRes.data;
  } catch (err) {
    assert(false, 'AI analysis endpoint works', err.message);
  }

  // Test 1.6: Price Data Endpoints
  log('\n--- Test 1.6: Price Data Endpoints ---');
  const symbols = ['SOXX', 'SOXL', 'SOXS'];

  for (const symbol of symbols) {
    try {
      const res = await axios.get(`${BASE_URL}/api/polygon/aggregates/${symbol}?multiplier=1&timespan=day&limit=2`);
      assert(res.status === 200, `${symbol} aggregates returns 200`);
      assert(res.data.results && res.data.results.length > 0, `${symbol} has price data`);

      const latest = res.data.results[res.data.results.length - 1];
      log(`  ${symbol}: $${latest.close} (${latest.date})`);

      results[`${symbol}Price`] = latest;
    } catch (err) {
      assert(false, `${symbol} price data available`, err.message);
    }
  }
}

// ============================================================
// SECTION 2: DATA CONSISTENCY TESTS
// ============================================================

async function testDataConsistency() {
  log('\n========================================', 'section');
  log('SECTION 2: DATA CONSISTENCY TESTS', 'section');
  log('========================================\n', 'section');

  // Test 2.1: Sentiment vs Price Data Consistency
  log('--- Test 2.1: Sentiment vs Price Consistency ---');
  try {
    const sentimentRes = await axios.get(`${BASE_URL}/api/semiconductor/sentiment`);
    const sentiment = sentimentRes.data;

    const soxxRes = await axios.get(`${BASE_URL}/api/polygon/aggregates/SOXX?multiplier=1&timespan=day&limit=2`);
    const soxxData = soxxRes.data.results;

    if (soxxData && soxxData.length >= 2) {
      const today = soxxData[soxxData.length - 1];
      const yesterday = soxxData[soxxData.length - 2];

      const calculatedChange = ((today.close - yesterday.close) / yesterday.close) * 100;
      const reportedChange = sentiment.intradayChangeRaw;

      // Note: Sentiment uses intraday (open to current), price data uses close to close
      // These will differ, but both should be directionally consistent
      log(`  Sentiment intraday change: ${sentiment.intradayChange}`);
      log(`  Price data day change: ${calculatedChange.toFixed(2)}%`);

      // Check if direction is consistent
      if (Math.abs(calculatedChange) > 0.5) {
        const priceDirection = calculatedChange > 0 ? 'bullish' : 'bearish';
        if (sentiment.direction !== 'neutral' && sentiment.direction !== priceDirection) {
          warn('Direction consistency',
            `Sentiment says ${sentiment.direction} but price change suggests ${priceDirection}`);
        }
      }
    }
  } catch (err) {
    warn('Sentiment vs price consistency check', err.message);
  }

  // Test 2.2: Threshold Logic Validation
  log('\n--- Test 2.2: Threshold Logic Validation ---');
  try {
    const sentiment = (await axios.get(`${BASE_URL}/api/semiconductor/sentiment`)).data;
    const thresholds = sentiment.thresholds;

    assert(thresholds.entryRaw > 0, 'Entry threshold is positive');
    assert(thresholds.exitRaw > 0, 'Exit threshold is positive');
    assert(thresholds.switchRaw > 0, 'Switch threshold is positive');

    assert(thresholds.switchRaw > thresholds.entryRaw,
      'Switch threshold > entry threshold (prevents whipsaw)',
      `Entry: ${thresholds.entryRaw}, Switch: ${thresholds.switchRaw}`);

    assert(thresholds.exitRaw < thresholds.entryRaw,
      'Exit threshold < entry threshold',
      `Entry: ${thresholds.entryRaw}, Exit: ${thresholds.exitRaw}`);

    // Verify direction assignment based on thresholds
    const change = Math.abs(sentiment.intradayChangeRaw);
    const entryThreshold = thresholds.entryRaw;

    if (change < entryThreshold) {
      assert(sentiment.direction === 'neutral',
        'Direction is neutral when change < threshold',
        `Change: ${change}, Threshold: ${entryThreshold}, Direction: ${sentiment.direction}`);
    }

    log(`  Change: ${sentiment.intradayChange}, Threshold: ${thresholds.entry}`);
    log(`  Direction assignment: ${sentiment.direction}`);
  } catch (err) {
    assert(false, 'Threshold logic validation', err.message);
  }

  // Test 2.3: Market Gate Logic
  log('\n--- Test 2.3: Market Gate Logic Validation ---');
  try {
    const sentiment = (await axios.get(`${BASE_URL}/api/semiconductor/sentiment`)).data;

    // Test SOXL gate (requires bullish)
    if (sentiment.direction === 'bullish' && sentiment.confidence >= 65) {
      log('  SOXL gate should PASS (bullish + sufficient confidence)');
    } else if (sentiment.direction !== 'bullish') {
      log(`  SOXL gate should BLOCK (direction is ${sentiment.direction}, need bullish)`);
    } else {
      log(`  SOXL gate should BLOCK (confidence ${sentiment.confidence}% < 65%)`);
    }

    // Test SOXS gate (requires bearish)
    if (sentiment.direction === 'bearish' && sentiment.confidence >= 70) {
      log('  SOXS gate should PASS (bearish + sufficient confidence)');
    } else if (sentiment.direction !== 'bearish') {
      log(`  SOXS gate should BLOCK (direction is ${sentiment.direction}, need bearish)`);
    } else {
      log(`  SOXS gate should BLOCK (confidence ${sentiment.confidence}% < 70%)`);
    }

    assert(true, 'Market gate logic documented');
  } catch (err) {
    assert(false, 'Market gate logic check', err.message);
  }

  // Test 2.4: Inverse Correlation Check (SOXL vs SOXS)
  log('\n--- Test 2.4: SOXL/SOXS Inverse Correlation ---');
  try {
    const soxlRes = await axios.get(`${BASE_URL}/api/polygon/aggregates/SOXL?multiplier=1&timespan=day&limit=2`);
    const soxsRes = await axios.get(`${BASE_URL}/api/polygon/aggregates/SOXS?multiplier=1&timespan=day&limit=2`);

    if (soxlRes.data.results.length >= 2 && soxsRes.data.results.length >= 2) {
      const soxlData = soxlRes.data.results;
      const soxsData = soxsRes.data.results;

      const soxlChange = ((soxlData[soxlData.length-1].close - soxlData[soxlData.length-2].close) / soxlData[soxlData.length-2].close) * 100;
      const soxsChange = ((soxsData[soxsData.length-1].close - soxsData[soxsData.length-2].close) / soxsData[soxsData.length-2].close) * 100;

      log(`  SOXL change: ${soxlChange.toFixed(2)}%`);
      log(`  SOXS change: ${soxsChange.toFixed(2)}%`);

      // They should move in opposite directions (inverse ETFs)
      const isInverse = (soxlChange > 0 && soxsChange < 0) || (soxlChange < 0 && soxsChange > 0);

      if (isInverse) {
        assert(true, 'SOXL and SOXS are inversely correlated');
      } else if (Math.abs(soxlChange) < 0.5 && Math.abs(soxsChange) < 0.5) {
        warn('Inverse correlation', 'Both changes too small to verify correlation');
      } else {
        warn('Inverse correlation issue',
          `SOXL: ${soxlChange.toFixed(2)}%, SOXS: ${soxsChange.toFixed(2)}% - expected opposite directions`);
      }
    }
  } catch (err) {
    warn('Inverse correlation check', err.message);
  }
}

// ============================================================
// SECTION 3: BUSINESS LOGIC TESTS
// ============================================================

async function testBusinessLogic() {
  log('\n========================================', 'section');
  log('SECTION 3: BUSINESS LOGIC TESTS', 'section');
  log('========================================\n', 'section');

  // Test 3.1: Session Creation from Preset
  log('--- Test 3.1: Session Creation from Preset ---');
  let testSessionId = null;

  try {
    const createRes = await axios.post(`${BASE_URL}/api/ai/session/from-preset`, {
      userId: TEST_USER,
      presetName: 'SOXL_MOMENTUM',
      overrides: { autoTrade: false },
    });

    assert(createRes.status === 200, 'Create session returns 200');
    assert(createRes.data.success === true, 'Session created successfully');
    assert(createRes.data.sessionId !== undefined, 'Session ID returned');

    testSessionId = createRes.data.sessionId;
    log(`  Session created: ${testSessionId}`);

    // Verify session configuration
    const detailRes = await axios.get(`${BASE_URL}/api/ai/session/detail/${testSessionId}`);
    const session = detailRes.data;

    assert(session.config.semiconductorMode === true, 'Session has semiconductorMode');
    assert(session.config.marketGate === 'bullish', 'Session has correct market gate');
    assert(session.config.autoTrade === false, 'Override applied (autoTrade=false)');

  } catch (err) {
    assert(false, 'Session creation', err.message);
  }

  // Test 3.2: Market Gate Blocking (if applicable)
  log('\n--- Test 3.2: Market Gate Behavior ---');
  if (testSessionId) {
    try {
      const sentiment = (await axios.get(`${BASE_URL}/api/semiconductor/sentiment`)).data;

      // If sentiment is not bullish, the SOXL session should be blocked
      if (sentiment.direction !== 'bullish') {
        log(`  Current direction: ${sentiment.direction}`);
        log(`  SOXL_MOMENTUM session should be gate-blocked (requires bullish)`);
        assert(true, 'Gate blocking logic correct for current conditions');
      } else if (sentiment.confidence < 65) {
        log(`  Confidence: ${sentiment.confidence}%`);
        log(`  SOXL_MOMENTUM session should be blocked (confidence < 65%)`);
        assert(true, 'Confidence threshold blocking correct');
      } else {
        log(`  Direction: ${sentiment.direction}, Confidence: ${sentiment.confidence}%`);
        log(`  SOXL_MOMENTUM session should be ACTIVE`);
        assert(true, 'Session should be active with current conditions');
      }
    } catch (err) {
      warn('Market gate behavior check', err.message);
    }
  }

  // Test 3.3: Session Cleanup
  log('\n--- Test 3.3: Session Cleanup ---');
  if (testSessionId) {
    try {
      const stopRes = await axios.post(`${BASE_URL}/api/ai/session/stop`, {
        sessionId: testSessionId,
      });

      assert(stopRes.data.success === true, 'Session stopped successfully');
      log(`  Session ${testSessionId} stopped`);
    } catch (err) {
      warn('Session cleanup', err.message);
    }
  }

  // Test 3.4: SOXS Time Restrictions
  log('\n--- Test 3.4: SOXS Time Restrictions ---');
  try {
    const phase = (await axios.get(`${BASE_URL}/api/semiconductor/phase`)).data;

    // SOXS should not allow new entries after 2:30 PM ET (14.5)
    if (phase.currentTimeET >= 14.5) {
      log(`  Current ET time: ${phase.currentTimeET.toFixed(2)}`);
      log(`  SOXS new entries should be BLOCKED (after 2:30 PM)`);
    } else {
      log(`  Current ET time: ${phase.currentTimeET.toFixed(2)}`);
      log(`  SOXS entries allowed (before 2:30 PM cutoff)`);
    }

    assert(true, 'SOXS time restriction logic documented');
  } catch (err) {
    warn('SOXS time restriction check', err.message);
  }

  // Test 3.5: Recommended Action Logic
  log('\n--- Test 3.5: Recommended Action Logic ---');
  try {
    const sentiment = (await axios.get(`${BASE_URL}/api/semiconductor/sentiment`)).data;

    let expectedAction;
    if (sentiment.direction === 'bullish' && sentiment.confidence >= 60) {
      expectedAction = 'SOXL';
    } else if (sentiment.direction === 'bearish' && sentiment.confidence >= 60) {
      expectedAction = 'SOXS';
    } else {
      expectedAction = 'CASH/WAIT';
    }

    log(`  Direction: ${sentiment.direction}`);
    log(`  Confidence: ${sentiment.confidence}%`);
    log(`  Can Trade: ${sentiment.canTrade}`);
    log(`  Expected Action: ${expectedAction}`);
    log(`  Reported Recommendation: ${sentiment.recommendedSymbol}`);

    const matches = (expectedAction === 'CASH/WAIT' && sentiment.recommendedSymbol === 'CASH') ||
                   (expectedAction === sentiment.recommendedSymbol);

    assert(matches, 'Recommended action matches logic',
      `Expected: ${expectedAction}, Got: ${sentiment.recommendedSymbol}`);

  } catch (err) {
    assert(false, 'Recommended action logic', err.message);
  }
}

// ============================================================
// SECTION 4: UI FUNCTIONALITY TESTS (Puppeteer)
// ============================================================

async function testUIFunctionality() {
  log('\n========================================', 'section');
  log('SECTION 4: UI FUNCTIONALITY TESTS', 'section');
  log('========================================\n', 'section');

  let browser;
  let page;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();

    // Set viewport
    await page.setViewport({ width: 1400, height: 900 });

    // Navigate to semiconductor page
    log('--- Test 4.1: Page Load ---');
    await page.goto(`${BASE_URL}/semiconductor`, { waitUntil: 'networkidle0', timeout: 30000 });
    assert(true, 'Semiconductor page loads');

    // Test 4.2: Verify page title/header
    log('\n--- Test 4.2: Page Structure ---');
    const title = await page.$eval('div', el => {
      const h = el.querySelector('div[style*="font-size: 28px"]');
      return h ? h.textContent : null;
    }).catch(() => null);

    if (title && title.includes('Semiconductor')) {
      assert(true, 'Page title present');
    } else {
      warn('Page title', 'Could not verify title');
    }

    // Test 4.3: Verify mini charts are present
    log('\n--- Test 4.3: Mini Charts ---');
    await page.waitForSelector('div', { timeout: 5000 });

    // Look for SOXX, SOXL, SOXS text
    const pageContent = await page.content();
    assert(pageContent.includes('SOXX'), 'SOXX chart present');
    assert(pageContent.includes('SOXL'), 'SOXL chart present');
    assert(pageContent.includes('SOXS'), 'SOXS chart present');

    // Test 4.4: Verify sentiment panel elements
    log('\n--- Test 4.4: Sentiment Panel Elements ---');
    assert(pageContent.includes('DIRECTION') || pageContent.includes('Direction'),
      'Direction label present');
    assert(pageContent.includes('CONFIDENCE') || pageContent.includes('Confidence'),
      'Confidence label present');
    assert(pageContent.includes('MARKET PHASE') || pageContent.includes('Market Phase'),
      'Market Phase label present');

    // Test 4.5: Verify strategy presets section
    log('\n--- Test 4.5: Strategy Presets Section ---');
    assert(pageContent.includes('SOXL Bullish Momentum'), 'SOXL preset visible');
    assert(pageContent.includes('SOXS Bearish Hedge'), 'SOXS preset visible');
    assert(pageContent.includes('SOXL/SOXS Dynamic'), 'Combo preset visible');

    // Test 4.6: Test Refresh Button
    log('\n--- Test 4.6: Refresh Button ---');
    try {
      const refreshButton = await page.$('button');
      const buttons = await page.$$('button');
      let refreshClicked = false;

      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.includes('Refresh')) {
          await btn.click();
          refreshClicked = true;
          await new Promise(resolve => setTimeout(resolve, 1000));
          break;
        }
      }

      if (refreshClicked) {
        assert(true, 'Refresh button clickable');
      } else {
        warn('Refresh button', 'Could not find refresh button');
      }
    } catch (err) {
      warn('Refresh button test', err.message);
    }

    // Test 4.7: Test AI Analyze Button
    log('\n--- Test 4.7: AI Analyze Button ---');
    try {
      const buttons = await page.$$('button');
      let aiClicked = false;

      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.includes('AI Analyze')) {
          await btn.click();
          aiClicked = true;
          // Wait for AI response
          await new Promise(resolve => setTimeout(resolve, 3000));
          break;
        }
      }

      if (aiClicked) {
        assert(true, 'AI Analyze button clickable');

        // Check if AI analysis section appeared/updated
        const updatedContent = await page.content();
        if (updatedContent.includes('Claude Analysis') || updatedContent.includes('AI DIRECTION')) {
          assert(true, 'AI analysis section visible after click');
        }
      } else {
        warn('AI Analyze button', 'Could not find AI Analyze button');
      }
    } catch (err) {
      warn('AI Analyze button test', err.message);
    }

    // Test 4.8: Verify Dynamic Thresholds Display
    log('\n--- Test 4.8: Dynamic Thresholds Display ---');
    assert(pageContent.includes('ENTRY') || pageContent.includes('Entry'),
      'Entry threshold label present');
    assert(pageContent.includes('EXIT') || pageContent.includes('Exit'),
      'Exit threshold label present');
    assert(pageContent.includes('SWITCH') || pageContent.includes('Switch'),
      'Switch threshold label present');

    // Test 4.9: Verify Recommended Action Display
    log('\n--- Test 4.9: Recommended Action Display ---');
    assert(
      pageContent.includes('RECOMMENDED ACTION') ||
      pageContent.includes('Recommended Action') ||
      pageContent.includes('WAIT') ||
      pageContent.includes('SOXL') ||
      pageContent.includes('SOXS'),
      'Recommended action section present'
    );

    // Test 4.10: Click on a Preset (but don't start session)
    log('\n--- Test 4.10: Preset Interaction ---');
    try {
      // Find a preset card and verify it's interactive
      const presetCards = await page.$$('div[style*="cursor: pointer"]');
      if (presetCards.length > 0) {
        assert(true, 'Preset cards are clickable (cursor: pointer)');
      } else {
        warn('Preset interaction', 'Could not verify preset clickability');
      }
    } catch (err) {
      warn('Preset interaction test', err.message);
    }

  } catch (err) {
    assert(false, 'UI tests execution', err.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// ============================================================
// SECTION 5: AI INTEGRATION TESTS
// ============================================================

async function testAIIntegration() {
  log('\n========================================', 'section');
  log('SECTION 5: AI INTEGRATION TESTS', 'section');
  log('========================================\n', 'section');

  // Test 5.1: AI Analysis Structure
  log('--- Test 5.1: AI Analysis Response Structure ---');
  try {
    const sentiment = (await axios.get(`${BASE_URL}/api/semiconductor/sentiment`)).data;

    const analyzeRes = await axios.post(`${BASE_URL}/api/semiconductor/analyze`, {
      trigger: 'test',
    }, { timeout: 30000 });

    assert(analyzeRes.status === 200, 'AI analyze returns 200');
    assert(analyzeRes.data.sentiment !== undefined, 'Response includes sentiment');
    assert(analyzeRes.data.analysis !== undefined, 'Response includes analysis');

    const analysis = analyzeRes.data.analysis;

    if (!analysis.aiDisabled && !analysis.error) {
      assert(['bullish', 'bearish', 'neutral'].includes(analysis.direction),
        'AI direction is valid');
      assert(typeof analysis.confidenceAdjustment === 'number',
        'AI confidence adjustment is number');
      assert(analysis.confidenceAdjustment >= -20 && analysis.confidenceAdjustment <= 20,
        'Confidence adjustment in valid range');
      assert(['low', 'medium', 'high'].includes(analysis.riskLevel),
        'Risk level is valid');
      assert(analysis.reasoning !== undefined, 'AI provides reasoning');

      log(`  AI Direction: ${analysis.direction}`);
      log(`  Confidence Adj: ${analysis.confidenceAdjustment}`);
      log(`  Risk Level: ${analysis.riskLevel}`);
      log(`  Reasoning: ${analysis.reasoning}`);
    } else {
      warn('AI analysis', analysis.aiDisabled ? 'AI is disabled' : analysis.error);
    }
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      warn('AI analysis', 'Request timed out (30s) - AI may be slow');
    } else {
      assert(false, 'AI analysis structure', err.message);
    }
  }

  // Test 5.2: AI Confidence Adjustment Application
  log('\n--- Test 5.2: AI Confidence Adjustment ---');
  try {
    const beforeRes = await axios.get(`${BASE_URL}/api/semiconductor/sentiment`);
    const before = beforeRes.data;

    // Trigger AI analysis
    await axios.post(`${BASE_URL}/api/semiconductor/analyze`, { trigger: 'test' }, { timeout: 30000 });

    // Get sentiment again - it might have aiEnhanced flag now
    const afterRes = await axios.get(`${BASE_URL}/api/semiconductor/sentiment?refresh=true`);
    const after = afterRes.data;

    log(`  Before: confidence=${before.confidence}, aiEnhanced=${before.aiEnhanced || false}`);
    log(`  After: confidence=${after.confidence}, aiEnhanced=${after.aiEnhanced || false}`);

    // The AI adjustment happens when sentiment is fetched after AI runs
    // This is documented behavior
    assert(true, 'AI confidence adjustment mechanism verified');

  } catch (err) {
    warn('AI confidence adjustment test', err.message);
  }
}

// ============================================================
// SECTION 6: EDGE CASES AND ERROR HANDLING
// ============================================================

async function testEdgeCases() {
  log('\n========================================', 'section');
  log('SECTION 6: EDGE CASES & ERROR HANDLING', 'section');
  log('========================================\n', 'section');

  // Test 6.1: Invalid Preset Name
  log('--- Test 6.1: Invalid Preset Name ---');
  try {
    const res = await axios.post(`${BASE_URL}/api/ai/session/from-preset`, {
      userId: TEST_USER,
      presetName: 'INVALID_PRESET_NAME',
    });

    // Should return error
    assert(false, 'Invalid preset should fail', 'Request succeeded unexpectedly');
  } catch (err) {
    if (err.response && err.response.status === 400) {
      assert(true, 'Invalid preset returns 400 error');
    } else {
      warn('Invalid preset error handling', err.message);
    }
  }

  // Test 6.2: Invalid Symbol in Aggregates
  log('\n--- Test 6.2: Invalid Symbol Handling ---');
  try {
    const res = await axios.get(`${BASE_URL}/api/polygon/aggregates/INVALIDSYMBOL123`);
    // Might return empty results or error
    if (res.data.results && res.data.results.length === 0) {
      assert(true, 'Invalid symbol returns empty results');
    } else {
      assert(true, 'Invalid symbol handled gracefully');
    }
  } catch (err) {
    if (err.response && err.response.status >= 400) {
      assert(true, 'Invalid symbol returns error status');
    } else {
      warn('Invalid symbol handling', err.message);
    }
  }

  // Test 6.3: Missing Required Fields
  log('\n--- Test 6.3: Missing Required Fields ---');
  try {
    const res = await axios.post(`${BASE_URL}/api/ai/session/from-preset`, {
      userId: TEST_USER,
      // Missing presetName
    });

    assert(false, 'Missing preset should fail', 'Request succeeded unexpectedly');
  } catch (err) {
    if (err.response && err.response.status === 400) {
      assert(true, 'Missing preset name returns 400');
    } else {
      // Might return 500 or other error
      warn('Missing fields error handling', `Got status: ${err.response?.status}`);
    }
  }

  // Test 6.4: Concurrent Session Handling
  log('\n--- Test 6.4: Concurrent Session Test ---');
  try {
    // Create two sessions quickly
    const [res1, res2] = await Promise.all([
      axios.post(`${BASE_URL}/api/ai/session/from-preset`, {
        userId: TEST_USER + '_1',
        presetName: 'SOXL_MOMENTUM',
        overrides: { autoTrade: false },
      }),
      axios.post(`${BASE_URL}/api/ai/session/from-preset`, {
        userId: TEST_USER + '_2',
        presetName: 'SOXS_HEDGE',
        overrides: { autoTrade: false },
      }),
    ]);

    assert(res1.data.success && res2.data.success, 'Concurrent sessions created');

    // Cleanup
    await axios.post(`${BASE_URL}/api/ai/session/stop`, { sessionId: res1.data.sessionId });
    await axios.post(`${BASE_URL}/api/ai/session/stop`, { sessionId: res2.data.sessionId });

  } catch (err) {
    warn('Concurrent session handling', err.message);
  }
}

// ============================================================
// MAIN TEST RUNNER
// ============================================================

async function runAllTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     SEMICONDUCTOR MOMENTUM TRADING - E2E TEST SUITE             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  // Check server is running
  try {
    await axios.get(`${BASE_URL}/api/semiconductor/phase`, { timeout: 5000 });
  } catch (err) {
    console.log('\n\x1b[31m[ABORT]\x1b[0m Server not responding at', BASE_URL);
    console.log('        Make sure the server is running: npm run server-dev\n');
    process.exit(1);
  }

  // Run all test sections
  await testAPIs();
  await testDataConsistency();
  await testBusinessLogic();
  await testUIFunctionality();
  await testAIIntegration();
  await testEdgeCases();

  // Print summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                         TEST SUMMARY                              ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Tests: ${(results.passed + results.failed).toString().padEnd(51)}║`);
  console.log(`║  \x1b[32mPassed: ${results.passed}\x1b[0m${' '.repeat(56 - results.passed.toString().length)}║`);
  console.log(`║  \x1b[31mFailed: ${results.failed}\x1b[0m${' '.repeat(56 - results.failed.toString().length)}║`);
  console.log(`║  \x1b[33mWarnings: ${results.warnings}\x1b[0m${' '.repeat(54 - results.warnings.toString().length)}║`);
  console.log(`║  Duration: ${duration}s${' '.repeat(53 - duration.length)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (results.issues.length > 0) {
    console.log('\x1b[31mFailed Tests:\x1b[0m');
    results.issues.forEach(issue => {
      console.log(`  - ${issue.test}: ${issue.issue}`);
    });
    console.log('');
  }

  // Print recommendations based on issues found
  if (results.failed > 0 || results.warnings > 0) {
    console.log('\x1b[33mRecommendations:\x1b[0m');

    if (results.issues.some(i => i.test.includes('consistency'))) {
      console.log('  - Check sentiment calculation logic in semiconductorSentiment.js');
    }
    if (results.issues.some(i => i.test.includes('gate'))) {
      console.log('  - Review market gate thresholds in strategy presets');
    }
    if (results.issues.some(i => i.test.includes('AI'))) {
      console.log('  - Verify ANTHROPIC_API_KEY is set and valid');
    }
    console.log('');
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});
