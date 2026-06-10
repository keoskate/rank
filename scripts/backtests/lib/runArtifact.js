// scripts/backtests/lib/runArtifact.js
//
// Standardized backtest run artifact (run.json) — schema v1.
//
// The contract: when you watch a backtest in the terminal or web viewer, you
// are watching the EXACT numbers the sim produced — same data path, same
// equity curve, same trades. There is no second engine and no re-derivation
// in the viewer. The artifact is also self-auditing: it reconciles the trade
// ledger against the equity curve and records the gap instead of hiding it.
//
// Shape (v1):
// {
//   schemaVersion: 1,
//   runId, generatedAt,
//   strategy:  { id, family, script, description, params },
//   data:      { source, adjustment, timeframe, window:{start,end}, symbols,
//                integrity },                       // from lib/marketData
//   capital,                                        // starting dollars
//   costModel: { name, note },
//   validation:{ verdict, gates:{ dataIntegrity, faithfulness, outOfSample,
//                realisticCosts, multipleTesting } },// honest, defaults not_run
//   stats:     { totalRet, cagr, vol, sharpe, maxDD, calmar, years, ... },
//   yearly:    { '2022': -0.18, ... },
//   benchmark: { symbol, stats, yearly },
//   equity:    { dates[], values[], drawdown[], benchmark[] },   // dollars
//   trades:    [{ date, symbol, side, price, qty, notional, pnl, pnlPct,
//                 holdingDays, reason }],            // pnl null on buys
//   openPositions: [{ symbol, qty, avgCost, lastPrice, unrealizedPnl }],
//   reconciliation: { realizedPnl, unrealizedPnl, equityPnl, gap, gapPct,
//                     note },
//   bars:      { SYM: [{date,open,high,low,close,volume}] },     // traded names
//   notes:     [string]                              // honest caveats
// }
//
// Artifacts land in data/backtests/runs/<runId>/run.json and the lightweight
// catalog data/backtests/runs/index.json is updated for listing.

const fs = require('fs');
const path = require('path');
const { equityStats } = require('@keo/quant-core');

const RUNS_DIR = path.join(__dirname, '../../../data/backtests/runs');

const GATE_NAMES = [
  'dataIntegrity',
  'faithfulness',
  'outOfSample',
  'realisticCosts',
  'multipleTesting',
];

function defaultGates() {
  return {
    dataIntegrity: {
      status: 'not_run',
      note: 'basic fetch sanity checks only — full integrity gate not yet built',
    },
    faithfulness: {
      status: 'not_run',
      note: 'backtest logic not yet certified against live plugin logic',
    },
    outOfSample: {
      status: 'not_run',
      note: 'IN-SAMPLE ONLY. This curve is not evidence of edge.',
    },
    realisticCosts: {
      status: 'not_run',
      note: 'cost model applied but not validated against live fills',
    },
    multipleTesting: {
      status: 'not_run',
      note: 'no trials ledger / FDR correction applied',
    },
  };
}

function computeVerdict(gates) {
  const passed = GATE_NAMES.filter(g => gates[g] && gates[g].status === 'pass');
  const failed = GATE_NAMES.filter(g => gates[g] && gates[g].status === 'fail');
  if (failed.length) return `FAILED:${failed[0]}`;
  if (passed.length === GATE_NAMES.length) return 'VALIDATED';
  return 'UNVALIDATED';
}

function tsStamp(d = new Date()) {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '-');
}

