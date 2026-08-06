/**
 * Semiconductor Sentiment Engine
 *
 * Uses SOXX (iShares Semiconductor ETF) as reference to determine
 * semiconductor sector direction for SOXL/SOXS momentum trading.
 *
 * Features:
 * - Real-time SOXX sentiment calculation
 * - Dynamic thresholds based on intraday volatility
 * - Market phase awareness (open, settle, active, wind-down, close)
 * - Confidence-driven trading signals
 */

const polygonClient = require('./polygonClient');

// ============================================================
// MARKET PHASE TRACKER
// ============================================================

/**
 * Tracks current market phase for semiconductor trading strategy
 * Phases determine when trading is allowed and what actions are permitted
 */
class MarketPhaseTracker {
  constructor() {
    this.phases = {
      PRE_MARKET: {
        start: 4.0,   // 4:00 AM ET
        end: 9.5,     // 9:30 AM ET
        tradingAllowed: false,
        description: 'Pre-market: Observing futures and pre-market activity',
      },
      OPEN: {
        start: 9.5,   // 9:30 AM ET
        end: 9.75,    // 9:45 AM ET
        tradingAllowed: false,
        description: 'Market open: Gathering initial direction data, no trades',
      },
      SETTLE: {
        start: 9.75,  // 9:45 AM ET
        end: 10.0,    // 10:00 AM ET
        tradingAllowed: false,
        description: 'Settling: Confirming direction before trading',
      },
      ACTIVE: {
        start: 10.0,  // 10:00 AM ET
        end: 15.5,    // 3:30 PM ET
        tradingAllowed: true,
        description: 'Active trading: Full trading allowed',
      },
      WIND_DOWN: {
        start: 15.5,  // 3:30 PM ET
        end: 15.917,  // 3:55 PM ET
        tradingAllowed: true,
        exitOnly: true,
        description: 'Wind down: Exit SOXS positions, protect profits',
      },
      CLOSE: {
        start: 15.917, // 3:55 PM ET
        end: 16.0,     // 4:00 PM ET
        tradingAllowed: true,
        forceExit: true,
        description: 'Market close: Force exit all leveraged positions',
      },
      AFTER_HOURS: {
        start: 16.0,  // 4:00 PM ET
        end: 20.0,    // 8:00 PM ET
        tradingAllowed: false,
        description: 'After hours: No trading',
      },
      CLOSED: {
        start: 20.0,  // 8:00 PM ET
        end: 4.0,     // 4:00 AM ET (next day)
        tradingAllowed: false,
        description: 'Market closed',
      },
    };

    // Track last phase for transition detection
    this.lastPhase = null;
  }

  /**
   * Get current Eastern Time as decimal hours
   * @returns {number} Hours in decimal (e.g., 9.5 = 9:30 AM)
   */
  getETTimeDecimal() {
    // Use the IANA tz database (America/New_York) for a DST-correct ET clock.
    // The previous month-based approximation (month>=2 && month<=10) was wrong in
    // the early-Nov / mid-March transition weeks — a real hazard for a strategy
    // that force-exits at 3:55 PM ET.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    let etHours = 0;
    let etMinutes = 0;
    for (const p of parts) {
      if (p.type === 'hour') etHours = parseInt(p.value, 10);
      else if (p.type === 'minute') etMinutes = parseInt(p.value, 10);
    }
    if (etHours === 24) etHours = 0; // some environments render midnight as '24'

    return etHours + etMinutes / 60;
  }

  /**
   * Get current market phase
   * @returns {Object} Phase info with name, settings, and metadata
   */
  getCurrentPhase() {
    const timeDecimal = this.getETTimeDecimal();

    let currentPhase = 'CLOSED';

    // Determine phase based on time
    if (timeDecimal >= 4.0 && timeDecimal < 9.5) {
      currentPhase = 'PRE_MARKET';
    } else if (timeDecimal >= 9.5 && timeDecimal < 9.75) {
      currentPhase = 'OPEN';
    } else if (timeDecimal >= 9.75 && timeDecimal < 10.0) {
      currentPhase = 'SETTLE';
    } else if (timeDecimal >= 10.0 && timeDecimal < 15.5) {
      currentPhase = 'ACTIVE';
    } else if (timeDecimal >= 15.5 && timeDecimal < 15.917) {
      currentPhase = 'WIND_DOWN';
    } else if (timeDecimal >= 15.917 && timeDecimal < 16.0) {
      currentPhase = 'CLOSE';
    } else if (timeDecimal >= 16.0 && timeDecimal < 20.0) {
      currentPhase = 'AFTER_HOURS';
    }

    const phaseInfo = this.phases[currentPhase];
    const isTransition = this.lastPhase !== null && this.lastPhase !== currentPhase;

    const result = {
      phase: currentPhase,
      ...phaseInfo,
      currentTimeET: timeDecimal,
      isTransition,
      previousPhase: isTransition ? this.lastPhase : null,
    };

    // Update last phase
    this.lastPhase = currentPhase;

    return result;
  }

