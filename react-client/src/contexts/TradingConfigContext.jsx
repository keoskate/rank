/**
 * TradingConfigContext - Shared Trading Configuration
 *
 * Provides centralized config management across the app.
 * Config is persisted to localStorage and synced across components.
 *
 * Usage:
 *   import { useTradingConfig } from '../contexts/TradingConfigContext';
 *   const { config, updateConfig, resetConfig } = useTradingConfig();
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// LocalStorage key for trading config persistence
const TRADING_CONFIG_KEY = 'keo-stocks-trading-config';

// Default config values - single source of truth
export const DEFAULT_TRADING_CONFIG = {
  // === ASSET TYPE ===
  // 'stocks' or 'crypto' - determines API routing and PDT rules
  assetType: 'stocks',

  // === CAPITAL ALLOCATION ===
  watchlist: [
    // Tech Giants
    'NVDA',
    'AMD',
    'TSLA',
    'AMZN',
    'META',
    'GOOG',
    'MSFT',
    'PLTR',
    // Quantum Computing
    'IONQ',
    'RGTI',
    'QBTS',
    // Semiconductors & ETFs
    'SOXL',
    'SOXS',
    'SOXX',
    // Volatility
    'SPY',
    'UVIX',
    // Crypto
    'BTC-USD',
    'MSTR',
  ],
  allocatedCapital: 100000,
  maxLeverage: 1.0,
  reserveCashPercent: 20,

  // === POSITION MANAGEMENT ===
  maxPositions: 5,
  maxPositionSizePercent: 10,
  minPositionSize: 100,
  maxPositionSize: 25000,

  // === RISK MANAGEMENT ===
  riskPerTradePercent: 2,
  dailyLossLimitPercent: 5,
  weeklyLossLimitPercent: 10,
  maxConsecutiveLosses: 3,
  trailingStopPercent: 0,

  // === AI MODEL PARAMETERS ===
  minConfidence: 70,
  rsiOversold: 30,
  rsiOverbought: 70,
  vwapDeviationPercent: 0.5,
  volumeMultiplier: 1.5,
  adxMinStrength: 20,
  macdSensitivity: 'normal',
  patternRecognition: true,

  // === ENTRY CONDITIONS ===
  entryStrategy: 'balanced',
  requireVolumeSpike: true,
  requireTrendAlignment: true,
  requireRsiSignal: true,
  minSignalsRequired: 3,

  // === EXIT CONDITIONS ===
  takeProfitPercent: 2.0,
  stopLossPercent: 1.0,
  useAdaptiveTargets: true,
  exitOnRsiExtreme: true,
  exitBeforeClose: true,
  exitBeforeCloseMinutes: 15,

  // === TIMEFRAMES ===
  timeframes: ['dayTrading'],
  preferredTimeframe: '5min',

  // === AUTO-TRADE ===
  autoTrade: false,
  paperTradeOnly: true,
};

// Load config from localStorage
const loadTradingConfig = () => {
  try {
    const saved = localStorage.getItem(TRADING_CONFIG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge with defaults to ensure new config options are included
      console.info('📂 Trading config loaded from localStorage');
      return { ...DEFAULT_TRADING_CONFIG, ...parsed };
    }
  } catch (error) {
    console.error('Failed to load trading config:', error);
  }
  return DEFAULT_TRADING_CONFIG;
};

// Save config to localStorage
const saveTradingConfig = config => {
  try {
    localStorage.setItem(TRADING_CONFIG_KEY, JSON.stringify(config));
    console.info('💾 Trading config saved to localStorage');
    return true;
  } catch (error) {
    console.error('Failed to save trading config:', error);
    return false;
  }
};

// Create context
const TradingConfigContext = createContext(null);

// Provider component
export const TradingConfigProvider = ({ children }) => {
  const [config, setConfig] = useState(() => loadTradingConfig());
  const [lastSaved, setLastSaved] = useState(null);

  // Update config (partial update)
  const updateConfig = useCallback((updates) => {
    setConfig(prev => {
      const newConfig = { ...prev, ...updates };
      if (saveTradingConfig(newConfig)) {
        setLastSaved(new Date());
      }
      return newConfig;
    });
  }, []);

  // Update a single config field
  const updateConfigField = useCallback((field, value) => {
    updateConfig({ [field]: value });
  }, [updateConfig]);

  // Reset config to defaults
  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_TRADING_CONFIG);
    saveTradingConfig(DEFAULT_TRADING_CONFIG);
    setLastSaved(new Date());
    console.info('🔄 Trading config reset to defaults');
  }, []);

  // Export config as JSON
  const exportConfig = useCallback(() => {
    const dataStr = JSON.stringify(config, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trading-config-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [config]);

  // Import config from JSON
  const importConfig = useCallback((jsonString) => {
    try {
      const imported = JSON.parse(jsonString);
      const mergedConfig = { ...DEFAULT_TRADING_CONFIG, ...imported };
      setConfig(mergedConfig);
      saveTradingConfig(mergedConfig);
      setLastSaved(new Date());
      console.info('📥 Trading config imported successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to import config:', error);
      return { success: false, error: error.message };
    }
  }, []);

  // Calculate derived values
  const derivedValues = {
    effectiveCapital: config.allocatedCapital * (1 - config.reserveCashPercent / 100),
    maxPositionValue: config.allocatedCapital * (config.maxPositionSizePercent / 100),
    dailyLossLimit: config.allocatedCapital * (config.dailyLossLimitPercent / 100),
    weeklyLossLimit: config.allocatedCapital * (config.weeklyLossLimitPercent / 100),
    riskPerTrade: config.allocatedCapital * (config.riskPerTradePercent / 100),
  };

  // Context value
  const value = {
    config,
    updateConfig,
    updateConfigField,
    resetConfig,
    exportConfig,
    importConfig,
    lastSaved,
    derivedValues,
    DEFAULT_CONFIG: DEFAULT_TRADING_CONFIG,
  };

  return (
    <TradingConfigContext.Provider value={value}>
      {children}
    </TradingConfigContext.Provider>
  );
};

// Hook to use trading config
export const useTradingConfig = () => {
  const context = useContext(TradingConfigContext);
  if (!context) {
    throw new Error('useTradingConfig must be used within a TradingConfigProvider');
  }
  return context;
};

// Export for backward compatibility
export { loadTradingConfig, saveTradingConfig, TRADING_CONFIG_KEY };

export default TradingConfigContext;
