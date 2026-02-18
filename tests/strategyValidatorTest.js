/**
 * Strategy Validator E2E Test Suite
 *
 * Tests the multi-day backtesting system end-to-end:
 * - API endpoint validation for /api/backtest/*
 * - UI panel rendering and interactions
 * - Running a backtest and validating results
 * - Verdict display and metrics validation
 *
 * Run with: node tests/strategyValidatorTest.js
 *
 * Prerequisites:
 * - Server running on localhost:8080
 * - npm run server-dev (in one terminal)
 */

const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8080';
const SCREENSHOT_DIR = './tests/screenshots/strategy-validator';
const TEST_SYMBOL = 'QBTS';
const TIMEOUT = 120000; // 2 minutes for backtests

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Results tracking
const results = {
  tests: [],
  startTime: Date.now(),
  errors: [],
};

// Helper to make HTTP requests
function httpRequest(urlPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT,
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Log result
function logResult(name, passed, details = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (details) console.log(`   ${details}`);
  results.tests.push({ name, passed, details, timestamp: new Date().toISOString() });
}

// Take screenshot
async function takeScreenshot(page, name) {
  const filename = path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: filename, fullPage: false });
  console.log(`   📸 Screenshot: ${filename}`);
  return filename;
}

// Get date string N days ago
function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// ==========================================
// TEST SUITE 1: API Endpoint Validation
// ==========================================
async function testBacktestAPI() {
  console.log('\n========================================');
  console.log('TEST SUITE 1: Backtest API Validation');
  console.log('========================================\n');

  const startDate = getDateDaysAgo(30);
  const endDate = getDateDaysAgo(1);

  // Test 1.1: Get trading days range
  try {
    const response = await httpRequest(
      `/api/strategy-validator/range/${TEST_SYMBOL}?startDate=${startDate}&endDate=${endDate}`
    );
    const passed =
      response.status === 200 &&
      typeof response.data.tradingDays === 'number' &&
      response.data.tradingDays > 0;
    logResult(
      'GET /api/strategy-validator/range/:symbol',
      passed,
      `Trading days: ${response.data.tradingDays}, B&H: ${response.data.buyAndHold?.returnPercent}%`
    );
  } catch (error) {
    logResult('GET /api/strategy-validator/range/:symbol', false, error.message);
    results.errors.push(error);
  }

  // Test 1.2: Validate required fields
  try {
    const response = await httpRequest('/api/strategy-validator/run', 'POST', {
      symbol: TEST_SYMBOL,
      // Missing startDate and endDate
    });
    const passed = response.status === 400 && response.data.error;
    logResult(
      'POST /api/strategy-validator/run (validation)',
      passed,
      `Correctly rejects missing fields: ${response.data.error}`
    );
  } catch (error) {
    logResult('POST /api/strategy-validator/run (validation)', false, error.message);
    results.errors.push(error);
  }

  // Test 1.3: Validate date range limits
  try {
    const response = await httpRequest('/api/strategy-validator/run', 'POST', {
      symbol: TEST_SYMBOL,
      startDate: getDateDaysAgo(100),
      endDate: getDateDaysAgo(1),
    });
    const passed = response.status === 400 && response.data.error?.includes('90 days');
    logResult(
      'POST /api/strategy-validator/run (90-day limit)',
      passed,
      `Correctly rejects >90 days: ${response.data.error}`
    );
  } catch (error) {
    logResult('POST /api/strategy-validator/run (90-day limit)', false, error.message);
    results.errors.push(error);
  }

  // Test 1.4: Run actual backtest (this takes time)
  console.log('\n   Running full backtest (this may take 30-60 seconds)...');
  try {
    const startTime = Date.now();
    const response = await httpRequest('/api/strategy-validator/run', 'POST', {
      symbol: TEST_SYMBOL,
      startDate: getDateDaysAgo(10), // 10 days for faster test
      endDate: getDateDaysAgo(1),
      config: {
        entryStrategy: 'balanced',
        maxPositionSizePercent: 50,
        minSignalsRequired: 2,
        takeProfitPercent: 2,
        stopLossPercent: 1,
        minConfidence: 60,
      },
    });
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    const passed =
      response.status === 200 &&
      response.data.statistics &&
      response.data.verdict &&
      response.data.dailyResults?.length > 0;

    logResult(
      'POST /api/strategy-validator/run (full backtest)',
      passed,
      `Duration: ${duration}s, Days: ${response.data.daysAnalyzed}, ` +
        `Sharpe: ${response.data.statistics?.sharpeRatio}, ` +
        `Verdict: ${response.data.verdict?.verdict}`
    );

    // Additional validation of response structure
    if (passed) {
      const stats = response.data.statistics;
      const hasRequiredStats =
        stats.totalDays !== undefined &&
        stats.sharpeRatio !== undefined &&
        stats.maxDrawdown !== undefined &&
        stats.avgDailyReturn !== undefined;

      logResult(
        '  → Statistics structure',
        hasRequiredStats,
        `Sharpe: ${stats.sharpeRatio}, DD: ${stats.maxDrawdown}%, Win: ${stats.dayWinRate}%`
      );

      const verdict = response.data.verdict;
      const hasVerdict =
        verdict.verdict !== undefined &&
        verdict.confidence !== undefined &&
        Array.isArray(verdict.issues) &&
        Array.isArray(verdict.strengths);

      logResult(
        '  → Verdict structure',
        hasVerdict,
        `${verdict.verdict} (${verdict.confidence}), ` +
          `${verdict.strengths?.length} strengths, ${verdict.issues?.length} issues`
      );

      // Store for later comparison
      results.backtestResult = response.data;
    }
  } catch (error) {
    logResult('POST /api/strategy-validator/run (full backtest)', false, error.message);
    results.errors.push(error);
  }
}

