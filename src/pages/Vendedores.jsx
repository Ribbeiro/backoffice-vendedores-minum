import { useMemo, useState } from 'react';
import {
  Alert,
  IconButton,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import RouteDetailsDrawer from '../components/RouteDetailsDrawer';
import SellerDetailsDrawer from '../components/SellerDetailsDrawer';
import StatusIndicator from '../components/StatusIndicator';
import { useData } from '../hooks/useData';
import { getLastVisitForSeller, isUserAllowed } from '../utils/helpers';
import { formatDateTime } from '../utils/formatters';
import { buildRouteTelemetry } from '../utils/routeTelemetry';

export default function Vendedores() {
  const { sellers, routes, routeStops, users, visitEvents, updateSellerAccess } = useData();
  const [selectedSellerId, setSelectedSellerId] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [updatingSellerId, setUpdatingSellerId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const usersById = useMemo(() => new Map(users.map((user) => [String(user.id), user])), [users]);
  const telemetryByRoute = useMemo(
    () => new Map(buildRouteTelemetry(routes, routeStops, visitEvents).map((item) => [String(item.routeId), item])),
    [routes, routeStops, visitEvents],
  );
  const selectedSeller = sellers.find((seller) => String(seller.id) === String(selectedSellerId)) || null;
  const selectedRoute = routes.find((route) => String(route.id) === String(selectedRouteId)) || null;

  async function handleAccessChange(seller, active) {
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
      <PageHeader title="Vendedores" subtitle="Acesso, atividade recente e rotas de cada vendedor em um unico lugar." />
      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
      {sellers.length === 0 ? (
        <Paper variant="outlined"><EmptyState title="Nenhum vendedor cadastrado" description="Crie uma conta de vendedor para disponibilizar as rotas e os clientes correspondentes." /></Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Vendedor</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Ultima visita</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Acesso</TableCell>
                <TableCell align="right">Detalhes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sellers.map((seller) => {
                const active = isUserAllowed(seller);
                const lastVisit = getLastVisitForSeller(seller.id, routes, routeStops);
                const isUpdating = updatingSellerId === String(seller.id);
                return (
                  <TableRow key={seller.id} hover>
                    <TableCell>
                      <Stack>
                        <Typography fontWeight={700}>{seller.name || seller.displayName || seller.email || seller.id}</Typography>
                        <Typography variant="caption" color="text.secondary">{seller.email || seller.id}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{seller.state || '-'}</TableCell>
                    <TableCell>{formatDateTime(lastVisit)}</TableCell>
                    <TableCell><StatusIndicator status={active ? 'active' : 'inactive'} /></TableCell>
                    <TableCell align="right">
                      <Switch
                        checked={active}
                        disabled={isUpdating}
                        onChange={(event) => handleAccessChange(seller, event.target.checked)}
                        inputProps={{ 'aria-label': `Alterar acesso de ${seller.name || seller.email || seller.id}` }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Abrir detalhes do vendedor">
                        <IconButton aria-label={`Abrir detalhes de ${seller.name || seller.email || seller.id}`} onClick={() => setSelectedSellerId(seller.id)}>
                          <ChevronRightIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <SellerDetailsDrawer
        seller={selectedSeller}
        open={Boolean(selectedSeller)}
        onClose={() => setSelectedSellerId(null)}
        routes={routes}
        routeStops={routeStops}
        onAccessChange={handleAccessChange}
        isUpdatingAccess={Boolean(selectedSeller && updatingSellerId === String(selectedSeller.id))}
        onRouteSelect={(route) => setSelectedRouteId(route.id)}
      />
      <RouteDetailsDrawer
        route={selectedRoute}
        open={Boolean(selectedRoute)}
        onClose={() => setSelectedRouteId(null)}
        stops={selectedRoute ? routeStops[selectedRoute.id] : []}
        seller={selectedRoute ? usersById.get(String(selectedRoute.sellerUid || selectedRoute.vendedor || selectedRoute.uid || '')) : null}
        telemetry={selectedRoute ? telemetryByRoute.get(String(selectedRoute.id)) : null}
        onSellerSelect={(seller) => setSelectedSellerId(seller.id)}
      />
    </>
  );
}
