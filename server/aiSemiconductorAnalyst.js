/**
 * AI Semiconductor Analyst
 *
 * Uses Claude to analyze semiconductor sector sentiment and provide
 * trading direction recommendations for SOXL/SOXS strategy.
 *
 * Triggered on:
 * - Market open (9:30 AM) - Initial direction assessment
 * - After settle phase (10:00 AM) - Confirm or adjust direction
 * - On sentiment direction change - Validate the switch
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getSemiContext } = require('./semiMarketContext');

// Render the live market-context pack into a compact, model-friendly block.
// Mirrors the reads shown to the human on the Command Center so the AI reasons
// over the SAME data. Returns '' when no context is available.
function formatContext(ctx) {
  if (!ctx) return 'Live market context: unavailable (reasoning from summary only).\n';
  const fx = (v, d = 1) => (v == null || !Number.isFinite(v) ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
  const daysFromToday = iso => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    const today = new Date();
    const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    return Math.round((Date.UTC(y, m - 1, d) - t0) / 86400000);
  };
  const rel = n => (n == null ? '' : n <= 0 ? 'today' : n === 1 ? 'in 1d' : `in ${n}d`);

  const lines = [];
  const asOf = ctx.asOf ? new Date(ctx.asOf).toLocaleTimeString('en-US', { timeZone: 'America/New_York' }) : '';
  lines.push(`Live market context (as of ${asOf} ET${ctx.stale ? ', STALE' : ''}):`);

  const b = ctx.breadth;
  if (b && b.scored) {
    lines.push(
      `- SOXX breadth: ${b.up} up / ${b.down} down of ${b.scored} (${b.pctGreen != null ? b.pctGreen.toFixed(0) : 'n/a'}% green, ${b.wPctGreen != null ? b.wPctGreen.toFixed(0) : 'n/a'}% by weight)`
    );
    lines.push(
      `- Concentration: NVDA/AVGO/AMD = ${(b.megaShare * 100).toFixed(0)}% of the move (${b.narrow ? 'NARROW — mega-cap led, fragile if they roll' : 'broad-based'})`
    );
  }
  if (Array.isArray(ctx.rotation) && ctx.rotation.length) {
    lines.push(`- Sub-sector rotation (weighted): ${ctx.rotation.map(r => `${r.name} ${fx(r.pct, 2)}`).join(', ')}`);
  }

  const m = ctx.macro;
  if (m) {
    if (Array.isArray(m.items)) {
      lines.push(`- Macro (day%): ${m.items.map(i => `${i.label} ${fx(i.pct)}`).join(', ')}`);
    }
    lines.push(
      `- Regime: ${m.regime} · Semis vs Tech (SMH−QQQ): ${fx(m.spread, 2)} ${m.spread == null ? '' : m.spread >= 0 ? '(leading)' : '(lagging)'} · VIX: ${m.vixConfirm}${m.safeHaven ? ' · safe-haven bid (caution)' : ''}`
    );
  }

  const e = ctx.earnings;
  if (e) {
    const up = (e.upcoming || []).slice(0, 5);
    if (up.length) {
      const imminent = up.filter(u => {
        const n = daysFromToday(u.date);
        return n != null && n <= 2;
      });
      lines.push(
        `- Upcoming SOXX earnings: ${up.map(u => `${u.sym} ${rel(daysFromToday(u.date))}${u.expectedMovePct != null ? ` (±${u.expectedMovePct.toFixed(1)}%)` : ''}`).join(', ')}`
      );
      if (imminent.length) {
        lines.push(`  ⚠ EVENT RISK — reporting within 48h: ${imminent.map(u => u.sym).join(', ')}`);
      }
    }
    const past = e.past || [];
    if (past.length) {
      const upN = past.filter(p => p.reaction1d != null && p.reaction1d > 0).length;
      const downN = past.filter(p => p.reaction1d != null && p.reaction1d < 0).length;
      const notable = past
        .slice(0, 4)
        .map(p => `${p.sym} ${fx(p.reaction1d)}${p.beat == null ? '' : p.beat ? ' beat' : ' miss'}`)
        .join(', ');
      lines.push(`- Recent earnings reactions: ${upN} up / ${downN} down of ${upN + downN} (${notable})`);
    }
  }

  return lines.join('\n') + '\n';
}

// Render the extra intel we now surface on the card but weren't feeding the model:
// the reversal-reconciliation verdict, sub-sector rotation OVER TIME (30d vs a
// quarter, to catch late-cycle rotation), and the pre-registered predictors' own
// track records (so the model calibrates its conviction to real hit-rates).
function formatExtra(x) {
  if (!x) return '';
  const fx = (v, d = 0) => (v == null || !Number.isFinite(v) ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
  const lines = [];

  if (x.reversalOverride) {
    lines.push(
      '- ⚠ REVERSAL RECONCILIATION: a CONFIRMED intraday reversal has overridden the from-open direction to NEUTRAL (recent momentum + technical trend both turned). Do NOT recommend the faded direction — a contrarian directional call here is high-risk; lean neutral with a negative adjustment.'
    );
  } else if (x.conflict) {
    lines.push(
      "- ⚠ SIGNAL CONFLICT: the day's net move disagrees with recent momentum / the technical trend (fading). Treat directional conviction as LOW."
    );
  }

  const rot = (h, label) => {
    if (!h || !Array.isArray(h.sectors) || !h.sectors.length) return;
    const lead = h.sectors[0];
    const lag = h.sectors[h.sectors.length - 1];
    const beat = h.sectors.filter(s => s.vsSpy > 0).length;
    lines.push(`- Rotation ${label}: ${lead.name} ${fx(lead.cum)} leads · ${lag.name} ${fx(lag.cum)} lags · ${beat}/${h.sectors.length} beat SPY`);
  };
  rot(x.sectorHist30, '30d');
  rot(x.sectorHistQ, '1Q (quarter)');
  // Late-cycle rotation: a sector that led the quarter but is now near the bottom
  // over 30d is rolling over — a bearish tell the daily snapshot alone can't show.
  if (x.sectorHist30?.sectors?.length && x.sectorHistQ?.sectors?.length) {
    const qLeader = x.sectorHistQ.sectors[0].name;
    const rank30 = x.sectorHist30.sectors.findIndex(s => s.name === qLeader);
    if (rank30 >= x.sectorHist30.sectors.length - 2) {
      lines.push(`  → ${qLeader} led the quarter but is now near the bottom over 30d (rolling over — late-cycle rotation).`);
    }
  }

  const tr = (s, label) => {
    if (s && s.directional > 0) {
      lines.push(`- ${label} predictor track record: ${(s.accuracy * 100).toFixed(0)}% over ${s.directional}${s.brier != null ? `, Brier ${s.brier.toFixed(2)}` : ''} — calibrate your conviction to this (near coin-flip ⇒ stay humble).`);
    }
  };
  tr(x.hStats, 'Hourly');
  tr(x.dStats, 'Next-day');

  if (!lines.length) return '';
  return 'Reconciliation, rotation cycle & model track record:\n' + lines.join('\n') + '\n';
}

class AISemiconductorAnalyst {
  constructor(options = {}) {
    // Initialize Anthropic client
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Analysis cache
    this.analysisCache = null;
    this.lastAnalysis = null;
    this.lastTrigger = null;

    // Configuration
    this.config = {
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 512,
      ...options,
    };

    // Track if API is available
    this.apiAvailable = !!process.env.ANTHROPIC_API_KEY;

    if (!this.apiAvailable) {
      console.warn('[AI Semiconductor Analyst] ANTHROPIC_API_KEY not set - AI analysis disabled');
    }
  }

  /**
   * Build system prompt for semiconductor analysis
   * @returns {string} System prompt
   */
  buildSystemPrompt() {
    return `You are a semiconductor sector analyst for an automated trading system.
Your job is to assess semiconductor market conditions and provide a trading direction recommendation.

You are analyzing data to determine whether to trade:
- SOXL (3x Bull Semiconductor ETF) on bullish days
- SOXS (3x Bear Semiconductor ETF) on bearish days

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "direction": "bullish" | "bearish" | "neutral",
  "confidenceAdjustment": <integer from -20 to +20>,
  "reasoning": "<1-2 sentence explanation>",
  "keyFactors": ["<factor1>", "<factor2>"],
  "riskLevel": "low" | "medium" | "high",
  "holdDuration": "intraday" | "swing" | "avoid"
}

Guidelines:
- confidenceAdjustment adjusts the base technical confidence by -20 to +20 points
- Use positive adjustment when the provided data corroborates the direction
- Use negative adjustment when the data is mixed, contradictory, or risky
- "avoid" holdDuration means skip trading entirely due to high risk
- You are given REAL live data below: SOXX breadth (advance/decline + concentration),
  sub-sector rotation, macro cross-asset (indices, VIX, gold, rates, dollar),
  a risk regime, the semis-vs-tech spread, and the SOXX earnings calendar with
  recent reactions. Ground your reasoning in THESE numbers — cite them in
  keyFactors — do not speculate about data you were not given.
- Narrow breadth (mega-cap-led) is fragile; broad breadth is more durable.
- If a heavyweight (esp. NVDA/AVGO/AMD) reports within ~48h, treat direction as
  higher-risk (elevated gap risk on a 3x ETF) → lean neutral / negative adjustment.
- A diverging VIX or semis lagging the broad tape argues against conviction.
- CRITICAL — weigh RECENT momentum and the technical trend, not just the day's net
  move: a broad up-day that is rolling over (negative recent momentum, price fading
  off the high, a bearish technical regime) is NOT a bullish entry. The "Direction"
  you are given is already AFTER a reversal-reconciliation pass. If a REVERSAL
  RECONCILIATION or SIGNAL CONFLICT note appears below, RESPECT it: do not recommend
  the faded direction — recommend neutral with a negative adjustment. Do not let a
  green breadth number override a confirmed reversal.
- Use the sub-sector rotation OVER TIME: a sector that led the quarter but is now
  lagging over 30d is rolling over (late-cycle) — a bearish tell.
- Use the predictor track records to calibrate conviction: if the models are near
  coin-flip, keep adjustments small and lean neutral.
- Be concise and actionable. If uncertain, recommend "neutral" with a negative adjustment.`;
  }

  /**
   * Build user message with current market data
   * @param {Object} marketData - Current semiconductor sentiment data
   * @param {string} trigger - What triggered this analysis
   * @returns {string} User message
   */
  buildUserMessage(marketData, trigger, context = null, extra = null) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York' });

    return `Semiconductor Market Analysis Request

Trigger: ${trigger}
Time: ${timeStr} ET

SOXX (Semiconductor ETF) Status:
- Current Price: $${marketData.currentPrice || 'N/A'}
- Open Price: $${marketData.openPrice || 'N/A'}
- Intraday Change: ${marketData.intradayChange || 'N/A'}
- Volatility: ${marketData.volatility || 'N/A'}

Technical Sentiment:
- Direction: ${marketData.direction || 'unknown'}
- Base Confidence: ${marketData.confidence || 0}%
- Trading Allowed: ${marketData.tradingAllowed ? 'Yes' : 'No'}
- Market Phase: ${marketData.phase || 'unknown'}

Dynamic Thresholds:
- Entry: ${marketData.thresholds?.entry || 'N/A'}
- Switch: ${marketData.thresholds?.switch || 'N/A'}

Signals:
${marketData.signals?.map(s => `- ${s}`).join('\n') || '- No signals'}

${formatContext(context)}${formatExtra(extra)}
Ground your recommendation in ALL the data above — especially any reversal/conflict note. What is your trading recommendation?`;
  }

  /**
   * Parse AI response into structured format
   * @param {string} text - Raw response text
   * @returns {Object} Parsed analysis
   */
  parseResponse(text) {
    try {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Validate required fields
        if (!['bullish', 'bearish', 'neutral'].includes(parsed.direction)) {
          parsed.direction = 'neutral';
        }

        // Clamp confidence adjustment
        parsed.confidenceAdjustment = Math.max(-20, Math.min(20, parseInt(parsed.confidenceAdjustment) || 0));

        // Ensure arrays
        if (!Array.isArray(parsed.keyFactors)) {
          parsed.keyFactors = [];
        }

        // Validate risk level
        if (!['low', 'medium', 'high'].includes(parsed.riskLevel)) {
          parsed.riskLevel = 'medium';
        }

        // Validate hold duration
        if (!['intraday', 'swing', 'avoid'].includes(parsed.holdDuration)) {
          parsed.holdDuration = 'intraday';
        }

        return parsed;
      }

      throw new Error('No valid JSON found in response');
    } catch (error) {
      console.error('[AI Semiconductor Analyst] Failed to parse response:', error.message);
      return {
        direction: 'neutral',
        confidenceAdjustment: -10,
        reasoning: 'Failed to parse AI response',
        keyFactors: ['Parse error'],
        riskLevel: 'high',
        holdDuration: 'avoid',
        parseError: true,
      };
    }
  }

  /**
   * Get AI analysis of semiconductor sector
   * @param {Object} marketData - Current market data (from SemiconductorSentimentEngine)
   * @param {string} trigger - What triggered this analysis (phase_transition, direction_change, manual)
   * @param {Object} [options] - { contextWaitMs } — how long to wait for the live
   *   market-context pack. Trade path uses the short default so a decision never
   *   blocks; user-initiated refreshes pass a larger value to get grounded data.
   * @returns {Promise<Object>} AI analysis with confidence adjustment
   */
  async analyze(marketData, trigger = 'manual', options = {}) {
    // Return cached if same trigger and recent
    if (
      this.analysisCache &&
      this.lastTrigger === trigger &&
      Date.now() - this.lastAnalysis < 60000 // 1 minute cache for same trigger
    ) {
      return this.analysisCache;
    }

    // Check if API is available
    if (!this.apiAvailable) {
      return {
        direction: 'neutral',
        confidenceAdjustment: 0,
        reasoning: 'AI analysis disabled - no API key',
        keyFactors: ['API unavailable'],
        riskLevel: 'medium',
        holdDuration: 'intraday',
        aiDisabled: true,
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[AI Semiconductor Analyst] Running analysis (trigger: ${trigger})`);

    // Assemble the live market-context pack (breadth / rotation / macro / earnings).
    // Guarded + time-boxed inside getSemiContext so it never blocks a trade decision.
    let context = null;
    try {
      context = await getSemiContext({ maxWaitMs: options.contextWaitMs || 2500 });
    } catch {
      context = null;
    }

    // Extra intel now surfaced on the card but previously withheld from the model:
    // the reversal verdict, rotation OVER TIME (30d vs quarter), and the predictors'
    // own track records. Lazy-required to avoid load-order cycles; each guarded so a
    // miss never blocks the analysis.
    const extra = { conflict: !!marketData.conflict, reversalOverride: !!marketData.reversalOverride };
    try {
      const { getSectorHistory } = require('./soxxSectorHistory');
      const [h30, hQ] = await Promise.all([
        getSectorHistory(false, '30d').catch(() => null),
        getSectorHistory(false, '1Q').catch(() => null),
      ]);
      extra.sectorHist30 = h30;
      extra.sectorHistQ = hQ;
    } catch {
      /* rotation-over-time unavailable */
    }
    try {
      const predStore = require('./soxxPredictions');
      extra.hStats = predStore.computeStats(predStore.loadRecent(60));
    } catch {
      /* hourly stats unavailable */
    }
    try {
      const dailyStore = require('./soxxDailyPredictions');
      extra.dStats = dailyStore.computeStats(dailyStore.loadRecent(90));
    } catch {
      /* daily stats unavailable */
    }

    try {
      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: this.buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: this.buildUserMessage(marketData, trigger, context, extra),
          },
        ],
      });

      const text = response.content[0].text;
      const analysis = this.parseResponse(text);

      // Add metadata
      this.analysisCache = {
        ...analysis,
        timestamp: new Date().toISOString(),
        trigger,
        model: this.config.model,
        contextAsOf: context?.asOf || null,
        contextStale: !!context?.stale,
        contextAvailable: !!context,
        inputData: {
          direction: marketData.direction,
          confidence: marketData.confidence,
          intradayChange: marketData.intradayChange,
          phase: marketData.phase,
        },
      };

      this.lastAnalysis = Date.now();
      this.lastTrigger = trigger;

      console.log(
        `[AI Semiconductor Analyst] Analysis complete: ${analysis.direction} (adj: ${analysis.confidenceAdjustment > 0 ? '+' : ''}${analysis.confidenceAdjustment})`
      );

      return this.analysisCache;
    } catch (error) {
      console.error('[AI Semiconductor Analyst] API error:', error.message);

      // Return safe fallback
      return {
        direction: 'neutral',
        confidenceAdjustment: -10,
        reasoning: `AI analysis failed: ${error.message}`,
        keyFactors: ['API error'],
        riskLevel: 'high',
        holdDuration: 'avoid',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Force refresh analysis (bypass cache)
   * @param {Object} marketData - Current market data
   * @param {string} trigger - Trigger reason
   * @returns {Promise<Object>} Fresh AI analysis
   */
  async forceRefresh(marketData, trigger = 'manual_refresh') {
    this.analysisCache = null;
    this.lastAnalysis = null;
    this.lastTrigger = null;
    // User-initiated (button / POST /analyze) — off the trading hot path, so wait
    // long enough for a cold context fetch (~30 SOXX + 9 macro snapshots) to ground it.
    return this.analyze(marketData, trigger, { contextWaitMs: 9000 });
  }

  /**
   * Get cached analysis without making API call
   * @returns {Object|null} Cached analysis or null
   */
  getCached() {
    return this.analysisCache;
  }

  /**
   * Check if AI is available
   * @returns {boolean} True if API key is configured
   */
  isAvailable() {
    return this.apiAvailable;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.analysisCache = null;
    this.lastAnalysis = null;
    this.lastTrigger = null;
  }
}

// Export singleton instance
const aiAnalyst = new AISemiconductorAnalyst();

module.exports = {
  AISemiconductorAnalyst,
  aiAnalyst,
};
