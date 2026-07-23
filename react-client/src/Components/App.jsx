/**
 * ROOT COMPONENT - Application Shell
 *
 * MVP Flow: Rankings → Stock Detail → Trade
 * Clean navigation with primary nav + Tools dropdown
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import NavBar from './NavBar';
import StockDataProvider from './StockDataProvider';
import { TradingConfigProvider } from '../contexts/TradingConfigContext';
import {
  AccountViewProvider,
  useAccountView,
} from '../contexts/AccountViewContext';
import ErrorBoundary from './common/ErrorBoundary';

// Primary Pages (MVP flow)
import RankingsPage from './RankingsPage';
import StockDetailPage from './pages/StockDetailPage';
import PortfolioPage from './pages/PortfolioPage';

// Tools (advanced features)
import BacktestPage from './pages/BacktestPage';
import IntradayAnalyzerPage from './pages/IntradayAnalyzerPage';
import TradingSessionsList from './pages/TradingSessionsList';
import MultiSessionView from './pages/MultiSessionView';
import TradeImportPage from './pages/TradeImportPage';
// PerformanceAnalytics now embedded in PortfolioPage as Analytics tab
import ABTestPage from './pages/ABTestPage';
import WalkForwardPage from './pages/WalkForwardPage';
import StrategyLabPage from './pages/StrategyLabPage';
import OvernightOptimizationPage from './pages/OvernightOptimizationPage';
import CharlieStrategyPage from './pages/CharlieStrategyPage';
import SemiconductorDemoPage from './pages/SemiconductorDemoPage';
// Lazy-loaded — pulls in lightweight-charts, socket.io-client, and 11 sub-panels (~1MB).
// Only loads when user actually navigates to /command-center.
const IntraDayCommandCenter = lazy(
  () => import('./pages/IntraDayCommandCenter')
);
import DataExplorer from './pages/DataExplorer';
import SymbolInspector from './pages/SymbolInspector';
import DarkPoolDiagnosticsPage from './pages/DarkPoolDiagnosticsPage';
// Lazy-loaded — scanner page pulls in all its sub-components.
const ProbabilityScannerPage = lazy(
  () => import('./pages/ProbabilityScannerPage')
);

// Legacy pages (keep for now)
import InvestTab from './pages/InvestTab';
import PaperTradingPage from './pages/PaperTradingPage';
import AIResearchPage from './pages/AIResearchPage';
import DataValidationTest from './DataValidationTest';

// Developer Tools
import ComponentCatalog from './pages/ComponentCatalog';

// Bridges the global account picker into pages that take tradingMode as a
// prop (the /api/alpaca routes accept the account id as their mode param).
const CommandCenterWithAccount = () => {
  const { accountId } = useAccountView();
  return <IntraDayCommandCenter tradingMode={accountId} />;
};

function App() {
  return (
    <ErrorBoundary message="The application encountered an unexpected error. Please refresh the page.">
      <TradingConfigProvider>
        <StockDataProvider>
          <AccountViewProvider>
            <Router>
              <div style={{ margin: 0, padding: 0 }}>
                {/* Navigation bar - appears on all pages */}
                <NavBar />
                {/* Main routes - using React Router v6 syntax */}
                <ErrorBoundary message="This page encountered an error. Try navigating to a different page.">
                  <Suspense
                    fallback={
                      <div
                        style={{
                          padding: '40px',
                          textAlign: 'center',
                          color: '#888',
                          fontFamily: 'monospace',
                        }}
                      >
                        Loading…
                      </div>
                    }
                  >
                    <Routes>
                      {/* MVP Primary Routes */}
                      <Route path="/" element={<RankingsPage />} />
                      <Route path="/portfolio" element={<PortfolioPage />} />
                      <Route
                        path="/stock/:ticker"
                        element={<StockDetailPage />}
                      />

                      {/* Tools */}
                      <Route path="/backtest" element={<BacktestPage />} />
                      <Route
                        path="/day-trading"
                        element={<IntradayAnalyzerPage />}
                      />
                      <Route
                        path="/live-trading"
                        element={<TradingSessionsList />}
                      />
                      <Route
                        path="/live-trading/:sessionId"
                        element={<MultiSessionView />}
                      />
                      <Route
                        path="/import-trades"
                        element={<TradeImportPage />}
                      />
                      {/* Analytics is now accessible via /portfolio?tab=analytics */}
                      <Route path="/ab-testing" element={<ABTestPage />} />
                      <Route
                        path="/walk-forward"
                        element={<WalkForwardPage />}
                      />
                      <Route
                        path="/strategy-lab"
                        element={<StrategyLabPage />}
                      />
                      <Route
                        path="/overnight"
                        element={<OvernightOptimizationPage />}
                      />
                      <Route
                        path="/charlie-strategy"
                        element={<CharlieStrategyPage />}
                      />
                      <Route
                        path="/semiconductor"
                        element={<SemiconductorDemoPage />}
                      />
                      <Route
                        path="/command-center"
                        element={<CommandCenterWithAccount />}
                      />
                      <Route path="/data-explorer" element={<DataExplorer />} />
                      <Route path="/inspect" element={<SymbolInspector />} />
                      <Route
                        path="/darkpool-diagnostics"
                        element={<DarkPoolDiagnosticsPage />}
                      />
                      <Route
                        path="/scanner"
                        element={<ProbabilityScannerPage />}
                      />

                      {/* Legacy routes (keep accessible) */}
                      <Route path="/invest" element={<InvestTab />} />
                      <Route
                        path="/paper-trading"
                        element={<PaperTradingPage />}
                      />
                      <Route path="/ai-research" element={<AIResearchPage />} />
                      <Route
                        path="/test-validation"
                        element={<DataValidationTest />}
                      />

                      {/* Developer Tools */}
                      <Route
                        path="/dev/components"
                        element={<ComponentCatalog />}
                      />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </div>
            </Router>
          </AccountViewProvider>
        </StockDataProvider>
      </TradingConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
