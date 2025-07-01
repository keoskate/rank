/**
 * INVEST TAB - Investment execution interface (Under Construction)
 *
 * Placeholder for future investment features:
 * - Portfolio execution
 * - Charles Schwab integration
 * - Order management
 * - Position tracking
 */

import React from 'react';

const InvestTab = () => {
  return (
    <div
      style={{
        padding: '40px 20px',
        textAlign: 'center',
        backgroundColor: '#f8f9fa',
        minHeight: '400px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Under Construction Banner */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '2px dashed #ffc107',
          padding: '40px',
          maxWidth: '500px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚧</div>
        <h2
          style={{
            margin: '0 0 16px 0',
            color: '#2c3e50',
            fontSize: '24px',
            fontWeight: '600',
          }}
        >
          Investment Execution
        </h2>
        <div
          style={{
            fontSize: '16px',
            color: '#6c757d',
            marginBottom: '24px',
            lineHeight: '1.5',
          }}
        >
          This feature is currently under development and will include:
        </div>

        {/* Feature List */}
        <div
          style={{
            textAlign: 'left',
            backgroundColor: '#f8f9fa',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '24px',
          }}
        >
          <ul
            style={{
              margin: 0,
              paddingLeft: '20px',
              fontSize: '14px',
              color: '#495057',
            }}
          >
            <li style={{ marginBottom: '8px' }}>
              <strong>Portfolio Execution:</strong> Automatic order placement
              based on rankings
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>Charles Schwab Integration:</strong> Direct broker
              connectivity
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>Order Management:</strong> Real-time order tracking and
              status
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>Position Tracking:</strong> Live portfolio monitoring
            </li>
            <li style={{ marginBottom: '8px' }}>
              <strong>Risk Management:</strong> Position sizing and stop-loss
              automation
            </li>
          </ul>
        </div>

        {/* TODO Section */}
        <div
          style={{
            backgroundColor: '#fff3cd',
            border: '1px solid #ffeaa7',
            borderRadius: '6px',
            padding: '16px',
            fontSize: '14px',
            color: '#856404',
          }}
        >
          <strong>🔗 TODO:</strong> Integrate with Charles Schwab API for
          automated portfolio execution
        </div>

        {/* Coming Soon Badge */}
        <div style={{ marginTop: '24px' }}>
          <span
            style={{
              display: 'inline-block',
              backgroundColor: '#e3f2fd',
              color: '#1976d2',
              padding: '8px 16px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Coming Soon
          </span>
        </div>
      </div>

      {/* Contact Section */}
      <div
        style={{
          marginTop: '32px',
          fontSize: '12px',
          color: '#6c757d',
        }}
      >
        Have ideas for this feature? Contact the development team.
      </div>
    </div>
  );
};

export default InvestTab;
