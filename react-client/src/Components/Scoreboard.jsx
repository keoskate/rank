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

class Scoreboard extends Component {
    constructor() {
        super();

        this.state = {
            sortName: undefined,
            sortOrder: undefined,
            altGrid: false, 
            rGrid: [],
            sGrid: [],
            params: {
                "rank": {
                    label: 'Rank',
                    type: '',
                    size: '50',
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "ticker": {
                    label: 'Ticker',
                    type: '',
                    size: '60',
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "marketCap": {
                    label: 'Market Cap',
                    type: 'money',
                    size: SIZE.large,
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "volume": {
                    label: 'Volume',
                    type: 'number',
                    size: SIZE.large,
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "price": {
                    label: 'Price',
                    type: 'money',
                    size: SIZE.small,
                    weight: 0.1, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "nav": {
                    label: 'NAV',
                    type: '',
                    size: SIZE.small,
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "discount": {
                    label: 'Discount',
                    type: '',
                    size: SIZE.medium,
                    weight: 0.40, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "distribution": {
                    label: 'Distribution',
                    type: '',
                    size: SIZE.medium,
                    weight: 0.30, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "zScore1y": {
                    label: 'Z-Score 1Y',
                    type: '',
                    size: SIZE.small,
                    weight: 0.2, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "leverage": {
                    label: 'Leverage',
                    type: '',
                    size: SIZE.small,
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "maturity": {
                    label: 'Maturity',
                    type: '',
                    size: SIZE.small,
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "uniiDist": {
                    label: 'UNII/Dist',
                    type: '',
                    size: SIZE.small,
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                }
            },
        };

        this.handleRelativeScoreboard = this.handleRelativeScoreboard.bind(this);
        this.handleStdScoreboard = this.handleStdScoreboard.bind(this);
        this.handleFullDataScoreboard = this.handleFullDataScoreboard.bind(this);

        this.onSortChange = this.onSortChange.bind(this);
    }

    componentDidMount() {
        const data = rawData.default.cef;
        this.cleanData(data);
        this.setupDataStructures(data);
        this.setState({
            data: data,
        });
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
            if (col !== 'ticker' && col !== 'rank') {
                const param = parameters[col];
                const order = param.multiplier === 1 ? 'asc' : 'desc';
                const multiplier = param.multiplier;
                const weight = param.weight;
                let stdDev = undefined;
                let average = undefined;
                if (!param.average && !param.stdDev) {
                    stdDev = this.getColStandardDeviation(col, data); // || 0;
                    average = this.getColAverage(col, data); // || 0;

                    this.state.params[col].stdDev = stdDev;
                    this.state.params[col].average = average;

                    this.setState(({
                        params: this.state.params
                    }));
                }
                stdDev = stdDev || this.getColStandardDeviation(col, data); // || 0;
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
        return math.mean(...list);
    }

    getColStandardDeviation(col, data) {
        const list = this.getColList(col, data);
        const avg = this.getListAverage(list);

        const stdDev = math.std(...list);

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

    // Step 1b
    swapKeys(rowItem) {
        let newRow = {};
        const goodKeys = Object.keys(this.state.params);

        Object.keys(rowItem).map(function(key, index) {
            newRow[goodKeys[index]] = rowItem[key];
         });

        return newRow;
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
    
    stylingID(col, params, cell, row, ridx, cidx) {
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

    headers(params) { 
        return Object.keys(params).map((key) => {
            if (key === 'rank') {
                return (
                    <TableHeaderColumn
                        isKey
                        dataField={key}
                        dataSort
                        width='50'
                        sortFunc={this.revertSortFunc}
                    >
                        {params[key].label}
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
                        tdClass={key}
                        tdStyle={ this.stylingID.bind(this, key, params) }
                        width={params[key].size}
                        dataFormat={(cell, row) => colString(cell, row)}
                        sortFunc={this.revertSortFunc}
                        >
                        {params[key].label}
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
                    {this.sumCol()}
                    {this.goodRankCol()}
                </BootstrapTable>
            </div>
        );
    }
}

export default Scoreboard;