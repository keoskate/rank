/**
 * MODERN STONK BOARD (REFACTORED) - Modular Stock Ranking Component
 *
 * This is the REFACTORED version of the stock analysis and ranking component.
 *
 * MODULAR ARCHITECTURE:
 * - Custom hooks for data management and ranking logic
 * - Separated utility modules for algorithms and calculations
 * - Reusable UI components
 * - Centralized configuration
 * - Improved maintainability and testability
 *
 * KEY IMPROVEMENTS:
 * - Separation of concerns
 * - Easier testing and debugging
 * - Reusable components and utilities
 * - Cleaner code organization
 * - Better performance optimization
 *
 * DATA FLOW:
 * Stock Config → Data Hook → Ranking Hook → UI Components → Table Display
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table';

// Custom hooks
import { useStockData } from '../hooks/useStockData';
import { useRanking } from '../hooks/useRanking';

// Utility modules
import { getCellStyle } from '../utils/colorUtils';
import { createTableColumns, TABLE_STYLES } from '../utils/tableConfig';

// Components
import BoardControls from '../components/BoardControls';

// Configuration
import { getStockConfig } from '../config/stockConfig';
import * as Utils from './StockUtils';

function ModernStonkBoardRefactored() {
  // Get configuration
  const config = getStockConfig(process.env.NODE_ENV);

  // Data management hook
  const { data, loading, error, initializeData, setData } = useStockData(
    config.ACTIVE_STOCKS,
    config.DEBUG_MODE
  );

  // Ranking management hook
  const {
    params,
    rGrid,
    sGrid,
    currentView,
    altGrid,
    setupDataStructures,
    handleWeightChange,
    handleMultiplierClick,
    handleFullDataScoreboard,
    handleRelativeScoreboard,
    handleStdScoreboard,
    sumOfWeights,
  } = useRanking(Utils.STOCK_COLUMNS);

  // UI state
  const [uiData, setUiData] = useState([]);
  const [sorting, setSorting] = useState([{ id: 'rank', desc: false }]);

  /**
   * Initialize data on component mount
   */
  useEffect(() => {
    const initialize = async () => {
      await initializeData(
        params,
        config.LOADING.INITIAL_BATCH_SIZE,
        config.LOADING.FETCH_FINANCIALS
      );
    };
    initialize();
  }, [
    initializeData,
    params,
    config.LOADING.INITIAL_BATCH_SIZE,
    config.LOADING.FETCH_FINANCIALS,
  ]);

  /**
   * Recalculate rankings when params change
   */
  useEffect(() => {
    if (data.length > 0) {
      setupDataStructures(data);
    }
  }, [params, setupDataStructures, data]);

  /**
   * Update uiData when grids change based on current view
   */
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

  /**
   * Memoized cell style function
   */
  const getCellStyleMemo = useCallback(
    (col, value) => {
      return getCellStyle(col, value, params);
    },
    [params]
  );

  /**
   * Memoized table columns
   */
  const columns = useMemo(() => {
    return createTableColumns(params, altGrid, getCellStyleMemo);
  }, [params, altGrid, getCellStyleMemo]);

  /**
   * Create table instance
   */
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

  // Error handling
  if (error) {
    return (
      <div style={{ padding: '20px', color: '#dc3545' }}>
        <h3>Error Loading Stock Data</h3>
        <p>{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 16px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          fontSize: '18px',
          color: '#6c757d',
        }}
      >
        <div>📈 Loading stock data...</div>
        <div style={{ fontSize: '14px', marginTop: '10px' }}>
          {config.DEBUG_MODE
            ? 'Using cached data'
            : 'Fetching live data from API'}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Board Controls */}
      <BoardControls
        params={params}
        sumOfWeights={sumOfWeights()}
        onWeightChange={handleWeightChange}
        onMultiplierClick={handleMultiplierClick}
        onFullDataScoreboard={handleFullDataScoreboard}
        onRelativeScoreboard={handleRelativeScoreboard}
        onStdScoreboard={handleStdScoreboard}
      />

      {/* Data Table */}
      <div style={TABLE_STYLES.container}>
        <table style={TABLE_STYLES.table}>
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    style={{
                      ...TABLE_STYLES.headerCell,
                      cursor: header.column.getCanSort()
                        ? 'pointer'
                        : 'default',
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
                  <td key={cell.id} style={TABLE_STYLES.bodyCell}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer Information */}
      <div style={{ marginTop: 20, fontSize: '12px', color: '#666' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            Showing {table.getRowModel().rows.length} stocks • Current view:{' '}
            <strong>{currentView}</strong> • Mode:{' '}
            <strong>{config.DEBUG_MODE ? 'Debug' : 'Live'}</strong>
          </div>
          <div>
            Powered by TanStack React Table • React 18 + Modular Architecture
          </div>
        </div>
        <div style={{ marginTop: '5px', fontSize: '11px', color: '#999' }}>
          Rankings calculated using dual algorithms: relative position +
          statistical deviation analysis
        </div>
      </div>
    </div>
  );
}

export default ModernStonkBoardRefactored;
