import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import './styles.css';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#155e75' },
    secondary: { main: '#7c3aed' },
    success: { main: '#16803c' },
    background: { default: '#f7f8fb', paper: '#ffffff' },
  },
  typography: {
    fontFamily: ['Inter', 'Roboto', 'Arial', 'sans-serif'].join(','),
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 700 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)' },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
