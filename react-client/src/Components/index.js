/**
 * COMPONENTS - Master Barrel Export
 *
 * Unified import for all components:
 *
 * // Import from specific categories
 * import { Button, Card, MetricCard } from './Components/common';
 * import { StockDetailPage, PortfolioPage } from './Components/pages';
 * import { PriceChart } from './Components/charts';
 * import { StockQuoteHeader } from './Components/trading';
 * import { SimulatorChart } from './Components/simulator';
 *
 * // Or import from the master index
 * import { Button, Card, StockDetailPage, PriceChart } from './Components';
 */

// Re-export all common components
export * from './common';

// Re-export all pages
export * from './pages';

// Re-export all chart components
export * from './charts';

// Re-export all trading components
export * from './trading';

// Re-export all simulator components
export * from './simulator';

// ============================================
// Root-level Components (not in subdirectories)
// ============================================
export { default as App } from './App';
export { default as NavBar } from './NavBar';
export { default as RankingsPage } from './RankingsPage';
export { default as StockDataProvider } from './StockDataProvider';
export { default as TradingSimulator } from './TradingSimulator';
export { default as ModernStonkBoard } from './ModernStonkBoard';
export { default as WeightSlider } from './WeightSlider';
export { default as WeightManager } from './WeightManager';
export { default as BoardControls } from './BoardControls';
export { default as ColumnVisibilityManager } from './ColumnVisibilityManager';
export { default as TabNavigation } from './TabNavigation';
export { default as RankingDashboard } from './RankingDashboard';
export { default as CustomStockListManager } from './CustomStockListManager';
export { default as StockListSelector } from './StockListSelector';
export { default as DataQualityBadge } from './DataQualityBadge';
export { default as DataValidationTest } from './DataValidationTest';
export { default as MetricCorrelationChart } from './MetricCorrelationChart';
export { default as PatternDetectionPanel } from './PatternDetectionPanel';
export { default as SignalSummaryPanel } from './SignalSummaryPanel';
