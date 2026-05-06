/**
 * TELEGRAM BOT - Remote Trading Control
 *
 * Two-way Telegram bot for monitoring and controlling the trading system.
 * - Read commands: /status, /positions, /sessions, /performance, /orders
 * - Write commands: /buy, /sell, /close, /pause, /resume, /stop, /kill, /cap
 * - Auto-alerts: trade executions, AI decisions, system alerts
 *
 * Security: Only responds to TELEGRAM_OWNER_ID. All others get "Unauthorized".
 * Write commands require /yes confirmation within 60 seconds.
 */

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const alpacaClient = require('./alpacaClient');
const aiTradingEngine = require('./aiTradingEngine');

const SERVER_URL = `http://localhost:${process.env.PORT || 8080}`;

let bot = null;
let ownerId = null;
let pendingConfirmation = null; // { action, description, params, timestamp, timeout }
const alertThrottle = new Map(); // key -> lastAlertTime
const watchedSymbols = new Map(); // symbol -> { intervalId, lastScore, lastVerdict, lastPrice, lastRsi, lastPatterns }
const WATCH_INTERVAL_MS = 5 * 60 * 1000; // 5 min

const THROTTLE_MS = 60000; // 1 message per symbol per 60s for alerts

// ─── Initialize ──────────────────────────────────────────────────────────────

function initialize(token, ownerChatId) {
  ownerId = String(ownerChatId);

  bot = new TelegramBot(token, { polling: true });

  // Auth guard middleware
  bot.on('message', (msg) => {
    if (!isOwner(msg) && msg.text && msg.text.startsWith('/')) {
      bot.sendMessage(msg.chat.id, 'Unauthorized.');
    }
  });

  // Read-only commands
  bot.onText(/^\/start$/, (msg) => isOwner(msg) && handleStart(msg));
  bot.onText(/^\/help$/, (msg) => isOwner(msg) && handleHelp(msg));
  bot.onText(/^\/status$/, (msg) => isOwner(msg) && handleStatus(msg));
  bot.onText(/^\/positions$/, (msg) => isOwner(msg) && handlePositions(msg));
  bot.onText(/^\/sessions$/, (msg) => isOwner(msg) && handleSessions(msg));
  bot.onText(/^\/performance$/, (msg) => isOwner(msg) && handlePerformance(msg));
  bot.onText(/^\/orders$/, (msg) => isOwner(msg) && handleOrders(msg));
  bot.onText(/^\/investigate\s+(\w+)$/i, (msg, match) => isOwner(msg) && handleInvestigate(msg, match[1]));
  bot.onText(/^\/watch\s+(\w+)$/i, (msg, match) => isOwner(msg) && handleWatch(msg, match[1]));
  bot.onText(/^\/unwatch\s+(\w+)$/i, (msg, match) => isOwner(msg) && handleUnwatch(msg, match[1]));
  bot.onText(/^\/watchlist$/i, (msg) => isOwner(msg) && handleWatchlist(msg));

  // Write commands (require confirmation)
  bot.onText(/^\/buy (\w+)\s+(\d+)$/i, (msg, match) => isOwner(msg) && handleBuy(msg, match));
  bot.onText(/^\/sell (\w+)\s+(\d+)$/i, (msg, match) => isOwner(msg) && handleSell(msg, match));
  bot.onText(/^\/close (\w+)$/i, (msg, match) => isOwner(msg) && handleClose(msg, match));
  bot.onText(/^\/pause (.+)$/i, (msg, match) => isOwner(msg) && handlePause(msg, match));
  bot.onText(/^\/resume (.+)$/i, (msg, match) => isOwner(msg) && handleResume(msg, match));
  bot.onText(/^\/stop (.+)$/i, (msg, match) => isOwner(msg) && handleStop(msg, match));
  bot.onText(/^\/kill$/, (msg) => isOwner(msg) && handleKill(msg));
  bot.onText(/^\/cap (\d+)$/i, (msg, match) => isOwner(msg) && handleCap(msg, match));
  bot.onText(/^\/trade\s+(\w+)$/i, (msg, match) => isOwner(msg) && handleTrade(msg, match[1]));

  // Confirmation handlers
  bot.onText(/^\/yes$/i, (msg) => isOwner(msg) && handleConfirm(msg));
  bot.onText(/^\/no$/i, (msg) => isOwner(msg) && handleCancel(msg));

  // Natural language handler (catches anything that isn't a /command)
  bot.on('message', (msg) => {
    if (!isOwner(msg)) return;
    if (!msg.text || msg.text.startsWith('/')) return;
    handleNaturalLanguage(msg);
  });

  console.log('[Telegram] Bot initialized, polling for messages...');

  // Send startup message (may fail if user hasn't /start'd the bot yet)
  bot.sendMessage(ownerId, '🤖 Trading bot connected and ready.\nType /help for commands.').catch(err => {
    console.log('[Telegram] Could not send startup message (send /start to the bot first):', err.message);
  });
}

function isOwner(msg) {
  return String(msg.chat.id) === ownerId;
}

// ─── Read-Only Commands ──────────────────────────────────────────────────────

