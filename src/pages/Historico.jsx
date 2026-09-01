import { Fragment, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Chip,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import RouteReportPanel from '../components/RouteReportPanel';
import RouteDetailsDrawer from '../components/RouteDetailsDrawer';
import RouteEditDialog from '../components/RouteEditDialog';
import { useData } from '../hooks/useData';
import { deleteRoute, updateSharedRouteAssignment } from '../services/api';
import { asArray } from '../utils/helpers';
import { formatDate, formatDateTime } from '../utils/formatters';
import {
  buildCustomerLookup,
  distanceAssessment,
  feedbackDistanceFromCustomer,
  formatDistanceMeters,
} from '../utils/locationDistance';
import {
  buildRouteTelemetry,
  formatTelemetryDistance,
  formatTelemetryDuration,
  formatTelemetryVariance,
  stopVisitDurationSeconds,
  telemetryVarianceColor,
} from '../utils/routeTelemetry';
import { attendanceDurationSeconds, attendancesForStop } from '../utils/routeAttendances';

const statusLabel = (status) => ({
  planned: 'Planejada',
  assigned: 'Atribuida',
  in_progress: 'Em andamento',
  'em andamento': 'Em andamento',
  completed: 'Concluida',
  concluida: 'Concluida',
  not_completed: 'Nao concluida',
  awaiting_feedback: 'Aguardando feedback',
  visited: 'Visitado',
  not_visited: 'Nao visitado',
}[String(status || '').toLowerCase()] || status || 'Pendente');

const feedbackText = (stop) => {
  const feedback = stop.feedback || stop.visitFeedback || stop.feedbackText || stop.observation || stop.notes || '-';
  const details = [
    stop.notVisitedReason && `Motivo: ${stop.notVisitedReason}`,
    stop.commercialOutcome && `Resultado: ${stop.commercialOutcome}`,
    stop.nextAction && `Proximo passo: ${stop.nextAction}${stop.nextActionDueDate ? ` (${stop.nextActionDueDate})` : ''}`,
  ].filter(Boolean);

  return [feedback, ...details].join('\n');
};

const feedbackDateTime = (stop) => stop.updatedAt || stop.feedbackAt || stop.visitedAt || stop.visitAt || stop.arrivalTime || stop.horario || stop.timestamp;

export default function Historico() {
  const { customers, routes, routeStops, users, visitEvents } = useData();
  const [routePendingDelete, setRoutePendingDelete] = useState(null);
  const [routePendingEdit, setRoutePendingEdit] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [filteredRouteIds, setFilteredRouteIds] = useState(null);
  const usersById = useMemo(() => Object.fromEntries(users.map((user) => [user.id, user])), [users]);
  const customersByKey = useMemo(() => buildCustomerLookup(customers), [customers]);
  const filteredRouteIdSet = useMemo(
    () => (filteredRouteIds ? new Set(filteredRouteIds) : null),
    [filteredRouteIds],
  );
  const sortedRoutes = useMemo(
    () => routes
      .filter((route) => !filteredRouteIdSet || filteredRouteIdSet.has(String(route.id)))
      .sort((a, b) => Number(b.createdAt || b.createdAtTimestamp || 0) - Number(a.createdAt || a.createdAtTimestamp || 0)),
    [routes, filteredRouteIdSet],
  );
  const telemetryByRoute = useMemo(
    () => new Map(buildRouteTelemetry(routes, routeStops, visitEvents).map((item) => [String(item.routeId), item])),
    [routes, routeStops, visitEvents],
  );
  const selectedRoute = selectedRouteId ? routes.find((route) => String(route.id) === String(selectedRouteId)) : null;

  const handleFilteredRoutesChange = useCallback((filteredRoutes) => {
    const nextIds = filteredRoutes
      .map((route) => String(route.id))
      .sort((first, second) => first.localeCompare(second));

    setFilteredRouteIds((current) => {
      if (current?.length === nextIds.length && current.every((routeId, index) => routeId === nextIds[index])) {
        return current;
      }
      return nextIds;
    });
  }, []);

  async function handleDeleteRoute() {
    if (!routePendingDelete) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteRoute(routePendingDelete);
      setRoutePendingDelete(null);
    } catch (error) {
      setActionError(error.message || 'Nao foi possivel excluir a rota agora.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <PageHeader title="Historico de rotas" subtitle="Rotas e paradas gravadas pelo aplicativo Android." />
      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
      <RouteReportPanel
        customers={customers}
        routes={routes}
        routeStops={routeStops}
        users={users}
        visitEvents={visitEvents}
        onFilteredRoutesChange={handleFilteredRoutesChange}
      />
      <Stack spacing={1.5}>
        {sortedRoutes.map((route) => {
          const sellerUid = route.sellerUid || route.vendedor || route.uid;
          const seller = usersById[sellerUid];
          const stops = asArray(routeStops[route.id]).sort((a, b) => Number(a.order ?? a.ordem ?? 0) - Number(b.order ?? b.ordem ?? 0));
          const reportedStops = stops.filter((stop) => ['visited', 'not_visited'].includes(String(stop.status || stop.result || '').toLowerCase()));
          const visitedStops = stops.filter((stop) => String(stop.status || stop.result || '').toLowerCase() === 'visited');
          const completionPercent = stops.length ? Math.round((visitedStops.length / stops.length) * 100) : 0;
          const isSharedAssignment = route.assignmentType === 'shared' || route.source === 'admin_assignment';
          const telemetry = telemetryByRoute.get(String(route.id));

          return (
            <Accordion key={route.id} disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between" spacing={1} width="100%">
                  <Typography fontWeight={700}>{route.name || route.nome || route.id}</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip label={seller?.name || seller?.email || sellerUid || 'Sem vendedor'} size="small" />
                    <Chip label={formatDateTime(route.createdAt || route.createdAtTimestamp)} size="small" variant="outlined" />
                    <Chip label={statusLabel(route.status)} size="small" color={route.status === 'completed' || route.status === 'concluida' ? 'success' : 'default'} />
                    <Chip label={`${stops.length} paradas`} size="small" color="primary" />
                    {isSharedAssignment && <Chip label="Atribuida" size="small" color="secondary" />}
                    <Button
                      size="small"
                      variant="text"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedRouteId(route.id);
                      }}
                    >
                      Resumo
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<EditOutlinedIcon fontSize="small" />}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setRoutePendingEdit(route);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteOutlineIcon fontSize="small" />}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setRoutePendingDelete(route);
                      }}
                    >
                      Excluir
                    </Button>
                  </Stack>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Origem: {route.origin?.latitude || route.origem?.latitude || route.startLatitude || '-'}, {route.origin?.longitude || route.origem?.longitude || route.startLongitude || '-'}
                </Typography>
                {route.notCompletedReason && (
                  <Typography variant="body2" color="error" mb={2}>
                    Motivo da nao conclusao da rota: {route.notCompletedReason}
                  </Typography>
                )}
                {isSharedAssignment && (
                  <Stack spacing={0.5} mb={2}>
                    <Typography variant="body2" color="text.secondary">
                      Prazo: {formatDate(route.dueDate)} | Meta: {route.targetCompletionPercent || 90}% | Resultado: {visitedStops.length}/{stops.length} visitados ({completionPercent}%)
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Feedbacks registrados: {reportedStops.length}/{stops.length} | Criada por: {route.createdByName || route.createdByUid || '-'}
                    </Typography>
                    {route.assignmentNotes && <Typography variant="body2">Orientacoes: {route.assignmentNotes}</Typography>}
                  </Stack>
                )}
                {telemetry?.hasTelemetry && <TelemetrySummary telemetry={telemetry} />}
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Ordem</TableCell>
                        <TableCell>Cliente</TableCell>
                        <TableCell>Check-in</TableCell>
                        <TableCell>Ultimo resultado</TableCell>
                        <TableCell>Permanencia</TableCell>
                        <TableCell>Distancia do cliente</TableCell>
                        <TableCell>Feedback</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stops.map((stop, index) => {
                        const attendances = attendancesForStop(stop);
                        const latestAttendance = attendances[0] || null;
                        const latest = latestAttendance ? { ...stop, ...latestAttendance } : stop;
                        const distance = feedbackDistanceFromCustomer(latest, customersByKey);
                        const attendanceDuration = latestAttendance
                          ? attendanceDurationSeconds(latestAttendance)
                          : stopVisitDurationSeconds(stop);
                        return (
                          <Fragment key={stop.id || `${route.id}-${index}`}>
                            <TableRow>
                              <TableCell>{stop.order ?? stop.ordem ?? index + 1}</TableCell>
                              <TableCell>
                                <Typography variant="body2" fontWeight={600}>{stop.opportunity || stop.customerName || stop.clienteNome || stop.name || stop.customerId || '-'}</Typography>
                                {attendances.length > 0 && <Typography variant="caption" color="text.secondary">{attendances.length} atendimento{attendances.length > 1 ? 's' : ''} registrado{attendances.length > 1 ? 's' : ''}</Typography>}
                              </TableCell>
                              <TableCell>{formatDateTime(latest.checkInAt || latest.arrivedAt || latest.arrivedAtClient)}</TableCell>
                              <TableCell>{formatDateTime(feedbackDateTime(latest))}</TableCell>
                              <TableCell>{formatTelemetryDuration(attendanceDuration)}</TableCell>
                              <TableCell>
                                <AttendanceDistanceCell attendance={latestAttendance} fallbackDistance={distance} />
                              </TableCell>
                              <TableCell sx={{ minWidth: 240, whiteSpace: 'pre-line' }}>{feedbackText(latest)}</TableCell>
                              <TableCell>{statusLabel(latest.status || latest.result)}</TableCell>
                            </TableRow>
                            {attendances.length > 0 && (
                              <TableRow sx={{ '& > *': { borderBottom: 0 }, bgcolor: 'action.hover' }}>
                                <TableCell colSpan={8} sx={{ py: 1.5, pl: 5 }}>
                                  <AttendanceHistoryTable attendances={attendances} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                      {stops.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} align="center">
                            Nenhuma parada encontrada.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </AccordionDetails>
            </Accordion>
          );
        })}
        {sortedRoutes.length === 0 && (
          <EmptyState
            title={routes.length ? 'Nenhuma rota corresponde aos filtros' : 'Nenhuma rota encontrada'}
            description={routes.length ? 'Ajuste ou limpe os filtros do relatorio para visualizar outras rotas.' : 'Quando uma rota for planejada no aplicativo, o acompanhamento e os feedbacks aparecerao aqui.'}
          />
        )}
      </Stack>
      <RouteDetailsDrawer
        route={selectedRoute}
        open={Boolean(selectedRoute)}
        onClose={() => setSelectedRouteId(null)}
        stops={selectedRoute ? routeStops[selectedRoute.id] : []}
        seller={selectedRoute ? usersById[selectedRoute.sellerUid || selectedRoute.vendedor || selectedRoute.uid] : null}
        telemetry={selectedRoute ? telemetryByRoute.get(String(selectedRoute.id)) : null}
      />
      <RouteEditDialog
        route={routePendingEdit}
        stops={routePendingEdit ? routeStops[routePendingEdit.id] : []}
        sellers={users.filter((user) => ['vendedor', 'seller', 'salesperson'].includes(String(user.role || '').toLowerCase()) || (!user.role && Boolean(user.state)))}
        customers={customers}
        open={Boolean(routePendingEdit)}
        onClose={() => setRoutePendingEdit(null)}
        onSave={updateSharedRouteAssignment}
      />
      <Dialog open={Boolean(routePendingDelete)} onClose={() => !isDeleting && setRoutePendingDelete(null)}>
        <DialogTitle>Excluir rota permanentemente?</DialogTitle>
        <DialogContent>
          A rota, todas as paradas, a copia enviada ao vendedor e os eventos de visita associados serao removidos do Firebase. Esta acao nao pode ser desfeita.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoutePendingDelete(null)} disabled={isDeleting}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={handleDeleteRoute} disabled={isDeleting}>
            {isDeleting ? 'Excluindo...' : 'Excluir rota'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function TelemetrySummary({ telemetry }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75, mb: 2, bgcolor: 'action.hover' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5} alignItems={{ md: 'center' }}>
        <Stack spacing={0.45}>
          <Typography variant="subtitle2">Execucao registrada pelo GPS</Typography>
          <Typography variant="body2" color="text.secondary">
            Inicio: {formatDateTime(telemetry.startedAt)} | Encerramento: {formatDateTime(telemetry.finishedAt)} | {telemetry.locationSampleCount || 0} amostras
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} flexWrap="wrap">
          <Chip label={`Percorrido ${formatTelemetryDistance(telemetry.actualDistanceMeters)}`} size="small" color="success" />
          <Chip label={`Rota ${formatTelemetryDistance(telemetry.plannedDistanceMeters)}`} size="small" variant="outlined" />
          <Chip
            label={formatTelemetryVariance(telemetry.distanceVariancePercent)}
            size="small"
            color={telemetryVarianceColor(telemetry.distanceVariancePercent)}
            variant="outlined"
          />
          <Chip label={`Em rota ${formatTelemetryDuration(telemetry.actualDurationSeconds)}`} size="small" color="info" variant="outlined" />
          <Chip label={`Parado ${formatTelemetryDuration(telemetry.stoppedDurationSeconds)}`} size="small" variant="outlined" />
          <Chip label={`Media por atendimento ${formatTelemetryDuration(telemetry.averageVisitDurationSeconds)}`} size="small" variant="outlined" />
        </Stack>
      </Stack>
    </Paper>
  );
}

