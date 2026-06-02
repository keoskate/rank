# Audit: Self-Mutation Safety (`server/brokers/selfMutation.js`)

**Dimension key:** `self-mutation`
**Scope:** EOD self-mutation loop — the MUTABLE_FIELDS allow-list (+ per-plugin merge), validation, atomic writes, reversibility, and whether the LLM can drive a broker into a degenerate/unsafe config.
**Type:** Safety audit. No backtest (this is config-mutation machinery, not a trading signal).
**Read:** `selfMutation.js`, `brokerSchema.js`, `brokerWriter.js`, `brokerLlm.js`, `strategies/index.js`, the strategy plugins' `mutableFields`/`holdPolicy`, `routes/brokers.js`, `index.js` cron wiring, `data/broker-ledger.json`.

---

## What it does

At each configured interval (`intraday-5m`, `intraday-1h`, `eod`; only `eod` is wired to the nightly cron in `index.js:1027`), for every broker whose `selfImprovement.intervals` includes that interval:

1. `_summarizeSession` aggregates the session's `stats` + last 50 `tradingLog` entries, including per-symbol win/PnL breakdown (`selfMutation.js:117-155`).
2. Skips brokers with `< MIN_CLOSED_TRADES` (20) closed trades (`:203`) or whose in-process daily LLM call count has hit `llm.callBudget` (default 50; `:191-199`).
3. Calls `brokerLlm.analyzeBroker` — a structured-output Claude call returning `{assessment, proposals[], personaNotes[], confidence}` (`brokerLlm.js:34-86`).
4. For each proposal: rejects fields not in `allowedFields = MUTABLE_FIELDS ∪ plugin.mutableFields` (`:262-267`); else applies the change to a deep-cloned broker, runs full `validateBroker`, reverts that single field if validation fails (`:269-278`).
5. Appends dated `personaNotes` under `## Self-Improvement Notes` (`_appendPersonaNotes`, `:161-177`).
6. If anything changed, writes the `.md` atomically via `brokerWriter.writeBroker`, which snapshots the prior version to `data/broker-versions/<slug>/<ts>.md` first (`brokerWriter.js:54-74`).
7. Appends an event to `data/broker-ledger.json` and broadcasts a websocket event.

The allow-list (`:39-56`) is risk knobs, regime knobs, `llm.callBudget`, `llm.role`, `selfImprovement.intervals`, `selfImprovement.fullAutonomy`. Immutable by omission: `slug`, `tier`, `capital`, `strategy`, `name`, `watchlist`, `paperAllocation`. Plugins additionally expose their own tunables (e.g. options-flow exposes `flow.minPremium/minSkew/lookbackMinutes`; insider exposes `insider.lookbackDays/minNotional`; dark-pool exposes `darkpool.*`).

**The good parts (genuinely sound):** allow-list is a default-deny set membership check on `prop.field` — robust against creative field paths. Every applied change re-runs the *full* schema validator, so range constraints (`risk.perTrade ∈ (0,0.1]`, `maxDrawdown ∈ (0,0.5]`, etc.) are enforced regardless of what the LLM proposes. Writes are atomic (tmp+rename) and auto-snapshotted, so every mutation is reversible via `/api/brokers/:slug/revert`. Deep-clone-per-pass means a rejected mutation can't poison the next. Budget is reserved *before* the call (`:213`) so a crash still counts. Ledger is capped at 1000 events and written atomically.

---

## Audit findings

