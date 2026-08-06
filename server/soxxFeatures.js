/**
 * SOXX feature snapshot — assembles the FULL raw feature vector at a point in
 * time from the sentiment engine + the market-context pack + technicals + time
 * of day. Recorded raw with every prediction so we can re-learn later without
 * re-collecting (mirrors run.json storing OHLC). Feeds soxxPredictorCore.predict.
 */

const { sentimentEngine } = require('./semiconductorSentiment');
const { getSemiContext } = require('./semiMarketContext');
const alpacaClient = require('./alpacaClient');

const num = v => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);

// ET clock parts (DST-correct) → { hour, minute, weekday 0=Sun..6=Sat }.
function etParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date());
  let hour = 0;
  let minute = 0;
  let wd = '';
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    else if (p.type === 'minute') minute = parseInt(p.value, 10);
    else if (p.type === 'weekday') wd = p.value;
  }
  if (hour === 24) hour = 0;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return { hour, minute, weekday };
}

/**
 * @returns {Promise<{ soxxPrice:number|null, features:object }>}
 */
async function assembleFeatures() {
  const sentiment = await sentimentEngine.getSentiment().catch(() => ({}));
  const ctx = await getSemiContext({ maxWaitMs: 4000 }).catch(() => null);
  const snap = await alpacaClient.getSnapshot('SOXX').catch(() => null);

  const soxxPrice =
    snap && Number.isFinite(snap.last) && snap.last > 0
      ? snap.last
      : num(sentiment.currentPrice);

  const { hour, minute, weekday } = etParts();
  const minutesFromOpen = hour * 60 + minute - (9 * 60 + 30); // 9:30 ET open

  const md = sentiment.momentumData || {};
  const b = ctx && ctx.breadth;
  const m = ctx && ctx.macro;

  // Sub-sector rotation over ~30 sessions (cached ~2h) → numeric rotation features.
  // Captures leadership cycles: dispersion (spread), whether semis broadly lead/lag
  // the market (vs SPY), and the breadth of that leadership. Recorded raw so future
  // learning can weight them; live == the same computeSectorSeries core the UI uses.
  const sectorHist = await require('./soxxSectorHistory')
    .getSectorHistory()
    .catch(() => null);
  const rot = (() => {
    if (!sectorHist || !sectorHist.sectors || !sectorHist.sectors.length || !sectorHist.benchmark) return {};
    const secs = sectorHist.sectors; // sorted by cum desc
    const spyCum = sectorHist.benchmark.cum;
    const cums = secs.map(s => s.cum);
    const meanCum = cums.reduce((a, c) => a + c, 0) / cums.length;
    return {
      rotLeader: secs[0].name,
      rotLaggard: secs[secs.length - 1].name,
      rotSpread: secs[0].cum - secs[secs.length - 1].cum,
      rotSemisVsSpy: meanCum - spyCum,
      rotPctBeatSpy: secs.filter(s => s.vsSpy > 0).length / secs.length,
      rotSpyCum: spyCum,
    };
  })();

  const features = {
    // ── sentiment (heuristic read) ──
    sentDirection: sentiment.direction || 'neutral',
    sentConfidence: num(sentiment.confidence),
    intradayChange: num(sentiment.intradayChangeRaw),
    volatility: num(sentiment.volatilityRaw),
    rollingMomentum: num(md.rollingMomentum),
    dropFromHigh: num(md.dropFromHigh),
    riseFromLow: num(md.riseFromLow),
    totalRange: num(md.totalRange),
    phase: sentiment.phase || null,
    // ── SOXX internals (breadth / concentration) ──
    breadthPctGreen: b ? num(b.pctGreen) : null,
    breadthWPctGreen: b ? num(b.wPctGreen) : null,
    megaShare: b ? num(b.megaShare) : null,
    narrow: b ? !!b.narrow : null,
    // ── macro / regime ──
    macroEquity: m ? num(m.equity) : null,
    macroVix: m ? num(m.vix) : null,
    macroGold: m ? num(m.gold) : null,
    semisVsTech: m ? num(m.spread) : null,
    macroRegime: m ? m.regime : null,
    vixConfirm: m ? m.vixConfirm : null,
    safeHaven: m ? !!m.safeHaven : null,
    // ── time (for seasonality / time-of-day learning) ──
    etHour: hour,
    minutesFromOpen,
    weekday,
    // ── sub-sector rotation over ~30d (leadership cycles / vs SPY) ──
    rotLeader: rot.rotLeader ?? null,
    rotLaggard: rot.rotLaggard ?? null,
    rotSpread: rot.rotSpread ?? null,
    rotSemisVsSpy: rot.rotSemisVsSpy ?? null,
    rotPctBeatSpy: rot.rotPctBeatSpy ?? null,
    rotSpyCum: rot.rotSpyCum ?? null,
    contextStale: ctx ? !!ctx.stale : true,
  };

  return { soxxPrice, features };
}

module.exports = { assembleFeatures, etParts };
