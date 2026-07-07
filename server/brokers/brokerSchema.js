// server/brokers/brokerSchema.js
// Validates broker frontmatter and translates it into a session-engine config.
// The .md frontmatter is the source of truth for a broker's personality + knobs.

const ALLOWED_TIERS = ['simulated', 'paper', 'live'];
const ALLOWED_SIZING = ['fixed', 'fractional-kelly', 'confidence-scaled'];
const ALLOWED_REGIMES = ['low-entropy', 'high-entropy', 'any'];
const ALLOWED_LLM_ROLES = ['advisor', 'gate'];
const ALLOWED_INTERVALS = ['intraday-5m', 'intraday-1h', 'eod'];
const ALLOWED_STRATEGIES = [
  'momentum-breakout',
  'mean-reversion',
  'entropy-adaptive',
  'medallion-ensemble',
  'llm-gated',
  'balanced',
  'conservative',
  'aggressive',
  // Plugin-backed strategies (route to a non-technical signal source):
  'options-flow',
  'insider-following',
  'dark-pool',
  'trend-following',
  'cross-sectional-momentum',
];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

const BROKER_DEFAULTS = {
  tier: 'simulated',
  capital: 100000,
  // When promoted to tier=paper, the broker is allocated this much of the
  // shared Alpaca paper account. Defaults to 20% of `capital` (e.g. $20k
  // for a $100k broker). Sum across paper-tier brokers must fit within the
  // Alpaca paper account's buying power.
  paperAllocation: null,
  watchlist: [],
  strategy: 'balanced',
  risk: {
    perTrade: 0.02,
    maxDrawdown: 0.15,
    sizing: 'confidence-scaled',
    kellyFraction: 0.25,
    maxPositions: 3,
    maxPositionSizePercent: 15,
    // Portfolio drawdown circuit breaker (opt-in; null = disabled). When set,
    // a broker whose equity falls this fraction from its high-water mark is
    // halted (new entries blocked, exits + stops still flow — no liquidation).
    maxPortfolioDrawdown: null,
    // Daily loss limit (opt-in; null = disabled). Fraction of day-start equity;
    // realized day P&L below -this halts new entries until the next ET day
    // (exits keep flowing). e.g. 0.05 = 5%.
    dailyLossLimit: null,
    // Consecutive-loss limit (opt-in; null = disabled). New entries halt once
    // the losing streak reaches this count; a winning exit resets it.
    maxConsecutiveLosses: null,
    // Winner-trim / partial profit-take (opt-in; null = disabled). When set,
    // a winning position is trimmed once after unrealized P&L >= this percent.
    trimAtProfitPercent: null,
    // Fraction of a position to sell on a winner-trim (0,1). Maps to the
    // executors' partialExitPercent sizing.
    trimFraction: 0.5,
  },
  regime: {
    enabled: false,
    entropyWindows: [21, 63, 252],
    preferred: 'any',
    blockOnTransition: true,
    referenceSymbol: null,
  },
  // Macro (FRED) risk-on/off overlay. Off by default; inert without FRED_API_KEY.
  macro: {
    enabled: false,
    riskOffScalar: 0.25, // position-size multiplier when macro is risk-off
  },
  llm: {
    enabled: false,
    model: 'claude-sonnet-4-5',
    callBudget: 50,
    role: 'advisor',
  },
  selfImprovement: {
    intervals: ['eod'],
    fullAutonomy: false,
  },
  // Options-flow plugin tunables (only used when strategy: options-flow).
  // Harmless defaults for every other broker.
  flow: {
    minPremium: 250000, // min total option premium in the window to act ($)
    minSkew: 0.65, // dominant call/put premium share to call it directional
    lookbackMinutes: 30, // how far back to aggregate flow alerts
    scanner: false, // if true, watchlist auto-refreshes from the hottest flow
  },
  // Insider-following plugin tunables (strategy: insider-following).
  insider: {
    minNotional: 100000, // min open-market insider buy $ in the window
    lookbackDays: 10, // how many days of filings to aggregate
    scanner: false, // if true, watchlist is auto-refreshed from the insider feed
  },
  // Dark-pool plugin tunables (strategy: dark-pool).
  darkpool: {
    minPremium: 1000000, // min dark-pool premium in the window ($)
    minBuyShare: 0.6, // buy-side share of premium to call it accumulation
    lookbackMinutes: 120, // how far back to aggregate prints
    scanner: false, // if true, watchlist auto-refreshes from biggest dark prints
    // Classifier integrity guards (2026-06-01 audit fixes, darkPoolCore):
    dropAtMid: true, // at-mid prints are negotiated crosses — indeterminate
    maxSinglePrintShare: 0.25, // cap one print's premium weight (mega-print flips)
    minPrints: 5, // require >= N prints on the dominant side
    rthOnly: true, // ignore after-hours prints entirely
  },
  // Trend-following plugin tunables (strategy: trend-following).
  trend: {
    rankBy: 'momentum', // 'momentum' | 'volAdjusted' (rankScore = mom/vol63)
  },
};

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (typeof base !== 'object' || Array.isArray(base)) return over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (
      over[k] !== null &&
      typeof over[k] === 'object' &&
      !Array.isArray(over[k]) &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], over[k]);
    } else if (over[k] !== undefined) {
      out[k] = over[k];
    }
  }
  return out;
}

