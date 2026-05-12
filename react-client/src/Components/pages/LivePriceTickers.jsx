import { useState, useEffect, useRef, memo } from 'react';
import theme from '../../theme';
import Card from '../common/Card';

const FLASH_MS = 400;

const fmtPrice = n => {
  if (n == null || !Number.isFinite(+n)) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtChange = (n, pct = false) => {
  if (n == null || !Number.isFinite(+n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return pct ? `${sign}${n.toFixed(2)}%` : `${sign}${n.toFixed(2)}`;
};

const Ticker = memo(({ symbol, state, openPrice, position }) => {
  const price = state?.price;
  const lastTickAt = state?.lastTickAt;
  const flashDir = state?.flashDir;

  const change = price != null && openPrice != null ? price - openPrice : null;
  const changePct = change != null && openPrice ? (change / openPrice) * 100 : null;
  const up = change != null ? change >= 0 : null;
  const color = up == null ? theme.colors.gray700 : up ? theme.colors.success : theme.colors.error;
  const flashBg =
    flashDir === 'up' ? theme.colors.successLight : flashDir === 'down' ? theme.colors.errorLight : 'transparent';

  const positionRow = position ? (
    <div
      style={{
        fontFamily: 'monospace',
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.gray700,
        marginTop: 6,
        paddingTop: 6,
        borderTop: `1px solid ${theme.colors.gray200}`,
      }}
    >
      {position.quantity}@${Number(position.averageCost).toFixed(2)} •{' '}
      <span style={{ color: position.unrealizedPnL >= 0 ? theme.colors.success : theme.colors.error, fontWeight: 600 }}>
        {fmtChange(position.unrealizedPnL)}$ ({fmtChange(position.unrealizedPnLPercent, true)})
      </span>
    </div>
  ) : (
    <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray400, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${theme.colors.gray200}` }}>
      no position
    </div>
  );

  return (
    <div
      style={{
        flex: 1,
        minWidth: 200,
        padding: theme.spacing.sm,
        background: flashBg,
        borderRadius: 6,
        transition: `background ${FLASH_MS}ms ease-out`,
        border: `1px solid ${theme.colors.gray200}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: theme.typography.fontSize.md }}>{symbol}</div>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: 'monospace' }}>
          {lastTickAt ? new Date(lastTickAt).toLocaleTimeString('en-US', { hour12: false }) : '—'}
        </div>
      </div>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, fontFamily: 'monospace', color, marginTop: 2 }}>
        {fmtPrice(price)}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: theme.typography.fontSize.sm, color, fontWeight: 600 }}>
        {fmtChange(change)} ({fmtChange(changePct, true)})
      </div>
      {positionRow}
    </div>
  );
});

const LivePriceTickers = ({ socket, symbols = ['SOXL', 'SOXS'], positions = [] }) => {
  const [prices, setPrices] = useState({});
  const [opens, setOpens] = useState({});
  const flashTimers = useRef({});

  useEffect(() => {
    if (!socket) return;
    socket.emit('subscribe_prices', { symbols });

    const onPriceUpdate = data => {
      const symbol = data.symbol;
      if (!symbols.includes(symbol)) return;
      setPrices(prev => {
        const previous = prev[symbol]?.price;
        let flashDir = null;
        if (previous != null) {
          if (data.price > previous) flashDir = 'up';
          else if (data.price < previous) flashDir = 'down';
        }
        // Schedule flash clear
        if (flashDir) {
          clearTimeout(flashTimers.current[symbol]);
          flashTimers.current[symbol] = setTimeout(() => {
            setPrices(p => ({ ...p, [symbol]: { ...p[symbol], flashDir: null } }));
          }, FLASH_MS);
        }
        return {
          ...prev,
          [symbol]: { price: data.price, lastTickAt: data.timestamp || new Date().toISOString(), flashDir },
        };
      });
      setOpens(prev => (prev[symbol] != null ? prev : { ...prev, [symbol]: data.price }));
    };

    socket.on('price_update', onPriceUpdate);

    return () => {
      socket.emit('unsubscribe_prices', { symbols });
      socket.off('price_update', onPriceUpdate);
      Object.values(flashTimers.current).forEach(clearTimeout);
    };
  }, [socket, symbols]);

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          gap: theme.spacing.sm,
          flexWrap: 'wrap',
        }}
      >
        {symbols.map(sym => (
          <Ticker
            key={sym}
            symbol={sym}
            state={prices[sym]}
            openPrice={opens[sym]}
            position={positions.find(p => p.symbol === sym)}
          />
        ))}
      </div>
    </Card>
  );
};

export default memo(LivePriceTickers);
