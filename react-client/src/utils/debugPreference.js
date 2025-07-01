/**
 * DEBUG PREFERENCE MANAGER
 * 
 * Manages the DEBUG mode preference with localStorage persistence.
 * This allows users to set their preference and have it persist across page refreshes.
 */

const DEBUG_PREFERENCE_KEY = 'stonks_debug_mode';

/**
 * Get the current debug mode preference
 * @returns {boolean} True if debug mode is enabled
 */
export function getDebugPreference() {
  try {
    const stored = localStorage.getItem(DEBUG_PREFERENCE_KEY);
    if (stored !== null) {
      return JSON.parse(stored);
    }
    // Default to false (Live API mode) for new users
    return false;
  } catch (error) {
    console.warn('Failed to read debug preference from localStorage:', error);
    return false;
  }
}

/**
 * Save the debug mode preference
 * @param {boolean} isDebugMode - Whether debug mode should be enabled
 */
export function setDebugPreference(isDebugMode) {
  try {
    localStorage.setItem(DEBUG_PREFERENCE_KEY, JSON.stringify(isDebugMode));
    console.info(`🔧 Debug mode preference saved: ${isDebugMode ? 'ON' : 'OFF'}`);
  } catch (error) {
    console.error('Failed to save debug preference to localStorage:', error);
  }
}

/**
 * Toggle the debug mode preference
 * @returns {boolean} The new debug mode state
 */
export function toggleDebugPreference() {
  const current = getDebugPreference();
  const newValue = !current;
  setDebugPreference(newValue);
  return newValue;
}

/**
 * Clear the debug preference (resets to default)
 */
export function clearDebugPreference() {
  try {
    localStorage.removeItem(DEBUG_PREFERENCE_KEY);
    console.info('🔧 Debug mode preference cleared (reset to default)');
  } catch (error) {
    console.error('Failed to clear debug preference:', error);
  }
}

/**
 * Get a human-readable description of the current mode
 * @param {boolean} isDebugMode - The current debug mode state
 * @returns {object} Object with mode info
 */
export function getDebugModeInfo(isDebugMode) {
  if (isDebugMode) {
    return {
      mode: 'Debug (Cached)',
      description: 'Using cached data only - preserves API quota',
      icon: '🔒',
      color: '#28a745',
      behavior: 'No API calls, loads cached data instantly'
    };
  } else {
    return {
      mode: 'Live (API)',
      description: 'Fetching fresh data from API - uses quota',
      icon: '🌐',
      color: '#007bff',
      behavior: 'Makes API calls, updates data in real-time'
    };
  }
}