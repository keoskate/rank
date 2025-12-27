/**
 * Session Tab Bar
 *
 * Horizontal tab bar for switching between open trading sessions.
 * Shows session name, status indicator, and P&L for each tab.
 */

import theme from '../../theme';

const SessionTabBar = ({
  sessions = [],
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onOpenSessionPicker,
}) => {
  const getStatusColor = status => {
    switch (status) {
      case 'running':
        return theme.colors.success;
      case 'paused':
        return theme.colors.warning;
      case 'stopped':
      default:
        return theme.colors.gray500;
    }
  };

  const formatPnL = value => {
    if (value == null || isNaN(value)) return '';
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.abs(value));
    return value >= 0 ? `+${formatted}` : `-${formatted}`;
  };

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        backgroundColor: theme.colors.gray100,
        borderBottom: `1px solid ${theme.colors.gray300}`,
        padding: `0 ${theme.spacing.md}`,
        minHeight: '44px',
        gap: theme.spacing.xs,
        overflowX: 'auto',
      }}
    >
      {sessions.map(session => {
        const isActive = session.sessionId === activeSessionId;
        // Show unrealized P&L from open positions (more relevant than realized P&L)
        const unrealizedPnL = session.positions?.reduce(
          (sum, pos) => sum + (pos.unrealizedPnL || pos.unrealizedPL || 0),
          0
        );
        // Fall back to realized P&L if no positions
        const pnl = unrealizedPnL || session.stats?.totalPnL;

        return (
          <div
            key={session.sessionId}
            onClick={() => onSelectSession(session.sessionId)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              padding: `${theme.spacing.sm} ${theme.spacing.md}`,
              backgroundColor: isActive ? theme.colors.surface : 'transparent',
              borderRadius: `${theme.borderRadius.md} ${theme.borderRadius.md} 0 0`,
              borderBottom: isActive
                ? `2px solid ${theme.colors.info}`
                : '2px solid transparent',
              cursor: 'pointer',
              transition: theme.transitions.fast,
              whiteSpace: 'nowrap',
              marginBottom: '-1px',
            }}
            onMouseEnter={e => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = theme.colors.gray200;
              }
            }}
            onMouseLeave={e => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            {/* Status dot */}
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: getStatusColor(session.status),
                flexShrink: 0,
              }}
            />

            {/* Session name */}
            <span
              style={{
                fontSize: theme.typography.fontSize.sm,
                fontWeight: isActive
                  ? theme.typography.fontWeight.medium
                  : theme.typography.fontWeight.normal,
                color: isActive ? theme.colors.gray900 : theme.colors.gray700,
                maxWidth: '150px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {session.name || 'Unnamed'}
            </span>

            {/* P&L badge */}
            {pnl != null && pnl !== 0 && (
              <span
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                  color: pnl >= 0 ? theme.colors.success : theme.colors.error,
                  backgroundColor:
                    pnl >= 0
                      ? theme.colors.successLight
                      : theme.colors.errorLight,
                  padding: '2px 6px',
                  borderRadius: theme.borderRadius.sm,
                }}
              >
                {formatPnL(pnl)}
              </span>
            )}

            {/* Close button */}
            <button
              onClick={e => {
                e.stopPropagation();
                onCloseSession(session.sessionId);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '18px',
                height: '18px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                borderRadius: theme.borderRadius.sm,
                color: theme.colors.gray500,
                fontSize: '14px',
                lineHeight: 1,
                padding: 0,
                transition: theme.transitions.fast,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = theme.colors.gray300;
                e.currentTarget.style.color = theme.colors.gray700;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = theme.colors.gray500;
              }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        );
      })}

      {/* Add tab button */}
      <button
        onClick={onOpenSessionPicker}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          border: `1px dashed ${theme.colors.gray400}`,
          background: 'transparent',
          cursor: 'pointer',
          borderRadius: theme.borderRadius.sm,
          color: theme.colors.gray500,
          fontSize: '16px',
          marginLeft: theme.spacing.xs,
          transition: theme.transitions.fast,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = theme.colors.gray200;
          e.currentTarget.style.borderColor = theme.colors.gray500;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.borderColor = theme.colors.gray400;
        }}
        title="Open another session"
      >
        +
      </button>
    </div>
  );
};

export default SessionTabBar;
