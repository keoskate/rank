/**
 * Lightweight Charts Shim
 *
 * This shim handles the UMD/standalone build of lightweight-charts
 * which doesn't export properly for webpack 4.
 */

// Import the standalone build
import 'lightweight-charts/dist/lightweight-charts.standalone.production.js';

// The standalone build attaches to window.LightweightCharts
const LightweightCharts = window.LightweightCharts || {};

export const createChart = LightweightCharts.createChart;
export const ColorType = LightweightCharts.ColorType;
export const CrosshairMode = LightweightCharts.CrosshairMode;
export const LineStyle = LightweightCharts.LineStyle;
export const PriceScaleMode = LightweightCharts.PriceScaleMode;

export default LightweightCharts;
