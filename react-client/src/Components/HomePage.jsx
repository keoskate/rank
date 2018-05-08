import React, { Component } from 'react';
import {BootstrapTable, TableHeaderColumn} from 'react-bootstrap-table';
import * as math from 'mathjs';
// import RawData from './rank-data.json'



class HomePage extends Component {

    constructor() {
        super();
        this.state = { 
            sortName: undefined,
            sortOrder: undefined,
            rGrid: [],
            sGrid: [],
            uiData: [],
            params: {
                "rank": {
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "ticker": {
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "marketCap": {
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "volume": {
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "price": {
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "nav": {
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "discount": {
                    weight: 0.50, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "distribution": {
                    weight: 0.50, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "zScore1y": {
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "leverage": {
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "maturity": {
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "uniiDist": {
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                }
            },
            data: [
                {
                  "Rank": 1,
                  "Ticker": "ZF",
                  "Market Cap": "191,458,080",
                  "Volume": "1,012,089",
                  "Price": "$11.22",
                  "NAV": "$12.77",
                  "Discount": "-12.14%",
                  "Distribution": "12.87%",
                  "Z-Score 1Y": -1.04,
                  "Leverage": "26.45%",
                  "Maturity": 0,
                  "UNII/Dist": "-21.59%"
                },
                {
                  "Rank": 2,
                  "Ticker": "NAD",
                  "Market Cap": "475,622,300",
                  "Volume": "1,451,542",
                  "Price": "$5.57",
                  "NAV": "$6.52",
                  "Discount": "-14.57%",
                  "Distribution": "10.78%",
                  "Z-Score 1Y": 1.56,
                  "Leverage": "2.67%",
                  "Maturity": 0,
                  "UNII/Dist": "-22.43%"
                },
                {
                  "Rank": 3,
                  "Ticker": "NEA",
                  "Market Cap": "24,972,480",
                  "Volume": "64,883",
                  "Price": "$6.96",
                  "NAV": "$8.50",
                  "Discount": "-18.10%",
                  "Distribution": "7.20%",
                  "Z-Score 1Y": -1.59,
                  "Leverage": "0.08%",
                  "Maturity": 0,
                  "UNII/Dist": "1.84%"
                },
                {
                  "Rank": 4,
                  "Ticker": "MUC",
                  "Market Cap": "61,296,771",
                  "Volume": "202,612",
                  "Price": "$6.55",
                  "NAV": "$7.66",
                  "Discount": "-14.50%",
                  "Distribution": "8.54%",
                  "Z-Score 1Y": 0,
                  "Leverage": "0.31%",
                  "Maturity": 0,
                  "UNII/Dist": "-57.16%"
                },
                {
                  "Rank": 5,
                  "Ticker": "NAC",
                  "Market Cap": "77,514,660",
                  "Volume": "427,123",
                  "Price": "$14.97",
                  "NAV": "$17.20",
                  "Discount": "-12.97%",
                  "Distribution": "9.35%",
                  "Z-Score 1Y": 0.04,
                  "Leverage": "7.03%",
                  "Maturity": 0.04,
                  "UNII/Dist": "-27.06%"
                },
                {
                  "Rank": 6,
                  "Ticker": "VKI",
                  "Market Cap": 0,
                  "Volume": "2,274,078",
                  "Price": "$7.13",
                  "NAV": "$8.01",
                  "Discount": "-10.99%",
                  "Distribution": "10.27%",
                  "Z-Score 1Y": -0.32,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "1.88%"
                },
                {
                  "Rank": 7,
                  "Ticker": "GRF",
                  "Market Cap": "194,065,620",
                  "Volume": "673,273",
                  "Price": "$7.98",
                  "NAV": "$8.86",
                  "Discount": "-9.93%",
                  "Distribution": "11.03%",
                  "Z-Score 1Y": 0.65,
                  "Leverage": "15.10%",
                  "Maturity": 0,
                  "UNII/Dist": "0.48%"
                },
                {
                  "Rank": 8,
                  "Ticker": "CCA",
                  "Market Cap": "116,971,950",
                  "Volume": "323,338",
                  "Price": "$16.95",
                  "NAV": "$19.03",
                  "Discount": "-10.93%",
                  "Distribution": "10.26%",
                  "Z-Score 1Y": 0.07,
                  "Leverage": "31.46%",
                  "Maturity": 3,
                  "UNII/Dist": "-5.24%"
                },
                {
                  "Rank": 9,
                  "Ticker": "IGD",
                  "Market Cap": "3,458,948,080",
                  "Volume": "6,144,930",
                  "Price": "$13.16",
                  "NAV": "$14.50",
                  "Discount": "-9.24%",
                  "Distribution": "5.66%",
                  "Z-Score 1Y": -1.21,
                  "Leverage": "35.73%",
                  "Maturity": 9.1,
                  "UNII/Dist": "-3.88%"
                },
                {
                  "Rank": 10,
                  "Ticker": "VFL",
                  "Market Cap": "2,722,983,480",
                  "Volume": "8,689,530",
                  "Price": "$13.49",
                  "NAV": "$14.83",
                  "Discount": "-9.04%",
                  "Distribution": "5.69%",
                  "Z-Score 1Y": -1.44,
                  "Leverage": "36.02%",
                  "Maturity": 9.3,
                  "UNII/Dist": "-3.70%"
                },
                {
                  "Rank": 11,
                  "Ticker": "IQI",
                  "Market Cap": "2,912,424,540",
                  "Volume": "6,034,423",
                  "Price": "$14.38",
                  "NAV": "$15.53",
                  "Discount": "-7.41%",
                  "Distribution": "6.05%",
                  "Z-Score 1Y": 0.01,
                  "Leverage": "36.02%",
                  "Maturity": 10.2,
                  "UNII/Dist": "0.60%"
                },
                {
                  "Rank": 12,
                  "Ticker": "VCV",
                  "Market Cap": "2,014,836,200",
                  "Volume": "3,970,797",
                  "Price": "$14.18",
                  "NAV": "$15.24",
                  "Discount": "-6.96%",
                  "Distribution": "6.27%",
                  "Z-Score 1Y": 0.26,
                  "Leverage": "36.07%",
                  "Maturity": 10.3,
                  "UNII/Dist": "0.15%"
                },
                {
                  "Rank": 13,
                  "Ticker": "AKP",
                  "Market Cap": "58,094,240",
                  "Volume": "310,563",
                  "Price": "$12.83",
                  "NAV": "$14.22",
                  "Discount": "-9.77%",
                  "Distribution": "5.14%",
                  "Z-Score 1Y": -1.69,
                  "Leverage": "30.65%",
                  "Maturity": 6.5,
                  "UNII/Dist": "3.65%"
                },
                {
                  "Rank": 14,
                  "Ticker": "PGZ",
                  "Market Cap": 0,
                  "Volume": "906,876",
                  "Price": "$11.08",
                  "NAV": "$11.94",
                  "Discount": "-7.20%",
                  "Distribution": "5.92%",
                  "Z-Score 1Y": -1.12,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "-0.88%"
                },
                {
                  "Rank": 15,
                  "Ticker": "FEO",
                  "Market Cap": "113,166,325",
                  "Volume": "667,137",
                  "Price": "$13.22",
                  "NAV": "$14.79",
                  "Discount": "-10.58%",
                  "Distribution": "4.28%",
                  "Z-Score 1Y": -1.94,
                  "Leverage": "36.65%",
                  "Maturity": 6.7,
                  "UNII/Dist": "-2.54%"
                },
                {
                  "Rank": 16,
                  "Ticker": "NVG",
                  "Market Cap": "120,292,160",
                  "Volume": "465,612",
                  "Price": "$12.01",
                  "NAV": "$13.30",
                  "Discount": "-9.70%",
                  "Distribution": "4.96%",
                  "Z-Score 1Y": -1.86,
                  "Leverage": "38.03%",
                  "Maturity": 5.6,
                  "UNII/Dist": "0.55%"
                },
                {
                  "Rank": 17,
                  "Ticker": "MUE",
                  "Market Cap": 0,
                  "Volume": "813,199",
                  "Price": "$12.31",
                  "NAV": "$13.31",
                  "Discount": "-7.51%",
                  "Distribution": "5.70%",
                  "Z-Score 1Y": -1.06,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "-1.84%"
                },
                {
                  "Rank": 18,
                  "Ticker": "EIV",
                  "Market Cap": 0,
                  "Volume": "1,519,490",
                  "Price": "$14.45",
                  "NAV": "$15.80",
                  "Discount": "-8.54%",
                  "Distribution": "5.15%",
                  "Z-Score 1Y": -1.39,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "-2.86%"
                },
                {
                  "Rank": 19,
                  "Ticker": "EVM",
                  "Market Cap": 0,
                  "Volume": "864,430",
                  "Price": "$13.10",
                  "NAV": "$13.98",
                  "Discount": "-6.29%",
                  "Distribution": "5.86%",
                  "Z-Score 1Y": -1.19,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "8.68%"
                },
                {
                  "Rank": 20,
                  "Ticker": "NKX",
                  "Market Cap": 0,
                  "Volume": "1,739,946",
                  "Price": "$14.09",
                  "NAV": "$15.23",
                  "Discount": "-7.49%",
                  "Distribution": "5.24%",
                  "Z-Score 1Y": -1.35,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "12.26%"
                },
                {
                  "Rank": 21,
                  "Ticker": "MCA",
                  "Market Cap": 0,
                  "Volume": "321,612",
                  "Price": "$14.33",
                  "NAV": "$15.32",
                  "Discount": "-6.46%",
                  "Distribution": "5.74%",
                  "Z-Score 1Y": -0.73,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "20.52%"
                },
                {
                  "Rank": 22,
                  "Ticker": "IIM",
                  "Market Cap": "287,776,280",
                  "Volume": "704,607",
                  "Price": "$12.76",
                  "NAV": "$13.57",
                  "Discount": "-5.97%",
                  "Distribution": "5.83%",
                  "Z-Score 1Y": -1.11,
                  "Leverage": "37.12%",
                  "Maturity": 20.1,
                  "UNII/Dist": "11.31%"
                },
                {
                  "Rank": 23,
                  "Ticker": "NEV",
                  "Market Cap": "450,149,960",
                  "Volume": "957,225",
                  "Price": "$14.66",
                  "NAV": "$15.43",
                  "Discount": "-4.99%",
                  "Distribution": "5.94%",
                  "Z-Score 1Y": -1.37,
                  "Leverage": "36.85%",
                  "Maturity": 19.2,
                  "UNII/Dist": "11.52%"
                },
                {
                  "Rank": 24,
                  "Ticker": "CH",
                  "Market Cap": 0,
                  "Volume": "4,214,299",
                  "Price": "$14.28",
                  "NAV": "$15.18",
                  "Discount": "-5.93%",
                  "Distribution": "5.75%",
                  "Z-Score 1Y": -1.17,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "-2.04%"
                },
                {
                  "Rank": 25,
                  "Ticker": "MQT",
                  "Market Cap": "31,537,520",
                  "Volume": "20,118",
                  "Price": "$11.32",
                  "NAV": "$12.20",
                  "Discount": "-7.21%",
                  "Distribution": "5.09%",
                  "Z-Score 1Y": -1.3,
                  "Leverage": "42.20%",
                  "Maturity": 15.2,
                  "UNII/Dist": "157.26%"
                },
                {
                  "Rank": 26,
                  "Ticker": "GGT",
                  "Market Cap": "347,651,010",
                  "Volume": "3,123,705",
                  "Price": "$13.93",
                  "NAV": "$14.70",
                  "Discount": "-5.24%",
                  "Distribution": "5.86%",
                  "Z-Score 1Y": -1.63,
                  "Leverage": "11.86%",
                  "Maturity": 9.1,
                  "UNII/Dist": "-1.23%"
                },
                {
                  "Rank": 27,
                  "Ticker": "MQY",
                  "Market Cap": 0,
                  "Volume": "1,380,973",
                  "Price": "$12.32",
                  "NAV": "$13.19",
                  "Discount": "-6.60%",
                  "Distribution": "5.21%",
                  "Z-Score 1Y": -1.06,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "-5.25%"
                },
                {
                  "Rank": 28,
                  "Ticker": "AWP",
                  "Market Cap": "244,185,410",
                  "Volume": "454,697",
                  "Price": "$11.41",
                  "NAV": "$12.21",
                  "Discount": "-6.55%",
                  "Distribution": "5.13%",
                  "Z-Score 1Y": -1.07,
                  "Leverage": "41.08%",
                  "Maturity": 5.5,
                  "UNII/Dist": "10.26%"
                },
                {
                  "Rank": 29,
                  "Ticker": "BAF",
                  "Market Cap": 0,
                  "Volume": "813,569",
                  "Price": "$14.56",
                  "NAV": "$15.37",
                  "Discount": "-5.27%",
                  "Distribution": "5.35%",
                  "Z-Score 1Y": -0.91,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "7.76%"
                },
                {
                  "Rank": 30,
                  "Ticker": "NZF",
                  "Market Cap": 0,
                  "Volume": "1,192,444",
                  "Price": "$14.46",
                  "NAV": "$15.20",
                  "Discount": "-4.87%",
                  "Distribution": "5.44%",
                  "Z-Score 1Y": -0.94,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "-2.33%"
                }
              ],
            data1: [
                {
                  "Rank": undefined,
                  "Ticker": "ZF",
                  "Market Cap": "191,458,080",
                  "Volume": "1,012,089",
                  "Price": "11.22",
                  "NAV": "$12.77",
                  "Discount": "-12.14%",
                  "Distribution": "12.87%",
                  "Z-Score 1Y": -1.04,
                  "Leverage": "26.45%",
                  "Maturity": 0,
                  "UNII/Dist": "-21.59%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "NAD",
                  "Market Cap": "475,622,300",
                  "Volume": "1,451,542",
                  "Price": "5.57",
                  "NAV": "$6.52",
                  "Discount": "-14.57%",
                  "Distribution": "10.78%",
                  "Z-Score 1Y": 1.56,
                  "Leverage": "2.67%",
                  "Maturity": 0,
                  "UNII/Dist": "-22.43%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "NEA",
                  "Market Cap": "24,972,480",
                  "Volume": "64,883",
                  "Price": "6.96",
                  "NAV": "$8.50",
                  "Discount": "-18.10%",
                  "Distribution": "7.20%",
                  "Z-Score 1Y": -1.59,
                  "Leverage": "0.08%",
                  "Maturity": 0,
                  "UNII/Dist": "1.84%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "MUC",
                  "Market Cap": "61,296,771",
                  "Volume": "202,612",
                  "Price": "6.55",
                  "NAV": "$7.66",
                  "Discount": "-14.50%",
                  "Distribution": "8.54%",
                  "Z-Score 1Y": 0,
                  "Leverage": "0.31%",
                  "Maturity": 0,
                  "UNII/Dist": "-57.16%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "NAC",
                  "Market Cap": "77,514,660",
                  "Volume": "427,123",
                  "Price": "14.97",
                  "NAV": "$17.20",
                  "Discount": "-12.97%",
                  "Distribution": "9.35%",
                  "Z-Score 1Y": 0.04,
                  "Leverage": "7.03%",
                  "Maturity": 0.04,
                  "UNII/Dist": "-27.06%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "VKI",
                  "Market Cap": 0,
                  "Volume": "2,274,078",
                  "Price": "7.13",
                  "NAV": "$8.01",
                  "Discount": "-10.99%",
                  "Distribution": "10.27%",
                  "Z-Score 1Y": -0.32,
                  "Leverage": 0,
                  "Maturity": 0,
                  "UNII/Dist": "1.88%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "GRF",
                  "Market Cap": "194,065,620",
                  "Volume": "673,273",
                  "Price": "7.98",
                  "NAV": "$8.86",
                  "Discount": "-9.93%",
                  "Distribution": "11.03%",
                  "Z-Score 1Y": 0.65,
                  "Leverage": "15.10%",
                  "Maturity": 0,
                  "UNII/Dist": "0.48%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "CCA",
                  "Market Cap": "116,971,950",
                  "Volume": "323,338",
                  "Price": "16.95",
                  "NAV": "$19.03",
                  "Discount": "-10.93%",
                  "Distribution": "10.26%",
                  "Z-Score 1Y": 0.07,
                  "Leverage": "31.46%",
                  "Maturity": 3,
                  "UNII/Dist": "-5.24%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "IGD",
                  "Market Cap": "3,458,948,080",
                  "Volume": "6,144,930",
                  "Price": "13.16",
                  "NAV": "$14.50",
                  "Discount": "-9.24%",
                  "Distribution": "5.66%",
                  "Z-Score 1Y": -1.21,
                  "Leverage": "35.73%",
                  "Maturity": 9.1,
                  "UNII/Dist": "-3.88%"
                },
                {
                  "Rank": undefined,
                  "Ticker": "VFL",
                  "Market Cap": "2,722,983,480",
                  "Volume": "8,689,530",
                  "Price": "13.49",
                  "NAV": "$14.83",
                  "Discount": "-9.04%",
                  "Distribution": "5.69%",
                  "Z-Score 1Y": -1.44,
                  "Leverage": "36.02%",
                  "Maturity": 9.3,
                  "UNII/Dist": "-3.70%"
                },
            ]
        };
        
        this.cleanData(this.state.data);
        
        // This binding is necessary to make `this` work in the callback
        this.handleRelativeScoreboard = this.handleRelativeScoreboard.bind(this);
        this.handleStdScoreboard = this.handleStdScoreboard.bind(this);
        this.handleFullDataScoreboard = this.handleFullDataScoreboard.bind(this);
        
        this.onSortChange = this.onSortChange.bind(this);
    }

    componentDidMount() {
        this.setupDataStructures(this.state.data);
    }

    getColList(name, data) {
        data = data || this.state.data;
        const list = [];
        for (let i = 0; i < data.length; i++){
            const row = data[i];
            list.push(row[name]);
        }
        return list;
    }

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

    setupDataStructures(data) {
        let rGrid = this.initGrid(this.state.data);
        let sGrid = this.initGrid(this.state.data);

        this.rankCols(rGrid);
        this.rankColsStd(sGrid);

        this.calculateRank(data, rGrid, sGrid);

        this.setState({
            uiData: data,
            rGrid: rGrid,
            sGrid: sGrid
        });
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

    countIf(list, number) {
        return list.reduce((sum, item) => {
            return sum + (item.rank === number);
        }, 0);
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
    
    // cell = [ (cell - colAvg) / colStd ] * this.state.param[1] 
    rankColsStd(grid) {
        // const colNames = Object.keys(this.state.weights);
        const parameters = this.state.params;

        // Each key of state.params is the name of the column.
        for (let col in parameters) {
            if (col !== 'ticker' && col !== 'rank') {
                const param = parameters[col];
                const order = param.multiplier === 1 ? 'asc' : 'desc';
                const multiplier = param.multiplier;
                const weight = param.weight;
                const stdDev = param.stdDev || this.getColStandardDeviation(col) || 0;
                const average = param.average || this.getColAverage(col) || 0;
    
                if (weight > 0) {
                    const colList = this.getColList(col);
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

    getColAverage(col) {
        const list = this.getColList(col);
        const avg = this.getListAverage(list);

        return avg;
    }

    getListAverage(list) {
        // const sum = list.reduce((sum, value) => {
        //     return sum + value;
        //   }, 0);
        
        // const avg = sum / list.length;
        return math.mean(...list);
    }

    getColStandardDeviation(col) {
        const list = this.getColList(col);
        const avg = this.getListAverage(list);

        const stdDev = math.std(...list);

        return stdDev;
    }

    rankCols(grid) {
        const parameters = this.state.params;
        for (let col in parameters) {
            const param = parameters[col];
            const order = param.multiplier === 1 ? 'asc' : 'desc';
            const weight = param.weight;
            
            if (weight > 0) {
                const colList = this.getColList(col);
                const rankedCol = this.rankCol(colList, order);
                
                // Insert rankedCol into each grid row. 
                for (let row in grid) {
                    grid[row][col] = rankedCol[row].rank * (1 + weight);
                }
            }
        }

        this.getSumAndRelativeRank(grid, 'desc');
    }

    rankCol(list, order) {
        // sort a copy of the array 
        const rankedList = [...list];

        // create array with holder objects
        var rankings = rankedList.map(function(item, index) {
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
        rankings.forEach(function(holder, index, rankings) {
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

    /**
     * 1) Rank each col in Asc/Dec order
     * 2) Multiple that rank by 1 + weight %
     * 
     * 3) Get cumulative sum for each row 
     * 4) Rank this col 
     * 5) Return the Rank for each Row.at(col)
     */
    relativeRankingStrategy(cell, row) {
        const itemSortOrder = paramters.order[cell];
        const itemWeight = paramters.weight[cell]; // 0.5%

        const item = data.row;

        const itemRank = Rank(cell, itemSortOrder); 
        return itemRank * (1 + itemWeight);

        for (let col in weights) {
            if (weights[index] > 0.0) {
                // if (Rank(this.getCol(col)item.Discount, )) {
                //     item.Discount
                // }
            }
        }
        
    }

    getRow(index) {
        return this.state.data[index];
    }

    getColumn(index, name) {
        return getRow(index)[name];
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


    // Step 1a
    cleanData(data) {
        // clean keys 
        for (let row in data) {
            data[row] = this.swapKeys(data[row]);
        }

        for (let index in data) {
            data[index] = Object.assign(data[index], this.cleanRow(data[index]));
        }

        this.setState({
            data: data
        });
    }

    // Step 1c
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

    revertSortFunc(a, b, order, sortField) {   // order is desc or asc
        if (order === 'desc') {
          return a[sortField] - b[sortField];
        } else {
          return b[sortField] - a[sortField];
        }
      }

    onSortChange(sortName, sortOrder) {
        this.setState({
            sortName, 
            sortOrder
        });
    }

    handleStdScoreboard() {
        this.setState({
            uiData: this.state.sGrid
        });
    }

    handleRelativeScoreboard() {
        this.setState(({
            uiData: this.state.rGrid
        }));
    }

    handleFullDataScoreboard() {
        this.setState(({
            uiData: this.state.data
        }));
    }
      
    render() {
        const options = {
            sortName: this.state.sortName,
            sortOrder: this.state.sortOrder,
            onSortChange: this.onSortChange
          };
        return (
            <div>
                <button onClick={this.handleFullDataScoreboard}>
                Full Grid
                </button>

                <button onClick={this.handleRelativeScoreboard}>
                Relative Rank Grid
                </button>

                <button onClick={this.handleStdScoreboard}>
                Std Deviation Grid
                </button>
                <BootstrapTable data={this.state.uiData} options={options} striped hover condensed>
                    <TableHeaderColumn
                        isKey
                        dataField='rank'
                        dataSort
                        sortFunc={ this.revertSortFunc }
                        // dataFormat={(cell, row) => `$${row.ticker}`}
                        >
                        Rank
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='ticker'
                        dataSort
                        sortFunc={ this.revertSortFunc }
                        >
                        Ticker
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='marketCap'   
                        dataSort
                        dataFormat={(cell, row) => `${row.marketCap.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`}
                        sortFunc={ this.revertSortFunc }
                        >
                        Market Cap
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='volume'
                        dataSort
                        dataFormat={(cell, row) => `${row.volume.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`}
                        sortFunc={ this.revertSortFunc }
                        >
                        Volume
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='price'        
                        dataSort
                        dataFormat={(cell, row) => `$${row.price}`}
                        sortFunc={ this.revertSortFunc }
                        >
                        Price
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='nav'   
                        dataSort      
                        dataFormat={(cell, row) => `$${row.nav}`} 
                        sortFunc={ this.revertSortFunc }
                        >
                        NAV
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='discount'
                        dataSort
                        dataFormat={(cell, row) => `${row.discount}%`}
                        sortFunc={ this.revertSortFunc }
                        >
                        Discount
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='distribution' 
                        dataSort
                        dataFormat={(cell, row) => `${row.distribution}%`}
                        sortFunc={ this.revertSortFunc }
                        >
                        Distribution
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='zScore1y'
                        dataSort
                        sortFunc={ this.revertSortFunc }
                        >
                        Z-Score 1Y
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='leverage'
                        dataSort
                        dataFormat={(cell, row) => `${row.leverage}%`}
                        sortFunc={ this.revertSortFunc }
                        >
                        Leverage
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='maturity'
                        dataSort
                        sortFunc={ this.revertSortFunc }
                        >
                        Maturity
                    </TableHeaderColumn>
                    <TableHeaderColumn 
                        dataField='uniiDist'
                        dataSort
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={ this.revertSortFunc }
                        >
                        UNII/Dist
                    </TableHeaderColumn>

                    <TableHeaderColumn 
                        dataField='sum'
                        dataSort
                        sortFunc={ this.revertSortFunc }
                        >
                        Sum
                    </TableHeaderColumn>

                    <TableHeaderColumn 
                        dataField='goodRank'
                        dataSort
                        sortFunc={ this.revertSortFunc }
                        >
                        Alt Rank
                    </TableHeaderColumn>

                </BootstrapTable>
            </div>
        );
    }
}

export default HomePage;