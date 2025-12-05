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
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 10px 0' }}>📈 Intraday Trading Analyzer</h1>
        <p style={{ margin: 0, color: '#6c757d' }}>
          Day trading analysis with real-time market sentiment and entry/exit recommendations
        </p>
      </div>

      {/* Active Position Dashboard */}
      {currentPosition && (
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '30px',
          border: '3px solid',
          borderColor: parseFloat(currentPosition.unrealized_pl) >= 0 ? '#28a745' : '#dc3545',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
            <div>
              <h3 style={{ margin: '0 0 5px 0', fontSize: '20px', fontWeight: '700' }}>
                Active Position: {currentPosition.symbol}
              </h3>
              <div style={{ fontSize: '14px', color: '#6c757d' }}>
                {Math.abs(currentPosition.qty)} shares
              </div>
            </div>
            <div style={{
              fontSize: '32px',
              fontWeight: '700',
              color: parseFloat(currentPosition.unrealized_pl) >= 0 ? '#28a745' : '#dc3545'
            }}>
              {parseFloat(currentPosition.unrealized_pl) >= 0 ? '📈' : '📉'}
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '15px',
            marginBottom: '20px'
          }}>
            <div style={{
              padding: '12px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px'
            }}>
              <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>Entry Price</div>
              <div style={{ fontSize: '18px', fontWeight: '600' }}>
                ${parseFloat(currentPosition.avg_entry_price).toFixed(2)}
              </div>
            </div>

            <div style={{
              padding: '12px',
              backgroundColor: '#e3f2fd',
              borderRadius: '8px'
            }}>
              <div style={{ fontSize: '12px', color: '#1976d2', marginBottom: '4px' }}>Current Price</div>
              <div style={{ fontSize: '18px', fontWeight: '600', color: '#1565c0' }}>
                ${currentPrice ? parseFloat(currentPrice).toFixed(2) : parseFloat(currentPosition.current_price).toFixed(2)}
              </div>
            </div>

            <div style={{
              padding: '12px',
              backgroundColor: parseFloat(currentPosition.unrealized_pl) >= 0 ? '#d4edda' : '#f8d7da',
              borderRadius: '8px',
              border: '2px solid',
              borderColor: parseFloat(currentPosition.unrealized_pl) >= 0 ? '#28a745' : '#dc3545'
            }}>
              <div style={{
                fontSize: '12px',
                color: parseFloat(currentPosition.unrealized_pl) >= 0 ? '#155724' : '#721c24',
                marginBottom: '4px'
              }}>
                Unrealized P/L
              </div>
              <div style={{
                fontSize: '18px',
                fontWeight: '700',
                color: parseFloat(currentPosition.unrealized_pl) >= 0 ? '#28a745' : '#dc3545'
              }}>
                ${parseFloat(currentPosition.unrealized_pl).toFixed(2)}
              </div>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: parseFloat(currentPosition.unrealized_pl) >= 0 ? '#28a745' : '#dc3545',
                marginTop: '2px'
              }}>
                {parseFloat(currentPosition.unrealized_plpc).toFixed(2)}%
              </div>
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end'
          }}>
            <button
              onClick={() => closePosition(true)}
              disabled={closingPosition}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: closingPosition ? '#6c757d' : '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: closingPosition ? 'not-allowed' : 'pointer',
                opacity: closingPosition ? 0.6 : 1,
                transition: 'all 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                if (!closingPosition) {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}
            >
              {closingPosition ? 'Closing...' : '💰 Take Profits'}
            </button>

            <button
              onClick={() => closePosition(false)}
              disabled={closingPosition}
              style={{
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: closingPosition ? '#6c757d' : '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: closingPosition ? 'not-allowed' : 'pointer',
                opacity: closingPosition ? 0.6 : 1,
                transition: 'all 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                if (!closingPosition) {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
              }}
            >
              {closingPosition ? 'Closing...' : '🔴 Close Position'}
            </button>
          </div>

          <div style={{
            marginTop: '15px',
            padding: '10px',
            backgroundColor: '#e7f3ff',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#004085',
            textAlign: 'center'
          }}>
            Updates automatically every 5 seconds
          </div>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        gap: '15px',
        marginBottom: '30px',
        padding: '20px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px'
      }}>
        <div style={{ flex: '0 0 150px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '14px' }}>
            Stock Symbol
          </label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL"
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '14px',
              border: '1px solid #ced4da',
              borderRadius: '6px'
            }}
          />
        </div>

        <div style={{ flex: '0 0 200px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '14px' }}>
            Date (Optional)
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '14px',
              border: '1px solid #ced4da',
              borderRadius: '6px'
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            type="submit"
            disabled={loading || !symbol}
            style={{
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: '600',
              backgroundColor: loading || !symbol ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading || !symbol ? 'not-allowed' : 'pointer',
              opacity: loading || !symbol ? 0.6 : 1
            }}
          >
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </form>

      {/* Error State */}
      {error && (
        <div style={{
          padding: '15px',
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '6px',
          color: '#721c24',
          marginBottom: '20px'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{
          textAlign: 'center',
          padding: '60px',
          fontSize: '18px',
          color: '#6c757d'
        }}>
          <div className="spinner" style={{ marginBottom: '15px' }}></div>
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
            gap: '20px',
            marginBottom: '30px'
          }}>
            <StatCard
              title="Open Price"
              value={`$${analysis.intraday.openPrice?.toFixed(2) || 'N/A'}`}
              color="#6c757d"
            />
            <StatCard
              title="Current Price"
              value={`$${analysis.intraday.currentPrice?.toFixed(2) || 'N/A'}`}
              color="#007bff"
              subtitle={`${analysis.intraday.analysis?.priceChange || '0'}% change`}
            />
            <StatCard
              title="High of Day"
              value={`$${analysis.intraday.highOfDay?.toFixed(2) || 'N/A'}`}
              color="#28a745"
            />
            <StatCard
              title="Low of Day"
              value={`$${analysis.intraday.lowOfDay?.toFixed(2) || 'N/A'}`}
              color="#dc3545"
            />
            <StatCard
              title="Volume"
              value={analysis.intraday.volume?.toLocaleString() || 'N/A'}
              color="#17a2b8"
            />
          </div>

          {/* Main Content Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: '20px',
            marginBottom: '20px'
          }}>
            {/* Left Column: Chart & Pattern */}
            <div>
              {/* Candlestick Chart */}
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '8px',
                padding: '20px',
                marginBottom: '20px',
                border: '1px solid #dee2e6'
              }}>
                <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                  5-Minute Candles ({analysis.intraday.candles?.length || 0} bars)
                </h3>
                <CandlestickChart candles={analysis.intraday.candles || []} />
              </div>

              {/* Pattern Analysis */}
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '8px',
                padding: '20px',
                border: '1px solid #dee2e6',
                marginBottom: '20px'
              }}>
                <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                  Intraday Pattern
                </h3>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '20px'
                }}>
                  <div style={{
                    fontSize: '48px',
                    color: getPatternColor(analysis.intraday.analysis?.pattern)
                  }}>
                    {getPatternEmoji(analysis.intraday.analysis?.pattern)}
                  </div>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: '600', marginBottom: '5px' }}>
                      {analysis.intraday.analysis?.pattern || 'Unknown'}
                    </div>
                    <div style={{ color: '#6c757d', fontSize: '14px' }}>
                      Strength: {analysis.intraday.analysis?.strength || 0}/100
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{
                        width: '100%',
                        height: '8px',
                        backgroundColor: '#e9ecef',
                        borderRadius: '4px',
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
              </div>

              {/* Swing Analysis */}
              {analysis.intraday.swingAnalysis && (
                <div style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '8px',
                  padding: '20px',
                  border: '1px solid #dee2e6'
                }}>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                    Intraday Swing Analysis
                  </h3>

                  {/* Price Timeline */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '10px',
                    marginBottom: '20px'
                  }}>
                    <div style={{ padding: '12px', backgroundColor: '#e3f2fd', borderRadius: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#1976d2', fontWeight: '600', marginBottom: '4px' }}>OPEN</div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#1565c0' }}>
                        ${analysis.intraday.swingAnalysis.openPrice}
                      </div>
                    </div>
                    <div style={{ padding: '12px', backgroundColor: '#f3e5f5', borderRadius: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#7b1fa2', fontWeight: '600', marginBottom: '4px' }}>+30 MIN</div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#6a1b9a' }}>
                        ${analysis.intraday.swingAnalysis.price30min}
                      </div>
                      <div style={{ fontSize: '11px', color: '#6a1b9a', marginTop: '2px' }}>
                        {analysis.intraday.swingAnalysis.change30min ? `${analysis.intraday.swingAnalysis.change30min > 0 ? '+' : ''}${analysis.intraday.swingAnalysis.change30min}%` : 'N/A'}
                      </div>
                    </div>
                    <div style={{ padding: '12px', backgroundColor: '#fff3e0', borderRadius: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#e65100', fontWeight: '600', marginBottom: '4px' }}>+3 HR</div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#d84315' }}>
                        ${analysis.intraday.swingAnalysis.price3hr}
                      </div>
                      <div style={{ fontSize: '11px', color: '#d84315', marginTop: '2px' }}>
                        {analysis.intraday.swingAnalysis.change3hr ? `${analysis.intraday.swingAnalysis.change3hr > 0 ? '+' : ''}${analysis.intraday.swingAnalysis.change3hr}%` : 'N/A'}
                      </div>
                    </div>
                    <div style={{ padding: '12px', backgroundColor: '#e8f5e9', borderRadius: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#2e7d32', fontWeight: '600', marginBottom: '4px' }}>CLOSE</div>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#1b5e20' }}>
                        ${analysis.intraday.swingAnalysis.closePrice}
                      </div>
                      <div style={{ fontSize: '11px', color: '#1b5e20', marginTop: '2px' }}>
                        {analysis.intraday.swingAnalysis.changeClose ? `${analysis.intraday.swingAnalysis.changeClose > 0 ? '+' : ''}${analysis.intraday.swingAnalysis.changeClose}%` : 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* Opening Behavior */}
                  <div style={{
                    padding: '12px 16px',
                    backgroundColor: '#f5f5f5',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    borderLeft: '4px solid #2196f3'
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#424242', marginBottom: '4px' }}>
                      Opening Behavior
                    </div>
                    <div style={{ fontSize: '14px', color: '#616161' }}>
                      {analysis.intraday.swingAnalysis.openingBehavior}
                    </div>
                  </div>

                  {/* Swing Pattern */}
                  <div style={{
                    padding: '12px 16px',
                    backgroundColor: '#f5f5f5',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    borderLeft: '4px solid #ff9800'
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#424242', marginBottom: '4px' }}>
                      Swing Pattern
                    </div>
                    <div style={{ fontSize: '14px', color: '#616161' }}>
                      {analysis.intraday.swingAnalysis.swingPattern}
                    </div>
                  </div>

                  {/* Trend Magnitude */}
                  <div style={{
                    padding: '12px 16px',
                    backgroundColor: '#f5f5f5',
                    borderRadius: '6px',
                    borderLeft: '4px solid #4caf50'
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: '#424242', marginBottom: '4px' }}>
                      Trend Magnitude
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: '#2e7d32' }}>
                      {analysis.intraday.swingAnalysis.trendMagnitude}%
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Market Sentiment & Recommendation */}
            <div>
              {/* Market Sentiment */}
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '8px',
                padding: '20px',
                marginBottom: '20px',
                border: '1px solid #dee2e6'
              }}>
                <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                  Market Sentiment
                </h3>
                <div style={{
                  textAlign: 'center',
                  padding: '20px 0'
                }}>
                  <div style={{
                    fontSize: '48px',
                    marginBottom: '10px'
                  }}>
                    {getSentimentEmoji(analysis.marketSentiment?.sentiment)}
                  </div>
                  <div style={{
                    fontSize: '24px',
                    fontWeight: '600',
                    color: getSentimentColor(analysis.marketSentiment?.sentiment),
                    marginBottom: '5px'
                  }}>
                    {analysis.marketSentiment?.sentiment || 'Unknown'}
                  </div>
                  <div style={{ fontSize: '14px', color: '#6c757d', marginBottom: '15px' }}>
                    {analysis.marketSentiment?.confidence || 0}% confidence
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: '#495057',
                    lineHeight: '1.5',
                    padding: '10px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '6px'
                  }}>
                    {analysis.marketSentiment?.description || 'No market data available'}
                  </div>
                </div>
              </div>

              {/* Recommendation */}
              <div style={{
                backgroundColor: getRecommendationBg(analysis.recommendations?.action),
                borderRadius: '8px',
                padding: '20px',
                border: `2px solid ${getRecommendationColor(analysis.recommendations?.action)}`
              }}>
                <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                  Trading Recommendation
                </h3>
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <div style={{
                    fontSize: '32px',
                    fontWeight: '700',
                    color: getRecommendationColor(analysis.recommendations?.action),
                    marginBottom: '10px'
                  }}>
                    {analysis.recommendations?.action || 'WAIT'}
                  </div>
                  <div style={{ fontSize: '14px', color: '#495057', marginBottom: '20px' }}>
                    Confidence: {analysis.recommendations?.confidence || 0}%
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: '#495057',
                    lineHeight: '1.6',
                    marginBottom: '20px',
                    fontStyle: 'italic'
                  }}>
                    "{analysis.recommendations?.reason || 'No recommendation available'}"
                  </div>

                  {analysis.recommendations?.entryPrice && (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: '10px',
                      fontSize: '13px'
                    }}>
                      <div>
                        <div style={{ color: '#6c757d', marginBottom: '5px' }}>Entry</div>
                        <div style={{ fontWeight: '600', fontSize: '16px' }}>
                          ${analysis.recommendations.entryPrice}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#6c757d', marginBottom: '5px' }}>Target</div>
                        <div style={{ fontWeight: '600', fontSize: '16px', color: '#28a745' }}>
                          ${analysis.recommendations.exitPrice}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#6c757d', marginBottom: '5px' }}>Stop Loss</div>
                        <div style={{ fontWeight: '600', fontSize: '16px', color: '#dc3545' }}>
                          ${analysis.recommendations.stopLoss}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Technical Indicators */}
          {analysis.technicals && (
            <div style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '20px',
              marginBottom: '20px',
              border: '1px solid #dee2e6'
            }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                Technical Indicators
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '15px'
              }}>
                <TechnicalIndicator label="RSI (14)" value={analysis.technicals.rsi?.toFixed(2)} />
                <TechnicalIndicator label="SMA 20" value={`$${analysis.technicals.sma20?.toFixed(2) || 'N/A'}`} />
                <TechnicalIndicator label="SMA 50" value={`$${analysis.technicals.sma50?.toFixed(2) || 'N/A'}`} />
                <TechnicalIndicator label="SMA 200" value={`$${analysis.technicals.sma200?.toFixed(2) || 'N/A'}`} />
                <TechnicalIndicator label="Volatility" value={`${analysis.technicals.volatility?.toFixed(2) || 'N/A'}%`} />
              </div>
            </div>
          )}

          {/* Stock Fundamentals from /api/stock/analysis */}
          {stockDetails && (
            <div style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '20px',
              marginBottom: '20px',
              border: '1px solid #dee2e6'
            }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                Stock Fundamentals & Longer-Term Trend
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '15px'
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
                  <div style={{
                    padding: '15px',
                    backgroundColor: stockDetails.recommendation === 'Strong Buy' || stockDetails.recommendation === 'Buy' ? '#d4edda' :
                                    stockDetails.recommendation === 'Sell' ? '#f8d7da' : '#fff3cd',
                    borderRadius: '6px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>
                      Longer-Term Rating
                    </div>
                    <div style={{ fontSize: '16px', fontWeight: '600' }}>
                      {stockDetails.recommendation}
                    </div>
                  </div>
                )}
              </div>
            </div>
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
            <div style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '20px',
              marginBottom: '20px',
              border: '1px solid #dee2e6'
            }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                Similar Historical Patterns
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: '15px'
              }}>
                {analysis.similarPatterns.map((pattern, idx) => (
                  <div key={idx} style={{
                    padding: '15px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '6px',
                    border: '1px solid #dee2e6'
                  }}>
                    <div style={{ fontWeight: '600', marginBottom: '8px' }}>
                      {pattern.date}
                    </div>
                    <div style={{ fontSize: '13px', color: '#6c757d', marginBottom: '8px' }}>
                      Pattern: {pattern.pattern}
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      <span style={{ color: '#6c757d' }}>Day Change: </span>
                      <span style={{
                        fontWeight: '600',
                        color: pattern.dayChange >= 0 ? '#28a745' : '#dc3545'
                      }}>
                        {pattern.dayChange > 0 ? '+' : ''}{pattern.dayChange}%
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '8px' }}>
                      Similarity: {pattern.similarity}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strategy Optimization Section */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px',
            border: '2px solid #007bff'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0, fontSize: '18px' }}>
                🎯 Strategy Optimization & Backtesting
              </h3>
              <button
                onClick={() => setShowStrategyOptimizer(!showStrategyOptimizer)}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: '600',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                {showStrategyOptimizer ? 'Hide' : 'Show'} Optimizer
              </button>
            </div>

            {showStrategyOptimizer && (
              <div>
                {/* Configuration Form */}
                <div style={{
                  padding: '20px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  marginBottom: '20px'
                }}>
                  <h4 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>
                    Backtest Date Range
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', alignItems: 'end' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '14px' }}>
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          fontSize: '14px',
                          border: '1px solid #ced4da',
                          borderRadius: '6px'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '14px' }}>
                        End Date
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          fontSize: '14px',
                          border: '1px solid #ced4da',
                          borderRadius: '6px'
                        }}
                      />
                    </div>
                    <button
                      onClick={optimizeStrategy}
                      disabled={strategyLoading}
                      style={{
                        padding: '10px 24px',
                        fontSize: '14px',
                        fontWeight: '600',
                        backgroundColor: strategyLoading ? '#6c757d' : '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: strategyLoading ? 'not-allowed' : 'pointer',
                        opacity: strategyLoading ? 0.6 : 1
                      }}
                    >
                      {strategyLoading ? 'Optimizing...' : 'Find Optimal Strategy'}
                    </button>
                  </div>
                  <div style={{
                    marginTop: '15px',
                    padding: '12px',
                    backgroundColor: '#e7f3ff',
                    borderRadius: '6px',
                    fontSize: '13px',
                    color: '#004085'
                  }}>
                    <strong>💡 How it works:</strong> Analyzes the first 3 hours of trading (9:30 AM - 12:30 PM ET)
                    along with SPY and VIX to determine if we should enter. If conditions are met, enters at 12:30 PM
                    and exits when hitting profit target (default 10%) or at market close. Tests various momentum thresholds
                    to find the optimal strategy for {symbol}.
                  </div>
                </div>

                {/* Loading State */}
                {strategyLoading && (
                  <div style={{
                    textAlign: 'center',
                    padding: '40px',
                    fontSize: '16px',
                    color: '#6c757d'
                  }}>
                    <div className="spinner" style={{ marginBottom: '15px' }}></div>
                    Analyzing {symbol} strategies across historical data...
                  </div>
                )}

                {/* Results */}
                {strategyResults && !strategyLoading && (
                  <div>
                    {/* Optimal Strategy Card */}
                    {strategyResults.optimalStrategy && (
                      <div style={{
                        padding: '20px',
                        backgroundColor: '#d4edda',
                        border: '2px solid #28a745',
                        borderRadius: '8px',
                        marginBottom: '20px'
                      }}>
                        <h4 style={{ margin: '0 0 15px 0', fontSize: '18px', color: '#155724' }}>
                          ✅ Optimal Strategy Found
                        </h4>

                        {/* Buy Now UI */}
                        <div style={{
                          display: 'flex',
                          gap: '15px',
                          alignItems: 'center',
                          padding: '15px',
                          backgroundColor: '#ffffff',
                          borderRadius: '6px',
                          marginBottom: '20px',
                          border: '1px solid #28a745'
                        }}>
                          <div style={{ flex: '0 0 auto' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600', fontSize: '14px', color: '#155724' }}>
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
                                padding: '10px',
                                fontSize: '14px',
                                border: '1px solid #28a745',
                                borderRadius: '6px'
                              }}
                            />
                          </div>
                          <div style={{ flex: '0 0 auto', paddingTop: '22px' }}>
                            <button
                              onClick={executeTrade}
                              disabled={tradeExecuting}
                              style={{
                                padding: '10px 24px',
                                fontSize: '14px',
                                fontWeight: '600',
                                backgroundColor: tradeExecuting ? '#6c757d' : '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: tradeExecuting ? 'not-allowed' : 'pointer',
                                opacity: tradeExecuting ? 0.6 : 1,
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {tradeExecuting ? 'Executing...' : '🔴 Try Live Trade (Market Hours Only)'}
                            </button>
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
                      </div>
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
          </div>
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
    <div style={{
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '20px',
      border: '1px solid #dee2e6'
    }}>
      <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
        Profit Calculator
      </h3>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px' }}>
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
            padding: '10px',
            fontSize: '14px',
            border: '1px solid #ced4da',
            borderRadius: '6px'
          }}
        />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '15px',
        marginBottom: '20px'
      }}>
        <div style={{
          padding: '15px',
          backgroundColor: '#f8f9fa',
          borderRadius: '6px'
        }}>
          <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>
            Total Investment
          </div>
          <div style={{ fontSize: '20px', fontWeight: '600' }}>
            ${totalInvestment.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </div>
        </div>

        <div style={{
          padding: '15px',
          backgroundColor: '#d4edda',
          borderRadius: '6px',
          border: '1px solid #28a745'
        }}>
          <div style={{ fontSize: '12px', color: '#155724', marginBottom: '5px' }}>
            Expected Profit (if target hit)
          </div>
          <div style={{ fontSize: '20px', fontWeight: '600', color: '#28a745' }}>
            ${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </div>
          <div style={{ fontSize: '12px', color: '#155724', marginTop: '5px' }}>
            +{profitPercent}% gain
          </div>
        </div>

        <div style={{
          padding: '15px',
          backgroundColor: '#f8d7da',
          borderRadius: '6px',
          border: '1px solid #dc3545'
        }}>
          <div style={{ fontSize: '12px', color: '#721c24', marginBottom: '5px' }}>
            Max Loss (if stop-loss hit)
          </div>
          <div style={{ fontSize: '20px', fontWeight: '600', color: '#dc3545' }}>
            -${totalLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </div>
          <div style={{ fontSize: '12px', color: '#721c24', marginTop: '5px' }}>
            -{lossPercent}% loss
          </div>
        </div>

        <div style={{
          padding: '15px',
          backgroundColor: '#fff3cd',
          borderRadius: '6px',
          border: '1px solid #ffc107'
        }}>
          <div style={{ fontSize: '12px', color: '#856404', marginBottom: '5px' }}>
            Risk/Reward Ratio
          </div>
          <div style={{ fontSize: '20px', fontWeight: '600', color: '#856404' }}>
            1:{riskRewardRatio}
          </div>
          <div style={{ fontSize: '12px', color: '#856404', marginTop: '5px' }}>
            {riskRewardRatio >= 2 ? 'Good R:R' : riskRewardRatio >= 1.5 ? 'Fair R:R' : 'Low R:R'}
          </div>
        </div>
      </div>

      <div style={{
        padding: '15px',
        backgroundColor: '#e7f3ff',
        borderRadius: '6px',
        fontSize: '13px',
        color: '#004085',
        lineHeight: '1.6'
      }}>
        <strong>Example Trade:</strong> Buy {shares.toLocaleString()} shares of {symbol} at ${entryPrice.toFixed(2)},
        sell at ${exitPrice.toFixed(2)} (target) or ${stopLoss.toFixed(2)} (stop-loss).
        Expected profit if target is hit: <strong style={{ color: '#28a745' }}>${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (+{profitPercent}%)</strong>.
      </div>
    </div>
  );
};

const StatCard = ({ title, value, color, subtitle }) => (
  <div style={{
    backgroundColor: '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #dee2e6'
  }}>
    <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {title}
    </div>
    <div style={{ fontSize: '24px', fontWeight: '700', color: color, marginBottom: '5px' }}>
      {value}
    </div>
    {subtitle && (
      <div style={{ fontSize: '12px', color: '#6c757d' }}>
        {subtitle}
      </div>
    )}
  </div>
);

const TechnicalIndicator = ({ label, value }) => (
  <div style={{
    padding: '15px',
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
    textAlign: 'center'
  }}>
    <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>
      {label}
    </div>
    <div style={{ fontSize: '18px', fontWeight: '600' }}>
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
    case 'Uptrend': return '#28a745';
    case 'Downtrend': return '#dc3545';
    case 'Ranging': return '#ffc107';
    default: return '#6c757d';
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
    case 'Bullish': return '#28a745';
    case 'Bearish': return '#dc3545';
    case 'Neutral': return '#ffc107';
    default: return '#6c757d';
  }
}

function getRecommendationColor(action) {
  if (action?.includes('BUY')) return '#28a745';
  if (action?.includes('SELL')) return '#dc3545';
  return '#ffc107';
}

function getRecommendationBg(action) {
  if (action?.includes('BUY')) return '#d4edda';
  if (action?.includes('SELL')) return '#f8d7da';
  return '#fff3cd';
}

// Candlestick Chart Component
const CandlestickChart = ({ candles }) => {
  const [hoveredCandle, setHoveredCandle] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  if (!candles || candles.length === 0) {
    return (
      <div style={{
        height: '400px',
        backgroundColor: '#f8f9fa',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#6c757d'
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
          const color = isGreen ? '#28a745' : '#dc3545';
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
      <div style={{
        backgroundColor: '#fff3cd',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #ffc107'
      }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#856404' }}>
          Market Correlation
        </h3>
        <div style={{ fontSize: '14px', color: '#856404' }}>
          Market correlation data (SPY, VIX) not available for this date. Showing stock price only.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '20px',
      border: '1px solid #dee2e6'
    }}>
      <MetricCorrelationChart
        metricsData={metricsData}
        labels={labels}
        availableMetrics={availableMetrics}
        title={`${stockSymbol} vs Market Correlation (Intraday)`}
      />
      <div style={{
        marginTop: '15px',
        padding: '12px',
        backgroundColor: '#e7f3ff',
        borderRadius: '6px',
        fontSize: '13px',
        color: '#004085',
        lineHeight: '1.6'
      }}>
        <strong>💡 Tip:</strong> Strong positive correlation with SPY suggests the stock is following broader market trends.
        Strong negative correlation with VIX (fear index) is typical for most stocks during calm markets.
        Weak correlations may indicate stock-specific news or events.
      </div>
    </div>
  );
};

export default IntradayAnalyzerPage;
