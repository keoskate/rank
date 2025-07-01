/**
 * LEGACY STOCK BOARD - DEPRECATED
 * 
 * This is the OLD stock board implementation.
 * It has been replaced by StonkBoard.jsx
 * 
 * STATUS: NOT USED - Consider removing this file
 * REPLACED BY: StonkBoard.jsx
 */
import React, { Component } from 'react';
import { BootstrapTable, TableHeaderColumn } from 'react-bootstrap-table';
import * as math from 'mathjs';
import WeightSlider from './WeightSlider';
import ColorColumn from './ColorColumn';
import * as rawData from '../rank-data'

const SIZE = {
    small: 50,
    medium: 75,
    large: 125
};

 const DEBUG = true;

 /**
  * How this works:
  * 
  * Create an Array KEO_STOCKS
  *     0 => Array of Stock Tickers
  *     1 => Cached response used when DEBUG = true
  */
 const KEO_STOCKS = [[
    'WM',
    'ADSK',
    'NKE',
    'LSCC',
    'DIS',
    'LRCX',
    'XRAY',
    'RTN',
    'YETI',
    'ENPH',
    'TEVA',
    'RUBI',
    'RUN',
    'DAL',
    'ZFGN',
    'RCL',
    'SHOP',
    'HIMX',
    'PI',
    'PENN'
], rawData.default.KeoStocks];

const ELVIS_STOCKS = [["EAT", "BLK", "DRI", "EDIT", "CRSP", "PYPL", "BA", "CYBR", "BILI", "TCEHY", "ADPT", "ZM", "ROKU", "BYND", "REAL", "LK", "SFIX", "LULU", "PCRFY", "TPTX", "UNH", "CVS", "GILD", "PK", "WYNN", "MGM", "HRI", "TCOM", "ZNH", "CCL", "CEA", "CPCAY", "DAL", "ALK", "OXY", "NOVA", "ACB", "HEXO", "SNDL"]];

const LOOKOUT_STOCKS = [[
    'AMZN',
    'WM',
    'NFLX',
    'BABA',
    'ADBE',
    'AAPL',
    'MSFT',
    'GOOG',
    'ADSK',
    'AMD',
    'FB',
    'NKE',
    'NVDA',
    'LSCC',
    'LUV',
    'DIS',
    'BTG',
    'MU',
    'TER',
    'LRCX',
    'XRAY',
    'LUNA',
    'RTN',
    'TWTR',
    'ENSG',
    'YETI',
    'WORK',
    'SNAP',
    'ENPH',
    'XOM',
    'TEVA',
    'HIMX',
    'RUBI',
    'RUN',
    'TSLA',
    'DAL',
    'PI',
    'ZFGN',
    'RCL',
    'SHOP',
    'MAXR',
    'WAB',
], rawData.default.blob];


const BIG_MONEY = [[
    "PENN",
    "EAT",
    "BLK",
    "DRI",
    "EDIT",
    "CRSP",
    "PYPL",
    "BA",
    "CYBR",
    "BILI",
    "TCEHY",
    "ADPT",
    "ZM",
    "ROKU",
    "BYND",
    "REAL",
    "LK",
    "SFIX",
    "LULU",
    "PCRFY",
    "TPTX",
    "UNH",
    "CVS",
    "GILD",
    "PK",
    "WYNN",
    "MGM",
    "HRI",
    "TCOM",
    "ZNH",
    "CCL",
    "CEA",
    "CPCAY",
    "ALK",
    "OXY",
    "NOVA",
    "ACB",
    "HEXO",
    "SNDL",
    "AMZN",
    "WM",
    "NFLX",
    "BABA",
    "ADBE",
    "AAPL",
    "MSFT",
    "GOOG",
    "ADSK",
    "AMD",
    "FB",
    "NKE",
    "NVDA",
    "LSCC",
    "LUV",
    "DIS",
    "BTG",
    "MU",
    "TER",
    "LRCX",
    "XRAY",
    "LUNA",
    "RTN",
    "TWTR",
    "ENSG",
    "YETI",
    "WORK",
    "SNAP",
    "ENPH",
    "XOM",
    "TEVA",
    "HIMX",
    "RUBI",
    "RUN",
    "TSLA",
    "DAL",
    "PI",
    "ZFGN",
    "RCL",
    "SHOP",
    "MAXR"
  ], rawData.default.ALL_STOCKS];

const STOCKS = LOOKOUT_STOCKS; // LOOKOUT_STOCKS;