  /**
   * Check if a position can be entered for a given symbol
   * @param {string} symbol - Symbol to check (SOXL or SOXS)
   * @returns {Object} { allowed: boolean, reason: string|null }
   */
  canEnterPosition(symbol) {
    const phase = this.getCurrentPhase();

    // Never enter in exit-only or force-exit phases
    if (phase.forceExit) {
      return { allowed: false, reason: `${phase.phase}: Force exit phase - no new positions` };
    }

    if (phase.exitOnly) {
      return { allowed: false, reason: `${phase.phase}: Exit-only phase - no new positions` };
    }

    // Don't enter during observation phases
    if (!phase.tradingAllowed) {
      return { allowed: false, reason: `${phase.phase}: ${phase.description}` };
    }

    // Special rule: SOXS should have early cutoff (2:30 PM) to avoid decay
    if (symbol && symbol.toUpperCase() === 'SOXS') {
      if (phase.currentTimeET >= 14.5) {
        return {
          allowed: false,
          reason: 'SOXS: No new positions after 2:30 PM ET (volatility decay risk)',
        };
      }
    }

    return { allowed: true, reason: null };
  }

  /**
   * Check if a position should be force-exited
   * @param {string} symbol - Symbol to check
   * @returns {Object} { shouldExit: boolean, reason: string|null }
   */
  shouldForceExit(symbol) {
    const phase = this.getCurrentPhase();

    if (phase.forceExit) {
      return { shouldExit: true, reason: `${phase.phase}: Force exit all leveraged positions` };
    }

    // SOXS special handling in wind-down
    if (phase.exitOnly && symbol && symbol.toUpperCase() === 'SOXS') {
      return { shouldExit: true, reason: `${phase.phase}: Exit SOXS before close (decay protection)` };
    }

    return { shouldExit: false, reason: null };
  }
}

// ============================================================
// SEMICONDUCTOR SENTIMENT ENGINE
// ============================================================

/**
 * Analyzes SOXX to determine semiconductor sector sentiment
 * Provides confidence-weighted direction signals for SOXL/SOXS trading
 */
class SemiconductorSentimentEngine {
  constructor(options = {}) {
    // Reference symbols (parameterized for reuse with other sectors)
    this.referenceSymbol = options.referenceSymbol || 'SOXX';
    this.bullSymbol = options.bullSymbol || 'SOXL';
    this.bearSymbol = options.bearSymbol || 'SOXS';

    // Cache for sentiment data
    this.sentimentCache = null;
    this.lastUpdate = null;
    this.cacheTTL = options.cacheTTL || 30000; // 30 seconds default

    // Track direction changes for AI trigger
    this.lastDirection = null;

    // Configuration
    this.config = {
      // Confidence thresholds
      minConfidenceToTrade: 55,  // Lowered from 60 for more responsiveness
      highConfidence: 75,        // Lowered from 80
      switchConfidence: 70,      // Lowered from 80 to allow mid-day switches

      // Dynamic threshold base values (will be scaled by volatility)
      baseEntryThreshold: 0.35,  // Lowered from 0.5% - more sensitive
      baseExitThreshold: 0.2,    // Lowered from 0.3%

      // Volatility scaling
      volatilityMultiplier: 1.2, // Reduced from 1.5 - less threshold inflation
      minThreshold: 0.15,        // Floor: 0.15% (was 0.2%)
      maxThreshold: 1.5,         // Ceiling: 1.5% (was 2.0%)

      ...options,
    };

    // Market phase tracker
    this.phaseTracker = new MarketPhaseTracker();
  }

