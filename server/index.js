/**
 * EXPRESS SERVER - Static File Server
 * 
 * Simple Express server that:
 * 1. Serves the built React application from /dist folder
 * 2. Handles client-side routing with catch-all route
 * 3. Provides API endpoint foundation (currently unused)
 * 
 * CRITICAL PATH: This serves the entire application
 * All HTTP requests flow through this server
 */
const express = require('express');
const bodyParser = require('body-parser');
const PORT = process.env.PORT || 8080;
const path = require('path');

const app = express();

// Middleware for JSON parsing (for future API endpoints)
app.use(bodyParser.json());

// Serve static files from React build
app.use(express.static(`${__dirname}/../react-client/dist`));

// Catch-all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.resolve(`${__dirname}/../react-client/dist/index.html`));
});

// Start server
app.listen(PORT, () => {
  console.log(`listening on port ${PORT}!`);
});