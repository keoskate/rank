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

import { useState, useEffect } from 'react';

const IntradayAnalyzerPage = () => {
  const [symbol, setSymbol] = useState('RR');
  const [date, setDate] = useState('2024-12-03');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Auto-fetch on mount
  useEffect(() => {
    fetchAnalysis();
  }, []);

  const fetchAnalysis = async () => {
    if (!symbol) return;

    setLoading(true);
    setError(null);

    try {
      const url = date
        ? `/api/intraday/${symbol}?date=${date}`
        : `/api/intraday/${symbol}`;

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch analysis');
      }

      setAnalysis(data);
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

  return (
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 10px 0' }}>📈 Intraday Trading Analyzer</h1>
        <p style={{ margin: 0, color: '#6c757d' }}>
          Day trading analysis with real-time market sentiment and entry/exit recommendations
        </p>
      </div>

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
              {/* Candlestick Chart Placeholder */}
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '8px',
                padding: '20px',
                marginBottom: '20px',
                border: '1px solid #dee2e6'
              }}>
                <h3 style={{ margin: '0 0 15px 0', fontSize: '18px' }}>
                  5-Minute Candles
                </h3>
                <div style={{
                  height: '300px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6c757d',
                  fontSize: '14px'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '48px', marginBottom: '10px' }}>📊</div>
                    <div>{analysis.intraday.candles?.length || 0} candles loaded</div>
                    <div style={{ fontSize: '12px', marginTop: '5px' }}>
                      Chart visualization coming soon
                    </div>
                  </div>
                </div>
              </div>

              {/* Pattern Analysis */}
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '8px',
                padding: '20px',
                border: '1px solid #dee2e6'
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

export default IntradayAnalyzerPage;
