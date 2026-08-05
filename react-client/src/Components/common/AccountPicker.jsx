import { useState, useEffect } from 'react';
import { useAccountView } from '../../contexts/AccountViewContext';
import theme from '../../theme';

const fmtMoney = v =>
  v == null || isNaN(v)
    ? '—'
    : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Signed dollar with a true minus, for the day-P&L glance.
const fmtSigned = v => {
  const n = Number(v) || 0;
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${n < 0 ? '−' : '+'}$${abs}`;
};

/**
 * AccountPicker — the global account dropdown (lives in the NavBar).
 *
 * Paper accounts render amber; the live account renders red with an explicit
 * REAL MONEY label — the paper/real distinction must be unmissable at a
 * glance. Selecting an account changes what every account-scoped page shows
 * (it is a view filter only; it never changes how anything trades).
 */
const KIND_STYLE = {
  paper: {
    bg: 'rgba(255, 193, 7, 0.25)',
    border: '#ffc107',
    text: '#ffc107',
    tag: 'PAPER',
  },
  live: {
    bg: 'rgba(220, 53, 69, 0.30)',
    border: '#dc3545',
    text: '#ff6b78',
    tag: 'REAL MONEY',
  },
};

const AccountPicker = () => {
  const { account, accounts, setAccountId } = useAccountView();
  const [open, setOpen] = useState(false);
  // Per-account { equity, dayPnl, dayPnlPct } — fetched when the dropdown opens
  // so each row shows a glanceable value + today's P&L.
  const [balances, setBalances] = useState({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    accounts
      .filter(a => a.configured)
      .forEach(a => {
        fetch(`/api/alpaca/account?mode=${a.id}`)
          .then(r => (r.ok ? r.json() : null))
          .then(j => {
            if (cancelled || !j) return;
            const acct = j.account || j;
            const eq = parseFloat(acct.equity ?? acct.portfolio_value);
            const le = parseFloat(acct.last_equity);
            // Only show a day P&L when there's a real prior-close mark (Alpaca
            // returns last_equity "0" on accounts that haven't closed yet —
            // don't render the whole equity as "today's P&L").
            const dayPnl =
              Number.isFinite(eq) && Number.isFinite(le) && le > 0
                ? eq - le
                : null;
            setBalances(prev => ({
              ...prev,
              [a.id]: {
                equity: Number.isFinite(eq) ? eq : null,
                dayPnl,
                dayPnlPct: dayPnl != null ? (dayPnl / le) * 100 : null,
              },
            }));
          })
          .catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, [open, accounts]);

  if (!account) return null;
  const style = KIND_STYLE[account.kind] || KIND_STYLE.paper;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        title="Which account the site is showing (view only — does not change how anything trades)"
        style={{
          background: style.bg,
          border: `1px solid ${style.border}`,
          color: '#ffffff',
          padding: '6px 12px',
          borderRadius: theme.borderRadius.md,
          cursor: 'pointer',
          fontSize: theme.typography.fontSize.sm,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.5px',
            color: style.text,
            border: `1px solid ${style.border}`,
            borderRadius: '4px',
            padding: '1px 5px',
          }}
        >
          {style.tag}
        </span>
        <span style={{ fontWeight: 600 }}>
          {account.label.replace(/^(Paper|Live) — /, '')}
        </span>
        <span
          style={{
            fontSize: '10px',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            backgroundColor: theme.colors.surface,
            borderRadius: theme.borderRadius.md,
            boxShadow: theme.shadows.lg,
            minWidth: '320px',
            overflow: 'hidden',
            zIndex: 1200,
          }}
          onMouseLeave={() => setOpen(false)}
        >
          {accounts.map(a => {
            const s = KIND_STYLE[a.kind] || KIND_STYLE.paper;
            const selected = a.id === account.id;
            return (
              <button
                key={a.id}
                disabled={!a.configured}
                onClick={() => {
                  setAccountId(a.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 12px',
                  background: selected ? theme.colors.gray100 : 'transparent',
                  border: 'none',
                  borderLeft: `3px solid ${selected ? s.border : 'transparent'}`,
                  cursor: a.configured ? 'pointer' : 'not-allowed',
                  opacity: a.configured ? 1 : 0.45,
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 800,
                    letterSpacing: '0.5px',
                    color: a.kind === 'live' ? '#dc3545' : '#b8860b',
                    border: `1px solid ${s.border}`,
                    borderRadius: '4px',
                    padding: '1px 4px',
                    flexShrink: 0,
                  }}
                >
                  {s.tag}
                </span>
                <span style={{ flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      color: theme.colors.text,
                      fontSize: theme.typography.fontSize.sm,
                      fontWeight: selected ? 700 : 500,
                    }}
                  >
                    {a.label.replace(/^(Paper|Live) — /, '')}
                  </span>
                  {a.accountNumber && (
                    <span
                      style={{
                        display: 'block',
                        color: theme.colors.textMuted || '#888',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                      }}
                    >
                      {a.accountNumber}
                    </span>
                  )}
                </span>
                {a.configured && (
                  <span
                    style={{
                      textAlign: 'right',
                      flexShrink: 0,
                      fontFamily: 'monospace',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontWeight: 700,
                        fontSize: theme.typography.fontSize.sm,
                        color: theme.colors.text,
                      }}
                    >
                      {balances[a.id] ? fmtMoney(balances[a.id].equity) : '···'}
                    </span>
                    {balances[a.id] && balances[a.id].dayPnl != null && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: '11px',
                          color:
                            balances[a.id].dayPnl >= 0
                              ? theme.colors.success
                              : theme.colors.error,
                        }}
                      >
                        {fmtSigned(balances[a.id].dayPnl)} (
                        {balances[a.id].dayPnlPct >= 0 ? '+' : ''}
                        {balances[a.id].dayPnlPct.toFixed(2)}%)
                      </span>
                    )}
                  </span>
                )}
                {selected && (
                  <span
                    style={{ color: s.border, fontWeight: 700, marginLeft: 4 }}
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
          <div
            style={{
              padding: '8px 12px',
              fontSize: '10px',
              color: theme.colors.textMuted || '#888',
              borderTop: `1px solid ${theme.colors.gray100}`,
            }}
          >
            View filter only — switching accounts never changes how brokers
            trade.
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountPicker;
