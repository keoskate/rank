// server/brokers/brokerSessionBridge.js
// Materializes broker .md files into running trading sessions, and reconciles
// changes (file added → start session, file deleted → stop session, file
// changed → updateConfig on existing session).
//
// Brokers live under a dedicated userId namespace so they don't collide with
// any pre-existing default_user sessions in data/ai-sessions.json.

const path = require('path');

const { loadAllBrokers, loadBroker, watchBrokers } = require('./brokerLoader');
const { brokerToSessionConfig, effectiveCapital } = require('./brokerSchema');
const { writeTokens } = require('./brokerWriter');
const { evaluateEdgeGate } = require('./tierPromotion');

const BROKER_USER_ID = 'brokers';

let _engine = null;
let _logger = null;
let _watcher = null;

function init({ engine, logger }) {
  _engine = engine;
  _logger = logger || console;
}

// Returns the projected session (for safe read-only API responses).
function _findBrokerSession(slug) {
  if (!_engine) return null;
  const all = _engine.getAllUserSessions(BROKER_USER_ID) || [];
  return all.find(s => s.config && s.config.brokerSlug === slug) || null;
}

// Returns the raw session view from the engine (which is itself a projection).
// `engine.getSession()` does not expose portfolio.cash directly — but the
// projection lists positions as an array which is enough for status reporting.
function _findRawBrokerSession(slug) {
  const projected = _findBrokerSession(slug);
  if (!projected) return null;
  return _engine.getSession(projected.sessionId);
}

// Resets a broker's portfolio to its configured starting capital. Delegates to
// the engine's resetSessionCapital (which mutates the real session) — only
// honored for simulated sessions.
function _applyCapitalToSession(sessionId, capital) {
  if (typeof _engine.resetSessionCapital === 'function') {
    const ok = _engine.resetSessionCapital(sessionId, capital);
    if (!ok) {
      _logger.error(
        `[bridge] resetSessionCapital refused for ${sessionId} (not simulated or missing)`
      );
    }
  }
}

async function _startSessionForBroker(broker, persona) {
  const config = brokerToSessionConfig(broker, persona);
  const result = _engine.startSession(BROKER_USER_ID, config);
  _applyCapitalToSession(result.sessionId, broker.capital);
  _logger.log(
    `[bridge] started session ${result.sessionId} for broker ${broker.slug}`
  );
  return result;
}

async function _stopSessionForBroker(slug, reason = 'broker file removed') {
  const session = _findBrokerSession(slug);
  if (!session) return null;
  try {
    _engine.stopSession(session.sessionId);
    _logger.log(
      `[bridge] stopped session ${session.sessionId} for broker ${slug} (${reason})`
    );
  } catch (err) {
    _logger.error(`[bridge] stopSession failed for ${slug}: ${err.message}`);
  }
  return session.sessionId;
}

async function _updateSessionForBroker(broker, persona) {
  const existing = _findBrokerSession(broker.slug);
  if (!existing) return _startSessionForBroker(broker, persona);
  const config = brokerToSessionConfig(broker, persona);
  if (typeof _engine.updateConfig === 'function') {
    try {
      _engine.updateConfig(existing.sessionId, config);
    } catch (err) {
      _logger.error(
        `[bridge] updateConfig failed for ${broker.slug}: ${err.message}`
      );
    }
  } else {
    // Fallback: mutate config in place
    Object.assign(existing.config, config);
  }
  // Honor capital from the broker config. The engine's getSession projection
  // exposes `initialValue` directly (the underlying session.portfolio is private).
  // If the broker's configured capital differs from what's stored, reset the
  // portfolio via the engine's resetSessionCapital mutator.
  if (typeof broker.capital === 'number') {
    const raw = _engine.getSession(existing.sessionId);
    if (!raw || raw.initialValue !== broker.capital) {
      _applyCapitalToSession(existing.sessionId, broker.capital);
    }
  }
  _logger.log(
    `[bridge] updated session ${existing.sessionId} for broker ${broker.slug}`
  );
  return existing;
}

/**
 * Reconciles every broker .md into a live session. Idempotent.
 * Reports a summary of what changed.
 */
