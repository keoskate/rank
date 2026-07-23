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
import ViewModeToggle from '../common/ViewModeToggle';
import useViewMode from '../../hooks/useViewMode';
import { useAccountView } from '../../contexts/AccountViewContext';
import theme from '../../theme';

const TradingSessionsList = () => {
  const navigate = useNavigate();
  const { viewMode, isEasy, toggleViewMode } = useViewMode();
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

  // The GLOBAL account picker (NavBar) decides which Alpaca account the
  // summary card shows; re-fetch when it changes.
  const {
    accountId,
    account: viewAccount,
    isLive: isLiveView,
  } = useAccountView();

  // Fetch sessions on mount; account summary follows the global picker
  useEffect(() => {
    fetchSessions();
    fetchAccount();
  }, [accountId]);

  const fetchSessions = async () => {
    try {
      // default_user = the hand-built experiment sessions (EXP-B, etc.).
      // 'brokers' = the broker-exchange agents (trend/momentum/insider/...) —
      // same session shape, just a different userId, so they render identically.
      const [userRes, brokerRes] = await Promise.all([
        fetch('/api/ai/sessions/default_user'),
        fetch('/api/ai/sessions/brokers').catch(() => null),
      ]);
      const userData = await userRes.json();
      const userSessions = userRes.ok ? userData.sessions || [] : [];
      let brokerSessions = [];
      if (brokerRes && brokerRes.ok) {
        const brokerData = await brokerRes.json();
        brokerSessions = (brokerData.sessions || []).map(s => ({
          ...s,
          isBroker: true,
          tier:
            s.config?.tier ||
            (s.config?.simulationMode === false ? 'paper' : 'simulated'),
        }));
      }
      setSessions([...userSessions, ...brokerSessions]);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccount = async () => {
    try {
      const res = await fetch(`/api/alpaca/account?mode=${accountId}`);
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

  // Toggle a session's auto-trade (execute orders vs. signals-only). Enabling
  // means the strategy will actually place orders, so guard it with a confirm.
  const setAutoTrade = async (sessionId, value, e) => {
    if (e) e.stopPropagation();
    if (
      value &&
      !window.confirm(
        'Enable auto-trade? The strategy will start placing real orders on its account when it finds signals.'
      )
    ) {
      return;
    }
    try {
      await fetch(`/api/ai/session/${sessionId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoTrade: value }),
      });
      fetchSessions();
    } catch (err) {
      console.error('Failed to set auto-trade:', err);
    }
  };

  // Promote a practice (sim) session to the real Alpaca paper account.
  const promoteToPaper = async (sessionId, name, e) => {
    if (e) e.stopPropagation();
    if (
      !window.confirm(
        `Upgrade "${name}" to REAL Alpaca paper trading?\n\n` +
          `• Best reserved for VALIDATED strategies — real paper money, shared account.\n` +
          `• Wipes its practice positions and starts fresh with $20,000 on the Alpaca paper account.\n` +
          `• Its track record (wins/losses) is kept.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/ai/session/${sessionId}/promote-to-paper`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocation: 20000 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to promote to paper');
        return;
      }
      fetchSessions();
    } catch (err) {
      console.error('Failed to promote to paper:', err);
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

  // Which Alpaca account a session's real orders route to (null = simulated,
  // no Alpaca account at all). Mirrors the ENGINE's routing semantics:
  // broker sessions carry config.alpacaAccountId from brokerSchema; legacy
  // sessions (EXP-B/QBTX era — no alpacaAccountId field) trade the shared
  // main paper account unless explicitly simulationMode:true, matching both
  // orderExecutor's sim-vs-real routing and this page's own "Real Paper
  // Money" grouping (simulationMode !== true).
  const accountOf = s => {
    const c = s.config || {};
    if (c.alpacaAccountId !== undefined) return c.alpacaAccountId; // authoritative (may be null = sim)
    if (c.simulationMode === true) return null; // simulated — no Alpaca account
    if (c.tradingMode === 'live' || c.paperTradeOnly === false) return 'live';
    return 'paper'; // legacy default: real orders on the shared main paper account
  };

  // Global picker scoping: account-bound sessions only show under THEIR
  // account; simulated sessions (no account) stay visible everywhere with
  // their SIM badge — hiding them entirely would make brokers "disappear".
  const scopedSessions = sessions.filter(s => {
    const acc = accountOf(s);
    return acc === null || acc === accountId;
  });

  const runningSessions = scopedSessions.filter(s => s.status === 'running');
  const pausedSessions = scopedSessions.filter(s => s.status === 'paused');
  const stoppedSessions = scopedSessions.filter(s => s.status === 'stopped');
  const hiddenByScope = sessions.length - scopedSessions.length;

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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.md,
          }}
        >
          <ViewModeToggle mode={viewMode} onToggle={toggleViewMode} />
          <Button variant="primary" onClick={() => setShowNewForm(true)}>
            + New Session
          </Button>
        </div>
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
            title={viewAccount ? viewAccount.label : 'Alpaca Paper Account'}
            value={formatCurrency(account.equity)}
            subtitle={
              isLiveView
                ? '🔴 REAL MONEY — live Alpaca account'
                : viewAccount && viewAccount.accountNumber
                  ? `Paper money · ${viewAccount.accountNumber}`
                  : 'Real paper money · shared across paper sessions'
            }
            variant={isLiveView ? 'error' : 'default'}
          />
          <MetricCard
            title="Active Sessions"
            value={runningSessions.length}
            subtitle={`${pausedSessions.length} paused${hiddenByScope > 0 ? ` · ${hiddenByScope} on other accounts` : ''}`}
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

      {/* Easy mode — grouped by real vs practice money. MUST receive the
          account-SCOPED list, not the raw one: passing `sessions` here was
          exactly the leak the 2026-07-23 screenshot caught (Main-account
          EXP-B/QBTX sessions rendering under the Keo Fund view). */}
      {!loading && isEasy && scopedSessions.length > 0 && (
        <EasyModeList
          sessions={scopedSessions}
          onStop={stopSession}
          onSetAutoTrade={setAutoTrade}
          onPromote={promoteToPaper}
          formatCurrency={formatCurrency}
          getStatusColor={getStatusColor}
          navigate={navigate}
        />
      )}

      {/* Active Sessions */}
      {!isEasy && runningSessions.length > 0 && (
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
      {!isEasy && pausedSessions.length > 0 && (
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
      {!isEasy && stoppedSessions.length > 0 && (
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
            <p
              style={{
                color: theme.colors.gray600,
                marginBottom: theme.spacing.lg,
              }}
            >
              Create a copy of "<strong>{cloneModalSession.name}</strong>" with
              all its configuration. The clone will start paused so you can
              review settings.
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
                    backgroundColor: clonePaperTrading
                      ? `${theme.colors.primary}10`
                      : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="tradingMode"
                    checked={clonePaperTrading}
                    onChange={() => setClonePaperTrading(true)}
                  />
                  <div>
                    <div
                      style={{ fontWeight: theme.typography.fontWeight.medium }}
                    >
                      Paper Trading
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray500,
                      }}
                    >
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
                    backgroundColor: !clonePaperTrading
                      ? `${theme.colors.warning}10`
                      : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="tradingMode"
                    checked={!clonePaperTrading}
                    onChange={() => setClonePaperTrading(false)}
                  />
                  <div>
                    <div
                      style={{ fontWeight: theme.typography.fontWeight.medium }}
                    >
                      Live Trading
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.warning,
                      }}
                    >
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
                <p
                  style={{
                    margin: 0,
                    color: theme.colors.warning,
                    fontWeight: theme.typography.fontWeight.medium,
                  }}
                >
                  ⚠️ Live Trading Warning
                </p>
                <p
                  style={{
                    margin: '8px 0 0',
                    color: theme.colors.gray700,
                    fontSize: theme.typography.fontSize.sm,
                  }}
                >
                  This session will use real money when auto-trading is enabled.
                  Make sure you review all settings before resuming.
                </p>
              </div>
            )}

            {/* Buttons */}
            <div
              style={{
                display: 'flex',
                gap: theme.spacing.md,
                justifyContent: 'flex-end',
              }}
            >
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
  const isRealPaper = session.config?.simulationMode !== true;

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
            {/* Money-world badge — shown for ALL sessions, not just brokers */}
            <span
              title={
                isRealPaper
                  ? 'Trades the real Alpaca paper account'
                  : 'Practice / simulated money — not connected to Alpaca'
              }
              style={{
                padding: '2px 8px',
                borderRadius: theme.borderRadius.sm,
                backgroundColor: isRealPaper ? '#2563eb' : '#6b7280',
                color: 'white',
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium,
                textTransform: 'uppercase',
              }}
            >
              {isRealPaper ? 'Paper' : 'Sim'}
            </span>
            {session.isBroker && (
              <>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    backgroundColor: '#374151',
                    color: 'white',
                    fontSize: theme.typography.fontSize.xs,
                    fontWeight: theme.typography.fontWeight.medium,
                    textTransform: 'uppercase',
                  }}
                >
                  Exchange
                </span>
                <span
                  title="No strategy has cleared the 5-gate validation — this is an unvalidated forward test, not proven edge"
                  style={{
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    backgroundColor: '#b91c1c',
                    color: 'white',
                    fontSize: theme.typography.fontSize.xs,
                    fontWeight: theme.typography.fontWeight.medium,
                    textTransform: 'uppercase',
                  }}
                >
                  Unvalidated
                </span>
              </>
            )}
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

          {/* Recent Trades (from tradingLog - actual executions) */}
          {session.recentTrades && session.recentTrades.length > 0 && (
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
                Recent Trades:
              </strong>
              {session.recentTrades.map((trade, idx) => (
                <div
                  key={idx}
                  style={{
                    marginTop: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    color:
                      trade.side === 'buy'
                        ? theme.colors.success
                        : theme.colors.error,
                  }}
                >
                  <span>
                    {trade.side.toUpperCase()} {trade.quantity} {trade.symbol} @
                    ${trade.price?.toFixed(2)}
                  </span>
                  {trade.side === 'sell' && trade.pnl != null && (
                    <span
                      style={{
                        color:
                          trade.pnl >= 0
                            ? theme.colors.success
                            : theme.colors.error,
                        fontWeight: theme.typography.fontWeight.medium,
                      }}
                    >
                      {trade.pnl >= 0 ? '+' : ''}
                      {formatCurrency(trade.pnl)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Open Positions */}
          {session.openPositions && session.openPositions.length > 0 && (
            <div
              style={{
                margin: '8px 0 0',
                padding: theme.spacing.sm,
                backgroundColor: '#fffbeb',
                borderRadius: theme.borderRadius.sm,
                border: '1px solid #fbbf2440',
                fontSize: theme.typography.fontSize.xs,
              }}
            >
              <strong style={{ color: theme.colors.gray700 }}>
                Open Positions:
              </strong>
              {session.openPositions.map((pos, idx) => (
                <div
                  key={idx}
                  style={{
                    marginTop: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ color: theme.colors.gray700 }}>
                    {pos.quantity} {pos.symbol} @ ${pos.averageCost?.toFixed(2)}
                  </span>
                  <span
                    style={{
                      color:
                        (pos.unrealizedPnL || 0) >= 0
                          ? theme.colors.success
                          : theme.colors.error,
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    {(pos.unrealizedPnL || 0) >= 0 ? '+' : ''}
                    {formatCurrency(pos.unrealizedPnL || 0)}
                    {pos.unrealizedPnLPercent
                      ? ` (${pos.unrealizedPnLPercent >= 0 ? '+' : ''}${pos.unrealizedPnLPercent.toFixed(1)}%)`
                      : ''}
                  </span>
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
              flexWrap: 'wrap',
            }}
          >
            {session.stats && (
              <>
                <span style={{ color: theme.colors.gray600 }}>
                  Trades:{' '}
                  <strong>
                    {session.stats.wins || 0}W / {session.stats.losses || 0}L
                  </strong>
                  {(session.positionCount || 0) > 0 && (
                    <span style={{ color: '#d97706' }}>
                      {' '}
                      ({session.positionCount} open)
                    </span>
                  )}
                </span>
                {session.stats.totalTrades > 0 && (
                  <span style={{ color: theme.colors.gray600 }}>
                    Win Rate:{' '}
                    <strong
                      style={{
                        color:
                          (session.stats.winRate || 0) >= 50
                            ? theme.colors.success
                            : (session.stats.winRate || 0) > 0
                              ? theme.colors.error
                              : theme.colors.gray700,
                      }}
                    >
                      {session.stats.winRate || 0}%
                    </strong>
                  </span>
                )}
                <span
                  style={{
                    color:
                      (session.stats.totalPnLWithUnrealized ||
                        session.stats.totalPnL ||
                        0) >= 0
                        ? theme.colors.success
                        : theme.colors.error,
                  }}
                >
                  P&L:{' '}
                  <strong>{formatCurrency(session.stats.totalPnL || 0)}</strong>
                  {(session.stats.unrealizedPnL || 0) !== 0 && (
                    <span
                      style={{
                        color:
                          (session.stats.unrealizedPnL || 0) >= 0
                            ? theme.colors.success
                            : theme.colors.error,
                        fontSize: theme.typography.fontSize.xs,
                      }}
                    >
                      {' '}
                      ({(session.stats.unrealizedPnL || 0) >= 0 ? '+' : ''}
                      {formatCurrency(session.stats.unrealizedPnL || 0)}{' '}
                      unrealized)
                    </span>
                  )}
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

// ── Easy mode ──────────────────────────────────────────────────────────────
// Curated cards grouped by real vs practice money, with a real auto-trade
// toggle and honest labels. Reuses the already-fetched sessions array.

const isRealPaperSession = s => s?.config?.simulationMode !== true;

const easyBadge = bg => ({
  padding: '2px 8px',
  borderRadius: theme.borderRadius.sm,
  backgroundColor: bg,
  color: 'white',
  fontSize: theme.typography.fontSize.xs,
  fontWeight: theme.typography.fontWeight.medium,
  textTransform: 'uppercase',
});

const EasySessionCard = ({
  session,
  onStop,
  onSetAutoTrade,
  onPromote,
  formatCurrency,
  getStatusColor,
  navigate,
}) => {
  const realPaper = isRealPaperSession(session);
  const autoOn = session.config?.autoTrade === true;
  const pnl =
    session.stats?.totalPnLWithUnrealized ?? session.stats?.totalPnL ?? 0;
  const staleMs = session.lastActivity
    ? Date.now() - new Date(session.lastActivity).getTime()
    : 0;
  const isStale = session.status === 'running' && staleMs > 24 * 3600 * 1000;
  const staleH = Math.round(staleMs / 3600000);

  return (
    <Card
      style={{
        padding: theme.spacing.md,
        cursor: 'pointer',
        border: `1px solid ${getStatusColor(session.status)}30`,
      }}
      onClick={() => navigate(`/live-trading/${session.sessionId}`)}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: theme.spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              flexWrap: 'wrap',
            }}
          >
            <h3 style={{ margin: 0, color: theme.colors.gray900 }}>
              {session.name || 'Unnamed Session'}
            </h3>
            <span style={easyBadge(getStatusColor(session.status))}>
              {session.status}
            </span>
            <span style={easyBadge(realPaper ? '#2563eb' : '#6b7280')}>
              {realPaper ? 'Paper' : 'Sim'}
            </span>
            {isStale && (
              <span
                title="Running, but no activity in over a day"
                style={easyBadge(theme.colors.warning)}
              >
                Stale {staleH}h
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: 6,
              display: 'flex',
              gap: theme.spacing.md,
              alignItems: 'center',
              fontSize: theme.typography.fontSize.sm,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                color: pnl >= 0 ? theme.colors.success : theme.colors.error,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              {formatCurrency(pnl)}
              {!realPaper && (
                <span style={{ color: theme.colors.gray500, fontWeight: 400 }}>
                  {' '}
                  (sim)
                </span>
              )}
            </span>
            <span style={{ color: theme.colors.gray600 }}>
              {autoOn
                ? '● executing trades'
                : '○ signals only — not placing orders'}
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={e => onSetAutoTrade(session.sessionId, !autoOn, e)}
            title="Auto-Trade ON = the strategy places orders on signals. OFF = it only logs signals (no orders)."
            style={{
              padding: '6px 12px',
              borderRadius: theme.borderRadius.full,
              border: 'none',
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.sm,
              fontWeight: theme.typography.fontWeight.bold,
              color: '#fff',
              backgroundColor: autoOn
                ? theme.colors.success
                : theme.colors.gray500,
            }}
          >
            Auto-Trade: {autoOn ? 'ON' : 'OFF'}
          </button>
          {!realPaper && onPromote && (
            <button
              type="button"
              onClick={e =>
                onPromote(session.sessionId, session.name || 'this session', e)
              }
              title="Move this practice strategy onto the real Alpaca paper account"
              style={{
                padding: '6px 12px',
                borderRadius: theme.borderRadius.full,
                border: `1px solid ${theme.colors.info}`,
                background: 'transparent',
                color: theme.colors.info,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.sm,
                fontWeight: theme.typography.fontWeight.medium,
                whiteSpace: 'nowrap',
              }}
            >
              ↑ Upgrade to Paper
            </button>
          )}
          {session.status !== 'stopped' && (
            <Button
              variant="secondary"
              onClick={e => onStop(session.sessionId, e)}
            >
              Stop
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

const EasyModeList = ({
  sessions,
  onStop,
  onSetAutoTrade,
  onPromote,
  formatCurrency,
  getStatusColor,
  navigate,
}) => {
  // Which account this list is scoped to (global picker) — used to label the
  // real-money section with the actual account instead of a generic string.
  const { account: viewAccount } = useAccountView();
  const real = sessions.filter(isRealPaperSession);
  const practice = sessions.filter(s => !isRealPaperSession(s));

  const Section = ({ title, subtitle, accent, items }) =>
    items.length > 0 ? (
      <div style={{ marginBottom: theme.spacing.lg }}>
        <h2
          style={{
            color: accent,
            fontSize: theme.typography.fontSize.lg,
            margin: 0,
          }}
        >
          {title} ({items.length})
        </h2>
        <p
          style={{
            margin: '2px 0 12px',
            color: theme.colors.gray500,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          {subtitle}
        </p>
        <div style={{ display: 'grid', gap: theme.spacing.md }}>
          {items.map(s => (
            <EasySessionCard
              key={s.sessionId}
              session={s}
              onStop={onStop}
              onSetAutoTrade={onSetAutoTrade}
              onPromote={onPromote}
              formatCurrency={formatCurrency}
              getStatusColor={getStatusColor}
              navigate={navigate}
            />
          ))}
        </div>
      </div>
    ) : null;

  return (
    <>
      <Section
        title="Real Paper Money"
        subtitle={`Trades ${viewAccount ? viewAccount.label : 'the live Alpaca paper account'}${viewAccount && viewAccount.accountNumber ? ` (${viewAccount.accountNumber})` : ''} — real fills, real P&L.`}
        accent={theme.colors.info}
        items={real}
      />
      <Section
        title="Practice (Simulated)"
        subtitle="Fake $100k pools, not connected to Alpaca — for testing only."
        accent={theme.colors.gray600}
        items={practice}
      />
    </>
  );
};

export default TradingSessionsList;
