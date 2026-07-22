/**
 * Strategy Plugin Registry
 *
 * Maps a plugin slug → strategy module. Each plugin owns its own entry-signal
 * generation and returns the shared decision object via
 *   evaluate(session, symbol, ctx) => decisionObject
 *
 * signalEvaluator.evaluateEntry is a thin dispatcher that routes a session to
 * the right plugin via resolve(config). Phase 1 ships a single plugin
 * (technical-indicators); later phases register orthogonal sources
 * (options-flow, insider-following, unusual-volume, claude-judge).
 */

const technicalIndicators = require('./technicalIndicators');
const optionsFlow = require('./optionsFlow');
const insiderFollowing = require('./insiderFollowing');
const darkPool = require('./darkPool');
const trendFollowing = require('./trendFollowing');
const xsMomentum = require('./xsMomentum');
const volTargetMix = require('./volTargetMix');

const DEFAULT_SLUG = 'technical-indicators';

// slug → plugin module
const registry = {
  [technicalIndicators.slug]: technicalIndicators,
  [optionsFlow.slug]: optionsFlow,
  [insiderFollowing.slug]: insiderFollowing,
  [darkPool.slug]: darkPool,
  [trendFollowing.slug]: trendFollowing,
  [xsMomentum.slug]: xsMomentum,
  [volTargetMix.slug]: volTargetMix,
};

// Frontmatter `strategy` value → plugin slug. Strategy values not listed here
// (momentum-breakout, mean-reversion, balanced, …) fall through to the default
// technical-indicators plugin. This lets a broker pick its signal source with a
// single frontmatter field.
const PLUGIN_BY_STRATEGY = {
  'options-flow': 'options-flow',
  'insider-following': 'insider-following',
  'dark-pool': 'dark-pool',
  'trend-following': 'trend-following',
  'cross-sectional-momentum': 'cross-sectional-momentum',
  'vol-target-mix': 'vol-target-mix',
};

/**
 * Look up a plugin by slug. Returns undefined if not registered.
 * @param {string} slug
 * @returns {object|undefined}
 */
function get(slug) {
  return registry[slug];
}

/**
 * Resolve the strategy plugin for a session config.
 *
 * Phase 1: every legacy entryStrategy value (dip/momentum/balanced/…) maps to
 * the technical-indicators plugin. A future strategyPlugin field on the config
 * takes precedence once additional plugins exist.
 *
 * @param {object} config - session.config
 * @returns {object} a strategy plugin (always falls back to the default)
 */
function resolve(config = {}) {
  // 1) explicit plugin slug (session config) wins
  const direct = config.strategyPlugin;
  if (direct && registry[direct]) return registry[direct];
  // 2) map from the frontmatter `strategy` (broker object) or `strategyKey`
  //    (session config copies broker.strategy → strategyKey)
  const viaStrategy =
    PLUGIN_BY_STRATEGY[config.strategy] ||
    PLUGIN_BY_STRATEGY[config.strategyKey];
  if (viaStrategy && registry[viaStrategy]) return registry[viaStrategy];
  // 3) default plugin
  return registry[DEFAULT_SLUG];
}

module.exports = { get, resolve, registry, DEFAULT_SLUG };
