/**
 * Semiconductor Sentiment Panel
 *
 * Visualizes SOXX-based sentiment for SOXL/SOXS momentum trading: direction,
 * confidence, market phase, dynamic thresholds, active signals, and the
 * (real, data-grounded) Claude analysis. Styled with the shared design system
 * (theme + Card) so it matches the rest of the Command Center.
 */

import React, { useState, useEffect, useCallback } from 'react';
import theme from '../../theme';
import Card from '../common/Card';
import { fmtET } from '../../utils/timeFormat';

// ── color helpers ──────────────────────────────────────────────────────────
const dirColor = d =>
  d === 'bullish'
    ? theme.colors.success
    : d === 'bearish'
      ? theme.colors.error
      : theme.colors.warningDark;

const confColor = (confidence, direction) => {
  if (confidence >= 75) return dirColor(direction);
  if (confidence >= 55) return theme.colors.warningDark;
  return theme.colors.error;
};

const phaseColor = phase =>
  ({
    ACTIVE: theme.colors.success,
    WIND_DOWN: theme.colors.warningDark,
    CLOSE: theme.colors.error,
    OPEN: theme.colors.warningDark,
    SETTLE: theme.colors.warningDark,
    PRE_MARKET: theme.colors.gray500,
    AFTER_HOURS: theme.colors.gray500,
    CLOSED: theme.colors.gray400,
  })[phase] || theme.colors.gray500;

// ── shared inline styles ───────────────────────────────────────────────────
const s = {
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: theme.spacing.md,
  },
  title: { margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold },
  meta: { fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono },
  btn: {
    background: 'transparent',
    border: `1px solid ${theme.colors.gray300}`,
    borderRadius: theme.borderRadius.sm,
    padding: '5px 10px',
    color: theme.colors.gray700,
    cursor: 'pointer',
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  statCard: {
    backgroundColor: theme.colors.gray100,
    border: `1px solid ${theme.colors.gray200}`,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing.sm,
  },
  label: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 6,
  },
  statValue: { fontSize: theme.typography.fontSize.xl, fontWeight: theme.typography.fontWeight.bold, fontVariantNumeric: 'tabular-nums' },
  subtext: { fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600, marginTop: 4, fontFamily: theme.typography.fontFamilyMono },
  section: { marginBottom: theme.spacing.md },
};

const Section = ({ label, right, children }) => (
  <div style={s.section}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
      <span style={s.label}>{label}</span>
      {right}
    </div>
    {children}
  </div>
);

