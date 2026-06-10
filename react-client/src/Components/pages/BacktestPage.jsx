/**
 * Backtest Runs - viewer for standardized run artifacts (run.json)
 *
 * This page renders backtest run artifacts produced by the audited backtest
 * scripts (scripts/backtests/*) through the shared run-artifact pipeline.
 * It deliberately runs NO backtest engine of its own: every number shown —
 * equity curve, drawdown, candles, trades, verdict — is read verbatim from
 * the artifact. The previous version of this page drove a separate
 * server-side engine whose trade contract drifted (trade.profit vs trade.pnl
 * → flat equity curves); reading the artifact makes that class of bug
 * impossible.
 *
 * Honesty contract: the verdict banner reflects the five validation gates
 * (data integrity, faithfulness, out-of-sample, realistic costs, multiple
 * testing). Until a run passes them, it is UNVALIDATED and the banner says
 * so — a pretty equity curve is not evidence of edge.
 */

import { useState, useEffect } from 'react';
import Card from '../common/Card';
import MetricCard from '../common/MetricCard';
import EquityCurveChart from '../Analytics/EquityCurveChart';
import RunPriceChart from '../charts/RunPriceChart';
import theme from '../../theme';

const GATE_LABELS = {
  dataIntegrity: 'Data integrity',
  faithfulness: 'Backtest = live',
  outOfSample: 'Out-of-sample',
  realisticCosts: 'Realistic costs',
  multipleTesting: 'Multiple testing',
};

