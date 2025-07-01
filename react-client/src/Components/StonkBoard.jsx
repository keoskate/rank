/**
 * STONK BOARD - Core Stock Ranking Component
 * 
 * This is the MAIN COMPONENT for stock analysis and ranking.
 * 
 * KEY RESPONSIBILITIES:
 * - Fetches stock data from Yahoo Finance API (or uses cached data)
 * - Implements dual ranking algorithm (relative + standard deviation)
 * - Renders interactive table with sortable columns
 * - Provides weight adjustment sliders for ranking criteria
 * - Handles conditional cell coloring based on statistical analysis
 * 
 * CRITICAL PATHS:
 * 1. componentDidMount() - Initial data loading
 * 2. setupDataStructures() - Core ranking calculation
 * 3. rankCols() & rankColsStd() - The two ranking algorithms
 * 4. render() - Table display with interactive controls
 * 
 * DATA FLOW:
 * Stock Symbols → API Fetch → Data Parsing → Ranking Calculation → UI Display
 * 
 * IMPORTANT: This component contains the core business logic for stock ranking
 */
import React, { Component } from 'react';
import { BootstrapTable, TableHeaderColumn } from 'react-bootstrap-table';
import * as math from 'mathjs';
import WeightSlider from './WeightSlider';
import ColorColumn from './ColorColumn';
import * as rawData from '../rank-data';           // CEF data (not used here)
import * as cachedData19 from '../stock-data_19';   // 2019 cached stock data
import * as cachedData20 from '../stock-data_20';   // 2020 cached stock data (ACTIVE)
import * as Utils from './StockUtils';              // API utilities & column config


/**
 * Each STOCKS group has 2 items
 *     0 => List of Stock symbols (i.e 'GME')
 *     1 => Cached response to use when debugging
 */
const COVID_STOCKS = [cachedData20.COVID_19, cachedData20.COVID_19_cached]; // 20
const KEO_STOCKS = [cachedData20.KEO_STOCKS, cachedData20.KEO_STOCKS_cached];
const NEW_STOCKS = [cachedData20.NEW_STOCKS, cachedData20.NEW_STOCKS_cached];
const GROUP_STOCKS = [cachedData20.GROUP_STOCKS, cachedData20.GROUP_STOCKS_cached];
const MEME_STOCKS = [cachedData20.MEME_STOCKS, cachedData20.MEME_STOCKS_cached]; // 9
const ALL_STOCKS = [cachedData20.ALL_STOCKS, cachedData20.ALL_STOCKS_cached];

