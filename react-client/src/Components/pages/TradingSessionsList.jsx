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
  // Clone modal state
  const [cloneModalSession, setCloneModalSession] = useState(null);
  const [cloneName, setCloneName] = useState('');
  const [clonePaperTrading, setClonePaperTrading] = useState(true);

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

  const deleteSession = async (sessionId, sessionName, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        `Are you sure you want to permanently delete "${sessionName}"? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/ai/session/${sessionId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchSessions();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to delete session');
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
      setError('Failed to delete session');
    }
  };

  // Open clone modal
  const openCloneModal = (session, e) => {
    e.preventDefault();
    e.stopPropagation();
    setCloneModalSession(session);
    setCloneName(`${session.name} (Copy)`);
    setClonePaperTrading(true); // Default to paper trading for safety
  };

  // Close clone modal
  const closeCloneModal = () => {
    setCloneModalSession(null);
    setCloneName('');
  };

  // Clone session
  const cloneSession = async () => {
    if (!cloneModalSession) return;

    try {
      const res = await fetch('/api/ai/session/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: cloneModalSession.sessionId,
          name: cloneName.trim() || `${cloneModalSession.name} (Copy)`,
          paperTrading: clonePaperTrading,
        }),
      });

      const data = await res.json();
      if (res.ok && data.sessionId) {
        closeCloneModal();
        fetchSessions();
        // Navigate to the cloned session
        navigate(`/live-trading/${data.sessionId}`);
      } else {
        setError(data.error || 'Failed to clone session');
      }
    } catch (err) {
      console.error('Failed to clone session:', err);
      setError('Failed to clone session');
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
                onDelete={deleteSession}
                onClone={openCloneModal}
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
                onDelete={deleteSession}
                onClone={openCloneModal}
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
                onDelete={deleteSession}
                onClone={openCloneModal}
                formatCurrency={formatCurrency}
                getStatusColor={getStatusColor}
                getStatusBg={getStatusBg}
              />
            ))}
          </div>
        </div>
      )}

      {/* Clone Session Modal */}
      {cloneModalSession && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={closeCloneModal}
        >
          <Card
            style={{
              width: '100%',
              maxWidth: '500px',
              padding: theme.spacing.xl,
              margin: theme.spacing.lg,
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, color: theme.colors.gray900 }}>
              Clone Session
            </h2>
            <p style={{ color: theme.colors.gray600, marginBottom: theme.spacing.lg }}>
              Create a copy of "<strong>{cloneModalSession.name}</strong>" with all its
              configuration. The clone will start paused so you can review settings.
            </p>

            {/* Clone Name */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  color: theme.colors.gray700,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                New Session Name
              </label>
              <input
                type="text"
                value={cloneName}
                onChange={e => setCloneName(e.target.value)}
                placeholder={`${cloneModalSession.name} (Copy)`}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.md,
                  fontSize: theme.typography.fontSize.md,
                }}
              />
            </div>

            {/* Trading Mode Selection */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.sm,
                  color: theme.colors.gray700,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Trading Mode
              </label>
              <div style={{ display: 'flex', gap: theme.spacing.md }}>
                <label
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    border: `2px solid ${clonePaperTrading ? theme.colors.primary : theme.colors.gray300}`,
                    borderRadius: theme.borderRadius.md,
                    cursor: 'pointer',
                    backgroundColor: clonePaperTrading ? `${theme.colors.primary}10` : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="tradingMode"
                    checked={clonePaperTrading}
                    onChange={() => setClonePaperTrading(true)}
                  />
                  <div>
                    <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                      Paper Trading
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                      Simulated trades, no real money
                    </div>
                  </div>
                </label>
                <label
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    border: `2px solid ${!clonePaperTrading ? theme.colors.warning : theme.colors.gray300}`,
                    borderRadius: theme.borderRadius.md,
                    cursor: 'pointer',
                    backgroundColor: !clonePaperTrading ? `${theme.colors.warning}10` : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="tradingMode"
                    checked={!clonePaperTrading}
                    onChange={() => setClonePaperTrading(false)}
                  />
                  <div>
                    <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                      Live Trading
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.warning }}>
                      Real money, real trades
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Warning for live trading */}
            {!clonePaperTrading && (
              <div
                style={{
                  padding: theme.spacing.md,
                  backgroundColor: `${theme.colors.warning}15`,
                  border: `1px solid ${theme.colors.warning}`,
                  borderRadius: theme.borderRadius.md,
                  marginBottom: theme.spacing.lg,
                }}
              >
                <p style={{ margin: 0, color: theme.colors.warning, fontWeight: theme.typography.fontWeight.medium }}>
                  ⚠️ Live Trading Warning
                </p>
                <p style={{ margin: '8px 0 0', color: theme.colors.gray700, fontSize: theme.typography.fontSize.sm }}>
                  This session will use real money when auto-trading is enabled.
                  Make sure you review all settings before resuming.
                </p>
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: theme.spacing.md, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={closeCloneModal}>
                Cancel
              </Button>
              <Button variant="primary" onClick={cloneSession}>
                Clone Session
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// Format relative time
const formatRelativeTime = dateStr => {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Session Card Component
const SessionCard = ({
  session,
  onStop,
  onPause,
  onResume,
  onDelete,
  onClone,
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

          {/* Last Activity */}
          <p
            style={{
              margin: '4px 0 0',
              color: theme.colors.gray500,
              fontSize: theme.typography.fontSize.xs,
            }}
          >
            Last activity: {formatRelativeTime(session.lastActivity)}
            {session.totalDecisions > 0 &&
              ` | ${session.totalDecisions} decisions`}
          </p>

          {/* Watchlist preview */}
          {session.watchlist && session.watchlist.length > 0 && (
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

          {/* Recent Decisions */}
          {session.recentDecisions && session.recentDecisions.length > 0 && (
            <div
              style={{
                margin: '8px 0 0',
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.sm,
                fontSize: theme.typography.fontSize.xs,
              }}
            >
              <strong style={{ color: theme.colors.gray700 }}>
                Recent Activity:
              </strong>
              {session.recentDecisions.map((decision, idx) => (
                <div
                  key={idx}
                  style={{
                    marginTop: '4px',
                    color:
                      decision.action === 'BUY'
                        ? theme.colors.success
                        : decision.action === 'SELL'
                          ? theme.colors.error
                          : theme.colors.gray600,
                  }}
                >
                  {decision.action} {decision.symbol} -{' '}
                  {decision.reason?.substring(0, 40)}
                  {decision.reason?.length > 40 ? '...' : ''}
                </div>
              ))}
            </div>
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
          style={{
            display: 'flex',
            gap: theme.spacing.sm,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
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
            onClick={e => onClone(session, e)}
            title="Clone this session"
          >
            Clone
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => navigate(`/live-trading/${session.sessionId}`)}
          >
            View
          </Button>
          <Button
            size="small"
            variant="danger"
            onClick={e => onDelete(session.sessionId, session.name, e)}
            title="Delete session permanently"
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default TradingSessionsList;
