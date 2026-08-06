import { memo, useMemo, useState } from 'react';
import theme from '../../theme';
import { fmtET } from '../../utils/timeFormat';
import { SOXX_TOP } from './soxxConstituents';

// SOXX (semiconductor index) membership — flags which fund holdings are semis,
// and is sortable so you can separate the SOXX names from everything else.
const SOXX_SET = new Set(SOXX_TOP.map(c => c.sym));

const formatMoney = (n, opts = {}) => {
  const { showSign = false, decimals = 2 } = opts;
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const sign = showSign && num >= 0 ? '+' : '';
  return `${sign}$${num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

const formatPct = n => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const formatQty = n => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return Math.abs(num) < 1 ? num.toFixed(6) : num.toLocaleString('en-US');
};

// key = position field; num=false sorts as text (symbol). sortVal overrides the
// sort accessor (used for the derived SOXX-membership flag).
const COLUMNS = [
  { key: 'symbol', label: 'Symbol', align: 'left', num: false, render: p => p.symbol },
  {
    key: 'isSoxx',
    label: 'SOXX',
    align: 'center',
    num: true,
    sortVal: p => (SOXX_SET.has(p.symbol) ? 1 : 0),
    render: p =>
      SOXX_SET.has(p.symbol) ? (
        <span title="SOXX (semiconductor index) member" style={{ color: theme.colors.success }}>●</span>
      ) : (
        <span style={{ color: theme.colors.gray300 }}>·</span>
      ),
  },
  { key: 'quantity', label: 'Qty', align: 'right', num: true, render: p => formatQty(p.quantity) },
  { key: 'avgEntryPrice', label: 'Entry', align: 'right', num: true, render: p => formatMoney(p.avgEntryPrice) },
  { key: 'currentPrice', label: 'Current', align: 'right', num: true, render: p => formatMoney(p.currentPrice) },
  { key: 'marketValue', label: 'Market Value', align: 'right', num: true, render: p => formatMoney(p.marketValue) },
  { key: 'unrealizedPL', label: 'Unrealized', align: 'right', num: true, pl: true, render: p => formatMoney(p.unrealizedPL, { showSign: true }) },
  { key: 'unrealizedPLPercent', label: '%', align: 'right', num: true, pl: true, render: p => formatPct(p.unrealizedPLPercent) },
];

const cell = {
  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
  fontSize: theme.typography.fontSize.sm,
  fontFamily: 'monospace',
  borderBottom: `1px solid ${theme.colors.gray100}`,
  whiteSpace: 'nowrap',
};

const headerCell = {
  ...cell,
  fontWeight: theme.typography.fontWeight.medium,
  fontSize: theme.typography.fontSize.xs,
  color: theme.colors.gray500,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontFamily: 'inherit',
  borderBottom: `2px solid ${theme.colors.gray200}`,
  backgroundColor: theme.colors.gray100,
  cursor: 'pointer',
  userSelect: 'none',
};

const OpenPositionsTable = ({ positions, loading, error, lastUpdated, onRefresh }) => {
  const [sortKey, setSortKey] = useState('marketValue');
  const [sortDir, setSortDir] = useState('desc'); // largest holdings first
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false); // top 10 by sort, or all
  const TOP_N = 10;

  const totals = useMemo(() => {
    if (!positions || positions.length === 0) return { unrealizedPL: 0, marketValue: 0 };
    return positions.reduce(
      (acc, p) => ({
        unrealizedPL: acc.unrealizedPL + (Number(p.unrealizedPL) || 0),
        marketValue: acc.marketValue + (Number(p.marketValue) || 0),
      }),
      { unrealizedPL: 0, marketValue: 0 }
    );
  }, [positions]);

  const sorted = useMemo(() => {
    const arr = [...(positions || [])];
    const col = COLUMNS.find(c => c.key === sortKey) || COLUMNS.find(c => c.key === 'marketValue');
    const val = p => (col.sortVal ? col.sortVal(p) : p[sortKey]);
    arr.sort((a, b) => {
      if (col.num) {
        const av = Number.isFinite(Number(val(a))) ? Number(val(a)) : -Infinity;
        const bv = Number.isFinite(Number(val(b))) ? Number(val(b)) : -Infinity;
        return av - bv;
      }
      return String(val(a) || '').localeCompare(String(val(b) || ''));
    });
    if (sortDir === 'desc') arr.reverse();
    return arr;
  }, [positions, sortKey, sortDir]);

  const visible = showAll ? sorted : sorted.slice(0, TOP_N);

  const onSort = key => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(COLUMNS.find(c => c.key === key)?.num ? 'desc' : 'asc');
    }
  };

  const hasPositions = positions && positions.length > 0;
  const totalColor =
    totals.unrealizedPL > 0 ? theme.colors.success : totals.unrealizedPL < 0 ? theme.colors.error : theme.colors.gray700;

  return (
    <div
      style={{
        marginBottom: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        border: `1px solid ${theme.colors.gray200}`,
        borderRadius: theme.borderRadius.md,
        overflow: 'hidden',
      }}
    >
      {/* Header — collapse toggle on the left, totals on the right */}
      <div
        style={{
          padding: `${theme.spacing.sm} ${theme.spacing.md}`,
          borderBottom: collapsed ? 'none' : `1px solid ${theme.colors.gray200}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.medium,
            color: theme.colors.gray700,
          }}
        >
          <span style={{ color: theme.colors.gray500, fontSize: '10px' }}>{collapsed ? '▸' : '▾'}</span>
          Open Positions
          {hasPositions && (
            <span style={{ color: theme.colors.gray500, fontWeight: theme.typography.fontWeight.normal }}>
              ({positions.length})
            </span>
          )}
        </button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.md }}>
          {hasPositions && (
            <div style={{ display: 'flex', gap: theme.spacing.md, fontSize: theme.typography.fontSize.sm, fontFamily: 'monospace' }}>
              <span style={{ color: theme.colors.gray500 }}>
                Value: <span style={{ color: theme.colors.gray700 }}>{formatMoney(totals.marketValue)}</span>
              </span>
              <span style={{ color: theme.colors.gray500 }}>
                Unrealized: <span style={{ color: totalColor, fontWeight: theme.typography.fontWeight.medium }}>{formatMoney(totals.unrealizedPL, { showSign: true })}</span>
              </span>
            </div>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Tap to refresh"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4, fontFamily: theme.typography.fontFamilyMono, fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}
            >
              {lastUpdated ? `${fmtET(lastUpdated)} ET` : ''}
              <span style={{ fontSize: '12px' }}>↻</span>
            </button>
          )}
        </div>
      </div>

      {collapsed ? null : error ? (
        <div style={{ padding: theme.spacing.md, color: theme.colors.error, fontSize: theme.typography.fontSize.sm }}>
          Positions unavailable: {String(error)}
        </div>
      ) : loading ? (
        <div style={{ padding: theme.spacing.md, color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm, fontFamily: 'monospace' }}>
          Loading positions…
        </div>
      ) : !hasPositions ? (
        <div style={{ padding: theme.spacing.md, color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm, fontStyle: 'italic' }}>
          No open positions
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => onSort(col.key)}
                    style={{ ...headerCell, textAlign: col.align }}
                    title="Click to sort"
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const pl = Number(p.unrealizedPL);
                const plColor = pl > 0 ? theme.colors.success : pl < 0 ? theme.colors.error : theme.colors.gray700;
                return (
                  <tr key={p.symbol}>
                    {COLUMNS.map(col => (
                      <td
                        key={col.key}
                        style={{
                          ...cell,
                          textAlign: col.align,
                          color: col.pl ? plColor : theme.colors.gray800,
                          fontWeight: col.key === 'symbol' ? theme.typography.fontWeight.medium : theme.typography.fontWeight.normal,
                        }}
                      >
                        {col.render(p)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.length > TOP_N && (
            <button
              onClick={() => setShowAll(s => !s)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderTop: `1px solid ${theme.colors.gray200}`,
                padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                color: theme.colors.gray600,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium,
                textAlign: 'left',
              }}
            >
              {showAll ? `▴ Show top ${TOP_N}` : `▾ Show all ${sorted.length} positions`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default memo(OpenPositionsTable);
