import { memo, useMemo, useState } from 'react';
import theme from '../../theme';

// Bright, traditional up/down that POPS, shaded by move size (deeper = bigger).
const UP = theme.colors.success; // #28a745
const DOWN = theme.colors.error; // #dc3545
const FLAT = theme.colors.gray400; // visible even at small dot sizes
const NEUTRAL_BAND = 0.15; // |day %| under this reads flat

const hexToRgb = h => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
// Blend toward white; t=1 full color, t→0 near white.
const shade = (hex, t) => {
  const [r, g, b] = hexToRgb(hex);
  const mix = c => Math.round(255 + (c - 255) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};

const dirOf = pct => (pct == null ? 0 : pct > NEUTRAL_BAND ? 1 : pct < -NEUTRAL_BAND ? -1 : 0);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parseISO = s => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
};
const mdLabel = s => {
  const dt = parseISO(s);
  return dt ? `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}` : '';
};
const fullLabel = s => {
  const dt = parseISO(s);
  return dt ? `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}` : '';
};
// Monday of the date's week — the week bucket key.
const weekKeyOf = s => {
  const dt = parseISO(s);
  if (!dt) return '?';
  const dow = dt.getUTCDay(); // 0 Sun … 6 Sat
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().slice(0, 10);
};

const CELL = 9;
const CELL_GAP = 2;

/**
 * Daily up/down/flat history. Two shapes:
 *   - series={[{date, pct}]}  → rich: weekly-grouped strip + tiny week dates +
 *     faint week separators + (optional) hover-expand to a ~6-month calendar grid.
 *   - recentDays={[+1/0/-1]}  → legacy simple strip (options scanner).
 */
const DotHistory = ({
  series,
  recentDays,
  magnitudes,
  stripDays = 30,
  weekly = false,
  expandable = false,
  size = 12,
  gap = 4,
  maxMagnitude = 8,
  label,
}) => {
  const [expanded, setExpanded] = useState(false);

  const days = useMemo(() => {
    if (Array.isArray(series) && series.length) {
      return series
        .filter(d => d && d.date)
        .map(d => ({ date: d.date, pct: Number.isFinite(d.pct) ? d.pct : null, dir: dirOf(d.pct) }));
    }
    if (Array.isArray(recentDays)) {
      return recentDays.map((dir, i) => ({ date: null, pct: magnitudes?.[i] ?? null, dir }));
    }
    return [];
  }, [series, recentDays, magnitudes]);

  // Compact strip grouped into weeks (Monday-keyed).
  const weeks = useMemo(() => {
    const strip = days.slice(-stripDays);
    const out = [];
    let cur = null;
    for (const d of strip) {
      const k = d.date ? weekKeyOf(d.date) : '_';
      if (!cur || cur.key !== k) {
        cur = { key: k, days: [] };
        out.push(cur);
      }
      cur.days.push(d);
    }
    return out;
  }, [days, stripDays]);

  // Full-history calendar grid: week columns × weekday rows (Mon–Fri).
  const grid = useMemo(() => {
    if (!expandable) return null;
    const withDates = days.filter(d => d.date);
    if (!withDates.length) return null;
    const cols = [];
    const byKey = new Map();
    for (const d of withDates) {
      const k = weekKeyOf(d.date);
      let col = byKey.get(k);
      if (!col) {
        col = { key: k, month: parseISO(k).getUTCMonth(), cells: {} };
        byKey.set(k, col);
        cols.push(col);
      }
      const dow = parseISO(d.date).getUTCDay(); // 1 Mon … 5 Fri
      if (dow >= 1 && dow <= 5) col.cells[dow - 1] = d;
    }
    return cols;
  }, [days, expandable]);

  if (!days.length) return null;

  const dotColor = (dir, pct) => {
    if (dir === 0) return FLAT;
    const base = dir > 0 ? UP : DOWN;
    if (pct == null) return base;
    // floor at 0.5 so even small moves stay legible (esp. at 6px dot sizes)
    const t = 0.5 + 0.5 * Math.min(1, Math.abs(pct) / maxMagnitude);
    return shade(base, t);
  };
  const dotTitle = d =>
    [d.date ? fullLabel(d.date) : null, d.pct != null ? `${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(1)}%` : null]
      .filter(Boolean)
      .join('  ·  ') || undefined;

  const Dot = ({ d, s = size, radius = '50%' }) => (
    <span title={dotTitle(d)} style={{ width: s, height: s, borderRadius: radius, background: dotColor(d.dir, d.pct), flex: '0 0 auto' }} />
  );

  const strip = days.slice(-stripDays);
  const useWeekly = weekly && strip.some(d => d.date);

  const stripEl = useWeekly ? (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {weeks.map((wk, wi) => (
        <div
          key={wk.key + wi}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            paddingLeft: wi > 0 ? gap + 3 : 0,
            marginLeft: wi > 0 ? gap + 3 : 0,
            borderLeft: wi > 0 ? `1px solid ${theme.colors.gray200}` : 'none',
          }}
        >
          <div style={{ display: 'flex', gap }}>
            {wk.days.map((d, i) => <Dot key={i} d={d} />)}
          </div>
          <span style={{ fontSize: '9px', color: theme.colors.gray400, fontFamily: theme.typography.fontFamilyMono, letterSpacing: '0.02em' }}>
            {mdLabel(wk.days[0].date)}
          </span>
        </div>
      ))}
    </div>
  ) : (
    <div style={{ display: 'flex', gap, flexWrap: 'wrap' }}>
      {strip.map((d, i) => <Dot key={i} d={d} />)}
    </div>
  );

  return (
    <div
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, position: 'relative' }}
      onMouseEnter={expandable ? () => setExpanded(true) : undefined}
      onMouseLeave={expandable ? () => setExpanded(false) : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {stripEl}
        {label && (
          <span style={{ fontSize: '11px', color: theme.colors.gray600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {label}
            {expandable && grid && <span style={{ color: theme.colors.gray400 }}> · hover ⤢</span>}
          </span>
        )}
      </div>

      {expandable && expanded && grid && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 40,
            background: theme.colors.surface,
            border: `1px solid ${theme.colors.gray200}`,
            borderRadius: theme.borderRadius.md,
            boxShadow: theme.shadows.lg,
            padding: theme.spacing.md,
          }}
        >
          <div style={{ fontSize: '11px', color: theme.colors.gray500, marginBottom: 8, fontFamily: theme.typography.fontFamilyMono }}>
            Daily history · {grid.reduce((n, c) => n + Object.keys(c.cells).length, 0)} sessions (green up / red down · deeper = bigger)
          </div>
          <div style={{ display: 'flex', gap: CELL_GAP, alignItems: 'flex-start' }}>
            {grid.map((col, ci) => {
              const showMonth = ci === 0 || grid[ci - 1].month !== col.month;
              return (
                <div key={col.key} style={{ display: 'flex', flexDirection: 'column', gap: CELL_GAP }}>
                  <div style={{ height: 12, fontSize: '9px', color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono, whiteSpace: 'nowrap' }}>
                    {showMonth ? MONTHS[col.month] : ''}
                  </div>
                  {[0, 1, 2, 3, 4].map(row => {
                    const d = col.cells[row];
                    return d ? (
                      <Dot key={row} d={d} s={CELL} radius="2px" />
                    ) : (
                      <span key={row} style={{ width: CELL, height: CELL, borderRadius: 2, background: theme.colors.gray100 }} />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(DotHistory);
