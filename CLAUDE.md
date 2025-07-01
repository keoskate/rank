# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

Start development environment:
```bash
npm run server-dev    # Start Express server with nodemon
npm run react-dev     # Start React client with webpack watch (legacy OpenSSL)
```

Access the application at `http://localhost:8080/`

Build commands:
```bash
npm run build         # Production webpack build
npm run dev           # Development webpack build with watch
```

## Architecture Overview

This is a full-stack React application for ranking and scoring investments with the following structure:

### Frontend (React Client)
- **Entry point**: `react-client/src/index.jsx` - renders App component into DOM
- **Router**: Uses React Router v4 with `App.jsx` as the main component container
- **Components**: Located in `react-client/src/Components/`
  - `HomePage.jsx` - Main landing page component
  - `NavBar.jsx` - Navigation component
  - `Scoreboard.jsx` - Investment scoring interface
  - `StockBoard.jsx` / `StonkBoard.jsx` - Stock data display components
  - `StockUtils.js` - Utility functions for stock data processing
  - `WeightSlider.jsx` - UI component for weight adjustments
  - `ColorColumn.jsx` - Color-coded column display
  - `Footer.jsx` - Footer component

### Backend (Express Server)
- **Server**: `server/index.js` - Express server serving static files and handling SPA routing
- **Port**: 8080 (configurable via PORT env var)
- **Static files**: Serves built React app from `react-client/dist/`

### Build System
- **Webpack**: Uses webpack 4 with Babel for JSX/ES2015 transpilation
- **Output**: Bundles to `react-client/dist/bundle.js`
- **Babel presets**: React and ES2015

### Data Management
- Stock data stored in versioned files: `stock-data_19.js`, `stock-data_20.js`
- Ranking data in `rank-data.js`
- Static data in `Components/data.json`

## Development Notes

- Uses legacy Node.js OpenSSL provider for compatibility (`NODE_OPTIONS=--openssl-legacy-provider`)
- No test framework currently configured
- Uses older React 16.x and Webpack 4.x stack
- Express server handles SPA routing with catch-all route serving index.html