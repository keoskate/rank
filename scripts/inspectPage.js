#!/usr/bin/env node
/**
 * Quick page-inspector — load a URL, screenshot it, capture console errors.
 * Usage: node scripts/inspectPage.js <path-or-url> [--viewport=1920x1080] [--waitMs=2000]
 *
 * Defaults to http://localhost:8080 + path. Saves PNG + JSON log to /tmp/.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const argMap = Object.fromEntries(
  args.filter(a => a.startsWith('--')).map(a => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=') || true];
  })
);
const target = args.find(a => !a.startsWith('--')) || '/command-center';
const url = target.startsWith('http') ? target : `http://localhost:8080${target.startsWith('/') ? '' : '/'}${target}`;
const [w, h] = (argMap.viewport || '1440x900').split('x').map(Number);
const waitMs = parseInt(argMap.waitMs || '2500', 10);

const outDir = '/tmp/page-inspect';
fs.mkdirSync(outDir, { recursive: true });
const slug = url.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80);
const pngPath = path.join(outDir, `${slug}.png`);
const logPath = path.join(outDir, `${slug}.log.json`);

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });

  const messages = [];
  const errors = [];
  page.on('console', msg => messages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => errors.push({ message: err.message, stack: err.stack }));
  page.on('requestfailed', req => errors.push({ requestFailed: req.url(), failure: req.failure()?.errorText }));

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (err) {
    errors.push({ navigation: err.message });
  }

  // Give the page extra time to render React + finish polling cycle
  await new Promise(r => setTimeout(r, waitMs));

  await page.screenshot({ path: pngPath, fullPage: true });
  fs.writeFileSync(logPath, JSON.stringify({ url, viewport: { w, h }, waitMs, messages, errors }, null, 2));
  await browser.close();

  console.log(`SCREENSHOT: ${pngPath}`);
  console.log(`LOG:        ${logPath}`);
  console.log(`Errors:     ${errors.length}`);
  console.log(`Console:    ${messages.length} messages (${messages.filter(m => m.type === 'error').length} errors, ${messages.filter(m => m.type === 'warning').length} warnings)`);
})().catch(err => {
  console.error('Inspector failed:', err.message);
  process.exit(1);
});
