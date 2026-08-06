/**
 * Telegram options commands — the Simple-mode cards, in chat.
 *
 *   /options [n]      top n picks from the options scanner as plain cards
 *   /optbuy i [qty]   buy card #i (limit order, /yes confirmation)
 *   /optpositions     open option positions vs their entry cards + advice
 *   /optsell i [qty]  sell position #i (limit at bid, /yes confirmation)
 *
 * Registered by telegramBot.initialize(); shares its owner-auth and
 * /yes-confirmation machinery. Orders go to the shared Alpaca paper account
 * via alpacaClient.placeOrder (same path the stock /buy command uses).
 *
 * Card language comes from react-client/src/utils/optionsPlainLanguage.js —
 * the SAME module the web Simple mode renders from (CJS on purpose).
 */

const fs = require('fs');
const path = require('path');
const alpacaClient = require('./alpacaClient');
const alpacaOptions = require('./alpacaOptionsClient');
const { runOptionsScan } = require('./scanner/optionsScanRunner');
const scanStore = require('./scanner/scanStore');
const { parseOccSymbol, horizonCalendarDays } = require('./scanner/optionsPricingModel');
const lang = require('../react-client/src/utils/optionsPlainLanguage');

const POSITIONS_FILE = path.join(__dirname, '..', 'data', 'options-positions.json');
const SCAN_REUSE_MS = 10 * 60 * 1000;
const MAX_CARDS = 10;
const DAY_MS = 86400000;

let lastBoard = null; // { rows, generatedAt } — indexes for /optbuy
let lastPositions = null; // rows shown by /optpositions — indexes for /optsell

// ─── Position store (entry-card snapshots) ───────────────────────────────────

