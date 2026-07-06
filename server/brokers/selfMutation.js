// server/brokers/selfMutation.js
// The self-mutation loop. At each configured interval (intraday-5m, intraday-1h, eod):
//
//   1. Snapshot the broker's recent stats + tradingLog
//   2. Ask brokerLlm for an assessment + concrete proposals
//   3. Validate each proposal against an allow-list of mutable fields
//      and the broker schema (rejecting out-of-range values)
//   4. Apply via brokerWriter (atomic, auto-snapshots prior version)
//   5. Append personaNotes under "## Self-Improvement Notes"
//   6. Log everything to data/broker-ledger.json + broadcast a websocket event
//
// Safety:
//   - Immutable fields (slug, tier, capital, strategy) are never touched
//   - Per-broker llm.callBudget caps daily Claude calls
//   - Brokers with <20 closed trades are skipped (insufficient signal)

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const { loadAllBrokers } = require('./brokerLoader');
const { writeBroker } = require('./brokerWriter');
const { validateBroker } = require('./brokerSchema');
const brokerLlm = require('./brokerLlm');
const strategies = require('../strategies');

const LEDGER_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'data',
  'broker-ledger.json'
);

// Fields the LLM is allowed to mutate. Anything outside this set is rejected
// regardless of what the model proposes. Immutable: slug, tier, capital, strategy, name.
const MUTABLE_FIELDS = new Set([
  'risk.perTrade',
  'risk.maxDrawdown',
  'risk.sizing',
  'risk.kellyFraction',
  'risk.maxPositions',
  'risk.maxPositionSizePercent',
  'risk.maxPortfolioDrawdown',
  'risk.trimAtProfitPercent',
  'risk.trimFraction',
  'regime.enabled',
  // regime.entropyWindows omitted — array values aren't supported by the
  // structured-output schema in this version; the LLM proposes scalars only
  'regime.preferred',
  'regime.blockOnTransition',
  'regime.referenceSymbol',
  // 'llm.callBudget' deliberately NOT mutable — a broker must not be able to
  // raise its own LLM cost ceiling.
  'llm.role',
  'selfImprovement.intervals',
  'selfImprovement.fullAutonomy',
]);

// Semantic safety controls (distinct from the schema's hard bounds). The schema
// allows e.g. perTrade up to 0.10; these soft ceilings stop a broker talking
// itself to that extreme over nightly runs.
const MUTATION_CONFIDENCE_MIN = 0.6; // skip applying low-confidence batches
const MAX_APPLIED_PER_RUN = 3; // cap mutations applied in one pass
const MAX_STEP_FRACTION = 0.3; // reject numeric jumps > ±30% of current value
const SOFT_CEILINGS = {
  'risk.perTrade': 0.05,
  'risk.kellyFraction': 0.5,
  'risk.maxPositionSizePercent': 50,
  'risk.maxPositions': 10,
};

// Hard floor: brokers below this many closed trades get skipped — there's
// nothing for the LLM to learn from yet.
const MIN_CLOSED_TRADES = 20;

// In-process counter of LLM calls per (broker, UTC day). Caps cost.
const callCounters = new Map();

function _todayKey(slug) {
  return `${slug}|${new Date().toISOString().slice(0, 10)}`;
}

function _incrementCallCount(slug) {
  const k = _todayKey(slug);
  const next = (callCounters.get(k) || 0) + 1;
  callCounters.set(k, next);
  return next;
}

function _getCallCount(slug) {
  return callCounters.get(_todayKey(slug)) || 0;
}

