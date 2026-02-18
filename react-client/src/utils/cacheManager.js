/**
 * SMART CACHE MANAGER - Dynamic API Data Caching
 *
 * This module provides intelligent caching for API data with validation and refresh logic.
 * Perfect for development workflow - fetch once, use cached data for debugging.
 *
 * KEY FEATURES:
 * - Saves fresh API data to localStorage/memory
 * - Validates data quality before caching
 * - Automatic cache expiration
 * - Easy cache refresh and management
 * - Seamless debug mode integration
 */

const CACHE_PREFIX = 'stonks_cache_';
const CACHE_VERSION = '1.0';

/**
 * Cache configuration
 */
const CACHE_CONFIG = {
  maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  minValidStocks: 3, // Minimum number of stocks to consider cache valid
  requiredFields: ['ticker', 'price', 'name'], // Required fields for validation
  maxCacheSize: 10 * 1024 * 1024, // 10MB max cache size
};

/**
 * Cache a dataset with validation and metadata
 *
 * @param {string} key - Cache key (e.g., 'TEST_STOCKS', 'COVID_19')
 * @param {Array} data - Stock data array to cache
 * @param {Object} metadata - Additional metadata
 * @returns {boolean} True if successfully cached
 */
export function cacheStockData(key, data, metadata = {}) {
  try {
    console.info(`💾 Attempting to cache ${key} with ${data.length} stocks...`);

    // Validate data quality before caching
    if (!validateStockData(data)) {
      console.warn(`❌ Cache validation failed for ${key} - data not cached`);
      return false;
    }

    const cacheEntry = {
      version: CACHE_VERSION,
      key,
      data,
      metadata: {
        ...metadata,
        cachedAt: Date.now(),
        dataCount: data.length,
        source: metadata.source || 'api',
        provider: metadata.provider || 'unknown',
      },
      expiresAt: Date.now() + CACHE_CONFIG.maxAge,
    };

    const cacheKey = CACHE_PREFIX + key;
    const serialized = JSON.stringify(cacheEntry);

    // Check cache size
    if (serialized.length > CACHE_CONFIG.maxCacheSize) {
      console.warn(
        `❌ Cache entry too large for ${key} (${serialized.length} bytes)`
      );
      return false;
    }

    localStorage.setItem(cacheKey, serialized);
    console.info(
      `✅ Successfully cached ${key}: ${data.length} stocks, expires in ${formatDuration(CACHE_CONFIG.maxAge)}`
    );

    return true;
  } catch (error) {
    console.error(`❌ Failed to cache ${key}:`, error);
    return false;
  }
}

/**
 * Retrieve cached stock data with validation
 *
 * @param {string} key - Cache key
 * @returns {Array|null} Cached stock data or null if invalid/expired
 */
export function getCachedStockData(key) {
  try {
    const cacheKey = CACHE_PREFIX + key;
    const cached = localStorage.getItem(cacheKey);

    if (!cached) {
      console.info(`📭 No cache found for ${key}`);
      return null;
    }

    const cacheEntry = JSON.parse(cached);

    // Check cache version
    if (cacheEntry.version !== CACHE_VERSION) {
      console.warn(`🔄 Cache version mismatch for ${key}, clearing...`);
      clearCache(key);
      return null;
    }

    // Check expiration
    if (Date.now() > cacheEntry.expiresAt) {
      console.info(`⏰ Cache expired for ${key}, clearing...`);
      clearCache(key);
      return null;
    }

    // Validate cached data
    if (!validateStockData(cacheEntry.data)) {
      console.warn(`❌ Cached data invalid for ${key}, clearing...`);
      clearCache(key);
      return null;
    }

    const age = Date.now() - cacheEntry.metadata.cachedAt;
    console.info(
      `📦 Using cached ${key}: ${cacheEntry.data.length} stocks, age: ${formatDuration(age)}`
    );

    return cacheEntry.data;
  } catch (error) {
    console.error(`❌ Failed to retrieve cache for ${key}:`, error);
    clearCache(key); // Clear corrupted cache
    return null;
  }
}

/**
 * Get cache metadata and status
 *
 * @param {string} key - Cache key
 * @returns {Object|null} Cache metadata or null
 */
export function getCacheInfo(key) {
  try {
    const cacheKey = CACHE_PREFIX + key;
    const cached = localStorage.getItem(cacheKey);

    if (!cached) {
      return null;
    }

    const cacheEntry = JSON.parse(cached);
    const age = Date.now() - cacheEntry.metadata.cachedAt;
    const timeToExpiry = cacheEntry.expiresAt - Date.now();

    return {
      ...cacheEntry.metadata,
      age,
      timeToExpiry,
      isExpired: timeToExpiry <= 0,
      isValid: validateStockData(cacheEntry.data),
      size: cached.length,
    };
  } catch (error) {
    console.error(`❌ Failed to get cache info for ${key}:`, error);
    return null;
  }
}

/**
 * Clear specific cache entry
 *
 * @param {string} key - Cache key to clear
 */
export function clearCache(key) {
  const cacheKey = CACHE_PREFIX + key;
  localStorage.removeItem(cacheKey);
  console.info(`🗑️ Cleared cache for ${key}`);
}

/**
 * Clear all cache entries
 */
export function clearAllCache() {
  const keys = Object.keys(localStorage).filter(key =>
    key.startsWith(CACHE_PREFIX)
  );
  keys.forEach(key => localStorage.removeItem(key));
  console.info(`🗑️ Cleared ${keys.length} cache entries`);
}

/**
 * Get all cache keys and their info
 *
 * @returns {Object} Map of cache keys to their info
 */
