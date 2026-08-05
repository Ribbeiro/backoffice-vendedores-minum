import { useMemo } from 'react';
import AssignmentLateOutlinedIcon from '@mui/icons-material/AssignmentLateOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import GpsFixedOutlinedIcon from '@mui/icons-material/GpsFixedOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import {
  Box,
  Chip,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import PageHeader from '../components/PageHeader';
import { useData } from '../hooks/useData';
import { formatDateTime, normalizeDate } from '../utils/formatters';
import {
  distanceConfidence,
  feedbackEvents,
  flattenVisitEvents,
  formatGpsDistance,
} from '../utils/visitEvents';

export default function Inteligencia() {
  const { visitEvents } = useData();
  const events = useMemo(() => flattenVisitEvents(visitEvents), [visitEvents]);
  const feedbacks = useMemo(() => feedbackEvents(events), [events]);
  const pendingActions = useMemo(
    () => feedbacks
      .filter((event) => event.nextAction)
      .sort((first, second) => dueDateTimestamp(first) - dueDateTimestamp(second)),
    [feedbacks],
  );
  const completedVisits = feedbacks.filter((event) => event.visitStatus === 'visited');
  const conversionRate = feedbacks.length ? Math.round((completedVisits.length / feedbacks.length) * 100) : 0;
  const fieldAlerts = feedbacks.filter((event) => {
    const assessment = distanceConfidence(event.distanceToCustomerMeters, event.location?.accuracyMeters);
    return assessment.color === 'warning' || assessment.color === 'error';
  });
  const odooQueue = feedbacks.filter((event) => event.odooSyncStatus === 'pending');

  return (
    <>
      <PageHeader
        title="Inteligencia operacional"
        subtitle="Leitura consolidada de visitas, retornos comerciais e qualidade do registro em campo."
      />
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Feedbacks registrados" value={feedbacks.length} icon={FactCheckOutlinedIcon} />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Taxa de visita realizada" value={`${conversionRate}%`} icon={TrendingUpOutlinedIcon} color="success.main" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Retornos para acompanhar" value={pendingActions.length} icon={AssignmentLateOutlinedIcon} color="warning.main" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Alertas de campo" value={fieldAlerts.length} icon={GpsFixedOutlinedIcon} color="error.main" />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} xl={7}>
          <Paper sx={{ p: 2.5, height: '100%' }}>
            <Stack spacing={0.5} mb={2}>
              <Typography variant="h6">Proximos passos comerciais</Typography>
              <Typography variant="body2" color="text.secondary">
                Pendencias criadas pelo vendedor durante as visitas.
              </Typography>
            </Stack>
            {pendingActions.length === 0 ? (
              <EmptyState title="Nenhum retorno pendente" description="Os proximos passos definidos em campo aparecerao aqui." />
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell>Vendedor</TableCell>
                      <TableCell>Proximo passo</TableCell>
                      <TableCell>Data de retorno</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pendingActions.slice(0, 20).map((event) => (
                      <TableRow key={event.id} hover>
                        <TableCell>{event.customerName || event.customerId || '-'}</TableCell>
                        <TableCell>{event.sellerName || event.sellerEmail || '-'}</TableCell>
                        <TableCell sx={{ minWidth: 200 }}>{event.nextAction}</TableCell>
                        <TableCell>{formatDueDate(event.nextActionDueDate)}</TableCell>
                        <TableCell>
                          <Chip
                            label={isOverdue(event.nextActionDueDate) ? 'Em atraso' : 'Acompanhar'}
                            size="small"
                            color={isOverdue(event.nextActionDueDate) ? 'error' : 'warning'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} xl={5}>
          <Paper sx={{ p: 2.5, height: '100%' }}>
            <Stack spacing={0.5} mb={2}>
              <Typography variant="h6">Auditoria de campo</Typography>
              <Typography variant="body2" color="text.secondary">
                Distancia e precisao do GPS no momento do feedback, sem exibir coordenadas brutas.
              </Typography>
            </Stack>
            {fieldAlerts.length === 0 ? (
              <EmptyState title="Nenhum alerta relevante" description="Feedbacks com GPS distante ou impreciso aparecerao aqui para analise." />
            ) : (
              <Stack spacing={1.25}>
                {fieldAlerts.slice(0, 8).map((event) => {
                  const assessment = distanceConfidence(event.distanceToCustomerMeters, event.location?.accuracyMeters);
                  return (
                    <Box key={event.id} borderLeft="3px solid" borderColor={`${assessment.color}.main`} pl={1.25}>
                      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                        <Typography variant="subtitle2">{event.customerName || event.customerId || 'Cliente'}</Typography>
                        <Chip label={assessment.label} size="small" color={assessment.color} />
                      </Stack>
                      <Typography variant="body2" color="text.secondary" mt={0.5}>
                        {formatGpsDistance(event.distanceToCustomerMeters)} do cliente
                        {Number.isFinite(Number(event.location?.accuracyMeters)) ? ` | GPS +/- ${Math.round(Number(event.location.accuracyMeters))} m` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">{event.sellerName || '-'} | {formatDateTime(event.createdAt)}</Typography>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>

      <Paper sx={{ p: 2.5, mt: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5} alignItems={{ md: 'center' }}>
          <Box>
            <Typography variant="h6">Preparacao para Odoo</Typography>
            <Typography variant="body2" color="text.secondary">
              Feedbacks entram em uma fila segura. A integracao futura criara atividades no Odoo por backend, sem expor credenciais no app.
            </Typography>
          </Box>
          <Chip label={`${odooQueue.length} feedbacks aguardando integracao`} color="info" variant="outlined" />
        </Stack>
      </Paper>

      {events.length === 0 && (
        <Box mt={2}>
          <EmptyState title="Aguardando os primeiros eventos" description="Check-ins e feedbacks registrados pelo aplicativo aparecerao aqui automaticamente." />
        </Box>
      )}
    </>
  );
}

function dueDateTimestamp(event) {
  const date = normalizeDate(event.nextActionDueDate);
  return date?.getTime() || Number.MAX_SAFE_INTEGER;
}

function formatDueDate(value) {
  const date = normalizeDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date) : 'Sem data';
}

function isOverdue(value) {
  const date = normalizeDate(value);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}
