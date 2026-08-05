/**
 * Freshness guard for the semiconductor AI confidence adjustment.
 *
 * The analyst (aiSemiconductorAnalyst) caches its result for ~60s and can return
 * an analysis computed under a now-changed market phase. This pure predicate
 * decides whether a given cached adjustment is safe to APPLY to the live
 * confidence the engine trades on — guarding against a stale or phase-mismatched
 * `-15` silently dragging trading confidence after conditions have moved on.
 *
 * Pure + dependency-free so it's unit-testable in isolation.
 *
 * @param {object} aiAnalysis - analyst result ({ confidenceAdjustment, timestamp, inputData:{phase} })
 * @param {string} currentPhase - the CURRENT market phase (sentiment.phase)
 * @param {number} [nowMs=Date.now()]
 * @param {number} [maxAgeMs=600000] - max analysis age to still apply (10 min)
 * @returns {{ apply: boolean, reason: string, ageMs: number }}
 */
function shouldApplyAiAdjustment(aiAnalysis, currentPhase, nowMs = Date.now(), maxAgeMs = 10 * 60 * 1000) {
  if (!aiAnalysis || !aiAnalysis.confidenceAdjustment) {
    return { apply: false, reason: 'no-adjustment', ageMs: 0 };
  }
  const ts = aiAnalysis.timestamp ? new Date(aiAnalysis.timestamp).getTime() : null;
  const ageMs = ts && Number.isFinite(ts) ? nowMs - ts : 0;

  if (ts && Number.isFinite(ts) && ageMs > maxAgeMs) {
    return { apply: false, reason: `stale(age=${Math.round(ageMs / 1000)}s)`, ageMs };
  }

  const analysisPhase = aiAnalysis.inputData && aiAnalysis.inputData.phase;
  if (analysisPhase && currentPhase && analysisPhase !== currentPhase) {
    return { apply: false, reason: `phase-mismatch(${analysisPhase}!=${currentPhase})`, ageMs };
  }

  return { apply: true, reason: 'fresh', ageMs };
}

module.exports = { shouldApplyAiAdjustment };
