import { useMemo } from 'react';
import AssignmentLateOutlinedIcon from '@mui/icons-material/AssignmentLateOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import GpsFixedOutlinedIcon from '@mui/icons-material/GpsFixedOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
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
import {
  buildRouteTelemetry,
  formatTelemetryDistance,
  formatTelemetryDuration,
  formatTelemetryVariance,
  summarizeSellerTelemetry,
  telemetryVarianceColor,
} from '../utils/routeTelemetry';
import {
  buildFollowUpTasks,
  followUpStatusColor,
  followUpStatusLabel,
  isFollowUpOverdue,
} from '../utils/followUpTasks';

export function OperationalIntelligence({ embedded = false }) {
  const { visitEvents, routes, routeStops } = useData();
  const events = useMemo(() => flattenVisitEvents(visitEvents), [visitEvents]);
  const feedbacks = useMemo(() => feedbackEvents(events), [events]);
  const routeMetrics = useMemo(
    () => buildRouteTelemetry(routes, routeStops, visitEvents),
    [routes, routeStops, visitEvents],
  );
  const sellerMetrics = useMemo(() => summarizeSellerTelemetry(routeMetrics), [routeMetrics]);
  const pendingActions = useMemo(
    () => buildFollowUpTasks(feedbacks),
    [feedbacks],
  );
  const completedVisits = feedbacks.filter((event) => event.visitStatus === 'visited');
  const conversionRate = feedbacks.length ? Math.round((completedVisits.length / feedbacks.length) * 100) : 0;
  const fieldAlerts = feedbacks.filter((event) => {
    const assessment = distanceConfidence(event.distanceToCustomerMeters, event.location?.accuracyMeters);
    return assessment.color === 'warning' || assessment.color === 'error';
  });
  const odooQueue = feedbacks.filter((event) => event.odooSyncStatus === 'pending');
  const monitoredRoutes = routeMetrics.filter((route) => route.hasTelemetry);
  const telemetryTotals = monitoredRoutes.reduce((total, route) => ({
    plannedDistanceMeters: total.plannedDistanceMeters + (route.plannedDistanceMeters || 0),
    actualDistanceMeters: total.actualDistanceMeters + (route.actualDistanceMeters || 0),
    actualDurationSeconds: total.actualDurationSeconds + (route.actualDurationSeconds || 0),
    totalVisitDurationSeconds: total.totalVisitDurationSeconds + (route.totalVisitDurationSeconds || 0),
    visitDurationCount: total.visitDurationCount + route.visitDurationCount,
  }), {
    plannedDistanceMeters: 0,
    actualDistanceMeters: 0,
    actualDurationSeconds: 0,
    totalVisitDurationSeconds: 0,
    visitDurationCount: 0,
  });
  const overallDistanceVariance = telemetryTotals.plannedDistanceMeters > 0
    ? ((telemetryTotals.actualDistanceMeters - telemetryTotals.plannedDistanceMeters) / telemetryTotals.plannedDistanceMeters) * 100
    : null;
  const averageVisitDuration = telemetryTotals.visitDurationCount
    ? telemetryTotals.totalVisitDurationSeconds / telemetryTotals.visitDurationCount
    : null;

  return (
    <>
      {!embedded && (
        <PageHeader
          title="Inteligencia operacional"
          subtitle="Leitura consolidada de visitas, retornos comerciais e qualidade do registro em campo."
        />
      )}
      {embedded && (
        <Box mb={2.25}>
          <Typography variant="h6">Inteligencia operacional</Typography>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Visitas, retornos comerciais e qualidade dos registros feitos em campo.
          </Typography>
        </Box>
      )}
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

      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1} mb={2} alignItems={{ md: 'flex-end' }}>
          <Box>
            <Typography variant="h6">Execucao em campo</Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              Dados GPS amostrados apenas enquanto a navegacao esta ativa. Eles comparam o planejamento com a execucao sem expor coordenadas brutas.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip label={`${monitoredRoutes.length} rotas monitoradas`} color="primary" variant="outlined" />
            <Chip label={formatTelemetryVariance(overallDistanceVariance)} color={telemetryVarianceColor(overallDistanceVariance)} variant="outlined" />
          </Stack>
        </Stack>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} lg={3}>
            <MetricCard label="Distancia prevista" value={formatTelemetryDistance(monitoredRoutes.length ? telemetryTotals.plannedDistanceMeters : null)} icon={RouteOutlinedIcon} />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <MetricCard label="Distancia percorrida" value={formatTelemetryDistance(monitoredRoutes.length ? telemetryTotals.actualDistanceMeters : null)} icon={RouteOutlinedIcon} color="success.main" />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <MetricCard label="Tempo total em rota" value={formatTelemetryDuration(monitoredRoutes.length ? telemetryTotals.actualDurationSeconds : null)} icon={TimerOutlinedIcon} color="info.main" />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <MetricCard label="Permanencia media" value={formatTelemetryDuration(averageVisitDuration)} icon={ScheduleOutlinedIcon} color="secondary.main" />
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={2} mb={2}>
        <Grid item xs={12} xl={7}>
          <Paper sx={{ p: 2.5, height: '100%' }}>
            <Stack spacing={0.5} mb={2}>
              <Typography variant="h6">Desempenho por vendedor</Typography>
              <Typography variant="body2" color="text.secondary">
                Compare volume, ritmo de visitas e aderencia da rota. Use estes dados como apoio de gestao, nunca isoladamente.
              </Typography>
            </Stack>
            {sellerMetrics.length === 0 ? (
              <EmptyState title="Aguardando rotas monitoradas" description="Quando uma navegacao for iniciada no aplicativo, os comparativos por vendedor aparecerao aqui." />
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Vendedor</TableCell>
                      <TableCell align="right">Rotas</TableCell>
                      <TableCell align="right">Visitas</TableCell>
                      <TableCell>Tempo em rota</TableCell>
                      <TableCell>Permanencia media</TableCell>
                      <TableCell>Distancia</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sellerMetrics.map((seller) => (
                      <TableRow key={seller.sellerUid || seller.sellerName} hover>
                        <TableCell>{seller.sellerName}</TableCell>
                        <TableCell align="right">{seller.routes}</TableCell>
                        <TableCell align="right">
                          {seller.reportedStops}
                          {seller.visitsPerHour ? ` (${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(seller.visitsPerHour)}/h)` : ''}
                        </TableCell>
                        <TableCell>{formatTelemetryDuration(seller.actualDurationSeconds)}</TableCell>
                        <TableCell>{formatTelemetryDuration(seller.averageVisitDurationSeconds)}</TableCell>
                        <TableCell>
                          <Stack spacing={0.35} alignItems="flex-start">
                            <Typography variant="body2">{formatTelemetryDistance(seller.actualDistanceMeters)}</Typography>
                            <Chip
                              size="small"
                              label={formatTelemetryVariance(seller.distanceVariancePercent)}
                              color={telemetryVarianceColor(seller.distanceVariancePercent)}
                            />
                          </Stack>
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
              <Typography variant="h6">Rotas recentes</Typography>
              <Typography variant="body2" color="text.secondary">
                Priorize desvios relevantes de distancia ou tempo antes de abrir uma auditoria detalhada.
              </Typography>
            </Stack>
            {monitoredRoutes.length === 0 ? (
              <EmptyState title="Sem execucoes para comparar" description="A primeira rota guiada do vendedor trara os dados de percurso para esta lista." />
            ) : (
              <Stack spacing={1.15}>
                {monitoredRoutes.slice(0, 6).map((item) => (
                  <Box key={item.routeId} borderLeft="3px solid" borderColor={`${telemetryVarianceColor(item.distanceVariancePercent)}.main`} pl={1.25}>
                    <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                      <Typography variant="subtitle2" noWrap>{item.route.name || item.routeId}</Typography>
                      <Chip label={`${item.completionPercent ?? 0}% reportado`} size="small" variant="outlined" />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" mt={0.45}>
                      {formatTelemetryDistance(item.actualDistanceMeters)} percorridos em {formatTelemetryDuration(item.actualDurationSeconds)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Previsto: {formatTelemetryDistance(item.plannedDistanceMeters)} | {formatTelemetryDuration(item.plannedDurationSeconds)} | {formatTelemetryVariance(item.durationVariancePercent)}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>
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
                            label={isFollowUpOverdue(event) ? 'Em atraso' : followUpStatusLabel(event.followUpStatus)}
                            size="small"
                            color={isFollowUpOverdue(event) ? 'error' : followUpStatusColor(event.followUpStatus)}
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

function formatDueDate(value) {
  const date = normalizeDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date) : 'Sem data';
}

export default function Inteligencia() {
  return <OperationalIntelligence />;
}
