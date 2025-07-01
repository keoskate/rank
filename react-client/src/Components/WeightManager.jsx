/**
 * WEIGHT MANAGER - Modern, Powerful Weight Configuration UI
 * 
 * A comprehensive weight management interface that provides:
 * - Visual weight allocation with real-time feedback
 * - Preset configurations and custom allocation
 * - Auto-save with localStorage persistence
 * - Smart validation and constraints
 * - One-click reset to defaults
 */

import React, { useState, useEffect, useCallback } from 'react';
import WeightSlider from './WeightSlider';
import { 
  DEFAULT_WEIGHTS, 
  isUsingDefaultWeights,
  resetToDefaultWeights 
} from '../config/stockColumns';
import {
  saveWeightPreferences,
  loadWeightPreferences,
  clearWeightPreferences,
  applyWeightPreferences,
  getWeightPreferencesInfo
} from '../utils/weightPreferences';

const WeightManager = ({ 
  params, 
  onWeightChange, 
  onMultiplierClick,
  onResetWeights 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [lastSaved, setLastSaved] = useState(null);

  // Calculate current state
  const totalWeight = Object.values(params).reduce((sum, param) => sum + (param.weight || 0), 0);
  const isUsingDefaults = isUsingDefaultWeights(params);
  const isValid = totalWeight <= 1.0;
  const preferencesInfo = getWeightPreferencesInfo();

  // Auto-save weights when they change
  useEffect(() => {
    if (autoSave && !isUsingDefaults) {
      const timeoutId = setTimeout(() => {
        saveWeightPreferences(params);
        setLastSaved(new Date());
      }, 1000); // Debounce saves by 1 second

      return () => clearTimeout(timeoutId);
    }
  }, [params, autoSave, isUsingDefaults]);

  // Load saved preferences on mount
  useEffect(() => {
    const savedWeights = loadWeightPreferences();
    if (savedWeights && onWeightChange) {
      const updatedParams = applyWeightPreferences(params, savedWeights);
      // Apply each weight change individually to trigger proper state updates
      Object.keys(savedWeights).forEach(key => {
        if (params[key] && savedWeights[key] !== params[key].weight) {
          onWeightChange({
            target: {
              name: key,
              valueAsNumber: savedWeights[key]
            }
          });
        }
      });
    }
  }, []); // Only run on mount

  const handleWeightChange = useCallback((evt) => {
    onWeightChange(evt);
  }, [onWeightChange]);

  const handleResetToDefaults = useCallback(() => {
    clearWeightPreferences();
    onResetWeights();
    setLastSaved(null);
  }, [onResetWeights]);

  const handleClearSaved = useCallback(() => {
    clearWeightPreferences();
    setLastSaved(null);
  }, []);

  // Get active weight metrics (weight > 0)
  const activeMetrics = Object.keys(params).filter(key => 
    params[key].weight > 0 && params[key].multiplier !== 0
  );

  // Get available metrics (multiplier !== 0 but weight = 0)
  const availableMetrics = Object.keys(params).filter(key => 
    params[key].weight === 0 && params[key].multiplier !== 0
  );

  const getWeightColor = (weight) => {
    if (weight === 0) return '#e9ecef';
    if (weight < 0.1) return '#fff3cd';
    if (weight < 0.2) return '#d1ecf1';
    if (weight < 0.3) return '#d4edda';
    return '#c3e6cb';
  };

  const getStatusInfo = () => {
    if (isUsingDefaults) {
      return {
        icon: '🎯',
        text: 'Default Strategy',
        subtext: 'Value investing approach',
        color: '#28a745'
      };
    } else if (preferencesInfo.exists) {
      return {
        icon: '⚡',
        text: 'Custom Strategy',
        subtext: `Saved ${preferencesInfo.lastSaved}`,
        color: '#007bff'
      };
    } else {
      return {
        icon: '🔧',
        text: 'Modified Strategy',
        subtext: 'Changes not saved',
        color: '#ffc107'
      };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Header with expand/collapse */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: `2px solid ${isValid ? '#dee2e6' : '#dc3545'}`,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '18px' }}>
            {statusInfo.icon}
          </span>
          <div>
            <div style={{ 
              fontWeight: 'bold', 
              fontSize: '16px',
              color: statusInfo.color 
            }}>
              Weight Allocation ({totalWeight.toFixed(2)}/1.00)
            </div>
            <div style={{ 
              fontSize: '12px', 
              color: '#6c757d',
              marginTop: '2px'
            }}>
              {statusInfo.text} • {statusInfo.subtext}
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Weight status indicator */}
          <div style={{
            width: '100px',
            height: '8px',
            backgroundColor: '#e9ecef',
            borderRadius: '4px',
            overflow: 'hidden',
            position: 'relative'
          }}>
            <div style={{
              width: `${Math.min(totalWeight * 100, 100)}%`,
              height: '100%',
              backgroundColor: isValid ? '#28a745' : '#dc3545',
              transition: 'all 0.3s ease'
            }} />
          </div>
          
          <span style={{ 
            fontSize: '16px',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}>
            ▼
          </span>
        </div>
      </div>

      {/* Expanded weight management interface */}
      {isExpanded && (
        <div style={{
          marginTop: '8px',
          padding: '20px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #dee2e6',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}>
          {/* Active Metrics */}
          {activeMetrics.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ 
                margin: '0 0 12px 0', 
                fontSize: '14px', 
                fontWeight: 'bold',
                color: '#495057'
              }}>
                Active Metrics ({activeMetrics.length})
              </h4>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px'
              }}>
                {activeMetrics.map(key => {
                  const param = params[key];
                  return (
                    <div 
                      key={key}
                      style={{
                        padding: '12px',
                        backgroundColor: getWeightColor(param.weight),
                        borderRadius: '6px',
                        border: '1px solid #dee2e6'
                      }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        marginBottom: '8px'
                      }}>
                        <span style={{ fontWeight: 'bold', fontSize: '13px' }}>
                          {param.label}
                        </span>
                        <span style={{ 
                          fontSize: '12px', 
                          fontWeight: 'bold',
                          color: '#495057'
                        }}>
                          {(param.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      
                      <WeightSlider
                        label=""
                        name={key}
                        value={param.weight}
                        onChange={handleWeightChange}
                        max={1.0}
                        step={0.01}
                        style={{ marginBottom: '8px' }}
                      />
                      
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          name={key}
                          onClick={onMultiplierClick}
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            backgroundColor: param.multiplier === 1 ? '#d4edda' : '#f8d7da',
                            color: param.multiplier === 1 ? '#155724' : '#721c24',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                          }}
                        >
                          {param.multiplier === 1 ? 'Higher ↑' : 'Lower ↓'}
                        </button>
                        
                        <button
                          onClick={() => handleWeightChange({
                            target: { name: key, valueAsNumber: 0 }
                          })}
                          style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            border: '1px solid #6c757d',
                            borderRadius: '4px',
                            backgroundColor: '#6c757d',
                            color: 'white',
                            cursor: 'pointer'
                          }}
                          title="Remove from strategy"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Available Metrics */}
          {availableMetrics.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ 
                margin: '0 0 12px 0', 
                fontSize: '14px', 
                fontWeight: 'bold',
                color: '#6c757d'
              }}>
                Available Metrics ({availableMetrics.length})
              </h4>
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '8px'
              }}>
                {availableMetrics.map(key => (
                  <button
                    key={key}
                    onClick={() => handleWeightChange({
                      target: { name: key, valueAsNumber: 0.05 }
                    })}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      border: '1px solid #007bff',
                      borderRadius: '20px',
                      backgroundColor: 'white',
                      color: '#007bff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    title={`Add ${params[key].label} to strategy`}
                  >
                    + {params[key].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Controls */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            paddingTop: '16px',
            borderTop: '1px solid #dee2e6'
          }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              {!isUsingDefaults && (
                <button
                  onClick={handleResetToDefaults}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold'
                  }}
                >
                  🔄 Reset to Defaults
                </button>
              )}
              
              {preferencesInfo.exists && (
                <button
                  onClick={handleClearSaved}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  🗑️ Clear Saved
                </button>
              )}
            </div>

            <div style={{ fontSize: '12px', color: '#6c757d' }}>
              {autoSave && !isUsingDefaults && (
                <span>💾 Auto-saving enabled</span>
              )}
              {lastSaved && (
                <span> • Last saved: {lastSaved.toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          {/* Validation messages */}
          {!isValid && (
            <div style={{
              marginTop: '12px',
              padding: '12px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '6px',
              border: '1px solid #f5c6cb',
              fontSize: '13px'
            }}>
              ⚠️ Total weight ({totalWeight.toFixed(2)}) exceeds 100%. 
              Please reduce some allocations.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WeightManager;