import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import GroupIcon from '@mui/icons-material/Group';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import RouteIcon from '@mui/icons-material/Route';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import TodayIcon from '@mui/icons-material/Today';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import CustomerDetailsDrawer from '../components/CustomerDetailsDrawer';
import CustomerMap from '../components/CustomerMap';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import PageHeader from '../components/PageHeader';
import RouteDetailsDrawer from '../components/RouteDetailsDrawer';
import SellerDetailsDrawer from '../components/SellerDetailsDrawer';
import { minumTokens } from '../design/tokens';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';
import { updateFollowUpTask } from '../services/api';
import { buildCustomerVisitIndex, hasCustomerCoordinates, latestVisitStatus, visitsForCustomer } from '../utils/customerVisits';
import { formatDate, formatDateTime } from '../utils/formatters';
import { buildLast7DaysVisits, calculateMetrics } from '../utils/helpers';
import {
  buildFollowUpTasks,
  FOLLOW_UP_STATUS,
  followUpStatusColor,
  followUpStatusLabel,
  isFollowUpOverdue,
  nextFollowUpActionLabel,
  nextFollowUpStatus,
} from '../utils/followUpTasks';
import { buildRouteTelemetry, formatTelemetryDistance, formatTelemetryDuration } from '../utils/routeTelemetry';
import { feedbackEvents, flattenVisitEvents } from '../utils/visitEvents';

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip);

/**
 * A Dashboard e a central de trabalho do gestor. Analises extensas continuam
 * no historico e nos relatórios, enquanto aqui ficam apenas decisoes e acoes
 * que precisam de encaminhamento agora.
 */
