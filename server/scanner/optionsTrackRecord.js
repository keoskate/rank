/**
 * Options scanner track record — the honest ledger of every card the
 * scanner recommended and how it actually played out.
 *
 * A "pick" = a contract surfaced on the board on a given day (deduped:
 * first appearance per contract per day, since that's when you'd have
 * acted). Every pick is graded under TWO playbooks with real market data:
 *
 *   A. "withStops" (pick.exit): follow the stock playbook — sell the day
 *      the underlying touches target or stop, else at the plan exit date.
 *      Same-day both-touch resolves pessimistically (stop first).
 *   B. "holdToPlan" (pick.exitHold): no stops — an option's premium already
 *      caps the loss, so ride to the plan exit date regardless of touches.
 *
 *   entry  = the card's modeled fill (entryDebit)
 *   result = the option's actual daily-bar close on the exit date; if it
 *            never traded again and expired, intrinsic at expiry.
 *
 * WIN = exited above entry. Playbook A can grade early (a touch resolves
 * it); playbook B only after the plan exit passes — so the two grade on
 * independent timelines. The report compares them ON THE SAME PICKS only.
 * No survivorship pruning — picks are never deleted (trials-ledger rule).
 *
 * The calibration stat (avg predicted PoP vs realized win rate) is the
 * self-improvement signal. Caveat (in the report): popModel predicts
 * profit AT EXPIRY while grading is at the plan exit — directional, not
 * exact.
 */

const fs = require('fs');
const path = require('path');
const { horizonCalendarDays, bsPrice } = require('./optionsPricingModel');

const STORE_FILE = path.join(__dirname, '..', '..', 'data', 'options-track-record.json');
const DAY_MS = 86400000;
const EXIT_BAR_GRACE_DAYS = 3; // thin contracts don't trade every day
const BARS_BATCH_SIZE = 40;
// v2: option exits valued at estimated BID (close minus half the entry-time
// relative spread — a seller doesn't get the last-trade print) + stock-leg
// attribution. Bumping this re-grades the whole ledger from the same raw
// entries; the methodology is versioned, the record never rewrites itself
// silently.
const GRADE_VERSION = 2;

function _load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function _save(picks) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(picks, null, 2));
}

