/**
 * COLOR UTILITIES - Conditional cell coloring based on statistical analysis
 * 
 * This module handles the complex conditional coloring logic that provides
 * visual feedback about stock performance. Colors are based on how many
 * standard deviations each value is from the mean.
 * 
 * COLOR SCHEME:
 * - Green shades: Good values (above average in positive direction)
 * - Red shades: Poor values (below average or in negative direction)
 * - Light colors: Values close to average
 * - White: Disabled columns (weight = 0)
 * 
 * KEY FEATURES:
 * - Statistical-based coloring
 * - Multiplier-aware (handles inverse relationships)
 * - Weight-sensitive (disabled columns are white)
 * - Performance optimized
 */

/**
 * CONDITIONAL COLOR CALCULATION - Statistical-based cell coloring
 * 
 * Colors cells based on how many standard deviations they are from the mean:
 * - Green shades: Good values (2+ std dev in positive direction)
 * - Red shades: Poor values (2+ std dev in negative direction)
 * - Light colors: Values close to average
 */
export const getConditionalColor = (col, value, paramConfig) => {
    const weight = paramConfig[col]?.weight || 0;
    const avg = paramConfig[col]?.average;
    const std = paramConfig[col]?.stdDev;
    const mult = paramConfig[col]?.multiplier === 1;

    if (avg === undefined || std === undefined) {
        return '#ffffff'; // White if no stats available
    }

    if (weight === 0) {
        return '#ffffff'; // White if weight is 0
    } 
    
    // Best values (2+ standard deviations in good direction)
    else if ((((avg - 2 * std) >= value) && !mult) ||
             (((avg + 2 * std) <= value) && mult)) {
        return '#67c279'; // Bright green
    }
    
    // Very good values (1.5-2 std dev)
    else if ((((avg - 1.5 * std) >= value) && (value >= (avg - 2 * std)) && !mult) ||
             (((avg + 1.5 * std) <= value) && (value <= (avg + 2 * std)) && mult)) {
        return '#a5d3a5'; // Green
    }
    
    // Good values (1-1.5 std dev)
    else if ((((avg - 1 * std) >= value) && (value >= (avg - 1.5 * std)) && !mult) ||
             (((avg + 1 * std) <= value) && (value <= (avg + 1.5 * std)) && mult)) {
        return '#b1e1b0'; // Light green
    }
    
    // Slightly good values (0.5-1 std dev)
    else if ((((avg - 0.5 * std) >= value) && (value >= (avg - 1 * std)) && !mult) ||
             (((avg + 0.5 * std) <= value) && (value <= (avg + 1 * std)) && mult)) {
        return '#c5f1c6'; // Very light green
    }
    
    // Near average (good direction)
    else if (((avg >= value) && (value >= (avg - 0.5 * std)) && !mult) ||
             ((avg <= value) && (value <= (avg + 0.5 * std)) && mult)) {
        return '#e7f6e5'; // Pale green
    }
    
    // Near average (poor direction) 
    else if (((avg >= value) && (value >= (avg - 0.5 * std)) && mult) ||
             ((avg <= value) && (value <= (avg + 0.5 * std)) && !mult)) {
        return '#fff3f3'; // Pale red
    }
    
    // Slightly poor values (0.5-1 std dev)
    else if (((avg - 0.5 * std >= value) && (value >= (avg - 1 * std)) && mult) ||
             ((avg + 0.5 * std <= value) && (value <= (avg + 1 * std)) && !mult)) {
        return '#ffe1e1'; // Very light red
    }
    
    // Poor values (1-1.5 std dev)
    else if (((avg - 1 * std >= value) && (value >= (avg - 1.5 * std)) && mult) ||
             ((avg + 1 * std <= value) && (value <= (avg + 1.5 * std)) && !mult)) {
        return '#fdc2c2'; // Light red
    }
    
    // Very poor values (1.5-2 std dev)
    else if (((avg - 1.5 * std >= value) && (value >= (avg - 2 * std)) && mult) ||
             ((avg + 1.5 * std <= value) && (value <= (avg + 2 * std)) && !mult)) {
        return '#fda4a4'; // Red
    }
    
    // Worst values (2+ standard deviations in poor direction)
    else if (((value < (avg - 2 * std)) && mult) ||
             ((value > (avg + 2 * std)) && !mult)) {
        return '#fd7979'; // Bright red
    }
    
    return '#ffffff'; // Default white
};

/**
 * Get cell style object for TanStack Table
 */
export const getCellStyle = (col, value, params) => {
    const color = getConditionalColor(col, value, params);
    return { 
        backgroundColor: color,
        padding: '8px',
        margin: '-4px', // Negative margin to fill the cell
        minHeight: '20px',
        display: 'flex',
        alignItems: 'center'
    };
};

/**
 * Color scheme definitions for reference
 */
export const COLOR_SCHEMES = {
    EXCELLENT: '#67c279',    // Bright green
    VERY_GOOD: '#a5d3a5',   // Green  
    GOOD: '#b1e1b0',        // Light green
    SLIGHTLY_GOOD: '#c5f1c6', // Very light green
    AVERAGE_GOOD: '#e7f6e5', // Pale green
    AVERAGE_POOR: '#fff3f3', // Pale red
    SLIGHTLY_POOR: '#ffe1e1', // Very light red
    POOR: '#fdc2c2',        // Light red
    VERY_POOR: '#fda4a4',   // Red
    TERRIBLE: '#fd7979',    // Bright red
    DISABLED: '#ffffff',    // White
    ALT_GRID_SUM: '#f8f9fa', // Light gray for sum column
    ALT_GRID_RANK: '#e9ecef' // Slightly darker gray for rank column
};