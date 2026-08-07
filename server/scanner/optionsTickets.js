/**
 * Real option tickets — buying a card for real (paper account) and having
 * the system manage it by the playbook the ledger proved out.
 *
 * Management discipline = HOLD TO PLAN: the track record shows selling on
 * stop touches lost ~11pp vs holding (stops kept selling bottoms), so a
 * ticket's only automatic exit is its plan date (horizon end, or the day
 * before expiry, whichever comes first). No stop-outs. Your debit is your
 * stop. Kill switch: OPTIONS_TICKETS_AUTO=off disables auto-exits.
 *
 * Shares data/options-positions.json with the Telegram /optbuy flow so
 * both surfaces see the same tickets. Every fill is joined back to the
 * matching ledger pick (actualFill) — real-stakes learning + slippage.
 */

const fs = require('fs');
const path = require('path');
const alpacaClient = require('../alpacaClient');
const alpacaOptions = require('../alpacaOptionsClient');
const { horizonCalendarDays } = require('./optionsPricingModel');

const STORE_FILE = path.join(__dirname, '..', '..', 'data', 'options-positions.json');
const DAY_MS = 86400000;

function _load() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return []; }
}
function _save(entries) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(entries, null, 2));
}
function _dateStr(ms) { return new Date(ms).toISOString().slice(0, 10); }

/** Alpaca option limit ticks: $0.01 under $3, $0.05 above. */
function roundToTick(price, direction) {
  const tick = price < 3 ? 0.01 : 0.05;
  const fn = direction === 'up' ? Math.ceil : Math.floor;
  return +(fn(price / tick) * tick).toFixed(2);
}

function planExitDateFor(card, horizonDays, boughtAtMs) {
  const hCal = horizonCalendarDays(horizonDays || 5);
  const dayBeforeExpiry = Date.parse(`${card.expiration}T00:00:00Z`) - DAY_MS;
  return _dateStr(Math.min(boughtAtMs + hCal * DAY_MS, dayBeforeExpiry));
}

async function _liveQuote(occSymbol) {
  const res = await alpacaOptions.getSnapshotsBySymbols([occSymbol], 15 * 1000);
  const q = res.snapshots?.[occSymbol]?.latestQuote;
  if (!q || !Number.isFinite(q.bp) || !Number.isFinite(q.ap) || q.ap <= 0) return null;
  return { bid: q.bp, ask: q.ap, mid: (q.bp + q.ap) / 2 };
}

/**
 * Buy a card for real: marketable limit at the live quote (same fill model
 * the scanner prices with), recorded with the full card snapshot so the
 * learning loop can grade the real trade against the modeled one.
 */
async function buyTicket({ card, horizonDays, qty = 1, source = 'web' }) {
  if (!card?.contractSymbol) throw new Error('card with contractSymbol required');
  qty = Math.min(Math.max(parseInt(qty, 10) || 1, 1), 10);

  const quote = await _liveQuote(card.contractSymbol);
  if (!quote) throw new Error('No live quote — market may be closed');
  const limit = roundToTick(quote.mid + 0.25 * (quote.ask - quote.bid), 'up');

  const order = await alpacaClient.placeOrder({
    symbol: card.contractSymbol,
    qty,
    side: 'buy',
    type: 'limit',
    limit_price: limit,
    time_in_force: 'day',
  });

  const boughtAt = new Date().toISOString();
  const ticket = {
    id: `tkt-${Date.now()}-${card.contractSymbol}`,
    occSymbol: card.contractSymbol,
    qty,
    card,
    horizonDays: horizonDays || 5,
    planExitDate: planExitDateFor(card, horizonDays, Date.now()),
    orderId: order.id,
    limitPrice: limit,
    boughtAt,
    status: 'open',
    source,
  };
  const entries = _load();
  entries.push(ticket);
  _save(entries);
  return { ticket, order };
}

/** Sell (marketable limit just inside the bid). reason lands in the record. */
async function sellTicket(ticketId, { reason = 'manual' } = {}) {
  const entries = _load();
  const ticket = entries.find(t => (t.id || t.occSymbol) === ticketId && t.status === 'open');
  if (!ticket) throw new Error('open ticket not found');

  const positions = await alpacaClient.getPositions();
  const pos = positions.find(p => p.symbol === ticket.occSymbol);
  if (!pos || parseInt(pos.qty, 10) < 1) {
    // Order never filled (or already flat) — close the record honestly.
    ticket.status = 'closed';
    ticket.exitReason = 'neverFilled';
    ticket.soldAt = new Date().toISOString();
    _save(entries);
    return { ticket, order: null };
  }

  const quote = await _liveQuote(ticket.occSymbol);
  if (!quote) throw new Error('No live bid — not selling blind');
  const qty = Math.min(ticket.qty, parseInt(pos.qty, 10));
  const limit = roundToTick(Math.max(quote.bid, 0.01), 'down');

  const order = await alpacaClient.placeOrder({
    symbol: ticket.occSymbol,
    qty,
    side: 'sell',
    type: 'limit',
    limit_price: limit,
    time_in_force: 'day',
  });

  ticket.status = 'closing';
  ticket.sellOrderId = order.id;
  ticket.soldAt = new Date().toISOString();
  ticket.exitReason = reason;
  ticket.sellLimit = limit;
  _save(entries);
  return { ticket, order };
}

