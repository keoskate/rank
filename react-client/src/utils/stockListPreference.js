/**
 * STOCK LIST PREFERENCE UTILITIES
 *
 * Manages persistence of selected stock list across page refreshes.
 * Provides localStorage-based saving and loading of user's stock list choice.
 */

const STOCK_LIST_PREFERENCE_KEY = 'keo_stonks_selected_stock_list';

/**
 * Save the current stock list selection to localStorage
 * @param {string} stockListId - ID of the selected stock list
 * @returns {boolean} Success status
 */
export function saveStockListPreference(stockListId) {
  try {
    const preference = {
      stockListId,
      savedAt: new Date().toISOString(),
      version: '1.0',
    };

    localStorage.setItem(STOCK_LIST_PREFERENCE_KEY, JSON.stringify(preference));
    console.info(`💾 Stock list preference saved: ${stockListId}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to save stock list preference:', error);
    return false;
  }
}

/**
 * Load the saved stock list selection from localStorage
 * @param {string} defaultStockListId - Fallback stock list ID if none saved
 * @returns {string} The stock list ID to use
 */
export function loadStockListPreference(defaultStockListId) {
  try {
    const saved = localStorage.getItem(STOCK_LIST_PREFERENCE_KEY);

    if (!saved) {
      console.info('📋 No saved stock list preference found, using default');
      return defaultStockListId;
    }

    const preference = JSON.parse(saved);

    if (!preference.stockListId) {
      console.warn('⚠️ Invalid stock list preference format, using default');
      return defaultStockListId;
    }

    console.info(
      `🔄 Loaded saved stock list preference: ${preference.stockListId}`
    );
    return preference.stockListId;
  } catch (error) {
    console.error('❌ Failed to load stock list preference:', error);
    return defaultStockListId;
  }
}

/**
 * Clear the saved stock list preference
 * @returns {boolean} Success status
 */
export function clearStockListPreference() {
  try {
    localStorage.removeItem(STOCK_LIST_PREFERENCE_KEY);
    console.info('🗑️ Stock list preference cleared');
    return true;
  } catch (error) {
    console.error('❌ Failed to clear stock list preference:', error);
    return false;
  }
}

/**
 * Get information about the saved preference
 * @returns {Object} Preference info object
 */
export function getStockListPreferenceInfo() {
  try {
    const saved = localStorage.getItem(STOCK_LIST_PREFERENCE_KEY);

    if (!saved) {
      return {
        exists: false,
        stockListId: null,
        savedAt: null,
      };
    }

    const preference = JSON.parse(saved);
    const savedDate = new Date(preference.savedAt);
    const now = new Date();
    const daysAgo = Math.floor((now - savedDate) / (1000 * 60 * 60 * 24));

    return {
      exists: true,
      stockListId: preference.stockListId,
      savedAt: preference.savedAt,
      lastSaved:
        daysAgo === 0
          ? 'today'
          : daysAgo === 1
            ? 'yesterday'
            : `${daysAgo} days ago`,
    };
  } catch (error) {
    console.error('❌ Failed to get stock list preference info:', error);
    return {
      exists: false,
      stockListId: null,
      savedAt: null,
    };
  }
}
