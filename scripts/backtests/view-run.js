#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/view-run.js
//
// Terminal viewer for standardized backtest run artifacts (run.json).
// Dependency-free: pure ANSI + Unicode braille. Renders the EXACT numbers in
// the artifact — equity curve, drawdown, price candles' closes with ▲buy/▼sell
// markers, trade log, and the honest validation verdict. No re-computation,
// no second engine.
//
// Usage:
//   node scripts/backtests/view-run.js                     # list available runs
//   node scripts/backtests/view-run.js <runId|path>        # render a run
//     --symbol=SPY        price strip symbol (default: most-traded)
//     --replay            animate the run day by day
//     --speed=15          ms per replay frame
//     --width=90          chart width in characters

const { loadRunArtifact, listRuns } = require('./lib/runArtifact');

// ---------- ANSI helpers ----------
const ESC = '\x1b[';
const C = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  gray: `${ESC}90m`,
  brightGreen: `${ESC}92m`,
  brightRed: `${ESC}91m`,
};
const col = (s, c) => `${c}${s}${C.reset}`;
const HOME = `${ESC}H`;
const CLEAR = `${ESC}2J${ESC}H`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;

// ---------- braille canvas ----------
// 2x4 dots per character cell. Color is per-cell (last writer wins).
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

class Canvas {
  constructor(wChars, hChars) {
    this.w = wChars;
    this.h = hChars;
    this.bits = new Uint8Array(wChars * hChars);
    this.colors = new Array(wChars * hChars).fill(null);
    this.overlays = new Map(); // cellIndex -> {ch, color}
  }
  get pw() {
    return this.w * 2;
  }
  get ph() {
    return this.h * 4;
  }
  set(px, py, color) {
    if (px < 0 || px >= this.pw || py < 0 || py >= this.ph) return;
    const cx = px >> 1;
    const cy = py >> 2;
    const i = cy * this.w + cx;
    this.bits[i] |= DOT_BITS[py & 3][px & 1];
    if (color) this.colors[i] = color;
  }
  // overlay a literal character (markers) at pixel coords
  overlay(px, py, ch, color) {
    const cx = Math.min(this.w - 1, Math.max(0, px >> 1));
    const cy = Math.min(this.h - 1, Math.max(0, py >> 2));
    this.overlays.set(cy * this.w + cx, { ch, color });
  }
  render() {
    const rows = [];
    for (let y = 0; y < this.h; y++) {
      let row = '';
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const ov = this.overlays.get(i);
        if (ov) {
          row += col(ov.ch, ov.color);
        } else if (this.bits[i]) {
          const ch = String.fromCharCode(0x2800 + this.bits[i]);
          row += this.colors[i] ? col(ch, this.colors[i]) : ch;
        } else {
          row += ' ';
        }
      }
      rows.push(row);
    }
    return rows;
  }
}

/**
 * Plot a series as a connected line on the canvas.
 * domainN: logical x-domain length (so partial replay keeps a fixed x-scale).
 * offset: shift the series right by N logical indices within the domain
 *         (lets overlays that start later share the closes' x-scale).
 */
function plotLine(canvas, values, { min, max, color, domainN, offset = 0 }) {
  const n = values.length;
  if (n < 2) return;
  const N = domainN || n;
  const span = max - min || 1;
  const yOf = v => Math.round((1 - (v - min) / span) * (canvas.ph - 1));
  const xOf = i => Math.round(((i + offset) / (N - 1)) * (canvas.pw - 1));
  let prevX = xOf(0);
  let prevY = yOf(values[0]);
  for (let i = 1; i < n; i++) {
    if (values[i] == null) continue;
    const x = xOf(i);
    const y = yOf(values[i]);
    // draw segment prev -> cur
    const steps = Math.max(Math.abs(x - prevX), Math.abs(y - prevY), 1);
    for (let s = 0; s <= steps; s++) {
      canvas.set(
        Math.round(prevX + ((x - prevX) * s) / steps),
        Math.round(prevY + ((y - prevY) * s) / steps),
        color
      );
    }
    prevX = x;
    prevY = y;
  }
}

