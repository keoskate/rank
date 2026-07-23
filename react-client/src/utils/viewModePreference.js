/**
 * VIEW MODE PREFERENCE MANAGER
 *
 * Manages the live-trading UI view mode ('easy' | 'full') with localStorage
 * persistence, mirroring debugPreference.js. Kept as a standalone local-only
 * preference (NOT in TradingConfigContext) so it never leaks into the trading
 * config that gets PUT to the backend / exported / snapshotted.
 *
 *   easy = curated MVP view (what's real vs practice, clear controls)
 *   full = everything, nothing hidden
 */

const VIEW_MODE_KEY = 'stonks_view_mode';
const MODES = ['easy', 'full'];

/**
 * Get the current view mode preference.
 * @returns {'easy'|'full'} defaults to 'easy'
 */
export function getViewModePreference() {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored && MODES.includes(stored)) {
      return stored;
    }
    // Default to 'easy' — the curated view is the friendlier starting point.
    return 'easy';
  } catch (error) {
    console.warn('Failed to read view mode from localStorage:', error);
    return 'easy';
  }
}

/**
 * Save the view mode preference.
 * @param {'easy'|'full'} mode
 */
export function setViewModePreference(mode) {
  const normalized = MODES.includes(mode) ? mode : 'easy';
  try {
    localStorage.setItem(VIEW_MODE_KEY, normalized);
    console.info(`👁️  View mode saved: ${normalized}`);
  } catch (error) {
    console.error('Failed to save view mode to localStorage:', error);
  }
}

/**
 * Toggle between 'easy' and 'full'.
 * @returns {'easy'|'full'} the new mode
 */
export function toggleViewModePreference() {
  const next = getViewModePreference() === 'easy' ? 'full' : 'easy';
  setViewModePreference(next);
  return next;
}
