import React, { useEffect, useRef, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import { calculateTimeHeatmap, formatCurrency, chartColors } from './analyticsUtils';

Chart.register(...registerables);

/**
 * TimeHeatmapChart - Trading Performance by Time
 *
 * Visualizes P&L by hour of day and day of week.
 * Reveals patterns like:
 * - Best hours to trade (market open, power hour, etc.)
 * - Days to avoid (Monday mornings, Friday afternoons)
 * - Your personal edge times based on historical performance
 */
const TimeHeatmapChart = ({
  trades = [],
  height = 400,
  title = 'Trading Time Analysis',
}) => {
  const hourChartRef = useRef(null);
  const dayChartRef = useRef(null);
  const hourChartInstance = useRef(null);
  const dayChartInstance = useRef(null);

  // Calculate time-based performance
  const timeData = useMemo(() => {
    return calculateTimeHeatmap(trades);
  }, [trades]);

  // Find best and worst times
  const insights = useMemo(() => {
    if (!timeData || timeData.byHour.length === 0) return null;

    // Filter to trading hours (6 AM to 8 PM)
    const tradingHours = timeData.byHour.filter(h => h.hour >= 6 && h.hour <= 20 && h.count > 0);
    const tradingDays = timeData.byDayOfWeek.filter(d => d.count > 0);

    if (tradingHours.length === 0) return null;

    // Find best/worst hours
    const sortedByPnl = [...tradingHours].sort((a, b) => b.avgPnl - a.avgPnl);
    const bestHour = sortedByPnl[0];
    const worstHour = sortedByPnl[sortedByPnl.length - 1];

    // Find most active hour
    const sortedByCount = [...tradingHours].sort((a, b) => b.count - a.count);
    const mostActiveHour = sortedByCount[0];

    // Find best/worst days
    let bestDay = null;
    let worstDay = null;
    if (tradingDays.length > 0) {
      const sortedDays = [...tradingDays].sort((a, b) => b.avgPnl - a.avgPnl);
      bestDay = sortedDays[0];
      worstDay = sortedDays[sortedDays.length - 1];
    }

    // Calculate market session performance
    const preMarket = tradingHours.filter(h => h.hour >= 6 && h.hour < 9);
    const morningSession = tradingHours.filter(h => h.hour >= 9 && h.hour < 12);
    const lunchHours = tradingHours.filter(h => h.hour >= 12 && h.hour < 14);
    const afternoonSession = tradingHours.filter(h => h.hour >= 14 && h.hour < 16);
    const afterHours = tradingHours.filter(h => h.hour >= 16);

    const sessionPnl = (session) => {
      if (session.length === 0) return { pnl: 0, count: 0 };
      const totalPnl = session.reduce((sum, h) => sum + h.totalPnl, 0);
      const totalCount = session.reduce((sum, h) => sum + h.count, 0);
      return { pnl: totalPnl, count: totalCount, avg: totalCount > 0 ? totalPnl / totalCount : 0 };
    };

    return {
      bestHour,
      worstHour,
      mostActiveHour,
      bestDay,
      worstDay,
      sessions: {
        preMarket: sessionPnl(preMarket),
        morning: sessionPnl(morningSession),
        lunch: sessionPnl(lunchHours),
        afternoon: sessionPnl(afternoonSession),
        afterHours: sessionPnl(afterHours),
      },
    };
  }, [timeData]);

  // Hour chart
  useEffect(() => {
    if (!hourChartRef.current || timeData.byHour.length === 0) return;

    if (hourChartInstance.current) {
      hourChartInstance.current.destroy();
    }

    const ctx = hourChartRef.current.getContext('2d');

    // Filter to trading hours (6 AM - 8 PM)
    const tradingHours = timeData.byHour.filter(h => h.hour >= 6 && h.hour <= 20);

    hourChartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: tradingHours.map(h => {
          const hour = h.hour;
          const amPm = hour >= 12 ? 'PM' : 'AM';
          const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
          return `${displayHour}${amPm}`;
        }),
        datasets: [
          {
            label: 'Total P&L',
            data: tradingHours.map(h => h.totalPnl),
            backgroundColor: tradingHours.map(h =>
              h.totalPnl >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
            ),
            borderColor: tradingHours.map(h =>
              h.totalPnl >= 0 ? chartColors.profit : chartColors.loss
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
                if (idx !== undefined) {
                  const h = tradingHours[idx];
                  return `${h.hour}:00 - ${h.hour}:59`;
                }
                return '';
              },
              label: (context) => {
                const idx = context.dataIndex;
                const h = tradingHours[idx];
                return [
                  `Total P&L: ${formatCurrency(h.totalPnl)}`,
                  `Trades: ${h.count}`,
                  `Avg P&L: ${formatCurrency(h.avgPnl)}`,
                ];
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
              text: 'Hour of Day',
              color: chartColors.text,
            },
            grid: {
              display: false,
            },
            ticks: {
              color: chartColors.text,
              font: { size: 10 },
            },
          },
          y: {
            title: {
              display: true,
              text: 'Total P&L ($)',
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
      if (hourChartInstance.current) {
        hourChartInstance.current.destroy();
      }
    };
  }, [timeData]);

  // Day of week chart
  useEffect(() => {
    if (!dayChartRef.current || timeData.byDayOfWeek.length === 0) return;

    if (dayChartInstance.current) {
      dayChartInstance.current.destroy();
    }

    const ctx = dayChartRef.current.getContext('2d');
    const days = timeData.byDayOfWeek;

    dayChartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: days.map(d => d.dayName),
        datasets: [
          {
            label: 'Total P&L',
            data: days.map(d => d.totalPnl),
            backgroundColor: days.map(d =>
              d.totalPnl >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
            ),
            borderColor: days.map(d =>
              d.totalPnl >= 0 ? chartColors.profit : chartColors.loss
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
              label: (context) => {
                const idx = context.dataIndex;
                const d = days[idx];
                return [
                  `Total P&L: ${formatCurrency(d.totalPnl)}`,
                  `Trades: ${d.count}`,
                  `Avg P&L: ${formatCurrency(d.avgPnl)}`,
                ];
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
              text: 'Day of Week',
              color: chartColors.text,
            },
            grid: {
              display: false,
            },
            ticks: {
              color: chartColors.text,
            },
          },
          y: {
            title: {
              display: true,
              text: 'Total P&L ($)',
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
      if (dayChartInstance.current) {
        dayChartInstance.current.destroy();
      }
    };
  }, [timeData]);

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

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: '16px',
    marginBottom: '16px',
  };

  const chartBoxStyle = {
    backgroundColor: '#1f2937',
    borderRadius: '6px',
    padding: '12px',
  };

  const chartTitleStyle = {
    color: chartColors.text,
    fontSize: '12px',
    fontWeight: '600',
    marginBottom: '8px',
    textTransform: 'uppercase',
  };

  const insightsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
    marginBottom: '16px',
  };

  const insightCardStyle = (type) => ({
    padding: '12px',
    backgroundColor: '#1f2937',
    borderRadius: '6px',
    borderLeft: `3px solid ${type === 'best' ? chartColors.profit : type === 'worst' ? chartColors.loss : chartColors.primary}`,
  });

  const insightLabelStyle = {
    color: chartColors.text,
    fontSize: '10px',
    textTransform: 'uppercase',
    marginBottom: '4px',
  };

  const insightValueStyle = (color) => ({
    color: color || chartColors.textLight,
    fontSize: '14px',
    fontWeight: '600',
  });

  const insightSubStyle = {
    color: chartColors.text,
    fontSize: '11px',
    marginTop: '2px',
  };

  const sessionGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '8px',
    padding: '12px',
    backgroundColor: '#1f2937',
    borderRadius: '6px',
  };

  const sessionItemStyle = {
    textAlign: 'center',
  };

  const sessionLabelStyle = {
    color: chartColors.text,
    fontSize: '10px',
    marginBottom: '4px',
  };

  const sessionValueStyle = (value) => ({
    color: value >= 0 ? chartColors.profit : chartColors.loss,
    fontSize: '13px',
    fontWeight: '600',
  });

  const sessionCountStyle = {
    color: chartColors.text,
    fontSize: '10px',
    marginTop: '2px',
  };

  const emptyStateStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: `${height}px`,
    color: chartColors.text,
  };

  const formatHour = (hour) => {
    const amPm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:00 ${amPm}`;
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

      {insights && (
        <>
          <div style={insightsGridStyle}>
            <div style={insightCardStyle('best')}>
              <div style={insightLabelStyle}>Best Hour</div>
              <div style={insightValueStyle(chartColors.profit)}>
                {insights.bestHour ? formatHour(insights.bestHour.hour) : '-'}
              </div>
              {insights.bestHour && (
                <div style={insightSubStyle}>
                  {formatCurrency(insights.bestHour.avgPnl)} avg / {insights.bestHour.count} trades
                </div>
              )}
            </div>
            <div style={insightCardStyle('worst')}>
              <div style={insightLabelStyle}>Worst Hour</div>
              <div style={insightValueStyle(chartColors.loss)}>
                {insights.worstHour ? formatHour(insights.worstHour.hour) : '-'}
              </div>
              {insights.worstHour && (
                <div style={insightSubStyle}>
                  {formatCurrency(insights.worstHour.avgPnl)} avg / {insights.worstHour.count} trades
                </div>
              )}
            </div>
            <div style={insightCardStyle('active')}>
              <div style={insightLabelStyle}>Most Active</div>
              <div style={insightValueStyle()}>
                {insights.mostActiveHour ? formatHour(insights.mostActiveHour.hour) : '-'}
              </div>
              {insights.mostActiveHour && (
                <div style={insightSubStyle}>
                  {insights.mostActiveHour.count} trades / {formatCurrency(insights.mostActiveHour.avgPnl)} avg
                </div>
              )}
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ ...chartTitleStyle, marginBottom: '8px' }}>Session Performance</div>
            <div style={sessionGridStyle}>
              <div style={sessionItemStyle}>
                <div style={sessionLabelStyle}>Pre-Market</div>
                <div style={sessionValueStyle(insights.sessions.preMarket.pnl)}>
                  {formatCurrency(insights.sessions.preMarket.pnl)}
                </div>
                <div style={sessionCountStyle}>{insights.sessions.preMarket.count} trades</div>
              </div>
              <div style={sessionItemStyle}>
                <div style={sessionLabelStyle}>Morning</div>
                <div style={sessionValueStyle(insights.sessions.morning.pnl)}>
                  {formatCurrency(insights.sessions.morning.pnl)}
                </div>
                <div style={sessionCountStyle}>{insights.sessions.morning.count} trades</div>
              </div>
              <div style={sessionItemStyle}>
                <div style={sessionLabelStyle}>Lunch</div>
                <div style={sessionValueStyle(insights.sessions.lunch.pnl)}>
                  {formatCurrency(insights.sessions.lunch.pnl)}
                </div>
                <div style={sessionCountStyle}>{insights.sessions.lunch.count} trades</div>
              </div>
              <div style={sessionItemStyle}>
                <div style={sessionLabelStyle}>Afternoon</div>
                <div style={sessionValueStyle(insights.sessions.afternoon.pnl)}>
                  {formatCurrency(insights.sessions.afternoon.pnl)}
                </div>
                <div style={sessionCountStyle}>{insights.sessions.afternoon.count} trades</div>
              </div>
              <div style={sessionItemStyle}>
                <div style={sessionLabelStyle}>After Hours</div>
                <div style={sessionValueStyle(insights.sessions.afterHours.pnl)}>
                  {formatCurrency(insights.sessions.afterHours.pnl)}
                </div>
                <div style={sessionCountStyle}>{insights.sessions.afterHours.count} trades</div>
              </div>
            </div>
          </div>
        </>
      )}

      <div style={gridStyle}>
        <div style={chartBoxStyle}>
          <div style={chartTitleStyle}>P&L by Hour of Day</div>
          <div style={{ height: '200px' }}>
            <canvas ref={hourChartRef} />
          </div>
        </div>
        <div style={chartBoxStyle}>
          <div style={chartTitleStyle}>P&L by Day of Week</div>
          <div style={{ height: '200px' }}>
            <canvas ref={dayChartRef} />
          </div>
        </div>
      </div>

      {insights && (insights.bestDay || insights.worstDay) && (
        <div style={insightsGridStyle}>
          {insights.bestDay && (
            <div style={insightCardStyle('best')}>
              <div style={insightLabelStyle}>Best Day</div>
              <div style={insightValueStyle(chartColors.profit)}>{insights.bestDay.dayName}</div>
              <div style={insightSubStyle}>
                {formatCurrency(insights.bestDay.avgPnl)} avg / {insights.bestDay.count} trades
              </div>
            </div>
          )}
          {insights.worstDay && (
            <div style={insightCardStyle('worst')}>
              <div style={insightLabelStyle}>Worst Day</div>
              <div style={insightValueStyle(chartColors.loss)}>{insights.worstDay.dayName}</div>
              <div style={insightSubStyle}>
                {formatCurrency(insights.worstDay.avgPnl)} avg / {insights.worstDay.count} trades
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TimeHeatmapChart;
