import { memo } from 'react';
import theme from '../../theme';

const StatusPill = ({ label, status }) => {
  const colors = {
    ok: theme.colors.success,
    degraded: theme.colors.warning,
    down: theme.colors.error,
    unknown: theme.colors.gray400,
  };
  const color = colors[status] || colors.unknown;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        backgroundColor: `${color}15`,
        borderRadius: theme.borderRadius.full,
        fontSize: theme.typography.fontSize.xs,
        fontWeight: theme.typography.fontWeight.medium,
        color: theme.colors.gray700,
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          boxShadow: status === 'ok' ? `0 0 4px ${color}80` : 'none',
        }}
      />
      {label}
    </div>
  );
};

const SystemHealthBar = ({ health, runningSessions, lastRefresh, wsConnected }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: `${theme.spacing.sm} ${theme.spacing.md}`,
        backgroundColor: theme.colors.gray100,
        borderRadius: theme.borderRadius.md,
        marginBottom: theme.spacing.md,
        flexWrap: 'wrap',
      }}
    >
      <StatusPill label="Server" status={health.server} />
      <StatusPill label="Alpaca" status={health.alpaca} />
      <StatusPill label="WebSocket" status={wsConnected ? 'ok' : 'down'} />
      <StatusPill label="Sentiment" status={health.sentiment} />
      <StatusPill
        label={`${runningSessions} Session${runningSessions !== 1 ? 's' : ''} Running`}
        status={runningSessions > 0 ? 'ok' : 'degraded'}
      />
      <div
        style={{
          marginLeft: 'auto',
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.gray500,
          fontFamily: 'monospace',
        }}
      >
        {lastRefresh
          ? `Updated ${lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
          : 'Loading...'}
      </div>
    </div>
  );
};

export default memo(SystemHealthBar);
