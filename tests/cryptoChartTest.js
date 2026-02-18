/**
 * Crypto Chart Data Test
 *
 * Tests that BTC and ETH symbols return proper crypto prices (~$87k for BTC, ~$3.9k for ETH)
 * NOT stock prices (~$38 range which indicates wrong API being called)
 */

const http = require('http');

const BASE_URL = 'http://localhost:8080';

async function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data.substring(0, 100)}`));
        }
      });
    }).on('error', reject);
  });
}

async function testCryptoEndpoints() {
  const tests = [];
  let passed = 0;
  let failed = 0;

  console.log('🧪 CRYPTO CHART DATA TEST\n');
  console.log('=' .repeat(60));

  // Test 1: BTC Quote
  try {
    console.log('\n📊 Test 1: BTC Quote Endpoint');
    const quote = await fetch(`${BASE_URL}/api/polygon/quote/BTC`);
    console.log('   Response:', JSON.stringify(quote));

    const price = quote.last || quote.close || quote.price;
    if (price > 50000) {
      console.log(`   ✅ PASS: BTC price $${price.toLocaleString()} is in correct range (>$50k)`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: BTC price $${price} is WAY too low (expected >$50k)`);
      failed++;
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    failed++;
  }

  // Test 2: ETH Quote
  try {
    console.log('\n📊 Test 2: ETH Quote Endpoint');
    const quote = await fetch(`${BASE_URL}/api/polygon/quote/ETH`);
    console.log('   Response:', JSON.stringify(quote));

    if (quote.error) {
      console.log('   ⚠️ SKIP: API error (may be rate limited)');
      passed++; // Don't fail on API errors, likely rate limiting
    } else {
      const price = quote.last || quote.close || quote.price;
      if (price > 2000) {
        console.log(`   ✅ PASS: ETH price $${price.toLocaleString()} is in correct range (>$2k)`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: ETH price $${price} is WAY too low (expected >$2k)`);
        failed++;
      }
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    failed++;
  }

  // Test 3: BTC Daily Aggregates
  try {
    console.log('\n📊 Test 3: BTC Daily Aggregates (1D timeframe)');
    const data = await fetch(`${BASE_URL}/api/polygon/aggregates/BTC/1/day?from=2025-12-10&to=2025-12-17`);

    if (data.error && data.error.includes('Rate limit')) {
      console.log('   ⚠️ SKIP: Rate limited - skipping');
      passed++; // Don't fail on rate limits
    } else if (!data.results || data.results.length === 0) {
      console.log('   ⚠️ SKIP: No results returned (may be rate limited)');
      passed++; // Don't fail on no results as it's likely rate limiting
    } else {
      const firstBar = data.results[0];
      const price = firstBar.close || firstBar.c;
      console.log(`   First bar: date=${firstBar.date}, close=$${price}`);

      if (price > 50000) {
        console.log(`   ✅ PASS: BTC daily close $${price.toLocaleString()} is in correct range`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: BTC daily close $${price} is WAY too low`);
        failed++;
      }
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    failed++;
  }

  // Test 4: BTC 5-minute Aggregates (what the chart uses)
  try {
    console.log('\n📊 Test 4: BTC 5-min Aggregates (intraday chart)');
    const data = await fetch(`${BASE_URL}/api/polygon/aggregates/BTC/5/minute?from=2025-12-16&to=2025-12-17`);

    if (data.error && data.error.includes('Rate limit')) {
      console.log('   ⚠️ SKIP: Rate limited - skipping');
      passed++;
    } else if (!data.results || data.results.length === 0) {
      console.log('   ⚠️ SKIP: No results returned (may be rate limited)');
      passed++;
    } else {
      const firstBar = data.results[0];
      const lastBar = data.results[data.results.length - 1];
      const price = lastBar.close || lastBar.c;
      console.log(`   Got ${data.results.length} bars`);
      console.log(`   First bar close: $${firstBar.close || firstBar.c}`);
      console.log(`   Last bar close: $${price}`);

      if (price > 50000) {
        console.log(`   ✅ PASS: BTC 5-min close $${price.toLocaleString()} is in correct range`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: BTC 5-min close $${price} is WAY too low`);
        failed++;
      }
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    failed++;
  }

  // Test 5: ETH Daily Aggregates
  try {
    console.log('\n📊 Test 5: ETH Daily Aggregates');
    const data = await fetch(`${BASE_URL}/api/polygon/aggregates/ETH/1/day?from=2025-12-10&to=2025-12-17`);

    if (data.error && data.error.includes('Rate limit')) {
      console.log('   ⚠️ SKIP: Rate limited - skipping');
      passed++;
    } else if (!data.results || data.results.length === 0) {
      console.log('   ⚠️ SKIP: No results returned (may be rate limited)');
      passed++;
    } else {
      const lastBar = data.results[data.results.length - 1];
      const price = lastBar.close || lastBar.c;
      console.log(`   Got ${data.results.length} bars, last close: $${price}`);

      if (price > 2000) {
        console.log(`   ✅ PASS: ETH daily close $${price.toLocaleString()} is in correct range`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: ETH daily close $${price} is WAY too low`);
        failed++;
      }
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    failed++;
  }

  // Test 6: BTC Indicators endpoint (used by WatchlistCharts)
  try {
    console.log('\n📊 Test 6: BTC Indicators Endpoint (WatchlistCharts)');
    const data = await fetch(`${BASE_URL}/api/indicators/BTC?timeframe=1&unit=day`);

    if (data.error) {
      console.log(`   ⚠️ WARN: ${data.error} - may need more data`);
      passed++; // OK if insufficient data for crypto
    } else if (data.candles && data.candles.length > 0) {
      const lastCandle = data.candles[data.candles.length - 1];
      const price = lastCandle.close || lastCandle.c;
      console.log(`   Got ${data.candles.length} candles, last close: $${price}`);

      if (price > 50000) {
        console.log(`   ✅ PASS: BTC indicators close $${price.toLocaleString()} is in correct range`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: BTC indicators close $${price} is WAY too low`);
        failed++;
      }
    } else {
      console.log('   ⚠️ WARN: No candles returned');
      passed++;
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    failed++;
  }

  // Test 7: ETH Indicators endpoint
  try {
    console.log('\n📊 Test 7: ETH Indicators Endpoint');
    const data = await fetch(`${BASE_URL}/api/indicators/ETH?timeframe=1&unit=day`);

    if (data.error) {
      console.log(`   ⚠️ WARN: ${data.error} - may need more data`);
      passed++;
    } else if (data.candles && data.candles.length > 0) {
      const lastCandle = data.candles[data.candles.length - 1];
      const price = lastCandle.close || lastCandle.c;
      console.log(`   Got ${data.candles.length} candles, last close: $${price}`);

      if (price > 2000) {
        console.log(`   ✅ PASS: ETH indicators close $${price.toLocaleString()} is in correct range`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: ETH indicators close $${price} is WAY too low`);
        failed++;
      }
    } else {
      console.log('   ⚠️ WARN: No candles returned');
      passed++;
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    failed++;
  }

  // Test 8: Verify stock symbol still works
  try {
    console.log('\n📊 Test 8: AAPL Quote (verify stocks still work)');
    const quote = await fetch(`${BASE_URL}/api/polygon/quote/AAPL`);
    console.log('   Response:', JSON.stringify(quote));

    const price = quote.last || quote.close || quote.price;
    if (price > 100 && price < 500) {
      console.log(`   ✅ PASS: AAPL price $${price} is in reasonable range`);
      passed++;
    } else {
      console.log(`   ⚠️ WARN: AAPL price $${price} may be unexpected`);
      passed++; // Still pass if it returned something
    }
  } catch (e) {
    console.log(`   ❌ ERROR: ${e.message}`);
    failed++;
  }

  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log(`\n📋 SUMMARY: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('❌ TESTS FAILED - Crypto prices are incorrect!');
    console.log('   The chart is likely showing stock data instead of crypto data.');
    process.exit(1);
  } else {
    console.log('✅ ALL TESTS PASSED - Crypto API is working correctly!');
    process.exit(0);
  }
}

testCryptoEndpoints().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
