import { Box, Card, CardContent, Stack, Typography } from '@mui/material';

export default function MetricCard({ label, value, icon, color = 'primary.main' }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.25, '&:last-child': { pb: 2.25 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Stack>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="h4" mt={0.5} color="text.primary">
              {value}
            </Typography>
          </Stack>
          <Box display="grid" sx={{ placeItems: 'center', width: 46, height: 46, borderRadius: 1, bgcolor: '#E4F5F0', color }}>
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
