/**
 * Audio Notifications Service
 *
 * Provides audio alerts for trading events using Web Speech API
 * and optional sound effects for different event types.
 *
 * Features:
 * - Speech queue to prevent overlapping announcements
 * - Short, concise trade announcements
 * - Sound effects for buy/sell
 */

// Notification settings stored in localStorage
const SETTINGS_KEY = 'keo-stocks-audio-settings';

const defaultSettings = {
  enabled: true,
  volume: 0.7,
  voiceEnabled: true,
  soundEffectsEnabled: true,
  announceTrades: true,
  announcePriceAlerts: true,
  announceAIDecisions: false,
  voiceRate: 1.2, // Slightly faster for snappier announcements
  voicePitch: 1.0,
};

// Speech queue to prevent overlapping
let speechQueue = [];
let isSpeaking = false;

// Load settings from localStorage
export const loadAudioSettings = () => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return { ...defaultSettings, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.error('Failed to load audio settings:', error);
  }
  return defaultSettings;
};

// Save settings to localStorage
export const saveAudioSettings = settings => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Failed to save audio settings:', error);
    return false;
  }
};

// Check if Speech Synthesis is available
const isSpeechAvailable = () => {
  return 'speechSynthesis' in window;
};

// Get available voices (prefer US English)
const getVoice = () => {
  if (!isSpeechAvailable()) return null;

  const voices = window.speechSynthesis.getVoices();
  // Prefer a US English voice
  const preferred = voices.find(
    v =>
      v.lang === 'en-US' &&
      (v.name.includes('Samantha') ||
        v.name.includes('Alex') ||
        v.name.includes('Google'))
  );
  return preferred || voices.find(v => v.lang.startsWith('en')) || voices[0];
};

// Process speech queue one at a time
const processQueue = () => {
  if (isSpeaking || speechQueue.length === 0) return;

  isSpeaking = true;
  const { text, options, resolve } = speechQueue.shift();
  const settings = loadAudioSettings();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = getVoice();
  utterance.rate = options.rate || settings.voiceRate;
  utterance.pitch = options.pitch || settings.voicePitch;
  utterance.volume = options.volume || settings.volume;

  utterance.onend = () => {
    isSpeaking = false;
    resolve();
    // Small delay between announcements for clarity
    setTimeout(processQueue, 300);
  };

  utterance.onerror = () => {
    isSpeaking = false;
    resolve();
    setTimeout(processQueue, 100);
  };

  window.speechSynthesis.speak(utterance);
};

// Speak text using Web Speech API (queued to prevent overlaps)
export const speak = (text, options = {}) => {
  const settings = loadAudioSettings();

  if (!settings.enabled || !settings.voiceEnabled || !isSpeechAvailable()) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    speechQueue.push({ text, options, resolve });
    processQueue();
  });
};

// Clear the speech queue (use when navigating away or stopping)
export const clearSpeechQueue = () => {
  speechQueue = [];
  window.speechSynthesis.cancel();
  isSpeaking = false;
};

// Sound effect types using AudioContext (no external files needed)
const playTone = (frequency, duration, type = 'sine', volume = 0.3) => {
  const settings = loadAudioSettings();

  if (!settings.enabled || !settings.soundEffectsEnabled) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    try {
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      gainNode.gain.setValueAtTime(
        volume * settings.volume,
        audioContext.currentTime
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + duration
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration);

      setTimeout(resolve, duration * 1000);
    } catch (error) {
      console.error('Audio playback error:', error);
      resolve();
    }
  });
};

// Play a success/buy sound (ascending tone)
export const playBuySound = async () => {
  await playTone(440, 0.1, 'sine', 0.4); // A4
  await playTone(554, 0.1, 'sine', 0.4); // C#5
  await playTone(659, 0.15, 'sine', 0.4); // E5
};

// Play a sell sound (descending tone)
export const playSellSound = async () => {
  await playTone(659, 0.1, 'sine', 0.4); // E5
  await playTone(554, 0.1, 'sine', 0.4); // C#5
  await playTone(440, 0.15, 'sine', 0.4); // A4
};

// Play alert sound (attention-grabbing)
export const playAlertSound = async () => {
  await playTone(880, 0.1, 'square', 0.3);
  await playTone(880, 0.1, 'square', 0.3);
};

