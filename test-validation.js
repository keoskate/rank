/**
 * TEST SCRIPT - Data Validation System
 *
 * Tests the multi-source validation system by:
 * 1. Fetching old (unvalidated) data
 * 2. Fetching new (validated) data
 * 3. Comparing the differences
 * 4. Showing confidence scores
 *
 * Run with: node test-validation.js
 */

const TEST_SYMBOLS = ['NVDA', 'AAPL', 'TSLA', 'MSFT'];

async function testValidation() {
  console.log('🧪 TESTING DATA VALIDATION SYSTEM\n');
  console.log('='.repeat(80));
  console.log('\n');

  // Dynamic import for ES modules
  const { getStockData, getValidatedStockData } = await import('./react-client/src/api/unifiedAPI.js');

  for (const symbol of TEST_SYMBOLS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 Testing ${symbol}`);
    console.log('='.repeat(80));

    try {
      // Fetch unvalidated data (old method)
      console.log(`\n1️⃣  Fetching UNVALIDATED data from primary source...`);
      const oldData = await getStockData(symbol);

      if (!oldData) {
        console.error(`❌ Failed to fetch old data for ${symbol}`);
        continue;
      }

      console.log(`   Price: $${oldData.price?.toFixed(2)}`);
      console.log(`   52W High: $${oldData.yearHigh?.toFixed(2)} ${oldData._dataQuality?.metrics?.yearHigh === 'estimated' ? '⚠️  ESTIMATED' : ''}`);
      console.log(`   Market Cap: $${(oldData.marketCap / 1000000000).toFixed(2)}B`);
      console.log(`   P/E Ratio: ${oldData.peRatio?.toFixed(2)} ${oldData._dataQuality?.metrics?.peRatio === 'estimated' ? '⚠️  ESTIMATED' : ''}`);
      console.log(`   Beta: ${oldData.beta?.toFixed(2)} ${oldData._dataQuality?.metrics?.beta === 'estimated' ? '⚠️  ESTIMATED' : ''}`);

      // Fetch validated data (new method)
      console.log(`\n2️⃣  Fetching VALIDATED data with multi-source verification...`);
      const newData = await getValidatedStockData(symbol);

      if (!newData) {
        console.error(`❌ Failed to fetch validated data for ${symbol}`);
        continue;
      }

      console.log(`   Price: $${newData.price?.toFixed(2)} (${newData._validation?.metrics?.price?.status})`);
      console.log(`   52W High: $${newData.yearHigh?.toFixed(2)} (${newData._validation?.metrics?.yearHigh?.status})`);
      console.log(`   Market Cap: $${(newData.marketCap / 1000000000).toFixed(2)}B (${newData._validation?.metrics?.marketCap?.status})`);
      console.log(`   P/E Ratio: ${newData.peRatio?.toFixed(2)} (${newData._validation?.metrics?.peRatio?.status})`);
      console.log(`   Beta: ${newData.beta?.toFixed(2)} (${newData._validation?.metrics?.beta?.status})`);

      // Show comparison
      console.log(`\n3️⃣  COMPARISON:`);
      console.log('   ────────────────────────────────────────────────────────');

      const priceDiff = newData.price - oldData.price;
      const pricePct = ((priceDiff / oldData.price) * 100).toFixed(2);
      console.log(`   Price:       ${oldData.price?.toFixed(2)} → ${newData.price?.toFixed(2)} (${pricePct > 0 ? '+' : ''}${pricePct}%)`);

      const yearHighDiff = newData.yearHigh - oldData.yearHigh;
      const yearHighPct = ((yearHighDiff / oldData.yearHigh) * 100).toFixed(2);
      console.log(`   52W High:    ${oldData.yearHigh?.toFixed(2)} → ${newData.yearHigh?.toFixed(2)} (${yearHighPct > 0 ? '+' : ''}${yearHighPct}%) ${Math.abs(yearHighPct) > 5 ? '🚨 BIG DIFFERENCE!' : ''}`);

      // Show validation details
      console.log(`\n4️⃣  VALIDATION DETAILS:`);
      console.log('   ────────────────────────────────────────────────────────');
      console.log(`   Overall Confidence: ${(newData._validation?.overallConfidence * 100).toFixed(1)}%`);
      console.log(`   Overall Status: ${newData._validation?.status}`);
      console.log(`   Verified Metrics: ${newData._validation?.verifiedMetrics}/${newData._validation?.totalMetrics}`);

      // Show individual metric confidence
      console.log(`\n   📊 Individual Metric Confidence:`);
      const metrics = newData._validation?.metrics || {};

      Object.entries(metrics).forEach(([key, value]) => {
        if (value.confidence !== undefined) {
          const confidencePct = (value.confidence * 100).toFixed(1);
          const icon = value.status === 'verified' ? '✅'
                     : value.status === 'acceptable' ? '🟡'
                     : value.status === 'single-source' ? '🔵'
                     : '🔴';
          const sources = value.sources?.join(', ') || 'none';
          console.log(`      ${icon} ${key.padEnd(15)} ${confidencePct}% (${sources})`);
        }
      });

      // Key findings
      console.log(`\n5️⃣  KEY FINDINGS:`);
      console.log('   ────────────────────────────────────────────────────────');

      if (Math.abs(yearHighPct) > 10) {
        console.log(`   🚨 52W High was ${Math.abs(yearHighPct).toFixed(1)}% wrong!`);
        console.log(`      Old: $${oldData.yearHigh?.toFixed(2)} (estimated/fake)`);
        console.log(`      New: $${newData.yearHigh?.toFixed(2)} (real from Yahoo Finance)`);
      } else if (Math.abs(yearHighPct) > 5) {
        console.log(`   ⚠️  52W High had ${Math.abs(yearHighPct).toFixed(1)}% deviation`);
      } else {
        console.log(`   ✅ 52W High was reasonably accurate (${Math.abs(yearHighPct).toFixed(1)}% difference)`);
      }

      if (newData._validation?.overallConfidence >= 0.95) {
        console.log(`   ✅ High confidence data (${(newData._validation.overallConfidence * 100).toFixed(1)}%)`);
      } else if (newData._validation?.overallConfidence >= 0.80) {
        console.log(`   🟡 Medium confidence data (${(newData._validation.overallConfidence * 100).toFixed(1)}%)`);
      } else {
        console.log(`   🔴 Low confidence data (${(newData._validation.overallConfidence * 100).toFixed(1)}%)`);
      }

    } catch (error) {
      console.error(`❌ Error testing ${symbol}:`, error.message);
      console.error(error.stack);
    }

    console.log('\n');
  }

  console.log('='.repeat(80));
  console.log('✅ VALIDATION TEST COMPLETE');
  console.log('='.repeat(80));
}

// Run the test
testValidation().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
