/**
 * CONFIG PANEL - System configuration and controls
 * 
 * Centralizes all configuration options that were previously in the main view:
 * - Debug mode toggle
 * - Stock list selection  
 * - Cache management
 * - View options
 * - API configuration display
 */

import React from 'react';
import { getApiInfo } from './StockUtils';
import { getStockListNames } from '../config/stockLists';
import { getDebugModeInfo } from '../utils/debugPreference';
import { getAllCacheInfo, clearCache, clearAllCache } from '../utils/cacheManager';
import { useState } from 'react';

const ConfigPanel = ({
  debugMode,
  onDebugModeToggle,
  onCacheRefresh,
  currentStockListId,
  onStockListChange,
  currentStockList,
  onFullDataScoreboard,
  onRelativeScoreboard,
  onStdScoreboard,
}) => {
  const [showCacheControls, setShowCacheControls] = useState(false);
  const [cacheInfo, setCacheInfo] = useState({});

  // Get current API configuration
  const apiInfo = getApiInfo();
  
  // Get available stock lists
  const availableStockLists = getStockListNames();
  
  // Get debug mode info for better UI
  const debugModeInfo = getDebugModeInfo(debugMode);

  // Cache management functions
  const refreshCacheInfo = () => {
    const info = getAllCacheInfo();
    setCacheInfo(info);
  };

  const handleClearCache = (key) => {
    clearCache(key);
    refreshCacheInfo();
    if (onCacheRefresh) {
      onCacheRefresh();
    }
  };

  const handleClearAllCache = () => {
    clearAllCache();
    refreshCacheInfo();
    if (onCacheRefresh) {
      onCacheRefresh();
    }
  };

  const handleForceRefresh = () => {
    if (onCacheRefresh) {
      onCacheRefresh(true); // Force refresh
    }
  };

  // Format duration for display
  const formatDuration = (ms) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${Math.floor(ms / 1000)}s`;
    }
  };

  return (
    <div style={{ 
      padding: '20px',
      backgroundColor: '#f8f9fa',
      minHeight: '400px'
    }}>
      {/* API Configuration Display */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ 
            margin: '0 0 12px 0', 
            color: '#2c3e50',
            fontSize: '16px',
            fontWeight: '600'
          }}>
            📡 API Configuration
          </h4>
          <div style={{ fontSize: '14px', color: '#495057' }}>
            <div style={{ marginBottom: '8px' }}>
              <strong>Provider:</strong> {apiInfo.name}
            </div>
            <div style={{ marginBottom: '8px' }}>
              <strong>Cost:</strong> {apiInfo.cost}
            </div>
            <div style={{ fontSize: '12px', color: '#6c757d' }}>
              Configure API settings in config/apiConfig.js
            </div>
          </div>
        </div>
      </div>

      {/* Debug Mode Toggle */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ 
            margin: '0 0 12px 0', 
            color: '#2c3e50',
            fontSize: '16px',
            fontWeight: '600'
          }}>
            🔧 Data Fetching Mode
          </h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px' }}>
            <button
              onClick={onDebugModeToggle}
              style={{
                padding: '10px 20px',
                backgroundColor: debugModeInfo.color,
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                minWidth: '120px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              }}
            >
              {debugModeInfo.icon} {debugModeInfo.mode}
            </button>
            
            <div style={{ flex: 1 }}>
              <div style={{ 
                fontSize: '14px', 
                fontWeight: '500', 
                color: '#495057',
                marginBottom: '3px'
              }}>
                {debugModeInfo.description}
              </div>
              <div style={{ 
                fontSize: '12px', 
                color: '#6c757d',
                fontStyle: 'italic'
              }}>
                {debugModeInfo.behavior}
              </div>
            </div>
          </div>
          
          <div style={{
            fontSize: '11px',
            color: '#28a745',
            fontWeight: '500',
          }}>
            ✅ Preference saved automatically
          </div>
        </div>
      </div>

      {/* Stock List Selection */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ 
            margin: '0 0 12px 0', 
            color: '#2c3e50',
            fontSize: '16px',
            fontWeight: '600'
          }}>
            📋 Stock List Selection
          </h4>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
            <select
              value={currentStockListId}
              onChange={(e) => onStockListChange(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                fontSize: '14px',
                minWidth: '200px',
              }}
            >
              {availableStockLists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.count} stocks)
                </option>
              ))}
            </select>
            
            <div style={{
              display: 'inline-block',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: currentStockList?.color || '#ccc',
              border: '2px solid white',
              boxShadow: '0 0 3px rgba(0,0,0,0.3)',
            }} />
          </div>
          
          {currentStockList && (
            <div style={{ 
              fontSize: '12px', 
              color: '#6c757d',
              backgroundColor: '#f8f9fa',
              padding: '8px 12px',
              borderRadius: '4px',
              border: '1px solid #dee2e6',
            }}>
              <strong>{currentStockList.name}</strong>: {currentStockList.description}
              <br />
              <span style={{ color: '#007bff' }}>
                {currentStockList.stocks.length} stocks: {currentStockList.stocks.slice(0, 8).join(', ')}
                {currentStockList.stocks.length > 8 && ` + ${currentStockList.stocks.length - 8} more`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Smart Cache Controls */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ 
            margin: '0 0 12px 0', 
            color: '#2c3e50',
            fontSize: '16px',
            fontWeight: '600'
          }}>
            💾 Cache Management
          </h4>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <button
              onClick={() => {
                setShowCacheControls(!showCacheControls);
                if (!showCacheControls) refreshCacheInfo();
              }}
              style={{
                padding: '6px 12px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              📦 {showCacheControls ? 'Hide' : 'Show'} Cache
            </button>
            
            <button
              onClick={handleForceRefresh}
              style={{
                padding: '6px 12px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              🔄 Force Refresh
            </button>
            
            <button
              onClick={handleClearAllCache}
              style={{
                padding: '6px 12px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              🗑️ Clear All Cache
            </button>
          </div>

          {showCacheControls && (
            <div style={{
              backgroundColor: '#f8f9fa',
              padding: '15px',
              borderRadius: '6px',
              border: '1px solid #dee2e6',
              fontSize: '12px',
            }}>
              <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>
                📊 Cache Status ({Object.keys(cacheInfo).length} entries)
              </div>
              
              {Object.keys(cacheInfo).length === 0 ? (
                <div style={{ color: '#6c757d', fontStyle: 'italic' }}>
                  No cache entries found. Fetch some data to populate cache.
                </div>
              ) : (
                Object.entries(cacheInfo).map(([key, info]) => (
                  <div key={key} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px',
                    backgroundColor: 'white',
                    marginBottom: '5px',
                    borderRadius: '4px',
                    border: '1px solid #e9ecef',
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#495057' }}>
                        {key.replace('STOCKS_', '').substring(0, 30)}...
                      </div>
                      <div style={{ color: '#6c757d' }}>
                        {info?.dataCount || 0} stocks • Age: {info?.age ? formatDuration(info.age) : 'Unknown'}
                        {info?.isExpired && <span style={{ color: '#dc3545' }}> • EXPIRED</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleClearCache(key)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '10px',
                      }}
                    >
                      Clear
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* View Options */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ 
            margin: '0 0 12px 0', 
            color: '#2c3e50',
            fontSize: '16px',
            fontWeight: '600'
          }}>
            👁️ View Options
          </h4>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={onFullDataScoreboard}
              style={{
                padding: '8px 16px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              📊 Full Grid
            </button>
            <button
              onClick={onRelativeScoreboard}
              style={{
                padding: '8px 16px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              📈 Relative Rank
            </button>
            <button
              onClick={onStdScoreboard}
              style={{
                padding: '8px 16px',
                backgroundColor: '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              📉 Std Deviation
            </button>
          </div>
          <div style={{
            fontSize: '12px',
            color: '#6c757d',
            marginTop: '8px',
          }}>
            Switch between different ranking views to analyze stock performance from multiple perspectives
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigPanel;