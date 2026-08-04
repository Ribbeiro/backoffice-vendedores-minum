import { Box, Stack, Typography } from '@mui/material';
import MinumLine from './MinumLine';

export default function PageHeader({ title, subtitle, action }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'flex-end' }} justifyContent="space-between" gap={2} mb={3.5}>
      <Box>
        <Typography variant="overline" color="secondary.main">OPERACAO MINUM</Typography>
        <Typography variant="h4" component="h1" mt={0.25}>{title}</Typography>
        {subtitle && <Typography variant="body1" color="text.secondary" mt={0.75} maxWidth={720}>{subtitle}</Typography>}
        <MinumLine sx={{ mt: 1.5 }} />
      </Box>
      {action}
    </Stack>
  );
}
