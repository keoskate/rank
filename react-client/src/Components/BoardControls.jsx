/**
 * BOARD CONTROLS - UI components for weight sliders and board switching
 *
 * This component handles all the user interface controls for:
 * - Weight adjustment sliders
 * - Multiplier toggle buttons
 * - Board view switching (Full, Relative, Std Deviation)
 * - Weight total display
 *
 * Separated from main component to improve maintainability and reusability.
 */

import WeightSlider from '../Components/WeightSlider';

const BoardControls = ({
  params,
  sumOfWeights,
  onWeightChange,
  onMultiplierClick,
  onFullDataScoreboard,
  onRelativeScoreboard,
  onStdScoreboard,
  debugMode,
  onDebugModeToggle,
}) => {
  // Render weight sliders for active parameters
  const renderWeightSliders = () => {
    return Object.keys(params).map(key => {
      if (params[key].multiplier !== 0) {
        return (
          <span
            key={key}
            style={{ display: 'inline-block', margin: 5, width: 120 }}
          >
            <WeightSlider
              label={key}
              name={key}
              value={params[key].weight}
              onChange={onWeightChange}
            />
            <button
              name={key}
              onClick={onMultiplierClick}
              style={{
                marginLeft: 5,
                padding: '2px 8px',
                fontSize: '12px',
                border: '1px solid #ccc',
                borderRadius: '3px',
                backgroundColor:
                  params[key].multiplier === 1 ? '#d4edda' : '#f8d7da',
                color: params[key].multiplier === 1 ? '#155724' : '#721c24',
                cursor: 'pointer',
              }}
            >
              {params[key].multiplier === 1 ? '+1' : '-1'}
            </button>
          </span>
        );
      }
      return null;
    });
  };

  return (
    <div>
      {/* Weight Controls */}
      <div style={{ marginBottom: 20 }}>
        <h3>Weight Controls (Total: {sumOfWeights.toFixed(2)})</h3>
        <div
          style={{
            padding: '10px',
            backgroundColor: '#f8f9fa',
            borderRadius: '5px',
            border: '1px solid #dee2e6',
          }}
        >
          {renderWeightSliders()}
        </div>
        {sumOfWeights > 1.0 && (
          <div
            style={{
              color: '#dc3545',
              fontSize: '14px',
              marginTop: '5px',
              fontWeight: 'bold',
            }}
          >
            ⚠️ Warning: Total weight exceeds 1.0
          </div>
        )}
      </div>

      {/* Debug Mode Toggle */}
      <div style={{ marginBottom: 20 }}>
        <h4>Debug Mode</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={onDebugModeToggle}
            style={{
              padding: '8px 16px',
              backgroundColor: debugMode ? '#28a745' : '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            {debugMode ? '🔒 CACHED DATA' : '🌐 LIVE API'}
          </button>
          <span style={{ fontSize: '12px', color: '#6c757d' }}>
            {debugMode
              ? 'Using cached data (preserves API quota)'
              : 'Fetching live data from API (uses quota)'}
          </span>
        </div>
      </div>

      {/* Board Switching Controls */}
      <div style={{ marginBottom: 20 }}>
        <h4>View Options</h4>
        <div style={{ display: 'flex', gap: '10px' }}>
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
            📈 Relative Rank Grid
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
            📉 Std Deviation Grid
          </button>
        </div>
        <div
          style={{
            fontSize: '12px',
            color: '#6c757d',
            marginTop: '5px',
          }}
        >
          Switch between different ranking views to analyze stock performance
          from multiple perspectives
        </div>
      </div>
    </div>
  );
};

export default BoardControls;
