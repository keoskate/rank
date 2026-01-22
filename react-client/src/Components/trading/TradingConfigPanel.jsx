/**
 * TradingConfigPanel
 *
 * Clean, single-page trading configuration with:
 * - Watchlist selection (dropdown + manual edit)
 * - Exit rules (stop loss, take profit, trailing stop)
 * - Capital settings (paper/live, positions, sizing)
 * - Advanced settings (collapsed by default)
 */

import { useState } from 'react';
import theme from '../../theme';
import { getStockListNames, getStockList } from '../../config/stockLists';

// Section wrapper component
const Section = ({ title, children }) => (
  <div
    style={{
      marginBottom: theme.spacing.lg,
      padding: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      border: `1px solid ${theme.colors.gray200}`,
    }}
  >
    <h3
      style={{
        margin: 0,
        marginBottom: theme.spacing.md,
        fontSize: theme.typography.fontSize.md,
        fontWeight: theme.typography.fontWeight.medium,
        color: theme.colors.gray700,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}
    >
      {title}
    </h3>
    {children}
  </div>
);

// Range slider with value display
const SliderInput = ({ label, value, onChange, min, max, step, unit = '%', hint }) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div style={{ flex: 1 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.xs,
        }}
      >
        <label
          style={{
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
          }}
        >
          {label}
        </label>
        <span
          style={{
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.gray900,
          }}
        >
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          height: '8px',
          borderRadius: '4px',
          background: `linear-gradient(to right, ${theme.colors.info} 0%, ${theme.colors.info} ${percentage}%, ${theme.colors.gray200} ${percentage}%, ${theme.colors.gray200} 100%)`,
          outline: 'none',
          cursor: 'pointer',
          WebkitAppearance: 'none',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.gray500,
          marginTop: '2px',
        }}
      >
        <span>{min}{unit}</span>
        {hint && <span>{hint}</span>}
        <span>{max}{unit}</span>
      </div>
    </div>
  );
};

