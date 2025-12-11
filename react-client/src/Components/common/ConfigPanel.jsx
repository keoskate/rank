/**
 * ConfigPanel - Unified Trading Configuration Editor
 *
 * Shows ALL trading config parameters in a clean grid layout.
 * Aligned exactly with TradingConfigContext - the single source of truth.
 *
 * Features:
 * - Risk indicators (green=conservative, red=aggressive)
 * - Strategy presets for quick configuration
 * - Save/load named configurations
 * - Tooltips explaining each setting
 *
 * Used across: Strategy Lab, Trading Simulator, A/B Testing, Live Trading
 */
import { useState, useRef } from 'react';
import theme from '../../theme';
import { useTradingConfig, DEFAULT_TRADING_CONFIG } from '../../contexts/TradingConfigContext';

// Strategy presets for quick configuration
const STRATEGY_PRESETS = {
  conservative: {
    name: 'Conservative',
    description: 'Lower risk with strict entry requirements. Fewer trades, higher confidence.',
    color: '#22c55e', // green
    config: {
      minConfidence: 70,
      rsiOversold: 25,
      rsiOverbought: 75,
      minSignalsRequired: 2,
      takeProfitPercent: 2,
      stopLossPercent: 1,
      riskPerTradePercent: 2,
      maxPositionSizePercent: 50,
      requireVolumeSpike: true,
      requireTrendAlignment: true,
      requireRsiSignal: false,
      entryStrategy: 'conservative',
    },
  },
  balanced: {
    name: 'Balanced',
    description: 'Moderate risk/reward. Works for most market conditions.',
    color: '#3b82f6', // blue
    config: {
      minConfidence: 60,
      rsiOversold: 30,
      rsiOverbought: 70,
      minSignalsRequired: 2,
      takeProfitPercent: 3,
      stopLossPercent: 1.5,
      riskPerTradePercent: 2,
      maxPositionSizePercent: 80,
      requireVolumeSpike: true,
      requireTrendAlignment: false,
      requireRsiSignal: false,
      entryStrategy: 'balanced',
    },
  },
  aggressive: {
    name: 'Aggressive',
    description: 'High conviction trades with larger positions. Best for trending days.',
    color: '#ef4444', // red
    config: {
      minConfidence: 40,
      rsiOversold: 35,
      rsiOverbought: 65,
      minSignalsRequired: 1,
      takeProfitPercent: 5,
      stopLossPercent: 1.5,
      riskPerTradePercent: 3,
      maxPositionSizePercent: 100,
      requireVolumeSpike: false,
      requireTrendAlignment: false,
      requireRsiSignal: false,
      entryStrategy: 'aggressive',
    },
  },
  dip: {
    name: 'Buy the Dip',
    description: 'Buy oversold conditions. Best for volatile days with recovery potential.',
    color: '#f59e0b', // amber
    config: {
      minConfidence: 50,
      rsiOversold: 30,
      rsiOverbought: 70,
      minSignalsRequired: 1,
      takeProfitPercent: 3,
      stopLossPercent: 1,
      riskPerTradePercent: 2,
      maxPositionSizePercent: 100,
      requireVolumeSpike: true,
      requireTrendAlignment: false,
      requireRsiSignal: false,
      entryStrategy: 'dip',
    },
  },
  momentum: {
    name: 'Momentum',
    description: 'Ride strong trends and breakouts. Best for big move days.',
    color: '#8b5cf6', // purple
    config: {
      minConfidence: 50,
      rsiOversold: 40,
      rsiOverbought: 80,
      minSignalsRequired: 1,
      takeProfitPercent: 5,
      stopLossPercent: 2,
      riskPerTradePercent: 3,
      maxPositionSizePercent: 100,
      requireVolumeSpike: true,
      requireTrendAlignment: false,
      requireRsiSignal: false,
      entryStrategy: 'momentum',
    },
  },
};

