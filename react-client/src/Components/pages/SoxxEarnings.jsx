import { useState, useEffect, useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';

// Earnings across SOXX constituents (from Unusual Whales via /api/soxx/earnings):
// upcoming reports (with expected move) tell you what's coming; recent reactions
// (with the actual 1-day move + beat/miss) tell you how the group has been
// digesting results. Both are leading context for SOXX/SOXL/SOXS direction.
//
// Full-width card: each row also carries ~market cap (approx, no live shares
// source) and price — current for upcoming, at-report-time for past.
const REFRESH_MS = 5 * 60 * 1000; // earnings change slowly; route caches 1h
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pctColor = pct =>
  pct == null ? theme.colors.gray500 : pct >= 0 ? theme.colors.success : theme.colors.error;

const fmtMcap = b =>
  b == null || !Number.isFinite(b) ? '—' : b >= 1000 ? `~$${(b / 1000).toFixed(1)}T` : `~$${Math.round(b)}B`;
const fmtPrice = p => (p == null || !Number.isFinite(p) ? '—' : `$${p.toFixed(2)}`);
const priceFromQuote = q => {
  if (!q) return null;
  const v = Number(q.last ?? q.close ?? q.price);
  return Number.isFinite(v) ? v : null;
};

// "2026-08-26" -> { label: "Aug 26", days: N-from-today }
const parseDate = iso => {
  if (!iso) return { label: '—', days: null };
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return { label: iso, days: null };
  const dt = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return { label: `${MONTHS[m - 1]} ${d}`, days: Math.round((dt - today) / 86400000) };
};

const relLabel = days =>
  days == null ? '' : days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;
const agoLabel = days =>
  days == null ? '' : days === 0 ? 'today' : days === -1 ? '1d ago' : `${-days}d ago`;

const timeTag = t => (t === 'premarket' ? 'pre' : t === 'postmarket' ? 'post' : '');

const UP_COLS = '46px 60px 58px minmax(0,1fr) 54px 34px 54px';
const PAST_COLS = '46px 60px 58px minmax(0,1fr) 54px 38px 72px';

// Signed % with sign, colored. e.g. "+25%" / "-6.7%".
const fmtSignedPct = (v, dp = 0) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`;

const colHeadStyle = {
  fontSize: '9px',
  color: theme.colors.gray400,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontFamily: 'monospace',
};

const Section = ({ label, right, children }) => (
  <div style={{ marginBottom: theme.spacing.md }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      {right}
    </div>
    {children}
  </div>
);

const SoxxEarnings = ({ quotes = {} }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchEarnings = async () => {
      try {
        const res = await fetch('/api/soxx/earnings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    fetchEarnings();
    const id = setInterval(fetchEarnings, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const COLLAPSED = 6;
  const upcomingAll = data?.upcoming || [];
  const pastAll = data?.past || [];
  const upcoming = expanded ? upcomingAll : upcomingAll.slice(0, COLLAPSED);
  const past = expanded ? pastAll : pastAll.slice(0, COLLAPSED);
  const canExpand = upcomingAll.length > COLLAPSED || pastAll.length > COLLAPSED;
  const priceNow = sym => priceFromQuote(quotes[sym]);

  const pastSummary = useMemo(() => {
    const rows = (data?.past || []).filter(p => p.reaction1d != null);
    const up = rows.filter(p => p.reaction1d > 0).length;
    const down = rows.filter(p => p.reaction1d < 0).length;
    // "diverged" = the market reaction contradicted the EPS beat/miss
    const diverged = rows.filter(
      p => p.beat != null && ((p.beat && p.reaction1d < 0) || (!p.beat && p.reaction1d > 0))
    ).length;
    return rows.length ? { up, down, n: rows.length, diverged } : null;
  }, [data]);

  const loading = !data && !error;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          SOXX Earnings
        </h3>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: 'monospace' }}>
          {loading ? 'loading…' : error ? 'unavailable' : data?.asOf ? `${fmtET(new Date(data.asOf))} ET` : ''}
        </div>
      </div>

      {error ? (
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          Earnings feed unavailable ({error}).
        </div>
      ) : loading ? (
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
          loading earnings…
        </div>
      ) : (
        <>
          {/* Two columns on wide screens: upcoming | recent reactions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: theme.spacing.lg }}>
            {/* Upcoming — current mcap + current price */}
            <Section label="Upcoming reports">
              {upcoming.length === 0 ? (
                <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>none scheduled</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: UP_COLS, gap: 8, marginBottom: 3, ...colHeadStyle }}>
                    <span>Ticker</span>
                    <span>Mkt cap</span>
                    <span style={{ textAlign: 'right' }}>Price</span>
                    <span>Date</span>
                    <span style={{ textAlign: 'right' }} title="run-up so far (~1 month)">1mo</span>
                    <span style={{ textAlign: 'right' }}>Time</span>
                    <span style={{ textAlign: 'right' }}>±Move</span>
                  </div>
                  <div style={{ display: 'grid', gap: 3 }}>
                    {upcoming.map(e => {
                      const { label, days } = parseDate(e.date);
                      const soon = days != null && days <= 5;
                      return (
                        <div key={e.sym} style={{ display: 'grid', gridTemplateColumns: UP_COLS, gap: 8, alignItems: 'baseline', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                          <span style={{ fontWeight: 700, color: theme.colors.gray800 }}>{e.sym}</span>
                          <span style={{ color: theme.colors.gray500 }} title="approx current market cap">{fmtMcap(e.mcapB)}</span>
                          <span style={{ textAlign: 'right', color: theme.colors.gray700 }} title="current price">{fmtPrice(priceNow(e.sym))}</span>
                          <span style={{ color: soon ? theme.colors.warningDark : theme.colors.gray600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {label}
                            <span style={{ color: theme.colors.gray400, marginLeft: 5 }}>{relLabel(days)}{e.estimated ? '*' : ''}</span>
                          </span>
                          <span style={{ textAlign: 'right', color: pctColor(e.runupSoFar), fontWeight: 600 }} title="price change over the last ~1 month (run-up into the report)">
                            {fmtSignedPct(e.runupSoFar)}
                          </span>
                          <span style={{ color: theme.colors.gray400, textAlign: 'right' }}>{timeTag(e.time)}</span>
                          <span style={{ textAlign: 'right', color: theme.colors.gray700 }} title="expected move (options-implied)">
                            {e.expectedMovePct != null ? `±${e.expectedMovePct.toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </Section>

            {/* Recent reactions — mcap + price AT REPORT TIME */}
            <Section
              label="Recent reactions"
              right={
                pastSummary && (
                  <span style={{ fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                    <span style={{ color: theme.colors.success, fontWeight: 700 }}>{pastSummary.up}▲</span>
                    {' / '}
                    <span style={{ color: theme.colors.error, fontWeight: 700 }}>{pastSummary.down}▼</span>
                    <span style={{ color: theme.colors.gray400 }}> of {pastSummary.n}</span>
                    {pastSummary.diverged > 0 && (
                      <span style={{ color: theme.colors.warningDark }} title="market reaction diverged from the EPS beat/miss">
                        {' '}· {pastSummary.diverged}≠
                      </span>
                    )}
                  </span>
                )
              }
            >
              {past.length === 0 ? (
                <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>no recent reports</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: PAST_COLS, gap: 8, marginBottom: 3, ...colHeadStyle }}>
                    <span>Ticker</span>
                    <span title="market cap at report time (approx)">Mkt cap</span>
                    <span style={{ textAlign: 'right' }} title="price at report time">Price</span>
                    <span>Date</span>
                    <span style={{ textAlign: 'right' }} title="run-up into the report (~1 month before)">1mo</span>
                    <span style={{ textAlign: 'center' }}>EPS</span>
                    <span style={{ textAlign: 'right' }}>React</span>
                  </div>
                  <div style={{ display: 'grid', gap: 3 }}>
                    {past.map(e => {
                      const { label, days } = parseDate(e.date);
                      const r = e.reaction1d;
                      const pNow = priceNow(e.sym);
                      // Approx mcap at that time = current mcap scaled by the
                      // price ratio (shares ~constant over a quarter).
                      const mcapThen =
                        e.mcapB != null && e.priceThen != null && pNow
                          ? e.mcapB * (e.priceThen / pNow)
                          : e.mcapB;
                      const diverged = e.beat != null && r != null && ((e.beat && r < 0) || (!e.beat && r > 0));
                      const bigMove = e.expectedMovePct != null && r != null && Math.abs(r) > e.expectedMovePct;
                      return (
                        <div key={e.sym} style={{ display: 'grid', gridTemplateColumns: PAST_COLS, gap: 8, alignItems: 'baseline', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                          <span style={{ fontWeight: 700, color: theme.colors.gray800 }}>{e.sym}</span>
                          <span style={{ color: theme.colors.gray500 }} title="approx market cap at report time">{fmtMcap(mcapThen)}</span>
                          <span style={{ textAlign: 'right', color: theme.colors.gray700 }} title="price at report time">{fmtPrice(e.priceThen)}</span>
                          <span style={{ color: theme.colors.gray500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {label}
                            <span style={{ color: theme.colors.gray400, marginLeft: 5 }}>{agoLabel(days)}</span>
                          </span>
                          <span style={{ textAlign: 'right', color: pctColor(e.runupPct), fontWeight: 600 }} title="run-up into the report (~1 month price change before)">
                            {fmtSignedPct(e.runupPct)}
                          </span>
                          <span
                            style={{ textAlign: 'center', color: e.beat == null ? theme.colors.gray400 : e.beat ? theme.colors.success : theme.colors.error }}
                            title="EPS vs street estimate"
                          >
                            {e.beat == null ? '—' : e.beat ? 'beat' : 'miss'}
                          </span>
                          <span
                            style={{ textAlign: 'right', fontWeight: 700, color: pctColor(r) }}
                            title={
                              [
                                r != null && e.expectedMovePct != null
                                  ? `1-day reaction ${fmtSignedPct(r, 1)} vs ±${e.expectedMovePct.toFixed(1)}% implied (${bigMove ? 'bigger' : 'smaller'} than expected)`
                                  : 'market 1-day reaction',
                                e.runupPct != null ? `ran ${fmtSignedPct(e.runupPct, 1)} into the report` : null,
                                e.postMove1w != null ? `${fmtSignedPct(e.postMove1w, 1)} over the following week` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            }
                          >
                            {r == null ? '—' : `${r >= 0 ? '▲ +' : '▼ '}${r.toFixed(1)}%`}
                            {diverged && (
                              <span style={{ color: theme.colors.warningDark, marginLeft: 3 }} title={e.beat ? 'beat but sold off' : 'missed but rallied'}>
                                ≠
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </Section>
          </div>

          {canExpand && (
            <button
              onClick={() => setExpanded(x => !x)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderTop: `1px solid ${theme.colors.gray200}`,
                paddingTop: theme.spacing.sm,
                marginBottom: 6,
                color: theme.colors.gray600,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium,
                textAlign: 'left',
              }}
            >
              {expanded
                ? '▴ Show less'
                : `▾ Show full calendar (${upcomingAll.length} upcoming · ${pastAll.length} past)`}
            </button>
          )}

          <div style={{ fontSize: '10px', color: theme.colors.gray400, fontFamily: 'monospace' }}>
            ~mcap = approx (no live shares) · past = value at report time · 1mo = run-up into the report · beat/miss = EPS vs estimate · ▲▼% = 1-day reaction (hover for 1-week) · ≠ = diverged · * = est. date
          </div>
        </>
      )}
    </Card>
  );
};

export default memo(SoxxEarnings);
