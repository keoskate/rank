#!/usr/bin/env node
/**
 * Page health check — inspects all key pages, aggregates results,
 * produces a markdown summary + persists JSON report.
 *
 *   node scripts/pageHealthCheck.js
 *   node scripts/pageHealthCheck.js --pages=/scanner,/command-center
 */

const fs = require('fs');
const path = require('path');
const { inspectUrl, ARTIFACT_ROOT } = require('../server/playwright/inspector');

const DEFAULT_PAGES = ['/', '/portfolio', '/command-center', '/scanner'];

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter(a => a.startsWith('--')).map(a => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
const pages = flags.pages ? flags.pages.split(',') : DEFAULT_PAGES;

function statusFor(errs) {
  if (errs === 0) return '✅';
  if (errs <= 3) return '⚠️';
  return '❌';
}

(async () => {
  console.log(`Running health check across ${pages.length} pages…`);
  const reports = [];
  for (const p of pages) {
    process.stdout.write(`  ${p} … `);
    const start = Date.now();
    try {
      const r = await inspectUrl(p, { settleMs: 2500 });
      const elapsed = Date.now() - start;
      reports.push({ ...r, elapsedMs: elapsed });
      const errs = r.consoleErrors.length + r.pageErrors.length + r.networkFailures.length;
      console.log(`${statusFor(errs)}  (${elapsed}ms, ${errs} errors)`);
    } catch (err) {
      reports.push({ url: p, error: err.message });
      console.log(`❌ failed: ${err.message}`);
    }
  }

  // Aggregate report
  const totalConsoleErrors = reports.reduce((s, r) => s + (r.consoleErrors?.length || 0), 0);
  const totalPageErrors = reports.reduce((s, r) => s + (r.pageErrors?.length || 0), 0);
  const totalNetworkFailures = reports.reduce((s, r) => s + (r.networkFailures?.length || 0), 0);
  const summary = {
    generatedAt: new Date().toISOString(),
    pages: pages.length,
    totalConsoleErrors,
    totalPageErrors,
    totalNetworkFailures,
    reports,
  };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(ARTIFACT_ROOT, `health-report-${ts}.json`);
  const latestPath = path.join(ARTIFACT_ROOT, 'health-latest.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));

  // Markdown summary
  console.log('\n────────────────────────────────────────────────────────');
  console.log(' PAGE HEALTH SUMMARY');
  console.log('────────────────────────────────────────────────────────');
  for (const r of reports) {
    const errs = (r.consoleErrors?.length || 0) + (r.pageErrors?.length || 0) + (r.networkFailures?.length || 0);
    console.log(`${statusFor(errs)}  ${r.url || 'unknown'}`);
    if (r.consoleErrors?.length) {
      r.consoleErrors.slice(0, 2).forEach(e => console.log(`    console: ${e.text.slice(0, 100)}`));
    }
    if (r.pageErrors?.length) {
      r.pageErrors.slice(0, 2).forEach(e => console.log(`    page:    ${e.message.slice(0, 100)}`));
    }
    if (r.networkFailures?.length) {
      r.networkFailures.slice(0, 2).forEach(e => console.log(`    network: ${e.url.slice(0, 80)} (${e.failure})`));
    }
  }
  console.log('────────────────────────────────────────────────────────');
  console.log(`Totals: console=${totalConsoleErrors}  page=${totalPageErrors}  network=${totalNetworkFailures}`);
  console.log(`Report: ${reportPath}`);
})().catch(err => {
  console.error('Health check failed:', err.message);
  process.exit(1);
});
