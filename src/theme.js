import { createTheme } from '@mui/material';

// Tokens extraidos do manual de identidade visual da Minum.
export const minumColors = {
  forest: '#00463A',
  green: '#009279',
  energy: '#00D2AE',
  mint: '#A4E0CE',
  cloud: '#F2F4FA',
  blue: '#5889FB',
  yellow: '#FDF083',
  ink: '#12342F',
};

const minumTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: minumColors.forest, dark: '#00382F', light: minumColors.mint, contrastText: '#FFFFFF' },
    secondary: { main: minumColors.green, dark: '#00755F', light: minumColors.energy, contrastText: '#FFFFFF' },
    success: { main: minumColors.green, dark: '#00755F', light: '#D8F4EC', contrastText: '#FFFFFF' },
    info: { main: minumColors.blue, dark: '#3B68D7', light: '#E3EAFF', contrastText: '#FFFFFF' },
    warning: { main: '#A67800', light: minumColors.yellow, contrastText: '#1C2D2A' },
    error: { main: '#B9382F', light: '#FCE8E5', contrastText: '#FFFFFF' },
    background: { default: minumColors.cloud, paper: '#FFFFFF' },
    text: { primary: minumColors.ink, secondary: '#526761' },
    divider: '#D9E5E1',
  },
  typography: {
    fontFamily: ['Carbona Variable', 'Carbona', 'Inter', 'Roboto', 'Arial', 'sans-serif'].join(','),
    h4: { fontWeight: 600, fontSize: '2rem', lineHeight: 1.15, letterSpacing: 0 },
    h5: { fontWeight: 600, letterSpacing: 0 },
    h6: { fontWeight: 600, letterSpacing: 0 },
    subtitle1: { fontWeight: 600, letterSpacing: 0 },
    button: { fontWeight: 700, letterSpacing: 0 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: minumColors.cloud },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 8, textTransform: 'none', minHeight: 40 },
        contained: { boxShadow: 'none' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { border: '1px solid #E0EAE7', boxShadow: '0 8px 24px rgba(0, 70, 58, 0.06)' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        outlined: { borderColor: '#D9E5E1' },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: minumColors.green, borderWidth: 2 },
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: { backgroundColor: '#F5F9F7' },
      },
    },
  },
});

export default minumTheme;
