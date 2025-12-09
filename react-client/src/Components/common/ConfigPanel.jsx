/**
 * ConfigPanel - Unified Trading Configuration Editor
 *
 * Shows ALL trading config parameters in a clean grid layout.
 * Aligned exactly with TradingConfigContext - the single source of truth.
 *
 * Used across: Strategy Lab, Trading Simulator, A/B Testing, Live Trading
 */
import { useState } from 'react';
import theme from '../../theme';
import { useTradingConfig, DEFAULT_TRADING_CONFIG } from '../../contexts/TradingConfigContext';

// Complete config schema matching TradingConfigContext exactly
const CONFIG_SCHEMA = {
  'Capital Allocation': {
    allocatedCapital: { label: 'Capital ($)', type: 'number', min: 1000, max: 10000000, step: 1000 },
    maxLeverage: { label: 'Max Leverage', type: 'number', min: 1, max: 4, step: 0.5 },
    reserveCashPercent: { label: 'Cash Reserve %', type: 'number', min: 0, max: 50, step: 5 },
  },
  'Position Management': {
    maxPositions: { label: 'Max Positions', type: 'number', min: 1, max: 20, step: 1 },
    maxPositionSizePercent: { label: 'Max Position %', type: 'number', min: 1, max: 100, step: 5 },
    minPositionSize: { label: 'Min Position $', type: 'number', min: 50, max: 10000, step: 50 },
    maxPositionSize: { label: 'Max Position $', type: 'number', min: 1000, max: 100000, step: 1000 },
  },
  'Risk Management': {
    riskPerTradePercent: { label: 'Risk/Trade %', type: 'number', min: 0.5, max: 10, step: 0.5 },
    dailyLossLimitPercent: { label: 'Daily Loss Limit %', type: 'number', min: 1, max: 20, step: 1 },
    weeklyLossLimitPercent: { label: 'Weekly Loss Limit %', type: 'number', min: 2, max: 30, step: 1 },
    maxConsecutiveLosses: { label: 'Max Consec. Losses', type: 'number', min: 1, max: 10, step: 1 },
    trailingStopPercent: { label: 'Trailing Stop %', type: 'number', min: 0, max: 10, step: 0.5 },
  },
  'AI Model Parameters': {
    minConfidence: { label: 'Min Confidence %', type: 'number', min: 50, max: 95, step: 5 },
    rsiOversold: { label: 'RSI Oversold', type: 'number', min: 10, max: 40, step: 5 },
    rsiOverbought: { label: 'RSI Overbought', type: 'number', min: 60, max: 90, step: 5 },
    vwapDeviationPercent: { label: 'VWAP Deviation %', type: 'number', min: 0.1, max: 3, step: 0.1 },
    volumeMultiplier: { label: 'Volume Multiplier', type: 'number', min: 1, max: 5, step: 0.25 },
    adxMinStrength: { label: 'ADX Min Strength', type: 'number', min: 10, max: 40, step: 5 },
    macdSensitivity: { label: 'MACD Sensitivity', type: 'select', options: ['low', 'normal', 'high'] },
    patternRecognition: { label: 'Pattern Recognition', type: 'boolean' },
  },
  'Entry Conditions': {
    entryStrategy: { label: 'Entry Strategy', type: 'select', options: ['conservative', 'balanced', 'aggressive'] },
    requireVolumeSpike: { label: 'Require Volume Spike', type: 'boolean' },
    requireTrendAlignment: { label: 'Require Trend Align', type: 'boolean' },
    requireRsiSignal: { label: 'Require RSI Signal', type: 'boolean' },
    minSignalsRequired: { label: 'Min Signals Required', type: 'number', min: 1, max: 5, step: 1 },
  },
  'Exit Conditions': {
    takeProfitPercent: { label: 'Take Profit %', type: 'number', min: 0.5, max: 20, step: 0.25 },
    stopLossPercent: { label: 'Stop Loss %', type: 'number', min: 0.25, max: 10, step: 0.25 },
    useAdaptiveTargets: { label: 'Adaptive Targets', type: 'boolean' },
    exitOnRsiExtreme: { label: 'Exit on RSI Extreme', type: 'boolean' },
    exitBeforeClose: { label: 'Exit Before Close', type: 'boolean' },
    exitBeforeCloseMinutes: { label: 'Exit Mins Before Close', type: 'number', min: 5, max: 60, step: 5 },
  },
  'Timeframes': {
    preferredTimeframe: { label: 'Preferred Timeframe', type: 'select', options: ['1min', '5min', '15min', '30min', '1hour'] },
  },
};

