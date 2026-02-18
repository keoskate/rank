/**
 * Strategy Version Control
 *
 * Manages strategy configurations with full version history:
 * - Create new versions with auto-incrementing version numbers
 * - Tag versions (production, staging, testing)
 * - Rollback to previous versions
 * - Compare versions side-by-side
 * - Track performance metrics per version
 *
 * Example:
 *   SOXL-v1 (production): TP=2.5%, SL=1.0% - Current live strategy
 *   SOXL-v2 (staging): TP=3.0%, SL=1.25% - Testing in paper trading
 *   SOXL-v3 (testing): TP=2.0%, SL=0.75% - Backtesting only
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class StrategyVersionControl {
  constructor(dataDir = path.join(__dirname, '..', 'data')) {
    this.dataDir = dataDir;
    this.versionsFile = path.join(dataDir, 'strategy-versions.json');
    this.versions = this.loadVersions();
  }

  /**
   * Load versions from disk
   */
  loadVersions() {
    try {
      if (fs.existsSync(this.versionsFile)) {
        const data = JSON.parse(fs.readFileSync(this.versionsFile, 'utf8'));
        return data.versions || {};
      }
    } catch (error) {
      console.error('Error loading strategy versions:', error.message);
    }
    return {};
  }

  /**
   * Save versions to disk
   */
  saveVersions() {
    try {
      const data = {
        _meta: {
          description: 'Strategy version history for A/B testing and rollback',
          lastUpdated: new Date().toISOString(),
          version: '1.0',
        },
        versions: this.versions,
      };
      fs.writeFileSync(this.versionsFile, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving strategy versions:', error.message);
      return false;
    }
  }

  /**
   * Create a new strategy version
   *
   * @param {string} symbol - Symbol this strategy is for (e.g., 'SOXL')
   * @param {Object} config - Strategy configuration
   * @param {Object} options - Additional options (description, tag, metrics)
   * @returns {Object} The created version
   */
  createVersion(symbol, config, options = {}) {
    const symbolKey = symbol.toUpperCase();

    // Initialize symbol's version history if needed
    if (!this.versions[symbolKey]) {
      this.versions[symbolKey] = {
        symbol: symbolKey,
        versions: [],
        activeVersion: null,
        productionVersion: null,
      };
    }

    const symbolData = this.versions[symbolKey];

    // Calculate next version number
    const existingVersions = symbolData.versions.map(v => v.versionNumber);
    const nextVersion = existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1;

    const version = {
      id: uuidv4(),
      versionNumber: nextVersion,
      versionString: `${symbolKey}-v${nextVersion}`,
      config: { ...config },
      description: options.description || `Version ${nextVersion}`,
      tag: options.tag || 'testing', // testing, staging, production
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy || 'system',
      metrics: options.metrics || null,
      walkForwardResults: options.walkForwardResults || null,
      parentVersion: options.parentVersion || null,
      status: 'active',
    };

    symbolData.versions.push(version);

    // Auto-set as active if it's the first version
    if (!symbolData.activeVersion) {
      symbolData.activeVersion = version.id;
    }

    // Auto-promote to production if tagged
    if (options.tag === 'production') {
      symbolData.productionVersion = version.id;
    }

    this.saveVersions();

    return {
      success: true,
      version,
      message: `Created ${version.versionString}`,
    };
  }

  /**
   * Get all versions for a symbol
   */
  getVersions(symbol) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData) {
      return {
        symbol: symbolKey,
        versions: [],
        activeVersion: null,
        productionVersion: null,
      };
    }

    // Enrich with status information
    const enrichedVersions = symbolData.versions.map(v => ({
      ...v,
      isActive: v.id === symbolData.activeVersion,
      isProduction: v.id === symbolData.productionVersion,
    }));

    return {
      symbol: symbolKey,
      versions: enrichedVersions,
      activeVersion: symbolData.activeVersion,
      productionVersion: symbolData.productionVersion,
      totalVersions: enrichedVersions.length,
    };
  }

  /**
   * Get a specific version by ID or version number
   */
  getVersion(symbol, versionIdentifier) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData) return null;

    // Find by ID or version number
    return symbolData.versions.find(
      v =>
        v.id === versionIdentifier ||
        v.versionNumber === versionIdentifier ||
        v.versionString === versionIdentifier
    );
  }

  /**
   * Get the active version's config for a symbol
   */
  getActiveConfig(symbol) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData || !symbolData.activeVersion) {
      return null;
    }

    const activeVersion = symbolData.versions.find(v => v.id === symbolData.activeVersion);
    return activeVersion ? activeVersion.config : null;
  }

  /**
   * Get the production version's config for a symbol
   */
  getProductionConfig(symbol) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData || !symbolData.productionVersion) {
      return null;
    }

    const prodVersion = symbolData.versions.find(v => v.id === symbolData.productionVersion);
    return prodVersion ? prodVersion.config : null;
  }

  /**
   * Set the active version for a symbol
   */
  setActiveVersion(symbol, versionIdentifier) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData) {
      return { success: false, error: `No versions found for ${symbolKey}` };
    }

    const version = this.getVersion(symbol, versionIdentifier);
    if (!version) {
      return { success: false, error: `Version ${versionIdentifier} not found` };
    }

    symbolData.activeVersion = version.id;
    this.saveVersions();

    return {
      success: true,
      message: `Set ${version.versionString} as active version`,
      version,
    };
  }

  /**
   * Promote a version to production
   */
  promoteToProduction(symbol, versionIdentifier) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData) {
      return { success: false, error: `No versions found for ${symbolKey}` };
    }

    const version = this.getVersion(symbol, versionIdentifier);
    if (!version) {
      return { success: false, error: `Version ${versionIdentifier} not found` };
    }

    // Update tags
    const oldProdVersion = symbolData.versions.find(v => v.id === symbolData.productionVersion);
    if (oldProdVersion) {
      oldProdVersion.tag = 'archived';
    }

    version.tag = 'production';
    version.promotedAt = new Date().toISOString();
    symbolData.productionVersion = version.id;
    symbolData.activeVersion = version.id;

    this.saveVersions();

    return {
      success: true,
      message: `Promoted ${version.versionString} to production`,
      version,
      previousProduction: oldProdVersion?.versionString || null,
    };
  }

  /**
   * Rollback to a previous version
   */
  rollback(symbol, versionIdentifier) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData) {
      return { success: false, error: `No versions found for ${symbolKey}` };
    }

    const version = this.getVersion(symbol, versionIdentifier);
    if (!version) {
      return { success: false, error: `Version ${versionIdentifier} not found` };
    }

    // Create a new version based on the rollback target
    const rollbackResult = this.createVersion(symbol, version.config, {
      description: `Rollback to ${version.versionString}`,
      tag: 'production',
      parentVersion: version.id,
      createdBy: 'rollback',
    });

    if (rollbackResult.success) {
      return {
        success: true,
        message: `Rolled back to ${version.versionString}. Created new version ${rollbackResult.version.versionString}`,
        rolledBackFrom: version.versionString,
        newVersion: rollbackResult.version,
      };
    }

    return rollbackResult;
  }

  /**
   * Update metrics for a version
   */
  updateMetrics(symbol, versionIdentifier, metrics) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData) {
      return { success: false, error: `No versions found for ${symbolKey}` };
    }

    const version = this.getVersion(symbol, versionIdentifier);
    if (!version) {
      return { success: false, error: `Version ${versionIdentifier} not found` };
    }

    // Initialize or update metrics history
    if (!version.metricsHistory) {
      version.metricsHistory = [];
    }

    version.metricsHistory.push({
      timestamp: new Date().toISOString(),
      metrics: { ...metrics },
    });

    // Keep latest as primary metrics
    version.metrics = { ...metrics };
    version.lastMetricsUpdate = new Date().toISOString();

    this.saveVersions();

    return {
      success: true,
      message: `Updated metrics for ${version.versionString}`,
      version,
    };
  }

  /**
   * Compare two versions side-by-side
   */
  compareVersions(symbol, versionA, versionB) {
    const a = this.getVersion(symbol, versionA);
    const b = this.getVersion(symbol, versionB);

    if (!a || !b) {
      return {
        success: false,
        error: `One or both versions not found`,
      };
    }

    // Compare configs
    const configDiff = this.diffConfigs(a.config, b.config);

    // Compare metrics if available
    const metricsDiff =
      a.metrics && b.metrics ? this.diffMetrics(a.metrics, b.metrics) : null;

    return {
      success: true,
      versionA: {
        versionString: a.versionString,
        tag: a.tag,
        createdAt: a.createdAt,
        config: a.config,
        metrics: a.metrics,
      },
      versionB: {
        versionString: b.versionString,
        tag: b.tag,
        createdAt: b.createdAt,
        config: b.config,
        metrics: b.metrics,
      },
      configDiff,
      metricsDiff,
      recommendation: this.getComparisonRecommendation(a, b),
    };
  }

  /**
   * Diff two configs
   */
  diffConfigs(configA, configB) {
    const allKeys = new Set([...Object.keys(configA), ...Object.keys(configB)]);
    const diff = {};

    for (const key of allKeys) {
      const valA = configA[key];
      const valB = configB[key];

      if (valA !== valB) {
        diff[key] = {
          a: valA,
          b: valB,
          change: this.calculateChange(valA, valB),
        };
      }
    }

    return {
      hasDifferences: Object.keys(diff).length > 0,
      differences: diff,
      changeCount: Object.keys(diff).length,
    };
  }

  /**
   * Diff two metrics objects
   */
  diffMetrics(metricsA, metricsB) {
    const keyMetrics = ['winRate', 'expectancy', 'profitFactor', 'totalReturn', 'maxDrawdown'];
    const diff = {};

    for (const key of keyMetrics) {
      const valA = parseFloat(metricsA[key]) || 0;
      const valB = parseFloat(metricsB[key]) || 0;

      diff[key] = {
        a: valA,
        b: valB,
        change: this.calculateChange(valA, valB),
        better: key === 'maxDrawdown' ? valB < valA : valB > valA,
      };
    }

    // Count which version is better
    const bBetter = Object.values(diff).filter(d => d.better).length;
    const aBetter = keyMetrics.length - bBetter;

    return {
      diff,
      summary: {
        versionABetter: aBetter,
        versionBBetter: bBetter,
        winner: bBetter > aBetter ? 'B' : aBetter > bBetter ? 'A' : 'TIE',
      },
    };
  }

  /**
   * Calculate percentage change
   */
  calculateChange(valA, valB) {
    if (valA === undefined || valA === null) return 'NEW';
    if (valB === undefined || valB === null) return 'REMOVED';
    if (typeof valA !== 'number' || typeof valB !== 'number') return 'CHANGED';
    if (valA === 0) return valB === 0 ? '0%' : '+100%';

    const change = ((valB - valA) / Math.abs(valA)) * 100;
    return (change >= 0 ? '+' : '') + change.toFixed(1) + '%';
  }

  /**
   * Get recommendation based on comparison
   */
  getComparisonRecommendation(versionA, versionB) {
    if (!versionA.metrics || !versionB.metrics) {
      return 'Insufficient metrics data to make a recommendation. Run backtests on both versions.';
    }

    const metricsA = versionA.metrics;
    const metricsB = versionB.metrics;

    // Score each version
    const scoreA =
      (parseFloat(metricsA.expectancy) || 0) * 30 +
      (parseFloat(metricsA.profitFactor) || 0) * 20 +
      (parseFloat(metricsA.winRate) || 0) * 10 -
      (parseFloat(metricsA.maxDrawdown) || 0) * 0.5;

    const scoreB =
      (parseFloat(metricsB.expectancy) || 0) * 30 +
      (parseFloat(metricsB.profitFactor) || 0) * 20 +
      (parseFloat(metricsB.winRate) || 0) * 10 -
      (parseFloat(metricsB.maxDrawdown) || 0) * 0.5;

    const scoreDiff = ((scoreB - scoreA) / Math.abs(scoreA)) * 100;

    if (Math.abs(scoreDiff) < 5) {
      return `Versions are similar (${scoreDiff.toFixed(1)}% difference). Consider other factors like robustness.`;
    } else if (scoreDiff > 0) {
      return `${versionB.versionString} is ${scoreDiff.toFixed(1)}% better. Recommend promoting to production.`;
    } else {
      return `${versionA.versionString} is ${Math.abs(scoreDiff).toFixed(1)}% better. Keep current production.`;
    }
  }

  /**
   * Get all symbols with versions
   */
  getAllSymbols() {
    return Object.keys(this.versions).map(symbol => ({
      symbol,
      versionCount: this.versions[symbol].versions.length,
      hasProduction: !!this.versions[symbol].productionVersion,
      latestVersion: this.versions[symbol].versions.slice(-1)[0]?.versionString,
    }));
  }

  /**
   * Archive a version (soft delete)
   */
  archiveVersion(symbol, versionIdentifier) {
    const symbolKey = symbol.toUpperCase();
    const symbolData = this.versions[symbolKey];

    if (!symbolData) {
      return { success: false, error: `No versions found for ${symbolKey}` };
    }

    const version = this.getVersion(symbol, versionIdentifier);
    if (!version) {
      return { success: false, error: `Version ${versionIdentifier} not found` };
    }

    // Can't archive production version
    if (version.id === symbolData.productionVersion) {
      return { success: false, error: 'Cannot archive production version. Promote another version first.' };
    }

    version.status = 'archived';
    version.archivedAt = new Date().toISOString();

    this.saveVersions();

    return {
      success: true,
      message: `Archived ${version.versionString}`,
      version,
    };
  }

  /**
   * Clone a version with modifications
   */
  cloneVersion(symbol, versionIdentifier, modifications = {}, options = {}) {
    const version = this.getVersion(symbol, versionIdentifier);
    if (!version) {
      return { success: false, error: `Version ${versionIdentifier} not found` };
    }

    const newConfig = { ...version.config, ...modifications };

    return this.createVersion(symbol, newConfig, {
      description: options.description || `Clone of ${version.versionString}`,
      tag: options.tag || 'testing',
      parentVersion: version.id,
      createdBy: options.createdBy || 'clone',
    });
  }

  /**
   * Get version history for auditing
   */
  getVersionHistory(symbol) {
    const symbolData = this.versions[symbol.toUpperCase()];
    if (!symbolData) return [];

    return symbolData.versions
      .map(v => ({
        versionString: v.versionString,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
        tag: v.tag,
        status: v.status,
        promotedAt: v.promotedAt,
        archivedAt: v.archivedAt,
        parentVersion: v.parentVersion,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Export versions for backup
   */
  exportVersions(symbol = null) {
    if (symbol) {
      return this.versions[symbol.toUpperCase()] || null;
    }
    return this.versions;
  }

  /**
   * Import versions from backup
   */
  importVersions(data, symbol = null) {
    try {
      if (symbol) {
        this.versions[symbol.toUpperCase()] = data;
      } else {
        this.versions = { ...this.versions, ...data };
      }
      this.saveVersions();
      return { success: true, message: 'Versions imported successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = StrategyVersionControl;
