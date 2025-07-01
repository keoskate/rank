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
 */
import React, { Component } from 'react';
import { BrowserRouter as Router, Route, Link} from 'react-router-dom';
import { browserHistory } from 'react-router';
import HomePage from './HomePage';
import NavBar from './NavBar';

class App extends Component {
  render() {
    return (
      <Router>
        <div>
          {/* Navigation bar - appears on all pages */}
          <NavBar />
          {/* Main route - currently only home page */}
          <Route name="home" exact path="/" component={HomePage} />
        </div>
      </Router>
    )
  }
}
export default App;