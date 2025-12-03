/**
 * METRIC CORRELATION CHART
 *
 * Multi-metric overlay chart with correlation analysis
 * - Overlays multiple metrics on the same timeline
 * - Color-coded Y-axis for each metric
 * - Calculates Pearson correlation coefficients
 * - Shows correlation strength between metric pairs
 */

import React, { useState, useMemo } from 'react';

/**
 * Calculate Pearson correlation coefficient between two datasets
 * Returns value between -1 and 1:
 *  1 = perfect positive correlation
 *  0 = no correlation
 * -1 = perfect negative correlation
 */
function calculateCorrelation(x, y) {
  if (!x || !y || x.length !== y.length || x.length < 2) {
    return null;
  }

  const n = x.length;

  // Calculate means
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  // Calculate correlation
  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    numerator += diffX * diffY;
    sumSqX += diffX * diffX;
    sumSqY += diffY * diffY;
  }

  const denominator = Math.sqrt(sumSqX * sumSqY);

  if (denominator === 0) return null;

  return numerator / denominator;
}

/**
 * Normalize data to 0-1 range for overlay visualization
 */
function normalizeData(data) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  if (range === 0) return data.map(() => 0.5);

  return data.map(val => (val - min) / range);
}

/**
 * Get correlation strength label
 */
function getCorrelationLabel(correlation) {
  const abs = Math.abs(correlation);

  if (abs >= 0.9) return 'Very Strong';
  if (abs >= 0.7) return 'Strong';
  if (abs >= 0.5) return 'Moderate';
  if (abs >= 0.3) return 'Weak';
  return 'Very Weak';
}

/**
 * Get color for correlation strength
 */
function getCorrelationColor(correlation) {
  const abs = Math.abs(correlation);

  if (abs >= 0.7) return '#28a745'; // Green for strong
  if (abs >= 0.5) return '#ffc107'; // Yellow for moderate
  if (abs >= 0.3) return '#fd7e14'; // Orange for weak
  return '#6c757d'; // Gray for very weak
}

const METRIC_COLORS = [
  '#007bff', // Blue
  '#28a745', // Green
  '#dc3545', // Red
  '#ffc107', // Yellow
  '#17a2b8', // Cyan
  '#6f42c1', // Purple
  '#fd7e14', // Orange
  '#e83e8c', // Pink
];