function _dateStr(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Record a scan's surfaced cards as picks. Dedupe: one pick per contract
 * per calendar day. Returns how many were newly recorded.
 */
function recordPicks(scanResult) {
  const rows = scanResult?.opportunities || [];
  if (!rows.length) return 0;
  const picks = _load();
  const recordedAt = scanResult.generatedAt || new Date().toISOString();
  const day = recordedAt.slice(0, 10);
  const seen = new Set(picks.map(p => `${p.card.contractSymbol}|${p.recordedAt.slice(0, 10)}`));

  let added = 0;
  for (const row of rows) {
    const key = `${row.contractSymbol}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hCal = horizonCalendarDays(scanResult.horizonDays || 5);
    const planExitDate = _dateStr(
      Math.min(Date.parse(`${day}T00:00:00Z`) + hCal * DAY_MS, Date.parse(`${row.expiration}T00:00:00Z`))
    );
    picks.push({
      id: `${row.contractSymbol}-${day}`,
      recordedAt,
      scanId: scanResult.scanId,
      horizonDays: scanResult.horizonDays || 5,
      planExitDate,
      status: 'open',
      holdStatus: 'open',
      card: row,
    });
    added++;
  }
  if (added) _save(picks);
  return added;
}

/**
 * Grade one pick from real bars. PURE — no I/O, unit-tested directly.
 * @param {object} pick
 * @param {Array} optionBars     daily bars for the contract [{t,c,...}]
 * @param {Array} underlyingBars daily bars for the stock [{t?, timestamp?, high, low, close}]
 * @param {string} today         'YYYY-MM-DD'
 * @param {object} opts { useTouches } — true = playbook A (sell on
 *   target/stop touch), false = playbook B (hold to the plan exit)
 * @returns {object|null} exit record, or null if not gradable yet
 */
function gradePick(pick, optionBars, underlyingBars, today, { useTouches = true } = {}) {
  const card = pick.card;
  const entryDay = pick.recordedAt.slice(0, 10);
  const isCall = card.type === 'call';

  const dayOf = b => (b.t || new Date(b.timestamp).toISOString()).slice(0, 10);

  // Follow the playbook: under A, the first touch of target or stop ends
  // the trade; under B nothing does — the premium is the stop.
  let exitDate = null;
  let exitReason = null;
  if (useTouches) {
    const inWindow = (underlyingBars || [])
      .filter(b => dayOf(b) > entryDay && dayOf(b) <= pick.planExitDate)
      .sort((a, b) => dayOf(a).localeCompare(dayOf(b)));
    for (const b of inWindow) {
      const hitTarget = isCall ? b.high >= card.targetPrice : b.low <= card.targetPrice;
      const hitStop = isCall ? b.low <= card.stopPrice : b.high >= card.stopPrice;
      if (hitTarget || hitStop) {
        exitDate = dayOf(b);
        exitReason = hitStop ? 'stopHit' : 'targetHit';
        break;
      }
    }
  }
  if (!exitDate) {
    if (today <= pick.planExitDate) return null; // still open
    exitDate = pick.planExitDate;
    exitReason = 'planExit';
  }

  // Value the option at the exit: its actual close that day, else the most
  // recent trade within the grace window, else intrinsic (post-expiry).
  const graceEnd = _dateStr(Date.parse(`${exitDate}T00:00:00Z`) + EXIT_BAR_GRACE_DAYS * DAY_MS);
  const candidates = (optionBars || [])
    .filter(b => dayOf(b) > entryDay && dayOf(b) <= graceEnd)
    .sort((a, b) => dayOf(a).localeCompare(dayOf(b)));
  let exitValue = null;
  let valueSource = null;
  const onOrBefore = candidates.filter(b => dayOf(b) <= exitDate);
  if (onOrBefore.length && dayOf(onOrBefore[onOrBefore.length - 1]) === exitDate) {
    exitValue = onOrBefore[onOrBefore.length - 1].c;
    valueSource = 'optionClose';
  } else if (candidates.length) {
    const nearest = candidates[candidates.length - 1];
    exitValue = nearest.c;
    valueSource = `optionClose:${dayOf(nearest)}`;
  } else if (today > card.expiration) {
    const expBar = (underlyingBars || [])
      .filter(b => dayOf(b) <= card.expiration)
      .sort((a, b) => dayOf(a).localeCompare(dayOf(b)))
      .pop();
    if (expBar) {
      exitValue = bsPrice({ S: expBar.close, K: card.strike, tau: 0, sigma: 0, type: card.type });
      valueSource = 'intrinsicAtExpiry';
    }
  }
  if (exitValue == null) return null; // no data yet — try again later

  // Sellers get the bid, not the last print: haircut trade-based exits by
  // half the entry-time relative spread. Intrinsic-at-expiry settles at
  // parity — no spread to pay.
  const exitValueRaw = exitValue;
  if (valueSource !== 'intrinsicAtExpiry') {
    const spreadHaircut = Math.min(Math.max(card.spreadPct ?? 0, 0), 0.5) / 2;
    exitValue = Math.max(exitValue * (1 - spreadHaircut), 0);
  }

  const entry = card.entryDebit;
  const returnPct = (exitValue - entry) / entry;
  return {
    exitDate,
    exitReason,
    exitValue: +exitValue.toFixed(3),
    exitValueRaw: +exitValueRaw.toFixed(3),
    valueSource,
    returnPct: +returnPct.toFixed(4),
    plPerContract: +((exitValue - entry) * 100).toFixed(2),
    win: returnPct > 0,
  };
}

/**
 * Grade the STOCK side of the pick under the same touch playbook — was the
 * direction call right, independent of the option wrapper? Separates
 * "picked the wrong direction" from "the vehicle (theta + spread) ate a
 * correct call" — they have opposite fixes. PURE, unit-tested.
 * @returns {object|null} { exitDate, exitReason, exitPrice, returnPct, win }
 */
function gradeStockLeg(pick, underlyingBars, today) {
  const card = pick.card;
  const entryDay = pick.recordedAt.slice(0, 10);
  const isLong = card.direction === 'LONG';
  const dayOf = b => (b.t || new Date(b.timestamp).toISOString()).slice(0, 10);
  const inWindow = (underlyingBars || [])
    .filter(b => dayOf(b) > entryDay && dayOf(b) <= pick.planExitDate)
    .sort((a, b) => dayOf(a).localeCompare(dayOf(b)));

  let exitDate = null;
  let exitReason = null;
  let exitPrice = null;
  for (const b of inWindow) {
    const hitTarget = isLong ? b.high >= card.targetPrice : b.low <= card.targetPrice;
    const hitStop = isLong ? b.low <= card.stopPrice : b.high >= card.stopPrice;
    if (hitTarget || hitStop) {
      exitDate = dayOf(b);
      exitReason = hitStop ? 'stopHit' : 'targetHit'; // same-day both-touch: pessimistic
      exitPrice = hitStop ? card.stopPrice : card.targetPrice;
      break;
    }
  }
  if (!exitDate) {
    if (today <= pick.planExitDate) return null;
    const exitBar = inWindow[inWindow.length - 1];
    if (!exitBar) return null;
    exitDate = dayOf(exitBar);
    exitReason = 'planExit';
    exitPrice = exitBar.close;
  }

  const entry = card.underlyingPrice;
  const raw = (exitPrice - entry) / entry;
  const returnPct = isLong ? raw : -raw;
  return {
    exitDate,
    exitReason,
    exitPrice: +exitPrice.toFixed(4),
    returnPct: +returnPct.toFixed(4),
    win: returnPct > 0,
  };
}

function _needsGrading(p) {
  return p.gradeVersion !== GRADE_VERSION || p.status === 'open' || !p.exitHold || !p.stockLeg;
}

/**
 * Grade every pending pick under both playbooks. Bar fetches are batched
 * (one option-bars call per ~40 contracts per recorded day, one
 * underlying-bars call per symbol) so a large backfill stays fast.
 */
async function evaluatePending() {
  const alpacaOptions = require('../alpacaOptionsClient');
  const polygonClient = require('../polygonClient');
  const picks = _load();
  const today = _dateStr(Date.now());
  const pending = picks.filter(_needsGrading);
  if (!pending.length) return { graded: 0, gradedHold: 0 };

  // Batched option bars: group contracts by recorded day.
  const byStart = new Map();
  for (const p of pending) {
    const start = p.recordedAt.slice(0, 10);
    if (!byStart.has(start)) byStart.set(start, new Set());
    byStart.get(start).add(p.card.contractSymbol);
  }
  const optionBarsBySym = {};
  for (const [start, symSet] of byStart) {
    const syms = [...symSet];
    for (let i = 0; i < syms.length; i += BARS_BATCH_SIZE) {
      try {
        const res = await alpacaOptions.getOptionBars(syms.slice(i, i + BARS_BATCH_SIZE), { start });
        for (const [sym, bars] of Object.entries(res.bars || {})) {
          if (!optionBarsBySym[sym] || bars.length > optionBarsBySym[sym].length) {
            optionBarsBySym[sym] = bars;
          }
        }
      } catch { /* affected picks retry on the next report */ }
    }
  }

  // Underlying bars: one fetch per symbol from its earliest pending pick.
  const underlyingCache = new Map();
  const earliestBySym = new Map();
  for (const p of pending) {
    const sym = p.card.underlying;
    const rec = Date.parse(p.recordedAt);
    if (!earliestBySym.has(sym) || rec < earliestBySym.get(sym)) earliestBySym.set(sym, rec);
  }
  for (const [sym, earliest] of earliestBySym) {
    try {
      underlyingCache.set(
        sym,
        await polygonClient.getAggregates(sym, 1, 'day', { from: new Date(earliest - 2 * DAY_MS), to: new Date() }) || []
      );
    } catch {
      underlyingCache.set(sym, []);
    }
  }

  let graded = 0;
  let gradedHold = 0;
  let changed = false;
  for (const pick of pending) {
    // Methodology bump: wipe derived grades and redo from the raw entry.
    if (pick.gradeVersion !== GRADE_VERSION) {
      delete pick.exit;
      delete pick.exitHold;
      delete pick.stockLeg;
      pick.status = 'open';
      pick.holdStatus = 'open';
      pick.gradeVersion = GRADE_VERSION;
      changed = true;
    }
    const optionBars = optionBarsBySym[pick.card.contractSymbol] || [];
    const underlyingBars = underlyingCache.get(pick.card.underlying) || [];
    if (pick.status === 'open') {
      const exit = gradePick(pick, optionBars, underlyingBars, today, { useTouches: true });
      if (exit) {
        pick.status = exit.win ? 'win' : 'loss';
        pick.exit = exit;
        pick.evaluatedAt = new Date().toISOString();
        graded++;
      }
    }
    if (!pick.exitHold) {
      const exitHold = gradePick(pick, optionBars, underlyingBars, today, { useTouches: false });
      if (exitHold) {
        pick.holdStatus = exitHold.win ? 'win' : 'loss';
        pick.exitHold = exitHold;
        gradedHold++;
      }
    }
    if (!pick.stockLeg) {
      const stockLeg = gradeStockLeg(pick, underlyingBars, today);
      if (stockLeg) {
        pick.stockLeg = stockLeg;
        changed = true;
      }
    }
  }
  if (graded || gradedHold || changed) _save(picks);
  return { graded, gradedHold };
}

/** Live "how are the open ones doing" marks (bid = what you could sell for). */
async function markOpenPicks(picks) {
  const alpacaOptions = require('../alpacaOptionsClient');
  const open = picks.filter(p => p.status === 'open');
  if (!open.length) return;
  const res = await alpacaOptions.getSnapshotsBySymbols(open.map(p => p.card.contractSymbol));
  for (const p of open) {
    const bid = res.snapshots?.[p.card.contractSymbol]?.latestQuote?.bp;
    p.openMark = Number.isFinite(bid)
      ? { bid, returnPct: +((bid - p.card.entryDebit) / p.card.entryDebit).toFixed(4) }
      : null;
  }
}

function _stats(exits) {
  if (!exits.length) return null;
  const wins = exits.filter(e => e.win).length;
  const returns = exits.map(e => e.returnPct).sort((a, b) => a - b);
  return {
    graded: exits.length,
    wins,
    losses: exits.length - wins,
    winRate: +(wins / exits.length).toFixed(4),
    avgReturnPct: +(returns.reduce((s, n) => s + n, 0) / returns.length).toFixed(4),
    medianReturnPct: +returns[Math.floor(returns.length / 2)].toFixed(4),
    totalPlPerContract: +exits.reduce((s, e) => s + e.plPerContract, 0).toFixed(2),
  };
}

/** Full report: summary stats + playbook comparison + the picks. */
async function getReport({ limit = 50 } = {}) {
  await evaluatePending();
  const picks = _load();
  await markOpenPicks(picks);

  const gradedPicks = picks.filter(p => p.exit);
  const wins = gradedPicks.filter(p => p.status === 'win');
  const avg = arr => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null);

  // Playbook comparison is only fair on picks graded under BOTH.
  const both = picks.filter(p => p.exit && p.exitHold);
  const openPicks = picks.filter(p => p.status === 'open');
  const withStops = _stats(both.map(p => p.exit));
  const holdToPlan = _stats(both.map(p => p.exitHold));
  let playbookVerdict = null;
  if (withStops && holdToPlan) {
    const edge = holdToPlan.avgReturnPct - withStops.avgReturnPct;
    playbookVerdict = Math.abs(edge) < 0.02
      ? 'Playbooks are roughly tied so far'
      : edge > 0
        ? `Holding to plan beat selling on stops by ${Math.round(edge * 100)}pp avg return`
        : `Selling on stops beat holding to plan by ${Math.round(-edge * 100)}pp avg return`;
  }

  return {
    summary: {
      totalPicks: picks.length,
      open: openPicks.length,
      nextGradeDate: openPicks.length ? openPicks.map(p => p.planExitDate).sort()[0] : null,
      graded: gradedPicks.length,
      wins: wins.length,
      losses: gradedPicks.length - wins.length,
      winRate: gradedPicks.length ? +(wins.length / gradedPicks.length).toFixed(4) : null,
      avgReturnPct: gradedPicks.length ? +avg(gradedPicks.map(p => p.exit.returnPct)).toFixed(4) : null,
      totalPlPerContract: +gradedPicks.reduce((s, p) => s + p.exit.plPerContract, 0).toFixed(2),
      calibration: gradedPicks.length
        ? {
            predictedWinRate: +avg(gradedPicks.map(p => p.card.popModel)).toFixed(4),
            realizedWinRate: +(wins.length / gradedPicks.length).toFixed(4),
            note: 'popModel predicts profit at expiry; grading is at the plan exit — treat the gap as directional, not exact',
          }
        : null,
      playbooks: withStops && holdToPlan
        ? { comparablePicks: both.length, withStops, holdToPlan, verdict: playbookVerdict }
        : null,
      attribution: (() => {
        // Direction vs vehicle: was the stock call right, and did the
        // option deliver when it was?
        const attributed = picks.filter(p => p.exit && p.stockLeg);
        if (!attributed.length) return null;
        const stockWon = attributed.filter(p => p.stockLeg.win);
        const slice = arr => (arr.length
          ? {
              picks: arr.length,
              optionWinRate: +(arr.filter(p => p.exit.win).length / arr.length).toFixed(4),
              avgOptionReturnPct: +avg(arr.map(p => p.exit.returnPct)).toFixed(4),
            }
          : null);
        return {
          picks: attributed.length,
          stockLegWinRate: +(stockWon.length / attributed.length).toFixed(4),
          whenStockWon: slice(stockWon),
          whenStockLost: slice(attributed.filter(p => !p.stockLeg.win)),
          note: 'stock right but option lost = the vehicle (theta + spread) ate a correct call — opposite fix from a wrong direction',
        };
      })(),
    },
    picks: picks
      .slice()
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, limit),
  };
}

module.exports = { recordPicks, gradePick, gradeStockLeg, evaluatePending, getReport, STORE_FILE, GRADE_VERSION };
