/**
 * TAB NAVIGATION - Clean tabbed interface for the application
 * 
 * Provides a professional tab system to organize different aspects:
 * - Ranking: Main stock ranking dashboard with weights
 * - Config: System configuration and controls  
 * - Invest: Investment execution (future feature)
 */

import React from 'react';

const TabNavigation = ({ activeTab, onTabChange }) => {
  const tabs = [
    {
      id: 'ranking',
      label: 'Ranking',
      icon: '📊',
      description: 'Stock analysis & portfolio weights'
    },
    {
      id: 'config', 
      label: 'Config',
      icon: '⚙️',
      description: 'System settings & data controls'
    },
    {
      id: 'invest',
      label: 'Invest',
      icon: '💰',
      description: 'Portfolio execution (coming soon)',
      disabled: true
    }
  ];

  return (
    <div style={{
      borderBottom: '1px solid #e0e6ed',
      backgroundColor: '#ffffff',
      marginBottom: '24px'
    }}>
      <div style={{
        display: 'flex',
        paddingLeft: '20px'
      }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          const isDisabled = tab.disabled;
          
          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && onTabChange(tab.id)}
              disabled={isDisabled}
              style={{
                padding: '16px 24px',
                border: 'none',
                background: 'none',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                borderBottom: isActive ? '3px solid #007bff' : '3px solid transparent',
                color: isActive ? '#007bff' : isDisabled ? '#adb5bd' : '#495057',
                fontWeight: isActive ? '600' : '500',
                fontSize: '15px',
                transition: 'all 0.2s ease',
                opacity: isDisabled ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
              title={tab.description}
            >
              <span style={{ fontSize: '16px' }}>{tab.icon}</span>
              {tab.label}
              {isDisabled && (
                <span style={{ 
                  fontSize: '11px', 
                  backgroundColor: '#e9ecef', 
                  color: '#6c757d',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  marginLeft: '4px'
                }}>
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TabNavigation;