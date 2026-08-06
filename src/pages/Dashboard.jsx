import { useMemo, useState } from 'react';
import { Box, Card, CardContent, Divider, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import RouteIcon from '@mui/icons-material/Route';
import TodayIcon from '@mui/icons-material/Today';
import GroupIcon from '@mui/icons-material/Group';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import CustomerMap from '../components/CustomerMap';
import EmptyState from '../components/EmptyState';
import MetricCard from '../components/MetricCard';
import PageHeader from '../components/PageHeader';
import StatusIndicator from '../components/StatusIndicator';
import { OperationalIntelligence } from './Inteligencia';
import { minumTokens } from '../design/tokens';
import { useData } from '../hooks/useData';
import { buildLast7DaysVisits, calculateMetrics } from '../utils/helpers';
import { formatDateTime } from '../utils/formatters';
import { buildCustomerVisitIndex, hasCustomerCoordinates, latestVisitStatus, statusLabel, visitsForCustomer } from '../utils/customerVisits';

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip);

export default function Dashboard() {
  const { customers, routes, sellers, routeStops, users } = useData();
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const metrics = calculateMetrics({ customers, routes, sellers, routeStops });
  const visits = buildLast7DaysVisits(routeStops);
  const customerVisits = useMemo(() => buildCustomerVisitIndex(routeStops), [routeStops]);
  const mapCustomers = useMemo(
    () => customers
      .filter(hasCustomerCoordinates)
      .map((customer) => {
        const customerVisitHistory = visitsForCustomer(customer, customerVisits);
        return {
          ...customer,
          visits: customerVisitHistory,
          visitStatus: latestVisitStatus(customerVisitHistory),
        };
      }),
    [customers, customerVisits],
  );
  const customersById = useMemo(() => new Map(mapCustomers.map((customer) => [String(customer.id), customer])), [mapCustomers]);
  const selectedCustomer = selectedCustomerId ? customersById.get(String(selectedCustomerId)) : null;
  const routesById = useMemo(() => new Map(routes.map((route) => [String(route.id), route])), [routes]);
  const usersById = useMemo(() => new Map(users.map((user) => [String(user.id), user])), [users]);
  const mapStatusCount = useMemo(
    () => mapCustomers.reduce((count, customer) => ({ ...count, [customer.visitStatus]: (count[customer.visitStatus] || 0) + 1 }), {}),
    [mapCustomers],
  );
  const latestRoutes = [...routes]
    .sort((a, b) => Number(b.createdAt || b.createdAtTimestamp || 0) - Number(a.createdAt || a.createdAtTimestamp || 0))
    .slice(0, 5);

  const chartData = {
    labels: visits.labels,
    datasets: [
      {
        label: 'Visitas',
        data: visits.values,
        backgroundColor: minumTokens.brand.primary,
        borderRadius: 6,
      },
    ],
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Resumo operacional dos clientes, rotas e vendedores." />
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Clientes" value={metrics.totalCustomers} icon={PeopleAltIcon} />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Rotas" value={metrics.totalRoutes} icon={RouteIcon} color={minumTokens.brand.primary} />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Vendedores ativos" value={metrics.activeSellers} icon={GroupIcon} color={minumTokens.feedback.success} />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Visitas hoje" value={metrics.visitsToday} icon={TodayIcon} color={minumTokens.feedback.warning} />
        </Grid>
      </Grid>

      <Box mb={3}>
        <OperationalIntelligence embedded />
      </Box>

      <Box mb={3}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1.5} mb={1.5}>
          <Box>
            <Typography variant="h6">Mapa operacional</Typography>
            <Typography variant="body2" color="text.secondary">
              Clientes geolocalizados e seus ultimos resultados de visita.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <MapLegend color={minumTokens.feedback.info} label={`Pendentes ${mapStatusCount.pending || 0}`} />
            <MapLegend color={minumTokens.feedback.success} label={`Visitados ${mapStatusCount.visited || 0}`} />
            <MapLegend color={minumTokens.feedback.error} label={`Nao visitados ${mapStatusCount.not_visited || 0}`} />
          </Stack>
        </Stack>
        <Grid container spacing={2}>
          <Grid item xs={12} lg={8}>
            <CustomerMap
              customers={mapCustomers}
              selectedCustomerId={selectedCustomerId}
              onCustomerSelect={setSelectedCustomerId}
            />
          </Grid>
          <Grid item xs={12} lg={4}>
            <CustomerDetails customer={selectedCustomer} routesById={routesById} usersById={usersById} />
          </Grid>
        </Grid>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={2}>
                Visitas nos ultimos 7 dias
              </Typography>
              <Bar data={chartData} options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }} />
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={5}>
          <Card>
            <CardContent>
              <Typography variant="h6" mb={2}>
                Ultimas rotas
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nome</TableCell>
                    <TableCell>Vendedor</TableCell>
                    <TableCell>Criacao</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {latestRoutes.map((route) => (
                    <TableRow key={route.id}>
                      <TableCell>{route.name || route.nome || route.id}</TableCell>
                      <TableCell>{route.sellerName || route.vendedorNome || route.sellerUid || route.vendedor || '-'}</TableCell>
                      <TableCell>{formatDateTime(route.createdAt || route.createdAtTimestamp)}</TableCell>
                    </TableRow>
                  ))}
                  {latestRoutes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} align="center">
                        Nenhuma rota encontrada.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
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

