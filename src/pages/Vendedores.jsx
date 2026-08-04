import {
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import StatusIndicator from '../components/StatusIndicator';
import { useData } from '../hooks/useData';
import { getLastVisitForSeller, isUserAllowed } from '../utils/helpers';
import { formatDateTime } from '../utils/formatters';

export default function Vendedores() {
  const { sellers, routes, routeStops, updateSellerAccess } = useData();

  return (
    <>
      <PageHeader title="Vendedores" subtitle="Usuarios com acesso ao app e acompanhamento de atividade recente." />
      {sellers.length === 0 ? (
        <Paper variant="outlined"><EmptyState title="Nenhum vendedor cadastrado" description="Crie uma conta de vendedor para disponibilizar as rotas e os clientes do estado correspondente." /></Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Vendedor</TableCell>
                <TableCell>Ultima visita</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Acesso</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sellers.map((seller) => {
                const active = isUserAllowed(seller);
                const lastVisit = getLastVisitForSeller(seller.id, routes, routeStops);
                return (
                  <TableRow key={seller.id} hover>
                    <TableCell>
                      <Stack>
                        <Typography fontWeight={700}>{seller.name || seller.displayName || seller.email || seller.id}</Typography>
                        <Typography variant="caption" color="text.secondary">{seller.email || seller.id}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{formatDateTime(lastVisit)}</TableCell>
                    <TableCell><StatusIndicator status={active ? 'active' : 'inactive'} /></TableCell>
                    <TableCell align="right">
                      <Switch checked={active} onChange={(event) => updateSellerAccess(seller.id, event.target.checked)} inputProps={{ 'aria-label': `Alterar acesso de ${seller.name || seller.email || seller.id}` }} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
