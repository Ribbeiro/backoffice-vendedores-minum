import { Box } from '@mui/material';
import { minumTokens } from '../design/tokens';

export default function MinumLine({ width = 68, tone = 'default', sx }) {
  const isInverse = tone === 'inverse';
  return (
    <Box aria-hidden="true" display="flex" width={width} height={4} sx={sx}>
      <Box flex={2} bgcolor={isInverse ? minumTokens.brand.energy : minumTokens.brand.primary} />
      <Box flex={1} bgcolor={minumTokens.brand.light} />
    </Box>
  );
}