// ---------- formatting ----------
const pct = x =>
  x == null ? ' n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const usd = x =>
  x == null
    ? 'n/a'
    : `$${Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)}`;

function gateBadge(name, gate) {
  const short = {
    dataIntegrity: 'data',
    faithfulness: 'faith',
    outOfSample: 'oos',
    realisticCosts: 'cost',
    multipleTesting: 'multi',
  }[name];
  if (!gate) return col(`· ${short}`, C.gray);
  if (gate.status === 'pass') return col(`✓ ${short}`, C.green);
  if (gate.status === 'fail') return col(`✗ ${short}`, C.brightRed);
  return col(`· ${short}`, C.gray);
}

function verdictColor(verdict) {
  if (verdict === 'VALIDATED') return C.brightGreen;
  if (verdict.startsWith('FAILED')) return C.brightRed;
  return C.yellow;
}

// ---------- sections ----------
function renderHeader(art, width) {
  const v = art.validation;
  const lines = [];
  const bar = '═'.repeat(width);
  lines.push(col(bar, C.gray));
  lines.push(
    `${col(art.strategy.family, C.dim)} ${col('›', C.gray)} ${col(art.strategy.id, C.bold)}  ` +
      col(`[${v.verdict}]`, verdictColor(v.verdict) + C.bold)
  );
  if (art.strategy.description)
    lines.push(col(art.strategy.description, C.gray));
  const gates = Object.keys(v.gates)
    .map(g => gateBadge(g, v.gates[g]))
    .join('  ');
  lines.push(`gates: ${gates}`);
  const w = art.data.window || {};
  lines.push(
    col(
      `${w.start} → ${w.end}  ·  ${art.data.source}/${art.data.adjustment}  ·  capital ${usd(art.capital)}`,
      C.gray
    )
  );
  const s = art.stats;
  const b = art.benchmark;
  lines.push(
    `CAGR ${col(pct(s.cagr), s.cagr >= 0 ? C.green : C.red)}  Vol ${pct(s.vol)}  ` +
      `Sharpe ${col(s.sharpe.toFixed(2), C.bold)}  MaxDD ${col(pct(s.maxDD), C.red)}  ` +
      `Calmar ${s.calmar.toFixed(2)}  Trades ${art.trades.length}`
  );
  if (b) {
    lines.push(
      col(
        `vs ${b.symbol} B&H: CAGR ${pct(b.stats.cagr)}  Sharpe ${b.stats.sharpe.toFixed(2)}  MaxDD ${pct(b.stats.maxDD)}`,
        C.gray
      )
    );
  }
  lines.push(col(bar, C.gray));
  return lines;
}

function renderEquity(art, width, upTo) {
  const values = art.equity.values.slice(0, upTo);
  const bench = art.equity.benchmark
    ? art.equity.benchmark.slice(0, upTo)
    : null;
  const all = bench ? values.concat(art.equity.benchmark) : art.equity.values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const canvas = new Canvas(width, 12);
  const domainN = art.equity.values.length;
  if (bench) plotLine(canvas, bench, { min, max, color: C.gray, domainN });
  plotLine(canvas, values, { min, max, color: C.brightGreen, domainN });
  const rows = canvas.render();
  const lines = [];
  const last = values[values.length - 1];
  lines.push(
    col('EQUITY ', C.bold) +
      col('— strategy ', C.brightGreen) +
      (bench ? col(`— ${art.benchmark.symbol} B&H `, C.gray) : '') +
      col(`   ${usd(last)}`, last >= art.capital ? C.green : C.red)
  );
  rows.forEach((r, i) => {
    let label = '';
    if (i === 0) label = col(` ${usd(max)}`, C.gray);
    if (i === rows.length - 1) label = col(` ${usd(min)}`, C.gray);
    lines.push(r + label);
  });
  return lines;
}

