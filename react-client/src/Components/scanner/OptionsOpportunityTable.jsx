import { useState, memo } from 'react';
import { Link } from 'react-router-dom';
import theme from '../../theme';

/**
 * PoP bar: filled width = our model's probability of profit; the dark tick
 * marks the market-implied probability. The visible gap IS the edge.
 */
const PopBar = ({ popModel, popMarket, direction }) => {
  const modelPct = Math.round(popModel * 100);
  const marketPct = Math.round(popMarket * 100);
  const color = direction === 'LONG' ? theme.colors.successMuted : theme.colors.errorMuted;
  return (
    <div
      title={`Model ${modelPct}% vs market-implied ${marketPct}%`}
      style={{ position: 'relative', height: 14, background: theme.colors.gray200, borderRadius: theme.borderRadius.xs, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, width: `${modelPct}%`, height: '100%', background: color, opacity: 0.85 }} />
      <div style={{ position: 'absolute', top: 0, left: `${marketPct}%`, width: 2, height: '100%', background: theme.colors.charcoal }} />
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: theme.typography.fontFamilyMono,
        fontSize: '0.7rem',
        fontWeight: 700,
        color: modelPct > 50 ? '#fff' : theme.colors.charcoal,
      }}>
        {modelPct}%
      </div>
    </div>
  );
};

const TypeBadge = ({ type }) => {
  const isCall = type === 'call';
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 8px',
      fontFamily: theme.typography.fontFamilyMono,
      fontSize: '0.7rem',
      fontWeight: 700,
      letterSpacing: '0.1em',
      color: '#fff',
      background: isCall ? theme.colors.successMuted : theme.colors.errorMuted,
      borderRadius: theme.borderRadius.xs,
    }}>
      {isCall ? 'CALL' : 'PUT'}
    </span>
  );
};

const EarningsBadge = ({ earnings }) => {
  if (!earnings) return <span style={{ color: theme.colors.gray400 }}>—</span>;
  const [, m, d] = earnings.nextReportDate.split('-');
  const color = earnings.withinHorizon
    ? theme.colors.errorMuted
    : earnings.spansEarnings
      ? theme.colors.warningMuted
      : theme.colors.gray500;
  const move = earnings.expectedMovePct != null ? ` ±${(earnings.expectedMovePct * 100).toFixed(1)}%` : '';
  return (
    <span
      title={`Earnings ${earnings.nextReportDate} (${earnings.reportTime})${earnings.spansEarnings ? ' — expiry spans the report' : ''}`}
      style={{ color, fontWeight: 700, whiteSpace: 'nowrap' }}
    >
      ⚡{+m}/{+d}{move}
    </span>
  );
};

const fmt$ = n => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const fmtPct = (n, dp = 0) => (n == null ? '—' : `${(n * 100).toFixed(dp)}%`);
const fmtExp = exp => {
  const [y, m, d] = exp.split('-');
  return `${+m}/${+d}/${y.slice(2)}`;
};

