/**
 * COLUMN VISIBILITY MANAGER
 * 
 * Provides easy controls to hide/show columns in the ranking table.
 * Includes search, categories, and bulk toggle functionality.
 */

import React, { useState, useMemo } from 'react';

const ColumnVisibilityManager = ({ params, columnVisibility, onVisibilityChange }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Categorize columns for better organization
  const columnCategories = useMemo(() => {
    const categories = {
      basic: { label: 'Basic Info', columns: ['rank', 'ticker', 'name', 'industry', 'price', 'yearHigh'] },
      value: { label: 'Value Metrics', columns: ['discount', 'peRatio', 'priceToBook', 'evEbitda'] },
      financial: { label: 'Financial Health', columns: ['debtEbitda', 'netDebt', 'quickRatio', 'cash', 'ebitda'] },
      profitability: { label: 'Profitability', columns: ['roe', 'freeCashFlowYield', 'dividend'] },
      risk: { label: 'Risk & Technical', columns: ['beta', 'rsi', 'impliedVolatility'] }
    };

    return categories;
  }, []);

  // Get available columns from params
  const availableColumns = useMemo(() => {
    return Object.keys(params).filter(key => 
      params[key].label && 
      key !== 'sum' && 
      key !== 'goodRank'
    );
  }, [params]);

  // Filter columns based on search and category
  const filteredColumns = useMemo(() => {
    let filtered = availableColumns;

    // Filter by category
    if (selectedCategory !== 'all') {
      const categoryColumns = columnCategories[selectedCategory]?.columns || [];
      filtered = filtered.filter(col => categoryColumns.includes(col));
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(col => {
        const label = params[col]?.label?.toLowerCase() || '';
        return label.includes(searchTerm.toLowerCase()) || 
               col.toLowerCase().includes(searchTerm.toLowerCase());
      });
    }

    return filtered;
  }, [availableColumns, selectedCategory, searchTerm, columnCategories, params]);

  const handleToggleColumn = (columnKey) => {
    // Don't allow hiding required columns
    const isRequired = columnKey === 'rank' || columnKey === 'ticker';
    if (isRequired && columnVisibility[columnKey] !== false) {
      return; // Don't hide required columns
    }
    
    const newVisibility = {
      ...columnVisibility,
      [columnKey]: !columnVisibility[columnKey]
    };
    onVisibilityChange(newVisibility);
  };

  const handleToggleCategory = (category) => {
    if (category === 'all') return;
    
    const categoryColumns = columnCategories[category]?.columns || [];
    const allVisible = categoryColumns.every(col => columnVisibility[col] !== false);
    
    const newVisibility = { ...columnVisibility };
    categoryColumns.forEach(col => {
      if (availableColumns.includes(col)) {
        newVisibility[col] = !allVisible;
      }
    });
    
    onVisibilityChange(newVisibility);
  };

  const handleShowAll = () => {
    const newVisibility = {};
    availableColumns.forEach(col => {
      newVisibility[col] = true;
    });
    onVisibilityChange(newVisibility);
  };

  const handleHideAll = () => {
    const newVisibility = {};
    availableColumns.forEach(col => {
      // Always keep rank and ticker visible
      newVisibility[col] = col === 'rank' || col === 'ticker';
    });
    onVisibilityChange(newVisibility);
  };

  const visibleCount = availableColumns.filter(col => columnVisibility[col] !== false).length;
  const totalCount = availableColumns.length;

  return (
    <div style={{ marginBottom: '16px' }}>
      {/* Compact Header */}
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        border: '1px solid #e0e6ed',
        padding: '12px 16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '16px' }}>👁️</span>
            <div>
              <span style={{ 
                fontWeight: '600', 
                fontSize: '14px',
                color: '#2c3e50'
              }}>
                Column Visibility
              </span>
              <span style={{ 
                marginLeft: '8px',
                fontSize: '12px', 
                color: '#6c757d'
              }}>
                {visibleCount}/{totalCount} visible
              </span>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleShowAll}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Show All
            </button>
            <button
              onClick={handleHideAll}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Hide All
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              {isExpanded ? '−' : '+'}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Controls */}
      {isExpanded && (
        <div style={{
          marginTop: '8px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          {/* Search and Category Filter */}
          <div style={{ 
            display: 'flex', 
            gap: '12px', 
            marginBottom: '16px',
            flexWrap: 'wrap'
          }}>
            <input
              type="text"
              placeholder="Search columns..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                flex: 1,
                minWidth: '200px',
                padding: '6px 10px',
                border: '1px solid #ced4da',
                borderRadius: '4px',
                fontSize: '13px'
              }}
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{
                padding: '6px 10px',
                border: '1px solid #ced4da',
                borderRadius: '4px',
                fontSize: '13px',
                minWidth: '120px'
              }}
            >
              <option value="all">All Categories</option>
              {Object.entries(columnCategories).map(([key, category]) => (
                <option key={key} value={key}>{category.label}</option>
              ))}
            </select>
          </div>

          {/* Category Toggle Buttons */}
          {selectedCategory === 'all' && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: '600', 
                color: '#495057',
                marginBottom: '8px'
              }}>
                Toggle by Category:
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {Object.entries(columnCategories).map(([key, category]) => {
                  const categoryColumns = category.columns.filter(col => availableColumns.includes(col));
                  const allVisible = categoryColumns.every(col => columnVisibility[col] !== false);
                  
                  return (
                    <button
                      key={key}
                      onClick={() => handleToggleCategory(key)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        backgroundColor: allVisible ? '#e8f5e8' : '#f8f9fa',
                        color: allVisible ? '#2d7d2d' : '#6c757d',
                        border: '1px solid #dee2e6',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      {category.label} ({categoryColumns.length})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Column Toggle Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '8px'
          }}>
            {filteredColumns.map(columnKey => {
              const param = params[columnKey];
              const isVisible = columnVisibility[columnKey] !== false;
              const isRequired = columnKey === 'rank' || columnKey === 'ticker';
              
              return (
                <label
                  key={columnKey}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 8px',
                    backgroundColor: isVisible ? '#f8fff8' : '#f8f9fa',
                    border: '1px solid #e9ecef',
                    borderRadius: '4px',
                    cursor: isRequired ? 'not-allowed' : 'pointer',
                    opacity: isRequired ? 0.6 : 1,
                    fontSize: '12px'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => !isRequired && handleToggleColumn(columnKey)}
                    disabled={isRequired}
                    style={{ margin: 0 }}
                  />
                  <span style={{ 
                    fontWeight: isVisible ? '500' : '400',
                    color: isVisible ? '#2c3e50' : '#6c757d'
                  }}>
                    {param.label}
                  </span>
                  {isRequired && (
                    <span style={{ 
                      fontSize: '10px', 
                      color: '#6c757d',
                      fontStyle: 'italic'
                    }}>
                      (required)
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {filteredColumns.length === 0 && (
            <div style={{ 
              textAlign: 'center', 
              color: '#6c757d', 
              fontStyle: 'italic',
              padding: '20px'
            }}>
              No columns match your search criteria
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ColumnVisibilityManager;