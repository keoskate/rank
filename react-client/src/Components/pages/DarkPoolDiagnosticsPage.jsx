import { useState, useEffect, useRef, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import theme from '../../theme';
import { Card } from '../common';

Chart.register(...registerables);

/**
 * DarkPoolDiagnosticsPage - Diagnostics over data/darkpool-archive/.
 *
 * NOT a signal page. The 2026-06-01 audit measured NO EDGE (−0.038% vs
 * baseline, n=120); this page exists to watch archive coverage build toward
 * the 60-day event-study threshold and to inspect the raw buy/at-mid/sell
 * premium decomposition (classified by @keo/quant-core darkPoolCore — the
 * single classifier, with the mega-print cap disabled server-side so the
 * decomposition shows the raw tape).
 */

const EVENT_STUDY_THRESHOLD = 60;

const CAP_HIT_TOOLTIP = '500-print cap hit — window truncated';

const fmtPremium = v => {
  const abs = Math.abs(v || 0);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${Math.round(v || 0)}`;
};

/** Stacked buy / at-mid / sell premium per archived day. */
const StackedPremiumChart = ({ days, height = 320 }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || days.length === 0) return undefined;
    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext('2d');
    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: days.map(d => d.date),
        datasets: [
          {
            label: 'Buy Premium',
            data: days.map(d => d.buyPremium),
            backgroundColor: theme.colors.success,
          },
          {
            label: 'At-Mid Premium (dropped)',
            data: days.map(d => d.atMidPremium),
            backgroundColor: theme.colors.gray500,
          },
          {
            label: 'Sell Premium',
            data: days.map(d => d.sellPremium),
            backgroundColor: theme.colors.error,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: context =>
                `${context.dataset.label}: ${fmtPremium(context.parsed.y)}`,
              afterBody: items => {
                const d = days[items[0]?.dataIndex];
                if (!d) return [];
                const lines = [
                  `Sentiment: ${d.sentiment}`,
                  `Prints: ${d.printCount} (${d.buyCount} buy / ${d.sellCount} sell, ${d.droppedAtMid} at-mid dropped)`,
                ];
                if (d.capHit) lines.push(CAP_HIT_TOOLTIP);
                return lines;
              },
            },
          },
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            ticks: { callback: value => fmtPremium(value) },
            title: { display: true, text: 'Premium ($)' },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [days]);

  return (
    <div style={{ height: `${height}px` }}>
      <canvas ref={canvasRef} />
    </div>
  );
};

/** Print counts by log10 premium bucket for one day. */
const BlockSizeHistogramChart = ({ histogram, height = 260 }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !histogram || histogram.length === 0) {
      return undefined;
    }
    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext('2d');
    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: histogram.map(b => b.bucket),
        datasets: [
          {
            label: 'Prints',
            data: histogram.map(b => b.count),
            backgroundColor: theme.colors.info,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Premium per print' } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            title: { display: true, text: 'Print count' },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [histogram]);

  return (
    <div style={{ height: `${height}px` }}>
      <canvas ref={canvasRef} />
    </div>
  );
};

const DarkPoolDiagnosticsPage = () => {
  const [index, setIndex] = useState(null);
  const [indexError, setIndexError] = useState(null);
  const [symbol, setSymbol] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Archive index (coverage + symbol universe)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/darkpool-archive')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.error) {
          setIndexError(data.error);
          return;
        }
        setIndex(data);
        const all = new Set();
        for (const day of data.days || []) {
          for (const s of day.symbols || []) all.add(s);
        }
        const symbols = [...all].sort();
        if (symbols.length > 0) {
          setSymbol(symbols.includes('NVDA') ? 'NVDA' : symbols[0]);
        }
      })
      .catch(err => {
        if (!cancelled) setIndexError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-symbol daily summary (classified server-side by darkPoolCore)
  useEffect(() => {
    if (!symbol) return undefined;
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError(null);
    fetch(`/api/darkpool-archive/summary/${symbol}?days=90`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.error) setSummaryError(data.error);
        else setSummary(data);
      })
      .catch(err => {
        if (!cancelled) setSummaryError(err.message);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const allSymbols = useMemo(() => {
    const all = new Set();
    for (const day of index?.days || []) {
      for (const s of day.symbols || []) all.add(s);
    }
    return [...all].sort();
  }, [index]);

  const capHitByDate = useMemo(() => {
    const map = {};
    for (const d of summary?.days || []) map[d.date] = d.capHit;
    return map;
  }, [summary]);

  const totalDays = index?.totalDays || 0;
  const threshold = index?.eventStudyThreshold || EVENT_STUDY_THRESHOLD;
  const progressPct = Math.min((totalDays / threshold) * 100, 100);
  const summaryDays = summary?.days || [];
  const latestDay =
    summaryDays.length > 0 ? summaryDays[summaryDays.length - 1] : null;

  const sectionTitleStyle = {
    margin: `0 0 ${theme.spacing.sm} 0`,
    fontSize: theme.typography.fontSize.md,
    fontFamily: 'inherit',
  };

  return (
    <div
      style={{
        padding: theme.spacing.md,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: theme.typography.fontSize.sm,
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto',
      }}
    >
      <h2
        style={{
          margin: `0 0 ${theme.spacing.md} 0`,
          fontSize: theme.typography.fontSize.lg,
          fontFamily: 'inherit',
        }}
      >
        Dark Pool Diagnostics
      </h2>

      {/* (a) Permanent honesty banner — this page is not a signal */}
      <Card
        variant="warning"
        style={{
          marginBottom: theme.spacing.md,
          fontWeight: theme.typography.fontWeight.bold,
          color: theme.colors.warningDark,
        }}
      >
        Audit 2026-06-01: NO EDGE (−0.038% vs baseline, n=120). Diagnostics only
        — not a signal. Event-study eligible at ≥60 archived days.
      </Card>

      {indexError && (
        <Card variant="error" style={{ marginBottom: theme.spacing.md }}>
          Failed to load archive index: {indexError}
        </Card>
      )}

      {/* (b) Archive coverage strip */}
      <Card style={{ marginBottom: theme.spacing.md }}>
        <h3 style={sectionTitleStyle}>
          Archive Coverage — {totalDays}/{threshold} days
        </h3>
        <div
          style={{
            height: '10px',
            backgroundColor: theme.colors.gray200,
            borderRadius: theme.borderRadius.sm,
            overflow: 'hidden',
            marginBottom: theme.spacing.sm,
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: '100%',
              backgroundColor:
                totalDays >= threshold
                  ? theme.colors.success
                  : theme.colors.info,
              transition: 'width 0.3s',
            }}
          />
        </div>
        {totalDays === 0 ? (
          <div style={{ color: theme.colors.gray600 }}>
            No archived days yet — captures run every 15 min during market hours
            (first capture 09:35 ET).
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: theme.spacing.xs,
            }}
          >
            {index.days.map(day => (
              <span
                key={day.date}
                title={`${day.symbols.length} symbols, ${day.captureCount} captures${day.finalized ? ', finalized' : ''}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: theme.borderRadius.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  backgroundColor: day.finalized
                    ? theme.colors.gray100
                    : theme.colors.infoLight,
                  fontSize: theme.typography.fontSize.xs,
                }}
              >
                {day.date}
                {capHitByDate[day.date] && (
                  <span
                    title={CAP_HIT_TOOLTIP}
                    style={{
                      padding: '0 4px',
                      borderRadius: theme.borderRadius.sm,
                      backgroundColor: theme.colors.warning,
                      color: theme.colors.warningDark,
                      fontWeight: theme.typography.fontWeight.bold,
                    }}
                  >
                    CAP
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </Card>

      {totalDays > 0 && (
        <>
          {/* (c) Symbol selector + stacked premium decomposition */}
          <Card style={{ marginBottom: theme.spacing.md }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.md,
                marginBottom: theme.spacing.sm,
                flexWrap: 'wrap',
              }}
            >
              <h3 style={{ ...sectionTitleStyle, margin: 0 }}>
                Daily Premium Decomposition (raw, cap disabled)
              </h3>
              <select
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                style={{
                  padding: '4px 8px',
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm,
                  fontSize: theme.typography.fontSize.sm,
                  fontFamily: 'inherit',
                }}
              >
                {allSymbols.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {summaryLoading && (
                <span style={{ color: theme.colors.gray600 }}>Loading…</span>
              )}
            </div>
            {summaryError && (
              <div style={{ color: theme.colors.error }}>
                Failed to load summary: {summaryError}
              </div>
            )}
            {!summaryError && !summaryLoading && summaryDays.length === 0 && (
              <div style={{ color: theme.colors.gray600 }}>
                No archived days for {symbol || 'this symbol'} yet.
              </div>
            )}
            {summaryDays.length > 0 && (
              <StackedPremiumChart days={summaryDays} />
            )}
          </Card>

          {/* (d) Block-size histogram for the latest archived day */}
          {latestDay && (
            <Card style={{ marginBottom: theme.spacing.md }}>
              <h3 style={sectionTitleStyle}>
                Block Size Histogram — {summary.symbol} on {latestDay.date}
                {latestDay.capHit ? ` (${CAP_HIT_TOOLTIP})` : ''}
              </h3>
              <div
                style={{
                  color: theme.colors.gray600,
                  marginBottom: theme.spacing.sm,
                }}
              >
                {latestDay.printCount} unique prints · sentiment{' '}
                {latestDay.sentiment} · last print{' '}
                {latestDay.lastPrintEt
                  ? new Date(latestDay.lastPrintEt).toLocaleString('en-US', {
                      timeZone: 'America/New_York',
                    }) + ' ET'
                  : 'n/a'}
              </div>
              <BlockSizeHistogramChart
                histogram={latestDay.blockSizeHistogram}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default DarkPoolDiagnosticsPage;
