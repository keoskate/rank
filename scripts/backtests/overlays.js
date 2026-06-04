#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/overlays.js
//
// Does either overlay actually EARN ITS KEEP? We A/B the two LIVE strategies —
// trend-following (dual-momentum top-5, SMA200, cash out-leg) and cross-sectional
// momentum (6-1, top quintile, monthly) — with and without each overlay:
//
//   - ENTROPY gate: block NEW entries unless SPY's Shannon-entropy regime is
//     'low-entropy' (trending). Exits are never gated. (Live on trend-follower.)
//   - FRED macro gate: scale book exposure by yield-curve slope (T10Y2Y) + HY
//     credit spread (BAMLH0A0HYM2) vs its 6-mo MA — ×1 risk-on, ×0.25 risk-off,
//     ×0 force-flat. FRED history pulled KEYLESS via fredgraph.csv.
//
// The only question that matters: does each overlay CUT the 2022 (and, for the
// ETF trend book, 2020) drawdown WITHOUT killing the bull-market return? If not,
// it's drag and we turn it off.
//
// No-lookahead: strategy signals on close[i-1] act at close[i]; macro signal is
// lagged one trading day; entropy uses only closes through the rebalance bar.
// Cost: bpsPerSide round-trip on every position/exposure change.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const alpacaClient = require('../../server/alpacaClient');
const { shannonEntropy } = require('@keo/quant-core');

// Alpaca daily history reaches back to 2016-01-04 (vs Polygon's 2021-06 floor),
// so we finally capture the 2018-Q4 selloff, the 2020 COVID V-bottom crash, AND
// the 2022 bear — three stress regimes instead of one.
const START = '2016-01-01';
// End a few days back: Alpaca's free plan blocks SIP data from the most recent
// ~15 min, which rejects any request that spans today's (incomplete) bar.
const END = new Date(Date.now() - 3 * 864e5).toISOString().split('T')[0];
const SLEEP_MS = 180;

const TREND_UNIVERSE = [
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  'XLK',
  'SMH',
  'XLF',
  'XLE',
  'XLV',
  'XLY',
  'XLP',
  'XLI',
  'XLU',
  'XLB',
  'XLRE',
  'XLC',
  'EEM',
  'EFA',
];
const XSMOM_UNIVERSE = [
  'AAPL',
  'MSFT',
  'NVDA',
  'AMD',
  'AVGO',
  'ORCL',
  'CRM',
  'ADBE',
  'CSCO',
  'QCOM',
  'TXN',
  'INTC',
  'AMAT',
  'MU',
  'GOOGL',
  'META',
  'NFLX',
  'DIS',
  'CMCSA',
  'TMUS',
  'AMZN',
  'TSLA',
  'HD',
  'MCD',
  'NKE',
  'COST',
  'WMT',
  'LOW',
  'JPM',
  'BAC',
  'WFC',
  'GS',
  'MS',
  'AXP',
  'SCHW',
  'UNH',
  'JNJ',
  'LLY',
  'ABBV',
  'MRK',
  'PFE',
  'XOM',
  'CVX',
  'CAT',
  'BA',
];
const ALL_SYMS = [...new Set([...TREND_UNIVERSE, ...XSMOM_UNIVERSE])];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchBars(sym) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // adjustment:'all' = split + dividend adjusted (total-return prices).
      // Without this Alpaca returns RAW prices and every split is a fake crash.
      const bars = await alpacaClient.getBars(
        sym,
        '1Day',
        START,
        END,
        10000,
        'all'
      );
      return (bars || [])
        .filter(b => b && b.close > 0 && b.timestamp)
        .map(b => ({ date: b.timestamp.slice(0, 10), close: b.close }));
    } catch (e) {
      await sleep(1500 * (attempt + 1));
    }
  }
  console.error(`  FAILED ${sym}`);
  return [];
}

