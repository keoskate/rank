/**
 * COLUMN VISIBILITY PREFERENCE UTILITIES
 *
 * Manages persistence of column visibility settings across page refreshes.
 * Provides localStorage-based saving and loading of user's column visibility choices.
 */

const COLUMN_VISIBILITY_PREFERENCE_KEY = 'keo_stonks_column_visibility';

/**
 * Default column visibility settings
 * By default, hide the company name column to keep table compact
 */
const DEFAULT_COLUMN_VISIBILITY = {
  name: false, // Hide company name by default as it makes rows too large
};

/**
 * Save the current column visibility settings to localStorage
 * @param {Object} columnVisibility - Column visibility object
 * @returns {boolean} Success status
 */
export function saveColumnVisibilityPreference(columnVisibility) {
  try {
    const preference = {
      columnVisibility,
      savedAt: new Date().toISOString(),
      version: '1.0',
    };

    localStorage.setItem(
      COLUMN_VISIBILITY_PREFERENCE_KEY,
      JSON.stringify(preference)
    );
    console.info(`💾 Column visibility preference saved`);
    return true;
  } catch (error) {
    console.error('❌ Failed to save column visibility preference:', error);
    return false;
  }
}

/**
 * Load the saved column visibility settings from localStorage
 * @returns {Object} Column visibility object with defaults applied
 */
export function loadColumnVisibilityPreference() {
  try {
    const saved = localStorage.getItem(COLUMN_VISIBILITY_PREFERENCE_KEY);

    if (!saved) {
      console.info(
        '📋 No saved column visibility preference found, using defaults'
      );
      return DEFAULT_COLUMN_VISIBILITY;
    }

    const preference = JSON.parse(saved);

    if (!preference.columnVisibility) {
      console.warn(
        '⚠️ Invalid column visibility preference format, using defaults'
      );
      return DEFAULT_COLUMN_VISIBILITY;
    }

    console.info('🔄 Loaded saved column visibility preferences');
    return { ...DEFAULT_COLUMN_VISIBILITY, ...preference.columnVisibility };
  } catch (error) {
    console.error('❌ Failed to load column visibility preference:', error);
    return DEFAULT_COLUMN_VISIBILITY;
  }
}

/**
 * Clear the saved column visibility preference
 * @returns {boolean} Success status
 */
export function clearColumnVisibilityPreference() {
  try {
    localStorage.removeItem(COLUMN_VISIBILITY_PREFERENCE_KEY);
    console.info('🗑️ Column visibility preference cleared');
    return true;
  } catch (error) {
    console.error('❌ Failed to clear column visibility preference:', error);
    return false;
  }
}

/**
 * Get information about the saved preference
 * @returns {Object} Preference info object
 */
export function getColumnVisibilityPreferenceInfo() {
  try {
    const saved = localStorage.getItem(COLUMN_VISIBILITY_PREFERENCE_KEY);

    if (!saved) {
      return {
        exists: false,
        savedAt: null,
        hasDefaults: true,
        defaultsApplied: DEFAULT_COLUMN_VISIBILITY,
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
      columnVisibility: preference.columnVisibility,
      hasDefaults: true,
      defaultsApplied: DEFAULT_COLUMN_VISIBILITY,
    };
  } catch (error) {
    console.error('❌ Failed to get column visibility preference info:', error);
    return {
      exists: false,
      savedAt: null,
      hasDefaults: true,
      defaultsApplied: DEFAULT_COLUMN_VISIBILITY,
    };
  }
}