  /**
   * Calculate intraday volatility from candles (ATR-based)
   * @param {Array} candles - Array of OHLCV candles
   * @returns {number} Volatility as decimal (0.01 = 1%)
   */
  calculateIntradayVolatility(candles) {
    if (!candles || candles.length < 5) {
      return 0.01; // Default 1%
    }

    // Calculate average true range as percentage
    const ranges = candles.map(c => {
      const high = c.high || c.h;
      const low = c.low || c.l;
      const close = c.close || c.c;
      return (high - low) / close;
    });

    return ranges.reduce((a, b) => a + b, 0) / ranges.length;
  }

  /**
   * Calculate dynamic thresholds based on intraday volatility
   * @param {number} volatility - Volatility as decimal
   * @returns {Object} Thresholds for entry, exit, and switching
   */
  calculateDynamicThresholds(volatility) {
    const { baseEntryThreshold, volatilityMultiplier, minThreshold, maxThreshold } = this.config;

    // Scale base threshold by volatility
    const scaled = baseEntryThreshold * (1 + volatility * volatilityMultiplier * 100);

    const entryThreshold = Math.max(minThreshold, Math.min(maxThreshold, scaled));

    return {
      entry: entryThreshold,
      exit: Math.max(minThreshold * 0.6, entryThreshold * 0.6),
      switchDirection: entryThreshold * 1.5, // Need larger move to switch mid-day
    };
  }

  /**
   * Derive short-term trend + volume ratio from OHLCV candles. Feeds signals 5
   * (trend confirm ±8) and 6 (volume confirm ±5) in analyzeDirection(). Uses only
   * the candles already fetched — no extra network call.
   * @param {Array} candles - full candle set (5-min, ~72h)
   * @param {Array} intradayCandles - today's candles (preferred when ≥20 bars)
   * @returns {{ shortTermTrend: string|null, volumeRatio: number|null }}
   */
  computeTechnicalData(candles, intradayCandles) {
    const bars =
      intradayCandles && intradayCandles.length >= 20 ? intradayCandles : candles || [];
    const closes = bars.map(c => c.close ?? c.c).filter(Number.isFinite);
    const vols = bars.map(c => c.volume ?? c.v).filter(v => Number.isFinite(v) && v > 0);

    // EMA helper (runs over the whole series, returns the final value).
    const ema = (arr, period) => {
      const k = 2 / (period + 1);
      let e = arr[0];
      for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
      return e;
    };

    // Short-term trend: EMA9 vs EMA21 over the recent window, with a 0.1%
    // deadband so a flat tape reads 'sideways' rather than flip-flopping.
    let shortTermTrend = null;
    if (closes.length >= 21) {
      const recent = closes.slice(-40);
      const ema9 = ema(recent, 9);
      const ema21 = ema(recent, 21);
      if (ema9 > ema21 * 1.001) shortTermTrend = 'bullish';
      else if (ema9 < ema21 * 0.999) shortTermTrend = 'bearish';
      else shortTermTrend = 'sideways';
    }

    // Volume ratio: recent (last 5 bars) avg vs overall avg.
    let volumeRatio = null;
    if (vols.length >= 10) {
      const overallAvg = vols.reduce((a, b) => a + b, 0) / vols.length;
      const recentVols = vols.slice(-5);
      const recentAvg = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
      if (overallAvg > 0) volumeRatio = recentAvg / overallAvg;
    }

    return { shortTermTrend, volumeRatio };
  }

