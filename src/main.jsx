import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import { ThemeModeProvider, useThemeMode } from './context/ThemeModeContext.jsx';
import { createMinumTheme } from './theme.js';
import './styles.css';

function MinumThemeRoot() {
  const { mode } = useThemeMode();
  const theme = useMemo(() => createMinumTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <MinumThemeRoot />
    </ThemeModeProvider>
  </React.StrictMode>,
);
