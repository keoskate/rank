import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Button from './common/Button';
import theme from '../theme';

/**
 * NavBar - Clean, minimal navigation
 *
 * Primary: Rankings, Portfolio
 * Tools menu: Advanced features for power users
 */
const NavBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showTools, setShowTools] = useState(false);

  const primaryNav = [
    { path: '/', label: 'Rankings' },
    { path: '/portfolio', label: 'Portfolio' }
  ];

  const toolsNav = [
    { path: '/backtest', label: 'Backtesting' },
    { path: '/day-trading', label: 'Day Trading Lab' },
    { path: '/live-trading', label: 'AI Trading' },
    { path: '/import-trades', label: 'Import Trades' },
    { path: '/analytics', label: 'Analytics' }
  ];

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <header style={{
      backgroundColor: theme.colors.primary,
      padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
      boxShadow: theme.shadows.md
    }}>
      <div style={{
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {/* Logo */}
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.white,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold,
            cursor: 'pointer',
            padding: theme.spacing.sm
          }}
        >
          STONKS
        </button>

        {/* Navigation */}
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm
        }}>
          {/* Primary Nav */}
          {primaryNav.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                background: isActive(item.path) ? 'rgba(255,255,255,0.2)' : 'none',
                border: 'none',
                color: theme.colors.white,
                padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                borderRadius: theme.borderRadius.md,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.md,
                fontWeight: isActive(item.path)
                  ? theme.typography.fontWeight.bold
                  : theme.typography.fontWeight.normal
              }}
            >
              {item.label}
            </button>
          ))}

          {/* Tools Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowTools(!showTools)}
              style={{
                background: showTools ? 'rgba(255,255,255,0.2)' : 'none',
                border: 'none',
                color: theme.colors.white,
                padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                borderRadius: theme.borderRadius.md,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.md,
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.xs
              }}
            >
              Tools
              <span style={{
                fontSize: '10px',
                transform: showTools ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s'
              }}>
                ▼
              </span>
            </button>

            {showTools && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: theme.spacing.xs,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.borderRadius.md,
                  boxShadow: theme.shadows.lg,
                  minWidth: '180px',
                  overflow: 'hidden',
                  zIndex: 1000
                }}
                onMouseLeave={() => setShowTools(false)}
              >
                {toolsNav.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => {
                      navigate(item.path);
                      setShowTools(false);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                      border: 'none',
                      background: isActive(item.path)
                        ? theme.colors.gray100
                        : theme.colors.surface,
                      color: theme.colors.text,
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: theme.typography.fontSize.sm
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
};

export default NavBar;
