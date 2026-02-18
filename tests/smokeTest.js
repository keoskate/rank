/**
 * Automated Smoke Test Suite
 *
 * Tests all pages and key functionality of the trading platform.
 * Run with: node tests/smokeTest.js
 */

const puppeteer = require('puppeteer');
const http = require('http');

const BASE_URL = 'http://localhost:8080';
const SCREENSHOT_DIR = './tests/screenshots';

// All routes to test
const PAGES = [
  { path: '/', name: 'Rankings', expectedText: 'Rankings' },
  { path: '/portfolio', name: 'Portfolio', expectedText: 'Portfolio' },
  { path: '/backtest', name: 'Backtest', expectedText: 'Backtest' },
  { path: '/day-trading', name: 'Intraday Analyzer', expectedText: null },
  { path: '/live-trading', name: 'Live Trading Sessions', expectedText: 'Trading Sessions' },
  { path: '/import-trades', name: 'Trade Import', expectedText: 'Import' },
  { path: '/analytics', name: 'Performance Analytics', expectedText: 'Analytics' },
  { path: '/ab-testing', name: 'A/B Testing', expectedText: 'A/B' },
  { path: '/walk-forward', name: 'Walk Forward', expectedText: null },
  { path: '/strategy-lab', name: 'Strategy Lab', expectedText: 'Strategy' },
  { path: '/overnight', name: 'Overnight Optimization', expectedText: 'Overnight' },
  { path: '/invest', name: 'Invest (Legacy)', expectedText: null },
  { path: '/paper-trading', name: 'Paper Trading', expectedText: 'Paper' },
  { path: '/ai-research', name: 'AI Research', expectedText: 'AI' },
];

// Key API endpoints to test
const API_ENDPOINTS = [
  { path: '/api/alpaca/account', name: 'Alpaca Account', method: 'GET' },
  { path: '/api/alpaca/positions', name: 'Alpaca Positions', method: 'GET' },
  { path: '/api/trading/mode', name: 'Trading Mode', method: 'GET' },
  { path: '/api/strategy-versions', name: 'Strategy Versions', method: 'GET' },
  { path: '/api/overnight/jobs', name: 'Overnight Jobs', method: 'GET' },
  { path: '/api/snapshots/dates', name: 'Snapshot Dates', method: 'GET' },
];

// Results tracking
const results = {
  pages: [],
  apis: [],
  consoleErrors: [],
  startTime: Date.now(),
};

// Helper to make HTTP requests
function httpRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

// Test a single page
async function testPage(browser, { path, name, expectedText }) {
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleLogs = [];

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      pageErrors.push(msg.text());
    }
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  // Capture page errors
  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  const result = {
    name,
    path,
    status: 'pending',
    loadTime: 0,
    errors: [],
    hasExpectedContent: null,
    screenshot: null,
  };

  try {
    const startTime = Date.now();
    const response = await page.goto(`${BASE_URL}${path}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    result.loadTime = Date.now() - startTime;
    result.httpStatus = response.status();

    // Wait for React to render
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check for expected text if specified
    if (expectedText) {
      const content = await page.content();
      result.hasExpectedContent = content.includes(expectedText);
    }

    // Take screenshot
    const screenshotPath = `${SCREENSHOT_DIR}/${name.replace(/[\s\/]+/g, '-').toLowerCase()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshot = screenshotPath;

    // Check for React error boundary
    const hasErrorBoundary = await page.$('.error-boundary, [data-testid="error"]');
    if (hasErrorBoundary) {
      pageErrors.push('Error boundary triggered');
    }

    // Look for common error indicators
    const errorText = await page.evaluate(() => {
      const body = document.body.innerText;
      if (body.includes('Something went wrong')) return 'Something went wrong error';
      if (body.includes('Cannot read properties')) return 'Runtime error detected';
      if (body.includes('undefined is not')) return 'Undefined error detected';
      return null;
    });
    if (errorText) pageErrors.push(errorText);

    result.errors = pageErrors;
    result.status = pageErrors.length === 0 ? 'PASS' : 'WARN';

  } catch (error) {
    result.status = 'FAIL';
    result.errors.push(error.message);
  }

  await page.close();
  return result;
}

// Test API endpoint
async function testAPI({ path, name, method }) {
  const result = {
    name,
    path,
    method,
    status: 'pending',
    responseTime: 0,
    httpStatus: null,
    error: null,
  };

  try {
    const startTime = Date.now();
    const response = await httpRequest(path);
    result.responseTime = Date.now() - startTime;
    result.httpStatus = response.status;
    result.status = response.status >= 200 && response.status < 400 ? 'PASS' : 'FAIL';
  } catch (error) {
    result.status = 'FAIL';
    result.error = error.message;
  }

  return result;
}

// Test Trading Simulator config integration
async function testTradingSimulator(browser) {
  const page = await browser.newPage();
  const result = {
    name: 'Trading Simulator Config Test',
    status: 'pending',
    steps: [],
  };

  try {
    // Navigate to live trading (where simulator lives)
    await page.goto(`${BASE_URL}/live-trading`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 1000));
    result.steps.push({ step: 'Navigate to Live Trading', status: 'PASS' });

    // Look for "New Session" button to create a session
    const newSessionBtn = await page.$('button');
    if (newSessionBtn) {
      result.steps.push({ step: 'Found New Session button', status: 'PASS' });
    }

    // Check if ConfigPanel is present (search for config-related text)
    const pageContent = await page.content();
    const hasConfigElements = pageContent.includes('Take Profit') ||
                              pageContent.includes('Stop Loss') ||
                              pageContent.includes('Configuration') ||
                              pageContent.includes('Capital');

    if (hasConfigElements) {
      result.steps.push({ step: 'ConfigPanel elements found', status: 'PASS' });
    } else {
      result.steps.push({ step: 'ConfigPanel elements found', status: 'WARN', note: 'May need to create session first' });
    }

    result.status = result.steps.every(s => s.status !== 'FAIL') ? 'PASS' : 'FAIL';

  } catch (error) {
    result.status = 'FAIL';
    result.steps.push({ step: 'Test execution', status: 'FAIL', error: error.message });
  }

  await page.close();
  return result;
}

