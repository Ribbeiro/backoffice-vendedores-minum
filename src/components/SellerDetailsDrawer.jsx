import {
  Box,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import StatusIndicator from './StatusIndicator';
import OperationalDetailsDrawer, { OperationalDrawerSection } from './OperationalDetailsDrawer';
import { getLastVisitForSeller, isUserAllowed } from '../utils/helpers';
import { formatDateTime } from '../utils/formatters';

/** Drawer padrao de vendedor com acesso, carteira e atividade recente. */
export default function SellerDetailsDrawer({
  seller,
  open,
  onClose,
  routes = [],
  routeStops = {},
  onAccessChange,
  isUpdatingAccess = false,
  onRouteSelect,
}) {
  if (!seller) return null;

  const active = isUserAllowed(seller);
  const sellerRoutes = routes
    .filter((route) => [route.sellerUid, route.vendedor, route.uid].map(String).includes(String(seller.id)))
    .sort((first, second) => Number(second.createdAt || second.createdAtTimestamp || 0) - Number(first.createdAt || first.createdAtTimestamp || 0));
  const completedRoutes = sellerRoutes.filter((route) => route.isCompleted || route.status === 'completed' || route.status === 'concluida');
  const inProgressRoutes = sellerRoutes.filter((route) => route.status === 'in_progress');
  const plannedStops = sellerRoutes.reduce((total, route) => total + Object.values(routeStops[route.id] || {}).length, 0);

  return (
    <OperationalDetailsDrawer
      open={open}
      onClose={onClose}
      eyebrow="Vendedor"
      title={seller.name || seller.displayName || seller.email || seller.id}
      subtitle={seller.email || 'E-mail nao informado'}
      status={<StatusIndicator status={active ? 'active' : 'inactive'} label={active ? 'Acesso ativo' : 'Acesso inativo'} />}
      actions={onAccessChange ? (
        <FormControlLabel
          control={<Switch checked={active} onChange={(event) => onAccessChange(seller, event.target.checked)} disabled={isUpdatingAccess} />}
          label={active ? 'Acesso liberado' : 'Acesso bloqueado'}
        />
      ) : null}
      ariaLabel={`Detalhes do vendedor ${seller.name || seller.email || seller.id}`}
    >
      <Stack spacing={2.5}>
        <OperationalDrawerSection title="Perfil e cobertura">
          <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap={1.25}>
            <SummaryMetric label="Estado" value={seller.state || 'Nao informado'} />
            <SummaryMetric label="Ultima atividade" value={formatDateTime(getLastVisitForSeller(seller.id, routes, routeStops))} />
            <SummaryMetric label="Rotas criadas" value={sellerRoutes.length} />
            <SummaryMetric label="Clientes em rotas" value={plannedStops} />
          </Box>
        </OperationalDrawerSection>

        <OperationalDrawerSection title="Situacao operacional">
          <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap={1.25}>
            <SummaryMetric label="Em andamento" value={inProgressRoutes.length} />
            <SummaryMetric label="Rotas concluidas" value={completedRoutes.length} />
          </Box>
        </OperationalDrawerSection>

        <OperationalDrawerSection title="Rotas recentes">
          {sellerRoutes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Nenhuma rota foi registrada para este vendedor ainda.</Typography>
          ) : (
            <Stack spacing={1}>
              {sellerRoutes.slice(0, 6).map((route) => (
                <Paper
                  key={route.id}
                  variant="outlined"
                  onClick={() => onRouteSelect?.(route)}
                  sx={{ p: 1.25, cursor: onRouteSelect ? 'pointer' : 'default', '&:hover': onRouteSelect ? { bgcolor: 'action.hover' } : undefined }}
                >
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Box minWidth={0}>
                      <Typography variant="body2" fontWeight={700} noWrap>{route.name || route.id}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatDateTime(route.createdAt || route.createdAtTimestamp)}</Typography>
                    </Box>
                    <StatusIndicator status={route.status} label={route.status === 'completed' ? 'Concluida' : route.status === 'in_progress' ? 'Em andamento' : 'Planejada'} />
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </OperationalDrawerSection>
      </Stack>
    </OperationalDetailsDrawer>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, minHeight: 72 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={700} mt={0.35}>{value ?? '-'}</Typography>
    </Paper>
  );
}
