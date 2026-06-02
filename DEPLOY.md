# Deploy & Uptime Runbook

How the trading engine stays up, and how to put it in the cloud for real 24/7.

## TL;DR — there are two ways to run the engine

| | Where | Survives | Use for |
|---|---|---|---|
| **LaunchAgent** (set up, running now) | your Mac | terminal close, logout, crashes — **NOT** sleep | tonight / while the laptop is awake & plugged in |
| **Fly.io** (scaffolded, needs your login) | cloud | everything, incl. your laptop being off | the real always-on setup |

---

## A. Laptop keep-alive (already live)

A launchd LaunchAgent runs `scripts/keep-alive.sh` = `caffeinate` (block idle sleep) + an auto-restart loop around `node server/index.js`. Verified: killing the server brings it back in ~2s.

```bash
# status
launchctl list | grep broker
curl -s localhost:8080/healthz

# stop it (and return to the `npm run server-dev` dev workflow)
launchctl unload ~/Library/LaunchAgents/com.broker-exchange.server.plist

# start it again
launchctl load ~/Library/LaunchAgents/com.broker-exchange.server.plist
```

**Limitation:** a MacBook with the lid closed on battery still sleeps and stops trading. Keep it **plugged in, lid open** — or use Fly (below).

---

## B. Fly.io cloud deploy (the real fix) — 2 steps when you're back

Everything is automated except your login (interactive, browser — can't be scripted).

```bash
fly auth login      # 1. your account (browser opens)
npm run deploy      # 2. does the rest
```

`scripts/fly-deploy.sh` (idempotent) then: creates the `broker-exchange` app, creates the 3GB persistent `broker_data` volume (Newark, near NYSE), pushes the needed secrets **from your local `.env`** (Polygon, Alpaca paper, Anthropic, **Unusual Whales**, Telegram), and deploys via Fly's remote builder. `min_machines_running=1` + health checks on `/healthz` keep it auto-restarting.

After it's up:
```bash
fly logs --app broker-exchange                       # tail engine logs
curl https://broker-exchange.fly.dev/healthz         # liveness
EXCHANGE_HOST=https://broker-exchange.fly.dev npm run broker:status   # TUI vs cloud
```

**Then turn the laptop engine off** so you're not running two engines that both poll the UW/Polygon APIs on the same keys:
```bash
launchctl unload ~/Library/LaunchAgents/com.broker-exchange.server.plist
```
Cloud = prod; laptop = dev only (run `npm run server-dev` when actively developing).

### Caveats
- The Docker image ships the **server + engine + brokers**, not a freshly-built web dashboard. Autonomous trading, the API, Telegram, and the CLIs (`npm run daily`/`trend`/`broker:status` against `EXCHANGE_HOST`) all work; the browser dashboard may not. Not needed for the engine to make/track money.
- Fly starts with **fresh $100k sim pools** (new data volume) — fine, the brokers have no meaningful track record yet, and they re-seed from the current `.md` configs baked into the image.
- I could not pre-build the image locally (Docker Desktop wasn't running), but `fly deploy` builds remotely; the Dockerfile + entrypoint were reviewed and the secrets list corrected.

---

## C. Monitoring (works on either)

- **Telegram**: you get a `🟢 Broker engine online` message on every (re)start — a burst means it bounced. Stale-session warnings also fire to Telegram.
- **`/healthz`**: instant liveness (uptime, pid). `/api/brokers` = full state.
- **Daily**: `npm run daily` (auto-runs at the 4:05pm ET close) + `npm run trend` for the per-source expectancy curves.