function _loadStore() {
  try {
    return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function _saveStore(entries) {
  fs.writeFileSync(POSITIONS_FILE, JSON.stringify(entries, null, 2));
}

function _storeEntry(occSymbol) {
  // Latest open entry wins if the same contract was bought twice.
  return _loadStore().filter(e => e.occSymbol === occSymbol && e.status === 'open').pop() || null;
}

// ─── Option order helpers ────────────────────────────────────────────────────

/** Alpaca option limit-price ticks: $0.01 under $3 premium, $0.05 above. */
function roundToTick(price, direction) {
  const tick = price < 3 ? 0.01 : 0.05;
  const fn = direction === 'up' ? Math.ceil : Math.floor;
  return +(fn(price / tick) * tick).toFixed(2);
}

async function _liveQuote(occSymbol) {
  const res = await alpacaOptions.getSnapshotsBySymbols([occSymbol]);
  const snap = res.snapshots?.[occSymbol];
  const bid = snap?.latestQuote?.bp;
  const ask = snap?.latestQuote?.ap;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask <= 0) return null;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ─── Card rendering (Telegram flavor of the Simple-mode card) ────────────────

function renderCard(row, index) {
  const payout = lang.payoutIfHit(row);
  const tier = lang.riskTier(row);
  const worst = lang.worstCase(row);
  const warnings = lang.plainWarnings(row);
  const dirWord = row.direction === 'LONG' ? 'GOES UP' : 'GOES DOWN';

  const stockPrice = row.live?.stockPrice ?? row.underlyingPrice;
  const gap = lang.breakevenGap(row, stockPrice);
  const swingLine = lang.pricedForSwing(row);
  const dots = lang.dotsEmoji(row.recentDays);

  let text =
    `*#${index + 1} ${row.underlying} — ${dirWord}*  [${tier.label}]\n` +
    `The bet: ${lang.betSentence(row)}\n` +
    `${row.underlying} now $${Number.isFinite(stockPrice) ? stockPrice.toFixed(2) : '?'}` +
    `${gap.phrase ? ` — ${gap.phrase}` : ''}\n\n` +
    `Ticket price: ${lang.fmtMoney(row.costPerContract)}\n` +
    `If it hits: ~${lang.fmtMoney(payout.dollars)} back (${payout.multiple.toFixed(1)}x)\n` +
    `Our estimate: ${Math.round(row.popModel * 100)}% · market says ${Math.round(row.popMarket * 100)}%\n` +
    `${lang.oddsPhrase(row)}\n` +
    (swingLine ? `${swingLine}\n` : '') +
    `\n${worst.sentence}\n`;

  for (const w of warnings) {
    text += `${w.level === 'high' ? '❗' : '•'} ${w.text}\n`;
  }

  if (dots) text += `${dots}  last ${row.recentDays.length} days\n`;
  text += `${lang.expiresIn(row)}\n\n→ /optbuy ${index + 1} to buy 1 contract (${lang.fmtMoney(row.costPerContract)})`;
  return text;
}

// ─── Sell/hold recommendation ────────────────────────────────────────────────

function recommend({ card, stockPrice, boughtAt, horizonDays, dte }) {
  const isCall = card.type === 'call';
  if (Number.isFinite(stockPrice)) {
    const hitTarget = isCall ? stockPrice >= card.targetPrice : stockPrice <= card.targetPrice;
    const hitStop = isCall ? stockPrice <= card.stopPrice : stockPrice >= card.stopPrice;
    if (hitTarget) return { verdict: 'SELL', reason: `Take the win — ${card.underlying} hit the target (${lang.fmtLevel(card.targetPrice)}).` };
    if (hitStop) return { verdict: 'SELL', reason: `Cut it — ${card.underlying} hit the stop (${lang.fmtLevel(card.stopPrice)}). The thesis failed.` };
  }
  const planExitMs = Date.parse(boughtAt) + horizonCalendarDays(horizonDays || 5) * DAY_MS;
  if (Date.now() > planExitMs) {
    return { verdict: 'SELL', reason: `Time's up — the plan was to be out by ${lang.fmtShortDate(new Date(planExitMs).toISOString().slice(0, 10))}. Edges fade past the plan.` };
  }
  if (dte <= 3) {
    return { verdict: 'SELL', reason: `Expires in ${dte} day${dte === 1 ? '' : 's'} — time decay is brutal from here.` };
  }
  const daysLeft = Math.ceil((planExitMs - Date.now()) / DAY_MS);
  return { verdict: 'HOLD', reason: `Thesis still open. Planned exit in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` };
}

// ─── Command handlers ────────────────────────────────────────────────────────

async function handleOptions(bot, msg, countRaw) {
  const count = Math.min(Math.max(parseInt(countRaw, 10) || 5, 1), MAX_CARDS);
  bot.sendMessage(msg.chat.id, '🔎 Scanning the options board…');

  try {
    let scan = scanStore.loadLatest('options-scan');
    const fresh = scan && Date.now() - Date.parse(scan.generatedAt) < SCAN_REUSE_MS
      && (scan.opportunities || []).length > 0;
    if (!fresh) {
      scan = await runOptionsScan({});
    }

    const rows = (scan.opportunities || []).slice(0, count);
    if (!rows.length) {
      bot.sendMessage(msg.chat.id,
        'Nothing worth betting on right now. Most options are bad bets — we only surface the good ones. Try again after the market moves.');
      return;
    }

    lastBoard = { rows, generatedAt: scan.generatedAt, horizonDays: scan.horizonDays };

    const staleNote = scan.marketLikelyClosed
      ? '\n⚠️ Market looks closed — prices are from the last session.'
      : '';
    await bot.sendMessage(msg.chat.id,
      `*🎯 TOP ${rows.length} OPTION PICKS*\n` +
      `Ranked by expected payoff vs cost. Every number already accounts for fees-in-spirit (spread) and time decay.${staleNote}`,
      { parse_mode: 'Markdown' });

    for (let i = 0; i < rows.length; i++) {
      await bot.sendMessage(msg.chat.id, renderCard(rows[i], i), { parse_mode: 'Markdown' });
    }
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Options scan failed: ${err.message}`);
  }
}

function handleOptBuy(bot, msg, ctx, indexRaw, qtyRaw) {
  const index = parseInt(indexRaw, 10) - 1;
  const qty = Math.min(Math.max(parseInt(qtyRaw, 10) || 1, 1), 10);

  if (!lastBoard || !lastBoard.rows[index]) {
    bot.sendMessage(msg.chat.id, 'No card with that number. Run /options first.');
    return;
  }
  const card = lastBoard.rows[index];
  if (Date.now() - Date.parse(lastBoard.generatedAt) > 30 * 60 * 1000) {
    bot.sendMessage(msg.chat.id, 'That board is over 30 minutes old — run /options again for fresh prices before buying.');
    return;
  }

  ctx.setPendingConfirmation(
    async () => {
      const quote = await _liveQuote(card.contractSymbol);
      if (!quote) {
        bot.sendMessage(ctx.ownerId, `❌ No live quote for ${card.contractSymbol} — market may be closed.`);
        return;
      }
      // Same fill model as the scanner: mid plus half the half-spread,
      // rounded up to a valid tick so it's actually marketable.
      const limit = roundToTick(quote.mid + 0.25 * (quote.ask - quote.bid), 'up');
      const order = await alpacaClient.placeOrder({
        symbol: card.contractSymbol,
        qty,
        side: 'buy',
        type: 'limit',
        limit_price: limit,
        time_in_force: 'day',
      });

      const entries = _loadStore();
      entries.push({
        occSymbol: card.contractSymbol,
        qty,
        card,
        horizonDays: lastBoard.horizonDays,
        orderId: order.id,
        limitPrice: limit,
        boughtAt: new Date().toISOString(),
        status: 'open',
      });
      _saveStore(entries);

      bot.sendMessage(ctx.ownerId,
        `✅ Order placed: BUY ${qty}x ${card.contractSymbol}\n` +
        `Limit ${lang.fmtMoney(limit * 100)}/contract (${lang.fmtMoney(limit * 100 * qty)} total)\n` +
        `Status: ${order.status}\n\n` +
        `The bet: ${lang.betSentence(card)}\n` +
        `Check on it anytime with /optpositions`);
    },
    `BUY ${qty}x ${card.underlying} ${card.type.toUpperCase()} $${card.strike} exp ${card.expiration} ` +
    `(~${lang.fmtMoney(card.costPerContract * qty)} total, max loss)?`,
    { occSymbol: card.contractSymbol, qty }
  );
}

async function handleOptPositions(bot, msg) {
  try {
    const positions = (await alpacaClient.getPositions())
      .filter(p => p.asset_class === 'us_option');

    if (!positions.length) {
      lastPositions = null;
      bot.sendMessage(msg.chat.id, '📭 No open option positions. Find one with /options');
      return;
    }

    const marks = await alpacaOptions.getSnapshotsBySymbols(positions.map(p => p.symbol));
    lastPositions = [];
    let text = '*📂 OPEN OPTION BETS*\n';

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const meta = parseOccSymbol(p.symbol) || {};
      const entry = _storeEntry(p.symbol);
      const card = entry?.card;
      const qty = parseInt(p.qty, 10);
      const costBasis = parseFloat(p.avg_entry_price) * 100 * qty;
      const value = parseFloat(p.market_value);
      const pl = parseFloat(p.unrealized_pl);
      const plPct = parseFloat(p.unrealized_plpc) * 100;
      const dte = meta.expiration
        ? Math.max(Math.round((Date.parse(`${meta.expiration}T00:00:00Z`) - Date.now()) / DAY_MS), 0)
        : null;

      let stockPrice = null;
      try {
        // getSnapshot returns a NORMALIZED shape: { price, last, close }
        const snap = await alpacaClient.getSnapshot(meta.underlying);
        stockPrice = snap?.price ?? snap?.last ?? snap?.close ?? null;
      } catch { /* recommendation degrades gracefully */ }

      const rec = card
        ? recommend({ card, stockPrice, boughtAt: entry.boughtAt, horizonDays: entry.horizonDays, dte })
        : null;

      lastPositions.push({ position: p, meta, entry, dte });

      const emoji = pl >= 0 ? '🟢' : '🔴';
      text +=
        `\n${emoji} *#${i + 1} ${meta.underlying || p.symbol}* ${meta.type === 'put' ? 'PUT' : 'CALL'} ` +
        `$${meta.strike} · exp ${lang.fmtShortDate(meta.expiration)}${dte != null ? ` (${dte}d left)` : ''}\n` +
        `   ${qty} contract${qty === 1 ? '' : 's'} · paid ${lang.fmtMoney(costBasis)} → now ${lang.fmtMoney(value)} ` +
        `(${pl >= 0 ? '+' : ''}${lang.fmtMoney(pl)}, ${plPct >= 0 ? '+' : ''}${plPct.toFixed(0)}%)\n`;

      if (card) {
        const payout = lang.payoutIfHit(card);
        text += `   The card said: cost ${lang.fmtMoney(card.costPerContract * qty)}, ` +
          `~${lang.fmtMoney(payout.dollars * qty)} if it hits\n`;
      }
      if (rec) {
        text += `   ${rec.verdict === 'SELL' ? '⚠️ *SELL*' : '✋ *HOLD*'} — ${rec.reason}\n`;
      }
      text += `   → /optsell ${i + 1} to sell\n`;
    }

    const mark = marks.error ? '\n(live marks unavailable — showing broker values)' : '';
    bot.sendMessage(msg.chat.id, text + mark, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
}

function handleOptSell(bot, msg, ctx, indexRaw, qtyRaw) {
  const index = parseInt(indexRaw, 10) - 1;

  if (!lastPositions || !lastPositions[index]) {
    bot.sendMessage(msg.chat.id, 'No position with that number. Run /optpositions first.');
    return;
  }
  const { position, meta, entry } = lastPositions[index];
  const held = parseInt(position.qty, 10);
  const qty = Math.min(Math.max(parseInt(qtyRaw, 10) || held, 1), held);

  ctx.setPendingConfirmation(
    async () => {
      const quote = await _liveQuote(position.symbol);
      const value = parseFloat(position.market_value);
      // Marketable limit just inside the bid; falls back to broker mark.
      const limit = quote ? roundToTick(Math.max(quote.bid, 0.01), 'down') : null;
      if (!limit) {
        bot.sendMessage(ctx.ownerId, `❌ No live bid for ${position.symbol} — market may be closed. Not selling blind.`);
        return;
      }

      const order = await alpacaClient.placeOrder({
        symbol: position.symbol,
        qty,
        side: 'sell',
        type: 'limit',
        limit_price: limit,
        time_in_force: 'day',
      });

      if (entry && qty >= held) {
        const entries = _loadStore();
        const idx = entries.findIndex(e => e.occSymbol === entry.occSymbol && e.status === 'open');
        if (idx >= 0) {
          entries[idx].status = 'closed';
          entries[idx].soldAt = new Date().toISOString();
          entries[idx].sellOrderId = order.id;
        }
        _saveStore(entries);
      }

      bot.sendMessage(ctx.ownerId,
        `✅ Order placed: SELL ${qty}x ${position.symbol}\n` +
        `Limit ${lang.fmtMoney(limit * 100)}/contract (~${lang.fmtMoney(limit * 100 * qty)} total)\n` +
        `Status: ${order.status}\n` +
        `(broker marked it ${lang.fmtMoney(value)})`);
    },
    (() => {
      const value = parseFloat(position.market_value);
      const cost = parseFloat(position.avg_entry_price) * 100 * held;
      let desc = `SELL ${qty}x ${meta.underlying} ${meta.type === 'put' ? 'PUT' : 'CALL'} $${meta.strike} — ` +
        `now worth ~${lang.fmtMoney(value)} (paid ${lang.fmtMoney(cost)})`;
      if (entry?.card) {
        const payout = lang.payoutIfHit(entry.card);
        desc += `; if held and it hits, the card modeled ~${lang.fmtMoney(payout.dollars * held)}`;
      }
      return desc + '?';
    })(),
    { occSymbol: position.symbol, qty }
  );
}

async function handleOptRecord(bot, msg) {
  try {
    const { getReport } = require('./scanner/optionsTrackRecord');
    const report = await getReport({ limit: 10 });
    const s = report.summary;

    let text = '*📊 PICK TRACK RECORD*\n';
    if (s.graded > 0) {
      text +=
        `${s.wins}W / ${s.losses}L — ${Math.round(s.winRate * 100)}% win rate\n` +
        `Avg per bet: ${s.avgReturnPct >= 0 ? '+' : ''}${Math.round(s.avgReturnPct * 100)}% · ` +
        `total ${lang.fmtMoney(s.totalPlPerContract)}/contract\n`;
      if (s.calibration) {
        text += `We predicted ${Math.round(s.calibration.predictedWinRate * 100)}% — reality ${Math.round(s.calibration.realizedWinRate * 100)}%\n`;
      }
      if (s.playbooks) {
        const pb = s.playbooks;
        text +=
          `\n*Playbook test* (${pb.comparablePicks} picks, two ways):\n` +
          `Sell on stops: ${Math.round(pb.withStops.winRate * 100)}% win, avg ${pb.withStops.avgReturnPct >= 0 ? '+' : ''}${Math.round(pb.withStops.avgReturnPct * 100)}%\n` +
          `Hold to plan: ${Math.round(pb.holdToPlan.winRate * 100)}% win, avg ${pb.holdToPlan.avgReturnPct >= 0 ? '+' : ''}${Math.round(pb.holdToPlan.avgReturnPct * 100)}%\n` +
          `${pb.verdict}\n`;
      }
      if (s.attribution?.whenStockWon) {
        const a = s.attribution;
        text +=
          `\n*Direction vs vehicle:*\n` +
          `Stock call right on ${Math.round(a.stockLegWinRate * 100)}% of ${a.picks} picks\n` +
          `When right, option won ${Math.round(a.whenStockWon.optionWinRate * 100)}% ` +
          `(avg ${a.whenStockWon.avgOptionReturnPct >= 0 ? '+' : ''}${Math.round(a.whenStockWon.avgOptionReturnPct * 100)}%) — the rest is theta \\+ spread\n`;
      }
    } else {
      text += `${s.totalPicks} picks recorded, none graded yet` +
        (s.nextGradeDate ? ` — first results after ${lang.fmtShortDate(s.nextGradeDate)}` : '') + '\n';
    }
    if (s.open > 0) text += `${s.open} picks still open\n`;

    const shown = report.picks.slice(0, 8);
    if (shown.length) text += '\n*Recent picks:*\n';
    for (const p of shown) {
      const icon = p.status === 'win' ? '✅' : p.status === 'loss' ? '❌' : '⏳';
      const pct = p.status === 'open' ? p.openMark?.returnPct : p.exit?.returnPct;
      const tail = pct != null
        ? ` ${p.status === 'open' ? 'so far ' : ''}${pct >= 0 ? '+' : ''}${Math.round(pct * 100)}%`
        : '';
      text += `${icon} ${lang.betSentence(p.card)} (in ${lang.fmtMoney(p.card.costPerContract)})${tail}\n`;
    }

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * @param {object} ctx { bot, isOwner, setPendingConfirmation, ownerId }
 */
function register(ctx) {
  const { bot, isOwner } = ctx;

  bot.onText(/^\/options(?:\s+(\d+))?$/i, (msg, match) =>
    isOwner(msg) && handleOptions(bot, msg, match[1]));
  bot.onText(/^\/optbuy\s+(\d+)(?:\s+(\d+))?$/i, (msg, match) =>
    isOwner(msg) && handleOptBuy(bot, msg, ctx, match[1], match[2]));
  bot.onText(/^\/optpositions$/i, (msg) =>
    isOwner(msg) && handleOptPositions(bot, msg));
  bot.onText(/^\/optsell\s+(\d+)(?:\s+(\d+))?$/i, (msg, match) =>
    isOwner(msg) && handleOptSell(bot, msg, ctx, match[1], match[2]));
  bot.onText(/^\/optrecord$/i, (msg) =>
    isOwner(msg) && handleOptRecord(bot, msg));

  console.log('[Telegram] Options commands registered (/options, /optbuy, /optpositions, /optsell, /optrecord)');
}

module.exports = { register, renderCard, recommend, roundToTick };
