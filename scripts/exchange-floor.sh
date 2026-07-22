#!/usr/bin/env bash
# scripts/exchange-floor.sh — Launch the full Exchange Floor in tmux.
#
# Four panes:
#   [top-left ]  Exchange TUI (npm run exchange) — leaderboard + log + regime
#   [top-right]  Server log (npm run server-dev) — verbose engine output
#   [bot-left ]  Trading log tail — every BUY/SELL/SIGNAL/ALERT line as it happens
#   [bot-right]  Broker config shell — cd'd into agents/brokers, ready to edit
#
# Usage:
#   npm run floor              # attach if running, otherwise start fresh
#   npm run floor:kill         # tear down the session
#
# Inside tmux:
#   Ctrl-b + arrows   move between panes
#   Ctrl-b + z        zoom current pane (Ctrl-b + z again to unzoom)
#   Ctrl-b + d        detach (re-attach with `tmux attach -t floor`)
#   Ctrl-b + [        scroll mode (q to exit)

set -e

SESSION="floor"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMUX="$(command -v tmux || echo /opt/homebrew/bin/tmux)"

if [ ! -x "$TMUX" ]; then
  echo "tmux not found. Install with: brew install tmux" >&2
  exit 1
fi

# If the session already exists, just attach.
if "$TMUX" has-session -t "$SESSION" 2>/dev/null; then
  echo "→ attaching to existing tmux session '$SESSION'"
  exec "$TMUX" attach -t "$SESSION"
fi

cd "$ROOT"

# Wait-for-server helper so the TUI pane doesn't race ahead of the engine.
WAIT_FOR_SERVER='for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/brokers | grep -q 200 && break; sleep 1; done'

# If the user already has the server running outside tmux, don't try to spawn
# another (port 8080 would collide). Just tail the server.log instead.
SERVER_PANE_CMD="echo '── server-dev ──'; npm run server-dev"
if lsof -ti:8080 >/dev/null 2>&1; then
  SERVER_PANE_CMD='echo "── server already running on :8080 — tailing server.log ──"; touch server.log; tail -F server.log'
fi

# Create session with the server in pane 0
"$TMUX" new-session -d -s "$SESSION" -x 220 -y 50 -c "$ROOT" "$SERVER_PANE_CMD"

# Pane 1 (right column): exchange TUI, after the server is up
"$TMUX" split-window -h -t "$SESSION":0.0 -c "$ROOT" \
  "$WAIT_FOR_SERVER; echo '── exchange floor ──'; sleep 1; npm run exchange"

# Pane 2 (bottom-left, under server): trading log tail
"$TMUX" split-window -v -t "$SESSION":0.0 -c "$ROOT" \
  "mkdir -p data/logs; touch data/logs/trading.log; echo '── trading.log tail ──'; tail -F data/logs/trading.log | grep --line-buffered -E 'EXEC|SIGNAL|RISK|ALERT|Sim\\\]|Entropy\\\]|Tier\\\]|bridge'"

# Pane 3 (bottom-right, under TUI): broker config shell
"$TMUX" split-window -v -t "$SESSION":0.1 -c "$ROOT/agents/brokers" \
  "echo '── broker configs ──'; echo 'edit any .md to live-tune a broker — file watcher picks it up in 5s'; echo; ls -la *.md 2>/dev/null; echo; exec \$SHELL"

# Layout: 4 even-ish quadrants
"$TMUX" select-layout -t "$SESSION":0 tiled

# Focus the exchange TUI pane by default
"$TMUX" select-pane -t "$SESSION":0.1

echo "→ launched tmux session '$SESSION' (Ctrl-b d to detach, 'npm run floor:kill' to tear down)"
exec "$TMUX" attach -t "$SESSION"
