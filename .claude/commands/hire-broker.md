---
description: Hire a new AI broker agent — conversationally design a persona and write the .md file to agents/brokers/
argument-hint: "[broker idea or archetype]"
---

# Hire a New AI Broker

Hire: $ARGUMENTS

You are helping the user "hire" a new autonomous trading broker for the Exchange Floor system. Each broker is a markdown file with YAML frontmatter (config) + a markdown body (personality, philosophy, LLM system-prompt context). The file lives at `agents/brokers/<slug>.md`. A file-watcher in the running server picks it up and spins up a trading session within seconds.

## Workflow

### 1. Interview the user

Ask 3-5 quick questions to lock in:

- **Slug** (lowercase-dashes, e.g. `momentum-maven`) — must be unique, not already in `agents/brokers/`. Run `ls agents/brokers/` first.
- **Display name** — short, character-flavored ("Momentum Maven", "Mean-Reversion Monk").
- **Capital** — starting cash. Default $100k.
- **Watchlist** — 1-50 symbols. Make sure they match the strategy.
- **Strategy archetype** — one of: `momentum-breakout`, `mean-reversion`, `entropy-adaptive`, `medallion-ensemble`, `llm-gated`, `balanced`, `conservative`, `aggressive`.
- **Tier** — almost always start `simulated`. Promotion to `paper` happens automatically via `tierPromotion.js` after the broker proves itself.
- **Personality voice** — one paragraph, in-character. This goes into the markdown body and (when LLM is enabled) becomes part of its Claude system prompt.

Don't ask all of these at once. Group them: identity + capital first, then strategy + universe, then personality.

### 2. Reference existing personas for inspiration

Look at `agents/templates/personas/` — there are starter archetypes there. If the user's idea is similar to one ("kind of like the momentum maven but for crypto"), suggest cloning that template with edits rather than starting blank.

### 3. Validate before writing

Field constraints (from `server/brokers/brokerSchema.js`):
- `slug`: matches `/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/`
- `capital`: 1000 to 10,000,000
- `watchlist`: 1-50 symbols (uppercase)
- `risk.perTrade`: 0 < x ≤ 0.10
- `risk.maxDrawdown`: 0 < x ≤ 0.50
- `risk.sizing`: `fixed` | `fractional-kelly` | `confidence-scaled`
- `risk.kellyFraction`: 0 < x ≤ 1.0
- `regime.preferred`: `low-entropy` | `high-entropy` | `any`
- `llm.role`: `advisor` | `gate`

### 4. Write the file

Write to `agents/brokers/<slug>.md` using the structure of `agents/templates/broker.md`. Frontmatter on top, four sections in the body:

- **Personality** — 2-3 sentence in-character voice.
- **Philosophy** — what this broker believes about markets and edge.
- **Watchlist Rationale** — why these symbols.
- **Risk Doctrine** — when it cuts, when it pyramids, its red line.
- **Self-Improvement Notes** — empty; the agent will append dated entries here as it mutates itself.

### 5. Confirm and hand off

After writing:
- Run `node -e "const {validateBroker} = require('./server/brokers/brokerSchema'); const m=require('gray-matter')(require('fs').readFileSync('agents/brokers/<slug>.md','utf8')); console.log(JSON.stringify(validateBroker(m.data,'<slug>.md'),null,2))"` to confirm zero validation errors.
- Tell the user: "Hired. If the server is running, the bridge will spin up a session within 5s. Watch live with `npm run exchange`."

## Alternative: non-interactive CLI

If the user wants to skip the conversation, the equivalent shell flow is `npm run hire`. The slash command exists for richer collaboration on personality and strategy fit.

## Tone

This is fun. Lean into it. The user is building a Bloomberg-terminal-aesthetic exchange floor of AI traders that compete and self-improve. Help them write brokers with character — distinct voices, opinionated philosophies, real edges.
