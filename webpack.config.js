const path = require('path');
const SRC_DIR = path.join(__dirname, '/react-client/src');
const DIST_DIR = path.join(__dirname, '/react-client/dist');
const webpack = require('webpack');
const dotenv = require('dotenv');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// Load .env file
const env = dotenv.config().parsed || {};

// Create env vars for DefinePlugin (only REACT_APP_* vars)
const envKeys = Object.keys(env).reduce((prev, next) => {
  if (next.startsWith('REACT_APP_')) {
    prev[`process.env.${next}`] = JSON.stringify(env[next]);
  }
  return prev;
}, {});

module.exports = {
  mode: 'development', // Enable development mode for better debugging
  entry: `${SRC_DIR}/index.jsx`,
  output: {
    path: DIST_DIR,
    filename: '[name].bundle.js',
    publicPath: '/', // Important for dev server
    clean: true, // Clean dist folder before build (Webpack 5 feature)
  },
  devtool: 'source-map', // CSP-compliant source maps (no eval)
  devServer: {
    static: { directory: DIST_DIR },
    hot: true,
    port: 3000,
    open: true,
    historyApiFallback: true, // For React Router
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:8080',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.css'],
    alias: {
      // Path aliases for cleaner imports
      // Usage: import { Button } from '@common';
      '@': path.resolve(__dirname, 'react-client/src'),
      '@components': path.resolve(__dirname, 'react-client/src/Components'),
      '@common': path.resolve(__dirname, 'react-client/src/Components/common'),
      '@pages': path.resolve(__dirname, 'react-client/src/Components/pages'),
      '@charts': path.resolve(__dirname, 'react-client/src/Components/charts'),
      '@trading': path.resolve(__dirname, 'react-client/src/Components/trading'),
      '@simulator': path.resolve(__dirname, 'react-client/src/Components/simulator'),
      '@contexts': path.resolve(__dirname, 'react-client/src/contexts'),
      '@hooks': path.resolve(__dirname, 'react-client/src/hooks'),
      '@utils': path.resolve(__dirname, 'react-client/src/utils'),
      '@config': path.resolve(__dirname, 'react-client/src/config'),
      // MVP - High rigor code (requires testing before changes)
      '@mvp': path.resolve(__dirname, 'react-client/src/mvp'),
    },
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpg|gif|svg)$/,
        type: 'asset',
        parser: {
          dataUrlCondition: {
            maxSize: 100000, // 100kb - inline if smaller
          },
        },
      },
      {
        test: /\.jsx?/,
        include: SRC_DIR,
        use: {
          loader: 'babel-loader',
        },
      },
      {
        // Transpile ES6+ syntax in these specific node_modules
        test: /\.m?js$/,
        include: [
          path.resolve(__dirname, 'node_modules/chart.js'),
          path.resolve(__dirname, 'node_modules/lightweight-charts'),
        ],
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
            plugins: ['@babel/plugin-transform-class-properties'],
          },
        },
      },
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development'),
      ...envKeys,
    }),
    new HtmlWebpackPlugin({
      template: path.join(SRC_DIR, 'index.html'),
      filename: 'index.html',
      inject: 'body', // Inject scripts at the bottom of body
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: path.join(SRC_DIR, 'styles.css'), to: 'styles.css' },
      ],
    }),
    // HotModuleReplacementPlugin is automatic in Webpack 5 with hot: true
  ],
  optimization: {
    // Enable tree shaking and dead code elimination
    usedExports: true,
    sideEffects: false,
    // Split chunks to reduce main bundle size
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
        },
        common: {
          name: 'common',
          minChunks: 2,
          chunks: 'all',
        },
      },
    },
  },
  performance: {
    // Increase size limits to suppress warnings for now
    maxAssetSize: 1000000, // 1MB
    maxEntrypointSize: 1000000, // 1MB
    hints: 'warning',
  },
};
