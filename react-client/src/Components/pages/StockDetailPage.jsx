/**
 * StockDetailPage - Comprehensive stock analysis and trading
 *
 * MVP Flow: Rankings → Stock Detail → Trade
 * Features: Quote, Chart, Metrics, AI Analysis, Order Form
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStockData } from '../StockDataProvider';
import theme from '../../theme';
import Card from '../common/Card';
import Button from '../common/Button';
import StockQuoteHeader from '../trading/StockQuoteHeader';
import StandardOrderForm from '../trading/StandardOrderForm';
import StockInsightsPanel from '../trading/StockInsightsPanel';
import PriceChart from '../charts/PriceChart';

// Metric categories for organized display
const METRIC_CATEGORIES = {
  valuation: {
    label: 'Valuation',
    metrics: ['peRatio', 'pbRatio', 'priceToSalesRatio', 'enterpriseToRevenue']
  },
  profitability: {
    label: 'Profitability',
    metrics: ['returnOnEquity', 'returnOnAssets', 'profitMargin', 'operatingMargin']
  },
  growth: {
    label: 'Growth',
    metrics: ['revenueGrowth', 'earningsGrowth', 'quarterlyRevenueGrowth']
  },
  financial: {
    label: 'Financial Health',
    metrics: ['debtToEquity', 'currentRatio', 'quickRatio', 'freeCashFlow']
  }
};

const StockDetailPage = () => {
  const { ticker } = useParams();
  const navigate = useNavigate();
  const { stockData } = useStockData();

  const [activeTab, setActiveTab] = useState('overview');
  const [companyInfo, setCompanyInfo] = useState(null);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // Find stock data from context
  const stock = useMemo(() => {
    if (!stockData || !ticker) return null;
    return stockData.find(s =>
      s.ticker?.toUpperCase() === ticker.toUpperCase() ||
      s.symbol?.toUpperCase() === ticker.toUpperCase()
    );
  }, [stockData, ticker]);

  // Fetch company info and price
  useEffect(() => {
    if (!ticker) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch company details
        const detailsRes = await fetch(`/api/polygon/details/${ticker}`);
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          setCompanyInfo(details);
        }

        // Fetch current price
        const quoteRes = await fetch(`/api/polygon/quote/${ticker}`);
        if (quoteRes.ok) {
          const quote = await quoteRes.json();
          setCurrentPrice(quote.last || quote.close || 0);
        }
      } catch (err) {
        console.error('Failed to fetch stock data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker]);

  const handleToggleAutoTrade = () => {
    setAutoTradeEnabled(!autoTradeEnabled);
    // TODO: Connect to AI trading engine
  };

  const handleOrderSubmit = async (order) => {
    const res = await fetch('/api/alpaca/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Order failed');
    }

    // Success feedback
    alert(`Order submitted: ${order.side.toUpperCase()} ${order.qty} ${order.symbol}`);
  };

  // Format metric value for display
  const formatMetricValue = (key, value) => {
    if (value === null || value === undefined) return '--';

    if (key.includes('Ratio') || key.includes('ratio')) {
      return value.toFixed(2);
    }
    if (key.includes('Margin') || key.includes('Growth') || key.includes('Return')) {
      return `${(value * 100).toFixed(1)}%`;
    }
    if (key.includes('CashFlow') || key.includes('Revenue') || key.includes('Earnings')) {
      if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
      if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
      return `$${value.toFixed(0)}`;
    }
    return typeof value === 'number' ? value.toFixed(2) : value;
  };

  // Get percentile color
  const getPercentileColor = (percentile) => {
    if (percentile >= 80) return theme.colors.success;
    if (percentile >= 60) return '#8bc34a';
    if (percentile >= 40) return theme.colors.warning;
    if (percentile >= 20) return '#ff9800';
    return theme.colors.error;
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'financials', label: 'Financials' },
    { id: 'analysis', label: 'AI Analysis' }
  ];

  return (
    <div style={{
      padding: theme.spacing.lg,
      maxWidth: theme.layout.maxWidthWide,
      margin: '0 auto'
    }}>
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
          fontSize: theme.typography.fontSize.sm
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
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: theme.spacing.lg,
        alignItems: 'start'
      }}>
        {/* Left Column: Chart + Tabs */}
        <div>
          {/* Price Chart */}
          <PriceChart symbol={ticker} height={400} />

          {/* Tab Navigation */}
          <div style={{
            display: 'flex',
            gap: theme.spacing.xs,
            marginTop: theme.spacing.lg,
            marginBottom: theme.spacing.md,
            borderBottom: `1px solid ${theme.colors.gray200}`,
            paddingBottom: theme.spacing.sm
          }}>
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
                  fontWeight: activeTab === tab.id
                    ? theme.typography.fontWeight.bold
                    : theme.typography.fontWeight.normal,
                  color: activeTab === tab.id
                    ? theme.colors.primary
                    : theme.colors.gray600,
                  borderBottom: activeTab === tab.id
                    ? `2px solid ${theme.colors.primary}`
                    : '2px solid transparent',
                  marginBottom: '-1px'
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
              formatMetricValue={formatMetricValue}
              getPercentileColor={getPercentileColor}
            />
          )}

          {activeTab === 'financials' && (
            <FinancialsTab
              stock={stock}
              formatMetricValue={formatMetricValue}
              getPercentileColor={getPercentileColor}
            />
          )}

          {activeTab === 'analysis' && (
            <StockInsightsPanel symbol={ticker} currentPrice={currentPrice} />
          )}
        </div>

        {/* Right Column: Order Form */}
        <div style={{ position: 'sticky', top: theme.spacing.lg }}>
          <StandardOrderForm
            symbol={ticker}
            currentPrice={currentPrice}
            onSubmitOrder={handleOrderSubmit}
          />

          {/* Auto-Trade Panel (when enabled) */}
          {autoTradeEnabled && (
            <Card style={{ marginTop: theme.spacing.md, padding: theme.spacing.md }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.sm,
                marginBottom: theme.spacing.sm
              }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: theme.colors.success,
                  animation: 'pulse 2s infinite'
                }} />
                <span style={{
                  fontWeight: theme.typography.fontWeight.bold,
                  color: theme.colors.success
                }}>
                  Auto-Trading Active
                </span>
              </div>
              <div style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600
              }}>
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