  /**
   * Analyze direction from intraday change and calculate confidence
   * @param {number} intradayChange - Intraday change as percentage
   * @param {Object} thresholds - Dynamic thresholds
   * @param {Object} technicalData - Optional technical indicators
   * @param {Object} momentumData - Rolling momentum and reversal data
   * @returns {Object} Direction analysis with confidence
   */
  analyzeDirection(intradayChange, thresholds, technicalData = {}, momentumData = {}) {
    let direction = 'neutral';
    let confidence = 50;
    const signals = [];

    const {
      rollingMomentum = 0,
      dropFromHigh = 0,
      riseFromLow = 0,
      totalRange = 0,
    } = momentumData;

    // Use a lower effective threshold for better sensitivity
    const effectiveThreshold = thresholds.entry * 0.7; // 30% more sensitive

    // Signal 1: Intraday direction from open (30% weight)
    if (intradayChange > effectiveThreshold) {
      direction = 'bullish';
      confidence += 15;
      signals.push(`SOXX up ${intradayChange.toFixed(2)}% from open`);
    } else if (intradayChange < -effectiveThreshold) {
      direction = 'bearish';
      confidence += 15;
      signals.push(`SOXX down ${Math.abs(intradayChange).toFixed(2)}% from open`);
    } else {
      signals.push(`SOXX ${intradayChange >= 0 ? '+' : ''}${intradayChange.toFixed(2)}% from open`);
    }

    // Signal 2: Rolling momentum - recent direction (25% weight) - THIS IS KEY
    const momentumThreshold = effectiveThreshold * 0.6; // Even more sensitive for momentum
    if (rollingMomentum > momentumThreshold) {
      if (direction !== 'bearish') direction = 'bullish';
      confidence += 12;
      signals.push(`Bullish momentum: +${rollingMomentum.toFixed(2)}% last 75min`);
    } else if (rollingMomentum < -momentumThreshold) {
      if (direction !== 'bullish') direction = 'bearish';
      confidence += 12;
      signals.push(`Bearish momentum: ${rollingMomentum.toFixed(2)}% last 75min`);
    }

    // Signal 3: Reversal detection (25% weight) - CRITICAL FOR CATCHING DIRECTION CHANGES
    // If price dropped significantly from high, that's bearish even if we're only slightly down from open
    if (totalRange > 1.0) { // Only check if there's been meaningful range
      if (dropFromHigh < -totalRange * 0.6) {
        // Price is in bottom 40% of range - bearish
        direction = 'bearish';
        confidence += 12;
        signals.push(`Reversal: ${dropFromHigh.toFixed(2)}% from high (range: ${totalRange.toFixed(2)}%)`);
      } else if (riseFromLow > totalRange * 0.6) {
        // Price is in top 40% of range - bullish
        direction = 'bullish';
        confidence += 12;
        signals.push(`Recovery: +${riseFromLow.toFixed(2)}% from low (range: ${totalRange.toFixed(2)}%)`);
      }
    }

    // Signal 4: Strong momentum confirmation (20% weight)
    if (Math.abs(intradayChange) > thresholds.entry * 1.5) {
      confidence += 10;
      signals.push('Strong directional move');
    } else if (Math.abs(rollingMomentum) > thresholds.entry) {
      confidence += 5;
      signals.push('Building momentum');
    }

    // Signal 5: Technical confirmation if available
    if (technicalData.shortTermTrend) {
      if (
        (direction === 'bullish' && technicalData.shortTermTrend === 'bullish') ||
        (direction === 'bearish' && technicalData.shortTermTrend === 'bearish')
      ) {
        confidence += 8;
        signals.push(`Trend confirms ${direction}`);
      } else if (technicalData.shortTermTrend !== 'sideways' && direction !== 'neutral') {
        confidence -= 5;
        signals.push(`Trend conflicts (${technicalData.shortTermTrend})`);
      }
    }

    // Signal 6: Volume confirmation if available
    if (technicalData.volumeRatio) {
      if (technicalData.volumeRatio > 1.5) {
        confidence += 5;
        signals.push(`High volume (${technicalData.volumeRatio.toFixed(1)}x avg)`);
      } else if (technicalData.volumeRatio < 0.7) {
        confidence -= 3;
        signals.push(`Low volume`);
      }
    }

    // ── Reversal reconciliation ──────────────────────────────────────────────
    // The signals above can leave `direction` anchored to the day's NET move (up
    // from open) even as the RECENT trend rolls over — projecting false confidence
    // (a contradicting momentum reading even added confidence above). Reconcile it:
    // on a conflict, damp the confidence and flag it MIXED; on a strong, CONFIRMED
    // reversal, neutralize the call to CASH rather than fight the tape.
    const revDown = rollingMomentum < -momentumThreshold; // recent momentum fading
    const revUp = rollingMomentum > momentumThreshold;
    const trendDown = technicalData.shortTermTrend === 'bearish';
    const trendUp = technicalData.shortTermTrend === 'bullish';
    // "confirmed" = momentum past 1.5× its threshold AND (technical trend agrees OR
    // price sits in the bottom/top of the day's range — not merely bounced off it).
    const strongDown =
      rollingMomentum < -momentumThreshold * 1.5 &&
      (trendDown || (totalRange > 1.0 && dropFromHigh < -totalRange * 0.5 && riseFromLow < totalRange * 0.4));
    const strongUp =
      rollingMomentum > momentumThreshold * 1.5 &&
      (trendUp || (totalRange > 1.0 && riseFromLow > totalRange * 0.5 && dropFromHigh > -totalRange * 0.4));

    let conflict = false;
    let reversalOverride = false;
    if (direction === 'bullish' && (revDown || trendDown)) conflict = true;
    else if (direction === 'bearish' && (revUp || trendUp)) conflict = true;

    if (conflict) {
      if ((direction === 'bullish' && strongDown) || (direction === 'bearish' && strongUp)) {
        // Strong, confirmed reversal — stand down rather than buy into the fade.
        reversalOverride = true;
        signals.push(
          `⚠ Reversal: ${direction} from open overridden by momentum ${rollingMomentum.toFixed(2)}%${technicalData.shortTermTrend ? ` + ${technicalData.shortTermTrend} trend` : ''} → NEUTRAL`
        );
        direction = 'neutral';
        confidence = Math.min(confidence, 35);
      } else {
        // Mixed but not a clean reversal — keep the direction, kill the false confidence.
        signals.push('⚠ Mixed: up from open but momentum/trend fading — confidence damped');
        confidence = Math.min(confidence, 42) - 8;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Ensure confidence is within bounds
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));

    return {
      direction,
      confidence,
      signals,
      conflict,
      reversalOverride,
      momentumData: {
        rollingMomentum: rollingMomentum.toFixed(2) + '%',
        dropFromHigh: dropFromHigh.toFixed(2) + '%',
        riseFromLow: riseFromLow.toFixed(2) + '%',
        totalRange: totalRange.toFixed(2) + '%',
      },
      recommendedSymbol:
        direction === 'bullish'
          ? this.bullSymbol
          : direction === 'bearish'
            ? this.bearSymbol
            : 'CASH',
      canTrade: confidence >= this.config.minConfidenceToTrade,
      highConfidence: confidence >= this.config.highConfidence,
      canSwitch: confidence >= this.config.switchConfidence,
    };
  }

