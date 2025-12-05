/**
 * ROOT COMPONENT - Application Shell
 *
 * This is the main application container that handles:
 * - React Router setup for navigation
 * - Layout structure (NavBar + main content)
 * - Route definitions
 *
 * CRITICAL PATH: This component defines the overall app structure
 * and routing. Changes here affect the entire application layout.
 * UPDATED: React Router v6 + React 18 functional component
 */
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import RankingsPage from './RankingsPage';
import NavBar from './NavBar';
import StockDetailPage from './StockDetailPage';
import InvestTab from './InvestTab';
import StockDataProvider from './StockDataProvider';
import DataValidationTest from './DataValidationTest';
import BacktestPage from './BacktestPage';
import PaperTradingPage from './PaperTradingPage';
import AIResearchPage from './AIResearchPage';
import IntradayAnalyzerPage from './IntradayAnalyzerPage';
import LiveTradingDashboard from './LiveTradingDashboard';
import TradeImportPage from './TradeImportPage';
import PerformanceAnalytics from './PerformanceAnalytics';
import ErrorBoundary from './common/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary message="The application encountered an unexpected error. Please refresh the page.">
      <StockDataProvider>
        <Router>
          <div style={{ margin: 0, padding: 0 }}>
            {/* Navigation bar - appears on all pages */}
            <NavBar />
            {/* Main routes - using React Router v6 syntax */}
            <ErrorBoundary message="This page encountered an error. Try navigating to a different page.">
              <Routes>
                <Route path="/" element={<RankingsPage />} />
                <Route path="/invest" element={<InvestTab />} />
                <Route path="/backtest" element={<BacktestPage />} />
                <Route path="/paper-trading" element={<PaperTradingPage />} />
                <Route path="/ai-research" element={<AIResearchPage />} />
                <Route path="/day-trading" element={<IntradayAnalyzerPage />} />
                <Route path="/live-trading" element={<LiveTradingDashboard />} />
                <Route path="/import-trades" element={<TradeImportPage />} />
                <Route path="/analytics" element={<PerformanceAnalytics />} />
                <Route path="/stock/:ticker" element={<StockDetailPage />} />
                <Route path="/test-validation" element={<DataValidationTest />} />
              </Routes>
            </ErrorBoundary>
          </div>
        </Router>
      </StockDataProvider>
    </ErrorBoundary>
  );
}

export default App;
