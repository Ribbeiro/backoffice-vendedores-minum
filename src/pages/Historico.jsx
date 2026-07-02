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
                    <Chip label={`${stops.length} paradas`} size="small" color="primary" />
                  </Stack>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Origem: {route.origin?.latitude || route.origem?.latitude || route.startLatitude || '-'}, {route.origin?.longitude || route.origem?.longitude || route.startLongitude || '-'}
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Ordem</TableCell>
                        <TableCell>Cliente</TableCell>
                        <TableCell>Horario</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {stops.map((stop, index) => (
                        <TableRow key={stop.id}>
                          <TableCell>{stop.order ?? stop.ordem ?? index + 1}</TableCell>
                          <TableCell>{stop.customerName || stop.clienteNome || stop.name || stop.customerId || '-'}</TableCell>
                          <TableCell>{formatDateTime(stop.arrivalTime || stop.horario || stop.visitedAt || stop.timestamp)}</TableCell>
                          <TableCell>{stop.status || stop.result || '-'}</TableCell>
                        </TableRow>
                      ))}
                      {stops.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} align="center">
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
