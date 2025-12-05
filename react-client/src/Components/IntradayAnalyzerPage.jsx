/**
 * Intraday Trading Analyzer
 *
 * Day trading analysis tool with:
 * - 5-minute candle visualization
 * - Market sentiment (S&P 500, VIX)
 * - Entry/exit recommendations
 * - Technical indicators
 * - Pattern matching
 */

import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import MetricCorrelationChart from './MetricCorrelationChart';
import Button from './common/Button';
import Card from './common/Card';
import MetricCard from './common/MetricCard';
import theme from '../theme';

const IntradayAnalyzerPage = () => {
  const location = useLocation();
  const tickerFromNav = location.state?.ticker;

  const [symbol, setSymbol] = useState(tickerFromNav || 'QBTS');
  const [date, setDate] = useState('2025-12-04'); // Fixed: default to 2025
  const [analysis, setAnalysis] = useState(null);
  const [stockDetails, setStockDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Strategy optimization state
  const [showStrategyOptimizer, setShowStrategyOptimizer] = useState(false);
  const [strategyResults, setStrategyResults] = useState(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [startDate, setStartDate] = useState('2025-11-20');
  const [endDate, setEndDate] = useState('2025-12-04');

  // Buy Now state
  const [profitTargetDollars, setProfitTargetDollars] = useState(1000);
  const [tradeExecuting, setTradeExecuting] = useState(false);
  const [tradeResult, setTradeResult] = useState(null);

  // Position monitoring state
  const [currentPosition, setCurrentPosition] = useState(null);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [positionLoading, setPositionLoading] = useState(false);
  const [closingPosition, setClosingPosition] = useState(false);

  // Auto-fetch on mount or when ticker changes from navigation
  useEffect(() => {
    if (tickerFromNav) {
      setSymbol(tickerFromNav);
    }
  }, [tickerFromNav]);

  useEffect(() => {
    fetchAnalysis();
    fetchCurrentPosition();
  }, [symbol]);

  // Poll for position updates every 5 seconds when position exists
  useEffect(() => {
    if (!currentPosition) return;

    const interval = setInterval(() => {
      fetchCurrentPosition();
      fetchCurrentPrice();
    }, 5000);

    return () => clearInterval(interval);
  }, [currentPosition, symbol]);

  const fetchAnalysis = async () => {
    if (!symbol) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch intraday analysis
      const intradayUrl = date
        ? `/api/intraday/${symbol}?date=${date}`
        : `/api/intraday/${symbol}`;

      const intradayResponse = await fetch(intradayUrl);
      const intradayData = await intradayResponse.json();

      if (!intradayResponse.ok) {
        throw new Error(intradayData.error || 'Failed to fetch analysis');
      }

      setAnalysis(intradayData);

      // Also fetch stock details for additional context (fundamentals, technicals)
      const detailsResponse = await fetch(`/api/stock/analysis/${symbol}`);
      const detailsData = await detailsResponse.json();

      if (detailsResponse.ok) {
        setStockDetails(detailsData);
      } else {
        console.warn('Stock details not available:', detailsData.error);
      }
    } catch (err) {
      console.error('Error fetching analysis:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    fetchAnalysis();
  };

  const optimizeStrategy = async () => {
    setStrategyLoading(true);
    setStrategyResults(null);
    setTradeResult(null); // Clear previous trade result

    try {
      const response = await fetch('/api/strategy/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          startDate,
          endDate
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to optimize strategy');
      }

      setStrategyResults(data);
    } catch (err) {
      console.error('Error optimizing strategy:', err);
      setError(err.message);
    } finally {
      setStrategyLoading(false);
    }
  };

  const fetchCurrentPosition = async () => {
    if (!symbol) return;

    try {
      const response = await fetch(`/api/alpaca/positions/${symbol}`);
      const data = await response.json();

      if (data.success && data.position) {
        setCurrentPosition(data.position);
      } else {
        setCurrentPosition(null);
      }
    } catch (err) {
      console.error('Error fetching position:', err);
      setCurrentPosition(null);
    }
  };

  const fetchCurrentPrice = async () => {
    if (!symbol) return;

    try {
      const response = await fetch(`/api/alpaca/quotes/${symbol}`);
      const data = await response.json();

      if (data.success && data.quote) {
        setCurrentPrice(data.quote.ap); // Ask price
      }
    } catch (err) {
      console.error('Error fetching current price:', err);
    }
  };

  const closePosition = async (takeProfits = false) => {
    if (!currentPosition) return;

    const action = takeProfits ? 'take profits' : 'close position';
    if (!confirm(`Are you sure you want to ${action} for ${symbol}? This will sell ${Math.abs(currentPosition.qty)} shares at market price.`)) {
      return;
    }

    setClosingPosition(true);

    try {
      const response = await fetch(`/api/alpaca/positions/${symbol}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        alert(`Position closed successfully! Sold ${Math.abs(currentPosition.qty)} shares.`);
        setCurrentPosition(null);
        setTradeResult(null);
      } else {
        alert(`Failed to close position: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error closing position:', err);
      alert('Error closing position: ' + err.message);
    } finally {
      setClosingPosition(false);
    }
  };

  const executeTrade = async () => {
    if (!strategyResults || !strategyResults.optimalStrategy) {
      alert('Please optimize a strategy first');
      return;
    }

    // Calculate expected quantity based on profit target
    const strategy = strategyResults.optimalStrategy.strategy;
    const estimatedEntry = strategyResults.optimalStrategy.metrics.avgEntryPrice || 0;
    const profitPerShare = estimatedEntry * (strategy.profitTarget / 100);
    const estimatedQty = Math.floor(profitTargetDollars / profitPerShare);

    if (!confirm(`Try to execute live trade for ~${estimatedQty} shares of ${symbol} with $${profitTargetDollars} profit target?\n\nNote: This only works during market hours (9:30 AM - 4:00 PM ET) and if current conditions match the strategy.`)) {
      return;
    }

    setTradeExecuting(true);
    setTradeResult(null);

    try {
      const response = await fetch('/api/strategy/execute-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          strategy: strategyResults.optimalStrategy.strategy,
          profitTargetDollars
        })
      });

      const data = await response.json();
      setTradeResult(data);

      if (data.success && data.shouldEnter) {
        alert(`Trade executed successfully! Buy order placed for ${data.quantity} shares at market price with $${profitTargetDollars} profit target.`);
        // Refresh position after successful trade
        setTimeout(() => fetchCurrentPosition(), 2000);
      } else if (!data.shouldEnter) {
        // Build detailed failure message
        let message = `❌ TRADE NOT EXECUTED\n\n`;
        message += `Reason: ${data.reason}\n\n`;

        if (data.intendedTrade) {
          message += `INTENDED TRADE:\n`;
          message += `• Symbol: ${data.intendedTrade.symbol}\n`;
          message += `• Quantity: ${data.intendedTrade.quantity} shares\n`;
          message += `• Entry: Market buy at $${Number(data.intendedTrade.entryPrice).toFixed(2)}\n`;
          message += `• Target: ${data.intendedTrade.sellOrder} (${data.intendedTrade.profitTarget} profit)\n`;
          message += `• Strategy: ${data.intendedTrade.strategy.minMomentum3Hr}% min momentum, ${data.intendedTrade.strategy.minMarketBreadth}% breadth\n\n`;
        }

        if (data.failureDetails) {
          message += `CURRENT CONDITIONS:\n`;
          message += `• Stock 3Hr Momentum: ${data.failureDetails.stockMomentum}%\n`;
          message += `• SPY 3Hr Change: ${data.failureDetails.spyPerformance}%\n`;
          message += `• VIX 3Hr Change: ${data.failureDetails.vixChange}%\n`;
          message += `• Market Breadth: ${data.failureDetails.marketBreadth}% positive\n`;
          message += `• Avg Market Change: ${data.failureDetails.avgMarketChange}%\n`;
        }

        alert(message);
      }
    } catch (err) {
      console.error('Error executing trade:', err);
      alert('Error executing trade: ' + err.message);
      setTradeResult({ success: false, error: err.message });
    } finally {
      setTradeExecuting(false);
    }
  };

  return (
    <div style={{ padding: theme.spacing.xl, maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: theme.spacing.xl }}>
        <h1 style={{ fontSize: theme.typography.fontSize.xxl, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.sm} 0` }}>📈 Intraday Trading Analyzer</h1>
        <p style={{ margin: 0, color: theme.colors.textMuted }}>
          Day trading analysis with real-time market sentiment and entry/exit recommendations
        </p>
      </div>

      {/* Active Position Dashboard */}
      {currentPosition && (
        <Card
          variant={parseFloat(currentPosition.unrealized_pl) >= 0 ? 'success' : 'error'}
          padding="large"
          style={{ marginBottom: theme.spacing.xl }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.spacing.lg }}>
            <div>
              <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.xs} 0` }}>
                Active Position: {currentPosition.symbol}
              </h3>
              <div style={{ fontSize: theme.typography.fontSize.base, color: theme.colors.textMuted }}>
                {Math.abs(currentPosition.qty)} shares
              </div>
            </div>
            <div style={{
              fontSize: '32px',
              fontWeight: '700',
              color: parseFloat(currentPosition.unrealized_pl) >= 0 ? theme.colors.success : theme.colors.error
            }}>
              {parseFloat(currentPosition.unrealized_pl) >= 0 ? '📈' : '📉'}
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: theme.spacing.md,
            marginBottom: theme.spacing.lg
          }}>
            <MetricCard
              label="Entry Price"
              value={`$${parseFloat(currentPosition.avg_entry_price).toFixed(2)}`}
            />

            <MetricCard
              label="Current Price"
              value={`$${currentPrice ? parseFloat(currentPrice).toFixed(2) : parseFloat(currentPosition.current_price).toFixed(2)}`}
              variant="info"
            />

            <MetricCard
              label="Unrealized P/L"
              value={`$${parseFloat(currentPosition.unrealized_pl).toFixed(2)}`}
              subtext={`${parseFloat(currentPosition.unrealized_plpc).toFixed(2)}%`}
              variant={parseFloat(currentPosition.unrealized_pl) >= 0 ? 'success' : 'error'}
            />
          </div>

          <div style={{
            display: 'flex',
            gap: theme.spacing.sm,
            justifyContent: 'flex-end'
          }}>
            <Button
              onClick={() => closePosition(true)}
              disabled={closingPosition}
              variant="success"
            >
              {closingPosition ? 'Closing...' : '💰 Take Profits'}
            </Button>

            <Button
              onClick={() => closePosition(false)}
              disabled={closingPosition}
              variant="danger"
            >
              {closingPosition ? 'Closing...' : '🔴 Close Position'}
            </Button>
          </div>

          <div style={{
            marginTop: theme.spacing.md,
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.infoLight,
            borderRadius: theme.borderRadius.md,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.infoDark,
            textAlign: 'center'
          }}>
            Updates automatically every 5 seconds
          </div>
        </Card>
      )}

      {/* Input Form */}
      <Card padding="medium" style={{ marginBottom: theme.spacing.xl }}>
        <form onSubmit={handleSubmit} style={{
          display: 'flex',
          gap: theme.spacing.md,
        }}>
          <div style={{ flex: '0 0 150px' }}>
            <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: '600', fontSize: theme.typography.fontSize.base }}>
              Stock Symbol
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. AAPL"
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                fontSize: theme.typography.fontSize.base,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md
              }}
            />
          </div>

          <div style={{ flex: '0 0 200px' }}>
            <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: '600', fontSize: theme.typography.fontSize.base }}>
              Date (Optional)
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                fontSize: theme.typography.fontSize.base,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button
              type="submit"
              disabled={loading || !symbol}
              variant="primary"
            >
              {loading ? 'Analyzing...' : 'Analyze'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Error State */}
      {error && (
        <Card variant="error" padding="medium" style={{ marginBottom: theme.spacing.lg }}>
          <strong>Error:</strong> {error}
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{
          textAlign: 'center',
          padding: theme.spacing.xxl,
          fontSize: theme.typography.fontSize.md,
          color: theme.colors.textMuted
        }}>
          <div className="spinner" style={{ marginBottom: theme.spacing.md }}></div>
          Analyzing {symbol} intraday data...
        </div>
      )}

      {/* Analysis Results */}
      {analysis && !loading && (
        <div>
          {/* Top Stats Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: theme.spacing.lg,
            marginBottom: theme.spacing.xl
          }}>
            <MetricCard
              label="Open Price"
              value={`$${analysis.intraday.openPrice?.toFixed(2) || 'N/A'}`}
            />
            <MetricCard
              label="Current Price"
              value={`$${analysis.intraday.currentPrice?.toFixed(2) || 'N/A'}`}
              subtext={`${analysis.intraday.analysis?.priceChange || '0'}% change`}
              variant="info"
            />
            <MetricCard
              label="High of Day"
              value={`$${analysis.intraday.highOfDay?.toFixed(2) || 'N/A'}`}
              variant="success"
            />
            <MetricCard
              label="Low of Day"
              value={`$${analysis.intraday.lowOfDay?.toFixed(2) || 'N/A'}`}
              variant="error"
            />
            <MetricCard
              label="Volume"
              value={analysis.intraday.volume?.toLocaleString() || 'N/A'}
              variant="info"
            />
          </div>

          {/* Main Content Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: theme.spacing.lg,
            marginBottom: theme.spacing.lg
          }}>
            {/* Left Column: Chart & Pattern */}
            <div>
              {/* Candlestick Chart */}
              <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
                <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
                  5-Minute Candles ({analysis.intraday.candles?.length || 0} bars)
                </h3>
                <CandlestickChart candles={analysis.intraday.candles || []} />
              </Card>

              {/* Pattern Analysis */}
              <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
                <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
                  Intraday Pattern
                </h3>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.lg
                }}>
                  <div style={{
                    fontSize: '48px',
                    color: getPatternColor(analysis.intraday.analysis?.pattern)
                  }}>
                    {getPatternEmoji(analysis.intraday.analysis?.pattern)}
                  </div>
                  <div>
                    <div style={{ fontSize: theme.typography.fontSize.xl, fontWeight: theme.typography.fontWeight.bold, marginBottom: theme.spacing.xs }}>
                      {analysis.intraday.analysis?.pattern || 'Unknown'}
                    </div>
                    <div style={{ color: theme.colors.textMuted, fontSize: theme.typography.fontSize.base }}>
                      Strength: {analysis.intraday.analysis?.strength || 0}/100
                    </div>
                    <div style={{ marginTop: theme.spacing.sm }}>
                      <div style={{
                        width: '100%',
                        height: '8px',
                        backgroundColor: theme.colors.backgroundMuted,
                        borderRadius: theme.borderRadius.small,
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${analysis.intraday.analysis?.strength || 0}%`,
                          height: '100%',
                          backgroundColor: getPatternColor(analysis.intraday.analysis?.pattern),
                          transition: 'width 0.3s'
                        }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Swing Analysis */}
              {analysis.intraday.swingAnalysis && (
                <Card padding="medium">
                  <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
                    Intraday Swing Analysis
                  </h3>

                  {/* Price Timeline */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: theme.spacing.sm,
                    marginBottom: theme.spacing.lg
                  }}>
                    <div style={{ padding: theme.spacing.sm, backgroundColor: theme.colors.infoLight, borderRadius: theme.borderRadius.md, textAlign: 'center' }}>
                      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.infoDark, fontWeight: '600', marginBottom: theme.spacing.xxs }}>OPEN</div>
                      <div style={{ fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.infoDark }}>
                        ${analysis.intraday.swingAnalysis.openPrice}
                      </div>
                    </div>
                    <div style={{ padding: theme.spacing.sm, backgroundColor: '#f3e5f5', borderRadius: theme.borderRadius.md, textAlign: 'center' }}>
                      <div style={{ fontSize: theme.typography.fontSize.sm, color: '#7b1fa2', fontWeight: '600', marginBottom: theme.spacing.xxs }}>+30 MIN</div>
                      <div style={{ fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.medium, color: '#6a1b9a' }}>
                        ${analysis.intraday.swingAnalysis.price30min}
                      </div>
                      <div style={{ fontSize: theme.typography.fontSize.sm, color: '#6a1b9a', marginTop: '2px' }}>
                        {analysis.intraday.swingAnalysis.change30min ? `${analysis.intraday.swingAnalysis.change30min > 0 ? '+' : ''}${analysis.intraday.swingAnalysis.change30min}%` : 'N/A'}
                      </div>
                    </div>
                    <div style={{ padding: theme.spacing.sm, backgroundColor: theme.colors.warningLight, borderRadius: theme.borderRadius.md, textAlign: 'center' }}>
                      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.warningDark, fontWeight: '600', marginBottom: theme.spacing.xxs }}>+3 HR</div>
                      <div style={{ fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.warningDark }}>
                        ${analysis.intraday.swingAnalysis.price3hr}
                      </div>
                      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.warningDark, marginTop: '2px' }}>
                        {analysis.intraday.swingAnalysis.change3hr ? `${analysis.intraday.swingAnalysis.change3hr > 0 ? '+' : ''}${analysis.intraday.swingAnalysis.change3hr}%` : 'N/A'}
                      </div>
                    </div>
                    <div style={{ padding: theme.spacing.sm, backgroundColor: theme.colors.successLight, borderRadius: theme.borderRadius.md, textAlign: 'center' }}>
                      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.successDark, fontWeight: '600', marginBottom: theme.spacing.xxs }}>CLOSE</div>
                      <div style={{ fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.successDark }}>
                        ${analysis.intraday.swingAnalysis.closePrice}
                      </div>
                      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.successDark, marginTop: '2px' }}>
                        {analysis.intraday.swingAnalysis.changeClose ? `${analysis.intraday.swingAnalysis.changeClose > 0 ? '+' : ''}${analysis.intraday.swingAnalysis.changeClose}%` : 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* Opening Behavior */}
                  <div style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                    backgroundColor: theme.colors.backgroundMuted,
                    borderRadius: theme.borderRadius.md,
                    marginBottom: theme.spacing.sm,
                    borderLeft: `4px solid ${theme.colors.primary}`
                  }}>
                    <div style={{ fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xxs }}>
                      Opening Behavior
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.base, color: theme.colors.textMuted }}>
                      {analysis.intraday.swingAnalysis.openingBehavior}
                    </div>
                  </div>

                  {/* Swing Pattern */}
                  <div style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                    backgroundColor: theme.colors.backgroundMuted,
                    borderRadius: theme.borderRadius.md,
                    marginBottom: theme.spacing.sm,
                    borderLeft: `4px solid ${theme.colors.warning}`
                  }}>
                    <div style={{ fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xxs }}>
                      Swing Pattern
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.base, color: theme.colors.textMuted }}>
                      {analysis.intraday.swingAnalysis.swingPattern}
                    </div>
                  </div>

                  {/* Trend Magnitude */}
                  <div style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                    backgroundColor: theme.colors.backgroundMuted,
                    borderRadius: theme.borderRadius.md,
                    borderLeft: `4px solid ${theme.colors.success}`
                  }}>
                    <div style={{ fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.xxs }}>
                      Trend Magnitude
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.successDark }}>
                      {analysis.intraday.swingAnalysis.trendMagnitude}%
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Right Column: Market Sentiment & Recommendation */}
            <div>
              {/* Market Sentiment */}
              <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
                <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
                  Market Sentiment
                </h3>
                <div style={{
                  textAlign: 'center',
                  padding: `${theme.spacing.lg} 0`
                }}>
                  <div style={{
                    fontSize: '48px',
                    marginBottom: theme.spacing.sm
                  }}>
                    {getSentimentEmoji(analysis.marketSentiment?.sentiment)}
                  </div>
                  <div style={{
                    fontSize: theme.typography.fontSize.xl, fontWeight: theme.typography.fontWeight.bold,
                    color: getSentimentColor(analysis.marketSentiment?.sentiment),
                    marginBottom: theme.spacing.xs
                  }}>
                    {analysis.marketSentiment?.sentiment || 'Unknown'}
                  </div>
                  <div style={{ fontSize: theme.typography.fontSize.base, color: theme.colors.textMuted, marginBottom: theme.spacing.md }}>
                    {analysis.marketSentiment?.confidence || 0}% confidence
                  </div>
                  <div style={{
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.text,
                    lineHeight: '1.5',
                    padding: theme.spacing.sm,
                    backgroundColor: theme.colors.backgroundMuted,
                    borderRadius: theme.borderRadius.md
                  }}>
                    {analysis.marketSentiment?.description || 'No market data available'}
                  </div>
                </div>
              </Card>

              {/* Recommendation */}
              <Card
                variant={
                  analysis.recommendations?.action?.includes('BUY') ? 'success' :
                  analysis.recommendations?.action?.includes('SELL') ? 'error' : 'warning'
                }
                padding="medium"
              >
                <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
                  Trading Recommendation
                </h3>
                <div style={{ textAlign: 'center', padding: `${theme.spacing.sm} 0` }}>
                  <div style={{
                    fontSize: '32px',
                    fontWeight: '700',
                    color: getRecommendationColor(analysis.recommendations?.action),
                    marginBottom: theme.spacing.sm
                  }}>
                    {analysis.recommendations?.action || 'WAIT'}
                  </div>
                  <div style={{ fontSize: theme.typography.fontSize.base, color: theme.colors.text, marginBottom: theme.spacing.lg }}>
                    Confidence: {analysis.recommendations?.confidence || 0}%
                  </div>
                  <div style={{
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.text,
                    lineHeight: '1.6',
                    marginBottom: theme.spacing.lg,
                    fontStyle: 'italic'
                  }}>
                    "{analysis.recommendations?.reason || 'No recommendation available'}"
                  </div>

                  {analysis.recommendations?.entryPrice && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: theme.spacing.sm,
                      fontSize: theme.typography.fontSize.sm
                    }}>
                      <div>
                        <div style={{ color: theme.colors.textMuted, marginBottom: theme.spacing.xs }}>Entry</div>
                        <div style={{ fontWeight: '600', fontSize: theme.typography.fontSize.md }}>
                          ${analysis.recommendations.entryPrice}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: theme.colors.textMuted, marginBottom: theme.spacing.xs }}>Target</div>
                        <div style={{ fontWeight: '600', fontSize: theme.typography.fontSize.md, color: theme.colors.success }}>
                          ${analysis.recommendations.exitPrice}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: theme.colors.textMuted, marginBottom: theme.spacing.xs }}>Stop Loss</div>
                        <div style={{ fontWeight: '600', fontSize: theme.typography.fontSize.md, color: theme.colors.error }}>
                          ${analysis.recommendations.stopLoss}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>

          {/* Technical Indicators */}
          {analysis.technicals && (
            <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
              <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
                Technical Indicators
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: theme.spacing.md
              }}>
                <TechnicalIndicator label="RSI (14)" value={analysis.technicals.rsi?.toFixed(2)} />
                <TechnicalIndicator label="SMA 20" value={`$${analysis.technicals.sma20?.toFixed(2) || 'N/A'}`} />
                <TechnicalIndicator label="SMA 50" value={`$${analysis.technicals.sma50?.toFixed(2) || 'N/A'}`} />
                <TechnicalIndicator label="SMA 200" value={`$${analysis.technicals.sma200?.toFixed(2) || 'N/A'}`} />
                <TechnicalIndicator label="Volatility" value={`${analysis.technicals.volatility?.toFixed(2) || 'N/A'}%`} />
              </div>
            </Card>
          )}

          {/* Stock Fundamentals from /api/stock/analysis */}
          {stockDetails && (
            <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
              <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
                Stock Fundamentals & Longer-Term Trend
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: theme.spacing.md
              }}>
                {stockDetails.currentPrice && (
                  <TechnicalIndicator label="Current Price" value={`$${parseFloat(stockDetails.currentPrice).toFixed(2)}`} />
                )}
                {stockDetails.technicals?.rsiSignal && (
                  <TechnicalIndicator label="RSI Signal" value={stockDetails.technicals.rsiSignal} />
                )}
                {stockDetails.technicals?.trendSignal && (
                  <TechnicalIndicator label="Trend Signal" value={stockDetails.technicals.trendSignal} />
                )}
                {stockDetails.technicals?.priceChange1D && (
                  <TechnicalIndicator label="1D Change" value={`${stockDetails.technicals.priceChange1D}%`} />
                )}
                {stockDetails.technicals?.priceChange1W && (
                  <TechnicalIndicator label="1W Change" value={`${stockDetails.technicals.priceChange1W}%`} />
                )}
                {stockDetails.technicals?.priceChange1M && (
                  <TechnicalIndicator label="1M Change" value={`${stockDetails.technicals.priceChange1M}%`} />
                )}
                {stockDetails.technicals?.distanceFromHigh && (
                  <TechnicalIndicator label="From 52W High" value={`${stockDetails.technicals.distanceFromHigh}%`} />
                )}
                {stockDetails.recommendation && (
                  <MetricCard
                    label="Longer-Term Rating"
                    value={stockDetails.recommendation}
                    variant={
                      stockDetails.recommendation === 'Strong Buy' || stockDetails.recommendation === 'Buy' ? 'success' :
                      stockDetails.recommendation === 'Sell' ? 'error' : 'warning'
                    }
                  />
                )}
              </div>
            </Card>
          )}

          {/* Profit Calculator */}
          {analysis.recommendations?.entryPrice && (
            <ProfitCalculator
              entryPrice={parseFloat(analysis.recommendations.entryPrice)}
              exitPrice={parseFloat(analysis.recommendations.exitPrice)}
              stopLoss={parseFloat(analysis.recommendations.stopLoss)}
              symbol={symbol}
            />
          )}

          {/* Market Correlation Analysis */}
          {analysis.marketSentiment && analysis.intraday.candles && analysis.intraday.candles.length > 0 && (
            <IntradayCorrelationChart
              stockSymbol={symbol}
              stockCandles={analysis.intraday.candles}
              marketSentiment={analysis.marketSentiment}
            />
          )}

          {/* Similar Patterns */}
          {analysis.similarPatterns && analysis.similarPatterns.length > 0 && (
            <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
              <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
                Similar Historical Patterns
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: theme.spacing.md
              }}>
                {analysis.similarPatterns.map((pattern, idx) => (
                  <div key={idx} style={{
                    padding: theme.spacing.md,
                    backgroundColor: theme.colors.backgroundMuted,
                    borderRadius: theme.borderRadius.md,
                    border: `1px solid ${theme.colors.gray400}`
                  }}>
                    <div style={{ fontWeight: '600', marginBottom: theme.spacing.xs }}>
                      {pattern.date}
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.textMuted, marginBottom: theme.spacing.xs }}>
                      Pattern: {pattern.pattern}
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.sm }}>
                      <span style={{ color: theme.colors.textMuted }}>Day Change: </span>
                      <span style={{
                        fontWeight: '600',
                        color: pattern.dayChange >= 0 ? theme.colors.success : theme.colors.error
                      }}>
                        {pattern.dayChange > 0 ? '+' : ''}{pattern.dayChange}%
                      </span>
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.textMuted, marginTop: theme.spacing.xs }}>
                      Similarity: {pattern.similarity}%
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Strategy Optimization Section */}
          <Card variant="info" padding="medium" style={{ marginBottom: theme.spacing.lg }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
              <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: 0 }}>
                🎯 Strategy Optimization & Backtesting
              </h3>
              <Button
                onClick={() => setShowStrategyOptimizer(!showStrategyOptimizer)}
                variant="primary"
                size="small"
              >
                {showStrategyOptimizer ? 'Hide' : 'Show'} Optimizer
              </Button>
            </div>

            {showStrategyOptimizer && (
              <div>
                {/* Configuration Form */}
                <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
                  <h4 style={{ fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.medium, margin: `0 0 ${theme.spacing.md} 0` }}>
                    Backtest Date Range
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: theme.spacing.md, alignItems: 'end' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: '600', fontSize: theme.typography.fontSize.base }}>
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: theme.spacing.sm,
                          fontSize: theme.typography.fontSize.base,
                          border: `1px solid ${theme.colors.gray400}`,
                          borderRadius: theme.borderRadius.md
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: '600', fontSize: theme.typography.fontSize.base }}>
                        End Date
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: theme.spacing.sm,
                          fontSize: theme.typography.fontSize.base,
                          border: `1px solid ${theme.colors.gray400}`,
                          borderRadius: theme.borderRadius.md
                        }}
                      />
                    </div>
                    <Button
                      onClick={optimizeStrategy}
                      disabled={strategyLoading}
                      variant="success"
                    >
                      {strategyLoading ? 'Optimizing...' : 'Find Optimal Strategy'}
                    </Button>
                  </div>
                  <div style={{
                    marginTop: theme.spacing.md,
                    padding: theme.spacing.sm,
                    backgroundColor: theme.colors.infoLight,
                    borderRadius: theme.borderRadius.md,
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.infoDark
                  }}>
                    <strong>💡 How it works:</strong> Analyzes the first 3 hours of trading (9:30 AM - 12:30 PM ET)
                    along with SPY and VIX to determine if we should enter. If conditions are met, enters at 12:30 PM
                    and exits when hitting profit target (default 10%) or at market close. Tests various momentum thresholds
                    to find the optimal strategy for {symbol}.
                  </div>
                </Card>

                {/* Loading State */}
                {strategyLoading && (
                  <div style={{
                    textAlign: 'center',
                    padding: theme.spacing.xxl,
                    fontSize: theme.typography.fontSize.md,
                    color: theme.colors.textMuted
                  }}>
                    <div className="spinner" style={{ marginBottom: theme.spacing.md }}></div>
                    Analyzing {symbol} strategies across historical data...
                  </div>
                )}

                {/* Results */}
                {strategyResults && !strategyLoading && (
                  <div>
                    {/* Optimal Strategy Card */}
                    {strategyResults.optimalStrategy && (
                      <Card variant="success" padding="medium" style={{ marginBottom: theme.spacing.lg }}>
                        <h4 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0`, color: theme.colors.successDark }}>
                          ✅ Optimal Strategy Found
                        </h4>

                        {/* Buy Now UI */}
                        <div style={{
                          display: 'flex',
                          gap: theme.spacing.md,
                          alignItems: 'center',
                          padding: theme.spacing.md,
                          backgroundColor: theme.colors.background,
                          borderRadius: theme.borderRadius.md,
                          marginBottom: theme.spacing.lg,
                          border: `1px solid ${theme.colors.success}`
                        }}>
                          <div style={{ flex: '0 0 auto' }}>
                            <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: '600', fontSize: theme.typography.fontSize.base, color: theme.colors.successDark }}>
                              Profit Target ($)
                            </label>
                            <input
                              type="number"
                              value={profitTargetDollars}
                              onChange={(e) => setProfitTargetDollars(Number(e.target.value))}
                              min="100"
                              step="100"
                              style={{
                                width: '140px',
                                padding: theme.spacing.sm,
                                fontSize: theme.typography.fontSize.base,
                                border: `1px solid ${theme.colors.success}`,
                                borderRadius: theme.borderRadius.md
                              }}
                            />
                          </div>
                          <div style={{ flex: '0 0 auto', paddingTop: '22px' }}>
                            <Button
                              onClick={executeTrade}
                              disabled={tradeExecuting}
                              variant="success"
                            >
                              {tradeExecuting ? 'Executing...' : '🔴 Try Live Trade (Market Hours Only)'}
                            </Button>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px', marginBottom: '20px' }}>
                          <div>
                            <div style={{ fontSize: '12px', color: '#155724', marginBottom: '4px' }}>3Hr Momentum Threshold</div>
                            <div style={{ fontSize: '20px', fontWeight: '700', color: '#155724' }}>
                              {strategyResults.optimalStrategy.strategy.minMomentum3Hr}%
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '12px', color: '#155724', marginBottom: '4px' }}>Profit Target</div>
                            <div style={{ fontSize: '20px', fontWeight: '700', color: '#155724' }}>
                              {strategyResults.optimalStrategy.strategy.profitTarget}%
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '12px', color: '#155724', marginBottom: '4px' }}>Win Rate</div>
                            <div style={{ fontSize: '20px', fontWeight: '700', color: '#155724' }}>
                              {strategyResults.optimalStrategy.metrics.winRate}%
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '12px', color: '#155724', marginBottom: '4px' }}>Profit Factor</div>
                            <div style={{ fontSize: '20px', fontWeight: '700', color: '#155724' }}>
                              {strategyResults.optimalStrategy.metrics.profitFactor}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '12px', color: '#155724', marginBottom: '4px' }}>Total Trades</div>
                            <div style={{ fontSize: '20px', fontWeight: '700', color: '#155724' }}>
                              {strategyResults.optimalStrategy.metrics.totalTrades}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '12px', color: '#155724', marginBottom: '4px' }}>Avg Return/Trade</div>
                            <div style={{ fontSize: '20px', fontWeight: '700', color: '#155724' }}>
                              {strategyResults.optimalStrategy.metrics.avgReturnPerTrade}%
                            </div>
                          </div>
                        </div>

                        {/* Entry/Exit Prices */}
                        {strategyResults.optimalStrategy.metrics.avgEntryPrice !== 'N/A' && (
                          <div style={{
                            padding: '15px',
                            backgroundColor: '#ffffff',
                            borderRadius: '6px',
                            marginBottom: '15px'
                          }}>
                            <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '600', color: '#155724' }}>
                              📊 Historical Backtest Results (From Date Range Above)
                            </h5>
                            <div style={{ fontSize: '11px', color: '#6c757d', marginBottom: '10px', fontStyle: 'italic' }}>
                              These are average prices from winning trades in the backtested period. NOT live market prices.
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                              <div>
                                <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>Avg Entry Price</div>
                                <div style={{ fontSize: '18px', fontWeight: '600', color: '#155724' }}>
                                  ${strategyResults.optimalStrategy.metrics.avgEntryPrice}
                                </div>
                                <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '2px' }}>at 12:30 PM ET</div>
                              </div>
                              <div>
                                <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>Avg Exit Price</div>
                                <div style={{ fontSize: '18px', fontWeight: '600', color: '#155724' }}>
                                  ${strategyResults.optimalStrategy.metrics.avgExitPrice}
                                </div>
                                <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '2px' }}>
                                  at {strategyResults.optimalStrategy.strategy.profitTarget}% profit or close
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Market Context Info */}
                        <div style={{
                          padding: '15px',
                          backgroundColor: '#e7f3ff',
                          border: '1px solid #007bff',
                          borderRadius: '6px',
                          marginBottom: '15px'
                        }}>
                          <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '600', color: '#004085' }}>
                            🌐 Enhanced Market Context
                          </h5>
                          <div style={{ fontSize: '13px', color: '#004085', lineHeight: '1.7' }}>
                            This strategy now includes <strong>ranking list stocks</strong> as additional market indicators:<br/>
                            <ul style={{ marginTop: '8px', marginBottom: '0', paddingLeft: '20px' }}>
                              <li>Analyzes 10 stocks from the COVID_19 ranking list for broader market sentiment</li>
                              <li>Requires at least <strong>{strategyResults.optimalStrategy.strategy.minMarketBreadth || 40}% of stocks</strong> showing positive momentum</li>
                              <li>Filters out days when overall market average is declining {'>'} -1.0%</li>
                              <li>Provides more robust entry signals by correlating with market breadth</li>
                            </ul>
                          </div>
                        </div>

                        {/* Day-by-Day Trade Log */}
                        {strategyResults.optimalStrategy.dailyLogs && strategyResults.optimalStrategy.dailyLogs.length > 0 && (
                          <div style={{
                            padding: '15px',
                            backgroundColor: '#ffffff',
                            border: '2px solid #6c757d',
                            borderRadius: '6px',
                            marginBottom: '15px'
                          }}>
                            <h5 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: '700', color: '#343a40' }}>
                              📅 Day-by-Day Trade Performance
                            </h5>
                            <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '15px', fontStyle: 'italic' }}>
                              How the algorithm performed on each trading day (reverse chronological order)
                            </div>
                            <div style={{
                              maxHeight: '400px',
                              overflowY: 'auto',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '10px'
                            }}>
                              {strategyResults.optimalStrategy.dailyLogs
                                .slice()
                                .reverse()
                                .map((log, idx) => {
                                  const isWin = log.status === 'win';
                                  const isLoss = log.status === 'loss';
                                  const isMissed = log.status === 'no_signal' && log.missedOpportunity;
                                  const isNoSignal = log.status === 'no_signal' && !log.missedOpportunity;
                                  const isError = log.status === 'error' || log.status === 'no_data';

                                  let bgColor = '#f8f9fa';
                                  let borderColor = '#dee2e6';
                                  let statusIcon = '🔵';
                                  let statusText = 'No Trade';
                                  let statusColor = '#6c757d';

                                  if (isWin) {
                                    bgColor = '#d4edda';
                                    borderColor = '#28a745';
                                    statusIcon = '✅';
                                    statusText = 'WIN';
                                    statusColor = '#155724';
                                  } else if (isLoss) {
                                    bgColor = '#f8d7da';
                                    borderColor = '#dc3545';
                                    statusIcon = '❌';
                                    statusText = 'LOSS';
                                    statusColor = '#721c24';
                                  } else if (isMissed) {
                                    bgColor = '#fff3cd';
                                    borderColor = '#ffc107';
                                    statusIcon = '⚠️';
                                    statusText = 'MISSED OPPORTUNITY';
                                    statusColor = '#856404';
                                  } else if (isError) {
                                    bgColor = '#e7e7e7';
                                    borderColor = '#999999';
                                    statusIcon = '📋';
                                    statusText = log.status === 'no_data' ? 'NO DATA' : 'ERROR';
                                    statusColor = '#555555';
                                  }

                                  return (
                                    <div
                                      key={idx}
                                      style={{
                                        padding: '12px',
                                        backgroundColor: bgColor,
                                        border: `2px solid ${borderColor}`,
                                        borderRadius: '6px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '6px'
                                      }}
                                    >
                                      <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                      }}>
                                        <div style={{
                                          fontSize: '14px',
                                          fontWeight: '700',
                                          color: statusColor
                                        }}>
                                          {statusIcon} {log.date}
                                        </div>
                                        <div style={{
                                          fontSize: '12px',
                                          fontWeight: '700',
                                          color: statusColor,
                                          padding: '4px 10px',
                                          backgroundColor: 'rgba(255, 255, 255, 0.6)',
                                          borderRadius: '4px'
                                        }}>
                                          {statusText}
                                        </div>
                                      </div>

                                      {log.executed && (
                                        <div style={{ fontSize: '12px', color: statusColor, lineHeight: '1.6' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span>Entry: <strong>${log.entryPrice.toFixed(2)}</strong></span>
                                            <span>Exit: <strong>${log.exitPrice.toFixed(2)}</strong></span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span>Profit/Loss: <strong style={{ color: log.profitLoss > 0 ? '#28a745' : '#dc3545' }}>
                                              ${log.profitLoss.toFixed(2)} ({log.profitPercent > 0 ? '+' : ''}{log.profitPercent.toFixed(2)}%)
                                            </strong></span>
                                            <span>Momentum: <strong>{log.momentum}%</strong></span>
                                          </div>
                                          {log.reason && (
                                            <div style={{ marginTop: '6px', fontSize: '11px', fontStyle: 'italic', opacity: 0.8 }}>
                                              {log.reason}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {!log.executed && log.status === 'no_signal' && (
                                        <div style={{ fontSize: '12px', color: statusColor, lineHeight: '1.6' }}>
                                          <div>Reason: <strong>{log.reason}</strong></div>
                                          {log.momentum !== undefined && (
                                            <div style={{ marginTop: '4px' }}>
                                              3Hr Momentum: <strong>{log.momentum}%</strong>
                                            </div>
                                          )}
                                          {log.actualDayReturn !== undefined && (
                                            <div style={{ marginTop: '4px' }}>
                                              Actual Day Return: <strong style={{
                                                color: parseFloat(log.actualDayReturn) > 0 ? '#28a745' : '#dc3545'
                                              }}>
                                                {parseFloat(log.actualDayReturn) > 0 ? '+' : ''}{log.actualDayReturn}%
                                              </strong>
                                              {isMissed && (
                                                <span style={{ marginLeft: '8px', fontWeight: '700', color: '#856404' }}>
                                                  (Big move missed!)
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {(isError || log.status === 'no_data') && (
                                        <div style={{ fontSize: '12px', color: statusColor }}>
                                          {log.reason || 'No data available'}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        )}

                        {/* Market Orders Template */}
                        {strategyResults.optimalStrategy.metrics.avgEntryPrice !== 'N/A' && (
                          <div style={{
                            padding: '15px',
                            backgroundColor: '#fff3cd',
                            border: '1px solid #ffc107',
                            borderRadius: '6px'
                          }}>
                            <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: '600', color: '#856404' }}>
                              🤖 Automated Order Template (for future API integration)
                            </h5>
                            <div style={{ fontSize: '12px', fontFamily: 'monospace', color: '#856404' }}>
                              <div style={{ marginBottom: '8px' }}>
                                <strong>1. Entry Order (at 12:30 PM ET if conditions met):</strong>
                              </div>
                              <div style={{ backgroundColor: '#ffffff', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                                Type: <strong>MARKET BUY</strong><br/>
                                Symbol: {symbol}<br/>
                                Time: 12:30 PM ET<br/>
                                <strong>Conditions (all must be met):</strong><br/>
                                • Stock momentum: +{strategyResults.optimalStrategy.strategy.minMomentum3Hr}% in first 3hrs<br/>
                                • SPY: {'>'} -0.5% in first 3hrs<br/>
                                • VIX: {'<'} +5% in first 3hrs<br/>
                                • Market Breadth: {'>'}= {strategyResults.optimalStrategy.strategy.minMarketBreadth || 40}% of ranking stocks positive<br/>
                                • Overall Market: Avg ranking stocks {'>'} -1.0%
                              </div>

                              <div style={{ marginBottom: '8px' }}>
                                <strong>2. Exit Order (profit target):</strong>
                              </div>
                              <div style={{ backgroundColor: '#ffffff', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>
                                Type: <strong>LIMIT SELL</strong><br/>
                                Symbol: {symbol}<br/>
                                Limit Price: Entry Price × {(1 + strategyResults.optimalStrategy.strategy.profitTarget / 100).toFixed(3)}<br/>
                                Time in Force: DAY<br/>
                                Example: If entry = ${strategyResults.optimalStrategy.metrics.avgEntryPrice},
                                limit = ${(parseFloat(strategyResults.optimalStrategy.metrics.avgEntryPrice) * (1 + strategyResults.optimalStrategy.strategy.profitTarget / 100)).toFixed(2)}
                              </div>

                              <div style={{ marginBottom: '8px' }}>
                                <strong>3. Backup Exit Order (market close):</strong>
                              </div>
                              <div style={{ backgroundColor: '#ffffff', padding: '8px', borderRadius: '4px' }}>
                                Type: <strong>MARKET ON CLOSE (MOC)</strong><br/>
                                Symbol: {symbol}<br/>
                                Time: 3:50 PM ET (10 min before close)<br/>
                                Condition: If limit sell not filled
                              </div>
                            </div>
                          </div>
                        )}
                      </Card>
                    )}

                    {/* All Results Table */}
                    <div style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #dee2e6',
                      borderRadius: '8px',
                      overflow: 'hidden'
                    }}>
                      <h4 style={{ margin: 0, padding: '15px 20px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #dee2e6', fontSize: '16px' }}>
                        All Strategy Results (Ranked)
                      </h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f8f9fa' }}>
                              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>Rank</th>
                              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>3Hr Momentum</th>
                              <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #dee2e6' }}>Profit Target</th>
                              <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>Win Rate</th>
                              <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>Total Trades</th>
                              <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>Profit Factor</th>
                              <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>Avg Return</th>
                            </tr>
                          </thead>
                          <tbody>
                            {strategyResults.allResults.map((result, idx) => (
                              <tr key={idx} style={{
                                backgroundColor: idx === 0 ? '#d4edda' : (idx % 2 === 0 ? '#ffffff' : '#f8f9fa')
                              }}>
                                <td style={{ padding: '12px', borderBottom: '1px solid #dee2e6', fontWeight: idx === 0 ? '700' : '400' }}>
                                  {idx + 1}
                                </td>
                                <td style={{ padding: '12px', borderBottom: '1px solid #dee2e6' }}>
                                  {result.strategy.minMomentum3Hr}%
                                </td>
                                <td style={{ padding: '12px', borderBottom: '1px solid #dee2e6' }}>
                                  {result.strategy.profitTarget}%
                                </td>
                                <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>
                                  {result.metrics.winRate}%
                                </td>
                                <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>
                                  {result.metrics.totalTrades}
                                </td>
                                <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #dee2e6' }}>
                                  {result.metrics.profitFactor}
                                </td>
                                <td style={{
                                  padding: '12px',
                                  textAlign: 'right',
                                  borderBottom: '1px solid #dee2e6',
                                  color: parseFloat(result.metrics.avgReturnPerTrade) >= 0 ? '#28a745' : '#dc3545',
                                  fontWeight: '600'
                                }}>
                                  {result.metrics.avgReturnPerTrade}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Loading Spinner CSS */}
      <style>{`
        .spinner {
          width: 40px;
          height: 40px;
          margin: 0 auto;
          border: 4px solid #f3f3f3;
          border-top: 4px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

// Helper Components
const ProfitCalculator = ({ entryPrice, exitPrice, stopLoss, symbol }) => {
  const [shares, setShares] = useState(1000);

  const calculateProfit = () => {
    const profitPerShare = exitPrice - entryPrice;
    const totalProfit = profitPerShare * shares;
    const profitPercent = ((profitPerShare / entryPrice) * 100).toFixed(2);
    const totalInvestment = entryPrice * shares;

    return { totalProfit, profitPercent, totalInvestment };
  };

  const calculateLoss = () => {
    const lossPerShare = entryPrice - stopLoss;
    const totalLoss = lossPerShare * shares;
    const lossPercent = ((lossPerShare / entryPrice) * 100).toFixed(2);

    return { totalLoss, lossPercent };
  };

  const { totalProfit, profitPercent, totalInvestment } = calculateProfit();
  const { totalLoss, lossPercent } = calculateLoss();
  const riskRewardRatio = (Math.abs(totalProfit) / Math.abs(totalLoss)).toFixed(2);

  return (
    <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
      <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.md} 0` }}>
        Profit Calculator
      </h3>

      <div style={{ marginBottom: theme.spacing.lg }}>
        <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: '600', fontSize: theme.typography.fontSize.base }}>
          Number of Shares
        </label>
        <input
          type="number"
          value={shares}
          onChange={(e) => setShares(Number(e.target.value))}
          min="1"
          step="100"
          style={{
            width: '200px',
            padding: theme.spacing.sm,
            fontSize: theme.typography.fontSize.base,
            border: `1px solid ${theme.colors.gray400}`,
            borderRadius: theme.borderRadius.md
          }}
        />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: theme.spacing.md,
        marginBottom: theme.spacing.lg
      }}>
        <MetricCard
          label="Total Investment"
          value={`$${totalInvestment.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
        />

        <MetricCard
          label="Expected Profit (if target hit)"
          value={`$${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
          subtext={`+${profitPercent}% gain`}
          variant="success"
        />

        <MetricCard
          label="Max Loss (if stop-loss hit)"
          value={`-$${totalLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
          subtext={`-${lossPercent}% loss`}
          variant="error"
        />

        <MetricCard
          label="Risk/Reward Ratio"
          value={`1:${riskRewardRatio}`}
          subtext={riskRewardRatio >= 2 ? 'Good R:R' : riskRewardRatio >= 1.5 ? 'Fair R:R' : 'Low R:R'}
          variant="warning"
        />
      </div>

      <div style={{
        padding: theme.spacing.md,
        backgroundColor: theme.colors.infoLight,
        borderRadius: theme.borderRadius.md,
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.infoDark,
        lineHeight: '1.6'
      }}>
        <strong>Example Trade:</strong> Buy {shares.toLocaleString()} shares of {symbol} at ${entryPrice.toFixed(2)},
        sell at ${exitPrice.toFixed(2)} (target) or ${stopLoss.toFixed(2)} (stop-loss).
        Expected profit if target is hit: <strong style={{ color: theme.colors.success }}>${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (+{profitPercent}%)</strong>.
      </div>
    </Card>
  );
};

const TechnicalIndicator = ({ label, value }) => (
  <div style={{
    padding: theme.spacing.md,
    backgroundColor: theme.colors.backgroundMuted,
    borderRadius: theme.borderRadius.md,
    textAlign: 'center'
  }}>
    <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.textMuted, marginBottom: theme.spacing.xs }}>
      {label}
    </div>
    <div style={{ fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.medium, fontWeight: '600' }}>
      {value || 'N/A'}
    </div>
  </div>
);

// Helper Functions
function getPatternEmoji(pattern) {
  switch (pattern) {
    case 'Uptrend': return '📈';
    case 'Downtrend': return '📉';
    case 'Ranging': return '↔️';
    default: return '❓';
  }
}

function getPatternColor(pattern) {
  switch (pattern) {
    case 'Uptrend': return theme.colors.success;
    case 'Downtrend': return theme.colors.error;
    case 'Ranging': return theme.colors.warning;
    default: return theme.colors.textMuted;
  }
}

function getSentimentEmoji(sentiment) {
  switch (sentiment) {
    case 'Bullish': return '🐂';
    case 'Bearish': return '🐻';
    case 'Neutral': return '⚖️';
    default: return '❓';
  }
}

function getSentimentColor(sentiment) {
  switch (sentiment) {
    case 'Bullish': return theme.colors.success;
    case 'Bearish': return theme.colors.error;
    case 'Neutral': return theme.colors.warning;
    default: return theme.colors.textMuted;
  }
}

function getRecommendationColor(action) {
  if (action?.includes('BUY')) return theme.colors.success;
  if (action?.includes('SELL')) return theme.colors.error;
  return theme.colors.warning;
}

function getRecommendationBg(action) {
  if (action?.includes('BUY')) return theme.colors.successLight;
  if (action?.includes('SELL')) return theme.colors.error.light;
  return theme.colors.warningLight;
}

// Candlestick Chart Component
const CandlestickChart = ({ candles }) => {
  const [hoveredCandle, setHoveredCandle] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  if (!candles || candles.length === 0) {
    return (
      <div style={{
        height: '400px',
        backgroundColor: theme.colors.backgroundMuted,
        borderRadius: theme.borderRadius.md,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.colors.textMuted
      }}>
        No candle data available
      </div>
    );
  }

  // Chart dimensions
  const chartWidth = 900;
  const chartHeight = 400;
  const padding = { top: 20, right: 60, bottom: 60, left: 60 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Calculate price range
  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  const pricePadding = priceRange * 0.1; // 10% padding

  // Scale price to Y coordinate
  const scaleY = (price) => {
    const normalized = (price - (minPrice - pricePadding)) / (priceRange + 2 * pricePadding);
    return padding.top + (1 - normalized) * plotHeight;
  };

  // Calculate candle width
  const candleWidth = Math.max(2, plotWidth / candles.length * 0.7);
  const candleSpacing = plotWidth / candles.length;

  // Format time label (PST timezone)
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Los_Angeles'
    });
  };

  const handleMouseMove = (event, candle, index) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMousePosition({ x: event.clientX, y: event.clientY });
    setHoveredCandle({ ...candle, index });
  };

  const handleMouseLeave = () => {
    setHoveredCandle(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg width={chartWidth} height={chartHeight} style={{ cursor: 'crosshair' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + ratio * plotHeight;
          const price = (minPrice - pricePadding) + (1 - ratio) * (priceRange + 2 * pricePadding);
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                y1={y}
                x2={chartWidth - padding.right}
                y2={y}
                stroke="#e9ecef"
                strokeWidth="1"
              />
              <text
                x={chartWidth - padding.right + 5}
                y={y + 4}
                fontSize="11"
                fill="#6c757d"
              >
                ${price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Candlesticks */}
        {candles.map((candle, index) => {
          const x = padding.left + index * candleSpacing + candleSpacing / 2;
          const isGreen = candle.close >= candle.open;
          const color = isGreen ? theme.colors.success : theme.colors.error;
          const bodyTop = scaleY(Math.max(candle.open, candle.close));
          const bodyBottom = scaleY(Math.min(candle.open, candle.close));
          const bodyHeight = Math.max(1, bodyBottom - bodyTop);

          return (
            <g
              key={index}
              onMouseMove={(e) => handleMouseMove(e, candle, index)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: 'pointer' }}
            >
              {/* Wick */}
              <line
                x1={x}
                y1={scaleY(candle.high)}
                x2={x}
                y2={scaleY(candle.low)}
                stroke={color}
                strokeWidth="1.5"
              />
              {/* Body */}
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={color}
                stroke={color}
                strokeWidth="1"
                opacity={hoveredCandle?.index === index ? 1 : 0.85}
              />
            </g>
          );
        })}

        {/* X-axis labels (time) */}
        {[0, Math.floor(candles.length / 4), Math.floor(candles.length / 2), Math.floor(candles.length * 3 / 4), candles.length - 1].map((index) => {
          if (index >= candles.length) return null;
          const x = padding.left + index * candleSpacing + candleSpacing / 2;
          return (
            <text
              key={index}
              x={x}
              y={chartHeight - padding.bottom + 20}
              textAnchor="middle"
              fontSize="11"
              fill="#6c757d"
            >
              {formatTime(candles[index].timestamp)}
            </text>
          );
        })}

        {/* Axis labels */}
        <text
          x={chartWidth / 2}
          y={chartHeight - 10}
          textAnchor="middle"
          fontSize="12"
          fill="#495057"
          fontWeight="600"
        >
          Time (PST)
        </text>
        <text
          x={20}
          y={chartHeight / 2}
          textAnchor="middle"
          fontSize="12"
          fill="#495057"
          fontWeight="600"
          transform={`rotate(-90, 20, ${chartHeight / 2})`}
        >
          Price ($)
        </text>
      </svg>

      {/* Hover tooltip */}
      {hoveredCandle && (
        <div
          style={{
            position: 'fixed',
            left: mousePosition.x + 10,
            top: mousePosition.y + 10,
            backgroundColor: 'rgba(44, 62, 80, 0.95)',
            color: 'white',
            padding: '12px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ fontWeight: '600', marginBottom: '6px', color: '#e9ecef' }}>
            {formatTime(hoveredCandle.timestamp)}
          </div>
          <div>O: ${hoveredCandle.open.toFixed(2)}</div>
          <div>H: <span style={{ color: '#28a745' }}>${hoveredCandle.high.toFixed(2)}</span></div>
          <div>L: <span style={{ color: '#dc3545' }}>${hoveredCandle.low.toFixed(2)}</span></div>
          <div>C: ${hoveredCandle.close.toFixed(2)}</div>
          <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #495057' }}>
            Vol: {hoveredCandle.volume?.toLocaleString() || 'N/A'}
          </div>
        </div>
      )}
    </div>
  );
};

// Intraday Correlation Chart Component
const IntradayCorrelationChart = ({ stockSymbol, stockCandles, marketSentiment }) => {
  // Prepare data for overlay chart
  const metricsData = useMemo(() => {
    if (!stockCandles || stockCandles.length === 0) return {};

    const stockPrices = stockCandles.map(c => c.close);

    // Use market sentiment data if available (SPY, VIX)
    const result = {
      [stockSymbol]: stockPrices
    };

    // If we have SPY/VIX data from marketSentiment, include it
    if (marketSentiment?.spyCandles && marketSentiment.spyCandles.length === stockCandles.length) {
      result.SPY = marketSentiment.spyCandles.map(c => c.close);
    }

    if (marketSentiment?.vixCandles && marketSentiment.vixCandles.length === stockCandles.length) {
      result.VIX = marketSentiment.vixCandles.map(c => c.close);
    }

    return result;
  }, [stockSymbol, stockCandles, marketSentiment]);

  const labels = useMemo(() => {
    if (!stockCandles || stockCandles.length === 0) return [];
    return stockCandles.map(c => {
      const date = new Date(c.timestamp);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Los_Angeles'
      });
    });
  }, [stockCandles]);

  const availableMetrics = useMemo(() => {
    const metrics = { [stockSymbol]: stockSymbol };
    if (metricsData.SPY) metrics.SPY = 'S&P 500';
    if (metricsData.VIX) metrics.VIX = 'VIX';
    return metrics;
  }, [stockSymbol, metricsData]);

  if (Object.keys(metricsData).length <= 1) {
    return (
      <Card variant="warning" padding="medium" style={{ marginBottom: theme.spacing.lg }}>
        <h3 style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, margin: `0 0 ${theme.spacing.sm} 0`, color: theme.colors.warningDark }}>
          Market Correlation
        </h3>
        <div style={{ fontSize: theme.typography.fontSize.base, color: theme.colors.warningDark }}>
          Market correlation data (SPY, VIX) not available for this date. Showing stock price only.
        </div>
      </Card>
    );
  }

  return (
    <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
      <MetricCorrelationChart
        metricsData={metricsData}
        labels={labels}
        availableMetrics={availableMetrics}
        title={`${stockSymbol} vs Market Correlation (Intraday)`}
      />
      <div style={{
        marginTop: theme.spacing.md,
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.infoLight,
        borderRadius: theme.borderRadius.md,
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.infoDark,
        lineHeight: '1.6'
      }}>
        <strong>💡 Tip:</strong> Strong positive correlation with SPY suggests the stock is following broader market trends.
        Strong negative correlation with VIX (fear index) is typical for most stocks during calm markets.
        Weak correlations may indicate stock-specific news or events.
      </div>
    </Card>
  );
};

export default IntradayAnalyzerPage;
