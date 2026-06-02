#!/usr/bin/env bash
# scripts/fly-deploy.sh — one-shot Fly.io deployment for the AI Broker Exchange.
#
# Prereqs (you only do these once):
#   1. brew install flyctl    (already done by the setup)
#   2. fly auth signup        OR   fly auth login
#   3. card on file (Fly requires a billing card even for hobby/free tier)
#
# Then: ./scripts/fly-deploy.sh
#
# Idempotent — re-running it deploys updates without destroying state.

set -e

cd "$(dirname "$0")/.."

APP_NAME="broker-exchange"
REGION="ewr"  # Newark — closest to NYSE
VOLUME_NAME="broker_data"
VOLUME_SIZE_GB=3

# ── checks ──────────────────────────────────────────────────────────────────
command -v flyctl >/dev/null || { echo "flyctl not found. Install: brew install flyctl" >&2; exit 1; }

if ! flyctl auth whoami >/dev/null 2>&1; then
  echo "✗ Not logged in to fly.io. Run: fly auth login" >&2
  echo "  (or 'fly auth signup' if you don't have an account)" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "✗ .env file not found — secrets can't be set without it" >&2
  exit 1
fi

# ── 1. create app if it doesn't exist ──────────────────────────────────────
if ! flyctl status --app "$APP_NAME" >/dev/null 2>&1; then
  echo "─── creating app: $APP_NAME ───"
  flyctl apps create "$APP_NAME" --org personal
else
  echo "✓ app $APP_NAME exists"
fi

# ── 2. create persistent volume if it doesn't exist ─────────────────────────
if ! flyctl volumes list --app "$APP_NAME" 2>/dev/null | grep -q "$VOLUME_NAME"; then
  echo "─── creating volume: $VOLUME_NAME ($VOLUME_SIZE_GB GB in $REGION) ───"
  flyctl volumes create "$VOLUME_NAME" \
    --app "$APP_NAME" \
    --region "$REGION" \
    --size "$VOLUME_SIZE_GB" \
    --yes
else
  echo "✓ volume $VOLUME_NAME exists"
fi

# ── 3. push secrets from local .env to Fly ──────────────────────────────────
SECRETS_TO_PUSH=(
  POLYGON_API_KEY
  ALPACA_PAPER_API_KEY
  ALPACA_PAPER_SECRET_KEY
  ANTHROPIC_API_KEY
  TRADING_MODE
  # Required by the orthogonal-signal plugins — without UW the insider/flow/
  # dark-pool brokers are inert in the cloud.
  UNUSUAL_WHALES_API_KEY
  # Ops alerting (engine-online + stale-session notifications).
  TELEGRAM_BOT_TOKEN
  TELEGRAM_OWNER_ID
)

echo "─── pushing secrets from .env ───"
SECRETS_CMD=""
for key in "${SECRETS_TO_PUSH[@]}"; do
  val=$(grep -E "^${key}=" .env | head -1 | sed -E "s/^${key}=//; s/^['\"]//; s/['\"]$//")
  if [ -n "$val" ]; then
    SECRETS_CMD+=" ${key}=${val}"
    echo "  + $key (length=${#val})"
  else
    echo "  - $key (not in .env — skipped)"
  fi
done

if [ -n "$SECRETS_CMD" ]; then
  # shellcheck disable=SC2086
  flyctl secrets set --app "$APP_NAME" --stage $SECRETS_CMD >/dev/null
  echo "✓ secrets staged"
fi

# ── 4. deploy ───────────────────────────────────────────────────────────────
echo "─── building + deploying ───"
flyctl deploy --app "$APP_NAME" --strategy immediate --ha=false

# ── 5. show result ──────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Deployment complete!"
echo "═══════════════════════════════════════════════════════════════════════"
flyctl status --app "$APP_NAME" || true
APP_URL=$(flyctl info --app "$APP_NAME" --json 2>/dev/null | jq -r '.Hostname // empty' 2>/dev/null || echo "")
if [ -n "$APP_URL" ]; then
  echo ""
  echo "  Public URL:    https://$APP_URL"
  echo "  Broker API:    https://$APP_URL/api/brokers"
  echo ""
  echo "  Useful commands:"
  echo "    fly logs --app $APP_NAME              # tail server logs"
  echo "    fly ssh console --app $APP_NAME       # shell in"
  echo "    EXCHANGE_HOST=https://$APP_URL npm run exchange    # TUI against cloud"
  echo "    fly machine restart -a $APP_NAME      # force restart"
fi
