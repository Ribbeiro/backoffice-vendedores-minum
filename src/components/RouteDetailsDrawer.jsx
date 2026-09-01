import {
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import StatusIndicator from './StatusIndicator';
import OperationalDetailsDrawer, { OperationalDrawerSection } from './OperationalDetailsDrawer';
import { asArray } from '../utils/helpers';
import { formatDate, formatDateTime } from '../utils/formatters';
import { formatTelemetryDistance, formatTelemetryDuration, formatTelemetryVariance } from '../utils/routeTelemetry';
import { attendancesForStop, attendanceDurationSeconds } from '../utils/routeAttendances';
import { stopPrimaryName } from '../utils/customerDisplay';

/** Drawer padrao para consulta de uma rota sem forcar a operacao a abrir outra tela. */
export default function RouteDetailsDrawer({
  route,
  stops = [],
  seller,
  telemetry,
  open,
  onClose,
  onCustomerSelect,
  onSellerSelect,
}) {
  if (!route) return null;

  const routeStops = asArray(stops).sort((first, second) => Number(first.order || 0) - Number(second.order || 0));
  const visitedStops = routeStops.filter((stop) => normalizeStopStatus(stop) === 'visited');
  const reportedStops = routeStops.filter((stop) => ['visited', 'not_visited'].includes(normalizeStopStatus(stop)));
  const routeStatus = routeStatusLabel(route.status, route.isCompleted);
  const origin = route.origin || route.origem;

  return (
    <OperationalDetailsDrawer
      open={open}
      onClose={onClose}
      eyebrow="Rota"
      title={route.name || route.nome || route.id}
      subtitle={`${routeStops.length} paradas${route.dueDate ? ` | cumprir ate ${formatDate(route.dueDate)}` : ''}`}
      status={<StatusIndicator status={route.status} label={routeStatus} />}
      actions={seller && onSellerSelect ? (
        <Button variant="outlined" startIcon={<PersonOutlineIcon />} onClick={() => onSellerSelect(seller)}>
          Ver vendedor
        </Button>
      ) : null}
      ariaLabel={`Detalhes da rota ${route.name || route.id}`}
    >
      <Stack spacing={2.5}>
        <OperationalDrawerSection title="Resumo da execucao">
          <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap={1.25}>
            <SummaryMetric label="Vendedor" value={seller?.name || seller?.displayName || seller?.email || route.sellerName || route.sellerUid || '-'} />
            <SummaryMetric label="Feedbacks" value={`${reportedStops.length}/${routeStops.length}`} />
            <SummaryMetric label="Visitas concluídas" value={`${visitedStops.length}/${routeStops.length}`} />
            <SummaryMetric label="Criada em" value={formatDateTime(route.createdAt || route.createdAtTimestamp)} />
          </Box>
          {route.notCompletedReason && (
            <Paper variant="outlined" sx={{ mt: 1.5, p: 1.25, bgcolor: 'error.light' }}>
              <Typography variant="caption" color="error.main">Motivo da nao conclusao</Typography>
              <Typography variant="body2" mt={0.35}>{route.notCompletedReason}</Typography>
            </Paper>
          )}
        </OperationalDrawerSection>

        <Divider />
        <OperationalDrawerSection title="Planejamento e GPS">
          <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap={1.25}>
            <SummaryMetric label="Distancia prevista" value={formatTelemetryDistance(telemetry?.plannedDistanceMeters ?? route.estimatedDistanceMeters ?? route.distanceMeters)} />
            <SummaryMetric label="Tempo previsto" value={formatTelemetryDuration(telemetry?.plannedDurationSeconds ?? route.estimatedDurationSeconds ?? route.durationSeconds)} />
            <SummaryMetric label="Distancia percorrida" value={formatTelemetryDistance(telemetry?.actualDistanceMeters)} />
            <SummaryMetric label="Tempo em rota" value={formatTelemetryDuration(telemetry?.actualDurationSeconds)} />
            <SummaryMetric label="Variacao de distancia" value={formatTelemetryVariance(telemetry?.distanceVariancePercent)} />
            <SummaryMetric label="Inicio da navegacao" value={formatDateTime(telemetry?.startedAt || route.startedAt)} />
          </Box>
          {origin && (
            <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>
              Origem registrada: {origin.latitude ?? '-'}, {origin.longitude ?? '-'}
            </Typography>
          )}
        </OperationalDrawerSection>

        <Divider />
        <OperationalDrawerSection title="Paradas da rota">
          {routeStops.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Esta rota ainda nao possui paradas sincronizadas.</Typography>
          ) : (
            <List disablePadding aria-label="Paradas da rota">
              {routeStops.map((stop, index) => {
                const attendances = attendancesForStop(stop);
                const latestAttendance = attendances[0];
                const customerKey = stop.customerId || stop.customerExternalId || stop.id;
                const status = normalizeStopStatus(latestAttendance || stop);
                const duration = latestAttendance ? attendanceDurationSeconds(latestAttendance) : null;
                return (
                  <ListItemButton
                    key={stop.id || `${customerKey}-${index}`}
                    onClick={() => onCustomerSelect?.(customerKey)}
                    disabled={!onCustomerSelect || !customerKey}
                    sx={{ px: 0, py: 1.15, alignItems: 'flex-start', borderBottom: index < routeStops.length - 1 ? '1px solid' : 0, borderColor: 'divider' }}
                  >
                    <Box mr={1.25} mt={0.35} minWidth={28} height={28} borderRadius="50%" display="grid" sx={{ placeItems: 'center', bgcolor: 'action.selected', color: 'primary.main', fontSize: 13, fontWeight: 700 }}>
                      {stop.order || index + 1}
                    </Box>
                    <ListItemText
                      primary={stopPrimaryName(stop, null, customerKey)}
                      primaryTypographyProps={{ fontWeight: 700, variant: 'body2' }}
                      secondary={[
                        [stop.city, stop.state].filter(Boolean).join(' - '),
                        attendances.length ? `${attendances.length} atendimento${attendances.length > 1 ? 's' : ''}` : null,
                        Number.isFinite(duration) ? `Permanencia ${formatTelemetryDuration(duration)}` : null,
                      ].filter(Boolean).join(' | ')}
                    />
                    <Chip label={stopStatusLabel(status)} size="small" color={stopStatusColor(status)} />
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </OperationalDrawerSection>

        {route.assignmentNotes && (
          <>
            <Divider />
            <OperationalDrawerSection title="Orientacoes administrativas">
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{route.assignmentNotes}</Typography>
            </OperationalDrawerSection>
          </>
        )}
      </Stack>
    </OperationalDetailsDrawer>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, minHeight: 76 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={700} mt={0.35} sx={{ overflowWrap: 'anywhere' }}>{value || '-'}</Typography>
    </Paper>
  );
}

function normalizeStopStatus(stop) {
  return String(stop?.status || stop?.result || '').trim().toLowerCase();
}

function routeStatusLabel(status, isCompleted) {
  if (isCompleted || status === 'completed' || status === 'concluida') return 'Concluida';
  if (status === 'not_completed') return 'Nao concluida';
  if (status === 'in_progress') return 'Em andamento';
  if (status === 'assigned') return 'Atribuida';
  return 'Planejada';
}

function stopStatusLabel(status) {
  if (status === 'visited') return 'Visitado';
  if (status === 'not_visited') return 'Nao visitado';
  if (status === 'in_progress') return 'Em visita';
  return 'Pendente';
}

function stopStatusColor(status) {
  if (status === 'visited') return 'success';
  if (status === 'not_visited') return 'error';
  if (status === 'in_progress') return 'info';
  return 'default';
}
