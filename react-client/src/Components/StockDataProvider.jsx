/**
 * STOCK DATA PROVIDER - Shared data context for the application
 *
 * Provides stock data, rankings, and configurations to components
 * that need access to the complete dataset for analysis.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { getCachedStockData, cacheOrFetch, cacheWithBackgroundRefresh } from '../utils/cacheManager';
import { STOCK_COLUMNS } from '../config/stockColumns';
import { getStockList, DEFAULT_STOCK_LIST } from '../config/stockLists';
import { getDebugPreference } from '../utils/debugPreference';
import * as Utils from './StockUtils';

const StockDataContext = createContext();

export const useStockData = () => {
  const context = useContext(StockDataContext);
  if (!context) {
    throw new Error('useStockData must be used within a StockDataProvider');
  }
  return context;
};

export const StockDataProvider = ({ children }) => {
  const [stockData, setStockData] = useState([]);
  const [stockColumns, setStockColumns] = useState(STOCK_COLUMNS);
  const [currentStockList, setCurrentStockList] = useState(getStockList(DEFAULT_STOCK_LIST));
  const [isLoading, setIsLoading] = useState(true);

  // Get stock data with smart caching
  const getFinancialData = async (stocks, fetchFinancials = false) => {
    console.info('Fetching Stocks: ' + stocks);

    // Generate cache key based on stocks and settings
    const stocksKey = stocks.sort().join('_');
    const cacheKey = `STOCKS_${stocksKey}_${fetchFinancials ? 'with_financials' : 'basic'}`;
    const debugMode = getDebugPreference();

    // Try smart cache first in debug mode
    if (debugMode) {
      const smartCached = getCachedStockData(cacheKey);
      if (smartCached) {
        console.info(`📦 Using smart cache for ${stocks.length} stocks`);
        return smartCached;
      }
      console.info(
        `📁 No cache found - fetching ${stocks.length} stocks in debug mode (quota-saving)`
      );
    }

    try {
      // GET API INFO FIRST
      const apiInfo = Utils.getApiInfo();
      console.info(
        `🚀 Using ${apiInfo.name} (${apiInfo.cost}) - Configure in config/apiConfig.js`
      );

      // Smart cache-or-fetch: tries cache first, fetches if needed, caches good results
      const fetchFunction = async () => {
        const fetchedData = await Utils.getMultipleStocksData(
          stocks,
          null, // Provider determined by config
          { fetchFinancials }
        );

        // Filter out null responses and ensure valid ticker
        return fetchedData.filter(x => x && x.ticker);
      };

      // Use background refresh for real-time updates when not in debug mode
      if (!debugMode) {
        return await cacheWithBackgroundRefresh(
          cacheKey,
          fetchFunction,
          freshData => {
            // Background update callback
            console.info('🔄 Updating with fresh background data...');
            const cleanedData = cleanData(freshData);
            setStockData(cleanedData);
          },
          {
            provider: apiInfo.provider,
            forceRefresh: fetchFinancials,
          }
        );
      } else {
        // Debug mode - use standard cache behavior
        return await cacheOrFetch(cacheKey, fetchFunction, {
          provider: apiInfo.provider,
          forceRefresh: fetchFinancials,
        });
      }
    } catch (error) {
      console.error('❌ Failed to fetch stock data:', error);
      throw error;
    }
  };

  // Clean data function (simplified version)
  const cleanData = (data) => {
    return data.filter(item => item && item.ticker);
  };

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // First try cached data
        const cachedData = getCachedStockData();
        if (cachedData && cachedData.length > 0) {
          console.log(`📂 Loaded ${cachedData.length} stocks from cache`);
          setStockData(cachedData);
          setIsLoading(false);
          return;
        }

        // No cached data - fetch fresh data
        console.log('📂 No cached data found - fetching fresh data');
        const stockSymbols = currentStockList.stocks;
        const freshData = await getFinancialData(stockSymbols, false);
        const cleanedData = cleanData(freshData);
        
        setStockData(cleanedData);
        setIsLoading(false);
        
        console.info(`✅ Successfully loaded ${cleanedData.length} stocks`);
      } catch (error) {
        console.error('Failed to load stock data:', error);
        setIsLoading(false);
      }
    };

    loadData();
  }, []); // Only run once on mount

  const updateStockData = (data, columns, stockList) => {
    setStockData(data);
    if (columns) setStockColumns(columns);
    if (stockList) setCurrentStockList(stockList);
    setIsLoading(false);
  };

  const value = {
    stockData,
    stockColumns,
    currentStockList,
    isLoading,
    updateStockData,
  };

  return (
    <StockDataContext.Provider value={value}>
      {children}
    </StockDataContext.Provider>
  );
};

export default StockDataProvider;