async function handleStart(msg) {
  bot.sendMessage(msg.chat.id,
    '🤖 *Trading Bot Active*\n\n' +
    'Use /help to see available commands.\n' +
    'Use /status for a quick overview.',
    { parse_mode: 'Markdown' }
  );
}

async function handleHelp(msg) {
  const text =
    '*📋 Commands*\n' +
    '━━━━━━━━━━━━━━━━\n' +
    '*Read:*\n' +
    '/status — Account overview\n' +
    '/positions — Open positions with P\\&L\n' +
    '/sessions — AI trading sessions\n' +
    '/performance — Today\'s P\\&L breakdown\n' +
    '/orders — Recent filled orders\n' +
    '/investigate SOXL — Deep\\-dive analysis\n\n' +
    '*Monitor:*\n' +
    '/watch SOXL — Watch for entry signals \\(5min\\)\n' +
    '/unwatch SOXL — Stop watching\n' +
    '/watchlist — Show watched symbols\n\n' +
    '*Trade:*\n' +
    '/buy SOXL 50 — Buy 50 shares\n' +
    '/sell SOXL 50 — Sell 50 shares\n' +
    '/close SOXL — Close position\n' +
    '/trade SOXL — Start auto\\-trading session\n\n' +
    '*Sessions:*\n' +
    '/pause NAME — Pause session\n' +
    '/resume NAME — Resume session\n' +
    '/stop NAME — Stop session\n\n' +
    '*Emergency:*\n' +
    '/kill — Close ALL positions\n' +
    '/cap 30 — Set max exposure to 30%';

  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function handleStatus(msg) {
  try {
    const [account, positions] = await Promise.all([
      alpacaClient.getAccount(),
      alpacaClient.getPositions(),
    ]);

    const sessions = aiTradingEngine.getAllUserSessions('default_user');
    const runningSessions = sessions.filter(s => s.status === 'running').length;
    const pausedSessions = sessions.filter(s => s.status === 'paused').length;

    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    const buyingPower = parseFloat(account.buying_power);
    const daytradeCount = account.daytrade_count || 0;
    const pdt = account.pattern_day_trader ? 'YES' : 'NO';

    let positionSummary = 'None';
    if (positions.length > 0) {
      const totalUnrealized = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl || 0), 0);
      positionSummary = `${positions.length} open (${formatMoney(totalUnrealized)} unrealized)`;
    }

    const text =
      '📊 *TRADING STATUS*\n' +
      '━━━━━━━━━━━━━━━━\n' +
      `Equity:  ${formatMoney(equity)}\n` +
      `Cash:    ${formatMoney(cash)}\n` +
      `Buying:  ${formatMoney(buyingPower)}\n` +
      `Day Trades: ${daytradeCount} (PDT: ${pdt})\n\n` +
      `📈 Positions: ${positionSummary}\n` +
      `🤖 Sessions: ${runningSessions} running` +
      (pausedSessions > 0 ? `, ${pausedSessions} paused` : '');

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
}

