import { useState, useEffect, useRef, memo, useMemo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';

const FILTERS = {
  ALL:     { label: 'All',     match: () => true },
  SIGNALS: { label: 'Signals', match: l => l.level === 'SIGNAL' || /STRATEGY_MATCH|ORB|BUY|SELL|EXIT|ENTRY/i.test(l.message || '') },
  FILTERS: { label: 'Filters', match: l => /filter blocked|F1|F2|Skipping|Cannot enter|Counter-trend/i.test(l.message || '') },
  TRADES:  { label: 'Trades',  match: l => l.level === 'EXEC' || /BUY \d|SELL \d/i.test(l.message || '') },
  RISK:    { label: 'Risk',    match: l => l.level === 'RISK' || l.level === 'ALERT' || l.level === 'ERROR' },
};

const LEVEL_COLOR = {
  SIGNAL: theme.colors.info,
  EXEC:   theme.colors.success,
  RISK:   theme.colors.error,
  ALERT:  theme.colors.error,
  ERROR:  theme.colors.error,
  INFO:   theme.colors.gray600,
  DECISION: theme.colors.info,
  ENTRY:  '#17a2b8',
  EXIT:   theme.colors.warning,
};

const fmtTime = ts => (ts ? new Date(ts).toLocaleTimeString('en-US', { hour12: false }) : '--:--:--');

const SignalActivityPanel = ({ logs }) => {
  const [active, setActive] = useState('ALL');
  const scrollRef = useRef(null);

  const filtered = useMemo(() => {
    const f = FILTERS[active] || FILTERS.ALL;
    return (logs || []).filter(f.match);
  }, [logs, active]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll to bottom if the user is already there (within
    // 60px of the end). Avoids the annoyance of getting yanked back to
    // the bottom every 5s when they've scrolled up to read older entries.
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isAtBottom) el.scrollTop = el.scrollHeight;
  }, [filtered]);

  const tally = useMemo(() => {
    const out = {};
    for (const key of Object.keys(FILTERS)) {
      out[key] = (logs || []).filter(FILTERS[key].match).length;
    }
    return out;
  }, [logs]);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
        <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
          Signal Activity
        </h3>
        <div style={{ display: 'flex', gap: 4 }}>
          {Object.entries(FILTERS).map(([key, f]) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              style={{
                padding: '4px 10px',
                fontSize: theme.typography.fontSize.xs,
                fontWeight: active === key ? 700 : 500,
                color: active === key ? '#fff' : theme.colors.gray700,
                background: active === key ? theme.colors.primary : theme.colors.gray100,
                border: 'none',
                borderRadius: 12,
                cursor: 'pointer',
              }}
            >
              {f.label} {tally[key] > 0 ? `(${tally[key]})` : ''}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={scrollRef}
        style={{
          height: 240,
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: theme.typography.fontSize.xs,
          background: theme.colors.gray100,
          borderRadius: 4,
          padding: theme.spacing.sm,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: theme.colors.gray500, padding: theme.spacing.md, textAlign: 'center' }}>
            no matching events yet
          </div>
        ) : (
          filtered.slice(-200).map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
              <span style={{ color: theme.colors.gray500, flexShrink: 0 }}>{fmtTime(l.timestamp)}</span>
              <span style={{ color: LEVEL_COLOR[l.level] || theme.colors.gray700, fontWeight: 600, minWidth: 60, flexShrink: 0 }}>
                {l.level}
              </span>
              {l.session && (
                <span style={{ color: theme.colors.gray600, minWidth: 110, flexShrink: 0 }}>
                  {String(l.session).slice(0, 16)}
                </span>
              )}
              <span style={{ color: theme.colors.gray900, flex: 1, wordBreak: 'break-word' }}>{l.message}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

export default memo(SignalActivityPanel);
