/**
 * CENTRALIZED API CONFIGURATION
 *
 * Single place to configure which financial data API to use.
 * Switch between providers easily by changing the PRIMARY_PROVIDER.
 */

// Available API providers
export const API_PROVIDERS = {
  ALPHA_VANTAGE: 'alphavantage',
  POLYGON: 'polygon',
};

// ⚙️ CONFIGURATION - Change this to switch APIs
export const PRIMARY_PROVIDER = API_PROVIDERS.POLYGON;

// API provider configurations
export const PROVIDER_CONFIG = {
  [API_PROVIDERS.ALPHA_VANTAGE]: {
    name: 'Alpha Vantage',
    apiKey: process.env.REACT_APP_ALPHA_VANTAGE_API_KEY || '1KEVFA9KIQVOBJUE',
    dailyLimit: 500,
    rateLimit: '5 calls/minute',
    features: ['fundamentals', 'real-time', 'historical'],
    documentation: 'https://www.alphavantage.co/documentation/',
    signup: 'https://www.alphavantage.co/support/#api-key',
    cost: 'Free (500 calls/day)',
    batchDelay: 12000, // 12 seconds between requests
  },
  [API_PROVIDERS.POLYGON]: {
    name: 'Polygon.io',
    apiKey:
      process.env.REACT_APP_POLYGON_API_KEY ||
      'trJFATg2fiHoUCMN6DUY2ldhCqifQO8_',
    dailyLimit: 'unlimited',
    rateLimit: 'unlimited (paid subscription)',
    features: ['fundamentals', 'real-time', 'technical-indicators', 'options'],
    documentation: 'https://polygon.io/docs',
    signup: 'https://polygon.io/dashboard/signup',
    cost: '$99/month (unlimited)',
    batchDelay: 100, // Fast requests with paid subscription
  },
};

// Get current provider configuration
export const getCurrentProviderConfig = () => {
  return PROVIDER_CONFIG[PRIMARY_PROVIDER];
};

// Validate API key exists
export const validateApiKey = () => {
  const config = getCurrentProviderConfig();
  return (
    config.apiKey &&
    config.apiKey !== 'demo' &&
    !config.apiKey.includes('YOUR_API_KEY')
  );
};

// Get provider display name
export const getProviderDisplayName = () => {
  return getCurrentProviderConfig().name;
};
