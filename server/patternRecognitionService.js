/**
 * Pattern Recognition Service
 *
 * TensorFlow.js-based pattern detection for trading signals.
 * Identifies breakouts, reversals, and momentum patterns.
 */

const tf = require('@tensorflow/tfjs');
const path = require('path');
const fs = require('fs');

// Model configuration
const MODEL_PATH = path.join(__dirname, 'models', 'pattern_model.json');
const SEQUENCE_LENGTH = 60; // Number of candles to analyze
const NUM_FEATURES = 8; // OHLCV + RSI + MACD + BB%B

// Pattern classes
const PATTERNS = {
  BUY_SIGNAL: 0,
  HOLD: 1,
  SELL_SIGNAL: 2
};

const PATTERN_NAMES = ['BUY_SIGNAL', 'HOLD', 'SELL_SIGNAL'];

// Store the model
let model = null;
let isModelLoaded = false;

/**
 * Create the CNN model architecture
 * @returns {tf.Sequential} TensorFlow model
 */
function createModel() {
  const model = tf.sequential();

  // Input shape: [SEQUENCE_LENGTH, NUM_FEATURES]
  // Conv1D Layer 1
  model.add(
    tf.layers.conv1d({
      inputShape: [SEQUENCE_LENGTH, NUM_FEATURES],
      filters: 64,
      kernelSize: 5,
      activation: 'relu',
      padding: 'same'
    })
  );
  model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  model.add(tf.layers.dropout({ rate: 0.2 }));

  // Conv1D Layer 2
  model.add(
    tf.layers.conv1d({
      filters: 128,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same'
    })
  );
  model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  model.add(tf.layers.dropout({ rate: 0.2 }));

  // Conv1D Layer 3
  model.add(
    tf.layers.conv1d({
      filters: 256,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same'
    })
  );
  model.add(tf.layers.globalMaxPooling1d());

  // Dense layers
  model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.3 }));

  // Output layer - 3 classes
  model.add(tf.layers.dense({ units: 3, activation: 'softmax' }));

  // Compile
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy']
  });

  return model;
}

/**
 * Initialize the model (create new or load existing)
 */
async function initializeModel() {
  try {
    // Check if saved model exists
    if (fs.existsSync(MODEL_PATH)) {
      console.log('[Pattern Recognition] Loading saved model...');
      model = await tf.loadLayersModel(`file://${MODEL_PATH}`);
      isModelLoaded = true;
      console.log('[Pattern Recognition] Model loaded successfully');
    } else {
      console.log('[Pattern Recognition] Creating new model...');
      model = createModel();
      isModelLoaded = true;
      console.log('[Pattern Recognition] New model created');
    }
  } catch (error) {
    console.error('[Pattern Recognition] Error initializing model:', error);
    // Create new model as fallback
    model = createModel();
    isModelLoaded = true;
  }
}

/**
 * Normalize a single value to 0-1 range
 * @param {number} value - Value to normalize
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Normalized value
 */
