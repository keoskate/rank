import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../signalEvaluator.js'), 'utf8');

function extractFunctionBody(source, fnName) {
  const startRegex = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\(`);
  const startMatch = source.match(startRegex);
  if (!startMatch) return null;
  let i = source.indexOf('{', startMatch.index);
  if (i === -1) return null;
  let depth = 1;
  const bodyStart = i + 1;
  i++;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return source.slice(bodyStart, i - 1);
}

describe('signalEvaluator scope hygiene', () => {
  // Regression: leverage was used in evaluateExit() but only declared inside
  // evaluateEntry(). Caused ReferenceError → 3-strike force-exit on every
  // profitable position above stop-loss. Real cost on 2026-04-30:
  // forced exit of 68 SOXL @ $120.31 instead of riding trailing TP, then
  // a 63-share round-trip ending in -$17.25 the same day.
  it('evaluateExit declares any identifier it uses (leverage, cfg, stopLossPercent)', () => {
    const body = extractFunctionBody(src, 'evaluateExit');
    expect(body, 'evaluateExit not found').toBeTruthy();

    for (const name of ['leverage', 'cfg', 'stopLossPercent']) {
      const used = new RegExp(`\\b${name}\\b`).test(body);
      if (!used) continue;
      const declared = new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(body);
      expect(
        declared,
        `evaluateExit() uses '${name}' but does not declare it in scope — regression of the leverage-scope bug from 2026-04-30`
      ).toBe(true);
    }
  });

  it('evaluateEntry declares any identifier it uses (leverage, cfg, stopLossPercent)', () => {
    const body = extractFunctionBody(src, 'evaluateEntry');
    expect(body, 'evaluateEntry not found').toBeTruthy();

    for (const name of ['leverage', 'cfg', 'stopLossPercent']) {
      const used = new RegExp(`\\b${name}\\b`).test(body);
      if (!used) continue;
      const declared = new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(body);
      expect(declared, `evaluateEntry() uses '${name}' but does not declare it in scope`).toBe(true);
    }
  });
});
