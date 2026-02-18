/**
 * CheddarFlow Debug Test
 *
 * Tests the CheddarFlow scraper to identify issues with data extraction.
 * Run with: node tests/cheddarflowDebugTest.js
 */

const CheddarFlowScraper = require('../server/cheddarFlowScraper');
const fs = require('fs');
const path = require('path');

async function runDebugTest() {
  console.log('='.repeat(60));
  console.log('CheddarFlow Debug Test');
  console.log('='.repeat(60));

  const symbol = process.argv[2] || 'QBTS';
  const date = process.argv[3] || new Date().toISOString().split('T')[0];

  console.log(`\nTesting symbol: ${symbol}`);
  console.log(`Date: ${date}`);
  console.log('');

  // Check for saved cookies
  const cookieFile = path.join(__dirname, '../data/cheddarflow-cookies.json');
  console.log(`Cookie file path: ${cookieFile}`);
  console.log(`Cookie file exists: ${fs.existsSync(cookieFile)}`);

  if (fs.existsSync(cookieFile)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
      console.log(`Cookies saved at: ${new Date(cookieData.savedAt).toISOString()}`);
      console.log(`Cookie count: ${cookieData.cookies?.length || 0}`);

      // Check cookie age
      const ageHours = (Date.now() - cookieData.savedAt) / (1000 * 60 * 60);
      console.log(`Cookie age: ${ageHours.toFixed(1)} hours`);
    } catch (e) {
      console.log(`Error reading cookie file: ${e.message}`);
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('Starting scraper test...');
  console.log('-'.repeat(60));

  // Create scraper instance
  const scraper = new CheddarFlowScraper({
    headless: false, // Run with visible browser for debugging
    useExistingProfile: false, // Don't use Chrome profile (avoids conflicts)
    timeout: 45000,
  });

  try {
    // Initialize browser
    console.log('\n[1/5] Initializing browser...');
    await scraper.init();
    console.log('Browser initialized successfully');

    // Get the page URL
    const url = `https://dash.cheddarflow.com/historical-flow?from=${date}&to=${date}&symbol=${symbol}`;
    console.log(`\n[2/5] Navigating to: ${url}`);

    // Navigate to page
    await scraper.page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });
    console.log('Page loaded');

    // Wait extra time for dynamic content
    console.log('\n[3/5] Waiting for dynamic content (5 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if we're redirected to login
    const currentUrl = scraper.page.url();
    console.log(`Current URL: ${currentUrl}`);

    if (currentUrl.includes('login') || currentUrl.includes('auth')) {
      console.log('\n⚠️  REDIRECTED TO LOGIN - Not authenticated!');
      console.log('You need to either:');
      console.log('  1. Use useProfile=true with Chrome closed');
      console.log('  2. Provide credentials via /api/cheddarflow/auth endpoint');
      console.log('  3. Manually login and save cookies');
    }

    // Take screenshot
    const screenshotPath = path.join(__dirname, `../data/cheddarflow-debug-${symbol}-${Date.now()}.png`);
    console.log(`\n[4/5] Taking screenshot: ${screenshotPath}`);
    await scraper.page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
    console.log('Screenshot saved');

    // Extract page content for debugging
    console.log('\n[5/5] Extracting page content...');
    const pageContent = await scraper.page.evaluate(() => {
      return {
        title: document.title,
        bodyText: document.body.innerText.substring(0, 5000),
        // Look for specific elements
        flowSentimentEl: document.querySelector('[data-testid="flow-sentiment"]')?.innerText || null,
        putCallEl: document.querySelector('[data-testid="put-call-ratio"]')?.innerText || null,
        // Get all h1, h2, h3 headings
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.innerText).slice(0, 10),
        // Get any elements with "flow" in class or id
        flowElements: Array.from(document.querySelectorAll('[class*="flow"], [id*="flow"]'))
          .map(el => ({ tag: el.tagName, text: el.innerText?.substring(0, 100) }))
          .slice(0, 10),
      };
    });

    console.log('\n--- Page Analysis ---');
    console.log(`Title: ${pageContent.title}`);
    console.log(`\nHeadings found: ${pageContent.headings.length}`);
    pageContent.headings.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

    console.log(`\nFlow-related elements: ${pageContent.flowElements.length}`);
    pageContent.flowElements.forEach((el, i) => {
      console.log(`  ${i + 1}. <${el.tag}> ${el.text?.substring(0, 50)}...`);
    });

    // Check for key text patterns in body
    console.log('\n--- Key Pattern Search ---');
    const bodyText = pageContent.bodyText;

    const patterns = [
      { name: 'Flow sentiment', pattern: /Flow sentiment/i },
      { name: 'Bullish', pattern: /Bullish/i },
      { name: 'Bearish', pattern: /Bearish/i },
      { name: 'Put to call', pattern: /Put to call/i },
      { name: 'Call flow', pattern: /Call flow/i },
      { name: 'Put flow', pattern: /Put flow/i },
      { name: 'Login', pattern: /Login|Sign in/i },
      { name: 'Subscribe', pattern: /Subscribe|Subscription/i },
    ];

    patterns.forEach(({ name, pattern }) => {
      const found = pattern.test(bodyText);
      console.log(`  ${found ? '✅' : '❌'} ${name}: ${found ? 'Found' : 'Not found'}`);
    });

    // Now try the actual scraper method
    console.log('\n--- Running getFlowSentiment() ---');
    const flowData = await scraper.getFlowSentiment(symbol, date);
    console.log('\nFlow data result:');
    console.log(JSON.stringify(flowData, null, 2));

    // Analyze sentiment
    console.log('\n--- Sentiment Analysis ---');
    const sentiment = scraper.analyzeSentiment(flowData);
    console.log(JSON.stringify(sentiment, null, 2));

    // Print first 1000 chars of body text for manual inspection
    console.log('\n--- Body Text Sample (first 1000 chars) ---');
    console.log(bodyText.substring(0, 1000));
    console.log('...');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  } finally {
    console.log('\n' + '-'.repeat(60));
    console.log('Closing browser...');
    await scraper.close();
    console.log('Done.');
  }
}

// Run the test
runDebugTest().catch(console.error);