class StockBoard extends Component {
    constructor() {
        super();
        this.state = {
            sortName: 'rank',
            sortOrder: 'desc',
            altGrid: false, 
            rGrid: [],
            sGrid: [],
            params: {
                "rank": {
                    label: 'Rank',
                    type: '',
                    size: SIZE.small,
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "ticker": {
                    label: 'Ticker',
                    type: '',
                    size: SIZE.small,
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "name": {
                    label: 'Company Name',
                    type: '',
                    size: SIZE.large,
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "industry": {
                    label: 'Industry',
                    type: '',
                    size: SIZE.large,
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "price": {
                    label: 'Price',
                    type: 'money',
                    size: SIZE.medium,
                    weight: 0.0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "yearHigh": {
                    label: 'Year High',
                    type: 'money',
                    size: SIZE.medium,
                    weight: 0.0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "yearRange": {
                    label: '52 Week Range',
                    type: '',
                    size: SIZE.medium,
                    weight: 0.4, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "debtEbitda": {
                    label: 'Debt / Ebitda',
                    type: '',
                    size: SIZE.medium,
                    weight: 0.15, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "netDebt": {
                    label: 'Net Debt',
                    type: '',
                    size: SIZE.large,
                    weight: 0.15, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "beta": {
                    label: 'Beta',
                    type: '',
                    size: SIZE.small,
                    weight: 0.15, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "quickRatio": {
                    label: 'Quick Ratio',
                    type: '',
                    size: SIZE.medium,
                    weight: 0.1, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "dividend": {
                    label: 'Dividend Rate',
                    type: '',
                    size: SIZE.medium,
                    weight: 0.05, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "ebitda": {
                    label: 'EBITDA',
                    type: '',
                    size: SIZE.large,
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "evEbitda": {
                    label: 'EV / Ebitda',
                    type: '',
                    size: SIZE.medium,
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "cash": {
                    label: 'Cash',
                    type: '',
                    size: SIZE.large,
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                // "shortDebt": {
                //     label: 'Short Term Debt',
                //     type: 'money',
                //     size: SIZE.medium,
                //     weight: 0, 
                //     multiplier: 1,
                //     average: undefined,
                //     stdDev: undefined
                // },
                // "sectorTrend": {
                //     label: 'Sector Trend',
                //     type: '',
                //     size: SIZE.large,
                //     weight: 0, 
                //     multiplier: 1,
                //     average: undefined,
                //     stdDev: undefined
                // },
                // "peRatio": {
                //     label: 'PE Ratio',
                //     type: '',
                //     size: SIZE.large,
                //     weight: 0, 
                //     multiplier: 1,
                //     average: undefined,
                //     stdDev: undefined
                // },
            },
            data: []
        };

        this.handleRelativeScoreboard = this.handleRelativeScoreboard.bind(this);
        this.handleStdScoreboard = this.handleStdScoreboard.bind(this);
        this.handleFullDataScoreboard = this.handleFullDataScoreboard.bind(this);

        this.onSortChange = this.onSortChange.bind(this);
    }

    async componentDidMount() {
        const data = await this.getFinancialData(STOCKS[0].slice(0, 5));
        const cleanedData = DEBUG ? data : this.cleanData(data);
        
        debugger;

        this.setupDataStructures(cleanedData);
        this.setState({
            data: cleanedData,
        });

        if (!DEBUG) this.fetchAllData();
    }

    wait(ms) {
        var start = new Date().getTime();
        var end = start;
        while(end < start + ms) {
          end = new Date().getTime();
       }
     }

    async fetchAllData() {
        this.wait(2000);

        for (let i = 5; i < STOCKS[0].length; i+=5) {
            const data = await this.getFinancialData(STOCKS[0].slice(i, i+5));
            const cleanedData = this.cleanData(data);
            const mergedData = [...this.state.uiData, ...cleanedData];

            debugger;
            console.log(JSON.stringify(mergedData));
            console.log('Merged Data:');
            console.log(mergedData);
            this.setupDataStructures(mergedData);
            this.setState({
                data: mergedData,
            });

            this.wait(2500);
        } 
    }

    async getFinancialData(stocks) {
        const endPoint = 'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/get-detail?region=US&lang=en&symbol=AAPL'

        if (DEBUG) {
            return STOCKS[1];
        } else {
            const allData = [];
            const fetchAll = [];

            stocks.forEach(stock => {
                fetchAll.push(this.getStockData(stock));
                this.wait(1000);
            });
            const data = await Promise.all(fetchAll);
            return data.filter(x => x && x.ticker);
        }
    }

    async getStockData(stock) {
        const endPoint = 'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/get-detail?region=US&lang=en&symbol='

        const altEndPoint = 'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/v2/get-financials?symbol='

        try {
            const results = await Promise.all([
                fetch(`${endPoint}${stock}`, {
                    "method": "GET",
                    "headers": {
                        "x-rapidapi-host": "apidojo-yahoo-finance-v1.p.rapidapi.com",
                        "x-rapidapi-key": "511813387amsh6e1ae8b9aaa13a4p19b849jsnfafad5e8440b"
                    }
                }),
                // fetch(`${altEndPoint}${stock}`, {
                //     "method": "GET",
                //     "headers": {
                //         "x-rapidapi-host": "apidojo-yahoo-finance-v1.p.rapidapi.com",
                //         "x-rapidapi-key": "511813387amsh6e1ae8b9aaa13a4p19b849jsnfafad5e8440b"
                //     }
                // })
              ]);
 
            const data = this.parseData(Object.assign({}, await results[0].json(), results.length === 2 ? await results[1].json() : {}));
        
            // const stockData = await response.json();  
            console.log('Financial Data for ' + stock)  
            console.log(data);

            return data;
        } catch(err) {
            try {
                const results = await Promise.all([
                    fetch(`${endPoint}${stock}`, {
                        "method": "GET",
                        "headers": {
                            "x-rapidapi-host": "apidojo-yahoo-finance-v1.p.rapidapi.com",
                            "x-rapidapi-key": "511813387amsh6e1ae8b9aaa13a4p19b849jsnfafad5e8440b"
                        }
                    }),
                    // fetch(`${altEndPoint}${stock}`, {
                    //     "method": "GET",
                    //     "headers": {
                    //         "x-rapidapi-host": "apidojo-yahoo-finance-v1.p.rapidapi.com",
                    //         "x-rapidapi-key": "511813387amsh6e1ae8b9aaa13a4p19b849jsnfafad5e8440b"
                    //     }
                    // })
                  ]);
     
                const data = this.parseData(Object.assign({}, await results[0].json(), results.length === 2 ? await results[1].json() : {}));
            
                // const stockData = await response.json();  
                console.log('Financial Data for ' + stock)  
                console.log(data);
    
                return data;
            } catch(err) {
                console.log(err);
                return [];
            }
        }
    }

    // ------------------- SETUP Methods -------------------
    setupDataStructures(data) {
        let rGrid = this.initGrid(data);
        let sGrid = this.initGrid(data);

        this.rankCols(rGrid, data);
        this.rankColsStd(sGrid, data);

        this.calculateRank(data, rGrid, sGrid);

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

    // Relative Ranking 
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

    // Standard Deviation Ranking 
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

    revertSortFunc(a, b, order, sortField) {   // order is desc or asc
        if (order === 'desc') {
            return a[sortField] - b[sortField];
        } else {
            return b[sortField] - a[sortField];
        }
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

    parseData(data) {
        if (!data.quoteType || !data.quoteType.symbol) return;
        // {
        //     "Rank": 0,
        //     "Ticker": "ZTS",
        //     "Company Name": "Zoetis Inc.",
        //     "Industry": "Medical - Drugs",
        //     "Price": 20.68,
        //     "52 Week Range": 94.02,
        //     "Debt / Ebitda": 0.32,
        //     "Net Debt": 483.86,
        //     "Beta": 0.97,
        //     "Quick Ratio": 40838.21,
        //     "Dividend Rate": 2699959,
        //     "EBITDA": 84.4,
        //     "EV / Ebitda": 85.97,
        //     "Cash": 59.73,
        //     "Short Term Debt": 94.02,
        //     "Sector Trend": 1.13,
        //     "PE Ratio": -1.18,
        //   }

        const formater = (value, percision) => {
            return value == null ? 0 : Number.parseFloat(value).toFixed(percision);
        };

        const formatValue = (value) => {
            return value == null ? 0 : value;
        };

        const calculateDebtEbitda = (totalDebt, ebitda) => {
            totalDebt = totalDebt == null ? 0 : totalDebt;
            ebitda = ebitda == null ? 0 : ebitda;
            const value = (totalDebt == 0 || ebitda == 0) ? 0 : totalDebt / ebitda;
            if (value == 'NaN' || value == null || value == NaN) {
                return 0;
            } else {
                return Number.parseFloat(value).toFixed(2);
            }
        };

        const calculateYearRange = () => {
            const high = data.summaryDetail.fiftyTwoWeekHigh.raw;
            const low = data.summaryDetail.fiftyTwoWeekLow.raw;

            return Number.parseFloat((high - low) / high).toFixed(2)
        };

        debugger;
        const formatData = {
            rank: 0,
            
            ticker: data.quoteType.symbol,
            
            name: data.quoteType.shortName,
            
            industry: data.summaryProfile.industry,
            
            price: Number.parseFloat(data.price.regularMarketPrice.raw).toFixed(2),
            
            yearHigh: data.summaryDetail.fiftyTwoWeekHigh.raw,

            yearRange: calculateYearRange(),
            
            debtEbitda: calculateDebtEbitda(data.financialData.totalDebt.raw, data.financialData.ebitda.raw),
            
            
            netDebt: formater(formatValue(data.financialData.totalDebt.raw) - formatValue(data.financialData.totalCash.raw), 0) || 0,
            
            beta: Number.parseFloat(data.summaryDetail.beta.raw || 0).toFixed(2) || 0,
            
            quickRatio: Number.parseFloat(data.financialData.quickRatio.raw || 0).toFixed(2) || 0,
            
            dividend: data.summaryDetail.dividendRate.raw || 0,
            
            ebitda: formater(data.financialData.ebitda.raw, 0) || 0,
            
            evEbitda: formater(data.defaultKeyStatistics.enterpriseToEbitda.raw, 0) || 0,
            
            cash: data.financialData.totalCash.raw || 0,
            
            // shortDebt: data.balanceSheetHistoryQuarterly.shortLongTermDebt,
            // sectorTrend: data.sectorTrend.PeRatio.raw.reduce((acc, next) => acc + next) / data.sectorTrend.PeRatio.raw.length
        
        };

        // debugger;
        return formatData;
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

        // debugger;

        return data;
    }

    // Step 1b
    swapKeys(rowItem) {
        let newRow = {};
        const goodKeys = Object.keys(this.state.params);

        Object.keys(rowItem).map(function(key, index) {
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
        } else if ( (((avg - 1.5*std) >= value) && (value >= (avg - 2*std)) && !mult) ||
                    (((avg + 1.5*std) <= value) && (value <= (avg + 2*std)) && mult)) {
            return '#a5d3a5';
        } else if ( (((avg - 1*std) >= value) && (value >= (avg - 1.5*std)) && !mult) ||
                    (((avg + 1*std) <= value) && (value <= (avg + 1.5*std)) && mult)) {
            return '#b1e1b0';
        } else if ( (((avg - 0.5*std) >= value) && (value >= (avg - 1*std)) && !mult) ||
                    (((avg + 0.5*std) <= value) && (value <= (avg + 1*std)) && mult)) {
            return '#c5f1c6';
        } else if ( ((avg >= value) && (value >= (avg - 0.5*std)) && !mult) ||
                    ((avg <= value) && (value <= (avg + 0.5*std)) && mult)) {
            return '#e7f6e5';
        } else if ( ((avg >= value) && (value >= (avg - 0.5*std)) && mult) ||
                    ((avg <= value) && (value <= (avg + 0.5*std)) && !mult)) {
            return '#fff3f3';
        } else if ( ((avg - 0.5*std >= value) && (value >= (avg - 1*std)) && mult) ||
                    ((avg + 0.5*std <= value) && (value <= (avg + 1*std)) && !mult)) {
            return '#ffe1e1';
        } else if ( ((avg - 1*std >= value) && (value >= (avg - 1.5*std)) && mult) ||
                    ((avg + 1*std <= value) && (value <= (avg + 1.5*std)) && !mult)) {
            return '#fdc2c2';
        } else if ( ((avg - 1.5*std >= value) && (value >= (avg - 2*std)) && mult) ||
                    ((avg + 1.5*std <= value) && (value <= (avg + 2*std)) && !mult)) {
            return '#fda4a4';
        } else if (((value < (avg - 2*std)) && !mult) || 
                    ((value > (avg + 2*std) && mult))) {
            return '#67c279';
        } else if ( ((value < (avg - 2*std)) && mult) || 
                    ((value > (avg + 2*std) && !mult))) {
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
                    <span style={{ display:'inline-block', margin: 5, width: 120 }}>
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
                        sortFunc={this.revertSortFunc}
                    >
                        <div>
                        {params[key].label}
                        </div>
                        
                    </TableHeaderColumn>
                );                
            } else {
                // Add Label, type(money, %, number), size ...
                const colString = (cell, row) => {
                    return <ColorColumn value={row[key]} class={key}/>
                    // return `${row[key].toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
                };
                return (
                    <TableHeaderColumn
                        dataField={key}
                        dataSort
                        row='1'
                        tdClass={key}
                        tdStyle={ this.getCellStyle.bind(this, key, params) }
                        width={params[key].size}
                        dataFormat={(cell, row) => colString(cell, row)}
                        sortFunc={this.revertSortFunc}
                        >
                            <div style={{'white-space': 'pre-line'}}>
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
                    sortFunc={ this.revertSortFunc }
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
                    sortFunc={ this.revertSortFunc }
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

export default StockBoard;