function pushIf(errs, cond, msg) {
  if (!cond) errs.push(msg);
}

/**
 * Validates and normalizes a broker definition parsed from frontmatter.
 * @param {object} raw The raw frontmatter object (after gray-matter).
 * @param {string} filename The source filename (used for slug fallback + errors).
 * @returns {{ broker: object | null, errors: string[] }}
 */
function validateBroker(raw, filename = '') {
  const errs = [];
  if (!raw || typeof raw !== 'object') {
    return { broker: null, errors: ['frontmatter missing or not an object'] };
  }

  const filenameSlug = filename
    ? filename.replace(/\.md$/, '').split('/').pop()
    : '';
  const slug = (raw.slug || filenameSlug || '').trim();
  pushIf(
    errs,
    SLUG_RE.test(slug),
    `slug "${slug}" must match ${SLUG_RE} (lowercase, dashes, 3-50 chars)`
  );

  const name = (raw.name || slug).toString();
  pushIf(errs, name.length > 0 && name.length <= 80, 'name must be 1-80 chars');

  const tier = raw.tier || BROKER_DEFAULTS.tier;
  pushIf(
    errs,
    ALLOWED_TIERS.includes(tier),
    `tier must be one of ${ALLOWED_TIERS.join('|')}`
  );

  const capital = Number(raw.capital ?? BROKER_DEFAULTS.capital);
  pushIf(
    errs,
    capital >= 1000 && capital <= 10_000_000,
    'capital must be 1000..10_000_000'
  );

  // paperAllocation may be null (use default = 20% of capital) or a number
  const rawPaperAlloc = raw.paperAllocation;
  let paperAllocation = null;
  if (rawPaperAlloc !== null && rawPaperAlloc !== undefined) {
    paperAllocation = Number(rawPaperAlloc);
    pushIf(
      errs,
      paperAllocation >= 500 && paperAllocation <= 1_000_000,
      'paperAllocation (when set) must be 500..1_000_000'
    );
  }

  const watchlist = Array.isArray(raw.watchlist)
    ? raw.watchlist.map(s => String(s).toUpperCase())
    : [];
  pushIf(
    errs,
    watchlist.length >= 1 && watchlist.length <= 50,
    'watchlist must have 1-50 symbols'
  );

  const strategy = raw.strategy || BROKER_DEFAULTS.strategy;
  pushIf(
    errs,
    ALLOWED_STRATEGIES.includes(strategy),
    `strategy must be one of ${ALLOWED_STRATEGIES.join('|')}`
  );

  const risk = deepMerge(BROKER_DEFAULTS.risk, raw.risk || {});
  pushIf(
    errs,
    risk.perTrade > 0 && risk.perTrade <= 0.1,
    'risk.perTrade must be in (0, 0.1]'
  );
  pushIf(
    errs,
    risk.maxDrawdown > 0 && risk.maxDrawdown <= 0.5,
    'risk.maxDrawdown must be in (0, 0.5]'
  );
  pushIf(
    errs,
    ALLOWED_SIZING.includes(risk.sizing),
    `risk.sizing must be one of ${ALLOWED_SIZING.join('|')}`
  );
  pushIf(
    errs,
    risk.kellyFraction > 0 && risk.kellyFraction <= 0.5,
    'risk.kellyFraction must be in (0, 0.5]'
  );
  pushIf(
    errs,
    Number.isInteger(risk.maxPositions) &&
      risk.maxPositions >= 1 &&
      risk.maxPositions <= 20,
    'risk.maxPositions must be int 1..20'
  );
  pushIf(
    errs,
    risk.maxPositionSizePercent > 0 && risk.maxPositionSizePercent <= 100,
    'risk.maxPositionSizePercent must be in (0, 100]'
  );
  pushIf(
    errs,
    risk.maxPortfolioDrawdown === null ||
      (typeof risk.maxPortfolioDrawdown === 'number' &&
        risk.maxPortfolioDrawdown > 0 &&
        risk.maxPortfolioDrawdown <= 0.5),
    'risk.maxPortfolioDrawdown must be null or in (0, 0.5]'
  );
  pushIf(
    errs,
    risk.dailyLossLimit === null ||
      (typeof risk.dailyLossLimit === 'number' &&
        risk.dailyLossLimit > 0 &&
        risk.dailyLossLimit <= 0.5),
    'risk.dailyLossLimit must be null or in (0, 0.5]'
  );
  pushIf(
    errs,
    risk.maxConsecutiveLosses === null ||
      (Number.isInteger(risk.maxConsecutiveLosses) &&
        risk.maxConsecutiveLosses >= 1 &&
        risk.maxConsecutiveLosses <= 50),
    'risk.maxConsecutiveLosses must be null or int 1..50'
  );
  pushIf(
    errs,
    risk.trimAtProfitPercent === null ||
      (typeof risk.trimAtProfitPercent === 'number' &&
        risk.trimAtProfitPercent > 0 &&
        risk.trimAtProfitPercent <= 500),
    'risk.trimAtProfitPercent must be null or in (0, 500]'
  );
  pushIf(
    errs,
    risk.trimFraction > 0 && risk.trimFraction < 1,
    'risk.trimFraction must be in (0, 1)'
  );

  const regime = deepMerge(BROKER_DEFAULTS.regime, raw.regime || {});
  if (regime.enabled) {
    pushIf(
      errs,
      Array.isArray(regime.entropyWindows) && regime.entropyWindows.length > 0,
      'regime.entropyWindows must be a non-empty array when regime.enabled=true'
    );
    pushIf(
      errs,
      regime.entropyWindows.every(
        n => Number.isInteger(n) && n >= 5 && n <= 504
      ),
      'regime.entropyWindows must be ints 5..504'
    );
    pushIf(
      errs,
      ALLOWED_REGIMES.includes(regime.preferred),
      `regime.preferred must be one of ${ALLOWED_REGIMES.join('|')}`
    );
  }

  const macro = deepMerge(BROKER_DEFAULTS.macro, raw.macro || {});
  if (macro.enabled) {
    pushIf(
      errs,
      typeof macro.riskOffScalar === 'number' &&
        macro.riskOffScalar >= 0 &&
        macro.riskOffScalar <= 1,
      'macro.riskOffScalar must be a number in [0, 1]'
    );
  }

  const llm = deepMerge(BROKER_DEFAULTS.llm, raw.llm || {});
  if (llm.enabled) {
    pushIf(
      errs,
      typeof llm.model === 'string' && llm.model.length > 0,
      'llm.model must be a non-empty string'
    );
    pushIf(
      errs,
      Number.isInteger(llm.callBudget) &&
        llm.callBudget >= 1 &&
        llm.callBudget <= 5000,
      'llm.callBudget must be int 1..5000'
    );
    pushIf(
      errs,
      ALLOWED_LLM_ROLES.includes(llm.role),
      `llm.role must be one of ${ALLOWED_LLM_ROLES.join('|')}`
    );
  }

  const trend = deepMerge(BROKER_DEFAULTS.trend, raw.trend || {});
  pushIf(
    errs,
    ['momentum', 'volAdjusted'].includes(trend.rankBy),
    'trend.rankBy must be momentum|volAdjusted'
  );

  const flow = deepMerge(BROKER_DEFAULTS.flow, raw.flow || {});
  pushIf(
    errs,
    typeof flow.minPremium === 'number' && flow.minPremium >= 0,
    'flow.minPremium must be a non-negative number'
  );
  pushIf(
    errs,
    typeof flow.minSkew === 'number' &&
      flow.minSkew >= 0.5 &&
      flow.minSkew <= 1,
    'flow.minSkew must be in [0.5, 1]'
  );
  pushIf(
    errs,
    Number.isInteger(flow.lookbackMinutes) &&
      flow.lookbackMinutes >= 1 &&
      flow.lookbackMinutes <= 1440,
    'flow.lookbackMinutes must be int 1..1440'
  );

  const insider = deepMerge(BROKER_DEFAULTS.insider, raw.insider || {});
  pushIf(
    errs,
    typeof insider.minNotional === 'number' && insider.minNotional >= 0,
    'insider.minNotional must be a non-negative number'
  );
  pushIf(
    errs,
    Number.isInteger(insider.lookbackDays) &&
      insider.lookbackDays >= 1 &&
      insider.lookbackDays <= 90,
    'insider.lookbackDays must be int 1..90'
  );

  const darkpool = deepMerge(BROKER_DEFAULTS.darkpool, raw.darkpool || {});
  pushIf(
    errs,
    typeof darkpool.minPremium === 'number' && darkpool.minPremium >= 0,
    'darkpool.minPremium must be a non-negative number'
  );
  pushIf(
    errs,
    typeof darkpool.minBuyShare === 'number' &&
      darkpool.minBuyShare >= 0.5 &&
      darkpool.minBuyShare <= 1,
    'darkpool.minBuyShare must be in [0.5, 1]'
  );
  pushIf(
    errs,
    Number.isInteger(darkpool.lookbackMinutes) &&
      darkpool.lookbackMinutes >= 1 &&
      darkpool.lookbackMinutes <= 1440,
    'darkpool.lookbackMinutes must be int 1..1440'
  );
  pushIf(
    errs,
    typeof darkpool.maxSinglePrintShare === 'number' &&
      darkpool.maxSinglePrintShare > 0 &&
      darkpool.maxSinglePrintShare <= 1,
    'darkpool.maxSinglePrintShare must be in (0, 1]'
  );
  pushIf(
    errs,
    Number.isInteger(darkpool.minPrints) &&
      darkpool.minPrints >= 1 &&
      darkpool.minPrints <= 100,
    'darkpool.minPrints must be int 1..100'
  );
  pushIf(
    errs,
    typeof darkpool.dropAtMid === 'boolean',
    'darkpool.dropAtMid must be a boolean'
  );
  pushIf(
    errs,
    typeof darkpool.rthOnly === 'boolean',
    'darkpool.rthOnly must be a boolean'
  );

  const selfImprovement = deepMerge(
    BROKER_DEFAULTS.selfImprovement,
    raw.selfImprovement || {}
  );
  pushIf(
    errs,
    Array.isArray(selfImprovement.intervals),
    'selfImprovement.intervals must be an array'
  );
  pushIf(
    errs,
    selfImprovement.intervals.every(i => ALLOWED_INTERVALS.includes(i)),
    `selfImprovement.intervals values must be one of ${ALLOWED_INTERVALS.join('|')}`
  );

  if (errs.length > 0) return { broker: null, errors: errs };

  return {
    broker: {
      slug,
      name,
      tier,
      capital,
      paperAllocation,
      watchlist,
      strategy,
      risk,
      regime,
      macro,
      llm,
      selfImprovement,
      flow,
      insider,
      darkpool,
      trend,
    },
    errors: [],
  };
}

