# Dockerfile — AI Broker Exchange Server
# Single-stage build. Node 22 (matches local). Production deps only.
# Persistent data lives on a mounted volume at /data → symlinked to /app/data.

FROM node:22-slim

# System deps for native modules (blessed needs ncurses, chokidar uses fs natively)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates jq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps first (Docker layer cache)
COPY package.json package-lock.json* ./
COPY packages/quant-core/package.json packages/quant-core/
RUN npm ci --omit=dev --workspaces=false 2>&1 || npm install --omit=dev

# Copy the rest of the app — but NOT the data dir (volume mount handles that)
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY agents/ ./agents/
COPY .claude/ ./.claude/
COPY CLAUDE.md AI_TRADING_GUIDE.md ./
COPY package.json ./

# data/ is a volume mount — create the directory so the app doesn't fail on first boot
RUN mkdir -p /app/data /app/data/logs /app/data/reports /app/data/broker-versions

ENV NODE_ENV=production
ENV NODE_OPTIONS=--openssl-legacy-provider
ENV PORT=8080

COPY scripts/deploy-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080

# Healthcheck: lightweight liveness probe (no engine/API work)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8080/healthz > /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
