import React from 'react';
import { useNavigate } from 'react-router-dom';

const NavBar = () => {
  const navigate = useNavigate();

  return (
    <header style={{
      backgroundColor: '#2c3e50',
      padding: '16px 24px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      borderBottom: '1px solid #34495e'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            color: '#ffffff',
            fontSize: '24px',
            fontWeight: '700',
            cursor: 'pointer',
            letterSpacing: '1px',
            padding: '8px 16px',
            borderRadius: '6px',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = '#34495e';
            e.target.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'transparent';
            e.target.style.transform = 'scale(1)';
          }}
        >
          KEO STONKS V2
        </button>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <span style={{
            color: '#bdc3c7',
            fontSize: '14px',
            fontWeight: '500'
          }}>
            Stock Analysis & Ranking Platform
          </span>
        </div>
      </div>
    </header>
  );
};

export default NavBar;