function DistanceCell({ distance }) {
  if (!Number.isFinite(distance.meters)) {
    return <Typography variant="body2" color="text.secondary">{distance.reason}</Typography>;
  }

  const assessment = distanceAssessment(distance.meters);
  return (
    <Tooltip title={`Distancia GPS em linha reta usando a posicao salva no feedback e a coordenada da ${distance.targetSource}.`}>
      <Stack spacing={0.25} alignItems="flex-start" sx={{ minWidth: 132 }}>
        <Chip label={formatDistanceMeters(distance.meters)} size="small" color={assessment.color} />
        <Typography variant="caption" color="text.secondary">{assessment.label}</Typography>
      </Stack>
    </Tooltip>
  );
}

function AttendanceDistanceCell({ attendance, fallbackDistance }) {
  const value = Number(attendance?.checkOutDistanceToCustomerMeters ?? attendance?.checkInDistanceToCustomerMeters);
  if (Number.isFinite(value)) {
    const assessment = distanceAssessment(value);
    return (
      <Tooltip title="Distancia em linha reta entre o GPS salvo no check-in ou checkout e o cliente.">
        <Stack spacing={0.25} alignItems="flex-start" sx={{ minWidth: 132 }}>
          <Chip label={formatDistanceMeters(value)} size="small" color={assessment.color} />
          <Typography variant="caption" color="text.secondary">{assessment.label}</Typography>
        </Stack>
      </Tooltip>
    );
  }
  return <DistanceCell distance={fallbackDistance} />;
}

