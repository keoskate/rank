import { memo } from 'react';
import { Link } from 'react-router-dom';
import theme from '../../theme';
import DotHistory from '../common/DotHistory';
import { PopBar } from './OptionsOpportunityTable';
import {
  betSentence,
  payoutIfHit,
  oddsPhrase,
  riskTier,
  worstCase,
  plainWarnings,
  expiresIn,
  fmtMoney,
  pricedForSwing,
  breakevenGap,
} from '../../utils/optionsPlainLanguage';

const TIER_COLORS = {
  success: theme.colors.successMuted,
  warning: theme.colors.warningMuted,
  error: theme.colors.errorMuted,
};

const DirectionChip = ({ direction }) => {
  const up = direction === 'LONG';
  return (
    <span style={{
      padding: '3px 10px',
      fontSize: '0.68rem',
      fontWeight: 700,
      letterSpacing: '0.12em',
      color: '#fff',
      background: up ? theme.colors.successMuted : theme.colors.errorMuted,
      borderRadius: theme.borderRadius.xs,
    }}>
      {up ? 'GOES UP' : 'GOES DOWN'}
    </span>
  );
};

const BigNumber = ({ label, children, accent }) => (
  <div>
    <div style={{
      fontSize: '0.62rem',
      fontWeight: 700,
      letterSpacing: '0.14em',
      color: theme.colors.gray500,
      textTransform: 'uppercase',
      marginBottom: 2,
    }}>
      {label}
    </div>
    <div style={{
      fontFamily: theme.typography.fontFamilyMono,
      fontSize: '1.25rem',
      fontWeight: 700,
      color: accent || theme.colors.charcoal,
      fontVariantNumeric: 'tabular-nums',
    }}>
      {children}
    </div>
  </div>
);

/** "NVDA now $531.20 (+0.8% today) — needs to climb 4.2% to break even" */
const PriceLine = ({ o }) => {
  const price = o.live?.stockPrice ?? o.underlyingPrice;
  if (!Number.isFinite(price)) return null;
  const chg = o.live?.stockChangeTodayPct;
  const gap = breakevenGap(o, price);
  const past = gap.gapPct != null && gap.gapPct <= 0;
  return (
    <div style={{ fontSize: '0.78rem', color: theme.colors.gray700, fontFamily: theme.typography.fontFamilyMono }}>
      {o.underlying} now <strong style={{ color: theme.colors.charcoal }}>${price.toFixed(2)}</strong>
      {Number.isFinite(chg) && (
        <span style={{ color: chg >= 0 ? theme.colors.successMuted : theme.colors.errorMuted }}>
          {' '}({chg >= 0 ? '+' : ''}{chg.toFixed(1)}% today)
        </span>
      )}
      {gap.phrase && (
        <span style={{ color: past ? theme.colors.successMuted : theme.colors.gray600 }}> — {gap.phrase}</span>
      )}
    </div>
  );
};

