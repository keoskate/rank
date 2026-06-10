import React, { useEffect, useRef, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import {
  calculateEquityCurve,
  formatCurrency,
  formatPercent,
  chartColors,
} from './analyticsUtils';

Chart.register(...registerables);

/**
 * EquityCurveChart - Displays cumulative P&L with drawdown overlay
 *
 * Features:
 * - Primary line: Cumulative equity
 * - Secondary area: Drawdown (inverted, red fill)
 * - High water mark line (dotted)
 * - Hover tooltips with trade details
 *
 * Two data modes:
 * - trades mode (default): derives the curve from a trade list via
 *   calculateEquityCurve (per-trade granularity).
 * - series mode: pass `series` = [{ index, date, equity, drawdown,
 *   highWaterMark }] to render a precomputed curve EXACTLY as provided (used
 *   by the backtest run viewer so the chart can't drift from the artifact).
 *   Optional `benchmarkValues` (aligned numbers) draws a comparison line.
 */
const EquityCurveChart = ({
  trades = [],
  startingCapital = 10000,
  height = 400,
  showDrawdown = true,
  showHighWaterMark = true,
  title = 'Equity Curve',
  series = null,
  benchmarkValues = null,
  benchmarkLabel = 'Benchmark',
  xLabel = 'Trade Number',
}) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  // Calculate equity curve data (or use the precomputed series verbatim)
  const data = useMemo(() => {
    if (series && series.length) return series;
    return calculateEquityCurve(trades, startingCapital);
  }, [series, trades, startingCapital]);

  // Calculate summary stats
  const stats = useMemo(() => {
    if (data.length === 0) return null;

    const finalEquity = data[data.length - 1].equity;
    const maxDrawdown = Math.max(...data.map(d => d.drawdown));
    const totalReturn =
      ((finalEquity - startingCapital) / startingCapital) * 100;
    const maxEquity = Math.max(...data.map(d => d.equity));

    return {
      finalEquity,
      totalReturn,
      maxDrawdown,
      maxEquity,
      tradeCount: trades.length,
    };
  }, [data, startingCapital, trades.length]);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');

    const datasets = [
      {
        label: 'Equity',
        data: data.map(d => ({ x: d.index, y: d.equity })),
        borderColor: chartColors.primary,
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.1,
        yAxisID: 'y',
      },
    ];

    if (showHighWaterMark) {
      datasets.push({
        label: 'High Water Mark',
        data: data.map(d => ({ x: d.index, y: d.highWaterMark })),
        borderColor: chartColors.textLight,
        borderDash: [5, 5],
        backgroundColor: 'transparent',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0,
        yAxisID: 'y',
      });
    }

    if (benchmarkValues && benchmarkValues.length === data.length) {
      datasets.push({
        label: benchmarkLabel,
        data: benchmarkValues.map((v, i) => ({ x: data[i].index, y: v })),
        borderColor: '#6b7280',
        backgroundColor: 'transparent',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.1,
        yAxisID: 'y',
      });
    }

    if (showDrawdown) {
      datasets.push({
        label: 'Drawdown',
        data: data.map(d => ({ x: d.index, y: d.drawdown })),
        borderColor: chartColors.loss,
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
        borderWidth: 1,
        pointRadius: 0,
        fill: true,
        tension: 0.1,
        yAxisID: 'y1',
      });
    }

    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: chartColors.text,
              usePointStyle: true,
            },
          },
          tooltip: {
            callbacks: {
              title: items => {
                const idx = items[0]?.dataIndex;
                if (idx !== undefined && data[idx]) {
                  const d = data[idx];
                  if (xLabel !== 'Trade Number') {
                    return d.date
                      ? new Date(d.date).toLocaleDateString()
                      : `${xLabel} ${idx + 1}`;
                  }
                  return d.date
                    ? `Trade #${idx + 1} - ${new Date(d.date).toLocaleDateString()}`
                    : `Trade #${idx + 1}`;
                }
                return '';
              },
              label: context => {
                const value = context.parsed.y;
                if (context.dataset.label === 'Drawdown') {
                  return `Drawdown: ${formatPercent(value)}`;
                }
                return `${context.dataset.label}: ${formatCurrency(value)}`;
              },
              afterBody: items => {
                const idx = items[0]?.dataIndex;
                if (idx !== undefined && data[idx]) {
                  const d = data[idx];
                  const lines = [];
                  if (d.pnl !== undefined) {
                    lines.push(`Trade P&L: ${formatCurrency(d.pnl)}`);
                  }
                  if (d.symbol) {
                    lines.push(`Symbol: ${d.symbol}`);
                  }
                  return lines;
                }
                return [];
              },
            },
            backgroundColor: chartColors.background,
            titleColor: chartColors.textLight,
            bodyColor: chartColors.text,
            borderColor: chartColors.gridLine,
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            type: 'linear',
            title: {
              display: true,
              text: xLabel,
              color: chartColors.text,
            },
            grid: {
              color: chartColors.gridLine,
            },
            ticks: {
              color: chartColors.text,
            },
          },
          y: {
            type: 'linear',
            position: 'left',
            title: {
              display: true,
              text: 'Equity ($)',
              color: chartColors.text,
            },
            grid: {
              color: chartColors.gridLine,
            },
            ticks: {
              color: chartColors.text,
              callback: value => formatCurrency(value),
            },
          },
          y1: showDrawdown
            ? {
                type: 'linear',
                position: 'right',
                reverse: true,
                min: 0,
                max: Math.max(20, ...data.map(d => d.drawdown)) * 1.1,
                title: {
                  display: true,
                  text: 'Drawdown (%)',
                  color: chartColors.loss,
                },
                grid: {
                  display: false,
                },
                ticks: {
                  color: chartColors.loss,
                  callback: value => formatPercent(value),
                },
              }
            : undefined,
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [
    data,
    showDrawdown,
    showHighWaterMark,
    benchmarkValues,
    benchmarkLabel,
    xLabel,
  ]);

  const containerStyle = {
    backgroundColor: '#111827',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  };

  const titleStyle = {
    color: chartColors.textLight,
    fontSize: '18px',
    fontWeight: '600',
    margin: 0,
  };

  const statsContainerStyle = {
    display: 'flex',
    gap: '24px',
  };

  const statStyle = {
    textAlign: 'right',
  };

  const statLabelStyle = {
    color: chartColors.text,
    fontSize: '12px',
    marginBottom: '2px',
  };

  const statValueStyle = isPositive => ({
    color:
      isPositive === undefined
        ? chartColors.textLight
        : isPositive
          ? chartColors.profit
          : chartColors.loss,
    fontSize: '16px',
    fontWeight: '600',
  });

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>{title}</h3>
        {stats && (
          <div style={statsContainerStyle}>
            <div style={statStyle}>
              <div style={statLabelStyle}>Final Equity</div>
              <div style={statValueStyle(stats.totalReturn >= 0)}>
                {formatCurrency(stats.finalEquity)}
              </div>
            </div>
            <div style={statStyle}>
              <div style={statLabelStyle}>Total Return</div>
              <div style={statValueStyle(stats.totalReturn >= 0)}>
                {stats.totalReturn >= 0 ? '+' : ''}
                {formatPercent(stats.totalReturn)}
              </div>
            </div>
            <div style={statStyle}>
              <div style={statLabelStyle}>Max Drawdown</div>
              <div style={statValueStyle(false)}>
                -{formatPercent(stats.maxDrawdown)}
              </div>
            </div>
            <div style={statStyle}>
              <div style={statLabelStyle}>Trades</div>
              <div style={statValueStyle()}>{stats.tradeCount}</div>
            </div>
          </div>
        )}
      </div>
      <div style={{ height: `${height}px` }}>
        <canvas ref={chartRef} />
      </div>
    </div>
  );
};

export default EquityCurveChart;
