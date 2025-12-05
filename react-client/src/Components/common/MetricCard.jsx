import React from 'react';
import theme from '../../theme';

/**
 * SHARED METRIC CARD COMPONENT
 *
 * Displays a labeled metric value with consistent styling.
 *
 * Props:
 * - label/title: string (metric label - supports both names)
 * - value: string | number (metric value)
 * - subtext/subtitle: string (optional additional info - supports both names)
 * - variant: 'default' | 'success' | 'error' | 'warning' | 'info'
 * - style: additional inline styles (overrides)
 */
const MetricCard = ({
  label,
  title, // alias for label
  value,
  subtext,
  subtitle, // alias for subtext
  variant = 'default',
  style = {},
  ...props
}) => {
  // Support both label/title and subtext/subtitle
  const displayLabel = label || title;
  const displaySubtext = subtext || subtitle;

  const getVariantStyles = () => {
    const variants = {
      default: {
        labelColor: theme.colors.gray500,
        valueColor: theme.colors.gray900,
        bgColor: theme.colors.gray50,
        borderColor: theme.colors.gray200,
      },
      success: {
        labelColor: theme.colors.success,
        valueColor: theme.colors.success,
        bgColor: `${theme.colors.success}10`,
        borderColor: `${theme.colors.success}40`,
      },
      error: {
        labelColor: theme.colors.error,
        valueColor: theme.colors.error,
        bgColor: `${theme.colors.error}10`,
        borderColor: `${theme.colors.error}40`,
      },
      warning: {
        labelColor: theme.colors.warning,
        valueColor: theme.colors.warning,
        bgColor: `${theme.colors.warning}10`,
        borderColor: `${theme.colors.warning}40`,
      },
      info: {
        labelColor: theme.colors.info,
        valueColor: theme.colors.info,
        bgColor: `${theme.colors.info}10`,
        borderColor: `${theme.colors.info}40`,
      },
    };
    return variants[variant] || variants.default;
  };

  const colors = getVariantStyles();

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: theme.spacing.md,
    backgroundColor: colors.bgColor,
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${colors.borderColor}`,
    minWidth: '140px',
    ...style,
  };

  const labelStyle = {
    fontSize: theme.typography.fontSize.xs,
    color: colors.labelColor,
    fontWeight: theme.typography.fontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const valueStyle = {
    fontSize: theme.typography.fontSize.xl,
    color: colors.valueColor,
    fontWeight: theme.typography.fontWeight.bold,
    lineHeight: 1.2,
  };

  const subtextStyle = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.gray500,
    marginTop: '2px',
  };

  return (
    <div style={containerStyle} {...props}>
      <div style={labelStyle}>{displayLabel}</div>
      <div style={valueStyle}>{value}</div>
      {displaySubtext && <div style={subtextStyle}>{displaySubtext}</div>}
    </div>
  );
};

export default MetricCard;
