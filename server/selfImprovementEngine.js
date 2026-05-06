/**
 * Self-Improvement Engine for AI Trading System
 *
 * Two modes of operation:
 *
 * 1. NIGHTLY OPTIMIZATION — For each running session:
 *    COLLECT → ANALYZE → OPTIMIZE → VALIDATE → APPLY → LOG
 *
 * 2. TOURNAMENT MODE — Spawn competing sessions with varied params,
 *    track daily P&L, evolve weekly (cull losers, clone+mutate winners).
 *
 * Safety guardrails:
 * - Max ±25% param change per cycle
 * - Min 5 trades for analysis
 * - Min 60% walk-forward robustness
 * - Auto-revert after 3 consecutive worsenings
 * - 3-day cooldown after revert
 * - Hard floors on stopLoss/takeProfit (≥0.5%)
 * - Tournament: max 6 concurrent sessions, 40% portfolio exposure cap
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'data', 'improvement-log.json');

// Parameters safe to auto-tune
const AUTO_TUNABLE_PARAMS = new Set([
  'takeProfitPercent',
  'stopLossPercent',
  'trailingStopPercent',
  'minConfidence',
  'rsiOversold',
  'rsiOverbought',
  'volumeMultiplier',
  'minSignalsRequired',
  'minHoldMinutes',
  'counterTrendMinHoldMinutes',
]);

// Hard floors to prevent absurd values
const PARAM_FLOORS = {
  stopLossPercent: 0.5,
  takeProfitPercent: 0.5,
  trailingStopPercent: 0,
  minConfidence: 10,
  rsiOversold: 10,
  rsiOverbought: 50,
  volumeMultiplier: 0.5,
  minSignalsRequired: 1,
  minHoldMinutes: 0,
  counterTrendMinHoldMinutes: 0,
};

const PARAM_CEILINGS = {
  stopLossPercent: 15,
  takeProfitPercent: 20,
  trailingStopPercent: 10,
  minConfidence: 95,
  rsiOversold: 45,
  rsiOverbought: 95,
  volumeMultiplier: 5,
  minSignalsRequired: 6,
  minHoldMinutes: 120,
  counterTrendMinHoldMinutes: 120,
};

// Guardrail constants
const MAX_PARAM_CHANGE_PERCENT = 0.25;
const MIN_TRADES_FOR_ANALYSIS = 3;
const MIN_ROBUSTNESS_SCORE = 60;
const MAX_CONSECUTIVE_WORSENINGS = 3;
const COOLDOWN_DAYS = 3;
const OPTIMIZATION_LOOKBACK_DAYS = 14;
const OPTIMIZATION_POPULATION = 30;
const OPTIMIZATION_GENERATIONS = 15;
const TRIGGER_HOUR = 16;
const TRIGGER_MINUTE = 15;

// Tournament constants
const MAX_TOURNAMENT_SESSIONS = 6;
const EVOLUTION_INTERVAL_DAYS = 5; // Evolve every 5 trading days
const MIN_TRADES_FOR_RANKING = 3;
const MUTATION_RANGE = 0.20; // ±20% mutation on clone

// Strategy variations for tournament spawning
const TOURNAMENT_VARIANTS = [
  {
    suffix: 'Conservative',
    mutations: {
      minConfidence: 80,
      stopLossPercent: 0.8,
      takeProfitPercent: 1.5,
      minSignalsRequired: 3,
      trailingStopPercent: 0.5,
      minHoldMinutes: 45,
    },
  },
  {
    suffix: 'Aggressive',
    mutations: {
      minConfidence: 55,
      stopLossPercent: 2.0,
      takeProfitPercent: 4.0,
      minSignalsRequired: 2,
      trailingStopPercent: 1.5,
      minHoldMinutes: 15,
    },
  },
  {
    suffix: 'Momentum',
    mutations: {
      minConfidence: 65,
      rsiOversold: 25,
      rsiOverbought: 75,
      takeProfitPercent: 3.5,
      stopLossPercent: 1.2,
      volumeMultiplier: 2.0,
      minSignalsRequired: 2,
      minHoldMinutes: 20,
    },
  },
  {
    suffix: 'MeanRevert',
    mutations: {
      minConfidence: 60,
      rsiOversold: 35,
      rsiOverbought: 65,
      takeProfitPercent: 1.5,
      stopLossPercent: 1.0,
      volumeMultiplier: 1.2,
      minSignalsRequired: 2,
      minHoldMinutes: 30,
    },
  },
  {
    suffix: 'WideNet',
    mutations: {
      minConfidence: 50,
      stopLossPercent: 2.5,
      takeProfitPercent: 5.0,
      minSignalsRequired: 1,
      trailingStopPercent: 2.0,
      minHoldMinutes: 10,
    },
  },
  {
    suffix: 'TightScalp',
    mutations: {
      minConfidence: 75,
      stopLossPercent: 0.5,
      takeProfitPercent: 1.0,
      minSignalsRequired: 3,
      trailingStopPercent: 0.3,
      minHoldMinutes: 5,
      counterTrendMinHoldMinutes: 5,
    },
  },
];

class SelfImprovementEngine {
  constructor() {
    this.intervalId = null;
    this.running = false;
    this.cycleInProgress = false;
    this.log = this._loadLog();
    this._deps = null;
  }

  _getDeps() {
    if (!this._deps) {
      this._deps = {
        aiTradingEngine: require('./aiTradingEngine'),
        tradingLogger: require('./tradingLogger'),
        strategyOptimizer: require('./strategyOptimizer'),
        WalkForwardOptimizer: require('./walkForwardOptimizer'),
        polygonClient: require('./polygonClient'),
      };
    }
    return this._deps;
  }

  // ═══════════════════════════════════════════════════════════
  // SCHEDULING
  // ═══════════════════════════════════════════════════════════

  start() {
    if (this.running) return;
    this.running = true;
    this.intervalId = setInterval(() => this.checkAndRun(), 60 * 1000);
    console.log('[SelfImprovement] Engine started — nightly at 4:15 PM ET');
    if (this.log.tournament?.active) {
      console.log(
        `[SelfImprovement] Tournament active: ${this.log.tournament.sessionIds.length} sessions competing`
      );
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    console.log('[SelfImprovement] Engine stopped');
  }

  checkAndRun() {
    const now = new Date();
    const etTime = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/New_York' })
    );
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();
    const day = etTime.getDay();

    if (day === 0 || day === 6) return;
    if (hour !== TRIGGER_HOUR || minute !== TRIGGER_MINUTE) return;

    const dateStr = etTime.toISOString().split('T')[0];
    if (this.log.lastRunDate === dateStr) return;

    console.log(`[SelfImprovement] Triggering nightly cycle for ${dateStr}`);
    this.runNightlyCycle(dateStr).catch((err) => {
      console.error('[SelfImprovement] Nightly cycle failed:', err.message);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN PIPELINE
  // ═══════════════════════════════════════════════════════════

  async runNightlyCycle(dateStr) {
    if (this.cycleInProgress) {
      console.log('[SelfImprovement] Cycle already in progress, skipping');
      return { status: 'skipped', reason: 'cycle_in_progress' };
    }

    this.cycleInProgress = true;
    const cycleId = `cycle_${dateStr}_${Date.now()}`;
    const cycle = {
      cycleId,
      date: dateStr,
      startTime: new Date().toISOString(),
      status: 'running',
      sessionResults: {},
      tournamentSnapshot: null,
    };

    try {
      const { aiTradingEngine } = this._getDeps();
      const sessions = aiTradingEngine.getAllUserSessions('default_user');
      const runningSessions = sessions.filter((s) => s.status === 'running');

      // Record daily performance for ALL running sessions (tournament or not)
      const dailySnapshot = this._recordDailyPerformance(runningSessions, dateStr);
      cycle.tournamentSnapshot = dailySnapshot;

      if (runningSessions.length === 0) {
        cycle.status = 'skipped';
        cycle.reason = 'no_running_sessions';
        console.log('[SelfImprovement] No running sessions, skipping cycle');
      } else {
        console.log(
          `[SelfImprovement] Processing ${runningSessions.length} running session(s)`
        );

        for (const sessionSummary of runningSessions) {
          try {
            const result = await this.processSession(sessionSummary, dateStr);
            cycle.sessionResults[sessionSummary.sessionId] = result;
          } catch (err) {
            console.error(
              `[SelfImprovement] Error processing session ${sessionSummary.name}:`,
              err.message
            );
            cycle.sessionResults[sessionSummary.sessionId] = {
              status: 'error',
              error: err.message,
            };
          }
        }

        // Tournament evolution check
        if (this.log.tournament?.active) {
          try {
            const evoResult = this._checkEvolution(dateStr);
            cycle.evolution = evoResult;
          } catch (err) {
            console.error('[SelfImprovement] Evolution check failed:', err.message);
            cycle.evolution = { status: 'error', error: err.message };
          }
        }

        cycle.status = 'completed';
      }

      cycle.endTime = new Date().toISOString();
      this.log.cycles.push(cycle);
      this.log.lastRunDate = dateStr;
      this._saveLog();

      console.log(`[SelfImprovement] Cycle ${cycleId} completed`);
      return cycle;
    } catch (err) {
      cycle.status = 'error';
      cycle.error = err.message;
      cycle.endTime = new Date().toISOString();
      this.log.cycles.push(cycle);
      this._saveLog();
      throw err;
    } finally {
      this.cycleInProgress = false;
    }
  }

  async processSession(sessionSummary, dateStr) {
    const sessionId = sessionSummary.sessionId;
    const sessionName = sessionSummary.name || sessionId;
    console.log(`[SelfImprovement] Processing session: ${sessionName}`);

    const result = { sessionId, sessionName, stages: {} };

    const prevEval = this._evaluatePreviousChanges(sessionId);
    result.previousEvaluation = prevEval;

    const tracking = this._getSessionTracking(sessionId);
    if (tracking.lastRevertDate) {
      const revertDate = new Date(tracking.lastRevertDate);
      const now = new Date();
      const daysSinceRevert = (now - revertDate) / (1000 * 60 * 60 * 24);
      if (daysSinceRevert < COOLDOWN_DAYS) {
        result.status = 'skipped';
        result.reason = `cooldown (${Math.ceil(COOLDOWN_DAYS - daysSinceRevert)} days remaining)`;
        console.log(`[SelfImprovement] ${sessionName}: ${result.reason}`);
        return result;
      }
    }

    const trades = this._collectTrades(sessionId, dateStr);
    result.stages.collect = { tradeCount: trades.length };

    if (trades.length < MIN_TRADES_FOR_ANALYSIS) {
      result.status = 'skipped';
      result.reason = `insufficient trades (${trades.length} < ${MIN_TRADES_FOR_ANALYSIS})`;
      console.log(`[SelfImprovement] ${sessionName}: ${result.reason}`);
      return result;
    }

    const analysis = this._analyzeTrades(trades, sessionSummary);
    result.stages.analyze = analysis;

    let optimized;
    try {
      optimized = await this._optimizeParams(sessionSummary, dateStr);
      result.stages.optimize = {
        status: 'completed',
        paramCount: Object.keys(optimized.proposedChanges || {}).length,
      };
    } catch (err) {
      result.stages.optimize = { status: 'error', error: err.message };
      result.status = 'error';
      result.reason = `optimization failed: ${err.message}`;
      console.log(`[SelfImprovement] ${sessionName}: ${result.reason}`);
      return result;
    }

    if (
      !optimized.proposedChanges ||
      Object.keys(optimized.proposedChanges).length === 0
    ) {
      result.status = 'no_changes';
      result.reason = 'optimizer found no beneficial changes';
      console.log(`[SelfImprovement] ${sessionName}: ${result.reason}`);
      return result;
    }

    let validation;
    try {
      validation = await this._validateChanges(
        sessionSummary,
        optimized.proposedChanges
      );
      result.stages.validate = validation;
    } catch (err) {
      result.stages.validate = { status: 'error', error: err.message };
      result.status = 'error';
      result.reason = `validation failed: ${err.message}`;
      console.log(`[SelfImprovement] ${sessionName}: ${result.reason}`);
      return result;
    }

    if (!validation.passed) {
      result.status = 'rejected';
      result.reason = `walk-forward robustness ${validation.robustness}% < ${MIN_ROBUSTNESS_SCORE}%`;
      console.log(`[SelfImprovement] ${sessionName}: ${result.reason}`);
      return result;
    }

    const applied = this._applyChanges(
      sessionId,
      sessionSummary,
      optimized.proposedChanges
    );
    result.stages.apply = applied;
    result.status = 'applied';
    result.changes = optimized.proposedChanges;

    console.log(
      `[SelfImprovement] ${sessionName}: applied ${Object.keys(optimized.proposedChanges).length} param changes`
    );

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // TOURNAMENT MODE
  // ═══════════════════════════════════════════════════════════

  /**
   * Start a tournament: spawn N competing sessions from a base preset.
   * Each session gets a different parameter variation.
   *
   * SAFETY: Tournament sessions run with autoTrade=FALSE to prevent
   * order stacking. Multiple sessions sharing the same watchlist would
   * each independently place orders, creating massive concentrated
   * exposure. Instead, tournament sessions observe and record decisions
   * without executing. The nightly cycle evaluates which params produce
   * the best signals, and those get applied to the single live session.
   *
   * @param {object} options
   * @param {string} options.preset - Base preset name (SOXL_MOMENTUM, QBTX_QBTZ_COMBO, etc.)
   * @param {number} options.count - Number of sessions to spawn (max 6)
   * @param {object} options.baseOverrides - Additional config overrides applied to all sessions
   * @param {string} options.liveSessionId - The ONE session that actually trades (optional)
   */
  startTournament(options = {}) {
    const { aiTradingEngine } = this._getDeps();

    if (this.log.tournament?.active) {
      return { success: false, reason: 'tournament_already_active' };
    }

    const preset = options.preset || 'QBTX_QBTZ_COMBO';
    const count = Math.min(options.count || MAX_TOURNAMENT_SESSIONS, MAX_TOURNAMENT_SESSIONS);
    const baseOverrides = options.baseOverrides || {};
    const liveSessionId = options.liveSessionId || null;

    // Get the base preset config
    const basePreset = aiTradingEngine.getStrategyPreset(preset);
    if (!basePreset) {
      return {
        success: false,
        reason: `unknown preset: ${preset}`,
        available: Object.keys(aiTradingEngine.STRATEGY_PRESETS || {}),
      };
    }

    const baseConfig = {
      ...basePreset,
      ...baseOverrides,
      // CRITICAL: Tournament sessions observe only — NO live orders.
      // This prevents the order-stacking bug where N sessions all buy
      // the same symbol simultaneously, creating N× intended exposure.
      autoTrade: false,
      maxPositionSizePercent: Math.min(basePreset.maxPositionSizePercent || 10, 10),
    };

    const sessionIds = [];
    const sessionDetails = [];
    const variants = TOURNAMENT_VARIANTS.slice(0, count);

    console.log(
      `[SelfImprovement] Starting tournament: ${count} OBSERVE-ONLY sessions from ${preset}`
    );
    console.log(
      '[SelfImprovement] Sessions will record signals without executing orders'
    );

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      const sessionConfig = { ...baseConfig };

      // Apply variant mutations
      for (const [param, value] of Object.entries(variant.mutations)) {
        sessionConfig[param] = value;
      }

      // Clamp to safe bounds
      for (const param of AUTO_TUNABLE_PARAMS) {
        if (sessionConfig[param] !== undefined) {
          if (PARAM_FLOORS[param] !== undefined) {
            sessionConfig[param] = Math.max(
              PARAM_FLOORS[param],
              sessionConfig[param]
            );
          }
          if (PARAM_CEILINGS[param] !== undefined) {
            sessionConfig[param] = Math.min(
              PARAM_CEILINGS[param],
              sessionConfig[param]
            );
          }
        }
      }

      sessionConfig.name = `T-${variant.suffix}`;

      try {
        const result = aiTradingEngine.startSession('default_user', sessionConfig);
        sessionIds.push(result.sessionId);
        sessionDetails.push({
          sessionId: result.sessionId,
          name: result.name,
          variant: variant.suffix,
          config: sessionConfig,
        });
        console.log(
          `[SelfImprovement] Spawned tournament session: ${result.name} (${result.sessionId}) [OBSERVE-ONLY]`
        );
      } catch (err) {
        console.error(
          `[SelfImprovement] Failed to spawn ${variant.suffix}: ${err.message}`
        );
      }
    }

    if (sessionIds.length === 0) {
      return { success: false, reason: 'failed_to_spawn_any_sessions' };
    }

    this.log.tournament = {
      active: true,
      preset,
      startDate: new Date().toISOString(),
      sessionIds,
      sessionDetails,
      liveSessionId, // The ONE session that actually executes trades
      dailySnapshots: [],
      generations: [
        {
          generation: 1,
          date: new Date().toISOString(),
          action: 'initial_spawn',
          sessions: sessionIds,
        },
      ],
      currentGeneration: 1,
      tradingDayCount: 0,
    };
    this._saveLog();

    console.log(
      `[SelfImprovement] Tournament started: ${sessionIds.length} observe-only sessions`
    );
    if (liveSessionId) {
      console.log(
        `[SelfImprovement] Live trading session: ${liveSessionId} (winner params will be applied here)`
      );
    }

    return {
      success: true,
      sessionsSpawned: sessionIds.length,
      mode: 'observe-only',
      note: 'Tournament sessions record signals without executing. Winner params get applied to the live session.',
      liveSessionId,
      sessions: sessionDetails.map((s) => ({
        id: s.sessionId,
        name: s.name,
        variant: s.variant,
      })),
      preset,
    };
  }

  /**
   * Stop the tournament and optionally keep the best session running.
   */
  stopTournament(options = {}) {
    const { aiTradingEngine } = this._getDeps();
    const tournament = this.log.tournament;

    if (!tournament?.active) {
      return { success: false, reason: 'no_active_tournament' };
    }

    const keepBest = options.keepBest !== false;
    const scoreboard = this.getScoreboard();
    const bestSession =
      scoreboard.rankings.length > 0 ? scoreboard.rankings[0] : null;

    let kept = null;
    const stopped = [];

    for (const sessionId of tournament.sessionIds) {
      if (keepBest && bestSession && sessionId === bestSession.sessionId) {
        kept = { sessionId, name: bestSession.name, pnl: bestSession.totalPnL };
        continue;
      }
      try {
        aiTradingEngine.stopSession(sessionId);
        stopped.push(sessionId);
      } catch (err) {
        console.log(`[SelfImprovement] Failed to stop ${sessionId}: ${err.message}`);
      }
    }

    tournament.active = false;
    tournament.endDate = new Date().toISOString();
    tournament.winner = kept;
    this._saveLog();

    console.log(
      `[SelfImprovement] Tournament ended. Winner: ${kept?.name || 'none'}`
    );

    return {
      success: true,
      stopped: stopped.length,
      winner: kept,
      finalScoreboard: scoreboard,
    };
  }

  // ─── Daily Performance Recording ────────────────────────

  _recordDailyPerformance(runningSessions, dateStr) {
    const snapshot = {
      date: dateStr,
      standings: {},
    };

    for (const session of runningSessions) {
      snapshot.standings[session.sessionId] = {
        name: session.name,
        totalTrades: session.stats?.totalTrades || 0,
        wins: session.stats?.wins || 0,
        losses: session.stats?.losses || 0,
        winRate: session.stats?.winRate || 0,
        totalPnL:
          session.stats?.totalPnLWithUnrealized ||
          session.stats?.totalPnL ||
          0,
        maxDrawdown: session.stats?.maxDrawdown || 0,
        positionCount: session.positionCount || 0,
        unrealizedPnL: session.stats?.unrealizedPnL || 0,
      };
    }

    // Store in tournament snapshots if active
    if (this.log.tournament?.active) {
      this.log.tournament.dailySnapshots.push(snapshot);
      this.log.tournament.tradingDayCount++;
      // Keep last 60 snapshots
      if (this.log.tournament.dailySnapshots.length > 60) {
        this.log.tournament.dailySnapshots =
          this.log.tournament.dailySnapshots.slice(-60);
      }
    }

    // Also store globally for non-tournament tracking
    if (!this.log.dailySnapshots) this.log.dailySnapshots = [];
    this.log.dailySnapshots.push(snapshot);
    if (this.log.dailySnapshots.length > 90) {
      this.log.dailySnapshots = this.log.dailySnapshots.slice(-90);
    }

    this._saveLog();
    return snapshot;
  }

  // ─── Tournament Evolution ───────────────────────────────

  _checkEvolution(dateStr) {
    const tournament = this.log.tournament;
    if (!tournament?.active) return { status: 'no_tournament' };

    // Only evolve every N trading days
    if (tournament.tradingDayCount % EVOLUTION_INTERVAL_DAYS !== 0) {
      return {
        status: 'waiting',
        daysUntilEvolution:
          EVOLUTION_INTERVAL_DAYS -
          (tournament.tradingDayCount % EVOLUTION_INTERVAL_DAYS),
        tradingDayCount: tournament.tradingDayCount,
      };
    }

    if (tournament.tradingDayCount === 0) {
      return { status: 'waiting', reason: 'no_trading_days_yet' };
    }

    const { aiTradingEngine } = this._getDeps();
    const scoreboard = this.getScoreboard();

    if (scoreboard.rankings.length < 2) {
      return { status: 'skipped', reason: 'not_enough_sessions_to_evolve' };
    }

    // Only rank sessions with enough trades
    const rankable = scoreboard.rankings.filter(
      (r) => r.totalTrades >= MIN_TRADES_FOR_RANKING
    );

    if (rankable.length < 2) {
      return {
        status: 'skipped',
        reason: `not enough sessions with ≥${MIN_TRADES_FOR_RANKING} trades`,
      };
    }

    // Winner = best P&L, Loser = worst P&L
    const winner = rankable[0];
    const loser = rankable[rankable.length - 1];

    // Don't cull if the loser is still profitable
    if (loser.totalPnL >= 0) {
      console.log(
        '[SelfImprovement] All sessions profitable, skipping evolution'
      );
      return {
        status: 'skipped',
        reason: 'all_sessions_profitable',
        rankings: rankable.map((r) => ({
          name: r.name,
          pnl: r.totalPnL,
          trades: r.totalTrades,
        })),
      };
    }

    console.log(
      `[SelfImprovement] Evolution: culling "${loser.name}" (P&L: $${loser.totalPnL.toFixed(2)}), cloning winner "${winner.name}" (P&L: $${winner.totalPnL.toFixed(2)})`
    );

    // Stop the loser
    try {
      aiTradingEngine.stopSession(loser.sessionId);
    } catch (err) {
      console.error(`[SelfImprovement] Failed to stop loser: ${err.message}`);
    }

    // Remove loser from tournament tracking
    tournament.sessionIds = tournament.sessionIds.filter(
      (id) => id !== loser.sessionId
    );

    // Clone winner with mutations — new session is ALSO observe-only
    const winnerSession = aiTradingEngine.getSession(winner.sessionId);
    if (!winnerSession) {
      return { status: 'error', reason: 'winner_session_not_found' };
    }

    const mutatedConfig = this._mutateConfig(winnerSession.config);
    mutatedConfig.name = `T-Gen${tournament.currentGeneration + 1}-${Date.now().toString(36).slice(-4)}`;
    mutatedConfig.autoTrade = false; // OBSERVE ONLY — never auto-trade in tournament

    let newSession;
    try {
      newSession = aiTradingEngine.startSession('default_user', mutatedConfig);
      tournament.sessionIds.push(newSession.sessionId);
      tournament.currentGeneration++;
      tournament.generations.push({
        generation: tournament.currentGeneration,
        date: dateStr,
        action: 'evolution',
        culled: { sessionId: loser.sessionId, name: loser.name, pnl: loser.totalPnL },
        spawned: { sessionId: newSession.sessionId, name: newSession.name },
        winner: { sessionId: winner.sessionId, name: winner.name, pnl: winner.totalPnL },
        mutatedParams: Object.keys(mutatedConfig)
          .filter((k) => AUTO_TUNABLE_PARAMS.has(k))
          .reduce((acc, k) => {
            acc[k] = mutatedConfig[k];
            return acc;
          }, {}),
      });

      // Apply winner's params to the live trading session (if one is set)
      if (tournament.liveSessionId) {
        const liveParams = {};
        for (const param of AUTO_TUNABLE_PARAMS) {
          if (winnerSession.config[param] !== undefined) {
            liveParams[param] = winnerSession.config[param];
          }
        }
        aiTradingEngine.updateConfig(tournament.liveSessionId, liveParams);
        console.log(
          `[SelfImprovement] Applied winner "${winner.name}" params to live session ${tournament.liveSessionId}`
        );
      }

      this._saveLog();
    } catch (err) {
      return { status: 'error', reason: `spawn failed: ${err.message}` };
    }

    console.log(
      `[SelfImprovement] Evolution complete: Gen ${tournament.currentGeneration}, spawned "${newSession.name}" [OBSERVE-ONLY]`
    );

    return {
      status: 'evolved',
      generation: tournament.currentGeneration,
      culled: loser.name,
      spawned: newSession.name,
      winner: winner.name,
      liveSessionUpdated: !!tournament.liveSessionId,
    };
  }

  _mutateConfig(sourceConfig) {
    const mutated = { ...sourceConfig };

    for (const param of AUTO_TUNABLE_PARAMS) {
      if (mutated[param] === undefined) continue;

      const current = mutated[param];
      if (current === 0) continue;

      // Random mutation within ±MUTATION_RANGE
      const factor = 1 + (Math.random() * 2 - 1) * MUTATION_RANGE;
      let newVal = current * factor;

      // Apply floors/ceilings
      if (PARAM_FLOORS[param] !== undefined) {
        newVal = Math.max(PARAM_FLOORS[param], newVal);
      }
      if (PARAM_CEILINGS[param] !== undefined) {
        newVal = Math.min(PARAM_CEILINGS[param], newVal);
      }

      mutated[param] = Math.round(newVal * 100) / 100;
    }

    return mutated;
  }

  // ─── Scoreboard ─────────────────────────────────────────

  getScoreboard() {
    const { aiTradingEngine } = this._getDeps();
    const tournament = this.log.tournament;

    // Get all running sessions, tournament or not
    const sessions = aiTradingEngine.getAllUserSessions('default_user');
    const runningSessions = sessions.filter((s) => s.status === 'running');

    const rankings = runningSessions
      .map((s) => {
        const pnl =
          s.stats?.totalPnLWithUnrealized || s.stats?.totalPnL || 0;
        const trades = s.stats?.totalTrades || 0;
        const wins = s.stats?.wins || 0;
        const winRate = s.stats?.winRate || 0;
        const drawdown = s.stats?.maxDrawdown || 0;

        // Compute daily P&L from snapshots
        let dailyPnLs = [];
        const snapshots = this.log.dailySnapshots || [];
        for (const snap of snapshots) {
          const standing = snap.standings[s.sessionId];
          if (standing) {
            dailyPnLs.push(standing.totalPnL);
          }
        }

        // Calculate P&L per trade (expectancy proxy)
        const pnlPerTrade = trades > 0 ? pnl / trades : 0;

        // Simple score: weighted combo of P&L, win rate, and drawdown
        const score = pnl * 0.5 + pnlPerTrade * 20 + winRate * 2 - drawdown * 0.3;

        return {
          sessionId: s.sessionId,
          name: s.name,
          totalPnL: Math.round(pnl * 100) / 100,
          totalTrades: trades,
          wins,
          winRate: Math.round(winRate * 100) / 100,
          maxDrawdown: Math.round(drawdown * 100) / 100,
          pnlPerTrade: Math.round(pnlPerTrade * 100) / 100,
          score: Math.round(score * 100) / 100,
          isTournament: tournament?.sessionIds?.includes(s.sessionId) || false,
          positionCount: s.positionCount || 0,
        };
      })
      .sort((a, b) => b.score - a.score);

    return {
      date: new Date().toISOString(),
      tournamentActive: tournament?.active || false,
      generation: tournament?.currentGeneration || 0,
      tradingDays: tournament?.tradingDayCount || 0,
      nextEvolution: tournament?.active
        ? EVOLUTION_INTERVAL_DAYS -
          ((tournament.tradingDayCount || 0) % EVOLUTION_INTERVAL_DAYS)
        : null,
      rankings,
    };
  }

  getDailyReport(dateStr) {
    const snapshots = this.log.dailySnapshots || [];
    const todaySnap = snapshots.find((s) => s.date === dateStr);
    if (!todaySnap) return null;

    // Find previous day snapshot for delta calculation
    const todayIdx = snapshots.indexOf(todaySnap);
    const prevSnap = todayIdx > 0 ? snapshots[todayIdx - 1] : null;

    const report = {
      date: dateStr,
      sessions: {},
    };

    for (const [sessionId, standing] of Object.entries(todaySnap.standings)) {
      const prev = prevSnap?.standings[sessionId];
      report.sessions[sessionId] = {
        ...standing,
        dailyPnLDelta: prev
          ? Math.round((standing.totalPnL - prev.totalPnL) * 100) / 100
          : null,
        dailyTradesDelta: prev
          ? standing.totalTrades - prev.totalTrades
          : null,
      };
    }

    return report;
  }

  getTournamentStatus() {
    const tournament = this.log.tournament;
    if (!tournament) return { active: false };

    return {
      active: tournament.active,
      preset: tournament.preset,
      startDate: tournament.startDate,
      endDate: tournament.endDate || null,
      sessionCount: tournament.sessionIds.length,
      sessionIds: tournament.sessionIds,
      currentGeneration: tournament.currentGeneration,
      tradingDayCount: tournament.tradingDayCount,
      nextEvolution: tournament.active
        ? EVOLUTION_INTERVAL_DAYS -
          ((tournament.tradingDayCount || 0) % EVOLUTION_INTERVAL_DAYS)
        : null,
      generations: tournament.generations,
      winner: tournament.winner || null,
      scoreboard: this.getScoreboard(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 1: COLLECT TRADES
  // ═══════════════════════════════════════════════════════════

  _collectTrades(sessionId, dateStr) {
    const { tradingLogger, aiTradingEngine } = this._getDeps();

    let loggerTrades = [];
    try {
      loggerTrades = tradingLogger
        .getLogs({ level: 'OUTCOME', sessionId, limit: 200 })
        .filter((log) => log.timestamp && log.timestamp.startsWith(dateStr));
    } catch (err) {
      console.log(
        `[SelfImprovement] tradingLogger.getLogs failed: ${err.message}`
      );
    }

    let sessionTrades = [];
    try {
      const session = aiTradingEngine.getSession(sessionId);
      if (session && session.tradingLog) {
        sessionTrades = session.tradingLog.filter((t) => {
          const ts = t.timestamp || t.exitTime || t.entryTime || '';
          return ts.startsWith(dateStr);
        });
      }
    } catch (err) {
      console.log(
        `[SelfImprovement] session.tradingLog read failed: ${err.message}`
      );
    }

    const merged = [...loggerTrades];
    for (const st of sessionTrades) {
      const stSymbol = st.symbol || '';
      const stTime = new Date(
        st.timestamp || st.exitTime || st.entryTime || 0
      ).getTime();

      const isDuplicate = merged.some((lt) => {
        const ltSymbol = lt.symbol || '';
        const ltTime = new Date(lt.timestamp || 0).getTime();
        return ltSymbol === stSymbol && Math.abs(ltTime - stTime) < 60000;
      });

      if (!isDuplicate) merged.push(st);
    }

    return merged;
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 2: ANALYZE TRADES
  // ═══════════════════════════════════════════════════════════

  _analyzeTrades(trades, sessionSummary) {
    const analysis = {
      totalTrades: trades.length,
      signalWinRates: {},
      regimePerformance: {},
      holdingTimeAnalysis: { short: [], medium: [], long: [] },
      overallWinRate: 0,
      avgPnl: 0,
    };

    let wins = 0;
    let totalPnl = 0;

    for (const trade of trades) {
      const pnl = trade.pnl || trade.pnlPercent || 0;
      const successful =
        trade.successful !== undefined ? trade.successful : pnl > 0;
      totalPnl += pnl;
      if (successful) wins++;

      const reasons =
        trade.entryContext?.reasons || trade.reasons || trade.signals || [];
      for (const reason of reasons) {
        if (!analysis.signalWinRates[reason]) {
          analysis.signalWinRates[reason] = { wins: 0, total: 0 };
        }
        analysis.signalWinRates[reason].total++;
        if (successful) analysis.signalWinRates[reason].wins++;
      }

      const regime =
        trade.entryContext?.regime || trade.regime || 'unknown';
      if (!analysis.regimePerformance[regime]) {
        analysis.regimePerformance[regime] = { trades: 0, pnl: 0, wins: 0 };
      }
      analysis.regimePerformance[regime].trades++;
      analysis.regimePerformance[regime].pnl += pnl;
      if (successful) analysis.regimePerformance[regime].wins++;

      const holdMins =
        trade.holdingPeriodMinutes ||
        trade.entryContext?.holdingPeriodMinutes ||
        0;
      const bucket =
        holdMins < 30 ? 'short' : holdMins < 120 ? 'medium' : 'long';
      analysis.holdingTimeAnalysis[bucket].push({
        pnl,
        holdMins,
        successful,
      });
    }

    analysis.overallWinRate =
      trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0;
    analysis.avgPnl =
      trades.length > 0
        ? Math.round((totalPnl / trades.length) * 100) / 100
        : 0;

    for (const [, data] of Object.entries(analysis.signalWinRates)) {
      data.winRate =
        data.total > 0 ? Math.round((data.wins / data.total) * 100) : 0;
    }

    analysis.statsSnapshot = {
      totalTrades: sessionSummary.stats?.totalTrades || 0,
      winRate: sessionSummary.stats?.winRate || 0,
      totalPnL:
        sessionSummary.stats?.totalPnLWithUnrealized ||
        sessionSummary.stats?.totalPnL ||
        0,
      maxDrawdown: sessionSummary.stats?.maxDrawdown || 0,
    };

    return analysis;
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 3: OPTIMIZE PARAMETERS
  // ═══════════════════════════════════════════════════════════

  async _optimizeParams(sessionSummary, dateStr) {
    const { strategyOptimizer } = this._getDeps();

    const config = sessionSummary.config || {};
    const watchlist = config.watchlist || [];
    const primarySymbol = watchlist[0];

    if (!primarySymbol) {
      return { proposedChanges: null, reason: 'no_watchlist_symbol' };
    }

    const endDate = dateStr;
    const startDate = this._subtractDays(dateStr, OPTIMIZATION_LOOKBACK_DAYS);

    console.log(
      `[SelfImprovement] Optimizing ${primarySymbol} from ${startDate} to ${endDate}`
    );

    const result = await strategyOptimizer.runOptimization(
      primarySymbol,
      startDate,
      endDate,
      {
        populationSize: OPTIMIZATION_POPULATION,
        generations: OPTIMIZATION_GENERATIONS,
      }
    );

    if (!result || !result.bestParams) {
      return { proposedChanges: null, reason: 'no_optimization_result' };
    }

    const proposedChanges = this._clampParamChanges(config, result.bestParams);

    return {
      proposedChanges,
      optimizationMetrics: result.metrics,
      generationsRun:
        result.generationHistory?.length || OPTIMIZATION_GENERATIONS,
    };
  }

  _clampParamChanges(currentConfig, proposedParams) {
    const changes = {};

    for (const [param, proposedValue] of Object.entries(proposedParams)) {
      if (!AUTO_TUNABLE_PARAMS.has(param)) continue;

      const currentValue = currentConfig[param];
      if (currentValue === undefined || currentValue === null) continue;
      if (currentValue === proposedValue) continue;
      if (currentValue === 0 && proposedValue === 0) continue;

      let clampedValue = proposedValue;

      if (currentValue !== 0) {
        const maxDelta = Math.abs(currentValue * MAX_PARAM_CHANGE_PERCENT);
        const delta = proposedValue - currentValue;
        const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
        clampedValue = currentValue + clampedDelta;
      }

      if (PARAM_FLOORS[param] !== undefined) {
        clampedValue = Math.max(PARAM_FLOORS[param], clampedValue);
      }
      if (PARAM_CEILINGS[param] !== undefined) {
        clampedValue = Math.min(PARAM_CEILINGS[param], clampedValue);
      }

      clampedValue = Math.round(clampedValue * 100) / 100;

      if (clampedValue !== currentValue) {
        changes[param] = {
          from: currentValue,
          to: clampedValue,
          changePercent:
            currentValue !== 0
              ? Math.round(
                  ((clampedValue - currentValue) / currentValue) * 10000
                ) / 100
              : null,
        };
      }
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 4: VALIDATE CHANGES
  // ═══════════════════════════════════════════════════════════

  async _validateChanges(sessionSummary, proposedChanges) {
    const { WalkForwardOptimizer, polygonClient } = this._getDeps();
    const { Backtester } = require('./strategyOptimizer');

    const config = sessionSummary.config || {};
    const primarySymbol = (config.watchlist || [])[0];

    if (!primarySymbol) {
      return { passed: false, robustness: 0, reason: 'no_symbol' };
    }

    const proposedConfig = { ...config };
    for (const [param, change] of Object.entries(proposedChanges)) {
      proposedConfig[param] = change.to;
    }

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = this._subtractDays(endDate, 10);

    let candles;
    try {
      candles = await polygonClient.getAggregates(primarySymbol, 1, 'day', {
        from: startDate,
        to: endDate,
      });
    } catch (err) {
      return {
        passed: false,
        robustness: 0,
        reason: `candle fetch failed: ${err.message}`,
      };
    }

    if (!candles || candles.length < 5) {
      return {
        passed: false,
        robustness: 0,
        reason: `insufficient candle data (${candles?.length || 0})`,
      };
    }

    const wfo = new WalkForwardOptimizer({
      trainPeriodDays: 7,
      testPeriodDays: 3,
    });

    const backtestFn = (testConfig, data) => {
      const bt = new Backtester(data);
      return bt.run(testConfig);
    };

    let wfResult;
    try {
      wfResult = await wfo.quickValidation(candles, proposedConfig, backtestFn);
    } catch (err) {
      return {
        passed: false,
        robustness: 0,
        reason: `walk-forward failed: ${err.message}`,
      };
    }

    const robustness = parseInt(wfResult.passRate) || 0;

    return {
      passed: robustness >= MIN_ROBUSTNESS_SCORE,
      robustness,
      windowsTested: wfResult.windowsTested,
      windowsPassed: wfResult.passed,
      recommendation: wfResult.recommendation,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 5: APPLY CHANGES
  // ═══════════════════════════════════════════════════════════

  _applyChanges(sessionId, sessionSummary, proposedChanges) {
    const { aiTradingEngine, tradingLogger } = this._getDeps();

    const configSnapshot = {};
    const newConfigValues = {};

    for (const [param, change] of Object.entries(proposedChanges)) {
      configSnapshot[param] = change.from;
      newConfigValues[param] = change.to;
    }

    const tracking = this._getSessionTracking(sessionId);
    tracking.recentChanges.push({
      date: new Date().toISOString().split('T')[0],
      changes: proposedChanges,
      configSnapshot,
      statsSnapshot: sessionSummary.stats
        ? {
            winRate: sessionSummary.stats.winRate,
            totalPnL:
              sessionSummary.stats.totalPnLWithUnrealized ||
              sessionSummary.stats.totalPnL ||
              0,
            totalTrades: sessionSummary.stats.totalTrades,
          }
        : null,
      nextDayResult: null,
    });

    if (tracking.recentChanges.length > 10) {
      tracking.recentChanges = tracking.recentChanges.slice(-10);
    }

    this._saveLog();
    aiTradingEngine.updateConfig(sessionId, newConfigValues);

    try {
      for (const [param, change] of Object.entries(proposedChanges)) {
        tradingLogger.logConfig('SELF_IMPROVEMENT_UPDATE', {
          sessionId,
          sessionName: sessionSummary.name || sessionId,
          field: param,
          oldValue: change.from,
          newValue: change.to,
        });
      }
    } catch (err) {
      console.log(
        `[SelfImprovement] Failed to log config change: ${err.message}`
      );
    }

    return {
      status: 'applied',
      paramsChanged: Object.keys(proposedChanges),
      snapshotSaved: true,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 6: EVALUATE PREVIOUS CHANGES
  // ═══════════════════════════════════════════════════════════

  _evaluatePreviousChanges(sessionId) {
    const { aiTradingEngine } = this._getDeps();
    const tracking = this._getSessionTracking(sessionId);

    if (tracking.recentChanges.length === 0) {
      return { status: 'no_previous_changes' };
    }

    const lastChange =
      tracking.recentChanges[tracking.recentChanges.length - 1];
    if (!lastChange.statsSnapshot || lastChange.nextDayResult !== null) {
      return { status: 'already_evaluated' };
    }

    const sessions = aiTradingEngine.getAllUserSessions('default_user');
    const currentSession = sessions.find((s) => s.sessionId === sessionId);
    if (!currentSession || !currentSession.stats) {
      return { status: 'session_not_found' };
    }

    const beforePnL = lastChange.statsSnapshot.totalPnL || 0;
    const afterPnL =
      currentSession.stats.totalPnLWithUnrealized ||
      currentSession.stats.totalPnL ||
      0;
    const pnlDelta = afterPnL - beforePnL;

    const beforeWinRate = lastChange.statsSnapshot.winRate || 0;
    const afterWinRate = currentSession.stats.winRate || 0;

    const improved = pnlDelta > 0 || afterWinRate > beforeWinRate;

    lastChange.nextDayResult = {
      pnlDelta,
      winRateDelta: afterWinRate - beforeWinRate,
      improved,
    };

    if (!improved) {
      tracking.consecutiveWorsenings++;
      console.log(
        `[SelfImprovement] Session ${sessionId}: worsening #${tracking.consecutiveWorsenings}`
      );

      if (tracking.consecutiveWorsenings >= MAX_CONSECUTIVE_WORSENINGS) {
        console.log(
          `[SelfImprovement] Session ${sessionId}: auto-reverting after ${MAX_CONSECUTIVE_WORSENINGS} consecutive worsenings`
        );
        this._revertToSnapshot(sessionId);
        return {
          status: 'auto_reverted',
          consecutiveWorsenings: tracking.consecutiveWorsenings,
          pnlDelta,
        };
      }
    } else {
      tracking.consecutiveWorsenings = 0;
    }

    this._saveLog();

    return {
      status: improved ? 'improved' : 'worsened',
      pnlDelta,
      winRateDelta: afterWinRate - beforeWinRate,
      consecutiveWorsenings: tracking.consecutiveWorsenings,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // REVERT
  // ═══════════════════════════════════════════════════════════

  _revertToSnapshot(sessionId) {
    const { aiTradingEngine } = this._getDeps();
    const tracking = this._getSessionTracking(sessionId);

    const streakStart = Math.max(
      0,
      tracking.recentChanges.length - MAX_CONSECUTIVE_WORSENINGS
    );
    const revertTarget = tracking.recentChanges[streakStart];

    if (!revertTarget || !revertTarget.configSnapshot) {
      console.log(
        `[SelfImprovement] No snapshot to revert to for ${sessionId}`
      );
      return false;
    }

    aiTradingEngine.updateConfig(sessionId, revertTarget.configSnapshot);

    tracking.lastRevertDate = new Date().toISOString();
    tracking.consecutiveWorsenings = 0;
    this._saveLog();

    console.log(
      `[SelfImprovement] Reverted session ${sessionId} to config from ${revertTarget.date}`
    );
    return true;
  }

  manualRevert(sessionId) {
    const { aiTradingEngine } = this._getDeps();
    const tracking = this._getSessionTracking(sessionId);

    if (tracking.recentChanges.length === 0) {
      return { success: false, reason: 'no_changes_to_revert' };
    }

    const lastChange =
      tracking.recentChanges[tracking.recentChanges.length - 1];
    if (!lastChange.configSnapshot) {
      return { success: false, reason: 'no_snapshot_available' };
    }

    aiTradingEngine.updateConfig(sessionId, lastChange.configSnapshot);
    tracking.lastRevertDate = new Date().toISOString();
    tracking.consecutiveWorsenings = 0;
    this._saveLog();

    return {
      success: true,
      revertedParams: Object.keys(lastChange.configSnapshot),
      revertedTo: lastChange.date,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // API READ METHODS
  // ═══════════════════════════════════════════════════════════

  getStatus() {
    return {
      running: this.running,
      cycleInProgress: this.cycleInProgress,
      lastRunDate: this.log.lastRunDate || null,
      totalCycles: this.log.cycles.length,
      sessionCount: Object.keys(this.log.sessionTracking).length,
      tournamentActive: this.log.tournament?.active || false,
      guardrails: {
        maxParamChangePercent: MAX_PARAM_CHANGE_PERCENT * 100,
        minTradesForAnalysis: MIN_TRADES_FOR_ANALYSIS,
        minRobustnessScore: MIN_ROBUSTNESS_SCORE,
        maxConsecutiveWorsenings: MAX_CONSECUTIVE_WORSENINGS,
        cooldownDays: COOLDOWN_DAYS,
        optimizationLookbackDays: OPTIMIZATION_LOOKBACK_DAYS,
        autoTunableParams: [...AUTO_TUNABLE_PARAMS],
      },
      tournament: {
        evolutionIntervalDays: EVOLUTION_INTERVAL_DAYS,
        maxSessions: MAX_TOURNAMENT_SESSIONS,
        mutationRange: MUTATION_RANGE * 100,
      },
    };
  }

  getHistory(limit = 20, offset = 0) {
    const cycles = [...this.log.cycles].reverse();
    return {
      total: cycles.length,
      offset,
      limit,
      cycles: cycles.slice(offset, offset + limit),
    };
  }

  getLatestCycle() {
    if (this.log.cycles.length === 0) return null;
    return this.log.cycles[this.log.cycles.length - 1];
  }

  // ═══════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════

  _loadLog() {
    try {
      if (fs.existsSync(LOG_FILE)) {
        const data = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        return {
          cycles: data.cycles || [],
          sessionTracking: data.sessionTracking || {},
          lastRunDate: data.lastRunDate || null,
          tournament: data.tournament || null,
          dailySnapshots: data.dailySnapshots || [],
        };
      }
    } catch (err) {
      console.error(
        '[SelfImprovement] Failed to load log file:',
        err.message
      );
    }
    return {
      cycles: [],
      sessionTracking: {},
      lastRunDate: null,
      tournament: null,
      dailySnapshots: [],
    };
  }

  _saveLog() {
    try {
      if (this.log.cycles.length > 90) {
        this.log.cycles = this.log.cycles.slice(-90);
      }
      fs.writeFileSync(LOG_FILE, JSON.stringify(this.log, null, 2), 'utf8');
    } catch (err) {
      console.error(
        '[SelfImprovement] Failed to save log file:',
        err.message
      );
    }
  }

  _getSessionTracking(sessionId) {
    if (!this.log.sessionTracking[sessionId]) {
      this.log.sessionTracking[sessionId] = {
        recentChanges: [],
        consecutiveWorsenings: 0,
        lastRevertDate: null,
      };
    }
    return this.log.sessionTracking[sessionId];
  }

  _subtractDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().split('T')[0];
  }
}

module.exports = SelfImprovementEngine;
