import { Card, CardContent, Grid, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import RouteIcon from '@mui/icons-material/Route';
import TodayIcon from '@mui/icons-material/Today';
import GroupIcon from '@mui/icons-material/Group';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip as ChartTooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import MetricCard from '../components/MetricCard';
import PageHeader from '../components/PageHeader';
import { useData } from '../hooks/useData';
import { buildLast7DaysVisits, calculateMetrics } from '../utils/helpers';
import { formatDateTime } from '../utils/formatters';

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip);

export default function Dashboard() {
  const { customers, routes, sellers, routeStops } = useData();
  const metrics = calculateMetrics({ customers, routes, sellers, routeStops });
  const visits = buildLast7DaysVisits(routeStops);
  const latestRoutes = [...routes]
    .sort((a, b) => Number(b.createdAt || b.createdAtTimestamp || 0) - Number(a.createdAt || a.createdAtTimestamp || 0))
    .slice(0, 5);

  const chartData = {
    labels: visits.labels,
    datasets: [
      {
        label: 'Visitas',
        data: visits.values,
        backgroundColor: '#155e75',
        borderRadius: 6,
      },
    ],
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Resumo operacional dos clientes, rotas e vendedores." />
      <Grid container spacing={2} mb={3}>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Clientes" value={metrics.totalCustomers} icon={<PeopleAltIcon />} />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Rotas" value={metrics.totalRoutes} icon={<RouteIcon />} color="secondary.main" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Vendedores ativos" value={metrics.activeSellers} icon={<GroupIcon />} color="success.main" />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <MetricCard label="Visitas hoje" value={metrics.visitsToday} icon={<TodayIcon />} color="#b45309" />
        </Grid>
      </Grid>

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
