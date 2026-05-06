/**
 * Leveraged ETF Strategy
 *
 * Specialized strategy for trading leveraged ETF families:
 * - QBTS family: QBTS (base), QBTX (2x bull), QBTZ (2x bear)
 * - SOX/SOXX family: SOXX (base), SOXL (3x bull), SOXS (3x bear)
 * - PLTR family: PLTR (base), PLTU (2x bull), PLTZ (2x bear)
 *
 * This strategy combines:
 * 1. Technical regime detection (momentum, MA, ADX)
 * 2. Options flow sentiment (from CheddarFlow)
 * 3. Leveraged ETF selection based on combined signals
 */

class LeveragedEtfStrategy {
  constructor() {
    // Supported ETF families
    this.families = {
      QBTS: {
        base: 'QBTS',
        name: 'Defiance Quantum ETF',
        bull: { symbol: 'QBTX', leverage: '2x', name: 'T-Rex 2X Long MSTR Daily Target ETF' },
        bear: { symbol: 'QBTZ', leverage: '2x', name: 'T-Rex 2X Inverse MSTR Daily Target ETF' },
      },
      SOXX: {
        base: 'SOXX',
        name: 'iShares Semiconductor ETF',
        bull: { symbol: 'SOXL', leverage: '3x', name: 'Direxion Daily Semiconductor Bull 3X' },
        bear: { symbol: 'SOXS', leverage: '3x', name: 'Direxion Daily Semiconductor Bear 3X' },
      },
      PLTR: {
        base: 'PLTR',
        name: 'Palantir Technologies',
        bull: { symbol: 'PLTU', leverage: '2x', name: 'T-Rex 2X Long Palantir Daily Target ETF' },
        bear: { symbol: 'PLTZ', leverage: '2x', name: 'T-Rex 2X Inverse Palantir Daily Target ETF' },
      },
    };

    // Signal weights for decision making
    this.weights = {
      technicalRegime: 0.4,    // 40% weight to technical analysis
      flowSentiment: 0.4,      // 40% weight to options flow
      momentum: 0.2,           // 20% weight to short-term momentum
    };

    // Thresholds
    this.thresholds = {
      putCallRatioBullish: 0.5,   // Below 0.5 = bullish flow
      putCallRatioBearish: 1.2,   // Above 1.2 = bearish flow
      flowConfidenceMin: 70,       // Minimum flow confidence to act
      combinedConfidenceMin: 60,   // Minimum combined confidence to trade
    };
  }

  /**
   * Get all supported families
   */
  getSupportedFamilies() {
    return Object.keys(this.families).map(key => ({
      baseSymbol: key,
      ...this.families[key],
    }));
  }

  /**
   * Get family by base symbol or any family member
   */
  getFamily(symbol) {
    const upperSymbol = symbol.toUpperCase();

    // Check if it's a base symbol
    if (this.families[upperSymbol]) {
      return { baseSymbol: upperSymbol, ...this.families[upperSymbol] };
    }

    // Check if it's a bull or bear variant
    for (const [base, family] of Object.entries(this.families)) {
      if (family.bull.symbol === upperSymbol || family.bear.symbol === upperSymbol) {
        return { baseSymbol: base, ...family };
      }
    }

    return null;
  }

  /**
   * Check if a symbol is part of a supported family
   */
  isSupported(symbol) {
    return this.getFamily(symbol) !== null;
  }

  /**
   * Analyze flow sentiment data from CheddarFlow
   * @param {Object} flowData - Data from CheddarFlow scraper
   */
  analyzeFlowSentiment(flowData) {
    if (!flowData) {
      return {
        sentiment: 'neutral',
        confidence: 0,
        reason: 'No flow data available',
      };
    }

    const {
      putCallRatio,
      callFlow,
      putFlow,
      callFlowPercent,
      putFlowPercent,
      sentimentText
    } = flowData;

    let sentiment = 'neutral';
    let confidence = 50;
    let reasons = [];

    // Analyze put/call ratio
    if (putCallRatio !== undefined) {
      if (putCallRatio < this.thresholds.putCallRatioBullish) {
        sentiment = 'bullish';
        confidence += 20;
        reasons.push(`Put/Call ratio ${putCallRatio.toFixed(2)} indicates bullish flow`);
      } else if (putCallRatio > this.thresholds.putCallRatioBearish) {
        sentiment = 'bearish';
        confidence += 20;
        reasons.push(`Put/Call ratio ${putCallRatio.toFixed(2)} indicates bearish flow`);
      } else {
        reasons.push(`Put/Call ratio ${putCallRatio.toFixed(2)} is neutral`);
      }
    }

    // Analyze flow percentages
    if (callFlowPercent !== undefined && putFlowPercent !== undefined) {
      if (callFlowPercent > 80) {
        if (sentiment !== 'bearish') sentiment = 'bullish';
        confidence += 15;
        reasons.push(`${callFlowPercent.toFixed(1)}% call flow is extremely bullish`);
      } else if (putFlowPercent > 60) {
        if (sentiment !== 'bullish') sentiment = 'bearish';
        confidence += 15;
        reasons.push(`${putFlowPercent.toFixed(1)}% put flow is bearish`);
      }
    }

    // Check sentiment text from CheddarFlow
    if (sentimentText) {
      const lowerSentiment = sentimentText.toLowerCase();
      if (lowerSentiment.includes('bullish') && sentiment !== 'bearish') {
        sentiment = 'bullish';
        confidence += 10;
        reasons.push(`CheddarFlow sentiment: ${sentimentText}`);
      } else if (lowerSentiment.includes('bearish') && sentiment !== 'bullish') {
        sentiment = 'bearish';
        confidence += 10;
        reasons.push(`CheddarFlow sentiment: ${sentimentText}`);
      }
    }

    // Analyze total flow volume
    if (callFlow && putFlow) {
      const totalFlow = callFlow + putFlow;
      if (totalFlow > 1000000) {
        confidence += 5; // High volume = more reliable signal
        reasons.push(`High options volume ($${(totalFlow / 1000000).toFixed(1)}M)`);
      }
    }

    return {
      sentiment,
      confidence: Math.min(95, confidence),
      reasons,
      rawData: flowData,
    };
  }

