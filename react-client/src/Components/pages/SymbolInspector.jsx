import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import theme from '../../theme';

const POLL_INTERVAL = 15000;

// Builds the full set of endpoints to query for one symbol. Result is
// keyed by a short source name so the UI can label each value with where
// it came from.
function buildEndpoints(symbol) {
  const sym = encodeURIComponent(symbol);
  return {
    family: `/api/leveraged-etf/family/${sym}`,
    leverage: `/api/leveraged/${sym}`,
    decay: `/api/leveraged/${sym}/decay`,
    analyze: `/api/leveraged-etf/analyze/${sym}`,
    quote: `/api/alpaca/quotes/${sym}?mode=paper`,
    realtime: `/api/realtime/price/${sym}`,
    position: `/api/alpaca/positions/${sym}?mode=paper`,
    bars: `/api/alpaca/bars/${sym}/5Min?mode=paper&limit=20`,
    indicators: `/api/indicators/${sym}`,
    signals: `/api/indicators/${sym}/signals`,
    regime: `/api/regime/${sym}`,
    regimeTimeline: `/api/regime/${sym}/timeline`,
    sentiment: `/api/semiconductor/sentiment`, // only meaningful for semi family
    phase: `/api/semiconductor/phase`,
    costs: `/api/costs/${sym}`,
    logs: `/api/trading/logs?symbol=${sym}&limit=50`,
    sessions: `/api/ai/sessions/default_user`,
  };
}

