import { useState, useEffect, useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';

// SOXL is +3x SOXX (daily reset); SOXS is -3x. Intraday from the open they
// should track ~3x / -3x — small drift is NORMAL (path dependence + tracking
// noise), but a large/sudden gap can signal a price-feed lag or dislocation.
const LEGS = [
  { sym: 'SOXL', exp: 3 },
  { sym: 'SOXS', exp: -3 },
];
const REFRESH_MS = 20000;
const SLIP_MINOR = 0.3; // %-points of tracking error
const SLIP_MAJOR = 0.7;

const pctFromOpen = q => {
  if (!q) return null;
  const last = Number(q.last ?? q.close ?? q.price);
  const open = Number(q.open ?? q.prevClose);
  if (!Number.isFinite(last) || !Number.isFinite(open) || open === 0) return null;
  return ((last - open) / open) * 100;
};

const pctColor = p => (p == null ? theme.colors.gray500 : p >= 0 ? theme.colors.success : theme.colors.error);
const fmtPct = p => (p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`);

const LeverageTracker = () => {
  const [quotes, setQuotes] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const syms = ['SOXX', 'SOXL', 'SOXS'];
      const results = await Promise.all(
        syms.map(async s => {
          try {
            const res = await fetch(`/api/quote/${s}`);
            return [s, res.ok ? await res.json() : null];
          } catch {
            return [s, null];
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

  const model = useMemo(() => {
    const soxx = pctFromOpen(quotes.SOXX);
    const legs = LEGS.map(({ sym, exp }) => {
      const pct = pctFromOpen(quotes[sym]);
      // realized multiple vs SOXX; unstable when SOXX is ~flat
      const mult = soxx != null && Math.abs(soxx) >= 0.05 && pct != null ? pct / soxx : null;
      const expectedPct = soxx != null ? exp * soxx : null;
      const slip = pct != null && expectedPct != null ? pct - expectedPct : null;
      return { sym, exp, pct, mult, slip };
    });
    const worst = legs.reduce((m, l) => (l.slip != null && Math.abs(l.slip) > Math.abs(m?.slip ?? -1) ? l : m), null);
    let status = { label: 'in sync', color: theme.colors.success };
    if (soxx == null) status = { label: 'awaiting quotes', color: theme.colors.gray500 };
    else if (worst && Math.abs(worst.slip) >= SLIP_MAJOR)
      status = { label: `slippage on ${worst.sym} ${fmtPct(worst.slip)} — possible feed lag / dislocation`, color: theme.colors.error };
    else if (worst && Math.abs(worst.slip) >= SLIP_MINOR)
      status = { label: `minor drift on ${worst.sym} ${fmtPct(worst.slip)}`, color: theme.colors.warningDark };
    return { soxx, legs, status };
  }, [quotes]);

  const loading = Object.keys(quotes).length === 0;

  const Cell = ({ label, pct, sub }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ fontFamily: theme.typography.fontFamilyMono, fontWeight: 700, fontSize: theme.typography.fontSize.md, color: pctColor(pct) }}>
        {fmtPct(pct)}
      </span>
      {sub && <span style={{ fontFamily: theme.typography.fontFamilyMono, fontSize: '11px', color: theme.colors.gray500 }}>{sub}</span>}
    </div>
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          Leverage tracking{' '}
          <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray400, fontWeight: theme.typography.fontWeight.normal }}>
            from open
          </span>
        </h3>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: 'monospace' }}>
          {loading ? 'loading…' : updatedAt ? `${fmtET(updatedAt)} ET` : ''}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
        <Cell label="SOXX (index)" pct={model.soxx} sub="the driver" />
        {model.legs.map(l => (
          <Cell
            key={l.sym}
            label={l.sym}
            pct={l.pct}
            sub={l.mult != null ? `${l.mult >= 0 ? '+' : ''}${l.mult.toFixed(2)}× · exp ${l.exp > 0 ? '+' : ''}${l.exp}×` : `exp ${l.exp > 0 ? '+' : ''}${l.exp}×`}
          />
        ))}
      </div>

      <div style={{ fontSize: theme.typography.fontSize.xs, fontFamily: theme.typography.fontFamilyMono, color: model.status.color, fontWeight: 600 }}>
        Tracking: {model.status.label}
      </div>
      <div style={{ fontSize: '10px', color: theme.colors.gray400, marginTop: 4 }}>
        small intraday drift is normal for 3× daily-reset ETFs; a large gap flags a feed lag or dislocation
      </div>
    </Card>
  );
};

export default memo(LeverageTracker);