// Helper: wait for a number of milliseconds (replaces deprecated page.waitForTimeout)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// TEST SUITE 2: UI Panel Rendering
// ==========================================
async function testUIRendering(page) {
  console.log('\n========================================');
  console.log('TEST SUITE 2: UI Panel Rendering');
  console.log('========================================\n');

  // Navigate to sessions list first (with retry)
  let navigationSuccess = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(`${BASE_URL}/live-trading`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      navigationSuccess = true;
      break;
    } catch (navError) {
      console.log(`   Navigation attempt ${attempt} failed: ${navError.message}`);
      if (attempt === 2) throw navError;
      await sleep(2000);
    }
  }
  try {
    await sleep(3000);
    await takeScreenshot(page, '01-sessions-list');

    // Click the first "View" button to open a session
    const viewClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('View')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (viewClicked) {
      await sleep(3000); // Wait for navigation and React to render
      await takeScreenshot(page, '02-dashboard-loaded');
      logResult('Navigate to Live Trading Dashboard', true, 'Clicked View on first session');
    } else {
      logResult('Navigate to Live Trading Dashboard', false, 'No View button found');
      return;
    }
  } catch (error) {
    logResult('Navigate to Live Trading Dashboard', false, error.message);
    results.errors.push(error);
    return;
  }

  // Wait for page to fully load
  await sleep(2000);

  // Test 2.1: Check if Strategy Validator panel exists
  try {
    // Use evaluate to search for text in the DOM
    const hasValidatorPanel = await page.evaluate(() => {
      return document.body.textContent.includes('Strategy Validator');
    });
    logResult('Strategy Validator panel visible', hasValidatorPanel);
    if (hasValidatorPanel) {
      await takeScreenshot(page, '02-validator-panel');
    }
  } catch (error) {
    logResult('Strategy Validator panel visible', false, error.message);
  }

  // Test 2.2: Check for date inputs
  try {
    const dateInputs = await page.$$('input[type="date"]');
    const passed = dateInputs.length >= 2;
    logResult('Date range inputs present', passed, `Found ${dateInputs.length} date inputs`);
  } catch (error) {
    logResult('Date range inputs present', false, error.message);
  }

  // Test 2.3: Check for Run Validation button
  try {
    const hasButton = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('Run Validation')) {
          return true;
        }
      }
      return false;
    });
    logResult('Run Validation button present', hasButton);
  } catch (error) {
    logResult('Run Validation button present', false, error.message);
  }

}

