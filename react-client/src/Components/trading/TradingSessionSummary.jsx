/**
 * TradingSessionSummary
 *
 * Modal showing a complete summary of all trades for the current session.
 * Displays:
 * - Realized P&L (locked in profits from closed trades) - GREEN
 * - Unrealized P&L (paper profits from open positions) - YELLOW
 * - Detailed list of every trade with entry/exit info
 * - Click to expand any trade row to see entry/exit reasoning
 */

import React, { useState } from 'react';
import theme from '../../theme';

const TradingSessionSummary = ({ isOpen, onClose, stats, trades, positions, sessionName, decisions = [] }) => {
  const [expandedRows, setExpandedRows] = useState({});

  if (!isOpen) return null;

  // Toggle expanded state for a row
  const toggleRow = (idx) => {
    setExpandedRows(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Find matching decisions for a trade (buy and sell decisions)
  const findDecisionsForTrade = (trade) => {
    const buyDecision = decisions.find(d =>
      d.symbol === trade.symbol &&
      d.action === 'BUY' &&
      d.shouldEnter
    );
    const sellDecision = decisions.find(d =>
      d.symbol === trade.symbol &&
      d.action === 'SELL' &&
      d.shouldExit
    );
    return { buyDecision, sellDecision };
  };

  // Create maps of current prices and unrealized P&L from positions (using Alpaca's data)
  const currentPrices = {};
  const positionUnrealizedPnL = {};
  (positions || []).forEach(pos => {
    const currentPrice = pos.currentPrice || pos.current_price ||
      (pos.market_value && pos.qty ? pos.market_value / pos.qty : null) ||
      (pos.marketValue && pos.qty ? pos.marketValue / pos.qty : null);
    currentPrices[pos.symbol] = currentPrice;
    // Use Alpaca's pre-calculated unrealized P&L (more accurate)
    positionUnrealizedPnL[pos.symbol] = parseFloat(pos.unrealizedPL || pos.unrealized_pl || 0);
  });

  // Calculate total unrealized P&L directly from positions (most accurate)
  const totalUnrealizedFromPositions = (positions || []).reduce((sum, pos) => {
    return sum + parseFloat(pos.unrealizedPL || pos.unrealized_pl || 0);
  }, 0);

  // Helper to get trade timestamp (API uses various field names)
  const getTradeTime = (trade) => trade.timestamp || trade.time || trade.createdAt || trade.filled_at;

  // Group trades by symbol to pair buys with sells
  const tradesBySymbol = {};
  const sortedTrades = [...(trades || [])].sort(
    (a, b) => new Date(getTradeTime(a)) - new Date(getTradeTime(b))
  );

  sortedTrades.forEach(trade => {
    if (!tradesBySymbol[trade.symbol]) {
      tradesBySymbol[trade.symbol] = { buys: [], sells: [] };
    }
    if (trade.side === 'buy') {
      tradesBySymbol[trade.symbol].buys.push(trade);
    } else {
      tradesBySymbol[trade.symbol].sells.push(trade);
    }
  });

  // Calculate round-trip trades (buy + sell pairs)
  const roundTrips = [];
  Object.entries(tradesBySymbol).forEach(([symbol, { buys, sells }]) => {
    // Match buys with sells chronologically
    const buysCopy = [...buys];
    sells.forEach(sell => {
      const matchingBuy = buysCopy.shift();
      if (matchingBuy) {
        const quantity = sell.quantity || matchingBuy.quantity || 0;
        const pnl = (sell.price - matchingBuy.price) * quantity;
        const pnlPercent = matchingBuy.price > 0
          ? ((sell.price - matchingBuy.price) / matchingBuy.price) * 100
          : 0;
        const buyTimeStr = getTradeTime(matchingBuy);
        const sellTimeStr = getTradeTime(sell);
        const holdTime = new Date(sellTimeStr) - new Date(buyTimeStr);
        const holdMinutes = Math.round(holdTime / 60000);

        roundTrips.push({
          symbol,
          buyPrice: matchingBuy.price,
          sellPrice: sell.price,
          quantity,
          pnl,
          pnlPercent,
          holdMinutes: isNaN(holdMinutes) ? null : holdMinutes,
          buyTime: buyTimeStr,
          sellTime: sellTimeStr,
          isWin: pnl > 0,
        });
      }
    });

    // Add any unmatched buys as open positions
    buysCopy.forEach(buy => {
      const currentPrice = currentPrices[symbol] || 0;
      // Calculate unrealized P&L for this specific buy
      const unrealizedPnl = currentPrice > 0 ? (currentPrice - buy.price) * buy.quantity : null;
      const unrealizedPnlPercent = currentPrice > 0 && buy.price > 0
        ? ((currentPrice - buy.price) / buy.price) * 100
        : null;

      // Calculate hold time for open positions (from buy time to now)
      const buyTimeStr = getTradeTime(buy);
      const holdTime = buyTimeStr ? (new Date() - new Date(buyTimeStr)) : null;
      const holdMinutes = holdTime ? Math.round(holdTime / 60000) : null;

      roundTrips.push({
        symbol,
        buyPrice: buy.price,
        currentPrice: currentPrice || null,
        sellPrice: null,
        quantity: buy.quantity,
        pnl: unrealizedPnl,
        pnlPercent: unrealizedPnlPercent,
        holdMinutes: (holdMinutes !== null && !isNaN(holdMinutes)) ? holdMinutes : null,
        buyTime: buyTimeStr,
        sellTime: null,
        isOpen: true,
      });
    });
  });

  // Update open trade P&L values from positions if available (more accurate)
  // This handles cases where multiple buys exist for same symbol
  roundTrips.forEach(trade => {
    if (trade.isOpen && positionUnrealizedPnL[trade.symbol] !== undefined) {
      // If we have position data but couldn't calculate from trade, use position data
      if (trade.pnl === null && currentPrices[trade.symbol]) {
        trade.currentPrice = currentPrices[trade.symbol];
        trade.pnl = (trade.currentPrice - trade.buyPrice) * trade.quantity;
        trade.pnlPercent = ((trade.currentPrice - trade.buyPrice) / trade.buyPrice) * 100;
      }
    }
  });

  // Sort by time (most recent first)
  roundTrips.sort((a, b) => {
    const timeA = new Date(a.sellTime || a.buyTime);
    const timeB = new Date(b.sellTime || b.buyTime);
    return timeB - timeA;
  });

  // Calculate summary stats
  const completedTrades = roundTrips.filter(t => !t.isOpen);
  const openTrades = roundTrips.filter(t => t.isOpen);
  const wins = completedTrades.filter(t => t.pnl > 0);
  const losses = completedTrades.filter(t => t.pnl <= 0);

  // Realized P&L = completed trades only
  const realizedPnL = completedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Unrealized P&L = use Alpaca's pre-calculated values (most accurate)
  // This is more reliable than calculating from trades because Alpaca has real-time prices
  const unrealizedPnL = totalUnrealizedFromPositions;

  // Total P&L
  const totalPnL = realizedPnL + unrealizedPnL;

  const winRate = completedTrades.length > 0
    ? Math.round((wins.length / completedTrades.length) * 100)
    : 0;
  const avgHoldTime = completedTrades.length > 0
    ? Math.round(completedTrades.reduce((sum, t) => sum + (t.holdMinutes || 0), 0) / completedTrades.length)
    : 0;
  const bestTrade = completedTrades.length > 0
    ? completedTrades.reduce((best, t) => (t.pnl > (best?.pnl || -Infinity) ? t : best), null)
    : null;
  const worstTrade = completedTrades.length > 0
    ? completedTrades.reduce((worst, t) => (t.pnl < (worst?.pnl || Infinity) ? t : worst), null)
    : null;

  const formatTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles'
    });
  };

  const formatPrice = (price) => {
    if (price === null || price === undefined) return '-';
    return `$${price.toFixed(2)}`;
  };

  const formatPnL = (pnl, percent) => {
    if (pnl === null || pnl === undefined) return '-';
    const sign = pnl >= 0 ? '+$' : '-$';
    const percentSign = percent >= 0 ? '+' : '-';
    return `${sign}${Math.abs(pnl).toFixed(2)} (${percentSign}${Math.abs(percent || 0).toFixed(2)}%)`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.borderRadius.lg,
          width: '90%',
          maxWidth: '900px',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: theme.spacing.lg,
            borderBottom: `1px solid ${theme.colors.gray200}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: theme.typography.fontSize.xl }}>
              Session Summary
            </h2>
            <span style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
              {sessionName || 'Current Session'} - {new Date().toLocaleDateString()}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: theme.colors.gray500,
              padding: theme.spacing.sm,
            }}
          >
            ×
          </button>
        </div>

        {/* P&L Summary - Realized vs Unrealized */}
        <div
          style={{
            padding: theme.spacing.lg,
            backgroundColor: theme.colors.gray50,
            borderBottom: `1px solid ${theme.colors.gray200}`,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: theme.spacing.lg,
              marginBottom: theme.spacing.md,
            }}
          >
            {/* Realized P&L */}
            <div
              style={{
                padding: theme.spacing.md,
                backgroundColor: realizedPnL >= 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                borderRadius: theme.borderRadius.md,
                border: `1px solid ${realizedPnL >= 0 ? theme.colors.success : theme.colors.error}`,
              }}
            >
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600, marginBottom: '4px' }}>
                Realized P&L
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color: realizedPnL >= 0 ? theme.colors.success : theme.colors.error,
                }}
              >
                {realizedPnL >= 0 ? '+$' : '-$'}{Math.abs(realizedPnL).toFixed(2)}
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                Locked in from {completedTrades.length} closed trade{completedTrades.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Unrealized P&L - Yellow/amber for gains, Red/orange for losses */}
            <div
              style={{
                padding: theme.spacing.md,
                backgroundColor: unrealizedPnL >= 0 ? 'rgba(234, 179, 8, 0.15)' : 'rgba(239, 68, 68, 0.1)',
                borderRadius: theme.borderRadius.md,
                border: `1px solid ${unrealizedPnL >= 0 ? '#eab308' : theme.colors.error}`,
              }}
            >
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600, marginBottom: '4px' }}>
                Unrealized P&L
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color: unrealizedPnL >= 0 ? '#b45309' : theme.colors.error,
                }}
              >
                {unrealizedPnL >= 0 ? '+$' : '-$'}{Math.abs(unrealizedPnL).toFixed(2)}
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                {unrealizedPnL >= 0 ? 'Paper profit' : 'Paper loss'} from {openTrades.length} open position{openTrades.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Total P&L */}
            <div
              style={{
                padding: theme.spacing.md,
                backgroundColor: theme.colors.infoLight,
                borderRadius: theme.borderRadius.md,
                border: `1px solid ${theme.colors.infoBorder}`,
              }}
            >
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600, marginBottom: '4px' }}>
                Total P&L
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color: totalPnL >= 0 ? theme.colors.success : theme.colors.error,
                }}
              >
                {totalPnL >= 0 ? '+$' : '-$'}{Math.abs(totalPnL).toFixed(2)}
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                Realized + Unrealized
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: theme.spacing.md,
              paddingTop: theme.spacing.md,
              borderTop: `1px solid ${theme.colors.gray200}`,
            }}
          >
            <div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                Win Rate
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color: winRate >= 50 ? theme.colors.success : theme.colors.warning,
                }}
              >
                {winRate}%
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                {wins.length}W / {losses.length}L
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                Closed Trades
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xl, fontWeight: theme.typography.fontWeight.bold }}>
                {completedTrades.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                Avg Hold Time
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xl, fontWeight: theme.typography.fontWeight.bold }}>
                {avgHoldTime}m
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                Best / Worst
              </div>
              <div style={{ fontSize: theme.typography.fontSize.sm }}>
                <span style={{ color: theme.colors.success }}>
                  {bestTrade ? `+$${bestTrade.pnl.toFixed(2)}` : '-'}
                </span>
                {' / '}
                <span style={{ color: theme.colors.error }}>
                  {worstTrade ? `$${worstTrade.pnl.toFixed(2)}` : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Trade List */}
        <div style={{ flex: 1, overflow: 'auto', padding: theme.spacing.lg }}>
          <h3 style={{ margin: 0, marginBottom: theme.spacing.md, fontSize: theme.typography.fontSize.md }}>
            All Trades ({roundTrips.length})
          </h3>

          {roundTrips.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: theme.spacing.xl,
                color: theme.colors.gray500,
              }}
            >
              No trades yet today
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${theme.colors.gray200}` }}>
                  <th style={{ textAlign: 'left', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Symbol</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Buy</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Sell / Current</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>P&L</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Hold</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {roundTrips.map((trade, idx) => {
                  const { buyDecision, sellDecision } = findDecisionsForTrade(trade);
                  const isExpanded = expandedRows[idx];
                  const hasDecisionData = buyDecision || sellDecision;

                  return (
                    <React.Fragment key={idx}>
                      <tr
                        onClick={() => toggleRow(idx)}
                        style={{
                          borderBottom: isExpanded ? 'none' : `1px solid ${theme.colors.gray100}`,
                          backgroundColor: trade.isOpen
                            ? 'rgba(139, 92, 246, 0.08)'
                            : trade.isWin
                              ? 'rgba(34, 197, 94, 0.05)'
                              : 'rgba(239, 68, 68, 0.05)',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ padding: theme.spacing.sm, fontWeight: theme.typography.fontWeight.medium }}>
                          <span style={{ marginRight: theme.spacing.xs, color: theme.colors.gray400 }}>
                            {isExpanded ? '▼' : '▶'}
                          </span>
                          {trade.symbol}
                          {trade.isOpen && (
                            <span
                              style={{
                                marginLeft: theme.spacing.xs,
                                padding: '2px 6px',
                                backgroundColor: '#8b5cf6',
                                color: 'white',
                                borderRadius: theme.borderRadius.sm,
                                fontSize: theme.typography.fontSize.xs,
                              }}
                            >
                              OPEN
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {trade.quantity}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {formatPrice(trade.buyPrice)}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {trade.isOpen ? (
                            <span style={{ color: trade.pnl >= 0 ? theme.colors.success : theme.colors.error }}>
                              {formatPrice(trade.currentPrice)}
                            </span>
                          ) : (
                            formatPrice(trade.sellPrice)
                          )}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            padding: theme.spacing.sm,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: trade.pnl > 0
                              ? theme.colors.success
                              : trade.pnl < 0
                                ? theme.colors.error
                                : theme.colors.gray600,
                          }}
                        >
                          {formatPnL(trade.pnl, trade.pnlPercent)}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {trade.holdMinutes !== null && !isNaN(trade.holdMinutes) ? `${trade.holdMinutes}m` : '-'}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray500 }}>
                          {formatTime(trade.buyTime)}
                          {trade.sellTime && ` → ${formatTime(trade.sellTime)}`}
                        </td>
                      </tr>

                      {/* Expanded Details Row */}
                      {isExpanded && (
                        <tr key={`${idx}-details`} style={{ backgroundColor: theme.colors.gray50 }}>
                          <td colSpan={7} style={{ padding: theme.spacing.md }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.spacing.lg }}>
                              {/* Entry Details */}
                              <div>
                                <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.success, fontSize: theme.typography.fontSize.sm }}>
                                  Entry Reason
                                </h4>
                                {buyDecision ? (
                                  <div style={{ fontSize: theme.typography.fontSize.sm }}>
                                    <div style={{ marginBottom: theme.spacing.xs }}>
                                      <strong>Confidence:</strong> {buyDecision.confidence}%
                                    </div>
                                    <div style={{ marginBottom: theme.spacing.xs }}>
                                      <strong>Signals:</strong>
                                    </div>
                                    <ul style={{ margin: 0, paddingLeft: theme.spacing.md, color: theme.colors.gray600 }}>
                                      {(buyDecision.reasons || []).slice(0, 5).map((reason, i) => (
                                        <li key={i} style={{ marginBottom: '2px' }}>{reason}</li>
                                      ))}
                                    </ul>
                                    {buyDecision.indicators && (
                                      <div style={{ marginTop: theme.spacing.sm, color: theme.colors.gray500, fontSize: theme.typography.fontSize.xs }}>
                                        RSI: {buyDecision.indicators.rsi?.toFixed(1)} |
                                        MACD: {buyDecision.indicators.macd?.toFixed(3)} |
                                        VWAP: {buyDecision.indicators.vwapDeviation?.toFixed(2)}%
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
                                    No entry decision data available
                                  </div>
                                )}
                              </div>

                              {/* Exit Details */}
                              <div>
                                <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: trade.isOpen ? theme.colors.gray500 : theme.colors.error, fontSize: theme.typography.fontSize.sm }}>
                                  {trade.isOpen ? 'Still Holding' : 'Exit Reason'}
                                </h4>
                                {trade.isOpen ? (
                                  <div style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
                                    Position is still open. No exit triggered yet.
                                  </div>
                                ) : sellDecision ? (
                                  <div style={{ fontSize: theme.typography.fontSize.sm }}>
                                    <div style={{ marginBottom: theme.spacing.xs, color: theme.colors.error, fontWeight: theme.typography.fontWeight.medium }}>
                                      {sellDecision.exitReason || 'Exit signal triggered'}
                                    </div>
                                    <div style={{ marginBottom: theme.spacing.xs }}>
                                      <strong>Exit Score:</strong> {sellDecision.exitScore}
                                    </div>
                                    <div style={{ marginBottom: theme.spacing.xs }}>
                                      <strong>Factors:</strong>
                                    </div>
                                    <ul style={{ margin: 0, paddingLeft: theme.spacing.md, color: theme.colors.gray600 }}>
                                      {(sellDecision.reasons || []).slice(0, 5).map((reason, i) => (
                                        <li key={i} style={{ marginBottom: '2px' }}>{reason}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : (
                                  <div style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
                                    No exit decision data available (may have been a quick trade or manual exit)
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: theme.spacing.md,
            borderTop: `1px solid ${theme.colors.gray200}`,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
              backgroundColor: theme.colors.gray700,
              color: 'white',
              border: 'none',
              borderRadius: theme.borderRadius.md,
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.base,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradingSessionSummary;