const SemiconductorSentimentPanel = ({ onPresetSelect }) => {
  const [sentiment, setSentiment] = useState(null);
  const [phase, setPhase] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchSentiment = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const [sentimentRes, phaseRes, aiRes] = await Promise.all([
        fetch(`/api/semiconductor/sentiment${forceRefresh ? '?refresh=true' : ''}`),
        fetch('/api/semiconductor/phase'),
        fetch('/api/semiconductor/ai-analysis'),
      ]);
      setSentiment(await sentimentRes.json());
      setPhase(await phaseRes.json());
      setAiAnalysis(await aiRes.json());
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerAIAnalysis = async () => {
    try {
      const response = await fetch('/api/semiconductor/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual' }),
      });
      const data = await response.json();
      if (data.sentiment) setSentiment(data.sentiment);
      if (data.analysis) setAiAnalysis({ available: true, analysis: data.analysis });
      setLastUpdate(new Date());
    } catch (err) {
      console.error('AI analysis failed:', err);
    }
  };

  useEffect(() => {
    fetchSentiment();
    const interval = setInterval(() => fetchSentiment(), 30000);
    return () => clearInterval(interval);
  }, [fetchSentiment]);

  if (loading && !sentiment) {
    return (
      <Card padding="large">
        <div style={{ textAlign: 'center', padding: theme.spacing.xl, color: theme.colors.gray500 }}>
          Loading semiconductor sentiment…
        </div>
      </Card>
    );
  }

  if (error && !sentiment) {
    return (
      <Card variant="error" padding="large">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: theme.typography.fontSize.base, marginBottom: theme.spacing.sm, color: theme.colors.errorDark }}>
            Failed to load sentiment
          </div>
          <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600 }}>{error}</div>
          <button style={{ ...s.btn, marginTop: theme.spacing.sm }} onClick={() => fetchSentiment(true)}>
            Retry
          </button>
        </div>
      </Card>
    );
  }

  const recommendedSymbol = sentiment?.recommendedSymbol || 'WAIT';
  const canTrade = sentiment?.canTrade && phase?.tradingAllowed;
  const confidence = sentiment?.confidence || 0;
  const analysis = aiAnalysis?.available && aiAnalysis.analysis ? aiAnalysis.analysis : null;

  const recTint =
    recommendedSymbol === 'SOXL'
      ? { bg: theme.colors.successLight, border: theme.colors.successBorder, color: theme.colors.success }
      : recommendedSymbol === 'SOXS'
        ? { bg: theme.colors.errorLight, border: theme.colors.errorBorder, color: theme.colors.error }
        : { bg: theme.colors.warningLight, border: theme.colors.warningBorder, color: theme.colors.warningDark };

  return (
    <Card padding="large">
      {/* Header */}
      <div style={s.headerRow}>
        <h3 style={s.title}>
          Semiconductor Sentiment{' '}
          <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray400, fontWeight: theme.typography.fontWeight.normal }}>
            SOXX
          </span>
          {sentiment?.stale && (
            <span
              title={sentiment.staleReason || 'data is stale'}
              style={{
                marginLeft: 8,
                fontSize: '10px',
                fontFamily: theme.typography.fontFamilyMono,
                color: theme.colors.warningDark,
                background: theme.colors.warningLight,
                border: `1px solid ${theme.colors.warningBorder}`,
                borderRadius: theme.borderRadius.sm,
                padding: '1px 5px',
              }}
            >
              STALE
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <span style={s.meta}>{lastUpdate ? `${fmtET(lastUpdate)} ET` : '—'}</span>
          <button style={s.btn} onClick={() => fetchSentiment(true)} title="Refresh sentiment">
            Refresh
          </button>
          <button
            style={{ ...s.btn, borderColor: theme.colors.info, color: theme.colors.info }}
            onClick={triggerAIAnalysis}
            title="Run AI analysis"
          >
            AI Analyze
          </button>
        </div>
      </div>

      {/* Main stats */}
      <div style={s.statGrid}>
        <div style={s.statCard}>
          <div style={s.label}>Direction</div>
          <div style={{ ...s.statValue, color: dirColor(sentiment?.direction) }}>
            {sentiment?.direction?.toUpperCase() || 'UNKNOWN'}
          </div>
          <div style={s.subtext}>{sentiment?.intradayChange || 'N/A'}</div>
        </div>

        <div style={s.statCard}>
          <div style={s.label}>Confidence</div>
          <div style={s.statValue}>{confidence}%</div>
          <div style={{ height: 6, backgroundColor: theme.colors.gray200, borderRadius: theme.borderRadius.sm, marginTop: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${confidence}%`, backgroundColor: confColor(confidence, sentiment?.direction), transition: 'width 0.5s ease' }} />
          </div>
          {sentiment?.aiEnhanced && (
            <div style={{ ...s.subtext, color: theme.colors.info }}>AI enhanced</div>
          )}
        </div>

        <div style={s.statCard}>
          <div style={s.label}>Market Phase</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: phaseColor(phase?.phase) }} />
            <span style={{ ...s.statValue, fontSize: theme.typography.fontSize.md }}>{phase?.phase || 'UNKNOWN'}</span>
          </div>
          <div style={s.subtext}>{phase?.tradingAllowed ? 'Trading allowed' : 'No trading'}</div>
        </div>

        <div style={s.statCard}>
          <div style={s.label}>SOXX Price</div>
          <div style={s.statValue}>${sentiment?.currentPrice || 'N/A'}</div>
          <div style={s.subtext}>Open: ${sentiment?.openPrice || 'N/A'}</div>
        </div>
      </div>

      {/* Dynamic thresholds */}
      {sentiment?.thresholds && (
        <Section label={`Dynamic thresholds (vol-scaled · ${sentiment.volatility})`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: theme.spacing.sm }}>
            {[
              ['Entry', sentiment.thresholds.entry],
              ['Exit', sentiment.thresholds.exit],
              ['Switch', sentiment.thresholds.switch],
            ].map(([lbl, val]) => (
              <div key={lbl} style={{ ...s.statCard, textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: theme.colors.gray500, textTransform: 'uppercase' }}>{lbl}</div>
                <div style={{ fontSize: theme.typography.fontSize.base, fontWeight: theme.typography.fontWeight.bold, fontFamily: theme.typography.fontFamilyMono }}>
                  {val}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Active signals */}
      {sentiment?.signals && sentiment.signals.length > 0 && (
        <Section label="Active signals">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sentiment.signals.map((signal, idx) => (
              <li
                key={idx}
                style={{
                  padding: '6px 0',
                  borderBottom: idx < sentiment.signals.length - 1 ? `1px solid ${theme.colors.gray200}` : 'none',
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray700,
                  fontFamily: theme.typography.fontFamilyMono,
                }}
              >
                {signal}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Claude analysis (real, data-grounded) */}
      {analysis && (
        <div
          style={{
            background: theme.colors.infoLight,
            border: `1px solid ${theme.colors.infoBorder}`,
            borderRadius: theme.borderRadius.sm,
            padding: theme.spacing.md,
            marginBottom: theme.spacing.md,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: theme.spacing.sm }}>
            <span style={{ background: theme.colors.info, color: '#fff', padding: '1px 6px', borderRadius: theme.borderRadius.sm, fontSize: '10px', fontWeight: theme.typography.fontWeight.bold }}>
              AI
            </span>
            <span style={{ fontWeight: theme.typography.fontWeight.bold, fontSize: theme.typography.fontSize.sm }}>Claude Analysis</span>
            <span style={{ ...s.meta, marginLeft: 'auto' }}>
              {analysis.timestamp ? `${fmtET(new Date(analysis.timestamp))} ET` : ''}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: theme.spacing.sm }}>
            <div>
              <div style={s.label}>AI Direction</div>
              <div style={{ fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold, color: dirColor(analysis.direction) }}>
                {analysis.direction?.toUpperCase()}
              </div>
            </div>
            <div>
              <div style={s.label}>Confidence Adj.</div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.md,
                  fontWeight: theme.typography.fontWeight.bold,
                  color: analysis.confidenceAdjustment > 0 ? theme.colors.success : analysis.confidenceAdjustment < 0 ? theme.colors.error : theme.colors.gray700,
                }}
              >
                {analysis.confidenceAdjustment > 0 ? '+' : ''}
                {analysis.confidenceAdjustment}
              </div>
            </div>
            <div>
              <div style={s.label}>Risk Level</div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.md,
                  fontWeight: theme.typography.fontWeight.bold,
                  color: analysis.riskLevel === 'low' ? theme.colors.success : analysis.riskLevel === 'high' ? theme.colors.error : theme.colors.warningDark,
                }}
              >
                {analysis.riskLevel?.toUpperCase()}
              </div>
            </div>
          </div>

          {analysis.reasoning && (
            <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray700, fontStyle: 'italic', marginTop: theme.spacing.sm, padding: theme.spacing.sm, background: theme.colors.surface, borderRadius: theme.borderRadius.sm }}>
              &ldquo;{analysis.reasoning}&rdquo;
            </div>
          )}

          {analysis.keyFactors && analysis.keyFactors.length > 0 && (
            <div style={{ marginTop: theme.spacing.sm, fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600 }}>
              Key factors: {analysis.keyFactors.join(', ')}
            </div>
          )}

          {/* Grounding freshness — is the AI reasoning over live data? */}
          <div style={{ marginTop: theme.spacing.sm, fontSize: '10px', fontFamily: theme.typography.fontFamilyMono, color: theme.colors.gray500 }}>
            {analysis.contextAvailable === false
              ? '⚠ reasoned from summary — live breadth/macro/earnings context unavailable'
              : analysis.contextAsOf
                ? `grounded on live breadth · macro · earnings${analysis.contextStale ? ' (stale)' : ''} · ${fmtET(new Date(analysis.contextAsOf))} ET`
                : ''}
          </div>
        </div>
      )}

      {/* Trading recommendation */}
      <div
        style={{
          padding: theme.spacing.md,
          borderRadius: theme.borderRadius.sm,
          textAlign: 'center',
          background: recTint.bg,
          border: `1px solid ${recTint.border}`,
        }}
      >
        <div style={s.label}>Recommended Action</div>
        <div style={{ fontSize: theme.typography.fontSize.xxl, fontWeight: theme.typography.fontWeight.bold, color: recTint.color, marginBottom: 4 }}>
          {recommendedSymbol === 'CASH' ? 'WAIT' : recommendedSymbol}
        </div>
        <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray600 }}>
          {canTrade
            ? `${confidence}% confidence — ready to trade`
            : phase?.tradingAllowed
              ? 'Confidence too low — wait for a stronger signal'
              : `${phase?.phase} — trading not allowed`}
        </div>

        {onPresetSelect && canTrade && recommendedSymbol !== 'CASH' && (
          <button
            style={{
              marginTop: theme.spacing.sm,
              padding: '8px 18px',
              backgroundColor: recTint.color,
              color: '#fff',
              border: 'none',
              borderRadius: theme.borderRadius.sm,
              cursor: 'pointer',
              fontWeight: theme.typography.fontWeight.bold,
              fontSize: theme.typography.fontSize.xs,
            }}
            onClick={() => onPresetSelect(recommendedSymbol === 'SOXL' ? 'SOXL_MOMENTUM' : 'SOXS_HEDGE')}
          >
            Start {recommendedSymbol === 'SOXL' ? 'SOXL_MOMENTUM' : 'SOXS_HEDGE'} Session
          </button>
        )}
      </div>
    </Card>
  );
};

export default SemiconductorSentimentPanel;
