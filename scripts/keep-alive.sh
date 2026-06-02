#!/bin/bash
# scripts/keep-alive.sh — keep the trading server up overnight on a laptop.
#
#   - caffeinate prevents IDLE sleep while the server runs (keep the Mac on AC;
#     a closed lid / clamshell still sleeps — only the cloud deploy fixes that).
#   - the while-loop relaunches server/index.js if it crashes or exits.
#
# Start (detached, survives terminal close):
#   setsid nohup bash scripts/keep-alive.sh >/dev/null 2>&1 </dev/null &
# Stop:
#   pkill -f keep-alive.sh; pkill -f 'node server/index.js'; pkill caffeinate
# Return to the dev workflow afterwards:
#   npm run server-dev

cd "$(dirname "$0")/.." || exit 1
# launchd runs with a minimal PATH that lacks nvm's node — add it explicitly.
export PATH="/Users/keo/.nvm/versions/node/v22.17.0/bin:/usr/local/bin:/usr/bin:/bin"
echo "[$(date)] keep-alive supervisor starting" >>server.log
while true; do
  echo "[$(date)] launching server (caffeinated)" >>server.log
  caffeinate -i node server/index.js >>server.log 2>&1
  code=$?
  echo "[$(date)] server exited (code $code) — restarting in 3s" >>server.log
  sleep 3
done
