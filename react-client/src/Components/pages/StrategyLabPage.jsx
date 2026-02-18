import { useState, useEffect, useCallback, useRef } from 'react';
import theme from '../../theme';
import { StrategyAnalyticsDashboard } from '../Analytics';
import { useTradingConfig } from '../../contexts/TradingConfigContext';
import ConfigPanel from '../common/ConfigPanel';

/**
 * StrategyLabPage - The central hub for strategy management and simulation
 *
 * Concepts:
 * - STRATEGY: A saved configuration (take profit, stop loss, entry rules, etc.)
 * - SIMULATION: Apply a strategy to a specific date/period and see trades
 * - VALIDATION: Test strategy on random unseen days
 *
 * Integration with TradingConfigContext:
 * - Load current trading config as new strategy baseline
 * - Apply selected strategy to live trading config
 *
 * Tabs:
 * 1. Strategies - Create, edit, save, version control
 * 2. Day Simulator - Run strategy on a specific date, visualize trades
 * 3. Random Validator - Test on random unseen dates
 * 4. Results - View analytics for simulation results
 */
const StrategyLabPage = () => {
  // Get shared trading config
  const { config: globalConfig, updateConfig: updateGlobalConfig } = useTradingConfig();

  const [activeTab, setActiveTab] = useState('strategies');
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Simulation state
  const [simulationConfig, setSimulationConfig] = useState({
    symbol: globalConfig?.watchlist?.[0] || 'SOXL',
    date: new Date().toISOString().split('T')[0],
    strategyId: null,
  });
  const [simulationResult, setSimulationResult] = useState(null);
  const [simulationTrades, setSimulationTrades] = useState([]);

  // Validation state
  const [validationConfig, setValidationConfig] = useState({
    symbol: globalConfig?.watchlist?.[0] || 'SOXL',
    strategyId: null,
    numDays: 5,
    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  });
  const [validationResults, setValidationResults] = useState(null);

  // New strategy form - uses FULL config from global config
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newStrategyMeta, setNewStrategyMeta] = useState({
    name: '',
    symbol: globalConfig?.watchlist?.[0] || 'SOXL',
    description: '',
  });
  // Full strategy config - starts with current global config
  const [newStrategyConfig, setNewStrategyConfig] = useState({});

  // Handle config changes from ConfigPanel
  const handleNewStrategyConfigChange = (updates) => {
    setNewStrategyConfig(prev => ({ ...prev, ...updates }));
  };

  // Apply selected strategy to live trading config (applies ALL config params)
  const applyStrategyToTrading = (strategy) => {
    if (!strategy || !strategy.config) return;
    // Apply the entire strategy config to global trading config
    updateGlobalConfig(strategy.config);
    alert('Full strategy config applied to trading settings!');
  };

  // Fetch strategies on mount
  useEffect(() => {
    fetchStrategies();
  }, []);

  const fetchStrategies = async () => {
    try {
      const response = await fetch('/api/strategies');
      const data = await response.json();
      if (data.strategies) {
        setStrategies(data.strategies);
      }
    } catch (err) {
      // Fallback to version control
      try {
        const response = await fetch('/api/strategy-versions');
        const data = await response.json();
        if (data.symbols) {
          const allStrategies = [];
          for (const sym of data.symbols) {
            const versionsRes = await fetch(`/api/strategy-versions/${sym.symbol}`);
            const versionsData = await versionsRes.json();
            if (versionsData.versions) {
              versionsData.versions.forEach(v => {
                allStrategies.push({
                  id: v.id,
                  name: v.versionString,
                  symbol: sym.symbol,
                  description: v.description,
                  config: v.config,
                  tag: v.tag,
                  isProduction: v.isProduction,
                  createdAt: v.createdAt,
                  metrics: v.metrics,
                });
              });
            }
          }
          setStrategies(allStrategies);
        }
      } catch (err2) {
        console.error('Failed to fetch strategies:', err2);
      }
    }
  };

  const createStrategy = async () => {
    if (!newStrategyMeta.name) {
      setError('Please enter a strategy name');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Merge global config with any overrides from the form
      const fullConfig = { ...globalConfig, ...newStrategyConfig };

      const response = await fetch('/api/strategy-versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: newStrategyMeta.symbol,
          config: fullConfig, // Save the FULL config
          options: {
            description: newStrategyMeta.description || newStrategyMeta.name,
            tag: 'testing',
          },
        }),
      });
      const data = await response.json();
      if (data.success) {
        await fetchStrategies();
        setShowCreateForm(false);
        setNewStrategyMeta({ name: '', symbol: 'SOXL', description: '' });
        setNewStrategyConfig({});
      } else {
        setError(data.error || 'Failed to create strategy');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runDaySimulation = async () => {
    if (!simulationConfig.strategyId) {
      setError('Please select a strategy');
      return;
    }

    setLoading(true);
    setError(null);
    setSimulationResult(null);
    setSimulationTrades([]);

    try {
      const strategy = strategies.find(s => s.id === simulationConfig.strategyId);
      if (!strategy) throw new Error('Strategy not found');

      const response = await fetch('/api/backtest/day-simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: simulationConfig.symbol,
          date: simulationConfig.date,
          config: strategy.config,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setSimulationResult(data);
      setSimulationTrades(data.trades || []);
      setActiveTab('results');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runRandomValidation = async () => {
    if (!validationConfig.strategyId) {
      setError('Please select a strategy');
      return;
    }

    setLoading(true);
    setError(null);
    setValidationResults(null);

    try {
      const strategy = strategies.find(s => s.id === validationConfig.strategyId);
      if (!strategy) throw new Error('Strategy not found');

      const response = await fetch('/api/backtest/random-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: validationConfig.symbol,
          config: strategy.config,
          numDays: validationConfig.numDays,
          startDate: validationConfig.startDate,
          endDate: validationConfig.endDate,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setValidationResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const promoteStrategy = async (strategyId) => {
    const strategy = strategies.find(s => s.id === strategyId);
    if (!strategy) return;

    try {
      const response = await fetch(`/api/strategy-versions/${strategy.symbol}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: strategyId }),
      });
      const data = await response.json();
      if (data.success) {
        await fetchStrategies();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Styles
  const containerStyle = {
    backgroundColor: theme.colors.background,
    minHeight: '100vh',
    padding: theme.spacing.lg,
    color: theme.colors.text,
  };

  const headerStyle = {
    maxWidth: '1400px',
    margin: '0 auto',
    marginBottom: theme.spacing.lg,
  };

  const contentStyle = {
    maxWidth: '1400px',
    margin: '0 auto',
  };

  const cardStyle = {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    boxShadow: theme.shadows.md,
  };

  const tabContainerStyle = {
    display: 'flex',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    borderBottom: `1px solid ${theme.colors.border}`,
    paddingBottom: theme.spacing.sm,
  };

  const tabStyle = (isActive) => ({
    padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
    backgroundColor: isActive ? theme.colors.primary : 'transparent',
    border: 'none',
    borderRadius: theme.borderRadius.md,
    color: isActive ? '#fff' : theme.colors.textSecondary,
    cursor: 'pointer',
    fontSize: theme.typography.fontSize.md,
    fontWeight: isActive ? '600' : '400',
  });

  const inputStyle = {
    width: '100%',
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
  };

  const labelStyle = {
    display: 'block',
    marginBottom: theme.spacing.xs,
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
  };

  const buttonStyle = (variant = 'primary', disabled = false) => ({
    padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
    backgroundColor: disabled
      ? theme.colors.gray300
      : variant === 'primary'
        ? theme.colors.primary
        : variant === 'success'
          ? theme.colors.success
          : variant === 'danger'
            ? theme.colors.danger
            : 'transparent',
    border: variant === 'secondary' ? `1px solid ${theme.colors.border}` : 'none',
    borderRadius: theme.borderRadius.md,
    color: disabled ? theme.colors.gray500 : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
  });

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: theme.spacing.md,
  };

  const grid2Style = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: theme.spacing.md,
  };

  const strategyCardStyle = (isSelected) => ({
    padding: theme.spacing.md,
    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : theme.colors.background,
    border: `2px solid ${isSelected ? theme.colors.primary : theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    cursor: 'pointer',
    transition: 'all 0.2s',
  });

  const tagStyle = (tag) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    backgroundColor:
      tag === 'production'
        ? 'rgba(34, 197, 94, 0.2)'
        : tag === 'staging'
          ? 'rgba(245, 158, 11, 0.2)'
          : 'rgba(107, 114, 128, 0.2)',
    color:
      tag === 'production'
        ? theme.colors.success
        : tag === 'staging'
          ? theme.colors.warning
          : theme.colors.textSecondary,
  });

  const metricBoxStyle = {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    textAlign: 'center',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: theme.spacing.xs }}>
          Strategy Lab
        </h1>
        <p style={{ color: theme.colors.textSecondary }}>
          Create strategies, simulate on specific days, validate on random unseen dates
        </p>
      </div>

      <div style={contentStyle}>
        {/* Tabs */}
        <div style={tabContainerStyle}>
          <button style={tabStyle(activeTab === 'strategies')} onClick={() => setActiveTab('strategies')}>
            Strategies
          </button>
          <button style={tabStyle(activeTab === 'simulator')} onClick={() => setActiveTab('simulator')}>
            Day Simulator
          </button>
          <button style={tabStyle(activeTab === 'validator')} onClick={() => setActiveTab('validator')}>
            Random Validator
          </button>
          <button
            style={tabStyle(activeTab === 'results')}
            onClick={() => setActiveTab('results')}
            disabled={!simulationResult && !validationResults}
          >
            Results {(simulationResult || validationResults) && '✓'}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div style={{
            ...cardStyle,
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgb(239, 68, 68)',
          }}>
            <strong style={{ color: 'rgb(239, 68, 68)' }}>Error:</strong> {error}
            <button
              onClick={() => setError(null)}
              style={{ marginLeft: theme.spacing.md, ...buttonStyle('secondary') }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* STRATEGIES TAB */}
        {activeTab === 'strategies' && (
          <>
            {/* Current Trading Config - Shared Component (ALL 7 categories) */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <ConfigPanel
                mode="edit"
                title="Current Trading Config (Shared Across All Tools)"
              />
              <p style={{
                color: theme.colors.textSecondary,
                fontSize: theme.typography.fontSize.sm,
                marginTop: theme.spacing.xs,
                marginLeft: theme.spacing.sm,
              }}>
                Changes here apply to Trading Simulator, A/B Testing, and Live Trading
              </p>
            </div>

            {/* Create Strategy Button */}
            <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: '600' }}>Your Strategies</h3>
                <p style={{ color: theme.colors.textSecondary, margin: 0, marginTop: '4px' }}>
                  {strategies.length} strategies saved
                </p>
              </div>
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                style={buttonStyle('primary')}
              >
                {showCreateForm ? 'Cancel' : '+ New Strategy'}
              </button>
            </div>

            {/* Create Strategy Form - Uses FULL ConfigPanel */}
            {showCreateForm && (
              <div style={cardStyle}>
                <h3 style={{ fontWeight: '600', margin: 0, marginBottom: theme.spacing.md }}>
                  Create New Strategy
                </h3>
                <p style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.lg }}>
                  Save your current trading config as a named strategy. Modify any parameters below before saving.
                </p>

                {/* Strategy Metadata */}
                <div style={{ ...gridStyle, marginBottom: theme.spacing.lg }}>
                  <div>
                    <label style={labelStyle}>Strategy Name *</label>
                    <input
                      type="text"
                      value={newStrategyMeta.name}
                      onChange={(e) => setNewStrategyMeta(prev => ({ ...prev, name: e.target.value }))}
                      style={inputStyle}
                      placeholder="e.g., Aggressive SOXL Scalper"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Symbol</label>
                    <input
                      type="text"
                      value={newStrategyMeta.symbol}
                      onChange={(e) => setNewStrategyMeta(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Description</label>
                    <input
                      type="text"
                      value={newStrategyMeta.description}
                      onChange={(e) => setNewStrategyMeta(prev => ({ ...prev, description: e.target.value }))}
                      style={inputStyle}
                      placeholder="Brief description of this strategy"
                    />
                  </div>
                </div>

                {/* Full Config Panel - All 7 categories */}
                <ConfigPanel
                  mode="edit"
                  title="Strategy Parameters (All Categories)"
                  localConfig={newStrategyConfig}
                  onConfigChange={handleNewStrategyConfigChange}
                />

                {/* Actions */}
                <div style={{ marginTop: theme.spacing.lg, display: 'flex', gap: theme.spacing.md }}>
                  <button
                    onClick={createStrategy}
                    disabled={loading || !newStrategyMeta.name}
                    style={buttonStyle('success', loading || !newStrategyMeta.name)}
                  >
                    {loading ? 'Creating...' : 'Save Strategy'}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateForm(false);
                      setNewStrategyMeta({ name: '', symbol: 'SOXL', description: '' });
                      setNewStrategyConfig({});
                    }}
                    style={buttonStyle('secondary')}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Strategy List */}
            <div style={grid2Style}>
              {strategies.map(strategy => (
                <div
                  key={strategy.id}
                  style={strategyCardStyle(selectedStrategy === strategy.id)}
                  onClick={() => setSelectedStrategy(strategy.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.spacing.sm }}>
                    <div>
                      <h4 style={{ margin: 0, fontWeight: '600' }}>{strategy.name}</h4>
                      <span style={{ color: theme.colors.textSecondary, fontSize: '13px' }}>
                        {strategy.symbol}
                      </span>
                    </div>
                    <span style={tagStyle(strategy.tag)}>{strategy.tag}</span>
                  </div>

                  {strategy.description && (
                    <p style={{ color: theme.colors.textSecondary, fontSize: '13px', marginBottom: theme.spacing.sm }}>
                      {strategy.description}
                    </p>
                  )}

                  {strategy.config && (
                    <div style={{ display: 'flex', gap: theme.spacing.md, flexWrap: 'wrap', fontSize: '12px' }}>
                      <span>TP: {strategy.config.takeProfitPercent}%</span>
                      <span>SL: {strategy.config.stopLossPercent}%</span>
                      <span>Conf: {strategy.config.minConfidence}%</span>
                    </div>
                  )}

                  {strategy.metrics && (
                    <div style={{
                      marginTop: theme.spacing.sm,
                      padding: theme.spacing.sm,
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.borderRadius.sm,
                      fontSize: '12px',
                    }}>
                      <span style={{ color: strategy.metrics.totalReturn >= 0 ? theme.colors.success : theme.colors.danger }}>
                        P/L: ${parseFloat(strategy.metrics.totalReturn || 0).toFixed(2)}
                      </span>
                      <span style={{ marginLeft: theme.spacing.md }}>
                        Win: {strategy.metrics.winRate}
                      </span>
                    </div>
                  )}

                  <div style={{ marginTop: theme.spacing.md, display: 'flex', gap: theme.spacing.sm }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSimulationConfig(prev => ({ ...prev, strategyId: strategy.id, symbol: strategy.symbol }));
                        setActiveTab('simulator');
                      }}
                      style={{ ...buttonStyle('secondary'), padding: '4px 12px', fontSize: '12px' }}
                    >
                      Simulate
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setValidationConfig(prev => ({ ...prev, strategyId: strategy.id, symbol: strategy.symbol }));
                        setActiveTab('validator');
                      }}
                      style={{ ...buttonStyle('secondary'), padding: '4px 12px', fontSize: '12px' }}
                    >
                      Validate
                    </button>
                    {strategy.tag !== 'production' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          promoteStrategy(strategy.id);
                        }}
                        style={{ ...buttonStyle('success'), padding: '4px 12px', fontSize: '12px' }}
                      >
                        Promote
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {strategies.length === 0 && (
              <div style={{ ...cardStyle, textAlign: 'center', padding: theme.spacing.xl }}>
                <p style={{ fontSize: '18px', marginBottom: theme.spacing.sm }}>No Strategies Yet</p>
                <p style={{ color: theme.colors.textSecondary }}>
                  Create your first strategy to start simulating and validating
                </p>
              </div>
            )}
          </>
        )}

        {/* DAY SIMULATOR TAB */}
        {activeTab === 'simulator' && (
          <>
            <div style={cardStyle}>
              <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>Day Simulator</h3>
              <p style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.lg }}>
                Apply a strategy to a specific day and see exactly what trades would have been made.
              </p>

              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Select Strategy</label>
                  <select
                    value={simulationConfig.strategyId || ''}
                    onChange={(e) => setSimulationConfig(prev => ({ ...prev, strategyId: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="">-- Select --</option>
                    {strategies.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.symbol})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Symbol</label>
                  <input
                    type="text"
                    value={simulationConfig.symbol}
                    onChange={(e) => setSimulationConfig(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input
                    type="date"
                    value={simulationConfig.date}
                    onChange={(e) => setSimulationConfig(prev => ({ ...prev, date: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginTop: theme.spacing.lg }}>
                <button
                  onClick={runDaySimulation}
                  disabled={loading || !simulationConfig.strategyId}
                  style={buttonStyle('primary', loading || !simulationConfig.strategyId)}
                >
                  {loading ? 'Running Simulation...' : 'Run Day Simulation'}
                </button>
              </div>
            </div>

            {/* Show selected strategy details */}
            {simulationConfig.strategyId && (
              <div style={cardStyle}>
                <h4 style={{ marginBottom: theme.spacing.sm }}>Selected Strategy Configuration</h4>
                {(() => {
                  const strategy = strategies.find(s => s.id === simulationConfig.strategyId);
                  if (!strategy) return null;
                  return (
                    <div style={gridStyle}>
                      {Object.entries(strategy.config || {}).map(([key, value]) => (
                        <div key={key} style={metricBoxStyle}>
                          <div style={{ color: theme.colors.textSecondary, fontSize: '11px', marginBottom: '4px' }}>
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </div>
                          <div style={{ fontSize: '18px', fontWeight: '600' }}>
                            {typeof value === 'number' ? value.toFixed(value % 1 === 0 ? 0 : 2) : value}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* How it works */}
            <div style={cardStyle}>
              <h4 style={{ marginBottom: theme.spacing.sm }}>How Day Simulation Works</h4>
              <ul style={{ color: theme.colors.textSecondary, paddingLeft: '20px', lineHeight: '1.8' }}>
                <li>Fetches 1-minute candle data for the selected date</li>
                <li>Simulates the strategy bar-by-bar, as if trading live</li>
                <li>No future knowledge - each decision uses only past data</li>
                <li>Shows every entry/exit with reasoning</li>
                <li>Visualizes trades on an intraday chart</li>
              </ul>
            </div>
          </>
        )}

        {/* RANDOM VALIDATOR TAB */}
        {activeTab === 'validator' && (
          <>
            <div style={cardStyle}>
              <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>Random Day Validator</h3>
              <p style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.lg }}>
                Test your strategy on random unseen days. The strategy must prove itself repeatedly.
              </p>

              <div style={gridStyle}>
                <div>
                  <label style={labelStyle}>Select Strategy</label>
                  <select
                    value={validationConfig.strategyId || ''}
                    onChange={(e) => setValidationConfig(prev => ({ ...prev, strategyId: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="">-- Select --</option>
                    {strategies.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.symbol})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Symbol</label>
                  <input
                    type="text"
                    value={validationConfig.symbol}
                    onChange={(e) => setValidationConfig(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Number of Random Days</label>
                  <input
                    type="number"
                    value={validationConfig.numDays}
                    onChange={(e) => setValidationConfig(prev => ({ ...prev, numDays: parseInt(e.target.value) }))}
                    style={inputStyle}
                    min="1"
                    max="30"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Start Date (range)</label>
                  <input
                    type="date"
                    value={validationConfig.startDate}
                    onChange={(e) => setValidationConfig(prev => ({ ...prev, startDate: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>End Date (range)</label>
                  <input
                    type="date"
                    value={validationConfig.endDate}
                    onChange={(e) => setValidationConfig(prev => ({ ...prev, endDate: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginTop: theme.spacing.lg }}>
                <button
                  onClick={runRandomValidation}
                  disabled={loading || !validationConfig.strategyId}
                  style={buttonStyle('primary', loading || !validationConfig.strategyId)}
                >
                  {loading ? 'Running Validation...' : `Test on ${validationConfig.numDays} Random Days`}
                </button>
              </div>
            </div>

            {/* Validation Results */}
            {validationResults && (
              <div style={cardStyle}>
                <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>Validation Results</h3>

                <div style={gridStyle}>
                  <div style={metricBoxStyle}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '11px', marginBottom: '4px' }}>
                      Days Tested
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '700' }}>
                      {validationResults.daysAnalyzed || validationResults.totalDays || 0}
                    </div>
                  </div>
                  <div style={metricBoxStyle}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '11px', marginBottom: '4px' }}>
                      Profitable Days
                    </div>
                    <div style={{
                      fontSize: '24px',
                      fontWeight: '700',
                      color: (validationResults.profitableDays || 0) > (validationResults.daysAnalyzed || 0) / 2
                        ? theme.colors.success
                        : theme.colors.danger,
                    }}>
                      {validationResults.profitableDays || 0}
                    </div>
                  </div>
                  <div style={metricBoxStyle}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '11px', marginBottom: '4px' }}>
                      Total P/L
                    </div>
                    <div style={{
                      fontSize: '24px',
                      fontWeight: '700',
                      color: (validationResults.totalPnl || 0) >= 0 ? theme.colors.success : theme.colors.danger,
                    }}>
                      ${(validationResults.totalPnl || 0).toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Day-by-day breakdown */}
                {validationResults.dailyResults && (
                  <div style={{ marginTop: theme.spacing.lg }}>
                    <h4 style={{ marginBottom: theme.spacing.sm }}>Day-by-Day Results</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Date</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Trades</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>P/L</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Win Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validationResults.dailyResults.map((day, idx) => (
                          <tr key={idx} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                            <td style={{ padding: theme.spacing.sm }}>{day.date}</td>
                            <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>{day.trades || 0}</td>
                            <td style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              color: (day.pnl || 0) >= 0 ? theme.colors.success : theme.colors.danger,
                            }}>
                              ${(day.pnl || 0).toFixed(2)}
                            </td>
                            <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                              {((day.winRate || 0) * 100).toFixed(0)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* How it works */}
            <div style={cardStyle}>
              <h4 style={{ marginBottom: theme.spacing.sm }}>Why Random Day Validation?</h4>
              <div style={{
                backgroundColor: theme.colors.background,
                padding: theme.spacing.md,
                borderRadius: theme.borderRadius.md,
                marginBottom: theme.spacing.md,
              }}>
                <p style={{ marginBottom: theme.spacing.sm }}>
                  <strong>The Problem:</strong> Backtesting on sequential days can accidentally "learn" patterns
                  from the data sequence.
                </p>
                <p>
                  <strong>The Solution:</strong> Test on random, non-sequential days. Each day is independent.
                  The strategy can't rely on "what happened yesterday."
                </p>
              </div>
              <ul style={{ color: theme.colors.textSecondary, paddingLeft: '20px', lineHeight: '1.8' }}>
                <li>Picks N random dates from the specified range</li>
                <li>Runs full day simulation on each date independently</li>
                <li>Aggregates results to show true out-of-sample performance</li>
                <li>Helps identify if strategy only works in specific conditions</li>
              </ul>
            </div>
          </>
        )}

        {/* RESULTS TAB */}
        {activeTab === 'results' && (
          <>
            {simulationResult && (
              <>
                <div style={cardStyle}>
                  <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>
                    Simulation Results: {simulationConfig.symbol} on {simulationConfig.date}
                  </h3>

                  <div style={gridStyle}>
                    <div style={metricBoxStyle}>
                      <div style={{ color: theme.colors.textSecondary, fontSize: '11px', marginBottom: '4px' }}>
                        Total P/L
                      </div>
                      <div style={{
                        fontSize: '28px',
                        fontWeight: '700',
                        color: (simulationResult.totalPnl || 0) >= 0 ? theme.colors.success : theme.colors.danger,
                      }}>
                        ${(simulationResult.totalPnl || 0).toFixed(2)}
                      </div>
                    </div>
                    <div style={metricBoxStyle}>
                      <div style={{ color: theme.colors.textSecondary, fontSize: '11px', marginBottom: '4px' }}>
                        Total Trades
                      </div>
                      <div style={{ fontSize: '28px', fontWeight: '700' }}>
                        {simulationResult.trades?.length || 0}
                      </div>
                    </div>
                    <div style={metricBoxStyle}>
                      <div style={{ color: theme.colors.textSecondary, fontSize: '11px', marginBottom: '4px' }}>
                        Win Rate
                      </div>
                      <div style={{
                        fontSize: '28px',
                        fontWeight: '700',
                        color: (simulationResult.winRate || 0) >= 50 ? theme.colors.success : theme.colors.danger,
                      }}>
                        {(simulationResult.winRate || 0).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Trade List */}
                {simulationTrades.length > 0 && (
                  <div style={cardStyle}>
                    <h4 style={{ marginBottom: theme.spacing.md }}>Trades</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Time</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Action</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Entry</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Exit</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>P/L</th>
                          <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simulationTrades.map((trade, idx) => (
                          <tr key={idx} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                            <td style={{ padding: theme.spacing.sm, fontSize: '13px' }}>
                              {trade.entryTime || trade.time}
                            </td>
                            <td style={{ padding: theme.spacing.sm }}>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                backgroundColor: trade.side === 'BUY' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                color: trade.side === 'BUY' ? theme.colors.success : theme.colors.danger,
                              }}>
                                {trade.side || 'BUY'}
                              </span>
                            </td>
                            <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                              ${(trade.entryPrice || 0).toFixed(2)}
                            </td>
                            <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                              ${(trade.exitPrice || 0).toFixed(2)}
                            </td>
                            <td style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              fontWeight: '600',
                              color: (trade.pnl || 0) >= 0 ? theme.colors.success : theme.colors.danger,
                            }}>
                              ${(trade.pnl || 0).toFixed(2)}
                            </td>
                            <td style={{ padding: theme.spacing.sm, fontSize: '12px', color: theme.colors.textSecondary }}>
                              {trade.exitReason || trade.reason || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Analytics Dashboard */}
                {simulationTrades.length > 0 && (
                  <StrategyAnalyticsDashboard
                    trades={simulationTrades.map(t => ({
                      pnl: t.pnl || 0,
                      entryDate: t.entryTime,
                      exitDate: t.exitTime,
                      entryPrice: t.entryPrice,
                      exitPrice: t.exitPrice,
                      mfe: t.mfe,
                      mae: t.mae,
                    }))}
                    strategyName={`${simulationConfig.symbol} Day Simulation`}
                    startingCapital={10000}
                  />
                )}
              </>
            )}

            {!simulationResult && !validationResults && (
              <div style={{ ...cardStyle, textAlign: 'center', padding: theme.spacing.xl }}>
                <p style={{ fontSize: '18px', marginBottom: theme.spacing.sm }}>No Results Yet</p>
                <p style={{ color: theme.colors.textSecondary }}>
                  Run a day simulation or random validation to see results
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default StrategyLabPage;
