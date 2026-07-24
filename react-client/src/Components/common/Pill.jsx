import theme from '../../theme';

// Restrained, mono, uppercase pills — the DirectionBadge pattern from
// scanner/OpportunityTable. Reserve filled tones for money-world / P&L; use
// the outline 'paper' tone for quiet metadata like status.
const TONES = {
  paper: { bg: 'transparent', fg: theme.colors.ink, border: theme.colors.ruler },
  neutral: { bg: theme.colors.ruler, fg: theme.colors.ink },
  ink: { bg: theme.colors.charcoal, fg: theme.colors.parchment },
  good: { bg: theme.colors.successMuted, fg: '#fff' },
  bad: { bg: theme.colors.errorMuted, fg: '#fff' },
  warn: { bg: theme.colors.warningMuted, fg: '#fff' },
};

const Pill = ({ label, tone = 'paper', title, style = {} }) => {
  const t = TONES[tone] || TONES.paper;
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        fontFamily: theme.typography.fontFamilyMono,
        fontSize: '0.66rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: t.fg,
        background: t.bg,
        border: t.border ? `1px solid ${t.border}` : '1px solid transparent',
        borderRadius: theme.borderRadius.xs,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
        ...style,
      }}
    >
      {label}
    </span>
  );
};

export default Pill;
