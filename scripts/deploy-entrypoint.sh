#!/usr/bin/env bash
# scripts/deploy-entrypoint.sh — container startup.
# Seeds the persistent volume with broker .md files on first boot, then starts
# the server with BROKERS_DIR pointing at the volume so edits persist.

set -e

VOLUME_BROKERS_DIR=/app/data/agents/brokers
VOLUME_FIRED_DIR=/app/data/agents/fired

# Seed the volume from the image's initial broker bench on first boot only.
# If the volume already has brokers, leave them alone — they may have mutated.
if [ ! -d "$VOLUME_BROKERS_DIR" ] || [ -z "$(ls -A "$VOLUME_BROKERS_DIR" 2>/dev/null | grep -v .gitkeep)" ]; then
  echo "[entrypoint] seeding $VOLUME_BROKERS_DIR from image"
  mkdir -p "$VOLUME_BROKERS_DIR" "$VOLUME_FIRED_DIR"
  cp -r /app/agents/brokers/. "$VOLUME_BROKERS_DIR/" 2>/dev/null || true
else
  echo "[entrypoint] $VOLUME_BROKERS_DIR has existing brokers — not reseeding"
fi

# Same for templates so /hire-broker (if anyone uses it via API) has something to clone
mkdir -p /app/data/agents/templates
cp -rn /app/agents/templates/. /app/data/agents/templates/ 2>/dev/null || true

# Subdirs the engine expects to exist
mkdir -p /app/data/logs /app/data/reports /app/data/broker-versions

# Point the loader/writer at the volume
export BROKERS_DIR="$VOLUME_BROKERS_DIR"

echo "[entrypoint] BROKERS_DIR=$BROKERS_DIR"
echo "[entrypoint] broker count: $(ls "$BROKERS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')"

exec node server/index.js