  /**
   * Get current semiconductor sentiment
   * @param {boolean} forceRefresh - Bypass cache
   * @returns {Promise<Object>} Sentiment data with direction, confidence, and signals
   */
  async getSentiment(forceRefresh = false) {
    // Return cached if valid and not forcing refresh
    if (!forceRefresh && this.sentimentCache && Date.now() - this.lastUpdate < this.cacheTTL) {
      return this.sentimentCache;
    }

    const now = new Date();

    try {
      // Fetch SOXX data (5-min candles for last 72h)
      // 72h lookback ensures Monday morning has Friday's data available
      // instead of waiting ~100 min for 20 fresh candles to accumulate
      const candles = await polygonClient.getAggregates(
        this.referenceSymbol,
        5,
        'minute',
        {
          from: new Date(Date.now() - 72 * 60 * 60 * 1000),
          to: now,
        }
      );

      if (!candles || candles.length < 20) {
        console.warn('[Semiconductor Sentiment] Insufficient SOXX data');
        return {
          error: 'Insufficient SOXX data',
          direction: 'neutral',
          confidence: 0,
          canTrade: false,
          timestamp: now.toISOString(),
        };
      }

      // Get today's candles (market hours)
      const todayStart = new Date(now);
      todayStart.setHours(9, 30, 0, 0); // 9:30 AM

      const intradayCandles = candles.filter(c => {
        const candleTime = new Date(c.timestamp || c.t);
        return candleTime >= todayStart;
      });

      // Calculate basic metrics
      const openPrice = intradayCandles[0]?.open || intradayCandles[0]?.o || candles[candles.length - 1].close || candles[candles.length - 1].c;
      const currentCandle = candles[candles.length - 1];
      const currentPrice = currentCandle.close || currentCandle.c;
      const intradayChange = ((currentPrice - openPrice) / openPrice) * 100;

      // Calculate high/low of day for reversal detection
      let dayHigh = openPrice;
      let dayLow = openPrice;
      intradayCandles.forEach(c => {
        const high = c.high || c.h;
        const low = c.low || c.l;
        if (high > dayHigh) dayHigh = high;
        if (low < dayLow) dayLow = low;
      });

      // Calculate reversal metrics
      const dropFromHigh = ((currentPrice - dayHigh) / dayHigh) * 100; // Negative if below high
      const riseFromLow = ((currentPrice - dayLow) / dayLow) * 100;    // Positive if above low
      const totalRange = ((dayHigh - dayLow) / openPrice) * 100;       // Total intraday range

      // Calculate rolling momentum (last 15 bars = ~75 minutes of 5-min candles)
      // Uses EMA-smoothed prices to reduce jitter from 2-point calculation
      const recentBars = candles.slice(-15);
      let rollingMomentum = 0;
      if (recentBars.length >= 5) {
        // EMA smoothing: k = 2/(N+1) where N = bar count
        const k = 2 / (recentBars.length + 1);
        let ema = recentBars[0].close || recentBars[0].c;
        const emaValues = [ema];
        for (let i = 1; i < recentBars.length; i++) {
          const price = recentBars[i].close || recentBars[i].c;
          ema = price * k + ema * (1 - k);
          emaValues.push(ema);
        }
        // Momentum from smoothed start to smoothed end
        const emaStart = emaValues[0];
        const emaEnd = emaValues[emaValues.length - 1];
        rollingMomentum = ((emaEnd - emaStart) / emaStart) * 100;
      }

      // Calculate volatility
      const volatility = this.calculateIntradayVolatility(intradayCandles.length > 5 ? intradayCandles : candles.slice(-50));

      // Calculate dynamic thresholds
      const thresholds = this.calculateDynamicThresholds(volatility);

      // Build momentum data for smarter analysis
      const momentumData = {
        intradayChange,
        rollingMomentum,
        dropFromHigh,
        riseFromLow,
        totalRange,
        dayHigh,
        dayLow,
        currentPrice,
        openPrice,
      };

      // Derive short-term trend + volume confirmation from the candles we already
      // have, so signals 5 & 6 in analyzeDirection() actually fire (previously
      // passed {} → those two confirmations were dead code).
      const technicalData = this.computeTechnicalData(candles, intradayCandles);

      // Analyze direction with momentum + technical data
      const analysis = this.analyzeDirection(intradayChange, thresholds, technicalData, momentumData);

      // Check for direction change (triggers AI analysis)
      const directionChanged = this.lastDirection !== null && this.lastDirection !== analysis.direction;
      this.lastDirection = analysis.direction;

      // Get current market phase
      const phase = this.phaseTracker.getCurrentPhase();

      // Build sentiment result
      this.sentimentCache = {
        timestamp: now.toISOString(),
        referenceSymbol: this.referenceSymbol,
        currentPrice: currentPrice.toFixed(2),
        openPrice: openPrice.toFixed(2),
        intradayChange: `${intradayChange >= 0 ? '+' : ''}${intradayChange.toFixed(2)}%`,
        intradayChangeRaw: intradayChange,
        volatility: (volatility * 100).toFixed(2) + '%',
        volatilityRaw: volatility,
        thresholds: {
          entry: thresholds.entry.toFixed(2) + '%',
          exit: thresholds.exit.toFixed(2) + '%',
          switch: thresholds.switchDirection.toFixed(2) + '%',
          entryRaw: thresholds.entry,
          exitRaw: thresholds.exit,
          switchRaw: thresholds.switchDirection,
        },
        ...analysis,
        directionChanged,
        phase: phase.phase,
        phaseDescription: phase.description,
        tradingAllowed: phase.tradingAllowed,
        isPhaseTransition: phase.isTransition,
      };

      this.lastUpdate = Date.now();
      return this.sentimentCache;
    } catch (error) {
      console.error('[Semiconductor Sentiment] Error fetching sentiment:', error.message);

      // Stale-while-error: a transient Polygon DNS hiccup should not slam the
      // market gate shut. If we have a recent cached sentiment, return it
      // marked as stale rather than degrading to confidence: 0. Only fall
      // through to the hard-fail response if no usable cache exists.
      const STALE_TOLERANCE_MS = 30 * 60 * 1000; // 30 min
      if (
        this.sentimentCache &&
        this.lastUpdate &&
        Date.now() - this.lastUpdate < STALE_TOLERANCE_MS
      ) {
        return {
          ...this.sentimentCache,
          stale: true,
          staleReason: error.message,
          timestamp: now.toISOString(),
        };
      }

      return {
        error: error.message,
        direction: 'neutral',
        confidence: 0,
        canTrade: false,
        timestamp: now.toISOString(),
      };
    }
  }

