/**
 * Regime-Aware Config Store
 *
 * Stores and retrieves strategy configurations based on market regime.
 * Different market conditions require different trading parameters:
 *
 * BULL MARKET:
 * - Wider profit targets (momentum continues)
 * - Standard stop losses
 * - Higher position sizes
 * - Lower confidence threshold (more opportunities)
 *
 * BEAR MARKET:
 * - Tighter profit targets (take profits quickly)
 * - Tighter stop losses
 * - Smaller position sizes
 * - Higher confidence threshold (be selective)
 *
 * SIDEWAYS/CHOPPY:
 * - Very tight targets (mean reversion)
 * - Very tight stops
 * - Minimal position sizes
 * - Very high confidence threshold (most setups fail)
 *
 * Integrates with:
 * - RegimeDetector: Get current market regime
 * - StrategyVersionControl: Get base config, apply regime adjustments
 * - ABTestingEngine: Test regime-specific parameters
 */

const fs = require('fs');
const path = require('path');
const RegimeDetector = require('./regimeDetector');

class RegimeAwareConfigStore {
  constructor(dataDir = path.join(__dirname, '..', 'data')) {
    this.dataDir = dataDir;
    this.configFile = path.join(dataDir, 'regime-configs.json');
    this.regimeDetector = new RegimeDetector();
    this.configs = this.loadConfigs();
  }