// Use this to combine different groups of stock (without duplicates)
const CUSTOM_STOCKS = [
    ...cachedData20.COVID_19,
    // ...cachedData20.KEO_STOCKS,
    // ...cachedData20.MEME_STOCKS,
    // ...cachedData20.NEW_STOCKS,
    // ...cachedData20.GROUP_STOCKS,
    // ...cachedData20.ALL_STOCKS,
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

class StonkBoard extends Component {
    constructor() {
        super();
        this.state = {
            sortName: 'rank',
            sortOrder: 'desc',
            altGrid: false,
            rGrid: [],
            sGrid: [],
            params: Utils.STOCK_COLUMNS,
            data: []
        };

        // @todo (ES5+) - upgrade babel to avoid binding 
        this.handleRelativeScoreboard = this.handleRelativeScoreboard.bind(this);
        this.handleStdScoreboard = this.handleStdScoreboard.bind(this);
        this.handleFullDataScoreboard = this.handleFullDataScoreboard.bind(this);
        this.onSortChange = this.onSortChange.bind(this);
    }

    /**
     * CRITICAL: Component initialization and data loading
     * 
     * This method handles the initial app startup:
     * 1. Loads first batch of stocks (5 by default) for immediate display
     * 2. Sets up data structures for ranking calculations
     * 3. Triggers background loading of remaining stocks
     * 
     * PERFORMANCE NOTE: Uses offset loading to prevent API rate limiting
     */
    async componentDidMount() {
        console.info('Welcome to Keo Stonks V2!');
        console.info(`DEBUG_MODE = ${DEBUG ? 'ON' : 'OFF'}`);

        // Get the first 5<offset> stocks and display them right away
        // We want to prevent long going requests and want to ease the data
        // 5 at a time with some delay in between to prevent network errors
        const offset = 5; // increase to fetch more stocks concurrently
        const getFinancials = false; // fetches extra data (double the # requests)
        const data = await this.getFinancialData(STOCKS[0].slice(0, offset), getFinancials);
        const cleanedData = DEBUG ? data : this.cleanData(data);

        this.setupDataStructures(cleanedData);
        this.setState({
            data: cleanedData,
        });

        if (!DEBUG) {
            this.fetchAllData(offset, getFinancials);
        }
    }

    // Fetch all stock data
    async fetchAllData(offset, getFinancials = false) {
        // We need to throttle a bit to prevent weird networking issues
        Utils.wait(THROTTLE.LARGE);

        for (let i = offset; i < STOCKS[0].length; i += offset) {
            const data = await this.getFinancialData(STOCKS[0].slice(i, i + offset), getFinancials);
            const cleanedData = this.cleanData(data);
            const mergedData = [...this.state.uiData, ...cleanedData];

            // This is the data we want to save to the cached data file
            console.info('Merged Data:');
            console.log(JSON.stringify(mergedData));
            console.log(mergedData);

            this.setupDataStructures(mergedData);
            this.setState({
                data: mergedData,
            });

            // we use this hack to make sure we aren't sending out
            // too many requests per second
            Utils.wait(THROTTLE.LARGE + THROTTLE.SMALL);
        }
    }

    // Get the Stock data for a list of stocks
    async getFinancialData(stocks, fetchFinancials = false) {
        console.info('Fetching Stocks: ' + stocks);
        if (DEBUG) {
            return STOCKS[1]; // Cached data is at index 1
        } else {
            const allData = [];
            const fetchAll = [];

            stocks.forEach(stock => {
                fetchAll.push(Utils.getStockData(stock, fetchFinancials, false));
                Utils.wait(THROTTLE.MEDIUM);
            });
            const data = await Promise.all(fetchAll);
            return data.filter(x => x && x.ticker);
        }
    }

    // ------------------- SETUP Methods -------------------

    /**
     * CORE RANKING ENGINE - Sets up dual ranking system
     * 
     * This is the HEART of the ranking algorithm:
     * 1. Creates two ranking grids (relative + standard deviation)
     * 2. Calculates rankings using both methods
     * 3. Combines results for final ranking
     * 
     * CRITICAL: All ranking logic flows through this method
     */
    setupDataStructures(data) {
        let rGrid = this.initGrid(data);  // Relative ranking grid
        let sGrid = this.initGrid(data);  // Standard deviation ranking grid

        this.rankCols(rGrid, data);       // Calculate relative rankings
        this.rankColsStd(sGrid, data);    // Calculate std dev rankings
        this.calculateRank(data, rGrid, sGrid); // Combine both methods

        this.setState({
            uiData: data,
            rGrid: rGrid,
            sGrid: sGrid
        });
    }

    handleStdScoreboard() {
        this.setState({
            uiData: this.state.sGrid,
            altGrid: true
        });
    }

    handleRelativeScoreboard() {
        this.setState(({
            uiData: this.state.rGrid,
            altGrid: true
        }));
    }

    handleFullDataScoreboard() {
        this.setState(({
            uiData: this.state.data,
            altGrid: false
        }));
    }

    updateGrid() {
        this.rankData(this.state.data);
    }

    // Setup up relative/std grids used to calculate rank
    rankData(data) {
        let rGrid = this.initGrid(this.state.data);
        let sGrid = this.initGrid(this.state.data);

        this.rankCols(rGrid, data);
        this.rankColsStd(sGrid);

        this.calculateRank(data, rGrid, sGrid);

        this.setState({
            data: data,
            uiData: data,
            rGrid: rGrid,
            sGrid: sGrid
        });
    }

    // Setup a blank grid 
    initGrid(data) {
        let grid = [];

        // This traverses through the Grid from left to right 
        for (let i = 0; i < data.length; i++) {
            // A row
            const row = data[i];
            let clearedRow = {};

            for (let col in row) {
                // Iterate through each column, left to right
                if (col === 'ticker') {
                    clearedRow[col] = row[col];
                } else {
                    const weight = this.state.params[col].weight;
                    if (!weight || weight === 0) {
                        clearedRow[col] = 0;
                    } else {
                        clearedRow[col] = row[col];
                    }
                }
            }

            grid.push(clearedRow);
        }

        return grid;
    }

    // ------------------- Calculation Methods -------------------    

    /**
     * RANKING ALGORITHM #1: Relative Position Ranking
     * 
     * Ranks stocks by their relative position within each metric:
     * - Sorts stocks by each column value
     * - Assigns rank 1, 2, 3, etc.
     * - Applies user-defined weights
     * - Better for understanding relative performance
     */
    rankCols(grid, data) {
        const parameters = this.state.params;
        for (let col in parameters) {
            const param = parameters[col];
            const order = param.multiplier === 1 ? 'asc' : 'desc';
            const weight = param.weight;

            if (weight > 0) {
                const colList = this.getColList(col, data);
                const rankedCol = this.rankCol(colList, order);

                // Insert rankedCol into each grid row. 
                for (let row in grid) {
                    grid[row][col] = rankedCol[row].rank * (1 + weight);
                }
            }
        }

        this.getSumAndRelativeRank(grid, 'desc');
    }

    /**
     * RANKING ALGORITHM #2: Statistical Standard Deviation Ranking
     * 
     * Ranks stocks by how many standard deviations they are from the mean:
     * - Calculates mean and standard deviation for each metric
     * - Scores based on statistical variance from average
     * - Better for identifying statistical outliers
     * - Used for conditional cell coloring (green/red highlighting)
     */
    rankColsStd(grid, data) {
        const parameters = this.state.params;

        // Each key of state.params is the name of the column.
        for (let col in parameters) {
            const param = parameters[col];
            const multiplier = param.multiplier;
            // Don't rank non-numerical data
            if (multiplier !== 0) {
                const order = param.multiplier === 1 ? 'asc' : 'desc';
                const weight = param.weight;
                let stdDev = undefined;
                let average = undefined;
                if (!param.average && !param.stdDev) {
                    stdDev = this.getColStandardDeviation(col, data);
                    average = this.getColAverage(col, data);

                    this.state.params[col].stdDev = stdDev;
                    this.state.params[col].average = average;

                    this.setState(({
                        params: this.state.params
                    }));
                }
                stdDev = stdDev || this.getColStandardDeviation(col, data);
                average = average || this.getColAverage(col, data);

                if (weight > 0) {
                    const colList = this.getColList(col, data);
                    const rankedCol = this.rankCol(colList, order);

                    // Insert rankedCol into each grid row. 
                    for (let row in grid) {
                        let variance = (rankedCol[row].item - average) / stdDev;
                        grid[row][col] = variance * multiplier * (1 + weight);
                    }
                }
            }
        }

        this.getSumAndRelativeRank(grid, 'desc');
    }

    getSumAndRelativeRank(grid, order) {
        for (let i = 0; i < grid.length; i++) {
            // A row
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

        const sumList = this.getColList('sum', grid);
        const rankedSumList = this.rankCol(sumList, order);

        // Insert rankedCol into each grid row. 
        for (let row in grid) {
            grid[row]['goodRank'] = rankedSumList[row].rank;
        }
    }

    calculateRank(data, rGrid, sGrid) {
        data.map((row, index) => {
            row.rank = math.mean(rGrid[index].goodRank, sGrid[index].goodRank)
        });

        const rankList = this.getColList('rank', data);
        const rankedRankList = this.rankCol(rankList, 'asc');

        const self = this;
        const rankedList = JSON.parse(JSON.stringify(rankedRankList));

        data.map((row, index) => {
            const rank = rankedList[index].rank;
            const range = rankedList.slice(0, index);
            const count = self.countIf(range, rank) === 0 ? 1 : self.countIf(range, rank) + 1;
            const trueRank = rank + count - 1;
            row.rank = trueRank
            rankedList[index].rank = trueRank;
        });
    }

    rankCol(list, order) {
        // sort a copy of the array 
        const rankedList = [...list];

        // create array with holder objects
        var rankings = rankedList.map(function (item, index) {
            return {
                item: item,
                row: index
            };
        });

        // order by rank value
        if (order === 'asc') {
            rankings.sort((a, b) => a.item - b.item); // For ascending sort
        } else {
            // highest first
            rankings.sort((a, b) => b.item - a.item); // For descending sort
        }

        // assign ranks
        rankings.forEach(function (holder, index, rankings) {
            var prevHolder = rankings[index - 1];

            // if item's rank value is same as prev item's rank value
            if (prevHolder && holder.item === prevHolder.item) {
                // they're tied and have same rank
                holder.rank = prevHolder.rank;
            } else {
                // item's rank is its one-based position in array
                holder.rank = index + 1;
            }
        });

        rankings.sort((a, b) => a.row - b.row);
        return rankings;
    }

    countIf(list, number) {
        return list.reduce((sum, item) => {
            return sum + (item.rank === number);
        }, 0);
    }

    getColAverage(col, data) {
        const list = this.getColList(col, data);
        const avg = this.getListAverage(list);

        return avg;
    }

    getListAverage(list) {
        return list.length > 0 ? math.mean(...list) : 0;
    }

    getColStandardDeviation(col, data) {
        const list = this.getColList(col, data);
        const avg = this.getListAverage(list);

        const stdDev = list.length > 0 ? math.std(...list) : 0;

        return stdDev;
    }

    // -------------------  Helper Methods ------------------- 

    getColList(name, data) {
        data = data || this.state.data;
        const list = [];
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            list.push(row[name]);
        }
        return list;
    }

    onSortChange(sortName, sortOrder) {
        this.setState({
            sortName,
            sortOrder
        });
    }

    sumOfWeights() {
        let sum = 0;
        Object.keys(this.state.params).map((key) => {
            return sum += this.state.params[key].weight;
        });

        return sum;
    }

    handleWeightChange(evt) {
        if (this.sumOfWeights() >= 1.0 && this.state.params[evt.target.name].weight < evt.target.valueAsNumber) {
            return;
        }
        this.state.params[evt.target.name].weight = evt.target.valueAsNumber || 0;
        this.setState(({
            params: this.state.params
        }));

        this.updateGrid();
    }

    handleMultiplierClick(evt) {
        this.state.params[evt.target.name].multiplier = this.state.params[evt.target.name].multiplier === 1 ? -1 : 1;

        this.setState(({
            params: this.state.params
        }));

        this.updateGrid();
    }

    // Step 1a
    cleanData(data) {
        // clean keys 
        for (let row in data) {
            data[row] = this.swapKeys(data[row]);
        }

        this.setState({
            data: data
        });

        return data;
    }

    // Step 1b
    swapKeys(rowItem) {
        let newRow = {};
        const goodKeys = Object.keys(this.state.params);

        Object.keys(rowItem).map(function (key, index) {
            newRow[goodKeys[index]] = rowItem[key];
        });

        return newRow;
    }

    // Step 1c - not used
    cleanRow(item) {
        return {
            rank: 0,
            marketCap: item.marketCap === 0 ? 0 : Number(item.marketCap.replace(/,/g, '')),
            volume: item.volume === 0 ? 0 : Number(item.volume.replace(/,/g, '')),
            price: item.price === 0 ? 0 : Number(item.price.replace(/\$/, '')),
            nav: item.nav === 0 ? 0 : Number(item.nav.replace(/\$/, '')),
            discount: item.discount === 0 ? 0 : Number(item.discount.replace(/%/, '')),
            distribution: item.distribution === 0 ? 0 : Number(item.distribution.replace(/%/, '')),
            leverage: item.leverage === 0 ? 0 : Number(item.leverage.replace(/%/, '')),
            uniiDist: item.uniiDist === 0 ? 0 : Number(item.uniiDist.replace(/%/, '')),
        };
    }

    getConditionalColor(col, value, params) {
        const weight = params[col].weight;
        let avg = params[col].average;
        let std = params[col].stdDev;
        const mult = params[col].multiplier === 1;

        if (avg === undefined) {
            return;
        }

        // avg = Math.abs(params[col].average);
        // std = Math.abs(params[col].stdDev);
        // value = Math.abs(value);

        if (weight === 0) {
            return '#ffffff';
        } else if ((((avg - 1.5 * std) >= value) && (value >= (avg - 2 * std)) && !mult) ||
            (((avg + 1.5 * std) <= value) && (value <= (avg + 2 * std)) && mult)) {
            return '#a5d3a5';
        } else if ((((avg - 1 * std) >= value) && (value >= (avg - 1.5 * std)) && !mult) ||
            (((avg + 1 * std) <= value) && (value <= (avg + 1.5 * std)) && mult)) {
            return '#b1e1b0';
        } else if ((((avg - 0.5 * std) >= value) && (value >= (avg - 1 * std)) && !mult) ||
            (((avg + 0.5 * std) <= value) && (value <= (avg + 1 * std)) && mult)) {
            return '#c5f1c6';
        } else if (((avg >= value) && (value >= (avg - 0.5 * std)) && !mult) ||
            ((avg <= value) && (value <= (avg + 0.5 * std)) && mult)) {
            return '#e7f6e5';
        } else if (((avg >= value) && (value >= (avg - 0.5 * std)) && mult) ||
            ((avg <= value) && (value <= (avg + 0.5 * std)) && !mult)) {
            return '#fff3f3';
        } else if (((avg - 0.5 * std >= value) && (value >= (avg - 1 * std)) && mult) ||
            ((avg + 0.5 * std <= value) && (value <= (avg + 1 * std)) && !mult)) {
            return '#ffe1e1';
        } else if (((avg - 1 * std >= value) && (value >= (avg - 1.5 * std)) && mult) ||
            ((avg + 1 * std <= value) && (value <= (avg + 1.5 * std)) && !mult)) {
            return '#fdc2c2';
        } else if (((avg - 1.5 * std >= value) && (value >= (avg - 2 * std)) && mult) ||
            ((avg + 1.5 * std <= value) && (value <= (avg + 2 * std)) && !mult)) {
            return '#fda4a4';
        } else if (((value < (avg - 2 * std)) && !mult) ||
            ((value > (avg + 2 * std) && mult))) {
            return '#67c279';
        } else if (((value < (avg - 2 * std)) && mult) ||
            ((value > (avg + 2 * std) && !mult))) {
            return '#fd7979';
        }
    }

    getCellStyle(col, params, cell, row, ridx, cidx) {
        const value = cell;
        const color = this.getConditionalColor(col, value, params);
        return { background: color };
    }

    parameters() {
        return Object.keys(this.state.params).map((key) => {
            if (this.state.params[key].multiplier !== 0) {
                return (
                    <span style={{ display: 'inline-block', margin: 5, width: 120 }}>
                        <WeightSlider label={`${key}`} name={key} value={this.state.params[key].weight} onChange={this.handleWeightChange.bind(this)} />
                        <button name={key} onClick={this.handleMultiplierClick.bind(this)}>
                            {this.state.params[key].multiplier === 1 ? '+1' : '-1'}
                        </button>
                    </span>
                );
            }
        });
    }
    sections() {

    }

    headers(params) {
        return Object.keys(params).map((key) => {
            if (key === 'rank') {
                return (
                    <TableHeaderColumn
                        isKey
                        dataField={key}
                        dataSort
                        row='0'
                        rowSpan='2'
                        width='50'
                        sortFunc={Utils.revertSortFunc}
                    >
                        <div>
                            {params[key].label}
                        </div>

                    </TableHeaderColumn>
                );
            } else {
                // Add Label, type(money, %, number), size ...
                const colString = (cell, row) => {
                    return <ColorColumn value={row[key]} class={key} />
                    // return `${row[key].toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
                };
                return (
                    <TableHeaderColumn
                        dataField={key}
                        dataSort
                        row='1'
                        tdClass={key}
                        tdStyle={this.getCellStyle.bind(this, key, params)}
                        width={params[key].size}
                        dataFormat={(cell, row) => colString(cell, row)}
                        sortFunc={Utils.revertSortFunc}
                    >
                        <div style={{ 'white-space': 'pre-line' }}>
                            {params[key].label}
                        </div>

                    </TableHeaderColumn>
                );
            }
        });
    }

    sumCol() {
        if (this.state.altGrid) {
            return (
                <TableHeaderColumn
                    dataField='sum'
                    dataSort
                    sortFunc={Utils.revertSortFunc}
                >
                    Sum
                </TableHeaderColumn>
            )
        }
    }

    goodRankCol() {
        if (this.state.altGrid) {
            return (
                <TableHeaderColumn
                    dataField='goodRank'
                    dataSort
                    sortFunc={Utils.revertSortFunc}
                >
                    Alt Rank
                </TableHeaderColumn>
            )
        }
    }

    render() {
        const options = {
            sortName: this.state.sortName,
            sortOrder: this.state.sortOrder,
            onSortChange: this.onSortChange
        };

        return (
            <div>
                {this.parameters()}

                <button onClick={this.handleFullDataScoreboard}>Full Grid</button>
                <button onClick={this.handleRelativeScoreboard}>Relative Rank Grid</button>
                <button onClick={this.handleStdScoreboard}>Std Deviation Grid</button>

                <BootstrapTable data={this.state.uiData} options={options} striped hover condensed>
                    {this.headers(this.state.params)}
                    {/* <TableHeaderColumn row='0' colSpan='4'>Company Descriptors</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='3'>{'Size & Share Volume'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='10'>{'Price & Price Changes'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='2'>{'EPS Growth'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='2'>{'Sales Growth'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='4'>{'Valuations'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='2'>{'Return on Investment'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='3'>{'Dividends'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='2'>{'Margins'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='3'>{'Balance Sheet'}</TableHeaderColumn>
                    <TableHeaderColumn row='0' colSpan='4'>{'Income Statement'}</TableHeaderColumn> */}
                    {this.sumCol()}
                    {this.goodRankCol()}
                </BootstrapTable>
            </div>
        );
    }
}

export default StonkBoard;