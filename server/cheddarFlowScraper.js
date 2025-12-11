/**
 * CheddarFlow Scraper
 *
 * Scrapes options flow sentiment data from CheddarFlow website.
 * Uses Puppeteer to render the page and extract key metrics:
 * - Flow sentiment (Bullish/Bearish/Neutral)
 * - Put/Call ratio
 * - Call flow $ and volume
 * - Put flow $ and volume
 *
 * Note: This requires a CheddarFlow subscription to access the data.
 * The scraper will need to handle authentication if required.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Persistent cookie storage path
const COOKIE_FILE = path.join(__dirname, '../data/cheddarflow-cookies.json');

class CheddarFlowScraper {
  constructor(options = {}) {
    this.baseUrl = 'https://dash.cheddarflow.com';
    this.timeout = options.timeout || 30000;
    this.headless = options.headless !== false; // Default to headless
    this.browser = null;
    this.page = null;

    // Authentication options
    this.useExistingProfile = options.useExistingProfile || false;
    this.chromeProfilePath = options.chromeProfilePath || null;
    this.cookies = options.cookies || null;
    this.credentials = options.credentials || null; // { email, password }

    // Cache to avoid too many requests
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Load saved cookies from file
   */
  static loadSavedCookies() {
    try {
      if (fs.existsSync(COOKIE_FILE)) {
        const data = fs.readFileSync(COOKIE_FILE, 'utf8');
        const parsed = JSON.parse(data);
        // Check if cookies are less than 7 days old
        if (parsed.savedAt && Date.now() - parsed.savedAt < 7 * 24 * 60 * 60 * 1000) {
          console.log('[CheddarFlow] Loaded saved cookies from file');
          return parsed.cookies;
        }
        console.log('[CheddarFlow] Saved cookies expired');
      }
    } catch (error) {
      console.log('[CheddarFlow] No saved cookies found');
    }
    return null;
  }

  /**
   * Save cookies to file for reuse
   */
  static saveCookies(cookies) {
    try {
      const data = {
        savedAt: Date.now(),
        cookies: cookies,
      };
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2));
      console.log('[CheddarFlow] Saved cookies to file');
    } catch (error) {
      console.error('[CheddarFlow] Failed to save cookies:', error.message);
    }
  }

  /**
   * Get the default Chrome profile path for macOS
   */
  static getDefaultChromeProfilePath() {
    const os = require('os');
    const path = require('path');
    const homeDir = os.homedir();

    // macOS Chrome profile path
    return path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome');
  }

  /**
   * Initialize browser
   * @param {Object} options - Override constructor options
   */
  async init(options = {}) {
    if (this.browser) return;

    const useProfile = options.useExistingProfile ?? this.useExistingProfile;
    const profilePath = options.chromeProfilePath ?? this.chromeProfilePath;

    const launchOptions = {
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    };

    // Use existing Chrome profile if specified
    if (useProfile) {
      const chromePath = profilePath || CheddarFlowScraper.getDefaultChromeProfilePath();
      console.log(`[CheddarFlow] Using Chrome profile at: ${chromePath}`);
      launchOptions.userDataDir = chromePath;
      launchOptions.args.push('--profile-directory=Default');

      // Can't run headless with user data dir easily, and need to avoid conflicts
      // with running Chrome instance
      console.log('[CheddarFlow] Note: Using existing profile. Make sure Chrome is closed.');
    }

    try {
      this.browser = await puppeteer.launch(launchOptions);
      this.page = await this.browser.newPage();

      // Set viewport
      await this.page.setViewport({ width: 1920, height: 1080 });

      // Set user agent to avoid detection
      await this.page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Try to load and inject cookies in this priority:
      // 1. Cookies passed in options
      // 2. Saved cookies from file
      let cookiesToUse = this.cookies;
      if (!cookiesToUse || cookiesToUse.length === 0) {
        cookiesToUse = CheddarFlowScraper.loadSavedCookies();
      }

      if (cookiesToUse && cookiesToUse.length > 0) {
        console.log(`[CheddarFlow] Injecting ${cookiesToUse.length} cookies`);
        await this.page.setCookie(...cookiesToUse);
      }

      // Handle login if credentials provided (and no cookies)
      if (this.credentials && this.credentials.email && this.credentials.password) {
        const loginSuccess = await this.login(this.credentials.email, this.credentials.password);
        if (loginSuccess) {
          // Save cookies for future use
          const newCookies = await this.exportCookies();
          CheddarFlowScraper.saveCookies(newCookies);
        }
      }

    } catch (error) {
      console.error('[CheddarFlow] Failed to launch browser:', error.message);
      if (error.message.includes('user data directory is already in use')) {
        console.error('[CheddarFlow] Please close Chrome browser and try again.');
      }
      throw error;
    }
  }

  /**
   * Login to CheddarFlow with credentials (handles Auth0 flow)
   */
  async login(email, password) {
    console.log('[CheddarFlow] Attempting to login...');

    try {
      // Navigate to the dashboard which will redirect to Auth0 login
      await this.page.goto('https://dash.cheddarflow.com', {
        waitUntil: 'networkidle2',
        timeout: this.timeout,
      });

      // Check if we're on Auth0 login page
      const currentUrl = this.page.url();
      console.log('[CheddarFlow] Current URL:', currentUrl);

      if (!currentUrl.includes('auth.cheddarflow') && !currentUrl.includes('login')) {
        console.log('[CheddarFlow] Already logged in!');
        return true;
      }

      // Wait for Auth0 login form
      console.log('[CheddarFlow] Waiting for login form...');

      // Auth0 uses different selectors - try multiple
      const emailSelectors = [
        'input[name="username"]',
        'input[name="email"]',
        'input[type="email"]',
        'input#username',
        'input[inputmode="email"]',
      ];

      let emailInput = null;
      for (const selector of emailSelectors) {
        try {
          emailInput = await this.page.waitForSelector(selector, { timeout: 5000 });
          if (emailInput) {
            console.log(`[CheddarFlow] Found email input: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }

      if (!emailInput) {
        throw new Error('Could not find email input field');
      }

      // Clear and type email
      await emailInput.click({ clickCount: 3 }); // Select all
      await emailInput.type(email);
      console.log('[CheddarFlow] Entered email');

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find and fill password field
      const passwordSelectors = [
        'input[name="password"]',
        'input[type="password"]',
        'input#password',
      ];

      let passwordInput = null;
      for (const selector of passwordSelectors) {
        try {
          passwordInput = await this.page.waitForSelector(selector, { timeout: 5000 });
          if (passwordInput) {
            console.log(`[CheddarFlow] Found password input: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }

      if (!passwordInput) {
        throw new Error('Could not find password input field');
      }

      await passwordInput.type(password);
      console.log('[CheddarFlow] Entered password');

      // Small delay before clicking submit
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find and click submit button
      const submitSelectors = [
        'button[type="submit"]',
        'button[name="action"]',
        'button[data-action-button-primary="true"]',
        'button.c3a8c6928', // Auth0 specific class
      ];

      let clicked = false;
      for (const selector of submitSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            console.log(`[CheddarFlow] Clicking submit: ${selector}`);
            await button.click();
            clicked = true;
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }

      if (!clicked) {
        // Try pressing Enter as fallback
        console.log('[CheddarFlow] Pressing Enter to submit');
        await this.page.keyboard.press('Enter');
      }

      // Wait for navigation after login
      console.log('[CheddarFlow] Waiting for redirect after login...');
      await this.page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 30000
      }).catch(() => {
        // Navigation might not trigger if already on target page
        console.log('[CheddarFlow] Navigation wait timed out, checking URL...');
      });

      // Give it a moment to settle
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if login was successful
      const finalUrl = this.page.url();
      console.log('[CheddarFlow] Final URL:', finalUrl);

      if (finalUrl.includes('auth.cheddarflow') || finalUrl.includes('login')) {
        // Still on login page - check for error messages
        const errorText = await this.page.evaluate(() => {
          const errorEl = document.querySelector('[class*="error"], [class*="alert"], [role="alert"]');
          return errorEl ? errorEl.innerText : null;
        });

        if (errorText) {
          console.error('[CheddarFlow] Login error:', errorText);
        }
        throw new Error('Login failed - still on login page');
      }

      console.log('[CheddarFlow] Login successful!');
      return true;

    } catch (error) {
      console.error('[CheddarFlow] Login failed:', error.message);
      return false;
    }
  }

  /**
   * Export current cookies (useful for saving session)
   */
  async exportCookies() {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }
    return await this.page.cookies();
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Get cached data if available and not expired
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  /**
   * Set cache
   */
  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Scrape flow sentiment for a symbol on a specific date
   * @param {string} symbol - Stock symbol (e.g., 'QBTS')
   * @param {string} date - Date in YYYY-MM-DD format (defaults to today)
   */
  async getFlowSentiment(symbol, date = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const cacheKey = `${symbol}-${targetDate}`;

    // Check cache first
    const cached = this.getCached(cacheKey);
    if (cached) {
      console.log(`[CheddarFlow] Using cached data for ${symbol} on ${targetDate}`);
      return cached;
    }

    try {
      await this.init();

      const url = `${this.baseUrl}/historical-flow?from=${targetDate}&to=${targetDate}&symbol=${symbol.toUpperCase()}`;
      console.log(`[CheddarFlow] Fetching: ${url}`);

      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.timeout,
      });

      // Wait for the flow sentiment elements to load
      await this.page.waitForSelector('body', { timeout: 10000 });

      // Give extra time for dynamic content to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if redirected to login page
      const currentUrl = this.page.url();
      if (currentUrl.includes('login') || currentUrl.includes('auth.cheddarflow')) {
        console.log('[CheddarFlow] Session expired - redirected to login');
        // Clear invalid cookies
        try {
          const fs = require('fs');
          if (fs.existsSync(COOKIE_FILE)) {
            fs.unlinkSync(COOKIE_FILE);
            console.log('[CheddarFlow] Deleted expired cookies file');
          }
        } catch (e) {
          // Ignore
        }
        return {
          symbol: symbol.toUpperCase(),
          date: targetDate,
          error: 'Session expired. Please re-authenticate.',
          needsAuth: true,
          scraped: false,
        };
      }

      // Extract data from the page
      const flowData = await this.page.evaluate(() => {
        const result = {
          symbol: null,
          date: null,
          sentimentText: null,
          sentimentPercent: null, // The bullish/bearish percentage (green bar fill)
          putCallRatio: null,
          putCallRatioDisplay: null, // The circular indicator value (0.79 etc)
          callFlow: null,
          putFlow: null,
          callFlowPercent: null,
          putFlowPercent: null,
          callContracts: null,
          putContracts: null,
          totalPremium: null,
          scraped: true,
        };

        const allText = document.body.innerText;

        // Flow sentiment (Bullish/Bearish/Neutral)
        if (allText.includes('Flow sentiment')) {
          const sentimentMatch = allText.match(/Flow sentiment[\s\S]*?(Bullish|Bearish|Neutral)/i);
          if (sentimentMatch) {
            result.sentimentText = sentimentMatch[1];
          }
        }

        // Try to extract the sentiment percentage from the progress bar
        // Look for a progress bar or percentage near the sentiment
        const progressBars = document.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="bar"]');
        progressBars.forEach(bar => {
          const width = bar.style?.width;
          if (width && width.includes('%')) {
            const percent = parseFloat(width);
            if (percent > 0 && percent <= 100) {
              result.sentimentPercent = percent;
            }
          }
          // Also check aria-valuenow
          const ariaValue = bar.getAttribute('aria-valuenow');
          if (ariaValue) {
            result.sentimentPercent = parseFloat(ariaValue);
          }
        });

        // If no progress bar found, estimate from call flow percentage
        // Bullish sentiment correlates with higher call flow %
        if (!result.sentimentPercent && result.sentimentText) {
          // We'll calculate this after we have callFlowPercent
        }

        // Put to call ratio - get both the main value and the circular display value
        const putCallMatch = allText.match(/Put to call[\s\S]*?([\d.]+)/i);
        if (putCallMatch) {
          result.putCallRatio = parseFloat(putCallMatch[1]);
        }

        // Look for the circular indicator value (usually shows as 0.xx)
        const circleValues = allText.match(/Put to call[\s\S]*?([\d.]+)[\s\S]*?([\d.]+)/i);
        if (circleValues && circleValues[2]) {
          result.putCallRatioDisplay = parseFloat(circleValues[2]);
        }

        // Call flow value and dollar amount (e.g., "$549.8M")
        const callFlowSection = allText.match(/Call flow[\s\S]*?\$([\d.,]+)([KMB])?/i);
        if (callFlowSection) {
          let value = parseFloat(callFlowSection[1].replace(/,/g, ''));
          const multiplier = callFlowSection[2];
          if (multiplier === 'K') value *= 1000;
          else if (multiplier === 'M') value *= 1000000;
          else if (multiplier === 'B') value *= 1000000000;
          result.callFlow = value;
        }

        // Put flow value
        const putFlowSection = allText.match(/Put flow[\s\S]*?\$([\d.,]+)([KMB])?/i);
        if (putFlowSection) {
          let value = parseFloat(putFlowSection[1].replace(/,/g, ''));
          const multiplier = putFlowSection[2];
          if (multiplier === 'K') value *= 1000;
          else if (multiplier === 'M') value *= 1000000;
          else if (multiplier === 'B') value *= 1000000000;
          result.putFlow = value;
        }

        // Extract contracts and percentages
        // Format: "1,682,543" followed by "56.0%"
        const callDataMatch = allText.match(/Call flow[\s\S]*?([\d,]+)[\s\S]*?([\d.]+)%/i);
        if (callDataMatch) {
          result.callContracts = parseInt(callDataMatch[1].replace(/,/g, ''));
          result.callFlowPercent = parseFloat(callDataMatch[2]);
        }

        const putDataMatch = allText.match(/Put flow[\s\S]*?([\d,]+)[\s\S]*?([\d.]+)%/i);
        if (putDataMatch) {
          result.putContracts = parseInt(putDataMatch[1].replace(/,/g, ''));
          result.putFlowPercent = parseFloat(putDataMatch[2]);
        }

        // Calculate percentages if we have both flow values but not percentages
        if (result.callFlow && result.putFlow) {
          const total = result.callFlow + result.putFlow;
          if (!result.callFlowPercent) {
            result.callFlowPercent = (result.callFlow / total) * 100;
          }
          if (!result.putFlowPercent) {
            result.putFlowPercent = (result.putFlow / total) * 100;
          }
          result.totalPremium = total;
        }

        // Estimate sentiment percentage if not found from progress bar
        // Use call flow percentage as a proxy (higher calls = more bullish)
        if (!result.sentimentPercent && result.callFlowPercent) {
          // Map call flow % to sentiment %
          // 50% calls = neutral, >50% = bullish, <50% = bearish
          result.sentimentPercent = result.callFlowPercent;
        }

        return result;
      });

      flowData.symbol = symbol.toUpperCase();
      flowData.date = targetDate;
      flowData.timestamp = new Date().toISOString();

      // Cache the result
      this.setCache(cacheKey, flowData);

      console.log(`[CheddarFlow] Scraped data for ${symbol}:`, flowData);
      return flowData;

    } catch (error) {
      console.error(`[CheddarFlow] Error scraping ${symbol}:`, error.message);
      return {
        symbol: symbol.toUpperCase(),
        date: targetDate,
        error: error.message,
        scraped: false,
      };
    }
  }

  /**
   * Take a screenshot of the flow page for visual analysis
   * @param {string} symbol - Stock symbol
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {string} outputPath - Path to save screenshot
   */
  async takeScreenshot(symbol, date = null, outputPath = null) {
    const targetDate = date || new Date().toISOString().split('T')[0];

    try {
      await this.init();

      const url = `${this.baseUrl}/historical-flow?from=${targetDate}&to=${targetDate}&symbol=${symbol.toUpperCase()}`;
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.timeout,
      });

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      const screenshotPath = outputPath || `./data/cheddarflow-${symbol}-${targetDate}.png`;
      await this.page.screenshot({
        path: screenshotPath,
        fullPage: false,
      });

      console.log(`[CheddarFlow] Screenshot saved to ${screenshotPath}`);
      return screenshotPath;

    } catch (error) {
      console.error(`[CheddarFlow] Screenshot error for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get flow sentiment summary (quick analysis)
   */
  analyzeSentiment(flowData) {
    if (!flowData || flowData.error || !flowData.scraped) {
      return {
        sentiment: 'unknown',
        confidence: 0,
        reason: flowData?.error || 'No data available',
      };
    }

    let sentiment = 'neutral';
    let confidence = 50;
    const reasons = [];

    // Primary: Use sentiment text if available
    if (flowData.sentimentText) {
      const text = flowData.sentimentText.toLowerCase();
      if (text.includes('bullish')) {
        sentiment = 'bullish';
        confidence = 70;
        reasons.push(`CheddarFlow shows: ${flowData.sentimentText}`);
      } else if (text.includes('bearish')) {
        sentiment = 'bearish';
        confidence = 70;
        reasons.push(`CheddarFlow shows: ${flowData.sentimentText}`);
      }
    }

    // Secondary: Put/Call ratio
    if (flowData.putCallRatio !== null) {
      if (flowData.putCallRatio < 0.3) {
        if (sentiment !== 'bearish') sentiment = 'bullish';
        confidence += 15;
        reasons.push(`Very low P/C ratio (${flowData.putCallRatio.toFixed(2)}) = strong bullish`);
      } else if (flowData.putCallRatio < 0.5) {
        if (sentiment !== 'bearish') sentiment = 'bullish';
        confidence += 10;
        reasons.push(`Low P/C ratio (${flowData.putCallRatio.toFixed(2)}) = bullish`);
      } else if (flowData.putCallRatio > 1.5) {
        if (sentiment !== 'bullish') sentiment = 'bearish';
        confidence += 15;
        reasons.push(`High P/C ratio (${flowData.putCallRatio.toFixed(2)}) = strong bearish`);
      } else if (flowData.putCallRatio > 1.0) {
        if (sentiment !== 'bullish') sentiment = 'bearish';
        confidence += 10;
        reasons.push(`Elevated P/C ratio (${flowData.putCallRatio.toFixed(2)}) = bearish`);
      }
    }

    // Tertiary: Flow percentages
    if (flowData.callFlowPercent && flowData.callFlowPercent > 80) {
      confidence += 10;
      reasons.push(`${flowData.callFlowPercent.toFixed(0)}% call flow`);
    } else if (flowData.putFlowPercent && flowData.putFlowPercent > 60) {
      confidence += 10;
      reasons.push(`${flowData.putFlowPercent.toFixed(0)}% put flow`);
    }

    return {
      sentiment,
      confidence: Math.min(95, confidence),
      reasons,
      data: flowData,
    };
  }
}

module.exports = CheddarFlowScraper;
