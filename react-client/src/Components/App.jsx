/**
 * ROOT COMPONENT - Application Shell
 *
 * MVP Flow: Rankings → Stock Detail → Trade
 * Clean navigation with primary nav + Tools dropdown
 */
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import NavBar from './NavBar';
import StockDataProvider from './StockDataProvider';
import { TradingConfigProvider } from '../contexts/TradingConfigContext';
import ErrorBoundary from './common/ErrorBoundary';

// Primary Pages (MVP flow)
import RankingsPage from './RankingsPage';
import StockDetailPage from './pages/StockDetailPage';
import PortfolioPage from './pages/PortfolioPage';

// Tools (advanced features)
import BacktestPage from './pages/BacktestPage';
import IntradayAnalyzerPage from './pages/IntradayAnalyzerPage';
import TradingSessionsList from './pages/TradingSessionsList';
import LiveTradingDashboard from './pages/LiveTradingDashboard';
import TradeImportPage from './pages/TradeImportPage';
import PerformanceAnalytics from './pages/PerformanceAnalytics';
import ABTestPage from './pages/ABTestPage';
import WalkForwardPage from './pages/WalkForwardPage';
import StrategyLabPage from './pages/StrategyLabPage';
import OvernightOptimizationPage from './pages/OvernightOptimizationPage';
import CharlieStrategyPage from './pages/CharlieStrategyPage';

// Legacy pages (keep for now)
import InvestTab from './pages/InvestTab';
import PaperTradingPage from './pages/PaperTradingPage';
import AIResearchPage from './pages/AIResearchPage';
import DataValidationTest from './DataValidationTest';

function App() {
  return (
    <ErrorBoundary message="The application encountered an unexpected error. Please refresh the page.">
      <TradingConfigProvider>
        <StockDataProvider>
          <Router>
          <div style={{ margin: 0, padding: 0 }}>
            {/* Navigation bar - appears on all pages */}
            <NavBar />
            {/* Main routes - using React Router v6 syntax */}
            <ErrorBoundary message="This page encountered an error. Try navigating to a different page.">
              <Routes>
                {/* MVP Primary Routes */}
                <Route path="/" element={<RankingsPage />} />
                <Route path="/portfolio" element={<PortfolioPage />} />
                <Route path="/stock/:ticker" element={<StockDetailPage />} />

                {/* Tools */}
                <Route path="/backtest" element={<BacktestPage />} />
                <Route path="/day-trading" element={<IntradayAnalyzerPage />} />
                <Route path="/live-trading" element={<TradingSessionsList />} />
                <Route
                  path="/live-trading/:sessionId"
                  element={<LiveTradingDashboard />}
                />
                <Route path="/import-trades" element={<TradeImportPage />} />
                <Route path="/analytics" element={<PerformanceAnalytics />} />
                <Route path="/ab-testing" element={<ABTestPage />} />
                <Route path="/walk-forward" element={<WalkForwardPage />} />
                <Route path="/strategy-lab" element={<StrategyLabPage />} />
                <Route path="/overnight" element={<OvernightOptimizationPage />} />
                <Route path="/charlie-strategy" element={<CharlieStrategyPage />} />

                {/* Legacy routes (keep accessible) */}
                <Route path="/invest" element={<InvestTab />} />
                <Route path="/paper-trading" element={<PaperTradingPage />} />
                <Route path="/ai-research" element={<AIResearchPage />} />
                <Route
                  path="/test-validation"
                  element={<DataValidationTest />}
                />
              </Routes>
            </ErrorBoundary>
          </div>
          </Router>
        </StockDataProvider>
      </TradingConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
