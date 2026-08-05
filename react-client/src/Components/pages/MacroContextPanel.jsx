import { useState, useEffect, useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';

// Cross-asset context. ETF proxies (indices/vol/gold/rates/dollar/semis) — the
// index itself (e.g. I:VIX) isn't served by the quote feed, so we use VIXY etc.
const MACRO = [
  { sym: 'SPY', label: 'S&P', group: 'Equities' },
  { sym: 'QQQ', label: 'Nasdaq', group: 'Equities' },
  { sym: 'IWM', label: 'Rus2k', group: 'Equities' },
  { sym: 'DIA', label: 'Dow', group: 'Equities' },
  { sym: 'SMH', label: 'Semis', group: 'Semis' },
  { sym: 'VIXY', label: 'VIX', group: 'Volatility' },
  { sym: 'GLD', label: 'Gold', group: 'Safe-haven' },
  { sym: 'TLT', label: 'Bonds', group: 'Rates' },
  { sym: 'UUP', label: 'Dollar', group: 'Dollar' },
];
const GROUPS = ['Equities', 'Semis', 'Volatility', 'Safe-haven', 'Rates', 'Dollar'];
const REFRESH_MS = 30000;

const pctFromOpen = q => {
  if (!q) return null;
  const last = Number(q.last ?? q.close);
  const ref = Number(q.open ?? q.prevClose);
  if (!Number.isFinite(last) || !Number.isFinite(ref) || ref === 0) return null;
  return ((last - ref) / ref) * 100;
};

const pctColor = pct =>
  pct == null ? theme.colors.gray500 : pct >= 0 ? theme.colors.success : theme.colors.error;

const Read = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: theme.typography.fontSize.xs, fontFamily: 'monospace', padding: '2px 0' }}>
    <span style={{ color: theme.colors.gray500 }}>{label}</span>
    <span style={{ color: color || theme.colors.gray800, fontWeight: 600, textAlign: 'right' }}>{value}</span>
  </div>
);

const MacroContextPanel = () => {
  const [quotes, setQuotes] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const results = await Promise.all(
        MACRO.map(async ({ sym }) => {
          try {
            const res = await fetch(`/api/quote/${sym}`);
            if (!res.ok) return [sym, null];
            return [sym, await res.json()];
          } catch {
            return [sym, null];
          }
        })
      );
      if (cancelled) return;
      setQuotes(Object.fromEntries(results));
      setUpdatedAt(new Date());
    };
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const p = useMemo(() => {
    const g = sym => pctFromOpen(quotes[sym]);
    const eqVals = ['SPY', 'QQQ', 'IWM', 'DIA'].map(g).filter(v => v != null);
    const equity = eqVals.length ? eqVals.reduce((a, b) => a + b, 0) / eqVals.length : null;
    const vix = g('VIXY');
    const gold = g('GLD');
    const semis = g('SMH');
    const qqq = g('QQQ');
    return { equity, vix, gold, semis, qqq };
  }, [quotes]);

  // Derived reads (client-side, from real day% only).
  const reads = useMemo(() => {
    const { equity, vix, gold, semis, qqq } = p;
    if (equity == null) return null;
    const eqUp = equity > 0.1;
    const eqDown = equity < -0.1;
    const vixUp = vix != null && vix > 1;
    const vixDown = vix != null && vix < -1;
    const goldBid = gold != null && gold > 1;

    let regime = 'MIXED';
    let regimeColor = theme.colors.warningDark;
    if (eqUp && !vixUp) {
      regime = 'RISK-ON';
      regimeColor = theme.colors.success;
    } else if (eqDown && (vixUp || goldBid)) {
      regime = 'RISK-OFF';
      regimeColor = theme.colors.error;
    }

    const spread = semis != null && qqq != null ? semis - qqq : null;
    const vixConfirm =
      vix == null || equity == null
        ? '—'
        : (equity >= 0 && vix <= 0) || (equity < 0 && vix > 0)
          ? 'confirming'
          : 'diverging ⚠';

    return {
      regime,
      regimeColor,
      spread,
      vixConfirm,
      vixConfirmColor: vixConfirm.startsWith('div') ? theme.colors.warningDark : theme.colors.gray700,
      safeHaven: goldBid || (gold != null && gold > 0.5 && eqDown),
    };
  }, [p]);

  const loading = Object.keys(quotes).length === 0;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          Macro &amp; Risk
        </h3>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: 'monospace' }}>
          {loading ? 'loading…' : updatedAt ? `${fmtET(updatedAt)} ET` : ''}
        </div>
      </div>

      {reads && (
        <div style={{ marginBottom: theme.spacing.sm, paddingBottom: theme.spacing.sm, borderBottom: `1px solid ${theme.colors.gray200}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Risk regime
            </span>
            <span style={{ fontWeight: 800, color: reads.regimeColor, fontFamily: 'monospace' }}>
              {reads.regime}
            </span>
          </div>
          <Read
            label="Semis vs Tech (SMH−QQQ)"
            value={reads.spread == null ? '—' : `${reads.spread >= 0 ? '+' : ''}${reads.spread.toFixed(2)}% ${reads.spread >= 0 ? 'leading' : 'lagging'}`}
            color={pctColor(reads.spread)}
          />
          <Read label="VIX confirmation" value={reads.vixConfirm} color={reads.vixConfirmColor} />
          {reads.safeHaven && (
            <Read label="Safe-haven bid" value="gold/bonds bid — caution" color={theme.colors.warningDark} />
          )}
        </div>
      )}

      {/* Macro grid, grouped by asset class */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: theme.spacing.sm }}>
        {GROUPS.map(group => (
          <div key={group}>
            <div style={{ fontSize: '10px', color: theme.colors.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {group}
            </div>
            {MACRO.filter(m => m.group === group).map(({ sym, label }) => {
              const pct = pctFromOpen(quotes[sym]);
              const last = quotes[sym]?.last ?? quotes[sym]?.close;
              return (
                <div key={sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, fontFamily: 'monospace', fontSize: theme.typography.fontSize.sm, marginBottom: 2 }}>
                  <span style={{ fontWeight: 700 }}>{label}</span>
                  <span style={{ color: pctColor(pct), fontWeight: 600, fontSize: theme.typography.fontSize.xs }}>
                    {last != null ? `$${Number(last).toFixed(0)}` : '—'}{' '}
                    {pct == null ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Card>
  );
};

export default memo(MacroContextPanel);
