export const minumTokens = Object.freeze({
  brand: Object.freeze({
    primaryDark: '#00463A',
    primary: '#009279',
    energy: '#00D2AE',
    light: '#A4E0CE',
    blue: '#5889FB',
    yellow: '#FDF083',
  }),
  surface: Object.freeze({
    default: '#F2F4FA',
    subtle: '#E7F2EE',
    elevated: '#FFFFFF',
    inverse: '#00463A',
  }),
  text: Object.freeze({
    primary: '#12342F',
    secondary: '#526761',
    muted: '#71857F',
    inverse: '#FFFFFF',
  }),
  border: Object.freeze({
    default: '#D9E5E1',
    strong: '#9DB5AD',
  }),
  feedback: Object.freeze({
    success: '#009279',
    warning: '#A67800',
    error: '#B9382F',
    info: '#5889FB',
  }),
  feedbackSurface: Object.freeze({
    success: '#D8F4EC',
    warning: '#FFF8D1',
    error: '#FCE8E5',
    info: '#E5EBFF',
    neutral: '#EDF1F0',
  }),
  radius: Object.freeze({ small: 6, medium: 8 }),
  shadow: Object.freeze({
    low: '0 2px 8px rgba(0, 70, 58, 0.06)',
    medium: '0 12px 28px rgba(0, 70, 58, 0.08)',
  }),
  motion: Object.freeze({ quick: '140ms', regular: '200ms' }),
});

// A Carbona nao foi entregue como arquivo web. Esta e a pilha de fallback temporaria.
export const minumTypography = Object.freeze({
  family: 'Carbona Variable, Carbona, Avenir Next, Segoe UI, sans-serif',
});
