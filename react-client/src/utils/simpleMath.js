/**
 * SIMPLE MATH UTILITIES
 * 
 * Lightweight replacement for mathjs functions.
 * Reduces bundle size by ~200KB by removing the heavy mathjs dependency.
 */

/**
 * Calculate the mean (average) of an array of numbers
 * @param {...number} values - Numbers to calculate mean for
 * @returns {number} The mean value
 */
export function mean(...values) {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + (val || 0), 0);
  return sum / values.length;
}

/**
 * Calculate the standard deviation of an array of numbers
 * @param {...number} values - Numbers to calculate standard deviation for
 * @returns {number} The standard deviation
 */
export function std(...values) {
  if (values.length === 0) return 0;
  if (values.length === 1) return 0;
  
  const meanValue = mean(...values);
  const squaredDifferences = values.map(value => {
    const diff = (value || 0) - meanValue;
    return diff * diff;
  });
  
  const variance = mean(...squaredDifferences);
  return Math.sqrt(variance);
}

// Export as an object that matches mathjs interface for easy replacement
export const math = {
  mean,
  std
};