const fmtPct = (x, dp = 1) =>
  x == null ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(dp)}%`;
const fmtUsd = x =>
  x == null
    ? 'n/a'
    : x.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      });

const BacktestPage = () => {
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [run, setRun] = useState(null);
  const [symbol, setSymbol] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/backtest-runs')
      .then(r => r.json())
      .then(d => {
        const list = d.runs || [];
        setRuns(list);
        if (list.length) setSelectedId(prev => prev || list[0].runId);
      })
      .catch(e => setError(`Failed to list runs: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/backtest-runs/${selectedId}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(art => {
        setRun(art);
        const tradedFirst = Object.keys(art.bars || {});
        setSymbol(tradedFirst[0] || null);
      })
      .catch(e => setError(`Failed to load run: ${e.message}`))
      .finally(() => setLoading(false));
  }, [selectedId]);

  // Build the precomputed series for EquityCurveChart straight from the
  // artifact (drawdown arrives as a fraction <= 0; the chart wants positive %)
  let seriesPeak = -Infinity;
  const series =
    run &&
    run.equity.dates.map((date, i) => {
      const equity = run.equity.values[i];
      if (equity > seriesPeak) seriesPeak = equity;
      return {
        index: i,
        date,
        equity,
        drawdown: Math.abs(run.equity.drawdown[i]) * 100,
        highWaterMark: seriesPeak,
      };
    });

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthMedium,
        margin: '0 auto',
      }}
    >
      <h1
        style={{
          marginBottom: theme.spacing.sm,
          color: theme.colors.text,
          fontSize: theme.typography.fontSize.xxl,
          fontWeight: theme.typography.fontWeight.bold,
        }}
      >
        📈 Backtest Runs
      </h1>
      <p
        style={{
          color: theme.colors.textLight,
          marginBottom: theme.spacing.lg,
          fontSize: theme.typography.fontSize.base,
        }}
      >
        Run artifacts from <code>scripts/backtests/</code> — the exact equity
        curves, trades, and bars each sim produced. Generate new runs with{' '}
        <code>npm run backtest:trend</code>.
      </p>

      {error && (
        <Card variant="error" style={{ marginBottom: theme.spacing.lg }}>
          <span style={{ color: theme.colors.errorDark }}>❌ {error}</span>
        </Card>
      )}

      {!runs.length && !error && (
        <Card variant="warning">
          <strong>No run artifacts yet.</strong> Run a backtest to produce
          one:&nbsp;<code>npm run backtest:trend</code>, then refresh.
        </Card>
      )}

      {runs.length > 0 && (
        <Card style={{ marginBottom: theme.spacing.lg }}>
          <label
            style={{
              display: 'block',
              marginBottom: theme.spacing.sm,
              fontWeight: theme.typography.fontWeight.medium,
              color: theme.colors.text,
            }}
          >
            Run
          </label>
          <select
            value={selectedId || ''}
            onChange={e => setSelectedId(e.target.value)}
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.gray400}`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.base,
              fontFamily: theme.typography.fontFamilyMono || 'monospace',
            }}
          >
            {runs.map(r => (
              <option key={r.runId} value={r.runId}>
                {r.strategyId} · {r.window?.start}→{r.window?.end} · Sharpe{' '}
                {r.stats?.sharpe?.toFixed(2)} · {r.verdict} · {r.runId}
              </option>
            ))}
          </select>
        </Card>
      )}

      {loading && (
        <Card>
          <span style={{ color: theme.colors.textLight }}>Loading run…</span>
        </Card>
      )}

      {run && !loading && (
        <div>
          {/* Verdict banner */}
          <VerdictBanner run={run} />

          {/* Performance summary */}
          <Card style={{ marginBottom: theme.spacing.lg }}>
            <h2
              style={{
                margin: `0 0 ${theme.spacing.lg} 0`,
                color: theme.colors.text,
                fontSize: theme.typography.fontSize.xl,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              {run.strategy.id}
              <span
                style={{
                  marginLeft: theme.spacing.md,
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.textLight,
                  fontWeight: theme.typography.fontWeight.normal,
                }}
              >
                {run.strategy.description}
              </span>
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: theme.spacing.md,
              }}
            >
              <Metric
                label="CAGR"
                value={fmtPct(run.stats.cagr)}
                good={run.stats.cagr >= 0}
              />
              <Metric label="Vol" value={fmtPct(run.stats.vol)} />
              <Metric
                label="Sharpe"
                value={run.stats.sharpe.toFixed(2)}
                good={
                  run.stats.sharpe >= 1
                    ? true
                    : run.stats.sharpe < 0.5
                      ? false
                      : undefined
                }
              />
              <Metric
                label="Max Drawdown"
                value={fmtPct(run.stats.maxDD)}
                good={false}
              />
              <Metric label="Calmar" value={run.stats.calmar.toFixed(2)} />
              <Metric
                label="Final Equity"
                value={fmtUsd(run.equity.values[run.equity.values.length - 1])}
                good={
                  run.equity.values[run.equity.values.length - 1] >= run.capital
                }
              />
              <Metric label="Trades" value={String(run.trades.length)} />
              {run.benchmark && (
                <Metric
                  label={`${run.benchmark.symbol} B&H Sharpe`}
                  value={run.benchmark.stats.sharpe.toFixed(2)}
                />
              )}
            </div>
          </Card>

          {/* Equity + drawdown (artifact numbers, verbatim) */}
          <EquityCurveChart
            series={series}
            startingCapital={run.capital}
            height={380}
            title={`Equity & Drawdown — ${run.strategy.id}`}
            xLabel="Day"
            benchmarkValues={run.equity.benchmark || null}
            benchmarkLabel={
              run.benchmark ? `${run.benchmark.symbol} buy & hold` : 'Benchmark'
            }
          />

          {/* Price candles + trade markers */}
          <Card style={{ marginBottom: theme.spacing.lg }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.sm,
                marginBottom: theme.spacing.md,
                flexWrap: 'wrap',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  color: theme.colors.text,
                  fontSize: theme.typography.fontSize.lg,
                }}
              >
                Price & Trades
              </h3>
              {Object.keys(run.bars || {}).map(s => (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  style={{
                    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                    border:
                      symbol === s
                        ? `1px solid ${theme.colors.primary}`
                        : `1px solid ${theme.colors.gray300}`,
                    backgroundColor:
                      symbol === s
                        ? `${theme.colors.primary}15`
                        : 'transparent',
                    color:
                      symbol === s
                        ? theme.colors.primary
                        : theme.colors.gray600,
                    borderRadius: theme.borderRadius.sm,
                    cursor: 'pointer',
                    fontWeight: theme.typography.fontWeight.medium,
                  }}
                >
                  {s}
                </button>
              ))}
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.textLight,
                }}
              >
                ▲ buy ▼ sell — markers are the artifact&apos;s trade log
              </span>
            </div>
            {symbol && run.bars[symbol] && (
              <RunPriceChart
                bars={run.bars[symbol]}
                trades={run.trades}
                symbol={symbol}
                height={380}
              />
            )}
          </Card>

          {/* Trade log */}
          <TradeTable trades={run.trades} />

          {/* Reconciliation + caveats */}
          <HonestyFooter run={run} />
        </div>
      )}
    </div>
  );
};

const VerdictBanner = ({ run }) => {
  const verdict = run.validation?.verdict || 'UNVALIDATED';
  const isValidated = verdict === 'VALIDATED';
  const failed = verdict.startsWith('FAILED');
  const bg = isValidated ? '#0f3d2e' : failed ? '#3d0f0f' : '#3d330f';
  const fg = isValidated ? '#34d399' : failed ? '#f87171' : '#fbbf24';
  return (
    <div
      style={{
        backgroundColor: bg,
        border: `1px solid ${fg}`,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.lg,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.md,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            color: fg,
            fontWeight: theme.typography.fontWeight.bold,
            fontSize: theme.typography.fontSize.lg,
          }}
        >
          {isValidated ? '✓' : '⚠'} {verdict}
        </span>
        {Object.entries(run.validation?.gates || {}).map(([k, g]) => (
          <span
            key={k}
            title={g.note || ''}
            style={{
              padding: `2px ${theme.spacing.sm}`,
              borderRadius: theme.borderRadius.sm,
              fontSize: theme.typography.fontSize.xs,
              backgroundColor:
                g.status === 'pass'
                  ? '#065f46'
                  : g.status === 'fail'
                    ? '#7f1d1d'
                    : '#37415180',
              color:
                g.status === 'pass'
                  ? '#34d399'
                  : g.status === 'fail'
                    ? '#f87171'
                    : '#9ca3af',
            }}
          >
            {g.status === 'pass' ? '✓' : g.status === 'fail' ? '✗' : '·'}{' '}
            {GATE_LABELS[k] || k}
          </span>
        ))}
      </div>
      {!isValidated && (
        <div
          style={{
            marginTop: theme.spacing.sm,
            color: '#d1d5db',
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          This curve has not cleared the validation gates — treat it as a
          hypothesis, not an edge.
        </div>
      )}
    </div>
  );
};

const Metric = ({ label, value, good }) => (
  <div
    style={{
      border: `1px solid ${theme.colors.gray300}`,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      textAlign: 'center',
    }}
  >
    <MetricCard
      label={label}
      value={value}
      variant={good === undefined ? 'info' : good ? 'success' : 'error'}
    />
  </div>
);

const TradeTable = ({ trades }) => {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? trades : trades.slice(-30);
  const cell = {
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
    color: theme.colors.text,
    whiteSpace: 'nowrap',
  };
  return (
    <Card style={{ marginBottom: theme.spacing.lg }}>
      <h3
        style={{
          margin: `0 0 ${theme.spacing.md} 0`,
          color: theme.colors.text,
          fontSize: theme.typography.fontSize.lg,
        }}
      >
        Trade Log{' '}
        <span
          style={{
            color: theme.colors.textLight,
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.normal,
          }}
        >
          {showAll
            ? `all ${trades.length}`
            : `last ${visible.length} of ${trades.length}`}{' '}
          ·{' '}
          <a
            href="#show"
            onClick={e => {
              e.preventDefault();
              setShowAll(v => !v);
            }}
          >
            {showAll ? 'show fewer' : 'show all'}
          </a>
        </span>
      </h3>
      <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: `2px solid ${theme.colors.gray300}`,
                textAlign: 'right',
              }}
            >
              <th style={{ ...cell, textAlign: 'left' }}>Date</th>
              <th style={{ ...cell, textAlign: 'left' }}>Side</th>
              <th style={{ ...cell, textAlign: 'left' }}>Symbol</th>
              <th style={cell}>Price</th>
              <th style={cell}>Qty</th>
              <th style={cell}>Notional</th>
              <th style={cell}>P&L</th>
              <th style={cell}>P&L %</th>
              <th style={{ ...cell, textAlign: 'left' }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => (
              <tr
                key={`${t.date}-${t.symbol}-${i}`}
                style={{ borderBottom: `1px solid ${theme.colors.gray200}` }}
              >
                <td style={{ ...cell, textAlign: 'left' }}>{t.date}</td>
                <td style={{ ...cell, textAlign: 'left' }}>
                  <span
                    style={{
                      color: t.side === 'buy' ? '#059669' : '#dc2626',
                      fontWeight: theme.typography.fontWeight.bold,
                    }}
                  >
                    {t.side === 'buy' ? '▲ BUY' : '▼ SELL'}
                  </span>
                </td>
                <td style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>
                  {t.symbol}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  ${t.price?.toFixed(2)}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {t.qty?.toFixed(1)}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {fmtUsd(t.notional)}
                </td>
                <td
                  style={{
                    ...cell,
                    textAlign: 'right',
                    color:
                      t.pnl == null
                        ? theme.colors.textLight
                        : t.pnl >= 0
                          ? '#059669'
                          : '#dc2626',
                  }}
                >
                  {t.pnl == null ? '—' : fmtUsd(t.pnl)}
                </td>
                <td
                  style={{
                    ...cell,
                    textAlign: 'right',
                    color:
                      t.pnlPct == null
                        ? theme.colors.textLight
                        : t.pnlPct >= 0
                          ? '#059669'
                          : '#dc2626',
                  }}
                >
                  {t.pnlPct == null ? '—' : fmtPct(t.pnlPct, 2)}
                </td>
                <td
                  style={{
                    ...cell,
                    textAlign: 'left',
                    color: theme.colors.textLight,
                  }}
                >
                  {t.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const HonestyFooter = ({ run }) => {
  const r = run.reconciliation;
  const ledgerTies = r && r.note && r.note.startsWith('trade ledger ties');
  return (
    <Card style={{ marginBottom: theme.spacing.xl }}>
      <h3
        style={{
          margin: `0 0 ${theme.spacing.md} 0`,
          color: theme.colors.text,
          fontSize: theme.typography.fontSize.lg,
        }}
      >
        Self-Audit
      </h3>
      {r && (
        <p
          style={{
            color: ledgerTies ? '#059669' : '#b45309',
            fontSize: theme.typography.fontSize.sm,
            fontFamily: 'monospace',
          }}
        >
          ledger: realized {fmtUsd(r.realizedPnl)} + unrealized{' '}
          {fmtUsd(r.unrealizedPnl)} vs equity Δ {fmtUsd(r.equityPnl)} → gap{' '}
          {fmtUsd(r.gap)} {ledgerTies ? '✓' : `⚠ ${r.note}`}
        </p>
      )}
      {run.notes?.length > 0 && (
        <ul
          style={{
            margin: 0,
            paddingLeft: theme.spacing.lg,
            color: theme.colors.textLight,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          {run.notes.map((n, i) => (
            <li key={i} style={{ marginBottom: theme.spacing.xs }}>
              {n}
            </li>
          ))}
        </ul>
      )}
      <p
        style={{
          margin: `${theme.spacing.md} 0 0 0`,
          color: theme.colors.textLight,
          fontSize: theme.typography.fontSize.xs,
          fontFamily: 'monospace',
        }}
      >
        artifact: data/backtests/runs/{run.runId}/run.json · schema v
        {run.schemaVersion} · data {run.data?.source}/{run.data?.adjustment} ·
        generated {run.generatedAt}
      </p>
    </Card>
  );
};

export default BacktestPage;
