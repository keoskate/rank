import { useState, memo } from 'react';
import theme from '../../theme';

const HORIZONS = [
  { label: '1d',  days: 1 },
  { label: '5d',  days: 5 },
  { label: '10d', days: 10 },
  { label: '20d', days: 20 },
];

const DTE_PRESETS = [
  { label: '7–30d',   dteMin: 7,   dteMax: 30 },
  { label: '7–60d',   dteMin: 7,   dteMax: 60 },
  { label: '30–90d',  dteMin: 30,  dteMax: 90 },
  { label: '2–6mo',   dteMin: 60,  dteMax: 180 },
  { label: '6–12mo',  dteMin: 180, dteMax: 365 },
];

const EARNINGS_MODES = [
  { label: 'All',   value: 'all' },
  { label: 'Avoid', value: 'exclude' },
  { label: 'Only',  value: 'only' },
];

const labelStyle = {
  fontSize: '0.7rem',
  color: theme.colors.gray500,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
};

const PillGroup = ({ options, isActive, onSelect }) => (
  <div style={{ display: 'flex', gap: 2, border: `1px solid ${theme.colors.ruler}`, borderRadius: theme.borderRadius.xs }}>
    {options.map(opt => {
      const active = isActive(opt);
      return (
        <button
          key={opt.label}
          onClick={() => onSelect(opt)}
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
          {opt.label}
        </button>
      );
    })}
  </div>
);

const OptionsScanControls = ({ onScan, loading, generatedAt, underlyingsScanned, elapsedMs }) => {
  const [horizonDays, setHorizonDays] = useState(5);
  const [dte, setDte] = useState(DTE_PRESETS[1]);
  const [earningsMode, setEarningsMode] = useState('all');
  const [maxSpreadPct, setMaxSpreadPct] = useState(0.15);

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
        onClick={() => onScan({ horizonDays, dteMin: dte.dteMin, dteMax: dte.dteMax, earningsMode, maxSpreadPct })}
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
        {loading ? 'Scanning…' : '▸ Scan Options'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={labelStyle}>Horizon</span>
        <PillGroup
          options={HORIZONS}
          isActive={h => horizonDays === h.days}
          onSelect={h => setHorizonDays(h.days)}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={labelStyle}>DTE</span>
        <PillGroup
          options={DTE_PRESETS}
          isActive={d => dte.label === d.label}
          onSelect={setDte}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={labelStyle}>Earnings</span>
        <PillGroup
          options={EARNINGS_MODES}
          isActive={m => earningsMode === m.value}
          onSelect={m => setEarningsMode(m.value)}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={labelStyle}>Max Spread</span>
        <input
          type="range"
          min="0.05"
          max="0.25"
          step="0.01"
          value={maxSpreadPct}
          onChange={e => setMaxSpreadPct(parseFloat(e.target.value))}
          style={{ width: 80 }}
        />
        <span style={{ fontFamily: theme.typography.fontFamilyMono, fontWeight: 700, color: theme.colors.charcoal, minWidth: 36 }}>
          {(maxSpreadPct * 100).toFixed(0)}%
        </span>
      </div>

      <div style={{ marginLeft: 'auto', fontSize: '0.7rem', color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono, textAlign: 'right' }}>
        {generatedAt && (
          <div>Last scan: {new Date(generatedAt).toLocaleTimeString('en-US', { hour12: false })}</div>
        )}
        {underlyingsScanned != null && (
          <div>{underlyingsScanned} underlyings · {elapsedMs}ms</div>
        )}
      </div>
    </div>
  );
};

export default memo(OptionsScanControls);