// Config field metadata with risk levels and tooltips
const CONFIG_SCHEMA = {
  'Capital Allocation': {
    allocatedCapital: {
      label: 'Capital ($)',
      type: 'number',
      min: 1000,
      max: 10000000,
      step: 1000,
      tooltip: 'Total capital available for trading',
      risk: 'neutral',
    },
    maxLeverage: {
      label: 'Max Leverage',
      type: 'number',
      min: 1,
      max: 4,
      step: 0.5,
      tooltip: 'Maximum leverage multiplier. Higher = more risk',
      risk: 'higher-risky',
    },
    reserveCashPercent: {
      label: 'Cash Reserve %',
      type: 'number',
      min: 0,
      max: 50,
      step: 5,
      tooltip: 'Cash kept uninvested. Higher = more conservative',
      risk: 'higher-safe',
    },
  },
  'Position Management': {
    maxPositions: {
      label: 'Max Positions',
      type: 'number',
      min: 1,
      max: 20,
      step: 1,
      tooltip: 'Maximum concurrent positions. More = diversified but complex',
      risk: 'neutral',
    },
    maxPositionSizePercent: {
      label: 'Max Position %',
      type: 'slider',
      min: 1,
      max: 50,
      step: 1,
      tooltip: 'Max % of capital per position. Higher = more concentrated risk',
      risk: 'higher-risky',
    },
    minPositionSize: {
      label: 'Min Position $',
      type: 'number',
      min: 50,
      max: 10000,
      step: 50,
      tooltip: 'Minimum position size in dollars',
      risk: 'neutral',
    },
    maxPositionSize: {
      label: 'Max Position $',
      type: 'number',
      min: 1000,
      max: 100000,
      step: 1000,
      tooltip: 'Maximum position size in dollars',
      risk: 'neutral',
    },
  },
  'Risk Management': {
    riskPerTradePercent: {
      label: 'Risk/Trade %',
      type: 'slider',
      min: 0.5,
      max: 5,
      step: 0.5,
      tooltip: 'Max capital risked per trade. Higher = aggressive',
      risk: 'higher-risky',
    },
    dailyLossLimitPercent: {
      label: 'Daily Loss Limit %',
      type: 'slider',
      min: 1,
      max: 10,
      step: 0.5,
      tooltip: 'Stop trading if daily loss exceeds this. Lower = safer',
      risk: 'higher-risky',
    },
    weeklyLossLimitPercent: {
      label: 'Weekly Loss Limit %',
      type: 'number',
      min: 2,
      max: 30,
      step: 1,
      tooltip: 'Stop trading if weekly loss exceeds this',
      risk: 'higher-risky',
    },
    maxConsecutiveLosses: {
      label: 'Max Consec. Losses',
      type: 'number',
      min: 1,
      max: 10,
      step: 1,
      tooltip: 'Pause trading after this many consecutive losses',
      risk: 'higher-risky',
    },
    trailingStopPercent: {
      label: 'Trailing Stop (% of TP)',
      type: 'slider',
      min: 0,
      max: 100,
      step: 10,
      tooltip: 'Lock in gains when price drops from high. E.g., 50% means sell if price drops halfway back to entry. 0 = disabled',
      risk: 'neutral',
      suffix: '%',
    },
  },
  'AI Model Parameters': {
    minConfidence: {
      label: 'Min Confidence %',
      type: 'slider',
      min: 40,
      max: 95,
      step: 5,
      tooltip: 'Minimum AI confidence to enter trade. Higher = fewer but surer trades',
      risk: 'lower-safe',
    },
    rsiOversold: {
      label: 'RSI Oversold',
      type: 'slider',
      min: 15,
      max: 40,
      step: 5,
      tooltip: 'RSI level considered oversold (buy signal). Higher = more signals',
      risk: 'higher-risky',
    },
    rsiOverbought: {
      label: 'RSI Overbought',
      type: 'slider',
      min: 60,
      max: 85,
      step: 5,
      tooltip: 'RSI level considered overbought (sell signal). Lower = earlier exits',
      risk: 'lower-safe',
    },
    vwapDeviationPercent: {
      label: 'VWAP Deviation %',
      type: 'number',
      min: 0.1,
      max: 3,
      step: 0.1,
      tooltip: 'Distance from VWAP to trigger signals',
      risk: 'neutral',
    },
    volumeMultiplier: {
      label: 'Volume Multiplier',
      type: 'slider',
      min: 1,
      max: 3,
      step: 0.25,
      tooltip: 'Volume spike threshold (vs average). Lower = more signals',
      risk: 'lower-risky',
    },
    adxMinStrength: {
      label: 'ADX Min Strength',
      type: 'number',
      min: 10,
      max: 40,
      step: 5,
      tooltip: 'Minimum trend strength (ADX) to trade',
      risk: 'neutral',
    },
    macdSensitivity: {
      label: 'MACD Sensitivity',
      type: 'select',
      options: ['low', 'normal', 'high'],
      tooltip: 'MACD signal sensitivity. High = more signals',
      risk: 'neutral',
    },
    patternRecognition: {
      label: 'Pattern Recognition',
      type: 'boolean',
      tooltip: 'Enable chart pattern detection',
      risk: 'neutral',
    },
  },
  'Entry Conditions': {
    entryStrategy: {
      label: 'Entry Strategy',
      type: 'select',
      options: ['conservative', 'balanced', 'aggressive', 'momentum'],
      tooltip: 'Overall entry approach',
      risk: 'neutral',
    },
    requireVolumeSpike: {
      label: 'Require Volume Spike',
      type: 'boolean',
      tooltip: 'Only enter on high volume. Enabled = safer',
      risk: 'off-risky',
    },
    requireTrendAlignment: {
      label: 'Require Trend Align',
      type: 'boolean',
      tooltip: 'Only enter when trend confirms. Enabled = safer',
      risk: 'off-risky',
    },
    requireRsiSignal: {
      label: 'Require RSI Signal',
      type: 'boolean',
      tooltip: 'Require RSI confirmation. Enabled = safer',
      risk: 'off-risky',
    },
    minSignalsRequired: {
      label: 'Min Signals Required',
      type: 'slider',
      min: 1,
      max: 5,
      step: 1,
      tooltip: 'Number of confirming signals needed. Higher = fewer but stronger entries',
      risk: 'lower-safe',
    },
  },
  'Exit Conditions': {
    takeProfitPercent: {
      label: 'Take Profit %',
      type: 'slider',
      min: 0.5,
      max: 10,
      step: 0.25,
      tooltip: 'Target profit to exit. Higher = bigger wins but fewer',
      risk: 'higher-risky',
    },
    stopLossPercent: {
      label: 'Stop Loss %',
      type: 'slider',
      min: 0.25,
      max: 5,
      step: 0.25,
      tooltip: 'Max loss before exit. Lower = tighter risk control',
      risk: 'higher-risky',
    },
    useAdaptiveTargets: {
      label: 'Adaptive Targets',
      type: 'boolean',
      tooltip: 'Adjust targets based on volatility',
      risk: 'neutral',
    },
    exitOnRsiExtreme: {
      label: 'Exit on RSI Extreme',
      type: 'boolean',
      tooltip: 'Exit when RSI hits extreme levels',
      risk: 'neutral',
    },
    exitBeforeClose: {
      label: 'Exit Before Close',
      type: 'boolean',
      tooltip: 'Close positions before market close',
      risk: 'off-risky',
    },
    exitBeforeCloseMinutes: {
      label: 'Exit Mins Before Close',
      type: 'number',
      min: 5,
      max: 60,
      step: 5,
      tooltip: 'Minutes before close to exit positions',
      risk: 'neutral',
    },
  },
  Timeframes: {
    preferredTimeframe: {
      label: 'Preferred Timeframe',
      type: 'select',
      options: ['1min', '5min', '15min', '30min', '1hour'],
      tooltip: 'Primary chart timeframe for analysis',
      risk: 'neutral',
    },
  },
};

