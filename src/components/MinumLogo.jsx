import { Box } from '@mui/material';
import minumLogo from '../assets/minum-logo.png';

const widths = { sm: 88, md: 128, lg: 172 };

export default function MinumLogo({ mode = 'dark', size = 'md', alt = 'Minum', sx }) {
  return (
    <Box
      component="img"
      src={minumLogo}
      alt={alt}
      sx={{
        display: 'block',
        width: widths[size] || widths.md,
        height: 'auto',
        filter: mode === 'light' ? 'brightness(0) invert(1)' : 'none',
        ...sx,
      }}
    />
  );
}
