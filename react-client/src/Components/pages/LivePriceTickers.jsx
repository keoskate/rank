import { useState, useEffect, useRef, memo } from 'react';
import theme from '../../theme';

const FLASH_MS = 450;

const fmtPrice = n => {
  if (n == null || !Number.isFinite(+n)) return '—';
  return `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtSigned = (n, opts = {}) => {
  const { pct = false, fixed = 2 } = opts;
  if (n == null || !Number.isFinite(+n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return pct ? `${sign}${n.toFixed(fixed)}%` : `${sign}${n.toFixed(fixed)}`;
};

const validNum = n => n != null && Number.isFinite(+n);

const labelStyle = {
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.22em',
  color: theme.colors.gray500,
  textTransform: 'uppercase',
};

const PositionLine = ({ position }) => {
  if (!position) {
    return (
      <div style={{ ...labelStyle, color: theme.colors.gray400 }}>
        NO POSITION
      </div>
    );
  }
  const hasCost = validNum(position.averageCost);
  const hasPnL = validNum(position.unrealizedPnL);
  const pnlColor = hasPnL && position.unrealizedPnL >= 0 ? theme.colors.successMuted : theme.colors.errorMuted;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontFamily: theme.typography.fontFamilyMono, fontVariantNumeric: 'tabular-nums' }}>
      <div>
        <div style={labelStyle}>POSITION</div>
        <div style={{ color: theme.colors.charcoal, fontWeight: 600, fontSize: '0.95rem' }}>
          {position.quantity}
          {hasCost && (
            <span style={{ color: theme.colors.gray500, fontWeight: 400 }}> @ {Number(position.averageCost).toFixed(2)}</span>
          )}
        </div>
      </div>
      {hasPnL && (
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ ...labelStyle }}>UNREALIZED</div>
          <div style={{ color: pnlColor, fontWeight: 700, fontSize: '0.95rem' }}>
            {fmtSigned(position.unrealizedPnL)}
            {validNum(position.unrealizedPnLPercent) && (
              <span style={{ marginLeft: 6, fontWeight: 500, fontSize: '0.8rem' }}>
                ({fmtSigned(position.unrealizedPnLPercent, { pct: true })})
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Ticker = memo(({ symbol, state, openPrice, position, index }) => {
  const price = state?.price;
  const lastTickAt = state?.lastTickAt;
  const flashDir = state?.flashDir;

  const change = validNum(price) && validNum(openPrice) ? price - openPrice : null;
  const changePct = change != null && openPrice ? (change / openPrice) * 100 : null;
  const up = change != null ? change >= 0 : null;
  const accent = up == null
    ? theme.colors.gray500
    : up ? theme.colors.successMuted : theme.colors.errorMuted;

  const flashBorder =
    flashDir === 'up' ? theme.colors.success
    : flashDir === 'down' ? theme.colors.error
    : theme.colors.ruler;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 320,
        position: 'relative',
        padding: '20px 24px 18px',
        background: theme.colors.parchment,
        border: `1px solid ${flashBorder}`,
        borderRadius: theme.borderRadius.xs,
        transition: `border-color ${FLASH_MS}ms ease-out`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 3,
          height: '100%',
          background: accent,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ ...labelStyle, color: theme.colors.gray400, fontSize: '0.7rem' }}>
            {String(index ?? 0).padStart(2, '0')}
          </span>
          <span style={{ fontSize: '1rem', fontWeight: 800, letterSpacing: '0.14em', color: theme.colors.charcoal }}>
            {symbol}
          </span>
        </div>
        <div
          style={{
            fontSize: '0.65rem',
            color: theme.colors.gray500,
            fontFamily: theme.typography.fontFamilyMono,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {lastTickAt ? new Date(lastTickAt).toLocaleTimeString('en-US', { hour12: false }) : 'AWAITING TICK'}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: '3.5rem',
            lineHeight: 1.0,
            fontWeight: 700,
            fontFamily: theme.typography.fontFamilyMono,
            color: theme.colors.charcoal,
            letterSpacing: '-0.025em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmtPrice(price)}
        </div>
        <div
          style={{
            fontSize: '0.95rem',
            fontFamily: theme.typography.fontFamilyMono,
            color: accent,
            fontWeight: 700,
            letterSpacing: '0.02em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <div>{fmtSigned(change)}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: 2 }}>
            {fmtSigned(changePct, { pct: true })}
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${theme.colors.ruler}`, paddingTop: 12 }}>
        <PositionLine position={position} />
      </div>
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
    <div style={{ display: 'flex', gap: theme.spacing.md, flexWrap: 'wrap' }}>
      {symbols.map((sym, idx) => (
        <Ticker
          key={sym}
          symbol={sym}
          state={prices[sym]}
          openPrice={opens[sym]}
          position={positions.find(p => p.symbol === sym)}
          index={idx + 1}
        />
      ))}
    </div>
  );
};

export default memo(LivePriceTickers);