// Risk color helper
const getRiskColor = (schema, value) => {
  if (!schema.risk || schema.risk === 'neutral') return null;

  const isAtMax = value >= (schema.max || 100);
  const isAtMin = value <= (schema.min || 0);
  const isOn = value === true || value === 'Yes';
  const isOff = value === false || value === 'No';

  // For boolean "off means risky"
  if (schema.risk === 'off-risky') {
    return isOff ? '#ef4444' : '#22c55e';
  }

  // For numeric "higher is risky"
  if (schema.risk === 'higher-risky') {
    const range = (schema.max || 100) - (schema.min || 0);
    const normalized = (value - (schema.min || 0)) / range;
    if (normalized > 0.7) return '#ef4444';
    if (normalized > 0.4) return '#f59e0b';
    return '#22c55e';
  }

  // For numeric "lower is risky"
  if (schema.risk === 'lower-risky') {
    const range = (schema.max || 100) - (schema.min || 0);
    const normalized = (value - (schema.min || 0)) / range;
    if (normalized < 0.3) return '#ef4444';
    if (normalized < 0.6) return '#f59e0b';
    return '#22c55e';
  }

  // For "higher is safe"
  if (schema.risk === 'higher-safe') {
    const range = (schema.max || 100) - (schema.min || 0);
    const normalized = (value - (schema.min || 0)) / range;
    if (normalized > 0.7) return '#22c55e';
    if (normalized > 0.4) return '#f59e0b';
    return '#ef4444';
  }

  // For "lower is safe"
  if (schema.risk === 'lower-safe') {
    const range = (schema.max || 100) - (schema.min || 0);
    const normalized = (value - (schema.min || 0)) / range;
    if (normalized < 0.3) return '#22c55e';
    if (normalized < 0.6) return '#f59e0b';
    return '#ef4444';
  }

  return null;
};

