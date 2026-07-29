import { useMemo } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Chip,
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PageHeader from '../components/PageHeader';
import { useData } from '../hooks/useData';
import { asArray } from '../utils/helpers';
import { formatDateTime } from '../utils/formatters';

const statusLabel = (status) => ({
  planned: 'Planejada',
  in_progress: 'Em andamento',
  'em andamento': 'Em andamento',
  completed: 'Concluida',
  concluida: 'Concluida',
  not_completed: 'Nao concluida',
  visited: 'Visitado',
  not_visited: 'Nao visitado',
}[String(status || '').toLowerCase()] || status || 'Pendente');

const feedbackLocation = (stop) => {
  const latitude = stop.feedbackLocation?.latitude ?? stop.feedbackLatitude ?? stop.visitLocation?.latitude;
  const longitude = stop.feedbackLocation?.longitude ?? stop.feedbackLongitude ?? stop.visitLocation?.longitude;
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) return '-';
  return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`;
};

const feedbackText = (stop) => stop.feedback || stop.visitFeedback || stop.feedbackText || stop.observation || stop.notes || '-';

const feedbackDateTime = (stop) => stop.feedbackAt || stop.visitedAt || stop.visitAt || stop.arrivalTime || stop.horario || stop.timestamp;

export default function Historico() {
  const { routes, routeStops, users } = useData();
  const usersById = useMemo(() => Object.fromEntries(users.map((user) => [user.id, user])), [users]);
  const sortedRoutes = useMemo(
    () => [...routes].sort((a, b) => Number(b.createdAt || b.createdAtTimestamp || 0) - Number(a.createdAt || a.createdAtTimestamp || 0)),
    [routes],
  );

  return (
    <>
      <PageHeader title="Historico de rotas" subtitle="Rotas e paradas gravadas pelo aplicativo Android." />
      <Stack spacing={1.5}>
        {sortedRoutes.map((route) => {
          const sellerUid = route.sellerUid || route.vendedor || route.uid;
          const seller = usersById[sellerUid];
          const stops = asArray(routeStops[route.id]).sort((a, b) => Number(a.order ?? a.ordem ?? 0) - Number(b.order ?? b.ordem ?? 0));

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
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Ordem</TableCell>
                        <TableCell>Cliente</TableCell>
                        <TableCell>Data e horario</TableCell>
                        <TableCell>Localizacao no momento</TableCell>
                        <TableCell>Feedback</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stops.map((stop, index) => (
                        <TableRow key={stop.id}>
                          <TableCell>{stop.order ?? stop.ordem ?? index + 1}</TableCell>
                          <TableCell>{stop.customerName || stop.clienteNome || stop.name || stop.customerId || '-'}</TableCell>
                          <TableCell>{formatDateTime(feedbackDateTime(stop))}</TableCell>
                          <TableCell>{feedbackLocation(stop)}</TableCell>
                          <TableCell sx={{ minWidth: 240 }}>{feedbackText(stop)}</TableCell>
                          <TableCell>{statusLabel(stop.status || stop.result)}</TableCell>
                        </TableRow>
                      ))}
                      {stops.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} align="center">
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
        {sortedRoutes.length === 0 && <Typography color="text.secondary">Nenhuma rota encontrada.</Typography>}
      </Stack>
    </>
  );
}
