/**
 * MVP COMPONENTS - Core Trading UI Components
 *
 * These are the shared components used across MVP pages.
 * All changes require high rigor and testing.
 *
 * TRADING PANELS (Large, specialized components):
 * - ConfigPanel: Trading configuration management
 * - StrategyValidatorPanel: Strategy backtesting and validation
 * - StrategyMonitorPanel: Real-time strategy performance
 * - TradingLogPanel: Trading activity logging
 * - RegimeConfigPanel: Market regime configuration
 *
 * MARKET DATA COMPONENTS:
 * - TradingViewChart: TradingView integration
 * - PortfolioPerformanceChart: Portfolio P&L visualization
 * - WatchlistCharts: Multi-asset watchlist
 * - CheddarFlowCard: CheddarFlow signal display
 * - MarketTideCard: Market sentiment
 * - TechnicalRegimeCard: Technical analysis
 *
 * CORE UI (Foundational building blocks):
 * - Button, Card, MetricCard, ErrorBoundary
 */

// Trading Panels
export { default as ConfigPanel } from '../Components/common/ConfigPanel';
export { default as StrategyValidatorPanel } from '../Components/common/StrategyValidatorPanel';
export { default as StrategyMonitorPanel } from '../Components/common/StrategyMonitorPanel';
export { default as TradingLogPanel } from '../Components/common/TradingLogPanel';
export { default as RegimeConfigPanel } from '../Components/common/RegimeConfigPanel';
export { default as LeveragedEtfPanel } from '../Components/common/LeveragedEtfPanel';

// Market Data Components
export { default as TradingViewChart } from '../Components/common/TradingViewChart';
export { default as PortfolioPerformanceChart } from '../Components/common/PortfolioPerformanceChart';
export { default as WatchlistCharts } from '../Components/common/WatchlistCharts';
export { default as CheddarFlowCard } from '../Components/common/CheddarFlowCard';
export { default as MarketTideCard } from '../Components/common/MarketTideCard';
export { default as TechnicalRegimeCard } from '../Components/common/TechnicalRegimeCard';

// Core UI Components
export { default as Button } from '../Components/common/Button';
export { default as Card } from '../Components/common/Card';
export { default as MetricCard } from '../Components/common/MetricCard';
export { default as ErrorBoundary } from '../Components/common/ErrorBoundary';
