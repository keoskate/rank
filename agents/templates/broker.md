---
# === IDENTITY ===
slug: example-broker              # filename + immutable id (lowercase, dashes, 3-50 chars)
name: Example Broker              # display name (1-80 chars)
tier: simulated                   # simulated | paper -- starts simulated; promoted on track record

# === CAPITAL ===
capital: 100000                   # starting cash (1000..10_000_000)

# === UNIVERSE ===
watchlist: [SOXL, SOXS]           # 1-50 symbols this broker may trade

# === STRATEGY ===
# One of: momentum-breakout, mean-reversion, entropy-adaptive,
#         medallion-ensemble, llm-gated, balanced, conservative, aggressive
strategy: balanced

# === RISK ===
risk:
  perTrade: 0.02                  # max % of capital risked on a single trade (0, 0.1]
  maxDrawdown: 0.15               # max acceptable drawdown before pause/demote
  sizing: confidence-scaled       # fixed | fractional-kelly | confidence-scaled
  kellyFraction: 0.25             # only used if sizing=fractional-kelly
  maxPositions: 3                 # max concurrent positions
  maxPositionSizePercent: 15      # max % of portfolio in one position

# === REGIME (Shannon entropy gate) ===
regime:
  enabled: false                  # gate entries on entropy regime?
  entropyWindows: [21, 63, 252]   # rolling windows for H(X) calc
  preferred: any                  # low-entropy | high-entropy | any
  blockOnTransition: true         # block entries when regime is transitioning
  referenceSymbol: null           # symbol to compute entropy on (e.g. SOXX for SOXL/SOXS)

# === LLM (Claude as advisor or hard gate) ===
llm:
  enabled: false
  model: claude-sonnet-4-6
  callBudget: 50                  # max Claude calls per trading day
  role: advisor                   # advisor (adjusts confidence) | gate (vetoes trades)

# === SELF-IMPROVEMENT ===
selfImprovement:
  intervals: [eod]                # subset of: intraday-5m, intraday-1h, eod
  fullAutonomy: false             # if true, agent may rewrite any of its own knobs
---

# Personality

Brief, in-character voice description. Two or three sentences max — this is what
shows in the exchange-floor leaderboard and ships into the LLM system prompt.

# Philosophy

What does this broker believe about markets? When does it think it has an edge?
What does it refuse to trade? Concrete, opinionated.

# Watchlist Rationale

Why these symbols? What's the thesis? (Engine reads `watchlist` from frontmatter;
this section is for humans + LLM context.)

# Risk Doctrine

When does this broker cut losses early? When does it pyramid? What's its red line?

# Self-Improvement Notes

When you (the agent) rewrite this file, leave a dated note here describing what
you changed and why. Your prior selves are versioned in `data/broker-versions/<slug>/`.