/**
 * The effective capital this broker should start with given its tier:
 * - simulated → broker.capital (the persona's stated virtual stake)
 * - paper → broker.paperAllocation, OR 20% of capital if unset
 * - live → liveAllocation/paperAllocation ceiling; the AUTHORITATIVE live equity
 *   is seeded from the real Alpaca account by transitionToLiveTier, not here.
 * Used by the bridge when transitioning between tiers.
 */
function effectiveCapital(broker) {
  if (broker.tier === 'paper') {
    return broker.paperAllocation ?? Math.round(broker.capital * 0.2);
  }
  if (broker.tier === 'live') {
    return (
      broker.liveAllocation ??
      broker.paperAllocation ??
      Math.round(broker.capital * 0.2)
    );
  }
  return broker.capital;
}

/**
 * Translates a validated broker into a session-engine config compatible with DEFAULT_CONFIG.
 * The engine remains the source of truth for runtime; this is the bridge.
 */
function brokerToSessionConfig(broker, personaBody = '') {
  // Resolve the effective tier FAIL-CLOSED so real money never happens by
  // accident:
  //  1. BROKER_PAPER_TRADING=off forces sim regardless of declared tier — the
  //     "days you don't trust the system" kill switch; wins over everything.
  //  2. A broker that declares tier:live runs on the PAPER Alpaca account unless
  //     live is EXPLICITLY unlocked (ALLOW_LIVE_TIER=1) and not killed
  //     (LIVE_TRADING!=off). Absent that, live silently downgrades to paper.
  const killSwitch = process.env.BROKER_PAPER_TRADING === 'off';
  const liveUnlocked =
    process.env.ALLOW_LIVE_TIER === '1' && process.env.LIVE_TRADING !== 'off';
  let effectiveTier = killSwitch ? 'simulated' : broker.tier;
  if (effectiveTier === 'live' && !liveUnlocked) effectiveTier = 'paper';
  const cap = effectiveCapital({ ...broker, tier: effectiveTier });

  const config = {
    name: broker.name,
    brokerSlug: broker.slug,
    brokerPersona: personaBody,
    tier: effectiveTier,
    declaredTier: broker.tier, // preserves persona intent even when kill-switched
    // simulationMode drives orderExecutor's routing: true → simulatedExecutor,
    // false → real Alpaca via tradingMode.
    simulationMode: effectiveTier === 'simulated',
    paperTradeOnly: effectiveTier === 'paper',
    // getSessionTradingMode treats tradingMode as authoritative (paperTradeOnly
    // is only a legacy fallback), so live→'live' routes to the real-money Alpaca
    // account; sim ignores this (simulationMode routing wins); everything else
    // → paper Alpaca.
    tradingMode: effectiveTier === 'live' ? 'live' : 'paper',
    initialCapital: cap,
    allocatedCapital: cap,
    paperAllocation: broker.paperAllocation,
    watchlist: broker.watchlist,
    autoTrade: true,
    manageAllPositions: false,

    // Risk
    riskPerTradePercent: broker.risk.perTrade * 100,
    maxDrawdownPercent: broker.risk.maxDrawdown * 100,
    sizingStrategy: broker.risk.sizing,
    kellyFraction: broker.risk.kellyFraction,
    maxPositions: broker.risk.maxPositions,
    maxPositionSizePercent: broker.risk.maxPositionSizePercent,
    // Portfolio drawdown circuit breaker (opt-in). null = disabled; guard the
    // null*100 trap so a disabled breaker stays null, not 0.
    maxPortfolioDrawdownPercent:
      broker.risk.maxPortfolioDrawdown == null
        ? null
        : broker.risk.maxPortfolioDrawdown * 100,
    // Daily loss + consecutive-loss soft-halt limits (opt-in; null = disabled).
    // dailyLossLimit is a fraction → percent; maxConsecutiveLosses is a count.
    dailyLossLimitPercent:
      broker.risk.dailyLossLimit == null
        ? null
        : broker.risk.dailyLossLimit * 100,
    maxConsecutiveLosses: broker.risk.maxConsecutiveLosses ?? null,
    // Winner-trim (opt-in). trimAtProfitPercent is already percent units.
    // trimFraction → the executors' partialExitPercent sizing (0..100).
    trimAtProfitPercent: broker.risk.trimAtProfitPercent ?? null,
    partialExitPercent: (broker.risk.trimFraction ?? 0.5) * 100,

    // Strategy → entry style mapping. strategyKey drives strategy-plugin
    // dispatch (see server/strategies/index.js resolve()); entryStrategy is the
    // technical-indicators preset used when this broker runs that plugin.
    entryStrategy: mapStrategyToEntryStyle(broker.strategy),
    strategyKey: broker.strategy,

    // Options-flow plugin tunables (no-ops for non-flow brokers).
    minPremium: (broker.flow || BROKER_DEFAULTS.flow).minPremium,
    minSkew: (broker.flow || BROKER_DEFAULTS.flow).minSkew,
    lookbackMinutes: (broker.flow || BROKER_DEFAULTS.flow).lookbackMinutes,
    flowScanner: (broker.flow || BROKER_DEFAULTS.flow).scanner === true,

    // Insider-following plugin tunables.
    insiderMinNotional: (broker.insider || BROKER_DEFAULTS.insider).minNotional,
    insiderLookbackDays: (broker.insider || BROKER_DEFAULTS.insider)
      .lookbackDays,
    insiderScanner:
      (broker.insider || BROKER_DEFAULTS.insider).scanner === true,

    // Dark-pool plugin tunables.
    darkpoolMinPremium: (broker.darkpool || BROKER_DEFAULTS.darkpool)
      .minPremium,
    darkpoolMinBuyShare: (broker.darkpool || BROKER_DEFAULTS.darkpool)
      .minBuyShare,
    darkpoolLookbackMinutes: (broker.darkpool || BROKER_DEFAULTS.darkpool)
      .lookbackMinutes,
    darkpoolScanner:
      (broker.darkpool || BROKER_DEFAULTS.darkpool).scanner === true,
    // Classifier integrity guards (audit fixes — see quant-core darkPoolCore).
    darkpoolDropAtMid:
      (broker.darkpool || BROKER_DEFAULTS.darkpool).dropAtMid !== false,
    darkpoolMaxSinglePrintShare: (broker.darkpool || BROKER_DEFAULTS.darkpool)
      .maxSinglePrintShare,
    darkpoolMinPrints: (broker.darkpool || BROKER_DEFAULTS.darkpool).minPrints,
    darkpoolRthOnly:
      (broker.darkpool || BROKER_DEFAULTS.darkpool).rthOnly !== false,

    // Trend-following plugin tunables
    trendRankBy: (broker.trend || BROKER_DEFAULTS.trend).rankBy,

    // Regime
    entropyGateEnabled: broker.regime.enabled,
    entropyWindows: broker.regime.entropyWindows,
    preferredRegime: broker.regime.preferred,
    blockOnRegimeTransition: broker.regime.blockOnTransition,
    regimeReferenceSymbol: broker.regime.referenceSymbol,

    // Macro (FRED) risk-on/off overlay
    macroGateEnabled: (broker.macro || BROKER_DEFAULTS.macro).enabled,
    macroRiskOffScalar: (broker.macro || BROKER_DEFAULTS.macro).riskOffScalar,

    // LLM
    brokerLlmEnabled: broker.llm.enabled,
    brokerLlmModel: broker.llm.model,
    brokerLlmCallBudget: broker.llm.callBudget,
    brokerLlmRole: broker.llm.role,

    // Self-improvement
    selfImproveIntervals: broker.selfImprovement.intervals,
    selfImproveFullAutonomy: broker.selfImprovement.fullAutonomy,
  };

  // Apply the strategy plugin's hold policy (if any). Multi-day plugins
  // (insider, dark-pool) hold overnight with wider targets and a max-hold in
  // days; intraday plugins declare none and keep the engine's defaults. Routed
  // through the same registry the dispatcher uses. Required lazily to avoid any
  // load-order coupling between the schema and the strategy modules.
  const { resolve } = require('../strategies');
  const hp = resolve(config)?.holdPolicy;
  if (hp) {
    if (hp.exitBeforeClose === false) config.exitBeforeClose = false;
    if (hp.takeProfitPercent != null) {
      config.takeProfitPercent = hp.takeProfitPercent;
    }
    if (hp.stopLossPercent != null) config.stopLossPercent = hp.stopLossPercent;
    if (hp.maxHoldDays != null) config.maxHoldDays = hp.maxHoldDays;
    if (hp.minHoldMinutes != null) config.minHoldMinutes = hp.minHoldMinutes;
    config.holdHorizon = hp.horizon || 'multi-day';
  }

  return config;
}

function mapStrategyToEntryStyle(strategy) {
  switch (strategy) {
    case 'momentum-breakout':
    case 'aggressive':
      return 'momentum';
    case 'mean-reversion':
    case 'conservative':
      return 'conservative';
    case 'entropy-adaptive':
    case 'medallion-ensemble':
    case 'llm-gated':
    case 'balanced':
    default:
      return 'balanced';
  }
}

module.exports = {
  BROKER_DEFAULTS,
  ALLOWED_TIERS,
  ALLOWED_SIZING,
  ALLOWED_REGIMES,
  ALLOWED_LLM_ROLES,
  ALLOWED_INTERVALS,
  ALLOWED_STRATEGIES,
  validateBroker,
  brokerToSessionConfig,
  effectiveCapital,
};
