/**
 * TABLE CONFIGURATION - TanStack React Table setup and column definitions
 * 
 * This module centralizes all table configuration logic, including:
 * - Column definitions
 * - Cell formatters
 * - Conditional styling
 * - Sorting configuration
 * 
 * This separation makes it easier to modify table behavior and add new
 * column types without touching the main component logic.
 */

import { createColumnHelper } from '@tanstack/react-table';
import { getCellStyle, COLOR_SCHEMES } from './colorUtils';
import { formatNumberWithCommas } from './mathUtils';

/**
 * Create table columns configuration
 */
export const createTableColumns = (params, altGrid, getCellStyleFn) => {
    const columnHelper = createColumnHelper();
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
                        const cellStyle = getCellStyleFn(key, value);
                        const formattedValue = formatNumberWithCommas(value);
                        
                        return (
                            <div style={cellStyle}>
                                {formattedValue}
                            </div>
                        );
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
                cell: info => {
                    const value = info.getValue();
                    return (
                        <div style={{ 
                            backgroundColor: COLOR_SCHEMES.ALT_GRID_SUM,
                            padding: '8px',
                            margin: '-4px',
                            minHeight: '20px',
                            display: 'flex',
                            alignItems: 'center'
                        }}>
                            {value?.toFixed(2) || ''}
                        </div>
                    );
                },
                size: 80
            })
        );
        cols.push(
            columnHelper.accessor('goodRank', {
                header: 'Alt Rank',
                cell: info => {
                    const value = info.getValue();
                    return (
                        <div style={{ 
                            backgroundColor: COLOR_SCHEMES.ALT_GRID_RANK,
                            padding: '8px',
                            margin: '-4px',
                            minHeight: '20px',
                            display: 'flex',
                            alignItems: 'center'
                        }}>
                            {value}
                        </div>
                    );
                },
                size: 80
            })
        );
    }

    return cols;
};

/**
 * Default table options
 */
export const getDefaultTableOptions = (data, columns, sorting, setSorting) => ({
    data,
    columns,
    state: {
        sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: require('@tanstack/react-table').getCoreRowModel(),
    getSortedRowModel: require('@tanstack/react-table').getSortedRowModel(),
});

/**
 * Table styles
 */
export const TABLE_STYLES = {
    table: {
        width: '100%',
        borderCollapse: 'collapse'
    },
    headerCell: {
        border: '1px solid #ccc',
        padding: '8px',
        backgroundColor: '#f5f5f5',
        cursor: 'pointer',
        userSelect: 'none'
    },
    bodyCell: {
        border: '1px solid #ccc',
        padding: '4px' // Reduced padding so cell content fills better
    },
    container: {
        overflowX: 'auto'
    }
};