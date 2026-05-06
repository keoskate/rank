---
description: Guided self-improvement - analyze, propose, validate, commit
argument-hint: "[session name or area to optimize]"
---

# Trading System Optimization

Optimize: $ARGUMENTS

Run a 4-phase guided self-improvement workflow. **Never make changes without explicit user approval.**

---

## Phase 1: Analyze (read-only)

Gather data from all available sources. Do NOT make any changes in this phase.

### 1a. System State
Same data gathering as `/healthcheck`:
- GET `http://localhost:8080/api/alpaca/account` — account status
- GET `http://localhost:8080/api/alpaca/positions` — open positions
- GET `http://localhost:8080/api/ai/sessions/default_user` — all sessions and stats

If `$ARGUMENTS` specifies a session name, scope analysis to that session only.

If the server is down, skip API calls and analyze files directly (`data/ai-sessions.json`, `server.log`).

### 1b. Performance Analysis
For each running session with enough data (minimum 3 trades):
- Win rate and trend (improving or declining?)
- Average win vs average loss (risk/reward ratio)
- Max drawdown and recovery
- Profit factor
- Trade frequency (too many? too few?)

### 1c. Pattern Detection
Search `server.log` for patterns:
- Are exits happening too early (small wins, big losses)?
- Are entries too timid (low confidence threshold filtering out good trades)?
- Is position sizing appropriate for account size?
- Are stop losses being hit frequently (too tight)?
- Are take profits being hit (or are trades reversing before target)?
- Is trend dampening working as expected?

### 1d. Improvement History
Read `data/improvement-log.json` (if it exists) to understand:
- What optimizations were tried before?
- What worked and what was reverted?
- Are there recurring issues?

### 1e. Present Analysis
Summarize findings in a clear format:
```
OPTIMIZATION ANALYSIS
=====================
Scope:       [all sessions | specific session name]
Data Period:  [date range of trades analyzed]
Trade Count:  [N trades across M sessions]

KEY FINDINGS
============
1. [Finding with supporting data]
2. [Finding with supporting data]
...

PATTERNS DETECTED
=================
- [Pattern]: [evidence and impact]
...
```

---

## Phase 2: Propose

Based on the analysis, present specific optimization proposals. Group by type:

### Config Changes (via API, reversible, no restart needed)
These are parameter adjustments applied via `PUT http://localhost:8080/api/ai/session/:sessionId/config`.

For each proposal:
- **What**: Exact parameter and new value (with current value)
- **Why**: Data-driven rationale from Phase 1
- **Risk**: LOW / MEDIUM / HIGH
- **Expected Impact**: What should improve
- **Bounded by**: Parameter changes should not exceed +/-25% from current value

### Code Changes (requires validation + commit)
These are modifications to server files.

For each proposal:
- **What**: Exact file and change description
- **Why**: Data-driven rationale
- **Risk**: LOW / MEDIUM / HIGH
- **Expected Impact**: What should improve
- **Tier**: Which MVP tier does the file belong to

### Present all proposals and ASK THE USER:
```
OPTIMIZATION PROPOSALS
======================

CONFIG CHANGES (reversible via API):
  1. [proposal] — Risk: LOW — [rationale]
  2. [proposal] — Risk: MEDIUM — [rationale]

CODE CHANGES (requires commit):
  3. [proposal] — Risk: LOW — [rationale]

Which proposals would you like to apply? (e.g., "1,2" or "all" or "none")
```

**STOP HERE and wait for user approval before proceeding to Phase 3.**

---

## Phase 3: Execute (only approved changes)

Apply only the proposals the user approved.

### For Config Changes:
```bash
# Apply via API
curl -X PUT "http://localhost:8080/api/ai/session/SESSION_ID/config" \
  -H "Content-Type: application/json" \
  -d '{"paramName": newValue}'
```

Verify each change took effect by re-reading the session config.

### For Code Changes:
1. Edit the file(s) directly
2. Show the exact diff to the user
3. Validate:
   ```bash
   # Syntax check all modified .js files
   node -c path/to/modified/file.js

   # Build check
   npm run build
   ```
4. If any validation fails, revert the change and report the error

### For Tier 1 MVP files (aiTradingEngine.js, alpacaClient.js, index.js):
- Always show the complete diff before applying
- Run extra validation: syntax check + build + curl health check
- Ask for explicit confirmation even if already approved in Phase 2

---

## Phase 4: Verify & Commit

### Verify
After all changes are applied:
1. Check server is still healthy: `curl -sf http://localhost:8080/api/alpaca/account`
2. Check sessions are still running: `curl -sf "http://localhost:8080/api/ai/sessions/default_user"`
3. If code was changed, run `npm run build` to verify no build errors

### Commit (if code changed)
**Ask the user before committing.** If approved:
```bash
git add <specific files>
git commit -m "optimize: [description of changes]

- [bullet point per change with rationale]
- Based on analysis of [N] trades across [sessions]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Summary
Present a before/after summary:
```
OPTIMIZATION SUMMARY
====================
Changes Applied:
  - [change 1]: [before] → [after]
  - [change 2]: [before] → [after]

Skipped/Rejected:
  - [proposal]: [reason]

Validation: PASSED / FAILED
Committed:  YES (hash) / NO (config only) / NO (user declined)

NEXT STEPS
==========
- Monitor [session] for [N] trades to evaluate impact
- Re-run /optimize after [timeframe] to assess results
- [Any other recommendations]
```

---

## Safety Guardrails

These rules are enforced throughout all phases:

1. **Never auto-apply changes** — always ask for approval first
2. **Never change Tier 1 files without showing the exact diff**
3. **Parameter changes bounded by +/-25%** from current values (e.g., if stopLossPercent is 4%, new value must be between 3% and 5%)
4. **Handle server-down gracefully** — skip API calls, analyze files only, note that config changes require the server
5. **Scope to $ARGUMENTS** — if a session name or area is specified, focus analysis and proposals on that scope only
6. **Minimum data requirement** — don't propose changes for sessions with fewer than 3 trades
7. **Log everything** — if `data/improvement-log.json` exists, append a record of this optimization cycle
