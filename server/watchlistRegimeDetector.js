/**
 * Watchlist-Based Market Regime Detector
 *
 * Uses a watchlist of correlated symbols to determine overall market conditions.
 * More reliable than single-symbol detection because:
 *
 * 1. Filters out single-stock noise (earnings, news, etc.)
 * 2. Confirms broad market trends vs isolated moves
 * 3. Identifies sector rotation patterns
 * 4. Detects divergences that predict regime changes
 *
 * Default watchlist includes:
 * - Broad market (SPY, QQQ)
 * - Volatility (VIX)
 * - Sector leaders (AAPL, NVDA, MSFT)
 * - Leveraged (SOXL, TQQQ)
 */

const RegimeDetector = require('./regimeDetector');

class WatchlistRegimeDetector {
  constructor(options = {}) {
    this.singleSymbolDetector = new RegimeDetector(options);

    // Default watchlist - user can customize
    this.watchlist = options.watchlist || {
      // Market indices (highest weight)
      indices: {
        symbols: ['SPY', 'QQQ', 'IWM'],
        weight: 3,
        description: 'Broad market direction',
      },
      // Volatility (inverse indicator)
      volatility: {
        symbols: ['VIX'],
        weight: 2,
        isInverse: true, // High VIX = bearish signal
        description: 'Fear/uncertainty gauge',
      },
      // Sector leaders
      leaders: {
        symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL'],
        weight: 2,
        description: 'Tech leadership confirmation',
      },
      // Leveraged ETFs (amplified moves)
      leveraged: {
        symbols: ['SOXL', 'TQQQ'],
        weight: 1,
        description: 'Momentum confirmation',
      },
    };

    this.config = {
      minSymbolsRequired: options.minSymbolsRequired || 3, // Min symbols needed for valid detection
      consensusThreshold: options.consensusThreshold || 0.6, // 60% agreement for strong signal
      divergenceThreshold: options.divergenceThreshold || 0.3, // 30% disagreement = caution
      ...options,
    };
  }

