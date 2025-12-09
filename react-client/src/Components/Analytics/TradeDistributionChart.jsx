import React, { useEffect, useRef, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import { calculateTradeDistribution, calculateMetrics, formatCurrency, formatPercent, chartColors } from './analyticsUtils';

Chart.register(...registerables);

/**
 * TradeDistributionChart - P&L Histogram
 *
 * Shows the distribution of trade P&L values.
 * Key insights:
 * - Normal distribution = predictable returns
 * - Fat left tail = rare large losses (dangerous!)
 * - Skewed right = good - small losses, occasional big wins
 */
const TradeDistributionChart = ({
  trades = [],
  bins = 20,
  height = 350,
  title = 'Trade Distribution',
}) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  // Calculate histogram data
  const histogram = useMemo(() => {
    return calculateTradeDistribution(trades, bins);
  }, [trades, bins]);

  // Calculate distribution statistics
  const stats = useMemo(() => {
    if (!trades || trades.length === 0) return null;

    const pnls = trades.map(t => t.pnl || 0).sort((a, b) => a - b);
    const metrics = calculateMetrics(trades);

    // Calculate standard deviation
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance = pnls.reduce((sum, pnl) => sum + Math.pow(pnl - mean, 2), 0) / pnls.length;
    const stdDev = Math.sqrt(variance);

    // Calculate skewness
    const skewness = pnls.reduce((sum, pnl) => sum + Math.pow((pnl - mean) / stdDev, 3), 0) / pnls.length;

    // Calculate kurtosis (excess kurtosis - 3 for normal)
    const kurtosis = pnls.reduce((sum, pnl) => sum + Math.pow((pnl - mean) / stdDev, 4), 0) / pnls.length - 3;

    // Find outliers (beyond 2 std devs)
    const lowerBound = mean - 2 * stdDev;
    const upperBound = mean + 2 * stdDev;
    const outliers = pnls.filter(p => p < lowerBound || p > upperBound);

    return {
      ...metrics,
      mean,
      median: pnls[Math.floor(pnls.length / 2)],
      stdDev,
      skewness,
      kurtosis,
      min: pnls[0],
      max: pnls[pnls.length - 1],
      outlierCount: outliers.length,
      outlierPercent: (outliers.length / pnls.length) * 100,
    };
  }, [trades]);

  // Interpret the distribution
  const interpretation = useMemo(() => {
    if (!stats) return null;

    const warnings = [];
    const positives = [];

    // Skewness interpretation
    if (stats.skewness < -0.5) {
      warnings.push('Negatively skewed - tendency for large losses');
    } else if (stats.skewness > 0.5) {
      positives.push('Positively skewed - tendency for larger wins than losses');
    }

    // Kurtosis interpretation
    if (stats.kurtosis > 1) {
      warnings.push('Heavy tails - occasional extreme outcomes');
    }

    // Outlier check
    if (stats.outlierPercent > 10) {
      warnings.push(`${formatPercent(stats.outlierPercent)} outliers - high volatility in outcomes`);
    }

    // Win rate check
    if (stats.winRate < 40) {
      warnings.push('Low win rate - ensure winners are much larger than losers');
    } else if (stats.winRate > 60) {
      positives.push('High win rate - consistent execution');
    }

    // Risk/reward check
    if (stats.avgWin > stats.avgLoss * 1.5) {
      positives.push(`Good R:R ratio - avg win ${formatCurrency(stats.avgWin)} vs avg loss ${formatCurrency(stats.avgLoss)}`);
    } else if (stats.avgLoss > stats.avgWin) {
      warnings.push('Avg loss > avg win - need higher win rate to be profitable');
    }

    return { warnings, positives };
  }, [stats]);

  useEffect(() => {
    if (!chartRef.current || histogram.length === 0) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');

    chartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: histogram.map(h => formatCurrency(h.binMid)),
        datasets: [
          {
            label: 'Trade Count',
            data: histogram.map(h => h.count),
            backgroundColor: histogram.map(h =>
              h.isProfit ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
            ),
            borderColor: histogram.map(h =>
              h.isProfit ? chartColors.profit : chartColors.loss
            ),
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex;
                if (idx !== undefined && histogram[idx]) {
                  const h = histogram[idx];
                  return `${formatCurrency(h.binStart)} to ${formatCurrency(h.binEnd)}`;
                }
                return '';
              },
              label: (context) => {
                return `Trades: ${context.parsed.y}`;
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
            title: {
              display: true,
              text: 'P&L ($)',
              color: chartColors.text,
            },
            grid: {
              display: false,
            },
            ticks: {
              color: chartColors.text,
              maxRotation: 45,
              font: { size: 10 },
            },
          },
          y: {
            title: {
              display: true,
              text: 'Number of Trades',
              color: chartColors.text,
            },
            grid: {
              color: chartColors.gridLine,
            },
            ticks: {
              color: chartColors.text,
              stepSize: 1,
            },
            beginAtZero: true,
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [histogram]);

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

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '12px',
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#1f2937',
    borderRadius: '6px',
  };

  const statItemStyle = {
    textAlign: 'center',
  };

  const statLabelStyle = {
    color: chartColors.text,
    fontSize: '10px',
    marginBottom: '2px',
    textTransform: 'uppercase',
  };

  const statValueStyle = (color) => ({
    color: color || chartColors.textLight,
    fontSize: '13px',
    fontWeight: '600',
  });

  const interpretationStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
    marginTop: '16px',
  };

  const alertBoxStyle = (type) => ({
    padding: '12px',
    backgroundColor: type === 'warning' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
    borderRadius: '6px',
    borderLeft: `3px solid ${type === 'warning' ? chartColors.loss : chartColors.profit}`,
  });

  const alertTitleStyle = (type) => ({
    color: type === 'warning' ? chartColors.loss : chartColors.profit,
    fontSize: '12px',
    fontWeight: '600',
    marginBottom: '8px',
  });

  const alertListStyle = {
    margin: 0,
    paddingLeft: '16px',
    color: chartColors.text,
    fontSize: '12px',
  };

  const emptyStateStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: `${height}px`,
    color: chartColors.text,
  };

  if (!trades || trades.length === 0) {
    return (
      <div style={containerStyle}>
        <h3 style={titleStyle}>{title}</h3>
        <div style={emptyStateStyle}>
          <p>No trade data available</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>{title}</h3>
      </div>

      {stats && (
        <div style={statsGridStyle}>
          <div style={statItemStyle}>
            <div style={statLabelStyle}>Mean</div>
            <div style={statValueStyle(stats.mean >= 0 ? chartColors.profit : chartColors.loss)}>
              {formatCurrency(stats.mean)}
            </div>
          </div>
          <div style={statItemStyle}>
            <div style={statLabelStyle}>Median</div>
            <div style={statValueStyle(stats.median >= 0 ? chartColors.profit : chartColors.loss)}>
              {formatCurrency(stats.median)}
            </div>
          </div>
          <div style={statItemStyle}>
            <div style={statLabelStyle}>Std Dev</div>
            <div style={statValueStyle()}>{formatCurrency(stats.stdDev)}</div>
          </div>
          <div style={statItemStyle}>
            <div style={statLabelStyle}>Skewness</div>
            <div style={statValueStyle(stats.skewness > 0 ? chartColors.profit : chartColors.loss)}>
              {stats.skewness.toFixed(2)}
            </div>
          </div>
          <div style={statItemStyle}>
            <div style={statLabelStyle}>Min</div>
            <div style={statValueStyle(chartColors.loss)}>{formatCurrency(stats.min)}</div>
          </div>
          <div style={statItemStyle}>
            <div style={statLabelStyle}>Max</div>
            <div style={statValueStyle(chartColors.profit)}>{formatCurrency(stats.max)}</div>
          </div>
        </div>
      )}

      <div style={{ height: `${height}px` }}>
        <canvas ref={chartRef} />
      </div>

      {interpretation && (interpretation.warnings.length > 0 || interpretation.positives.length > 0) && (
        <div style={interpretationStyle}>
          {interpretation.warnings.length > 0 && (
            <div style={alertBoxStyle('warning')}>
              <div style={alertTitleStyle('warning')}>Risk Factors</div>
              <ul style={alertListStyle}>
                {interpretation.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {interpretation.positives.length > 0 && (
            <div style={alertBoxStyle('positive')}>
              <div style={alertTitleStyle('positive')}>Strengths</div>
              <ul style={alertListStyle}>
                {interpretation.positives.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TradeDistributionChart;
