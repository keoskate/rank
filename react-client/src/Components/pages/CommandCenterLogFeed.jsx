import { useEffect, useRef, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';

const LEVEL_CONFIG = {
  EXEC: { color: theme.colors.success, icon: '$' },
  SIGNAL: { color: theme.colors.info, icon: '~' },
  ENTRY: { color: '#17a2b8', icon: '>' },
  EXIT: { color: theme.colors.warning, icon: '<' },
  ERROR: { color: theme.colors.error, icon: '!' },
  ALERT: { color: theme.colors.error, icon: '!' },
  INFO: { color: theme.colors.gray600, icon: '-' },
  DECISION: { color: theme.colors.info, icon: '?' },
};

const CommandCenterLogFeed = ({ logs, sentiment }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const formatTime = ts => fmtET(ts);

  return (
    <Card style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.sm,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: theme.typography.fontSize.md,
            fontWeight: theme.typography.fontWeight.bold,
          }}
        >
          Live Feed
        </h3>
        {sentiment && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.gray600,
            }}
          >
            <span
              style={{
                padding: '2px 6px',
                borderRadius: theme.borderRadius.sm,
                backgroundColor:
                  sentiment.direction === 'bullish'
                    ? `${theme.colors.success}20`
                    : sentiment.direction === 'bearish'
                      ? `${theme.colors.error}20`
                      : `${theme.colors.gray200}`,
                color:
                  sentiment.direction === 'bullish'
                    ? theme.colors.success
                    : sentiment.direction === 'bearish'
                      ? theme.colors.error
                      : theme.colors.gray600,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              SOXX {sentiment.direction || 'N/A'}
            </span>
            {sentiment.confidence != null && (
              <span>{(sentiment.confidence * 100).toFixed(0)}%</span>
            )}
            {sentiment.phase && <span>{sentiment.phase}</span>}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        style={{
          height: 250,
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: theme.typography.fontSize.xs,
          backgroundColor: theme.colors.gray900,
          color: theme.colors.gray300,
          borderRadius: theme.borderRadius.sm,
          padding: theme.spacing.sm,
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: theme.colors.gray500, padding: theme.spacing.md, textAlign: 'center' }}>
            Waiting for events...
          </div>
        ) : (
          logs.map((log, i) => {
            const cfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.INFO;
            return (
              <div
                key={i}
                style={{
                  padding: '2px 0',
                  lineHeight: 1.5,
                  borderBottom: `1px solid ${theme.colors.gray800 || '#2d2d2d'}`,
                }}
              >
                <span style={{ color: theme.colors.gray500 }}>
                  [{formatTime(log.timestamp)}]
                </span>{' '}
                <span style={{ color: cfg.color, fontWeight: theme.typography.fontWeight.medium }}>
                  {cfg.icon}
                </span>{' '}
                {log.session && (
                  <span style={{ color: theme.colors.gray500 }}>
                    [{log.session}]{' '}
                  </span>
                )}
                <span style={{ color: cfg.color }}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
};

export default memo(CommandCenterLogFeed);
