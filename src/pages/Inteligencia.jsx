import { useMemo, useState } from 'react';
import AssignmentLateOutlinedIcon from '@mui/icons-material/AssignmentLateOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import GpsFixedOutlinedIcon from '@mui/icons-material/GpsFixedOutlined';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import {
  Alert,
  Box,
  Button,
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
import { createOdooTestActivity, processSingleOdooFeedback, verifyOdooConnection } from '../services/odooImport';

function describeOdooFeedbackSyncFailure(result) {
  switch (result?.status) {
    case 'skipped':
      return 'O feedback mudou de estado antes do envio. Atualize a pagina e tente novamente.';
    case 'not_found':
      return 'O feedback nao foi encontrado no Firebase. Atualize a pagina antes de tentar novamente.';
    case 'not_configured':
      return 'A integracao com o Odoo ainda nao esta configurada no servidor.';
    case 'blocked':
      return 'Este feedback esta bloqueado para envio. Verifique se o cliente possui um ID Odoo valido.';
    case 'finalization_pending':
      return 'A atividade foi criada no Odoo, mas a confirmacao no Firebase ainda esta pendente. Atualize a pagina antes de repetir o envio.';
    case 'failed':
      return 'O Odoo nao aceitou este feedback agora. Aguarde alguns instantes e tente novamente.';
    default:
      return 'Nao foi possivel confirmar o envio deste feedback ao Odoo agora.';
  }
}