  /**
   * Detect market regime using watchlist data
   *
   * @param {Object} symbolData - Map of symbol -> candles data
   *   e.g., { SPY: [...candles], QQQ: [...candles], ... }
   * @returns {Object} Market regime analysis
   */
  detectMarketRegime(symbolData) {
    if (!symbolData || Object.keys(symbolData).length === 0) {
      return {
        regime: 'unknown',
        confidence: 0,
        error: 'No symbol data provided',
      };
    }

    const symbolResults = [];
    let totalWeight = 0;

    // Analyze each watchlist category
    for (const [category, config] of Object.entries(this.watchlist)) {
      for (const symbol of config.symbols) {
        const candles = symbolData[symbol];
        if (!candles || candles.length < 50) continue;

        const result = this.singleSymbolDetector.detectRegime(candles);
        if (result.regime === 'unknown') continue;

        // For VIX (inverse), flip the regime
        let regime = result.regime;
        if (config.isInverse) {
          regime = result.regime === 'bull' ? 'bear' : result.regime === 'bear' ? 'bull' : 'sideways';
        }

        symbolResults.push({
          symbol,
          category,
          weight: config.weight,
          regime,
          confidence: result.confidence,
          indicators: result.indicators,
          isInverse: config.isInverse || false,
        });

        totalWeight += config.weight;
      }
    }

    if (symbolResults.length < this.config.minSymbolsRequired) {
      return {
        regime: 'unknown',
        confidence: 0,
        error: `Insufficient data: only ${symbolResults.length} symbols analyzable, need ${this.config.minSymbolsRequired}`,
        availableSymbols: symbolResults.map(r => r.symbol),
      };
    }

    // Calculate weighted consensus
    const regimeVotes = { bull: 0, bear: 0, sideways: 0 };

    for (const result of symbolResults) {
      const weightedVote = result.weight * (result.confidence / 100);
      regimeVotes[result.regime] += weightedVote;
    }

    // Normalize votes
    const totalVotes = Object.values(regimeVotes).reduce((a, b) => a + b, 0);
    const normalizedVotes = {
      bull: regimeVotes.bull / totalVotes,
      bear: regimeVotes.bear / totalVotes,
      sideways: regimeVotes.sideways / totalVotes,
    };

    // Determine consensus regime
    const sortedRegimes = Object.entries(normalizedVotes).sort((a, b) => b[1] - a[1]);
    const [primaryRegime, primaryShare] = sortedRegimes[0];
    const [secondaryRegime, secondaryShare] = sortedRegimes[1];

    // Calculate overall confidence
    let confidence;
    let signalStrength;
    let description;

    if (primaryShare >= this.config.consensusThreshold) {
      confidence = Math.round(primaryShare * 100);
      signalStrength = 'strong';
      description = `Strong ${primaryRegime} consensus: ${(primaryShare * 100).toFixed(0)}% of watchlist agrees`;
    } else if (primaryShare >= 0.45) {
      confidence = Math.round(primaryShare * 85);
      signalStrength = 'moderate';
      description = `Moderate ${primaryRegime} signal: ${(primaryShare * 100).toFixed(0)}% agreement, ${(secondaryShare * 100).toFixed(0)}% ${secondaryRegime}`;
    } else {
      confidence = Math.round(primaryShare * 60);
      signalStrength = 'weak';
      description = `Mixed signals: ${(primaryShare * 100).toFixed(0)}% ${primaryRegime}, ${(secondaryShare * 100).toFixed(0)}% ${secondaryRegime}`;
    }

    // Check for divergences
    const divergences = this.detectDivergences(symbolResults);

    // Category breakdown
    const categoryBreakdown = this.getCategoryBreakdown(symbolResults);

    return {
      regime: primaryRegime,
      confidence,
      signalStrength,
      description,
      breakdown: {
        votes: normalizedVotes,
        symbolCount: symbolResults.length,
        totalWeight,
      },
      categoryBreakdown,
      divergences,
      symbolDetails: symbolResults,
      recommendations: this.getRecommendations(primaryRegime, signalStrength, divergences),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Detect divergences between categories
   * Divergences can predict regime changes
   */
  detectDivergences(symbolResults) {
    const divergences = [];

    // Group by category
    const categories = {};
    for (const result of symbolResults) {
      if (!categories[result.category]) {
        categories[result.category] = [];
      }
      categories[result.category].push(result);
    }

    // Check for category vs category divergences
    const catRegimes = {};
    for (const [category, results] of Object.entries(categories)) {
      const regimeCounts = { bull: 0, bear: 0, sideways: 0 };
      for (const r of results) {
        regimeCounts[r.regime]++;
      }
      catRegimes[category] = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0][0];
    }

    // Indices vs Leaders divergence
    if (catRegimes.indices && catRegimes.leaders && catRegimes.indices !== catRegimes.leaders) {
      divergences.push({
        type: 'indices_vs_leaders',
        severity: 'warning',
        message: `Indices are ${catRegimes.indices} but leaders are ${catRegimes.leaders}`,
        implication: 'Potential rotation or trend exhaustion',
      });
    }

    // Volatility divergence (VIX not confirming move)
    if (catRegimes.indices && catRegimes.volatility) {
      // Note: VIX regime is already inverted
      if (catRegimes.indices === 'bull' && catRegimes.volatility === 'bull') {
        // VIX bullish (inverted) = low volatility, good for bull market
      } else if (catRegimes.indices === 'bull' && catRegimes.volatility !== 'bull') {
        divergences.push({
          type: 'volatility_warning',
          severity: 'caution',
          message: 'VIX not confirming bullish move',
          implication: 'Hidden risk - consider smaller positions',
        });
      }
    }

    // Leveraged vs indices divergence
    if (catRegimes.indices && catRegimes.leveraged && catRegimes.indices !== catRegimes.leveraged) {
      divergences.push({
        type: 'momentum_divergence',
        severity: 'info',
        message: `Indices ${catRegimes.indices} but leveraged ETFs ${catRegimes.leveraged}`,
        implication: 'Momentum may be shifting',
      });
    }

    return divergences;
  }

  /**
   * Get category-level breakdown
   */
  getCategoryBreakdown(symbolResults) {
    const breakdown = {};

    for (const [category, config] of Object.entries(this.watchlist)) {
      const categoryResults = symbolResults.filter(r => r.category === category);
      if (categoryResults.length === 0) {
        breakdown[category] = { status: 'no_data', description: config.description };
        continue;
      }

      const regimeCounts = { bull: 0, bear: 0, sideways: 0 };
      let totalConfidence = 0;

      for (const r of categoryResults) {
        regimeCounts[r.regime]++;
        totalConfidence += r.confidence;
      }

      const dominantRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0][0];
      const avgConfidence = Math.round(totalConfidence / categoryResults.length);

      breakdown[category] = {
        regime: dominantRegime,
        confidence: avgConfidence,
        symbols: categoryResults.map(r => ({ symbol: r.symbol, regime: r.regime })),
        description: config.description,
      };
    }

    return breakdown;
  }