function normalize(value, min, max) {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/**
 * Preprocess candle data for model input
 * @param {Array} candles - OHLCV candle data
 * @param {object} indicators - Calculated indicators
 * @returns {tf.Tensor} Preprocessed tensor
 */
function preprocessData(candles, indicators = {}) {
  if (candles.length < SEQUENCE_LENGTH) {
    throw new Error(`Need at least ${SEQUENCE_LENGTH} candles for prediction`);
  }

  // Take last SEQUENCE_LENGTH candles
  const recentCandles = candles.slice(-SEQUENCE_LENGTH);

  // Calculate min/max for normalization
  const opens = recentCandles.map((c) => c.open);
  const highs = recentCandles.map((c) => c.high);
  const lows = recentCandles.map((c) => c.low);
  const closes = recentCandles.map((c) => c.close);
  const volumes = recentCandles.map((c) => c.volume);

  const priceMin = Math.min(...lows);
  const priceMax = Math.max(...highs);
  const volumeMin = Math.min(...volumes);
  const volumeMax = Math.max(...volumes);

  // Get indicator values (use defaults if not provided)
  const rsiValues = indicators.rsi?.history || Array(SEQUENCE_LENGTH).fill(50);
  const macdValues = indicators.macd?.history?.map((m) => m?.histogram || 0) ||
    Array(SEQUENCE_LENGTH).fill(0);
  const bbValues = indicators.bollingerBands?.history?.map((b) => b?.percentB || 0.5) ||
    Array(SEQUENCE_LENGTH).fill(0.5);

  // Pad indicator arrays if needed
  const padArray = (arr, targetLength, defaultValue) => {
    if (arr.length >= targetLength) return arr.slice(-targetLength);
    return [...Array(targetLength - arr.length).fill(defaultValue), ...arr];
  };

  const paddedRSI = padArray(rsiValues, SEQUENCE_LENGTH, 50);
  const paddedMACD = padArray(macdValues, SEQUENCE_LENGTH, 0);
  const paddedBB = padArray(bbValues, SEQUENCE_LENGTH, 0.5);

  // MACD normalization bounds
  const macdMin = Math.min(...paddedMACD);
  const macdMax = Math.max(...paddedMACD);

  // Build feature matrix
  const features = recentCandles.map((candle, i) => [
    normalize(candle.open, priceMin, priceMax),
    normalize(candle.high, priceMin, priceMax),
    normalize(candle.low, priceMin, priceMax),
    normalize(candle.close, priceMin, priceMax),
    normalize(candle.volume, volumeMin, volumeMax),
    paddedRSI[i] / 100, // RSI is 0-100
    normalize(paddedMACD[i], macdMin, macdMax),
    paddedBB[i] // Already 0-1
  ]);

  return tf.tensor3d([features], [1, SEQUENCE_LENGTH, NUM_FEATURES]);
}

/**
 * Predict pattern from candle data
 * @param {Array} candles - OHLCV candle data
 * @param {object} indicators - Calculated indicators
 * @returns {object} Prediction result
 */
async function predictPattern(candles, indicators = {}) {
  if (!isModelLoaded || !model) {
    await initializeModel();
  }

  try {
    // Preprocess data
    const inputTensor = preprocessData(candles, indicators);

    // Make prediction
    const prediction = model.predict(inputTensor);
    const probabilities = await prediction.data();

    // Clean up tensors
    inputTensor.dispose();
    prediction.dispose();

    // Get prediction
    const maxIdx = probabilities.indexOf(Math.max(...probabilities));
    const patternName = PATTERN_NAMES[maxIdx];
    const confidence = Math.round(probabilities[maxIdx] * 100);

    // Detect specific patterns using heuristics
    const detectedPatterns = detectHeuristicPatterns(candles, indicators);

    return {
      signal: patternName,
      confidence,
      probabilities: {
        BUY_SIGNAL: Math.round(probabilities[0] * 100),
        HOLD: Math.round(probabilities[1] * 100),
        SELL_SIGNAL: Math.round(probabilities[2] * 100)
      },
      detectedPatterns,
      timestamp: new Date()
    };
  } catch (error) {
    console.error('[Pattern Recognition] Prediction error:', error);
    // Return rule-based fallback
    return detectHeuristicPatterns(candles, indicators);
  }
}

/**
 * Detect patterns using heuristic rules (rule-based fallback)
 * @param {Array} candles - OHLCV candle data
 * @param {object} indicators - Calculated indicators
 * @returns {object} Detected patterns
 */
function detectHeuristicPatterns(candles, indicators = {}) {
  if (!candles || candles.length < 20) {
    return { signal: 'HOLD', confidence: 50, patterns: [] };
  }

  const patterns = [];
  let bullishScore = 0;
  let bearishScore = 0;

  const recent = candles.slice(-20);
  const closes = recent.map((c) => c.close);
  const volumes = recent.map((c) => c.volume);
  const currentPrice = closes[closes.length - 1];
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const currentVolume = volumes[volumes.length - 1];

  // 1. Breakout Detection
  const recentHigh = Math.max(...closes.slice(0, -3));
  const recentLow = Math.min(...closes.slice(0, -3));
  const range = recentHigh - recentLow;

  // Bullish breakout
  if (currentPrice > recentHigh && currentVolume > avgVolume * 1.5) {
    patterns.push('Bullish Breakout');
    bullishScore += 25;
  }

  // Bearish breakout
  if (currentPrice < recentLow && currentVolume > avgVolume * 1.5) {
    patterns.push('Bearish Breakdown');
    bearishScore += 25;
  }

  // 2. Double Bottom / Double Top
  const lows = recent.slice(-10).map((c) => c.low);
  const highs = recent.slice(-10).map((c) => c.high);
  const minLow = Math.min(...lows);
  const maxHigh = Math.max(...highs);

  // Check for double bottom (two similar lows)
  const lowIndices = lows
    .map((l, i) => (l < minLow * 1.02 ? i : -1))
    .filter((i) => i >= 0);
  if (lowIndices.length >= 2 && lowIndices[lowIndices.length - 1] - lowIndices[0] > 3) {
    patterns.push('Double Bottom');
    bullishScore += 20;
  }

  // Check for double top (two similar highs)
  const highIndices = highs
    .map((h, i) => (h > maxHigh * 0.98 ? i : -1))
    .filter((i) => i >= 0);
  if (highIndices.length >= 2 && highIndices[highIndices.length - 1] - highIndices[0] > 3) {
    patterns.push('Double Top');
    bearishScore += 20;
  }

  // 3. Momentum Exhaustion
  if (indicators.rsi?.divergence?.bullish) {
    patterns.push('Bullish RSI Divergence');
    bullishScore += 30;
  }
  if (indicators.rsi?.divergence?.bearish) {
    patterns.push('Bearish RSI Divergence');
    bearishScore += 30;
  }

  // 4. Volume Profile
  const volumeDecreasing = volumes[volumes.length - 1] < volumes[volumes.length - 2] &&
    volumes[volumes.length - 2] < volumes[volumes.length - 3];

  if (volumeDecreasing && currentPrice > closes[closes.length - 4]) {
    patterns.push('Distribution (Rising Price, Falling Volume)');
    bearishScore += 15;
  }
  if (volumeDecreasing && currentPrice < closes[closes.length - 4]) {
    patterns.push('Accumulation (Falling Price, Falling Volume)');
    bullishScore += 15;
  }

  // 5. Opening Range Breakout (for intraday)
  const first30min = candles.slice(0, 6); // Assuming 5-min candles
  if (first30min.length >= 6) {
    const orbHigh = Math.max(...first30min.map((c) => c.high));
    const orbLow = Math.min(...first30min.map((c) => c.low));

    if (currentPrice > orbHigh && currentVolume > avgVolume) {
      patterns.push('ORB Breakout (Bullish)');
      bullishScore += 20;
    }
    if (currentPrice < orbLow && currentVolume > avgVolume) {
      patterns.push('ORB Breakdown (Bearish)');
      bearishScore += 20;
    }
  }

  // 6. Flag/Pennant patterns (simplified)
  const last5 = closes.slice(-5);
  const tightRange = Math.max(...last5) - Math.min(...last5) < range * 0.3;
  if (tightRange && closes[0] < closes[closes.length - 6]) {
    // Uptrend followed by consolidation
    patterns.push('Bull Flag');
    bullishScore += 15;
  }
  if (tightRange && closes[0] > closes[closes.length - 6]) {
    // Downtrend followed by consolidation
    patterns.push('Bear Flag');
    bearishScore += 15;
  }

  // 7. Bollinger Band squeeze and expansion
  if (indicators.bollingerBands?.squeeze) {
    patterns.push('Volatility Squeeze');
    // Direction based on price position
    if (currentPrice > indicators.bollingerBands?.middle) {
      bullishScore += 10;
    } else {
      bearishScore += 10;
    }
  }

  // Calculate final signal
  const netScore = bullishScore - bearishScore;
  let signal = 'HOLD';
  let confidence = 50;

  if (netScore >= 30) {
    signal = 'BUY_SIGNAL';
    confidence = Math.min(70 + netScore, 95);
  } else if (netScore <= -30) {
    signal = 'SELL_SIGNAL';
    confidence = Math.min(70 + Math.abs(netScore), 95);
  } else {
    confidence = 50 - Math.abs(netScore);
  }

  return {
    signal,
    confidence,
    probabilities: {
      BUY_SIGNAL: Math.min(35 + bullishScore, 95),
      HOLD: Math.max(30 - Math.abs(netScore) / 2, 10),
      SELL_SIGNAL: Math.min(35 + bearishScore, 95)
    },
    patterns,
    bullishScore,
    bearishScore,
    timestamp: new Date()
  };
}

/**
 * Train the model on historical trades
 * @param {Array} trades - Historical trade data with outcomes
 * @param {object} options - Training options
 */
async function trainModel(trades, options = {}) {
  const { epochs = 50, batchSize = 32, validationSplit = 0.2 } = options;

  if (!isModelLoaded || !model) {
    await initializeModel();
  }

  if (!trades || trades.length < 100) {
    throw new Error('Need at least 100 trades for training');
  }

  console.log(`[Pattern Recognition] Training on ${trades.length} trades...`);

  try {
    // Prepare training data
    const xs = [];
    const ys = [];

    for (const trade of trades) {
      if (!trade.candles || trade.candles.length < SEQUENCE_LENGTH) continue;

      // Preprocess candles
      const features = preprocessTradeData(trade.candles);
      xs.push(features);

      // Determine label based on outcome
      let label;
      if (trade.profitPercent > 2) {
        label = [1, 0, 0]; // BUY_SIGNAL was correct
      } else if (trade.profitPercent < -2) {
        label = [0, 0, 1]; // SELL_SIGNAL was correct (or BUY was wrong)
      } else {
        label = [0, 1, 0]; // HOLD
      }
      ys.push(label);
    }

    if (xs.length < 50) {
      throw new Error('Not enough valid training samples');
    }

    // Convert to tensors
    const xTensor = tf.tensor3d(xs);
    const yTensor = tf.tensor2d(ys);

    // Train
    const history = await model.fit(xTensor, yTensor, {
      epochs,
      batchSize,
      validationSplit,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(
            `[Pattern Recognition] Epoch ${epoch + 1}/${epochs} - ` +
              `Loss: ${logs.loss.toFixed(4)}, Accuracy: ${logs.acc.toFixed(4)}`
          );
        }
      }
    });

    // Clean up
    xTensor.dispose();
    yTensor.dispose();

    // Save model
    await saveModel();

    return {
      success: true,
      epochs,
      finalLoss: history.history.loss[history.history.loss.length - 1],
      finalAccuracy: history.history.acc[history.history.acc.length - 1],
      samplesUsed: xs.length
    };
  } catch (error) {
    console.error('[Pattern Recognition] Training error:', error);
    throw error;
  }
}

