// server/integrity/reconcile.js
//
// Integrity / reconciliation layer. One job: make "a number we track silently
// drifts from reality" impossible. Runs on a timer, independent of the per-
// session tick loops, and for every session it:
//
//   1. QUARANTINES ghost positions — sim positions with no cash backing
//      (delegates to simulatedExecutor.reconcileSimPositions). The Crypto
//      −$23k phantom.
//   2. PROTECTS unmanaged positions — a *paused* sim session kills its tick
//      loop, so its stop-losses stop being evaluated (the −1%→−11% incident:
//      a position bled 6 days with no stop). Here we mark-to-market and fire
//      any breached stop regardless of session status. markToMarket alone
//      also keeps P&L from freezing.
//   3. DETECTS P&L drift — flags when a session's tracked P&L diverges from the
//      equity implied by its own cash+positions (the −$20-vs-−28% incident).
//
// Healing is limited to the two SAFE, config-declared actions (quarantine
// ghosts, fire a stop the config already declared). Everything else is
// surfaced loudly, never silently "fixed". The stop-firing can be disabled with
// INTEGRITY_AUTOFIRE=off so this safety mechanism can never itself become the
// liability it exists to prevent.

let ctx = null; // { getSessions, simulatedExecutor, tradingLogger, saveReport }

// Auto-fire declared stops on unmanaged positions. On by default; kill switch
// for when you don't trust it.
const AUTO_FIRE_STOPS = process.env.INTEGRITY_AUTOFIRE !== 'off';
// Flag P&L drift beyond this fraction of the baseline.
const PNL_DIVERGENCE_TOLERANCE = 0.03;

function init(context) {
  ctx = context;
}

async function reconcileSession(session) {
  const report = {
    sessionId: session && session.sessionId,
    name: session && session.name,
    status: session && session.status,
    ghostsQuarantined: 0,
    stopsFired: [],
    warnings: [],
  };
  if (!ctx || !session || !session.config || !session.portfolio) return report;
  const { simulatedExecutor, tradingLogger } = ctx;
  const isSim = !!session.config.simulationMode;
  const positions = session.portfolio.positions;
  const hasPositions = positions && typeof positions.size === 'number' && positions.size > 0;

  // 1. Ghost positions (sim only) — quarantine, count.
  if (isSim && simulatedExecutor && simulatedExecutor.reconcileSimPositions) {
    report.ghostsQuarantined = simulatedExecutor.reconcileSimPositions(session) || 0;
  }

  // 2. Protect unmanaged positions (sim only — paper/live carry broker-side stops).
  if (isSim && hasPositions && simulatedExecutor) {
    try {
      await simulatedExecutor.markToMarket(session); // never let P&L go stale
    } catch (e) {
      report.warnings.push(`markToMarket failed: ${e.message}`);
    }
    const stopPct = Number(session.config.stopLossPercent);
    if (AUTO_FIRE_STOPS && stopPct > 0) {
      for (const [symbol, pos] of [...positions]) {
        const dd = Number(pos && pos.unrealizedPnLPercent);
        if (Number.isFinite(dd) && dd <= -stopPct) {
          try {
            await simulatedExecutor.simulatedExit(session, symbol, {
              reason: `integrity guard: stop ${dd.toFixed(2)}% <= -${stopPct}% on ${
                session.status !== 'running' ? 'paused/' : ''
              }unmanaged position`,
              source: 'integrity-guard',
            });
            report.stopsFired.push({ symbol, pnlPercent: dd });
            if (tradingLogger) {
              tradingLogger.logError('[Integrity] Fired stop on unmanaged position', {
                sessionId: session.sessionId,
                sessionName: session.name,
                symbol,
                pnlPercent: dd,
                status: session.status,
              });
            }
          } catch (e) {
            report.warnings.push(`exit ${symbol} failed: ${e.message}`);
          }
        }
      }
    }
  }

  // 3. P&L drift detection (any session with a baseline). Surfaces the
  //    display-vs-reality gap; does NOT auto-correct (that needs the per-broker
  //    equity rework for the shared paper account).
  const baseline = Number(session.portfolio.initialValue);
  if (positions && baseline > 0) {
    const cash = Number(session.portfolio.cash) || 0;
    let posVal = 0;
    for (const p of positions.values()) posVal += Number(p.marketValue) || 0;
    const computedPnL = cash + posVal - baseline;
    const trackedPnL = Number(session.stats && session.stats.totalPnLWithUnrealized) || 0;
    const gap = Math.abs(computedPnL - trackedPnL);
    if (gap > baseline * PNL_DIVERGENCE_TOLERANCE) {
      report.warnings.push(
        `P&L drift: tracked $${trackedPnL.toFixed(0)} vs computed $${computedPnL.toFixed(
          0
        )} (gap $${gap.toFixed(0)})`
      );
      if (tradingLogger) {
        tradingLogger.logError('[Integrity] P&L divergence', {
          sessionId: session.sessionId,
          sessionName: session.name,
          trackedPnL,
          computedPnL,
          gap,
        });
      }
    }
  }

  return report;
}

async function runOnce() {
  if (!ctx || !ctx.getSessions) return { error: 'integrity layer not initialized' };
  const sessions = ctx.getSessions() || [];
  const reports = [];
  for (const session of sessions) {
    try {
      reports.push(await reconcileSession(session));
    } catch (e) {
      reports.push({ sessionId: session && session.sessionId, error: e.message });
    }
  }
  const summary = {
    ranAt: new Date().toISOString(),
    sessions: reports.length,
    ghostsQuarantined: reports.reduce((s, r) => s + (r.ghostsQuarantined || 0), 0),
    stopsFired: reports.reduce((s, r) => s + (r.stopsFired ? r.stopsFired.length : 0), 0),
    withWarnings: reports.filter(r => r.warnings && r.warnings.length).length,
    reports,
  };
  if (ctx.saveReport) {
    try {
      ctx.saveReport(summary);
    } catch (e) {
      /* reporting is best-effort */
    }
  }
  return summary;
}

let timer = null;
function startIntegrityLoop(intervalMs = 60000) {
  if (timer) return timer;
  timer = setInterval(() => {
    runOnce().catch(() => {});
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}
function stopIntegrityLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  init,
  reconcileSession,
  runOnce,
  startIntegrityLoop,
  stopIntegrityLoop,
  AUTO_FIRE_STOPS,
};
