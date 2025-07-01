/**
 * STOCK DATA HOOK - Custom hook for managing stock data fetching and state
 *
 * This hook encapsulates all stock data fetching logic, progressive loading,
 * and data state management. It provides a clean API for components to
 * interact with stock data without dealing with implementation details.
 *
 * KEY FEATURES:
 * - Progressive data loading (prevents API rate limiting)
 * - Debug mode support (uses cached data)
 * - Loading state management
 * - Error handling
 * - Data cleaning and normalization
 */

import { useState, useCallback } from 'react';
import * as Utils from '../Components/StockUtils';

const THROTTLE = {
  SMALL: 100,
  MEDIUM: 500,
  LARGE: 1000,
};

export const useStockData = (stocksConfig, debugMode = true) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Utility function for waiting
  const wait = useCallback(ms => {
    const start = new Date().getTime();
    let end = start;
    while (end < start + ms) {
      end = new Date().getTime();
    }
  }, []);

  // Get financial data for a list of stocks
  const getFinancialData = useCallback(
    async (stocks, fetchFinancials = false) => {
      console.info('Fetching Stocks: ' + stocks);
      if (debugMode) {
        return stocksConfig[1]; // Cached data is at index 1
      } else {
        const fetchAll = [];
        stocks.forEach(stock => {
          fetchAll.push(Utils.getStockData(stock, fetchFinancials, false));
          wait(THROTTLE.MEDIUM);
        });
        const fetchedData = await Promise.all(fetchAll);
        return fetchedData.filter(x => x && x.ticker);
      }
    },
    [debugMode, stocksConfig, wait]
  );

  // Clean data by swapping keys to match parameter structure
  const cleanData = useCallback((stockData, params) => {
    for (const row in stockData) {
      stockData[row] = swapKeys(stockData[row], params);
    }
    return stockData;
  }, []);

  // Swap keys to match expected parameter structure
  const swapKeys = useCallback((rowItem, params) => {
    const newRow = {};
    const goodKeys = Object.keys(params);
    Object.keys(rowItem).map((key, index) => {
      newRow[goodKeys[index]] = rowItem[key];
    });
    return newRow;
  }, []);

  // Fetch all stock data progressively
  const fetchAllData = useCallback(
    async (offset, getFinancials = false, onProgressUpdate) => {
      wait(THROTTLE.LARGE);

      for (let i = offset; i < stocksConfig[0].length; i += offset) {
        try {
          const stockData = await getFinancialData(
            stocksConfig[0].slice(i, i + offset),
            getFinancials
          );
          const cleanedData = debugMode ? stockData : cleanData(stockData);

          // Call progress update callback if provided
          if (onProgressUpdate) {
            onProgressUpdate(cleanedData, i + offset);
          }

          wait(THROTTLE.LARGE + THROTTLE.SMALL);
        } catch (err) {
          console.error('Error fetching batch:', err);
          setError(err);
        }
      }
    },
    [stocksConfig, getFinancialData, debugMode, cleanData, wait]
  );

  // Initialize data loading
  const initializeData = useCallback(
    async (params, offset = 5, getFinancials = false) => {
      console.info(`Welcome to Keo Stonks V2!`);
      console.info(`DEBUG_MODE = ${debugMode ? 'ON' : 'OFF'}`);

      try {
        setLoading(true);
        setError(null);

        // Get the first batch of stocks and display them right away
        const initialData = await getFinancialData(
          stocksConfig[0].slice(0, offset),
          getFinancials
        );
        const cleanedData = debugMode
          ? initialData
          : cleanData(initialData, params);

        setData(cleanedData);
        setLoading(false);

        // Fetch remaining data in background if not in debug mode
        if (!debugMode) {
          fetchAllData(offset, getFinancials, (newData, progress) => {
            const mergedData = [...data, ...newData];
            console.info('Merged Data:', mergedData);
            setData(mergedData);
          });
        }

        return cleanedData;
      } catch (err) {
        console.error('Error initializing data:', err);
        setError(err);
        setLoading(false);
        return [];
      }
    },
    [debugMode, stocksConfig, getFinancialData, cleanData, fetchAllData, data]
  );

  return {
    data,
    loading,
    error,
    initializeData,
    setData,
  };
};
