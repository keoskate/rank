/**
 * RANKINGS PAGE - Main Application View
 *
 * This component serves as the main dashboard and handles:
 * - Board type selection (Stock vs Crypto rankings)
 * - Renders either ModernStonkBoard (Stock data) or Crypto view
 * - Contains the primary user interface logic
 *
 * CRITICAL PATH: This is the main view users see. Changes here directly
 * impact the user experience and board switching functionality.
 *
 * UPDATED: Uses design system components for consistent styling
 */
import { useState } from 'react';
import ModernStonkBoard from './ModernStonkBoard';
import Button from './common/Button';
import Card from './common/Card';
import theme from '../theme';

function RankingsPage() {
  const [currentBoard, setCurrentBoard] = useState('stock');

  const handleBoardToggle = () => {
    setCurrentBoard(currentBoard === 'stock' ? 'crypto' : 'stock');
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: theme.colors.background,
      padding: theme.spacing.lg,
    }}>
      {/* Board Selection */}
      <div style={{
        marginBottom: theme.spacing.lg,
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.md,
        flexWrap: 'wrap',
      }}>
        <Button
          variant="primary"
          onClick={handleBoardToggle}
        >
          {currentBoard === 'stock' ? 'Switch to Crypto' : 'Switch to Stocks'}
        </Button>
        <span style={{
          color: theme.colors.textLight,
          fontSize: theme.typography.fontSize.base,
          fontWeight: theme.typography.fontWeight.medium,
        }}>
          Currently viewing:{' '}
          <span style={{
            color: theme.colors.text,
            fontWeight: theme.typography.fontWeight.bold,
          }}>
            {currentBoard === 'stock' ? 'Stock Rankings' : 'Crypto Rankings'}
          </span>
        </span>
      </div>

      {/* Main Content */}
      {currentBoard === 'stock' ? (
        <ModernStonkBoard />
      ) : (
        <Card padding="large" style={{ textAlign: 'center' }}>
          <h3 style={{
            margin: `0 0 ${theme.spacing.md} 0`,
            color: theme.colors.text,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold,
          }}>
            Crypto Scoreboard
          </h3>
          <p style={{
            margin: `0 0 ${theme.spacing.sm} 0`,
            color: theme.colors.textLight,
            fontSize: theme.typography.fontSize.base,
          }}>
            Coming soon! The Crypto scoreboard will be modernized with the new table system.
          </p>
          <p style={{
            margin: 0,
            color: theme.colors.textLight,
            fontSize: theme.typography.fontSize.base,
          }}>
            For now, please use the Stock Rankings.
          </p>
        </Card>
      )}

      {/* Footer Info Card */}
      <Card
        style={{
          marginTop: theme.spacing.xl,
          textAlign: 'center',
        }}
      >
        <div style={{
          fontSize: theme.typography.fontSize.base,
          color: theme.colors.textLight,
          fontWeight: theme.typography.fontWeight.medium,
          marginBottom: theme.spacing.xs,
        }}>
          KEO STONKS V2 • React 18 • Modern Security • TanStack Table
        </div>
        <div style={{
          fontSize: theme.typography.fontSize.sm,
          color: theme.colors.textMuted,
          lineHeight: '1.5',
        }}>
          Investment rankings are calculated using dual algorithms: relative
          position ranking and statistical deviation analysis
        </div>
      </Card>
    </div>
  );
}

export default RankingsPage;