function fmt(value, opts = {}) {
  const { decimals = 2, isMoney = false, isPct = false } = opts;
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    const formatted = value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${isMoney ? '$' : ''}${formatted}${isPct ? '%' : ''}`;
  }
  return String(value);
}

function timeAgo(date) {
  if (!date) return 'never';
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

const Field = ({ label, value, source, mono = true, color }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: theme.spacing.sm,
      padding: '4px 0',
      borderBottom: `1px solid ${theme.colors.gray100}`,
      fontSize: theme.typography.fontSize.sm,
    }}
  >
    <div
      style={{
        color: theme.colors.gray600,
        fontSize: theme.typography.fontSize.xs,
      }}
    >
      {label}
      {source && (
        <div
          style={{
            fontSize: '10px',
            color: theme.colors.gray400,
            fontFamily: 'monospace',
            marginTop: 1,
          }}
        >
          {source}
        </div>
      )}
    </div>
    <div
      style={{
        fontFamily: mono
          ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
          : 'inherit',
        color: color || theme.colors.gray900,
        wordBreak: 'break-word',
      }}
    >
      {value}
    </div>
  </div>
);

const Section = ({ title, source, children, defaultOpen = true }) => (
  <details
    open={defaultOpen}
    style={{
      marginBottom: theme.spacing.md,
      border: `1px solid ${theme.colors.gray200}`,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface,
    }}
  >
    <summary
      style={{
        padding: `${theme.spacing.sm} ${theme.spacing.md}`,
        backgroundColor: theme.colors.gray100,
        cursor: 'pointer',
        fontWeight: theme.typography.fontWeight.semibold,
        fontSize: theme.typography.fontSize.sm,
        borderBottom: `1px solid ${theme.colors.gray200}`,
      }}
    >
      {title}
      {source && (
        <span
          style={{
            marginLeft: 8,
            fontWeight: theme.typography.fontWeight.normal,
            color: theme.colors.gray500,
            fontSize: theme.typography.fontSize.xs,
            fontFamily: 'monospace',
          }}
        >
          {source}
        </span>
      )}
    </summary>
    <div style={{ padding: theme.spacing.md }}>{children}</div>
  </details>
);

const RawJson = ({ data }) => (
  <details style={{ marginTop: theme.spacing.sm }}>
    <summary
      style={{
        cursor: 'pointer',
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.gray500,
      }}
    >
      Raw response
    </summary>
    <pre
      style={{
        margin: '8px 0 0 0',
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.gray100,
        borderRadius: theme.borderRadius.sm,
        fontSize: theme.typography.fontSize.xs,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 400,
        overflow: 'auto',
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  </details>
);

const ErrorOrLoading = ({ result }) => {
  if (!result) {
    return (
      <div
        style={{
          color: theme.colors.gray500,
          fontFamily: 'monospace',
          fontSize: theme.typography.fontSize.sm,
        }}
      >
        loading…
      </div>
    );
  }
  if (result.error) {
    return (
      <div
        style={{
          color: theme.colors.error,
          fontSize: theme.typography.fontSize.sm,
        }}
      >
        Network error: {result.error}
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div
        style={{
          color: theme.colors.warning,
          fontSize: theme.typography.fontSize.sm,
        }}
      >
        HTTP {result.status} —{' '}
        {result.json?.error || result.json?.message || 'no body'}
      </div>
    );
  }
  return null;
};

const SymbolInspector = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [symbol, setSymbol] = useState(
    (searchParams.get('symbol') || 'SOXL').toUpperCase()
  );
  const [pendingSymbol, setPendingSymbol] = useState(symbol);
  const [data, setData] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);
  const [tick, setTick] = useState(0);

  const endpoints = useMemo(() => buildEndpoints(symbol), [symbol]);

  const fetchAll = useCallback(async () => {
    const entries = Object.entries(endpoints);
    const results = await Promise.all(
      entries.map(async ([key, url]) => {
        const start = performance.now();
        try {
          const res = await fetch(url);
          const latencyMs = Math.round(performance.now() - start);
          const text = await res.text();
          let json = null;
          let parseError = null;
          if (text) {
            try {
              json = JSON.parse(text);
            } catch (e) {
              parseError = e.message;
              json = text.slice(0, 500);
            }
          }
          return [
            key,
            {
              url,
              status: res.status,
              ok: res.ok,
              latencyMs,
              json,
              parseError,
              fetchedAt: new Date(),
              error: null,
            },
          ];
        } catch (err) {
          return [
            key,
            {
              url,
              status: 0,
              ok: false,
              latencyMs: Math.round(performance.now() - start),
              json: null,
              fetchedAt: new Date(),
              error: err.message,
            },
          ];
        }
      })
    );
    const next = {};
    for (const [k, v] of results) next[k] = v;
    setData(next);
    setLastRefresh(new Date());
  }, [endpoints]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchAll]);

  // 1s tick so timestamps stay live
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const handleSymbolSubmit = e => {
    e.preventDefault();
    const next = pendingSymbol.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
    setSearchParams({ symbol: next });
  };

  // Pull useful values out of the various endpoint responses.
  // Each section below extracts the fields it needs and labels them
  // with the endpoint they came from.
  const family = data.family?.json?.family || data.family?.json;
  const analyze = data.analyze?.json;
  const leverage = data.leverage?.json;
  const decay = data.decay?.json;
  const quote = data.quote?.json?.quote || data.quote?.json;
  const realtime = data.realtime?.json;
  const position =
    data.position?.json?.position ||
    (data.position?.status === 200 ? data.position?.json : null);
  const indicators = data.indicators?.json;
  const signals = data.signals?.json;
  const regime = data.regime?.json;
  const sentiment = data.sentiment?.json;
  const phase = data.phase?.json;
  const costs = data.costs?.json;
  const logs = data.logs?.json?.logs || data.logs?.json || [];
  const allSessions = data.sessions?.json?.sessions || [];
  const watchingSessions = allSessions.filter(s =>
    (s.config?.watchlist || []).map(x => x.toUpperCase()).includes(symbol)
  );

  // Color helpers
  const plColor = pl => {
    const n = Number(pl);
    if (!Number.isFinite(n)) return theme.colors.gray700;
    if (n > 0) return theme.colors.success;
    if (n < 0) return theme.colors.error;
    return theme.colors.gray700;
  };

  return (
    <div
      style={{
        padding: theme.spacing.md,
        fontFamily: 'inherit',
        fontSize: theme.typography.fontSize.sm,
      }}
    >
      <form
        onSubmit={handleSymbolSubmit}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: theme.typography.fontSize.lg,
          }}
        >
          Symbol Inspector
        </h2>
        <input
          type="text"
          value={pendingSymbol}
          onChange={e => setPendingSymbol(e.target.value)}
          placeholder="SOXL"
          style={{
            padding: '6px 10px',
            border: `1px solid ${theme.colors.gray300}`,
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.sm,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            textTransform: 'uppercase',
            width: 140,
          }}
        />
        <button
          type="submit"
          style={{
            padding: '6px 14px',
            border: 'none',
            backgroundColor: theme.colors.primary || '#3b82f6',
            color: '#fff',
            borderRadius: theme.borderRadius.sm,
            cursor: 'pointer',
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.medium,
          }}
        >
          Inspect
        </button>
        {['SOXL', 'SOXS', 'QBTX', 'TQQQ', 'SPY', 'AAPL', 'BTCUSD'].map(s => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setPendingSymbol(s);
              setSymbol(s);
              setSearchParams({ symbol: s });
            }}
            style={{
              padding: '4px 10px',
              border: `1px solid ${s === symbol ? theme.colors.primary || '#3b82f6' : theme.colors.gray300}`,
              backgroundColor:
                s === symbol
                  ? `${theme.colors.primary || '#3b82f6'}15`
                  : '#fff',
              borderRadius: theme.borderRadius.sm,
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.xs,
              fontFamily: 'monospace',
            }}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={fetchAll}
          style={{
            padding: '6px 12px',
            border: `1px solid ${theme.colors.gray300}`,
            backgroundColor: '#fff',
            borderRadius: theme.borderRadius.sm,
            cursor: 'pointer',
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          Refresh
        </button>
        <span
          style={{
            marginLeft: 'auto',
            color: theme.colors.gray500,
            fontSize: theme.typography.fontSize.xs,
            fontFamily: 'monospace',
          }}
        >
          last refresh: {lastRefresh ? timeAgo(lastRefresh) : 'never'} • auto
          15s
        </span>
      </form>

      <h1
        style={{
          margin: 0,
          marginBottom: theme.spacing.md,
          fontSize: '32px',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        {symbol}
      </h1>

      {/* IDENTITY */}
      <Section
        title="Identity & Metadata"
        source="@keo/quant-core: LeveragedEtfStrategy.getFamily, LeveragedEtfRules.getInfo"
      >
        <ErrorOrLoading result={data.family || data.leverage} />
        {family && (
          <>
            <Field
              label="Symbol"
              value={analyze?.symbol || symbol}
              source="param"
            />
            <Field
              label="Family base"
              value={family.baseSymbol || family.base || '—'}
              source="GET /api/leveraged-etf/family"
            />
            <Field
              label="Family name"
              value={family.name || '—'}
              source="GET /api/leveraged-etf/family"
            />
            <Field
              label="Bull symbol"
              value={`${family.bull?.symbol || '—'} (${family.bull?.leverage || ''}) — ${family.bull?.name || ''}`}
              source="LeveragedEtfStrategy.getFamily.bull"
            />
            <Field
              label="Bear symbol"
              value={`${family.bear?.symbol || '—'} (${family.bear?.leverage || ''}) — ${family.bear?.name || ''}`}
              source="LeveragedEtfStrategy.getFamily.bear"
            />
          </>
        )}
        {leverage && (
          <>
            <Field
              label="Is leveraged"
              value={leverage.isLeveraged ? 'yes' : 'no'}
              source="LeveragedEtfRules.isLeveraged"
            />
            <Field
              label="Leverage multiplier"
              value={leverage.leverage || leverage.info?.leverage || '—'}
              source="LeveragedEtfRules.getLeverage"
            />
            <Field
              label="Direction"
              value={leverage.info?.direction || '—'}
              source="LeveragedEtfRules.getInfo.direction"
            />
            <Field
              label="Underlying"
              value={leverage.info?.underlying || '—'}
              source="LeveragedEtfRules.getInfo.underlying"
            />
            <Field
              label="Annual decay rate"
              value={
                leverage.info?.annualDecayRate !== undefined
                  ? fmt(leverage.info.annualDecayRate * 100, {
                      decimals: 2,
                      isPct: true,
                    })
                  : '—'
              }
              source="LeveragedEtfRules.getInfo.annualDecayRate"
            />
            <Field
              label="Description"
              value={leverage.info?.description || '—'}
              source="LeveragedEtfRules.getInfo.description"
            />
          </>
        )}
        {decay && (
          <>
            <Field
              label="Decay (1d)"
              value={
                decay.expectedDecay !== undefined
                  ? fmt(decay.expectedDecay * 100, { decimals: 4, isPct: true })
                  : '—'
              }
              source="LeveragedEtfRules.calculateExpectedDecay(1)"
            />
          </>
        )}
        <RawJson
          data={{
            family: data.family?.json,
            leverage: data.leverage?.json,
            decay: data.decay?.json,
          }}
        />
      </Section>

      {/* LIVE PRICE */}
      <Section
        title="Live Price"
        source="GET /api/alpaca/quotes, /api/realtime/price"
      >
        <ErrorOrLoading result={data.quote || data.realtime} />
        {quote && (
          <>
            <Field
              label="Bid"
              value={fmt(quote.bid || quote.bp, { isMoney: true })}
              source="quote.bid"
            />
            <Field
              label="Ask"
              value={fmt(quote.ask || quote.ap, { isMoney: true })}
              source="quote.ask"
            />
            <Field
              label="Spread"
              value={
                quote.bid && quote.ask
                  ? fmt(quote.ask - quote.bid, { isMoney: true, decimals: 4 })
                  : '—'
              }
              source="ask − bid"
            />
            <Field
              label="Quote timestamp"
              value={quote.timestamp || quote.t || '—'}
              source="quote.timestamp"
            />
          </>
        )}
        {realtime && (
          <>
            <Field
              label="Realtime price (cached)"
              value={fmt(realtime.price, { isMoney: true })}
              source="GET /api/realtime/price"
            />
            <Field
              label="Source"
              value={realtime.source || realtime.cached ? 'cache' : 'live'}
              source="realtime.source"
            />
            <Field
              label="Realtime timestamp"
              value={realtime.timestamp || '—'}
              source="realtime.timestamp"
            />
          </>
        )}
        <RawJson
          data={{ quote: data.quote?.json, realtime: data.realtime?.json }}
        />
      </Section>

      {/* POSITION */}
      <Section
        title="Open Position"
        source="GET /api/alpaca/positions/:symbol"
        defaultOpen={!!position}
      >
        <ErrorOrLoading result={data.position} />
        {position && position.symbol ? (
          <>
            <Field
              label="Quantity"
              value={fmt(position.quantity || position.qty, { decimals: 6 })}
              source="position.quantity"
            />
            <Field
              label="Side"
              value={position.side || '—'}
              source="position.side"
            />
            <Field
              label="Entry price"
              value={fmt(position.avgEntryPrice || position.avg_entry_price, {
                isMoney: true,
              })}
              source="position.avgEntryPrice"
            />
            <Field
              label="Current price"
              value={fmt(position.currentPrice || position.current_price, {
                isMoney: true,
              })}
              source="position.currentPrice"
            />
            <Field
              label="Market value"
              value={fmt(position.marketValue || position.market_value, {
                isMoney: true,
              })}
              source="position.marketValue"
            />
            <Field
              label="Unrealized P&L"
              value={fmt(position.unrealizedPL || position.unrealized_pl, {
                isMoney: true,
              })}
              source="position.unrealizedPL"
              color={plColor(position.unrealizedPL || position.unrealized_pl)}
            />
            <Field
              label="Unrealized %"
              value={fmt(
                Number(
                  position.unrealizedPLPercent ?? position.unrealized_plpc
                ) * (position.unrealized_plpc ? 100 : 1),
                { isPct: true }
              )}
              source="position.unrealizedPLPercent"
              color={plColor(position.unrealizedPL || position.unrealized_pl)}
            />
            <Field
              label="Cost basis"
              value={fmt(position.costBasis || position.cost_basis, {
                isMoney: true,
              })}
              source="position.costBasis"
            />
            <Field
              label="Change today"
              value={fmt(position.changeToday, { isPct: false })}
              source="position.changeToday"
            />
          </>
        ) : (
          <div style={{ color: theme.colors.gray500, fontStyle: 'italic' }}>
            No open position for {symbol}
          </div>
        )}
        <RawJson data={data.position?.json} />
      </Section>

      {/* INDICATORS */}
      <Section
        title="Technical Indicators"
        source="@keo/quant-core: indicators.getAllIndicators (via GET /api/indicators/:symbol)"
      >
        <ErrorOrLoading result={data.indicators} />
        {indicators &&
          (() => {
            const ind = indicators.indicators || indicators;
            return (
              <>
                <Field
                  label="Current price"
                  value={fmt(ind.price, { isMoney: true })}
                  source="indicators.price"
                />
                <Field
                  label="Previous close"
                  value={fmt(indicators.prevClose, { isMoney: true })}
                  source="prevClose"
                />
                <Field
                  label="Bars analyzed"
                  value={fmt(indicators.candles?.length, { decimals: 0 })}
                  source="candles.length"
                />
                <Field
                  label="RSI (14)"
                  value={fmt(ind.rsi?.value ?? ind.rsi, { decimals: 2 })}
                  source="indicators.calculateRSI"
                />
                {ind.rsi?.signal && (
                  <Field
                    label="RSI signal"
                    value={ind.rsi.signal}
                    source="indicators.rsi.signal"
                  />
                )}
                <Field
                  label="MACD line"
                  value={fmt(ind.macd?.MACD ?? ind.macd?.macd, { decimals: 4 })}
                  source="indicators.calculateMACD"
                />
                <Field
                  label="MACD signal"
                  value={fmt(ind.macd?.signal, { decimals: 4 })}
                  source="macd.signal"
                />
                <Field
                  label="MACD histogram"
                  value={fmt(ind.macd?.histogram, { decimals: 4 })}
                  source="macd.histogram"
                />
                <Field
                  label="Bollinger upper"
                  value={fmt(ind.bollingerBands?.upper, { isMoney: true })}
                  source="indicators.calculateBollingerBands.upper"
                />
                <Field
                  label="Bollinger middle"
                  value={fmt(ind.bollingerBands?.middle, { isMoney: true })}
                  source="bollingerBands.middle"
                />
                <Field
                  label="Bollinger lower"
                  value={fmt(ind.bollingerBands?.lower, { isMoney: true })}
                  source="bollingerBands.lower"
                />
                <Field
                  label="BB %B"
                  value={fmt(ind.bollingerBands?.percentB, { decimals: 4 })}
                  source="bollingerBands.percentB"
                />
                <Field
                  label="BB bandwidth"
                  value={fmt(ind.bollingerBands?.bandwidth, { decimals: 4 })}
                  source="bollingerBands.bandwidth"
                />
                <Field
                  label="ATR (14)"
                  value={fmt(ind.atr?.value ?? ind.atr, { decimals: 4 })}
                  source="indicators.calculateATR"
                />
                <Field
                  label="EMA fast"
                  value={fmt(ind.ema?.fast, { isMoney: true })}
                  source="indicators.calculateEMA(fast)"
                />
                <Field
                  label="EMA slow"
                  value={fmt(ind.ema?.slow, { isMoney: true })}
                  source="indicators.calculateEMA(slow)"
                />
                <Field
                  label="VWAP"
                  value={fmt(ind.vwap, { isMoney: true })}
                  source="indicators.calculateVWAP"
                />
                <Field
                  label="Stochastic K"
                  value={fmt(ind.stochastic?.k, { decimals: 2 })}
                  source="indicators.calculateStochastic.k"
                />
                <Field
                  label="Stochastic D"
                  value={fmt(ind.stochastic?.d, { decimals: 2 })}
                  source="stochastic.d"
                />
                <Field
                  label="ADX value"
                  value={fmt(ind.adx?.value, { decimals: 2 })}
                  source="indicators.calculateADX"
                />
                <Field
                  label="ADX trending"
                  value={ind.adx?.trending ? 'yes' : 'no'}
                  source="adx.trending"
                />
                <Field
                  label="ADX bullish DI"
                  value={ind.adx?.bullishDI ? 'yes' : 'no'}
                  source="adx.bullishDI"
                />
                <Field
                  label="Volume ratio"
                  value={fmt(ind.volume?.ratio, { decimals: 2 })}
                  source="indicators.volume.ratio"
                />
                <Field
                  label="Above avg volume"
                  value={ind.volume?.aboveAverage ? 'yes' : 'no'}
                  source="volume.aboveAverage"
                />
                <Field
                  label="Trend"
                  value={ind.trend?.shortTerm || JSON.stringify(ind.trend)}
                  source="indicators.trend"
                />
              </>
            );
          })()}
        <RawJson data={data.indicators?.json} />
      </Section>

      {/* SIGNALS */}
      <Section
        title="Signal Summary"
        source="@keo/quant-core: indicators.generateSignals (via /api/indicators/:symbol/signals)"
      >
        <ErrorOrLoading result={data.signals} />
        {signals &&
          (() => {
            const s = signals.signals || signals;
            return (
              <>
                <Field
                  label="Signal"
                  value={s.signal || '—'}
                  source="signals.signal"
                  color={
                    s.signal === 'BUY'
                      ? theme.colors.success
                      : s.signal === 'SELL'
                        ? theme.colors.error
                        : theme.colors.gray700
                  }
                />
                <Field
                  label="Confidence"
                  value={fmt(s.confidence, { isPct: true })}
                  source="signals.confidence"
                />
                <Field
                  label="Bullish score"
                  value={fmt(s.bullishScore, { decimals: 0 })}
                  source="signals.bullishScore"
                />
                <Field
                  label="Bearish score"
                  value={fmt(s.bearishScore, { decimals: 0 })}
                  source="signals.bearishScore"
                />
                <Field
                  label="Net score"
                  value={fmt(s.netScore, { decimals: 0 })}
                  source="signals.netScore"
                />
                <Field
                  label="Reasons"
                  value={Array.isArray(s.reasons) ? s.reasons.join(', ') : '—'}
                  source="signals.reasons"
                />
              </>
            );
          })()}
        <RawJson data={data.signals?.json} />
      </Section>

      {/* REGIME */}
      <Section
        title="Market Regime"
        source="@keo/quant-core: RegimeDetector.detectRegime (via /api/regime/:symbol)"
      >
        <ErrorOrLoading result={data.regime} />
        {regime && (
          <>
            <Field
              label="Regime"
              value={regime.regime || '—'}
              source="RegimeDetector.detectRegime.regime"
              color={
                regime.regime === 'bull'
                  ? theme.colors.success
                  : regime.regime === 'bear'
                    ? theme.colors.error
                    : theme.colors.gray700
              }
            />
            <Field
              label="Confidence"
              value={fmt(regime.confidence, { isPct: true })}
              source="regime.confidence"
            />
            <Field
              label="Trend strength"
              value={regime.trendStrength || '—'}
              source="regime.trendStrength"
            />
            <Field
              label="Description"
              value={regime.description || '—'}
              source="regime.description"
            />
            {regime.indicators && (
              <>
                <Field
                  label="Price vs MA"
                  value={regime.indicators.priceToMA || '—'}
                  source="regime.indicators.priceToMA"
                />
                <Field
                  label="50-MA value"
                  value={fmt(regime.indicators.ma, { isMoney: true })}
                  source="regime.indicators.ma"
                />
                <Field
                  label="ADX"
                  value={regime.indicators.adx || '—'}
                  source="regime.indicators.adx"
                />
                <Field
                  label="Volatility"
                  value={regime.indicators.volatility || '—'}
                  source="regime.indicators.volatility"
                />
                <Field
                  label="5-day return"
                  value={regime.indicators.fiveDayReturn || '—'}
                  source="regime.indicators.fiveDayReturn"
                />
                <Field
                  label="10-day return"
                  value={regime.indicators.tenDayReturn || '—'}
                  source="regime.indicators.tenDayReturn"
                />
                <Field
                  label="Bull/Bear/Sideways signals"
                  value={
                    regime.indicators.signals
                      ? `${regime.indicators.signals.bullish}/${regime.indicators.signals.bearish}/${regime.indicators.signals.sideways}`
                      : '—'
                  }
                  source="regime.indicators.signals"
                />
              </>
            )}
            {regime.recommendedStrategy && (
              <>
                <Field
                  label="Strategy approach"
                  value={regime.recommendedStrategy.approach || '—'}
                  source="regime.recommendedStrategy.approach"
                />
                <Field
                  label="TP multiplier"
                  value={fmt(regime.recommendedStrategy.takeProfitMultiplier, {
                    decimals: 2,
                  })}
                  source="regime.recommendedStrategy.takeProfitMultiplier"
                />
                <Field
                  label="SL multiplier"
                  value={fmt(regime.recommendedStrategy.stopLossMultiplier, {
                    decimals: 2,
                  })}
                  source="regime.recommendedStrategy.stopLossMultiplier"
                />
              </>
            )}
            {regime.leveragedRecommendation && (
              <>
                <Field
                  label="Recommended ETF"
                  value={regime.leveragedRecommendation.symbol || '—'}
                  source="regime.leveragedRecommendation.symbol"
                />
                <Field
                  label="ETF leverage"
                  value={regime.leveragedRecommendation.leverage || '—'}
                  source="regime.leveragedRecommendation.leverage"
                />
                <Field
                  label="ETF direction"
                  value={regime.leveragedRecommendation.direction || '—'}
                  source="regime.leveragedRecommendation.direction"
                />
                <Field
                  label="Risk level"
                  value={regime.leveragedRecommendation.riskLevel || '—'}
                  source="regime.leveragedRecommendation.riskLevel"
                />
              </>
            )}
          </>
        )}
        <RawJson data={data.regime?.json} />
      </Section>

      {/* SENTIMENT (only useful for semi family) */}
      {family?.baseSymbol === 'SOXX' ||
      family?.base === 'SOXX' ||
      ['SOXL', 'SOXS', 'SOXX'].includes(symbol) ? (
        <Section
          title="Semiconductor Sentiment"
          source="server/semiconductorSentiment.js (via /api/semiconductor/sentiment, /phase)"
        >
          <ErrorOrLoading result={data.sentiment || data.phase} />
          {sentiment && (
            <>
              <Field
                label="Reference symbol"
                value={sentiment.referenceSymbol || '—'}
                source="sentiment.referenceSymbol"
              />
              <Field
                label="Direction"
                value={sentiment.direction || '—'}
                source="analyzeDirection.direction"
                color={
                  sentiment.direction === 'bullish'
                    ? theme.colors.success
                    : sentiment.direction === 'bearish'
                      ? theme.colors.error
                      : theme.colors.gray700
                }
              />
              <Field
                label="Confidence"
                value={fmt(sentiment.confidence, { isPct: true })}
                source="sentiment.confidence"
              />
              <Field
                label="Current SOXX price"
                value={fmt(parseFloat(sentiment.currentPrice), {
                  isMoney: true,
                })}
                source="sentiment.currentPrice"
              />
              <Field
                label="Open SOXX price"
                value={fmt(parseFloat(sentiment.openPrice), { isMoney: true })}
                source="sentiment.openPrice"
              />
              <Field
                label="Intraday change"
                value={sentiment.intradayChange || '—'}
                source="sentiment.intradayChange"
              />
              <Field
                label="Volatility"
                value={sentiment.volatility || '—'}
                source="sentiment.volatility"
              />
              <Field
                label="Stale data?"
                value={
                  sentiment.stale ? `yes (${sentiment.staleReason})` : 'no'
                }
                source="sentiment.stale (stale-while-error fallback)"
              />
              <Field
                label="Phase"
                value={sentiment.phase || '—'}
                source="MarketPhaseTracker.getCurrentPhase"
              />
              <Field
                label="Trading allowed"
                value={sentiment.tradingAllowed ? 'yes' : 'no'}
                source="phase.tradingAllowed"
              />
              <Field
                label="Direction changed"
                value={sentiment.directionChanged ? 'yes' : 'no'}
                source="sentiment.directionChanged"
              />
              {sentiment.thresholds && (
                <>
                  <Field
                    label="Entry threshold"
                    value={sentiment.thresholds.entry || '—'}
                    source="calculateDynamicThresholds.entry"
                  />
                  <Field
                    label="Exit threshold"
                    value={sentiment.thresholds.exit || '—'}
                    source="calculateDynamicThresholds.exit"
                  />
                  <Field
                    label="Switch threshold"
                    value={sentiment.thresholds.switch || '—'}
                    source="calculateDynamicThresholds.switchDirection"
                  />
                </>
              )}
              {Array.isArray(sentiment.signals) && (
                <Field
                  label="Signals"
                  value={sentiment.signals.join(', ')}
                  source="sentiment.signals"
                />
              )}
            </>
          )}
          <RawJson
            data={{ sentiment: data.sentiment?.json, phase: data.phase?.json }}
          />
        </Section>
      ) : null}

      {/* LEVERAGE ANALYSIS — combined view */}
      <Section
        title="Leveraged ETF Analysis (combined)"
        source="GET /api/leveraged-etf/analyze/:symbol"
        defaultOpen={false}
      >
        <ErrorOrLoading result={data.analyze} />
        {analyze?.analysis?.technical && (
          <>
            <Field
              label="Technical regime"
              value={analyze.analysis.technical.regime || '—'}
              source="analyze.analysis.technical.regime"
            />
            <Field
              label="Technical confidence"
              value={fmt(analyze.analysis.technical.confidence, {
                isPct: true,
              })}
              source="technical.confidence"
            />
            <Field
              label="Trend strength"
              value={analyze.analysis.technical.trendStrength || '—'}
              source="technical.trendStrength"
            />
            <Field
              label="Description"
              value={analyze.analysis.technical.description || '—'}
              source="technical.description"
            />
          </>
        )}
        {analyze?.recommendation && (
          <>
            <Field
              label="Recommended action"
              value={analyze.recommendation.action || '—'}
              source="analyze.recommendation.action"
            />
            <Field
              label="Recommended symbol"
              value={analyze.recommendation.symbol || '—'}
              source="analyze.recommendation.symbol"
            />
            <Field
              label="Combined confidence"
              value={fmt(analyze.recommendation.combinedConfidence, {
                isPct: true,
              })}
              source="analyze.recommendation.combinedConfidence"
            />
          </>
        )}
        <RawJson data={data.analyze?.json} />
      </Section>

      {/* COSTS / FEES */}
      <Section
        title="Transaction Costs"
        source="server/transactionCostModel.js (via /api/costs/:symbol)"
        defaultOpen={false}
      >
        <ErrorOrLoading result={data.costs} />
        {costs && (
          <>
            <Field
              label="Spread (bps)"
              value={fmt(costs.spreadBps ?? costs.spread, { decimals: 2 })}
              source="costs.spread"
            />
            <Field
              label="Commission"
              value={fmt(costs.commission, { isMoney: true, decimals: 4 })}
              source="costs.commission"
            />
            <Field
              label="Slippage estimate"
              value={fmt(costs.slippageBps, { decimals: 2 })}
              source="costs.slippage"
            />
          </>
        )}
        <RawJson data={data.costs?.json} />
      </Section>

      {/* SESSIONS WATCHING THIS SYMBOL */}
      <Section
        title={`Sessions Trading ${symbol}`}
        source="GET /api/ai/sessions/default_user (filtered by config.watchlist)"
      >
        {watchingSessions.length === 0 ? (
          <div style={{ color: theme.colors.gray500, fontStyle: 'italic' }}>
            No sessions have {symbol} in their watchlist
          </div>
        ) : (
          watchingSessions.map(s => (
            <div
              key={s.sessionId}
              style={{
                marginBottom: theme.spacing.sm,
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray200}`,
                borderRadius: theme.borderRadius.sm,
              }}
            >
              <div
                style={{
                  fontWeight: theme.typography.fontWeight.semibold,
                  marginBottom: 4,
                }}
              >
                {s.name}{' '}
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color:
                      s.status === 'running'
                        ? theme.colors.success
                        : theme.colors.gray500,
                    fontWeight: theme.typography.fontWeight.normal,
                    marginLeft: 6,
                  }}
                >
                  ({s.status})
                </span>
              </div>
              <Field
                label="Watchlist"
                value={(s.config?.watchlist || []).join(', ')}
                source="session.config.watchlist"
              />
              <Field
                label="Asset type"
                value={s.config?.assetType || '—'}
                source="session.config.assetType"
              />
              <Field
                label="Auto trade"
                value={s.config?.autoTrade ? 'yes' : 'no'}
                source="session.config.autoTrade"
              />
              <Field
                label="Sim mode"
                value={s.config?.simulationMode ? 'yes' : 'no'}
                source="session.config.simulationMode"
              />
              <Field
                label="Take profit"
                value={fmt(s.config?.takeProfitPercent, { isPct: true })}
                source="session.config.takeProfitPercent"
              />
              <Field
                label="Stop loss"
                value={fmt(s.config?.stopLossPercent, { isPct: true })}
                source="session.config.stopLossPercent"
              />
              <Field
                label="Max position size"
                value={fmt(s.config?.maxPositionSize, { isMoney: true })}
                source="session.config.maxPositionSize"
              />
              <Field
                label="Total trades"
                value={fmt(s.stats?.totalTrades, { decimals: 0 })}
                source="session.stats.totalTrades"
              />
              <Field
                label="Win rate"
                value={fmt(s.stats?.winRate, { isPct: true })}
                source="session.stats.winRate"
              />
              <Field
                label="Lifetime P&L"
                value={fmt(s.stats?.totalPnL, { isMoney: true })}
                source="session.stats.totalPnL"
                color={plColor(s.stats?.totalPnL)}
              />
              <Field
                label="Consecutive losses"
                value={fmt(s.stats?.consecutiveLosses, { decimals: 0 })}
                source="session.stats.consecutiveLosses"
              />
              <Field
                label="Circuit breaker"
                value={s.circuitBreakerTriggered ? 'TRIPPED' : 'ok'}
                source="session.circuitBreakerTriggered"
                color={
                  s.circuitBreakerTriggered
                    ? theme.colors.error
                    : theme.colors.success
                }
              />
            </div>
          ))
        )}
      </Section>

      {/* RECENT ACTIVITY */}
      <Section
        title={`Recent Activity (${symbol})`}
        source="GET /api/trading/logs?symbol=:symbol"
      >
        {logs.length === 0 ? (
          <div style={{ color: theme.colors.gray500, fontStyle: 'italic' }}>
            No log entries for {symbol} (logs are in-memory; cleared on server
            restart)
          </div>
        ) : (
          <div
            style={{
              maxHeight: 400,
              overflow: 'auto',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: theme.typography.fontSize.xs,
            }}
          >
            {logs.slice(0, 50).map(l => (
              <div
                key={l.id || `${l.timestamp}-${l.message}`}
                style={{
                  padding: '2px 0',
                  borderBottom: `1px solid ${theme.colors.gray100}`,
                }}
              >
                <span style={{ color: theme.colors.gray500 }}>
                  {new Date(l.timestamp).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>{' '}
                <span
                  style={{
                    fontWeight: theme.typography.fontWeight.semibold,
                    color:
                      l.level === 'EXEC'
                        ? theme.colors.success
                        : l.level === 'RISK' || l.level === 'ERROR'
                          ? theme.colors.error
                          : l.level === 'SIGNAL'
                            ? theme.colors.primary || '#3b82f6'
                            : theme.colors.gray700,
                  }}
                >
                  [{l.level}]
                </span>{' '}
                {l.message}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
};

export default SymbolInspector;
