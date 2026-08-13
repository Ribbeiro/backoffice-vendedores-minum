import { alpha, createTheme } from '@mui/material';
import { minumTokens, minumTypography } from './design/tokens';

const { brand, border, feedback, feedbackSurface, radius, shadow, surface, text } = minumTokens;

const lightScheme = { surface, text, border, feedbackSurface, shadow };

// O contraste no tema escuro foi definido por semantica, preservando os verdes da Minum.
const darkScheme = {
  surface: {
    default: '#0D1C19',
    subtle: '#18332C',
    elevated: '#142823',
    inverse: '#F2F8F6',
  },
  text: {
    primary: '#F2F8F6',
    secondary: '#B8CCC5',
    muted: '#91AAA1',
    inverse: '#FFFFFF',
  },
  border: {
    default: '#31564D',
    strong: '#6D9085',
  },
  feedbackSurface: {
    success: '#123F36',
    warning: '#493F17',
    error: '#492B2B',
    info: '#273A64',
    neutral: '#22362F',
  },
  shadow: {
    low: '0 2px 10px rgba(0, 0, 0, 0.24)',
    medium: '0 14px 34px rgba(0, 0, 0, 0.3)',
  },
};

/** Cria o tema Minum a partir da preferencia visual ativa. */
export function createMinumTheme(mode = 'light') {
  const isDark = mode === 'dark';
  const scheme = isDark ? darkScheme : lightScheme;
  const primaryColor = isDark ? brand.energy : brand.primaryDark;
  const successColor = isDark ? brand.energy : feedback.success;
  const warningColor = isDark ? brand.yellow : feedback.warning;
  const errorColor = isDark ? '#FF938B' : feedback.error;
  const infoColor = isDark ? '#9BB5FF' : feedback.info;

  return createTheme({
    palette: {
      mode,
      primary: { main: primaryColor, dark: brand.primaryDark, light: brand.light, contrastText: isDark ? brand.primaryDark : text.inverse },
      secondary: { main: brand.primary, dark: brand.primaryDark, light: brand.energy, contrastText: text.inverse },
      success: { main: successColor, light: scheme.feedbackSurface.success, contrastText: isDark ? brand.primaryDark : text.inverse },
      info: { main: infoColor, light: scheme.feedbackSurface.info, contrastText: isDark ? brand.primaryDark : text.inverse },
      warning: { main: warningColor, light: scheme.feedbackSurface.warning, contrastText: brand.primaryDark },
      error: { main: errorColor, light: scheme.feedbackSurface.error, contrastText: text.inverse },
      background: { default: scheme.surface.default, paper: scheme.surface.elevated },
      text: { primary: scheme.text.primary, secondary: scheme.text.secondary, disabled: scheme.text.muted },
      divider: scheme.border.default,
      action: {
        hover: alpha(brand.energy, isDark ? 0.1 : 0.18),
        selected: alpha(brand.energy, isDark ? 0.16 : 0.2),
      },
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
            '--minum-surface-default': scheme.surface.default,
            '--minum-surface-subtle': scheme.surface.subtle,
            '--minum-surface-elevated': scheme.surface.elevated,
            '--minum-text-primary': scheme.text.primary,
            '--minum-text-secondary': scheme.text.secondary,
            '--minum-text-inverse': scheme.text.inverse,
            '--minum-border-default': scheme.border.default,
          },
          html: { backgroundColor: scheme.surface.default, colorScheme: mode },
          body: { backgroundColor: scheme.surface.default, color: scheme.text.primary },
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
          contained: { boxShadow: 'none', '&:hover': { boxShadow: scheme.shadow.low } },
          outlined: { borderWidth: 1, '&:hover': { borderWidth: 1, backgroundColor: alpha(primaryColor, isDark ? 0.14 : 0.06) } },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: radius.small } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: scheme.border.default } } },
      MuiCard: {
        styleOverrides: {
          root: { border: `1px solid ${scheme.border.default}`, boxShadow: scheme.shadow.low, borderRadius: radius.medium, backgroundImage: 'none' },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: scheme.surface.elevated,
            borderRadius: radius.medium,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: scheme.border.default },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: scheme.border.strong },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: primaryColor, borderWidth: 2 },
          },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { color: scheme.text.secondary, '&.Mui-focused': { color: primaryColor } } } },
      MuiTableContainer: { styleOverrides: { root: { borderRadius: radius.medium } } },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: scheme.border.default, paddingTop: 12, paddingBottom: 12 },
          head: { backgroundColor: scheme.surface.subtle, color: scheme.text.primary, fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' },
        },
      },
      MuiTableRow: { styleOverrides: { root: { '&:hover': { backgroundColor: alpha(brand.energy, isDark ? 0.1 : 0.22) } } } },
      MuiChip: { styleOverrides: { root: { borderRadius: radius.small, fontWeight: 600 }, sizeSmall: { height: 24 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: radius.medium, alignItems: 'center' } } },
      MuiAccordion: { styleOverrides: { root: { border: `1px solid ${scheme.border.default}`, borderRadius: `${radius.medium}px !important`, boxShadow: 'none', overflow: 'hidden', '&::before': { display: 'none' } } } },
      MuiTooltip: { styleOverrides: { tooltip: { borderRadius: radius.small, backgroundColor: brand.primaryDark } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 0, height: 6, backgroundColor: scheme.surface.subtle } } },
    },
  });
}

export default createMinumTheme;
