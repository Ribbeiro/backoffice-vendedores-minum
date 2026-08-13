import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { minumTokens } from '../design/tokens';
import MinumIcon from './MinumIcon';

export default function MetricCard({ label, value, icon: Icon, color = minumTokens.brand.primary }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <Stack spacing={0.5} minWidth={0}>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Typography variant="h4" color="text.primary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
          </Stack>
          <Box display="grid" sx={{ flex: '0 0 auto', placeItems: 'center', width: 44, height: 44, borderRadius: 1, bgcolor: 'action.hover', color }}>
            <MinumIcon icon={Icon} size="lg" />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
