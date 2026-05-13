import { useCallback, useMemo, memo } from 'react';
import theme from '../../theme';
import useScanner from '../../hooks/useScanner';
import ScanControls from '../scanner/ScanControls';
import OpportunityTable from '../scanner/OpportunityTable';
import { getAllStockLists } from '../../config/stockLists';

const ProbabilityScannerPage = () => {
  const { scan, loading, error, runScan } = useScanner();

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
          Ranks all stocks across your rank lists by probability × R:R. Calibrated 40–85% (no false 95% confidence).
        </div>
      </div>

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
    </div>
  );
};

export default memo(ProbabilityScannerPage);