const ConfigPanel = ({
  mode = 'view', // 'view', 'edit'
  showCategories = null, // null = all, or ['Capital Allocation', 'Exit Conditions']
  onConfigChange = null,
  localConfig = null, // use local state instead of context
  title = 'Trading Configuration',
  compact = false, // compact mode for inline display
  showPresets = true, // show strategy presets
  showSaveLoad = true, // show save/load buttons
}) => {
  const { config: contextConfig, updateConfig, exportConfig, importConfig, resetConfig } =
    useTradingConfig();
  const [localState, setLocalState] = useState(localConfig || {});
  const [hoveredField, setHoveredField] = useState(null);
  const [savedConfigs, setSavedConfigs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('saved-trading-configs') || '{}');
    } catch {
      return {};
    }
  });
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false);
  const [saveAsTarget, setSaveAsTarget] = useState(null); // Strategy being overwritten
  const [saveAsNewName, setSaveAsNewName] = useState(''); // New name for Save As (empty = keep original)
  const [configName, setConfigName] = useState('');
  const [loadedConfigName, setLoadedConfigName] = useState(() => {
    try {
      return localStorage.getItem('loaded-config-name') || null;
    } catch {
      return null;
    }
  });
  const fileInputRef = useRef(null);

  // Auto-load saved config on mount
  useEffect(() => {
    if (loadedConfigName && savedConfigs[loadedConfigName] && localConfig === null) {
      updateConfig(savedConfigs[loadedConfigName]);
    }
  }, []); // Only run on mount

  // Use localConfig if provided, otherwise use context
  const config = localConfig !== null ? { ...DEFAULT_TRADING_CONFIG, ...localState } : contextConfig;

  const handleChange = (field, value) => {
    if (localConfig !== null) {
      const newState = { ...localState, [field]: value };
      setLocalState(newState);
      if (onConfigChange) onConfigChange(newState);
    } else {
      updateConfig({ [field]: value });
      if (onConfigChange) onConfigChange({ [field]: value });
    }
  };

  const applyPreset = preset => {
    const presetConfig = STRATEGY_PRESETS[preset]?.config;
    if (presetConfig) {
      if (localConfig !== null) {
        setLocalState(prev => ({ ...prev, ...presetConfig }));
        if (onConfigChange) onConfigChange(presetConfig);
      } else {
        updateConfig(presetConfig);
      }
    }
  };

  const saveConfig = () => {
    if (!configName.trim()) return;
    const newSaved = { ...savedConfigs, [configName]: config };
    setSavedConfigs(newSaved);
    localStorage.setItem('saved-trading-configs', JSON.stringify(newSaved));
    // Set as currently loaded config
    setLoadedConfigName(configName);
    localStorage.setItem('loaded-config-name', configName);
    setShowSaveDialog(false);
    setConfigName('');
  };

  // Save As - overwrite existing strategy (with optional rename)
  const saveAsConfig = () => {
    if (!saveAsTarget) return;
    const finalName = saveAsNewName.trim() || saveAsTarget;
    const newSaved = { ...savedConfigs };

    // If renaming, delete the old entry
    if (finalName !== saveAsTarget) {
      delete newSaved[saveAsTarget];
    }

    newSaved[finalName] = config;
    setSavedConfigs(newSaved);
    localStorage.setItem('saved-trading-configs', JSON.stringify(newSaved));
    // Set as currently loaded config
    setLoadedConfigName(finalName);
    localStorage.setItem('loaded-config-name', finalName);
    setShowSaveAsDialog(false);
    setSaveAsTarget(null);
    setSaveAsNewName('');
  };

  // Get differences between current config and saved config
  const getConfigDiff = (savedConfig) => {
    const diffs = [];
    const allKeys = new Set([...Object.keys(config), ...Object.keys(savedConfig || {})]);

    // Find field labels from schema
    const getFieldLabel = (key) => {
      for (const category of Object.keys(CONFIG_SCHEMA)) {
        if (CONFIG_SCHEMA[category][key]) {
          return CONFIG_SCHEMA[category][key].label || key;
        }
      }
      return key;
    };

    allKeys.forEach(key => {
      const oldVal = savedConfig?.[key];
      const newVal = config[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diffs.push({
          field: key,
          label: getFieldLabel(key),
          oldValue: oldVal,
          newValue: newVal,
        });
      }
    });

    return diffs;
  };

  const loadConfig = name => {
    const loaded = savedConfigs[name];
    if (loaded) {
      if (localConfig !== null) {
        setLocalState(loaded);
        if (onConfigChange) onConfigChange(loaded);
      } else {
        updateConfig(loaded);
      }
      // Persist loaded config name
      setLoadedConfigName(name);
      localStorage.setItem('loaded-config-name', name);
    }
  };

  // Clear loaded config (revert to defaults)
  const clearLoadedConfig = () => {
    setLoadedConfigName(null);
    localStorage.removeItem('loaded-config-name');
    resetConfig();
  };

  const deleteConfig = name => {
    const newSaved = { ...savedConfigs };
    delete newSaved[name];
    setSavedConfigs(newSaved);
    localStorage.setItem('saved-trading-configs', JSON.stringify(newSaved));
  };

  const handleImport = e => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = event => {
        importConfig(event.target.result);
      };
      reader.readAsText(file);
    }
  };

  // Get safe value with fallback
  const getSafeValue = (field, schema) => {
    const value = config[field];
    if (value !== undefined && value !== null && !Number.isNaN(value)) return value;
    if (DEFAULT_TRADING_CONFIG[field] !== undefined) return DEFAULT_TRADING_CONFIG[field];
    if (schema.type === 'boolean') return false;
    if (schema.type === 'select') return schema.options[0];
    return schema.min || 0;
  };

  const categoriesToShow = showCategories || Object.keys(CONFIG_SCHEMA);

  // Compact mode - single row summary
  if (compact) {
    return (
      <div
        style={{
          display: 'flex',
          gap: theme.spacing.lg,
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.borderRadius.md,
          border: `1px solid ${theme.colors.border}`,
          flexWrap: 'wrap',
          fontSize: theme.typography.fontSize.sm,
        }}
      >
        <span>
          <strong style={{ color: theme.colors.success }}>TP:</strong> {config.takeProfitPercent}%
        </span>
        <span>
          <strong style={{ color: theme.colors.error }}>SL:</strong> {config.stopLossPercent}%
        </span>
        <span>
          <strong>Conf:</strong> {config.minConfidence}%
        </span>
        <span>
          <strong>Capital:</strong> ${(config.allocatedCapital || 25000).toLocaleString()}
        </span>
        <span>
          <strong>Max Pos:</strong> {config.maxPositions}
        </span>
        <span>
          <strong>Risk:</strong> {config.riskPerTradePercent}%
        </span>
      </div>
    );
  }

  // Slider component
  const renderSlider = (field, schema, value) => {
    const riskColor = getRiskColor(schema, value);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="range"
          value={value}
          onChange={e => handleChange(field, parseFloat(e.target.value))}
          min={schema.min}
          max={schema.max}
          step={schema.step}
          style={{
            flex: 1,
            height: '6px',
            borderRadius: '3px',
            cursor: 'pointer',
            accentColor: riskColor || theme.colors.primary,
          }}
        />
        <span
          style={{
            minWidth: '45px',
            textAlign: 'right',
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.bold,
            color: riskColor || theme.colors.text,
          }}
        >
          {value}
          {field.includes('Percent') || field === 'minConfidence' ? '%' : ''}
        </span>
      </div>
    );
  };

  // Toggle switch component
  const renderToggle = (field, schema, value) => {
    const riskColor = getRiskColor(schema, value);
    const isOn = value === true;
    return (
      <button
        onClick={() => handleChange(field, !value)}
        style={{
          width: '48px',
          height: '26px',
          borderRadius: '13px',
          border: 'none',
          backgroundColor: isOn ? (riskColor || '#22c55e') : '#cbd5e1',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '3px',
            left: isOn ? '25px' : '3px',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            backgroundColor: '#fff',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </button>
    );
  };

  // Input renderer
  const renderInput = (field, schema) => {
    const value = getSafeValue(field, schema);
    const isEditing = mode === 'edit';
    const riskColor = getRiskColor(schema, value);

    const inputStyle = {
      width: '100%',
      padding: '6px 8px',
      borderRadius: theme.borderRadius.sm,
      border: `1px solid ${riskColor || theme.colors.border}`,
      backgroundColor: isEditing ? theme.colors.background : theme.colors.surface,
      color: theme.colors.text,
      fontSize: theme.typography.fontSize.sm,
    };

    if (!isEditing) {
      // View mode - display only
      let displayValue = value;
      if (typeof value === 'boolean') displayValue = value ? 'Yes' : 'No';
      else if (field.includes('Capital') || field.includes('PositionSize'))
        displayValue = `$${Number(value).toLocaleString()}`;
      else if (field.includes('Percent') || field === 'minConfidence') displayValue = `${value}%`;

      return (
        <div
          style={{
            ...inputStyle,
            backgroundColor: theme.colors.surface,
            fontWeight: theme.typography.fontWeight.medium,
            borderLeft: riskColor ? `3px solid ${riskColor}` : undefined,
          }}
        >
          {displayValue}
        </div>
      );
    }

    // Edit mode
    if (schema.type === 'boolean') {
      return renderToggle(field, schema, value);
    }

    if (schema.type === 'slider') {
      return renderSlider(field, schema, value);
    }

    if (schema.type === 'select') {
      return (
        <select
          value={value || schema.options[0]}
          onChange={e => handleChange(field, e.target.value)}
          style={inputStyle}
        >
          {schema.options.map(opt => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type="number"
        value={value}
        onChange={e => {
          const parsed = parseFloat(e.target.value);
          handleChange(field, Number.isNaN(parsed) ? schema.min || 0 : parsed);
        }}
        min={schema.min}
        max={schema.max}
        step={schema.step}
        style={{
          ...inputStyle,
          borderLeft: riskColor ? `3px solid ${riskColor}` : undefined,
        }}
      />
    );
  };

  return (
    <div
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        border: `1px solid ${theme.colors.border}`,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: theme.spacing.md,
          borderBottom: `1px solid ${theme.colors.border}`,
          backgroundColor: theme.colors.background,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <h3
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.lg,
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            {title}
          </h3>
          {mode === 'edit' && (
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                padding: '2px 8px',
                backgroundColor: theme.colors.primary,
                color: '#fff',
                borderRadius: theme.borderRadius.sm,
              }}
            >
              EDITING
            </span>
          )}
        </div>

        {/* Risk Legend */}
        {mode === 'edit' && (
          <div
            style={{
              display: 'flex',
              gap: theme.spacing.md,
              fontSize: theme.typography.fontSize.xs,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: '#22c55e',
                }}
              />
              Conservative
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: '#f59e0b',
                }}
              />
              Moderate
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: '#ef4444',
                }}
              />
              Aggressive
            </span>
          </div>
        )}
      </div>

      {/* Strategy Presets */}
      {mode === 'edit' && showPresets && (
        <div
          style={{
            padding: theme.spacing.md,
            borderBottom: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.gray50,
          }}
        >
          <div
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.textMuted,
              marginBottom: theme.spacing.sm,
              textTransform: 'uppercase',
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            Quick Presets
          </div>
          <div style={{ display: 'flex', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            {Object.entries(STRATEGY_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                title={preset.description}
                style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                  borderRadius: theme.borderRadius.md,
                  border: `2px solid ${preset.color}`,
                  backgroundColor:
                    config.entryStrategy === key ? preset.color : 'transparent',
                  color: config.entryStrategy === key ? '#fff' : preset.color,
                  cursor: 'pointer',
                  fontWeight: theme.typography.fontWeight.bold,
                  fontSize: theme.typography.fontSize.sm,
                  transition: 'all 0.2s',
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Currently Loaded Config Label */}
      {mode === 'edit' && showSaveLoad && loadedConfigName && (
        <div
          style={{
            padding: `${theme.spacing.sm} ${theme.spacing.md}`,
            backgroundColor: '#dbeafe',
            borderBottom: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <span style={{ fontSize: theme.typography.fontSize.sm, color: '#1e40af' }}>
              📁 Loaded:
            </span>
            <span style={{
              fontWeight: 'bold',
              fontSize: theme.typography.fontSize.sm,
              color: '#1e40af',
            }}>
              {loadedConfigName}
            </span>
          </div>
          <button
            onClick={clearLoadedConfig}
            style={{
              padding: `2px ${theme.spacing.sm}`,
              borderRadius: theme.borderRadius.sm,
              border: '1px solid #93c5fd',
              backgroundColor: 'transparent',
              color: '#1e40af',
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.xs,
            }}
            title="Clear loaded config and reset to defaults"
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* Save/Load Section */}
      {mode === 'edit' && showSaveLoad && (
        <div
          style={{
            padding: theme.spacing.md,
            borderBottom: `1px solid ${theme.colors.border}`,
            display: 'flex',
            gap: theme.spacing.sm,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <button
            onClick={() => setShowSaveDialog(true)}
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.md}`,
              borderRadius: theme.borderRadius.sm,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: theme.colors.primary,
              color: '#fff',
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            💾 Save New
          </button>
          {Object.keys(savedConfigs).length > 0 && (
            <select
              onChange={e => {
                if (e.target.value) {
                  setSaveAsTarget(e.target.value);
                  setSaveAsNewName(''); // Reset name field
                  setShowSaveAsDialog(true);
                }
                e.target.value = '';
              }}
              value=""
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.border}`,
                backgroundColor: theme.colors.success,
                color: '#fff',
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              <option value="">💾 Save As...</option>
              {Object.keys(savedConfigs).map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={exportConfig}
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.md}`,
              borderRadius: theme.borderRadius.sm,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            📤 Export JSON
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.md}`,
              borderRadius: theme.borderRadius.sm,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            📥 Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            style={{ display: 'none' }}
          />

          {/* Saved configs dropdown */}
          {Object.keys(savedConfigs).length > 0 && (
            <select
              onChange={e => e.target.value && loadConfig(e.target.value)}
              value=""
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.border}`,
                backgroundColor: theme.colors.background,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              <option value="">📂 Load Saved...</option>
              {Object.keys(savedConfigs).map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Save Dialog */}
      {showSaveDialog && (
        <div
          style={{
            padding: theme.spacing.md,
            borderBottom: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.gray50,
            display: 'flex',
            gap: theme.spacing.sm,
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            value={configName}
            onChange={e => setConfigName(e.target.value)}
            placeholder="Config name..."
            style={{
              flex: 1,
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              borderRadius: theme.borderRadius.sm,
              border: `1px solid ${theme.colors.border}`,
              fontSize: theme.typography.fontSize.sm,
            }}
          />
          <button
            onClick={saveConfig}
            disabled={!configName.trim()}
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.md}`,
              borderRadius: theme.borderRadius.sm,
              border: 'none',
              backgroundColor: theme.colors.primary,
              color: '#fff',
              cursor: configName.trim() ? 'pointer' : 'not-allowed',
              opacity: configName.trim() ? 1 : 0.5,
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            Save
          </button>
          <button
            onClick={() => setShowSaveDialog(false)}
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.md}`,
              borderRadius: theme.borderRadius.sm,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Save As Dialog with Diff */}
      {showSaveAsDialog && saveAsTarget && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => {
            setShowSaveAsDialog(false);
            setSaveAsTarget(null);
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: theme.borderRadius.lg,
              padding: theme.spacing.lg,
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, marginBottom: theme.spacing.md }}>
              Save Strategy
            </h3>

            {/* Strategy Name Input */}
            <div style={{ marginBottom: theme.spacing.md }}>
              <label style={{
                display: 'block',
                marginBottom: theme.spacing.xs,
                fontSize: theme.typography.fontSize.sm,
                fontWeight: 500,
              }}>
                Strategy Name
              </label>
              <input
                type="text"
                value={saveAsNewName}
                onChange={e => setSaveAsNewName(e.target.value)}
                placeholder={saveAsTarget}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  borderRadius: theme.borderRadius.sm,
                  border: `1px solid ${theme.colors.border}`,
                  fontSize: theme.typography.fontSize.md,
                  boxSizing: 'border-box',
                }}
              />
              <p style={{
                margin: `${theme.spacing.xs} 0 0 0`,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textMuted,
              }}>
                {saveAsNewName.trim() && saveAsNewName.trim() !== saveAsTarget
                  ? `Will rename "${saveAsTarget}" to "${saveAsNewName.trim()}"`
                  : 'Leave empty to keep the current name'}
              </p>
            </div>

            {(() => {
              const diffs = getConfigDiff(savedConfigs[saveAsTarget]);
              if (diffs.length === 0) {
                return (
                  <p style={{ color: theme.colors.textMuted }}>
                    No changes detected.
                  </p>
                );
              }

              return (
                <>
                  <p style={{ marginBottom: theme.spacing.sm, color: theme.colors.textMuted }}>
                    {diffs.length} change{diffs.length !== 1 ? 's' : ''} will be saved:
                  </p>
                  <div style={{
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: theme.borderRadius.sm,
                    overflow: 'hidden',
                    marginBottom: theme.spacing.md,
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm }}>
                      <thead>
                        <tr style={{ backgroundColor: theme.colors.gray100 }}>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'left', borderBottom: `1px solid ${theme.colors.border}` }}>Setting</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'right', borderBottom: `1px solid ${theme.colors.border}` }}>Old</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'center', borderBottom: `1px solid ${theme.colors.border}` }}>→</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'left', borderBottom: `1px solid ${theme.colors.border}` }}>New</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffs.map(diff => (
                          <tr key={diff.field}>
                            <td style={{ padding: theme.spacing.sm, fontWeight: 500 }}>{diff.label}</td>
                            <td style={{ padding: theme.spacing.sm, textAlign: 'right', color: '#ef4444' }}>
                              {diff.oldValue === undefined ? '—' : String(diff.oldValue)}
                            </td>
                            <td style={{ padding: theme.spacing.sm, textAlign: 'center', color: theme.colors.textMuted }}>→</td>
                            <td style={{ padding: theme.spacing.sm, textAlign: 'left', color: '#22c55e' }}>
                              {diff.newValue === undefined ? '—' : String(diff.newValue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}

            <div style={{ display: 'flex', gap: theme.spacing.sm, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowSaveAsDialog(false);
                  setSaveAsTarget(null);
                }}
                style={{
                  padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                  borderRadius: theme.borderRadius.sm,
                  border: `1px solid ${theme.colors.border}`,
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveAsConfig}
                style={{
                  padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                  borderRadius: theme.borderRadius.sm,
                  border: 'none',
                  backgroundColor: theme.colors.success,
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Confirm Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Grid - All categories visible */}
      <div style={{ padding: theme.spacing.md }}>
        {categoriesToShow.map(category => {
          const fields = CONFIG_SCHEMA[category];
          if (!fields) return null;

          return (
            <div key={category} style={{ marginBottom: theme.spacing.lg }}>
              {/* Category Header */}
              <h4
                style={{
                  margin: `0 0 ${theme.spacing.sm}`,
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  borderBottom: `1px solid ${theme.colors.border}`,
                  paddingBottom: theme.spacing.xs,
                }}
              >
                {category}
              </h4>

              {/* Fields Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: theme.spacing.md,
                }}
              >
                {Object.entries(fields).map(([field, schema]) => (
                  <div
                    key={field}
                    onMouseEnter={() => setHoveredField(field)}
                    onMouseLeave={() => setHoveredField(null)}
                    style={{ position: 'relative' }}
                  >
                    <label
                      style={{
                        display: 'block',
                        marginBottom: '4px',
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.textSecondary,
                        fontWeight: theme.typography.fontWeight.medium,
                      }}
                    >
                      {schema.label}
                      {schema.tooltip && (
                        <span
                          style={{
                            marginLeft: '4px',
                            cursor: 'help',
                            opacity: 0.5,
                          }}
                        >
                          ⓘ
                        </span>
                      )}
                    </label>
                    {renderInput(field, schema)}

                    {/* Tooltip */}
                    {hoveredField === field && schema.tooltip && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '100%',
                          left: 0,
                          right: 0,
                          padding: theme.spacing.sm,
                          backgroundColor: '#1f2937',
                          color: '#fff',
                          borderRadius: theme.borderRadius.sm,
                          fontSize: theme.typography.fontSize.xs,
                          zIndex: 100,
                          marginBottom: '4px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        }}
                      >
                        {schema.tooltip}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Actions */}
        {mode === 'edit' && (
          <div
            style={{
              display: 'flex',
              gap: theme.spacing.sm,
              marginTop: theme.spacing.md,
              paddingTop: theme.spacing.md,
              borderTop: `1px solid ${theme.colors.border}`,
            }}
          >
            <button
              onClick={() => {
                if (localConfig !== null) {
                  setLocalState({});
                  if (onConfigChange) onConfigChange({});
                } else {
                  resetConfig();
                }
              }}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.border}`,
                backgroundColor: 'transparent',
                color: theme.colors.text,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              Reset to Defaults
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigPanel;