// Overview Tab Component
const OverviewTab = ({ stock, companyInfo, formatMetricValue, getPercentileColor }) => {
  const keyMetrics = [
    { key: 'marketCap', label: 'Market Cap' },
    { key: 'peRatio', label: 'P/E Ratio' },
    { key: 'eps', label: 'EPS' },
    { key: 'dividend', label: 'Dividend Yield' },
    { key: 'beta', label: 'Beta' },
    { key: 'week52High', label: '52W High' },
    { key: 'week52Low', label: '52W Low' },
    { key: 'avgVolume', label: 'Avg Volume' }
  ];

  return (
    <div>
      {/* Company Description */}
      {companyInfo?.description && (
        <Card style={{ marginBottom: theme.spacing.md, padding: theme.spacing.md }}>
          <h4 style={{ margin: 0, marginBottom: theme.spacing.sm }}>About</h4>
          <p style={{
            margin: 0,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.gray600,
            lineHeight: 1.6
          }}>
            {companyInfo.description.slice(0, 300)}
            {companyInfo.description.length > 300 ? '...' : ''}
          </p>
          {companyInfo.sector && (
            <div style={{
              marginTop: theme.spacing.sm,
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.gray500
            }}>
              {companyInfo.sector} • {companyInfo.industry}
            </div>
          )}
        </Card>
      )}

      {/* Key Metrics Grid */}
      <Card style={{ padding: theme.spacing.md }}>
        <h4 style={{ margin: 0, marginBottom: theme.spacing.md }}>Key Metrics</h4>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: theme.spacing.md
        }}>
          {keyMetrics.map(({ key, label }) => (
            <MetricItem
              key={key}
              label={label}
              value={formatMetricValue(key, stock?.[key])}
              percentile={stock?.[`${key}_percentile`]}
              getPercentileColor={getPercentileColor}
            />
          ))}
        </div>
      </Card>
    </div>
  );
};

// Financials Tab Component
const FinancialsTab = ({ stock, formatMetricValue, getPercentileColor }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {Object.entries(METRIC_CATEGORIES).map(([catKey, category]) => (
        <Card key={catKey} style={{ padding: theme.spacing.md }}>
          <h4 style={{ margin: 0, marginBottom: theme.spacing.md }}>{category.label}</h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: theme.spacing.md
          }}>
            {category.metrics.map(key => (
              <MetricItem
                key={key}
                label={key.replace(/([A-Z])/g, ' $1').trim()}
                value={formatMetricValue(key, stock?.[key])}
                percentile={stock?.[`${key}_percentile`]}
                getPercentileColor={getPercentileColor}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
};

// Metric Item Component
const MetricItem = ({ label, value, percentile, getPercentileColor }) => (
  <div style={{
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.gray50,
    borderRadius: theme.borderRadius.sm
  }}>
    <div style={{
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.gray500,
      marginBottom: '2px',
      textTransform: 'capitalize'
    }}>
      {label}
    </div>
    <div style={{
      fontSize: theme.typography.fontSize.lg,
      fontWeight: theme.typography.fontWeight.bold,
      color: theme.colors.text
    }}>
      {value}
    </div>
    {percentile !== undefined && (
      <div style={{
        fontSize: theme.typography.fontSize.xs,
        color: getPercentileColor(percentile),
        marginTop: '2px'
      }}>
        {percentile >= 50 ? '▲' : '▼'} {percentile}th %ile
      </div>
    )}
  </div>
);

export default StockDetailPage;