// Toggle button group
const ToggleGroup = ({ options, value, onChange, disabled }) => (
  <div
    style={{
      display: 'flex',
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden',
      border: `1px solid ${theme.colors.gray300}`,
    }}
  >
    {options.map(option => (
      <button
        key={option.value}
        onClick={() => !disabled && onChange(option.value)}
        disabled={disabled}
        style={{
          flex: 1,
          padding: `${theme.spacing.sm} ${theme.spacing.md}`,
          border: 'none',
          backgroundColor:
            value === option.value ? theme.colors.info : theme.colors.surface,
          color: value === option.value ? '#fff' : theme.colors.gray700,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.fontWeight.medium,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: theme.transitions.fast,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {option.label}
      </button>
    ))}
  </div>
);

// Number input with label
const NumberInput = ({ label, value, onChange, min, max, step = 1, prefix, suffix, hint }) => (
  <div style={{ flex: 1 }}>
    <label
      style={{
        display: 'block',
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.gray600,
        marginBottom: theme.spacing.xs,
      }}
    >
      {label}
    </label>
    <div style={{ position: 'relative' }}>
      {prefix && (
        <span
          style={{
            position: 'absolute',
            left: theme.spacing.sm,
            top: '50%',
            transform: 'translateY(-50%)',
            color: theme.colors.gray500,
          }}
        >
          {prefix}
        </span>
      )}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{
          width: '100%',
          padding: theme.spacing.sm,
          paddingLeft: prefix ? theme.spacing.lg : theme.spacing.sm,
          paddingRight: suffix ? theme.spacing.lg : theme.spacing.sm,
          border: `1px solid ${theme.colors.gray300}`,
          borderRadius: theme.borderRadius.sm,
          fontSize: theme.typography.fontSize.base,
        }}
      />
      {suffix && (
        <span
          style={{
            position: 'absolute',
            right: theme.spacing.sm,
            top: '50%',
            transform: 'translateY(-50%)',
            color: theme.colors.gray500,
          }}
        >
          {suffix}
        </span>
      )}
    </div>
    {hint && (
      <span
        style={{
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.gray500,
        }}
      >
        {hint}
      </span>
    )}
  </div>
);

const TradingConfigPanel = ({ config, onUpdateConfig }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editingWatchlist, setEditingWatchlist] = useState(false);
  const [watchlistText, setWatchlistText] = useState(config.watchlist?.join(', ') || '');

  // Calculate derived values
  const maxPositionValue = config.allocatedCapital * (config.maxPositionSizePercent / 100);
  const maxLossPerTrade = maxPositionValue * (config.stopLossPercent / 100);
  const riskRewardRatio = config.takeProfitPercent / config.stopLossPercent;
  const dailyLossLimit = config.allocatedCapital * (config.dailyLossLimitPercent / 100);

  // Detect which preset matches current watchlist (if any)
  const detectCurrentPreset = () => {
    const currentWatchlist = config.watchlist || [];
    if (currentWatchlist.length === 0) return '';

    const presets = getStockListNames();
    for (const preset of presets) {
      const presetStocks = getStockList(preset.id)?.stocks || [];
      // Check if watchlists match (same symbols, order doesn't matter)
      if (
        presetStocks.length === currentWatchlist.length &&
        presetStocks.every(s => currentWatchlist.includes(s))
      ) {
        return preset.id;
      }
    }
    return ''; // Custom watchlist, no preset match
  };

  const currentPresetId = detectCurrentPreset();

  // Handle watchlist preset selection
  const handlePresetSelect = presetId => {
    if (presetId) {
      const preset = getStockList(presetId);
      if (preset?.stocks) {
        onUpdateConfig({ watchlist: preset.stocks });
        setWatchlistText(preset.stocks.join(', '));
      }
    }
  };

  // Handle manual watchlist edit
  const handleWatchlistSave = () => {
    const symbols = watchlistText
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s);
    onUpdateConfig({ watchlist: symbols });
    setEditingWatchlist(false);
  };

  return (
    <div>

      {/* SECTION 1: WATCHLIST */}
      <Section title="Watchlist">
        <div style={{ marginBottom: theme.spacing.sm }}>
          <select
            onChange={e => handlePresetSelect(e.target.value)}
            value={currentPresetId}
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.gray300}`,
              borderRadius: theme.borderRadius.sm,
              fontSize: theme.typography.fontSize.base,
              backgroundColor: theme.colors.surface,
              cursor: 'pointer',
            }}
          >
            <option value="">{currentPresetId ? 'Select preset watchlist...' : 'Custom watchlist'}</option>
            {getStockListNames().map(list => (
              <option key={list.id} value={list.id}>
                {list.name} ({list.count} stocks)
              </option>
            ))}
          </select>
        </div>

        {editingWatchlist ? (
          <div>
            <textarea
              value={watchlistText}
              onChange={e => setWatchlistText(e.target.value)}
              placeholder="Enter symbols separated by commas: AAPL, TSLA, NVDA..."
              style={{
                width: '100%',
                minHeight: '60px',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.info}`,
                borderRadius: theme.borderRadius.sm,
                fontSize: theme.typography.fontSize.base,
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
              <button
                onClick={handleWatchlistSave}
                style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                  backgroundColor: theme.colors.success,
                  color: '#fff',
                  border: 'none',
                  borderRadius: theme.borderRadius.sm,
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  setWatchlistText(config.watchlist?.join(', ') || '');
                  setEditingWatchlist(false);
                }}
                style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                  backgroundColor: theme.colors.gray200,
                  border: 'none',
                  borderRadius: theme.borderRadius.sm,
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.gray100,
              borderRadius: theme.borderRadius.sm,
            }}
          >
            <div style={{ flex: 1 }}>
              <span style={{ color: theme.colors.gray700 }}>
                {config.watchlist?.join(', ') || 'No symbols'}
              </span>
              <span
                style={{
                  marginLeft: theme.spacing.sm,
                  color: theme.colors.gray500,
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                ({config.watchlist?.length || 0} symbols)
              </span>
            </div>
            <button
              onClick={() => setEditingWatchlist(true)}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
              }}
            >
              Edit
            </button>
          </div>
        )}
      </Section>

      {/* SECTION 2: EXIT RULES */}
      <Section title="Exit Rules">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: theme.spacing.lg,
            marginBottom: theme.spacing.md,
          }}
        >
          <SliderInput
            label="Stop Loss"
            value={config.stopLossPercent || 1}
            onChange={val => onUpdateConfig({ stopLossPercent: val })}
            min={0.5}
            max={15}
            step={0.5}
            hint="Cut losses"
          />
          <SliderInput
            label="Take Profit"
            value={config.takeProfitPercent || 2}
            onChange={val => onUpdateConfig({ takeProfitPercent: val })}
            min={1}
            max={25}
            step={0.5}
            hint="Lock gains"
          />
          <SliderInput
            label="Trailing Stop"
            value={config.trailingStopPercent || 0}
            onChange={val => onUpdateConfig({ trailingStopPercent: val })}
            min={0}
            max={100}
            step={5}
            hint={config.trailingStopPercent > 0 ? 'Active' : 'Disabled'}
          />
        </div>
      </Section>

      {/* SECTION 3: CAPITAL */}
      <Section title="Capital">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: theme.spacing.lg,
            marginBottom: theme.spacing.md,
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
                marginBottom: theme.spacing.xs,
              }}
            >
              Account
            </label>
            <ToggleGroup
              options={[
                { value: true, label: 'Paper' },
                { value: false, label: 'Live' },
              ]}
              value={config.paperTradeOnly}
              onChange={val => onUpdateConfig({ paperTradeOnly: val })}
            />
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: config.paperTradeOnly ? theme.colors.success : theme.colors.error,
                marginTop: '4px',
                display: 'block',
              }}
            >
              {config.paperTradeOnly ? 'Safe mode' : 'Real money!'}
            </span>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
                marginBottom: theme.spacing.xs,
              }}
            >
              Asset Type
            </label>
            <ToggleGroup
              options={[
                { value: 'stocks', label: 'Stocks' },
                { value: 'crypto', label: 'Crypto' },
              ]}
              value={config.assetType || 'stocks'}
              onChange={val => onUpdateConfig({ assetType: val })}
            />
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.gray500,
                marginTop: '4px',
                display: 'block',
              }}
            >
              {config.assetType === 'crypto' ? '24/7 trading' : 'Market hours'}
            </span>
          </div>

          <NumberInput
            label="Capital"
            value={config.allocatedCapital || 0}
            onChange={val => onUpdateConfig({ allocatedCapital: val })}
            min={1000}
            max={10000000}
            step={1000}
            prefix="$"
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: theme.spacing.md,
          }}
        >
          <NumberInput
            label="Max Positions"
            value={config.maxPositions || 5}
            onChange={val => onUpdateConfig({ maxPositions: val })}
            min={1}
            max={20}
            hint="Concurrent trades"
          />
          <NumberInput
            label="Position Size"
            value={config.maxPositionSizePercent || 10}
            onChange={val => onUpdateConfig({ maxPositionSizePercent: val })}
            min={1}
            max={50}
            suffix="%"
            hint="Per trade"
          />
          <div>
            <label
              style={{
                display: 'block',
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
                marginBottom: theme.spacing.xs,
              }}
            >
              Max Per Position
            </label>
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.gray100,
                borderRadius: theme.borderRadius.sm,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              ${maxPositionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
              Calculated
            </span>
          </div>
        </div>
      </Section>

      {/* SECTION 4: ESTIMATED RISK (Calculator - depends on Exit Rules + Capital) */}
      <Section title="Estimated Risk">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            backgroundColor: theme.colors.infoLight,
            borderRadius: theme.borderRadius.md,
            border: `1px solid ${theme.colors.infoBorder}`,
          }}
        >
          <div>
            <span style={{ color: theme.colors.gray600, fontSize: theme.typography.fontSize.sm }}>
              Risk/Reward
            </span>
            <div
              style={{
                fontWeight: theme.typography.fontWeight.bold,
                fontSize: theme.typography.fontSize.xl,
                color: riskRewardRatio >= 2 ? theme.colors.success : theme.colors.warning,
              }}
            >
              {riskRewardRatio.toFixed(1)}:1
            </div>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
              {config.takeProfitPercent}% TP / {config.stopLossPercent}% SL
            </span>
          </div>
          <div>
            <span style={{ color: theme.colors.gray600, fontSize: theme.typography.fontSize.sm }}>
              Max Loss/Trade
            </span>
            <div
              style={{
                fontWeight: theme.typography.fontWeight.bold,
                fontSize: theme.typography.fontSize.xl,
                color: theme.colors.error,
              }}
            >
              ${maxLossPerTrade.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
              {config.stopLossPercent}% of ${maxPositionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div>
            <span style={{ color: theme.colors.gray600, fontSize: theme.typography.fontSize.sm }}>
              Daily Limit
            </span>
            <div
              style={{
                fontWeight: theme.typography.fontWeight.bold,
                fontSize: theme.typography.fontSize.xl,
                color: theme.colors.gray800,
              }}
            >
              ${dailyLossLimit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
              {config.dailyLossLimitPercent || 5}% of ${(config.allocatedCapital || 0).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Exit Protection Settings */}
        <div
          style={{
            marginTop: theme.spacing.md,
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.gray50,
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: theme.spacing.sm,
          }}
        >
          <span>
            Min hold <strong>{config.minHoldMinutes || 10} min</strong>
          </span>
          <span>
            Trailing activates at <strong>{config.trailingStopMinProfitPercent || 2}%</strong> profit
          </span>
          <span>
            No weak exits under <strong>{config.minProfitForExitPercent || 1.5}%</strong> profit
          </span>
        </div>
      </Section>

      {/* SECTION 5: ADVANCED (Collapsible) */}
      <div
        style={{
          marginBottom: theme.spacing.lg,
          border: `1px solid ${theme.colors.gray200}`,
          borderRadius: theme.borderRadius.lg,
          overflow: 'hidden',
        }}
      >
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            width: '100%',
            padding: theme.spacing.md,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: theme.colors.gray100,
            border: 'none',
            cursor: 'pointer',
            fontSize: theme.typography.fontSize.md,
            fontWeight: theme.typography.fontWeight.medium,
            color: theme.colors.gray700,
          }}
        >
          <span>Advanced Settings</span>
          <span style={{ fontSize: theme.typography.fontSize.lg }}>
            {showAdvanced ? '−' : '+'}
          </span>
        </button>

        {showAdvanced && (
          <div style={{ padding: theme.spacing.md, backgroundColor: theme.colors.surface }}>
            {/* Entry Strategy */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.gray700 }}>
                Entry Strategy
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.spacing.md }}>
                <div>
                  <label style={{ display: 'block', fontSize: theme.typography.fontSize.sm, marginBottom: theme.spacing.xs }}>
                    Strategy
                  </label>
                  <select
                    value={config.entryStrategy || 'balanced'}
                    onChange={e => onUpdateConfig({ entryStrategy: e.target.value })}
                    style={{
                      width: '100%',
                      padding: theme.spacing.sm,
                      border: `1px solid ${theme.colors.gray300}`,
                      borderRadius: theme.borderRadius.sm,
                    }}
                  >
                    <option value="dip">Buy the Dip</option>
                    <option value="momentum">Momentum</option>
                    <option value="balanced">Balanced</option>
                    <option value="conservative">Conservative</option>
                    <option value="aggressive">Aggressive</option>
                  </select>
                </div>
                <NumberInput
                  label="Min Confidence"
                  value={config.minConfidence || 70}
                  onChange={val => onUpdateConfig({ minConfidence: val })}
                  min={50}
                  max={95}
                  step={5}
                  suffix="%"
                />
              </div>
            </div>

            {/* AI Model Parameters */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.gray700 }}>
                AI Model Parameters
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: theme.spacing.md }}>
                <NumberInput
                  label="RSI Oversold"
                  value={config.rsiOversold || 30}
                  onChange={val => onUpdateConfig({ rsiOversold: val })}
                  min={20}
                  max={40}
                />
                <NumberInput
                  label="RSI Overbought"
                  value={config.rsiOverbought || 70}
                  onChange={val => onUpdateConfig({ rsiOverbought: val })}
                  min={60}
                  max={80}
                />
                <NumberInput
                  label="Volume Multiplier"
                  value={config.volumeMultiplier || 1.5}
                  onChange={val => onUpdateConfig({ volumeMultiplier: val })}
                  min={1}
                  max={3}
                  step={0.1}
                  suffix="x"
                />
              </div>
            </div>

            {/* Risk Limits */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.gray700 }}>
                Risk Limits
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: theme.spacing.md }}>
                <NumberInput
                  label="Daily Loss Limit"
                  value={config.dailyLossLimitPercent || 5}
                  onChange={val => onUpdateConfig({ dailyLossLimitPercent: val })}
                  min={1}
                  max={20}
                  suffix="%"
                />
                <NumberInput
                  label="Weekly Loss Limit"
                  value={config.weeklyLossLimitPercent || 10}
                  onChange={val => onUpdateConfig({ weeklyLossLimitPercent: val })}
                  min={1}
                  max={30}
                  suffix="%"
                />
                <NumberInput
                  label="Max Consecutive Losses"
                  value={config.maxConsecutiveLosses || 3}
                  onChange={val => onUpdateConfig({ maxConsecutiveLosses: val })}
                  min={1}
                  max={10}
                />
              </div>
            </div>

            {/* Exit Protection - Prevents premature exits */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.gray700 }}>
                Exit Protection
              </h4>
              <p style={{ margin: 0, marginBottom: theme.spacing.sm, fontSize: theme.typography.fontSize.sm, color: theme.colors.gray500 }}>
                Prevents selling too early with small profits
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: theme.spacing.md }}>
                <NumberInput
                  label="Trailing Stop Min Profit"
                  value={config.trailingStopMinProfitPercent || 2}
                  onChange={val => onUpdateConfig({ trailingStopMinProfitPercent: val })}
                  min={0.5}
                  max={5}
                  step={0.5}
                  suffix="%"
                />
                <NumberInput
                  label="Min Profit to Exit"
                  value={config.minProfitForExitPercent || 1.5}
                  onChange={val => onUpdateConfig({ minProfitForExitPercent: val })}
                  min={0}
                  max={5}
                  step={0.5}
                  suffix="%"
                />
                <NumberInput
                  label="Min Hold Time"
                  value={config.minHoldMinutes || 10}
                  onChange={val => onUpdateConfig({ minHoldMinutes: val })}
                  min={1}
                  max={60}
                  suffix=" min"
                />
              </div>
            </div>

            {/* Toggles */}
            <div>
              <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.gray700 }}>
                Entry/Exit Conditions
              </h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: theme.spacing.sm,
                }}
              >
                {[
                  { key: 'requireVolumeSpike', label: 'Require Volume Spike' },
                  { key: 'requireTrendAlignment', label: 'Require Trend Alignment' },
                  { key: 'requireRsiSignal', label: 'Require RSI Signal' },
                  { key: 'useAdaptiveTargets', label: 'Adaptive Targets (ATR)' },
                  { key: 'exitOnRsiExtreme', label: 'Exit on RSI Extreme' },
                  { key: 'exitBeforeClose', label: 'Exit Before Market Close' },
                ].map(toggle => (
                  <label
                    key={toggle.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      padding: theme.spacing.sm,
                      backgroundColor: config[toggle.key] ? theme.colors.successLight : theme.colors.gray100,
                      borderRadius: theme.borderRadius.sm,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={config[toggle.key] || false}
                      onChange={e => onUpdateConfig({ [toggle.key]: e.target.checked })}
                    />
                    <span style={{ fontSize: theme.typography.fontSize.sm }}>
                      {toggle.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TradingConfigPanel;
