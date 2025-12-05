import React from 'react';
import theme from '../../theme';

/**
 * SHARED METRIC CARD COMPONENT
 *
 * Displays a labeled metric value with consistent styling.
 *
 * Props:
 * - label: string (metric label)
 * - value: string | number (metric value)
 * - subtext: string (optional additional info)
 * - variant: 'default' | 'success' | 'error' | 'warning' | 'info'
 * - style: additional inline styles (overrides)
 */
const MetricCard = ({
  label,
  value,
  subtext,
  variant = 'default',
  style = {},
  ...props
}) => {
  const getVariantColors = () => {
    const variants = {
      default: {
        labelColor: theme.colors.textLight,
        valueColor: theme.colors.text,
      },
      success: {
        labelColor: theme.colors.successDark,
        valueColor: theme.colors.successDark,
      },
      error: {
        labelColor: theme.colors.errorDark,
        valueColor: theme.colors.errorDark,
      },
      warning: {
        labelColor: theme.colors.warningDark,
        valueColor: theme.colors.warningDark,
      },
      info: {
        labelColor: theme.colors.infoDark,
        valueColor: theme.colors.infoDark,
      },
    };
    return variants[variant] || variants.default;
  };

  const colors = getVariantColors();

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
    ...style,
  };

  const labelStyle = {
    fontSize: theme.typography.fontSize.sm,
    color: colors.labelColor,
    fontWeight: theme.typography.fontWeight.normal,
  };

  const valueStyle = {
    fontSize: theme.typography.fontSize.xl,
    color: colors.valueColor,
    fontWeight: theme.typography.fontWeight.bold,
  };

  const subtextStyle = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  };

  return (
    <div style={containerStyle} {...props}>
      <div style={labelStyle}>{label}</div>
      <div style={valueStyle}>{value}</div>
      {subtext && <div style={subtextStyle}>{subtext}</div>}
    </div>
  );
};

export default MetricCard;