const SimpleCard = ({ o, onBuy }) => {
  const payout = payoutIfHit(o);
  // The "if it hits" payout is the value AT the scan's price target — a much
  // bigger move than clearing break-even. Surface the target + its move so the
  // multiple never reads as "the popModel% chance → this payout".
  const targetPx = Number.isFinite(o.targetPrice) ? Math.round(o.targetPrice) : null;
  const targetMovePct =
    Number.isFinite(o.targetPrice) && Number.isFinite(o.underlyingPrice) && o.underlyingPrice > 0
      ? Math.round((o.targetPrice / o.underlyingPrice - 1) * 100)
      : null;
  const bePx = Number.isFinite(o.breakeven) ? Math.round(o.breakeven) : null;
  const tier = riskTier(o);
  const worst = worstCase(o);
  const warnings = plainWarnings(o);
  const swingLine = pricedForSwing(o);

  return (
    <div style={{
      background: theme.colors.paper,
      border: `1px solid ${theme.colors.ruler}`,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing.sm,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link
          to={`/stock/${o.underlying}`}
          style={{ fontSize: '1.1rem', fontWeight: 700, color: theme.colors.charcoal, textDecoration: 'none' }}
        >
          {o.underlying}
        </Link>
        <DirectionChip direction={o.direction} />
      </div>

      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: theme.colors.charcoal }}>
        The bet: {betSentence(o)}
      </div>

      <PriceLine o={o} />

      {(o.live?.status === 'degraded' || o.live?.status === 'noQuote') && (
        <div style={{
          fontSize: '0.72rem',
          color: theme.colors.warningDark,
          background: theme.colors.warningLight,
          border: `1px solid ${theme.colors.warningBorder}`,
          borderRadius: theme.borderRadius.xs,
          padding: '3px 8px',
        }}>
          Live re-check {o.live.status === 'noQuote' ? 'found no quote' : 'flagged this contract'} — numbers may be stale
        </div>
      )}

      <div style={{ display: 'flex', gap: theme.spacing.xl }}>
        <BigNumber label="Ticket price">{fmtMoney(o.costPerContract)}</BigNumber>
        <BigNumber label={targetPx ? `If it hits $${targetPx}` : 'If target hits'} accent={theme.colors.successMuted}>
          ~{fmtMoney(payout.dollars)}
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.colors.gray600 }}>
            {' '}({payout.multiple.toFixed(1)}×)
          </span>
        </BigNumber>
      </div>
      {targetPx && (
        <div style={{ fontSize: '0.72rem', color: theme.colors.gray600, lineHeight: 1.45, marginTop: -4 }}>
          Best case — the payout if {o.underlying} reaches its ~${targetPx}
          {targetMovePct != null ? ` target (${targetMovePct >= 0 ? '+' : ''}${targetMovePct}%)` : ' target'}
          {bePx != null ? `, well past the $${bePx} break-even` : ''}. That's a far bigger
          move than the “chance to profit” below — which only needs it to clear break-even.
        </div>
      )}

      <div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.72rem',
          color: theme.colors.gray600,
          fontFamily: theme.typography.fontFamilyMono,
          marginBottom: 3,
        }}>
          <span>Chance to profit — us: <strong style={{ color: theme.colors.charcoal }}>{Math.round(o.popModel * 100)}%</strong></span>
          <span>market: {Math.round(o.popMarket * 100)}%</span>
        </div>
        <PopBar popModel={o.popModel} popMarket={o.popMarket} direction={o.direction} />
        <div style={{ fontSize: '0.72rem', color: theme.colors.gray600, marginTop: 3 }}>
          {oddsPhrase(o)}
        </div>
        {swingLine && (
          <div style={{ fontSize: '0.72rem', color: theme.colors.gray600, marginTop: 2 }}>
            {swingLine}
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${theme.colors.gray200}`, paddingTop: theme.spacing.sm }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: theme.colors.charcoal }}>
          {worst.sentence}
        </div>
        {warnings.length > 0 && (
          <ul style={{ margin: `${theme.spacing.xs} 0 0`, paddingLeft: 18 }}>
            {warnings.map(w => (
              <li key={w.text} style={{
                fontSize: '0.74rem',
                color: w.level === 'high' ? theme.colors.errorMuted : theme.colors.gray600,
                marginBottom: 2,
              }}>
                {w.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      <DotHistory recentDays={o.recentDays} />

      <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginTop: 'auto' }}>
        <span style={{
          padding: '3px 10px',
          fontSize: '0.68rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: '#fff',
          background: TIER_COLORS[tier.tone],
          borderRadius: theme.borderRadius.xs,
        }}>
          {tier.label}
        </span>
        <span style={{ fontSize: '0.72rem', color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono }}>
          {expiresIn(o)}
        </span>
        {onBuy && (
          <button
            onClick={() => onBuy(o)}
            style={{
              marginLeft: 'auto',
              padding: '6px 14px',
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#fff',
              background: theme.colors.charcoal,
              border: 'none',
              borderRadius: theme.borderRadius.xs,
              cursor: 'pointer',
            }}
          >
            Buy ticket · {fmtMoney(o.costPerContract)}
          </button>
        )}
      </div>
    </div>
  );
};

const OptionsSimpleCards = ({ opportunities = [], loading = false, onBuy = null }) => {
  if (loading && opportunities.length === 0) {
    return (
      <div style={{ padding: theme.spacing.xl, textAlign: 'center', color: theme.colors.gray500 }}>
        Checking the board…
      </div>
    );
  }
  if (!opportunities.length) {
    return (
      <div style={{
        padding: theme.spacing.xl,
        textAlign: 'center',
        color: theme.colors.gray500,
        fontSize: '0.85rem',
        background: theme.colors.parchment,
        border: `1px dashed ${theme.colors.ruler}`,
        borderRadius: theme.borderRadius.xs,
      }}>
        Nothing worth betting on right now. Most options are bad bets — we only show the good ones.
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      // min(380px, 100%) keeps narrow viewports to a single full-width
      // column instead of overflowing two-up.
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))',
      gap: theme.spacing.md,
    }}>
      {opportunities.map(o => <SimpleCard key={o.contractSymbol} o={o} onBuy={onBuy} />)}
    </div>
  );
};

export default memo(OptionsSimpleCards);