export default function Dashboard() {
  const {
    customers,
    routes,
    sellers,
    routeStops,
    users,
    visitEvents,
    updateSellerAccess,
  } = useData();
  const { profile } = useAuth();
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [selectedSellerId, setSelectedSellerId] = useState(null);
  const [taskScope, setTaskScope] = useState('active');
  const [updatingTaskId, setUpdatingTaskId] = useState(null);
  const [updatingSellerId, setUpdatingSellerId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const metrics = calculateMetrics({ customers, routes, sellers, routeStops });
  const visits = buildLast7DaysVisits(routeStops);
  const customerVisits = useMemo(() => buildCustomerVisitIndex(routeStops), [routeStops]);
  const customersByKey = useMemo(() => buildCustomerLookup(customers), [customers]);
  const routesById = useMemo(() => new Map(routes.map((route) => [String(route.id), route])), [routes]);
  const usersById = useMemo(() => new Map(users.map((user) => [String(user.id), user])), [users]);
  const routeTelemetry = useMemo(
    () => buildRouteTelemetry(routes, routeStops, visitEvents),
    [routes, routeStops, visitEvents],
  );
  const telemetryByRoute = useMemo(
    () => new Map(routeTelemetry.map((item) => [String(item.routeId), item])),
    [routeTelemetry],
  );
  const mapCustomers = useMemo(
    () => customers
      .filter(hasCustomerCoordinates)
      .map((customer) => {
        const history = visitsForCustomer(customer, customerVisits);
        return { ...customer, visits: history, visitStatus: latestVisitStatus(history) };
      }),
    [customers, customerVisits],
  );
  const mapStatusCount = useMemo(
    () => mapCustomers.reduce((count, customer) => ({ ...count, [customer.visitStatus]: (count[customer.visitStatus] || 0) + 1 }), {}),
    [mapCustomers],
  );
  const eventRecords = useMemo(() => flattenVisitEvents(visitEvents), [visitEvents]);
  const feedbacks = useMemo(() => feedbackEvents(eventRecords), [eventRecords]);
  const followUpTasks = useMemo(
    () => buildFollowUpTasks(eventRecords),
    [eventRecords],
  );
  const fieldSnapshot = useMemo(
    () => buildFieldSnapshot(feedbacks, routeTelemetry),
    [feedbacks, routeTelemetry],
  );
  const visibleTasks = useMemo(
    () => followUpTasks.filter((task) => (
      taskScope === 'completed'
        ? task.followUpStatus === FOLLOW_UP_STATUS.COMPLETED
        : task.followUpStatus !== FOLLOW_UP_STATUS.COMPLETED
    )),
    [followUpTasks, taskScope],
  );
  const taskSummary = useMemo(() => ({
    active: followUpTasks.filter((task) => task.followUpStatus !== FOLLOW_UP_STATUS.COMPLETED).length,
    overdue: followUpTasks.filter((task) => isFollowUpOverdue(task)).length,
    completed: followUpTasks.filter((task) => task.followUpStatus === FOLLOW_UP_STATUS.COMPLETED).length,
  }), [followUpTasks]);
  const latestRoutes = useMemo(
    () => [...routes]
      .sort((first, second) => Number(second.createdAt || second.createdAtTimestamp || 0) - Number(first.createdAt || first.createdAtTimestamp || 0))
      .slice(0, 6),
    [routes],
  );

  const selectedCustomer = selectedCustomerId ? customersByKey.get(normalizeLookupKey(selectedCustomerId)) : null;
  const selectedRoute = selectedRouteId ? routesById.get(String(selectedRouteId)) : null;
  const selectedSeller = selectedSellerId ? usersById.get(String(selectedSellerId)) : null;
  const chartData = {
    labels: visits.labels,
    datasets: [{
      label: 'Visitas',
      data: visits.values,
      backgroundColor: minumTokens.brand.primary,
      borderRadius: 6,
    }],
  };

  function selectCustomer(customerKey) {
    const customer = customersByKey.get(normalizeLookupKey(customerKey));
    if (customer) setSelectedCustomerId(customer.id || customer.externalId);
  }

  async function handleFollowUpStatus(task) {
    const eventId = String(task.id || '').trim();
    if (!eventId || updatingTaskId) return;

    const targetStatus = nextFollowUpStatus(task.followUpStatus);
    setActionError(null);
    setUpdatingTaskId(eventId);
    try {
      await updateFollowUpTask({
        routeId: task.routeId,
        stopId: task.stopId,
        eventId,
        status: targetStatus,
        completedByName: profile?.name || profile?.displayName || profile?.email,
      });
    } catch (error) {
      setActionError(error.message || 'Nao foi possivel atualizar este acompanhamento agora.');
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function handleSellerAccess(seller, active) {
    setActionError(null);
    setUpdatingSellerId(String(seller.id));
    try {
      await updateSellerAccess(seller.id, active);
    } catch (error) {
      setActionError(error.message || 'Nao foi possivel atualizar o acesso do vendedor.');
    } finally {
      setUpdatingSellerId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Visao operacional"
        subtitle="Prioridades do dia, acompanhamento comercial e leitura rápida da operação de campo."
      />
      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="Clientes na base" value={metrics.totalCustomers} icon={PeopleAltIcon} /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="Rotas em historico" value={metrics.totalRoutes} icon={RouteIcon} color={minumTokens.brand.primary} /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="Vendedores ativos" value={metrics.activeSellers} icon={GroupIcon} color={minumTokens.feedback.success} /></Grid>
        <Grid item xs={12} sm={6} lg={3}><MetricCard label="Visitas hoje" value={metrics.visitsToday} icon={TodayIcon} color={minumTokens.feedback.warning} /></Grid>
      </Grid>

      <Box component="section" mb={3.5} aria-labelledby="leitura-campo-title">
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'flex-end' }} spacing={1} mb={1.5}>
          <Box>
            <Typography id="leitura-campo-title" variant="h6">Leitura de campo</Typography>
            <Typography variant="body2" color="text.secondary">Indicadores consolidados dos feedbacks e das rotas que tiveram navegacao ativa.</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">{fieldSnapshot.monitoredRoutes} rotas monitoradas</Typography>
        </Stack>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} lg={3}><MetricCard label="Feedbacks registrados" value={fieldSnapshot.feedbackCount} icon={FactCheckOutlinedIcon} color={minumTokens.brand.primary} /></Grid>
          <Grid item xs={12} sm={6} lg={3}><MetricCard label="Taxa de visita realizada" value={`${fieldSnapshot.visitRate}%`} icon={TrendingUpOutlinedIcon} color={minumTokens.feedback.success} /></Grid>
          <Grid item xs={12} sm={6} lg={3}><MetricCard label="Distancia percorrida" value={formatTelemetryDistance(fieldSnapshot.actualDistanceMeters)} icon={RouteOutlinedIcon} color={minumTokens.feedback.info} /></Grid>
          <Grid item xs={12} sm={6} lg={3}><MetricCard label="Permanencia media" value={formatTelemetryDuration(fieldSnapshot.averageVisitDurationSeconds)} icon={ScheduleOutlinedIcon} color={minumTokens.brand.energy} /></Grid>
        </Grid>
      </Box>

      <FollowUpQueue
        tasks={visibleTasks}
        summary={taskSummary}
        scope={taskScope}
        onScopeChange={setTaskScope}
        onCustomerSelect={selectCustomer}
        onRouteSelect={(routeId) => setSelectedRouteId(routeId)}
        onSellerSelect={(sellerId) => setSelectedSellerId(sellerId)}
        onStatusChange={handleFollowUpStatus}
        isUpdatingTaskId={updatingTaskId}
      />

      <Box component="section" mb={3.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1.5} mb={1.5}>
          <Box>
            <Typography variant="h6">Mapa operacional</Typography>
            <Typography variant="body2" color="text.secondary">Clientes geolocalizados e o resultado mais recente de cada visita.</Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <MapLegend color={minumTokens.feedback.info} label={`Pendentes ${mapStatusCount.pending || 0}`} />
            <MapLegend color={minumTokens.feedback.success} label={`Visitados ${mapStatusCount.visited || 0}`} />
            <MapLegend color={minumTokens.feedback.error} label={`Nao visitados ${mapStatusCount.not_visited || 0}`} />
          </Stack>
        </Stack>
        <CustomerMap
          customers={mapCustomers}
          selectedCustomerId={selectedCustomerId}
          onCustomerSelect={setSelectedCustomerId}
        />
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={0.4}>Ritmo de visitas</Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>Atendimentos registrados nos últimos sete dias.</Typography>
              <Bar data={chartData} options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }} />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ height: '100%', overflow: 'hidden' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2, pb: 1.25 }}>
              <Box>
                <Typography variant="h6">Rotas recentes</Typography>
                <Typography variant="body2" color="text.secondary">Abra uma rota para ver paradas e execução.</Typography>
              </Box>
              <RouteIcon color="secondary" />
            </Stack>
            <Divider />
            <Table size="small" aria-label="Rotas recentes">
              <TableHead>
                <TableRow>
                  <TableCell>Rota</TableCell>
                  <TableCell>Vendedor</TableCell>
                  <TableCell align="right">Detalhes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {latestRoutes.map((route) => {
                  const seller = usersById.get(String(route.sellerUid || route.vendedor || route.uid || ''));
                  return (
                    <TableRow key={route.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700} noWrap>{route.name || route.nome || route.id}</Typography>
                        <Typography variant="caption" color="text.secondary">{formatDateTime(route.createdAt || route.createdAtTimestamp)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Button size="small" variant="text" onClick={() => seller && setSelectedSellerId(seller.id)} disabled={!seller} sx={{ px: 0, minWidth: 0, justifyContent: 'flex-start' }}>
                          {seller?.name || seller?.displayName || route.sellerName || route.sellerUid || '-'}
                        </Button>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Abrir detalhes da rota">
                          <IconButton aria-label={`Abrir detalhes de ${route.name || route.id}`} onClick={() => setSelectedRouteId(route.id)}>
                            <ChevronRightIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {latestRoutes.length === 0 && (
                  <TableRow><TableCell colSpan={3} align="center">Nenhuma rota encontrada.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>

      <CustomerDetailsDrawer
        customer={selectedCustomer}
        open={Boolean(selectedCustomer)}
        onClose={() => setSelectedCustomerId(null)}
        visits={selectedCustomer ? visitsForCustomer(selectedCustomer, customerVisits) : []}
        routesById={routesById}
        usersById={usersById}
      />
      <RouteDetailsDrawer
        route={selectedRoute}
        open={Boolean(selectedRoute)}
        onClose={() => setSelectedRouteId(null)}
        stops={selectedRoute ? routeStops[selectedRoute.id] : []}
        seller={selectedRoute ? usersById.get(String(selectedRoute.sellerUid || selectedRoute.vendedor || selectedRoute.uid || '')) : null}
        telemetry={selectedRoute ? telemetryByRoute.get(String(selectedRoute.id)) : null}
        onCustomerSelect={selectCustomer}
        onSellerSelect={(seller) => setSelectedSellerId(seller.id)}
      />
      <SellerDetailsDrawer
        seller={selectedSeller}
        open={Boolean(selectedSeller)}
        onClose={() => setSelectedSellerId(null)}
        routes={routes}
        routeStops={routeStops}
        onAccessChange={handleSellerAccess}
        isUpdatingAccess={Boolean(selectedSeller && updatingSellerId === String(selectedSeller.id))}
        onRouteSelect={(route) => setSelectedRouteId(route.id)}
      />
    </>
  );
}

function FollowUpQueue({
  tasks,
  summary,
  scope,
  onScopeChange,
  onCustomerSelect,
  onRouteSelect,
  onSellerSelect,
  onStatusChange,
  isUpdatingTaskId,
}) {
  const [search, setSearch] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const normalizedSearch = normalizeSearchText(search);
  const filteredTasks = useMemo(
    () => tasks.filter((task) => !normalizedSearch || normalizeSearchText(task.customerName).includes(normalizedSearch)),
    [normalizedSearch, tasks],
  );
  const previewTasks = filteredTasks.slice(0, 5);
  const remainingTasks = filteredTasks.slice(5);
  const hasSearch = Boolean(normalizedSearch);

  return (
    <Paper component="section" variant="outlined" sx={{ mb: 3.5, overflow: 'hidden' }} aria-labelledby="fila-title">
      <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" gap={2} sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack spacing={0.6} maxWidth={720}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AssignmentTurnedInOutlinedIcon color="secondary" />
            <Typography id="fila-title" variant="h6">Fila de acompanhamento</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Proximos passos registrados em campo. Assuma, conclua ou reabra cada encaminhamento sem perder o vínculo com a visita original.
          </Typography>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" pt={0.6}>
            <Chip label={`${summary.active} ativas`} size="small" color="primary" />
            {summary.overdue > 0 && <Chip label={`${summary.overdue} em atraso`} size="small" color="error" />}
            <Chip label={`${summary.completed} concluidas`} size="small" variant="outlined" />
          </Stack>
        </Stack>
        <Stack spacing={1} sx={{ width: { xs: '100%', lg: 360 }, flexShrink: 0 }}>
          <TextField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            fullWidth
            label="Buscar cliente"
            placeholder="Digite o nome do cliente"
            inputProps={{ 'aria-label': 'Buscar cliente na fila de acompanhamento' }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment>,
            }}
          />
          <ToggleButtonGroup
            value={scope}
            exclusive
            onChange={(_, value) => value && onScopeChange(value)}
            size="small"
            aria-label="Filtro da fila de acompanhamento"
            sx={{ alignSelf: { lg: 'flex-end' } }}
          >
            <ToggleButton value="active">Ativas</ToggleButton>
            <ToggleButton value="completed">Concluidas</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>
      <Divider />

      {filteredTasks.length === 0 ? (
        <Box p={3}>
          <EmptyState
            title={hasSearch ? 'Nenhum cliente encontrado' : scope === 'active' ? 'Nenhuma acao pendente' : 'Nenhuma acao concluida'}
            description={hasSearch ? 'Tente outro nome ou limpe a busca para ver todos os acompanhamentos.' : scope === 'active' ? 'Os proximos passos informados pelos vendedores aparecerao aqui.' : 'As acoes concluidas permanecem registradas para auditoria.'}
          />
        </Box>
      ) : (
        <>
          <Stack divider={<Divider flexItem />}>
            {previewTasks.map((task) => (
              <FollowUpTaskRow
                key={`${task.routeId}-${task.stopId}-${task.id}`}
                task={task}
                onCustomerSelect={onCustomerSelect}
                onRouteSelect={onRouteSelect}
                onSellerSelect={onSellerSelect}
                onStatusChange={onStatusChange}
                isUpdating={isUpdatingTaskId === String(task.id)}
              />
            ))}
          </Stack>
          {remainingTasks.length > 0 && (
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <Box>
                <Divider />
                <Stack divider={<Divider flexItem />}>
                  {remainingTasks.map((task) => (
                    <FollowUpTaskRow
                      key={`${task.routeId}-${task.stopId}-${task.id}`}
                      task={task}
                      onCustomerSelect={onCustomerSelect}
                      onRouteSelect={onRouteSelect}
                      onSellerSelect={onSellerSelect}
                      onStatusChange={onStatusChange}
                      isUpdating={isUpdatingTaskId === String(task.id)}
                    />
                  ))}
                </Stack>
              </Box>
            </Collapse>
          )}
          {filteredTasks.length > 5 && (
            <Box px={{ xs: 2, md: 2.5 }} py={1.25} borderTop="1px solid" borderColor="divider" bgcolor="action.hover">
              <Button
                size="small"
                endIcon={isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                onClick={() => setIsExpanded((current) => !current)}
                aria-expanded={isExpanded}
              >
                {isExpanded ? 'Recolher fila' : `Ver mais ${remainingTasks.length} ${remainingTasks.length === 1 ? 'acompanhamento' : 'acompanhamentos'}`}
              </Button>
            </Box>
          )}
        </>
      )}
    </Paper>
  );
}

function FollowUpTaskRow({ task, onCustomerSelect, onRouteSelect, onSellerSelect, onStatusChange, isUpdating }) {
  const overdue = isFollowUpOverdue(task);
  const actionLabel = nextFollowUpActionLabel(task.followUpStatus);
  const statusLabel = overdue ? 'Em atraso' : followUpStatusLabel(task.followUpStatus);
  const statusColor = overdue ? 'error' : followUpStatusColor(task.followUpStatus);

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }} sx={{ px: { xs: 2, md: 2.5 }, py: 1.75 }}>
      <Box flex={1} minWidth={0}>
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          <Chip label={statusLabel} size="small" color={statusColor} />
          {task.nextActionDueDate && <Typography variant="caption" color={overdue ? 'error.main' : 'text.secondary'}>Prazo: {formatDate(task.nextActionDueDate)}</Typography>}
        </Stack>
        <Typography variant="subtitle2" mt={0.8}>{task.customerName || 'Cliente nao identificado'}</Typography>
        <Typography variant="body2" color="text.secondary" mt={0.25}>{task.nextAction}</Typography>
        <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap" mt={0.75}>
          <Button size="small" variant="text" startIcon={<PersonOutlineIcon />} onClick={() => onSellerSelect(task.sellerUid)} disabled={!task.sellerUid} sx={{ px: 0 }}>
            {task.sellerName || 'Vendedor'}
          </Button>
          <Typography variant="caption" color="text.secondary">Registrado em {formatDateTime(task.createdAt || task.feedbackAt)}</Typography>
        </Stack>
      </Box>
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button size="small" variant="outlined" startIcon={<VisibilityOutlinedIcon />} onClick={() => onCustomerSelect(task.customerExternalId || task.customerId)}>
          Cliente
        </Button>
        <Tooltip title="Ver rota de origem">
          <IconButton aria-label="Ver rota de origem" onClick={() => onRouteSelect(task.routeId)}>
            <RouteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Button size="small" variant={task.followUpStatus === FOLLOW_UP_STATUS.IN_PROGRESS ? 'contained' : 'outlined'} onClick={() => onStatusChange(task)} disabled={isUpdating}>
          {isUpdating ? 'Salvando...' : actionLabel}
        </Button>
      </Stack>
    </Stack>
  );
}

function MapLegend({ color, label }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.25}>
      <FiberManualRecordIcon sx={{ color, fontSize: 18 }} />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

function buildCustomerLookup(customers) {
  const lookup = new Map();
  customers.forEach((customer) => {
    [customer.id, customer.externalId, customer.cnpjCpf, customer.cpfCnpj]
      .filter(Boolean)
      .forEach((key) => lookup.set(normalizeLookupKey(key), customer));
  });
  return lookup;
}

function normalizeLookupKey(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function buildFieldSnapshot(feedbacks, routeTelemetry) {
  const completedFeedbacks = feedbacks.filter((event) => event.visitStatus === 'visited').length;
  const totals = routeTelemetry.reduce((summary, route) => {
    if (Number.isFinite(route.actualDistanceMeters)) {
      summary.actualDistanceMeters += route.actualDistanceMeters;
      summary.hasActualDistance = true;
    }
    if (Number.isFinite(route.totalVisitDurationSeconds)) {
      summary.totalVisitDurationSeconds += route.totalVisitDurationSeconds;
      summary.visitDurationCount += route.visitDurationCount;
    }
    if (route.hasTelemetry) summary.monitoredRoutes += 1;
    return summary;
  }, {
    actualDistanceMeters: 0,
    hasActualDistance: false,
    totalVisitDurationSeconds: 0,
    visitDurationCount: 0,
    monitoredRoutes: 0,
  });

  return {
    feedbackCount: feedbacks.length,
    visitRate: feedbacks.length ? Math.round((completedFeedbacks / feedbacks.length) * 100) : 0,
    actualDistanceMeters: totals.hasActualDistance ? totals.actualDistanceMeters : null,
    averageVisitDurationSeconds: totals.visitDurationCount
      ? totals.totalVisitDurationSeconds / totals.visitDurationCount
      : null,
    monitoredRoutes: totals.monitoredRoutes,
  };
}
