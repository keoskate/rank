/**
 * DATA QUALITY BADGE
 *
 * Visual indicator for data confidence and validation status.
 * Shows users which metrics are trustworthy vs estimated.
 *
 * Props:
 * - confidence: number (0-1) - confidence score
 * - status: string - validation status ('verified', 'acceptable', 'questionable', 'unreliable', 'single-source', 'missing')
 * - sources: string[] - data sources used
 * - showLabel: boolean - whether to show text label
 * - size: 'small'|'medium'|'large'
 */

import React, { useState } from 'react';
import { getConfidenceLevel } from '../api/dataValidator';

const DataQualityBadge = ({
  confidence,
  status,
  sources = [],
  showLabel = false,
  size = 'small',
  style = {},
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  if (confidence === undefined && !status) {
    return null; // No validation data available
  }

  const confidenceInfo =
    confidence !== undefined
      ? getConfidenceLevel(confidence)
      : getStatusInfo(status);

  const sizes = {
    small: { fontSize: '11px', padding: '2px 6px', iconSize: '10px' },
    medium: { fontSize: '12px', padding: '4px 8px', iconSize: '12px' },
    large: { fontSize: '14px', padding: '6px 12px', iconSize: '14px' },
  };

  const sizeStyle = sizes[size] || sizes.small;

  const badgeStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: confidenceInfo.color + '20', // 20% opacity
    border: `1px solid ${confidenceInfo.color}`,
    borderRadius: '12px',
    padding: sizeStyle.padding,
    fontSize: sizeStyle.fontSize,
    fontWeight: '600',
    color: confidenceInfo.color,
    cursor: 'pointer',
    position: 'relative',
    ...style,
  };

  const iconStyle = {
    fontSize: sizeStyle.iconSize,
    fontWeight: 'bold',
  };

  const tooltipStyle = {
    position: 'absolute',
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: '8px',
    backgroundColor: '#2c3e50',
    color: 'white',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '11px',
    whiteSpace: 'nowrap',
    zIndex: 1000,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    pointerEvents: 'none',
  };

  const arrowStyle = {
    position: 'absolute',
    top: '-4px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 0,
    height: 0,
    borderLeft: '4px solid transparent',
    borderRight: '4px solid transparent',
    borderBottom: '4px solid #2c3e50',
  };

  return (
    <div
      style={badgeStyle}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      title={`Confidence: ${confidence ? (confidence * 100).toFixed(1) + '%' : status}`}
    >
      <span style={iconStyle}>{confidenceInfo.icon}</span>
      {showLabel && <span>{confidenceInfo.label}</span>}
      {confidence !== undefined && !showLabel && (
        <span>{(confidence * 100).toFixed(0)}%</span>
      )}

      {showTooltip && (
        <div style={tooltipStyle}>
          <div style={arrowStyle} />
          <div style={{ fontWeight: '600', marginBottom: '4px' }}>
            {confidenceInfo.label}
          </div>
          {confidence !== undefined && (
            <div>Confidence: {(confidence * 100).toFixed(1)}%</div>
          )}
          {sources.length > 0 && <div>Sources: {sources.join(', ')}</div>}
          {status && <div>Status: {status}</div>}
        </div>
      )}
    </div>
  );
};

/**
 * Get status info for non-confidence statuses
 */
function getStatusInfo(status) {
  switch (status) {
    case 'verified':
      return { level: 'high', label: 'Verified', color: '#28a745', icon: '✓' };
    case 'acceptable':
      return {
        level: 'medium',
        label: 'Acceptable',
        color: '#ffc107',
        icon: '~',
      };
    case 'questionable':
      return {
        level: 'low',
        label: 'Questionable',
        color: '#fd7e14',
        icon: '?',
      };
    case 'single-source':
      return {
        level: 'medium',
        label: 'Single Source',
        color: '#17a2b8',
        icon: '○',
      };
    case 'missing':
      return {
        level: 'unreliable',
        label: 'Missing',
        color: '#6c757d',
        icon: '−',
      };
    case 'unreliable':
    default:
      return {
        level: 'unreliable',
        label: 'Unreliable',
        color: '#dc3545',
        icon: '✗',
      };
  }
}

export default DataQualityBadge;
