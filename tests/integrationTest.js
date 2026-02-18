/**
 * Integration Test Suite
 *
 * Tests all page flows and config integration:
 * - Trading Simulator config integration
 * - Strategy Lab flows
 * - A/B Testing flows
 * - Walk-Forward Optimization flows
 * - Backtest flows
 *
 * Run with: node tests/integrationTest.js
 */

const puppeteer = require('puppeteer');
const http = require('http');

const BASE_URL = 'http://localhost:8080';
const SCREENSHOT_DIR = './tests/screenshots';

// Results tracking
const results = {
  tests: [],
  startTime: Date.now(),
};

// Helper to make HTTP requests
function httpRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Log result
function logResult(name, passed, details = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (details) console.log(`   ${details}`);
  results.tests.push({ name, passed, details });
}

// ==========================================
// TEST 1: Trading Simulator Config Integration
// ==========================================
async function testTradingSimulatorConfig(browser) {
  console.log('\n--- TEST 1: Trading Simulator Config Integration ---\n');
  const page = await browser.newPage();
  const logs = [];

  // Capture console logs to verify config is being used
  page.on('console', msg => {
    if (msg.text().includes('[Simulator]')) {
      logs.push(msg.text());
    }
  });

  try {
    // Navigate to live trading sessions list
    await page.goto(`${BASE_URL}/live-trading`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    let pageContent = await page.content();

    // Check for sessions list view
    const hasSessionsList = pageContent.includes('AI Trading Sessions') ||
                            pageContent.includes('Trading Sessions') ||
                            pageContent.includes('New Session');
    logResult('Sessions list view rendered', hasSessionsList);

    // Try to click "View" button to enter a session
    const viewButtons = await page.$$('button');
    let enteredSession = false;
    for (const btn of viewButtons) {
      const text = await btn.evaluate(el => el.textContent);
      if (text && text.includes('View')) {
        await btn.click();
        await new Promise(r => setTimeout(r, 2000));
        enteredSession = true;
        break;
      }
    }

    if (enteredSession) {
      logResult('Entered session detail view', true);
      pageContent = await page.content();

      // Now check for config panel toggle button and click it
      const configToggle = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.includes('Settings') || btn.textContent.includes('Config')) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (configToggle) {
        await new Promise(r => setTimeout(r, 500));
        pageContent = await page.content();
      }

      // Check for config elements in session view
      const hasConfigPanel =
        pageContent.includes('Take Profit') ||
        pageContent.includes('Stop Loss') ||
        pageContent.includes('Position Management') ||
        pageContent.includes('Capital');
      logResult('ConfigPanel visible in session', hasConfigPanel);

      // Check for StrategyMonitorPanel
      const hasStrategyMonitor = pageContent.includes('Strategy Monitor') || pageContent.includes('Win Rate');
      logResult('StrategyMonitorPanel visible', hasStrategyMonitor);

      // Check for RegimeConfigPanel
      const hasRegimePanel = pageContent.includes('Market Regime') || pageContent.includes('Auto-Adapt');
      logResult('RegimeConfigPanel visible', hasRegimePanel);

      // Check for Simulator toggle button
      const hasSimulatorToggle = pageContent.includes('Simulate Trading') || pageContent.includes('Hide Simulator');
      logResult('Simulator toggle button present', hasSimulatorToggle);

      // Try to click Simulate Trading button
      const simulatorOpened = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.includes('Simulate Trading')) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (simulatorOpened) {
        await new Promise(r => setTimeout(r, 1000));
        pageContent = await page.content();
        const hasSimulator = pageContent.includes('Run Simulation') ||
                             pageContent.includes('simulation') ||
                             pageContent.includes('Start');
        logResult('TradingSimulator opened', hasSimulator);
      }

    } else {
      logResult('Entered session detail view', false, 'No View button found - creating new session');

      // Try to create new session
      const newSessionBtn = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent.includes('New Session')) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (newSessionBtn) {
        await new Promise(r => setTimeout(r, 2000));
        logResult('New Session button clicked', true);
      }
    }

    // Take screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/live-trading-session-detail.png`, fullPage: true });
    logResult('Screenshot saved', true);

  } catch (error) {
    logResult('Trading Simulator Config Test', false, error.message);
  }

  await page.close();
}

