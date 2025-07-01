// Quick build script to bypass CLI issues
const webpack = require('webpack');
const config = require('./webpack.config.js');

// Check if watch mode is requested
const watchMode = process.argv.includes('--watch');

if (watchMode) {
  console.log('Starting webpack in watch mode...');
  const compiler = webpack(config);
  
  compiler.watch({
    aggregateTimeout: 300,
    poll: undefined
  }, (err, stats) => {
    if (err || stats.hasErrors()) {
      console.error('Build failed:', err || stats.toString());
      return;
    }
    console.log('✅ Build completed successfully!');
    console.log(stats.toString({
      chunks: false,
      colors: true,
      hash: false,
      version: false,
      timings: true,
      assets: false,
      modules: false
    }));
  });
} else {
  webpack(config, (err, stats) => {
    if (err || stats.hasErrors()) {
      console.error('Build failed:', err || stats.toString());
      return;
    }
    console.log('✅ Build completed successfully!');
    console.log(stats.toString({
      chunks: false,
      colors: true
    }));
  });
}