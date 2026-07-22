#!/usr/bin/env bash
# Tear down the Exchange Floor tmux session and any spawned children.
TMUX="$(command -v tmux || echo /opt/homebrew/bin/tmux)"
if "$TMUX" has-session -t floor 2>/dev/null; then
  "$TMUX" kill-session -t floor
  echo "✓ killed tmux session 'floor'"
else
  echo "no tmux session 'floor' running"
fi