const DetailRow = ({ o, colSpan }) => {
  const block = { minWidth: 170 };
  const label = {
    fontSize: '0.62rem',
    fontWeight: 700,
    letterSpacing: '0.14em',
    color: theme.colors.gray500,
    textTransform: 'uppercase',
    marginBottom: 4,
  };
  const mono = { fontFamily: theme.typography.fontFamilyMono, fontSize: '0.76rem', color: theme.colors.charcoal };
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: `${theme.spacing.sm} ${theme.spacing.md}`, background: theme.colors.parchment, borderBottom: `1px solid ${theme.colors.gray200}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.lg }}>
          <div style={block}>
            <div style={label}>Greeks / IV</div>
            <div style={mono}>Δ {o.greeks.delta} · Γ {o.greeks.gamma ?? '—'}</div>
            <div style={mono}>Θ {o.greeks.theta ?? '—'}/day · ν {o.greeks.vega ?? '—'}</div>
            <div style={mono}>IV {fmtPct(o.iv, 1)}{o.ivRank != null ? ` · IV rank ${o.ivRank}` : ''}</div>
          </div>
          <div style={block}>
            <div style={label}>Quote / Liquidity</div>
            <div style={mono}>{fmt$(o.bid)} × {fmt$(o.ask)} (spread {fmtPct(o.spreadPct, 1)})</div>
            <div style={mono}>OI {o.openInterest.toLocaleString()} · vol {o.dayVolume != null ? o.dayVolume.toLocaleString() : '—'}</div>
            <div style={mono}>quote age {o.quoteAgeMinutes != null ? `${o.quoteAgeMinutes}m` : '—'}</div>
          </div>
          <div style={block}>
            <div style={label}>Breakeven</div>
            <div style={mono}>{fmt$(o.breakeven)} ({fmtPct(o.breakevenMovePct, 1)} move)</div>
            <div style={mono}>by {fmtExp(o.expiration)}</div>
            <div style={mono}>market ITM prob ≈ {fmtPct(o.itmProbMarket)}</div>
          </div>
          <div style={block}>
            <div style={label}>Exit value @ horizon</div>
            <div style={{ ...mono, color: theme.colors.successMuted }}>target {fmt$(o.scenarioValues.target)}</div>
            <div style={mono}>flat {fmt$(o.scenarioValues.flat)}</div>
            <div style={{ ...mono, color: theme.colors.errorMuted }}>stop {fmt$(o.scenarioValues.stop)} (vs {fmt$(o.entryDebit)} in)</div>
          </div>
          <div style={block}>
            <div style={label}>Stock leg</div>
            <div style={mono}>{o.underlying} {fmt$(o.underlyingPrice)} · p {fmtPct(o.stockProbability)}</div>
            <div style={{ ...mono, color: theme.colors.successMuted }}>target {fmt$(o.targetPrice)}</div>
            <div style={{ ...mono, color: theme.colors.errorMuted }}>stop {fmt$(o.stopPrice)}</div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={label}>Why / Risks</div>
            <div style={{ fontSize: '0.74rem', color: theme.colors.gray700 }}>
              {(o.reasons || []).join(' · ')}
            </div>
            {o.riskFlags?.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {o.riskFlags.map(f => (
                  <span key={f} style={{
                    padding: '2px 6px',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    fontFamily: theme.typography.fontFamilyMono,
                    color: theme.colors.warningDark,
                    background: theme.colors.warningLight,
                    border: `1px solid ${theme.colors.warningBorder}`,
                    borderRadius: theme.borderRadius.xs,
                  }}>
                    {f.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
};

const N_COLS = 14;

const OptionsOpportunityTable = ({ opportunities = [], loading = false }) => {
  const [expanded, setExpanded] = useState(() => new Set());

  if (loading && opportunities.length === 0) {
    return (
      <div style={{ padding: theme.spacing.xl, textAlign: 'center', color: theme.colors.gray500 }}>
        Scanning chains…
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
        No contracts worth buying right now. That is the filter working — most options are not.
      </div>
    );
  }

  const toggle = i => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

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
  const right = { ...cellStyle, textAlign: 'right' };

  return (
    <div style={{ background: theme.colors.paper, border: `1px solid ${theme.colors.ruler}`, borderRadius: theme.borderRadius.xs, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...headerStyle, width: 30 }}>#</th>
            <th style={{ ...headerStyle, width: 60 }}>Sym</th>
            <th style={headerStyle}>Contract</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>DTE</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Debit</th>
            <th style={{ ...headerStyle, width: 130 }}>PoP vs Mkt</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Edge</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Exp ROI</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>EV $</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Δ</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Θ Burn</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>IVR</th>
            <th style={headerStyle}>Earn</th>
            <th style={{ ...headerStyle, width: 30 }} />
          </tr>
        </thead>
        <tbody>
          {opportunities.map((o, i) => (
            <OptionRowPair
              key={o.contractSymbol}
              o={o}
              i={i}
              isExpanded={expanded.has(i)}
              onToggle={() => toggle(i)}
              cellStyle={cellStyle}
              right={right}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

const OptionRowPair = ({ o, i, isExpanded, onToggle, cellStyle, right }) => (
  <>
    <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
      <td style={{ ...cellStyle, color: theme.colors.gray500 }}>{String(i + 1).padStart(2, '0')}</td>
      <td style={cellStyle}>
        <Link
          to={`/stock/${o.underlying}`}
          onClick={e => e.stopPropagation()}
          style={{ fontWeight: 700, color: theme.colors.charcoal, textDecoration: 'none' }}
        >
          {o.underlying}
        </Link>
      </td>
      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
        <TypeBadge type={o.type} />{' '}
        <span style={{ fontWeight: 600 }}>${o.strike}</span>
        <span style={{ color: theme.colors.gray500 }}> · {fmtExp(o.expiration)}</span>
      </td>
      <td style={right}>{o.dte}</td>
      <td style={{ ...right, fontWeight: 700 }} title="Cost per contract = max loss">
        ${Math.round(o.costPerContract)}
      </td>
      <td style={cellStyle}>
        <PopBar popModel={o.popModel} popMarket={o.popMarket} direction={o.direction} />
      </td>
      <td style={{ ...right, fontWeight: 700, color: o.popEdge > 0 ? theme.colors.successMuted : theme.colors.errorMuted }}>
        {o.popEdge > 0 ? '+' : ''}{Math.round(o.popEdge * 100)}pp
      </td>
      <td style={{ ...right, fontWeight: 700, color: o.expectedRoi >= 1 ? theme.colors.successMuted : theme.colors.charcoal }}>
        +{Math.round(o.expectedRoi * 100)}%
      </td>
      <td style={right}>${Math.round(o.evPerContract)}</td>
      <td style={right}>{o.greeks.delta.toFixed(2)}</td>
      <td style={{ ...right, color: o.thetaBurnPct > 0.5 ? theme.colors.warningMuted : theme.colors.charcoal }}>
        {o.thetaBurnPct != null ? fmtPct(o.thetaBurnPct) : '—'}
      </td>
      <td style={{ ...right, color: o.ivRank > 80 ? theme.colors.warningMuted : theme.colors.charcoal }}>
        {o.ivRank != null ? Math.round(o.ivRank) : '—'}
      </td>
      <td style={{ ...cellStyle, fontSize: '0.72rem' }}><EarningsBadge earnings={o.earnings} /></td>
      <td style={{ ...cellStyle, color: theme.colors.gray500 }}>{isExpanded ? '▾' : '▸'}</td>
    </tr>
    {isExpanded && <DetailRow o={o} colSpan={N_COLS} />}
  </>
);

export default memo(OptionsOpportunityTable);