function renderDrawdown(art, width, upTo) {
  const dd = art.equity.drawdown.slice(0, upTo);
  const minDD = Math.min(...art.equity.drawdown, -0.0001);
  const canvas = new Canvas(width, 4);
  plotLine(canvas, dd, {
    min: minDD,
    max: 0,
    color: C.red,
    domainN: art.equity.drawdown.length,
  });
  const lines = [];
  const cur = dd[dd.length - 1];
  lines.push(
    col('DRAWDOWN ', C.bold) +
      col(`now ${pct(cur)}  worst ${pct(minDD)}`, C.gray)
  );
  canvas.render().forEach((r, i) => {
    let label = '';
    if (i === 0) label = col(' 0%', C.gray);
    if (i === 3) label = col(` ${pct(minDD)}`, C.gray);
    lines.push(r + label);
  });
  return lines;
}

function renderPrice(art, symbol, width, upTo, dateIndex) {
  const bars = art.bars[symbol];
  if (!bars || !bars.length) return [col(`no bars for ${symbol}`, C.gray)];
  // align bars to the equity date domain so markers line up with time
  const dates = art.equity.dates;
  const closeByDate = new Map(bars.map(b => [b.date, b.close]));
  const closes = [];
  let lastClose = null;
  for (const d of dates) {
    if (closeByDate.has(d)) lastClose = closeByDate.get(d);
    closes.push(lastClose);
  }
  const shown = closes.slice(0, upTo);
  const valid = closes.filter(v => v != null);
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const canvas = new Canvas(width, 9);
  const firstIdx = closes.findIndex(v => v != null);
  plotLine(canvas, shown.slice(firstIdx), {
    min,
    max,
    color: C.cyan,
    domainN: closes.length - firstIdx,
  });
  // artifact overlays (extra.levels POC / extra.avwap) — plotted VERBATIM on
  // the same date domain as the closes; values outside the close range clip;
  // skipped silently when the artifact carries no extra
  const overlays = [];
  const lv = art.extra && art.extra.levels ? art.extra.levels[symbol] : null;
  if (Array.isArray(lv) && lv.length) {
    overlays.push({
      label: 'POC',
      color: C.yellow,
      points: lv.filter(l => l.poc != null).map(l => [l.date, l.poc]),
    });
  }
  const aw = art.extra && art.extra.avwap ? art.extra.avwap[symbol] : null;
  if (aw && Array.isArray(aw.points) && aw.points.length) {
    overlays.push({
      label: `AVWAP@${aw.anchor}`,
      color: C.magenta,
      points: aw.points
        .filter(p => p.value != null)
        .map(p => [p.date, p.value]),
    });
  }
  for (const o of overlays) {
    const byDate = new Map(o.points);
    const series = [];
    let lastVal = null;
    for (const d of dates) {
      if (byDate.has(d)) lastVal = byDate.get(d);
      series.push(lastVal);
    }
    const fi = series.findIndex(v => v != null);
    if (fi < 0) continue;
    plotLine(canvas, series.slice(fi, upTo), {
      min,
      max,
      color: o.color,
      domainN: closes.length - firstIdx,
      offset: fi - firstIdx,
    });
  }
  // markers
  const span = max - min || 1;
  const n = closes.length - firstIdx;
  for (const t of art.trades) {
    if (t.symbol !== symbol) continue;
    const i = dateIndex.get(t.date);
    if (i == null || i >= upTo || i < firstIdx) continue;
    const px = Math.round(((i - firstIdx) / (n - 1)) * (canvas.pw - 1));
    const py = Math.round((1 - (t.price - min) / span) * (canvas.ph - 1));
    if (t.side === 'buy')
      canvas.overlay(px, Math.min(canvas.ph - 1, py + 4), '▲', C.brightGreen);
    else canvas.overlay(px, Math.max(0, py - 4), '▼', C.brightRed);
  }
  const lines = [];
  const buys = art.trades.filter(
    t => t.symbol === symbol && t.side === 'buy'
  ).length;
  const sells = art.trades.filter(
    t => t.symbol === symbol && t.side === 'sell'
  ).length;
  lines.push(
    col(`PRICE ${symbol} `, C.bold) +
      col(`(adjusted close)  `, C.gray) +
      col(`▲${buys} buys `, C.brightGreen) +
      col(`▼${sells} sells`, C.brightRed) +
      overlays.map(o => col(`  ─${o.label}`, o.color)).join('')
  );
  canvas.render().forEach((r, i) => {
    let label = '';
    if (i === 0) label = col(` $${max.toFixed(0)}`, C.gray);
    if (i === 8) label = col(` $${min.toFixed(0)}`, C.gray);
    lines.push(r + label);
  });
  return lines;
}

