#!/usr/bin/env node
// scripts/hire-broker.js — interactive CLI to write a new broker .md.
// Usage: node scripts/hire-broker.js [--slug <slug>] [--from <template>] [--non-interactive]

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');

const {
  validateBroker,
  BROKER_DEFAULTS,
  ALLOWED_STRATEGIES,
  ALLOWED_TIERS,
} = require('../server/brokers/brokerSchema');
const { writeBroker, brokerPath } = require('../server/brokers/brokerWriter');

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'agents', 'templates');
const PERSONAS_DIR = path.join(TEMPLATES_DIR, 'personas');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val =
        argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function prompt(rl, q, def) {
  return new Promise(resolve => {
    const suffix = def !== undefined && def !== '' ? ` [${def}]` : '';
    rl.question(`${q}${suffix}: `, ans =>
      resolve(ans.trim() || (def === undefined ? '' : String(def)))
    );
  });
}

async function listPersonas() {
  if (!fs.existsSync(PERSONAS_DIR)) return [];
  const entries = await fsp.readdir(PERSONAS_DIR);
  return entries
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

async function readTemplate(name) {
  const candidates = [
    path.join(PERSONAS_DIR, `${name}.md`),
    path.join(TEMPLATES_DIR, `${name}.md`),
    path.join(TEMPLATES_DIR, 'broker.md'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fsp.readFile(p, 'utf8');
  }
  throw new Error(`no template found: tried ${candidates.join(', ')}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const interactive = !args['non-interactive'];

  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const ask = (q, def) =>
    interactive ? prompt(rl, q, def) : Promise.resolve(def);

  console.log('\n=== Hiring a New Broker ===\n');
  const personas = await listPersonas();
  if (personas.length) {
    console.log(`Available persona templates: ${personas.join(', ')}`);
    console.log('(or press enter for blank broker.md template)\n');
  }

  const slug = (
    args.slug ||
    (await ask('Slug (lowercase-dashes)', '')) ||
    ''
  ).trim();
  if (!slug) {
    console.error('slug is required');
    process.exit(1);
  }
  if (fs.existsSync(brokerPath(slug))) {
    console.error(`broker already exists: ${brokerPath(slug)}`);
    process.exit(1);
  }

  const fromTemplate =
    args.from || (await ask('Template (blank for default)', personas[0] || ''));
  const name =
    (await ask(
      'Display name',
      slug
        .split('-')
        .map(w => w[0].toUpperCase() + w.slice(1))
        .join(' ')
    )) || slug;
  const tier =
    (await ask(`Tier (${ALLOWED_TIERS.join('|')})`, BROKER_DEFAULTS.tier)) ||
    BROKER_DEFAULTS.tier;
  const capital = Number(
    (await ask('Starting capital', BROKER_DEFAULTS.capital)) ||
      BROKER_DEFAULTS.capital
  );
  const watchlistRaw =
    (await ask('Watchlist (comma-separated)', 'SOXL,SOXS')) || 'SOXL,SOXS';
  const strategy =
    (await ask(
      `Strategy (${ALLOWED_STRATEGIES.join('|')})`,
      BROKER_DEFAULTS.strategy
    )) || BROKER_DEFAULTS.strategy;

  // Read template body to seed personality/philosophy
  let templateBody = '';
  try {
    const raw = await readTemplate(fromTemplate || 'broker');
    const idx = raw.indexOf('---', 3);
    templateBody = idx > 0 ? raw.slice(idx + 3).trim() : raw;
  } catch (err) {
    console.warn(`template warning: ${err.message}`);
  }

  const broker = {
    slug,
    name,
    tier,
    capital,
    watchlist: watchlistRaw
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean),
    strategy,
    risk: { ...BROKER_DEFAULTS.risk },
    regime: { ...BROKER_DEFAULTS.regime },
    llm: { ...BROKER_DEFAULTS.llm },
    selfImprovement: { ...BROKER_DEFAULTS.selfImprovement },
  };

  const result = validateBroker(broker, `${slug}.md`);
  if (result.errors.length > 0) {
    console.error('\nValidation failed:');
    result.errors.forEach(e => console.error(`  - ${e}`));
    if (rl) rl.close();
    process.exit(1);
  }

  const { file, snapshot } = await writeBroker(
    slug,
    result.broker,
    templateBody,
    { skipSnapshot: true }
  );

  console.log(`\n✓ Hired: ${file}`);
  if (snapshot) console.log(`  snapshot: ${snapshot}`);
  console.log(
    `\nNext: start the server (npm run server-dev) — the bridge will spin up a session.`
  );
  console.log(`Then: npm run exchange — watch it trade.\n`);

  if (rl) rl.close();
}

main().catch(err => {
  console.error('hire-broker failed:', err);
  process.exit(1);
});
