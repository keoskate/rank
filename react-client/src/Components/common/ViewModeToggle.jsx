import theme from '../../theme';

/**
 * ViewModeToggle — a compact "Easy | Full" segmented control for the
 * live-trading UI. Easy = curated MVP view; Full = everything.
 *
 * Props:
 *   mode: 'easy' | 'full'      current mode
 *   onToggle: () => void       flip between easy/full
 */
const ViewModeToggle = ({ mode = 'easy', onToggle }) => {
  const segStyle = active => ({
    padding: '5px 12px',
    fontSize: theme.typography.fontSize.sm,
    fontWeight: active
      ? theme.typography.fontWeight.bold
      : theme.typography.fontWeight.medium,
    color: active ? '#fff' : theme.colors.gray600,
    background: active ? theme.colors.primary : 'transparent',
    border: 'none',
    cursor: active ? 'default' : 'pointer',
    transition: theme.transitions.fast,
  });

  const select = target => {
    if (mode !== target && onToggle) onToggle();
  };

  return (
    <div
      title="Easy = simplified view (real vs practice, key controls). Full = every panel and advanced control."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: `1px solid ${theme.colors.gray300}`,
        borderRadius: theme.borderRadius.full,
        overflow: 'hidden',
        background: theme.colors.gray100,
      }}
    >
      <span
        style={{
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.textMuted,
          padding: '0 8px 0 10px',
          userSelect: 'none',
        }}
      >
        View
      </span>
      <button
        type="button"
        onClick={() => select('easy')}
        style={{ ...segStyle(mode === 'easy'), borderRadius: theme.borderRadius.full }}
      >
        Easy
      </button>
      <button
        type="button"
        onClick={() => select('full')}
        style={{ ...segStyle(mode === 'full'), borderRadius: theme.borderRadius.full }}
      >
        Full
      </button>
    </div>
  );
};

export default ViewModeToggle;