  /**
   * Combine technical regime and flow sentiment to make trading decision
   * @param {Object} technicalRegime - From regimeDetector
   * @param {Object} flowSentiment - From analyzeFlowSentiment
   * @param {Object} family - ETF family info
   */
  makeDecision(technicalRegime, flowSentiment, family) {
    if (!family) {
      return {
        action: 'SKIP',
        reason: 'Symbol not in supported leveraged ETF families',
      };
    }

    // Convert regimes to numeric scores
    const regimeScores = {
      bull: 1,
      sideways: 0,
      bear: -1,
    };

    const sentimentScores = {
      bullish: 1,
      neutral: 0,
      bearish: -1,
    };

    const technicalScore = regimeScores[technicalRegime.regime] || 0;
    const flowScore = sentimentScores[flowSentiment.sentiment] || 0;

    // Calculate weighted combined score
    const combinedScore =
      (technicalScore * this.weights.technicalRegime) +
      (flowScore * this.weights.flowSentiment);

    // Calculate combined confidence
    const combinedConfidence =
      (technicalRegime.confidence * this.weights.technicalRegime) +
      (flowSentiment.confidence * this.weights.flowSentiment) +
      (Math.abs(combinedScore) * 20); // Boost confidence when signals agree

    // Determine action
    let action, symbol, direction, reason;
    const reasons = [];

    if (combinedScore > 0.3 && combinedConfidence >= this.thresholds.combinedConfidenceMin) {
      action = 'BUY_BULL';
      symbol = family.bull.symbol;
      direction = 'long';
      reasons.push(`Bullish signals (score: ${combinedScore.toFixed(2)})`);
      reasons.push(`Technical: ${technicalRegime.regime} (${technicalRegime.confidence}%)`);
      reasons.push(`Flow: ${flowSentiment.sentiment} (${flowSentiment.confidence}%)`);
    } else if (combinedScore < -0.3 && combinedConfidence >= this.thresholds.combinedConfidenceMin) {
      action = 'BUY_BEAR';
      symbol = family.bear.symbol;
      direction = 'short';
      reasons.push(`Bearish signals (score: ${combinedScore.toFixed(2)})`);
      reasons.push(`Technical: ${technicalRegime.regime} (${technicalRegime.confidence}%)`);
      reasons.push(`Flow: ${flowSentiment.sentiment} (${flowSentiment.confidence}%)`);
    } else if (Math.abs(combinedScore) <= 0.3) {
      action = 'STAY_CASH';
      symbol = 'CASH';
      direction = 'neutral';
      reasons.push('Mixed signals - stay in cash');
      reasons.push(`Technical: ${technicalRegime.regime}, Flow: ${flowSentiment.sentiment}`);
    } else {
      action = 'STAY_CASH';
      symbol = 'CASH';
      direction = 'neutral';
      reasons.push(`Low confidence (${combinedConfidence.toFixed(0)}%)`);
    }

    // Check for conflicting signals (warning)
    const signalsConflict =
      (technicalScore > 0 && flowScore < 0) ||
      (technicalScore < 0 && flowScore > 0);

    return {
      action,
      symbol,
      direction,
      leverage: symbol !== 'CASH' ? (direction === 'long' ? family.bull.leverage : family.bear.leverage) : 'none',
      family,
      combinedScore,
      combinedConfidence: Math.round(combinedConfidence),
      signalsConflict,
      reasons,
      breakdown: {
        technical: {
          regime: technicalRegime.regime,
          confidence: technicalRegime.confidence,
          score: technicalScore,
          weight: this.weights.technicalRegime,
        },
        flow: {
          sentiment: flowSentiment.sentiment,
          confidence: flowSentiment.confidence,
          score: flowScore,
          weight: this.weights.flowSentiment,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get position sizing recommendation based on confidence and leverage
   */
  getPositionSizing(decision, accountValue, riskPercent = 2) {
    if (decision.action === 'STAY_CASH') {
      return { shares: 0, value: 0, reason: 'No position - staying in cash' };
    }

    // Reduce position size for leveraged ETFs
    const leverageMultiplier = parseFloat(decision.leverage) || 1;
    const adjustedRisk = riskPercent / leverageMultiplier;

    // Further reduce if signals conflict
    const conflictMultiplier = decision.signalsConflict ? 0.5 : 1;

    // Confidence-based sizing (higher confidence = larger position)
    const confidenceMultiplier = Math.min(1, decision.combinedConfidence / 80);

    const positionPercent = adjustedRisk * conflictMultiplier * confidenceMultiplier;
    const positionValue = accountValue * (positionPercent / 100);

    return {
      positionPercent,
      positionValue,
      leverageMultiplier,
      effectiveExposure: positionPercent * leverageMultiplier,
      reason: `${positionPercent.toFixed(1)}% position (${decision.leverage} leverage = ${(positionPercent * leverageMultiplier).toFixed(1)}% effective exposure)`,
    };
  }
}

module.exports = LeveragedEtfStrategy;