function _setDeep(obj, fieldPath, value) {
  const parts = fieldPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function _getDeep(obj, fieldPath) {
  return fieldPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

async function _appendLedger(event) {
  let ledger = { events: [] };
  if (fsSync.existsSync(LEDGER_PATH)) {
    try {
      const raw = await fs.readFile(LEDGER_PATH, 'utf8');
      ledger = JSON.parse(raw);
      if (!Array.isArray(ledger.events)) ledger.events = [];
    } catch {
      // corrupted/missing — start fresh
    }
  }
  ledger.events.push({ ...event, timestamp: new Date().toISOString() });
  if (ledger.events.length > 1000) {
    ledger.events = ledger.events.slice(-1000);
  }
  await fs.mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  const tmp = `${LEDGER_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2));
  await fs.rename(tmp, LEDGER_PATH);
}

function _summarizeSession(session) {
  const stats = session?.stats || {};
  const tradingLog = session?.tradingLog || [];
  const closedTrades = tradingLog.filter(
    t => t && t.side === 'sell' && typeof t.realizedPnL === 'number'
  );
  // Aggregate per-symbol so the LLM can see which names work and which don't
  const bySymbol = {};
  for (const t of closedTrades) {
    const sym = t.symbol || '?';
    if (!bySymbol[sym]) {
      bySymbol[sym] = { trades: 0, wins: 0, totalPnL: 0 };
    }
    bySymbol[sym].trades++;
    if (t.realizedPnL >= 0) bySymbol[sym].wins++;
    bySymbol[sym].totalPnL += t.realizedPnL;
  }
  for (const sym of Object.keys(bySymbol)) {
    const s = bySymbol[sym];
    s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
    s.totalPnL = Number(s.totalPnL.toFixed(2));
  }
  return {
    summary: {
      totalTrades: stats.totalTrades || 0,
      wins: stats.wins || 0,
      losses: stats.losses || 0,
      winRate: stats.winRate || 0,
      totalPnL: Number((stats.totalPnL || 0).toFixed(2)),
      unrealizedPnL: Number((stats.unrealizedPnL || 0).toFixed(2)),
      peakValue: Math.round(stats.peakValue || 0),
      maxDrawdownPct: Number((stats.maxDrawdown || 0).toFixed(2)),
      consecutiveLosses: stats.consecutiveLosses || 0,
      closedTradesCount: closedTrades.length,
      bySymbol,
    },
    recentTrades: tradingLog.slice(-50),
  };
}

/**
 * Splice persona notes under the "## Self-Improvement Notes" heading, creating
 * the section if it doesn't exist. Each note is dated and prefixed as a bullet.
 */
function _appendPersonaNotes(persona, notes) {
  if (!notes || notes.length === 0) return persona;
  const stamp = new Date().toISOString().slice(0, 10);
  // Claude often includes its own "YYYY-MM-DD:" prefix because the persona
  // body shows past notes in that shape. Strip a leading ISO date so we don't
  // double-stamp ("2026-05-21: 2026-05-21: ...").
  const stripLeadingDate = s => s.replace(/^\s*\d{4}-\d{2}-\d{2}\s*:\s*/, '');
  // Sanitize: the persona body is fed back verbatim into the system prompt, so
  // a note must not be able to inject a fake markdown heading or multi-line
  // instructions to its future self. Flatten newlines, strip leading '#'
  // markers, collapse whitespace, and hard-cap length.
  const sanitize = s =>
    String(s)
      .replace(/[\r\n]+/g, ' ')
      .replace(/^[\s#>*-]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 280);
  const block = notes
    .map(n => `- ${stamp}: ${sanitize(stripLeadingDate(n))}`)
    .filter(line => line.length > `- ${stamp}: `.length)
    .join('\n');
  if (!block) return persona;
  if (/^##\s+Self-Improvement Notes\b/m.test(persona)) {
    // Insert the block right after the heading line
    return persona.replace(
      /(^##\s+Self-Improvement Notes[^\n]*\n)/m,
      `$1\n${block}\n`
    );
  }
  return `${persona.trimEnd()}\n\n## Self-Improvement Notes\n\n${block}\n`;
}

/**
 * Apply one broker's self-mutation pass. Returns { ok, applied, rejected,
 * proposals, usage, reason }.
 *
 * Pure function in the sense that it gets all its inputs as args — caller
 * does the session lookup.
 */
async function mutateBroker(
  { broker, persona, session, regimeContext },
  opts = {}
) {
  const dryRun = !!opts.dryRun;
  const callBudget = broker.llm?.callBudget ?? 50;
  const callsToday = _getCallCount(broker.slug);
  if (callsToday >= callBudget) {
    tradingLogger.logInfo(
      `[SelfMutation] ${broker.slug} at llm.callBudget (${callBudget}) — skipping`,
      { sessionId: session?.sessionId, sessionName: session?.name }
    );
    return { ok: false, reason: 'budget_exhausted', callsToday };
  }

  const { summary, recentTrades } = _summarizeSession(session);

  if (summary.closedTradesCount < MIN_CLOSED_TRADES) {
    return {
      ok: false,
      reason: 'insufficient_history',
      closedTradesCount: summary.closedTradesCount,
      threshold: MIN_CLOSED_TRADES,
    };
  }

  // Reserve the call before firing so a crash mid-call still counts.
  _incrementCallCount(broker.slug);

  let llmResult;
  try {
    llmResult = await brokerLlm.analyzeBroker({
      broker,
      persona,
      statsSummary: summary,
      recentTrades,
      regimeContext,
    });
  } catch (err) {
    await _appendLedger({
      slug: broker.slug,
      action: 'self-mutation-error',
      error: err.message,
    });
    return { ok: false, reason: 'llm_error', error: err.message };
  }

  const { parsed, usage } = llmResult;
  tradingLogger.logInfo(
    `[SelfMutation] ${broker.slug} — ${parsed.proposals?.length || 0} proposals, ` +
      `confidence=${(parsed.confidence ?? 0).toFixed(2)}, ` +
      `tokens=${usage.input}/${usage.output} cache=${usage.cacheRead}`,
    { sessionId: session?.sessionId, sessionName: session?.name }
  );

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      applied: [],
      rejected: [],
      proposals: parsed,
      usage,
    };
  }

  // Apply proposals: validate each against allow-list + full-schema validation.
  // Deep-clone the broker so a rejected mutation doesn't poison the next one.
  const next = JSON.parse(JSON.stringify(broker));
  const applied = [];
  const rejected = [];

  // Confidence gate: a batch the model isn't confident in is logged but not
  // applied. (confidence is collected per analysis; previously ignored.)
  const confidence =
    typeof parsed.confidence === 'number' ? parsed.confidence : 1;
  const lowConfidence = confidence < MUTATION_CONFIDENCE_MIN;

  // Allow-list = global mutable fields ∪ the broker's strategy-plugin fields.
  // Each plugin declares which of its own config knobs the LLM may tune.
  const pluginFields = strategies.resolve(broker)?.mutableFields || [];
  const allowedFields = new Set([...MUTABLE_FIELDS, ...pluginFields]);

  for (const prop of parsed.proposals || []) {
    if (lowConfidence) {
      rejected.push({
        ...prop,
        reason: `low confidence ${confidence.toFixed(2)} < ${MUTATION_CONFIDENCE_MIN}`,
      });
      continue;
    }
    if (applied.length >= MAX_APPLIED_PER_RUN) {
      rejected.push({
        ...prop,
        reason: `per-run cap (${MAX_APPLIED_PER_RUN}) reached`,
      });
      continue;
    }
    if (!allowedFields.has(prop.field)) {
      rejected.push({ ...prop, reason: 'field is immutable' });
      continue;
    }
    const before = _getDeep(next, prop.field);
    // Velocity cap: reject numeric jumps larger than ±30% of the current value
    // (stops a broker ratcheting a knob to its schema extreme in one step).
    if (
      typeof before === 'number' &&
      typeof prop.proposedValue === 'number' &&
      before !== 0 &&
      Math.abs(prop.proposedValue - before) / Math.abs(before) >
        MAX_STEP_FRACTION
    ) {
      rejected.push({
        ...prop,
        reason: `step > ±${MAX_STEP_FRACTION * 100}% of current (${before})`,
      });
      continue;
    }
    // Soft operational ceiling (tighter than the schema's hard bound).
    if (
      SOFT_CEILINGS[prop.field] != null &&
      typeof prop.proposedValue === 'number' &&
      prop.proposedValue > SOFT_CEILINGS[prop.field]
    ) {
      rejected.push({
        ...prop,
        reason: `exceeds soft ceiling ${SOFT_CEILINGS[prop.field]}`,
      });
      continue;
    }
    _setDeep(next, prop.field, prop.proposedValue);
    const v = validateBroker(next, `${broker.slug}.md`);
    if (!v.broker) {
      _setDeep(next, prop.field, before); // revert
      rejected.push({ ...prop, reason: `validation: ${v.errors.join('; ')}` });
      continue;
    }
    applied.push({ ...prop, before });
  }

  const newPersona = _appendPersonaNotes(persona, parsed.personaNotes);
  const personaChanged = newPersona !== persona;

  // Write back if anything actually changed. brokerWriter snapshots the prior
  // version automatically, so this is rollback-safe.
  if (applied.length > 0 || personaChanged) {
    const finalBroker = validateBroker(next, `${broker.slug}.md`).broker;
    await writeBroker(broker.slug, finalBroker, newPersona);
  }

  await _appendLedger({
    slug: broker.slug,
    action: 'self-mutation',
    applied,
    rejected,
    personaNotesAdded: parsed.personaNotes?.length || 0,
    assessment: parsed.assessment,
    confidence: parsed.confidence,
    usage,
  });

  try {
    if (typeof websocketServer.broadcastToAll === 'function') {
      websocketServer.broadcastToAll('broker_self_mutation', {
        slug: broker.slug,
        appliedCount: applied.length,
        rejectedCount: rejected.length,
        confidence: parsed.confidence,
      });
    }
  } catch {
    // Best-effort broadcast
  }

  return { ok: true, applied, rejected, proposals: parsed, usage };
}

