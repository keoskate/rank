---
description: Feature implementation workflow - 7-phase guide for new features
argument-hint: "[feature description]"
---

# Feature Implementation Workflow

Implement: $ARGUMENTS

## Phase 1: Understand

1. **Parse the feature request** - What exactly needs to be built?
2. **Identify target page/component** - Where does this feature live?
3. **Check existing patterns** - How do similar features work in this codebase?

## Phase 2: Classify

Determine if files touched are MVP (require high rigor) or experimental:

**MVP Files (Tier 1 - CRITICAL):**
- `server/aiTradingEngine.js`, `server/alpacaClient.js`, `server/index.js`
- `LiveTradingDashboard.jsx`, `TradingSessionsList.jsx`

**MVP Files (Tier 2 - HIGH IMPACT):**
- Technical indicators, regime detector, backtester, Polygon client
- `ConfigPanel.jsx`, `StrategyValidatorPanel.jsx`, `TradingLogPanel.jsx`

**MVP Files (Tier 3 - SUPPORTING):**
- WebSocket server, trading logger, CheddarFlow scraper

If touching MVP files, apply extra rigor in validation phase.

## Phase 3: Plan

1. List all files to create/modify
2. Identify any new dependencies needed
3. Consider edge cases and error handling
4. Note any API changes or data model changes

## Phase 4: Implement

1. Write the code
2. Follow existing patterns and conventions
3. Use path aliases (`@common`, `@pages`, etc.) for imports
4. Keep changes minimal and focused

## Phase 5: Validate

Run these checks before committing:

```bash
# 1. Build check
npm run build

# 2. Lint check
npm run lint

# 3. If MVP files touched, run MVP check
npm run check-mvp
```

For MVP changes, also verify:
- [ ] No breaking changes to existing functionality
- [ ] Error cases handled
- [ ] Trading logic changes tested with backtest if applicable

## Phase 6: Test

If feature is testable:
1. Add/update tests in `tests/` directory
2. For UI features, consider Puppeteer screenshot tests
3. For trading logic, consider backtest validation

## Phase 7: Commit

Only if all validation passes:

```bash
git add <files>
git commit -m "feat: <description>

- <bullet points of what changed>

<scope>: MVP | experimental
"
```

---

**Start by telling me what you understand about this feature request, then proceed through each phase.**
