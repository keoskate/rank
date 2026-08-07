import { useCallback, useEffect, useState, memo } from 'react';
import theme from '../../theme';
import useOptionsScanner from '../../hooks/useOptionsScanner';
import OptionsScanControls from './OptionsScanControls';
import OptionsOpportunityTable from './OptionsOpportunityTable';
import OptionsSimpleCards from './OptionsSimpleCards';
import OptionsTrackRecord from './OptionsTrackRecord';
import MyTicketsPanel from './MyTicketsPanel';

const VIEW_STORAGE_KEY = 'optionsScannerView';

function loadViewMode() {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'pro' ? 'pro' : 'simple';
  } catch {
    return 'simple';
  }
}

const FILTER_LABELS = {
  noGreeks: 'no greeks/IV',
  zeroBid: 'no bid',
  illiquid: 'illiquid',
  lowDelta: 'low delta',
  wideSpread: 'wide spread',
  overBudget: 'over budget',
  earningsExcluded: 'earnings filter',
  belowThresholds: 'below thresholds',
};

const FilterFunnel = ({ scan, simple }) => {
  if (!scan.contractsEvaluated) return null;
  const filtered = scan.contractsFiltered || {};
  const shown = (scan.opportunities || []).length;
  const passed = scan.contractsPassed ?? shown;
  const style = { fontSize: '0.72rem', color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono };

  if (simple) {
    return (
      <div style={style}>
        We checked {scan.contractsEvaluated.toLocaleString()} contracts — only these {shown} made the cut
        {passed > shown && <> (our top {shown} of {passed.toLocaleString()} that passed)</>}.
      </div>
    );
  }

  const parts = Object.entries(filtered)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n.toLocaleString()} ${FILTER_LABELS[k] || k}`);
  const totalFiltered = Object.values(filtered).reduce((s, n) => s + n, 0);
  return (
    <div style={style}>
      {scan.contractsEvaluated.toLocaleString()} contracts evaluated → {totalFiltered.toLocaleString()} filtered
      {parts.length > 0 && <> ({parts.join(' · ')})</>} → {passed > shown
        ? <>top {shown} of {passed.toLocaleString()} passing</>
        : <>{shown} worth a look</>}
    </div>
  );
};

const ViewToggle = ({ viewMode, onChange }) => (
  <div style={{ display: 'flex', gap: 2, border: `1px solid ${theme.colors.ruler}`, borderRadius: theme.borderRadius.xs }}>
    {[{ key: 'simple', label: 'Simple' }, { key: 'pro', label: 'Pro' }].map(v => {
      const active = viewMode === v.key;
      return (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          style={{
            padding: '5px 14px',
            fontSize: '0.72rem',
            fontWeight: active ? 700 : 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: active ? '#fff' : theme.colors.gray600,
            background: active ? theme.colors.charcoal : 'transparent',
            border: 'none',
            borderRadius: theme.borderRadius.xs,
            cursor: 'pointer',
          }}
        >
          {v.label}
        </button>
      );
    })}
  </div>
);

const REQUOTE_INTERVAL_MS = 45 * 1000;

const OptionsScannerTab = ({ universeSymbols }) => {
  const { scan, loading, error, runScan } = useOptionsScanner();
  const [viewMode, setViewMode] = useState(loadViewMode);
  const [requote, setRequote] = useState(null);

  // Keep cards live: re-price the displayed board from current quotes every
  // 45s so the numbers track the market instead of the scan-time snapshot.
  useEffect(() => {
    setRequote(null);
    if (!scan?.scanId || !(scan.opportunities || []).length) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/scanner/options/requote');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.scanId === scan.scanId && (data.opportunities || []).length) {
          setRequote(data);
        }
      } catch {
        // keep showing the last good numbers
      }
    };
    tick();
    const id = setInterval(tick, REQUOTE_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [scan?.scanId, scan?.opportunities]);

  const changeView = useCallback(mode => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      // private-mode storage failures are fine — the toggle still works
    }
  }, []);

  const handleScan = useCallback(opts => {
    runScan({ ...opts, symbols: universeSymbols, maxResults: 30 });
  }, [runScan, universeSymbols]);

  const [ticketsRefresh, setTicketsRefresh] = useState(0);
  const handleBuy = useCallback(async card => {
    const ok = window.confirm(
      `Buy 1 contract: ${card.underlying} ${card.type.toUpperCase()} $${card.strike} exp ${card.expiration}?\n\n` +
      `Cost ≈ $${Math.round(card.costPerContract)} — that's your max loss.\n` +
      `The system will auto-sell it on the plan date (hold-to-plan playbook). Paper account.`
    );
    if (!ok) return;
    try {
      const res = await fetch('/api/scanner/options/tickets/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card, horizonDays: scan?.horizonDays ?? 5, qty: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTicketsRefresh(n => n + 1);
    } catch (err) {
      window.alert(`Buy failed: ${err.message}`);
    }
  }, [scan?.horizonDays]);

  const opportunities = requote?.opportunities ?? scan?.opportunities ?? [];

  return (
    <>
      <OptionsScanControls
        onScan={handleScan}
        loading={loading}
        generatedAt={scan?.generatedAt}
        underlyingsScanned={scan?.underlyingsScanned}
        elapsedMs={scan?.elapsedMs}
      />

      {error && (
        <div style={{
          padding: theme.spacing.sm,
          background: theme.colors.errorLight,
          color: theme.colors.errorDark,
          border: `1px solid ${theme.colors.error}`,
          borderRadius: theme.borderRadius.xs,
          fontSize: '0.85rem',
        }}>
          Scan error: {error}
        </div>
      )}

      {scan?.marketLikelyClosed && (
        <div style={{
          padding: theme.spacing.sm,
          background: theme.colors.warningLight,
          color: theme.colors.warningDark,
          border: `1px solid ${theme.colors.warningBorder}`,
          borderRadius: theme.borderRadius.xs,
          fontSize: '0.8rem',
        }}>
          {viewMode === 'simple'
            ? `Market looks closed — these prices are from the last session. Rescan after the open for live numbers.`
            : `Market looks closed — quotes are ~${scan.medianQuoteAgeMinutes} min old. Prices and greeks are last-session marks; rescan after the open.`}
        </div>
      )}

      <div style={{
        display: 'flex',
        gap: theme.spacing.lg,
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: '0.75rem',
        color: theme.colors.gray600,
        fontFamily: theme.typography.fontFamilyMono,
      }}>
        {scan && (
          <>
            <span><strong style={{ color: theme.colors.charcoal }}>{opportunities.length}</strong> {viewMode === 'simple' ? 'picks' : 'contracts'}</span>
            <span><strong style={{ color: theme.colors.charcoal }}>{scan.underlyingsScanned}</strong> {viewMode === 'simple' ? 'stocks with a signal' : 'underlyings with edge'}</span>
            {scan.errors?.length > 0 && (
              <span
                style={{ color: theme.colors.errorMuted, cursor: 'help', textDecoration: 'underline dotted' }}
                title={scan.errors.map(e => `${e.underlying}: ${e.error}`).join('\n')}
              >
                {scan.errors.length} errored
              </span>
            )}
            {scan.params?.earningsMode === 'exclude' && (
              <span style={{ color: theme.colors.gray500 }}>
                ⚡ dates shown land after your exit window (in-window reports excluded)
              </span>
            )}
            {viewMode === 'pro' && (
              <span>horizon: {scan.horizonDays}d · DTE {scan.params?.dteMin}–{scan.params?.dteMax}</span>
            )}
          </>
        )}
        {requote?.asOf && (
          <span style={{ color: theme.colors.gray500 }}>
            live · updated {new Date(requote.asOf).toLocaleTimeString('en-US', { hour12: false })}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <ViewToggle viewMode={viewMode} onChange={changeView} />
        </span>
      </div>

      {scan && <FilterFunnel scan={scan} simple={viewMode === 'simple'} />}

      <MyTicketsPanel refreshKey={ticketsRefresh} />

      <OptionsTrackRecord refreshKey={scan?.scanId} />

      {viewMode === 'simple'
        ? <OptionsSimpleCards opportunities={opportunities} loading={loading} onBuy={handleBuy} />
        : <OptionsOpportunityTable opportunities={opportunities} loading={loading} />}
    </>
  );
};

export default memo(OptionsScannerTab);
