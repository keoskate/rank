/**
 * StockQuoteHeader - Professional real-time stock quote display
 * Similar to Schwab/Robinhood quote headers
 */

import { useState, useEffect } from 'react';
import theme from '../../theme';

const StockQuoteHeader = ({
  symbol,
  companyName,
  onToggleAutoTrade,
  autoTradeEnabled,
  periodChange, // { price, change, changePercent, periodLabel }
}) => {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;

    const fetchQuote = async () => {
      try {
        const res = await fetch(`/api/polygon/quote/${symbol}`);
        if (res.ok) {
          const data = await res.json();
          setQuote(data);
        }
      } catch (err) {
        console.error('Failed to fetch quote:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchQuote();
    const interval = setInterval(fetchQuote, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [symbol]);

  const formatPrice = price => {
    if (!price && price !== 0) return '--';
    return `$${Number(price).toFixed(2)}`;
  };

  const formatChange = (change, changePercent) => {
    if (!change && change !== 0)
      return { text: '--', color: theme.colors.gray500 };
    const isPositive = change >= 0;
    return {
      text: `${isPositive ? '+' : ''}${change.toFixed(2)} (${isPositive ? '+' : ''}${changePercent.toFixed(2)}%)`,
      color: isPositive ? theme.colors.success : theme.colors.error,
    };
  };

  const formatVolume = vol => {
    if (!vol) return '--';
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
    return vol.toString();
  };

  const price = periodChange?.price || quote?.last || quote?.close || 0;
  const prevClose = quote?.prevClose || quote?.previousClose || price;

  // Use period-based change if available (from chart), otherwise fall back to daily change
  const change = periodChange?.change ?? (price - prevClose);
  const changePercent = periodChange?.changePercent ?? (prevClose ? ((price - prevClose) / prevClose) * 100 : 0);
  const periodLabel = periodChange?.periodLabel || 'today';
  const changeInfo = formatChange(change, changePercent);

  return (
    <div
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.md,
        boxShadow: theme.shadows.sm,
      }}
    >
      {/* Top Row: Symbol, Name, Auto-Trade Toggle */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: theme.spacing.md,
        }}
      >
        <div>
          <div
            style={{
              fontSize: theme.typography.fontSize.xxl,
              fontWeight: theme.typography.fontWeight.bold,
              color: theme.colors.text,
            }}
          >
            {symbol}
          </div>
          <div
            style={{
              fontSize: theme.typography.fontSize.md,
              color: theme.colors.gray600,
            }}
          >
            {companyName || 'Loading...'}
          </div>
        </div>

        {onToggleAutoTrade && (
          <button
            onClick={onToggleAutoTrade}
            style={{
              padding: `${theme.spacing.sm} ${theme.spacing.md}`,
              backgroundColor: autoTradeEnabled
                ? theme.colors.success
                : theme.colors.gray100,
              color: autoTradeEnabled
                ? theme.colors.white
                : theme.colors.gray700,
              border: 'none',
              borderRadius: theme.borderRadius.md,
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.sm,
              fontWeight: theme.typography.fontWeight.medium,
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.xs,
            }}
          >
            {autoTradeEnabled ? '● Auto-Trading ON' : '○ Auto-Trade'}
          </button>
        )}
      </div>

      {/* Price Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.md,
        }}
      >
        <span
          style={{
            fontSize: '2.5rem',
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.text,
          }}
        >
          {loading ? '--' : formatPrice(price)}
        </span>
        <span
          style={{
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.medium,
            color: changeInfo.color,
          }}
        >
          {loading ? '' : changeInfo.text}
        </span>
        {periodLabel && periodLabel !== 'today' && (
          <span
            style={{
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray500,
              marginLeft: theme.spacing.xs,
            }}
          >
            ({periodLabel})
          </span>
        )}
      </div>

      {/* Stats Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: theme.spacing.md,
          paddingTop: theme.spacing.md,
          borderTop: `1px solid ${theme.colors.gray200}`,
        }}
      >
        <QuoteStat label="Open" value={formatPrice(quote?.open)} />
        <QuoteStat label="High" value={formatPrice(quote?.high)} />
        <QuoteStat label="Low" value={formatPrice(quote?.low)} />
        <QuoteStat label="Prev Close" value={formatPrice(prevClose)} />
        <QuoteStat label="Volume" value={formatVolume(quote?.volume)} />

        {quote?.bid && quote?.ask && (
          <>
            <QuoteStat
              label="Bid"
              value={`${formatPrice(quote.bid)} x ${quote.bidSize || '--'}`}
            />
            <QuoteStat
              label="Ask"
              value={`${formatPrice(quote.ask)} x ${quote.askSize || '--'}`}
            />
            <QuoteStat
              label="Spread"
              value={formatPrice(quote.ask - quote.bid)}
            />
          </>
        )}
      </div>
    </div>
  );
};

const QuoteStat = ({ label, value }) => (
  <div>
    <div
      style={{
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.gray500,
        textTransform: 'uppercase',
        marginBottom: '2px',
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: theme.typography.fontSize.md,
        fontWeight: theme.typography.fontWeight.medium,
        color: theme.colors.text,
      }}
    >
      {value}
    </div>
  </div>
);

export default StockQuoteHeader;
