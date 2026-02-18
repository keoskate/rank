/**
 * CheddarFlow Authentication Test
 *
 * This script helps authenticate with CheddarFlow by using your existing Chrome profile.
 *
 * INSTRUCTIONS:
 * 1. CLOSE Google Chrome completely (all windows)
 * 2. Run: node tests/cheddarflowAuthTest.js
 * 3. A Chrome window will open - log into CheddarFlow manually
 * 4. Once logged in, the script will save cookies for future use
 *
 * After authentication, the CheddarFlow card should work with headless scraping.
 */

const CheddarFlowScraper = require('../server/cheddarFlowScraper');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const COOKIE_FILE = path.join(__dirname, '../data/cheddarflow-cookies.json');

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function runAuthTest() {
  console.log('='.repeat(60));
  console.log('CheddarFlow Authentication Test');
  console.log('='.repeat(60));

  // Check if Chrome is running
  console.log('\n⚠️  IMPORTANT: Close ALL Chrome windows before proceeding!');
  console.log('   This script needs to use your Chrome profile.\n');

  const answer = await prompt('Have you closed Chrome? (y/n): ');
  if (answer.toLowerCase() !== 'y') {
    console.log('Please close Chrome and try again.');
    process.exit(1);
  }

  const symbol = 'QBTS';
  const date = new Date().toISOString().split('T')[0];

  console.log(`\nWill test with: ${symbol} on ${date}`);

  // Create scraper with Chrome profile
  console.log('\n[1/4] Launching Chrome with your profile...');
  const scraper = new CheddarFlowScraper({
    headless: false, // Must be visible for manual login
    useExistingProfile: true, // Use your existing Chrome profile
    timeout: 120000, // 2 minutes for manual login
  });

  try {
    await scraper.init();
    console.log('Chrome launched successfully');

    // Navigate to CheddarFlow
    const url = `https://dash.cheddarflow.com/historical-flow?from=${date}&to=${date}&symbol=${symbol}`;
    console.log(`\n[2/4] Navigating to CheddarFlow...`);
    console.log(`URL: ${url}\n`);

    await scraper.page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // Check if we're on login page
    let currentUrl = scraper.page.url();
    console.log(`Current URL: ${currentUrl}`);

    if (currentUrl.includes('login') || currentUrl.includes('auth.cheddarflow')) {
      console.log('\n📋 You need to log in manually.');
      console.log('   1. Enter your CheddarFlow credentials in the browser');
      console.log('   2. Complete any 2FA if required');
      console.log('   3. Once you see the flow data, press Enter here\n');

      await prompt('Press Enter after logging in...');

      // Wait for navigation after login
      await new Promise(resolve => setTimeout(resolve, 3000));
      currentUrl = scraper.page.url();
      console.log(`After login URL: ${currentUrl}`);
    }

    // Check if login was successful
    if (currentUrl.includes('login') || currentUrl.includes('auth.cheddarflow')) {
      console.log('\n❌ Still on login page. Login may have failed.');
      console.log('Please try again.\n');
    } else {
      console.log('\n✅ Successfully authenticated!');

      // Save cookies
      console.log('\n[3/4] Saving session cookies...');
      const cookies = await scraper.exportCookies();
      CheddarFlowScraper.saveCookies(cookies);
      console.log(`Saved ${cookies.length} cookies to: ${COOKIE_FILE}`);

      // Try to scrape data
      console.log('\n[4/4] Testing data extraction...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const flowData = await scraper.page.evaluate(() => {
        const bodyText = document.body.innerText;
        return {
          hasSentiment: /Flow sentiment/i.test(bodyText),
          hasBullish: /Bullish/i.test(bodyText),
          hasBearish: /Bearish/i.test(bodyText),
          hasPutCall: /Put to call/i.test(bodyText),
          sample: bodyText.substring(0, 500),
        };
      });

      console.log('\n--- Page Content Check ---');
      console.log(`Has "Flow sentiment": ${flowData.hasSentiment ? '✅' : '❌'}`);
      console.log(`Has "Bullish/Bearish": ${flowData.hasBullish || flowData.hasBearish ? '✅' : '❌'}`);
      console.log(`Has "Put to call": ${flowData.hasPutCall ? '✅' : '❌'}`);

      if (flowData.hasSentiment || flowData.hasPutCall) {
        console.log('\n✅ CheddarFlow data is accessible!');
        console.log('The CheddarFlow card should now work with headless scraping.');
        console.log('\nTo test, restart the server and refresh the dashboard.');
      } else {
        console.log('\n⚠️  Could not find expected data on page.');
        console.log('The page might not have loaded fully, or the data format changed.');
        console.log('\nSample content:');
        console.log(flowData.sample);
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('user data directory is already in use')) {
      console.log('\nChrome is still running! Please close ALL Chrome windows and try again.');
    }
  } finally {
    console.log('\n' + '-'.repeat(60));
    const closeAnswer = await prompt('Close browser? (y/n): ');
    if (closeAnswer.toLowerCase() === 'y') {
      await scraper.close();
      console.log('Browser closed.');
    } else {
      console.log('Leaving browser open. Close it manually when done.');
    }
    console.log('Done.');
    process.exit(0);
  }
}

// Run
runAuthTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
