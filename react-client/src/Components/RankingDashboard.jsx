/**
 * RANKING DASHBOARD - Clean stock ranking interface
 * 
 * Focused dashboard showing only the essential ranking functionality:
 * - Weight management for portfolio strategy
 * - Stock ranking table with conditional formatting
 * - Clean, distraction-free interface for analysis
 */

import React from 'react';
import WeightManager from './WeightManager';

const RankingDashboard = ({
  params,
  uiData,
  table,
  loading,
  currentStockList,
  debugMode,
  backgroundFetching,
  apiInfo,
  onWeightChange,
  onMultiplierClick,
  onResetWeights
}) => {
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '400px',
        color: '#6c757d'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>📊</div>
          <div style={{ fontSize: '16px', fontWeight: '500' }}>Loading stock data...</div>
          <div style={{ fontSize: '13px', marginTop: '8px' }}>
            Fetching {currentStockList.stocks.length} stocks from "{currentStockList.name}"
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Portfolio Weight Management */}
      <WeightManager
        params={params}
        onWeightChange={onWeightChange}
        onMultiplierClick={onMultiplierClick}
        onResetWeights={onResetWeights}
      />

      {/* Stock Ranking Table */}
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        border: '1px solid #e0e6ed',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        {/* Table Header Info */}
        <div style={{
          padding: '16px 20px',
          backgroundColor: '#f8f9fa',
          borderBottom: '1px solid #e0e6ed',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <span style={{ 
              fontWeight: '600', 
              fontSize: '15px',
              color: '#2c3e50'
            }}>
              Stock Rankings
            </span>
            <span style={{ 
              marginLeft: '12px',
              fontSize: '13px', 
              color: '#6c757d'
            }}>
              {table.getRowModel().rows.length} stocks from{' '}
              <strong style={{ color: currentStockList.color }}>
                {currentStockList.name}
              </strong>
            </span>
          </div>
          
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px',
            fontSize: '12px',
            color: '#6c757d'
          }}>
            <span>
              Mode: <strong>{debugMode ? 'Cache' : 'Live'}</strong>
            </span>
            {backgroundFetching && !debugMode && (
              <span style={{ color: '#007bff', fontWeight: '500' }}>
                🔄 Updating...
              </span>
            )}
            <span>
              API: <strong>{apiInfo.name}</strong>
            </span>
          </div>
        </div>

        {/* Ranking Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ 
            width: '100%', 
            borderCollapse: 'collapse',
            fontSize: '13px'
          }}>
            <thead>
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id} style={{ backgroundColor: '#fafbfc' }}>
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      style={{
                        border: '1px solid #e1e5e9',
                        padding: '12px 8px',
                        backgroundColor: '#fafbfc',
                        cursor: header.column.getCanSort() ? 'pointer' : 'default',
                        userSelect: 'none',
                        fontWeight: '600',
                        color: '#495057',
                        textAlign: 'left',
                        fontSize: '12px'
                      }}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {header.isPlaceholder ? null : (
                          <>
                            {header.column.columnDef.header}
                            {{
                              asc: ' ↑',
                              desc: ' ↓',
                            }[header.column.getIsSorted()] ?? null}
                          </>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row, index) => (
                <tr 
                  key={row.id}
                  style={{
                    backgroundColor: index % 2 === 0 ? '#ffffff' : '#fafbfc',
                    ':hover': { backgroundColor: '#f1f3f4' }
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      style={{
                        border: '1px solid #e1e5e9',
                        padding: '8px',
                        verticalAlign: 'middle'
                      }}
                    >
                      {cell.column.columnDef.cell(cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div style={{
          padding: '12px 20px',
          backgroundColor: '#f8f9fa',
          borderTop: '1px solid #e0e6ed',
          fontSize: '12px',
          color: '#6c757d',
          textAlign: 'center'
        }}>
          Powered by TanStack React Table • Data from {apiInfo.name} ({apiInfo.cost})
          {!debugMode && (
            <span style={{ color: '#28a745', marginLeft: '8px' }}>
              • Live data with smart caching
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default RankingDashboard;