export function OperationalIntelligence({ embedded = false }) {
  const { visitEvents, routes, routeStops } = useData();
  const [isCheckingOdoo, setIsCheckingOdoo] = useState(false);
  const [isCreatingOdooTest, setIsCreatingOdooTest] = useState(false);
  const [odooConnection, setOdooConnection] = useState(null);
  const [odooConnectionError, setOdooConnectionError] = useState('');
  const [odooTestActivity, setOdooTestActivity] = useState(null);
  const [odooTestActivityError, setOdooTestActivityError] = useState('');
  const [syncingOdooEventId, setSyncingOdooEventId] = useState('');
  const [odooEventSync, setOdooEventSync] = useState(null);
  const [odooEventSyncError, setOdooEventSyncError] = useState('');
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
  const testableOdooEvents = odooQueue.filter((event) => Number.isSafeInteger(Number(event.odooLeadId)) && Number(event.odooLeadId) > 0);
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

  async function handleOdooConnectionCheck() {
    setIsCheckingOdoo(true);
    setOdooConnectionError('');
    setOdooTestActivity(null);
    setOdooTestActivityError('');
    try {
      setOdooConnection(await verifyOdooConnection());
    } catch (error) {
      setOdooConnection(null);
      setOdooConnectionError(error?.message || 'Nao foi possivel validar a conexao com o Odoo agora.');
    } finally {
      setIsCheckingOdoo(false);
    }
  }

  async function handleCreateOdooTestActivity() {
    setIsCreatingOdooTest(true);
    setOdooTestActivityError('');
    try {
      setOdooTestActivity(await createOdooTestActivity());
    } catch (error) {
      setOdooTestActivity(null);
      setOdooTestActivityError(error?.message || 'Nao foi possivel criar a atividade de teste no Odoo agora.');
    } finally {
      setIsCreatingOdooTest(false);
    }
  }

  async function handleProcessSingleOdooFeedback(event) {
    setSyncingOdooEventId(event.id);
    setOdooEventSync(null);
    setOdooEventSyncError('');
    try {
      const result = await processSingleOdooFeedback({
        routeId: event.routeId,
        stopId: event.stopId,
        eventId: event.id,
      });
      if (!['synced', 'already_synced'].includes(result.status)) {
        throw new Error(describeOdooFeedbackSyncFailure(result));
      }
      setOdooEventSync({ ...result, customerName: event.customerName || event.customerId || 'Cliente' });
    } catch (error) {
      setOdooEventSyncError(error?.message || 'Nao foi possivel enviar este feedback de teste ao Odoo agora.');
    } finally {
      setSyncingOdooEventId('');
    }
  }

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
            <Typography variant="h6">Integracao com Odoo</Typography>
            <Typography variant="body2" color="text.secondary">
              Feedbacks elegiveis do aplicativo entram automaticamente como atividades na oportunidade. A validacao abaixo apenas confere o acesso.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`${odooQueue.length} feedbacks aguardando integracao`} color="info" variant="outlined" />
            <Button
              variant="outlined"
              startIcon={<SyncOutlinedIcon />}
              onClick={handleOdooConnectionCheck}
              disabled={isCheckingOdoo}
            >
              {isCheckingOdoo ? 'Validando Odoo...' : 'Validar conexao Odoo'}
            </Button>
            {odooConnection?.available && (
              <Button
                variant="contained"
                color="primary"
                onClick={handleCreateOdooTestActivity}
                disabled={isCreatingOdooTest}
              >
                {isCreatingOdooTest ? 'Criando teste...' : 'Criar atividade de teste'}
              </Button>
            )}
          </Stack>
        </Stack>
        {odooConnectionError && <Alert severity="error" sx={{ mt: 2 }}>{odooConnectionError}</Alert>}
        {odooTestActivityError && <Alert severity="error" sx={{ mt: 2 }}>{odooTestActivityError}</Alert>}
        {odooEventSyncError && <Alert severity="error" sx={{ mt: 2 }}>{odooEventSyncError}</Alert>}
        {odooConnection && (
          <Alert severity={odooConnection.available ? 'success' : 'warning'} sx={{ mt: 2 }}>
            {odooConnection.available ? (
              <Stack spacing={1}>
                <Typography variant="body2">
                  {odooConnection.protocol === 'jsonrpc'
                    ? `Conexao JSON-RPC confirmada em ${odooConnection.baseUrl}. O CRM foi validado e as atividades serao agendadas diretamente na oportunidade.`
                    : `Conexao JSON-2 confirmada em ${odooConnection.baseUrl}. Modelo ${odooConnection.crmLeadModelName} confirmado (ID ${odooConnection.crmLeadModelId}).`}
                </Typography>
                {odooConnection.leadId && (
                  <Typography variant="body2" color="text.secondary">
                    Oportunidade {odooConnection.leadId} validada para leitura{odooConnection.leadName ? `: ${odooConnection.leadName}` : '.'}
                  </Typography>
                )}
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {odooConnection.activityScheduling === 'crm_lead_activity_schedule'
                    ? <Chip size="small" label="Tipo padrao de atividade do CRM" color="success" variant="outlined" />
                    : (odooConnection.activityTypes || []).map((activity) => (
                      <Chip key={activity.id} size="small" label={`${activity.name} (#${activity.id})`} variant="outlined" />
                    ))}
                  {odooConnection.activityScheduling !== 'crm_lead_activity_schedule' && !(odooConnection.activityTypes || []).length && <Chip size="small" label="Nenhum tipo de atividade retornado" color="warning" />}
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={0.9}>
                <Typography variant="body2">
                  A conexao Odoo ainda nao foi confirmada. {odooConnection.nextRequirement || 'Verifique a configuracao do Odoo e tente novamente.'}
                </Typography>
                {!!odooConnection.attempts?.length && (
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {odooConnection.attempts.map((attempt) => (
                      <Chip
                        key={`${attempt.baseUrl}-${attempt.code}`}
                        size="small"
                        variant="outlined"
                        label={`${attempt.baseUrl.replace('https://', '')}: ${attempt.code}`}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
          </Alert>
        )}
        {odooTestActivity && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Atividade de teste confirmada no lead {odooTestActivity.leadId} (atividade #{odooTestActivity.activityId}). Repetir esta acao reutiliza o mesmo registro.
          </Alert>
        )}
        {odooEventSync && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Feedback de {odooEventSync.customerName} confirmado no Odoo{odooEventSync.odooActivityId ? ` (atividade #${odooEventSync.odooActivityId})` : ''}. Novos feedbacks elegiveis sao enviados automaticamente.
          </Alert>
        )}
        {odooConnection?.available && (
          <Box mt={2.5} pt={2.5} borderTop="1px solid" borderColor="divider">
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1} mb={1.5} alignItems={{ md: 'center' }}>
              <Box>
                <Typography variant="subtitle1">Reprocessar um feedback especifico</Typography>
                <Typography variant="body2" color="text.secondary">
                  Use esta acao somente para validar ou reenviar um item. A fila automatica processa os novos feedbacks sem intervencao manual.
                </Typography>
              </Box>
              <Chip label={`${testableOdooEvents.length} feedbacks elegiveis`} color="info" variant="outlined" />
            </Stack>
            {testableOdooEvents.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Registre um feedback no app para um cliente importado com ID tecnico Odoo e ele aparecera aqui para o teste individual.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small" aria-label="Feedbacks pendentes para teste individual no Odoo">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell>Vendedor</TableCell>
                      <TableCell>Registrado em</TableCell>
                      <TableCell>ID Odoo</TableCell>
                      <TableCell align="right">Teste</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {testableOdooEvents.slice(0, 10).map((event) => (
                      <TableRow key={`${event.routeId}-${event.stopId}-${event.id}`} hover>
                        <TableCell>{event.customerName || event.customerId || '-'}</TableCell>
                        <TableCell>{event.sellerName || event.sellerEmail || '-'}</TableCell>
                        <TableCell>{formatDateTime(event.createdAt)}</TableCell>
                        <TableCell>#{event.odooLeadId}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={syncingOdooEventId === event.id ? <SyncOutlinedIcon /> : undefined}
                            onClick={() => handleProcessSingleOdooFeedback(event)}
                            disabled={Boolean(syncingOdooEventId)}
                          >
                            {syncingOdooEventId === event.id ? 'Enviando...' : 'Enviar este feedback'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        )}
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