function renderXAxis(art, width, upTo) {
  const dates = art.equity.dates;
  const n = dates.length;
  const first = dates[0];
  const mid = dates[Math.floor((n - 1) / 2)];
  const last = dates[n - 1];
  const cursorIdx = Math.min(upTo - 1, n - 1);
  let axis =
    first +
    ' '.repeat(Math.max(1, Math.floor(width / 2) - first.length - 5)) +
    mid;
  axis += ' '.repeat(Math.max(1, width - axis.length - last.length)) + last;
  const lines = [col(axis, C.gray)];
  if (upTo < n) {
    const cx = Math.round((cursorIdx / (n - 1)) * (width - 1));
    lines.unshift(
      ' '.repeat(cx) +
        col('▾', C.yellow) +
        col(` ${dates[cursorIdx]}`, C.yellow)
    );
  }
  return lines;
}

function renderTrades(art, upTo, dateIndex, limit = 10) {
  const visible = art.trades.filter(t => {
    const i = dateIndex.get(t.date);
    return i != null && i < upTo;
  });
  const lines = [];
  lines.push(
    col('TRADES ', C.bold) +
      col(
        `${visible.length} of ${art.trades.length} shown (last ${Math.min(limit, visible.length)})`,
        C.gray
      )
  );
  lines.push(
    col(
      '  date        side  symbol     price        qty       pnl     pnl%   reason',
      C.gray
    )
  );
  for (const t of visible.slice(-limit)) {
    const side =
      t.side === 'buy' ? col('BUY ', C.brightGreen) : col('SELL', C.brightRed);
    const pnlStr =
      t.pnl == null
        ? col('       —', C.gray)
        : col(
            `${t.pnl >= 0 ? '+' : ''}${Math.round(t.pnl).toLocaleString('en-US')}`.padStart(
              8
            ),
            t.pnl >= 0 ? C.green : C.red
          );
    const pnlPctStr =
      t.pnlPct == null
        ? col('      —', C.gray)
        : col(pct(t.pnlPct).padStart(7), t.pnlPct >= 0 ? C.green : C.red);
    lines.push(
      `  ${t.date}  ${side}  ${String(t.symbol).padEnd(6)} ${(
        '$' + t.price.toFixed(2)
      ).padStart(
        9
      )} ${String(t.qty.toFixed(1)).padStart(10)} ${pnlStr}  ${pnlPctStr}   ${col(t.reason || '', C.gray)}`
    );
  }
  return lines;
}

function renderFooter(art, width) {
  const lines = [];
  const r = art.reconciliation;
  if (r) {
    const ok = r.note.startsWith('trade ledger ties');
    lines.push(
      col('LEDGER CHECK ', C.bold) +
        col(
          `realized ${usd(r.realizedPnl)} + unrealized ${usd(r.unrealizedPnl)} vs equity ${usd(r.equityPnl)} → gap ${usd(r.gap)}`,
          ok ? C.green : C.yellow
        )
    );
    if (!ok) lines.push(col(`  ⚠ ${r.note}`, C.yellow));
  }
  if (art.notes && art.notes.length) {
    lines.push(col('CAVEATS', C.bold));
    for (const note of art.notes) lines.push(col(`  • ${note}`, C.gray));
  }
  lines.push(col('═'.repeat(width), C.gray));
  return lines;
}

