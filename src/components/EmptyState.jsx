import { Box, Button, Stack, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { minumTokens } from '../design/tokens';
import MinumLine from './MinumLine';

export default function EmptyState({ icon: Icon = InboxOutlinedIcon, title, description, action }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.25} textAlign="center" py={5} px={3}>
      <Box display="grid" sx={{ placeItems: 'center', width: 52, height: 52, bgcolor: 'action.hover', color: minumTokens.brand.primary, borderRadius: 1 }}>
        <Icon aria-hidden="true" />
      </Box>
      <Typography variant="h6">{title}</Typography>
      <Typography variant="body2" color="text.secondary" maxWidth={380}>{description}</Typography>
      <MinumLine sx={{ mt: 0.5 }} />
      {action && <Button variant="outlined" onClick={action.onClick}>{action.label}</Button>}
    </Stack>
  );
}
