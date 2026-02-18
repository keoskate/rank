/**
 * CHART PREFERENCES UTILITIES
 *
 * Manages persistence of chart timeframe and metric selection preferences
 * across page refreshes and browser sessions.
 */

const CHART_PREFERENCES_KEY = 'keo_stonks_chart_preferences';

/**
 * Default chart preferences
 */
const DEFAULT_CHART_PREFERENCES = {
  timeframe: '52W',
  metric: 'price',
};

/**
 * Save chart preferences to localStorage
 * @param {Object} preferences - Chart preferences object
 * @returns {boolean} Success status
 */
export function saveChartPreferences(preferences) {
  try {
    const preference = {
      ...preferences,
      savedAt: new Date().toISOString(),
      version: '1.0',
    };

    localStorage.setItem(CHART_PREFERENCES_KEY, JSON.stringify(preference));
    console.info(`📊 Chart preferences saved`);
    return true;
  } catch (error) {
    console.error('❌ Failed to save chart preferences:', error);
    return false;
  }
}

/**
 * Load chart preferences from localStorage
 * @returns {Object} Chart preferences with defaults applied
 */
export function loadChartPreferences() {
  try {
    const saved = localStorage.getItem(CHART_PREFERENCES_KEY);

    if (!saved) {
      console.info('📋 No saved chart preferences found, using defaults');
      return DEFAULT_CHART_PREFERENCES;
    }

    const preference = JSON.parse(saved);

    if (!preference.timeframe || !preference.metric) {
      console.warn('⚠️ Invalid chart preferences format, using defaults');
      return DEFAULT_CHART_PREFERENCES;
    }

    console.info('🔄 Loaded saved chart preferences');
    return {
      timeframe: preference.timeframe || DEFAULT_CHART_PREFERENCES.timeframe,
      metric: preference.metric || DEFAULT_CHART_PREFERENCES.metric,
    };
  } catch (error) {
    console.error('❌ Failed to load chart preferences:', error);
    return DEFAULT_CHART_PREFERENCES;
  }
}

/**
 * Clear chart preferences
 * @returns {boolean} Success status
 */
export function clearChartPreferences() {
  try {
    localStorage.removeItem(CHART_PREFERENCES_KEY);
    console.info('🗑️ Chart preferences cleared');
    return true;
  } catch (error) {
    console.error('❌ Failed to clear chart preferences:', error);
    return false;
  }
}

/**
 * Update a specific chart preference
 * @param {string} key - Preference key ('timeframe' or 'metric')
 * @param {string} value - Preference value
 * @returns {boolean} Success status
 */
export function updateChartPreference(key, value) {
  const currentPreferences = loadChartPreferences();
  const newPreferences = {
    ...currentPreferences,
    [key]: value,
  };
  return saveChartPreferences(newPreferences);
}

/**
 * Get information about saved preferences
 * @returns {Object} Preference info object
 */
export function getChartPreferencesInfo() {
  try {
    const saved = localStorage.getItem(CHART_PREFERENCES_KEY);

    if (!saved) {
      return {
        exists: false,
        savedAt: null,
        hasDefaults: true,
        defaultsApplied: DEFAULT_CHART_PREFERENCES,
      };
    }

    const preference = JSON.parse(saved);
    const savedDate = new Date(preference.savedAt);
    const now = new Date();
    const daysAgo = Math.floor((now - savedDate) / (1000 * 60 * 60 * 24));

    return {
      exists: true,
      savedAt: preference.savedAt,
      lastSaved:
        daysAgo === 0
          ? 'today'
          : daysAgo === 1
            ? 'yesterday'
            : `${daysAgo} days ago`,
      preferences: {
        timeframe: preference.timeframe,
        metric: preference.metric,
      },
      hasDefaults: true,
      defaultsApplied: DEFAULT_CHART_PREFERENCES,
    };
  } catch (error) {
    console.error('❌ Failed to get chart preferences info:', error);
    return {
      exists: false,
      savedAt: null,
      hasDefaults: true,
      defaultsApplied: DEFAULT_CHART_PREFERENCES,
    };
  }
}