// ---- FRED ----
// Prefer the API host (api.stlouisfed.org) when FRED_API_KEY is set — it's the
// reachable host and the one the live gate uses. Fall back to the keyless
// fredgraph CSV (blocked in some environments). Either way -> { date: value }.
async function fetchFredCsv(seriesId) {
  const out = {};
  if (process.env.FRED_API_KEY) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}` +
      `&api_key=${process.env.FRED_API_KEY}&file_type=json&observation_start=2018-01-01`;
    const res = await axios.get(url, { timeout: 20000 });
    for (const o of res.data.observations || []) {
      const v = parseFloat(o.value);
      if (Number.isFinite(v)) out[o.date] = v;
    }
    return out;
  }
  const res = await axios.get(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`,
    { timeout: 20000 }
  );
  const lines = String(res.data).trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const [date, raw] = lines[i].split(',');
    const v = parseFloat(raw);
    if (date && Number.isFinite(v)) out[date.trim()] = v;
  }
  return out;
}

function sma(arr, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) {
    if (arr[k] == null) return null;
    s += arr[k];
  }
  return s / n;
}

function statsFromDaily(dates, eq) {
  const rets = [];
  for (let i = 1; i < eq.length; i++) rets.push(eq[i] / eq[i - 1] - 1);
  const n = eq.length;
  const years =
    (new Date(dates[n - 1]) - new Date(dates[0])) / (365.25 * 864e5);
  const cagr = Math.pow(eq[n - 1] / eq[0], 1 / years) - 1;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252);
  const sharpe = vol === 0 ? 0 : (mean * 252) / vol;
  let peak = eq[0];
  let maxDD = 0;
  for (const e of eq) {
    if (e > peak) peak = e;
    const dd = e / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  const calmar = maxDD === 0 ? 0 : cagr / Math.abs(maxDD);
  return {
    totalRet: eq[n - 1] / eq[0] - 1,
    cagr,
    vol,
    sharpe,
    maxDD,
    calmar,
    years,
  };
}