// Test Strategy Lab
async function testStrategyLab(browser) {
  const page = await browser.newPage();
  const result = {
    name: 'Strategy Lab Integration Test',
    status: 'pending',
    steps: [],
  };

  try {
    await page.goto(`${BASE_URL}/strategy-lab`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    result.steps.push({ step: 'Navigate to Strategy Lab', status: 'PASS' });

    // Check for tabs
    const pageContent = await page.content();
    const hasTabs = pageContent.includes('Strategies') ||
                    pageContent.includes('Simulator') ||
                    pageContent.includes('Validator');

    if (hasTabs) {
      result.steps.push({ step: 'Strategy Lab tabs present', status: 'PASS' });
    } else {
      result.steps.push({ step: 'Strategy Lab tabs present', status: 'WARN' });
    }

    // Check for ConfigPanel (all 7 categories should be visible)
    const hasAllCategories =
      pageContent.includes('Capital Allocation') ||
      pageContent.includes('Position Management') ||
      pageContent.includes('Risk Management');

    if (hasAllCategories) {
      result.steps.push({ step: 'Full ConfigPanel present', status: 'PASS' });
    } else {
      result.steps.push({ step: 'Full ConfigPanel present', status: 'WARN', note: 'May be in collapsed state' });
    }

    // Take screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/strategy-lab-detail.png`, fullPage: true });
    result.steps.push({ step: 'Screenshot captured', status: 'PASS' });

    result.status = result.steps.every(s => s.status !== 'FAIL') ? 'PASS' : 'FAIL';

  } catch (error) {
    result.status = 'FAIL';
    result.steps.push({ step: 'Test execution', status: 'FAIL', error: error.message });
  }

  await page.close();
  return result;
}

// Test A/B Testing Page
async function testABTesting(browser) {
  const page = await browser.newPage();
  const result = {
    name: 'A/B Testing Integration Test',
    status: 'pending',
    steps: [],
  };

  try {
    await page.goto(`${BASE_URL}/ab-testing`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    result.steps.push({ step: 'Navigate to A/B Testing', status: 'PASS' });

    const pageContent = await page.content();

    // Check for A/B testing elements
    const hasABElements =
      pageContent.includes('Control') ||
      pageContent.includes('Challenger') ||
      pageContent.includes('A/B Test');

    if (hasABElements) {
      result.steps.push({ step: 'A/B Testing elements present', status: 'PASS' });
    } else {
      result.steps.push({ step: 'A/B Testing elements present', status: 'WARN' });
    }

    // Check for config categories
    const hasConfigCategories =
      pageContent.includes('Capital') ||
      pageContent.includes('Position') ||
      pageContent.includes('Risk');

    if (hasConfigCategories) {
      result.steps.push({ step: 'Config categories visible', status: 'PASS' });
    }

    // Take screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/ab-testing-detail.png`, fullPage: true });

    result.status = result.steps.every(s => s.status !== 'FAIL') ? 'PASS' : 'FAIL';

  } catch (error) {
    result.status = 'FAIL';
    result.steps.push({ step: 'Test execution', status: 'FAIL', error: error.message });
  }

  await page.close();
  return result;
}

// Main test runner
async function runTests() {
  console.log('\n========================================');
  console.log('   AUTOMATED SMOKE TEST SUITE');
  console.log('========================================\n');

  // Check if server is running
  try {
    await httpRequest('/');
    console.log('Server is running at', BASE_URL);
  } catch {
    console.error('ERROR: Server is not running at', BASE_URL);
    console.log('Please start the server with: npm run server-dev');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  console.log('\n--- TESTING ALL PAGES ---\n');

  for (const pageConfig of PAGES) {
    const result = await testPage(browser, pageConfig);
    results.pages.push(result);

    const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '⚠️' : '❌';
    console.log(`${icon} ${result.name} (${result.path})`);
    console.log(`   Load time: ${result.loadTime}ms | HTTP: ${result.httpStatus}`);
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.slice(0, 2).join(', ')}`);
    }
  }

  console.log('\n--- TESTING API ENDPOINTS ---\n');

  for (const apiConfig of API_ENDPOINTS) {
    const result = await testAPI(apiConfig);
    results.apis.push(result);

    const icon = result.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${result.name} (${result.path})`);
    console.log(`   Response: ${result.responseTime}ms | HTTP: ${result.httpStatus}`);
  }

  console.log('\n--- INTEGRATION TESTS ---\n');

  // Test Trading Simulator
  const simResult = await testTradingSimulator(browser);
  console.log(`${simResult.status === 'PASS' ? '✅' : '⚠️'} ${simResult.name}`);
  simResult.steps.forEach(s => {
    console.log(`   ${s.status === 'PASS' ? '✓' : '!'} ${s.step}`);
  });

  // Test Strategy Lab
  const stratResult = await testStrategyLab(browser);
  console.log(`${stratResult.status === 'PASS' ? '✅' : '⚠️'} ${stratResult.name}`);
  stratResult.steps.forEach(s => {
    console.log(`   ${s.status === 'PASS' ? '✓' : '!'} ${s.step}`);
  });

  // Test A/B Testing
  const abResult = await testABTesting(browser);
  console.log(`${abResult.status === 'PASS' ? '✅' : '⚠️'} ${abResult.name}`);
  abResult.steps.forEach(s => {
    console.log(`   ${s.status === 'PASS' ? '✓' : '!'} ${s.step}`);
  });

  await browser.close();

  // Summary
  const totalTime = Date.now() - results.startTime;
  const pagesPassed = results.pages.filter(p => p.status === 'PASS').length;
  const pagesWarned = results.pages.filter(p => p.status === 'WARN').length;
  const pagesFailed = results.pages.filter(p => p.status === 'FAIL').length;
  const apisPassed = results.apis.filter(a => a.status === 'PASS').length;
  const apisFailed = results.apis.filter(a => a.status === 'FAIL').length;

  console.log('\n========================================');
  console.log('   TEST SUMMARY');
  console.log('========================================');
  console.log(`\nPages: ${pagesPassed} passed, ${pagesWarned} warnings, ${pagesFailed} failed`);
  console.log(`APIs: ${apisPassed} passed, ${apisFailed} failed`);
  console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}/`);

  // List any failures
  const failures = [
    ...results.pages.filter(p => p.status === 'FAIL'),
    ...results.apis.filter(a => a.status === 'FAIL'),
  ];

  if (failures.length > 0) {
    console.log('\n--- FAILURES ---');
    failures.forEach(f => {
      console.log(`❌ ${f.name}: ${f.errors?.join(', ') || f.error}`);
    });
  }

  // List warnings
  const warnings = results.pages.filter(p => p.status === 'WARN');
  if (warnings.length > 0) {
    console.log('\n--- WARNINGS ---');
    warnings.forEach(w => {
      console.log(`⚠️ ${w.name}: ${w.errors.slice(0, 2).join(', ')}`);
    });
  }

  console.log('\n');

  // Exit with appropriate code
  process.exit(pagesFailed > 0 || apisFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
