import React, { Component } from 'react';
import { BootstrapTable, TableHeaderColumn, InsertButton } from 'react-bootstrap-table';
import * as math from 'mathjs';
import WeightSlider from './WeightSlider';
import * as rawData from '../rank-data'

class StockBoard extends Component {
    constructor() {
        super();

        this.state = {
            sortName: undefined,
            sortOrder: undefined,
            rGrid: [],
            sGrid: [],
            data: [],
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
                "name": {
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "industry": {
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "sector": {
                    weight: 0, 
                    multiplier: 0,
                    average: undefined,
                    stdDev: undefined
                },
                "sharesOutstanding": {
                    weight: 0, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "marketCap": {
                    weight: 0.50, 
                    multiplier: 1,
                    average: undefined,
                    stdDev: undefined
                },
                "avgVolume": {
                    weight: 0.50, 
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
                "52High": {
                    weight: 0, 
                    multiplier: -1,
                    average: undefined,
                    stdDev: undefined
                },
                "52Low": {
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
        };

        this.onSortChange = this.onSortChange.bind(this);
    }

    componentDidMount() {
        const data = rawData.default.cef;
        this.setState({
            data: data
        });
    }

    componentWillReceiveProps() {
        this.setState({
            data: this.props.uiData,
            params: this.props.params
        });
    }

    // ------------------- SETUP Methods -------------------
    updateGrid() {
        this.rankData(this.state.data);
    }

    // Setup up relative/std grids used to calculate rank
    rankData(data) {
        let rGrid = this.initGrid(this.state.data);
        let sGrid = this.initGrid(this.state.data);

        this.rankCols(rGrid);
        this.rankColsStd(sGrid);

        this.calculateRank(data, rGrid, sGrid);

        this.setState({
            data: data
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

    // Standard Deviation Ranking 
    rankColsStd(grid) {
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

    getColAverage(col) {
        const list = this.getColList(col);
        const avg = this.getListAverage(list);

        return avg;
    }

    getListAverage(list) {
        return math.mean(...list);
    }

    getColStandardDeviation(col) {
        const list = this.getColList(col);
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

    handleWeightChange(evt) {
        this.state.params[evt.target.name].weight = evt.target.valueAsNumber || 0;

        this.setState(({
            params: this.state.params
        }));

        this.updateGrid();
    }

    cellButton(cell, row) {
        return (
            <p>hey</p>
        );
    }

    render() {
        const options = {
            sortName: this.state.sortName,
            sortOrder: this.state.sortOrder,
            onSortChange: this.onSortChange
        };
        
        return (
            <div>
                <WeightSlider label='Test Slider' name='marketCap' value={this.props.params.marketCap.weight} onChange={this.handleWeightChange.bind(this)} />
                
                <div>
                    <label>
                        Market Cap Weight: [{this.props.params.marketCap.weight}] <input type="range" value={this.props.params.marketCap.weight} min="0" max="1" step="0.05" name="marketCap" onChange={this.handleWeightChange.bind(this)} />
                    </label>
                    <button>hey</button>
                </div>

                <div>
                    <label>
                        Discount: [{this.props.params.discount.weight}] <input type="range" value={this.props.params.discount.weight} min="0" max="1" step="0.05" name="discount" onChange={this.handleWeightChange.bind(this)} />
                    </label>
                </div>

                <div>
                    <label>
                        Distribution: [{this.props.params.distribution.weight}] <input type="range" value={this.props.params.distribution.weight} min="0" max="1" step="0.05" name="distribution" onChange={this.handleWeightChange.bind(this)} />
                    </label>
                </div>

                <div>
                    <label>
                        Volume: [{this.props.params.volume.weight}] <input type="range" value={this.props.params.volume.weight} min="0" max="1" step="0.05" name="volume" onChange={this.handleWeightChange.bind(this)} />
                    </label>
                </div>

                <div>
                    <label>
                        Z-Score: [{this.props.params.zScore1y.weight}] <input type="range" value={this.props.params.zScore1y.weight} min="0" max="1" step="0.05" name="zScore1y" onChange={this.handleWeightChange.bind(this)} />
                    </label>
                </div>

                <BootstrapTable data={this.props.uiData} options={options} striped hover condensed pagination containerStyle={ { overflow: scroll  } }>
                    {/* <TableHeaderColumn row='0' colSpan='3' dataField='' dataFormat={this.cellButton}>Positive Multiplier</TableHeaderColumn> */}
                    {/* <TableHeaderColumn row='0' colSpan='1' dataField=''>Positive Multiplier</TableHeaderColumn> */}
                    <TableHeaderColumn
                        isKey
                        row='1'
                        dataField='rank'
                        dataSort
                        width='75'
                        sortFunc={this.revertSortFunc}
                    // dataFormat={(cell, row) => `$${row.ticker}`}
                    >
                        Rank
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='ticker'
                        dataSort
                        row='1'
                        width='100'
                        sortFunc={this.revertSortFunc}
                    >
                        Ticker
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='marketCap'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.marketCap.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`}
                        sortFunc={this.revertSortFunc}
                    >
                        Market Cap
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='volume'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.volume.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`}
                        sortFunc={this.revertSortFunc}
                    >
                        Volume
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='price'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `$${row.price}`}
                        sortFunc={this.revertSortFunc}
                    >
                        Price
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='nav'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `$${row.nav}`}
                        sortFunc={this.revertSortFunc}
                    >
                        NAV
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='discount'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.discount}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        Discount
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='distribution'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.distribution}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        Distribution
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='zScore1y'
                        dataSort
                        row='1'
                        width='100'
                        sortFunc={this.revertSortFunc}
                    >
                        Z-Score 1Y
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='leverage'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.leverage}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        Leverage
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='maturity'
                        dataSort
                        row='1'
                        width='100'
                        sortFunc={this.revertSortFunc}
                    >
                        Maturity
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='uniiDist'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        UNII/Dist
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='uniiDist'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        UNII/Dist
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='uniiDist'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        UNII/Dist
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='uniiDist'
                        dataSort
                        row='1'
                        width='100'
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        UNII/Dist
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='uniiDist'
                        dataSort
                        row='1'
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        UNII/Dist
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='uniiDist'
                        dataSort
                        row='1'
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        UNII/Dist
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='uniiDist'
                        dataSort
                        row='1'
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        UNII/Dist
                    </TableHeaderColumn>
                    <TableHeaderColumn
                        dataField='uniiDist'
                        dataSort
                        row='1'
                        dataFormat={(cell, row) => `${row.uniiDist}%`}
                        sortFunc={this.revertSortFunc}
                    >
                        UNII/Dist
                    </TableHeaderColumn>

                    {/* <TableHeaderColumn
                        dataField='sum'
                        dataSort
                        sortFunc={this.revertSortFunc}
                    >
                        Sum
                    </TableHeaderColumn>

                    <TableHeaderColumn
                        dataField='goodRank'
                        dataSort
                        sortFunc={this.revertSortFunc}
                    >
                        Alt Rank
                    </TableHeaderColumn> */}
                </BootstrapTable>
            </div>
        );
    }
}

export default StockBoard;