  /**
   * Get trading recommendations based on regime analysis
   */
  getRecommendations(regime, signalStrength, divergences) {
    const recommendations = [];

    // Base recommendations for regime
    const regimeRecs = {
      bull: [
        'Look for pullbacks to moving averages as entry points',
        'Use wider profit targets to capture trends',
        'Trail stops to lock in gains',
      ],
      bear: [
        'Take profits quickly - don\'t let winners turn to losers',
        'Use tighter stops',
        'Consider reducing position sizes',
        'Be very selective with entries',
      ],
      sideways: [
        'Trade only at range extremes',
        'Use very tight profit targets',
        'Consider sitting out until trend develops',
        'Most momentum setups will fail',
      ],
    };

    recommendations.push(...(regimeRecs[regime] || regimeRecs.sideways));

    // Adjust for signal strength
    if (signalStrength === 'weak') {
      recommendations.unshift('CAUTION: Mixed signals - reduce position sizes');
    } else if (signalStrength === 'strong') {
      recommendations.unshift(`Strong ${regime} environment - higher confidence entries`);
    }

    // Add divergence warnings
    for (const div of divergences) {
      if (div.severity === 'warning') {
        recommendations.push(`WARNING: ${div.implication}`);
      }
    }

    return recommendations;
  }

  /**
   * Quick regime check for a single trading day
   * Uses pre-market or early session data to classify the day
   *
   * @param {Object} symbolData - Intraday candles for watchlist symbols
   * @param {string} timeframe - 'premarket' | 'first_hour' | 'morning'
   */
  detectIntradayRegime(symbolData, timeframe = 'first_hour') {
    // For intraday, we focus on:
    // 1. Gap direction (open vs previous close)
    // 2. First hour momentum
    // 3. Volume patterns

    const results = [];

    for (const [symbol, candles] of Object.entries(symbolData)) {
      if (!candles || candles.length < 10) continue;

      // Calculate session metrics
      const firstCandle = candles[0];
      const latestCandle = candles[candles.length - 1];

      const sessionReturn = ((latestCandle.close - firstCandle.open) / firstCandle.open) * 100;
      const highOfDay = Math.max(...candles.map(c => c.high));
      const lowOfDay = Math.min(...candles.map(c => c.low));
      const range = ((highOfDay - lowOfDay) / firstCandle.open) * 100;

      // Determine intraday regime
      let regime;
      if (sessionReturn > 0.5 && latestCandle.close > (highOfDay + lowOfDay) / 2) {
        regime = 'bull';
      } else if (sessionReturn < -0.5 && latestCandle.close < (highOfDay + lowOfDay) / 2) {
        regime = 'bear';
      } else {
        regime = 'sideways';
      }

      results.push({
        symbol,
        regime,
        sessionReturn: sessionReturn.toFixed(2) + '%',
        range: range.toFixed(2) + '%',
        currentPrice: latestCandle.close,
      });
    }

    if (results.length === 0) {
      return { regime: 'unknown', error: 'No intraday data available' };
    }

    // Calculate consensus
    const regimeCounts = { bull: 0, bear: 0, sideways: 0 };
    for (const r of results) {
      regimeCounts[r.regime]++;
    }

    const total = results.length;
    const dominantRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0][0];
    const consensus = regimeCounts[dominantRegime] / total;

    return {
      regime: dominantRegime,
      confidence: Math.round(consensus * 100),
      timeframe,
      breakdown: {
        bull: `${regimeCounts.bull}/${total}`,
        bear: `${regimeCounts.bear}/${total}`,
        sideways: `${regimeCounts.sideways}/${total}`,
      },
      symbolDetails: results,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get historical day classifications
   * Useful for training and validation
   *
   * @param {Object} historicalData - { symbol: { [date]: candles } }
   * @param {Array} dates - Dates to classify
   */
  classifyDays(historicalData, dates) {
    const classifications = [];

    for (const date of dates) {
      const dayData = {};

      for (const [symbol, dateMap] of Object.entries(historicalData)) {
        if (dateMap[date]) {
          dayData[symbol] = dateMap[date];
        }
      }

      if (Object.keys(dayData).length >= this.config.minSymbolsRequired) {
        const classification = this.detectIntradayRegime(dayData);
        classifications.push({
          date,
          ...classification,
        });
      }
    }

    return classifications;
  }

  /**
   * Add symbol to watchlist
   */
  addToWatchlist(symbol, category = 'custom') {
    if (!this.watchlist[category]) {
      this.watchlist[category] = {
        symbols: [],
        weight: 1,
        description: 'Custom watchlist symbols',
      };
    }

    if (!this.watchlist[category].symbols.includes(symbol)) {
      this.watchlist[category].symbols.push(symbol);
    }

    return this.watchlist;
  }

  /**
   * Remove symbol from watchlist
   */
  removeFromWatchlist(symbol, category = null) {
    for (const [cat, config] of Object.entries(this.watchlist)) {
      if (category && cat !== category) continue;
      const idx = config.symbols.indexOf(symbol);
      if (idx !== -1) {
        config.symbols.splice(idx, 1);
      }
    }

    return this.watchlist;
  }

  /**
   * Get current watchlist
   */
  getWatchlist() {
    return this.watchlist;
  }

  /**
   * Set custom watchlist
   */
  setWatchlist(watchlist) {
    this.watchlist = watchlist;
    return this.watchlist;
  }
}

module.exports = WatchlistRegimeDetector;