async function handlePositions(msg) {
  try {
    const positions = await alpacaClient.getPositions();

    if (!positions || positions.length === 0) {
      bot.sendMessage(msg.chat.id, '📈 No open positions.');
      return;
    }

    let text = '📈 *POSITIONS*\n━━━━━━━━━━━━━━━━\n';
    let totalUnrealized = 0;

    for (const p of positions) {
      const qty = parseInt(p.qty);
      const avgEntry = parseFloat(p.avg_entry_price);
      const currentPrice = parseFloat(p.current_price);
      const unrealizedPl = parseFloat(p.unrealized_pl);
      const unrealizedPlPct = parseFloat(p.unrealized_plpc) * 100;
      const marketValue = parseFloat(p.market_value);
      totalUnrealized += unrealizedPl;

      const emoji = unrealizedPl >= 0 ? '🟢' : '🔴';
      text +=
        `\n${emoji} *${p.symbol}*\n` +
        `   ${qty} shares @ ${formatMoney(avgEntry)}\n` +
        `   Now: ${formatMoney(currentPrice)} | Val: ${formatMoney(marketValue)}\n` +
        `   P&L: ${formatMoney(unrealizedPl)} (${formatPercent(unrealizedPlPct)})\n`;
    }

    text += `\n━━━━━━━━━━━━━━━━\nTotal Unrealized: ${formatMoney(totalUnrealized)}`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
}

async function handleSessions(msg) {
  try {
    const sessions = aiTradingEngine.getAllUserSessions('default_user');

    if (!sessions || sessions.length === 0) {
      bot.sendMessage(msg.chat.id, '🤖 No trading sessions found.');
      return;
    }

    let text = '🤖 *TRADING SESSIONS*\n━━━━━━━━━━━━━━━━━━━\n';

    for (const s of sessions) {
      const statusEmoji = s.status === 'running' ? '✅' :
        s.status === 'paused' ? '⏸' :
        s.status === 'stopped' ? '⏹' : '❓';

      const trades = s.trades || [];
      const wins = trades.filter(t => (t.pnl || 0) > 0).length;
      const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0;
      const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

      text +=
        `\n${statusEmoji} *${escapeMarkdown(s.name || s.sessionId)}*\n` +
        `   ${s.status} | ${trades.length} trades | ${winRate}% WR\n` +
        `   P&L: ${formatMoney(totalPnl)}\n`;
    }

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
}

async function handlePerformance(msg) {
  try {
    const [account, positions] = await Promise.all([
      alpacaClient.getAccount(),
      alpacaClient.getPositions(),
    ]);

    const equity = parseFloat(account.equity);
    const lastEquity = parseFloat(account.last_equity);
    const dayChange = equity - lastEquity;
    const dayChangePct = lastEquity > 0 ? (dayChange / lastEquity) * 100 : 0;

    const unrealizedPl = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl || 0), 0);
    const realizedPl = dayChange - unrealizedPl;

    const emoji = dayChange >= 0 ? '📈' : '📉';

    const text =
      `${emoji} *TODAY'S PERFORMANCE*\n` +
      '━━━━━━━━━━━━━━━━━━━\n' +
      `Day P&L: ${formatMoney(dayChange)} (${formatPercent(dayChangePct)})\n` +
      `Realized: ${formatMoney(realizedPl)}\n` +
      `Unrealized: ${formatMoney(unrealizedPl)}\n\n` +
      `Equity: ${formatMoney(equity)}\n` +
      `Prev Close: ${formatMoney(lastEquity)}`;

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
}

async function handleOrders(msg) {
  try {
    const orders = await alpacaClient.getOrders({
      status: 'closed',
      limit: 10,
      direction: 'desc',
    });

    if (!orders || orders.length === 0) {
      bot.sendMessage(msg.chat.id, '📋 No recent orders.');
      return;
    }

    let text = '📋 *RECENT ORDERS*\n━━━━━━━━━━━━━━━━\n';

    for (const o of orders) {
      const side = o.side.toUpperCase();
      const emoji = side === 'BUY' ? '🟢' : '🔴';
      const filledQty = o.filled_qty || o.qty;
      const filledPrice = o.filled_avg_price ? formatMoney(parseFloat(o.filled_avg_price)) : 'pending';
      const time = new Date(o.filled_at || o.created_at).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York',
      });

      text += `${emoji} ${side} ${filledQty}x ${o.symbol} @ ${filledPrice} — ${time}\n`;
    }

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
}

// ─── Investigate Command ──────────────────────────────────────────────────────

