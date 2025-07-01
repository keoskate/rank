/**
 * MODERN STONK BOARD - Updated Stock Ranking Component
 *
 * This is the MODERNIZED version of the stock analysis and ranking component.
 *
 * KEY FEATURES:
 * - React 18 functional component with hooks
 * - TanStack React Table (replaces vulnerable react-bootstrap-table)
 * - Environment variables for API key security
 * - Modern async/await patterns
 * - Improved performance and security
 *
 * CRITICAL PATHS:
 * 1. useEffect() - Initial data loading
 * 2. setupDataStructures() - Core ranking calculation
 * 3. rankCols() & rankColsStd() - The two ranking algorithms
 * 4. TanStack table rendering - Modern table display
 *
 * DATA FLOW:
 * Stock Symbols → API Fetch → Data Parsing → Ranking Calculation → Modern UI Display
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import * as math from 'mathjs';
import WeightSlider from './WeightSlider';
import BoardControls from './BoardControls';
import * as cachedData20 from '../stock-data_20';
import * as Utils from './StockUtils';
import {
  cacheOrFetch,
  cacheWithBackgroundRefresh,
  getCachedStockData,
  getCacheInfo,
  clearCache,
} from '../utils/cacheManager';

/** KEO: TOGGLE FOR DEBUGGING NETWORK ISSUES */
const DEBUG = false; // If we want to use cached data (preserve network request quota)

// Configuration constants
const COVID_STOCKS = [cachedData20.COVID_19, cachedData20.COVID_19_cached];
const KEO_STOCKS = [cachedData20.KEO_STOCKS, cachedData20.KEO_STOCKS_cached];
const NEW_STOCKS = [cachedData20.NEW_STOCKS, cachedData20.NEW_STOCKS_cached];
const GROUP_STOCKS = [
  cachedData20.GROUP_STOCKS,
  cachedData20.GROUP_STOCKS_cached,
];
const MEME_STOCKS = [cachedData20.MEME_STOCKS, cachedData20.MEME_STOCKS_cached];

// Use this to combine different groups of stock (without duplicates)
const CUSTOM_STOCKS = [
  ...cachedData20.COVID_19,
  // Add other groups as needed
];

const TEST_STOCKS = [
  [...new Set(CUSTOM_STOCKS)],
  [...cachedData20.TEST_STOCKS_cached],
];

// Config for the Stock board
const STOCKS = TEST_STOCKS;

const THROTTLE = {
  SMALL: 100,
  MEDIUM: 500,
  LARGE: 1000,
};

