/**
 * Trading Sessions List
 *
 * Shows all AI trading sessions with options to create new ones,
 * view details, or manage existing sessions.
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../common/Button';
import Card from '../common/Card';
import MetricCard from '../common/MetricCard';
import theme from '../../theme';

const TradingSessionsList = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [account, setAccount] = useState(null);

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions();
    fetchAccount();
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/ai/sessions/default_user');
      const data = await res.json();
      if (res.ok) {
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccount = async () => {
    try {
      const res = await fetch('/api/alpaca/account');
      const data = await res.json();
      if (res.ok) {
        setAccount(data.account || data);
      }
    } catch (err) {
      console.error('Failed to fetch account:', err);
    }
  };

  const createNewSession = async () => {
    if (!newSessionName.trim()) {
      setNewSessionName(`Strategy ${sessions.length + 1}`);
    }

    try {
      const res = await fetch('/api/ai/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'default_user',
          config: {
            name: newSessionName.trim() || `Strategy ${sessions.length + 1}`,
          },
        }),
      });

      const data = await res.json();
      if (res.ok && data.sessionId) {
        // Navigate to the new session
        navigate(`/live-trading/${data.sessionId}`);
      } else {
        setError(data.error || 'Failed to create session');
      }
    } catch (err) {
      setError('Failed to create session');
    }
  };

  const stopSession = async (sessionId, e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetch('/api/ai/session/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      fetchSessions();
    } catch (err) {
      console.error('Failed to stop session:', err);
    }
  };

  const pauseSession = async (sessionId, e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetch('/api/ai/session/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      fetchSessions();
    } catch (err) {
      console.error('Failed to pause session:', err);
    }
  };

  const resumeSession = async (sessionId, e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetch('/api/ai/session/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      fetchSessions();
    } catch (err) {
      console.error('Failed to resume session:', err);
    }
  };

  const formatCurrency = value => {
    if (value == null || isNaN(value)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

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

  const getStatusBg = status => {
    switch (status) {
      case 'running':
        return `${theme.colors.success}15`;
      case 'paused':
        return `${theme.colors.warning}15`;
      default:
        return theme.colors.gray100;
    }
  };

  const runningSessions = sessions.filter(s => s.status === 'running');
  const pausedSessions = sessions.filter(s => s.status === 'paused');
  const stoppedSessions = sessions.filter(s => s.status === 'stopped');

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: '1400px',
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.lg,
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: theme.colors.gray900 }}>
            AI Trading Sessions
          </h1>
          <p style={{ margin: '8px 0 0', color: theme.colors.gray600 }}>
            Manage your autonomous trading strategies
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowNewForm(true)}>
          + New Session
        </Button>
      </div>

      {/* Account Overview */}
      {account && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: theme.spacing.md,
            marginBottom: theme.spacing.lg,
          }}
        >
          <MetricCard
            title="Account Equity"
            value={formatCurrency(account.equity)}
            subtitle={`Cash: ${formatCurrency(account.buying_power)}`}
          />
          <MetricCard
            title="Active Sessions"
            value={runningSessions.length}
            subtitle={`${pausedSessions.length} paused`}
            variant={runningSessions.length > 0 ? 'success' : 'default'}
          />
          <MetricCard
            title="Total Sessions"
            value={sessions.length}
            subtitle={`${stoppedSessions.length} stopped`}
          />
        </div>
      )}

      {/* New Session Form */}
      {showNewForm && (
        <Card
          style={{ marginBottom: theme.spacing.lg, padding: theme.spacing.lg }}
        >
          <h3 style={{ marginTop: 0 }}>Create New Trading Session</h3>
          <div
            style={{
              display: 'flex',
              gap: theme.spacing.md,
              alignItems: 'flex-end',
            }}
          >
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  color: theme.colors.gray700,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Session Name
              </label>
              <input
                type="text"
                value={newSessionName}
                onChange={e => setNewSessionName(e.target.value)}
                placeholder={`Strategy ${sessions.length + 1}`}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.md,
                  fontSize: theme.typography.fontSize.md,
                }}
              />
            </div>
            <Button variant="primary" onClick={createNewSession}>
              Create & Configure
            </Button>
            <Button variant="secondary" onClick={() => setShowNewForm(false)}>
              Cancel
            </Button>
          </div>
          <p
            style={{
              margin: '12px 0 0',
              color: theme.colors.gray500,
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            You'll be taken to the session page to configure watchlist, risk
            settings, and start trading.
          </p>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card
          style={{
            marginBottom: theme.spacing.lg,
            padding: theme.spacing.md,
            backgroundColor: `${theme.colors.error}10`,
            border: `1px solid ${theme.colors.error}`,
          }}
        >
          <p style={{ margin: 0, color: theme.colors.error }}>{error}</p>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card style={{ padding: theme.spacing.xl, textAlign: 'center' }}>
          <p style={{ color: theme.colors.gray500 }}>Loading sessions...</p>
        </Card>
      )}

      {/* Sessions List */}
      {!loading && sessions.length === 0 && (
        <Card style={{ padding: theme.spacing.xl, textAlign: 'center' }}>
          <h3 style={{ color: theme.colors.gray700 }}>
            No Trading Sessions Yet
          </h3>
          <p style={{ color: theme.colors.gray500 }}>
            Create your first AI trading session to get started with autonomous
            trading.
          </p>
          <Button
            variant="primary"
            onClick={() => setShowNewForm(true)}
            style={{ marginTop: theme.spacing.md }}
          >
            Create First Session
          </Button>
        </Card>
      )}

      {/* Active Sessions */}
      {runningSessions.length > 0 && (
        <div style={{ marginBottom: theme.spacing.lg }}>
          <h2
            style={{
              color: theme.colors.success,
              fontSize: theme.typography.fontSize.lg,
              marginBottom: theme.spacing.md,
            }}
          >
            Running ({runningSessions.length})
          </h2>
          <div style={{ display: 'grid', gap: theme.spacing.md }}>
            {runningSessions.map(session => (
              <SessionCard
                key={session.sessionId}
                session={session}
                onStop={stopSession}
                onPause={pauseSession}
                onResume={resumeSession}
                formatCurrency={formatCurrency}
                getStatusColor={getStatusColor}
                getStatusBg={getStatusBg}
              />
            ))}
          </div>
        </div>
      )}

      {/* Paused Sessions */}
      {pausedSessions.length > 0 && (
        <div style={{ marginBottom: theme.spacing.lg }}>
          <h2
            style={{
              color: theme.colors.warning,
              fontSize: theme.typography.fontSize.lg,
              marginBottom: theme.spacing.md,
            }}
          >
            Paused ({pausedSessions.length})
          </h2>
          <div style={{ display: 'grid', gap: theme.spacing.md }}>
            {pausedSessions.map(session => (
              <SessionCard
                key={session.sessionId}
                session={session}
                onStop={stopSession}
                onPause={pauseSession}
                onResume={resumeSession}
                formatCurrency={formatCurrency}
                getStatusColor={getStatusColor}
                getStatusBg={getStatusBg}
              />
            ))}
          </div>
        </div>
      )}

      {/* Stopped Sessions */}
      {stoppedSessions.length > 0 && (
        <div>
          <h2
            style={{
              color: theme.colors.gray500,
              fontSize: theme.typography.fontSize.lg,
              marginBottom: theme.spacing.md,
            }}
          >
            Stopped ({stoppedSessions.length})
          </h2>
          <div style={{ display: 'grid', gap: theme.spacing.md }}>
            {stoppedSessions.map(session => (
              <SessionCard
                key={session.sessionId}
                session={session}
                onStop={stopSession}
                onPause={pauseSession}
                onResume={resumeSession}
                formatCurrency={formatCurrency}
                getStatusColor={getStatusColor}
                getStatusBg={getStatusBg}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Session Card Component
const SessionCard = ({
  session,
  onStop,
  onPause,
  onResume,
  formatCurrency,
  getStatusColor,
  getStatusBg,
}) => {
  const navigate = useNavigate();

  return (
    <Card
      style={{
        padding: theme.spacing.md,
        backgroundColor: getStatusBg(session.status),
        border: `1px solid ${getStatusColor(session.status)}30`,
        cursor: 'pointer',
        transition: 'transform 0.1s, box-shadow 0.1s',
      }}
      onClick={() => navigate(`/live-trading/${session.sessionId}`)}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = theme.shadows.md;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        {/* Session Info */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <h3 style={{ margin: 0, color: theme.colors.gray900 }}>
              {session.name || 'Unnamed Session'}
            </h3>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: theme.borderRadius.sm,
                backgroundColor: getStatusColor(session.status),
                color: 'white',
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium,
                textTransform: 'uppercase',
              }}
            >
              {session.status}
            </span>
          </div>

          {/* Watchlist preview */}
          {session.watchlist && (
            <p
              style={{
                margin: '8px 0 0',
                color: theme.colors.gray600,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              Watching: {session.watchlist.slice(0, 5).join(', ')}
              {session.watchlist.length > 5 &&
                ` +${session.watchlist.length - 5} more`}
            </p>
          )}

          {/* Stats row */}
          <div
            style={{
              display: 'flex',
              gap: theme.spacing.lg,
              marginTop: theme.spacing.sm,
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            {session.stats && (
              <>
                <span style={{ color: theme.colors.gray600 }}>
                  Trades: <strong>{session.stats.totalTrades || 0}</strong>
                </span>
                <span style={{ color: theme.colors.gray600 }}>
                  Win Rate:{' '}
                  <strong
                    style={{
                      color:
                        (session.stats.winRate || 0) >= 50
                          ? theme.colors.success
                          : theme.colors.gray700,
                    }}
                  >
                    {session.stats.winRate || 0}%
                  </strong>
                </span>
                <span
                  style={{
                    color:
                      (session.stats.totalPnL || 0) >= 0
                        ? theme.colors.success
                        : theme.colors.error,
                  }}
                >
                  P&L:{' '}
                  <strong>{formatCurrency(session.stats.totalPnL || 0)}</strong>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div
          style={{ display: 'flex', gap: theme.spacing.sm }}
          onClick={e => e.stopPropagation()}
        >
          {session.status === 'running' && (
            <Button
              size="small"
              variant="secondary"
              onClick={e => onPause(session.sessionId, e)}
            >
              Pause
            </Button>
          )}
          {session.status === 'paused' && (
            <Button
              size="small"
              variant="primary"
              onClick={e => onResume(session.sessionId, e)}
            >
              Resume
            </Button>
          )}
          {session.status !== 'stopped' && (
            <Button
              size="small"
              variant="danger"
              onClick={e => onStop(session.sessionId, e)}
            >
              Stop
            </Button>
          )}
          <Button
            size="small"
            variant="secondary"
            onClick={() => navigate(`/live-trading/${session.sessionId}`)}
          >
            View
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default TradingSessionsList;
