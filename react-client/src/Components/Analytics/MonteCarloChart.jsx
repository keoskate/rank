import React, { useEffect, useRef, useMemo, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { runMonteCarloSimulation, formatCurrency, formatPercent, chartColors } from './analyticsUtils';

Chart.register(...registerables);

/**
 * MonteCarloChart - Statistical Risk Visualization
 *
 * Monte Carlo simulation shows the realistic range of outcomes
 * by randomly reshuffling trade order 1000+ times.
 *
 * Key insight: Your backtest is ONE possible path.
 * The 5th percentile drawdown is what you should plan for!
 */
const MonteCarloChart = ({
  trades = [],
  startingCapital = 10000,
  simulations = 1000,
  height = 400,
  title = 'Monte Carlo Simulation',
}) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // Run Monte Carlo simulation (memoized)
  const mcResults = useMemo(() => {
    if (!trades || trades.length < 5) return null;
    setIsCalculating(true);
    const results = runMonteCarloSimulation(trades, simulations, startingCapital);
    setIsCalculating(false);
    return results;
  }, [trades, simulations, startingCapital]);

  useEffect(() => {
    if (!chartRef.current || !mcResults || mcResults.percentiles.length === 0) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');
    const { percentiles } = mcResults;

    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: percentiles.map(p => p.index),
        datasets: [
          {
            label: '95th Percentile (Best)',
            data: percentiles.map(p => p.p95),
            borderColor: 'rgba(16, 185, 129, 0.8)',
            backgroundColor: 'transparent',
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
          },
          {
            label: '75th Percentile',
            data: percentiles.map(p => p.p75),
            borderColor: 'rgba(16, 185, 129, 0.4)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 1,
            pointRadius: 0,
            fill: '+1',
          },
          {
            label: '50th Percentile (Median)',
            data: percentiles.map(p => p.p50),
            borderColor: chartColors.primary,
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          },
          {
            label: '25th Percentile',
            data: percentiles.map(p => p.p25),
            borderColor: 'rgba(239, 68, 68, 0.4)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderWidth: 1,
            pointRadius: 0,
            fill: '-1',
          },
          {
            label: '5th Percentile (Worst)',
            data: percentiles.map(p => p.p5),
            borderColor: 'rgba(239, 68, 68, 0.8)',
            backgroundColor: 'transparent',
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
          },
          {
            label: 'Starting Capital',
            data: percentiles.map(() => startingCapital),
            borderColor: chartColors.text,
            borderDash: [5, 5],
            backgroundColor: 'transparent',
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
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
              font: { size: 10 },
            },
          },
          tooltip: {
            callbacks: {
              title: (items) => `Trade #${items[0]?.label || 0}`,
              label: (context) => {
                const value = context.parsed.y;
                return `${context.dataset.label}: ${formatCurrency(value)}`;
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
              text: 'Trade Number',
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
              callback: (value) => formatCurrency(value),
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
  }, [mcResults, startingCapital]);

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

  const subtitleStyle = {
    color: chartColors.text,
    fontSize: '12px',
    marginTop: '4px',
  };

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
    marginBottom: '16px',
  };

  const statsBoxStyle = (type) => ({
    padding: '16px',
    backgroundColor: '#1f2937',
    borderRadius: '6px',
    borderLeft: `3px solid ${type === 'equity' ? chartColors.primary : chartColors.loss}`,
  });

  const statsBoxTitleStyle = {
    color: chartColors.text,
    fontSize: '12px',
    fontWeight: '600',
    marginBottom: '12px',
    textTransform: 'uppercase',
  };

  const statRowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: `1px solid ${chartColors.gridLine}`,
  };

  const statLabelStyle = {
    color: chartColors.text,
    fontSize: '12px',
  };

  const statValueStyle = (isPositive) => ({
    color: isPositive === undefined ? chartColors.textLight : isPositive ? chartColors.profit : chartColors.loss,
    fontSize: '13px',
    fontWeight: '600',
  });

  const warningBoxStyle = {
    padding: '12px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: '6px',
    borderLeft: `3px solid ${chartColors.loss}`,
    marginTop: '16px',
  };

  const warningTitleStyle = {
    color: chartColors.loss,
    fontSize: '12px',
    fontWeight: '600',
    marginBottom: '4px',
  };

  const warningTextStyle = {
    color: chartColors.text,
    fontSize: '12px',
  };

  const loadingStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: `${height}px`,
    color: chartColors.text,
  };

  if (!trades || trades.length < 5) {
    return (
      <div style={containerStyle}>
        <h3 style={titleStyle}>{title}</h3>
        <div style={loadingStyle}>
          <p>Need at least 5 trades for Monte Carlo simulation</p>
        </div>
      </div>
    );
  }

  if (isCalculating || !mcResults) {
    return (
      <div style={containerStyle}>
        <h3 style={titleStyle}>{title}</h3>
        <div style={loadingStyle}>
          <p>Running {simulations.toLocaleString()} simulations...</p>
        </div>
      </div>
    );
  }

  const { statistics } = mcResults;
  const isWorstCaseProfitable = statistics.finalEquity.p5 > startingCapital;

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <h3 style={titleStyle}>{title}</h3>
          <div style={subtitleStyle}>
            {simulations.toLocaleString()} simulations | {trades.length} trades
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={statLabelStyle}>Profit Probability</div>
          <div style={statValueStyle(statistics.profitProbability >= 50)}>
            {formatPercent(statistics.profitProbability)}
          </div>
        </div>
      </div>

      <div style={statsGridStyle}>
        <div style={statsBoxStyle('equity')}>
          <div style={statsBoxTitleStyle}>Final Equity Distribution</div>
          <div style={statRowStyle}>
            <span style={statLabelStyle}>Best (95th)</span>
            <span style={statValueStyle(true)}>{formatCurrency(statistics.finalEquity.p95)}</span>
          </div>
          <div style={statRowStyle}>
            <span style={statLabelStyle}>Good (75th)</span>
            <span style={statValueStyle(true)}>{formatCurrency(statistics.finalEquity.p75)}</span>
          </div>
          <div style={statRowStyle}>
            <span style={statLabelStyle}>Median (50th)</span>
            <span style={statValueStyle(statistics.finalEquity.p50 > startingCapital)}>
              {formatCurrency(statistics.finalEquity.p50)}
            </span>
          </div>
          <div style={statRowStyle}>
            <span style={statLabelStyle}>Poor (25th)</span>
            <span style={statValueStyle(statistics.finalEquity.p25 > startingCapital)}>
              {formatCurrency(statistics.finalEquity.p25)}
            </span>
          </div>
          <div style={{ ...statRowStyle, borderBottom: 'none' }}>
            <span style={statLabelStyle}>Worst (5th)</span>
            <span style={statValueStyle(isWorstCaseProfitable)}>
              {formatCurrency(statistics.finalEquity.p5)}
            </span>
          </div>
        </div>

        <div style={statsBoxStyle('drawdown')}>
          <div style={statsBoxTitleStyle}>Max Drawdown Distribution</div>
          <div style={statRowStyle}>
            <span style={statLabelStyle}>Best (5th)</span>
            <span style={statValueStyle(false)}>-{formatPercent(statistics.maxDrawdown.p5)}</span>
          </div>
          <div style={statRowStyle}>
            <span style={statLabelStyle}>Median (50th)</span>
            <span style={statValueStyle(false)}>-{formatPercent(statistics.maxDrawdown.p50)}</span>
          </div>
          <div style={statRowStyle}>
            <span style={statLabelStyle}>Worst (95th)</span>
            <span style={statValueStyle(false)}>-{formatPercent(statistics.maxDrawdown.p95)}</span>
          </div>
          <div style={{ ...statRowStyle, borderBottom: 'none' }}>
            <span style={statLabelStyle}>Mean</span>
            <span style={statValueStyle(false)}>-{formatPercent(statistics.maxDrawdown.mean)}</span>
          </div>
        </div>
      </div>

      <div style={{ height: `${height}px` }}>
        <canvas ref={chartRef} />
      </div>

      <div style={warningBoxStyle}>
        <div style={warningTitleStyle}>Risk Warning</div>
        <div style={warningTextStyle}>
          Plan for the 5th percentile outcome: You could see a max drawdown of{' '}
          <strong>{formatPercent(statistics.maxDrawdown.p95)}</strong> and end with{' '}
          <strong>{formatCurrency(statistics.finalEquity.p5)}</strong> ({formatPercent(((statistics.finalEquity.p5 - startingCapital) / startingCapital) * 100)} return).
          This is the realistic worst case based on your trade distribution.
        </div>
      </div>
    </div>
  );
};

export default MonteCarloChart;
