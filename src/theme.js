import { alpha, createTheme } from '@mui/material';
import { minumTokens, minumTypography } from './design/tokens';

const { brand, border, feedback, feedbackSurface, radius, shadow, surface, text } = minumTokens;

const minumTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: brand.primaryDark, dark: brand.primaryDark, light: brand.light, contrastText: text.inverse },
    secondary: { main: brand.primary, dark: brand.primaryDark, light: brand.energy, contrastText: text.inverse },
    success: { main: feedback.success, light: feedbackSurface.success, contrastText: text.inverse },
    info: { main: feedback.info, light: feedbackSurface.info, contrastText: text.inverse },
    warning: { main: feedback.warning, light: feedbackSurface.warning, contrastText: text.primary },
    error: { main: feedback.error, light: feedbackSurface.error, contrastText: text.inverse },
    background: { default: surface.default, paper: surface.elevated },
    text: { primary: text.primary, secondary: text.secondary, disabled: text.muted },
    divider: border.default,
  },
  typography: {
    fontFamily: minumTypography.family,
    h3: { fontSize: '2.5rem', lineHeight: 1.08, fontWeight: 600, letterSpacing: 0 },
    h4: { fontSize: '2rem', lineHeight: 1.16, fontWeight: 600, letterSpacing: 0 },
    h5: { fontSize: '1.5rem', lineHeight: 1.24, fontWeight: 600, letterSpacing: 0 },
    h6: { fontSize: '1.125rem', lineHeight: 1.36, fontWeight: 600, letterSpacing: 0 },
    subtitle1: { fontWeight: 600, letterSpacing: 0 },
    body1: { lineHeight: 1.55, letterSpacing: 0 },
    body2: { lineHeight: 1.45, letterSpacing: 0 },
    caption: { lineHeight: 1.35, letterSpacing: 0 },
    overline: { fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.4 },
    button: { fontWeight: 700, letterSpacing: 0, textTransform: 'none' },
  },
  shape: { borderRadius: radius.medium },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          '--minum-brand-dark': brand.primaryDark,
          '--minum-brand-primary': brand.primary,
          '--minum-brand-energy': brand.energy,
          '--minum-brand-light': brand.light,
          '--minum-surface-default': surface.default,
          '--minum-surface-subtle': surface.subtle,
          '--minum-surface-elevated': surface.elevated,
          '--minum-text-primary': text.primary,
          '--minum-text-secondary': text.secondary,
          '--minum-text-inverse': text.inverse,
          '--minum-border-default': border.default,
        },
        body: { backgroundColor: surface.default },
        '*, *::before, *::after': { boxSizing: 'border-box' },
        ':focus-visible': { outline: `3px solid ${alpha(brand.energy, 0.64)}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': { animationDuration: '1ms !important', transitionDuration: '1ms !important', scrollBehavior: 'auto !important' },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: radius.medium, minHeight: 40, paddingInline: 16, transition: `background-color ${minumTokens.motion.quick} ease, border-color ${minumTokens.motion.quick} ease` },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: shadow.low } },
        outlined: { borderWidth: 1, '&:hover': { borderWidth: 1, backgroundColor: alpha(brand.primary, 0.06) } },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: radius.small } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: border.default } } },
    MuiCard: {
      styleOverrides: {
        root: { border: `1px solid ${border.default}`, boxShadow: shadow.low, borderRadius: radius.medium, backgroundImage: 'none' },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: surface.elevated,
          borderRadius: radius.medium,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: border.default },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: border.strong },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: brand.primary, borderWidth: 2 },
        },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { color: text.secondary, '&.Mui-focused': { color: brand.primary } } } },
    MuiTableContainer: { styleOverrides: { root: { borderRadius: radius.medium } } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: border.default, paddingTop: 12, paddingBottom: 12 },
        head: { backgroundColor: surface.subtle, color: text.primary, fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' },
      },
    },
    MuiTableRow: { styleOverrides: { root: { '&:hover': { backgroundColor: alpha(brand.light, 0.22) } } } },
    MuiChip: { styleOverrides: { root: { borderRadius: radius.small, fontWeight: 600 }, sizeSmall: { height: 24 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: radius.medium, alignItems: 'center' } } },
    MuiAccordion: { styleOverrides: { root: { border: `1px solid ${border.default}`, borderRadius: `${radius.medium}px !important`, boxShadow: 'none', overflow: 'hidden', '&::before': { display: 'none' } } } },
    MuiTooltip: { styleOverrides: { tooltip: { borderRadius: radius.small, backgroundColor: brand.primaryDark } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 0, height: 6, backgroundColor: surface.subtle } } },
  },
});

export default minumTheme;
