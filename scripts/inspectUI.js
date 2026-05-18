#!/usr/bin/env node
/**
 * Playwright-powered UI inspector — CLI.
 *
 *   node scripts/inspectUI.js /command-center
 *   node scripts/inspectUI.js /scanner --viewport=1920x1080 --settleMs=4000
 *   node scripts/inspectUI.js http://localhost:8080/portfolio --headed
 *
 * Output: screenshot + JSON log under data/ui-inspect/, plus a one-line
 * stdout summary.
 */

const { inspectUrl } = require('../server/playwright/inspector');

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of args) {
  if (a.startsWith('--')) {
    const [k, ...v] = a.slice(2).split('=');
    flags[k] = v.length ? v.join('=') : true;
  } else {
    positional.push(a);
  }
}

const target = positional[0] || '/command-center';

(async () => {
  const report = await inspectUrl(target, {
    viewport: flags.viewport,
    settleMs: flags.settleMs ? parseInt(flags.settleMs, 10) : undefined,
    headed: !!flags.headed,
  });

  console.log(`URL:        ${report.url}`);
  console.log(`SCREENSHOT: ${report.screenshot}`);
  console.log(`LOG:        ${report.logPath}`);
  console.log(`Errors:     console=${report.consoleErrors.length}  page=${report.pageErrors.length}  network=${report.networkFailures.length}`);
  console.log(`Warnings:   console=${report.consoleWarnings.length}`);
  if (report.performanceMetrics) {
    console.log(`Timing:     DCL=${report.performanceMetrics.domContentLoaded}ms  load=${report.performanceMetrics.loadComplete}ms  FCP=${report.performanceMetrics.firstContentfulPaint?.toFixed(0)}ms`);
  }
  if (report.navError) console.log(`NavError:   ${report.navError}`);
})().catch(err => {
  console.error('inspectUI failed:', err.message);
  process.exit(1);
});
