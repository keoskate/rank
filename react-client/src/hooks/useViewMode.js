import { useState, useCallback } from 'react';
import {
  getViewModePreference,
  setViewModePreference,
  toggleViewModePreference,
} from '../utils/viewModePreference';

/**
 * useViewMode — self-contained hook for the live-trading UI view mode
 * ('easy' | 'full'). useState-backed so components re-render on toggle, and
 * every change is persisted to localStorage.
 *
 * @returns {{ viewMode: 'easy'|'full', isEasy: boolean, setViewMode: (m)=>void, toggleViewMode: ()=>void }}
 */
export default function useViewMode() {
  const [viewMode, setMode] = useState(() => getViewModePreference());

  const setViewMode = useCallback(mode => {
    setViewModePreference(mode);
    setMode(mode);
  }, []);

  const toggleViewMode = useCallback(() => {
    const next = toggleViewModePreference();
    setMode(next);
  }, []);

  return { viewMode, isEasy: viewMode === 'easy', setViewMode, toggleViewMode };
}