  /**
   * Check if AI analysis should be triggered
   * Triggered on: phase transitions, direction changes
   * @param {Object} sentiment - Current sentiment data
   * @returns {Object} { shouldTrigger: boolean, reason: string }
   */
  shouldTriggerAIAnalysis(sentiment) {
    if (!sentiment) {
      return { shouldTrigger: false, reason: 'No sentiment data' };
    }

    // Trigger on phase transitions
    if (sentiment.isPhaseTransition) {
      return {
        shouldTrigger: true,
        reason: `Phase transition: ${sentiment.phase}`,
        trigger: 'phase_transition',
      };
    }

    // Trigger on direction changes
    if (sentiment.directionChanged) {
      return {
        shouldTrigger: true,
        reason: `Direction changed to ${sentiment.direction}`,
        trigger: 'direction_change',
      };
    }

    return { shouldTrigger: false, reason: 'No trigger condition met' };
  }

  /**
   * Get market phase info
   * @returns {Object} Current phase information
   */
  getMarketPhase() {
    return this.phaseTracker.getCurrentPhase();
  }

  /**
   * Check if entry is allowed for a symbol
   * @param {string} symbol - Symbol to check
   * @returns {Object} { allowed: boolean, reason: string|null }
   */
  canEnterPosition(symbol) {
    return this.phaseTracker.canEnterPosition(symbol);
  }

