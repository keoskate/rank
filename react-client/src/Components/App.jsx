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

function App() {
  return (
    <Router>
      <div>
        {/* Navigation bar - appears on all pages */}
        <NavBar />
        {/* Main routes - using React Router v6 syntax */}
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;