export function getAllCacheInfo() {
  const keys = Object.keys(localStorage)
    .filter(key => key.startsWith(CACHE_PREFIX))
    .map(key => key.replace(CACHE_PREFIX, ''));

  const info = {};
  keys.forEach(key => {
    info[key] = getCacheInfo(key);
  });

  return info;
}

/**
 * Validate stock data quality
 *
 * @param {Array} data - Stock data array
 * @returns {boolean} True if data is valid for caching
 */
function validateStockData(data) {
  if (!Array.isArray(data)) {
    console.warn('❌ Data is not an array');
    return false;
  }

  if (data.length < CACHE_CONFIG.minValidStocks) {
    console.warn(
      `❌ Insufficient stocks: ${data.length} < ${CACHE_CONFIG.minValidStocks}`
    );
    return false;
  }

  // Check if at least 80% of stocks have required fields
  const validStocks = data.filter(stock => {
    return CACHE_CONFIG.requiredFields.every(
      field => stock && typeof stock === 'object' && stock[field] != null
    );
  });

  const validPercentage = validStocks.length / data.length;

  if (validPercentage < 0.8) {
    console.warn(
      `❌ Too many invalid stocks: ${validStocks.length}/${data.length} (${Math.round(validPercentage * 100)}%)`
    );
    return false;
  }

  console.info(
    `✅ Data validation passed: ${validStocks.length}/${data.length} valid stocks`
  );
  return true;
}

/**
 * Format duration in human-readable format
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${Math.floor(ms / 1000)}s`;
  }
}

/**
 * Smart cache-or-fetch function
 * Tries cache first, fetches if needed, caches good results
 *
 * @param {string} cacheKey - Cache key
 * @param {Function} fetchFunction - Function that returns Promise<Array>
 * @param {Object} options - Options
 * @returns {Promise<Array>} Stock data
 */
export async function cacheOrFetch(cacheKey, fetchFunction, options = {}) {
  const { forceRefresh = false, provider = 'api' } = options;

  // Try cache first (unless forcing refresh)
  if (!forceRefresh) {
    const cached = getCachedStockData(cacheKey);
    if (cached) {
      return cached;
    }
  }

  console.info(`🌐 Fetching fresh data for ${cacheKey}...`);

  try {
    // Fetch fresh data
    const freshData = await fetchFunction();

    // Cache if data is good
    if (validateStockData(freshData)) {
      cacheStockData(cacheKey, freshData, {
        source: 'api',
        provider,
        fetchedAt: Date.now(),
      });
    }

    return freshData;
  } catch (error) {
    console.error(`❌ Fetch failed for ${cacheKey}:`, error);

    // Try to return stale cache as fallback
    const staleCache = localStorage.getItem(CACHE_PREFIX + cacheKey);
    if (staleCache) {
      try {
        const cacheEntry = JSON.parse(staleCache);
        console.warn(
          `⚠️ Using stale cache for ${cacheKey} due to fetch failure`
        );
        return cacheEntry.data;
      } catch (parseError) {
        console.error('❌ Stale cache also corrupted');
      }
    }

    throw error;
  }
}

/**
 * Advanced cache-with-background-refresh function
 * Returns cached data immediately, then updates with fresh data in background
 *
 * @param {string} cacheKey - Cache key
 * @param {Function} fetchFunction - Function that returns Promise<Array>
 * @param {Function} updateCallback - Called when fresh data is available
 * @param {Object} options - Options
 * @returns {Promise<Array>} Cached data (immediate) or fresh data (if no cache)
 */
export async function cacheWithBackgroundRefresh(
  cacheKey,
  fetchFunction,
  updateCallback,
  options = {}
) {
  const {
    maxAge = CACHE_CONFIG.maxAge,
    provider = 'api',
    forceRefresh = false,
  } = options;

  // Get cached data immediately
  const cached = getCachedStockData(cacheKey);
  let shouldFetchFresh = forceRefresh || !cached;

  // Check if cache is getting stale (more than 30 minutes old)
  if (cached && !forceRefresh) {
    try {
      const cacheEntry = JSON.parse(
        localStorage.getItem(CACHE_PREFIX + cacheKey)
      );
      const age = Date.now() - cacheEntry.metadata.cachedAt;
      const isStale = age > 30 * 60 * 1000; // 30 minutes

      if (isStale) {
        console.info(
          `🔄 Cache is ${Math.round(age / 60000)} minutes old, refreshing in background...`
        );
        shouldFetchFresh = true;
      }
    } catch (error) {
      shouldFetchFresh = true;
    }
  }

  // Start background fetch if needed
  if (shouldFetchFresh) {
    console.info(`🌐 Starting background fetch for ${cacheKey}...`);

    // Don't await - run in background
    fetchFunction()
      .then(freshData => {
        if (validateStockData(freshData)) {
          console.info(
            `✅ Background fetch complete for ${cacheKey}, updating cache...`
          );

          // Update cache
          cacheStockData(cacheKey, freshData, {
            source: 'api',
            provider,
            fetchedAt: Date.now(),
          });

          // Notify callback with fresh data
          if (updateCallback) {
            updateCallback(freshData);
          }
        }
      })
      .catch(error => {
        console.error(`❌ Background fetch failed for ${cacheKey}:`, error);
      });
  }

  // Return cached data immediately (if available) or wait for fresh data
  if (cached && !forceRefresh) {
    console.info(`📦 Returning cached data for ${cacheKey} immediately`);
    return cached;
  } else {
    console.info(`⏳ No cache available, waiting for fresh data...`);
    return await fetchFunction();
  }
}
