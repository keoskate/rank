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
import { loadStockListPreference } from '../utils/stockListPreference';
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
  const [currentStockList, setCurrentStockList] = useState(() => {
    const savedStockListId = loadStockListPreference(DEFAULT_STOCK_LIST);
    return getStockList(savedStockListId);
  });
  const [isLoading, setIsLoading] = useState(true);

  // Clean data function (simplified version)
  const cleanData = (data) => {
    return data.filter(item => item && item.ticker);
  };

  // Load cached data on mount (if available)
  useEffect(() => {
    // Generate the same cache key that ModernStonkBoard uses
    const stockSymbols = currentStockList.stocks;
    const stocksKey = stockSymbols.sort().join('_');
    const cacheKey = `STOCKS_${stocksKey}_basic`; // ModernStonkBoard uses fetchFinancials=false initially
    
    const cachedData = getCachedStockData(cacheKey);
    if (cachedData && cachedData.length > 0) {
      console.log(`📂 Loaded ${cachedData.length} stocks from cache (${currentStockList.name})`);
      setStockData(cachedData);
      setIsLoading(false);
    } else {
      console.log(`📭 No cached data found for ${currentStockList.name} stock list`);
      // Set loading to false even if no cache found, so StockDetailPage can show "Stock Not Found"
      setIsLoading(false);
    }
  }, [currentStockList.stocks]); // Re-run if stock list changes

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
