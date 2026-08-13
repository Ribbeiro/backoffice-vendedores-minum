import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'minum-backoffice-color-mode';
const ThemeModeContext = createContext(null);

function getInitialMode() {
  if (typeof window === 'undefined') return 'light';

  const savedMode = window.localStorage.getItem(STORAGE_KEY);
  if (savedMode === 'light' || savedMode === 'dark') return savedMode;

  return 'light';
}

/** Mantem a preferencia visual do administrador entre os acessos ao backoffice. */
export function ThemeModeProvider({ children }) {
  const [mode, setMode] = useState(getInitialMode);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const value = useMemo(() => ({
    mode,
    toggleColorMode: () => setMode((currentMode) => (currentMode === 'light' ? 'dark' : 'light')),
  }), [mode]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext);
  if (!context) throw new Error('useThemeMode deve ser usado dentro de ThemeModeProvider.');
  return context;
}
