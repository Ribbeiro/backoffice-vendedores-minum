import CloseIcon from '@mui/icons-material/Close';
import { Box, Divider, Drawer, IconButton, Stack, Typography } from '@mui/material';

/**
 * Moldura unica para os detalhes operacionais do backoffice. Cliente, rota e
 * vendedor compartilham a mesma hierarquia para que a consulta seja previsivel.
 */
export default function OperationalDetailsDrawer({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  status,
  actions,
  children,
  ariaLabel,
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, bgcolor: 'background.default' } }}
      aria-label={ariaLabel || `Detalhes de ${title}`}
    >
      <Stack spacing={2.5} sx={{ minHeight: '100%', p: { xs: 2, sm: 3 }, overflowY: 'auto' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
          <Box minWidth={0}>
            <Typography variant="overline" color="primary.main">{eyebrow}</Typography>
            <Typography variant="h5" component="h2" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary" mt={0.5}>
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton aria-label="Fechar detalhes" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>

        {status && <Box>{status}</Box>}
        {actions && <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">{actions}</Stack>}

        <Divider />
        {children}
      </Stack>
    </Drawer>
  );
}

/** Separador semantico para blocos dentro de qualquer drawer operacional. */
export function OperationalDrawerSection({ title, children }) {
  return (
    <Box>
      <Typography variant="subtitle2" mb={1.25}>{title}</Typography>
      {children}
    </Box>
  );
}
