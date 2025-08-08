/**
 * HOME PAGE - Main Application View
 *
 * This component serves as the main dashboard and handles:
 * - Board type selection (CEF vs Stock rankings)
 * - Renders either Scoreboard (CEF data) or ModernStonkBoard (Stock data)
 * - Contains the primary user interface logic
 *
 * CRITICAL PATH: This is the main view users see. Changes here directly
 * impact the user experience and board switching functionality.
 *
 * UPDATED: Converted to React 18 functional component with hooks
 * MODERN: Uses ModernStonkBoard with TanStack Table
 */
import { useState } from 'react';
// import Scoreboard from './Scoreboard'; // TODO: Modernize Scoreboard with TanStack Table
import ModernStonkBoard from './ModernStonkBoard';

function HomePage() {
  const [currentBoard, setCurrentBoard] = useState('stock');

  const handleBoardToggle = () => {
    setCurrentBoard(currentBoard === 'stock' ? 'crypto' : 'stock');
  };

  return (
    <div style={{ 
      minHeight: '100vh',
      backgroundColor: '#f8f9fa'
    }}>
      <div style={{ 
        padding: '24px'
      }}>
        <div style={{ marginBottom: '24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <button
              onClick={handleBoardToggle}
              style={{
                padding: '12px 24px',
                backgroundColor: currentBoard === 'stock' ? '#007bff' : '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                marginRight: '12px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}
            >
              {currentBoard === 'stock' ? 'Switch to Crypto' : 'Switch to Stocks'}
            </button>
            <span style={{ 
              color: '#6c757d', 
              fontSize: '14px',
              fontWeight: '500'
            }}>
              Currently viewing:{' '}
              <span style={{ color: '#2c3e50', fontWeight: '600' }}>
                {currentBoard === 'stock' ? 'Stock Rankings' : 'Crypto Rankings'}
              </span>
            </span>
          </div>
        </div>

      {currentBoard === 'stock' ? (
        <ModernStonkBoard />
      ) : (
        <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
          <h3>Crypto Scoreboard</h3>
          <p>
            Coming soon! The Crypto scoreboard will be modernized with the new
            table system.
          </p>
          <p>For now, please use the Stock Rankings.</p>
        </div>
      )}

        <div
          style={{
            marginTop: '40px',
            padding: '24px',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e9ecef',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            textAlign: 'center',
          }}
        >
          <div style={{
            fontSize: '14px',
            color: '#6c757d',
            fontWeight: '500',
            marginBottom: '8px'
          }}>
            KEO STONKS V2 • React 18 • Modern Security • TanStack Table
          </div>
          <div style={{
            fontSize: '12px',
            color: '#95a5a6',
            lineHeight: '1.5'
          }}>
            Investment rankings are calculated using dual algorithms: relative
            position ranking and statistical deviation analysis
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
