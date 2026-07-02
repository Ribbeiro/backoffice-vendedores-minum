import {
  Chip,
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
import RefreshIcon from '@mui/icons-material/Refresh';
import PageHeader from '../components/PageHeader';
import { useData } from '../hooks/useData';
import { getLastVisitForSeller, isUserAllowed } from '../utils/helpers';
import { formatDateTime } from '../utils/formatters';

export default function Vendedores() {
  const { sellers, routes, routeStops, updateSellerAccess } = useData();

  return (
    <>
      <PageHeader
        title="Vendedores"
        subtitle="Usuarios com role vendedor e controle de acesso ao app."
        action={
          <Tooltip title="Dados atualizados em tempo real pelo Firebase">
            <IconButton>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        }
      />
      <TableContainer component={Paper}>
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
                      <Typography variant="caption" color="text.secondary">
                        {seller.email || seller.id}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{formatDateTime(lastVisit)}</TableCell>
                  <TableCell>
                    <Chip label={active ? 'Ativo' : 'Inativo'} color={active ? 'success' : 'default'} size="small" />
                  </TableCell>
                  <TableCell align="right">
                    <Switch checked={active} onChange={(event) => updateSellerAccess(seller.id, event.target.checked)} />
                  </TableCell>
                </TableRow>
              );
            })}
            {sellers.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  Nenhum vendedor encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