  /**
   * Load configs from disk
   */
  loadConfigs() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
        return data.configs || {};
      }
    } catch (error) {
      console.error('Error loading regime configs:', error.message);
    }
    return {};
  }

  /**
   * Save configs to disk
   */
  saveConfigs() {
    try {
      const data = {
        _meta: {
          description: 'Regime-specific strategy configurations',
          lastUpdated: new Date().toISOString(),
          version: '1.0',
        },
        configs: this.configs,
      };
      fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving regime configs:', error.message);
      return false;
    }
  }

  /**
   * Get default regime adjustments
   * These are multipliers/offsets applied to base config
   */
  getDefaultRegimeAdjustments() {
    return {
      bull: {
        description: 'Bull market: momentum, let winners run',
        adjustments: {
          takeProfitMultiplier: 1.25, // 25% wider targets
          stopLossMultiplier: 1.0, // Standard stops
          positionSizeMultiplier: 1.0, // Full position
          confidenceOffset: -5, // Lower threshold (more trades)
          maxHoldingPeriodMultiplier: 1.5, // Can hold longer
        },
        recommendations: [
          'Buy dips to moving average',
          'Use trailing stops to capture trends',
          'Add to winning positions',
        ],
      },
      bear: {
        description: 'Bear market: defensive, take profits quickly',
        adjustments: {
          takeProfitMultiplier: 0.75, // 25% tighter targets
          stopLossMultiplier: 0.8, // 20% tighter stops
          positionSizeMultiplier: 0.6, // 60% of normal size
          confidenceOffset: 10, // Higher threshold (fewer trades)
          maxHoldingPeriodMultiplier: 0.75, // Exit faster
        },
        recommendations: [
          'Take profits quickly',
          'Reduce overall exposure',
          'Consider inverse ETFs',
          'Cash is a position',
        ],
      },
      sideways: {
        description: 'Sideways: mean reversion, very selective',
        adjustments: {
          takeProfitMultiplier: 0.5, // 50% tighter targets
          stopLossMultiplier: 0.5, // 50% tighter stops
          positionSizeMultiplier: 0.4, // 40% of normal size
          confidenceOffset: 20, // Much higher threshold
          maxHoldingPeriodMultiplier: 0.5, // Quick in and out
        },
        recommendations: [
          'Trade only at range extremes',
          'Very small positions',
          'Consider sitting out entirely',
          'Most setups will fail',
        ],
      },
    };
  }

  /**
   * Set regime-specific config for a symbol
   *
   * @param {string} symbol - Symbol (e.g., 'SOXL')
   * @param {string} regime - Market regime (bull, bear, sideways)
   * @param {Object} config - Configuration for this regime
   */
  setRegimeConfig(symbol, regime, config) {
    const symbolKey = symbol.toUpperCase();
    const regimeKey = regime.toLowerCase();

    if (!['bull', 'bear', 'sideways'].includes(regimeKey)) {
      return { success: false, error: 'Invalid regime. Use: bull, bear, or sideways' };
    }

    if (!this.configs[symbolKey]) {
      this.configs[symbolKey] = {
        symbol: symbolKey,
        baseConfig: null,
        regimeConfigs: {},
        useRegimeAdaptation: true,
        createdAt: new Date().toISOString(),
      };
    }

    this.configs[symbolKey].regimeConfigs[regimeKey] = {
      ...config,
      regime: regimeKey,
      updatedAt: new Date().toISOString(),
    };

    this.saveConfigs();

    return {
      success: true,
      message: `Set ${regimeKey} config for ${symbolKey}`,
      config: this.configs[symbolKey].regimeConfigs[regimeKey],
    };
  }

  /**
   * Set base config for a symbol (regime adjustments applied on top)
   */
  setBaseConfig(symbol, config) {
    const symbolKey = symbol.toUpperCase();

    if (!this.configs[symbolKey]) {
      this.configs[symbolKey] = {
        symbol: symbolKey,
        baseConfig: null,
        regimeConfigs: {},
        useRegimeAdaptation: true,
        createdAt: new Date().toISOString(),
      };
    }

    this.configs[symbolKey].baseConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };

    this.saveConfigs();

    return {
      success: true,
      message: `Set base config for ${symbolKey}`,
      config: this.configs[symbolKey].baseConfig,
    };
  }

  /**
   * Get config for a symbol, optionally adjusted for regime
   *
   * @param {string} symbol - Symbol to get config for
   * @param {string|Object} regime - Regime string or regime detection result
   * @param {boolean} applyAdjustments - Whether to apply regime adjustments
   */
  getConfig(symbol, regime = null, applyAdjustments = true) {
    const symbolKey = symbol.toUpperCase();
    const symbolConfig = this.configs[symbolKey];

    // No config stored, return defaults
    if (!symbolConfig) {
      const defaultConfig = this.getDefaultConfig();
      if (regime && applyAdjustments) {
        return this.applyRegimeAdjustments(defaultConfig, this.normalizeRegime(regime));
      }
      return defaultConfig;
    }

    // Get base config or default
    let config = symbolConfig.baseConfig || this.getDefaultConfig();

    // If regime-specific config exists and is preferred, use it directly
    const regimeKey = this.normalizeRegime(regime);
    if (regimeKey && symbolConfig.regimeConfigs[regimeKey]) {
      return {
        ...config,
        ...symbolConfig.regimeConfigs[regimeKey],
        source: 'regime-specific',
        regime: regimeKey,
      };
    }

    // Apply automatic regime adjustments if enabled
    if (regime && applyAdjustments && symbolConfig.useRegimeAdaptation) {
      return this.applyRegimeAdjustments(config, regimeKey);
    }

    return {
      ...config,
      source: 'base',
    };
  }

  /**
   * Get config with live regime detection
   *
   * @param {string} symbol - Symbol to get config for
   * @param {Array} candles - Recent candles for regime detection
   */
  getConfigWithDetection(symbol, candles) {
    // Detect current regime
    const regimeResult = this.regimeDetector.detectRegime(candles);

    // Get appropriate config
    const config = this.getConfig(symbol, regimeResult.regime, true);

    return {
      config,
      regime: regimeResult,
      recommendations: this.getRecommendations(regimeResult.regime),
    };
  }

  /**
   * Apply regime adjustments to a base config
   */
  applyRegimeAdjustments(baseConfig, regime) {
    const adjustments = this.getDefaultRegimeAdjustments()[regime];

    if (!adjustments) {
      return { ...baseConfig, source: 'base', regime: 'unknown' };
    }

    const adjusted = { ...baseConfig };

    // Apply multipliers
    if (adjusted.takeProfitPercent && adjustments.adjustments.takeProfitMultiplier) {
      adjusted.takeProfitPercent = +(
        adjusted.takeProfitPercent * adjustments.adjustments.takeProfitMultiplier
      ).toFixed(2);
    }

    if (adjusted.stopLossPercent && adjustments.adjustments.stopLossMultiplier) {
      adjusted.stopLossPercent = +(
        adjusted.stopLossPercent * adjustments.adjustments.stopLossMultiplier
      ).toFixed(2);
    }

    if (adjusted.positionSizePercent && adjustments.adjustments.positionSizeMultiplier) {
      adjusted.positionSizePercent = +(
        adjusted.positionSizePercent * adjustments.adjustments.positionSizeMultiplier
      ).toFixed(0);
    }

    if (adjusted.minConfidence && adjustments.adjustments.confidenceOffset) {
      adjusted.minConfidence = Math.min(
        95,
        Math.max(50, adjusted.minConfidence + adjustments.adjustments.confidenceOffset)
      );
    }

    if (adjusted.maxHoldingPeriodHours && adjustments.adjustments.maxHoldingPeriodMultiplier) {
      adjusted.maxHoldingPeriodHours = +(
        adjusted.maxHoldingPeriodHours * adjustments.adjustments.maxHoldingPeriodMultiplier
      ).toFixed(1);
    }

    return {
      ...adjusted,
      source: 'regime-adjusted',
      regime,
      adjustmentsApplied: adjustments.adjustments,
      originalConfig: baseConfig,
    };
  }

  /**
   * Normalize regime input (could be string or detection result)
   */
  normalizeRegime(regime) {
    if (!regime) return null;
    if (typeof regime === 'string') return regime.toLowerCase();
    if (typeof regime === 'object' && regime.regime) return regime.regime.toLowerCase();
    return null;
  }

  /**
   * Get recommendations for a regime
   */
  getRecommendations(regime) {
    const adjustments = this.getDefaultRegimeAdjustments()[regime];
    return adjustments ? adjustments.recommendations : [];
  }

  /**
   * Get default trading config
   */
  getDefaultConfig() {
    return {
      takeProfitPercent: 2.0,
      stopLossPercent: 1.0,
      positionSizePercent: 30,
      minConfidence: 70,
      maxHoldingPeriodHours: 6,
      maxPositions: 2,
      entryRsiMin: 30,
      entryRsiMax: 70,
    };
  }

  /**
   * Get all configs for a symbol
   */
  getAllConfigs(symbol) {
    const symbolKey = symbol.toUpperCase();
    const symbolConfig = this.configs[symbolKey];

    if (!symbolConfig) {
      return {
        symbol: symbolKey,
        hasConfig: false,
        baseConfig: this.getDefaultConfig(),
        regimeConfigs: {},
        useRegimeAdaptation: true,
      };
    }

    return {
      symbol: symbolKey,
      hasConfig: true,
      ...symbolConfig,
    };
  }

  /**
   * Enable/disable automatic regime adaptation for a symbol
   */
  setRegimeAdaptation(symbol, enabled) {
    const symbolKey = symbol.toUpperCase();

    if (!this.configs[symbolKey]) {
      this.configs[symbolKey] = {
        symbol: symbolKey,
        baseConfig: null,
        regimeConfigs: {},
        useRegimeAdaptation: enabled,
        createdAt: new Date().toISOString(),
      };
    } else {
      this.configs[symbolKey].useRegimeAdaptation = enabled;
    }

    this.saveConfigs();

    return {
      success: true,
      message: `Regime adaptation ${enabled ? 'enabled' : 'disabled'} for ${symbolKey}`,
    };
  }

  /**
   * Get summary of all stored configs
   */
  getSummary() {
    const symbols = Object.keys(this.configs);

    return {
      totalSymbols: symbols.length,
      symbols: symbols.map(s => ({
        symbol: s,
        hasBaseConfig: !!this.configs[s].baseConfig,
        regimeConfigsCount: Object.keys(this.configs[s].regimeConfigs || {}).length,
        useRegimeAdaptation: this.configs[s].useRegimeAdaptation,
      })),
    };
  }

  /**
   * Preview what config would look like for each regime
   */
  previewRegimeConfigs(symbol) {
    const baseConfig = this.getConfig(symbol, null, false);

    return {
      symbol: symbol.toUpperCase(),
      baseConfig,
      regimePreview: {
        bull: this.applyRegimeAdjustments(baseConfig, 'bull'),
        bear: this.applyRegimeAdjustments(baseConfig, 'bear'),
        sideways: this.applyRegimeAdjustments(baseConfig, 'sideways'),
      },
    };
  }

  /**
   * Bulk set configs for multiple symbols
   */
  bulkSetConfigs(configsArray) {
    const results = [];

    for (const { symbol, baseConfig, regimeConfigs } of configsArray) {
      if (baseConfig) {
        results.push(this.setBaseConfig(symbol, baseConfig));
      }

      if (regimeConfigs) {
        for (const [regime, config] of Object.entries(regimeConfigs)) {
          results.push(this.setRegimeConfig(symbol, regime, config));
        }
      }
    }

    return {
      success: true,
      resultsCount: results.length,
      results,
    };
  }

  /**
   * Export configs for backup
   */
  exportConfigs() {
    return this.configs;
  }

  /**
   * Import configs from backup
   */
  importConfigs(data) {
    try {
      this.configs = { ...this.configs, ...data };
      this.saveConfigs();
      return { success: true, message: 'Configs imported successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete config for a symbol
   */
  deleteConfig(symbol) {
    const symbolKey = symbol.toUpperCase();

    if (!this.configs[symbolKey]) {
      return { success: false, error: `No config found for ${symbolKey}` };
    }

    delete this.configs[symbolKey];
    this.saveConfigs();

    return {
      success: true,
      message: `Deleted config for ${symbolKey}`,
    };
  }
}

module.exports = RegimeAwareConfigStore;
