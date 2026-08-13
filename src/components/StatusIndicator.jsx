import { Box, Chip } from '@mui/material';

const statusConfig = {
  active: { label: 'Ativo', color: 'success.main', background: 'success.light' },
  completed: { label: 'Concluida', color: 'success.main', background: 'success.light' },
  visited: { label: 'Visitado', color: 'success.main', background: 'success.light' },
  pending: { label: 'Pendente', color: 'warning.main', background: 'warning.light' },
  assigned: { label: 'Atribuida', color: 'info.main', background: 'info.light' },
  in_progress: { label: 'Em andamento', color: 'info.main', background: 'info.light' },
  inactive: { label: 'Inativo', color: 'text.secondary', background: 'action.hover' },
  not_visited: { label: 'Nao visitado', color: 'error.main', background: 'error.light' },
  not_completed: { label: 'Nao concluida', color: 'error.main', background: 'error.light' },
};

export default function StatusIndicator({ status, label }) {
  const key = String(status || '').toLowerCase().replaceAll(' ', '_');
  const config = statusConfig[key] || { label: label || status || 'Pendente', color: 'text.secondary', background: 'action.hover' };
  return (
    <Chip
      size="small"
      label={label || config.label}
      icon={<Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor' }} />}
      sx={{ bgcolor: config.background, color: config.color, border: '1px solid transparent' }}
    />
  );
}
