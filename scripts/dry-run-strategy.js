#!/usr/bin/env node
/**
 * dry-run-strategy.js — run a strategy plugin's entry evaluation for a symbol
 * without touching the order path or persisting anything.
 *
 *   node scripts/dry-run-strategy.js <brokerSlug|pluginSlug> <SYMBOL>
 *
 * Examples:
 *   node scripts/dry-run-strategy.js momentum-maven SOXL
 *   node scripts/dry-run-strategy.js technical-indicators TQQQ
 *
 * The first arg is resolved as a broker .md (so the broker's real config drives
 * the evaluation); if no such broker exists, it's treated as a strategy plugin
 * slug applied over default config. Prints the decision object + signal funnel.
 *
 * IMPORTANT: AI_ENGINE_DRY_RUN is set before requiring the engine so it stays
 * inert — no session autostart, no trading loops, no disk writes.
 */

process.env.AI_ENGINE_DRY_RUN = '1';

const { loadAllBrokers } = require('../server/brokers/brokerLoader');
const { brokerToSessionConfig } = require('../server/brokers/brokerSchema');
const strategies = require('../server/strategies');
const engine = require('../server/aiTradingEngine');

async function main() {
  const [target, symbolArg] = process.argv.slice(2);

  if (!target || !symbolArg) {
    console.error(
      'Usage: node scripts/dry-run-strategy.js <brokerSlug|pluginSlug> <SYMBOL>'
    );
    process.exit(1);
  }
  const symbol = symbolArg.toUpperCase();

  // Try to resolve the target as a broker slug first.
  const brokers = await loadAllBrokers();
  const match = brokers.find(b => b.broker && b.broker.slug === target);

  let config;
  let label;
  if (match) {
    config = brokerToSessionConfig(match.broker, match.persona);
    label = `broker "${match.broker.slug}" (strategy=${match.broker.strategy}, entryStrategy=${config.entryStrategy})`;
  } else {
    // Treat target as a strategy plugin slug over default config.
    const plugin = strategies.get(target);
    if (!plugin) {
      const known = Object.keys(strategies.registry).join(', ');
      console.error(
        `No broker or plugin named "${target}". Known plugins: ${known}`
      );
      console.error(
        `Known brokers: ${brokers
          .filter(b => b.broker)
          .map(b => b.broker.slug)
          .join(', ')}`
      );
      process.exit(1);
    }
    config = {
      brokerSlug: target,
      strategyPlugin: target,
      watchlist: [symbol],
    };
    label = `plugin "${target}" over default config`;
  }

  const plugin = strategies.resolve(config);
  console.log(`\n▶ Dry-run: ${label}`);
  console.log(`  plugin: ${plugin.slug}  |  symbol: ${symbol}\n`);

  const { decision, funnel } = await engine.dryRunEntry(config, symbol);

  console.log('── Decision ──────────────────────────────');
  console.log(JSON.stringify(decision, null, 2));
  console.log('\n── Signal funnel ─────────────────────────');
  console.log(JSON.stringify(funnel, null, 2));
  console.log(
    `\n  source: ${decision.source || '(none)'}  |  shouldEnter: ${decision.shouldEnter}`
  );

  // Engine pulled in network clients; force a clean exit.
  process.exit(0);
}

main().catch(err => {
  console.error('Dry-run failed:', err);
  process.exit(1);
});
