/**
 * MATHEMATICAL UTILITIES - Statistical calculations and data processing
 *
 * This module provides statistical calculation functions used throughout
 * the ranking system. These utilities support both ranking algorithms
 * and conditional cell coloring based on statistical analysis.
 *
 * KEY FEATURES:
 * - Statistical calculations (mean, standard deviation)
 * - Data extraction utilities
 * - Pure functions for testability
 * - Optimized for performance
 */

import { math } from './simpleMath';

/**
 * Extract a column of values from stock data
 */
export const getColList = (name, stockData) => {
  const list = [];
  for (let i = 0; i < stockData.length; i++) {
    const row = stockData[i];
    list.push(row[name]);
  }
  return list;
};

/**
 * Calculate average of a column
 */
export const getColAverage = (col, stockData) => {
  const list = getColList(col, stockData);
  return list.length > 0 ? math.mean(...list) : 0;
};

/**
 * Calculate standard deviation of a column
 */
export const getColStandardDeviation = (col, stockData) => {
  const list = getColList(col, stockData);
  return list.length > 0 ? math.std(...list) : 0;
};

/**
 * Calculate average of a list
 */
export const getListAverage = list => {
  return list.length > 0 ? math.mean(...list) : 0;
};

/**
 * Format numbers with commas for display
 */
export const formatNumberWithCommas = value => {
  if (typeof value === 'number') {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return value;
};

/**
 * Calculate statistical ranges for conditional coloring
 */
export const getStatisticalRanges = (average, stdDev) => {
  return {
    excellent: {
      min: average + 2 * stdDev,
      max: Infinity,
    },
    veryGood: {
      min: average + 1.5 * stdDev,
      max: average + 2 * stdDev,
    },
    good: {
      min: average + 1 * stdDev,
      max: average + 1.5 * stdDev,
    },
    slightlyGood: {
      min: average + 0.5 * stdDev,
      max: average + 1 * stdDev,
    },
    average: {
      min: average - 0.5 * stdDev,
      max: average + 0.5 * stdDev,
    },
    slightlyPoor: {
      min: average - 1 * stdDev,
      max: average - 0.5 * stdDev,
    },
    poor: {
      min: average - 1.5 * stdDev,
      max: average - 1 * stdDev,
    },
    veryPoor: {
      min: average - 2 * stdDev,
      max: average - 1.5 * stdDev,
    },
    terrible: {
      min: -Infinity,
      max: average - 2 * stdDev,
    },
  };
};
