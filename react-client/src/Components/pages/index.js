/**
 * PAGES - Barrel Export
 *
 * Import pages by name without specifying path:
 * import { PortfolioPage, StockDetailPage } from './pages';
 *
 * Pages organized by category:
 * - MVP: Core production pages
 * - Tools: Secondary feature pages
 * - Experimental: WIP/research pages
 * - Legacy: Kept for backwards compatibility
 */

// ============================================
// MVP Pages (5 Core Screens)
// ============================================
// Note: RankingsPage is in Components/ root, not pages/
export { default as StockDetailPage } from './StockDetailPage';
export { default as PortfolioPage } from './PortfolioPage';
export { default as TradingSessionsList } from './TradingSessionsList';
export { default as LiveTradingDashboard } from './LiveTradingDashboard';
export { default as PerformanceAnalyticsPanel } from './PerformanceAnalyticsPanel';

// ============================================
// Tools (Advanced Features)
// ============================================
export { default as BacktestPage } from './BacktestPage';
export { default as IntradayAnalyzerPage } from './IntradayAnalyzerPage';
export { default as TradeImportPage } from './TradeImportPage';

// ============================================
// Experimental (WIP/Research)
// ============================================
export { default as ABTestPage } from './ABTestPage';
export { default as WalkForwardPage } from './WalkForwardPage';
export { default as StrategyLabPage } from './StrategyLabPage';
export { default as OvernightOptimizationPage } from './OvernightOptimizationPage';
export { default as CharlieStrategyPage } from './CharlieStrategyPage';
export { default as PerformanceAnalytics } from './PerformanceAnalytics';

// ============================================
// Legacy (Backwards Compatibility)
// ============================================
export { default as InvestTab } from './InvestTab';
export { default as PaperTradingPage } from './PaperTradingPage';
export { default as AIResearchPage } from './AIResearchPage';

// ============================================
// Developer Tools
// ============================================
export { default as ComponentCatalog } from './ComponentCatalog';