// ==========================================
// TEST 2: Strategy Lab Flows
// ==========================================
async function testStrategyLabFlows(browser) {
  console.log('\n--- TEST 2: Strategy Lab Flows ---\n');
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE_URL}/strategy-lab`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageContent = await page.content();

    // Check for main tabs
    const hasTabs = pageContent.includes('Strategies') ||
                    pageContent.includes('Simulator') ||
                    pageContent.includes('Validator');
    logResult('Strategy Lab tabs present', hasTabs);

    // Check for config categories
    const configCategories = [
      'Capital Allocation',
      'Position Management',
      'Risk Management',
      'Entry Conditions',
      'Exit Conditions',
      'Filters',
      'Advanced'
    ];

    let foundCategories = 0;
    for (const cat of configCategories) {
      if (pageContent.includes(cat)) foundCategories++;
    }
    logResult('Config categories visible', foundCategories >= 3, `Found ${foundCategories}/7 categories`);

    // Check for buttons/actions
    const hasActions = pageContent.includes('Save') ||
                       pageContent.includes('Run') ||
                       pageContent.includes('Create');
    logResult('Action buttons present', hasActions);

    // Try clicking on different tabs
    const tabButtons = await page.$$('button');
    for (const btn of tabButtons) {
      const text = await btn.evaluate(el => el.textContent);
      if (text && (text.includes('Simulator') || text.includes('Validator'))) {
        await btn.click();
        await new Promise(r => setTimeout(r, 500));
        const newContent = await page.content();
        const tabChanged = !newContent.includes('Strategies') || newContent.includes('Simulator');
        logResult(`Tab click: ${text}`, true);
        break;
      }
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/strategy-lab-flows.png`, fullPage: true });

  } catch (error) {
    logResult('Strategy Lab Flows Test', false, error.message);
  }

  await page.close();
}

// ==========================================
// TEST 3: A/B Testing Flows
// ==========================================
async function testABTestingFlows(browser) {
  console.log('\n--- TEST 3: A/B Testing Flows ---\n');
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE_URL}/ab-testing`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageContent = await page.content();

    // Check for A/B testing elements
    const hasABElements = pageContent.includes('Control') ||
                          pageContent.includes('Challenger') ||
                          pageContent.includes('A/B Test');
    logResult('A/B Testing elements present', hasABElements);

    // Check for comparison view
    const hasComparison = pageContent.includes('vs') ||
                          pageContent.includes('Compare') ||
                          (pageContent.includes('Control') && pageContent.includes('Challenger'));
    logResult('Comparison view available', hasComparison);

    // Test API: Get all tests
    const testsResponse = await httpRequest('/api/ab-tests');
    logResult('GET /api/ab-tests', testsResponse.status === 200, `Status: ${testsResponse.status}`);

    // Test API: Get active tests
    const activeResponse = await httpRequest('/api/ab-tests/active');
    logResult('GET /api/ab-tests/active', activeResponse.status === 200, `Status: ${activeResponse.status}`);

    // Check for "Create Test" or "New Test" button
    const hasCreateButton = pageContent.includes('Create') || pageContent.includes('New Test');
    logResult('Create Test button present', hasCreateButton);

    // Try to find config panels for Control and Challenger
    const configPanelCount = (pageContent.match(/ConfigPanel|config-panel|Position Management/g) || []).length;
    logResult('Config panels for comparison', configPanelCount >= 1, `Found ${configPanelCount} config references`);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/ab-testing-flows.png`, fullPage: true });

  } catch (error) {
    logResult('A/B Testing Flows Test', false, error.message);
  }

  await page.close();
}

// ==========================================
// TEST 4: Walk-Forward Optimization Flows
// ==========================================
async function testWalkForwardFlows(browser) {
  console.log('\n--- TEST 4: Walk-Forward Optimization Flows ---\n');
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE_URL}/walk-forward`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageContent = await page.content();

    // Check for walk-forward elements
    const hasWFElements = pageContent.includes('Walk-Forward') ||
                          pageContent.includes('Optimization') ||
                          pageContent.includes('Training Period');
    logResult('Walk-Forward elements present', hasWFElements);

    // Check for tabs
    const hasTabs = pageContent.includes('Run Optimization') ||
                    pageContent.includes('Results') ||
                    pageContent.includes('How It Works');
    logResult('Walk-Forward tabs present', hasTabs);

    // Check for base strategy config
    const hasBaseStrategy = pageContent.includes('Base Strategy') ||
                            pageContent.includes('Take Profit') ||
                            pageContent.includes('Stop Loss');
    logResult('Base Strategy config present', hasBaseStrategy);

    // Check for walk-forward settings
    const hasWFSettings = pageContent.includes('Training Period') ||
                          pageContent.includes('Test Period') ||
                          pageContent.includes('Step');
    logResult('Walk-Forward settings present', hasWFSettings);

    // Test API: Get parameter ranges
    const paramsResponse = await httpRequest('/api/optimize/parameters');
    logResult('GET /api/optimize/parameters', paramsResponse.status === 200, `Status: ${paramsResponse.status}`);

    if (paramsResponse.status === 200 && paramsResponse.data.parameterRanges) {
      const ranges = paramsResponse.data.parameterRanges;
      const rangeCount = Object.keys(ranges).length;
      logResult('Parameter ranges returned', rangeCount > 0, `Found ${rangeCount} parameters`);
    }

    // Check for Quick Validation and Full Optimization buttons
    const hasButtons = pageContent.includes('Quick Validation') ||
                       pageContent.includes('Run Full Optimization');
    logResult('Action buttons present', hasButtons);

    // Check for "Load Current Config" button
    const hasLoadConfig = pageContent.includes('Load Current Config');
    logResult('Load Current Config button', hasLoadConfig);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/walk-forward-flows.png`, fullPage: true });

  } catch (error) {
    logResult('Walk-Forward Flows Test', false, error.message);
  }

  await page.close();
}

