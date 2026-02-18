/**
 * COMMON COMPONENTS - Barrel Export
 *
 * Import components by name without specifying path:
 * import { Button, Card, MetricCard } from './common';
 */

// Core UI Components
export { default as Button } from './Button';
export { default as Card } from './Card';
export { default as MetricCard } from './MetricCard';
export { default as ErrorBoundary } from './ErrorBoundary';

// Trading & Analysis Cards
export { default as CheddarFlowCard } from './CheddarFlowCard';
export { default as TechnicalRegimeCard } from './TechnicalRegimeCard';
export { default as MarketTideCard } from './MarketTideCard';

// Trading Panels
export { default as ConfigPanel } from './ConfigPanel';
export { default as TradingLogPanel } from './TradingLogPanel';
export { default as StrategyMonitorPanel } from './StrategyMonitorPanel';
export { default as StrategyValidatorPanel } from './StrategyValidatorPanel';
export { default as RegimeConfigPanel } from './RegimeConfigPanel';
export { default as LeveragedEtfPanel } from './LeveragedEtfPanel';

// Charts
export { default as TradingViewChart } from './TradingViewChart';
export { default as LiveTradingChart } from './LiveTradingChart';
export { default as WatchlistCharts } from './WatchlistCharts';
export { default as PortfolioPerformanceChart } from './PortfolioPerformanceChart';