// ==========================================
// TEST SUITE 3: Full E2E Backtest Flow
// ==========================================
async function testE2EBacktestFlow(page) {
  console.log('\n========================================');
  console.log('TEST SUITE 3: E2E Backtest Flow');
  console.log('========================================\n');

  // Navigate to sessions list and click View (with retry)
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto(`${BASE_URL}/live-trading`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        break;
      } catch (navError) {
        console.log(`   Navigation attempt ${attempt} failed: ${navError.message}`);
        if (attempt === 2) throw navError;
        await sleep(2000);
      }
    }
    await sleep(3000);

    // Click first View button
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('View')) {
          btn.click();
          break;
        }
      }
    });
    await sleep(3000);
  } catch (error) {
    logResult('Navigate to dashboard', false, error.message);
    return;
  }

  // Scroll to Strategy Validator section
  try {
    await page.evaluate(() => {
      const elements = document.querySelectorAll('h3');
      for (const el of elements) {
        if (el.textContent.includes('Strategy Validator')) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    });
    await sleep(1000);
    await takeScreenshot(page, '03-scrolled-to-validator');
    logResult('Scroll to Strategy Validator', true);
  } catch (error) {
    logResult('Scroll to Strategy Validator', false, error.message);
  }

  // Set date range (last 7 days for faster test)
  const startDate = getDateDaysAgo(10);
  const endDate = getDateDaysAgo(1);

  try {
    // Set symbol and date values via JavaScript
    const inputsSet = await page.evaluate((testSymbol, start, end) => {
      // Find the Strategy Validator panel
      const validatorPanel = Array.from(document.querySelectorAll('div')).find(
        div => div.textContent.includes('Strategy Validator') && div.textContent.includes('Multi-day')
      );

      if (!validatorPanel) {
        return { success: false, error: 'Strategy Validator panel not found' };
      }

      // Find symbol input (text input) and set using React-compatible method
      const symbolInput = validatorPanel.querySelector('input[type="text"]');
      if (symbolInput) {
        // Use native setter to trigger React's onChange
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(symbolInput, testSymbol);
        symbolInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Find date inputs and set using React-compatible method
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

      const panelDateInputs = validatorPanel.querySelectorAll('input[type="date"]');
      if (panelDateInputs.length >= 2) {
        // Use native setter to properly trigger React's onChange
        nativeInputValueSetter.call(panelDateInputs[0], start);
        panelDateInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        panelDateInputs[0].dispatchEvent(new Event('change', { bubbles: true }));

        nativeInputValueSetter.call(panelDateInputs[1], end);
        panelDateInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        panelDateInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, hasSymbolInput: !!symbolInput };
      }

      // Fallback: use all date inputs on page
      const dateInputs = document.querySelectorAll('input[type="date"]');
      if (dateInputs.length >= 2) {
        nativeInputValueSetter.call(dateInputs[dateInputs.length - 2], start);
        dateInputs[dateInputs.length - 2].dispatchEvent(new Event('input', { bubbles: true }));
        dateInputs[dateInputs.length - 2].dispatchEvent(new Event('change', { bubbles: true }));

        nativeInputValueSetter.call(dateInputs[dateInputs.length - 1], end);
        dateInputs[dateInputs.length - 1].dispatchEvent(new Event('input', { bubbles: true }));
        dateInputs[dateInputs.length - 1].dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, fallback: true };
      }

      return { success: false, error: 'No date inputs found' };
    }, TEST_SYMBOL, startDate, endDate);

    await takeScreenshot(page, '04-dates-entered');
    logResult('Enter date range', inputsSet.success, `${TEST_SYMBOL}: ${startDate} to ${endDate}`);
  } catch (error) {
    logResult('Enter date range', false, error.message);
  }

  // Click Run Validation button
  try {
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('Run Validation')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    logResult('Click Run Validation', clicked);
    await takeScreenshot(page, '05-running-backtest');
  } catch (error) {
    logResult('Click Run Validation', false, error.message);
  }

  // Wait for results (with timeout)
  console.log('   Waiting for backtest results (up to 2 minutes)...');
  try {
    // Wait for backtest to complete - check that loading is gone AND verdict is visible
    await page.waitForFunction(
      () => {
        const pageText = document.body.textContent;

        // Make sure we're not still loading
        if (pageText.includes('Running backtest') || pageText.includes('Running...')) {
          return false;
        }

        // Check for verdict text
        const hasVerdict = (
          pageText.includes('Ready for Paper Trading') ||
          pageText.includes('Promising') ||
          pageText.includes('Needs Work') ||
          pageText.includes('Not Ready')
        );

        // Also check for error state
        const errorElements = document.querySelectorAll('div');
        let hasError = false;
        for (const el of errorElements) {
          if (el.style.backgroundColor === 'rgb(254, 226, 226)') {
            hasError = true;
            break;
          }
        }

        return hasVerdict || hasError;
      },
      { timeout: TIMEOUT }
    );

    await takeScreenshot(page, '06-backtest-complete');
    logResult('Backtest completed', true);
  } catch (error) {
    await takeScreenshot(page, '06-backtest-timeout');
    logResult('Backtest completed', false, `Timeout: ${error.message}`);
    results.errors.push(error);
    return;
  }

  // Wait for full results to render (verdict appearing doesn't mean stats are visible yet)
  await sleep(1000);

  // Validate results display
  try {
    // Wait for key stats to appear - check for partial matches since labels may have line breaks
    await page.waitForFunction(
      () => {
        const text = document.body.textContent;
        // Check for partial text matches (labels may be split across lines)
        const hasSharpe = text.includes('Sharpe') && text.includes('Ratio');
        const hasDrawdown = text.includes('Drawdown');
        const hasWinRate = text.includes('Win Rate') || text.includes('Win') && text.includes('Rate');
        return hasSharpe && hasDrawdown && hasWinRate;
      },
      { timeout: 5000 }
    );
    logResult('Key statistics displayed', true);
  } catch (error) {
    // If waiting failed, check current state for debugging
    const statsVisible = await page.evaluate(() => {
      const text = document.body.textContent;
      return {
        hasSharpe: text.includes('Sharpe'),
        hasDrawdown: text.includes('Drawdown'),
        hasWinRate: text.includes('Win'),
        hasRatio: text.includes('Ratio'),
      };
    });
    logResult('Key statistics displayed', false, JSON.stringify(statsVisible));
  }

  // Check for verdict - wait for it to appear
  try {
    await page.waitForFunction(
      () => {
        const text = document.body.textContent;
        return (
          text.includes('Ready for Paper Trading') ||
          text.includes('Promising') ||
          text.includes('Needs Work') ||
          text.includes('Not Ready')
        );
      },
      { timeout: 5000 }
    );
    const verdictInfo = await page.evaluate(() => {
      const text = document.body.textContent;
      if (text.includes('Ready for Paper Trading')) return 'READY_FOR_PAPER_TRADING';
      if (text.includes('Promising')) return 'PROMISING_NEEDS_REFINEMENT';
      if (text.includes('Needs Work')) return 'NEEDS_WORK';
      if (text.includes('Not Ready')) return 'NOT_READY';
      return 'UNKNOWN';
    });
    logResult('Verdict displayed', verdictInfo !== 'UNKNOWN', `Verdict: ${verdictInfo}`);

    // NEW TEST: Verify statistics are non-zero (not all 0.00%)
    const statsValues = await page.evaluate(() => {
      const text = document.body.textContent;
      // Text structure: "LabelValue" with no spaces, e.g., "Sharpe Ratio0.00" or "Day Win Rate50.0%"
      // Use flexible regex that matches label followed by number (with optional sign and decimals)
      const avgDailyMatch = text.match(/Avg Daily\s*Return([-\d.]+)%/i);
      const sharpeMatch = text.match(/Sharpe\s*Ratio([-\d.]+)/i);
      const drawdownMatch = text.match(/Max\s*Drawdown([-\d.]+)%/i);
      const dayWinMatch = text.match(/Day Win\s*Rate([-\d.]+)%/i);
      const tradeWinMatch = text.match(/Trade Win\s*Rate([-\d.]+)%/i);

      // Debug: find relevant portion of text starting from "Days Tested"
      const daysIdx = text.indexOf('Days Tested');
      const validatorSection = daysIdx > -1
        ? text.substring(daysIdx, Math.min(daysIdx + 500, text.length))
        : text.substring(text.indexOf('Strategy Validator'), text.indexOf('Strategy Validator') + 500);

      return {
        avgDailyReturn: avgDailyMatch ? parseFloat(avgDailyMatch[1]) : null,
        sharpeRatio: sharpeMatch ? parseFloat(sharpeMatch[1]) : null,
        maxDrawdown: drawdownMatch ? parseFloat(drawdownMatch[1]) : null,
        dayWinRate: dayWinMatch ? parseFloat(dayWinMatch[1]) : null,
        tradeWinRate: tradeWinMatch ? parseFloat(tradeWinMatch[1]) : null,
        debugText: validatorSection,
      };
    });

    // Check that at least some stats have non-zero values
    const hasNonZeroStats = (
      (statsValues.sharpeRatio !== null && statsValues.sharpeRatio !== 0) ||
      (statsValues.dayWinRate !== null && statsValues.dayWinRate !== 0) ||
      (statsValues.tradeWinRate !== null && statsValues.tradeWinRate !== 0)
    );

    logResult(
      'Statistics have non-zero values',
      hasNonZeroStats,
      `Sharpe: ${statsValues.sharpeRatio}, DayWin: ${statsValues.dayWinRate}%, TradeWin: ${statsValues.tradeWinRate}%`
    );

    // Debug output
    if (!hasNonZeroStats && statsValues.debugText) {
      console.log('   DEBUG Text snippet:', statsValues.debugText.replace(/\s+/g, ' ').substring(0, 300));
    }
  } catch (error) {
    // Debug: show what text is on page
    const pageText = await page.evaluate(() => document.body.textContent.substring(0, 500));
    logResult('Verdict displayed', false, `Timeout. Page starts with: ${pageText.substring(0, 100)}...`);
  }

  // Check for regime breakdown
  try {
    const regimeVisible = await page.evaluate(() => {
      const text = document.body.textContent.toLowerCase();
      return text.includes('bull') && text.includes('bear');
    });
    logResult('Regime breakdown displayed', regimeVisible);
  } catch (error) {
    logResult('Regime breakdown displayed', false, error.message);
  }

  // Check for strengths/issues - scroll to make sure they're visible
  try {
    // Scroll down to see the strengths/issues section
    await page.evaluate(() => {
      window.scrollBy(0, 500);
    });
    await sleep(500);

    const feedbackVisible = await page.evaluate(() => {
      const text = document.body.textContent;
      return text.includes('Strengths') && text.includes('Issues');
    });
    logResult('Strengths/Issues section displayed', feedbackVisible, feedbackVisible ? '' : 'Text not found in body');
  } catch (error) {
    logResult('Strengths/Issues section displayed', false, error.message);
  }

  // Take final screenshot
  await takeScreenshot(page, '07-final-results');

  // Try to expand daily results
  try {
    const expanded = await page.evaluate(() => {
      const details = document.querySelector('details');
      if (details) {
        details.open = true;
        return true;
      }
      return false;
    });
    if (expanded) {
      await sleep(500);
      await takeScreenshot(page, '08-daily-results-expanded');
      logResult('Daily results expandable', true);
    }
  } catch (error) {
    logResult('Daily results expandable', false, error.message);
  }
}

