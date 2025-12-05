import React from 'react';
import { useNavigate } from 'react-router-dom';
import Button from './common/Button';
import theme from '../theme';

/**
 * NAVIGATION BAR COMPONENT
 *
 * Clean, simplified navigation using design system.
 * Groups related features for better UX.
 */
const NavBar = () => {
  const navigate = useNavigate();

  const navItems = [
    { path: '/', label: 'Rankings', icon: '📊' },
    { path: '/backtest', label: 'Backtest', icon: '🧪' },
    { path: '/day-trading', label: 'Day Trading', icon: '📈' },
    { path: '/paper-trading', label: 'Paper Trading', icon: '📝' },
    { path: '/ai-research', label: 'AI Research', icon: '🤖' },
    { path: '/invest', label: 'Brokerage', icon: '🏦' },
  ];

  return (
    <header style={{
      backgroundColor: theme.colors.primary,
      padding: theme.spacing.md + ' ' + theme.spacing.lg,
      boxShadow: theme.shadows.md,
      borderBottom: `1px solid ${theme.colors.primaryLight}`,
    }}>
      <div style={{
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.spacing.lg,
      }}>
        {/* Logo/Brand */}
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          style={{
            color: theme.colors.surface,
            fontSize: theme.typography.fontSize.xxl,
            fontWeight: theme.typography.fontWeight.bold,
            letterSpacing: '1px',
            padding: theme.spacing.sm + ' ' + theme.spacing.md,
          }}
        >
          KEO STONKS V2
        </Button>

        {/* Navigation Links */}
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          flexWrap: 'wrap',
        }}>
          {navItems.map((item) => (
            <Button
              key={item.path}
              variant="outline"
              size="small"
              onClick={() => navigate(item.path)}
              style={{
                borderColor: theme.colors.surface,
                color: theme.colors.surface,
                backgroundColor: 'transparent',
              }}
            >
              {item.icon} {item.label}
            </Button>
          ))}
        </nav>
      </div>
    </header>
  );
};

export default NavBar;