const MetricCorrelationChart = ({ metricsData, labels, availableMetrics, title = "Metric Correlation Analysis" }) => {
  const [selectedMetrics, setSelectedMetrics] = useState([]);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Calculate all pairwise correlations
  const correlations = useMemo(() => {
    if (selectedMetrics.length < 2) return [];

    const results = [];

    for (let i = 0; i < selectedMetrics.length; i++) {
      for (let j = i + 1; j < selectedMetrics.length; j++) {
        const metric1 = selectedMetrics[i];
        const metric2 = selectedMetrics[j];

        const data1 = metricsData[metric1];
        const data2 = metricsData[metric2];

        if (data1 && data2) {
          const correlation = calculateCorrelation(data1, data2);

          if (correlation !== null) {
            results.push({
              metric1,
              metric2,
              correlation,
              strength: getCorrelationLabel(correlation),
              color: getCorrelationColor(correlation)
            });
          }
        }
      }
    }

    return results;
  }, [selectedMetrics, metricsData]);

  // Average correlation strength (useful for quick assessment)
  const averageCorrelation = useMemo(() => {
    if (correlations.length === 0) return null;

    const sum = correlations.reduce((acc, c) => acc + Math.abs(c.correlation), 0);
    return sum / correlations.length;
  }, [correlations]);

  // Normalize all selected metrics for overlay
  const normalizedData = useMemo(() => {
    const result = {};

    selectedMetrics.forEach(metric => {
      if (metricsData[metric]) {
        result[metric] = normalizeData(metricsData[metric]);
      }
    });

    return result;
  }, [selectedMetrics, metricsData]);

  // Toggle metric selection
  const toggleMetric = (metric) => {
    setSelectedMetrics(prev => {
      if (prev.includes(metric)) {
        return prev.filter(m => m !== metric);
      } else if (prev.length < METRIC_COLORS.length) {
        return [...prev, metric];
      }
      return prev;
    });
  };

  // Chart dimensions
  const chartWidth = 800;
  const chartHeight = 400;
  const padding = { top: 20, right: 120, bottom: 60, left: 60 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Generate chart data points
  const chartData = useMemo(() => {
    if (!labels || labels.length === 0) return {};

    const result = {};

    selectedMetrics.forEach((metric, metricIndex) => {
      const normalized = normalizedData[metric];
      if (!normalized) return;

      const points = normalized.map((value, index) => {
        const x = padding.left + (index / (normalized.length - 1)) * plotWidth;
        const y = padding.top + (1 - value) * plotHeight;

        return {
          x,
          y,
          value: metricsData[metric][index],
          normalizedValue: value,
          label: labels[index],
          index
        };
      });

      result[metric] = {
        points,
        color: METRIC_COLORS[metricIndex % METRIC_COLORS.length]
      };
    });

    return result;
  }, [selectedMetrics, normalizedData, metricsData, labels, plotWidth, plotHeight, padding]);

  // Generate SVG path for each metric
  const generatePath = (points) => {
    if (!points || points.length === 0) return '';

    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ');
  };

  const handleMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    setMousePosition({ x: event.clientX, y: event.clientY });

    // Find closest point across all metrics
    let closestPoint = null;
    let minDistance = Infinity;

    Object.entries(chartData).forEach(([metric, data]) => {
      data.points.forEach((point, index) => {
        const distance = Math.abs(point.x - mouseX);

        if (distance < minDistance && distance < 20) {
          minDistance = distance;
          closestPoint = {
            ...point,
            metric,
            color: data.color
          };
        }
      });
    });

    setHoveredPoint(closestPoint);
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  return (
    <div style={{ padding: '20px' }}>
      <h3 style={{ marginBottom: '20px', color: '#2c3e50' }}>{title}</h3>

      {/* Metric Selection */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: '600', marginBottom: '10px', color: '#6c757d' }}>
          Select Metrics to Compare (max {METRIC_COLORS.length}):
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {Object.entries(availableMetrics).map(([key, label]) => {
            const isSelected = selectedMetrics.includes(key);
            const colorIndex = selectedMetrics.indexOf(key);
            const color = colorIndex >= 0 ? METRIC_COLORS[colorIndex] : '#6c757d';

            return (
              <button
                key={key}
                onClick={() => toggleMetric(key)}
                disabled={!isSelected && selectedMetrics.length >= METRIC_COLORS.length}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: isSelected ? `2px solid ${color}` : '2px solid #dee2e6',
                  backgroundColor: isSelected ? `${color}20` : 'white',
                  color: isSelected ? color : '#6c757d',
                  fontWeight: isSelected ? '600' : '400',
                  cursor: (!isSelected && selectedMetrics.length >= METRIC_COLORS.length) ? 'not-allowed' : 'pointer',
                  opacity: (!isSelected && selectedMetrics.length >= METRIC_COLORS.length) ? 0.5 : 1,
                  transition: 'all 0.2s'
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {selectedMetrics.length === 0 && (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          color: '#6c757d'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>📊</div>
          <div>Select metrics above to see correlation analysis</div>
        </div>
      )}

      {selectedMetrics.length > 0 && (
        <>
          {/* Chart */}
          <div style={{
            backgroundColor: 'white',
            border: '1px solid #dee2e6',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <svg
              width={chartWidth}
              height={chartHeight}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: 'crosshair' }}
            >
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = padding.top + ratio * plotHeight;
                return (
                  <g key={ratio}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={chartWidth - padding.right}
                      y2={y}
                      stroke="#e9ecef"
                      strokeWidth="1"
                    />
                    <text
                      x={padding.left - 10}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="11"
                      fill="#6c757d"
                    >
                      {(100 - ratio * 100).toFixed(0)}%
                    </text>
                  </g>
                );
              })}

              {/* Metric lines */}
              {Object.entries(chartData).map(([metric, data]) => (
                <g key={metric}>
                  <path
                    d={generatePath(data.points)}
                    fill="none"
                    stroke={data.color}
                    strokeWidth="2"
                    opacity="0.8"
                  />

                  {/* Data points */}
                  {data.points.map((point, index) => (
                    <circle
                      key={index}
                      cx={point.x}
                      cy={point.y}
                      r="3"
                      fill={data.color}
                      opacity="0.6"
                    />
                  ))}
                </g>
              ))}

              {/* Hovered point indicator */}
              {hoveredPoint && (
                <>
                  <line
                    x1={hoveredPoint.x}
                    y1={padding.top}
                    x2={hoveredPoint.x}
                    y2={chartHeight - padding.bottom}
                    stroke="#999"
                    strokeWidth="1"
                    strokeDasharray="4,4"
                  />
                  <circle
                    cx={hoveredPoint.x}
                    cy={hoveredPoint.y}
                    r="5"
                    fill={hoveredPoint.color}
                    stroke="white"
                    strokeWidth="2"
                  />
                </>
              )}

              {/* X-axis labels (time) */}
              {labels && labels.length > 0 && [0, Math.floor(labels.length / 2), labels.length - 1].map((index) => {
                const x = padding.left + (index / (labels.length - 1)) * plotWidth;
                return (
                  <text
                    key={index}
                    x={x}
                    y={chartHeight - padding.bottom + 20}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#6c757d"
                  >
                    {labels[index]}
                  </text>
                );
              })}

              {/* Legend */}
              {selectedMetrics.map((metric, index) => {
                const y = padding.top + index * 25;
                const x = chartWidth - padding.right + 10;
                const color = METRIC_COLORS[index % METRIC_COLORS.length];

                return (
                  <g key={metric}>
                    <line
                      x1={x}
                      y1={y}
                      x2={x + 20}
                      y2={y}
                      stroke={color}
                      strokeWidth="3"
                    />
                    <text
                      x={x + 25}
                      y={y + 4}
                      fontSize="11"
                      fill="#2c3e50"
                    >
                      {availableMetrics[metric]}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Hover tooltip */}
            {hoveredPoint && (
              <div
                style={{
                  position: 'fixed',
                  left: mousePosition.x + 10,
                  top: mousePosition.y + 10,
                  backgroundColor: 'rgba(44, 62, 80, 0.95)',
                  color: 'white',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  pointerEvents: 'none',
                  zIndex: 1000,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  whiteSpace: 'nowrap'
                }}
              >
                <div style={{ fontWeight: '600', marginBottom: '4px', color: hoveredPoint.color }}>
                  {availableMetrics[hoveredPoint.metric]}
                </div>
                <div>Value: {hoveredPoint.value.toFixed(2)}</div>
                <div>Time: {hoveredPoint.label}</div>
              </div>
            )}
          </div>

          {/* Correlation Analysis */}
          {correlations.length > 0 && (
            <div style={{
              backgroundColor: 'white',
              border: '1px solid #dee2e6',
              borderRadius: '8px',
              padding: '20px'
            }}>
              <h4 style={{ marginBottom: '15px', color: '#2c3e50' }}>
                Correlation Analysis
              </h4>

              {/* Average correlation */}
              {averageCorrelation !== null && (
                <div style={{
                  padding: '12px',
                  backgroundColor: getCorrelationColor(averageCorrelation) + '20',
                  border: `2px solid ${getCorrelationColor(averageCorrelation)}`,
                  borderRadius: '6px',
                  marginBottom: '15px'
                }}>
                  <div style={{ fontWeight: '600', color: '#2c3e50' }}>
                    Average Correlation Strength: {getCorrelationLabel(averageCorrelation)}
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: getCorrelationColor(averageCorrelation) }}>
                    {averageCorrelation.toFixed(3)}
                  </div>
                </div>
              )}

              {/* Pairwise correlations */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '15px' }}>
                {correlations.map((corr, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '15px',
                      backgroundColor: corr.color + '10',
                      border: `1px solid ${corr.color}`,
                      borderRadius: '6px'
                    }}
                  >
                    <div style={{ fontWeight: '600', marginBottom: '8px', color: '#2c3e50' }}>
                      {availableMetrics[corr.metric1]} ↔ {availableMetrics[corr.metric2]}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#6c757d', marginBottom: '2px' }}>
                          Correlation
                        </div>
                        <div style={{ fontSize: '20px', fontWeight: 'bold', color: corr.color }}>
                          {corr.correlation.toFixed(3)}
                        </div>
                      </div>
                      <div style={{
                        padding: '4px 12px',
                        backgroundColor: corr.color,
                        color: 'white',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}>
                        {corr.strength}
                      </div>
                    </div>
                    {corr.correlation < 0 && (
                      <div style={{ marginTop: '8px', fontSize: '11px', color: '#6c757d' }}>
                        ⚠️ Negative correlation (inverse relationship)
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Interpretation guide */}
              <div style={{
                marginTop: '20px',
                padding: '15px',
                backgroundColor: '#f8f9fa',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#6c757d'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '8px', color: '#2c3e50' }}>
                  📖 How to Interpret Correlations:
                </div>
                <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                  <li><strong>0.9 to 1.0 / -0.9 to -1.0:</strong> Very strong correlation - metrics move together/opposite very reliably</li>
                  <li><strong>0.7 to 0.9 / -0.7 to -0.9:</strong> Strong correlation - metrics generally move together/opposite</li>
                  <li><strong>0.5 to 0.7 / -0.5 to -0.7:</strong> Moderate correlation - some relationship exists</li>
                  <li><strong>0.3 to 0.5 / -0.3 to -0.5:</strong> Weak correlation - slight relationship</li>
                  <li><strong>-0.3 to 0.3:</strong> Very weak/no correlation - metrics move independently</li>
                </ul>
                <div style={{ marginTop: '8px', fontStyle: 'italic' }}>
                  Positive values = metrics move together | Negative values = metrics move opposite
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MetricCorrelationChart;
