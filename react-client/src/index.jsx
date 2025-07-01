/**
 * ENTRY POINT - Application Bootstrap
 * 
 * This is the main entry point that initializes the React application.
 * It renders the root App component into the DOM element with id 'app'.
 * 
 * CRITICAL PATH: This file connects the React app to the HTML template
 * UPDATED: Using React 18's createRoot API
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './Components/App';
 
// Mount the React application to the DOM using React 18's createRoot
const container = document.getElementById('app');
const root = createRoot(container);
root.render(<App />);