/**
 * Preprocess trade data for training
 * @param {Array} candles - Candle data
 * @returns {Array} Feature array
 */
function preprocessTradeData(candles) {
  const recentCandles = candles.slice(-SEQUENCE_LENGTH);

  const opens = recentCandles.map((c) => c.open);
  const highs = recentCandles.map((c) => c.high);
  const lows = recentCandles.map((c) => c.low);
  const closes = recentCandles.map((c) => c.close);
  const volumes = recentCandles.map((c) => c.volume);

  const priceMin = Math.min(...lows);
  const priceMax = Math.max(...highs);
  const volumeMin = Math.min(...volumes);
  const volumeMax = Math.max(...volumes);

  // Simple indicators (since we may not have full indicator data)
  const rsi = calculateSimpleRSI(closes);
  const macd = calculateSimpleMACD(closes);

  return recentCandles.map((candle, i) => [
    normalize(candle.open, priceMin, priceMax),
    normalize(candle.high, priceMin, priceMax),
    normalize(candle.low, priceMin, priceMax),
    normalize(candle.close, priceMin, priceMax),
    normalize(candle.volume, volumeMin, volumeMax),
    (rsi[i] || 50) / 100,
    normalize(macd[i] || 0, -1, 1),
    0.5 // Placeholder for BB%B
  ]);
}

