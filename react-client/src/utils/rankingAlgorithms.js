/**
 * RANKING ALGORITHMS - Core ranking calculation utilities
 *
 * This module contains the two primary ranking algorithms used in the application:
 * 1. Relative Position Ranking - Ranks by relative position within each metric
 * 2. Statistical Standard Deviation Ranking - Ranks by statistical variance from mean
 *
 * These algorithms are the heart of the stock ranking system and are used to
 * generate the dual ranking approach that provides comprehensive stock analysis.
 *
 * KEY FEATURES:
 * - Pure functions for testability
 * - Separated concerns for maintainability
 * - Statistical calculations for conditional coloring
 * - Grid-based ranking system
 */

import * as math from 'mathjs';
import {
  getColAverage,
  getColStandardDeviation,
  getColList,
} from './mathUtils';

/**
 * RANKING ALGORITHM #1: Relative Position Ranking
 *
 * Ranks stocks by their relative position within each metric:
 * - Sorts stocks by each column value
 * - Assigns rank 1, 2, 3, etc.
 * - Applies user-defined weights
 * - Better for understanding relative performance
 */
export const rankCols = (grid, stockData, params) => {
  for (let col in params) {
    const param = params[col];
    const order = param.multiplier === 1 ? 'asc' : 'desc';
    const weight = param.weight;

    if (weight > 0) {
      const colList = getColList(col, stockData);
      const rankedCol = rankCol(colList, order);

      for (let row in grid) {
        grid[row][col] = rankedCol[row].rank * (1 + weight);
      }
    }
  }

  getSumAndRelativeRank(grid, 'desc');
};

/**
 * RANKING ALGORITHM #2: Statistical Standard Deviation Ranking
 *
 * Ranks stocks by how many standard deviations they are from the mean:
 * - Calculates mean and standard deviation for each metric
 * - Scores based on statistical variance from average
 * - Better for identifying statistical outliers
 * - Used for conditional cell coloring (green/red highlighting)
 */
export const rankColsStd = (grid, stockData, params, setParams) => {
  for (let col in params) {
    const param = params[col];
    const multiplier = param.multiplier;

    // Don't rank non-numerical data
    if (multiplier !== 0) {
      const order = param.multiplier === 1 ? 'asc' : 'desc';
      const weight = param.weight;
      let stdDev = undefined;
      let average = undefined;

      if (!param.average && !param.stdDev) {
        stdDev = getColStandardDeviation(col, stockData);
        average = getColAverage(col, stockData);

        // Update params with calculated values
        if (setParams) {
          setParams(prev => ({
            ...prev,
            [col]: {
              ...prev[col],
              stdDev,
              average,
            },
          }));
        }
      }

      stdDev = param.stdDev || getColStandardDeviation(col, stockData);
      average = param.average || getColAverage(col, stockData);

      if (weight > 0) {
        const colList = getColList(col, stockData);
        const rankedCol = rankCol(colList, order);

        for (let row in grid) {
          let variance = (rankedCol[row].item - average) / stdDev;
          grid[row][col] = variance * multiplier * (1 + weight);
        }
      }
    }
  }

  getSumAndRelativeRank(grid, 'desc');
};

/**
 * Calculate final ranking by combining relative and standard deviation rankings
 */
export const calculateRank = (stockData, relativeGrid, stdGrid) => {
  stockData.map((row, index) => {
    row.rank = math.mean(relativeGrid[index].goodRank, stdGrid[index].goodRank);
  });

  const rankList = getColList('rank', stockData);
  const rankedRankList = rankCol(rankList, 'asc');

  stockData.map((row, index) => {
    const rank = rankedRankList[index].rank;
    const range = rankedRankList.slice(0, index);
    const count = countIf(range, rank) === 0 ? 1 : countIf(range, rank) + 1;
    const trueRank = rank + count - 1;
    row.rank = trueRank;
  });
};

/**
 * Initialize grid structure for ranking calculations
 */
export const initGrid = (stockData, params) => {
  let grid = [];
  for (let i = 0; i < stockData.length; i++) {
    const row = stockData[i];
    let clearedRow = {};

    for (let col in row) {
      if (col === 'ticker') {
        clearedRow[col] = row[col];
      } else {
        const weight = params[col]?.weight || 0;
        clearedRow[col] = weight === 0 ? 0 : row[col];
      }
    }
    grid.push(clearedRow);
  }
  return grid;
};

/**
 * Calculate sum and relative rank for grid
 */
const getSumAndRelativeRank = (grid, order) => {
  for (let i = 0; i < grid.length; i++) {
    const rowItem = grid[i];
    let rowSum = 0;

    for (let colName in rowItem) {
      if (colName !== 'ticker') {
        const cell = rowItem[colName];
        rowSum += cell;
      }
    }
    grid[i].sum = rowSum;
  }

  const sumList = getColList('sum', grid);
  const rankedSumList = rankCol(sumList, order);

  for (let row in grid) {
    grid[row]['goodRank'] = rankedSumList[row].rank;
  }
};

/**
 * Rank a column of values
 */
const rankCol = (list, order) => {
  const rankedList = [...list];
  const rankings = rankedList.map((item, index) => ({
    item: item,
    row: index,
  }));

  if (order === 'asc') {
    rankings.sort((a, b) => a.item - b.item);
  } else {
    rankings.sort((a, b) => b.item - a.item);
  }

  rankings.forEach((holder, index, rankings) => {
    const prevHolder = rankings[index - 1];
    if (prevHolder && holder.item === prevHolder.item) {
      holder.rank = prevHolder.rank;
    } else {
      holder.rank = index + 1;
    }
  });

  rankings.sort((a, b) => a.row - b.row);
  return rankings;
};

/**
 * Count occurrences of a specific rank
 */
const countIf = (list, number) => {
  return list.reduce((sum, item) => {
    return sum + (item.rank === number);
  }, 0);
};
