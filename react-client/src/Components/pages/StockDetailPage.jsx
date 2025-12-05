/**
 * StockDetailPage - Comprehensive stock analysis and trading
 *
 * MVP Flow: Rankings → Stock Detail → Trade
 * Features: Quote, Chart, Ranking Metrics, AI Analysis, Enhanced Order Form
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStockData } from '../StockDataProvider';
import theme from '../../theme';
import Card from '../common/Card';
import Button from '../common/Button';
import StockQuoteHeader from '../trading/StockQuoteHeader';
import StockInsightsPanel from '../trading/StockInsightsPanel';
import PriceChart from '../charts/PriceChart';
import { STOCK_COLUMNS, DEFAULT_WEIGHTS } from '../../config/stockColumns';

// Ranking metrics that drive the scoring system
const RANKING_METRICS = {
  primary: {
    label: 'Value Signal',
    description: 'Primary ranking factor',
    metrics: [
      {
        key: 'discount',
        label: 'Discount from 52W High',
        weight: 0.4,
        direction: 'higher',
      },
    ],
  },
  financial: {
    label: 'Financial Health',
    description: 'Leverage and liquidity assessment',
    metrics: [
      {
        key: 'debtEbitda',
        label: 'Debt/EBITDA',
        weight: 0.15,
        direction: 'lower',
      },
      { key: 'netDebt', label: 'Net Debt', weight: 0.15, direction: 'lower' },
      {
        key: 'beta',
        label: 'Beta (Volatility)',
        weight: 0.15,
        direction: 'lower',
      },
      {
        key: 'quickRatio',
        label: 'Quick Ratio',
        weight: 0.1,
        direction: 'higher',
      },
    ],
  },
  income: {
    label: 'Income',
    description: 'Dividend generation',
    metrics: [
      {
        key: 'dividend',
        label: 'Dividend Yield',
        weight: 0.05,
        direction: 'higher',
      },
    ],
  },
  additional: {
    label: 'Additional Metrics',
    description: 'Other key indicators',
    metrics: [
      { key: 'peRatio', label: 'P/E Ratio', weight: 0, direction: 'lower' },
      { key: 'priceToBook', label: 'P/B Ratio', weight: 0, direction: 'lower' },
      { key: 'roe', label: 'ROE', weight: 0, direction: 'higher' },
      { key: 'rsi', label: 'RSI', weight: 0, direction: 'neutral' },
      {
        key: 'freeCashFlowYield',
        label: 'FCF Yield',
        weight: 0,
        direction: 'higher',
      },
    ],
  },
};

const StockDetailPage = () => {
  const { ticker } = useParams();
  const navigate = useNavigate();
  const { stockData } = useStockData();

  const [activeTab, setActiveTab] = useState('overview');
  const [companyInfo, setCompanyInfo] = useState(null);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  const [priceChangePercent, setPriceChangePercent] = useState(0);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // Stock analysis for trade insights (from InvestTab)
  const [stockAnalysis, setStockAnalysis] = useState(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  // Order form state
  const [orderForm, setOrderForm] = useState({
    symbol: '',
    side: 'buy',
    quantity: '',
    orderType: 'market',
    limitPrice: '',
  });

  // Find stock data from context
  const stock = useMemo(() => {
    if (!stockData || !ticker) return null;
    return stockData.find(
      s =>
        s.ticker?.toUpperCase() === ticker.toUpperCase() ||
        s.symbol?.toUpperCase() === ticker.toUpperCase()
    );
  }, [stockData, ticker]);

  // Fetch company info, price, and analysis
  useEffect(() => {
    if (!ticker) return;

    const fetchData = async () => {
      setLoading(true);
      setLoadingAnalysis(true);
      setOrderForm(prev => ({ ...prev, symbol: ticker }));

      try {
        // Fetch all data in parallel
        const [detailsRes, quoteRes, analysisRes] = await Promise.all([
          fetch(`/api/polygon/details/${ticker}`).catch(() => null),
          fetch(`/api/polygon/quote/${ticker}`).catch(() => null),
          fetch(`/api/stock/analysis/${ticker}`).catch(() => null),
        ]);

        // Company details
        if (detailsRes?.ok) {
          const details = await detailsRes.json();
          setCompanyInfo(details);
        }

        // Current price and change
        if (quoteRes?.ok) {
          const quote = await quoteRes.json();
          const price = quote.last || quote.close || 0;
          const prevClose = quote.prevClose || quote.previousClose || price;
          const change = price - prevClose;
          const changePercent = prevClose ? (change / prevClose) * 100 : 0;
          setCurrentPrice(price);
          setPriceChange(change);
          setPriceChangePercent(changePercent);
        }

        // Stock analysis (from InvestTab)
        if (analysisRes?.ok) {
          const analysisData = await analysisRes.json();
          setStockAnalysis(analysisData.analysis);
        }
      } catch (err) {
        console.error('Failed to fetch stock data:', err);
      } finally {
        setLoading(false);
        setLoadingAnalysis(false);
      }
    };

    fetchData();
  }, [ticker]);

  const handleToggleAutoTrade = () => {
    setAutoTradeEnabled(!autoTradeEnabled);
    // TODO: Connect to AI trading engine
  };

  const handleOrderSubmit = async order => {
    const res = await fetch('/api/alpaca/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Order failed');
    }

    // Success feedback
    alert(
      `Order submitted: ${order.side.toUpperCase()} ${order.qty} ${order.symbol}`
    );
  };

  // Format metric value for display
  const formatMetricValue = (key, value) => {
    if (value === null || value === undefined) return 'N/A';

    if (key.includes('Ratio') || key.includes('ratio')) {
      return value.toFixed(2);
    }
    if (
      key.includes('Margin') ||
      key.includes('Growth') ||
      key.includes('Return')
    ) {
      return `${(value * 100).toFixed(1)}%`;
    }
    if (
      key.includes('CashFlow') ||
      key.includes('Revenue') ||
      key.includes('Earnings')
    ) {
      if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
      if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
      return `$${value.toFixed(0)}`;
    }
    return typeof value === 'number' ? value.toFixed(2) : value;
  };

  // Get percentile color
  const getPercentileColor = percentile => {
    if (percentile >= 80) return theme.colors.success;
    if (percentile >= 60) return '#8bc34a';
    if (percentile >= 40) return theme.colors.warning;
    if (percentile >= 20) return '#ff9800';
    return theme.colors.error;
  };

  // Format currency
  const formatCurrency = value => {
    if (value === null || value === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  // Execute paper trade
  const executePaperTrade = async side => {
    try {
      const { quantity, orderType, limitPrice } = orderForm;

      if (!ticker || !quantity) {
        alert('Please enter a quantity');
        return;
      }

      const orderData = {
        symbol: ticker.toUpperCase(),
        side,
        qty: parseInt(quantity),
        type: orderType,
      };

      if (orderType === 'limit' && limitPrice) {
        orderData.limit_price = parseFloat(limitPrice);
      }

      const response = await fetch('/api/alpaca/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData),
      });

      const data = await response.json();
      if (response.ok) {
        alert(`Order submitted: ${side.toUpperCase()} ${quantity} ${ticker}`);
        setOrderForm(prev => ({ ...prev, quantity: '', limitPrice: '' }));
      } else {
        alert(`Order failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert('Failed to execute trade');
      console.error('Error executing trade:', err);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'ranking', label: 'Ranking Metrics' },
    { id: 'analysis', label: 'AI Analysis' },
  ];

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto',
      }}
    >
      {/* Back Button */}
      <button
        onClick={() => navigate('/')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          background: 'none',
          border: 'none',
          color: theme.colors.primary,
          cursor: 'pointer',
          marginBottom: theme.spacing.md,
          padding: 0,
          fontSize: theme.typography.fontSize.sm,
        }}
      >
        ← Back to Rankings
      </button>

      {/* Quote Header */}
      <StockQuoteHeader
        symbol={ticker}
        companyName={companyInfo?.name || stock?.companyName}
        onToggleAutoTrade={handleToggleAutoTrade}
        autoTradeEnabled={autoTradeEnabled}
      />

      {/* Main Content Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: theme.spacing.lg,
          alignItems: 'start',
        }}
      >
        {/* Left Column: Chart + Tabs */}
        <div>
          {/* Price Chart */}
          <PriceChart symbol={ticker} height={400} />

          {/* Tab Navigation */}
          <div
            style={{
              display: 'flex',
              gap: theme.spacing.xs,
              marginTop: theme.spacing.lg,
              marginBottom: theme.spacing.md,
              borderBottom: `1px solid ${theme.colors.gray200}`,
              paddingBottom: theme.spacing.sm,
            }}
          >
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: `${theme.spacing.sm} ${theme.spacing.md}`,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSize.md,
                  fontWeight:
                    activeTab === tab.id
                      ? theme.typography.fontWeight.bold
                      : theme.typography.fontWeight.normal,
                  color:
                    activeTab === tab.id
                      ? theme.colors.primary
                      : theme.colors.gray600,
                  borderBottom:
                    activeTab === tab.id
                      ? `2px solid ${theme.colors.primary}`
                      : '2px solid transparent',
                  marginBottom: '-1px',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <OverviewTab
              stock={stock}
              companyInfo={companyInfo}
              stockAnalysis={stockAnalysis}
              formatMetricValue={formatMetricValue}
              getPercentileColor={getPercentileColor}
            />
          )}

          {activeTab === 'ranking' && (
            <RankingMetricsTab
              stock={stock}
              stockAnalysis={stockAnalysis}
              formatMetricValue={formatMetricValue}
              getPercentileColor={getPercentileColor}
            />
          )}

          {activeTab === 'analysis' && (
            <StockInsightsPanel symbol={ticker} currentPrice={currentPrice} />
          )}
        </div>

        {/* Right Column: Enhanced Order Form with Insights */}
        <div style={{ position: 'sticky', top: theme.spacing.lg }}>
          {/* Order Form */}
          <Card
            style={{
              padding: theme.spacing.lg,
              marginBottom: theme.spacing.md,
            }}
          >
            <h4
              style={{
                margin: 0,
                marginBottom: theme.spacing.md,
                fontWeight: theme.typography.fontWeight.bold,
              }}
            >
              Trade {ticker}
            </h4>

            {/* Symbol & Quantity */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr',
                gap: theme.spacing.sm,
                marginBottom: theme.spacing.md,
              }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: theme.spacing.xs,
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.gray600,
                  }}
                >
                  Symbol
                </label>
                <input
                  type="text"
                  value={ticker}
                  disabled
                  style={{
                    width: '100%',
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.gray300}`,
                    borderRadius: theme.borderRadius.md,
                    fontSize: theme.typography.fontSize.md,
                    fontWeight: theme.typography.fontWeight.bold,
                    backgroundColor: theme.colors.gray50,
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: theme.spacing.xs,
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.gray600,
                  }}
                >
                  Shares
                </label>
                <input
                  type="number"
                  value={orderForm.quantity}
                  onChange={e =>
                    setOrderForm({ ...orderForm, quantity: e.target.value })
                  }
                  placeholder="Qty"
                  min="1"
                  style={{
                    width: '100%',
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.gray300}`,
                    borderRadius: theme.borderRadius.md,
                    fontSize: theme.typography.fontSize.md,
                  }}
                />
              </div>
            </div>

            {/* Order Cost Summary */}
            {currentPrice > 0 && orderForm.quantity && (
              <div
                style={{
                  backgroundColor: theme.colors.gray50,
                  padding: theme.spacing.md,
                  borderRadius: theme.borderRadius.md,
                  marginBottom: theme.spacing.md,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  <span style={{ color: theme.colors.gray600 }}>
                    Market Price
                  </span>
                  <span
                    style={{ fontWeight: theme.typography.fontWeight.medium }}
                  >
                    {formatCurrency(currentPrice)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  <span style={{ color: theme.colors.gray600 }}>Shares</span>
                  <span
                    style={{ fontWeight: theme.typography.fontWeight.medium }}
                  >
                    {orderForm.quantity}
                  </span>
                </div>
                <div
                  style={{
                    borderTop: `1px solid ${theme.colors.gray300}`,
                    margin: `${theme.spacing.sm} 0`,
                  }}
                />
                <div
                  style={{ display: 'flex', justifyContent: 'space-between' }}
                >
                  <span
                    style={{ fontWeight: theme.typography.fontWeight.bold }}
                  >
                    Estimated Total
                  </span>
                  <span
                    style={{
                      fontWeight: theme.typography.fontWeight.bold,
                      color: theme.colors.primary,
                    }}
                  >
                    {formatCurrency(
                      currentPrice * parseFloat(orderForm.quantity || 0)
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Order Type */}
            <div style={{ marginBottom: theme.spacing.md }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray600,
                }}
              >
                Order Type
              </label>
              <select
                value={orderForm.orderType}
                onChange={e =>
                  setOrderForm({ ...orderForm, orderType: e.target.value })
                }
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.md,
                  fontSize: theme.typography.fontSize.md,
                  backgroundColor: theme.colors.surface,
                }}
              >
                <option value="market">Market Order</option>
                <option value="limit">Limit Order</option>
              </select>
            </div>

            {orderForm.orderType === 'limit' && (
              <div style={{ marginBottom: theme.spacing.md }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: theme.spacing.xs,
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.gray600,
                  }}
                >
                  Limit Price
                </label>
                <input
                  type="number"
                  value={orderForm.limitPrice}
                  onChange={e =>
                    setOrderForm({ ...orderForm, limitPrice: e.target.value })
                  }
                  placeholder="0.00"
                  step="0.01"
                  style={{
                    width: '100%',
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.gray300}`,
                    borderRadius: theme.borderRadius.md,
                    fontSize: theme.typography.fontSize.md,
                  }}
                />
              </div>
            )}

            {/* Buy/Sell Buttons */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: theme.spacing.sm,
              }}
            >
              <Button
                variant="success"
                onClick={() => executePaperTrade('buy')}
                disabled={!orderForm.quantity}
              >
                Buy {ticker}
              </Button>
              <Button
                variant="danger"
                onClick={() => executePaperTrade('sell')}
                disabled={!orderForm.quantity}
              >
                Sell {ticker}
              </Button>
            </div>

            <div
              style={{
                marginTop: theme.spacing.sm,
                padding: theme.spacing.xs,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.info,
                textAlign: 'center',
                backgroundColor: `${theme.colors.info}10`,
                borderRadius: theme.borderRadius.sm,
                border: `1px solid ${theme.colors.info}30`,
              }}
            >
              📋 Paper Trading Mode (Alpaca)
            </div>
          </Card>

          {/* Full Stock Analysis Panel (from InvestTab) */}
          {stockAnalysis && (
            <Card
              style={{
                padding: theme.spacing.md,
                maxHeight: '600px',
                overflowY: 'auto',
              }}
            >
              <h4
                style={{
                  margin: 0,
                  marginBottom: theme.spacing.md,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {stockAnalysis.symbol || ticker} Analysis
              </h4>

              {/* Price Info - use currentPrice from Polygon API for consistency with header */}
              <div style={{ marginBottom: theme.spacing.md }}>
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: theme.typography.fontWeight.bold,
                    color: theme.colors.primary,
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  ${currentPrice.toFixed(2)}
                </div>
                {(priceChange !== 0 || priceChangePercent !== 0) && (
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      fontWeight: theme.typography.fontWeight.medium,
                      color:
                        priceChange >= 0
                          ? theme.colors.success
                          : theme.colors.error,
                    }}
                  >
                    {priceChange >= 0 ? '▲' : '▼'} $
                    {Math.abs(priceChange).toFixed(2)} (
                    {priceChange >= 0 ? '+' : ''}
                    {priceChangePercent.toFixed(2)}%) today
                  </div>
                )}
              </div>

              {/* Recommendation */}
              {stockAnalysis.recommendation && (
                <div
                  style={{
                    padding: theme.spacing.sm,
                    borderRadius: theme.borderRadius.md,
                    marginBottom: theme.spacing.md,
                    backgroundColor:
                      stockAnalysis.recommendation.action.includes('Buy')
                        ? `${theme.colors.success}15`
                        : stockAnalysis.recommendation.action.includes('Sell')
                          ? `${theme.colors.error}15`
                          : `${theme.colors.warning}15`,
                    border: `1px solid ${
                      stockAnalysis.recommendation.action.includes('Buy')
                        ? theme.colors.success
                        : stockAnalysis.recommendation.action.includes('Sell')
                          ? theme.colors.error
                          : theme.colors.warning
                    }30`,
                  }}
                >
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.md,
                      fontWeight: theme.typography.fontWeight.bold,
                      color: stockAnalysis.recommendation.action.includes('Buy')
                        ? theme.colors.success
                        : stockAnalysis.recommendation.action.includes('Sell')
                          ? theme.colors.error
                          : theme.colors.warning,
                      marginBottom: theme.spacing.xs,
                    }}
                  >
                    Recommendation: {stockAnalysis.recommendation.action}
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: theme.spacing.md,
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.gray700,
                    }}
                  >
                    {stockAnalysis.recommendation.reasons?.map((reason, i) => (
                      <li key={i} style={{ marginBottom: '2px' }}>
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Technical Indicators */}
              {stockAnalysis.technicals && (
                <div style={{ marginBottom: theme.spacing.md }}>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      fontWeight: theme.typography.fontWeight.bold,
                      marginBottom: theme.spacing.sm,
                      color: theme.colors.primary,
                    }}
                  >
                    Technical Indicators
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: theme.spacing.xs,
                      marginBottom: theme.spacing.sm,
                    }}
                  >
                    <div
                      style={{
                        padding: theme.spacing.sm,
                        backgroundColor: theme.colors.gray50,
                        borderRadius: theme.borderRadius.md,
                      }}
                    >
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.xs,
                          color: theme.colors.gray500,
                          marginBottom: '2px',
                        }}
                      >
                        RSI (14)
                      </div>
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.lg,
                          fontWeight: theme.typography.fontWeight.bold,
                        }}
                      >
                        {stockAnalysis.technicals.rsi}
                      </div>
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.xs,
                          fontWeight: theme.typography.fontWeight.medium,
                          color:
                            stockAnalysis.technicals.rsiSignal === 'Oversold'
                              ? theme.colors.success
                              : stockAnalysis.technicals.rsiSignal ===
                                  'Overbought'
                                ? theme.colors.error
                                : theme.colors.gray600,
                        }}
                      >
                        {stockAnalysis.technicals.rsiSignal}
                      </div>
                    </div>
                    <div
                      style={{
                        padding: theme.spacing.sm,
                        backgroundColor: theme.colors.gray50,
                        borderRadius: theme.borderRadius.md,
                      }}
                    >
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.xs,
                          color: theme.colors.gray500,
                          marginBottom: '2px',
                        }}
                      >
                        Trend
                      </div>
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.lg,
                          fontWeight: theme.typography.fontWeight.bold,
                          color:
                            stockAnalysis.technicals.trendSignal === 'Bullish'
                              ? theme.colors.success
                              : stockAnalysis.technicals.trendSignal ===
                                  'Bearish'
                                ? theme.colors.error
                                : theme.colors.gray600,
                        }}
                      >
                        {stockAnalysis.technicals.trendSignal}
                      </div>
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.xs,
                          color: theme.colors.gray500,
                        }}
                      >
                        MA20/MA50
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.gray700,
                      marginBottom: theme.spacing.xs,
                    }}
                  >
                    <strong>52-Week Range:</strong> $
                    {stockAnalysis.technicals.low52w} - $
                    {stockAnalysis.technicals.high52w}
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.gray700,
                    }}
                  >
                    <strong>Distance from High:</strong>{' '}
                    {stockAnalysis.technicals.distanceFromHigh}%
                  </div>
                </div>
              )}

              {/* Volume */}
              {stockAnalysis.volume && (
                <div style={{ marginBottom: theme.spacing.md }}>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      fontWeight: theme.typography.fontWeight.bold,
                      marginBottom: theme.spacing.xs,
                      color: theme.colors.primary,
                    }}
                  >
                    Volume
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.gray700,
                    }}
                  >
                    <div>
                      Today: {stockAnalysis.volume.current?.toLocaleString()}
                    </div>
                    {stockAnalysis.volume.changePercent && (
                      <div
                        style={{
                          color:
                            parseFloat(stockAnalysis.volume.changePercent) > 0
                              ? theme.colors.success
                              : theme.colors.error,
                          fontWeight: theme.typography.fontWeight.medium,
                        }}
                      >
                        {parseFloat(stockAnalysis.volume.changePercent) > 0
                          ? '▲'
                          : '▼'}{' '}
                        {Math.abs(
                          parseFloat(stockAnalysis.volume.changePercent)
                        ).toFixed(1)}
                        % vs yesterday
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Projections */}
              {stockAnalysis.projections && (
                <div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      fontWeight: theme.typography.fontWeight.bold,
                      marginBottom: theme.spacing.sm,
                      color: theme.colors.primary,
                    }}
                  >
                    Expected Returns
                  </div>

                  {/* 1 Week Projection */}
                  <div
                    style={{
                      padding: theme.spacing.sm,
                      backgroundColor: `${theme.colors.info}10`,
                      borderRadius: theme.borderRadius.md,
                      marginBottom: theme.spacing.sm,
                      border: `1px solid ${theme.colors.info}30`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        fontWeight: theme.typography.fontWeight.bold,
                        color: theme.colors.gray700,
                        marginBottom: theme.spacing.xs,
                      }}
                    >
                      1 Week Projection
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.lg,
                        fontWeight: theme.typography.fontWeight.bold,
                        color: theme.colors.info,
                        marginBottom: '2px',
                      }}
                    >
                      ${stockAnalysis.projections.oneWeek?.expectedPrice}
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray600,
                      }}
                    >
                      Expected return:{' '}
                      {stockAnalysis.projections.oneWeek?.expectedReturn}%
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray600,
                      }}
                    >
                      Range: ${stockAnalysis.projections.oneWeek?.range?.low} -
                      ${stockAnalysis.projections.oneWeek?.range?.high}
                    </div>
                    {orderForm.quantity && (
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.sm,
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.info,
                          marginTop: theme.spacing.xs,
                        }}
                      >
                        Your potential P/L:{' '}
                        {formatCurrency(
                          (parseFloat(
                            stockAnalysis.projections.oneWeek?.expectedPrice ||
                              0
                          ) -
                            currentPrice) *
                            parseFloat(orderForm.quantity)
                        )}
                      </div>
                    )}
                  </div>

                  {/* 1 Month Projection */}
                  <div
                    style={{
                      padding: theme.spacing.sm,
                      backgroundColor: `${theme.colors.success}10`,
                      borderRadius: theme.borderRadius.md,
                      border: `1px solid ${theme.colors.success}30`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        fontWeight: theme.typography.fontWeight.bold,
                        color: theme.colors.gray700,
                        marginBottom: theme.spacing.xs,
                      }}
                    >
                      1 Month Projection
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.lg,
                        fontWeight: theme.typography.fontWeight.bold,
                        color: theme.colors.success,
                        marginBottom: '2px',
                      }}
                    >
                      ${stockAnalysis.projections.oneMonth?.expectedPrice}
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray600,
                      }}
                    >
                      Expected return:{' '}
                      {stockAnalysis.projections.oneMonth?.expectedReturn}%
                    </div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray600,
                      }}
                    >
                      Range: ${stockAnalysis.projections.oneMonth?.range?.low} -
                      ${stockAnalysis.projections.oneMonth?.range?.high}
                    </div>
                    {orderForm.quantity && (
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.sm,
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.success,
                          marginTop: theme.spacing.xs,
                        }}
                      >
                        Your potential P/L:{' '}
                        {formatCurrency(
                          (parseFloat(
                            stockAnalysis.projections.oneMonth?.expectedPrice ||
                              0
                          ) -
                            currentPrice) *
                            parseFloat(orderForm.quantity)
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          {loadingAnalysis && (
            <Card style={{ padding: theme.spacing.md, textAlign: 'center' }}>
              <div style={{ color: theme.colors.gray500 }}>
                Loading insights...
              </div>
            </Card>
          )}

          {/* Auto-Trade Panel (when enabled) */}
          {autoTradeEnabled && (
            <Card
              style={{ marginTop: theme.spacing.md, padding: theme.spacing.md }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  marginBottom: theme.spacing.sm,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: theme.colors.success,
                    animation: 'pulse 2s infinite',
                  }}
                />
                <span
                  style={{
                    fontWeight: theme.typography.fontWeight.bold,
                    color: theme.colors.success,
                  }}
                >
                  Auto-Trading Active
                </span>
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray600,
                }}
              >
                AI is monitoring {ticker} for trade opportunities.
              </div>
              <Button
                variant="outline"
                size="small"
                onClick={handleToggleAutoTrade}
                style={{ marginTop: theme.spacing.sm, width: '100%' }}
              >
                Stop Auto-Trading
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

// Overview Tab Component - Enhanced with all available data
const OverviewTab = ({
  stock,
  companyInfo,
  stockAnalysis,
  formatMetricValue,
  getPercentileColor,
}) => {
  // Combine all data sources for comprehensive overview
  const priceMetrics = [
    {
      key: 'price',
      label: 'Current Price',
      value: stock?.price,
      format: 'currency',
    },
    {
      key: 'yearHigh',
      label: '52-Week High',
      value: stock?.yearHigh,
      format: 'currency',
    },
    {
      key: 'discount',
      label: 'Discount from High',
      value: stock?.discount,
      format: 'percent',
      highlight: true,
    },
    { key: 'beta', label: 'Beta', value: stock?.beta, format: 'number' },
  ];

  const valuationMetrics = [
    {
      key: 'peRatio',
      label: 'P/E Ratio',
      value: stock?.peRatio,
      format: 'number',
    },
    {
      key: 'priceToBook',
      label: 'P/B Ratio',
      value: stock?.priceToBook,
      format: 'number',
    },
    {
      key: 'evEbitda',
      label: 'EV/EBITDA',
      value: stock?.evEbitda,
      format: 'number',
    },
    {
      key: 'marketCap',
      label: 'Market Cap',
      value: companyInfo?.marketCap,
      format: 'largeNumber',
    },
  ];

  const financialMetrics = [
    {
      key: 'debtEbitda',
      label: 'Debt/EBITDA',
      value: stock?.debtEbitda,
      format: 'number',
    },
    {
      key: 'quickRatio',
      label: 'Quick Ratio',
      value: stock?.quickRatio,
      format: 'number',
    },
    {
      key: 'netDebt',
      label: 'Net Debt',
      value: stock?.netDebt,
      format: 'largeNumber',
    },
    { key: 'cash', label: 'Cash', value: stock?.cash, format: 'largeNumber' },
  ];

  const formatValue = (value, format) => {
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'number' && isNaN(value))
    )
      return 'N/A';
    switch (format) {
      case 'currency':
        return `$${parseFloat(value).toFixed(2)}`;
      case 'percent':
        return `${(parseFloat(value) * 100).toFixed(1)}%`;
      case 'largeNumber':
        const num = parseFloat(value);
        if (isNaN(num)) return 'N/A';
        if (Math.abs(num) >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
        if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
        if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
        return `$${num.toFixed(0)}`;
      default:
        return typeof value === 'number' ? value.toFixed(2) : value;
    }
  };

  const MetricBox = ({ label, value, format, highlight }) => (
    <div
      style={{
        padding: theme.spacing.sm,
        backgroundColor: highlight
          ? `${theme.colors.success}10`
          : theme.colors.gray50,
        borderRadius: theme.borderRadius.md,
        border: highlight ? `1px solid ${theme.colors.success}30` : 'none',
      }}
    >
      <div
        style={{
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.gray500,
          marginBottom: '2px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: theme.typography.fontSize.lg,
          fontWeight: theme.typography.fontWeight.bold,
          color: highlight ? theme.colors.success : theme.colors.text,
        }}
      >
        {formatValue(value, format)}
      </div>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
      }}
    >
      {/* Company Description */}
      {companyInfo?.description && (
        <Card style={{ padding: theme.spacing.md }}>
          <h4 style={{ margin: 0, marginBottom: theme.spacing.sm }}>About</h4>
          <p
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray600,
              lineHeight: 1.6,
            }}
          >
            {companyInfo.description.slice(0, 400)}
            {companyInfo.description.length > 400 ? '...' : ''}
          </p>
          <div
            style={{
              marginTop: theme.spacing.sm,
              display: 'flex',
              gap: theme.spacing.md,
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.gray500,
            }}
          >
            {companyInfo.sector && <span>{companyInfo.sector}</span>}
            {companyInfo.industry && <span>• {companyInfo.industry}</span>}
            {companyInfo.employees && (
              <span>• {companyInfo.employees.toLocaleString()} employees</span>
            )}
          </div>
        </Card>
      )}

      {/* Ranking Score (if available) */}
      {stock?.rank !== undefined && stock?.rank !== null && (
        <Card style={{ padding: theme.spacing.md }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h4 style={{ margin: 0, marginBottom: theme.spacing.xs }}>
                Ranking Score
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray600,
                }}
              >
                Combined value and financial health assessment
              </p>
            </div>
            <div
              style={{
                fontSize: '36px',
                fontWeight: theme.typography.fontWeight.bold,
                color:
                  stock.rank <= 10
                    ? theme.colors.success
                    : stock.rank <= 25
                      ? theme.colors.warning
                      : theme.colors.text,
              }}
            >
              #{stock.rank}
            </div>
          </div>
        </Card>
      )}

      {/* Price & Value */}
      <Card style={{ padding: theme.spacing.md }}>
        <h4 style={{ margin: 0, marginBottom: theme.spacing.md }}>
          Price & Value
        </h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: theme.spacing.sm,
          }}
        >
          {priceMetrics.map(m => (
            <MetricBox key={m.key} {...m} />
          ))}
        </div>
      </Card>

      {/* Valuation */}
      <Card style={{ padding: theme.spacing.md }}>
        <h4 style={{ margin: 0, marginBottom: theme.spacing.md }}>Valuation</h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: theme.spacing.sm,
          }}
        >
          {valuationMetrics.map(m => (
            <MetricBox key={m.key} {...m} />
          ))}
        </div>
      </Card>

      {/* Financial Health */}
      <Card style={{ padding: theme.spacing.md }}>
        <h4 style={{ margin: 0, marginBottom: theme.spacing.md }}>
          Financial Health
        </h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: theme.spacing.sm,
          }}
        >
          {financialMetrics.map(m => (
            <MetricBox key={m.key} {...m} />
          ))}
        </div>
      </Card>

      {/* Technical Analysis (from stockAnalysis) */}
      {stockAnalysis?.technicals && (
        <Card style={{ padding: theme.spacing.md }}>
          <h4 style={{ margin: 0, marginBottom: theme.spacing.md }}>
            Technical Analysis
          </h4>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: theme.spacing.sm,
            }}
          >
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                RSI (14)
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {stockAnalysis.technicals.rsi}
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color:
                    stockAnalysis.technicals.rsiSignal === 'Oversold'
                      ? theme.colors.success
                      : stockAnalysis.technicals.rsiSignal === 'Overbought'
                        ? theme.colors.error
                        : theme.colors.gray600,
                }}
              >
                {stockAnalysis.technicals.rsiSignal}
              </div>
            </div>
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                Trend
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    stockAnalysis.technicals.trendSignal === 'Bullish'
                      ? theme.colors.success
                      : stockAnalysis.technicals.trendSignal === 'Bearish'
                        ? theme.colors.error
                        : theme.colors.text,
                }}
              >
                {stockAnalysis.technicals.trendSignal}
              </div>
            </div>
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                52W Range
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                ${stockAnalysis.technicals.low52w} - $
                {stockAnalysis.technicals.high52w}
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray600,
                }}
              >
                {stockAnalysis.technicals.distanceFromHigh}% from high
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

// Ranking Metrics Tab - Shows all metrics from the ranking system
const RankingMetricsTab = ({
  stock,
  stockAnalysis,
  formatMetricValue,
  getPercentileColor,
}) => {
  const getDirectionIcon = direction => {
    if (direction === 'higher') return '↑';
    if (direction === 'lower') return '↓';
    return '↔';
  };

  const getMetricColor = (value, direction, key) => {
    if (value === null || value === undefined) return theme.colors.gray500;
    // Simple coloring based on direction preference
    if (key === 'discount' && value > 0.2) return theme.colors.success;
    if (key === 'beta' && value < 1) return theme.colors.success;
    if (key === 'quickRatio' && value > 1) return theme.colors.success;
    if (key === 'debtEbitda' && value < 3) return theme.colors.success;
    return theme.colors.text;
  };

  const formatMetric = (value, key) => {
    if (value === null || value === undefined) return '--';
    if (key === 'discount') return `${(value * 100).toFixed(1)}%`;
    if (key === 'netDebt') {
      const num = parseFloat(value);
      if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
      if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
      return `$${num.toFixed(0)}`;
    }
    if (key === 'dividend') return `${(value * 100).toFixed(2)}%`;
    if (key === 'roe' || key === 'freeCashFlowYield')
      return `${(value * 100).toFixed(1)}%`;
    return typeof value === 'number' ? value.toFixed(2) : value;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
      }}
    >
      {/* Explanation */}
      <Card
        style={{
          padding: theme.spacing.md,
          backgroundColor: `${theme.colors.info}08`,
        }}
      >
        <h4
          style={{
            margin: 0,
            marginBottom: theme.spacing.xs,
            color: theme.colors.info,
          }}
        >
          Ranking Methodology
        </h4>
        <p
          style={{
            margin: 0,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
          }}
        >
          Stocks are ranked using a dual-algorithm system combining relative
          position ranking and statistical deviation. Weights indicate each
          metric's contribution to the final rank.
        </p>
      </Card>

      {/* Primary Value Signal */}
      <Card style={{ padding: theme.spacing.md }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: theme.spacing.sm,
          }}
        >
          <h4 style={{ margin: 0 }}>{RANKING_METRICS.primary.label}</h4>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.gray500,
            }}
          >
            40% of rank
          </span>
        </div>
        <p
          style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
          }}
        >
          {RANKING_METRICS.primary.description}
        </p>
        {RANKING_METRICS.primary.metrics.map(m => (
          <div
            key={m.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: theme.spacing.md,
              backgroundColor: `${theme.colors.success}10`,
              borderRadius: theme.borderRadius.md,
              border: `1px solid ${theme.colors.success}30`,
            }}
          >
            <div>
              <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                {m.label}
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                {getDirectionIcon(m.direction)}{' '}
                {m.direction === 'higher'
                  ? 'Higher is better'
                  : 'Lower is better'}
              </div>
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.xxl,
                fontWeight: theme.typography.fontWeight.bold,
                color: getMetricColor(stock?.[m.key], m.direction, m.key),
              }}
            >
              {formatMetric(stock?.[m.key], m.key)}
            </div>
          </div>
        ))}
      </Card>

      {/* Financial Health */}
      <Card style={{ padding: theme.spacing.md }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: theme.spacing.sm,
          }}
        >
          <h4 style={{ margin: 0 }}>{RANKING_METRICS.financial.label}</h4>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.gray500,
            }}
          >
            55% of rank
          </span>
        </div>
        <p
          style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
          }}
        >
          {RANKING_METRICS.financial.description}
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: theme.spacing.sm,
          }}
        >
          {RANKING_METRICS.financial.metrics.map(m => (
            <div
              key={m.key}
              style={{
                padding: theme.spacing.md,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'start',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    {m.label}
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.gray500,
                    }}
                  >
                    Weight: {(m.weight * 100).toFixed(0)}%
                  </div>
                </div>
                <div
                  style={{
                    fontSize: theme.typography.fontSize.lg,
                    fontWeight: theme.typography.fontWeight.bold,
                    color: getMetricColor(stock?.[m.key], m.direction, m.key),
                  }}
                >
                  {formatMetric(stock?.[m.key], m.key)}
                </div>
              </div>
              <div
                style={{
                  marginTop: theme.spacing.xs,
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                {getDirectionIcon(m.direction)}{' '}
                {m.direction === 'higher'
                  ? 'Higher is better'
                  : 'Lower is better'}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Income */}
      <Card style={{ padding: theme.spacing.md }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: theme.spacing.sm,
          }}
        >
          <h4 style={{ margin: 0 }}>{RANKING_METRICS.income.label}</h4>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.gray500,
            }}
          >
            5% of rank
          </span>
        </div>
        {RANKING_METRICS.income.metrics.map(m => (
          <div
            key={m.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: theme.spacing.md,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.md,
            }}
          >
            <div>
              <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                {m.label}
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                {getDirectionIcon(m.direction)}{' '}
                {m.direction === 'higher'
                  ? 'Higher is better'
                  : 'Lower is better'}
              </div>
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.xl,
                fontWeight: theme.typography.fontWeight.bold,
                color: getMetricColor(stock?.[m.key], m.direction, m.key),
              }}
            >
              {formatMetric(stock?.[m.key], m.key)}
            </div>
          </div>
        ))}
      </Card>

      {/* Additional Metrics */}
      <Card style={{ padding: theme.spacing.md }}>
        <h4 style={{ margin: 0, marginBottom: theme.spacing.sm }}>
          {RANKING_METRICS.additional.label}
        </h4>
        <p
          style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
          }}
        >
          {RANKING_METRICS.additional.description} (not weighted in ranking)
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: theme.spacing.sm,
          }}
        >
          {RANKING_METRICS.additional.metrics.map(m => (
            <div
              key={m.key}
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                  marginBottom: '2px',
                }}
              >
                {m.label}
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.md,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {formatMetric(
                  stock?.[m.key] ??
                    stockAnalysis?.technicals?.[m.key.toLowerCase()],
                  m.key
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// Metric Item Component
const MetricItem = ({ label, value, percentile, getPercentileColor }) => (
  <div
    style={{
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.gray50,
      borderRadius: theme.borderRadius.sm,
    }}
  >
    <div
      style={{
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.gray500,
        marginBottom: '2px',
        textTransform: 'capitalize',
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: theme.typography.fontSize.lg,
        fontWeight: theme.typography.fontWeight.bold,
        color: theme.colors.text,
      }}
    >
      {value}
    </div>
    {percentile !== undefined && (
      <div
        style={{
          fontSize: theme.typography.fontSize.xs,
          color: getPercentileColor(percentile),
          marginTop: '2px',
        }}
      >
        {percentile >= 50 ? '▲' : '▼'} {percentile}th %ile
      </div>
    )}
  </div>
);

export default StockDetailPage;