/**
 * Simple RSI calculation for training
 * @param {Array} closes - Closing prices
 * @returns {Array} RSI values
 */
function calculateSimpleRSI(closes, period = 14) {
  const rsi = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    if (i <= period) {
      if (change > 0) gains += change;
      else losses -= change;

      if (i === period) {
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi.push(100 - 100 / (1 + rs));
      } else {
        rsi.push(50);
      }
    } else {
      const avgGain = gains / period;
      const avgLoss = losses / period;
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? -change : 0;

      gains = (avgGain * (period - 1) + currentGain);
      losses = (avgLoss * (period - 1) + currentLoss);

      const rs = losses === 0 ? 100 : gains / losses;
      rsi.push(100 - 100 / (1 + rs));
    }
  }

  return [50, ...rsi]; // Pad first value
}

/**
 * Simple MACD calculation for training
 * @param {Array} closes - Closing prices
 * @returns {Array} MACD histogram values
 */
function calculateSimpleMACD(closes) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  const macdLine = ema12.map((v, i) => v - (ema26[i] || 0));
  const signal = calculateEMA(macdLine, 9);

  return macdLine.map((v, i) => v - (signal[i] || 0));
}

/**
 * Simple EMA calculation
 * @param {Array} values - Values
 * @param {number} period - Period
 * @returns {Array} EMA values
 */
function calculateEMA(values, period) {
  const k = 2 / (period + 1);
  const ema = [values[0]];

  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }

  return ema;
}

/**
 * Save model to disk
 */
async function saveModel() {
  if (!model) return;

  try {
    const modelDir = path.dirname(MODEL_PATH);
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    await model.save(`file://${MODEL_PATH.replace('.json', '')}`);
    console.log('[Pattern Recognition] Model saved successfully');
  } catch (error) {
    console.error('[Pattern Recognition] Error saving model:', error);
  }
}

/**
 * Get model info
 * @returns {object} Model information
 */
function getModelInfo() {
  return {
    isLoaded: isModelLoaded,
    sequenceLength: SEQUENCE_LENGTH,
    numFeatures: NUM_FEATURES,
    patterns: PATTERN_NAMES,
    modelPath: MODEL_PATH
  };
}

// Initialize on load
initializeModel().catch(console.error);

module.exports = {
  initializeModel,
  predictPattern,
  detectHeuristicPatterns,
  trainModel,
  saveModel,
  getModelInfo,
  PATTERNS,
  PATTERN_NAMES
};
