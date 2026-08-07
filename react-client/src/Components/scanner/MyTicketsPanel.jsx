import { useEffect, useState, useCallback, memo } from 'react';
import theme from '../../theme';
import PickDetailChart from '../charts/PickDetailChart';
import { betSentence, fmtMoney, fmtShortDate } from '../../utils/optionsPlainLanguage';

/**
 * Purchased tickets — real paper-account positions, auto-managed by the
 * hold-to-plan playbook (the one the ledger proved). Paid vs now, P&L,
 * planned exit, sell-now escape hatch, and click-through to the ticket's
 * own price action.
 */
const MyTicketsPanel = ({ refreshKey }) => {
  const [tickets, setTickets] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(() => {
    fetch('/api/scanner/options/tickets')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setTickets(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 45000);
    return () => clearInterval(id);
  }, [refresh, refreshKey]);

  const sellNow = async t => {
    if (!window.confirm(`Sell ${t.qty}x ${t.occSymbol} now at the market bid?\nCurrently ${t.nowValue != null ? `worth ~$${Math.round(t.nowValue)}` : 'unpriced'} (paid $${Math.round(t.paid)}).`)) return;
    setBusy(t.id);
    try {
      const res = await fetch(`/api/scanner/options/tickets/${encodeURIComponent(t.id)}/sell`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      refresh();
    } catch (err) {
      window.alert(`Sell failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  if (!tickets || (!tickets.open.length && !tickets.closed.length)) return null;

  const row = (t, isOpen) => (
    <div key={t.id || t.occSymbol}>
      <div
        onClick={() => setExpanded(e => (e === t.id ? null : t.id))}
        style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'baseline', fontSize: '0.76rem', padding: '5px 0', cursor: 'pointer', borderBottom: `1px solid ${theme.colors.gray100}` }}
      >
        <span>{t.status === 'closed' ? (t.pl >= 0 ? '✅' : '❌') : '🎟️'}</span>
        <span style={{ fontWeight: 600, color: theme.colors.charcoal }}>{betSentence(t.card)}</span>
        <span style={{ fontFamily: theme.typography.fontFamilyMono, color: theme.colors.gray500 }}>
          {t.qty}x · paid {fmtMoney(t.paid)}{!t.filled && isOpen ? ' (filling…)' : ''}
        </span>
        {t.nowValue != null && (
          <span style={{ fontFamily: theme.typography.fontFamilyMono, fontWeight: 700, color: t.pl >= 0 ? theme.colors.successMuted : theme.colors.errorMuted }}>
            {isOpen ? 'now' : 'sold'} {fmtMoney(t.nowValue)} ({t.pl >= 0 ? '+' : ''}{fmtMoney(t.pl)}, {t.plPct >= 0 ? '+' : ''}{Math.round(t.plPct * 100)}%)
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono }}>
          {isOpen
            ? `auto-sells ${fmtShortDate(t.planExitDate)}`
            : `${t.exitReason || 'closed'} · ${fmtShortDate((t.soldAt || t.boughtAt).slice(0, 10))}`}
        </span>
        {isOpen && t.status === 'open' && (
          <button
            onClick={e => { e.stopPropagation(); sellNow(t); }}
            disabled={busy === t.id}
            style={{ padding: '3px 10px', fontSize: '0.68rem', fontWeight: 700, color: theme.colors.errorMuted, background: 'transparent', border: `1px solid ${theme.colors.errorMuted}`, borderRadius: theme.borderRadius.xs, cursor: 'pointer' }}
          >
            {busy === t.id ? '…' : 'Sell now'}
          </button>
        )}
        <span style={{ color: theme.colors.gray500 }}>{expanded === t.id ? '▾' : '▸'}</span>
      </div>
      {expanded === t.id && <PickDetailChart pickId={t.pickId} />}
    </div>
  );

  const totalOpenPl = tickets.open.reduce((s, t) => s + (t.pl || 0), 0);

  return (
    <div style={{ background: theme.colors.paper, border: `1px solid ${theme.colors.ruler}`, borderRadius: theme.borderRadius.xs, padding: theme.spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.sm, marginBottom: theme.spacing.xs }}>
        <span style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.14em', color: theme.colors.gray500, textTransform: 'uppercase' }}>
          My tickets
        </span>
        {tickets.open.length > 0 && (
          <span style={{ fontSize: '0.74rem', fontFamily: theme.typography.fontFamilyMono, fontWeight: 700, color: totalOpenPl >= 0 ? theme.colors.successMuted : theme.colors.errorMuted }}>
            {tickets.open.length} open · {totalOpenPl >= 0 ? '+' : ''}{fmtMoney(totalOpenPl)}
          </span>
        )}
        <span style={{ fontSize: '0.68rem', color: theme.colors.gray500 }}>
          managed for you: each ticket auto-sells on its plan date (no stop-outs — that playbook lost)
        </span>
        {tickets.closed.length > 0 && (
          <button
            onClick={() => setShowClosed(s => !s)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: '0.7rem', color: theme.colors.gray600, cursor: 'pointer', textDecoration: 'underline dotted' }}
          >
            {showClosed ? 'hide' : 'show'} {tickets.closed.length} closed
          </button>
        )}
      </div>
      {tickets.open.map(t => row(t, true))}
      {showClosed && tickets.closed.map(t => row(t, false))}
    </div>
  );
};

export default memo(MyTicketsPanel);
