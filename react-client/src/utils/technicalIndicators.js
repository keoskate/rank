/**
 * TECHNICAL INDICATORS - RSI and other technical analysis calculations
 *
 * Provides accurate calculations for technical indicators based on real price data.
 */

/**
 * Calculate RSI (Relative Strength Index) from price data
 *
 * RSI measures momentum by comparing the magnitude of recent gains to recent losses.
 * Traditional RSI uses 14 periods, but this can be adjusted.
 *
 * Formula:
 * 1. Calculate price changes between periods
 * 2. Separate gains (positive changes) from losses (negative changes)
 * 3. Calculate smoothed average gain and average loss using Wilder's smoothing
 * 4. RS = Average Gain / Average Loss
 * 5. RSI = 100 - (100 / (1 + RS))
 *
 * @param {number[]} prices - Array of closing prices (chronological order)
 * @param {number} period - RSI period (default: 14)
 * @returns {number[]} Array of RSI values (same length as prices, with null for initial periods)
 */
export function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) {
    console.warn('Not enough price data to calculate RSI');
    return new Array(prices?.length || 0).fill(null);
  }

  const rsiValues = new Array(prices.length).fill(null);
  const gains = [];
  const losses = [];

  // Step 1: Calculate price changes and separate gains/losses
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // Step 2: Calculate initial average gain and loss (simple average for first period)
  let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

  // Calculate first RSI value
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiValues[period] = 100 - (100 / (1 + rs));

  // Step 3: Calculate subsequent RSI values using Wilder's smoothing
  // Wilder's smoothing: new avg = (previous avg * (period - 1) + current value) / period
  for (let i = period; i < gains.length; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues[i + 1] = 100 - (100 / (1 + rs));
  }

  return rsiValues;
}

/**
 * Calculate RSI for intraday data (with open and close prices)
 * When data includes both open and close prices (like generated price data),
 * calculate RSI using only closing prices at appropriate intervals
 *
 * @param {number[]} prices - Array of prices (may include open and close)
 * @param {string[]} labels - Array of timestamps corresponding to prices
 * @param {number} period - RSI period (default: 14)
 * @returns {number[]} Array of RSI values aligned with input prices
 */
export function calculateIntradayRSI(prices, labels, period = 14) {
  if (!prices || !labels || prices.length !== labels.length) {
    console.warn('Invalid price or label data for intraday RSI');
    return new Array(prices?.length || 0).fill(null);
  }

  // Extract closing prices only (filter to one price per day)
  const closingPrices = [];
  const closingIndices = [];

  let currentDate = null;
  for (let i = 0; i < labels.length; i++) {
    const date = new Date(labels[i]);
    const dateStr = date.toISOString().split('T')[0];

    // For each day, keep only the last (closing) price
    if (dateStr !== currentDate) {
      // If we have a previous day, save its last price
      if (currentDate !== null && i > 0) {
        closingPrices.push(prices[i - 1]);
        closingIndices.push(i - 1);
      }
      currentDate = dateStr;
    }
  }

  // Add the final closing price
  if (labels.length > 0) {
    closingPrices.push(prices[prices.length - 1]);
    closingIndices.push(prices.length - 1);
  }

  // Calculate RSI on closing prices
  const closingRSI = calculateRSI(closingPrices, period);

  // Map RSI values back to all data points (interpolate for intraday)
  const rsiValues = new Array(prices.length).fill(null);

  for (let i = 0; i < closingIndices.length; i++) {
    const index = closingIndices[i];
    rsiValues[index] = closingRSI[i];

    // For intraday data, carry forward the previous close's RSI until next close
    if (i > 0) {
      const prevIndex = closingIndices[i - 1];
      for (let j = prevIndex + 1; j < index; j++) {
        rsiValues[j] = closingRSI[i - 1];
      }
    }
  }

  return rsiValues;
}

/**
 * Get the current RSI value from a stock's historical price data
 * This provides a single current RSI value based on recent price history
 *
 * @param {number[]} recentPrices - Array of recent closing prices (at least 15 prices)
 * @param {number} period - RSI period (default: 14)
 * @returns {number|null} Current RSI value, or null if insufficient data
 */
export function getCurrentRSI(recentPrices, period = 14) {
  if (!recentPrices || recentPrices.length < period + 1) {
    return null;
  }

  const rsiValues = calculateRSI(recentPrices, period);
  // Return the most recent non-null RSI value
  for (let i = rsiValues.length - 1; i >= 0; i--) {
    if (rsiValues[i] !== null && isFinite(rsiValues[i])) {
      return rsiValues[i];
    }
  }

  return null;
}

/**
 * Validate RSI values (should be between 0 and 100)
 *
 * @param {number[]} rsiValues - Array of RSI values
 * @returns {number[]} Validated RSI values (clamped to 0-100 range)
 */
export function validateRSI(rsiValues) {
  return rsiValues.map(value => {
    if (value === null || value === undefined) return null;
    if (!isFinite(value)) return null;
    return Math.max(0, Math.min(100, value));
  });
}