function CustomerDetails({ customer, routesById, usersById }) {
  if (!customer) {
    return (
      <Paper variant="outlined" sx={{ height: { xs: 'auto', lg: 590 }, minHeight: 220, p: 3, display: 'grid', placeItems: 'center' }}>
        <EmptyState title="Selecione um cliente" description="Clique em um ponto do mapa para consultar dados e feedbacks de visitas." />
      </Paper>
    );
  }

  const details = [
    ['Empresa', customer.clientName || customer.opportunity],
    ['CNPJ/CPF', customer.cnpjCpf || customer.cpfCnpj],
    ['Endereco', customer.address || customer.dealAddress],
    ['Cidade / Estado', [customer.city, customer.state].filter(Boolean).join(' - ')],
    ['Segmento', customer.segment],
    ['Responsavel', customer.responsible || customer.responsavel],
    ['Telefone', customer.phone],
    ['Email', customer.email],
    ['Ultima atualizacao', customer.lastUpdate || customer.ultimaAtualizacao],
    ['Distribuidor', customer.distributor],
    ['Vendedor responsavel', customer.responsibleSalesperson || customer.responsableSalesperson],
    ['Receita esperada', customer.expectedRevenue],
    ['Tags', customer.tags],
    ['Origem', customer.origin || customer.origem],
    ['Etapa comercial', customer.pipelineStage || customer.status],
    ['Observacoes comerciais', customer.notes],
    ['Pais', customer.country],
  ].filter(([, value]) => value);

  return (
    <Paper variant="outlined" sx={{ height: { xs: 'auto', lg: 590 }, overflow: 'auto', p: 2.5 }}>
      <Stack spacing={1.25}>
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="h6" lineHeight={1.25}>{customer.name || customer.clientName || customer.id}</Typography>
            <StatusIndicator status={customer.visitStatus} label={statusLabel(customer.visitStatus)} />
          </Stack>
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            {Number(customer.latitude).toFixed(5)}, {Number(customer.longitude).toFixed(5)}
          </Typography>
        </Box>

        <Divider />
        <Stack spacing={1}>
          {details.map(([label, value]) => (
            <Box key={label}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography variant="body2">{value}</Typography>
            </Box>
          ))}
        </Stack>

        <Divider />
        <Typography variant="subtitle2">Feedbacks dos vendedores</Typography>
        {customer.visits.length === 0 && <Typography variant="body2" color="text.secondary">Nenhuma visita registrada para este cliente.</Typography>}
        <Stack spacing={1.25}>
          {customer.visits.map((visit, index) => {
            const route = routesById.get(String(visit.routeId));
            const sellerUid = route?.sellerUid || route?.vendedor || route?.uid;
            const seller = usersById.get(String(sellerUid || ''));
            const latitude = visit.feedbackLocation?.latitude ?? visit.feedbackLatitude;
            const longitude = visit.feedbackLocation?.longitude ?? visit.feedbackLongitude;

            return (
              <Box key={`${visit.routeId}-${visit.id || index}-${visit.timestamp}`} borderLeft="3px solid" borderColor={visit.status === 'visited' ? 'success.main' : visit.status === 'not_visited' ? 'error.main' : 'primary.main'} pl={1.25}>
                <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                  <StatusIndicator status={visit.status} label={statusLabel(visit.status)} />
                  <Typography variant="caption" color="text.secondary">{formatDateTime(visit.timestamp || null)}</Typography>
                </Stack>
                <Typography variant="body2" mt={0.75}>{visit.feedback || 'Sem observacao registrada.'}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" mt={0.75}>
                  {seller?.name || seller?.email || route?.sellerName || route?.vendedorNome || 'Vendedor nao identificado'}
                </Typography>
                {latitude !== undefined && longitude !== undefined && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Local: {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
}
