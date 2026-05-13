import { useState, memo } from 'react';
import theme from '../../theme';

const HORIZONS = [
  { label: '1d',  days: 1 },
  { label: '5d',  days: 5 },
  { label: '10d', days: 10 },
  { label: '20d', days: 20 },
];

const ScanControls = ({ onScan, loading, generatedAt, scannedSymbols, elapsedMs }) => {
  const [horizonDays, setHorizonDays] = useState(5);
  const [minProbability, setMinProbability] = useState(0.55);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.md,
        flexWrap: 'wrap',
        padding: `${theme.spacing.sm} ${theme.spacing.md}`,
        background: theme.colors.paper,
        border: `1px solid ${theme.colors.ruler}`,
        borderRadius: theme.borderRadius.xs,
      }}
    >
      <button
        onClick={() => onScan({ horizonDays, minProbability })}
        disabled={loading}
        style={{
          padding: '10px 20px',
          fontWeight: 700,
          fontSize: '0.85rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#fff',
          background: loading ? theme.colors.gray500 : theme.colors.charcoal,
          border: 'none',
          borderRadius: theme.borderRadius.xs,
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? 'Scanning…' : '▸ Scan Now'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.7rem', color: theme.colors.gray500, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Horizon</span>
        <div style={{ display: 'flex', gap: 2, border: `1px solid ${theme.colors.ruler}`, borderRadius: theme.borderRadius.xs }}>
          {HORIZONS.map(h => {
            const active = horizonDays === h.days;
            return (
              <button
                key={h.days}
                onClick={() => setHorizonDays(h.days)}
                style={{
                  padding: '6px 12px',
                  fontFamily: theme.typography.fontFamilyMono,
                  fontSize: '0.8rem',
                  fontWeight: active ? 700 : 500,
                  color: active ? '#fff' : theme.colors.charcoal,
                  background: active ? theme.colors.charcoal : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {h.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.7rem', color: theme.colors.gray500, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Min Prob</span>
        <input
          type="range"
          min="0.40"
          max="0.85"
          step="0.05"
          value={minProbability}
          onChange={e => setMinProbability(parseFloat(e.target.value))}
          style={{ width: 100 }}
        />
        <span style={{ fontFamily: theme.typography.fontFamilyMono, fontWeight: 700, color: theme.colors.charcoal, minWidth: 40 }}>
          {(minProbability * 100).toFixed(0)}%
        </span>
      </div>

      <div style={{ marginLeft: 'auto', fontSize: '0.7rem', color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono, textAlign: 'right' }}>
        {generatedAt && (
          <div>Last scan: {new Date(generatedAt).toLocaleTimeString('en-US', { hour12: false })}</div>
        )}
        {scannedSymbols != null && (
          <div>{scannedSymbols} symbols · {elapsedMs}ms</div>
        )}
      </div>
    </div>
  );
};

export default memo(ScanControls);
