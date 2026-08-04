import { Box, Chip } from '@mui/material';
import { minumTokens } from '../design/tokens';

const statusConfig = {
  active: { label: 'Ativo', color: minumTokens.feedback.success, background: minumTokens.feedbackSurface.success },
  completed: { label: 'Concluida', color: minumTokens.feedback.success, background: minumTokens.feedbackSurface.success },
  visited: { label: 'Visitado', color: minumTokens.feedback.success, background: minumTokens.feedbackSurface.success },
  pending: { label: 'Pendente', color: minumTokens.feedback.warning, background: minumTokens.feedbackSurface.warning },
  assigned: { label: 'Atribuida', color: minumTokens.brand.blue, background: minumTokens.feedbackSurface.info },
  in_progress: { label: 'Em andamento', color: minumTokens.brand.blue, background: minumTokens.feedbackSurface.info },
  inactive: { label: 'Inativo', color: minumTokens.text.muted, background: minumTokens.feedbackSurface.neutral },
  not_visited: { label: 'Nao visitado', color: minumTokens.feedback.error, background: minumTokens.feedbackSurface.error },
  not_completed: { label: 'Nao concluida', color: minumTokens.feedback.error, background: minumTokens.feedbackSurface.error },
};

export default function StatusIndicator({ status, label }) {
  const key = String(status || '').toLowerCase().replaceAll(' ', '_');
  const config = statusConfig[key] || { label: label || status || 'Pendente', color: minumTokens.text.muted, background: minumTokens.feedbackSurface.neutral };
  return (
    <Chip
      size="small"
      label={label || config.label}
      icon={<Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: config.color }} />}
      sx={{ bgcolor: config.background, color: config.color, border: '1px solid transparent' }}
    />
  );
}
