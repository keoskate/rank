import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import theme from '../theme';
import AccountPicker from './common/AccountPicker';

/**
 * NavBar - Clean, minimal navigation
 *
 * Primary: Rankings, Portfolio
 * Tools menu: Advanced features for power users
 */
const NavBar = () => {
  const location = useLocation();
  const [showTools, setShowTools] = useState(false);

  const primaryNav = [
    { path: '/', label: 'Rankings' },
    { path: '/portfolio', label: 'Portfolio' },
    { path: '/live-trading', label: 'Trading' },
    { path: '/scanner', label: 'Scanner' },
  ];

  const toolsNav = [
    { path: '/semiconductor', label: 'Semiconductor' },
    { path: '/strategy-lab', label: 'Strategy Lab' },
    { path: '/charlie-strategy', label: 'Charlie Strategy' },
    { path: '/overnight', label: 'Overnight Optimizer' },
    { path: '/backtest', label: 'Backtesting' },
    { path: '/day-trading', label: 'Day Trading Lab' },
    { path: '/import-trades', label: 'Import Trades' },
    { path: '/analytics', label: 'Analytics' },
    { path: '/ab-testing', label: 'A/B Testing' },
    { path: '/walk-forward', label: 'Walk-Forward' },
    { path: '/darkpool-diagnostics', label: 'Dark Pool' },
  ];

  const isActive = path => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <header
      style={{
        backgroundColor: theme.colors.primary,
        padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
        boxShadow: theme.shadows.md,
      }}
    >
      <div
        style={{
          maxWidth: theme.layout.maxWidthWide,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Logo */}
        <Link
          to="/"
          style={{
            color: '#ffffff',
            fontSize: '20px',
            fontWeight: 700,
            textDecoration: 'none',
            padding: '8px 12px',
            whiteSpace: 'nowrap',
          }}
        >
          Keo Stonks
        </Link>

        {/* Navigation */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          {/* Primary Nav */}
          {primaryNav.map(item => (
            <Link
              key={item.path}
              to={item.path}
              style={{
                background: isActive(item.path)
                  ? 'rgba(255,255,255,0.2)'
                  : 'transparent',
                color: '#ffffff',
                textDecoration: 'none',
                padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.md,
                fontWeight: isActive(item.path)
                  ? theme.typography.fontWeight.bold
                  : theme.typography.fontWeight.normal,
              }}
            >
              {item.label}
            </Link>
          ))}

          {/* Global account picker — which account the whole site is viewing */}
          <AccountPicker />

          {/* Tools Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowTools(!showTools)}
              style={{
                background: showTools ? 'rgba(255,255,255,0.2)' : 'transparent',
                border: 'none',
                color: '#ffffff',
                opacity: 1,
                padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                borderRadius: theme.borderRadius.md,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.md,
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.xs,
              }}
            >
              Tools
              <span
                style={{
                  fontSize: '10px',
                  transform: showTools ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              >
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
                  zIndex: 1000,
                }}
                onMouseLeave={() => setShowTools(false)}
              >
                {toolsNav.map(item => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setShowTools(false)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                      background: isActive(item.path)
                        ? theme.colors.gray100
                        : theme.colors.surface,
                      color: theme.colors.text,
                      textDecoration: 'none',
                      textAlign: 'left',
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    {item.label}
                  </Link>
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
