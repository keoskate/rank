// server/brokers/brokerLlm.js
// Per-broker Claude analyst: ingests a broker's persona + recent trade history,
// returns structured proposals for self-mutation.
//
// Design notes:
// - Prompt caching: the persona body and broker config are stable across calls
//   in a window, so they live in the system prompt with cache_control. Recent
//   trades (volatile) live in the user message after the breakpoint.
// - Adaptive thinking: trade-tape analysis is a reasoning task. Let Claude decide
//   thinking depth per call.
// - Structured output: JSON-schema-constrained so the proposal shape is stable
//   and the engine doesn't have to guess at field names.
// - Typed exceptions: we surface 429s and 401s explicitly so the caller can back off.

const Anthropic = require('@anthropic-ai/sdk');
const tradingLogger = require('../tradingLogger');

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set — broker LLM is unavailable');
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Default to current Sonnet. Brokers can override per-persona via llm.model.
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

// JSON Schema that constrains the structured proposal output. Engine code
// downstream (selfMutation) assumes this shape.
const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assessment: {
      type: 'string',
      description:
        'Honest one-paragraph take on how this broker is performing — speak in your own voice as the persona.',
    },
    proposals: {
      type: 'array',
      description:
        'Concrete frontmatter changes you want to make to yourself. Empty array = no changes.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          field: {
            type: 'string',
            description:
              'Dot-notation frontmatter path. Examples: risk.perTrade, risk.kellyFraction, regime.preferred, regime.blockOnTransition.',
          },
          currentValue: {
            type: ['string', 'number', 'boolean', 'null'],
            description: 'The current value (for reference; not validated).',
          },
          proposedValue: {
            type: ['string', 'number', 'boolean', 'null'],
            description:
              'The value you want to change it to. Scalars only — propose array/object changes one element at a time via a different mechanism.',
          },
          rationale: {
            type: 'string',
            description: 'Why this change, in 1-2 sentences.',
          },
        },
        required: ['field', 'proposedValue', 'rationale'],
      },
    },
    personaNotes: {
      type: 'array',
      description:
        'Short dated notes to append under "## Self-Improvement Notes" in your persona body. Voice should match your personality. Empty array if nothing to add.',
      items: { type: 'string' },
    },
    confidence: {
      type: 'number',
      description:
        'How confident you are in these proposals overall, between 0 and 1 (0 = guessing, 1 = certain). The engine clamps out-of-range values.',
    },
  },
  required: ['assessment', 'proposals', 'personaNotes', 'confidence'],
};

// System prompt is constructed once per (broker, persona) and is stable across
// calls — so it caches well. Keep volatile data out of here.
function buildSystemPrompt(broker, persona) {
  // Strip the {} bracket characters from JSON so they don't get confused as
  // template literals in any downstream display. Just informational.
  const configBlock = JSON.stringify(
    {
      slug: broker.slug,
      tier: broker.tier,
      capital: broker.capital,
      watchlist: broker.watchlist,
      strategy: broker.strategy,
      risk: broker.risk,
      regime: broker.regime,
      llm: broker.llm,
      selfImprovement: broker.selfImprovement,
    },
    null,
    2
  );

  return [
    '<role>',
    `You are ${broker.name}, an autonomous AI trading agent. The markdown below is your own persona —`,
    'your voice, your philosophy, your risk doctrine. When you respond, speak as yourself.',
    '</role>',
    '',
    '<your-persona>',
    persona,
    '</your-persona>',
    '',
    '<your-current-config>',
    configBlock,
    '</your-current-config>',
    '',
    '<task>',
    'You will be shown your recent trading activity. Your job:',
    '',
    "1. Honestly assess how you're doing.",
    '2. Propose specific, narrow changes to your own config that you believe will',
    '   improve your performance while staying true to your strategy and risk doctrine.',
    '3. Optionally append short dated notes to your "## Self-Improvement Notes" section.',
    '',
    'Rules:',
    '- Be honest. If your week was bad, say so. Do not rationalize losses.',
    '- Be conservative. Small adjustments beat big swings. Prefer 10-30% changes to any numeric value.',
    '- Respect your identity. Do not propose changes that would turn you into a different broker.',
    '  A momentum broker should not propose switching to mean reversion.',
    '- Acknowledge sample size. If you have fewer than 20 closed trades, your stats are noise.',
    '  In that case propose nothing and explain why in your assessment.',
    '- You may NOT touch these immutable fields: slug, tier, capital, strategy. The tier-promotion',
    '  engine handles tier transitions; do not propose tier changes.',
    '- Field paths use dot notation matching your frontmatter, e.g. "risk.perTrade", "risk.kellyFraction",',
    '  "regime.preferred", "regime.blockOnTransition", "risk.maxPositions".',
    '- Numeric value ranges (the engine will reject out-of-range proposals):',
    '  risk.perTrade in (0, 0.10], risk.maxDrawdown in (0, 0.50],',
    '  risk.kellyFraction in (0, 1.0], risk.maxPositions integer 1..20,',
    '  risk.maxPositionSizePercent in (0, 100].',
    '- regime.preferred ∈ {low-entropy, high-entropy, any}.',
    '- Persona notes should be in your voice and feel like a journal entry from your future self.',
    '</task>',
    '',
    '<output-format>',
    'Respond with a single JSON object matching the provided schema. Do not include any text',
    'outside the JSON object.',
    '</output-format>',
  ].join('\n');
}

