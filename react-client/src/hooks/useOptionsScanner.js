import { useState, useEffect, useCallback } from 'react';

export function useOptionsScanner() {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastError, setLastError] = useState(null);

  const loadLast = useCallback(async () => {
    try {
      const res = await fetch('/api/scanner/options/last');
      if (!res.ok) {
        if (res.status === 404) return; // no scans yet
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setScan(data);
    } catch (err) {
      setLastError(err.message);
    }
  }, []);

  const runScan = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scanner/options/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      setScan(data);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLast(); }, [loadLast]);

  return { scan, loading, error, lastError, runScan, loadLast };
}

export default useOptionsScanner;
