/**
 * Trade Import Page
 *
 * Import Schwab CSV trade history, analyze patterns,
 * and train the AI from your trading history.
 */

import { useState, useCallback, useRef } from 'react';
import Button from '../common/Button';
import Card from '../common/Card';
import MetricCard from '../common/MetricCard';
import theme from '../../theme';

const TradeImportPage = () => {
  const [file, setFile] = useState(null);
  const [trades, setTrades] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState(null);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'exitDate', direction: 'desc' });
  const [filterStyle, setFilterStyle] = useState('all');
  const [showWinsOnly, setShowWinsOnly] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith('.csv')) {
      setFile(droppedFile);
      setError(null);
    } else {
      setError('Please drop a CSV file');
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const uploadAndParse = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/import/schwab', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse CSV');
      }

      setTrades(data.trades || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const trainFromTrades = async () => {
    setTrainingStatus({ status: 'training', message: 'Training AI on your trades...' });

    try {
      const res = await fetch('/api/import/schwab/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'default_user' })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Training failed');
      }

      setTrainingStatus({
        status: 'complete',
        message: `Training complete! Model accuracy: ${(data.finalAccuracy * 100).toFixed(1)}%`,
        details: data
      });
    } catch (err) {
      setTrainingStatus({ status: 'error', message: err.message });
    }
  };

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const sortedTrades = [...trades]
    .filter((t) => {
      if (showWinsOnly && !t.isWin) return false;
      if (filterStyle !== 'all' && t.tradingStyle !== filterStyle) return false;
      return true;
    })
    .sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];

      if (typeof aVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortConfig.direction === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

  const formatCurrency = (value) => {
    if (value === undefined || value === null) return '$0.00';
    const num = parseFloat(value);
    const sign = num >= 0 ? '+' : '';
    return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = (value) => {
    if (value === undefined || value === null) return '0.00%';
    const sign = parseFloat(value) >= 0 ? '+' : '';
    return `${sign}${parseFloat(value).toFixed(2)}%`;
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto'
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: theme.spacing.lg }}>
        <h1 style={{ margin: 0, fontSize: theme.typography.fontSize.xxl }}>
          Import Trade History
        </h1>
        <p style={{ color: theme.colors.gray600, marginTop: theme.spacing.sm }}>
          Upload your Schwab CSV export to analyze your trading patterns and train the AI.
        </p>
      </div>

      {/* Upload Section */}
      <Card style={{ marginBottom: theme.spacing.lg }}>
        <h3 style={{ marginTop: 0 }}>Upload Schwab CSV</h3>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${file ? theme.colors.success : theme.colors.gray300}`,
            borderRadius: theme.borderRadius.lg,
            padding: theme.spacing.xl,
            textAlign: 'center',
            cursor: 'pointer',
            backgroundColor: file ? theme.colors.success + '10' : theme.colors.gray50,
            transition: 'all 0.2s'
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {file ? (
            <div>
              <div style={{ fontSize: theme.typography.fontSize.lg, marginBottom: theme.spacing.sm }}>
                {file.name}
              </div>
              <div style={{ color: theme.colors.gray500 }}>
                {(file.size / 1024).toFixed(1)} KB
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: theme.typography.fontSize.lg, marginBottom: theme.spacing.sm }}>
                Drop CSV file here or click to browse
              </div>
              <div style={{ color: theme.colors.gray500 }}>
                Supports Schwab transaction history exports
              </div>
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: theme.spacing.md,
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.error + '10',
              border: `1px solid ${theme.colors.error}`,
              borderRadius: theme.borderRadius.sm,
              color: theme.colors.error
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginTop: theme.spacing.md, display: 'flex', gap: theme.spacing.sm }}>
          <Button onClick={uploadAndParse} disabled={!file || loading}>
            {loading ? 'Processing...' : 'Upload & Analyze'}
          </Button>
          {file && (
            <Button
              variant="ghost"
              onClick={() => {
                setFile(null);
                setTrades([]);
                setSummary(null);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </Card>

      {/* Summary Section */}
      {summary && (
        <>
          {/* Overview Metrics */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: theme.spacing.md,
              marginBottom: theme.spacing.lg
            }}
          >
            <MetricCard
              title="Total Trades"
              value={summary.overview?.totalTrades || 0}
            />
            <MetricCard
              title="Win Rate"
              value={`${summary.overview?.winRate || 0}%`}
              subtitle={`${summary.overview?.wins}W / ${summary.overview?.losses}L`}
              variant={parseFloat(summary.overview?.winRate) >= 50 ? 'success' : 'error'}
            />
            <MetricCard
              title="Total P&L"
              value={formatCurrency(summary.overview?.totalProfit)}
              variant={parseFloat(summary.overview?.totalProfit) >= 0 ? 'success' : 'error'}
            />
            <MetricCard
              title="Avg Win"
              value={formatCurrency(summary.overview?.avgWin)}
              variant="success"
            />
            <MetricCard
              title="Avg Loss"
              value={formatCurrency(summary.overview?.avgLoss)}
              variant="error"
            />
            <MetricCard
              title="Profit Factor"
              value={summary.overview?.profitFactor || 'N/A'}
              variant={parseFloat(summary.overview?.profitFactor) > 1 ? 'success' : 'error'}
            />
          </div>

          {/* Insights and Analysis */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: theme.spacing.lg,
              marginBottom: theme.spacing.lg
            }}
          >
            {/* Trading Style Breakdown */}
            <Card>
              <h3 style={{ marginTop: 0 }}>Trading Style Performance</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${theme.colors.gray200}` }}>
                    <th style={{ textAlign: 'left', padding: theme.spacing.sm }}>Style</th>
                    <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>Trades</th>
                    <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>Win Rate</th>
                    <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summary.byStyle || {}).map(([style, data]) => (
                    <tr key={style} style={{ borderBottom: `1px solid ${theme.colors.gray100}` }}>
                      <td style={{ padding: theme.spacing.sm, textTransform: 'capitalize' }}>
                        {style}
                      </td>
                      <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                        {data.trades}
                      </td>
                      <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                        {data.winRate}%
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          padding: theme.spacing.sm,
                          color: parseFloat(data.profit) >= 0 ? theme.colors.success : theme.colors.error
                        }}
                      >
                        {formatCurrency(data.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Best/Worst Trades */}
            <Card>
              <h3 style={{ marginTop: 0 }}>Notable Trades</h3>

              {summary.bestTrade && (
                <div
                  style={{
                    padding: theme.spacing.md,
                    backgroundColor: theme.colors.success + '10',
                    borderRadius: theme.borderRadius.sm,
                    marginBottom: theme.spacing.md
                  }}
                >
                  <div style={{ fontWeight: theme.typography.fontWeight.bold, color: theme.colors.success }}>
                    Best Trade
                  </div>
                  <div style={{ fontSize: theme.typography.fontSize.lg }}>
                    {summary.bestTrade.symbol}
                  </div>
                  <div>
                    Profit: {formatCurrency(summary.bestTrade.profit)} ({formatPercent(summary.bestTrade.profitPercent)})
                  </div>
                  <div style={{ color: theme.colors.gray500 }}>
                    Held for {summary.bestTrade.holdingDays} days
                  </div>
                </div>
              )}

              {summary.worstTrade && (
                <div
                  style={{
                    padding: theme.spacing.md,
                    backgroundColor: theme.colors.error + '10',
                    borderRadius: theme.borderRadius.sm
                  }}
                >
                  <div style={{ fontWeight: theme.typography.fontWeight.bold, color: theme.colors.error }}>
                    Worst Trade
                  </div>
                  <div style={{ fontSize: theme.typography.fontSize.lg }}>
                    {summary.worstTrade.symbol}
                  </div>
                  <div>
                    Loss: {formatCurrency(summary.worstTrade.profit)} ({formatPercent(summary.worstTrade.profitPercent)})
                  </div>
                  <div style={{ color: theme.colors.gray500 }}>
                    Held for {summary.worstTrade.holdingDays} days
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Top Symbols */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: theme.spacing.lg,
              marginBottom: theme.spacing.lg
            }}
          >
            <Card>
              <h3 style={{ marginTop: 0 }}>Top Performing Symbols</h3>
              {summary.topSymbols?.map((s, i) => (
                <div
                  key={s.symbol}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: theme.spacing.sm,
                    borderBottom: `1px solid ${theme.colors.gray100}`
                  }}
                >
                  <span>
                    <span style={{ color: theme.colors.gray400, marginRight: theme.spacing.sm }}>
                      #{i + 1}
                    </span>
                    <strong>{s.symbol}</strong>
                    <span style={{ color: theme.colors.gray500, marginLeft: theme.spacing.sm }}>
                      ({s.trades} trades, {s.winRate}% win)
                    </span>
                  </span>
                  <span style={{ color: theme.colors.success, fontWeight: theme.typography.fontWeight.bold }}>
                    {formatCurrency(s.profit)}
                  </span>
                </div>
              ))}
            </Card>

            <Card>
              <h3 style={{ marginTop: 0 }}>Worst Performing Symbols</h3>
              {summary.worstSymbols?.map((s, i) => (
                <div
                  key={s.symbol}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: theme.spacing.sm,
                    borderBottom: `1px solid ${theme.colors.gray100}`
                  }}
                >
                  <span>
                    <span style={{ color: theme.colors.gray400, marginRight: theme.spacing.sm }}>
                      #{i + 1}
                    </span>
                    <strong>{s.symbol}</strong>
                    <span style={{ color: theme.colors.gray500, marginLeft: theme.spacing.sm }}>
                      ({s.trades} trades, {s.winRate}% win)
                    </span>
                  </span>
                  <span style={{ color: theme.colors.error, fontWeight: theme.typography.fontWeight.bold }}>
                    {formatCurrency(s.profit)}
                  </span>
                </div>
              ))}
            </Card>
          </div>

          {/* Insights */}
          {summary.insights && summary.insights.length > 0 && (
            <Card style={{ marginBottom: theme.spacing.lg }}>
              <h3 style={{ marginTop: 0 }}>AI Insights</h3>
              <ul style={{ margin: 0, paddingLeft: theme.spacing.lg }}>
                {summary.insights.map((insight, i) => (
                  <li key={i} style={{ marginBottom: theme.spacing.sm, color: theme.colors.gray700 }}>
                    {insight}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Train AI Button */}
          <Card style={{ marginBottom: theme.spacing.lg }}>
            <h3 style={{ marginTop: 0 }}>Train AI from Your Trades</h3>
            <p style={{ color: theme.colors.gray600 }}>
              Use your trading history to train the AI pattern recognition model.
              This helps the AI learn from your successful trades and avoid your mistakes.
            </p>

            <Button onClick={trainFromTrades} disabled={trainingStatus?.status === 'training'}>
              {trainingStatus?.status === 'training' ? 'Training...' : 'Train AI Model'}
            </Button>

            {trainingStatus && (
              <div
                style={{
                  marginTop: theme.spacing.md,
                  padding: theme.spacing.md,
                  backgroundColor:
                    trainingStatus.status === 'complete'
                      ? theme.colors.success + '10'
                      : trainingStatus.status === 'error'
                        ? theme.colors.error + '10'
                        : theme.colors.info + '10',
                  borderRadius: theme.borderRadius.sm
                }}
              >
                {trainingStatus.message}
              </div>
            )}
          </Card>
        </>
      )}

      {/* Trade History Table */}
      {trades.length > 0 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
            <h3 style={{ margin: 0 }}>Trade History ({sortedTrades.length} trades)</h3>

            <div style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
              <select
                value={filterStyle}
                onChange={(e) => setFilterStyle(e.target.value)}
                style={{
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm
                }}
              >
                <option value="all">All Styles</option>
                <option value="scalping">Scalping</option>
                <option value="dayTrading">Day Trading</option>
                <option value="swing">Swing</option>
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
                <input
                  type="checkbox"
                  checked={showWinsOnly}
                  onChange={(e) => setShowWinsOnly(e.target.checked)}
                />
                Wins only
              </label>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${theme.colors.gray200}` }}>
                  {[
                    { key: 'symbol', label: 'Symbol' },
                    { key: 'entryDate', label: 'Entry' },
                    { key: 'exitDate', label: 'Exit' },
                    { key: 'entryPrice', label: 'Entry $' },
                    { key: 'exitPrice', label: 'Exit $' },
                    { key: 'quantity', label: 'Qty' },
                    { key: 'profit', label: 'P&L' },
                    { key: 'profitPercent', label: 'P&L %' },
                    { key: 'holdingDays', label: 'Days' },
                    { key: 'tradingStyle', label: 'Style' }
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        textAlign: col.key === 'symbol' || col.key === 'tradingStyle' ? 'left' : 'right',
                        padding: theme.spacing.sm,
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                    >
                      {col.label}
                      {sortConfig.key === col.key && (
                        <span style={{ marginLeft: theme.spacing.xs }}>
                          {sortConfig.direction === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    style={{
                      borderBottom: `1px solid ${theme.colors.gray100}`,
                      backgroundColor: trade.isWin ? theme.colors.success + '05' : theme.colors.error + '05'
                    }}
                  >
                    <td style={{ padding: theme.spacing.sm, fontWeight: theme.typography.fontWeight.bold }}>
                      {trade.symbol}
                    </td>
                    <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                      {formatDate(trade.entryDate)}
                    </td>
                    <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                      {formatDate(trade.exitDate)}
                    </td>
                    <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                      ${trade.entryPrice.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                      ${trade.exitPrice.toFixed(2)}
                    </td>
                    <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                      {trade.quantity}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: theme.spacing.sm,
                        color: trade.isWin ? theme.colors.success : theme.colors.error,
                        fontWeight: theme.typography.fontWeight.bold
                      }}
                    >
                      {formatCurrency(trade.profit)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: theme.spacing.sm,
                        color: trade.isWin ? theme.colors.success : theme.colors.error
                      }}
                    >
                      {formatPercent(trade.profitPercent)}
                    </td>
                    <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                      {trade.holdingDays}
                    </td>
                    <td
                      style={{
                        padding: theme.spacing.sm,
                        textTransform: 'capitalize',
                        color: theme.colors.gray600
                      }}
                    >
                      {trade.tradingStyle}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default TradeImportPage;
