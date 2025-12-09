/**
 * OvernightOptimizationPage - Set it and forget it optimization
 *
 * Run optimization jobs overnight to find the best strategy parameters.
 * Wake up to improved strategies ready to deploy.
 *
 * Features:
 * - Create optimization jobs for multiple symbols
 * - Configure parameter search space
 * - Monitor job progress in real-time
 * - View and apply optimized results
 * - Track job history with full transparency
 */
import { useState, useEffect, useCallback } from 'react';
import theme from '../../theme';
import { useTradingConfig } from '../../contexts/TradingConfigContext';

const OvernightOptimizationPage = () => {
  const { config: tradingConfig, updateConfig } = useTradingConfig();

  // Job management state
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // New job form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newJob, setNewJob] = useState({
    name: '',
    description: '',
    symbols: 'SOXL, TQQQ, NVDA',
    searchMethod: 'grid',
    iterations: 100,
    lookbackDays: 180,
    trainTestSplit: 0.7,
    validateWithWalkForward: true,
    validateWithRandomDays: true,
    optimizeByRegime: true,
  });

  // Collapsible sections
  const [expandedSections, setExpandedSections] = useState({
    errors: true,
    results: true,
    recommendations: true,
    config: false,
  });

  // Polling interval for job status
  const POLL_INTERVAL = 5000;

  // Fetch all jobs
  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/overnight/jobs');
      if (!response.ok) throw new Error('Failed to fetch jobs');
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  }, []);

  // Fetch job details
  const fetchJobDetails = useCallback(async jobId => {
    try {
      const response = await fetch(`/api/overnight/jobs/${jobId}`);
      if (!response.ok) throw new Error('Failed to fetch job details');
      const data = await response.json();
      setSelectedJob(data.job);

      // Always try to fetch results for completed jobs
      if (data.job.status === 'completed') {
        const resultsResponse = await fetch(`/api/overnight/results/${jobId}`);
        if (resultsResponse.ok) {
          const resultsData = await resultsResponse.json();
          setResults(resultsData.results);
        }
      } else {
        setResults(null);
      }
    } catch (err) {
      console.error('Error fetching job details:', err);
      setError(err.message);
    }
  }, []);

  // Create a new job
  const createJob = async () => {
    setLoading(true);
    setError(null);

    try {
      const symbols = newJob.symbols
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(s => s);

      if (symbols.length === 0) {
        throw new Error('Please enter at least one symbol');
      }

      const response = await fetch('/api/overnight/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols,
          name: newJob.name || `Optimization ${new Date().toLocaleDateString()}`,
          description: newJob.description,
          config: {
            searchMethod: newJob.searchMethod,
            maxIterations: newJob.iterations,
            lookbackDays: newJob.lookbackDays,
            trainTestSplit: newJob.trainTestSplit,
            validateWithWalkForward: newJob.validateWithWalkForward,
            validateWithRandomDays: newJob.validateWithRandomDays,
            optimizeByRegime: newJob.optimizeByRegime,
          },
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to create job');
      }

      const data = await response.json();
      setShowCreateForm(false);
      setNewJob({
        name: '',
        description: '',
        symbols: 'SOXL, TQQQ, NVDA',
        searchMethod: 'grid',
        iterations: 100,
        lookbackDays: 180,
        trainTestSplit: 0.7,
        validateWithWalkForward: true,
        validateWithRandomDays: true,
        optimizeByRegime: true,
      });
      await fetchJobs();
      setSelectedJob(data.job);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Start a job
  const startJob = async jobId => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/overnight/jobs/${jobId}/start`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to start job');
      }

      await fetchJobs();
      await fetchJobDetails(jobId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Cancel a job
  const cancelJob = async jobId => {
    if (!window.confirm('Are you sure you want to cancel this job?')) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/overnight/jobs/${jobId}/cancel`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to cancel job');
      }

      await fetchJobs();
      await fetchJobDetails(jobId);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Delete a job
  const deleteJob = async jobId => {
    if (!window.confirm('Delete this job and all results?')) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/overnight/jobs/${jobId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to delete job');
      }

      setSelectedJob(null);
      setResults(null);
      await fetchJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Apply best config to trading settings
  const applyToTradingConfig = (bestConfig) => {
    if (!bestConfig) return;

    const updates = {};

    // Map optimization params to trading config
    if (bestConfig.takeProfitPercent !== undefined) {
      updates.takeProfitPercent = bestConfig.takeProfitPercent;
    }
    if (bestConfig.stopLossPercent !== undefined) {
      updates.stopLossPercent = bestConfig.stopLossPercent;
    }
    if (bestConfig.minConfidence !== undefined) {
      updates.minConfidence = bestConfig.minConfidence;
    }
    if (bestConfig.positionSizePercent !== undefined) {
      updates.maxPositionSizePercent = bestConfig.positionSizePercent;
    }

    updateConfig(updates);
    alert('Optimized parameters applied to Trading Config!');
  };

  // Apply results to strategy version control
  const applyToStrategyLab = async jobId => {
    if (
      !window.confirm(
        'Apply optimized configs to Strategy Lab? This will create new strategy versions.'
      )
    )
      return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/overnight/jobs/${jobId}/apply`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to apply results');
      }

      const data = await response.json();
      alert(
        `Successfully applied ${data.applied?.length || 0} optimized configurations!`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Initial load and polling
  useEffect(() => {
    fetchJobs();

    // Poll for updates on running jobs
    const interval = setInterval(() => {
      fetchJobs();
      if (selectedJob?.status === 'running') {
        fetchJobDetails(selectedJob.id);
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [fetchJobs, fetchJobDetails, selectedJob?.id, selectedJob?.status]);

  // Get status color
  const getStatusColor = status => {
    switch (status) {
      case 'completed':
        return theme.colors.success;
      case 'running':
        return theme.colors.warning;
      case 'failed':
        return theme.colors.error;
      case 'cancelled':
        return theme.colors.textMuted;
      default:
        return theme.colors.text;
    }
  };

  // Format duration
  const formatDuration = (startedAt, completedAt) => {
    if (!startedAt) return '-';
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const seconds = Math.floor((end - start) / 1000);

    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  // Toggle section
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Section header component
  const SectionHeader = ({ title, section, count }) => (
    <div
      onClick={() => toggleSection(section)}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.background,
        borderRadius: theme.borderRadius.sm,
        cursor: 'pointer',
        marginBottom: theme.spacing.sm,
      }}
    >
      <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
        {title} {count !== undefined && `(${count})`}
      </span>
      <span>{expandedSections[section] ? '▼' : '▶'}</span>
    </div>
  );

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.lg,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: theme.typography.fontSize.xxl,
              fontWeight: theme.typography.fontWeight.bold,
              color: theme.colors.text,
              margin: 0,
            }}
          >
            Overnight Optimization
          </h1>
          <p
            style={{
              color: theme.colors.textMuted,
              marginTop: theme.spacing.xs,
            }}
          >
            Set it and forget it - wake up to optimized strategies
          </p>
        </div>

        <button
          onClick={() => setShowCreateForm(true)}
          style={{
            backgroundColor: theme.colors.primary,
            color: '#fff',
            border: 'none',
            borderRadius: theme.borderRadius.md,
            padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
            fontSize: theme.typography.fontSize.md,
            fontWeight: theme.typography.fontWeight.medium,
            cursor: 'pointer',
          }}
        >
          + New Optimization Job
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div
          style={{
            backgroundColor: `${theme.colors.error}20`,
            border: `1px solid ${theme.colors.error}`,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.md,
            marginBottom: theme.spacing.lg,
            color: theme.colors.error,
          }}
        >
          {error}
        </div>
      )}

      {/* Create Job Form Modal */}
      {showCreateForm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowCreateForm(false)}
        >
          <div
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.borderRadius.lg,
              padding: theme.spacing.xl,
              width: '600px',
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2
              style={{
                fontSize: theme.typography.fontSize.xl,
                fontWeight: theme.typography.fontWeight.bold,
                marginBottom: theme.spacing.lg,
              }}
            >
              Create Optimization Job
            </h2>

            {/* Job Name */}
            <div style={{ marginBottom: theme.spacing.md }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Job Name (optional)
              </label>
              <input
                type="text"
                value={newJob.name}
                onChange={e => setNewJob({ ...newJob, name: e.target.value })}
                placeholder="e.g., Weekend SOXL Optimization"
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.border}`,
                  backgroundColor: theme.colors.background,
                  color: theme.colors.text,
                }}
              />
            </div>

            {/* Symbols */}
            <div style={{ marginBottom: theme.spacing.md }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Symbols (comma-separated)
              </label>
              <input
                type="text"
                value={newJob.symbols}
                onChange={e => setNewJob({ ...newJob, symbols: e.target.value })}
                placeholder="SOXL, TQQQ, NVDA"
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.border}`,
                  backgroundColor: theme.colors.background,
                  color: theme.colors.text,
                }}
              />
            </div>

            {/* Search Method */}
            <div style={{ marginBottom: theme.spacing.md }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Search Method
              </label>
              <select
                value={newJob.searchMethod}
                onChange={e =>
                  setNewJob({ ...newJob, searchMethod: e.target.value })
                }
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.border}`,
                  backgroundColor: theme.colors.background,
                  color: theme.colors.text,
                }}
              >
                <option value="grid">
                  Grid Search (systematic, all combinations)
                </option>
                <option value="random">
                  Random Search (faster, samples parameter space)
                </option>
              </select>
            </div>

            {/* Iterations */}
            <div style={{ marginBottom: theme.spacing.md }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Max Iterations: {newJob.iterations}
              </label>
              <input
                type="range"
                min="50"
                max="500"
                step="25"
                value={newJob.iterations}
                onChange={e =>
                  setNewJob({ ...newJob, iterations: parseInt(e.target.value) })
                }
                style={{ width: '100%' }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                <span>50 (quick)</span>
                <span>500 (thorough)</span>
              </div>
            </div>

            {/* Lookback Days */}
            <div style={{ marginBottom: theme.spacing.md }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Lookback Days: {newJob.lookbackDays}
              </label>
              <input
                type="range"
                min="30"
                max="365"
                step="15"
                value={newJob.lookbackDays}
                onChange={e =>
                  setNewJob({ ...newJob, lookbackDays: parseInt(e.target.value) })
                }
                style={{ width: '100%' }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: theme.colors.textMuted,
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                <span>30 days</span>
                <span>365 days</span>
              </div>
            </div>

            {/* Train/Test Split */}
            <div style={{ marginBottom: theme.spacing.md }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Train/Test Split: {Math.round(newJob.trainTestSplit * 100)}% /{' '}
                {Math.round((1 - newJob.trainTestSplit) * 100)}%
              </label>
              <input
                type="range"
                min="0.5"
                max="0.9"
                step="0.05"
                value={newJob.trainTestSplit}
                onChange={e =>
                  setNewJob({
                    ...newJob,
                    trainTestSplit: parseFloat(e.target.value),
                  })
                }
                style={{ width: '100%' }}
              />
            </div>

            {/* Validation Options */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.sm,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Validation Options
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  marginBottom: theme.spacing.xs,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={newJob.validateWithWalkForward}
                  onChange={e =>
                    setNewJob({
                      ...newJob,
                      validateWithWalkForward: e.target.checked,
                    })
                  }
                />
                Walk-Forward Validation (prevents overfitting)
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  marginBottom: theme.spacing.xs,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={newJob.validateWithRandomDays}
                  onChange={e =>
                    setNewJob({
                      ...newJob,
                      validateWithRandomDays: e.target.checked,
                    })
                  }
                />
                Random Day Validation (tests on unseen data)
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={newJob.optimizeByRegime}
                  onChange={e =>
                    setNewJob({ ...newJob, optimizeByRegime: e.target.checked })
                  }
                />
                Optimize by Market Regime (separate configs for bull/bear/sideways)
              </label>
            </div>

            {/* Description */}
            <div style={{ marginBottom: theme.spacing.lg }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: theme.spacing.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                Notes (optional)
              </label>
              <textarea
                value={newJob.description}
                onChange={e =>
                  setNewJob({ ...newJob, description: e.target.value })
                }
                placeholder="Any notes about this optimization run..."
                rows={3}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.border}`,
                  backgroundColor: theme.colors.background,
                  color: theme.colors.text,
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Actions */}
            <div
              style={{ display: 'flex', gap: theme.spacing.md, justifyContent: 'flex-end' }}
            >
              <button
                onClick={() => setShowCreateForm(false)}
                style={{
                  padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.border}`,
                  backgroundColor: 'transparent',
                  color: theme.colors.text,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={createJob}
                disabled={loading}
                style={{
                  padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
                  borderRadius: theme.borderRadius.md,
                  border: 'none',
                  backgroundColor: theme.colors.primary,
                  color: '#fff',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Creating...' : 'Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div style={{ display: 'flex', gap: theme.spacing.lg }}>
        {/* Jobs List */}
        <div style={{ flex: '0 0 350px' }}>
          <h3
            style={{
              fontSize: theme.typography.fontSize.lg,
              fontWeight: theme.typography.fontWeight.bold,
              marginBottom: theme.spacing.md,
            }}
          >
            Optimization Jobs
          </h3>

          {jobs.length === 0 ? (
            <div
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.md,
                padding: theme.spacing.lg,
                textAlign: 'center',
                color: theme.colors.textMuted,
              }}
            >
              <p>No optimization jobs yet.</p>
              <p style={{ fontSize: theme.typography.fontSize.sm }}>
                Create a job to start optimizing your strategies overnight.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              {jobs.map(job => (
                <div
                  key={job.id}
                  onClick={() => fetchJobDetails(job.id)}
                  style={{
                    backgroundColor:
                      selectedJob?.id === job.id
                        ? theme.colors.primaryLight
                        : theme.colors.surface,
                    borderRadius: theme.borderRadius.md,
                    padding: theme.spacing.md,
                    cursor: 'pointer',
                    border:
                      selectedJob?.id === job.id
                        ? `2px solid ${theme.colors.primary}`
                        : `1px solid ${theme.colors.border}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: theme.spacing.xs,
                    }}
                  >
                    <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
                      {job.name || `Job ${job.id.slice(0, 8)}`}
                    </span>
                    <span
                      style={{
                        fontSize: theme.typography.fontSize.sm,
                        color: getStatusColor(job.status),
                        fontWeight: theme.typography.fontWeight.medium,
                      }}
                    >
                      {job.status}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.textMuted,
                    }}
                  >
                    {job.symbols?.join(', ')}
                  </div>

                  {/* Show error count if any */}
                  {job.errors && job.errors.length > 0 && (
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.error,
                        marginTop: theme.spacing.xs,
                      }}
                    >
                      {job.errors.length} error(s)
                    </div>
                  )}

                  {job.status === 'running' && job.progress && (
                    <div style={{ marginTop: theme.spacing.sm }}>
                      <div
                        style={{
                          height: '4px',
                          backgroundColor: theme.colors.gray200,
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${(job.progress.symbolsCompleted / job.progress.totalSymbols) * 100}%`,
                            height: '100%',
                            backgroundColor: theme.colors.primary,
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.xs,
                          color: theme.colors.textMuted,
                          marginTop: theme.spacing.xs,
                        }}
                      >
                        {job.progress.message}
                      </div>
                    </div>
                  )}

                  <div
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.textMuted,
                      marginTop: theme.spacing.xs,
                    }}
                  >
                    {new Date(job.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Job Details */}
        <div style={{ flex: 1 }}>
          {selectedJob ? (
            <div
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.lg,
                padding: theme.spacing.lg,
              }}
            >
              {/* Job Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: theme.spacing.lg,
                }}
              >
                <div>
                  <h2
                    style={{
                      fontSize: theme.typography.fontSize.xl,
                      fontWeight: theme.typography.fontWeight.bold,
                      margin: 0,
                    }}
                  >
                    {selectedJob.name || `Job ${selectedJob.id.slice(0, 8)}`}
                  </h2>
                  <p
                    style={{
                      color: theme.colors.textMuted,
                      margin: `${theme.spacing.xs} 0 0`,
                    }}
                  >
                    {selectedJob.description || 'No description'}
                  </p>
                </div>

                <span
                  style={{
                    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                    borderRadius: theme.borderRadius.sm,
                    backgroundColor: `${getStatusColor(selectedJob.status)}20`,
                    color: getStatusColor(selectedJob.status),
                    fontWeight: theme.typography.fontWeight.medium,
                  }}
                >
                  {selectedJob.status.toUpperCase()}
                </span>
              </div>

              {/* Job Info Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: theme.spacing.md,
                  marginBottom: theme.spacing.lg,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.textMuted,
                    }}
                  >
                    Symbols
                  </div>
                  <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                    {selectedJob.symbols?.join(', ')}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.textMuted,
                    }}
                  >
                    Search Method
                  </div>
                  <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                    {selectedJob.config?.method || selectedJob.config?.searchMethod || 'grid'}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.textMuted,
                    }}
                  >
                    Max Iterations
                  </div>
                  <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                    {selectedJob.config?.maxIterations || 'N/A'}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.textMuted,
                    }}
                  >
                    Duration
                  </div>
                  <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                    {formatDuration(selectedJob.startedAt, selectedJob.completedAt)}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.sm,
                      color: theme.colors.textMuted,
                    }}
                  >
                    Created
                  </div>
                  <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                    {new Date(selectedJob.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Progress for running jobs */}
              {selectedJob.status === 'running' && selectedJob.progress && (
                <div
                  style={{
                    backgroundColor: theme.colors.background,
                    borderRadius: theme.borderRadius.md,
                    padding: theme.spacing.md,
                    marginBottom: theme.spacing.lg,
                  }}
                >
                  <h4 style={{ margin: `0 0 ${theme.spacing.sm}` }}>Progress</h4>
                  <div
                    style={{
                      height: '8px',
                      backgroundColor: theme.colors.gray200,
                      borderRadius: '4px',
                      overflow: 'hidden',
                      marginBottom: theme.spacing.sm,
                    }}
                  >
                    <div
                      style={{
                        width: `${(selectedJob.progress.symbolsCompleted / selectedJob.progress.totalSymbols) * 100}%`,
                        height: '100%',
                        backgroundColor: theme.colors.primary,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      Symbol {selectedJob.progress.symbolsCompleted} of{' '}
                      {selectedJob.progress.totalSymbols}
                    </span>
                    <span>
                      {selectedJob.progress.message}
                    </span>
                  </div>
                  {selectedJob.progress.currentSymbol && (
                    <div style={{ marginTop: theme.spacing.xs, color: theme.colors.textMuted }}>
                      Currently processing: {selectedJob.progress.currentSymbol}
                    </div>
                  )}
                </div>
              )}

              {/* Errors Section */}
              {selectedJob.errors && selectedJob.errors.length > 0 && (
                <div style={{ marginBottom: theme.spacing.lg }}>
                  <SectionHeader
                    title="Errors & Warnings"
                    section="errors"
                    count={selectedJob.errors.length}
                  />
                  {expandedSections.errors && (
                    <div
                      style={{
                        backgroundColor: `${theme.colors.error}10`,
                        border: `1px solid ${theme.colors.error}40`,
                        borderRadius: theme.borderRadius.md,
                        padding: theme.spacing.md,
                      }}
                    >
                      {selectedJob.errors.map((err, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: theme.spacing.sm,
                            marginBottom: i < selectedJob.errors.length - 1 ? theme.spacing.sm : 0,
                            fontSize: theme.typography.fontSize.sm,
                          }}
                        >
                          <span style={{ color: theme.colors.error }}>⚠</span>
                          <div>
                            <div style={{ color: theme.colors.error }}>{err.message}</div>
                            {err.symbol && (
                              <span style={{ color: theme.colors.textMuted }}>
                                Symbol: {err.symbol}
                              </span>
                            )}
                            <span
                              style={{
                                color: theme.colors.textMuted,
                                fontSize: theme.typography.fontSize.xs,
                                marginLeft: theme.spacing.sm,
                              }}
                            >
                              {new Date(err.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Results for completed jobs */}
              {selectedJob.status === 'completed' && (
                <div style={{ marginBottom: theme.spacing.lg }}>
                  <SectionHeader
                    title="Optimization Results"
                    section="results"
                  />
                  {expandedSections.results && (
                    <>
                      {/* Summary Stats */}
                      {(results?.summary || selectedJob.results?.summary) && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                            gap: theme.spacing.md,
                            marginBottom: theme.spacing.lg,
                          }}
                        >
                          <div
                            style={{
                              backgroundColor: theme.colors.background,
                              borderRadius: theme.borderRadius.md,
                              padding: theme.spacing.md,
                              textAlign: 'center',
                            }}
                          >
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.xxl,
                                fontWeight: theme.typography.fontWeight.bold,
                                color: (results?.summary?.totalSymbols || selectedJob.results?.summary?.totalSymbols || 0) > 0
                                  ? theme.colors.success
                                  : theme.colors.textMuted,
                              }}
                            >
                              {results?.summary?.totalSymbols || selectedJob.results?.summary?.totalSymbols || 0}
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.sm,
                                color: theme.colors.textMuted,
                              }}
                            >
                              Symbols Processed
                            </div>
                          </div>

                          <div
                            style={{
                              backgroundColor: theme.colors.background,
                              borderRadius: theme.borderRadius.md,
                              padding: theme.spacing.md,
                              textAlign: 'center',
                            }}
                          >
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.xxl,
                                fontWeight: theme.typography.fontWeight.bold,
                                color: (results?.summary?.totalStrategiesFound || selectedJob.results?.summary?.totalStrategiesFound || 0) > 0
                                  ? theme.colors.success
                                  : theme.colors.warning,
                              }}
                            >
                              {results?.summary?.totalStrategiesFound || selectedJob.results?.summary?.totalStrategiesFound || 0}
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.sm,
                                color: theme.colors.textMuted,
                              }}
                            >
                              Strategies Found
                            </div>
                          </div>

                          <div
                            style={{
                              backgroundColor: theme.colors.background,
                              borderRadius: theme.borderRadius.md,
                              padding: theme.spacing.md,
                              textAlign: 'center',
                            }}
                          >
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.xxl,
                                fontWeight: theme.typography.fontWeight.bold,
                              }}
                            >
                              {selectedJob.progress?.iterationsCompleted || selectedJob.config?.maxIterations || 0}
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.sm,
                                color: theme.colors.textMuted,
                              }}
                            >
                              Iterations Run
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Best Strategy */}
                      {(results?.summary?.bestStrategy || selectedJob.results?.summary?.bestStrategy) && (
                        <div
                          style={{
                            backgroundColor: `${theme.colors.success}10`,
                            border: `1px solid ${theme.colors.success}`,
                            borderRadius: theme.borderRadius.md,
                            padding: theme.spacing.md,
                            marginBottom: theme.spacing.md,
                          }}
                        >
                          <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.success }}>
                            Best Strategy Found
                          </h4>
                          {(() => {
                            const best = results?.summary?.bestStrategy || selectedJob.results?.summary?.bestStrategy;
                            return (
                              <div>
                                <div style={{ fontWeight: theme.typography.fontWeight.bold, marginBottom: theme.spacing.sm }}>
                                  {best.symbol}
                                </div>
                                {best.config && (
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                      gap: theme.spacing.sm,
                                      fontSize: theme.typography.fontSize.sm,
                                    }}
                                  >
                                    {best.config.takeProfitPercent && (
                                      <div>
                                        <span style={{ color: theme.colors.textMuted }}>Take Profit: </span>
                                        <strong>{best.config.takeProfitPercent}%</strong>
                                      </div>
                                    )}
                                    {best.config.stopLossPercent && (
                                      <div>
                                        <span style={{ color: theme.colors.textMuted }}>Stop Loss: </span>
                                        <strong>{best.config.stopLossPercent}%</strong>
                                      </div>
                                    )}
                                    {best.config.minConfidence && (
                                      <div>
                                        <span style={{ color: theme.colors.textMuted }}>Min Confidence: </span>
                                        <strong>{best.config.minConfidence}%</strong>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {best.metrics && (
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                                      gap: theme.spacing.sm,
                                      fontSize: theme.typography.fontSize.sm,
                                      marginTop: theme.spacing.sm,
                                      paddingTop: theme.spacing.sm,
                                      borderTop: `1px solid ${theme.colors.border}`,
                                    }}
                                  >
                                    {best.metrics.winRate !== undefined && (
                                      <div>
                                        <span style={{ color: theme.colors.textMuted }}>Win Rate: </span>
                                        <strong>{(best.metrics.winRate * 100).toFixed(1)}%</strong>
                                      </div>
                                    )}
                                    {best.metrics.profitFactor !== undefined && (
                                      <div>
                                        <span style={{ color: theme.colors.textMuted }}>Profit Factor: </span>
                                        <strong>{best.metrics.profitFactor.toFixed(2)}</strong>
                                      </div>
                                    )}
                                    {best.metrics.expectancy !== undefined && (
                                      <div>
                                        <span style={{ color: theme.colors.textMuted }}>Expectancy: </span>
                                        <strong>${best.metrics.expectancy.toFixed(2)}</strong>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <button
                                  onClick={() => applyToTradingConfig(best.config)}
                                  style={{
                                    marginTop: theme.spacing.md,
                                    padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                                    backgroundColor: theme.colors.success,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: theme.borderRadius.sm,
                                    cursor: 'pointer',
                                    fontWeight: theme.typography.fontWeight.medium,
                                  }}
                                >
                                  Apply to Trading Config
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* No results message */}
                      {!(results?.summary?.bestStrategy || selectedJob.results?.summary?.bestStrategy) && (
                        <div
                          style={{
                            backgroundColor: `${theme.colors.warning}10`,
                            border: `1px solid ${theme.colors.warning}`,
                            borderRadius: theme.borderRadius.md,
                            padding: theme.spacing.md,
                            marginBottom: theme.spacing.md,
                          }}
                        >
                          <h4 style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.warning }}>
                            No Optimal Strategies Found
                          </h4>
                          <p style={{ margin: 0, color: theme.colors.textMuted }}>
                            The optimization ran but couldn't find strategies meeting the minimum thresholds.
                            This could be due to:
                          </p>
                          <ul style={{ margin: `${theme.spacing.sm} 0`, paddingLeft: theme.spacing.lg, color: theme.colors.textMuted }}>
                            <li>No historical data available for the selected symbols</li>
                            <li>Minimum thresholds too strict (try lowering min win rate or profit factor)</li>
                            <li>Insufficient data range (try increasing lookback days)</li>
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Recommendations Section */}
              {(results?.summary?.recommendations || selectedJob.results?.summary?.recommendations) && (
                <div style={{ marginBottom: theme.spacing.lg }}>
                  <SectionHeader
                    title="Recommendations"
                    section="recommendations"
                    count={(results?.summary?.recommendations || selectedJob.results?.summary?.recommendations || []).length}
                  />
                  {expandedSections.recommendations && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
                      {(results?.summary?.recommendations || selectedJob.results?.summary?.recommendations || []).map((rec, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: theme.spacing.sm,
                            padding: theme.spacing.sm,
                            borderRadius: theme.borderRadius.sm,
                            backgroundColor: rec.type === 'warning'
                              ? `${theme.colors.warning}10`
                              : rec.type === 'success'
                              ? `${theme.colors.success}10`
                              : `${theme.colors.primary}10`,
                            border: `1px solid ${
                              rec.type === 'warning'
                                ? theme.colors.warning
                                : rec.type === 'success'
                                ? theme.colors.success
                                : theme.colors.primary
                            }40`,
                          }}
                        >
                          <span>
                            {rec.type === 'warning' ? '⚠️' : rec.type === 'success' ? '✅' : 'ℹ️'}
                          </span>
                          <span>{rec.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Job Configuration Section */}
              <div style={{ marginBottom: theme.spacing.lg }}>
                <SectionHeader title="Job Configuration" section="config" />
                {expandedSections.config && (
                  <div
                    style={{
                      backgroundColor: theme.colors.background,
                      borderRadius: theme.borderRadius.md,
                      padding: theme.spacing.md,
                      fontFamily: 'monospace',
                      fontSize: theme.typography.fontSize.sm,
                      whiteSpace: 'pre-wrap',
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(selectedJob.config, null, 2)}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: theme.spacing.md, flexWrap: 'wrap' }}>
                {selectedJob.status === 'pending' && (
                  <button
                    onClick={() => startJob(selectedJob.id)}
                    disabled={loading}
                    style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
                      borderRadius: theme.borderRadius.md,
                      border: 'none',
                      backgroundColor: theme.colors.success,
                      color: '#fff',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    Start Optimization
                  </button>
                )}

                {selectedJob.status === 'running' && (
                  <button
                    onClick={() => cancelJob(selectedJob.id)}
                    disabled={loading}
                    style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
                      borderRadius: theme.borderRadius.md,
                      border: 'none',
                      backgroundColor: theme.colors.warning,
                      color: '#fff',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    Cancel Job
                  </button>
                )}

                {selectedJob.status === 'completed' && (results?.strategies?.length > 0 || selectedJob.results?.strategies?.length > 0) && (
                  <button
                    onClick={() => applyToStrategyLab(selectedJob.id)}
                    disabled={loading}
                    style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
                      borderRadius: theme.borderRadius.md,
                      border: 'none',
                      backgroundColor: theme.colors.primary,
                      color: '#fff',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    Apply to Strategy Lab
                  </button>
                )}

                {(selectedJob.status === 'completed' ||
                  selectedJob.status === 'failed' ||
                  selectedJob.status === 'cancelled') && (
                  <button
                    onClick={() => deleteJob(selectedJob.id)}
                    disabled={loading}
                    style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
                      borderRadius: theme.borderRadius.md,
                      border: `1px solid ${theme.colors.error}`,
                      backgroundColor: 'transparent',
                      color: theme.colors.error,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    Delete Job
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.lg,
                padding: theme.spacing.xl,
                textAlign: 'center',
                color: theme.colors.textMuted,
              }}
            >
              <h3 style={{ marginBottom: theme.spacing.md }}>
                Select a job to view details
              </h3>
              <p>
                Or create a new optimization job to find the best strategy parameters
                for your symbols.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* How it Works Section */}
      <div
        style={{
          marginTop: theme.spacing.xl,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.borderRadius.lg,
          padding: theme.spacing.lg,
        }}
      >
        <h3
          style={{
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold,
            marginBottom: theme.spacing.md,
          }}
        >
          How Overnight Optimization Works
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: theme.spacing.lg,
          }}
        >
          <div>
            <h4
              style={{
                fontWeight: theme.typography.fontWeight.medium,
                marginBottom: theme.spacing.xs,
              }}
            >
              1. Create a Job
            </h4>
            <p
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSize.sm,
                margin: 0,
              }}
            >
              Select symbols and configure optimization parameters. Choose between
              thorough grid search or faster random search.
            </p>
          </div>

          <div>
            <h4
              style={{
                fontWeight: theme.typography.fontWeight.medium,
                marginBottom: theme.spacing.xs,
              }}
            >
              2. Start & Sleep
            </h4>
            <p
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSize.sm,
                margin: 0,
              }}
            >
              Click start and let it run overnight. The optimizer tests thousands of
              parameter combinations using historical data.
            </p>
          </div>

          <div>
            <h4
              style={{
                fontWeight: theme.typography.fontWeight.medium,
                marginBottom: theme.spacing.xs,
              }}
            >
              3. Wake Up Optimized
            </h4>
            <p
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSize.sm,
                margin: 0,
              }}
            >
              Review results in the morning. Apply the best configs to Strategy Lab
              or Trading Config with one click.
            </p>
          </div>

          <div>
            <h4
              style={{
                fontWeight: theme.typography.fontWeight.medium,
                marginBottom: theme.spacing.xs,
              }}
            >
              4. Validate & Deploy
            </h4>
            <p
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.typography.fontSize.sm,
                margin: 0,
              }}
            >
              Optimized configs are validated with walk-forward and random day testing
              to prevent overfitting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OvernightOptimizationPage;
