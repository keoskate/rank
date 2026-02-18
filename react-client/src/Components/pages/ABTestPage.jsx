/**
 * A/B Test Management Page - FULL CONFIG COMPARISON
 *
 * Test ANY config parameter from your trading strategy.
 * Control = Your current config, Challenger = Modified version to test.
 */

import { useState, useEffect, useCallback } from 'react';
import Card from '../common/Card';
import Button from '../common/Button';
import theme from '../../theme';
import { useTradingConfig, DEFAULT_TRADING_CONFIG } from '../../contexts/TradingConfigContext';

// Config parameter definitions with metadata
const CONFIG_SCHEMA = {
  'Capital Allocation': {
    allocatedCapital: { label: 'Allocated Capital', type: 'number', min: 1000, max: 10000000, step: 1000 },
    maxLeverage: { label: 'Max Leverage', type: 'number', min: 1, max: 4, step: 0.5 },
    reserveCashPercent: { label: 'Reserve Cash %', type: 'number', min: 0, max: 50, step: 5 },
  },
  'Position Management': {
    maxPositions: { label: 'Max Positions', type: 'number', min: 1, max: 20, step: 1 },
    maxPositionSizePercent: { label: 'Max Position Size %', type: 'number', min: 1, max: 100, step: 5 },
    minPositionSize: { label: 'Min Position $', type: 'number', min: 50, max: 10000, step: 50 },
    maxPositionSize: { label: 'Max Position $', type: 'number', min: 1000, max: 100000, step: 1000 },
  },
  'Risk Management': {
    riskPerTradePercent: { label: 'Risk Per Trade %', type: 'number', min: 0.5, max: 10, step: 0.5 },
    dailyLossLimitPercent: { label: 'Daily Loss Limit %', type: 'number', min: 1, max: 20, step: 1 },
    weeklyLossLimitPercent: { label: 'Weekly Loss Limit %', type: 'number', min: 2, max: 30, step: 1 },
    maxConsecutiveLosses: { label: 'Max Consecutive Losses', type: 'number', min: 1, max: 10, step: 1 },
    trailingStopPercent: { label: 'Trailing Stop (% of TP)', type: 'number', min: 0, max: 100, step: 10 },
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
    requireTrendAlignment: { label: 'Require Trend Alignment', type: 'boolean' },
    requireRsiSignal: { label: 'Require RSI Signal', type: 'boolean' },
    minSignalsRequired: { label: 'Min Signals Required', type: 'number', min: 1, max: 5, step: 1 },
  },
  'Exit Conditions': {
    takeProfitPercent: { label: 'Take Profit %', type: 'number', min: 0.5, max: 20, step: 0.25 },
    stopLossPercent: { label: 'Stop Loss %', type: 'number', min: 0.25, max: 10, step: 0.25 },
    useAdaptiveTargets: { label: 'Use Adaptive Targets', type: 'boolean' },
    exitOnRsiExtreme: { label: 'Exit on RSI Extreme', type: 'boolean' },
    exitBeforeClose: { label: 'Exit Before Close', type: 'boolean' },
    exitBeforeCloseMinutes: { label: 'Exit Minutes Before Close', type: 'number', min: 5, max: 60, step: 5 },
  },
  'Timeframes': {
    preferredTimeframe: { label: 'Preferred Timeframe', type: 'select', options: ['1min', '5min', '15min', '30min', '1hour'] },
  },
};

