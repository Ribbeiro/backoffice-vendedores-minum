import { Card, CardContent, Stack, Typography } from '@mui/material';

export default function MetricCard({ label, value, icon, color = 'primary.main' }) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Stack>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="h4" mt={0.5}>
              {value}
            </Typography>
          </Stack>
          <Stack alignItems="center" justifyContent="center" sx={{ width: 48, height: 48, borderRadius: 2, bgcolor: color, color: 'white' }}>
            {icon}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
