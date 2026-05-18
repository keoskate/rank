/**
 * Playwright-powered UI inspector.
 *
 * Single entry: `inspectUrl(target, opts)` →
 *   { url, screenshot, consoleErrors, pageErrors, networkFailures,
 *     performanceMetrics, elements, logPath, artifactDir }
 *
 * Designed to be driven from:
 *   - scripts/inspectUI.js (CLI)
 *   - scripts/pageHealthCheck.js (batch)
 *   - .claude/agents/ui-inspector.md (subagent via Bash)
 *
 * Playwright is preferred over Puppeteer here for: auto-waiting on
 * actions (no more --waitMs hacks), locator API, and the @playwright/test
 * runner if we want regression tests later. The inspector itself doesn't
 * use the runner — it's a plain Node module.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
  ARTIFACT_ROOT,
  ensureArtifactDir,
  slugForUrl,
  resolveUrl,
  parseViewport,
} = require('./helpers');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_SETTLE_MS = 2000;

/**
 * Inspect a URL and return a structured report.
 *
 * @param {string} target - path (starts with /) or absolute URL
 * @param {object} opts
 *   @param {string} opts.viewport - "WxH" e.g. "1920x1080"
 *   @param {number} opts.settleMs - extra ms to wait after networkidle
 *   @param {number} opts.timeoutMs - navigation timeout
 *   @param {string} opts.baseUrl - default http://localhost:8080
 *   @param {boolean} opts.headed - show browser (debug only)
 *   @param {Object<string, string>} opts.elements - { name: cssSelector } map
 *     If provided, each selector is queried and the resulting text +
 *     existence flag are included in the report.
 *   @param {Array} opts.actions - sequence of [{ type, ...args }]:
 *     - { type: 'click', selector }
 *     - { type: 'fill', selector, text }
 *     - { type: 'wait', selector }
 *     - { type: 'waitMs', ms }
 *     Actions run between navigation and screenshot.
 *   @param {boolean} opts.fullPage - default true
 */
async function inspectUrl(target, opts = {}) {
  const url = resolveUrl(target, opts.baseUrl);
  const viewport = parseViewport(opts.viewport);
  const settleMs = opts.settleMs ?? DEFAULT_SETTLE_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fullPage = opts.fullPage !== false;

  ensureArtifactDir();
  const slug = slugForUrl(url) + '_' + Date.now();
  const screenshotPath = path.join(ARTIFACT_ROOT, `${slug}.png`);
  const logPath = path.join(ARTIFACT_ROOT, `${slug}.log.json`);

  const browser = await chromium.launch({
    headless: !opts.headed,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const consoleMessages = [];
  const pageErrors = [];
  const networkFailures = [];

  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => pageErrors.push({ message: err.message, stack: err.stack }));
  page.on('requestfailed', req => networkFailures.push({
    url: req.url(),
    method: req.method(),
    failure: req.failure()?.errorText,
  }));

  let navError = null;
  let performanceMetrics = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
  } catch (err) {
    navError = err.message;
  }

  // Optional actions (click, fill, wait)
  if (Array.isArray(opts.actions)) {
    for (const action of opts.actions) {
      try {
        if (action.type === 'click') await page.click(action.selector);
        else if (action.type === 'fill') await page.fill(action.selector, action.text);
        else if (action.type === 'wait') await page.waitForSelector(action.selector, { timeout: timeoutMs });
        else if (action.type === 'waitMs') await page.waitForTimeout(action.ms);
      } catch (err) {
        pageErrors.push({ message: `action ${action.type} failed: ${err.message}` });
      }
    }
  }

  // Settle pass — gives React time to fully paint after networkidle
  await page.waitForTimeout(settleMs);

  // Performance metrics
  try {
    const perf = await page.evaluate(() => {
      const t = performance.timing;
      return {
        domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
        loadComplete: t.loadEventEnd - t.navigationStart,
        firstPaint: performance.getEntriesByType('paint').find(p => p.name === 'first-paint')?.startTime || null,
        firstContentfulPaint: performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint')?.startTime || null,
      };
    });
    performanceMetrics = perf;
  } catch {
    performanceMetrics = null;
  }

  // Element queries
  let elements = null;
  if (opts.elements && typeof opts.elements === 'object') {
    elements = {};
    for (const [key, selector] of Object.entries(opts.elements)) {
      try {
        const el = await page.$(selector);
        if (!el) {
          elements[key] = { exists: false };
        } else {
          const text = (await el.innerText().catch(() => null))?.trim() || null;
          const visible = await el.isVisible().catch(() => null);
          elements[key] = { exists: true, text, visible };
        }
      } catch (err) {
        elements[key] = { exists: false, error: err.message };
      }
    }
  }

  await page.screenshot({ path: screenshotPath, fullPage });

  const consoleErrors = consoleMessages.filter(m => m.type === 'error');
  const consoleWarnings = consoleMessages.filter(m => m.type === 'warning');

  const report = {
    url,
    timestamp: new Date().toISOString(),
    viewport,
    settleMs,
    navError,
    screenshot: screenshotPath,
    logPath,
    consoleErrors,
    consoleWarnings,
    consoleAllCount: consoleMessages.length,
    pageErrors,
    networkFailures,
    performanceMetrics,
    elements,
  };

  fs.writeFileSync(logPath, JSON.stringify({ ...report, consoleMessages }, null, 2));

  await browser.close();
  return report;
}

module.exports = {
  inspectUrl,
  ARTIFACT_ROOT,
};
