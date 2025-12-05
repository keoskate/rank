/**
 * Lightweight Charts Shim
 *
 * This shim handles the UMD/standalone build of lightweight-charts
 * which doesn't export properly for webpack 4.
 */

// Import the standalone build - this attaches to window.LightweightCharts
import 'lightweight-charts/dist/lightweight-charts.standalone.production.js';

// Get reference after import
const getLightweightCharts = () => {
  if (typeof window !== 'undefined' && window.LightweightCharts) {
    return window.LightweightCharts;
  }
  return {};
};

const LightweightCharts = getLightweightCharts();

// Export createChart as a function that retrieves from window at call time
// This ensures it's available even if the script loads async
export const createChart = (...args) => {
  const lwc = typeof window !== 'undefined' && window.LightweightCharts;
  if (lwc && typeof lwc.createChart === 'function') {
    return lwc.createChart(...args);
  }
  throw new Error('lightweight-charts not loaded');
};

export const ColorType = LightweightCharts.ColorType;
export const CrosshairMode = LightweightCharts.CrosshairMode;
export const LineStyle = LightweightCharts.LineStyle;
export const PriceScaleMode = LightweightCharts.PriceScaleMode;

export default LightweightCharts;
