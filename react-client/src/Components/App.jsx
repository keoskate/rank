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
import HomePage from './HomePage';
import NavBar from './NavBar';
import StockDetailPage from './StockDetailPage';
import InvestTab from './InvestTab';
import StockDataProvider from './StockDataProvider';

function App() {
  return (
    <StockDataProvider>
      <Router>
        <div style={{ margin: 0, padding: 0 }}>
          {/* Navigation bar - appears on all pages */}
          <NavBar />
          {/* Main routes - using React Router v6 syntax */}
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/invest" element={<InvestTab />} />
            <Route path="/stock/:ticker" element={<StockDetailPage />} />
          </Routes>
        </div>
      </Router>
    </StockDataProvider>
  );
}

export default App;
