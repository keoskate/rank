/**
 * ConfigOptimizer Component
 *
 * Runs multiple simulations to find optimal trading configuration.
 * Tests many parameter combinations and displays the best performers.
 */

import { useState } from 'react';
import Button from '../common/Button';
import theme from '../../theme';
import { runFastSimulation } from '../../utils/tradingLogic';

// Config variations to test - comprehensive coverage
const CONFIG_VARIATIONS = {
  entryStrategy: ['dip', 'conservative', 'balanced', 'aggressive', 'momentum'],
  minSignalsRequired: [1, 2, 3],
  takeProfitPercent: [1, 1.5, 2, 3, 5, 8, 10],
  stopLossPercent: [0.5, 1, 1.5, 2, 3],
  minConfidence: [40, 50, 60, 70, 80],
  maxPositionSizePercent: [10, 25, 50, 80, 100],
  requireFlags: [
    { requireVolumeSpike: false, requireTrendAlignment: false, requireRsiSignal: false },
    { requireVolumeSpike: true, requireTrendAlignment: false, requireRsiSignal: false },
    { requireVolumeSpike: true, requireTrendAlignment: true, requireRsiSignal: false },
  ],
};

const ConfigOptimizer = ({
  config,
  candleData,
  onApplyResult,
  onComplete,
  addEvent,
}) => {
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  // Run the optimizer
  const runOptimizer = async () => {
    if (!candleData || candleData.length === 0) {
      addEvent?.('error', 'Optimizer Failed', 'No data available. Run a simulation first.');
      return;
    }

    setIsOptimizing(true);
    setProgress(0);
    setResults([]);
    setShowResults(true);

    console.log(`[Optimizer] Processing ${candleData.length} candles (starting from index 20, so ${candleData.length - 20} tradeable candles)`);

    // Generate all config combinations
    const combinations = [];
    const baseConfig = {
      ...config,
      allocatedCapital: config.allocatedCapital || 25000,
      rsiOversold: config.rsiOversold || 30,
      rsiOverbought: config.rsiOverbought || 70,
      volumeMultiplier: config.volumeMultiplier || 1.5,
    };

    for (const strategy of CONFIG_VARIATIONS.entryStrategy) {
      for (const signals of CONFIG_VARIATIONS.minSignalsRequired) {
        for (const tp of CONFIG_VARIATIONS.takeProfitPercent) {
          for (const sl of CONFIG_VARIATIONS.stopLossPercent) {
            for (const conf of CONFIG_VARIATIONS.minConfidence) {
              for (const posSize of CONFIG_VARIATIONS.maxPositionSizePercent) {
                for (const flags of CONFIG_VARIATIONS.requireFlags) {
                  combinations.push({
                    ...baseConfig,
                    entryStrategy: strategy,
                    minSignalsRequired: signals,
                    takeProfitPercent: tp,
                    stopLossPercent: sl,
                    minConfidence: conf,
                    maxPositionSizePercent: posSize,
                    ...flags,
                  });
                }
              }
            }
          }
        }
      }
    }

    console.log(`[Optimizer] Testing ${combinations.length} config combinations...`);
    addEvent?.('info', 'Optimizer Started', `Testing ${combinations.length} configurations...`);

    const allResults = [];
    for (let i = 0; i < combinations.length; i++) {
      const testConfig = combinations[i];
      const result = runFastSimulation(candleData, testConfig);
      allResults.push(result);

      // Update progress every 10 iterations
      if (i % 10 === 0) {
        setProgress(Math.round((i / combinations.length) * 100));
        // Yield to prevent UI freeze
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Sort by return percent (best first)
    allResults.sort((a, b) => b.returnPercent - a.returnPercent);

    // Keep top 10
    const topResults = allResults.slice(0, 10);
    setResults(topResults);
    setProgress(100);
    setIsOptimizing(false);

    addEvent?.('success', 'Optimizer Complete', `Best config: ${topResults[0].returnPercent.toFixed(2)}% return`);
    onComplete?.(topResults);
    console.log('[Optimizer] Top 10 results:', topResults);
  };

  // Apply an optimizer result
  const handleApplyResult = (result) => {
    onApplyResult?.(result);
    addEvent?.('info', 'Config Applied', `Applied ${result.config.entryStrategy} strategy config. Predicted: ${result.returnPercent.toFixed(2)}% return, ${result.numTrades} trades`);
  };

  return (
    <div style={{ marginTop: theme.spacing.md }}>
      {/* Optimizer Button or Progress */}
      {!showResults && (
        <Button
          variant="outline"
          onClick={runOptimizer}
          disabled={isOptimizing || !candleData?.length}
          style={{ backgroundColor: '#8b5cf6', color: '#fff', border: 'none' }}
        >
          {isOptimizing ? `Optimizing... ${progress}%` : '🔬 Find Optimal Config'}
        </Button>
      )}

      {/* Progress Bar */}
      {isOptimizing && (
        <div style={{ marginTop: theme.spacing.sm }}>
          <div
            style={{
              height: '8px',
              backgroundColor: theme.colors.gray200,
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                backgroundColor: '#8b5cf6',
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          <div
            style={{
              marginTop: theme.spacing.xs,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray500,
              textAlign: 'center',
            }}
          >
            Testing {Math.round(progress * 393.75)} of 39,375 configurations...
          </div>
        </div>
      )}

      {/* Results Table */}
      {showResults && results.length > 0 && (
        <div
          style={{
            marginTop: theme.spacing.md,
            backgroundColor: '#f3e8ff',
            padding: theme.spacing.md,
            borderRadius: theme.borderRadius.md,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: theme.spacing.sm,
            }}
          >
            <h4 style={{ margin: 0, color: '#7c3aed' }}>
              Top 10 Configurations
            </h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResults(false)}
            >
              Hide
            </Button>
          </div>
          <div
            style={{
              maxHeight: '300px',
              overflowY: 'auto',
            }}
          >
            <table
              style={{
                width: '100%',
                fontSize: theme.typography.fontSize.xs,
                borderCollapse: 'collapse',
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: '#e9d5ff',
                    position: 'sticky',
                    top: 0,
                  }}
                >
                  <th style={{ padding: '4px', textAlign: 'left' }}>#</th>
                  <th style={{ padding: '4px', textAlign: 'left' }}>Strategy</th>
                  <th style={{ padding: '4px', textAlign: 'right' }}>Return</th>
                  <th style={{ padding: '4px', textAlign: 'right' }}>Trades</th>
                  <th style={{ padding: '4px', textAlign: 'right' }}>Win%</th>
                  <th style={{ padding: '4px', textAlign: 'center' }}>TP/SL</th>
                  <th style={{ padding: '4px', textAlign: 'center' }}>Signals</th>
                  <th style={{ padding: '4px' }}></th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, i) => (
                  <tr
                    key={i}
                    style={{
                      backgroundColor: i === 0 ? '#dcfce7' : i % 2 === 0 ? '#fff' : '#faf5ff',
                    }}
                  >
                    <td style={{ padding: '4px' }}>{i + 1}</td>
                    <td
                      style={{
                        padding: '4px',
                        fontWeight: i === 0 ? 600 : 400,
                      }}
                    >
                      {result.config.entryStrategy}
                    </td>
                    <td
                      style={{
                        padding: '4px',
                        textAlign: 'right',
                        color: result.returnPercent >= 0 ? theme.colors.success : theme.colors.error,
                        fontWeight: 600,
                      }}
                    >
                      {result.returnPercent >= 0 ? '+' : ''}{result.returnPercent.toFixed(2)}%
                    </td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>
                      {result.numTrades}
                    </td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>
                      {result.winRate.toFixed(0)}%
                    </td>
                    <td style={{ padding: '4px', textAlign: 'center' }}>
                      {result.config.takeProfitPercent}/{result.config.stopLossPercent}
                    </td>
                    <td style={{ padding: '4px', textAlign: 'center' }}>
                      {result.config.minSignalsRequired}
                    </td>
                    <td style={{ padding: '4px' }}>
                      <Button
                        size="sm"
                        variant={i === 0 ? 'primary' : 'outline'}
                        onClick={() => handleApplyResult(result)}
                        style={{
                          padding: '2px 6px',
                          fontSize: '10px',
                        }}
                      >
                        Apply
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConfigOptimizer;
