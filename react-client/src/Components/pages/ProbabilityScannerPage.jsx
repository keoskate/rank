import { useCallback, useMemo, memo, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import theme from '../../theme';
import useScanner from '../../hooks/useScanner';
import ScanControls from '../scanner/ScanControls';
import OpportunityTable from '../scanner/OpportunityTable';
import { getAllStockLists } from '../../config/stockLists';

const OptionsScannerTab = lazy(() => import('../scanner/OptionsScannerTab'));
const OptionsLearningTab = lazy(() => import('../scanner/OptionsLearningTab'));

const TABS = [
  { key: 'stocks', label: 'Stocks' },
  { key: 'options', label: 'Options' },
  { key: 'learning', label: 'Learning' },
];

const ProbabilityScannerPage = () => {
  const { scan, loading, error, runScan } = useScanner();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = ['options', 'learning'].includes(tabParam) ? tabParam : 'stocks';

  const handleTabChange = useCallback(tab => {
    setSearchParams(tab === 'stocks' ? {} : { tab }, { replace: true });
  }, [setSearchParams]);

  const universeSymbols = useMemo(() => {
    try {
      const all = getAllStockLists();
      const set = new Set();
      Object.values(all).forEach(list => (list.stocks || []).forEach(s => set.add(s.toUpperCase())));
      return Array.from(set);
    } catch {
      return [];
    }
  }, []);

  const handleScan = useCallback((opts) => {
    runScan({ ...opts, symbols: universeSymbols, maxResults: 50 });
  }, [runScan, universeSymbols]);

  const opportunities = scan?.opportunities ?? [];

  return (
    <div style={{
      maxWidth: 1400,
      margin: '0 auto',
      padding: `${theme.spacing.lg} ${theme.spacing.md}`,
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing.md,
    }}>
      <div>
        <div style={{
          fontSize: '0.7rem',
          color: theme.colors.gray500,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}>
          Scanner · {universeSymbols.length} symbols
        </div>
        <h1 style={{
          margin: '4px 0 0',
          fontSize: '2rem',
          fontWeight: 700,
          color: theme.colors.charcoal,
          letterSpacing: '-0.01em',
        }}>
          Probability Scanner
        </h1>
        <div style={{
          fontSize: '0.85rem',
          color: theme.colors.gray600,
          marginTop: 4,
        }}>
          {activeTab === 'options'
            ? 'Expresses the stock scanner’s directional edge through long calls/puts. Ranked by expected ROI net of spread + theta; most contracts get filtered — that’s the point.'
            : activeTab === 'learning'
              ? 'The honest scoreboard: how every recommended pick actually performed, what we predicted vs what happened, and where the model is learning.'
              : 'Ranks all stocks across your rank lists by probability × R:R. Calibrated 40–85% (no false 95% confidence).'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2, alignSelf: 'flex-start', border: `1px solid ${theme.colors.ruler}`, borderRadius: theme.borderRadius.xs, background: theme.colors.paper, padding: 2 }}>
        {TABS.map(t => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => handleTabChange(t.key)}
              style={{
                padding: '8px 20px',
                fontSize: '0.8rem',
                fontWeight: active ? 700 : 500,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: active ? '#fff' : theme.colors.gray600,
                background: active ? theme.colors.charcoal : 'transparent',
                border: 'none',
                borderRadius: theme.borderRadius.xs,
                cursor: 'pointer',
                transition: theme.transitions?.fast || 'all 0.15s ease',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'options' ? (
        <Suspense fallback={<div style={{ padding: theme.spacing.xl, textAlign: 'center', color: theme.colors.gray500 }}>Loading…</div>}>
          <OptionsScannerTab universeSymbols={universeSymbols} />
        </Suspense>
      ) : activeTab === 'learning' ? (
        <Suspense fallback={<div style={{ padding: theme.spacing.xl, textAlign: 'center', color: theme.colors.gray500 }}>Loading…</div>}>
          <OptionsLearningTab />
        </Suspense>
      ) : (
        <>
          <ScanControls
            onScan={handleScan}
            loading={loading}
            generatedAt={scan?.generatedAt}
            scannedSymbols={scan?.scannedSymbols}
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

          {scan && (
            <div style={{
              display: 'flex',
              gap: theme.spacing.lg,
              fontSize: '0.75rem',
              color: theme.colors.gray600,
              fontFamily: theme.typography.fontFamilyMono,
            }}>
              <span><strong style={{ color: theme.colors.charcoal }}>{opportunities.length}</strong> opportunities</span>
              <span><strong style={{ color: theme.colors.charcoal }}>{scan.scannedSymbols}</strong> scanned</span>
              {scan.errors?.length > 0 && (
                <span style={{ color: theme.colors.errorMuted }}>{scan.errors.length} errored</span>
              )}
              <span style={{ marginLeft: 'auto' }}>horizon: {scan.horizonDays}d · min p: {(scan.minProbability * 100).toFixed(0)}%</span>
            </div>
          )}

          <OpportunityTable opportunities={opportunities} loading={loading} />
        </>
      )}
    </div>
  );
};

export default memo(ProbabilityScannerPage);