const ConfigPanel = ({
  mode = 'view', // 'view', 'edit'
  showCategories = null, // null = all, or ['Capital Allocation', 'Exit Conditions']
  onConfigChange = null,
  localConfig = null, // use local state instead of context
  title = 'Trading Configuration',
  compact = false, // compact mode for inline display
}) => {
  const { config: contextConfig, updateConfig } = useTradingConfig();
  const [localState, setLocalState] = useState(localConfig || {});

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
      <div style={{
        display: 'flex',
        gap: theme.spacing.lg,
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.md,
        border: `1px solid ${theme.colors.border}`,
        flexWrap: 'wrap',
        fontSize: theme.typography.fontSize.sm,
      }}>
        <span><strong style={{ color: theme.colors.success }}>TP:</strong> {config.takeProfitPercent}%</span>
        <span><strong style={{ color: theme.colors.error }}>SL:</strong> {config.stopLossPercent}%</span>
        <span><strong>Conf:</strong> {config.minConfidence}%</span>
        <span><strong>Capital:</strong> ${(config.allocatedCapital || 25000).toLocaleString()}</span>
        <span><strong>Max Pos:</strong> {config.maxPositions}</span>
        <span><strong>Risk:</strong> {config.riskPerTradePercent}%</span>
      </div>
    );
  }

  // Input renderer
  const renderInput = (field, schema) => {
    const value = getSafeValue(field, schema);
    const isEditing = mode === 'edit';

    const inputStyle = {
      width: '100%',
      padding: '6px 8px',
      borderRadius: theme.borderRadius.sm,
      border: `1px solid ${theme.colors.border}`,
      backgroundColor: isEditing ? theme.colors.background : theme.colors.surface,
      color: theme.colors.text,
      fontSize: theme.typography.fontSize.sm,
    };

    if (!isEditing) {
      // View mode - display only
      let displayValue = value;
      if (typeof value === 'boolean') displayValue = value ? 'Yes' : 'No';
      else if (field.includes('Capital') || field.includes('PositionSize')) displayValue = `$${Number(value).toLocaleString()}`;
      else if (field.includes('Percent') || field === 'minConfidence') displayValue = `${value}%`;

      return (
        <div style={{
          ...inputStyle,
          backgroundColor: theme.colors.surface,
          fontWeight: theme.typography.fontWeight.medium,
        }}>
          {displayValue}
        </div>
      );
    }

    // Edit mode
    if (schema.type === 'boolean') {
      return (
        <select
          value={value ? 'true' : 'false'}
          onChange={(e) => handleChange(field, e.target.value === 'true')}
          style={inputStyle}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }

    if (schema.type === 'select') {
      return (
        <select
          value={value || schema.options[0]}
          onChange={(e) => handleChange(field, e.target.value)}
          style={inputStyle}
        >
          {schema.options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }

    return (
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          handleChange(field, Number.isNaN(parsed) ? schema.min || 0 : parsed);
        }}
        min={schema.min}
        max={schema.max}
        step={schema.step}
        style={inputStyle}
      />
    );
  };

  return (
    <div style={{
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      border: `1px solid ${theme.colors.border}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: theme.spacing.md,
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.background,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold }}>
            {title}
          </h3>
          {mode === 'edit' && (
            <span style={{
              fontSize: theme.typography.fontSize.xs,
              padding: '2px 8px',
              backgroundColor: theme.colors.primary,
              color: '#fff',
              borderRadius: theme.borderRadius.sm,
            }}>
              EDITING
            </span>
          )}
        </div>
      </div>

      {/* Config Grid - All categories visible */}
      <div style={{ padding: theme.spacing.md }}>
        {categoriesToShow.map(category => {
          const fields = CONFIG_SCHEMA[category];
          if (!fields) return null;

          return (
            <div key={category} style={{ marginBottom: theme.spacing.lg }}>
              {/* Category Header */}
              <h4 style={{
                margin: `0 0 ${theme.spacing.sm}`,
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                borderBottom: `1px solid ${theme.colors.border}`,
                paddingBottom: theme.spacing.xs,
              }}>
                {category}
              </h4>

              {/* Fields Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: theme.spacing.md,
              }}>
                {Object.entries(fields).map(([field, schema]) => (
                  <div key={field}>
                    <label style={{
                      display: 'block',
                      marginBottom: '4px',
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.textSecondary,
                      fontWeight: theme.typography.fontWeight.medium,
                    }}>
                      {schema.label}
                    </label>
                    {renderInput(field, schema)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Actions */}
        {mode === 'edit' && (
          <div style={{
            display: 'flex',
            gap: theme.spacing.sm,
            marginTop: theme.spacing.md,
            paddingTop: theme.spacing.md,
            borderTop: `1px solid ${theme.colors.border}`,
          }}>
            <button
              onClick={() => {
                if (localConfig !== null) {
                  setLocalState({});
                  if (onConfigChange) onConfigChange({});
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
