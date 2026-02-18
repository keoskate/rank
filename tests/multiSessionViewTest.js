/**
 * Multi-Session View Test
 *
 * Tests the multi-session trading viewer functionality.
 * Run with: node tests/multiSessionViewTest.js
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:8080';

async function runTest() {
  console.log('🧪 Multi-Session View Test\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // Step 1: Get a session ID from the API
    console.log('1. Fetching available sessions...');
    await page.goto(`${BASE_URL}/live-trading`, { waitUntil: 'networkidle2' });

    const sessionsResponse = await page.evaluate(async () => {
      const res = await fetch('/api/ai/sessions/default_user');
      return res.json();
    });

    const sessions = sessionsResponse.sessions || [];
    if (sessions.length === 0) {
      console.log('   ⚠️  No sessions available - creating test requires existing session');
      console.log('   Skipping multi-session test\n');
      await browser.close();
      return;
    }

    const testSessionId = sessions[0].sessionId;
    console.log(`   Found ${sessions.length} sessions, using: ${testSessionId.slice(0, 8)}...`);

    // Step 2: Navigate to session detail page
    console.log('\n2. Navigating to session detail page...');
    await page.goto(`${BASE_URL}/live-trading/${testSessionId}`, {
      waitUntil: 'networkidle2',
      timeout: 10000,
    });

    // Wait a bit for React to render
    await new Promise(r => setTimeout(r, 2000));

    // Step 3: Check if page loaded (not blank)
    console.log('\n3. Checking page content...');
    const bodyText = await page.evaluate(() => document.body.innerText);
    const bodyHTML = await page.evaluate(() => document.body.innerHTML);

    if (bodyText.includes('Loading session')) {
      console.log('   ⚠️  Page stuck on "Loading session..."');
      console.log('   This indicates the session fetch is not completing.');
    } else if (bodyText.trim().length < 50) {
      console.log('   ❌ Page appears blank or nearly empty');
      console.log(`   Body text length: ${bodyText.length}`);
      console.log(`   Body preview: "${bodyText.slice(0, 100)}"`);
    } else {
      console.log('   ✅ Page has content');
    }

    // Step 4: Check for tab bar
    console.log('\n4. Looking for session tab bar...');
    const hasTabBar = await page.evaluate(() => {
      // Look for elements that would indicate the tab bar
      const tabBarIndicators = [
        document.querySelector('[style*="borderBottom"]'), // Tab styling
        Array.from(document.querySelectorAll('div')).find(
          el => el.innerText && el.innerText.includes('×') && el.style.cursor === 'pointer'
        ),
      ];
      return tabBarIndicators.some(Boolean);
    });

    // Check for session name in content
    const sessionName = sessions[0].name || 'Unnamed';
    const hasSessionName = bodyText.includes(sessionName);

    console.log(`   Tab bar detected: ${hasTabBar ? '✅ Yes' : '❌ No'}`);
    console.log(`   Session name visible: ${hasSessionName ? '✅ Yes' : '❌ No'}`);

    // Step 5: Check for console errors
    console.log('\n5. Console errors:');
    if (consoleErrors.length === 0) {
      console.log('   ✅ No console errors');
    } else {
      consoleErrors.forEach(err => console.log(`   ❌ ${err}`));
    }

    // Take screenshot for debugging
    const screenshotPath = './tests/screenshots/multi-session-view.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\n📸 Screenshot saved to: ${screenshotPath}`);

    // Summary
    console.log('\n' + '='.repeat(50));
    const passed = bodyText.trim().length > 50 && !bodyText.includes('Loading session');
    if (passed) {
      console.log('✅ PASSED - Multi-session view loads correctly');
    } else {
      console.log('❌ FAILED - Multi-session view has issues');
    }

  } catch (error) {
    console.error('\n❌ Test error:', error.message);
  } finally {
    await browser.close();
  }
}

runTest();