/** Join a filled buy back to the matching ledger pick (real-stakes learning). */
function _joinFillToLedger(ticket, fillPrice) {
  try {
    const trackRecord = require('./optionsTrackRecord');
    const picks = JSON.parse(fs.readFileSync(trackRecord.STORE_FILE, 'utf8'));
    const day = ticket.boughtAt.slice(0, 10);
    const pick = picks.find(p => p.card.contractSymbol === ticket.occSymbol && p.recordedAt.slice(0, 10) === day);
    if (pick && pick.actualFill == null) {
      pick.actualFill = fillPrice;
      pick.modeledFill = ticket.card.entryDebit;
      pick.fillSlippagePct = ticket.card.entryDebit > 0
        ? +((fillPrice - ticket.card.entryDebit) / ticket.card.entryDebit).toFixed(4)
        : null;
      fs.writeFileSync(trackRecord.STORE_FILE, JSON.stringify(picks, null, 2));
    }
  } catch { /* learning join is best-effort */ }
}

/**
 * Open + closed tickets with live P&L from broker truth (positions +
 * order fills), for the My Tickets UI and Telegram alike.
 */
async function listTickets() {
  const entries = _load();
  if (!entries.length) return { open: [], closed: [] };

  const [positions, marks] = await Promise.all([
    alpacaClient.getPositions().catch(() => []),
    alpacaOptions.getSnapshotsBySymbols(
      entries.filter(t => t.status === 'open' || t.status === 'closing').map(t => t.occSymbol)
    ),
  ]);
  const posBySym = new Map(positions.map(p => [p.symbol, p]));

  let dirty = false;
  for (const t of entries) {
    if ((t.status === 'open' || t.status === 'closing') && t.orderId && t.fillPrice == null) {
      try {
        const order = await alpacaClient.getOrderById(t.orderId);
        if (order?.filled_avg_price) {
          t.fillPrice = parseFloat(order.filled_avg_price);
          _joinFillToLedger(t, t.fillPrice);
          dirty = true;
        } else if (order && ['canceled', 'expired', 'rejected'].includes(order.status)) {
          t.status = 'closed';
          t.exitReason = `buy ${order.status}`;
          dirty = true;
        }
      } catch { /* retry next listing */ }
    }
    if (t.status === 'closing' && t.sellOrderId) {
      try {
        const order = await alpacaClient.getOrderById(t.sellOrderId);
        if (order?.status === 'filled') {
          t.status = 'closed';
          t.sellFillPrice = parseFloat(order.filled_avg_price);
          dirty = true;
        }
      } catch { /* retry next listing */ }
    }
  }
  if (dirty) _save(entries);

  const enrich = t => {
    const pos = posBySym.get(t.occSymbol);
    const bid = marks.snapshots?.[t.occSymbol]?.latestQuote?.bp;
    const paidPerShare = t.fillPrice ?? t.limitPrice;
    const paid = paidPerShare * 100 * t.qty;
    const nowValue = pos ? parseFloat(pos.market_value) : Number.isFinite(bid) ? bid * 100 * t.qty : null;
    const closedValue = t.sellFillPrice != null ? t.sellFillPrice * 100 * t.qty : null;
    const value = t.status === 'closed' ? closedValue : nowValue;
    return {
      ...t,
      pickId: `${t.occSymbol}-${t.boughtAt.slice(0, 10)}`,
      paid: +paid.toFixed(2),
      nowValue: value != null ? +value.toFixed(2) : null,
      pl: value != null ? +(value - paid).toFixed(2) : null,
      plPct: value != null && paid > 0 ? +((value - paid) / paid).toFixed(4) : null,
      filled: t.fillPrice != null,
    };
  };

  return {
    open: entries.filter(t => t.status === 'open' || t.status === 'closing').map(enrich),
    closed: entries.filter(t => t.status === 'closed').map(enrich).reverse(),
  };
}

/** PURE gate: which open tickets the manager should exit today. */
function shouldAutoExit(ticket, todayEt) {
  return ticket.status === 'open' && todayEt >= ticket.planExitDate;
}

/**
 * Auto-management tick: sell tickets whose plan date has arrived. Runs
 * from the daily-loop interval during market hours. Every action is
 * Telegrammed. OPTIONS_TICKETS_AUTO=off disables.
 */
async function managerTick({ todayEt, marketOpen }) {
  if (String(process.env.OPTIONS_TICKETS_AUTO).toLowerCase() === 'off') return { sold: 0 };
  if (!marketOpen) return { sold: 0 };
  const due = _load().filter(t => shouldAutoExit(t, todayEt));
  let sold = 0;
  for (const t of due) {
    try {
      const { order } = await sellTicket(t.id || t.occSymbol, { reason: 'planExit' });
      sold++;
      try {
        require('../telegramBot').sendAlert(
          `🎟️ *Ticket auto-closed (plan exit)*\n${t.qty}x ${t.occSymbol}\n` +
          (order ? `Sell limit ${order.limit_price} — status ${order.status}` : 'Buy never filled — record closed') +
          `\nThe plan was to be out by ${t.planExitDate}. /optpositions for the rest.`
        );
      } catch { /* alert best-effort */ }
    } catch (err) {
      console.log(`[Tickets] auto-exit failed for ${t.occSymbol}: ${err.message}`);
    }
  }
  return { sold };
}

module.exports = { buyTicket, sellTicket, listTickets, managerTick, shouldAutoExit, roundToTick, planExitDateFor, STORE_FILE };