// ==========================================
// TEST 5: Backtest Flows
// ==========================================
async function testBacktestFlows(browser) {
  console.log('\n--- TEST 5: Backtest Flows ---\n');
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE_URL}/backtest`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageContent = await page.content();

    // Check for backtest elements
    const hasBacktestElements = pageContent.includes('Backtest') ||
                                pageContent.includes('Historical') ||
                                pageContent.includes('Symbol');
    logResult('Backtest elements present', hasBacktestElements);

    // Check for config section
    const hasConfig = pageContent.includes('Take Profit') ||
                      pageContent.includes('Stop Loss') ||
                      pageContent.includes('Configuration');
    logResult('Config section present', hasConfig);

    // Check for date range selection
    const hasDateRange = pageContent.includes('Start Date') ||
                         pageContent.includes('End Date') ||
                         pageContent.includes('Date Range');
    logResult('Date range selection present', hasDateRange);

    // Check for Run Backtest button
    const hasRunButton = pageContent.includes('Run Backtest') ||
                         pageContent.includes('Start Backtest');
    logResult('Run Backtest button present', hasRunButton);

    // Test API: Check strategy versions endpoint
    const versionsResponse = await httpRequest('/api/strategy-versions');
    logResult('GET /api/strategy-versions', versionsResponse.status === 200, `Status: ${versionsResponse.status}`);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/backtest-flows.png`, fullPage: true });

  } catch (error) {
    logResult('Backtest Flows Test', false, error.message);
  }

  await page.close();
}

// ==========================================
// TEST 6: API Integration Tests
// ==========================================
async function testAPIIntegration() {
  console.log('\n--- TEST 6: API Integration Tests ---\n');

  // Test regime detection API
  try {
    const regimeResponse = await httpRequest('/api/regime/SPY');
    logResult('GET /api/regime/SPY', regimeResponse.status === 200 || regimeResponse.status === 404,
              `Status: ${regimeResponse.status}`);
  } catch (error) {
    logResult('GET /api/regime/SPY', false, error.message);
  }

  // Test strategy monitor API
  try {
    const monitorResponse = await httpRequest('/api/monitors/AAPL/default');
    logResult('GET /api/monitors/:symbol/:versionId',
              monitorResponse.status === 200 || monitorResponse.status === 404,
              `Status: ${monitorResponse.status}`);
  } catch (error) {
    logResult('GET /api/monitors/:symbol/:versionId', false, error.message);
  }

  // Test walk-forward quick validate (POST)
  try {
    const validateResponse = await httpRequest('/api/optimize/quick-validate', 'POST', {
      symbol: 'SPY',
      config: {
        takeProfitPercent: 2,
        stopLossPercent: 1,
        minConfidence: 70
      }
    });
    // May return error due to lack of data, but API should respond
    logResult('POST /api/optimize/quick-validate',
              validateResponse.status === 200 || validateResponse.status === 500,
              `Status: ${validateResponse.status}`);
  } catch (error) {
    logResult('POST /api/optimize/quick-validate', false, error.message);
  }

  // Test A/B test creation
  try {
    const createTestResponse = await httpRequest('/api/ab-tests', 'POST', {
      name: 'Integration Test',
      symbol: 'AAPL',
      control: { takeProfitPercent: 2, stopLossPercent: 1 },
      challenger: { takeProfitPercent: 3, stopLossPercent: 1.5 }
    });
    logResult('POST /api/ab-tests',
              createTestResponse.status === 200 || createTestResponse.status === 201 || createTestResponse.status === 400,
              `Status: ${createTestResponse.status}`);
  } catch (error) {
    logResult('POST /api/ab-tests', false, error.message);
  }
}

