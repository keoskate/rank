import React from 'react';
import theme from '../../theme';

/**
 * SHARED CARD COMPONENT
 *
 * Standardized card container with consistent styling.
 *
 * Props:
 * - variant: 'default' | 'success' | 'error' | 'warning' | 'info'
 * - padding: 'none' | 'small' | 'medium' | 'large' (defaults to 'medium')
 * - children: card content
 * - style: additional inline styles (overrides)
 */
const Card = ({
  variant = 'default',
  padding = 'medium',
  children,
  style = {},
  ...props
}) => {
  const getVariantStyle = () => {
    const variants = {
      default: {
        backgroundColor: theme.colors.paper || theme.colors.surface,
        border: `1px solid ${theme.colors.ruler || theme.colors.gray300}`,
      },
      success: {
        backgroundColor: theme.colors.successLight,
        border: `1px solid ${theme.colors.success}`,
      },
      error: {
        backgroundColor: theme.colors.errorLight,
        border: `1px solid ${theme.colors.error}`,
      },
      warning: {
        backgroundColor: theme.colors.warningLight,
        border: `1px solid ${theme.colors.warning}`,
      },
      info: {
        backgroundColor: theme.colors.infoLight,
        border: `1px solid ${theme.colors.info}`,
      },
    };
    return variants[variant] || variants.default;
  };

  const getPaddingStyle = () => {
    const paddingMap = {
      none: '0',
      small: theme.spacing.sm,
      medium: theme.spacing.md,
      large: theme.spacing.lg,
    };
    return paddingMap[padding] || paddingMap.medium;
  };

  const cardStyle = {
    ...getVariantStyle(),
    padding: getPaddingStyle(),
    borderRadius: theme.borderRadius.xs || theme.borderRadius.sm,
    ...style,
  };

  return (
    <div style={cardStyle} {...props}>
      {children}
    </div>
  );
};

export default Card;
