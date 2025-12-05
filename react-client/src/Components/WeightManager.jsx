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
  resetToDefaultWeights,
  STRATEGY_PRESETS,
  applyStrategyPreset,
  getActivePreset,
  getPresetList,
} from '../config/stockColumns';
import {
  saveWeightPreferences,
  loadWeightPreferences,
  clearWeightPreferences,
  applyWeightPreferences,
  getWeightPreferencesInfo,
} from '../utils/weightPreferences';

const WeightManager = ({
  params,
  onWeightChange,
  onMultiplierClick,
  onResetWeights,
  onApplyPreset, // New prop for applying presets
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [lastSaved, setLastSaved] = useState(null);
  const [showPresets, setShowPresets] = useState(false);

  // Calculate current state
  const totalWeight = Object.values(params).reduce(
    (sum, param) => sum + (param.weight || 0),
    0
  );
  const isUsingDefaults = isUsingDefaultWeights(params);
  const isValid = totalWeight <= 1.0;
  const preferencesInfo = getWeightPreferencesInfo();
  const activePreset = getActivePreset(params);
  const presetList = getPresetList();

  // Auto-save weights when they change (fixed)
  useEffect(() => {
    if (autoSave && !isUsingDefaults && Object.keys(params).length > 0) {
      const timeoutId = setTimeout(() => {
        const success = saveWeightPreferences(params);
        if (success) {
          setLastSaved(new Date());
        }
      }, 1500); // Longer debounce for better UX

      return () => clearTimeout(timeoutId);
    }
  }, [params, autoSave, isUsingDefaults]);

  const handleWeightChange = useCallback(
    evt => {
      onWeightChange(evt);
      // Immediate save on weight change for better reliability
      if (autoSave) {
        setTimeout(() => {
          const success = saveWeightPreferences(params);
          if (success) {
            setLastSaved(new Date());
            console.info('💾 Weights auto-saved after change');
          }
        }, 500); // Quick save after change
      }
    },
    [onWeightChange, params, autoSave]
  );

  const handleResetToDefaults = useCallback(() => {
    clearWeightPreferences();
    onResetWeights();
    setLastSaved(null);
  }, [onResetWeights]);

  const handleClearSaved = useCallback(() => {
    clearWeightPreferences();
    setLastSaved(null);
  }, []);

  const handleManualSave = useCallback(() => {
    const success = saveWeightPreferences(params);
    if (success) {
      setLastSaved(new Date());
      console.info('💾 Weights manually saved');
    }
  }, [params]);

  // Get active weight metrics (weight > 0)
  const activeMetrics = Object.keys(params).filter(
    key => params[key].weight > 0 && params[key].multiplier !== 0
  );

  // Get available metrics (multiplier !== 0 but weight = 0)
  const availableMetrics = Object.keys(params).filter(
    key => params[key].weight === 0 && params[key].multiplier !== 0
  );

  const getWeightColor = weight => {
    if (weight === 0) return '#e9ecef';
    if (weight < 0.1) return '#fff3cd';
    if (weight < 0.2) return '#d1ecf1';
    if (weight < 0.3) return '#d4edda';
    return '#c3e6cb';
  };

  const handleApplyPreset = useCallback((presetId) => {
    if (onApplyPreset) {
      onApplyPreset(presetId);
    }
    setShowPresets(false);
    setLastSaved(new Date());
  }, [onApplyPreset]);

  const getStatusInfo = () => {
    if (activePreset) {
      return {
        icon: activePreset.icon,
        text: activePreset.name,
        subtext: activePreset.description,
        color: activePreset.id === 'aiMomentum' ? '#9c27b0' : '#28a745',
      };
    } else if (preferencesInfo.exists) {
      return {
        icon: '⚡',
        text: 'Custom Strategy',
        subtext: `Saved ${preferencesInfo.lastSaved}`,
        color: '#007bff',
      };
    } else {
      return {
        icon: '🔧',
        text: 'Modified Strategy',
        subtext: 'Changes not saved',
        color: '#ffc107',
      };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Compact Financial-Style Header */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: `1px solid ${isValid ? '#e0e6ed' : '#dc3545'}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        {/* Top Row: Strategy Status */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '16px' }}>{statusInfo.icon}</span>
            <div>
              <span
                style={{
                  fontWeight: '600',
                  fontSize: '15px',
                  color: '#2c3e50',
                }}
              >
                Portfolio Strategy
              </span>
              <span
                style={{
                  marginLeft: '8px',
                  fontSize: '13px',
                  color: statusInfo.color,
                  fontWeight: '500',
                }}
              >
                {statusInfo.text}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Save Status */}
            {!isUsingDefaults && (
              <span
                style={{
                  fontSize: '12px',
                  color: preferencesInfo.exists ? '#28a745' : '#ffc107',
                  fontWeight: '500',
                }}
              >
                {preferencesInfo.exists ? '✓ Saved' : '○ Unsaved'}
              </span>
            )}

            {/* Weight Allocation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  color: isValid ? '#2c3e50' : '#dc3545',
                }}
              >
                {(totalWeight * 100).toFixed(0)}%
              </span>
              <div
                style={{
                  width: '60px',
                  height: '4px',
                  backgroundColor: '#e9ecef',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(totalWeight * 100, 100)}%`,
                    height: '100%',
                    backgroundColor: isValid ? '#28a745' : '#dc3545',
                    transition: 'all 0.3s ease',
                  }}
                />
              </div>
            </div>

            {/* Expand Toggle */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              style={{
                background: 'none',
                border: 'none',
                padding: '4px 8px',
                cursor: 'pointer',
                borderRadius: '4px',
                color: '#6c757d',
                fontSize: '14px',
                transition: 'all 0.2s ease',
                ':hover': { backgroundColor: '#f8f9fa' },
              }}
            >
              {isExpanded ? '−' : '+'}
            </button>
          </div>
        </div>

        {/* Strategy Presets Row */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '12px',
            flexWrap: 'wrap',
          }}
        >
          {presetList.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleApplyPreset(preset.id)}
              style={{
                padding: '6px 12px',
                backgroundColor: activePreset?.id === preset.id ? '#007bff' : '#f8f9fa',
                color: activePreset?.id === preset.id ? 'white' : '#495057',
                border: `1px solid ${activePreset?.id === preset.id ? '#007bff' : '#dee2e6'}`,
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s ease',
              }}
              title={preset.description}
            >
              <span>{preset.icon}</span>
              <span>{preset.name}</span>
              {preset.id === 'aiMomentum' && (
                <span style={{
                  fontSize: '9px',
                  backgroundColor: activePreset?.id === preset.id ? 'rgba(255,255,255,0.3)' : '#9c27b0',
                  color: 'white',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  marginLeft: '2px',
                }}>
                  AI
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Quick Actions Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            {!activePreset && (
              <>
                <button
                  onClick={handleManualSave}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500',
                  }}
                  title="Manually save current weights"
                >
                  Save
                </button>

                <button
                  onClick={handleResetToDefaults}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#f8f9fa',
                    color: '#6c757d',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500',
                  }}
                >
                  Reset
                </button>
              </>
            )}

            {preferencesInfo.exists && !activePreset && (
              <button
                onClick={handleClearSaved}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#f8f9fa',
                  color: '#dc3545',
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Active Metrics Summary */}
          <div style={{ fontSize: '12px', color: '#6c757d' }}>
            {activeMetrics.length > 0 ? (
              <span>{activeMetrics.length} active metrics</span>
            ) : (
              <span>No active weights</span>
            )}
            {lastSaved && (
              <span> • Saved {lastSaved.toLocaleTimeString()}</span>
            )}
          </div>
        </div>

        {/* Validation Warning */}
        {!isValid && (
          <div
            style={{
              marginTop: '12px',
              padding: '8px 12px',
              backgroundColor: '#fff5f5',
              color: '#dc3545',
              borderRadius: '4px',
              border: '1px solid #fed7d7',
              fontSize: '12px',
              fontWeight: '500',
            }}
          >
            ⚠️ Total allocation exceeds 100% - please adjust weights
          </div>
        )}
      </div>

      {/* Expanded: Streamlined Weight Controls */}
      {isExpanded && (
        <div
          style={{
            marginTop: '8px',
            padding: '20px',
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e0e6ed',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          {/* Financial Table Style */}
          <div style={{ marginBottom: '16px' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      fontWeight: '600',
                      color: '#495057',
                      borderBottom: '1px solid #dee2e6',
                    }}
                  >
                    Metric
                  </th>
                  <th
                    style={{
                      padding: '8px 12px',
                      textAlign: 'center',
                      fontWeight: '600',
                      color: '#495057',
                      borderBottom: '1px solid #dee2e6',
                      width: '80px',
                    }}
                  >
                    Weight
                  </th>
                  <th
                    style={{
                      padding: '8px 12px',
                      textAlign: 'center',
                      fontWeight: '600',
                      color: '#495057',
                      borderBottom: '1px solid #dee2e6',
                      width: '200px',
                    }}
                  >
                    Allocation
                  </th>
                  <th
                    style={{
                      padding: '8px 12px',
                      textAlign: 'center',
                      fontWeight: '600',
                      color: '#495057',
                      borderBottom: '1px solid #dee2e6',
                      width: '100px',
                    }}
                  >
                    Direction
                  </th>
                  <th
                    style={{
                      padding: '8px 12px',
                      textAlign: 'center',
                      fontWeight: '600',
                      color: '#495057',
                      borderBottom: '1px solid #dee2e6',
                      width: '80px',
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(params)
                  .filter(
                    key =>
                      params[key].multiplier !== 0 &&
                      key !== 'rank' &&
                      key !== 'ticker'
                  )
                  .map(key => {
                    const param = params[key];
                    const isActive = param.weight > 0;

                    return (
                      <tr
                        key={key}
                        style={{
                          backgroundColor: isActive ? '#fff' : '#f8f9fa',
                          opacity: isActive ? 1 : 0.6,
                        }}
                      >
                        <td
                          style={{
                            padding: '10px 12px',
                            borderBottom: '1px solid #f1f3f4',
                            fontWeight: isActive ? '500' : '400',
                          }}
                        >
                          {param.label}
                        </td>

                        <td
                          style={{
                            padding: '10px 12px',
                            textAlign: 'center',
                            borderBottom: '1px solid #f1f3f4',
                            fontWeight: '600',
                            color: isActive ? '#2c3e50' : '#6c757d',
                          }}
                        >
                          {(param.weight * 100).toFixed(0)}%
                        </td>

                        <td
                          style={{
                            padding: '10px 12px',
                            borderBottom: '1px solid #f1f3f4',
                          }}
                        >
                          <WeightSlider
                            label=""
                            name={key}
                            value={param.weight}
                            onChange={handleWeightChange}
                            max={1.0}
                            step={0.01}
                          />
                        </td>

                        <td
                          style={{
                            padding: '10px 12px',
                            textAlign: 'center',
                            borderBottom: '1px solid #f1f3f4',
                          }}
                        >
                          <button
                            name={key}
                            onClick={onMultiplierClick}
                            style={{
                              padding: '4px 8px',
                              fontSize: '11px',
                              border: 'none',
                              borderRadius: '3px',
                              backgroundColor:
                                param.multiplier === 1 ? '#e8f5e8' : '#ffeaea',
                              color:
                                param.multiplier === 1 ? '#2d7d2d' : '#d83333',
                              cursor: 'pointer',
                              fontWeight: '500',
                              minWidth: '60px',
                            }}
                          >
                            {param.multiplier === 1 ? 'Higher' : 'Lower'}
                          </button>
                        </td>

                        <td
                          style={{
                            padding: '10px 12px',
                            textAlign: 'center',
                            borderBottom: '1px solid #f1f3f4',
                          }}
                        >
                          {isActive ? (
                            <button
                              onClick={() =>
                                handleWeightChange({
                                  target: { name: key, valueAsNumber: 0 },
                                })
                              }
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                border: 'none',
                                borderRadius: '3px',
                                backgroundColor: '#f8f9fa',
                                color: '#6c757d',
                                cursor: 'pointer',
                              }}
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                handleWeightChange({
                                  target: { name: key, valueAsNumber: 0.05 },
                                })
                              }
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                border: '1px solid #007bff',
                                borderRadius: '3px',
                                backgroundColor: 'white',
                                color: '#007bff',
                                cursor: 'pointer',
                              }}
                            >
                              Add
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default WeightManager;
