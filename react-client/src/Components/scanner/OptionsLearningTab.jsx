import { useEffect, useRef, useState, memo } from 'react';
import { Chart, registerables } from 'chart.js';
import theme from '../../theme';
import PickDetailChart from '../charts/PickDetailChart';
import { betSentence, fmtMoney, fmtShortDate } from '../../utils/optionsPlainLanguage';

Chart.register(...registerables);

/**
 * The honest scoreboard. Everything renders from the immutable pick ledger
 * via /api/scanner/options/track-record[/timeline] — the same computation
 * that feeds the daily Telegram, so the two can never disagree. Default
 * window is ALL history; every stat carries its pick-N and cluster-N.
 */

const panelStyle = {
  background: theme.colors.paper,
  border: `1px solid ${theme.colors.ruler}`,
  borderRadius: theme.borderRadius.xs,
  padding: theme.spacing.md,
};

const titleStyle = {
  fontSize: '0.66rem',
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: theme.colors.gray500,
  textTransform: 'uppercase',
  marginBottom: theme.spacing.sm,
};

/** Two cumulative "$100 per ticket" curves — the playbooks racing. */
const CurvesChart = ({ curves }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !curves.holdToPlan.length) return undefined;
    if (chartRef.current) chartRef.current.destroy();

    const labels = curves.holdToPlan.map(d => d.date.slice(5));
    const stopsByDate = new Map(curves.withStops.map(d => [d.date, d.cumulativePer100]));
    let lastStops = 0;
    const stopsAligned = curves.holdToPlan.map(d => {
      if (stopsByDate.has(d.date)) lastStops = stopsByDate.get(d.date);
      return lastStops;
    });

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Hold to plan (no stops)',
            data: curves.holdToPlan.map(d => d.cumulativePer100),
            borderColor: theme.colors.successMuted,
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.15,
            pointRadius: 2,
          },
          {
            label: 'Sell on stops',
            data: stopsAligned,
            borderColor: theme.colors.gray500,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 4],
            tension: 0.15,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { boxWidth: 18, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}$${Math.round(ctx.parsed.y).toLocaleString()}`,
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: v => `$${Math.round(v).toLocaleString()}`, font: { size: 10 } },
            title: { display: true, text: 'Cumulative P&L, $100 on every pick', font: { size: 10 } },
          },
          x: { ticks: { font: { size: 10 } }, title: { display: true, text: 'Exit date', font: { size: 10 } } },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [curves]);

  return <div style={{ height: 280 }}><canvas ref={canvasRef} /></div>;
};

/** Predicted vs realized win rate per entry day — the honesty gap. */
const CalibrationBars = ({ days }) => {
  if (!days.length) return null;
  return (
    <div style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'flex-end', overflowX: 'auto', paddingBottom: 4 }}>
      {days.map(d => (
        <div key={d.day} style={{ textAlign: 'center', minWidth: 56 }}>
          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', justifyContent: 'center', height: 110 }}>
            <div
              title={`Predicted ${Math.round(d.predicted * 100)}%`}
              style={{
                width: 16,
                height: `${Math.max(d.predicted * 100, 2)}%`,
                border: `1.5px dashed ${theme.colors.gray400}`,
                borderRadius: '2px 2px 0 0',
              }}
            />
            <div
              title={`Realized ${Math.round(d.realized * 100)}%${d.partial ? ' (partial — losers grade first)' : ''}`}
              style={{
                width: 16,
                height: `${Math.max(d.realized * 100, 2)}%`,
                background: d.realized >= d.predicted ? theme.colors.successMuted : theme.colors.errorMuted,
                opacity: d.partial ? 0.45 : 0.9,
                borderRadius: '2px 2px 0 0',
              }}
            />
          </div>
          <div style={{ fontSize: '0.62rem', color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono, marginTop: 3 }}>
            {d.day.slice(5)}{d.partial ? '*' : ''}
          </div>
          <div style={{ fontSize: '0.62rem', color: theme.colors.gray600, fontFamily: theme.typography.fontFamilyMono }}>
            {Math.round(d.predicted * 100)}→{Math.round(d.realized * 100)}
          </div>
        </div>
      ))}
    </div>
  );
};

const SliceTable = ({ title, rows }) => (
  <div>
    <div style={{ ...titleStyle, marginBottom: 4 }}>{title}</div>
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <tbody>
        {rows.filter(r => r.graded > 0).map(r => (
          <tr key={r.label}>
            <td style={{ padding: '3px 8px 3px 0', fontSize: '0.74rem', color: theme.colors.charcoal }}>{r.label}</td>
            <td style={{ padding: '3px 8px', fontSize: '0.74rem', fontFamily: theme.typography.fontFamilyMono, fontWeight: 700, color: r.avgReturnPct >= 0 ? theme.colors.successMuted : theme.colors.errorMuted }}>
              {r.avgReturnPct >= 0 ? '+' : ''}{Math.round(r.avgReturnPct * 100)}%
            </td>
            <td style={{ padding: '3px 8px', fontSize: '0.72rem', fontFamily: theme.typography.fontFamilyMono, color: theme.colors.gray600 }}>
              {Math.round(r.winRate * 100)}% win
            </td>
            <td style={{ padding: '3px 0', fontSize: '0.68rem', fontFamily: theme.typography.fontFamilyMono, color: theme.colors.gray500 }}>
              {r.graded} picks · {r.clusterN} clusters
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const OptionsLearningTab = () => {
  const [timeline, setTimeline] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [expandedPick, setExpandedPick] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/scanner/options/track-record/timeline').then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch('/api/scanner/options/track-record?limit=200').then(r => (r.ok ? r.json() : null)),
    ])
      .then(([tl, rep]) => { if (!cancelled) { setTimeline(tl); setReport(rep); } })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div style={{ padding: theme.spacing.xl, textAlign: 'center', color: theme.colors.errorMuted }}>Couldn’t load the scoreboard: {error}</div>;
  }
  if (!timeline) {
    return <div style={{ padding: theme.spacing.xl, textAlign: 'center', color: theme.colors.gray500 }}>Grading the ledger…</div>;
  }
  if (!timeline.gradedPicks) {
    return (
      <div style={{ padding: theme.spacing.xl, textAlign: 'center', color: theme.colors.gray500, background: theme.colors.parchment, border: `1px dashed ${theme.colors.ruler}`, borderRadius: theme.borderRadius.xs }}>
        No graded picks yet — the scoreboard fills in as recommendations resolve.
      </div>
    );
  }

  const s = report?.summary;
  const ev = timeline.evidence;
  const cs = timeline.clusterStats;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {s && (
        <div style={{ display: 'flex', gap: theme.spacing.lg, flexWrap: 'wrap', fontSize: '0.78rem', color: theme.colors.gray600, fontFamily: theme.typography.fontFamilyMono }}>
          <span><strong style={{ color: theme.colors.charcoal }}>{s.wins}W / {s.losses}L</strong> ({Math.round(s.winRate * 100)}%)</span>
          <span>avg {s.avgReturnPct >= 0 ? '+' : ''}{Math.round(s.avgReturnPct * 100)}% per $100 ticket</span>
          {cs && <span>cluster-weighted: {Math.round(cs.winRate * 100)}% win, avg {cs.avgReturnPct >= 0 ? '+' : ''}{Math.round(cs.avgReturnPct * 100)}% ({cs.clusters} clusters)</span>}
          {s.calibration && (
            <span>we predicted {Math.round(s.calibration.predictedWinRate * 100)}% — reality {Math.round(s.calibration.realizedWinRate * 100)}%</span>
          )}
          <span style={{ marginLeft: 'auto', color: ev.clusters >= ev.clustersNeeded && ev.days >= ev.daysNeeded ? theme.colors.successMuted : theme.colors.gray500 }}>
            evidence: {ev.clusters}/{ev.clustersNeeded} clusters · {ev.days}/{ev.daysNeeded} days
          </span>
        </div>
      )}

      <div style={panelStyle}>
        <div style={titleStyle}>If you'd put $100 on every pick — two exit disciplines, same picks</div>
        <CurvesChart curves={timeline.equityCurves} />
      </div>

      <div style={panelStyle}>
        <div style={titleStyle}>What we predicted vs what happened, by entry day (dashed = our predicted win rate)</div>
        <CalibrationBars days={timeline.calibrationByDay} />
        {timeline.calibrationByDay.some(d => d.partial) && (
          <div style={{ fontSize: '0.68rem', color: theme.colors.gray500, marginTop: 4 }}>
            * day still has open picks — losers tend to grade first, so partial days read worse than they'll finish
          </div>
        )}
      </div>

      <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: theme.spacing.lg }}>
        <SliceTable title="By time to expiry" rows={timeline.slices.byDte} />
        <SliceTable title="By delta (aggressiveness)" rows={timeline.slices.byDelta} />
        <SliceTable title="Earnings exposure" rows={timeline.slices.byEarnings} />
        <SliceTable title="Direction" rows={timeline.slices.byDirection} />
      </div>

      <div style={panelStyle}>
        <div style={titleStyle}>Recent grades — click a pick to see why it won or lost</div>
        {(() => {
          const gradedRows = (report?.picks || [])
            .filter(p => p.exit)
            .sort((a, b) => b.exit.exitDate.localeCompare(a.exit.exitDate))
            .slice(0, 15);
          if (!gradedRows.length) {
            return <div style={{ fontSize: '0.76rem', color: theme.colors.gray500 }}>No grades in the recent window yet.</div>;
          }
          return gradedRows.map(p => (
            <div key={p.id}>
              <div
                onClick={() => setExpandedPick(e => (e === p.id ? null : p.id))}
                style={{ display: 'flex', gap: theme.spacing.sm, fontSize: '0.74rem', padding: '3px 0', alignItems: 'baseline', cursor: 'pointer' }}
              >
                <span>{p.status === 'win' ? '✅' : '❌'}</span>
                <span style={{ color: theme.colors.charcoal, fontWeight: 600 }}>{betSentence(p.card)}</span>
                <span style={{ color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono }}>
                  in {fmtMoney(p.card.costPerContract)} · {fmtShortDate(p.recordedAt.slice(0, 10))}
                </span>
                <span style={{ marginLeft: 'auto', fontFamily: theme.typography.fontFamilyMono, fontWeight: 700, color: p.exit.returnPct >= 0 ? theme.colors.successMuted : theme.colors.errorMuted }}>
                  {p.exit.returnPct >= 0 ? '+' : ''}{Math.round(p.exit.returnPct * 100)}%
                  {p.exitHold && <span style={{ color: theme.colors.gray500, fontWeight: 500 }}> · held {p.exitHold.returnPct >= 0 ? '+' : ''}{Math.round(p.exitHold.returnPct * 100)}%</span>}
                </span>
                <span style={{ color: theme.colors.gray500 }}>{expandedPick === p.id ? '▾' : '▸'}</span>
              </div>
              {expandedPick === p.id && <PickDetailChart pickId={p.id} />}
            </div>
          ));
        })()}
      </div>

      <div style={{ fontSize: '0.68rem', color: theme.colors.gray500 }}>
        Methodology v{timeline.methodology.gradeVersion}: {timeline.methodology.exits}. Fills are {timeline.methodology.fills}.
        Every pick ever surfaced is recorded and never deleted; this page and the daily Telegram render from the same ledger computation.
      </div>
    </div>
  );
};

export default memo(OptionsLearningTab);
