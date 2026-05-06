# @kpe/quant-core

Pure quant primitives. No I/O, no side effects, no vendor coupling.

Every module here is a function (or class) of its inputs alone — no
network calls, no filesystem reads, no module-level state that depends
on runtime context. Drop-in usable in any project that needs the same
math.

## What's in here

| Module | What it does |
|---|---|
| `tradingCalculations` | ETF leverage map (`getEtfLeverage`), market hours, DST, holiday calendars, position sizing |
| `LeveragedEtfStrategy` | ETF family lookup (SOXL↔SOXS), flow sentiment, decision composition |
| `LeveragedEtfRules` | Time-based + volatility-based constraint application, decay estimation |

## Usage

```js
const { getEtfLeverage, isMarketOpen, LeveragedEtfStrategy } = require('@kpe/quant-core');

getEtfLeverage('SOXL');                    // 3
isMarketOpen(new Date());                  // true | false
new LeveragedEtfStrategy().getFamily('SOXL'); // { bull: {...}, bear: {...} }
```

## Verification

Two layers of test coverage live with this package:

1. **Unit tests** (`tradingCalculations.test.js`) — 44 tests covering math
   and rule semantics directly.
2. **Golden fixtures** (`fixtures/golden/*.json` at repo root) — captured
   input/output pairs locked in. Runs as part of the main test suite via
   `server/__tests__/golden.fixtures.test.js`. Any drift between the
   captured behavior and the live module fails the suite.

## Adding a module

1. Drop the file into `src/`.
2. Re-export it from `src/index.js`.
3. If you're moving an existing in-repo module, leave a one-line shim at
   the old path: `module.exports = require('../packages/quant-core/src/yourModule');`
   so existing callers keep working.
4. Add fixtures via `scripts/capture-fixtures.js` so future refactors
   can't change behavior accidentally.
