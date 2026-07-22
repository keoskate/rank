import { useCallback, memo } from 'react';
import theme from '../../theme';
import useOptionsScanner from '../../hooks/useOptionsScanner';
import OptionsScanControls from './OptionsScanControls';
import OptionsOpportunityTable from './OptionsOpportunityTable';

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

const FilterFunnel = ({ scan }) => {
  const filtered = scan.contractsFiltered || {};
  const parts = Object.entries(filtered)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n.toLocaleString()} ${FILTER_LABELS[k] || k}`);
  const totalFiltered = Object.values(filtered).reduce((s, n) => s + n, 0);
  if (!scan.contractsEvaluated) return null;
  const shown = (scan.opportunities || []).length;
  const passed = scan.contractsPassed ?? shown;
  return (
    <div style={{ fontSize: '0.72rem', color: theme.colors.gray500, fontFamily: theme.typography.fontFamilyMono }}>
      {scan.contractsEvaluated.toLocaleString()} contracts evaluated → {totalFiltered.toLocaleString()} filtered
      {parts.length > 0 && <> ({parts.join(' · ')})</>} → {passed > shown
        ? <>top {shown} of {passed.toLocaleString()} passing</>
        : <>{shown} worth a look</>}
    </div>
  );
};

const OptionsScannerTab = ({ universeSymbols }) => {
  const { scan, loading, error, runScan } = useOptionsScanner();

  const handleScan = useCallback(opts => {
    runScan({ ...opts, symbols: universeSymbols, maxResults: 30 });
  }, [runScan, universeSymbols]);

  const opportunities = scan?.opportunities ?? [];

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
          Market looks closed — quotes are ~{scan.medianQuoteAgeMinutes} min old. Prices and greeks are last-session marks; rescan after the open.
        </div>
      )}

      {scan && (
        <div style={{
          display: 'flex',
          gap: theme.spacing.lg,
          alignItems: 'baseline',
          flexWrap: 'wrap',
          fontSize: '0.75rem',
          color: theme.colors.gray600,
          fontFamily: theme.typography.fontFamilyMono,
        }}>
          <span><strong style={{ color: theme.colors.charcoal }}>{opportunities.length}</strong> contracts</span>
          <span><strong style={{ color: theme.colors.charcoal }}>{scan.underlyingsScanned}</strong> underlyings with edge</span>
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
          <span style={{ marginLeft: 'auto' }}>
            horizon: {scan.horizonDays}d · DTE {scan.params?.dteMin}–{scan.params?.dteMax}
          </span>
        </div>
      )}

      {scan && <FilterFunnel scan={scan} />}

      <OptionsOpportunityTable opportunities={opportunities} loading={loading} />
    </>
  );
};

export default memo(OptionsScannerTab);
