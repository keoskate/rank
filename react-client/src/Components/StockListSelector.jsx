/**
 * STOCK LIST SELECTOR
 * 
 * Clean, integrated stock list selector for the main ranking table.
 * Provides quick switching between stock lists with visual indicators.
 */

import React, { useState } from 'react';
import { getStockListNames } from '../config/stockLists';

const StockListSelector = ({ 
  currentStockListId, 
  currentStockList,
  onStockListChange,
  loading = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const availableStockLists = getStockListNames();

  const handleStockListChange = (newStockListId) => {
    if (newStockListId !== currentStockListId) {
      onStockListChange(newStockListId);
      setIsExpanded(false);
    }
  };

  return (
    <div style={{ 
      display: 'inline-block',
      position: 'relative'
    }}>
      {/* Compact Selector Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          backgroundColor: '#ffffff',
          border: '1px solid #e0e6ed',
          borderRadius: '6px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '13px',
          fontWeight: '500',
          color: '#2c3e50',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          opacity: loading ? 0.7 : 1,
          minWidth: '180px',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: currentStockList?.color || '#ccc',
            border: '2px solid white',
            boxShadow: '0 0 2px rgba(0,0,0,0.3)',
          }} />
          <span style={{ 
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '120px'
          }}>
            {currentStockList?.name || 'Select List'}
          </span>
        </div>
        <span style={{ 
          fontSize: '10px',
          color: '#6c757d'
        }}>
          {loading ? '⏳' : (isExpanded ? '▲' : '▼')}
        </span>
      </button>

      {/* Dropdown Menu */}
      {isExpanded && !loading && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          backgroundColor: '#ffffff',
          border: '1px solid #e0e6ed',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          {/* Header */}
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid #f1f3f4',
            fontSize: '11px',
            fontWeight: '600',
            color: '#6c757d',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Stock Lists
          </div>

          {/* Stock List Options */}
          {availableStockLists.map((stockList) => {
            const isSelected = stockList.id === currentStockListId;
            
            return (
              <button
                key={stockList.id}
                onClick={() => handleStockListChange(stockList.id)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: 'none',
                  backgroundColor: isSelected ? '#f8f9fa' : 'transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '13px',
                  borderBottom: '1px solid #f8f9fa',
                  ':hover': {
                    backgroundColor: '#f1f3f4'
                  }
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.target.style.backgroundColor = '#f1f3f4';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.target.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: stockList.color,
                    border: '1px solid white',
                    boxShadow: '0 0 2px rgba(0,0,0,0.2)',
                    flexShrink: 0
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ 
                      fontWeight: isSelected ? '600' : '500',
                      color: isSelected ? '#2c3e50' : '#495057',
                      marginBottom: '2px'
                    }}>
                      {stockList.name}
                      {isSelected && (
                        <span style={{ 
                          marginLeft: '6px',
                          fontSize: '10px',
                          color: '#28a745'
                        }}>
                          ✓
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: '#6c757d',
                      lineHeight: '1.2'
                    }}>
                      {stockList.count} stocks • {stockList.description}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Footer */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid #f1f3f4',
            fontSize: '10px',
            color: '#6c757d',
            textAlign: 'center'
          }}>
            Configure lists in Config tab
          </div>
        </div>
      )}

      {/* Overlay to close dropdown */}
      {isExpanded && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999
          }}
          onClick={() => setIsExpanded(false)}
        />
      )}
    </div>
  );
};

export default StockListSelector;