function ModernStonkBoard() {
  // State management with hooks
  const [data, setData] = useState([]);
  const [uiData, setUiData] = useState([]);
  const [rGrid, setRGrid] = useState([]);
  const [sGrid, setSGrid] = useState([]);
  const [params, setParams] = useState(Utils.STOCK_COLUMNS);
  const [altGrid, setAltGrid] = useState(false);
  const [currentView, setCurrentView] = useState('full'); // 'full', 'relative', 'std'
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState([{ id: 'rank', desc: false }]);
  const [debugMode, setDebugMode] = useState(DEBUG); // Toggle for cached vs live data
  const [backgroundFetching, setBackgroundFetching] = useState(false);

  // Utility function for waiting
  const wait = useCallback(ms => {
    const start = new Date().getTime();
    let end = start;
    while (end < start + ms) {
      end = new Date().getTime();
    }
  }, []);

  /**
   * CRITICAL: Component initialization and data loading
   */
  useEffect(() => {
    const initializeData = async () => {
      console.info('Welcome to Keo Stonks V2!');
      console.info(`DEBUG_MODE = ${debugMode ? 'ON' : 'OFF'}`);

      try {
        const getFinancials = false;

        if (debugMode) {
          // Debug mode: Load just first 5 stocks to save quota
          const offset = 5;
          const initialData = await getFinancialData(
            STOCKS[0].slice(0, offset),
            getFinancials
          );
          const cleanedData = cleanData(initialData);
          setupDataStructures(cleanedData);
          setData(cleanedData);
          setUiData(cleanedData);
          setLoading(false);
        } else {
          // Live mode: Load ALL stocks at once (optimized for unlimited subscription)
          console.info(
            `🚀 Loading all ${STOCKS[0].length} stocks at once with unlimited subscription...`
          );
          const allData = await getFinancialData(
            STOCKS[0], // Load ALL stocks
            getFinancials
          );
          const cleanedData = cleanData(allData);
          setupDataStructures(cleanedData);
          setData(cleanedData);
          setUiData(cleanedData);
          setLoading(false);
          console.info(`✅ Successfully loaded ${allData.length} stocks`);
        }
      } catch (error) {
        console.error('Error initializing data:', error);
        setLoading(false);
      }
    };

    initializeData();
  }, []);

  // Recalculate rankings when params change
  useEffect(() => {
    if (data.length > 0) {
      setupDataStructures(data);
    }
  }, [params, setupDataStructures]);

  // Update uiData when grids change based on current view
  useEffect(() => {
    if (data.length > 0) {
      switch (currentView) {
        case 'full':
          setUiData([...data]);
          break;
        case 'relative':
          setUiData([...rGrid]);
          break;
        case 'std':
          setUiData([...sGrid]);
          break;
        default:
          setUiData([...data]);
      }
    }
  }, [rGrid, sGrid, data, currentView]);

  // Get the Stock data for a list of stocks (OPTIMIZED WITH SMART CACHING)
  const getFinancialData = async (stocks, fetchFinancials = false) => {
    console.info('Fetching Stocks: ' + stocks);

    // Generate cache key based on stocks and settings
    const stocksKey = stocks.sort().join('_');
    const cacheKey = `STOCKS_${stocksKey}_${fetchFinancials ? 'with_financials' : 'basic'}`;

    if (debugMode) {
      // Try smart cache first, fallback to static cache
      const smartCached = getCachedStockData(cacheKey);
      if (smartCached) {
        console.info(`📦 Using smart cache for ${stocks.length} stocks`);
        return smartCached;
      }

      console.info(
        `📁 No smart cache found, using static cache for ${stocks.length} stocks`
      );
      return STOCKS[1]; // Fallback to static cached data
    } else {
      try {
        // GET API INFO FIRST - outside the fetchFunction
        const apiInfo = Utils.getApiInfo();
        console.info(
          `🚀 Using ${apiInfo.name} (${apiInfo.cost}) - Configure in config/apiConfig.js`
        );

        // Smart cache-or-fetch: tries cache first, fetches if needed, caches good results
        const fetchFunction = async () => {
          const fetchedData = await Utils.getMultipleStocksData(
            stocks,
            null, // Provider determined by config
            {
              fetchFinancials,
            }
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
              // Background update callback - update table with fresh data
              console.info('🔄 Updating table with fresh background data...');
              setBackgroundFetching(false);
              const cleanedData = cleanData(freshData);
              setupDataStructures(cleanedData);
              setData(cleanedData);
              setUiData(cleanedData);
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
        console.error(
          '❌ Batch fetch failed, falling back to individual requests:',
          error
        );

        // Fallback to individual requests (legacy behavior)
        const fetchAll = [];
        stocks.forEach((stock, index) => {
          const delay = index * 12000; // 12 seconds between each call
          fetchAll.push(
            new Promise(resolve => {
              setTimeout(async () => {
                try {
                  const result = await Utils.getStockData(
                    stock,
                    fetchFinancials,
                    true
                  );
                  resolve(result);
                } catch (error) {
                  console.error(`Error fetching ${stock}:`, error);
                  resolve(null);
                }
              }, delay);
            })
          );
        });

        const fetchedData = await Promise.all(fetchAll);
        return fetchedData.filter(x => x && x.ticker);
      }
    }
  };

  // Fetch all stock data progressively
  const fetchAllData = async (offset, getFinancials = false) => {
    wait(THROTTLE.LARGE);

    for (let i = offset; i < STOCKS[0].length; i += offset) {
      const stockData = await getFinancialData(
        STOCKS[0].slice(i, i + offset),
        getFinancials
      );
      const cleanedData = cleanData(stockData);
      const mergedData = [...uiData, ...cleanedData];

      console.info('Merged Data:', mergedData);

      setupDataStructures(mergedData);
      setData(mergedData);
      setUiData(mergedData);

      wait(THROTTLE.LARGE + THROTTLE.SMALL);
    }
  };

  /**
   * CORE RANKING ENGINE - Sets up dual ranking system
   */
  const setupDataStructures = useCallback(
    stockData => {
      let relativeGrid = initGrid(stockData);
      let stdGrid = initGrid(stockData);

      rankCols(relativeGrid, stockData);
      rankColsStd(stdGrid, stockData);
      calculateRank(stockData, relativeGrid, stdGrid);

      setRGrid(relativeGrid);
      setSGrid(stdGrid);
    },
    [params]
  );

  // Initialize grid structure
  const initGrid = stockData => {
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
   * RANKING ALGORITHM #1: Relative Position Ranking
   */
  const rankCols = (grid, stockData) => {
    const parameters = params;
    for (let col in parameters) {
      const param = parameters[col];
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
   */
  const rankColsStd = (grid, stockData) => {
    const parameters = params;
    for (let col in parameters) {
      const param = parameters[col];
      const multiplier = param.multiplier;

      if (multiplier !== 0) {
        const order = param.multiplier === 1 ? 'asc' : 'desc';
        const weight = param.weight;

        if (!param.average && !param.stdDev) {
          const stdDev = getColStandardDeviation(col, stockData);
          const average = getColAverage(col, stockData);

          // Update params with calculated values
          setParams(prev => ({
            ...prev,
            [col]: {
              ...prev[col],
              stdDev,
              average,
            },
          }));
        }

        const stdDev = param.stdDev || getColStandardDeviation(col, stockData);
        const average = param.average || getColAverage(col, stockData);

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

  // Helper functions (keeping the original logic)
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

  const calculateRank = (stockData, relativeGrid, stdGrid) => {
    stockData.map((row, index) => {
      row.rank = math.mean(
        relativeGrid[index].goodRank,
        stdGrid[index].goodRank
      );
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

  // Utility functions
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

  const countIf = (list, number) => {
    return list.reduce((sum, item) => {
      return sum + (item.rank === number);
    }, 0);
  };

  const getColList = (name, stockData) => {
    const list = [];
    for (let i = 0; i < stockData.length; i++) {
      const row = stockData[i];
      list.push(row[name]);
    }
    return list;
  };

  const getColAverage = (col, stockData) => {
    const list = getColList(col, stockData);
    return list.length > 0 ? math.mean(...list) : 0;
  };

  const getColStandardDeviation = (col, stockData) => {
    const list = getColList(col, stockData);
    return list.length > 0 ? math.std(...list) : 0;
  };

  const cleanData = stockData => {
    for (let row in stockData) {
      stockData[row] = swapKeys(stockData[row]);
    }
    return stockData;
  };

  const swapKeys = rowItem => {
    let newRow = {};
    const goodKeys = Object.keys(params);
    Object.keys(rowItem).map((key, index) => {
      newRow[goodKeys[index]] = rowItem[key];
    });
    return newRow;
  };

  /**
   * CONDITIONAL COLOR CALCULATION - Statistical-based cell coloring
   *
   * Colors cells based on how many standard deviations they are from the mean:
   * - Green shades: Good values (2+ std dev in positive direction)
   * - Red shades: Poor values (2+ std dev in negative direction)
   * - Light colors: Values close to average
   */
  const getConditionalColor = useCallback((col, value, paramConfig) => {
    const weight = paramConfig[col]?.weight || 0;
    const avg = paramConfig[col]?.average;
    const std = paramConfig[col]?.stdDev;
    const mult = paramConfig[col]?.multiplier === 1;

    if (avg === undefined || std === undefined) {
      return '#ffffff'; // White if no stats available
    }

    if (weight === 0) {
      return '#ffffff'; // White if weight is 0
    }

    // Best values (2+ standard deviations in good direction)
    else if (
      (avg - 2 * std >= value && !mult) ||
      (avg + 2 * std <= value && mult)
    ) {
      return '#67c279'; // Bright green
    }

    // Very good values (1.5-2 std dev)
    else if (
      (avg - 1.5 * std >= value && value >= avg - 2 * std && !mult) ||
      (avg + 1.5 * std <= value && value <= avg + 2 * std && mult)
    ) {
      return '#a5d3a5'; // Green
    }

    // Good values (1-1.5 std dev)
    else if (
      (avg - 1 * std >= value && value >= avg - 1.5 * std && !mult) ||
      (avg + 1 * std <= value && value <= avg + 1.5 * std && mult)
    ) {
      return '#b1e1b0'; // Light green
    }

    // Slightly good values (0.5-1 std dev)
    else if (
      (avg - 0.5 * std >= value && value >= avg - 1 * std && !mult) ||
      (avg + 0.5 * std <= value && value <= avg + 1 * std && mult)
    ) {
      return '#c5f1c6'; // Very light green
    }

    // Near average (good direction)
    else if (
      (avg >= value && value >= avg - 0.5 * std && !mult) ||
      (avg <= value && value <= avg + 0.5 * std && mult)
    ) {
      return '#e7f6e5'; // Pale green
    }

    // Near average (poor direction)
    else if (
      (avg >= value && value >= avg - 0.5 * std && mult) ||
      (avg <= value && value <= avg + 0.5 * std && !mult)
    ) {
      return '#fff3f3'; // Pale red
    }

    // Slightly poor values (0.5-1 std dev)
    else if (
      (avg - 0.5 * std >= value && value >= avg - 1 * std && mult) ||
      (avg + 0.5 * std <= value && value <= avg + 1 * std && !mult)
    ) {
      return '#ffe1e1'; // Very light red
    }

    // Poor values (1-1.5 std dev)
    else if (
      (avg - 1 * std >= value && value >= avg - 1.5 * std && mult) ||
      (avg + 1 * std <= value && value <= avg + 1.5 * std && !mult)
    ) {
      return '#fdc2c2'; // Light red
    }

    // Very poor values (1.5-2 std dev)
    else if (
      (avg - 1.5 * std >= value && value >= avg - 2 * std && mult) ||
      (avg + 1.5 * std <= value && value <= avg + 2 * std && !mult)
    ) {
      return '#fda4a4'; // Red
    }

    // Worst values (2+ standard deviations in poor direction)
    else if (
      (value < avg - 2 * std && mult) ||
      (value > avg + 2 * std && !mult)
    ) {
      return '#fd7979'; // Bright red
    }

    return '#ffffff'; // Default white
  }, []);

  const getCellStyle = useCallback(
    (col, value) => {
      const color = getConditionalColor(col, value, params);
      return { backgroundColor: color };
    },
    [params, getConditionalColor]
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
  const handleFullDataScoreboard = () => {
    setCurrentView('full');
    setAltGrid(false);
  };

  const handleRelativeScoreboard = () => {
    setCurrentView('relative');
    setAltGrid(true);
  };

  const handleStdScoreboard = () => {
    setCurrentView('std');
    setAltGrid(true);
  };

  // Debug mode toggle handler
  const handleDebugModeToggle = () => {
    const newDebugMode = !debugMode;
    setDebugMode(newDebugMode);
    console.info(`DEBUG_MODE toggled to: ${newDebugMode ? 'ON' : 'OFF'}`);

    // Optionally reload data with new mode
    if (data.length > 0) {
      console.info('Reloading data with new debug mode...');
      // You could trigger a reload here if needed
    }
  };

  // Cache refresh handler
  const handleCacheRefresh = async (forceRefresh = false) => {
    console.info(
      `🔄 ${forceRefresh ? 'Force refreshing' : 'Refreshing'} cache...`
    );
    setLoading(true);

    try {
      // Clear current data
      setData([]);
      setUiData([]);

      // If force refresh, we'll bypass cache in the fetch function
      const offset = 5;
      const getFinancials = false;

      // Generate cache key and clear it if force refresh
      const stocks = STOCKS[0].slice(0, offset);
      const stocksKey = stocks.sort().join('_');
      const cacheKey = `STOCKS_${stocksKey}_${getFinancials ? 'with_financials' : 'basic'}`;

      if (forceRefresh) {
        clearCache(cacheKey);
      }

      const initialData = await getFinancialData(stocks, getFinancials);
      const cleanedData = debugMode ? initialData : cleanData(initialData);

      setupDataStructures(cleanedData);
      setData(cleanedData);
      setUiData(cleanedData);
      setLoading(false);

      console.info(
        `✅ Cache refresh complete: ${cleanedData.length} stocks loaded`
      );
    } catch (error) {
      console.error('❌ Cache refresh failed:', error);
      setLoading(false);
    }
  };

  // Column helper for TanStack Table
  const columnHelper = createColumnHelper();

  // Define table columns
  const columns = useMemo(() => {
    const cols = [];

    Object.keys(params).forEach(key => {
      const param = params[key];

      if (key === 'rank') {
        cols.push(
          columnHelper.accessor('rank', {
            header: 'Rank',
            cell: info => info.getValue(),
            size: 50,
          })
        );
      } else if (key === 'ticker') {
        cols.push(
          columnHelper.accessor('ticker', {
            header: 'Ticker',
            cell: info => info.getValue(),
            size: 60,
          })
        );
      } else if (param.multiplier !== 0) {
        cols.push(
          columnHelper.accessor(key, {
            header: param.label,
            cell: info => {
              const value = info.getValue();
              const cellStyle = getCellStyle(key, value);

              // Format numbers with commas
              const formattedValue =
                typeof value === 'number'
                  ? value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                  : value;

              return (
                <div
                  style={{
                    ...cellStyle,
                    padding: '8px',
                    margin: '-4px', // Negative margin to fill the cell
                    minHeight: '20px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {formattedValue}
                </div>
              );
            },
            size: param.size || 100,
          })
        );
      }
    });

    // Add additional columns for alt grid
    if (altGrid) {
      cols.push(
        columnHelper.accessor('sum', {
          header: 'Sum',
          cell: info => {
            const value = info.getValue();
            return (
              <div
                style={{
                  backgroundColor: '#f8f9fa',
                  padding: '8px',
                  margin: '-4px',
                  minHeight: '20px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {value?.toFixed(2) || ''}
              </div>
            );
          },
          size: 80,
        })
      );
      cols.push(
        columnHelper.accessor('goodRank', {
          header: 'Alt Rank',
          cell: info => {
            const value = info.getValue();
            return (
              <div
                style={{
                  backgroundColor: '#e9ecef',
                  padding: '8px',
                  margin: '-4px',
                  minHeight: '20px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {value}
              </div>
            );
          },
          size: 80,
        })
      );
    }

    return cols;
  }, [params, altGrid, columnHelper]);

  // Create table instance
  const table = useReactTable({
    data: uiData,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Calculate sum of weights
  const sumOfWeights = useMemo(() => {
    return Object.keys(params).reduce(
      (sum, key) => sum + params[key].weight,
      0
    );
  }, [params]);

  // Note: Weight slider rendering moved to BoardControls component

  if (loading) {
    return <div>Loading stock data...</div>;
  }

  return (
    <div>
      {/* Board Controls with Debug Toggle and Smart Cache */}
      <BoardControls
        params={params}
        sumOfWeights={sumOfWeights}
        onWeightChange={handleWeightChange}
        onMultiplierClick={handleMultiplierClick}
        onFullDataScoreboard={handleFullDataScoreboard}
        onRelativeScoreboard={handleRelativeScoreboard}
        onStdScoreboard={handleStdScoreboard}
        debugMode={debugMode}
        onDebugModeToggle={handleDebugModeToggle}
        onCacheRefresh={handleCacheRefresh}
      />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    style={{
                      border: '1px solid #ccc',
                      padding: '8px',
                      backgroundColor: '#f5f5f5',
                      cursor: header.column.getCanSort()
                        ? 'pointer'
                        : 'default',
                      userSelect: 'none',
                    }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                    {{
                      asc: ' 🔼',
                      desc: ' 🔽',
                    }[header.column.getIsSorted()] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id}>
                {row.getVisibleCells().map(cell => (
                  <td
                    key={cell.id}
                    style={{
                      border: '1px solid #ccc',
                      padding: '4px', // Reduced padding so cell content fills better
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20, fontSize: '12px', color: '#666' }}>
        Showing {table.getRowModel().rows.length} stocks • Mode:{' '}
        <strong>{debugMode ? 'Debug (Cached)' : 'Live (API)'}</strong>
        {backgroundFetching && !debugMode && (
          <span style={{ color: '#007bff', fontWeight: 'bold' }}>
            {' '}
            • 🔄 Refreshing in background...
          </span>
        )}
        {!debugMode && (
          <span style={{ color: '#28a745' }}>
            {' '}
            • ⚡ Fast loading with background updates
          </span>
        )}
        <br />
        API: <strong>{Utils.getApiInfo().name}</strong> (
        {Utils.getApiInfo().cost}) • Powered by TanStack React Table
      </div>
    </div>
  );
}

export default ModernStonkBoard;
