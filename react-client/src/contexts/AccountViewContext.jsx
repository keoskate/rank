import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * AccountViewContext — the GLOBAL account picker state.
 *
 * Selects which Alpaca account the UI is LOOKING AT (portfolio, positions,
 * orders). This is a pure view filter: it never changes how any broker or
 * session trades — brokers are bound to their accounts server-side
 * (tradingModeManager), and the engine's global mode cannot be pointed at a
 * strategy-dedicated account at all.
 *
 * The selected id doubles as the `?mode=` param the /api/alpaca/* routes
 * accept ('paper' | 'paper-mixer' | 'live' | …), validated server-side
 * against the registry.
 */

const STORAGE_KEY = 'global-account-view';

// Static fallback so the UI renders sensibly before /api/alpaca/accounts
// answers (or if it fails). Mirrors the server registry's shape.
const FALLBACK_ACCOUNTS = [
  { id: 'paper', label: 'Paper — Main', kind: 'paper', configured: true },
  { id: 'live', label: 'Live — REAL MONEY', kind: 'live', configured: true },
];

const AccountViewContext = createContext(null);

export function AccountViewProvider({ children }) {
  const [accounts, setAccounts] = useState(FALLBACK_ACCOUNTS);
  const [accountId, setAccountIdState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'paper';
    } catch (e) {
      return 'paper';
    }
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/alpaca/accounts')
      .then(r => r.json())
      .then(j => {
        if (cancelled || !j.success || !Array.isArray(j.accounts)) return;
        setAccounts(j.accounts);
        // If the stored selection no longer exists, fall back to paper.
        if (!j.accounts.some(a => a.id === localStorage.getItem(STORAGE_KEY))) {
          setAccountIdState(prev =>
            j.accounts.some(a => a.id === prev) ? prev : 'paper'
          );
        }
      })
      .catch(() => {}); // fallback list already in place
    return () => {
      cancelled = true;
    };
  }, []);

  const setAccountId = id => {
    setAccountIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {
      /* private mode etc. — selection just won't persist */
    }
  };

  const value = useMemo(() => {
    const account =
      accounts.find(a => a.id === accountId) || accounts[0] || null;
    return {
      accountId: account ? account.id : 'paper',
      account,
      accounts,
      setAccountId,
      isLive: account ? account.kind === 'live' : false,
    };
  }, [accountId, accounts]);

  return (
    <AccountViewContext.Provider value={value}>
      {children}
    </AccountViewContext.Provider>
  );
}

export function useAccountView() {
  const ctx = useContext(AccountViewContext);
  if (!ctx) {
    // Render-safe default for components mounted outside the provider (tests,
    // isolated mounts) — behaves like the legacy hard-coded paper mode.
    return {
      accountId: 'paper',
      account: FALLBACK_ACCOUNTS[0],
      accounts: FALLBACK_ACCOUNTS,
      setAccountId: () => {},
      isLive: false,
    };
  }
  return ctx;
}

export default AccountViewContext;
