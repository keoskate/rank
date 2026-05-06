import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../orderExecutor.js'), 'utf8');

describe('orderExecutor — sell-side P&L fallback chain', () => {
  // Regression: force-exit paths (stale-guard, EOD, sentiment-driven force
  // exit) call executeExit with a stub decision that has only shouldExit and
  // a reason — no entryPrice, no pnl, no quantity. Prior to 2026-05-06, when
  // entryContext was also missing, the P&L computation fell through to
  // entryPrice = 0, which made the ternary short-circuit to decision.pnl || 0
  // and log the trade as "+$0.00" even when the actual realized gain was real.
  // Today's SOXL EOD exit logged $0 P&L on what was a real +$252 winner.
  //
  // The fix adds session.portfolio.positions[symbol].averageCost as a third
  // fallback after entryContext and decision.entryPrice. This test asserts
  // that fallback chain is intact so it can't regress.

  it('full-exit entryPrice fallback chain includes entryContext + decision + session-position', () => {
    // Find every `const entryPrice = ...` declaration in the file. There are
    // multiple (partial-exit, full-exit). At least one — specifically the
    // full-exit path that runs after force-exits — must reference all three
    // sources so a stub decision still resolves to a real P&L.
    const matches = [...src.matchAll(/const\s+entryPrice\s*=\s*([\s\S]*?);/g)];
    expect(matches.length, 'expected at least one `const entryPrice = ...` declaration').toBeGreaterThan(0);

    const fullChain = matches.find(m =>
      /entryContext/.test(m[1]) &&
      /decision\.entryPrice/.test(m[1]) &&
      /averageCost/.test(m[1])
    );

    expect(
      fullChain,
      'no entryPrice declaration falls back through entryContext → decision.entryPrice → session position averageCost — regression of 2026-05-06 force-exit logging $0.00'
    ).toBeTruthy();
  });

  it('positionState is read from session.portfolio.positions', () => {
    expect(src).toMatch(/const\s+positionState\s*=\s*[^;]*session\.portfolio\??\.positions/);
  });

  it('actualPnl still gates on entryPrice > 0 (no division-by-zero or false positives)', () => {
    // Sanity check: the existing guard against bad entryPrice must remain.
    expect(src).toMatch(/entryPrice\s*>\s*0\s*\?\s*\(filledPrice\s*-\s*entryPrice\)\s*\*\s*quantity/);
  });
});
