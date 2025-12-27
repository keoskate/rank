/**
 * Multi-Session View
 *
 * Orchestrates multiple trading sessions with a tabbed interface.
 * Keeps sessions alive in background for instant switching.
 * Persists open tabs to localStorage.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionTabBar from '../common/SessionTabBar';
import LiveTradingDashboard from './LiveTradingDashboard';
import Button from '../common/Button';
import Card from '../common/Card';
import theme from '../../theme';

const STORAGE_KEY = 'open-trading-sessions';

const MultiSessionView = () => {
  const { sessionId: urlSessionId } = useParams();
  const navigate = useNavigate();

  // Open sessions (tabs) - each has { sessionId, name, status, stats }
  const [openSessions, setOpenSessions] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Currently active session
  const [activeSessionId, setActiveSessionId] = useState(urlSessionId || null);

  // Session picker modal
  const [showPicker, setShowPicker] = useState(false);
  const [allSessions, setAllSessions] = useState([]);
  const [loadingAllSessions, setLoadingAllSessions] = useState(false);

  // Persist open sessions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openSessions));
    } catch {
      // Ignore storage errors
    }
  }, [openSessions]);

  // Open a session if it's not already in the tabs
  const openSessionIfNotOpen = useCallback(
    async sessionId => {
      // Check if already exists (read current state via ref pattern)
      const alreadyExists = openSessions.some(s => s.sessionId === sessionId);
      if (alreadyExists) return;

      try {
        const res = await fetch(`/api/ai/session/detail/${sessionId}`);
        const data = await res.json();

        if (data && data.status !== 'not_found') {
          setOpenSessions(current => {
            // Double-check it wasn't added while we were fetching
            if (current.some(s => s.sessionId === sessionId)) return current;
            return [
              ...current,
              {
                sessionId,
                name: data.name || 'Unnamed',
                status: data.status,
                stats: data.stats || {},
                positions: data.positions || [],
              },
            ];
          });
        }
      } catch (err) {
        console.error('Failed to fetch session details:', err);
        // Still add it with minimal info so UI shows something
        setOpenSessions(current => {
          if (current.some(s => s.sessionId === sessionId)) return current;
          return [
            ...current,
            {
              sessionId,
              name: 'Session',
              status: 'unknown',
              stats: {},
              positions: [],
            },
          ];
        });
      }
    },
    [openSessions]
  );

  // Sync URL sessionId with active session
  useEffect(() => {
    if (urlSessionId) {
      // Always try to open the session from URL (function handles deduplication)
      openSessionIfNotOpen(urlSessionId);
      if (urlSessionId !== activeSessionId) {
        setActiveSessionId(urlSessionId);
      }
    }
  }, [urlSessionId, activeSessionId, openSessionIfNotOpen]);

  // Update URL when active session changes
  useEffect(() => {
    if (activeSessionId && activeSessionId !== urlSessionId) {
      navigate(`/live-trading/${activeSessionId}`, { replace: true });
    }
  }, [activeSessionId, urlSessionId, navigate]);

  // Handle tab selection - navigate to force clean page load
  const handleSelectSession = sessionId => {
    if (sessionId !== activeSessionId) {
      // Navigate to the new session URL - this ensures clean component lifecycle
      window.location.href = `/live-trading/${sessionId}`;
    }
  };

  // Handle tab close
  const handleCloseSession = sessionId => {
    setOpenSessions(prev => prev.filter(s => s.sessionId !== sessionId));

    // If closing the active session, switch to another
    if (sessionId === activeSessionId) {
      const remaining = openSessions.filter(s => s.sessionId !== sessionId);
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].sessionId);
      } else {
        // No more tabs - go back to sessions list
        navigate('/live-trading');
      }
    }
  };

  // Update session data (called from LiveTradingDashboard)
  const handleSessionUpdate = useCallback((sessionId, updates) => {
    setOpenSessions(prev =>
      prev.map(s => (s.sessionId === sessionId ? { ...s, ...updates } : s))
    );
  }, []);

  // Fetch all sessions for picker
  const fetchAllSessions = async () => {
    setLoadingAllSessions(true);
    try {
      const res = await fetch('/api/ai/sessions/default_user');
      const data = await res.json();
      if (res.ok) {
        setAllSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoadingAllSessions(false);
    }
  };

  // Open session picker
  const handleOpenPicker = () => {
    setShowPicker(true);
    fetchAllSessions();
  };

  // Add session from picker
  const handleAddSession = async session => {
    const exists = openSessions.some(s => s.sessionId === session.sessionId);
    if (!exists) {
      setOpenSessions(prev => [
        ...prev,
        {
          sessionId: session.sessionId,
          name: session.name || 'Unnamed',
          status: session.status,
          stats: session.stats || {},
          positions: session.positions || [],
        },
      ]);
    }
    setActiveSessionId(session.sessionId);
    setShowPicker(false);
  };

  // Get sessions not already open
  const availableSessions = allSessions.filter(
    s => !openSessions.some(os => os.sessionId === s.sessionId)
  );

  // Check if we're waiting for a session to load from URL
  const isLoadingFromUrl =
    urlSessionId && !openSessions.some(s => s.sessionId === urlSessionId);

  // If no sessions open and no URL param, show empty state
  if (openSessions.length === 0 && !urlSessionId) {
    return (
      <div style={{ padding: theme.spacing.lg }}>
        <Card
          style={{
            padding: theme.spacing.xl,
            textAlign: 'center',
            maxWidth: '600px',
            margin: '0 auto',
          }}
        >
          <h2
            style={{
              color: theme.colors.gray800,
              marginBottom: theme.spacing.md,
            }}
          >
            No Sessions Open
          </h2>
          <p
            style={{
              color: theme.colors.gray600,
              marginBottom: theme.spacing.lg,
            }}
          >
            Open a trading session to view its details and monitor activity.
          </p>
          <div
            style={{
              display: 'flex',
              gap: theme.spacing.md,
              justifyContent: 'center',
            }}
          >
            <Button variant="primary" onClick={handleOpenPicker}>
              Open Session
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/live-trading')}
            >
              Back to Sessions List
            </Button>
          </div>
        </Card>

        {/* Session Picker Modal */}
        {showPicker && (
          <SessionPickerModal
            sessions={allSessions}
            loading={loadingAllSessions}
            onSelect={handleAddSession}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>
    );
  }

  // Show loading state while fetching session from URL
  if (isLoadingFromUrl) {
    return (
      <div
        style={{
          padding: theme.spacing.xl,
          textAlign: 'center',
          color: theme.colors.gray600,
        }}
      >
        Loading session...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 60px)',
      }}
    >
      {/* Tab Bar */}
      <SessionTabBar
        sessions={openSessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onCloseSession={handleCloseSession}
        onOpenSessionPicker={handleOpenPicker}
      />

      {/* Session Content - only render the active session (single mount to avoid shared state issues) */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeSessionId && (
          <LiveTradingDashboard
            key={activeSessionId}
            sessionId={activeSessionId}
            onSessionUpdate={updates =>
              handleSessionUpdate(activeSessionId, updates)
            }
            isMultiSessionMode={true}
          />
        )}
      </div>

      {/* Session Picker Modal */}
      {showPicker && (
        <SessionPickerModal
          sessions={availableSessions}
          loading={loadingAllSessions}
          onSelect={handleAddSession}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
};

// Session Picker Modal Component
const SessionPickerModal = ({ sessions, loading, onSelect, onClose }) => {
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

  const formatCurrency = value => {
    if (value == null || isNaN(value)) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  return (
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
      onClick={onClose}
    >
      <Card
        style={{
          width: '500px',
          maxHeight: '70vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            padding: theme.spacing.lg,
            borderBottom: `1px solid ${theme.colors.gray200}`,
          }}
        >
          <h3 style={{ margin: 0, color: theme.colors.gray900 }}>
            Open Session
          </h3>
          <p
            style={{
              margin: `${theme.spacing.xs} 0 0`,
              color: theme.colors.gray600,
            }}
          >
            Select a session to open in a new tab
          </p>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: theme.spacing.md }}>
          {loading && (
            <p style={{ color: theme.colors.gray500, textAlign: 'center' }}>
              Loading sessions...
            </p>
          )}

          {!loading && sessions.length === 0 && (
            <p style={{ color: theme.colors.gray500, textAlign: 'center' }}>
              All sessions are already open
            </p>
          )}

          {!loading &&
            sessions.map(session => (
              <div
                key={session.sessionId}
                onClick={() => onSelect(session)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  padding: theme.spacing.md,
                  borderRadius: theme.borderRadius.md,
                  cursor: 'pointer',
                  transition: theme.transitions.fast,
                  marginBottom: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray200}`,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = theme.colors.gray100;
                  e.currentTarget.style.borderColor = theme.colors.info;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.borderColor = theme.colors.gray200;
                }}
              >
                {/* Status dot */}
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: getStatusColor(session.status),
                    flexShrink: 0,
                  }}
                />

                {/* Session info */}
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontWeight: theme.typography.fontWeight.medium,
                      color: theme.colors.gray900,
                    }}
                  >
                    {session.name || 'Unnamed Session'}
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.gray500,
                    }}
                  >
                    {session.status} • {session.stats?.totalTrades || 0} trades
                  </div>
                </div>

                {/* P&L */}
                {session.stats?.totalPnL != null && (
                  <span
                    style={{
                      fontWeight: theme.typography.fontWeight.medium,
                      color:
                        session.stats.totalPnL >= 0
                          ? theme.colors.success
                          : theme.colors.error,
                    }}
                  >
                    {formatCurrency(session.stats.totalPnL)}
                  </span>
                )}
              </div>
            ))}
        </div>

        <div
          style={{
            padding: theme.spacing.md,
            borderTop: `1px solid ${theme.colors.gray200}`,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default MultiSessionView;
