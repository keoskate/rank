/**
 * DESIGN SYSTEM - Theme Configuration
 *
 * Centralized theme for consistent styling across the application.
 * Use these values instead of hardcoded colors/spacing.
 */

export const theme = {
  // Color Palette
  colors: {
    // Primary Brand
    primary: '#2c3e50',
    primaryLight: '#34495e',
    primaryDark: '#1a252f',

    // Semantic Colors
    success: '#28a745',
    successLight: '#d4edda',
    successBorder: '#c3e6cb',
    successDark: '#155724',

    error: '#dc3545',
    errorLight: '#f8d7da',
    errorBorder: '#f5c6cb',
    errorDark: '#721c24',

    warning: '#ffc107',
    warningLight: '#fff3cd',
    warningBorder: '#ffeeba',
    warningDark: '#856404',

    info: '#007bff',
    infoLight: '#e7f3ff',
    infoBorder: '#bee5eb',
    infoDark: '#004085',

    // Neutral/Gray Scale
    gray100: '#f8f9fa',
    gray200: '#e9ecef',
    gray300: '#dee2e6',
    gray400: '#ced4da',
    gray500: '#adb5bd',
    gray600: '#6c757d',
    gray700: '#495057',
    gray800: '#343a40',
    gray900: '#212529',

    // Background & Text
    background: '#f8f9fa',
    surface: '#ffffff',
    text: '#212529',
    textLight: '#6c757d',
    textMuted: '#999999',

    // Special Colors (from existing nav)
    navRankings: '#3498db',
    navBacktest: '#9b59b6',
    navPaper: '#e67e22',
    navAI: '#6f42c1',
    navDay: '#fd7e14',
    navInvest: '#27ae60',

    // Retro/analog palette — warm parchment + charcoal + muted accents.
    // Additive tokens for the command center aesthetic refresh.
    // Use the muted variants for steady-state UI; reserve the bright
    // semantic colors (success/error/etc) for moments that need to pop
    // (price-tick flashes, urgent alerts).
    parchment: '#faf8f1',      // warm off-white page background
    paper: '#fafaf5',          // slightly cooler off-white for cards
    charcoal: '#1a1a1a',       // primary text
    ink: '#2a2825',            // secondary text
    ruler: '#d8d4c8',          // subtle warm border line
    successMuted: '#5a7a4f',   // forest green
    errorMuted: '#a85546',     // terracotta red
    warningMuted: '#b08a3e',   // amber
  },

  // Spacing Scale (8px base unit)
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },

  // Typography
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontFamilyMono:
      '"SF Mono", "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
    fontSize: {
      xs: '11px',
      sm: '12px',
      base: '14px',
      md: '16px',
      lg: '18px',
      xl: '20px',
      xxl: '24px',
    },
    fontWeight: {
      normal: '400',
      medium: '600',
      bold: '700',
    },
  },

  // Border Radius
  borderRadius: {
    xs: '2px',  // retro-analog feel
    sm: '4px',
    md: '6px',
    lg: '8px',
    xl: '12px',
    full: '9999px',
  },

  // Shadows
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 2px 8px rgba(0,0,0,0.1)',
    lg: '0 4px 12px rgba(0,0,0,0.15)',
  },

  // Layout
  layout: {
    maxWidthNarrow: '800px',
    maxWidthMedium: '1200px',
    maxWidthWide: '1600px',
    contentPadding: '24px',
  },

  // Transitions
  transitions: {
    fast: '0.15s ease',
    normal: '0.2s ease',
    slow: '0.3s ease',
  },
};

// Helper function to create button styles
export const createButtonStyle = (variant = 'primary', size = 'medium') => {
  const baseStyle = {
    padding:
      size === 'small'
        ? '6px 12px'
        : size === 'large'
          ? '12px 24px'
          : '8px 16px',
    fontSize:
      size === 'small'
        ? theme.typography.fontSize.sm
        : theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.medium,
    border: 'none',
    borderRadius: theme.borderRadius.md,
    cursor: 'pointer',
    transition: theme.transitions.normal,
    fontFamily: theme.typography.fontFamily,
  };

  const variants = {
    primary: {
      backgroundColor: theme.colors.info,
      color: theme.colors.surface,
      '&:hover': { backgroundColor: theme.colors.infoDark },
    },
    success: {
      backgroundColor: theme.colors.success,
      color: theme.colors.surface,
      '&:hover': { backgroundColor: theme.colors.successDark },
    },
    danger: {
      backgroundColor: theme.colors.error,
      color: theme.colors.surface,
      '&:hover': { backgroundColor: theme.colors.errorDark },
    },
    outline: {
      backgroundColor: 'transparent',
      color: theme.colors.info,
      border: `2px solid ${theme.colors.info}`,
      '&:hover': {
        backgroundColor: theme.colors.info,
        color: theme.colors.surface,
      },
    },
  };

  return { ...baseStyle, ...variants[variant] };
};

// Helper function to create card styles
export const createCardStyle = (variant = 'default') => {
  const baseStyle = {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.lg,
    boxShadow: theme.shadows.sm,
  };

  const variants = {
    default: {},
    success: {
      backgroundColor: theme.colors.successLight,
      border: `1px solid ${theme.colors.successBorder}`,
    },
    error: {
      backgroundColor: theme.colors.errorLight,
      border: `1px solid ${theme.colors.errorBorder}`,
    },
    warning: {
      backgroundColor: theme.colors.warningLight,
      border: `1px solid ${theme.colors.warningBorder}`,
    },
    info: {
      backgroundColor: theme.colors.infoLight,
      border: `1px solid ${theme.colors.infoBorder}`,
    },
  };

  return { ...baseStyle, ...variants[variant] };
};

export default theme;