function AttendanceHistoryTable({ attendances }) {
  return (
    <Table size="small" aria-label="Historico de atendimentos do cliente">
      <TableHead>
        <TableRow>
          <TableCell>Atendimento</TableCell>
          <TableCell>Check-in</TableCell>
          <TableCell>Checkout</TableCell>
          <TableCell>Permanencia</TableCell>
          <TableCell>Distancia check-in</TableCell>
          <TableCell>Distancia checkout</TableCell>
          <TableCell>Feedback</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {[...attendances].reverse().map((attendance, index) => (
          <TableRow key={attendance.id || `${attendance.checkInAt}-${index}`}>
            <TableCell>{index + 1}</TableCell>
            <TableCell>{formatDateTime(attendance.checkInAt)}</TableCell>
            <TableCell>{formatDateTime(attendance.checkOutAt)}</TableCell>
            <TableCell>{formatTelemetryDuration(attendanceDurationSeconds(attendance))}</TableCell>
            <TableCell>{formatDistanceMeters(Number(attendance.checkInDistanceToCustomerMeters))}</TableCell>
            <TableCell>{formatDistanceMeters(Number(attendance.checkOutDistanceToCustomerMeters))}</TableCell>
            <TableCell sx={{ minWidth: 260, whiteSpace: 'pre-line' }}>{feedbackText(attendance)}</TableCell>
            <TableCell>{statusLabel(attendance.status || attendance.result)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