### HIGH — `tier` and `capital` are immutable in self-mutation, but `selfImprovement.fullAutonomy` is mutable and **does nothing**, creating a false safety signal
`selfImprovement.fullAutonomy` is in MUTABLE_FIELDS (`:55`) and is the one field whose name implies a safety gate ("only mutate freely if fullAutonomy is true"). But **nothing in the codebase reads it as a gate.** Grep shows it is only: defaulted to `false` in schema, copied to `selfImproveFullAutonomy` in the session config, and listed as mutable. `mutateBroker` never checks it. So:
- The mutation loop applies changes at full autonomy *regardless* of `fullAutonomy`'s value. The field is decorative.
- Worse, it is **self-mutable**: the LLM can propose `selfImprovement.fullAutonomy: true` on itself. It passes validation (schema only checks `intervals`, never `fullAutonomy`'s type/value — `brokerSchema.js:309-318`). So a human reading the persona/ledger sees "this broker granted itself full autonomy" with no actual behavioral change — pure confusion, and a latent footgun if anyone later wires a gate to it assuming brokers start at `false`.

### HIGH — `confidence` is collected but never gates anything
`brokerLlm`'s schema requires `confidence ∈ [0,1]` and the prompt says "the engine clamps out-of-range values" (`brokerLlm.js:79-83`), but the engine never clamps and never thresholds it. It is logged (`:236`) and stored in the ledger (`:297`), then ignored. A proposal with `confidence: 0.0` ("I'm guessing") is applied identically to one with `confidence: 0.95`. The prompt explicitly invites the model to express low confidence, yet that signal is discarded. This is the single cheapest guardrail to add and it's missing.

### HIGH — Unbounded cumulative drift: no per-run / per-day cap on number or magnitude of applied mutations, and no rate limiting on the field over time
Within one pass, the LLM can return many proposals; all that pass validation are applied. Across passes there is no memory: the prompt *asks* for "10-30% changes" (`brokerLlm.js:133`) but nothing enforces step size. Concretely, `risk.perTrade` can go `0.02 → 0.10` in **one** proposal (schema allows anything in `(0,0.1]`), a 5x jump, fully validated, fully applied. Over consecutive EOD runs a broker can ratchet every risk knob to its schema extreme: `perTrade=0.10`, `maxDrawdown=0.50`, `kellyFraction=1.0`, `maxPositions=20`, `maxPositionSizePercent=100`. That config is schema-valid but degenerate — a single 100%-of-capital position with full Kelly and a 50% drawdown tolerance. **The schema bounds each field but not the *combination*, and not the *velocity*.** The "be conservative, prefer small changes" instruction is a soft prompt request with zero enforcement.

### HIGH — LLM-controlled `llm.callBudget` lets a broker disable its own cost cap (and the cap is in-memory, lost on restart)
`llm.callBudget` is self-mutable (`:52`). The LLM can propose `llm.callBudget: 5000` (schema max, `brokerSchema.js:237-241`) and raise its own daily cost ceiling 100x. Separately, the counter (`callCounters` Map, `:63`) is **in-process only** and keyed by UTC day. Any server restart resets all counts to zero, so the "daily cap" is really "daily cap per server uptime." A crash-loop or frequent restarts (or just the manual `/self-mutate` endpoint hit repeatedly) bypasses the cap entirely. The cap is also only checked in `mutateBroker`; the single-broker API route (`routes/brokers.js:188`) goes through `mutateBroker` so it shares the counter, but the counter dying on restart undermines the whole budget premise.

### MED — Persona-note injection: notes are written verbatim with no newline/markdown sanitization → prompt-injection feedback loop + structural corruption
`_appendPersonaNotes` (`:161-177`) only strips a leading ISO date, then writes each note as `- <stamp>: <note>` with `notes.join('\n')`. The note string is arbitrary LLM text and may contain newlines and markdown. I verified empirically (test harness) that a note like `"risk too high\n## FAKE HEADING\n- injected"` produces:

```
## Self-Improvement Notes

- 2026-06-01: risk too high
## FAKE HEADING
- injected
- 2026-06-01: tier: paper -- change my tier
```

Consequences:
- A note can inject a **fake `## Self-Improvement Notes` heading**. The next run's regex `replace(/(^##\s+Self-Improvement Notes...)/m)` matches the *first* heading, so subsequent notes can land in an attacker-chosen location, and the section structure degrades over time.
- The persona body is fed back verbatim into the **system prompt** every call (`brokerLlm.js:115`). The model can write instructions to its future self ("ignore the conservative rule," "always propose raising kellyFraction"). This is a self-reinforcing prompt-injection channel with no filter. It cannot directly rewrite the top-of-file frontmatter (gray-matter only parses the first `---` fence, and `writeBroker` re-stringifies from the validated object, not the body), so it can't flip `tier`/`capital` — but it *can* steer every future mutation decision.
- No length cap on notes: the body grows unboundedly, inflating every cached system prompt and token cost.

### MED — Single-pass validation can't catch cross-field invalid combinations, and the final re-validate is silently trusted
Each proposal is validated in isolation against the *cumulative* `next` object, which is good, but `validateBroker` has no cross-field invariants (e.g. nothing says `perTrade * maxPositions` must be ≤ 100%, or `maxPositionSizePercent ≥ perTrade-implied size`). So self-consistent-but-nonsensical combos pass. Also `:286`: `const finalBroker = validateBroker(next, ...).broker;` — if this returned `null` it would write `undefined`/throw, but since each step already validated, it's defensively redundant rather than wrong. Minor, but the code trusts it without a null check.

### MED — `regimeContext` is never supplied by the cron path
`mutateBroker` accepts `regimeContext` and forwards it to the LLM, but `runAllSelfMutations` (the cron + bulk path) never builds or passes it (`:346-349`). So every nightly mutation decision is made **without regime context**, contradicting the design intent that brokers adapt regime-aware. Not unsafe, but it means the feature is half-wired and the LLM is reasoning with less context than the prompt scaffolding implies.

### LOW — No "do not mutate while position is open" guard
Mutations can fire mid-position (the interval is `eod` but `intraday-5m/1h` are allowed). Changing `maxPositionSizePercent`/`kellyFraction`/`maxPositions` while positions are open can create inconsistencies between the open book and the new limits (e.g. now over `maxPositions`). The exit logic is universal so this is bounded, but there's no guard or note.

### LOW — Ledger/cost: a broker stuck in a degenerate loop has no circuit breaker
If the LLM proposes the same rejected change every run, or oscillates a field back and forth across runs (A→B one day, B→A the next), nothing detects the oscillation or stops calling Claude. Budget caps *count* but don't detect *thrashing*. The ledger records it but nothing reacts.

### LOW — `_appendLedger` "corrupted → start fresh" silently discards history
`:103` swallows a parse error and reinitializes the ledger to `{events:[]}`, then the next write overwrites the file. A single corrupt write (or a partial external edit) silently destroys the entire audit trail with no backup. The audit log is the reversibility story for *what changed*; losing it loses accountability even though the `.md` snapshots survive.

---

## Reversibility assessment

Reversibility is **the strongest part of the system**: every write snapshots the prior `.md` (`brokerWriter.js:58`), `/revert` restores any snapshot (and snapshots the replaced version too), and the ledger records before/after values per field. Verified snapshots exist on disk (`data/broker-versions/claude-quant/`, `.../momentum-maven/`). Gaps: (a) snapshots accumulate without pruning (unbounded disk), (b) the ledger itself can be wiped on corruption (LOW above), (c) persona-body growth is irreversible-in-practice because reverting loses the legitimately-learned notes too.

---

## Verdict

**needs-work.** The core *mechanical* safety (allow-list default-deny, full schema re-validation per change, atomic+snapshotted writes, deep-clone isolation, reversibility) is well-built and I could not find a path for the LLM to flip `tier`, `capital`, or `strategy`, or to write an out-of-range scalar. The system will not blow up the account in a single step.

However, the *semantic* guardrails are thin: the model can ratchet every risk knob to its schema maximum over a few sessions (no step-size or velocity cap), grant itself a 100x-larger LLM budget and (cosmetically) "full autonomy," and steer all future decisions via an unsanitized persona-note feedback channel. `confidence` and `fullAutonomy` — the two fields that look like safety controls — are inert. For a system whose explicit goal is to eventually route real paper/live capital to brokers that "prove themselves," the absence of drift bounds and the dead safety gates are the gap between "can't crash in one step" and "can't degrade into a degenerate config over a week."

---

## Prioritized recommendations

1. **(HIGH) Enforce per-mutation step-size + per-day mutation caps.** Reject any numeric proposal whose change exceeds e.g. ±30% of the current value (matches the prompt's stated intent), and cap total applied mutations per broker per day (e.g. 3). This directly kills the ratchet-to-extreme path. Enforce in `mutateBroker`, not the prompt.
2. **(HIGH) Add tighter operational ceilings distinct from schema absolute bounds.** The schema's `(0,0.1]` etc. are *hard* limits; introduce *soft* self-mutation limits (e.g. `risk.perTrade ≤ 0.05`, `kellyFraction ≤ 0.5`, `maxPositionSizePercent ≤ 50`, `maxPositions ≤ 10`) that the loop won't cross even though the schema would allow it. A broker shouldn't be able to talk itself to full Kelly + 100% sizing.
3. **(HIGH) Gate on `confidence` and actually wire `fullAutonomy`.** Skip applying proposals below a confidence threshold (e.g. 0.6). Either make `fullAutonomy=false` mean "log proposals to the ledger but do NOT write" (human-in-the-loop / dry-run by default), or remove the field so it stops implying a control that doesn't exist. Today both fields are theater.
4. **(HIGH) Remove `llm.callBudget` from MUTABLE_FIELDS and persist the call counter.** Don't let a broker raise its own cost ceiling. Persist counts to disk (or the ledger) so restarts don't reset the daily cap.
5. **(MED) Sanitize persona notes.** Strip/escape newlines and `^#` heading markers, hard-cap each note length and total Self-Improvement-Notes section size (prune oldest). This closes the structural-corruption and prompt-injection-feedback channels.
6. **(MED) Add a thrash detector.** If a field's value over the last N ledger events oscillates or reverts a prior mutation, skip mutating it and log a `mutation-thrash` event. Cheap circuit breaker against wasted Claude spend and config churn.
7. **(MED) Build and pass `regimeContext` in `runAllSelfMutations`,** or drop the parameter — currently the cron path silently makes regime-blind decisions.
8. **(LOW) Back up the ledger before overwrite** (rename old to `.bak`) instead of silently discarding on parse error; prune `broker-versions` snapshots beyond N to bound disk.
9. **(LOW) Add an "open-position" guard** that defers mutation of sizing/position-count fields until the book is flat, or at minimum logs that a mutation occurred with N open positions.
