#!/usr/bin/env node
// scripts/system-map.js
//
// Generates a self-contained HTML snapshot of the WHOLE trading system — every
// strategy, gate, signal, exit rule, eval verdict, and promotion rule — read
// live from source. Opens anywhere, offline. Re-run to refresh; keep old files
// to diff configs over time.
//
// Usage:
//   node scripts/system-map.js                 # write html + json to data/reports/
//   node scripts/system-map.js --no-live       # skip network fetches (pure config)
//   node scripts/system-map.js --snapshot      # also drop a dated copy for history
//   node scripts/system-map.js --open          # open the HTML in your browser (macOS)
//   node scripts/system-map.js --print         # print the manifest JSON to stdout
//
//   npm run system-map            (default)
//   npm run system-map -- --open  (pass flags after --)

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { buildManifest } = require('../server/systemManifest');
const { renderHtml } = require('./lib/renderSystemMap');

const args = process.argv.slice(2);
const has = f => args.includes(f);

const OUT_DIR = path.resolve(__dirname, '..', 'data', 'reports');

async function main() {
  const live = !has('--no-live');
  const manifest = await buildManifest({ live });

  if (has('--print')) {
    process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
    return;
  }

  const html = renderHtml(manifest);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const htmlPath = path.join(OUT_DIR, 'system-map.html');
  const jsonPath = path.join(OUT_DIR, 'system-map.json');
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));

  const written = [htmlPath, jsonPath];

  if (has('--snapshot')) {
    // Date-stamped copies for diffing over time. Uses the manifest timestamp
    // (Date.now() at build) so the filename matches the snapshot content.
    const day = manifest.meta.generatedAt.slice(0, 10);
    const snapHtml = path.join(OUT_DIR, `system-map-${day}.html`);
    const snapJson = path.join(OUT_DIR, `system-map-${day}.json`);
    fs.writeFileSync(snapHtml, html);
    fs.writeFileSync(snapJson, JSON.stringify(manifest, null, 2));
    written.push(snapHtml, snapJson);
  }

  console.log(
    `System Map generated (${live ? 'live' : 'offline'} · ${manifest.meta.brokerCount} brokers · git ${manifest.meta.gitSha || 'n/a'})`
  );
  for (const w of written)
    console.log('  → ' + path.relative(process.cwd(), w));

  if (has('--open')) {
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start'
          : 'xdg-open';
    execFile(opener, [htmlPath], err => {
      if (err) console.log(`  (could not auto-open: ${err.message})`);
    });
  }
}

main().catch(err => {
  console.error('system-map failed:', err.stack || err.message);
  process.exit(1);
});
