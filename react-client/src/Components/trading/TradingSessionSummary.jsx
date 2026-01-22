/**
 * TradingSessionSummary
 *
 * Modal showing a complete summary of all trades for the current session.
 * Displays:
 * - High-level stats (total P&L, win rate, trade count)
 * - Detailed list of every trade with entry/exit info
 */

import theme from '../../theme';

const TradingSessionSummary = ({ isOpen, onClose, stats, trades, sessionName }) => {
  if (!isOpen) return null;

  // Group trades by symbol to pair buys with sells
  const tradesBySymbol = {};
  const sortedTrades = [...(trades || [])].sort(
    (a, b) => new Date(a.time || a.createdAt) - new Date(b.time || b.createdAt)
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
        const buyPrice = sell.price || 0;
        const sellPrice = matchingBuy.price || 0;
        const quantity = sell.quantity || matchingBuy.quantity || 0;
        const pnl = (sell.price - matchingBuy.price) * quantity;
        const pnlPercent = matchingBuy.price > 0
          ? ((sell.price - matchingBuy.price) / matchingBuy.price) * 100
          : 0;
        const holdTime = new Date(sell.time || sell.createdAt) - new Date(matchingBuy.time || matchingBuy.createdAt);
        const holdMinutes = Math.round(holdTime / 60000);

        roundTrips.push({
          symbol,
          buyPrice: matchingBuy.price,
          sellPrice: sell.price,
          quantity,
          pnl,
          pnlPercent,
          holdMinutes,
          buyTime: matchingBuy.time || matchingBuy.createdAt,
          sellTime: sell.time || sell.createdAt,
          isWin: pnl > 0,
        });
      }
    });

    // Add any unmatched buys as open positions
    buysCopy.forEach(buy => {
      roundTrips.push({
        symbol,
        buyPrice: buy.price,
        sellPrice: null,
        quantity: buy.quantity,
        pnl: null,
        pnlPercent: null,
        holdMinutes: null,
        buyTime: buy.time || buy.createdAt,
        sellTime: null,
        isOpen: true,
      });
    });
  });

  // Sort by time (most recent first)
  roundTrips.sort((a, b) => {
    const timeA = new Date(a.sellTime || a.buyTime);
    const timeB = new Date(b.sellTime || b.buyTime);
    return timeB - timeA;
  });

  // Calculate summary stats
  const completedTrades = roundTrips.filter(t => !t.isOpen);
  const wins = completedTrades.filter(t => t.pnl > 0);
  const losses = completedTrades.filter(t => t.pnl <= 0);
  const totalPnL = completedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
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
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatPrice = (price) => {
    if (price === null || price === undefined) return '-';
    return `$${price.toFixed(2)}`;
  };

  const formatPnL = (pnl, percent) => {
    if (pnl === null || pnl === undefined) return '-';
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toFixed(2)} (${sign}${percent?.toFixed(2) || 0}%)`;
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
          maxWidth: '800px',
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

        {/* Summary Stats */}
        <div
          style={{
            padding: theme.spacing.lg,
            backgroundColor: theme.colors.infoLight,
            borderBottom: `1px solid ${theme.colors.gray200}`,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: theme.spacing.lg,
            }}
          >
            <div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                Total P&L
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color: totalPnL >= 0 ? theme.colors.success : theme.colors.error,
                }}
              >
                {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                Win Rate
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color: winRate >= 50 ? theme.colors.success : theme.colors.warning,
                }}
              >
                {winRate}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                Trades
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xxl, fontWeight: theme.typography.fontWeight.bold }}>
                {completedTrades.length}
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                {wins.length}W / {losses.length}L
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                Avg Hold
              </div>
              <div style={{ fontSize: theme.typography.fontSize.xxl, fontWeight: theme.typography.fontWeight.bold }}>
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
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Sell</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>P&L</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Hold</th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray600 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {roundTrips.map((trade, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: `1px solid ${theme.colors.gray100}`,
                      backgroundColor: trade.isOpen
                        ? theme.colors.warningLight
                        : trade.isWin
                          ? 'rgba(34, 197, 94, 0.05)'
                          : 'rgba(239, 68, 68, 0.05)',
                    }}
                  >
                    <td style={{ padding: theme.spacing.sm, fontWeight: theme.typography.fontWeight.medium }}>
                      {trade.symbol}
                      {trade.isOpen && (
                        <span
                          style={{
                            marginLeft: theme.spacing.xs,
                            padding: '2px 6px',
                            backgroundColor: theme.colors.warning,
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
                      {formatPrice(trade.sellPrice)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: theme.spacing.sm,
                        fontWeight: theme.typography.fontWeight.medium,
                        color: trade.pnl > 0 ? theme.colors.success : trade.pnl < 0 ? theme.colors.error : theme.colors.gray600,
                      }}
                    >
                      {trade.isOpen ? '-' : formatPnL(trade.pnl, trade.pnlPercent)}
                    </td>
                    <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                      {trade.holdMinutes !== null ? `${trade.holdMinutes}m` : '-'}
                    </td>
                    <td style={{ textAlign: 'right', padding: theme.spacing.sm, color: theme.colors.gray500 }}>
                      {formatTime(trade.buyTime)}
                      {trade.sellTime && ` → ${formatTime(trade.sellTime)}`}
                    </td>
                  </tr>
                ))}
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
