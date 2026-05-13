import { memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';

const formatCurrency = (value) => {
  if (value == null || isNaN(value)) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

const formatPercent = (value) => {
  if (value == null || isNaN(value)) return '--';
  const num = parseFloat(value);
  return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`;
};

const timeAgo = (timestamp) => {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
};

const ConfigBadge = ({ label, active }) => (
  <span
    style={{
      fontSize: '10px',
      padding: '1px 6px',
      borderRadius: theme.borderRadius.full,
      backgroundColor: active ? `${theme.colors.info}20` : theme.colors.gray200,
      color: active ? theme.colors.info : theme.colors.gray500,
      fontWeight: theme.typography.fontWeight.medium,
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </span>
);

const StatusDot = ({ status }) => {
  const color =
    status === 'running'
      ? theme.colors.success
      : status === 'paused'
        ? theme.colors.warning
        : theme.colors.gray400;
  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        display: 'inline-block',
        marginRight: 6,
        boxShadow: status === 'running' ? `0 0 6px ${color}` : 'none',
      }}
    />
  );
};

const SessionCard = memo(({ session, isFlashing }) => {
  const { stats = {}, positions = [], recentDecisions = [], config = {} } = session;
  const lastDecision = recentDecisions[0];
  const pnl = stats.totalPnL || 0;
  const unrealizedPnL = positions.reduce(
    (sum, p) => sum + parseFloat(p.unrealizedPnL || p.unrealized_pl || 0),
    0
  );

  return (
    <Card
      style={{
        transition: 'box-shadow 0.3s ease',
        boxShadow: isFlashing ? `0 0 12px ${theme.colors.success}60` : theme.shadows.sm,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.sm,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <StatusDot status={session.status} />
          <span
            style={{
              fontSize: theme.typography.fontSize.base,
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            {session.name || session.sessionId}
          </span>
        </div>
        {session.circuitBreaker?.triggered && (
          <span
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: theme.borderRadius.sm,
              backgroundColor: `${theme.colors.error}20`,
              color: theme.colors.error,
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            CIRCUIT BREAKER
          </span>
        )}
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: theme.spacing.xs,
          marginBottom: theme.spacing.sm,
          fontSize: theme.typography.fontSize.xs,
        }}
      >
        <div>
          <div style={{ color: theme.colors.gray500 }}>Realized P&L</div>
          <div
            style={{
              fontWeight: theme.typography.fontWeight.bold,
              fontSize: theme.typography.fontSize.sm,
              color: pnl >= 0 ? theme.colors.success : theme.colors.error,
            }}
          >
            {formatCurrency(pnl)}
          </div>
        </div>
        <div>
          <div style={{ color: theme.colors.gray500 }}>Unrealized</div>
          <div
            style={{
              fontWeight: theme.typography.fontWeight.bold,
              fontSize: theme.typography.fontSize.sm,
              color: unrealizedPnL >= 0 ? theme.colors.success : theme.colors.error,
            }}
          >
            {formatCurrency(unrealizedPnL)}
          </div>
        </div>
        <div>
          <div style={{ color: theme.colors.gray500 }}>Win Rate</div>
          <div style={{ fontWeight: theme.typography.fontWeight.bold, fontSize: theme.typography.fontSize.sm }}>
            {stats.winRate != null ? `${(typeof stats.winRate === 'number' && stats.winRate <= 1 ? stats.winRate * 100 : stats.winRate).toFixed(0)}%` : '--'}
          </div>
        </div>
        <div>
          <div style={{ color: theme.colors.gray500 }}>Trades</div>
          <div style={{ fontWeight: theme.typography.fontWeight.bold, fontSize: theme.typography.fontSize.sm }}>
            {stats.totalTrades || 0}
          </div>
        </div>
      </div>

      {/* Open Positions */}
      {positions.length > 0 && (
        <div
          style={{
            marginBottom: theme.spacing.sm,
            padding: theme.spacing.xs,
            backgroundColor: theme.colors.gray100,
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.xs,
          }}
        >
          {positions.slice(0, 4).map((pos) => {
            const uPnl = parseFloat(pos.unrealizedPnL || pos.unrealized_pl || 0);
            const uPnlPct = parseFloat(pos.unrealizedPnLPercent || pos.unrealized_plpc || 0);
            return (
              <div
                key={pos.symbol}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '2px 0',
                }}
              >
                <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
                  {pos.symbol} x{pos.quantity || pos.qty}
                </span>
                <span
                  style={{
                    color: uPnl >= 0 ? theme.colors.success : theme.colors.error,
                    fontWeight: theme.typography.fontWeight.medium,
                  }}
                >
                  {formatPercent(uPnlPct * 100)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Last Signal */}
      {lastDecision && (
        <div
          style={{
            marginBottom: theme.spacing.sm,
            padding: theme.spacing.xs,
            backgroundColor:
              lastDecision.action === 'BUY'
                ? `${theme.colors.success}10`
                : lastDecision.action === 'SELL' || lastDecision.action === 'EXIT'
                  ? `${theme.colors.error}10`
                  : `${theme.colors.gray100}`,
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.xs,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <span
                style={{
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    lastDecision.action === 'BUY'
                      ? theme.colors.success
                      : lastDecision.action === 'SELL' || lastDecision.action === 'EXIT'
                        ? theme.colors.error
                        : theme.colors.gray700,
                }}
              >
                {lastDecision.action}
              </span>{' '}
              {lastDecision.symbol}
              {lastDecision.confidence != null && (
                <span style={{ color: theme.colors.gray500 }}>
                  {' '}({(lastDecision.confidence * 100).toFixed(0)}%)
                </span>
              )}
            </span>
            <span style={{ color: theme.colors.gray500 }}>{timeAgo(lastDecision.timestamp)}</span>
          </div>
        </div>
      )}

      {/* Config Badges */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        <ConfigBadge label={config.autoTrade ? 'AUTO' : 'MANUAL'} active={config.autoTrade} />
        {config.useSentimentGating && <ConfigBadge label="GATE" active />}
        {config.strategy && <ConfigBadge label={config.strategy} active />}
        {config.symbols && (
          <ConfigBadge
            label={Array.isArray(config.symbols) ? config.symbols.join('/') : config.symbols}
            active
          />
        )}
      </div>
    </Card>
  );
});

const SessionCardGrid = ({ sessions, flashTrades }) => {
  if (!sessions || sessions.length === 0) {
    return (
      <Card style={{ textAlign: 'center', padding: theme.spacing.xl, color: theme.colors.gray500 }}>
        No active trading sessions. Start a session from the Live Trading page.
      </Card>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: theme.spacing.md,
        marginBottom: theme.spacing.md,
      }}
    >
      {sessions.map((session) => (
        <SessionCard
          key={session.sessionId}
          session={session}
          isFlashing={flashTrades.has(session.sessionId)}
        />
      ))}
    </div>
  );
};

export default memo(SessionCardGrid);