function slug(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function round2(x) {
  return x == null ? null : Math.round(x * 100) / 100;
}

/**
 * Build and write a run artifact.
 *
 * Required: family, strategyId, script, dates[], equity[] (in equity
 * multiples, 1.0 base — converted to dollars via capital), data{} from
 * marketData (window/symbols/integrity), bars{} for traded names.
 * Optional: trades[], openPositions[], benchmark {symbol, dates?, values},
 * params, description, notes[], gates overrides, capital (default 100k).
 */
function writeRunArtifact(input) {
  const {
    family,
    strategyId,
    script,
    description = '',
    params = {},
    capital = 100000,
    dates,
    equity,
    benchmark = null, // { symbol, values } aligned to `dates`, 1.0 base
    trades = [],
    openPositions = [],
    bars = {},
    data = {},
    costModel = {
      name: 'bpsPerSide',
      note: 'server/risk/transactionCost.js — 5bps/side default, 15bps/side leveraged',
    },
    notes = [],
    gates: gateOverrides = {},
    extra = null, // optional structured payload (e.g. walk-forward folds)
  } = input;

  if (
    !dates ||
    !equity ||
    dates.length !== equity.length ||
    equity.length < 2
  ) {
    throw new Error('writeRunArtifact: dates/equity missing or misaligned');
  }

  const equityDollars = equity.map(e => round2(e * capital));
  const drawdown = equityStats
    .drawdownSeries(equity)
    .map(d => Math.round(d * 1e6) / 1e6);
  const stats = equityStats.statsFromEquity(dates, equity);
  const yearly = equityStats.yearlyReturns(dates, equity);

  // ---- ledger vs equity reconciliation (self-audit) ----
  const realizedPnl = trades.reduce((a, t) => a + (t.pnl || 0), 0);
  const unrealizedPnl = openPositions.reduce(
    (a, p) => a + (p.unrealizedPnl || 0),
    0
  );
  const equityPnl = equityDollars[equityDollars.length - 1] - equityDollars[0];
  const gap = equityPnl - (realizedPnl + unrealizedPnl);
  const reconciliation = {
    realizedPnl: round2(realizedPnl),
    unrealizedPnl: round2(unrealizedPnl),
    equityPnl: round2(equityPnl),
    gap: round2(gap),
    gapPct: equityDollars[0]
      ? Math.round((gap / equityDollars[0]) * 1e6) / 1e6
      : null,
    note:
      Math.abs(gap) <= Math.max(1, Math.abs(equityPnl) * 0.005)
        ? 'trade ledger ties to equity curve'
        : 'LEDGER/EQUITY GAP — trade log is an approximation of the engine (see notes); the equity curve is authoritative',
  };

  const gates = { ...defaultGates() };
  for (const [k, v] of Object.entries(gateOverrides)) {
    if (GATE_NAMES.includes(k)) gates[k] = v;
  }
  const verdict = computeVerdict(gates);

  const runId = `${slug(family)}__${slug(strategyId)}__${tsStamp()}`;

  let benchOut = null;
  if (
    benchmark &&
    benchmark.values &&
    benchmark.values.length === dates.length
  ) {
    benchOut = {
      symbol: benchmark.symbol,
      stats: equityStats.statsFromEquity(dates, benchmark.values),
      yearly: equityStats.yearlyReturns(dates, benchmark.values),
    };
  }

  const artifact = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    strategy: { id: strategyId, family, script, description, params },
    data,
    capital,
    costModel,
    validation: { verdict, gates },
    stats,
    yearly,
    benchmark: benchOut,
    equity: {
      dates,
      values: equityDollars,
      drawdown,
      benchmark: benchOut
        ? benchmark.values.map(v => round2(v * capital))
        : null,
    },
    trades: trades.map(t => ({
      ...t,
      price: round2(t.price),
      qty: t.qty != null ? Math.round(t.qty * 10000) / 10000 : null,
      notional: round2(t.notional),
      pnl: t.pnl != null ? round2(t.pnl) : null,
      pnlPct: t.pnlPct != null ? Math.round(t.pnlPct * 1e6) / 1e6 : null,
    })),
    openPositions: openPositions.map(p => ({
      ...p,
      qty: Math.round(p.qty * 10000) / 10000,
      avgCost: round2(p.avgCost),
      lastPrice: round2(p.lastPrice),
      unrealizedPnl: round2(p.unrealizedPnl),
    })),
    reconciliation,
    bars,
    notes,
    ...(extra ? { extra } : {}),
  };

  const dir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'run.json');
  fs.writeFileSync(filePath, JSON.stringify(artifact));

  updateIndex(artifact);
  return { runId, path: filePath, artifact };
}

function updateIndex(artifact) {
  const indexPath = path.join(RUNS_DIR, 'index.json');
  let index = { runs: [] };
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {
      index = { runs: [] };
    }
  }
  index.runs = index.runs.filter(r => r.runId !== artifact.runId);
  index.runs.push({
    runId: artifact.runId,
    family: artifact.strategy.family,
    strategyId: artifact.strategy.id,
    description: artifact.strategy.description,
    generatedAt: artifact.generatedAt,
    window: artifact.data.window || {
      start: artifact.equity.dates[0],
      end: artifact.equity.dates[artifact.equity.dates.length - 1],
    },
    verdict: artifact.validation.verdict,
    stats: artifact.stats,
    nTrades: artifact.trades.length,
    symbols: Object.keys(artifact.bars),
    capital: artifact.capital,
  });
  index.runs.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

/** Load an artifact by runId or path. */
function loadRunArtifact(idOrPath) {
  let p = idOrPath;
  if (!fs.existsSync(p)) p = path.join(RUNS_DIR, idOrPath, 'run.json');
  if (!fs.existsSync(p)) throw new Error(`run artifact not found: ${idOrPath}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function listRuns() {
  const indexPath = path.join(RUNS_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8')).runs || [];
  } catch (e) {
    return [];
  }
}

module.exports = {
  writeRunArtifact,
  loadRunArtifact,
  listRuns,
  RUNS_DIR,
  GATE_NAMES,
};
