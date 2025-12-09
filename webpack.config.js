const path = require('path');
const SRC_DIR = path.join(__dirname, '/react-client/src');
const DIST_DIR = path.join(__dirname, '/react-client/dist');
const webpack = require('webpack');
const dotenv = require('dotenv');

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
    filename: 'bundle.js',
    publicPath: '/', // Important for dev server
  },
  devtool: 'eval-source-map', // Enable source maps for debugging
  devServer: {
    contentBase: DIST_DIR,
    hot: true,
    port: 3000,
    open: true,
    historyApiFallback: true, // For React Router
    proxy: {
      '/api': 'http://localhost:8080', // Proxy API calls to Express server
    },
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.css'],
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        loader: 'style-loader!css-loader',
      },
      {
        test: /\.png$/,
        loader: 'url-loader?limit=100000&minetype=image/png',
      },
      {
        test: /\.jpg/,
        loader: 'file-loader',
      },
      {
        test: /\.json$/,
        loader: 'json-loader',
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
    new webpack.HotModuleReplacementPlugin(),
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
