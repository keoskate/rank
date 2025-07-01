# Modular Architecture Documentation

## Overview

The stock ranking application has been refactored into a modular architecture to improve maintainability, testability, and prepare for major API and functionality changes. This document outlines the new structure and how to work with it.

## Architecture Benefits

- **Separation of Concerns**: Each module has a single responsibility
- **Easier Testing**: Pure functions and isolated logic
- **Better Maintainability**: Changes are localized to specific modules
- **Reusability**: Components and utilities can be shared
- **Future-Proof**: Easy to swap implementations for major refactors

## Module Structure

### 1. Custom Hooks (`/src/hooks/`)

#### `useStockData.js`
- **Purpose**: Manages all stock data fetching and state
- **Key Features**:
  - Progressive data loading (prevents API rate limiting)
  - Debug mode support (cached vs live data)
  - Error handling and loading states
  - Data cleaning and normalization

```javascript
const { data, loading, error, initializeData } = useStockData(stockConfig, debugMode);
```

#### `useRanking.js`
- **Purpose**: Manages ranking calculations and parameters
- **Key Features**:
  - Dual ranking algorithm coordination
  - Parameter state management
  - Weight and multiplier controls
  - View switching logic

```javascript
const { 
  params, rGrid, sGrid, 
  handleWeightChange, setupDataStructures 
} = useRanking(initialParams);
```

### 2. Utility Modules (`/src/utils/`)

#### `rankingAlgorithms.js`
- **Purpose**: Core ranking calculation algorithms
- **Key Functions**:
  - `rankCols()` - Relative position ranking
  - `rankColsStd()` - Statistical deviation ranking  
  - `calculateRank()` - Combined final ranking
  - `initGrid()` - Grid initialization

#### `mathUtils.js`
- **Purpose**: Statistical calculations and data processing
- **Key Functions**:
  - `getColAverage()` - Column averages
  - `getColStandardDeviation()` - Standard deviations
  - `formatNumberWithCommas()` - Number formatting
  - `getStatisticalRanges()` - Color range calculations

#### `colorUtils.js`
- **Purpose**: Conditional cell coloring logic
- **Key Functions**:
  - `getConditionalColor()` - Statistical color mapping
  - `getCellStyle()` - TanStack table cell styling
  - `COLOR_SCHEMES` - Predefined color constants

#### `tableConfig.js`
- **Purpose**: TanStack React Table configuration
- **Key Functions**:
  - `createTableColumns()` - Dynamic column generation
  - `getDefaultTableOptions()` - Table setup
  - `TABLE_STYLES` - Consistent styling

### 3. Components (`/src/components/`)

#### `BoardControls.jsx`
- **Purpose**: UI controls for weights and board switching
- **Features**:
  - Weight sliders with validation
  - Multiplier toggle buttons
  - Board view switching buttons
  - Visual feedback for weight limits

### 4. Configuration (`/src/config/`)

#### `stockConfig.js`
- **Purpose**: Centralized stock data and app configuration
- **Key Features**:
  - Predefined stock groups (COVID, KEO, MEME, etc.)
  - Custom stock combinations
  - Environment-specific configurations
  - Debug mode and throttling settings

```javascript
const config = getStockConfig(process.env.NODE_ENV);
// Returns appropriate config for development/staging/production
```

## Migration Guide

### Original vs Refactored

| Original | Refactored | Benefit |
|----------|------------|---------|
| Single 740-line component | Multiple focused modules | Easier to understand and modify |
| Mixed data/UI/logic | Separated concerns | Testable units |
| Hardcoded configurations | Centralized config | Easy environment switching |
| Inline calculations | Pure utility functions | Reusable and testable |
| Monolithic rendering | Composed components | Better performance and reuse |

### How to Use the Refactored Version

1. **Replace the import in HomePage.jsx**:
```javascript
// Old
import ModernStonkBoard from './ModernStonkBoard';

// New  
import ModernStonkBoardRefactored from './ModernStonkBoardRefactored';
```

2. **Update the component usage**:
```javascript
// In HomePage.jsx
{currentBoard === 'stock' ? (
    <ModernStonkBoardRefactored />
) : (
    // CEF component
)}
```

## Testing Strategy

### Unit Testing
- **Utilities**: Test pure functions in isolation
- **Hooks**: Test with React Testing Library
- **Components**: Test UI behavior and props

### Integration Testing
- **Data Flow**: Test hook interactions
- **API Integration**: Test with mock data
- **User Interactions**: Test complete workflows

### Example Test Structure:
```
__tests__/
├── utils/
│   ├── rankingAlgorithms.test.js
│   ├── mathUtils.test.js
│   └── colorUtils.test.js
├── hooks/
│   ├── useStockData.test.js
│   └── useRanking.test.js
└── components/
    ├── BoardControls.test.js
    └── ModernStonkBoardRefactored.test.js
```

## Performance Optimizations

### Implemented
- **useMemo**: Table columns and computed values
- **useCallback**: Event handlers and functions
- **Pure Functions**: Utilities for better memoization
- **Component Splitting**: Smaller re-render scope

### Future Opportunities
- **React.memo**: Wrap pure components
- **Virtualization**: For large data sets
- **Code Splitting**: Lazy load modules
- **Worker Threads**: Heavy calculations

## Future Refactoring Preparation

### API Changes
- All API logic is isolated in `useStockData` hook
- Swap the hook implementation without touching UI
- Configuration-driven API endpoints

### Algorithm Changes  
- Ranking algorithms are in separate modules
- Add new algorithms by implementing the same interface
- A/B testing different ranking approaches

### UI Changes
- Components are decoupled from business logic
- Table configuration is externalized
- Easy to switch table libraries or add new visualizations

### Data Source Changes
- Stock configuration is centralized
- Easy to add new data sources or stock groups
- Environment-specific configurations

## Best Practices

### Adding New Features
1. **Identify the module**: Determine where the change belongs
2. **Create utilities first**: Build reusable functions
3. **Add hook if needed**: For stateful logic
4. **Update components last**: Use the new utilities/hooks
5. **Update configuration**: Add any new settings

### Modifying Existing Features
1. **Find the responsible module**: Use the module map above
2. **Update tests first**: Ensure you understand current behavior
3. **Make changes incrementally**: Small, focused changes
4. **Verify integration**: Test the complete flow

### Code Organization Rules
- **One responsibility per module**: Don't mix concerns
- **Pure functions when possible**: Easier to test and debug
- **Clear naming**: Function and variable names should be descriptive
- **Consistent patterns**: Follow established conventions

## Migration Checklist

- [x] Create custom hooks for data and ranking
- [x] Extract algorithms into utilities  
- [x] Create reusable UI components
- [x] Centralize configuration
- [x] Build refactored main component
- [ ] Update HomePage to use refactored component
- [ ] Add comprehensive tests
- [ ] Performance benchmark comparison
- [ ] Remove original component after validation

## Next Steps

1. **Test the refactored component thoroughly**
2. **Switch HomePage to use the new component**
3. **Add unit tests for all modules** 
4. **Performance comparison with original**
5. **Remove ModernStonkBoard.jsx after validation**
6. **Add more stock groups and configurations**
7. **Implement new features using modular approach**