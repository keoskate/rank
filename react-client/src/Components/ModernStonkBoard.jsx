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
  createColumnHelper
} from '@tanstack/react-table';
import * as math from 'mathjs';
import WeightSlider from './WeightSlider';
import * as cachedData20 from '../stock-data_20';
import * as Utils from './StockUtils';

// Configuration constants
const COVID_STOCKS = [cachedData20.COVID_19, cachedData20.COVID_19_cached];
const KEO_STOCKS = [cachedData20.KEO_STOCKS, cachedData20.KEO_STOCKS_cached];
const NEW_STOCKS = [cachedData20.NEW_STOCKS, cachedData20.NEW_STOCKS_cached];
const GROUP_STOCKS = [cachedData20.GROUP_STOCKS, cachedData20.GROUP_STOCKS_cached];
const MEME_STOCKS = [cachedData20.MEME_STOCKS, cachedData20.MEME_STOCKS_cached];

// Use this to combine different groups of stock (without duplicates)
const CUSTOM_STOCKS = [
    ...cachedData20.COVID_19,
    // Add other groups as needed
];

const TEST_STOCKS = [[...new Set(CUSTOM_STOCKS)], [
    ...cachedData20.TEST_STOCKS_cached,
]];

// Config for the Stock board
const STOCKS = TEST_STOCKS;
const DEBUG = true; // If we want to use cached data (preserve network request quota)

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
    const [loading, setLoading] = useState(true);
    const [sorting, setSorting] = useState([{ id: 'rank', desc: false }]);

    // Utility function for waiting
    const wait = useCallback((ms) => {
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
            console.info(`DEBUG_MODE = ${DEBUG ? 'ON' : 'OFF'}`);

            try {
                // Get the first 5 stocks and display them right away
                const offset = 5;
                const getFinancials = false;
                const initialData = await getFinancialData(STOCKS[0].slice(0, offset), getFinancials);
                const cleanedData = DEBUG ? initialData : cleanData(initialData);

                setupDataStructures(cleanedData);
                setData(cleanedData);
                setUiData(cleanedData);
                setLoading(false);

                if (!DEBUG) {
                    fetchAllData(offset, getFinancials);
                }
            } catch (error) {
                console.error('Error initializing data:', error);
                setLoading(false);
            }
        };

        initializeData();
    }, []);

    // Get the Stock data for a list of stocks
    const getFinancialData = async (stocks, fetchFinancials = false) => {
        console.info('Fetching Stocks: ' + stocks);
        if (DEBUG) {
            return STOCKS[1]; // Cached data is at index 1
        } else {
            const fetchAll = [];
            stocks.forEach(stock => {
                fetchAll.push(Utils.getStockData(stock, fetchFinancials, false));
                wait(THROTTLE.MEDIUM);
            });
            const fetchedData = await Promise.all(fetchAll);
            return fetchedData.filter(x => x && x.ticker);
        }
    };

    // Fetch all stock data progressively
    const fetchAllData = async (offset, getFinancials = false) => {
        wait(THROTTLE.LARGE);

        for (let i = offset; i < STOCKS[0].length; i += offset) {
            const stockData = await getFinancialData(STOCKS[0].slice(i, i + offset), getFinancials);
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
    const setupDataStructures = useCallback((stockData) => {
        let relativeGrid = initGrid(stockData);
        let stdGrid = initGrid(stockData);

        rankCols(relativeGrid, stockData);
        rankColsStd(stdGrid, stockData);
        calculateRank(stockData, relativeGrid, stdGrid);

        setRGrid(relativeGrid);
        setSGrid(stdGrid);
    }, [params]);

    // Initialize grid structure
    const initGrid = (stockData) => {
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
                            average
                        }
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

    // Utility functions
    const rankCol = (list, order) => {
        const rankedList = [...list];
        const rankings = rankedList.map((item, index) => ({
            item: item,
            row: index
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

    const cleanData = (stockData) => {
        for (let row in stockData) {
            stockData[row] = swapKeys(stockData[row]);
        }
        return stockData;
    };

    const swapKeys = (rowItem) => {
        let newRow = {};
        const goodKeys = Object.keys(params);
        Object.keys(rowItem).map((key, index) => {
            newRow[goodKeys[index]] = rowItem[key];
        });
        return newRow;
    };

    // Handle weight changes
    const handleWeightChange = useCallback((evt) => {
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
                weight: newWeight
            }
        }));

        // Recalculate rankings
        setupDataStructures(data);
    }, [params, data, setupDataStructures]);

    const handleMultiplierClick = useCallback((evt) => {
        const columnName = evt.target.name;
        
        setParams(prev => ({
            ...prev,
            [columnName]: {
                ...prev[columnName],
                multiplier: prev[columnName].multiplier === 1 ? -1 : 1
            }
        }));

        // Recalculate rankings
        setupDataStructures(data);
    }, [params, data, setupDataStructures]);

    // Board switching functions
    const handleFullDataScoreboard = () => {
        setUiData(data);
        setAltGrid(false);
    };

    const handleRelativeScoreboard = () => {
        setUiData(rGrid);
        setAltGrid(true);
    };

    const handleStdScoreboard = () => {
        setUiData(sGrid);
        setAltGrid(true);
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
                        size: 50
                    })
                );
            } else if (key === 'ticker') {
                cols.push(
                    columnHelper.accessor('ticker', {
                        header: 'Ticker',
                        cell: info => info.getValue(),
                        size: 60
                    })
                );
            } else if (param.multiplier !== 0) {
                cols.push(
                    columnHelper.accessor(key, {
                        header: param.label,
                        cell: info => {
                            const value = info.getValue();
                            // Format numbers with commas
                            return typeof value === 'number' 
                                ? value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                                : value;
                        },
                        size: param.size || 100
                    })
                );
            }
        });

        // Add additional columns for alt grid
        if (altGrid) {
            cols.push(
                columnHelper.accessor('sum', {
                    header: 'Sum',
                    cell: info => info.getValue()?.toFixed(2) || '',
                    size: 80
                })
            );
            cols.push(
                columnHelper.accessor('goodRank', {
                    header: 'Alt Rank',
                    cell: info => info.getValue(),
                    size: 80
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
        return Object.keys(params).reduce((sum, key) => sum + params[key].weight, 0);
    }, [params]);

    // Render weight sliders
    const renderWeightSliders = () => {
        return Object.keys(params).map((key) => {
            if (params[key].multiplier !== 0) {
                return (
                    <span key={key} style={{ display: 'inline-block', margin: 5, width: 120 }}>
                        <WeightSlider 
                            label={key} 
                            name={key} 
                            value={params[key].weight} 
                            onChange={handleWeightChange} 
                        />
                        <button 
                            name={key} 
                            onClick={handleMultiplierClick}
                            style={{ marginLeft: 5 }}
                        >
                            {params[key].multiplier === 1 ? '+1' : '-1'}
                        </button>
                    </span>
                );
            }
            return null;
        });
    };

    if (loading) {
        return <div>Loading stock data...</div>;
    }

    return (
        <div>
            <div style={{ marginBottom: 20 }}>
                <h3>Weight Controls (Total: {sumOfWeights.toFixed(2)})</h3>
                {renderWeightSliders()}
            </div>

            <div style={{ marginBottom: 20 }}>
                <button onClick={handleFullDataScoreboard} style={{ marginRight: 10 }}>
                    Full Grid
                </button>
                <button onClick={handleRelativeScoreboard} style={{ marginRight: 10 }}>
                    Relative Rank Grid
                </button>
                <button onClick={handleStdScoreboard}>
                    Std Deviation Grid
                </button>
            </div>

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
                                            cursor: header.column.getCanSort() ? 'pointer' : 'default',
                                            userSelect: 'none'
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
                                            padding: '8px'
                                        }}
                                    >
                                        {flexRender(
                                            cell.column.columnDef.cell,
                                            cell.getContext()
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div style={{ marginTop: 20, fontSize: '12px', color: '#666' }}>
                Showing {table.getRowModel().rows.length} stocks • 
                Powered by TanStack React Table • 
                React 18 + Modern Build System
            </div>
        </div>
    );
}

export default ModernStonkBoard;