// ==========================================
// TEST SUITE 4: Edge Cases & Error Handling
// ==========================================
async function testEdgeCases(page) {
  console.log('\n========================================');
  console.log('TEST SUITE 4: Edge Cases & Error Handling');
  console.log('========================================\n');

  // Test 4.1: Invalid symbol
  try {
    const response = await httpRequest('/api/strategy-validator/run', 'POST', {
      symbol: 'INVALID_SYMBOL_12345',
      startDate: getDateDaysAgo(10),
      endDate: getDateDaysAgo(1),
    });
    // Should either fail or return empty results
    const passed = response.status !== 200 || response.data.error || response.data.daysAnalyzed === 0;
    logResult('Handle invalid symbol', passed, `Status: ${response.status}`);
  } catch (error) {
    logResult('Handle invalid symbol', true, `Correctly errors: ${error.message}`);
  }

  // Test 4.2: Too small date range
  try {
    const response = await httpRequest('/api/strategy-validator/run', 'POST', {
      symbol: TEST_SYMBOL,
      startDate: getDateDaysAgo(3),
      endDate: getDateDaysAgo(1),
    });
    const passed = response.status === 400 && response.data.error?.includes('5 days');
    logResult('Reject <5 day range', passed, response.data.error || 'No error');
  } catch (error) {
    logResult('Reject <5 day range', false, error.message);
  }

  // Test 4.3: Future dates
  try {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const response = await httpRequest('/api/strategy-validator/run', 'POST', {
      symbol: TEST_SYMBOL,
      startDate: getDateDaysAgo(1),
      endDate: futureDate.toISOString().split('T')[0],
    });
    // Should handle gracefully (no data for future)
    const passed = response.status === 200 || response.data.error;
    logResult('Handle future dates', passed);
  } catch (error) {
    logResult('Handle future dates', true, 'Correctly rejects');
  }
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================
async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     STRATEGY VALIDATOR E2E TEST SUITE            ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║ Symbol: ${TEST_SYMBOL.padEnd(40)}║`);
  console.log(`║ Base URL: ${BASE_URL.padEnd(38)}║`);
  console.log(`║ Started: ${new Date().toISOString().padEnd(39)}║`);
  console.log('╚══════════════════════════════════════════════════╝');

  let browser;
  let page;

  try {
    // Check if server is running
    console.log('\n🔍 Checking if server is running...');
    try {
      await httpRequest('/api/health');
      console.log('   Server is running!\n');
    } catch {
      console.error('❌ Server not responding at', BASE_URL);
      console.error('   Please run: npm run server-dev');
      process.exit(1);
    }

    // Run API tests first (no browser needed)
    await testBacktestAPI();

    // Launch browser for UI tests
    console.log('\n🌐 Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    // Run UI tests
    await testUIRendering(page);
    await testE2EBacktestFlow(page);
    await testEdgeCases(page);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    results.errors.push(error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Print summary
  const passed = results.tests.filter(t => t.passed).length;
  const failed = results.tests.filter(t => !t.passed).length;
  const duration = ((Date.now() - results.startTime) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║                  TEST SUMMARY                    ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║ Total Tests: ${(passed + failed).toString().padEnd(36)}║`);
  console.log(`║ ✅ Passed: ${passed.toString().padEnd(38)}║`);
  console.log(`║ ❌ Failed: ${failed.toString().padEnd(38)}║`);
  console.log(`║ Duration: ${(duration + 's').padEnd(39)}║`);
  console.log(`║ Screenshots: ${SCREENSHOT_DIR.padEnd(36)}║`);
  console.log('╚══════════════════════════════════════════════════╝');

  // Save results to JSON
  const resultsFile = path.join(SCREENSHOT_DIR, 'test-results.json');
  fs.writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        ...results,
        summary: { passed, failed, duration: `${duration}s` },
        endTime: Date.now(),
      },
      null,
      2
    )
  );
  console.log(`\n📄 Results saved to: ${resultsFile}`);

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runAllTests();