const ABTestPage = () => {
  const { config: globalConfig, updateConfig: updateGlobalConfig } = useTradingConfig();

  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTest, setSelectedTest] = useState(null);
  const [backtestRunning, setBacktestRunning] = useState({});
  const [expandedCategories, setExpandedCategories] = useState({});

  // New test form state - starts with current config as control
  const [newTest, setNewTest] = useState({
    name: '',
    symbol: globalConfig?.watchlist?.[0] || 'NVDA',
    description: '',
    controlConfig: { ...globalConfig },
    challengerConfig: { ...globalConfig },
  });

  // Track which parameters are different
  const [changedParams, setChangedParams] = useState(new Set());

  // Fetch tests
  const fetchTests = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/ab-tests');
      if (!res.ok) throw new Error('Failed to fetch tests');
      const data = await res.json();
      setTests(data.tests || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTests();
  }, [fetchTests]);

  // Initialize form with current config
  const initializeNewTest = () => {
    setNewTest({
      name: '',
      symbol: globalConfig?.watchlist?.[0] || 'NVDA',
      description: '',
      controlConfig: { ...globalConfig },
      challengerConfig: { ...globalConfig },
    });
    setChangedParams(new Set());
    setShowCreateForm(true);
  };

  // Update challenger config and track changes
  const updateChallengerParam = (key, value) => {
    setNewTest(prev => ({
      ...prev,
      challengerConfig: { ...prev.challengerConfig, [key]: value },
    }));

    // Track if this param differs from control
    setChangedParams(prev => {
      const next = new Set(prev);
      if (value !== newTest.controlConfig[key]) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  // Toggle category expansion
  const toggleCategory = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  // Create test
  const createTest = async () => {
    if (!newTest.name || changedParams.size === 0) {
      setError('Please name your test and change at least one parameter');
      return;
    }

    try {
      const res = await fetch('/api/ab-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTest.name,
          symbol: newTest.symbol,
          description: newTest.description,
          variants: [
            { name: 'Control (Current Config)', config: newTest.controlConfig },
            { name: 'Challenger', config: newTest.challengerConfig },
          ],
          changedParameters: Array.from(changedParams),
        }),
      });

      if (!res.ok) throw new Error('Failed to create test');

      setShowCreateForm(false);
      fetchTests();
    } catch (err) {
      setError(err.message);
    }
  };

  // Run backtest
  const runBacktest = async (testId, variantId, symbol) => {
    const key = `${testId}-${variantId}`;
    setBacktestRunning(prev => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`/api/ab-tests/${testId}/variants/${variantId}/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });

      if (!res.ok) throw new Error('Backtest failed');
      fetchTests();
    } catch (err) {
      setError(err.message);
    } finally {
      setBacktestRunning(prev => ({ ...prev, [key]: false }));
    }
  };

  // Apply winning config
  const applyConfig = (config) => {
    updateGlobalConfig(config);
    alert('Config applied to your trading settings!');
  };

  // Render config input
  const renderConfigInput = (key, schema, value, onChange, isDifferent) => {
    const baseStyle = {
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
      border: `1px solid ${isDifferent ? theme.colors.warning : theme.colors.gray300}`,
      backgroundColor: isDifferent ? theme.colors.warning + '10' : theme.colors.surface,
      width: '100%',
      fontSize: theme.typography.fontSize.sm,
    };

    // Get default value from DEFAULT_TRADING_CONFIG or schema
    const getDefaultValue = () => {
      if (DEFAULT_TRADING_CONFIG[key] !== undefined) return DEFAULT_TRADING_CONFIG[key];
      if (schema.type === 'boolean') return false;
      if (schema.type === 'select') return schema.options[0];
      return schema.min || 0;
    };

    // Ensure value is never undefined/NaN
    const safeValue = value !== undefined && value !== null && !Number.isNaN(value)
      ? value
      : getDefaultValue();

    if (schema.type === 'boolean') {
      return (
        <select
          value={safeValue ? 'true' : 'false'}
          onChange={(e) => onChange(key, e.target.value === 'true')}
          style={baseStyle}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }

    if (schema.type === 'select') {
      return (
        <select
          value={safeValue || schema.options[0]}
          onChange={(e) => onChange(key, e.target.value)}
          style={baseStyle}
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
        value={safeValue}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          onChange(key, Number.isNaN(parsed) ? schema.min || 0 : parsed);
        }}
        min={schema.min}
        max={schema.max}
        step={schema.step}
        style={baseStyle}
      />
    );
  };

  // Format values for display
  const formatValue = (key, value) => {
    if (value === undefined || value === null) return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return '-';
      if (key.includes('Percent') || key.includes('percent')) return `${value}%`;
      if (key.includes('Capital') || key.includes('Size') || key.includes('Position')) return `$${value.toLocaleString()}`;
      return value;
    }
    return value;
  };

  return (
    <div style={{ padding: theme.spacing.lg, maxWidth: theme.layout.maxWidth, margin: '0 auto' }}>
      <div style={{ marginBottom: theme.spacing.lg }}>
        <h1 style={{ margin: 0, marginBottom: theme.spacing.xs }}>A/B Testing</h1>
        <p style={{ color: theme.colors.gray600, margin: 0 }}>
          Compare your current trading config against modified versions. Test ANY parameter.
        </p>
      </div>

      {error && (
        <Card style={{ backgroundColor: theme.colors.error + '10', marginBottom: theme.spacing.md }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: theme.colors.error }}>{error}</span>
            <Button size="small" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
          </div>
        </Card>
      )}

      {/* Create New Test Button */}
      {!showCreateForm && (
        <Button onClick={initializeNewTest} style={{ marginBottom: theme.spacing.lg }}>
          + Create New A/B Test
        </Button>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <Card style={{ marginBottom: theme.spacing.lg }}>
          <h2 style={{ margin: 0, marginBottom: theme.spacing.md }}>Create New A/B Test</h2>

          {/* Test Info */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: theme.spacing.md, marginBottom: theme.spacing.lg }}>
            <div>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: 500 }}>Test Name</label>
              <input
                type="text"
                value={newTest.name}
                onChange={(e) => setNewTest(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Wider Stop Loss Test"
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.gray300}`,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: 500 }}>Symbol</label>
              <select
                value={newTest.symbol}
                onChange={(e) => setNewTest(prev => ({ ...prev, symbol: e.target.value }))}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.gray300}`,
                }}
              >
                {(globalConfig?.watchlist || ['NVDA', 'TSLA', 'SPY']).map(sym => (
                  <option key={sym} value={sym}>{sym}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Changed Parameters Summary */}
          {changedParams.size > 0 && (
            <div style={{
              padding: theme.spacing.md,
              backgroundColor: theme.colors.warning + '15',
              borderRadius: theme.borderRadius.md,
              marginBottom: theme.spacing.lg,
              border: `1px solid ${theme.colors.warning}`,
            }}>
              <strong style={{ color: theme.colors.warning }}>
                {changedParams.size} parameter{changedParams.size > 1 ? 's' : ''} modified:
              </strong>
              <div style={{ marginTop: theme.spacing.sm, display: 'flex', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {Array.from(changedParams).map(param => {
                  const schema = Object.values(CONFIG_SCHEMA).flatMap(cat => Object.entries(cat)).find(([k]) => k === param)?.[1];
                  return (
                    <span
                      key={param}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: theme.colors.warning + '30',
                        borderRadius: theme.borderRadius.sm,
                        fontSize: theme.typography.fontSize.sm,
                      }}
                    >
                      {schema?.label || param}: {formatValue(param, newTest.controlConfig[param])} → {formatValue(param, newTest.challengerConfig[param])}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Side by Side Config Comparison */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.spacing.lg }}>
            {/* Control */}
            <div>
              <h3 style={{ margin: 0, marginBottom: theme.spacing.md, color: theme.colors.primary }}>
                Control (Your Current Config)
              </h3>
              <p style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm, marginBottom: theme.spacing.md }}>
                This is your current trading configuration. It will not be modified.
              </p>
            </div>

            {/* Challenger */}
            <div>
              <h3 style={{ margin: 0, marginBottom: theme.spacing.md, color: theme.colors.warning }}>
                Challenger (Modified Config)
              </h3>
              <p style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm, marginBottom: theme.spacing.md }}>
                Modify parameters below to test against the control.
              </p>
            </div>
          </div>

          {/* Config Categories */}
          {Object.entries(CONFIG_SCHEMA).map(([category, params]) => (
            <div key={category} style={{ marginBottom: theme.spacing.md }}>
              <button
                onClick={() => toggleCategory(category)}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  backgroundColor: theme.colors.gray100,
                  border: 'none',
                  borderRadius: theme.borderRadius.md,
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontWeight: 600,
                }}
              >
                <span>{category}</span>
                <span style={{ color: theme.colors.gray500 }}>
                  {expandedCategories[category] ? '▼' : '▶'}
                </span>
              </button>

              {expandedCategories[category] && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: theme.spacing.md,
                  padding: theme.spacing.md,
                  backgroundColor: theme.colors.gray50,
                  borderRadius: `0 0 ${theme.borderRadius.md} ${theme.borderRadius.md}`,
                }}>
                  {/* Control Column */}
                  <div>
                    {Object.entries(params).map(([key, schema]) => (
                      <div key={key} style={{ marginBottom: theme.spacing.sm }}>
                        <label style={{
                          display: 'block',
                          marginBottom: '4px',
                          fontSize: theme.typography.fontSize.sm,
                          color: theme.colors.gray600,
                        }}>
                          {schema.label}
                        </label>
                        <div style={{
                          padding: theme.spacing.sm,
                          backgroundColor: theme.colors.gray200,
                          borderRadius: theme.borderRadius.md,
                          fontSize: theme.typography.fontSize.sm,
                        }}>
                          {formatValue(key, newTest.controlConfig[key])}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Challenger Column */}
                  <div>
                    {Object.entries(params).map(([key, schema]) => {
                      const isDifferent = changedParams.has(key);
                      return (
                        <div key={key} style={{ marginBottom: theme.spacing.sm }}>
                          <label style={{
                            display: 'block',
                            marginBottom: '4px',
                            fontSize: theme.typography.fontSize.sm,
                            color: isDifferent ? theme.colors.warning : theme.colors.gray600,
                            fontWeight: isDifferent ? 600 : 400,
                          }}>
                            {schema.label} {isDifferent && '(modified)'}
                          </label>
                          {renderConfigInput(
                            key,
                            schema,
                            newTest.challengerConfig[key],
                            updateChallengerParam,
                            isDifferent
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Actions */}
          <div style={{ display: 'flex', gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
            <Button onClick={createTest} disabled={!newTest.name || changedParams.size === 0}>
              Create Test ({changedParams.size} changes)
            </Button>
            <Button variant="outline" onClick={() => setShowCreateForm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Existing Tests */}
      <h2 style={{ marginBottom: theme.spacing.md }}>Your Tests ({tests.length})</h2>

      {loading ? (
        <p>Loading tests...</p>
      ) : tests.length === 0 ? (
        <Card>
          <p style={{ color: theme.colors.gray500, textAlign: 'center' }}>
            No tests yet. Create one to compare different configurations.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: theme.spacing.md }}>
          {tests.map(test => (
            <Card key={test.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0, marginBottom: theme.spacing.xs }}>{test.name}</h3>
                  <p style={{ margin: 0, color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
                    Symbol: {test.symbol} | Status: {test.status}
                    {test.changedParameters && ` | Testing: ${test.changedParameters.join(', ')}`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: theme.spacing.sm }}>
                  <Button
                    size="small"
                    variant="outline"
                    onClick={() => setSelectedTest(selectedTest === test.id ? null : test.id)}
                  >
                    {selectedTest === test.id ? 'Hide Details' : 'View Details'}
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={async () => {
                      await fetch(`/api/ab-tests/${test.id}`, { method: 'DELETE' });
                      fetchTests();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {/* Expanded Details */}
              {selectedTest === test.id && test.variants && (
                <div style={{ marginTop: theme.spacing.lg }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.spacing.lg }}>
                    {test.variants.map((variant, idx) => (
                      <div
                        key={variant.id}
                        style={{
                          padding: theme.spacing.md,
                          backgroundColor: idx === 0 ? theme.colors.primary + '08' : theme.colors.warning + '08',
                          borderRadius: theme.borderRadius.md,
                          border: `1px solid ${idx === 0 ? theme.colors.primary : theme.colors.warning}30`,
                        }}
                      >
                        <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: idx === 0 ? theme.colors.primary : theme.colors.warning }}>
                          {variant.name}
                          {variant.isWinner && ' (WINNER)'}
                        </h4>

                        {/* Results if available */}
                        {variant.metrics && variant.metrics.totalTrades > 0 && (
                          <div style={{ marginBottom: theme.spacing.md }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: theme.spacing.sm, textAlign: 'center' }}>
                              <div>
                                <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>P&L</div>
                                <div style={{
                                  fontWeight: 'bold',
                                  color: variant.metrics.totalPnL >= 0 ? theme.colors.success : theme.colors.error,
                                }}>
                                  ${variant.metrics.totalPnL?.toFixed(2)}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>Win Rate</div>
                                <div style={{ fontWeight: 'bold' }}>{variant.metrics.winRate?.toFixed(0)}%</div>
                              </div>
                              <div>
                                <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>Trades</div>
                                <div style={{ fontWeight: 'bold' }}>{variant.metrics.totalTrades}</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: theme.spacing.sm }}>
                          <Button
                            size="small"
                            variant="outline"
                            onClick={() => runBacktest(test.id, variant.id, test.symbol)}
                            disabled={backtestRunning[`${test.id}-${variant.id}`]}
                          >
                            {backtestRunning[`${test.id}-${variant.id}`] ? 'Running...' : 'Run Backtest'}
                          </Button>
                          {variant.config && (
                            <Button
                              size="small"
                              variant={variant.isWinner ? 'primary' : 'ghost'}
                              onClick={() => applyConfig(variant.config)}
                            >
                              Apply Config
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default ABTestPage;