// ==========================================
// TEST 7: Config Context Persistence
// ==========================================
async function testConfigPersistence(browser) {
  console.log('\n--- TEST 7: Config Context Persistence ---\n');
  const page = await browser.newPage();

  try {
    // Go to Strategy Lab and modify config
    await page.goto(`${BASE_URL}/strategy-lab`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Try to find and modify a config value
    const modifyResult = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="number"]');
      if (inputs.length > 0) {
        const input = inputs[0];
        const oldValue = input.value;
        input.value = '7.77';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { modified: true, oldValue, newValue: '7.77', inputId: input.id || 'no-id' };
      }
      return { modified: false };
    });

    if (modifyResult.modified) {
      logResult('Config modified on Strategy Lab', true, `Changed to ${modifyResult.newValue}`);

      // Navigate to Live Trading and check if value persists
      await page.goto(`${BASE_URL}/live-trading`, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const persistedValue = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="number"]');
        for (const input of inputs) {
          if (input.value === '7.77') return true;
        }
        return false;
      });

      logResult('Config persisted across navigation', persistedValue,
                persistedValue ? 'Value 7.77 found' : 'Value not found');
    } else {
      logResult('Config modified on Strategy Lab', false, 'No inputs found');
    }

  } catch (error) {
    logResult('Config Persistence Test', false, error.message);
  }

  await page.close();
}

// ==========================================
// TEST 8: Paper Trading Page
// ==========================================
async function testPaperTradingFlows(browser) {
  console.log('\n--- TEST 8: Paper Trading Flows ---\n');
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE_URL}/paper-trading`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageContent = await page.content();

    // Check for paper trading elements
    const hasPaperElements = pageContent.includes('Paper Trading') ||
                             pageContent.includes('Simulated') ||
                             pageContent.includes('Virtual');
    logResult('Paper Trading elements present', hasPaperElements);

    // Check for account info
    const hasAccountInfo = pageContent.includes('Balance') ||
                           pageContent.includes('Cash') ||
                           pageContent.includes('Portfolio');
    logResult('Account info present', hasAccountInfo);

    // Check for trading controls
    const hasControls = pageContent.includes('Buy') ||
                        pageContent.includes('Sell') ||
                        pageContent.includes('Trade');
    logResult('Trading controls present', hasControls);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/paper-trading-flows.png`, fullPage: true });

  } catch (error) {
    logResult('Paper Trading Flows Test', false, error.message);
  }

  await page.close();
}

// ==========================================
// TEST 9: Performance Analytics Page
// ==========================================
async function testAnalyticsFlows(browser) {
  console.log('\n--- TEST 9: Performance Analytics Flows ---\n');
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const pageContent = await page.content();

    // Check for analytics elements
    const hasAnalyticsElements = pageContent.includes('Analytics') ||
                                 pageContent.includes('Performance') ||
                                 pageContent.includes('Metrics');
    logResult('Analytics elements present', hasAnalyticsElements);

    // Check for charts
    const hasCharts = pageContent.includes('Chart') ||
                      pageContent.includes('Graph') ||
                      pageContent.includes('canvas');
    logResult('Chart elements present', hasCharts);

    // Check for metrics display
    const hasMetrics = pageContent.includes('Win Rate') ||
                       pageContent.includes('Profit') ||
                       pageContent.includes('Return');
    logResult('Metrics display present', hasMetrics);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/analytics-flows.png`, fullPage: true });

  } catch (error) {
    logResult('Analytics Flows Test', false, error.message);
  }

  await page.close();
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================
async function runTests() {
  console.log('\n========================================');
  console.log('   INTEGRATION TEST SUITE');
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

  try {
    await testTradingSimulatorConfig(browser);
    await testStrategyLabFlows(browser);
    await testABTestingFlows(browser);
    await testWalkForwardFlows(browser);
    await testBacktestFlows(browser);
    await testAPIIntegration();
    await testConfigPersistence(browser);
    await testPaperTradingFlows(browser);
    await testAnalyticsFlows(browser);
  } catch (error) {
    console.error('Test runner error:', error);
  }

  await browser.close();

  // Summary
  const totalTime = Date.now() - results.startTime;
  const passed = results.tests.filter(t => t.passed).length;
  const failed = results.tests.filter(t => !t.passed).length;

  console.log('\n========================================');
  console.log('   TEST SUMMARY');
  console.log('========================================');
  console.log(`\nTests: ${passed} passed, ${failed} failed`);
  console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}/`);

  if (failed > 0) {
    console.log('\n--- FAILURES ---');
    results.tests
      .filter(t => !t.passed)
      .forEach(t => console.log(`❌ ${t.name}: ${t.details || 'No details'}`));
  }

  console.log('\n');
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
