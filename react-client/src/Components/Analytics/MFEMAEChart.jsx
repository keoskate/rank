import React, { useEffect, useRef, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import { calculateMFEMAEData, formatPercent, chartColors } from './analyticsUtils';

Chart.register(...registerables);

/**
 * MFEMAEChart - Maximum Favorable/Adverse Excursion Scatter Plot
 *
 * This chart reveals exit optimization opportunities:
 * - X-axis: MAE (how far price went against you - % from entry)
 * - Y-axis: MFE (how far price went in your favor - % from entry)
 * - Green points: Winners, Red points: Losers
 *
 * Interpretation:
 * - Upper-left: Big MFE, small MAE = Great trades
 * - Lower-right: Big MAE, small MFE = Price went against you hard
 * - If many winners cluster in lower-left: You're exiting too early
 * - If many losers cluster in upper-right: Stops are too tight (price moved in your favor then reversed)
 */
const MFEMAEChart = ({
  trades = [],
  height = 400,
  title = 'MFE/MAE Analysis',
}) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  // Calculate MFE/MAE data
  const data = useMemo(() => {
    return calculateMFEMAEData(trades);
  }, [trades]);

  // Calculate insights
  const insights = useMemo(() => {
    if (data.length === 0) return null;

    const winners = data.filter(d => d.isWinner);
    const losers = data.filter(d => !d.isWinner);

    // Average MFE for winners - are we capturing the move?
    const avgWinnerMFE = winners.length > 0
      ? winners.reduce((sum, d) => sum + d.mfe, 0) / winners.length
      : 0;

    // Average MAE for losers - are stops too tight?
    const avgLoserMAE = losers.length > 0
      ? losers.reduce((sum, d) => sum + d.mae, 0) / losers.length
      : 0;

    // Trades where MFE was much higher than actual profit (left money on table)
    const leftMoneyOnTable = winners.filter(d => d.mfe > d.pnlPercent * 2).length;

    // Trades where MAE was close to stop but would have recovered
    const stoppedOutEarly = losers.filter(d => d.mfe > d.mae).length;

    let recommendation = '';
    if (leftMoneyOnTable > winners.length * 0.3) {
      recommendation = 'Consider wider profit targets or trailing stops - leaving money on table';
    } else if (stoppedOutEarly > losers.length * 0.3) {
      recommendation = 'Consider wider stops - getting stopped out before recovery';
    } else if (avgLoserMAE > avgWinnerMFE * 1.5) {
      recommendation = 'Losers have higher MAE than winners MFE - tighten stops';
    } else {
      recommendation = 'Exit strategy appears balanced';
    }

    return {
      totalTrades: data.length,
      winners: winners.length,
      losers: losers.length,
      avgWinnerMFE,
      avgLoserMAE,
      leftMoneyOnTable,
      stoppedOutEarly,
      recommendation,
    };
  }, [data]);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');

    const winners = data.filter(d => d.isWinner);
    const losers = data.filter(d => !d.isWinner);

    // Find max values for axes
    const maxMFE = Math.max(...data.map(d => d.mfe), 5);
    const maxMAE = Math.max(...data.map(d => d.mae), 5);
    const maxAxis = Math.max(maxMFE, maxMAE) * 1.1;

    chartInstance.current = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Winners',
            data: winners.map(d => ({ x: d.mae, y: d.mfe, ...d })),
            backgroundColor: 'rgba(16, 185, 129, 0.6)',
            borderColor: chartColors.profit,
            borderWidth: 1,
            pointRadius: 6,
            pointHoverRadius: 8,
          },
          {
            label: 'Losers',
            data: losers.map(d => ({ x: d.mae, y: d.mfe, ...d })),
            backgroundColor: 'rgba(239, 68, 68, 0.6)',
            borderColor: chartColors.loss,
            borderWidth: 1,
            pointRadius: 6,
            pointHoverRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
              title: () => '',
              label: (context) => {
                const d = context.raw;
                return [
                  `MAE: ${formatPercent(d.mae)}`,
                  `MFE: ${formatPercent(d.mfe)}`,
                  `P&L: ${formatPercent(d.pnlPercent)}`,
                  d.symbol ? `Symbol: ${d.symbol}` : '',
                ].filter(Boolean);
              },
            },
            backgroundColor: chartColors.background,
            titleColor: chartColors.textLight,
            bodyColor: chartColors.text,
            borderColor: chartColors.gridLine,
            borderWidth: 1,
          },
          annotation: {
            annotations: {
              diagonalLine: {
                type: 'line',
                xMin: 0,
                xMax: maxAxis,
                yMin: 0,
                yMax: maxAxis,
                borderColor: chartColors.text,
                borderWidth: 1,
                borderDash: [5, 5],
                label: {
                  display: true,
                  content: 'MFE = MAE',
                  position: 'end',
                  color: chartColors.text,
                },
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max: maxAxis,
            title: {
              display: true,
              text: 'MAE (Max Adverse Excursion %)',
              color: chartColors.text,
            },
            grid: {
              color: chartColors.gridLine,
            },
            ticks: {
              color: chartColors.text,
              callback: (value) => formatPercent(value),
            },
          },
          y: {
            type: 'linear',
            min: 0,
            max: maxAxis,
            title: {
              display: true,
              text: 'MFE (Max Favorable Excursion %)',
              color: chartColors.text,
            },
            grid: {
              color: chartColors.gridLine,
            },
            ticks: {
              color: chartColors.text,
              callback: (value) => formatPercent(value),
            },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [data]);

  const containerStyle = {
    backgroundColor: '#111827',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  };

  const titleStyle = {
    color: chartColors.textLight,
    fontSize: '18px',
    fontWeight: '600',
    margin: 0,
  };

  const insightsContainerStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#1f2937',
    borderRadius: '6px',
  };

  const insightItemStyle = {
    textAlign: 'center',
  };

  const insightLabelStyle = {
    color: chartColors.text,
    fontSize: '11px',
    marginBottom: '4px',
    textTransform: 'uppercase',
  };

  const insightValueStyle = {
    color: chartColors.textLight,
    fontSize: '14px',
    fontWeight: '600',
  };

  const recommendationStyle = {
    padding: '12px',
    backgroundColor: '#1f2937',
    borderRadius: '6px',
    marginTop: '16px',
    borderLeft: `3px solid ${chartColors.tertiary}`,
  };

  const recommendationTitleStyle = {
    color: chartColors.tertiary,
    fontSize: '12px',
    fontWeight: '600',
    marginBottom: '4px',
  };

  const recommendationTextStyle = {
    color: chartColors.text,
    fontSize: '13px',
  };

  const emptyStateStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: `${height}px`,
    color: chartColors.text,
  };

  if (data.length === 0) {
    return (
      <div style={containerStyle}>
        <h3 style={titleStyle}>{title}</h3>
        <div style={emptyStateStyle}>
          <p>No MFE/MAE data available</p>
          <p style={{ fontSize: '12px', marginTop: '8px' }}>
            Trades need maxFavorableExcursion and maxAdverseExcursion fields
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>{title}</h3>
      </div>

      {insights && (
        <div style={insightsContainerStyle}>
          <div style={insightItemStyle}>
            <div style={insightLabelStyle}>Avg Winner MFE</div>
            <div style={{ ...insightValueStyle, color: chartColors.profit }}>
              {formatPercent(insights.avgWinnerMFE)}
            </div>
          </div>
          <div style={insightItemStyle}>
            <div style={insightLabelStyle}>Avg Loser MAE</div>
            <div style={{ ...insightValueStyle, color: chartColors.loss }}>
              {formatPercent(insights.avgLoserMAE)}
            </div>
          </div>
          <div style={insightItemStyle}>
            <div style={insightLabelStyle}>Left Money on Table</div>
            <div style={insightValueStyle}>
              {insights.leftMoneyOnTable} / {insights.winners}
            </div>
          </div>
          <div style={insightItemStyle}>
            <div style={insightLabelStyle}>Stopped Out Early</div>
            <div style={insightValueStyle}>
              {insights.stoppedOutEarly} / {insights.losers}
            </div>
          </div>
        </div>
      )}

      <div style={{ height: `${height}px` }}>
        <canvas ref={chartRef} />
      </div>

      {insights && (
        <div style={recommendationStyle}>
          <div style={recommendationTitleStyle}>Exit Strategy Insight</div>
          <div style={recommendationTextStyle}>{insights.recommendation}</div>
        </div>
      )}
    </div>
  );
};

export default MFEMAEChart;
