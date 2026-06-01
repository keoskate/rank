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

const DEFAULT_SLUG = 'technical-indicators';

// slug → plugin module
const registry = {
  [technicalIndicators.slug]: technicalIndicators,
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
  const slug = config.strategyPlugin;
  if (slug && registry[slug]) return registry[slug];
  return registry[DEFAULT_SLUG];
}

module.exports = { get, resolve, registry, DEFAULT_SLUG };