async function handleInvestigate(msg, symbolRaw) {
  const symbol = symbolRaw.toUpperCase();
  bot.sendMessage(msg.chat.id, `🔍 Investigating ${symbol}...`);

  try {
    const response = await axios.get(`${SERVER_URL}/api/investigate/${symbol}`, { timeout: 30000 });
    const inv = response.data.investigation;

    if (!inv) {
      bot.sendMessage(msg.chat.id, `❌ No data returned for ${symbol}`);
      return;
    }

    // ── Message 1: Verdict + Price ──
    const price = inv.price || {};
    const rec = inv.recommendation || {};
    const change1D = price.change1D;
    const changeStr = change1D != null ? ` (${change1D >= 0 ? '+' : ''}${change1D.toFixed(2)}%)` : '';

    let msg1 =
      `🔍 *${escapeMarkdown(symbol)}* — ${escapeMarkdown(inv.name || symbol)}\n` +
      '━━━━━━━━━━━━━━━━━━━\n' +
      `Price: $${currentPriceFmt(price.current)}${changeStr}\n`;

    if (price.high52w) msg1 += `52wk: $${price.low52w?.toFixed(2)} — $${price.high52w?.toFixed(2)}\n`;

    msg1 += `\n*VERDICT: ${rec.verdict || 'N/A'}* (${rec.confidence || '?'}% confidence)\n`;
    msg1 += `Score: ${rec.score || '0'} / ${rec.maxScore || '10'}\n`;

    if (rec.reasons && rec.reasons.length > 0) {
      for (const r of rec.reasons.slice(0, 5)) {
        msg1 += `• ${escapeMarkdown(r)}\n`;
      }
    }

    bot.sendMessage(msg.chat.id, msg1, { parse_mode: 'Markdown' });

    // ── Message 2: Indicators ──
    if (inv.indicators) {
      const ind = inv.indicators;
      const rsiLabel = ind.rsi?.signal || 'N/A';
      const macdLabel = ind.macd?.signal || 'N/A';
      const bbLabel = ind.bollingerBands?.squeeze ? 'squeeze' : 'normal';
      const stochLabel = ind.stochastic?.bullishCross ? 'bullish cross' : 'neutral';
      const adxLabel = ind.adx?.trending ? 'trending' : 'weak trend';
      const vwapLabel = ind.vwap?.position ? (parseFloat(ind.vwap.position) > 0 ? `above (${ind.vwap.position}%)` : `below (${ind.vwap.position}%)`) : 'N/A';
      const volLabel = ind.volume?.ratio ? `${ind.volume.ratio}x avg` : 'N/A';

      const ema9gt21 = ind.ema?.ema9 && ind.ema?.ema21 && parseFloat(ind.ema.ema9) > parseFloat(ind.ema.ema21);
      const crossLabel = ind.ema?.goldenCross ? 'golden cross' : ind.ema?.deathCross ? 'death cross' : 'none';

      const msg2 =
        '📊 *TECHNICAL INDICATORS*\n' +
        '━━━━━━━━━━━━━━━━━━━\n' +
        `RSI (14):     ${ind.rsi?.value || 'N/A'}  — ${rsiLabel}\n` +
        `MACD:        ${ind.macd?.value || 'N/A'}  — ${macdLabel}\n` +
        `BB %B:        ${ind.bollingerBands?.percentB || 'N/A'}  — ${bbLabel}\n` +
        `ATR:          ${ind.atr?.value || 'N/A'}  (${ind.atr?.percent || '?'}%)\n` +
        `Stochastic:   ${ind.stochastic?.k || '?'}/${ind.stochastic?.d || '?'} — ${stochLabel}\n` +
        `ADX:          ${ind.adx?.value || 'N/A'}  — ${adxLabel}\n` +
        `VWAP:         ${vwapLabel}\n` +
        `Volume:       ${volLabel}\n\n` +
        `EMA: ${ema9gt21 ? '9>21' : '9<21'} | ${crossLabel}`;

      bot.sendMessage(msg.chat.id, msg2, { parse_mode: 'Markdown' });
    }

    // ── Message 3: Entry/Exit + Patterns + Projections ──
    let msg3 = '';

    if (inv.entryExit) {
      const ee = inv.entryExit;
      msg3 +=
        '🎯 *ENTRY/EXIT TARGETS*\n' +
        '━━━━━━━━━━━━━━━━━━━\n' +
        `Entry Zone: $${ee.entryZone.low} \\- $${ee.entryZone.high}\n` +
        `  Ideal: $${ee.entryZone.ideal}\n\n` +
        `Stop Loss:\n` +
        `  Tight: $${ee.stopLoss.tight}\n` +
        `  Normal: $${ee.stopLoss.normal}\n\n` +
        `Take Profit:\n` +
        `  Conservative: $${ee.takeProfit.conservative}\n` +
        `  Moderate: $${ee.takeProfit.moderate}\n` +
        `  Aggressive: $${ee.takeProfit.aggressive}\n\n` +
        `Risk/Reward: ${ee.riskReward || '?'}x\n`;

      if (ee.isLeveraged) {
        msg3 += '⚠️ Leveraged ETF — day trade only\n';
      }
      msg3 += '\n';
    }

    if (inv.patterns && inv.patterns.names && inv.patterns.names.length > 0) {
      msg3 +=
        `🔎 PATTERNS: ${escapeMarkdown(inv.patterns.names.join(', '))}\n` +
        `Signal: ${inv.patterns.signal || 'HOLD'} (${inv.patterns.confidence || '?'}% confidence)\n\n`;
    }

    if (inv.projections) {
      const p = inv.projections;
      msg3 +=
        '📈 *PROJECTIONS*\n' +
        `1W: $${p.oneWeek.expected} ($${p.oneWeek.low} \\- $${p.oneWeek.high})\n` +
        `1M: $${p.oneMonth.expected} ($${p.oneMonth.low} \\- $${p.oneMonth.high})\n`;
    }

    if (msg3) {
      bot.sendMessage(msg.chat.id, msg3, { parse_mode: 'Markdown' });
    }

  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    bot.sendMessage(msg.chat.id, `❌ Investigation failed: ${errMsg}`);
  }
}

function currentPriceFmt(price) {
  if (price == null) return '?.??';
  return parseFloat(price).toFixed(2);
}

// ─── Watch Commands ──────────────────────────────────────────────────────────

async function handleWatch(msg, symbolRaw) {
  const symbol = symbolRaw.toUpperCase();

  if (watchedSymbols.has(symbol)) {
    bot.sendMessage(msg.chat.id, `Already watching ${symbol}. Use /unwatch ${symbol} to stop.`);
    return;
  }

  bot.sendMessage(msg.chat.id, `👁 Starting watch on ${symbol}...`);

  // Run initial investigation
  const initial = await runWatchCheck(symbol);
  if (!initial) {
    bot.sendMessage(msg.chat.id, `❌ Could not investigate ${symbol}. Watch not started.`);
    return;
  }

  // Store state and start interval
  const state = {
    lastScore: initial.score,
    lastVerdict: initial.verdict,
    lastPrice: initial.price,
    lastRsi: initial.rsi,
    lastPatterns: initial.patterns,
    intervalId: setInterval(() => watchTick(symbol), WATCH_INTERVAL_MS),
  };
  watchedSymbols.set(symbol, state);

  bot.sendMessage(msg.chat.id,
    `👁 *WATCHING ${escapeMarkdown(symbol)}*\n` +
    `Score: ${initial.score} | ${escapeMarkdown(initial.verdict)}\n` +
    `Price: $${currentPriceFmt(initial.price)}\n` +
    `RSI: ${initial.rsi || 'N/A'}\n\n` +
    `Checking every 5 min\\. Use /unwatch ${escapeMarkdown(symbol)} to stop\\.`,
    { parse_mode: 'Markdown' }
  );
}

