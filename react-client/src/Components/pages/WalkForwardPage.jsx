import { useState, useEffect, useRef } from 'react';
import theme from '../../theme';
import { useTradingConfig } from '../../contexts/TradingConfigContext';

/**
 * WalkForwardPage - Walk-Forward Optimization UI
 *
 * Prevents overfitting by using rolling train/test windows:
 * - Train on Jan-Jun → Test on Jul (unseen data)
 * - Train on Feb-Jul → Test on Aug (unseen data)
 * - Repeat...
 *
 * Only strategies that prove themselves on UNSEEN data survive.
 *
 * Integration with TradingConfigContext:
 * - Loads base strategy from global config
 * - Can apply optimized config back to live trading
 */
const WalkForwardPage = () => {
  // Get shared trading config
  const { config: globalConfig, updateConfig: updateGlobalConfig } = useTradingConfig();

  const [symbol, setSymbol] = useState(globalConfig?.watchlist?.[0] || 'SPY');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [parameterRanges, setParameterRanges] = useState(null);
  const [quickValidationResult, setQuickValidationResult] = useState(null);
  const [activeTab, setActiveTab] = useState('run'); // 'run' | 'results' | 'help'
  const [progress, setProgress] = useState({ status: '', percent: 0 });

  // Configuration options
  const [config, setConfig] = useState({
    trainPeriodDays: 180,
    testPeriodDays: 60,
    stepDays: 30,
    minWinRate: 0.45,
    minExpectancy: 0.5,
    minProfitFactor: 1.2,
    maxDrawdownPercent: 20,
  });

  // Base strategy for optimization - initialized from global config
  const [baseStrategy, setBaseStrategy] = useState({
    takeProfitPercent: globalConfig?.takeProfitPercent || 2,
    stopLossPercent: globalConfig?.stopLossPercent || 1,
    minConfidence: globalConfig?.minConfidence || 70,
  });

  // Load current trading config as base strategy
  const loadCurrentConfig = () => {
    setBaseStrategy({
      takeProfitPercent: globalConfig?.takeProfitPercent || 2,
      stopLossPercent: globalConfig?.stopLossPercent || 1,
      minConfidence: globalConfig?.minConfidence || 70,
    });
  };

  // Apply optimized config to live trading
  const applyOptimizedConfig = (configToApply) => {
    updateGlobalConfig({
      takeProfitPercent: configToApply.takeProfitPercent,
      stopLossPercent: configToApply.stopLossPercent,
      minConfidence: configToApply.minConfidence,
    });
    alert('Configuration applied to trading settings!');
  };

  // Fetch parameter ranges on mount
  useEffect(() => {
    fetchParameterRanges();
  }, []);

  const fetchParameterRanges = async () => {
    try {
      const response = await fetch('/api/optimize/parameters');
      const data = await response.json();
      if (data.parameterRanges) {
        setParameterRanges(data.parameterRanges);
      }
    } catch (err) {
      console.error('Failed to fetch parameter ranges:', err);
    }
  };

  const runQuickValidation = async () => {
    setError(null);
    setQuickValidationResult(null);
    setProgress({ status: 'Running quick validation...', percent: 25 });

    try {
      const response = await fetch('/api/optimize/quick-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          config: baseStrategy,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setQuickValidationResult(data);
      setProgress({ status: 'Quick validation complete', percent: 100 });
    } catch (err) {
      setError(err.message);
      setProgress({ status: '', percent: 0 });
    }
  };

  const runFullOptimization = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);
    setProgress({ status: 'Starting walk-forward optimization...', percent: 5 });

    try {
      // Simulate progress updates (actual optimization is server-side)
      const progressInterval = setInterval(() => {
        setProgress(prev => ({
          status: getProgressMessage(prev.percent),
          percent: Math.min(prev.percent + 2, 95),
        }));
      }, 2000);

      const response = await fetch('/api/optimize/walk-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          baseStrategy,
          options: config,
        }),
      });

      clearInterval(progressInterval);
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      setResults(data);
      setProgress({ status: 'Optimization complete!', percent: 100 });
      setActiveTab('results');
    } catch (err) {
      setError(err.message);
      setProgress({ status: '', percent: 0 });
    } finally {
      setIsRunning(false);
    }
  };

  const getProgressMessage = (percent) => {
    if (percent < 20) return 'Fetching historical data...';
    if (percent < 40) return 'Generating train/test windows...';
    if (percent < 60) return 'Optimizing parameters on training windows...';
    if (percent < 80) return 'Testing on out-of-sample data...';
    return 'Calculating robustness metrics...';
  };

  const containerStyle = {
    backgroundColor: theme.colors.background,
    minHeight: '100vh',
    padding: theme.spacing.lg,
    color: theme.colors.text,
  };

  const headerStyle = {
    maxWidth: theme.layout.maxWidth,
    margin: '0 auto',
    marginBottom: theme.spacing.lg,
  };

  const contentStyle = {
    maxWidth: theme.layout.maxWidth,
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
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    backgroundColor: isActive ? theme.colors.primary : 'transparent',
    border: 'none',
    borderRadius: theme.borderRadius.md,
    color: isActive ? '#fff' : theme.colors.textSecondary,
    cursor: 'pointer',
    fontSize: theme.typography.fontSize.md,
    fontWeight: isActive ? '600' : '400',
  });

  const inputGroupStyle = {
    marginBottom: theme.spacing.md,
  };

  const labelStyle = {
    display: 'block',
    marginBottom: theme.spacing.xs,
    color: theme.colors.textSecondary,
    fontSize: theme.typography.fontSize.sm,
  };

  const inputStyle = {
    width: '100%',
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.md,
  };

  const buttonStyle = (variant = 'primary', disabled = false) => ({
    padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
    backgroundColor: disabled
      ? theme.colors.gray300
      : variant === 'primary'
        ? theme.colors.primary
        : 'transparent',
    border: variant === 'secondary' ? `1px solid ${theme.colors.border}` : 'none',
    borderRadius: theme.borderRadius.md,
    color: disabled ? theme.colors.gray500 : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: theme.typography.fontSize.md,
    fontWeight: '600',
    marginRight: theme.spacing.sm,
  });

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: theme.spacing.md,
  };

  const metricCardStyle = (color = theme.colors.text) => ({
    padding: theme.spacing.md,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    textAlign: 'center',
  });

  const progressBarStyle = {
    width: '100%',
    height: '8px',
    backgroundColor: theme.colors.background,
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: theme.spacing.sm,
  };

  const progressFillStyle = {
    width: `${progress.percent}%`,
    height: '100%',
    backgroundColor: theme.colors.primary,
    transition: 'width 0.3s ease',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: theme.spacing.xs }}>
          Walk-Forward Optimization
        </h1>
        <p style={{ color: theme.colors.textSecondary }}>
          Prove your strategy on unseen data. No more overfitting.
        </p>
      </div>

      <div style={contentStyle}>
        {/* Tabs */}
        <div style={tabContainerStyle}>
          <button style={tabStyle(activeTab === 'run')} onClick={() => setActiveTab('run')}>
            Run Optimization
          </button>
          <button
            style={tabStyle(activeTab === 'results')}
            onClick={() => setActiveTab('results')}
            disabled={!results}
          >
            Results {results && '✓'}
          </button>
          <button style={tabStyle(activeTab === 'help')} onClick={() => setActiveTab('help')}>
            How It Works
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div style={{
            ...cardStyle,
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgb(239, 68, 68)'
          }}>
            <strong style={{ color: 'rgb(239, 68, 68)' }}>Error:</strong> {error}
          </div>
        )}

        {/* Run Tab */}
        {activeTab === 'run' && (
          <>
            {/* Symbol Selection */}
            <div style={cardStyle}>
              <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>Symbol</h3>
              <div style={inputGroupStyle}>
                <label style={labelStyle}>Stock Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  style={inputStyle}
                  placeholder="e.g., SPY, AAPL, TSLA"
                />
              </div>
            </div>

            {/* Base Strategy */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
                <h3 style={{ fontWeight: '600', margin: 0 }}>
                  Base Strategy Parameters
                </h3>
                <button
                  onClick={loadCurrentConfig}
                  style={{
                    padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                    backgroundColor: theme.colors.surface,
                    border: `1px solid ${theme.colors.primary}`,
                    borderRadius: theme.borderRadius.md,
                    color: theme.colors.primary,
                    cursor: 'pointer',
                    fontSize: theme.typography.fontSize.sm,
                    fontWeight: '500',
                  }}
                  title="Load your current trading config values"
                >
                  Load Current Config
                </button>
              </div>
              <p style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.md, fontSize: '14px' }}>
                These will be optimized within the parameter ranges. Click "Load Current Config" to use your live trading settings.
              </p>
              <div style={gridStyle}>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Take Profit %</label>
                  <input
                    type="number"
                    value={baseStrategy.takeProfitPercent}
                    onChange={(e) => setBaseStrategy(prev => ({
                      ...prev,
                      takeProfitPercent: parseFloat(e.target.value)
                    }))}
                    style={inputStyle}
                    step="0.25"
                    min="0.5"
                    max="10"
                  />
                </div>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Stop Loss %</label>
                  <input
                    type="number"
                    value={baseStrategy.stopLossPercent}
                    onChange={(e) => setBaseStrategy(prev => ({
                      ...prev,
                      stopLossPercent: parseFloat(e.target.value)
                    }))}
                    style={inputStyle}
                    step="0.25"
                    min="0.25"
                    max="5"
                  />
                </div>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Min Confidence</label>
                  <input
                    type="number"
                    value={baseStrategy.minConfidence}
                    onChange={(e) => setBaseStrategy(prev => ({
                      ...prev,
                      minConfidence: parseInt(e.target.value)
                    }))}
                    style={inputStyle}
                    step="5"
                    min="50"
                    max="90"
                  />
                </div>
              </div>
            </div>

            {/* Walk-Forward Configuration */}
            <div style={cardStyle}>
              <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>
                Walk-Forward Settings
              </h3>
              <div style={gridStyle}>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Training Period (days)</label>
                  <input
                    type="number"
                    value={config.trainPeriodDays}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      trainPeriodDays: parseInt(e.target.value)
                    }))}
                    style={inputStyle}
                    step="30"
                    min="60"
                    max="365"
                  />
                </div>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Test Period (days)</label>
                  <input
                    type="number"
                    value={config.testPeriodDays}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      testPeriodDays: parseInt(e.target.value)
                    }))}
                    style={inputStyle}
                    step="30"
                    min="30"
                    max="180"
                  />
                </div>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Step Forward (days)</label>
                  <input
                    type="number"
                    value={config.stepDays}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      stepDays: parseInt(e.target.value)
                    }))}
                    style={inputStyle}
                    step="15"
                    min="15"
                    max="90"
                  />
                </div>
              </div>

              <h4 style={{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.md, fontWeight: '600' }}>
                Minimum Thresholds
              </h4>
              <div style={gridStyle}>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Min Win Rate</label>
                  <input
                    type="number"
                    value={config.minWinRate * 100}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      minWinRate: parseFloat(e.target.value) / 100
                    }))}
                    style={inputStyle}
                    step="5"
                    min="30"
                    max="70"
                  />
                </div>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Min Profit Factor</label>
                  <input
                    type="number"
                    value={config.minProfitFactor}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      minProfitFactor: parseFloat(e.target.value)
                    }))}
                    style={inputStyle}
                    step="0.1"
                    min="1"
                    max="3"
                  />
                </div>
                <div style={inputGroupStyle}>
                  <label style={labelStyle}>Max Drawdown %</label>
                  <input
                    type="number"
                    value={config.maxDrawdownPercent}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      maxDrawdownPercent: parseInt(e.target.value)
                    }))}
                    style={inputStyle}
                    step="5"
                    min="10"
                    max="50"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                <button
                  onClick={runQuickValidation}
                  disabled={isRunning || !symbol}
                  style={buttonStyle('secondary', isRunning || !symbol)}
                >
                  Quick Validation (3 windows)
                </button>
                <button
                  onClick={runFullOptimization}
                  disabled={isRunning || !symbol}
                  style={buttonStyle('primary', isRunning || !symbol)}
                >
                  {isRunning ? 'Running...' : 'Run Full Optimization'}
                </button>
                <span style={{ color: theme.colors.textSecondary, fontSize: '14px' }}>
                  ~2-5 minutes depending on data size
                </span>
              </div>

              {/* Progress Bar */}
              {(isRunning || progress.percent > 0) && (
                <div style={{ marginTop: theme.spacing.md }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '14px' }}>{progress.status}</span>
                    <span style={{ fontSize: '14px' }}>{progress.percent}%</span>
                  </div>
                  <div style={progressBarStyle}>
                    <div style={progressFillStyle} />
                  </div>
                </div>
              )}
            </div>

            {/* Quick Validation Results */}
            {quickValidationResult && (
              <div style={cardStyle}>
                <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>
                  Quick Validation Results
                </h3>
                <div style={gridStyle}>
                  <div style={metricCardStyle()}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                      Windows Tested
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '700' }}>
                      {quickValidationResult.windowsTested}
                    </div>
                  </div>
                  <div style={metricCardStyle()}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                      Passed
                    </div>
                    <div style={{
                      fontSize: '24px',
                      fontWeight: '700',
                      color: quickValidationResult.passed >= 2 ? theme.colors.success : theme.colors.danger,
                    }}>
                      {quickValidationResult.passed}
                    </div>
                  </div>
                  <div style={metricCardStyle()}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                      Pass Rate
                    </div>
                    <div style={{
                      fontSize: '24px',
                      fontWeight: '700',
                      color: parseInt(quickValidationResult.passRate) >= 66
                        ? theme.colors.success
                        : theme.colors.warning,
                    }}>
                      {quickValidationResult.passRate}
                    </div>
                  </div>
                </div>
                <div style={{
                  marginTop: theme.spacing.md,
                  padding: theme.spacing.md,
                  backgroundColor: parseInt(quickValidationResult.passRate) >= 66
                    ? 'rgba(34, 197, 94, 0.1)'
                    : 'rgba(245, 158, 11, 0.1)',
                  borderRadius: theme.borderRadius.md,
                  color: parseInt(quickValidationResult.passRate) >= 66
                    ? theme.colors.success
                    : theme.colors.warning,
                }}>
                  {quickValidationResult.recommendation}
                </div>
              </div>
            )}
          </>
        )}

        {/* Results Tab */}
        {activeTab === 'results' && results && (
          <>
            {/* Summary */}
            <div style={cardStyle}>
              <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>
                Optimization Summary
              </h3>
              <div style={gridStyle}>
                <div style={metricCardStyle()}>
                  <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                    Total Windows
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: '700' }}>
                    {results.summary.totalWindows}
                  </div>
                </div>
                <div style={metricCardStyle()}>
                  <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                    Passed Windows
                  </div>
                  <div style={{
                    fontSize: '24px',
                    fontWeight: '700',
                    color: results.summary.passedWindows > results.summary.totalWindows / 2
                      ? theme.colors.success
                      : theme.colors.danger,
                  }}>
                    {results.summary.passedWindows}
                  </div>
                </div>
                <div style={metricCardStyle()}>
                  <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                    Robustness Score
                  </div>
                  <div style={{
                    fontSize: '24px',
                    fontWeight: '700',
                    color: parseFloat(results.summary.robustnessScore) >= 60
                      ? theme.colors.success
                      : parseFloat(results.summary.robustnessScore) >= 40
                        ? theme.colors.warning
                        : theme.colors.danger,
                  }}>
                    {results.summary.robustnessScore}
                  </div>
                </div>
              </div>

              {/* Recommendation */}
              <div style={{
                marginTop: theme.spacing.md,
                padding: theme.spacing.md,
                backgroundColor: results.summary.recommendation.includes('STRONG')
                  ? 'rgba(34, 197, 94, 0.1)'
                  : results.summary.recommendation.includes('AVOID')
                    ? 'rgba(239, 68, 68, 0.1)'
                    : 'rgba(245, 158, 11, 0.1)',
                borderRadius: theme.borderRadius.md,
              }}>
                <strong>{results.summary.recommendation.split(':')[0]}:</strong>{' '}
                {results.summary.recommendation.split(':')[1]}
              </div>
            </div>

            {/* Robust Configuration */}
            {results.robustConfig && results.robustConfig.found && (
              <div style={cardStyle}>
                <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>
                  Recommended Configuration
                </h3>
                <p style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.md, fontSize: '14px' }}>
                  These parameters performed best across multiple test windows.
                </p>
                <div style={gridStyle}>
                  {Object.entries(results.robustConfig.config)
                    .filter(([key]) => typeof results.robustConfig.config[key] === 'number')
                    .slice(0, 6)
                    .map(([key, value]) => (
                      <div key={key} style={metricCardStyle()}>
                        <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </div>
                        <div style={{ fontSize: '20px', fontWeight: '600' }}>
                          {typeof value === 'number' ? value.toFixed(2) : value}
                        </div>
                      </div>
                    ))}
                </div>
                <div style={{
                  marginTop: theme.spacing.md,
                  display: 'flex',
                  gap: theme.spacing.md,
                  fontSize: '14px',
                }}>
                  <span>
                    <strong>Validation Windows:</strong> {results.robustConfig.validationWindows}
                  </span>
                  <span>
                    <strong>Confidence:</strong> {results.robustConfig.confidence}
                  </span>
                </div>

                {/* Apply to Trading Button */}
                <div style={{ marginTop: theme.spacing.lg }}>
                  <button
                    onClick={() => applyOptimizedConfig(results.robustConfig.config)}
                    style={buttonStyle('primary')}
                  >
                    Apply to Trading Settings
                  </button>
                  <span style={{ marginLeft: theme.spacing.md, color: theme.colors.textSecondary, fontSize: '13px' }}>
                    This will update your live trading configuration
                  </span>
                </div>
              </div>
            )}

            {/* Window Details */}
            <div style={cardStyle}>
              <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>
                Window-by-Window Results
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Window</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Train Period</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Test Period</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'center' }}>Status</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Test Win Rate</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Test P/F</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Degradation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.windowResults.map((window, idx) => (
                      <tr key={idx} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                        <td style={{ padding: theme.spacing.sm }}>{window.window}</td>
                        <td style={{ padding: theme.spacing.sm, fontSize: '13px' }}>
                          {window.trainPeriod.start} → {window.trainPeriod.end}
                        </td>
                        <td style={{ padding: theme.spacing.sm, fontSize: '13px' }}>
                          {window.testPeriod.start} → {window.testPeriod.end}
                        </td>
                        <td style={{ padding: theme.spacing.sm, textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '600',
                            backgroundColor: window.passed
                              ? 'rgba(34, 197, 94, 0.2)'
                              : window.status === 'NO_PROFITABLE_CONFIG'
                                ? 'rgba(107, 114, 128, 0.2)'
                                : 'rgba(239, 68, 68, 0.2)',
                            color: window.passed
                              ? theme.colors.success
                              : window.status === 'NO_PROFITABLE_CONFIG'
                                ? theme.colors.textSecondary
                                : theme.colors.danger,
                          }}>
                            {window.passed ? 'PASSED' : window.status || 'FAILED'}
                          </span>
                        </td>
                        <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                          {window.testMetrics?.winRate || '-'}
                        </td>
                        <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                          {window.testMetrics?.profitFactor || '-'}
                        </td>
                        <td style={{ padding: theme.spacing.sm, fontSize: '12px' }}>
                          {window.degradation?.interpretation?.split(':')[0] || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Degradation Analysis */}
            {results.degradationAnalysis && (
              <div style={cardStyle}>
                <h3 style={{ marginBottom: theme.spacing.md, fontWeight: '600' }}>
                  Overfitting Analysis
                </h3>
                <div style={gridStyle}>
                  <div style={metricCardStyle()}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                      Overfit Windows
                    </div>
                    <div style={{
                      fontSize: '24px',
                      fontWeight: '700',
                      color: results.degradationAnalysis.overfitWindows > 0
                        ? theme.colors.danger
                        : theme.colors.success,
                    }}>
                      {results.degradationAnalysis.overfitWindows}
                    </div>
                  </div>
                  <div style={metricCardStyle()}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                      Stable Windows
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: theme.colors.success }}>
                      {results.degradationAnalysis.stableWindows}
                    </div>
                  </div>
                  <div style={metricCardStyle()}>
                    <div style={{ color: theme.colors.textSecondary, fontSize: '12px', marginBottom: '4px' }}>
                      Mild Degradation
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: theme.colors.warning }}>
                      {results.degradationAnalysis.mildDegradationWindows}
                    </div>
                  </div>
                </div>
                <div style={{
                  marginTop: theme.spacing.md,
                  padding: theme.spacing.md,
                  backgroundColor: theme.colors.background,
                  borderRadius: theme.borderRadius.md,
                }}>
                  <strong>Assessment:</strong> {results.degradationAnalysis.overallAssessment}
                </div>
              </div>
            )}
          </>
        )}

        {/* Help Tab */}
        {activeTab === 'help' && (
          <div style={cardStyle}>
            <h3 style={{ marginBottom: theme.spacing.lg, fontWeight: '600' }}>
              How Walk-Forward Optimization Works
            </h3>

            <div style={{ marginBottom: theme.spacing.lg }}>
              <h4 style={{ color: theme.colors.primary, marginBottom: theme.spacing.sm }}>
                The Problem: Traditional Backtesting Overfits
              </h4>
              <p style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.md }}>
                Traditional approach: Optimize on 2 years of data → Use those parameters forever.
                <br />
                Result: Strategy looks amazing on historical data but fails in live trading.
              </p>
            </div>

            <div style={{ marginBottom: theme.spacing.lg }}>
              <h4 style={{ color: theme.colors.success, marginBottom: theme.spacing.sm }}>
                The Solution: Prove It On Unseen Data
              </h4>
              <div style={{
                backgroundColor: theme.colors.background,
                padding: theme.spacing.md,
                borderRadius: theme.borderRadius.md,
                fontFamily: 'monospace',
                fontSize: '13px',
                lineHeight: '1.8',
              }}>
                <div>Window 1: Train Jan-Jun 2023 → <span style={{ color: theme.colors.success }}>Test Jul 2023</span></div>
                <div>Window 2: Train Feb-Jul 2023 → <span style={{ color: theme.colors.success }}>Test Aug 2023</span></div>
                <div>Window 3: Train Mar-Aug 2023 → <span style={{ color: theme.colors.success }}>Test Sep 2023</span></div>
                <div>Window 4: Train Apr-Sep 2023 → <span style={{ color: theme.colors.success }}>Test Oct 2023</span></div>
                <div style={{ marginTop: theme.spacing.sm, color: theme.colors.textSecondary }}>
                  ... repeat, always testing on data the strategy has NEVER seen ...
                </div>
              </div>
            </div>

            <div style={{ marginBottom: theme.spacing.lg }}>
              <h4 style={{ marginBottom: theme.spacing.sm }}>Interpreting Results</h4>
              <ul style={{ color: theme.colors.textSecondary, paddingLeft: '20px', lineHeight: '1.8' }}>
                <li><strong>Robustness Score &gt; 80%:</strong> Strategy is robust, confident for live trading</li>
                <li><strong>Robustness Score 60-80%:</strong> Acceptable, start with small positions</li>
                <li><strong>Robustness Score 40-60%:</strong> Inconsistent, needs refinement</li>
                <li><strong>Robustness Score &lt; 40%:</strong> Strategy is overfit, avoid</li>
              </ul>
            </div>

            <div style={{ marginBottom: theme.spacing.lg }}>
              <h4 style={{ marginBottom: theme.spacing.sm }}>Settings Explained</h4>
              <ul style={{ color: theme.colors.textSecondary, paddingLeft: '20px', lineHeight: '1.8' }}>
                <li><strong>Training Period:</strong> How much data to optimize on (typically 4-6 months)</li>
                <li><strong>Test Period:</strong> How much unseen data to validate on (typically 1-2 months)</li>
                <li><strong>Step Days:</strong> How far to roll the window forward each iteration</li>
                <li><strong>Min Thresholds:</strong> Minimum performance required to "pass" a window</li>
              </ul>
            </div>

            <div style={{
              padding: theme.spacing.md,
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              borderRadius: theme.borderRadius.md,
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}>
              <strong>Pro Tip:</strong> Start with "Quick Validation" to get a fast sanity check
              before running the full optimization.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WalkForwardPage;
