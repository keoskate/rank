import React, { useState } from 'react';
import theme from '../../theme';

/**
 * SHARED BUTTON COMPONENT
 *
 * Standardized button with consistent styling across the app.
 *
 * Props:
 * - variant: 'primary' | 'success' | 'danger' | 'outline' | 'ghost'
 * - size: 'small' | 'medium' | 'large'
 * - disabled: boolean
 * - onClick: function
 * - children: button content
 * - style: additional inline styles (overrides)
 */
const Button = ({
  variant = 'primary',
  size = 'medium',
  disabled = false,
  onClick,
  children,
  style = {},
  ...props
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getVariantStyle = () => {
    const variants = {
      primary: {
        backgroundColor: isHovered ? theme.colors.infoDark : theme.colors.info,
        color: theme.colors.surface,
        border: 'none',
      },
      success: {
        backgroundColor: isHovered
          ? theme.colors.successDark
          : theme.colors.success,
        color: theme.colors.surface,
        border: 'none',
      },
      danger: {
        backgroundColor: isHovered
          ? theme.colors.errorDark
          : theme.colors.error,
        color: theme.colors.surface,
        border: 'none',
      },
      outline: {
        backgroundColor: isHovered ? theme.colors.info : 'transparent',
        color: isHovered ? theme.colors.surface : theme.colors.info,
        border: `2px solid ${theme.colors.info}`,
      },
      ghost: {
        backgroundColor: isHovered ? theme.colors.gray200 : 'transparent',
        color: theme.colors.text,
        border: 'none',
      },
    };
    return variants[variant] || variants.primary;
  };

  const getSizeStyle = () => {
    const sizes = {
      small: {
        padding: '6px 12px',
        fontSize: theme.typography.fontSize.sm,
      },
      medium: {
        padding: '8px 16px',
        fontSize: theme.typography.fontSize.base,
      },
      large: {
        padding: '12px 24px',
        fontSize: theme.typography.fontSize.md,
      },
    };
    return sizes[size] || sizes.medium;
  };

  const buttonStyle = {
    ...getSizeStyle(),
    ...getVariantStyle(),
    fontWeight: theme.typography.fontWeight.medium,
    borderRadius: theme.borderRadius.md,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: theme.transitions.normal,
    fontFamily: theme.typography.fontFamily,
    whiteSpace: 'nowrap',
    ...style,
  };

  return (
    <button
      style={buttonStyle}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
