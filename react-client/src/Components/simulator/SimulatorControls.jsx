/**
 * SimulatorControls Component
 *
 * Date, symbol, speed selection and start/stop/pause controls
 * for the trading simulator.
 */

import Button from '../common/Button';
import theme from '../../theme';

const SimulatorControls = ({
  simulationDate,
  setSimulationDate,
  symbol,
  setSymbol,
  simulationSpeed,
  setSimulationSpeed,
  isRunning,
  isPaused,
  isOptimizing,
  lockedSymbols,
  onStart,
  onPause,
  onStop,
  onOptimize,
}) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: theme.spacing.md,
        marginBottom: theme.spacing.lg,
      }}
    >
      {/* Date Input */}
      <div>
        <label
          style={{
            display: 'block',
            marginBottom: theme.spacing.xs,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
          }}
        >
          Date
        </label>
        <input
          type="date"
          value={simulationDate}
          onChange={e => setSimulationDate(e.target.value)}
          disabled={isRunning}
          max={new Date().toISOString().split('T')[0]}
          style={{
            width: '100%',
            padding: theme.spacing.sm,
            border: `1px solid ${theme.colors.gray300}`,
            borderRadius: theme.borderRadius.md,
            fontSize: theme.typography.fontSize.md,
          }}
        />
      </div>

      {/* Symbol Input */}
      <div>
        <label
          style={{
            display: 'block',
            marginBottom: theme.spacing.xs,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
          }}
        >
          Symbol {lockedSymbols?.length > 0 && <span style={{ color: '#22c55e', fontSize: '10px' }}>(ETF Mode)</span>}
        </label>
        {lockedSymbols?.length > 0 ? (
          <select
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            disabled={isRunning}
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid #22c55e`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.md,
              backgroundColor: '#dcfce7',
            }}
          >
            {lockedSymbols.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            disabled={isRunning}
            placeholder="AAPL"
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.gray300}`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.md,
            }}
          />
        )}
      </div>

      {/* Speed Selector */}
      <div>
        <label
          style={{
            display: 'block',
            marginBottom: theme.spacing.xs,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
          }}
        >
          Speed
        </label>
        <select
          value={simulationSpeed}
          onChange={e => setSimulationSpeed(parseFloat(e.target.value))}
          disabled={isRunning}
          style={{
            width: '100%',
            padding: theme.spacing.sm,
            border: `1px solid ${theme.colors.gray300}`,
            borderRadius: theme.borderRadius.md,
            fontSize: theme.typography.fontSize.md,
          }}
        >
          <option value={0.5}>0.5x (12s)</option>
          <option value={1}>1x (6s)</option>
          <option value={2}>2x (3s)</option>
          <option value={4}>4x (1.5s)</option>
        </select>
      </div>

      {/* Action Buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: theme.spacing.sm,
        }}
      >
        {!isRunning && !isOptimizing ? (
          <>
            <Button
              onClick={onStart}
              disabled={!simulationDate || !symbol}
            >
              Run Simulation
            </Button>
            <Button
              variant="outline"
              onClick={onOptimize}
              disabled={!simulationDate || !symbol}
              style={{ backgroundColor: '#8b5cf6', color: '#fff', border: 'none' }}
            >
              🔬 Optimize
            </Button>
          </>
        ) : isOptimizing ? (
          <div
            style={{
              padding: theme.spacing.sm,
              color: '#8b5cf6',
              fontWeight: 600,
            }}
          >
            Optimizing...
          </div>
        ) : (
          <>
            <Button variant="outline" onClick={onPause}>
              {isPaused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="outline" onClick={onStop}>
              Stop
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default SimulatorControls;
