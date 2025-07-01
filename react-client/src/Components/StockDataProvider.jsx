/**
 * STOCK DATA PROVIDER - Shared data context for the application
 * 
 * Provides stock data, rankings, and configurations to components
 * that need access to the complete dataset for analysis.
 */

import React, { createContext, useContext, useState } from 'react';

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
  const [stockColumns, setStockColumns] = useState({});
  const [currentStockList, setCurrentStockList] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  const updateStockData = (data, columns, stockList) => {
    setStockData(data);
    setStockColumns(columns);
    setCurrentStockList(stockList);
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