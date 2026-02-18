/**
 * StandardOrderForm - Professional order entry form
 * Supports market and limit orders with real-time cost calculation
 */

import { useState, useEffect } from 'react';
import theme from '../../theme';
import Button from '../common/Button';

const StandardOrderForm = ({
  symbol,
  currentPrice = 0,
  onSubmitOrder,
  compact = false,
}) => {
  const [orderType, setOrderType] = useState('market');
  const [side, setSide] = useState('buy');
  const [quantity, setQuantity] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset limit price when order type changes
  useEffect(() => {
    if (orderType === 'market') {
      setLimitPrice('');
    } else if (currentPrice) {
      setLimitPrice(currentPrice.toFixed(2));
    }
  }, [orderType, currentPrice]);

  const effectivePrice =
    orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : currentPrice;

  const qty = parseInt(quantity) || 0;
  const estimatedTotal = qty * effectivePrice;

  const handleSubmit = async e => {
    e.preventDefault();
    if (!symbol || !qty || qty <= 0) {
      setError('Please enter a valid quantity');
      return;
    }

    if (orderType === 'limit' && (!limitPrice || parseFloat(limitPrice) <= 0)) {
      setError('Please enter a valid limit price');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const order = {
        symbol,
        side,
        type: orderType,
        qty,
        ...(orderType === 'limit' && { limit_price: parseFloat(limitPrice) }),
      };

      if (onSubmitOrder) {
        await onSubmitOrder(order);
      } else {
        // Default: submit to paper trading API
        const res = await fetch('/api/alpaca/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Order failed');
        }
      }

      // Reset form on success
      setQuantity('');
      setLimitPrice('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: theme.spacing.sm,
    fontSize: theme.typography.fontSize.md,
    border: `1px solid ${theme.colors.gray300}`,
    borderRadius: theme.borderRadius.md,
    outline: 'none',
    transition: theme.transitions.fast,
  };

  const labelStyle = {
    display: 'block',
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.gray600,
    marginBottom: theme.spacing.xs,
    fontWeight: theme.typography.fontWeight.medium,
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: compact ? theme.spacing.md : theme.spacing.lg,
        boxShadow: theme.shadows.sm,
      }}
    >
      {!compact && (
        <h3
          style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold,
          }}
        >
          Trade {symbol}
        </h3>
      )}

      {/* Buy/Sell Toggle */}
      <div
        style={{
          display: 'flex',
          marginBottom: theme.spacing.md,
          borderRadius: theme.borderRadius.md,
          overflow: 'hidden',
          border: `1px solid ${theme.colors.gray300}`,
        }}
      >
        <button
          type="button"
          onClick={() => setSide('buy')}
          style={{
            flex: 1,
            padding: theme.spacing.sm,
            border: 'none',
            backgroundColor:
              side === 'buy' ? theme.colors.success : theme.colors.surface,
            color: side === 'buy' ? theme.colors.white : theme.colors.gray600,
            fontWeight: theme.typography.fontWeight.bold,
            cursor: 'pointer',
            transition: theme.transitions.fast,
          }}
        >
          BUY
        </button>
        <button
          type="button"
          onClick={() => setSide('sell')}
          style={{
            flex: 1,
            padding: theme.spacing.sm,
            border: 'none',
            borderLeft: `1px solid ${theme.colors.gray300}`,
            backgroundColor:
              side === 'sell' ? theme.colors.error : theme.colors.surface,
            color: side === 'sell' ? theme.colors.white : theme.colors.gray600,
            fontWeight: theme.typography.fontWeight.bold,
            cursor: 'pointer',
            transition: theme.transitions.fast,
          }}
        >
          SELL
        </button>
      </div>

      {/* Order Type */}
      <div style={{ marginBottom: theme.spacing.md }}>
        <label style={labelStyle}>Order Type</label>
        <select
          value={orderType}
          onChange={e => setOrderType(e.target.value)}
          style={{
            ...inputStyle,
            backgroundColor: theme.colors.surface,
            cursor: 'pointer',
          }}
        >
          <option value="market">Market</option>
          <option value="limit">Limit</option>
        </select>
      </div>

      {/* Quantity */}
      <div style={{ marginBottom: theme.spacing.md }}>
        <label style={labelStyle}>Shares</label>
        <input
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          placeholder="0"
          style={inputStyle}
        />
      </div>

      {/* Limit Price (conditional) */}
      {orderType === 'limit' && (
        <div style={{ marginBottom: theme.spacing.md }}>
          <label style={labelStyle}>Limit Price</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={limitPrice}
            onChange={e => setLimitPrice(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </div>
      )}

      {/* Estimated Total */}
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
            {orderType === 'market' ? 'Market Price' : 'Limit Price'}
          </span>
          <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
            ${effectivePrice.toFixed(2)}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold,
          }}
        >
          <span>Est. {side === 'buy' ? 'Cost' : 'Proceeds'}</span>
          <span
            style={{
              color: side === 'buy' ? theme.colors.error : theme.colors.success,
            }}
          >
            ${estimatedTotal.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            color: theme.colors.error,
            fontSize: theme.typography.fontSize.sm,
            marginBottom: theme.spacing.md,
            padding: theme.spacing.sm,
            backgroundColor: `${theme.colors.error}10`,
            borderRadius: theme.borderRadius.sm,
          }}
        >
          {error}
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        variant={side === 'buy' ? 'success' : 'danger'}
        disabled={submitting || !qty}
        style={{ width: '100%' }}
      >
        {submitting
          ? 'Submitting...'
          : `${side.toUpperCase()} ${qty || 0} ${symbol}`}
      </Button>

      {/* Paper Trading Notice */}
      <div
        style={{
          marginTop: theme.spacing.sm,
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.gray500,
          textAlign: 'center',
        }}
      >
        Paper Trading Mode
      </div>
    </form>
  );
};

export default StandardOrderForm;