  /**
   * Check if position should be force-exited
   * @param {string} symbol - Symbol to check
   * @returns {Object} { shouldExit: boolean, reason: string|null }
   */
  shouldForceExit(symbol) {
    return this.phaseTracker.shouldForceExit(symbol);
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache() {
    this.sentimentCache = null;
    this.lastUpdate = null;
    this.lastDirection = null;
  }
}

// Export singleton instances
const sentimentEngine = new SemiconductorSentimentEngine();
const phaseTracker = new MarketPhaseTracker();

// ---------------------------------------------------------------------------
// SENTIMENT_MODEL — read-only DESCRIPTOR of the direction/confidence model.
//
// The live threshold config is already readable at runtime via
// `sentimentEngine.config` (minConfidenceToTrade, highConfidence, baseEntry, …),
// so the System Map reads that directly. What has NO data form in the code are
// the six confidence weights inside analyzeDirection() — they are inline
// `confidence += N` literals. This object documents them so the transparency
// snapshot is complete. It does NOT drive analyzeDirection(); if you change a
// weight there, update this object in the same edit.
const SENTIMENT_MODEL = Object.freeze({
  // Direction starts neutral at 50 confidence; each signal nudges it.
  baseConfidence: 50,
  // Effective entry threshold is thresholds.entry * 0.7 (30% more sensitive).
  effectiveThresholdMult: 0.7,
  signals: Object.freeze([
    { key: 'intradayDirection', points: 15, weightLabel: '30%', note: 'move from open beyond effective threshold' },
    { key: 'rollingMomentum', points: 12, weightLabel: '25%', note: 'recent 75-min direction' },
    { key: 'reversal', points: 12, weightLabel: '25%', note: 'position within intraday range (drop-from-high / rise-from-low)' },
    { key: 'strongMove', points: 10, weightLabel: '20%', note: '+5 for building momentum' },
    { key: 'technicalTrend', points: 8, weightLabel: '±', note: '-5 when short-term trend conflicts' },
    { key: 'volumeConfirm', points: 5, weightLabel: '±', note: '-3 on low volume' },
  ]),
});

module.exports = {
  SemiconductorSentimentEngine,
  MarketPhaseTracker,
  sentimentEngine,
  phaseTracker,
  SENTIMENT_MODEL,
};
