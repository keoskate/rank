import theme from '../../theme';

// Format a dollar amount with a true minus sign and grouped digits.
const fmt = (v, signed, decimals) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = n < 0 ? '−' : signed ? '+' : '';
  return `${sign}$${abs}`;
};

const SIZES = { sm: '0.85rem', md: '1rem', lg: '1.7rem', xl: '2.3rem' };

/**
 * Money — a financial figure in the app's command-center language:
 * monospace, tabular-nums, and P&L-colored with the muted palette.
 *
 * Props: value, signed, color ('pnl'|'neutral'), size ('sm'|'md'|'lg'|'xl'),
 *        sim (append a quiet "sim" tag), decimals, style.
 */
const Money = ({
  value,
  signed = false,
  color = 'pnl',
  size = 'md',
  sim = false,
  decimals = 2,
  style = {},
}) => {
  const n = Number(value) || 0;
  const c =
    color === 'neutral'
      ? theme.colors.charcoal
      : n >= 0
        ? theme.colors.successMuted
        : theme.colors.errorMuted;
  return (
    <span
      style={{
        fontFamily: theme.typography.fontFamilyMono,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 700,
        fontSize: SIZES[size] || SIZES.md,
        color: c,
        ...style,
      }}
    >
      {fmt(n, signed, decimals)}
      {sim && (
        <span
          style={{
            fontFamily: theme.typography.fontFamily,
            fontWeight: 400,
            fontSize: '0.62em',
            color: theme.colors.textMuted,
            marginLeft: 5,
            letterSpacing: '0.04em',
          }}
        >
          sim
        </span>
      )}
    </span>
  );
};

export default Money;