/**
 * Run self-mutation for every broker whose selfImprovement.intervals includes
 * the given interval. Used by both the daily cron and manual API trigger.
 */
async function runAllSelfMutations({ engine, interval = 'eod' }, opts = {}) {
  const brokers = await loadAllBrokers();
  const summary = {
    interval,
    evaluated: 0,
    skipped: 0,
    mutated: 0,
    errors: 0,
    results: [],
  };
  for (const r of brokers) {
    if (!r.broker) continue;
    const intervals = r.broker.selfImprovement?.intervals || [];
    if (!intervals.includes(interval)) {
      summary.skipped++;
      continue;
    }
    const all = engine.getAllUserSessions('brokers') || [];
    const proj = all.find(s => s.config?.brokerSlug === r.broker.slug);
    const session = proj ? engine.getSession(proj.sessionId) : null;
    if (!session) {
      summary.skipped++;
      continue;
    }
    summary.evaluated++;
    const result = await mutateBroker(
      { broker: r.broker, persona: r.persona, session },
      opts
    );
    if (result.error) summary.errors++;
    if (result.applied?.length > 0) summary.mutated++;
    summary.results.push({ slug: r.broker.slug, ...result });
  }
  return summary;
}

module.exports = {
  mutateBroker,
  runAllSelfMutations,
  MUTABLE_FIELDS,
  MIN_CLOSED_TRADES,
};
