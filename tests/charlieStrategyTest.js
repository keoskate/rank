/**
 * Charlie Strategy Backtest Parity Test
 *
 * Goal: Achieve parity with TradingView's backtest results
 *
 * TradingView Expected Results:
 * - Symbol: QBTZ
 * - Date Range: Oct 9 - Dec 10, 2025
 * - Timeframe: 5-minute
 * - Total P&L: +$789.97 (+3.16%)
 * - Total Trades: 16
 * - Win Rate: 43.75%
 * - Profit Factor: 3.105
 *
 * Run: node tests/charlieStrategyTest.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8080';
const SCREENSHOT_DIR = './tests/screenshots/charlie-strategy';
const TIMEOUT = 180000; // 3 minutes

// Expected TradingView results
const EXPECTED = {
  totalPnL: 789.97,
  totalReturn: 3.16,
  totalTrades: 16,
  winRate: 43.75,
  profitFactor: 3.105,
};

// Tolerance for comparison
// Note: Exact parity with TradingView is difficult due to data source differences
// (Polygon vs TradingView's data provider). These tolerances account for that.
const TOLERANCE = {
  pnl: 400, // $400 tolerance (data source differences affect P&L)
  trades: 3, // 3 trade tolerance
  winRate: 6, // 6% tolerance
  profitFactor: 1.5, // 1.5 tolerance
};

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Log with timestamp
function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

// Compare results
function compareResults(actual, expected) {
  const issues = [];

  // P&L comparison
  const pnlDiff = Math.abs(actual.totalPnL - expected.totalPnL);
  if (pnlDiff > TOLERANCE.pnl) {
    issues.push(`P&L: got $${actual.totalPnL.toFixed(2)}, expected $${expected.totalPnL.toFixed(2)} (diff: $${pnlDiff.toFixed(2)})`);
  }

  // Trade count comparison
  const tradeDiff = Math.abs(actual.totalTrades - expected.totalTrades);
  if (tradeDiff > TOLERANCE.trades) {
    issues.push(`Trades: got ${actual.totalTrades}, expected ${expected.totalTrades} (diff: ${tradeDiff})`);
  }

  // Win rate comparison
  const winRateDiff = Math.abs(actual.winRate - expected.winRate);
  if (winRateDiff > TOLERANCE.winRate) {
    issues.push(`Win Rate: got ${actual.winRate.toFixed(1)}%, expected ${expected.winRate.toFixed(1)}% (diff: ${winRateDiff.toFixed(1)}%)`);
  }

  // Profit factor comparison
  if (actual.profitFactor !== Infinity) {
    const pfDiff = Math.abs(actual.profitFactor - expected.profitFactor);
    if (pfDiff > TOLERANCE.profitFactor) {
      issues.push(`Profit Factor: got ${actual.profitFactor.toFixed(2)}, expected ${expected.profitFactor.toFixed(2)} (diff: ${pfDiff.toFixed(2)})`);
    }
  }

  return issues;
}

// Main test function
async function runTest() {
  log('Starting Charlie Strategy Parity Test');
  log('=====================================');
  log(`Expected: ${EXPECTED.totalTrades} trades, $${EXPECTED.totalPnL} P&L, ${EXPECTED.winRate}% win rate`);
  log('');

  let browser;
  let page;

  try {
    // Launch browser
    log('Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    // Capture console logs from the page
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      // Print signal debug logs immediately
      if (text.includes('Signal') || text.includes('VWAP=') || text.includes('MACD') || text.includes('nearVWAP') || text.includes('Reasons:') || text.includes('SIGNAL DEBUG')) {
        log(`[BROWSER] ${text}`);
      }
    });

    // Navigate to Charlie Strategy page
    log('Navigating to Charlie Strategy page...');
    await page.goto(`${BASE_URL}/charlie-strategy`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    await sleep(2000);

    // Verify page loaded
    const pageTitle = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent : 'NOT FOUND';
    });
    log(`Page title: ${pageTitle}`);

    // Set inputs: QBTZ, Oct 9 - Dec 10, 2025, 5-minute
    // Usage: node tests/charlieStrategyTest.js [dataSource] [stdevMethod]
    // dataSource: polygon | alpaca
    // stdevMethod: rolling | vwap
    const dataSource = process.argv[2] || 'polygon';
    const stdevMethod = process.argv[3] || 'rolling';
    log(`Setting inputs: QBTZ, 2025-10-09 to 2025-12-10, 5min`)
    log(`  Data source: ${dataSource}, StDev method: ${stdevMethod}`);
    await page.evaluate((ds) => {
      // Helper to set input value
      const setInput = (selector, value) => {
        const input = document.querySelector(selector);
        if (input) {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          ).set;
          nativeSetter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };

      // Find and set symbol input (first text input)
      const textInputs = document.querySelectorAll('input[type="text"]');
      if (textInputs[0]) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set;
        nativeSetter.call(textInputs[0], 'QBTZ');
        textInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        textInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Find and set date inputs
      const dateInputs = document.querySelectorAll('input[type="date"]');
      if (dateInputs.length >= 2) {
        dateInputs[0].value = '2025-10-09';
        dateInputs[1].value = '2025-12-10';
        dateInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
        dateInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Set timeframe to 5min (find the first select - timeframe)
      const selects = document.querySelectorAll('select');
      if (selects[0]) {
        selects[0].value = '5';
        selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Set data source (second select)
      if (selects[1]) {
        selects[1].value = ds;
        selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Click Strategy Config button to show config options
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('Strategy Config')) {
          btn.click();
          break;
        }
      }
    }, dataSource);
    await sleep(500);

    // Set the stdev method
    await page.evaluate((method) => {
      // Find the StDev Method select
      const selects = document.querySelectorAll('select');
      for (const select of selects) {
        const options = select.querySelectorAll('option');
        for (const opt of options) {
          if (opt.value === method || opt.textContent.toLowerCase().includes(method)) {
            select.value = method;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }

      // If using alpaca data source VWAP
      if (method === 'alpaca-vwap') {
        const labels = document.querySelectorAll('label');
        for (const label of labels) {
          if (label.textContent.includes('Use Data Source VWAP')) {
            const checkbox = label.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.checked) {
              checkbox.click();
            }
            break;
          }
        }
      }
    }, stdevMethod);
    await sleep(500);

    // Take screenshot of setup
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-setup.png') });
    log('Screenshot: 01-setup.png');

    // Click Run Backtest button
    log('Clicking Run Backtest...');
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('Run Backtest')) {
          btn.click();
          break;
        }
      }
    });

    // Wait for results (check for metrics to appear)
    log('Waiting for backtest to complete (up to 3 minutes)...');
    try {
      await page.waitForFunction(
        () => {
          const text = document.body.textContent;
          // Check for key metrics in results
          return (
            text.includes('Total P&L') &&
            text.includes('Win Rate') &&
            text.includes('Total Trades') &&
            !text.includes('Running...')
          );
        },
        { timeout: TIMEOUT }
      );
    } catch (e) {
      log('ERROR: Backtest timeout or failed to complete');
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-timeout.png') });
      throw e;
    }

    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-results.png') });
    log('Screenshot: 02-results.png');

    // Extract results from the page
    log('Extracting results...');
    const results = await page.evaluate(() => {
      // Find all metric cards and extract values
      const metrics = {};

      // Try to find metric values by looking at the displayed text
      const text = document.body.textContent;

      // Parse Total P&L
      const pnlMatch = text.match(/Total P&L\s*\$?([-\d,.]+)/);
      if (pnlMatch) {
        metrics.totalPnL = parseFloat(pnlMatch[1].replace(',', ''));
      }

      // Parse Return %
      const returnMatch = text.match(/Return\s*([+-]?[\d.]+)%/);
      if (returnMatch) {
        metrics.totalReturn = parseFloat(returnMatch[1]);
      }

      // Parse Win Rate
      const winRateMatch = text.match(/Win Rate\s*([\d.]+)%/);
      if (winRateMatch) {
        metrics.winRate = parseFloat(winRateMatch[1]);
      }

      // Parse Total Trades
      const tradesMatch = text.match(/Total Trades\s*(\d+)/);
      if (tradesMatch) {
        metrics.totalTrades = parseInt(tradesMatch[1]);
      }

      // Parse Profit Factor
      const pfMatch = text.match(/Profit Factor\s*([\d.]+|N\/A)/);
      if (pfMatch && pfMatch[1] !== 'N/A') {
        metrics.profitFactor = parseFloat(pfMatch[1]);
      }

      // Also try to extract the trade table
      const tradeRows = document.querySelectorAll('table tbody tr');
      metrics.trades = [];
      tradeRows.forEach((row, idx) => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 9) {
          metrics.trades.push({
            num: idx + 1,
            type: cells[1]?.textContent.trim(),
            entry: cells[2]?.textContent.trim(),
            exit: cells[3]?.textContent.trim(),
            shares: cells[4]?.textContent.trim(),
            pnl: cells[5]?.textContent.trim(),
            pct: cells[6]?.textContent.trim(),
            score: cells[7]?.textContent.trim(),
            reason: cells[8]?.textContent.trim(),
          });
        }
      });

      return metrics;
    });

    log('');
    log('ACTUAL RESULTS:');
    log('===============');
    log(`Total P&L: $${results.totalPnL?.toFixed(2) || 'N/A'}`);
    log(`Return: ${results.totalReturn?.toFixed(2) || 'N/A'}%`);
    log(`Total Trades: ${results.totalTrades || 'N/A'}`);
    log(`Win Rate: ${results.winRate?.toFixed(1) || 'N/A'}%`);
    log(`Profit Factor: ${results.profitFactor?.toFixed(2) || 'N/A'}`);
    log('');

    // Log individual trades for debugging
    if (results.trades && results.trades.length > 0) {
      log('TRADE DETAILS:');
      log('==============');
      results.trades.forEach(t => {
        log(`#${t.num} ${t.type} Entry:${t.entry} Exit:${t.exit} PnL:${t.pnl} (${t.reason})`);
      });
      log('');
    }

    // Compare with expected
    log('COMPARISON:');
    log('===========');
    const issues = compareResults(
      {
        totalPnL: results.totalPnL || 0,
        totalTrades: results.totalTrades || 0,
        winRate: results.winRate || 0,
        profitFactor: results.profitFactor || 0,
      },
      EXPECTED
    );

    if (issues.length === 0) {
      log('SUCCESS! Results are within tolerance of TradingView.');
    } else {
      log('DISCREPANCIES FOUND:');
      issues.forEach(issue => log(`  - ${issue}`));
    }

    // Save results to JSON for debugging
    const resultsFile = path.join(SCREENSHOT_DIR, 'test-results.json');
    fs.writeFileSync(
      resultsFile,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          expected: EXPECTED,
          actual: results,
          issues,
          passed: issues.length === 0,
        },
        null,
        2
      )
    );
    log(`\nResults saved to: ${resultsFile}`);

    return {
      passed: issues.length === 0,
      results,
      issues,
    };
  } catch (error) {
    log(`ERROR: ${error.message}`);
    if (page) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'error.png') });
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
runTest()
  .then(result => {
    console.log('\n');
    if (result.passed) {
      console.log('========================================');
      console.log('       PARITY ACHIEVED!');
      console.log('========================================');
      process.exit(0);
    } else {
      console.log('========================================');
      console.log('       PARITY NOT YET ACHIEVED');
      console.log('========================================');
      console.log('\nNext steps to debug:');
      console.log('1. Check signal generation logic');
      console.log('2. Verify SL/TP calculation uses signal bar close');
      console.log('3. Check VWAP session reset timing');
      console.log('4. Verify opposite position closing behavior');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