// User message is the volatile part — recent trades, stats, regime context.
// Goes AFTER the cache breakpoint so the system prompt remains cache-stable.
function buildUserMessage({ statsSummary, recentTrades, regimeContext, asOf }) {
  const lines = [
    `## Daily review — ${asOf || new Date().toISOString().slice(0, 10)}`,
    '',
    '### Your stats',
    '```json',
    JSON.stringify(statsSummary, null, 2),
    '```',
    '',
    '### Recent trades (most recent last)',
  ];
  if (!recentTrades || recentTrades.length === 0) {
    lines.push('(no trades in window)');
  } else {
    lines.push('```');
    for (const t of recentTrades) {
      const time = (t.timestamp || '').slice(0, 19).replace('T', ' ');
      const side = (t.side || '?').toUpperCase().padEnd(4);
      const sym = (t.symbol || '?').padEnd(5);
      const px = t.price != null ? `$${Number(t.price).toFixed(2)}` : 'mkt';
      const pnl =
        t.realizedPnL != null
          ? `pnl=${t.realizedPnL >= 0 ? '+' : ''}$${t.realizedPnL.toFixed(2)}`
          : '';
      const pct =
        t.realizedPct != null
          ? `(${t.realizedPct >= 0 ? '+' : ''}${t.realizedPct.toFixed(2)}%)`
          : '';
      const reason = t.reason || t.exitReason || '';
      lines.push(
        `${time}  ${side} ${sym} ${px}  ${pnl} ${pct}  ${reason}`.trim()
      );
    }
    lines.push('```');
  }
  if (regimeContext) {
    lines.push('', '### Market regime context', '```json');
    lines.push(JSON.stringify(regimeContext, null, 2));
    lines.push('```');
  }
  lines.push(
    '',
    'Respond with the JSON object: your assessment, proposals, and persona notes.'
  );
  return lines.join('\n');
}

/**
 * Call the LLM analyst. Returns { parsed, usage } or throws.
 */
async function analyzeBroker({
  broker,
  persona,
  statsSummary,
  recentTrades,
  regimeContext,
  asOf,
}) {
  const client = getClient();
  const model = broker.llm?.model || DEFAULT_MODEL;
  const systemPrompt = buildSystemPrompt(broker, persona);
  const userMessage = buildUserMessage({
    statsSummary,
    recentTrades,
    regimeContext,
    asOf,
  });

  let response;
  try {
    // Adaptive thinking + medium effort: Claude decides depth per call. Both
    // require 4.6+ Sonnet/Opus. Falls back gracefully to no-thinking on legacy
    // models by stripping the field — see the catch block below.
    const supportsAdaptive = /sonnet-4-6|opus-4-(6|7)/.test(model);
    const params = {
      model,
      max_tokens: MAX_TOKENS,
      output_config: {
        format: { type: 'json_schema', schema: PROPOSAL_SCHEMA },
        ...(supportsAdaptive ? { effort: 'medium' } : {}),
      },
      ...(supportsAdaptive ? { thinking: { type: 'adaptive' } } : {}),
    };
    response = await client.messages.create({
      ...params,
      // System prompt cached — persona + config are stable across calls so the
      // 5-minute (default) cache makes the next call to the same broker cheap.
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      tradingLogger.logError(`[BrokerLLM] rate limited on ${broker.slug}`, {
        error: err.message,
      });
    } else if (err instanceof Anthropic.AuthenticationError) {
      tradingLogger.logError(
        `[BrokerLLM] auth error (check ANTHROPIC_API_KEY)`,
        {
          error: err.message,
        }
      );
    } else if (err instanceof Anthropic.APIError) {
      tradingLogger.logError(
        `[BrokerLLM] API error ${err.status} on ${broker.slug}`,
        { error: err.message }
      );
    }
    throw err;
  }

  // Structured outputs constrain the format, but the response body is still a
  // text block — we parse the JSON ourselves.
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error(`[BrokerLLM] no text block in response for ${broker.slug}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error(
      `[BrokerLLM] failed to parse JSON for ${broker.slug}: ${err.message}; raw=${textBlock.text.slice(0, 200)}`
    );
  }

  return {
    parsed,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens || 0,
      cacheCreation: response.usage.cache_creation_input_tokens || 0,
      model,
      stopReason: response.stop_reason,
    },
  };
}

module.exports = {
  analyzeBroker,
  buildSystemPrompt, // exposed for tests / debugging
  DEFAULT_MODEL,
  PROPOSAL_SCHEMA,
};
