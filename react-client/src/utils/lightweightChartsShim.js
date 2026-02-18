/**
 * Lightweight Charts Shim
 *
 * Uses the CDN version loaded via script tag in index.html
 * Do NOT import from node_modules - it's v5 which has different API
 */

// Get reference from window (CDN loads v3.8.0 with correct API)
const getLightweightCharts = () => {
  if (typeof window !== 'undefined' && window.LightweightCharts) {
    return window.LightweightCharts;
  }
  return null;
};

// Export createChart - retrieves from window at call time
export const createChart = (...args) => {
  const lwc = getLightweightCharts();
  if (lwc && typeof lwc.createChart === 'function') {
    return lwc.createChart(...args);
  }
  throw new Error('lightweight-charts not loaded from CDN');
};

// Export other constants
export const ColorType = getLightweightCharts()?.ColorType;
export const CrosshairMode = getLightweightCharts()?.CrosshairMode;
export const LineStyle = getLightweightCharts()?.LineStyle;
export const PriceScaleMode = getLightweightCharts()?.PriceScaleMode;

export default getLightweightCharts;