// Play error sound
export const playErrorSound = async () => {
  await playTone(200, 0.3, 'sawtooth', 0.3);
};

// Play neutral notification
export const playNotificationSound = async () => {
  await playTone(587, 0.15, 'sine', 0.3); // D5
};

/**
 * Announce a trade execution - short and sweet format
 * Examples: "Profit $50 - SELL 31 GOOG at 321", "Loss $20 - SELL...", "BUY 10 TSLA at 245"
 */
export const announceTrade = async trade => {
  const settings = loadAudioSettings();
  if (!settings.enabled || !settings.announceTrades) return;

  const { symbol, side, quantity, price, profit, pnl } = trade;
  const action = side.toUpperCase();
  const priceRounded = Math.round(parseFloat(price));
  const qty = Math.round(parseFloat(quantity));

  // Play sound effect (don't await - let it play while we queue speech)
  if (action === 'BUY') {
    playBuySound();
  } else {
    playSellSound();
  }

  // Short announcement format
  let text;
  const profitValue = profit !== undefined ? profit : pnl;

  if (action === 'SELL' && profitValue !== undefined && profitValue !== null) {
    const pnlNum = parseFloat(profitValue);
    const isProfit = pnlNum >= 0;
    const pnlRounded = Math.abs(Math.round(pnlNum));
    // Format: "Profit $50 - SELL 31 GOOG" or "Loss $20 - SELL 10 TSLA"
    text = `${isProfit ? 'Profit' : 'Loss'} $${pnlRounded} - ${action} ${qty} ${symbol}`;
  } else {
    text = `${action} ${qty} ${symbol} at ${priceRounded}`;
  }

  await speak(text, { rate: 1.3 }); // Faster for trade announcements
};

/**
 * Announce a price alert - short format
 * Example: "TSLA up 5% at 245"
 */
export const announcePriceAlert = async alert => {
  const settings = loadAudioSettings();
  if (!settings.enabled || !settings.announcePriceAlerts) return;

  const { symbol, direction, price, change } = alert;
  const changeRounded = Math.round(Math.abs(parseFloat(change)));
  const priceRounded = Math.round(parseFloat(price));

  playAlertSound(); // Don't await

  const text = `${symbol} ${direction} ${changeRounded}% at ${priceRounded}`;
  await speak(text, { rate: 1.3 });
};

/**
 * Announce AI decision - short format
 * Example: "AI: BUY NVDA, 85% confidence"
 */
export const announceAIDecision = async decision => {
  const settings = loadAudioSettings();
  if (!settings.enabled || !settings.announceAIDecisions) return;

  const { symbol, action, confidence } = decision;

  playNotificationSound(); // Don't await

  const text = `AI: ${action} ${symbol}, ${Math.round(confidence)}%`;
  await speak(text, { rate: 1.3 });
};

/**
 * Announce portfolio update - short format
 * Example: "Portfolio up $150"
 */
export const announcePortfolioUpdate = async update => {
  const settings = loadAudioSettings();
  if (!settings.enabled) return;

  const { totalPnL } = update;
  const sign = totalPnL >= 0 ? 'up' : 'down';
  const pnlRounded = Math.round(Math.abs(parseFloat(totalPnL)));

  playNotificationSound(); // Don't await

  const text = `Portfolio ${sign} $${pnlRounded}`;
  await speak(text, { rate: 1.3 });
};

/**
 * Quick test of the audio system
 */
export const testAudioSystem = async () => {
  await playNotificationSound();
  await speak('Audio notifications are working');
};

// Initialize voices when the page loads
if (isSpeechAvailable()) {
  // Voices may not be immediately available
  window.speechSynthesis.onvoiceschanged = () => {
    console.log('Speech synthesis voices loaded');
  };
}

export default {
  loadAudioSettings,
  saveAudioSettings,
  speak,
  clearSpeechQueue,
  playBuySound,
  playSellSound,
  playAlertSound,
  playErrorSound,
  playNotificationSound,
  announceTrade,
  announcePriceAlert,
  announceAIDecision,
  announcePortfolioUpdate,
  testAudioSystem,
};