async function syncBrokersToSessions() {
  if (!_engine)
    throw new Error('bridge not initialized — call init({engine}) first');
  const results = await loadAllBrokers();
  const summary = { loaded: 0, started: 0, updated: 0, errored: 0, errors: [] };
  for (const r of results) {
    if (r.errors && r.errors.length) {
      summary.errored++;
      summary.errors.push({ file: r.file, errors: r.errors });
      _logger.error(
        `[bridge] invalid broker ${path.basename(r.file)}: ${r.errors.join('; ')}`
      );
      continue;
    }
    if (!r.broker) continue;
    summary.loaded++;
    const existing = _findBrokerSession(r.broker.slug);
    if (existing) {
      await _updateSessionForBroker(r.broker, r.persona);
      summary.updated++;
    } else {
      await _startSessionForBroker(r.broker, r.persona);
      summary.started++;
    }
  }
  return summary;
}

/**
 * Returns the merged broker + live session state for /api/brokers.
 */
async function listBrokersWithSessionState() {
  const results = await loadAllBrokers();
  return results.map(r => {
    const broker = r.broker;
    if (!broker) return { file: r.file, errors: r.errors };
    const projection = _findBrokerSession(broker.slug);
    const raw = projection ? _engine.getSession(projection.sessionId) : null;
    return {
      slug: broker.slug,
      name: broker.name,
      tier: broker.tier,
      capital: broker.capital,
      strategy: broker.strategy,
      watchlist: broker.watchlist,
      regime: broker.regime,
      llm: broker.llm,
      session: projection
        ? {
            sessionId: projection.sessionId,
            status: projection.status,
            startTime: projection.startTime,
            portfolio: {
              cash: raw?.cash,
              initialValue: raw?.initialValue,
              positionsCount: raw?.positions?.length || 0,
            },
            stats: projection.stats,
            openPositions: projection.openPositions,
            regimeState: raw?.entropyRegimeState || raw?.regimeState || null,
            // Per-source realized edge (drives the sim→paper promotion gate).
            edge: raw ? evaluateEdgeGate(raw) : null,
          }
        : null,
    };
  });
}

/**
 * Starts watching agents/brokers/ for changes. Files added → start, deleted → stop,
 * changed → updateConfig. Self-mutation writes are debounced via writeTokens.
 */
function startWatcher() {
  if (_watcher) return _watcher;
  _watcher = watchBrokers(
    {
      onAdd: async file => {
        try {
          const r = await loadBroker(file);
          if (!r.broker) {
            _logger.error(
              `[bridge] add: invalid ${file}: ${r.errors.join('; ')}`
            );
            return;
          }
          await _startSessionForBroker(r.broker, r.persona);
        } catch (err) {
          _logger.error(`[bridge] onAdd failed: ${err.message}`);
        }
      },
      onChange: async file => {
        try {
          const r = await loadBroker(file);
          if (!r.broker) {
            _logger.error(
              `[bridge] change: invalid ${file}: ${r.errors.join('; ')}`
            );
            return;
          }
          await _updateSessionForBroker(r.broker, r.persona);
        } catch (err) {
          _logger.error(`[bridge] onChange failed: ${err.message}`);
        }
      },
      onUnlink: async file => {
        const slug = path.basename(file).replace(/\.md$/, '');
        await _stopSessionForBroker(slug, 'file removed');
      },
      onError: err => _logger.error(`[bridge] watcher error: ${err.message}`),
    },
    { writeTokens }
  );
  _logger.log('[bridge] watching agents/brokers/');
  return _watcher;
}

function stopWatcher() {
  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }
}

/**
 * Sum of paper allocations across all tier:paper brokers. Used to warn when
 * the population is oversubscribed relative to the Alpaca paper account's
 * buying power.
 */
async function summarizePaperAllocations() {
  const results = await loadAllBrokers();
  const paperBrokers = results
    .filter(r => r.broker && r.broker.tier === 'paper')
    .map(r => ({
      slug: r.broker.slug,
      paperAllocation: effectiveCapital(r.broker),
    }));
  const totalAllocated = paperBrokers.reduce(
    (sum, b) => sum + b.paperAllocation,
    0
  );
  return { totalAllocated, paperBrokers, brokerCount: paperBrokers.length };
}

module.exports = {
  BROKER_USER_ID,
  init,
  syncBrokersToSessions,
  listBrokersWithSessionState,
  summarizePaperAllocations,
  startWatcher,
  stopWatcher,
};
