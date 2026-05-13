import { memo } from 'react';
import { Link } from 'react-router-dom';
import theme from '../../theme';

const ProbBar = ({ probability, direction }) => {
  const widthPct = Math.round(probability * 100);
  const color = direction === 'LONG' ? theme.colors.successMuted : theme.colors.errorMuted;
  return (
    <div style={{ position: 'relative', height: 14, background: theme.colors.gray200, borderRadius: theme.borderRadius.xs, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${widthPct}%`,
          height: '100%',
          background: color,
          opacity: 0.85,
        }}
      />
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: theme.typography.fontFamilyMono,
        fontSize: '0.7rem',
        fontWeight: 700,
        color: widthPct > 50 ? '#fff' : theme.colors.charcoal,
      }}>
        {widthPct}%
      </div>
    </div>
  );
};

const DirectionBadge = ({ direction }) => {
  const isLong = direction === 'LONG';
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 8px',
      fontFamily: theme.typography.fontFamilyMono,
      fontSize: '0.7rem',
      fontWeight: 700,
      letterSpacing: '0.1em',
      color: '#fff',
      background: isLong ? theme.colors.successMuted : theme.colors.errorMuted,
      borderRadius: theme.borderRadius.xs,
    }}>
      {direction}
    </span>
  );
};

const fmt$ = n => n == null ? '—' : `$${Number(n).toFixed(2)}`;
const fmtR = n => n == null ? '—' : `${Number(n).toFixed(2)}×`;

const OpportunityTable = ({ opportunities = [], loading = false }) => {
  if (loading && opportunities.length === 0) {
    return (
      <div style={{ padding: theme.spacing.xl, textAlign: 'center', color: theme.colors.gray500 }}>
        Scanning universe…
      </div>
    );
  }
  if (!opportunities.length) {
    return (
      <div style={{
        padding: theme.spacing.xl,
        textAlign: 'center',
        color: theme.colors.gray500,
        fontSize: '0.85rem',
        background: theme.colors.parchment,
        border: `1px dashed ${theme.colors.ruler}`,
        borderRadius: theme.borderRadius.xs,
      }}>
        No opportunities meet the threshold. Lower the min probability or change horizon.
      </div>
    );
  }

  const headerStyle = {
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.18em',
    color: theme.colors.gray500,
    textTransform: 'uppercase',
    padding: '8px 6px',
    textAlign: 'left',
    borderBottom: `1px solid ${theme.colors.ruler}`,
  };
  const cellStyle = {
    padding: '10px 6px',
    fontFamily: theme.typography.fontFamilyMono,
    fontSize: '0.8rem',
    color: theme.colors.charcoal,
    borderBottom: `1px solid ${theme.colors.gray200}`,
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div style={{ background: theme.colors.paper, border: `1px solid ${theme.colors.ruler}`, borderRadius: theme.borderRadius.xs, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...headerStyle, width: 30 }}>#</th>
            <th style={{ ...headerStyle, width: 70 }}>Symbol</th>
            <th style={{ ...headerStyle, width: 60 }}>Dir</th>
            <th style={{ ...headerStyle, width: 140 }}>Probability</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Last</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Target</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Stop</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>R:R</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>EV (R)</th>
            <th style={{ ...headerStyle, width: '40%' }}>Why</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((o, i) => (
            <tr key={`${o.symbol}-${i}`}>
              <td style={{ ...cellStyle, color: theme.colors.gray500 }}>{String(i + 1).padStart(2, '0')}</td>
              <td style={cellStyle}>
                <Link to={`/stock/${o.symbol}`} style={{ fontWeight: 700, color: theme.colors.charcoal, textDecoration: 'none' }}>
                  {o.symbol}
                </Link>
              </td>
              <td style={cellStyle}><DirectionBadge direction={o.direction} /></td>
              <td style={cellStyle}><ProbBar probability={o.probability} direction={o.direction} /></td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>{fmt$(o.currentPrice)}</td>
              <td style={{ ...cellStyle, textAlign: 'right', color: theme.colors.successMuted, fontWeight: 600 }}>{fmt$(o.targetPrice)}</td>
              <td style={{ ...cellStyle, textAlign: 'right', color: theme.colors.errorMuted, fontWeight: 600 }}>{fmt$(o.stopPrice)}</td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{fmtR(o.riskReward)}</td>
              <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700, color: o.expectedValue >= 1 ? theme.colors.successMuted : theme.colors.charcoal }}>
                {o.expectedValue != null ? `+${o.expectedValue.toFixed(2)}` : '—'}
              </td>
              <td style={{ ...cellStyle, fontSize: '0.72rem', fontFamily: theme.typography.fontFamily, color: theme.colors.gray700 }}>
                {(o.reasons || []).slice(0, 3).join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default memo(OpportunityTable);
