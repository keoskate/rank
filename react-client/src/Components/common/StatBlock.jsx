import theme from '../../theme';

/**
 * StatBlock — a labelled metric in the command-center language: a small
 * uppercase ink label over a large mono/tabular value. Use `divider` to draw
 * a thin ruler rule on the left (for stat rows).
 */
const StatBlock = ({
  label,
  value,
  color,
  divider = false,
  style = {},
}) => (
  <div
    style={{
      padding: `0 ${theme.spacing.lg}`,
      borderLeft: divider ? `1px solid ${theme.colors.ruler}` : 'none',
      ...style,
    }}
  >
    <div
      style={{
        fontSize: theme.typography.fontSize.xs,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: theme.colors.ink,
        marginBottom: 5,
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontFamily: theme.typography.fontFamilyMono,
        fontVariantNumeric: 'tabular-nums',
        fontSize: theme.typography.fontSize.xl,
        fontWeight: 700,
        color: color || theme.colors.charcoal,
        lineHeight: 1.1,
      }}
    >
      {value}
    </div>
  </div>
);

export default StatBlock;
