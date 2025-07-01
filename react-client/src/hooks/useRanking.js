/**
 * RANKING HOOK - Custom hook for managing ranking calculations and state
 *
 * This hook encapsulates all ranking logic including:
 * - Dual ranking algorithm management
 * - Grid state management
 * - Parameter updates and recalculation
 * - View switching logic
 *
 * This separation allows for easier testing of ranking logic and provides
 * a clean interface for components to interact with ranking functionality.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  rankCols,
  rankColsStd,
  calculateRank,
  initGrid,
} from '../utils/rankingAlgorithms';

export const useRanking = initialParams => {
  const [params, setParams] = useState(initialParams);
  const [rGrid, setRGrid] = useState([]);
  const [sGrid, setSGrid] = useState([]);
  const [currentView, setCurrentView] = useState('full');
  const [altGrid, setAltGrid] = useState(false);

  /**
   * CORE RANKING ENGINE - Sets up dual ranking system
   */
  const setupDataStructures = useCallback(
    stockData => {
      const relativeGrid = initGrid(stockData, params);
      const stdGrid = initGrid(stockData, params);

      rankCols(relativeGrid, stockData, params);
      rankColsStd(stdGrid, stockData, params, setParams);
      calculateRank(stockData, relativeGrid, stdGrid);

      setRGrid(relativeGrid);
      setSGrid(stdGrid);
    },
    [params]
  );

  // Handle weight changes
  const handleWeightChange = useCallback(
    evt => {
      const newWeight = evt.target.valueAsNumber || 0;
      const columnName = evt.target.name;

      const totalWeight = Object.keys(params).reduce((sum, key) => {
        return sum + (key === columnName ? 0 : params[key].weight);
      }, 0);

      if (totalWeight + newWeight > 1.0) {
        return; // Don't allow weights to exceed 1.0
      }

      setParams(prev => ({
        ...prev,
        [columnName]: {
          ...prev[columnName],
          weight: newWeight,
        },
      }));
    },
    [params]
  );

  // Handle multiplier changes
  const handleMultiplierClick = useCallback(evt => {
    const columnName = evt.target.name;

    setParams(prev => ({
      ...prev,
      [columnName]: {
        ...prev[columnName],
        multiplier: prev[columnName].multiplier === 1 ? -1 : 1,
      },
    }));
  }, []);

  // Board switching functions
  const handleFullDataScoreboard = useCallback(() => {
    setCurrentView('full');
    setAltGrid(false);
  }, []);

  const handleRelativeScoreboard = useCallback(() => {
    setCurrentView('relative');
    setAltGrid(true);
  }, []);

  const handleStdScoreboard = useCallback(() => {
    setCurrentView('std');
    setAltGrid(true);
  }, []);

  // Calculate sum of weights
  const sumOfWeights = useCallback(() => {
    return Object.keys(params).reduce(
      (sum, key) => sum + params[key].weight,
      0
    );
  }, [params]);

  return {
    // State
    params,
    rGrid,
    sGrid,
    currentView,
    altGrid,

    // Actions
    setParams,
    setupDataStructures,
    handleWeightChange,
    handleMultiplierClick,
    handleFullDataScoreboard,
    handleRelativeScoreboard,
    handleStdScoreboard,

    // Computed
    sumOfWeights,
  };
};
