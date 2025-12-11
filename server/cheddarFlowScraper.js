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
   * Login to CheddarFlow with credentials
   */
  async login(email, password) {
    console.log('[CheddarFlow] Attempting to login...');

    try {
      // Navigate to login page
      await this.page.goto('https://cheddarflow.com/login', {
        waitUntil: 'networkidle2',
        timeout: this.timeout,
      });

      // Wait for and fill email field
      await this.page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
      await this.page.type('input[type="email"], input[name="email"]', email);

      // Fill password field
      await this.page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 10000 });
      await this.page.type('input[type="password"], input[name="password"]', password);

      // Click login button
      await this.page.click('button[type="submit"]');

      // Wait for navigation
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });

      console.log('[CheddarFlow] Login successful');
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
          putCallRatio: null,
          callFlow: null,
          putFlow: null,
          callFlowPercent: null,
          putFlowPercent: null,
          callContracts: null,
          putContracts: null,
          totalPremium: null,
          scraped: true,
        };

        // Try to find sentiment text
        // Looking for elements that contain "Bullish", "Bearish", or "Neutral"
        const allText = document.body.innerText;

        // Flow sentiment
        if (allText.includes('Flow sentiment')) {
          const sentimentMatch = allText.match(/Flow sentiment[\s\S]*?(Bullish|Bearish|Neutral)/i);
          if (sentimentMatch) {
            result.sentimentText = sentimentMatch[1];
          }
        }

        // Put to call ratio
        const putCallMatch = allText.match(/Put to call[\s\S]*?([\d.]+)/i);
        if (putCallMatch) {
          result.putCallRatio = parseFloat(putCallMatch[1]);
        }

        // Call flow value (e.g., "$2.3M")
        const callFlowMatch = allText.match(/Call flow[\s\S]*?\$([\d.]+)([KMB])?/i);
        if (callFlowMatch) {
          let value = parseFloat(callFlowMatch[1]);
          const multiplier = callFlowMatch[2];
          if (multiplier === 'K') value *= 1000;
          else if (multiplier === 'M') value *= 1000000;
          else if (multiplier === 'B') value *= 1000000000;
          result.callFlow = value;
        }

        // Put flow value
        const putFlowMatch = allText.match(/Put flow[\s\S]*?\$([\d.]+)([KMB])?/i);
        if (putFlowMatch) {
          let value = parseFloat(putFlowMatch[1]);
          const multiplier = putFlowMatch[2];
          if (multiplier === 'K') value *= 1000;
          else if (multiplier === 'M') value *= 1000000;
          else if (multiplier === 'B') value *= 1000000000;
          result.putFlow = value;
        }

        // Call contracts and percentage (look for patterns like "8,728" with "95.6%")
        const callContractsMatch = allText.match(/Call flow[\s\S]*?([\d,]+)[\s\S]*?([\d.]+)%/i);
        if (callContractsMatch) {
          result.callContracts = parseInt(callContractsMatch[1].replace(/,/g, ''));
          result.callFlowPercent = parseFloat(callContractsMatch[2]);
        }

        // Put contracts and percentage
        const putContractsMatch = allText.match(/Put flow[\s\S]*?([\d,]+)[\s\S]*?([\d.]+)%/i);
        if (putContractsMatch) {
          result.putContracts = parseInt(putContractsMatch[1].replace(/,/g, ''));
          result.putFlowPercent = parseFloat(putContractsMatch[2]);
        }

        // Calculate percentages if we have both values
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
