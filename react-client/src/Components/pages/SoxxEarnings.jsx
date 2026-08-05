import { useState, useEffect, useMemo, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';

// Earnings across SOXX constituents (from Unusual Whales via /api/soxx/earnings):
// upcoming reports (with expected move) tell you what's coming; recent reactions
// (with the actual 1-day move + beat/miss) tell you how the group has been
// digesting results. Both are leading context for SOXX/SOXL/SOXS direction.
const REFRESH_MS = 5 * 60 * 1000; // earnings change slowly; route caches 1h
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pctColor = pct =>
  pct == null ? theme.colors.gray500 : pct >= 0 ? theme.colors.success : theme.colors.error;

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

const timeTag = t =>
  t === 'premarket' ? 'pre' : t === 'postmarket' ? 'post' : '';

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

const SoxxEarnings = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

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

  const upcoming = useMemo(() => (data?.upcoming || []).slice(0, 8), [data]);
  const past = useMemo(() => (data?.past || []).slice(0, 8), [data]);
  const pastSummary = useMemo(() => {
    const rx = (data?.past || []).map(p => p.reaction1d).filter(v => v != null);
    const up = rx.filter(v => v > 0).length;
    const down = rx.filter(v => v < 0).length;
    return rx.length ? { up, down, n: rx.length } : null;
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
          {/* Upcoming — soonest reports first, with UW expected move */}
          <Section label="Upcoming reports">
            {upcoming.length === 0 ? (
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>none scheduled</div>
            ) : (
              <div style={{ display: 'grid', gap: 3 }}>
                {upcoming.map(e => {
                  const { label, days } = parseDate(e.date);
                  const soon = days != null && days <= 5;
                  return (
                    <div key={e.sym} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 70px 62px', gap: 8, alignItems: 'baseline', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                      <span style={{ fontWeight: 700, color: theme.colors.gray800 }}>{e.sym}</span>
                      <span style={{ color: soon ? theme.colors.warningDark : theme.colors.gray600 }}>
                        {label}
                        <span style={{ color: theme.colors.gray400, marginLeft: 5 }}>{relLabel(days)}{e.estimated ? '*' : ''}</span>
                      </span>
                      <span style={{ color: theme.colors.gray400, textAlign: 'right' }}>{timeTag(e.time)}</span>
                      <span style={{ textAlign: 'right', color: theme.colors.gray700 }} title="expected move (options-implied)">
                        {e.expectedMovePct != null ? `±${e.expectedMovePct.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Recent reactions — how the group has been digesting results */}
          <Section
            label="Recent reactions"
            right={
              pastSummary && (
                <span style={{ fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                  <span style={{ color: theme.colors.success, fontWeight: 700 }}>{pastSummary.up}▲</span>
                  {' / '}
                  <span style={{ color: theme.colors.error, fontWeight: 700 }}>{pastSummary.down}▼</span>
                  <span style={{ color: theme.colors.gray400 }}> of {pastSummary.n}</span>
                </span>
              )
            }
          >
            {past.length === 0 ? (
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>no recent reports</div>
            ) : (
              <div style={{ display: 'grid', gap: 3 }}>
                {past.map(e => {
                  const { label, days } = parseDate(e.date);
                  return (
                    <div key={e.sym} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 66px 58px', gap: 8, alignItems: 'baseline', fontFamily: 'monospace', fontSize: theme.typography.fontSize.xs }}>
                      <span style={{ fontWeight: 700, color: theme.colors.gray800 }}>{e.sym}</span>
                      <span style={{ color: theme.colors.gray500 }}>
                        {label}
                        <span style={{ color: theme.colors.gray400, marginLeft: 5 }}>{agoLabel(days)}</span>
                      </span>
                      <span style={{ textAlign: 'right', color: pctColor(e.reaction1d), fontWeight: 700 }}>
                        {e.reaction1d == null ? '—' : `${e.reaction1d >= 0 ? '+' : ''}${e.reaction1d.toFixed(1)}%`}
                      </span>
                      <span
                        style={{ textAlign: 'right', color: e.beat == null ? theme.colors.gray400 : e.beat ? theme.colors.success : theme.colors.error }}
                        title="EPS vs street estimate"
                      >
                        {e.beat == null ? '' : e.beat ? 'beat' : 'miss'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <div style={{ fontSize: '10px', color: theme.colors.gray400, fontFamily: 'monospace' }}>
            reaction = 1-day move after report · expected move = options-implied · * = est. date
          </div>
        </>
      )}
    </Card>
  );
};

export default memo(SoxxEarnings);
