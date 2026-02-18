/**
 * WEIGHT PREFERENCES MANAGEMENT
 *
 * Handles saving, loading, and managing custom weight configurations
 * with localStorage persistence and validation.
 */

const WEIGHT_PREFERENCES_KEY = 'keo-stocks-weight-preferences';

/**
 * Save current weight configuration to localStorage
 * @param {Object} params - Current parameter configuration
 */
export function saveWeightPreferences(params) {
  const weights = {};

  // Extract only the weights from params
  Object.keys(params).forEach(key => {
    if (params[key] && typeof params[key].weight === 'number') {
      weights[key] = params[key].weight;
    }
  });

  const preferences = {
    weights,
    timestamp: Date.now(),
    version: '1.0',
  };

  try {
    localStorage.setItem(WEIGHT_PREFERENCES_KEY, JSON.stringify(preferences));
    console.info('💾 Weight preferences saved to localStorage');
    return true;
  } catch (error) {
    console.error('Failed to save weight preferences:', error);
    return false;
  }
}

/**
 * Load saved weight configuration from localStorage
 * @returns {Object|null} Saved weights or null if none exist
 */
export function loadWeightPreferences() {
  try {
    const stored = localStorage.getItem(WEIGHT_PREFERENCES_KEY);
    if (!stored) return null;

    const preferences = JSON.parse(stored);

    // Validate the structure
    if (!preferences.weights || !preferences.timestamp) {
      console.warn('Invalid weight preferences structure, ignoring');
      return null;
    }

    console.info('📂 Weight preferences loaded from localStorage');
    return preferences.weights;
  } catch (error) {
    console.error('Failed to load weight preferences:', error);
    return null;
  }
}

/**
 * Clear saved weight preferences
 */
export function clearWeightPreferences() {
  try {
    localStorage.removeItem(WEIGHT_PREFERENCES_KEY);
    console.info('🗑️ Weight preferences cleared');
    return true;
  } catch (error) {
    console.error('Failed to clear weight preferences:', error);
    return false;
  }
}

/**
 * Apply saved weights to parameter configuration
 * @param {Object} params - Current parameter configuration
 * @param {Object} savedWeights - Saved weight values
 * @returns {Object} Updated parameter configuration
 */
export function applyWeightPreferences(params, savedWeights) {
  if (!savedWeights) return params;

  const updatedParams = { ...params };

  Object.keys(savedWeights).forEach(key => {
    if (updatedParams[key] && typeof savedWeights[key] === 'number') {
      updatedParams[key] = {
        ...updatedParams[key],
        weight: savedWeights[key],
      };
    }
  });

  return updatedParams;
}

/**
 * Get weight preferences info for UI display
 * @returns {Object} Preferences metadata
 */
export function getWeightPreferencesInfo() {
  try {
    const stored = localStorage.getItem(WEIGHT_PREFERENCES_KEY);
    if (!stored) return { exists: false };

    const preferences = JSON.parse(stored);
    return {
      exists: true,
      timestamp: preferences.timestamp,
      lastSaved: new Date(preferences.timestamp).toLocaleString(),
      version: preferences.version || '1.0',
    };
  } catch (error) {
    return { exists: false, error: true };
  }
}