async function handleUnwatch(msg, symbolRaw) {
  const symbol = symbolRaw.toUpperCase();
  const state = watchedSymbols.get(symbol);

  if (!state) {
    bot.sendMessage(msg.chat.id, `Not watching ${symbol}.`);
    return;
  }

  clearInterval(state.intervalId);
  watchedSymbols.delete(symbol);
  bot.sendMessage(msg.chat.id, `✅ Stopped watching ${symbol}.`);
}

async function handleWatchlist(msg) {
  if (watchedSymbols.size === 0) {
    bot.sendMessage(msg.chat.id, '👁 Not watching any symbols. Use /watch SYMBOL to start.');
    return;
  }

  let text = '👁 *WATCHLIST*\n━━━━━━━━━━━━━━━━\n';
  for (const [symbol, state] of watchedSymbols) {
    text +=
      `\n*${escapeMarkdown(symbol)}*\n` +
      `  Score: ${state.lastScore} | ${escapeMarkdown(state.lastVerdict || 'N/A')}\n` +
      `  Price: $${currentPriceFmt(state.lastPrice)} | RSI: ${state.lastRsi || 'N/A'}\n`;
  }

  bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function runWatchCheck(symbol) {
  try {
    const response = await axios.get(`${SERVER_URL}/api/investigate/${symbol}`, { timeout: 30000 });
    const inv = response.data.investigation;
    if (!inv) return null;

    return {
      score: inv.recommendation?.score || 0,
      verdict: inv.recommendation?.verdict || 'N/A',
      price: inv.price?.current || null,
      rsi: inv.indicators?.rsi?.value || null,
      rsiSignal: inv.indicators?.rsi?.signal || null,
      patterns: inv.patterns?.names || [],
      entryZone: inv.entryExit?.entryZone || null,
    };
  } catch (err) {
    console.log(`[Telegram] Watch check failed for ${symbol}: ${err.message}`);
    return null;
  }
}

async function watchTick(symbol) {
  const state = watchedSymbols.get(symbol);
  if (!state) return;

  const current = await runWatchCheck(symbol);
  if (!current) return;

  const alerts = [];

  // Verdict changed
  if (state.lastVerdict && current.verdict !== state.lastVerdict) {
    alerts.push(`${symbol}: ${state.lastVerdict} -> ${current.verdict} (${current.score})`);
  }

  // Score flipped sign (bearish to bullish or vice versa)
  if (state.lastScore != null && current.score != null) {
    if (state.lastScore <= 0 && current.score > 0) {
      alerts.push(`${symbol} score flipped bullish: ${state.lastScore} -> ${current.score}`);
    } else if (state.lastScore >= 0 && current.score < 0) {
      alerts.push(`${symbol} score flipped bearish: ${state.lastScore} -> ${current.score}`);
    }
  }

  // Price entered entry zone
  if (current.entryZone && current.price) {
    const { low, high } = current.entryZone;
    const wasInZone = state.lastPrice && state.lastPrice >= low && state.lastPrice <= high;
    const isInZone = current.price >= low && current.price <= high;
    if (isInZone && !wasInZone) {
      alerts.push(`${symbol} IN ENTRY ZONE: $${currentPriceFmt(current.price)} ($${currentPriceFmt(low)}-$${currentPriceFmt(high)})`);
    }
  }

  // RSI crossed 30 or 70
  if (current.rsi != null && state.lastRsi != null) {
    if (current.rsi <= 30 && state.lastRsi > 30) {
      alerts.push(`${symbol} RSI oversold: ${current.rsi}`);
    } else if (current.rsi >= 70 && state.lastRsi < 70) {
      alerts.push(`${symbol} RSI overbought: ${current.rsi}`);
    }
  }

  // New patterns detected
  if (current.patterns.length > 0) {
    const newPatterns = current.patterns.filter(p => !state.lastPatterns.includes(p));
    if (newPatterns.length > 0) {
      alerts.push(`${symbol} pattern: ${newPatterns.join(', ')}`);
    }
  }

  // Send alerts
  if (alerts.length > 0) {
    let text = `👁 *WATCH ALERT — ${escapeMarkdown(symbol)}*\n━━━━━━━━━━━━━━━━\n`;
    for (const a of alerts) {
      text += `• ${escapeMarkdown(a)}\n`;
    }
    text += `\nPrice: $${currentPriceFmt(current.price)} | Score: ${current.score}`;

    // Strong signal footer
    if (Math.abs(current.score) >= 2.5) {
      text += `\n\n➡️ /investigate ${escapeMarkdown(symbol)} for full breakdown`;
      text += `\n➡️ /trade ${escapeMarkdown(symbol)} to start auto\\-trading`;
    }

    sendAlert(text);
  }

  // Update stored state
  state.lastScore = current.score;
  state.lastVerdict = current.verdict;
  state.lastPrice = current.price;
  state.lastRsi = current.rsi;
  state.lastPatterns = current.patterns;
}

// ─── Trade Command ───────────────────────────────────────────────────────────

function handleTrade(msg, symbolRaw) {
  const symbol = symbolRaw.toUpperCase();
  const preset = aiTradingEngine.getStrategyPreset('INVESTIGATE_TRADER');

  if (!preset) {
    bot.sendMessage(msg.chat.id, '❌ INVESTIGATE_TRADER preset not found.');
    return;
  }

  const config = {
    ...preset,
    watchlist: [symbol],
    autoTrade: true,
    name: `Investigate ${symbol}`,
  };

  setPendingConfirmation(
    async () => {
      const session = aiTradingEngine.startSession('default_user', config);
      bot.sendMessage(ownerId,
        `✅ *Auto\\-trading session started*\n` +
        `Symbol: ${escapeMarkdown(symbol)}\n` +
        `Preset: Investigate\\-Based Trader\n` +
        `Session: ${escapeMarkdown(session.sessionId)}\n\n` +
        `TP: ${config.takeProfitPercent}% | SL: ${config.stopLossPercent}% | Trail: ${config.trailingStopPercent}%\n` +
        `Max position: ${config.maxPositionSizePercent}%\n` +
        `Exit before close: ${config.exitBeforeCloseMinutes}min`,
        { parse_mode: 'Markdown' }
      );
    },
    `Start auto-trading ${symbol} with Investigate-Based Trader preset?`,
    { symbol, config }
  );
}

// ─── Natural Language Handler ─────────────────────────────────────────────────

async function handleNaturalLanguage(msg) {
  const text = msg.text.toLowerCase();

  // Performance / P&L questions
  if (text.match(/how('?d| did).*go|p&?l|profit|loss|performance|how('?s| is).*doing|make.*money|lose/)) {
    return handlePerformance(msg);
  }

  // Status / overview
  if (text.match(/status|overview|how('?s| is).*account|what('?s| is).*happening|balance|equity|cash/)) {
    return handleStatus(msg);
  }

  // Positions
  if (text.match(/position|holding|what.*own|portfolio|exposure/)) {
    return handlePositions(msg);
  }

  // Sessions
  if (text.match(/session|bot|running|active|strategy|strategies/)) {
    return handleSessions(msg);
  }

  // Orders
  if (text.match(/order|trade|bought|sold|filled|execution/)) {
    return handleOrders(msg);
  }

  // Investigate / analyze a symbol
  const investigateMatch = text.match(/(?:investigate|analyze|look into|deep dive|research)\s+([A-Za-z]{1,5})/i);
  if (investigateMatch) {
    return handleInvestigate(msg, investigateMatch[1]);
  }

  // Watch a symbol
  const watchMatch = text.match(/(?:watch|track|monitor|alert)\s+([A-Za-z]{1,5})/i);
  if (watchMatch) {
    return handleWatch(msg, watchMatch[1]);
  }

  // Unwatch a symbol
  const unwatchMatch = text.match(/(?:unwatch|stop watching|stop tracking|untrack)\s+([A-Za-z]{1,5})/i);
  if (unwatchMatch) {
    return handleUnwatch(msg, unwatchMatch[1]);
  }

  // Watchlist
  if (text.match(/what.*watching|watchlist|tracked|monitoring/)) {
    return handleWatchlist(msg);
  }

  // Trade a symbol
  const tradeAutoMatch = text.match(/(?:auto.?trade|trade)\s+([A-Za-z]{1,5})/i);
  if (tradeAutoMatch) {
    return handleTrade(msg, tradeAutoMatch[1]);
  }

  // Market status
  if (text.match(/market.*(open|close|hour)|trading.*(open|close|hour)/)) {
    const isOpen = aiTradingEngine.isMarketOpen();
    const emoji = isOpen ? '🟢' : '🔴';
    return bot.sendMessage(msg.chat.id, `${emoji} Market is currently ${isOpen ? 'OPEN' : 'CLOSED'}`);
  }

  // Greetings
  if (text.match(/^(hey|hi|hello|yo|sup|what'?s up|gm)/)) {
    return handleStatus(msg);
  }

  // Fallback
  bot.sendMessage(msg.chat.id,
    'I can understand things like:\n' +
    '• "how\'d it go today?" → performance\n' +
    '• "what am I holding?" → positions\n' +
    '• "how are the bots doing?" → sessions\n' +
    '• "any trades today?" → recent orders\n' +
    '• "what\'s the balance?" → account status\n' +
    '• "investigate SOXL" → deep analysis\n' +
    '• "watch SOXL" → start monitoring\n' +
    '• "what am I watching?" → watchlist\n' +
    '• "trade SOXL" → start auto-trading\n\n' +
    'Or use /help for all commands.'
  );
}

// ─── Write Commands (require confirmation) ───────────────────────────────────

function setPendingConfirmation(action, description, params) {
  // Clear any existing timeout
  if (pendingConfirmation && pendingConfirmation.timeout) {
    clearTimeout(pendingConfirmation.timeout);
  }

  pendingConfirmation = {
    action,
    description,
    params,
    timestamp: Date.now(),
    timeout: setTimeout(() => {
      pendingConfirmation = null;
      bot.sendMessage(ownerId, '⏰ Confirmation expired. Command cancelled.');
    }, 60000),
  };

  bot.sendMessage(ownerId,
    `⚠️ *Confirm:* ${description}\n\nReply /yes or /no (expires in 60s)`,
    { parse_mode: 'Markdown' }
  );
}

async function handleConfirm(msg) {
  if (!pendingConfirmation) {
    bot.sendMessage(msg.chat.id, 'No pending command to confirm.');
    return;
  }

  const { action, params } = pendingConfirmation;
  clearTimeout(pendingConfirmation.timeout);
  pendingConfirmation = null;

  try {
    await action(params);
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
}

async function handleCancel(msg) {
  if (pendingConfirmation) {
    clearTimeout(pendingConfirmation.timeout);
    pendingConfirmation = null;
    bot.sendMessage(msg.chat.id, '❌ Command cancelled.');
  } else {
    bot.sendMessage(msg.chat.id, 'Nothing to cancel.');
  }
}

function handleBuy(msg, match) {
  const symbol = match[1].toUpperCase();
  const qty = parseInt(match[2]);

  setPendingConfirmation(
    async () => {
      const order = await alpacaClient.placeOrder({
        symbol, qty, side: 'buy', type: 'market', time_in_force: 'day',
      });
      bot.sendMessage(ownerId,
        `✅ Order placed: BUY ${qty}x ${symbol}\n` +
        `Order ID: ${order.id}\nStatus: ${order.status}`
      );
    },
    `BUY ${qty}x ${symbol} at market?`,
    { symbol, qty, side: 'buy' }
  );
}

function handleSell(msg, match) {
  const symbol = match[1].toUpperCase();
  const qty = parseInt(match[2]);

  setPendingConfirmation(
    async () => {
      const order = await alpacaClient.placeOrder({
        symbol, qty, side: 'sell', type: 'market', time_in_force: 'day',
      });
      bot.sendMessage(ownerId,
        `✅ Order placed: SELL ${qty}x ${symbol}\n` +
        `Order ID: ${order.id}\nStatus: ${order.status}`
      );
    },
    `SELL ${qty}x ${symbol} at market?`,
    { symbol, qty, side: 'sell' }
  );
}

function handleClose(msg, match) {
  const symbol = match[1].toUpperCase();

  setPendingConfirmation(
    async () => {
      await alpacaClient.closePosition(symbol);
      bot.sendMessage(ownerId, `✅ Position closed: ${symbol}`);
    },
    `CLOSE entire ${symbol} position?`,
    { symbol }
  );
}

function handlePause(msg, match) {
  const nameQuery = match[1].trim();
  const session = findSession(nameQuery);

  if (!session) {
    bot.sendMessage(msg.chat.id, `❌ No session matching "${nameQuery}"`);
    return;
  }

  setPendingConfirmation(
    async () => {
      await aiTradingEngine.pauseSession(session.sessionId);
      bot.sendMessage(ownerId, `⏸ Session paused: ${session.name || session.sessionId}`);
    },
    `PAUSE session "${session.name || session.sessionId}"?`,
    { sessionId: session.sessionId }
  );
}

function handleResume(msg, match) {
  const nameQuery = match[1].trim();
  const session = findSession(nameQuery);

  if (!session) {
    bot.sendMessage(msg.chat.id, `❌ No session matching "${nameQuery}"`);
    return;
  }

  setPendingConfirmation(
    async () => {
      await aiTradingEngine.resumeSession(session.sessionId);
      bot.sendMessage(ownerId, `▶️ Session resumed: ${session.name || session.sessionId}`);
    },
    `RESUME session "${session.name || session.sessionId}"?`,
    { sessionId: session.sessionId }
  );
}

function handleStop(msg, match) {
  const nameQuery = match[1].trim();
  const session = findSession(nameQuery);

  if (!session) {
    bot.sendMessage(msg.chat.id, `❌ No session matching "${nameQuery}"`);
    return;
  }

  setPendingConfirmation(
    async () => {
      await aiTradingEngine.stopSession(session.sessionId);
      bot.sendMessage(ownerId, `⏹ Session stopped: ${session.name || session.sessionId}`);
    },
    `STOP session "${session.name || session.sessionId}" permanently?`,
    { sessionId: session.sessionId }
  );
}

function handleKill(msg) {
  setPendingConfirmation(
    async () => {
      const sessions = aiTradingEngine.getAllUserSessions('default_user');
      const runningSessions = sessions.filter(s => s.status === 'running' || s.status === 'paused');
      let closed = 0;

      for (const s of runningSessions) {
        try {
          await aiTradingEngine.panicSell(s.sessionId);
          closed++;
        } catch (err) {
          console.log(`[Telegram] Kill failed for ${s.sessionId}: ${err.message}`);
        }
      }

      // Also close any positions not managed by sessions
      try {
        await alpacaClient.closeAllPositions();
      } catch (err) {
        console.log(`[Telegram] closeAllPositions error: ${err.message}`);
      }

      bot.sendMessage(ownerId,
        `🚨 KILL executed\n` +
        `Panic-sold ${closed} sessions\n` +
        `Closed all remaining positions`
      );
    },
    `🚨 EMERGENCY KILL — close ALL positions across ALL sessions?`,
    {}
  );
}

function handleCap(msg, match) {
  const capPct = parseInt(match[1]);

  if (capPct < 1 || capPct > 100) {
    bot.sendMessage(msg.chat.id, '❌ Cap must be between 1 and 100.');
    return;
  }

  setPendingConfirmation(
    async () => {
      const sessions = aiTradingEngine.getAllUserSessions('default_user');
      const runningSessions = sessions.filter(s => s.status === 'running' || s.status === 'paused');
      let updated = 0;

      for (const s of runningSessions) {
        try {
          await aiTradingEngine.updateConfig(s.sessionId, {
            MAX_AGGREGATE_EXPOSURE_PCT: capPct / 100,
          });
          updated++;
        } catch (err) {
          console.log(`[Telegram] Cap update failed for ${s.sessionId}: ${err.message}`);
        }
      }

      bot.sendMessage(ownerId,
        `✅ Exposure cap set to ${capPct}% across ${updated} sessions`
      );
    },
    `Set max exposure to ${capPct}% across all active sessions?`,
    { capPct }
  );
}

// ─── Session Finder (fuzzy match) ────────────────────────────────────────────

function findSession(query) {
  const sessions = aiTradingEngine.getAllUserSessions('default_user');
  const q = query.toLowerCase();

  // Exact sessionId match
  let found = sessions.find(s => s.sessionId === query);
  if (found) return found;

  // Name starts with query
  found = sessions.find(s => (s.name || '').toLowerCase().startsWith(q));
  if (found) return found;

  // Name contains query
  found = sessions.find(s => (s.name || '').toLowerCase().includes(q));
  if (found) return found;

  // SessionId contains query
  found = sessions.find(s => s.sessionId.toLowerCase().includes(q));
  return found || null;
}

// ─── Real-Time Alerts ────────────────────────────────────────────────────────

function sendAlert(message) {
  if (!bot || !ownerId) return;
  bot.sendMessage(ownerId, message, { parse_mode: 'Markdown' }).catch(err => {
    console.log(`[Telegram] Alert send failed: ${err.message}`);
  });
}

function shouldThrottle(key) {
  const lastTime = alertThrottle.get(key);
  const now = Date.now();
  if (lastTime && (now - lastTime) < THROTTLE_MS) return true;
  alertThrottle.set(key, now);
  return false;
}

function hookIntoEvents(io) {
  if (!io || !bot || !ownerId) return;

  io.on('connection', (socket) => {
    // Trade executions
    socket.on('trade_executed', (data) => {
      const key = `trade_${data.symbol}_${data.side}`;
      if (shouldThrottle(key)) return;

      const emoji = data.side === 'buy' ? '🟢' : '🔴';
      const text =
        `${emoji} *TRADE EXECUTED*\n` +
        `${data.side.toUpperCase()} ${data.quantity}x ${data.symbol} @ ${formatMoney(data.price)}\n` +
        (data.sessionName ? `Session: ${escapeMarkdown(data.sessionName)}\n` : '') +
        (data.pnl ? `P&L: ${formatMoney(data.pnl)}` : '');

      sendAlert(text);
    });

    // AI decisions
    socket.on('ai_decision', (data) => {
      if (data.action === 'HOLD') return; // Don't spam HOLD decisions
      const key = `decision_${data.symbol}`;
      if (shouldThrottle(key)) return;

      const text =
        `🧠 *AI SIGNAL*\n` +
        `${data.action} ${data.symbol}\n` +
        (data.confidence ? `Confidence: ${Math.round(data.confidence * 100)}%\n` : '') +
        (data.reason ? `Reason: ${escapeMarkdown(data.reason)}` : '');

      sendAlert(text);
    });

    // System alerts
    socket.on('alert', (data) => {
      if (data.type === 'info') return; // Skip info-level
      const key = `alert_${data.type}`;
      if (shouldThrottle(key)) return;

      const emoji = data.type === 'error' ? '🚨' : data.type === 'warning' ? '⚠️' : '📢';
      const text = `${emoji} *ALERT*\n${escapeMarkdown(data.message || data.title || 'System alert')}`;
      sendAlert(text);
    });
  });

  console.log('[Telegram] Hooked into WebSocket events for alerts');
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function formatMoney(n) {
  if (n == null || isNaN(n)) return '$0.00';
  const sign = n < 0 ? '-' : n > 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(n) {
  if (n == null || isNaN(n)) return '0.0%';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

function shutdown() {
  // Clear all watch intervals
  for (const [symbol, state] of watchedSymbols) {
    clearInterval(state.intervalId);
  }
  watchedSymbols.clear();

  if (bot) {
    bot.stopPolling();
    console.log('[Telegram] Bot stopped');
  }
}

module.exports = { initialize, sendAlert, hookIntoEvents, shutdown };
