const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { brokerBridge, aiTradingEngine } = deps;
  const tierPromotion = require('../brokers/tierPromotion');

  // List all brokers with their live session state
  router.get('/api/brokers', async (req, res) => {
    try {
      const list = await brokerBridge.listBrokersWithSessionState();
      res.json({ success: true, brokers: list });
    } catch (error) {
      console.error('Error listing brokers:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger a manual broker→session reconciliation
  router.post('/api/brokers/sync', async (req, res) => {
    try {
      const summary = await brokerBridge.syncBrokersToSessions();
      res.json({ success: true, summary });
    } catch (error) {
      console.error('Error syncing brokers:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger a tier evaluation (promote/demote/fire) — pass ?dryRun=1 to preview
  // without mutating, ?breed=1 to spawn children from top performers.
  router.post('/api/brokers/tier-eval', async (req, res) => {
    try {
      const result = await tierPromotion.runTierEvaluation(
        { engine: aiTradingEngine, bridge: brokerBridge },
        { dryRun: req.query.dryRun === '1', breed: req.query.breed === '1' }
      );
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Error running tier eval:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Force a simulated trade through a broker's sim executor. Useful for
  // testing end-to-end while markets are closed. Body: { symbol, side, confidence, reason }
  router.post('/api/brokers/:slug/test-trade', async (req, res) => {
    try {
      const { slug } = req.params;
      const {
        symbol,
        side = 'buy',
        confidence = 75,
        reason = 'manual test trade',
      } = req.body || {};
      if (!symbol) return res.status(400).json({ error: 'symbol required' });

      const allSessions = aiTradingEngine.getAllUserSessions('brokers') || [];
      const proj = allSessions.find(
        s => s.config && s.config.brokerSlug === slug
      );
      if (!proj)
        return res.status(404).json({ error: `broker ${slug} not found` });

      const beforeRaw = aiTradingEngine.getSession(proj.sessionId);
      const before = {
        cash: beforeRaw?.cash,
        positions: beforeRaw?.positions?.length || 0,
        totalPnL: beforeRaw?.stats?.totalPnL || 0,
      };

      const result =
        side === 'sell'
          ? await aiTradingEngine.manualSimExit(proj.sessionId, symbol, {
              reason,
            })
          : await aiTradingEngine.manualSimEntry(proj.sessionId, symbol, {
              confidence,
              reason,
            });
      if (result?.error) return res.status(400).json({ error: result.error });

      const afterRaw = aiTradingEngine.getSession(proj.sessionId);
      const after = {
        cash: afterRaw?.cash,
        positions: afterRaw?.positions?.length || 0,
        totalPnL: afterRaw?.stats?.totalPnL || 0,
      };
      res.json({ success: true, slug, symbol, side, before, after });
    } catch (error) {
      console.error('test-trade error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Reset a broker's portfolio + stats to a fresh starting capital. Used by
  // the cleanup workflow after synthetic seeds, and by users who want to wipe
  // a broker's history. Only honored for simulated sessions.
  router.post('/api/brokers/:slug/reset', async (req, res) => {
    try {
      const { slug } = req.params;
      const { capital = 100000 } = req.body || {};
      const allSessions = aiTradingEngine.getAllUserSessions('brokers') || [];
      const proj = allSessions.find(
        s => s.config && s.config.brokerSlug === slug
      );
      if (!proj)
        return res.status(404).json({ error: `broker ${slug} not found` });
      const ok = aiTradingEngine.resetSessionCapital(proj.sessionId, capital);
      if (!ok)
        return res
          .status(400)
          .json({ error: 'reset refused (session not in simulationMode)' });
      res.json({ success: true, slug, capital });
    } catch (error) {
      console.error('reset error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Reset just the loss-streak + circuit breaker. Use after applying engine fixes
  // so a broker doesn't immediately trip its breaker on its pre-fix loss history.
  router.post('/api/brokers/:slug/reset-streak', async (req, res) => {
    try {
      const { slug } = req.params;
      const all = aiTradingEngine.getAllUserSessions('brokers') || [];
      const proj = all.find(s => s.config?.brokerSlug === slug);
      if (!proj) return res.status(404).json({ error: `broker ${slug} not found` });
      const result = aiTradingEngine.resetLossStreak(proj.sessionId);
      if (!result?.ok) {
        return res.status(400).json({ error: 'reset refused (not simulated, or no session)' });
      }
      res.json({ success: true, slug, ...result });
    } catch (error) {
      console.error('reset-streak error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Reset all brokers in one call — useful after a synthetic-seed demo.
  router.post('/api/brokers/reset-all', async (req, res) => {
    try {
      const { capital = 100000 } = req.body || {};
      const all = aiTradingEngine.getAllUserSessions('brokers') || [];
      const results = all.map(s => ({
        slug: s.config?.brokerSlug,
        ok: aiTradingEngine.resetSessionCapital(s.sessionId, capital),
      }));
      res.json({
        success: true,
        reset: results.filter(r => r.ok).length,
        results,
      });
    } catch (error) {
      console.error('reset-all error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Test-only: seed a broker with synthetic trade history so tier eval and
  // Phase 6 self-mutation have realistic data to chew on without waiting for
  // weeks of real market activity. Body: { trades, winRate, avgWinPct, avgLossPct, daysBack }
  router.post('/api/brokers/:slug/seed', async (req, res) => {
    try {
      const { slug } = req.params;
      const allSessions = aiTradingEngine.getAllUserSessions('brokers') || [];
      const proj = allSessions.find(
        s => s.config && s.config.brokerSlug === slug
      );
      if (!proj)
        return res.status(404).json({ error: `broker ${slug} not found` });
      const result = aiTradingEngine.seedSyntheticTradeHistory(
        proj.sessionId,
        req.body || {}
      );
      if (result?.error) return res.status(400).json({ error: result.error });
      res.json({ success: true, slug, ...result });
    } catch (error) {
      console.error('seed error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Phase 6: ask Claude to review a broker's recent tape and propose changes.
  // ?dryRun=1 returns proposals without writing the file. Without dryRun, the
  // broker's .md is rewritten (atomic, with a snapshot of the prior version
  // for revert) and the change is logged to data/broker-ledger.json.
  router.post('/api/brokers/:slug/self-mutate', async (req, res) => {
    try {
      const selfMutation = require('../brokers/selfMutation');
      const { loadBroker } = require('../brokers/brokerLoader');
      const { brokerPath } = require('../brokers/brokerWriter');
      const { slug } = req.params;

      const all = aiTradingEngine.getAllUserSessions('brokers') || [];
      const proj = all.find(s => s.config?.brokerSlug === slug);
      if (!proj)
        return res.status(404).json({ error: `broker ${slug} not found` });
      const session = aiTradingEngine.getSession(proj.sessionId);

      const file = brokerPath(slug);
      const loaded = await loadBroker(file);
      if (!loaded.broker) {
        return res
          .status(500)
          .json({ error: `broker file invalid: ${loaded.errors.join('; ')}` });
      }

      const result = await selfMutation.mutateBroker(
        { broker: loaded.broker, persona: loaded.persona, session },
        { dryRun: req.query.dryRun === '1' }
      );
      res.json({ success: true, slug, ...result });
    } catch (error) {
      console.error('self-mutate error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Run self-mutation across all brokers whose selfImprovement.intervals
  // includes the given interval. Defaults to 'eod'.
  router.post('/api/brokers/self-mutate-all', async (req, res) => {
    try {
      const selfMutation = require('../brokers/selfMutation');
      const interval = req.query.interval || req.body?.interval || 'eod';
      const result = await selfMutation.runAllSelfMutations(
        { engine: aiTradingEngine, interval },
        { dryRun: req.query.dryRun === '1' }
      );
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('self-mutate-all error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Roll back a broker to a prior persona snapshot. Use after a bad mutation.
  // Available snapshots live in data/broker-versions/<slug>/<timestamp>.md
  router.post('/api/brokers/:slug/revert', async (req, res) => {
    try {
      const {
        revertBroker,
        listSnapshots,
      } = require('../brokers/brokerWriter');
      const { slug } = req.params;
      const { timestamp } = req.body || {};
      if (!timestamp) {
        const snaps = await listSnapshots(slug);
        return res.status(400).json({
          error:
            'timestamp required in body — pick one of the available snapshots',
          available: snaps,
        });
      }
      const result = await revertBroker(slug, timestamp);
      res.json({ success: true, slug, ...result });
    } catch (error) {
      console.error('revert error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/brokers/:slug/snapshots', async (req, res) => {
    try {
      const { listSnapshots } = require('../brokers/brokerWriter');
      const snaps = await listSnapshots(req.params.slug);
      res.json({ success: true, slug: req.params.slug, snapshots: snaps });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Paper-allocation overview — useful for sizing decisions.
  router.get('/api/brokers/paper-allocations', async (req, res) => {
    try {
      const summary = await brokerBridge.summarizePaperAllocations();
      // Try to fetch Alpaca paper account size for context
      let alpacaBuyingPower = null;
      try {
        const alpacaClient = require('../alpacaClient');
        const acct = await alpacaClient.getAccount('paper');
        alpacaBuyingPower = parseFloat(acct.buying_power);
      } catch {
        // ignore — Alpaca creds may not be set
      }
      const oversubscribed =
        alpacaBuyingPower != null && summary.totalAllocated > alpacaBuyingPower;
      res.json({
        success: true,
        ...summary,
        alpacaBuyingPower,
        oversubscribed,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manually flip a broker's tier — bypasses the tier-eval thresholds.
  // Useful for testing the paper-trading transition, and for moving a broker
  // you trust without waiting for the metrics to compound. Body: { to: "paper"|"simulated" }
  router.post('/api/brokers/:slug/transition', async (req, res) => {
    try {
      const { slug } = req.params;
      const { to, confirm } = req.body || {};
      if (!['paper', 'simulated', 'live'].includes(to)) {
        return res
          .status(400)
          .json({ error: 'to must be paper|simulated|live' });
      }

      // LIVE is real money — require the server-side unlock and the explicit
      // confirmation phrase before we touch anything.
      if (to === 'live') {
        const { getSafetyConfig } = require('../tradingModeManager');
        if (process.env.ALLOW_LIVE_TIER !== '1') {
          return res.status(403).json({
            error:
              'live tier locked — set ALLOW_LIVE_TIER=1 on the server to enable',
          });
        }
        const expected =
          getSafetyConfig().confirmationText ||
          'I understand this is LIVE trading with real money';
        if (confirm !== expected) {
          return res
            .status(400)
            .json({ error: `live promotion requires confirm: "${expected}"` });
        }
      }

      const { loadBroker } = require('../brokers/brokerLoader');
      const { writeBroker, brokerPath } = require('../brokers/brokerWriter');
      const { effectiveCapital } = require('../brokers/brokerSchema');

      const all = aiTradingEngine.getAllUserSessions('brokers') || [];
      const proj = all.find(s => s.config?.brokerSlug === slug);
      if (!proj)
        return res.status(404).json({ error: `broker ${slug} not found` });

      const loaded = await loadBroker(brokerPath(slug));
      if (!loaded.broker) {
        return res
          .status(500)
          .json({ error: `broker file invalid: ${loaded.errors.join('; ')}` });
      }

      // Write the .md tier change first so the file-watcher reflects it — EXCEPT
      // for live, where we persist ONLY after the guarded transition succeeds.
      const updated = { ...loaded.broker, tier: to };
      if (to !== 'live') {
        await writeBroker(slug, updated, loaded.persona);
      }

      let transition;
      if (to === 'paper') {
        const alloc = effectiveCapital(updated);
        transition = aiTradingEngine.transitionToPaperTier(
          proj.sessionId,
          alloc
        );
      } else if (to === 'live') {
        transition = await aiTradingEngine.transitionToLiveTier(proj.sessionId);
        if (transition && transition.error) {
          return res.status(400).json({ error: transition.error, slug, to });
        }
        await writeBroker(slug, updated, loaded.persona); // persist only on success
      } else {
        transition = await aiTradingEngine.transitionToSimulatedTier(
          proj.sessionId,
          loaded.broker.capital
        );
      }

      res.json({ success: true, slug, to, transition });
    } catch (error) {
      console.error('transition error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Read the tier-promotion audit log
  router.get('/api/brokers/ledger', async (req, res) => {
    try {
      const ledger = await tierPromotion.getLedger();
      res.json({ success: true, ...ledger });
    } catch (error) {
      console.error('Error reading ledger:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