function windowReturn(dates, eq, from, to) {
  let si = -1;
  let ei = -1;
  for (let i = 0; i < dates.length; i++) {
    if (si < 0 && dates[i] >= from) si = i;
    if (dates[i] <= to) ei = i;
  }
  if (si < 0 || ei < 0 || ei <= si) return null;
  let peak = eq[si];
  let maxDD = 0;
  for (let i = si; i <= ei; i++) {
    if (eq[i] > peak) peak = eq[i];
    const dd = eq[i] / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  return { ret: eq[ei] / eq[si] - 1, maxDD };
}

function fmtPct(x) {
  return x == null ? '   n/a' : (x * 100).toFixed(1) + '%';
}

async function main() {
  const CACHE = path.join(__dirname, '.overlays-bars-alpaca.json');
  let data = {};
  if (fs.existsSync(CACHE)) {
    data = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    console.log(`Loaded ${Object.keys(data).length} tickers from cache.`);
  } else {
    console.log(`Fetching ${ALL_SYMS.length} tickers ${START}..${END} …`);
    for (let k = 0; k < ALL_SYMS.length; k++) {
      const sym = ALL_SYMS[k];
      const bars = await fetchBars(sym);
      if (bars.length > 60) data[sym] = bars;
      if ((k + 1) % 15 === 0) console.log(`  …${k + 1}/${ALL_SYMS.length}`);
      await sleep(SLEEP_MS);
    }
    fs.writeFileSync(CACHE, JSON.stringify(data));
  }

  // Master calendar from SPY.
  const dates = data['SPY'].map(b => b.date);
  const series = {}; // sym -> aligned forward-filled close array
  for (const sym of Object.keys(data)) {
    const m = {};
    for (const b of data[sym]) m[b.date] = b.close;
    const arr = [];
    let last = null;
    for (const d of dates) {
      if (m[d] != null) last = m[d];
      arr.push(last);
    }
    series[sym] = arr;
  }
  const have = s => series[s] != null;

  // ---- FRED macro state per trading day (lagged 1 day when applied) ----
  // Source order: local CSVs (scripts/backtests/fred-<id>.csv) if dropped in,
  // else the keyless fredgraph endpoint. If neither is reachable, FRED arms are
  // skipped and we report entropy-only.
  function loadLocalFred(id) {
    const p = path.join(__dirname, `fred-${id}.csv`);
    if (!fs.existsSync(p)) return null;
    const out = {};
    for (const line of fs.readFileSync(p, 'utf8').trim().split('\n').slice(1)) {
      const [d, raw] = line.split(',');
      const v = parseFloat(raw);
      if (d && Number.isFinite(v)) out[d.trim()] = v;
    }
    return out;
  }
  let fredAvailable = true;
  let curveRaw = {};
  let hyRaw = {};
  const localCurve = loadLocalFred('T10Y2Y');
  const localHy = loadLocalFred('BAMLH0A0HYM2');
  if (localCurve && localHy) {
    curveRaw = localCurve;
    hyRaw = localHy;
    console.log('Loaded FRED from local CSVs.');
  } else {
    console.log('Fetching FRED (keyless): T10Y2Y, BAMLH0A0HYM2 …');
    try {
      [curveRaw, hyRaw] = await Promise.all([
        fetchFredCsv('T10Y2Y'),
        fetchFredCsv('BAMLH0A0HYM2'),
      ]);
    } catch (e) {
      fredAvailable = false;
      console.warn(`  FRED unreachable (${e.message}) — running entropy-only.`);
    }
  }
  // align onto trading calendar, forward-fill
  const curve = [];
  const hy = [];
  {
    let lc = null;
    let lh = null;
    for (const d of dates) {
      if (curveRaw[d] != null) lc = curveRaw[d];
      if (hyRaw[d] != null) lh = hyRaw[d];
      curve.push(lc);
      hy.push(lh);
    }
  }
  // macro scalar per day: ×1 risk-on, ×0.25 risk-off, ×0 force-flat
  const HY_SPIKE_MULT = 1.25;
  const DEEP_INV = -0.5;
  const macroScalar = new Array(dates.length).fill(1);
  for (let i = 0; i < dates.length; i++) {
    const cs = curve[i];
    const h = hy[i];
    if (cs == null || h == null || i < 126) {
      macroScalar[i] = 1;
      continue;
    }
    // 6-mo (126 trading-day) trailing MA of HY
    let s = 0;
    let cnt = 0;
    for (let k = i - 125; k <= i; k++) {
      if (hy[k] != null) {
        s += hy[k];
        cnt++;
      }
    }
    const hyMa = cnt ? s / cnt : h;
    if (cs > 0 && h < hyMa)
      macroScalar[i] = 1; // risk-on
    else if (h > hyMa * HY_SPIKE_MULT || cs < DEEP_INV)
      macroScalar[i] = 0; // force-flat
    else macroScalar[i] = 0.25; // risk-off
  }

  // ---- entropy regime (SPY) at an index: true if 'low-entropy' (allow entry) ----
  const spy = series['SPY'];
  const entropyCache = new Map();
  let prevNormH = null;
  function spyLowEntropy(i) {
    if (entropyCache.has(i)) return entropyCache.get(i);
    const closes = spy.slice(0, i + 1).filter(x => x != null);
    if (closes.length < 70) {
      entropyCache.set(i, true);
      return true; // not enough data — fail open (allow)
    }
    const snap = shannonEntropy.entropySnapshot(closes, [21, 63]);
    const H = snap[21];
    const regime = shannonEntropy.classifyRegime(
      H,
      snap.Hmax,
      prevNormH != null ? prevNormH * snap.Hmax : null
    );
    if (regime.normH > 0) prevNormH = regime.normH;
    const allow = regime.state === 'low-entropy';
    entropyCache.set(i, allow);
    return allow;
  }

  // month-end indices
  const isMonthEnd = new Array(dates.length).fill(false);
  for (let i = 0; i < dates.length - 1; i++) {
    if (dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7)) isMonthEnd[i] = true;
  }
  isMonthEnd[dates.length - 1] = true;

  // ---- generic monthly long portfolio with optional entropy gate ----
  // momFn(sym,i) -> momentum score or null; eligibleFn(sym,i) -> bool.
  // entryGate(i) -> bool (whether NEW entries are allowed this rebalance).
  function simulate({ universe, topN, lookback, skip, requireTrend, entropy }) {
    const pickable = universe.filter(have);
    const startI = lookback + 2;
    const eq = [1];
    const eqDates = [dates[startI - 1]];
    let holdings = {}; // sym -> weight
    let daysInvested = 0;
    let rebalances = 0;
    let turnoverTot = 0;
    let firstActive = -1; // eqDates index of first day actually holding a position
    const costPerSide = 5 / 10000;

    for (let i = startI; i < dates.length; i++) {
      // realize holdings return i-1 -> i
      let r = 0;
      let invested = 0;
      for (const [sym, w] of Object.entries(holdings)) {
        if (sym === 'CASH') continue;
        const pPrev = series[sym][i - 1];
        const pNow = series[sym][i];
        if (pPrev != null && pNow != null) {
          r += w * (pNow / pPrev - 1);
          invested += w;
        }
      }
      daysInvested += invested;
      if (firstActive < 0 && invested > 0) firstActive = eq.length;
      eq.push(eq[eq.length - 1] * (1 + r));
      eqDates.push(dates[i]);

      if (!isMonthEnd[i]) continue;

      // rank eligible names by momentum (signal uses data through i)
      const ranked = [];
      for (const sym of pickable) {
        const px = series[sym];
        if (px[i] == null || px[i - lookback] == null) continue;
        const mom = px[i - skip] / px[i - lookback] - 1;
        let ok = mom > 0 || !requireTrend ? true : false;
        if (requireTrend) {
          const ma = sma(px, i, 200);
          ok = mom > 0 && ma != null && px[i] > ma;
        }
        if (ok) ranked.push({ sym, mom });
      }
      ranked.sort((a, b) => b.mom - a.mom);
      const picks = ranked.slice(0, topN).map(x => x.sym);

      // entropy gate: NEW entries (not already held) only allowed when SPY is
      // low-entropy. Continuing holdings are kept; blocked new picks -> cash.
      const allowNew = entropy ? spyLowEntropy(i) : true;
      const wEach = 1 / topN;
      const newHoldings = {};
      for (const p of picks) {
        const isNew = !(holdings[p] > 0);
        if (isNew && !allowNew) continue; // gate the new entry -> slot stays cash
        newHoldings[p] = wEach;
      }
      const investedW = Object.values(newHoldings).reduce((a, b) => a + b, 0);
      if (investedW < 1) newHoldings['CASH'] = 1 - investedW;

      // turnover cost
      const allS = new Set([
        ...Object.keys(holdings),
        ...Object.keys(newHoldings),
      ]);
      let turnover = 0;
      for (const s of allS) {
        if (s === 'CASH') continue;
        turnover += Math.abs((newHoldings[s] || 0) - (holdings[s] || 0));
      }
      turnoverTot += turnover;
      eq[eq.length - 1] *= 1 - turnover * costPerSide;
      holdings = newHoldings;
      rebalances++;
    }
    // Trim the leading flat-in-cash period (before the universe has data) and
    // re-baseline to 1.0 so stats reflect the active trading window only.
    const k = firstActive > 0 ? firstActive - 1 : 0;
    const tDates = eqDates.slice(k);
    const tEq = eq.slice(k).map(v => v / eq[k]);
    const activeDays = eqDates.length - 1 - k;
    return {
      eqDates: tDates,
      eq: tEq,
      exposure: daysInvested / Math.max(1, activeDays),
      rebalances,
      avgTurnover: turnoverTot / Math.max(1, rebalances),
    };
  }

  // ---- layer the FRED macro scalar onto a daily equity curve ----
  // Scales the day's strategy return by the (1-day-lagged) macro scalar; the
  // un-invested fraction earns 0. Charges cost when the scalar steps.
  function applyFred(base) {
    const { eqDates, eq } = base;
    const idxByDate = new Map(dates.map((d, i) => [d, i]));
    const outEq = [eq[0]];
    let prevScalar = 1;
    const costPerSide = 5 / 10000;
    for (let j = 1; j < eq.length; j++) {
      const gi = idxByDate.get(eqDates[j]);
      const scalar = gi != null && gi > 0 ? macroScalar[gi - 1] : 1; // lag 1 day
      const stratRet = eq[j] / eq[j - 1] - 1;
      let mult = 1 + scalar * stratRet;
      if (scalar !== prevScalar) {
        mult *= 1 - Math.abs(scalar - prevScalar) * costPerSide;
        prevScalar = scalar;
      }
      outEq.push(outEq[outEq.length - 1] * mult);
    }
    return {
      eqDates,
      eq: outEq,
      exposure: base.exposure,
      rebalances: base.rebalances,
    };
  }

  // ---- run both strategies × {base, +entropy, +FRED, +both} ----
  const strategies = {
    Trend: {
      universe: TREND_UNIVERSE,
      topN: 5,
      lookback: 252,
      skip: 21,
      requireTrend: true,
    },
    XSMom: {
      universe: XSMOM_UNIVERSE,
      topN: 9,
      lookback: 126,
      skip: 21,
      requireTrend: false,
    },
  };

  const regimes = {
    '2018Q4 selloff': ['2018-09-20', '2018-12-24'],
    '2020 crash': ['2020-02-19', '2020-03-23'],
    '2022 bear': ['2022-01-01', '2022-12-31'],
  };

  const out = { window: { START, END }, results: {} };
  const lines = [];
  const log = s => {
    lines.push(s);
    console.log(s);
  };

  for (const [sName, cfg] of Object.entries(strategies)) {
    const base = simulate({ ...cfg, entropy: false });
    const ent = simulate({ ...cfg, entropy: true });
    const arms = { base, '+entropy': ent };
    if (fredAvailable) {
      arms['+FRED'] = applyFred(base);
      arms['+both'] = applyFred(ent);
    }

    log(
      `\n================ ${sName} (effective ${arms.base.eqDates[0]} -> ${arms.base.eqDates[arms.base.eqDates.length - 1]}) ================`
    );
    log(
      'arm'.padEnd(10) +
        'CAGR'.padStart(8) +
        'Vol'.padStart(8) +
        'Sharpe'.padStart(8) +
        'MaxDD'.padStart(9) +
        'Calmar'.padStart(8) +
        'Expos'.padStart(8) +
        'TotRet'.padStart(9)
    );
    const statByArm = {};
    for (const [aName, r] of Object.entries(arms)) {
      const st = statsFromDaily(r.eqDates, r.eq);
      statByArm[aName] = st;
      log(
        aName.padEnd(10) +
          fmtPct(st.cagr).padStart(8) +
          fmtPct(st.vol).padStart(8) +
          st.sharpe.toFixed(2).padStart(8) +
          fmtPct(st.maxDD).padStart(9) +
          st.calmar.toFixed(2).padStart(8) +
          fmtPct(r.exposure).padStart(8) +
          fmtPct(st.totalRet).padStart(9)
      );
    }
    // regime windows (return / maxDD) per arm
    log('\n  -- regime stress (return / maxDD) --');
    log(
      'arm'.padEnd(10) +
        Object.keys(regimes)
          .map(k => k.padStart(20))
          .join('')
    );
    const regByArm = {};
    for (const [aName, r] of Object.entries(arms)) {
      regByArm[aName] = {};
      let row = aName.padEnd(10);
      for (const [rk, [from, to]] of Object.entries(regimes)) {
        const w = windowReturn(r.eqDates, r.eq, from, to);
        regByArm[aName][rk] = w;
        row += (w ? `${fmtPct(w.ret)}/${fmtPct(w.maxDD)}` : 'n/a').padStart(20);
      }
      log(row);
    }
    out.results[sName] = {
      stats: statByArm,
      regimes: regByArm,
      exposure: Object.fromEntries(
        Object.entries(arms).map(([k, v]) => [k, v.exposure])
      ),
    };
  }

  const outPath = path.join(__dirname, 'overlays.results.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`\nWrote ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
