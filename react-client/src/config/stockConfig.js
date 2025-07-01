/**
 * STOCK CONFIGURATION - Centralized stock data and app configuration
 * 
 * This module centralizes all stock group definitions, debug settings,
 * and throttling configurations. This makes it easy to modify stock
 * groups or switch between different data sets without touching the
 * main application logic.
 * 
 * KEY FEATURES:
 * - Predefined stock groups
 * - Custom stock combinations
 * - Debug mode configuration
 * - API throttling settings
 * - Easy switching between stock sets
 */

import * as cachedData20 from '../stock-data_20';

// Stock group configurations - each has [symbols, cached_data]
export const STOCK_GROUPS = {
    COVID: [cachedData20.COVID_19, cachedData20.COVID_19_cached],
    KEO: [cachedData20.KEO_STOCKS, cachedData20.KEO_STOCKS_cached],
    NEW: [cachedData20.NEW_STOCKS, cachedData20.NEW_STOCKS_cached],
    GROUP: [cachedData20.GROUP_STOCKS, cachedData20.GROUP_STOCKS_cached],
    MEME: [cachedData20.MEME_STOCKS, cachedData20.MEME_STOCKS_cached],
    ALL: [cachedData20.ALL_STOCKS, cachedData20.ALL_STOCKS_cached]
};

// Custom stock combinations (without duplicates)
export const CUSTOM_COMBINATIONS = {
    COVID_FOCUS: [
        ...cachedData20.COVID_19,
        // Add other groups as needed
    ],
    DIVERSIFIED: [
        ...cachedData20.COVID_19,
        ...cachedData20.KEO_STOCKS,
        ...cachedData20.MEME_STOCKS,
    ],
    GROWTH_FOCUSED: [
        ...cachedData20.NEW_STOCKS,
        ...cachedData20.GROUP_STOCKS,
    ]
};

// Test stocks configuration
export const TEST_STOCKS = [
    [...new Set(CUSTOM_COMBINATIONS.COVID_FOCUS)], 
    [...cachedData20.TEST_STOCKS_cached]
];

// Application configuration
export const APP_CONFIG = {
    // Current active stock configuration
    ACTIVE_STOCKS: TEST_STOCKS,
    
    // Debug mode - if true, uses cached data to preserve API quota
    DEBUG_MODE: true,
    
    // API throttling settings (milliseconds)
    THROTTLE: {
        SMALL: 100,
        MEDIUM: 500,
        LARGE: 1000,
    },
    
    // Data loading settings
    LOADING: {
        INITIAL_BATCH_SIZE: 5,  // Number of stocks to load initially
        FETCH_FINANCIALS: false, // Whether to fetch additional financial data
    }
};

// Environment-specific configurations
export const getStockConfig = (environment = 'development') => {
    const configs = {
        development: {
            ...APP_CONFIG,
            DEBUG_MODE: true,
            ACTIVE_STOCKS: TEST_STOCKS
        },
        staging: {
            ...APP_CONFIG,
            DEBUG_MODE: true,
            ACTIVE_STOCKS: STOCK_GROUPS.KEO
        },
        production: {
            ...APP_CONFIG,
            DEBUG_MODE: false,
            ACTIVE_STOCKS: STOCK_GROUPS.ALL
        }
    };
    
    return configs[environment] || configs.development;
};

// Helper functions for stock management
export const getAvailableStockGroups = () => {
    return Object.keys(STOCK_GROUPS);
};

export const getStockGroupByName = (name) => {
    return STOCK_GROUPS[name.toUpperCase()];
};

export const createCustomStockGroup = (groupNames) => {
    const symbols = [];
    const cachedData = [];
    
    groupNames.forEach(name => {
        const group = getStockGroupByName(name);
        if (group) {
            symbols.push(...group[0]);
            cachedData.push(...group[1]);
        }
    });
    
    return [
        [...new Set(symbols)], // Remove duplicates
        cachedData
    ];
};