// ---------- frame assembly ----------
function renderFrame(art, { width, symbol, upTo, dateIndex, replay }) {
  const out = [];
  out.push(...renderHeader(art, width));
  out.push('');
  out.push(...renderEquity(art, width, upTo));
  out.push(...renderDrawdown(art, width, upTo));
  out.push(...renderPrice(art, symbol, width, upTo, dateIndex));
  out.push(...renderXAxis(art, width, upTo));
  out.push('');
  out.push(...renderTrades(art, upTo, dateIndex, replay ? 6 : 12));
  if (!replay || upTo >= art.equity.dates.length) {
    out.push('');
    out.push(...renderFooter(art, width));
  }
  return out.join('\n');
}

// ---------- main ----------
function listMode() {
  const runs = listRuns();
  if (!runs.length) {
    console.log('No run artifacts yet. Run a backtest first, e.g.:');
    console.log('  node scripts/backtests/ts-momentum-trend.js');
    return;
  }
  console.log(
    col('\nAvailable backtest runs (data/backtests/runs):\n', C.bold)
  );
  console.log(
    col('verdict      sharpe   maxDD     cagr  trades  runId', C.gray)
  );
  for (const r of runs) {
    const v = r.verdict || 'UNVALIDATED';
    console.log(
      `${col(v.padEnd(12), verdictColor(v))} ${r.stats.sharpe.toFixed(2).padStart(6)} ${pct(
        r.stats.maxDD
      ).padStart(
        7
      )} ${pct(r.stats.cagr).padStart(8)} ${String(r.nTrades).padStart(7)}  ${r.runId}`
    );
  }
  console.log(
    col(
      '\nview:   node scripts/backtests/view-run.js <runId> [--replay]',
      C.gray
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {};
  const positional = [];
  for (const a of args) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else positional.push(a);
  }

  if (!positional.length) return listMode();

  const art = loadRunArtifact(positional[0]);
  const width = Math.min(
    parseInt(flags.width || '0', 10) || (process.stdout.columns || 100) - 14,
    120
  );

  // default symbol: the most-traded one
  let symbol = flags.symbol;
  if (!symbol) {
    const counts = {};
    for (const t of art.trades) counts[t.symbol] = (counts[t.symbol] || 0) + 1;
    symbol =
      Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      Object.keys(art.bars)[0];
  }

  const dateIndex = new Map(art.equity.dates.map((d, i) => [d, i]));
  const n = art.equity.dates.length;

  if (!flags.replay) {
    console.log(
      renderFrame(art, { width, symbol, upTo: n, dateIndex, replay: false })
    );
    return;
  }

  // ---- replay mode ----
  const speed = parseInt(flags.speed || '15', 10);
  const step = Math.max(1, Math.floor(n / 400)); // ~400 frames max
  process.stdout.write(HIDE_CURSOR + CLEAR);
  const restore = () => process.stdout.write(SHOW_CURSOR + '\n');
  process.on('SIGINT', () => {
    restore();
    process.exit(0);
  });
  try {
    for (let upTo = Math.max(2, step); upTo <= n; upTo += step) {
      const frame = renderFrame(art, {
        width,
        symbol,
        upTo: Math.min(upTo, n),
        dateIndex,
        replay: true,
      });
      process.stdout.write(
        HOME + frame.replace(/\n/g, `${ESC}K\n`) + `${ESC}J`
      );
      await new Promise(r => setTimeout(r, speed));
    }
    // final full frame with footer
    process.stdout.write(
      HOME +
        renderFrame(art, { width, symbol, upTo: n, dateIndex, replay: false }) +
        `${ESC}J\n`
    );
  } finally {
    restore();
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
