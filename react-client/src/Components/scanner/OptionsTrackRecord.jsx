import { useEffect, useState, memo } from 'react';
import theme from '../../theme';
import { betSentence, fmtMoney, fmtShortDate } from '../../utils/optionsPlainLanguage';

/**
 * Past performance of the scanner's recommendations — the honest W/L ledger.
 * Every card ever surfaced is recorded and graded against what actually
 * happened; this panel is why you can (or can't) trust the cards.
 */
const OptionsTrackRecord = ({ refreshKey }) => {
  const [report, setReport] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/scanner/options/track-record?limit=25')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data?.summary) setReport(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!report) return null;
  const s = report.summary;

  const headline = s.graded > 0
    ? <>
        <strong style={{ color: theme.colors.charcoal }}>{s.wins}W / {s.losses}L</strong>
        {' '}({Math.round(s.winRate * 100)}% win rate) · avg {s.avgReturnPct >= 0 ? '+' : ''}{Math.round(s.avgReturnPct * 100)}% per bet
        {s.calibration && (
          <> · we predicted {Math.round(s.calibration.predictedWinRate * 100)}%, reality {Math.round(s.calibration.realizedWinRate * 100)}%</>
        )}
      </>
    : <>
        {s.totalPicks} picks on the record, none graded yet
        {s.nextGradeDate && <> — first results land after {fmtShortDate(s.nextGradeDate)}</>}
      </>;

  return (
    <div style={{
      background: theme.colors.paper,
      border: `1px solid ${theme.colors.ruler}`,
      borderRadius: theme.borderRadius.xs,
      padding: `${theme.spacing.xs} ${theme.spacing.md}`,
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.sm, cursor: 'pointer', fontSize: '0.78rem', color: theme.colors.gray600 }}
      >
        <span style={{ fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: '0.66rem', color: theme.colors.gray500 }}>
          Past performance
        </span>
        <span>{headline}</span>
        {s.open > 0 && <span style={{ color: theme.colors.gray500 }}>· {s.open} still open</span>}
        <span style={{ marginLeft: 'auto', color: theme.colors.gray500 }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: theme.spacing.xs, borderTop: `1px solid ${theme.colors.gray200}`, paddingTop: theme.spacing.xs }}>
          {s.playbooks && (
            <div style={{
              fontSize: '0.74rem',
              color: theme.colors.gray700,
              background: theme.colors.parchment,
              border: `1px solid ${theme.colors.gray200}`,
              borderRadius: theme.borderRadius.xs,
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              marginBottom: theme.spacing.xs,
            }}>
              <strong style={{ color: theme.colors.charcoal }}>Playbook test</strong> — same {s.playbooks.comparablePicks} picks graded two ways:{' '}
              sell on stops {Math.round(s.playbooks.withStops.winRate * 100)}% win, avg {s.playbooks.withStops.avgReturnPct >= 0 ? '+' : ''}{Math.round(s.playbooks.withStops.avgReturnPct * 100)}%
              {' · '}hold to plan {Math.round(s.playbooks.holdToPlan.winRate * 100)}% win, avg {s.playbooks.holdToPlan.avgReturnPct >= 0 ? '+' : ''}{Math.round(s.playbooks.holdToPlan.avgReturnPct * 100)}%.
              {' '}<strong style={{ color: theme.colors.charcoal }}>{s.playbooks.verdict}</strong>
            </div>
          )}
          {report.picks.slice(0, 15).map(p => {
            const graded = p.status === 'win' || p.status === 'loss';
            const pct = graded ? p.exit.returnPct : p.openMark?.returnPct;
            return (
              <div key={p.id} style={{ display: 'flex', gap: theme.spacing.sm, fontSize: '0.74rem', padding: '3px 0', alignItems: 'baseline' }}>
                <span>{p.status === 'win' ? '✅' : p.status === 'loss' ? '❌' : '⏳'}</span>
                <span style={{ color: theme.colors.charcoal, fontWeight: 600 }}>{betSentence(p.card)}</span>
                <span style={{ color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono }}>
                  in {fmtMoney(p.card.costPerContract)} · {fmtShortDate(p.recordedAt.slice(0, 10))}
                </span>
                <span style={{
                  marginLeft: 'auto',
                  fontFamily: theme.typography.fontFamilyMono,
                  fontWeight: 700,
                  color: pct == null ? theme.colors.gray500 : pct >= 0 ? theme.colors.successMuted : theme.colors.errorMuted,
                }}>
                  {graded
                    ? `${p.exit.exitReason === 'targetHit' ? 'target hit' : p.exit.exitReason === 'stopHit' ? 'stopped' : 'plan exit'} ${pct >= 0 ? '+' : ''}${Math.round(pct * 100)}%${p.exitHold ? ` · held ${p.exitHold.returnPct >= 0 ? '+' : ''}${Math.round(p.exitHold.returnPct * 100)}%` : ''}`
                    : pct != null
                      ? `so far ${pct >= 0 ? '+' : ''}${Math.round(pct * 100)}%`
                      : `grades after ${fmtShortDate(p.planExitDate)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default memo(OptionsTrackRecord);
