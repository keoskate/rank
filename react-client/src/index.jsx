/**
 * ENTRY POINT - Application Bootstrap
 * 
 * This is the main entry point that initializes the React application.
 * It renders the root App component into the DOM element with id 'app'.
 * 
 * CRITICAL PATH: This file connects the React app to the HTML template
 */
import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import App from './Components/App';
 
// Mount the React application to the DOM
ReactDOM.render(<App />, document.getElementById('app'));