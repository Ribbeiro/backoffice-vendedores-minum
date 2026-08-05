import {
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
  Tooltip,
} from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { useMemo, useState } from 'react';
import { currencyBRL } from '../utils/formatters';
import EmptyState from './EmptyState';

export default function CustomersTable({ customers, onCustomerSelect, selectedCustomerId }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const visibleRows = useMemo(
    () => customers.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [customers, page, rowsPerPage],
  );

  if (customers.length === 0) {
    return (
      <Paper variant="outlined">
        <EmptyState title="Nenhum cliente encontrado" description="Ajuste os filtros ou importe uma nova planilha para ampliar a sua base de oportunidades." />
      </Paper>
    );
  }

  return (
    <Paper>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Cliente</TableCell>
              <TableCell>Cidade</TableCell>
              <TableCell>Segmento</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Responsavel</TableCell>
              <TableCell align="right">Receita esperada</TableCell>
              <TableCell align="right">Detalhes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleRows.map((customer) => (
              <TableRow
                key={customer.id}
                hover
                selected={String(customer.id) === String(selectedCustomerId)}
                onClick={() => onCustomerSelect?.(customer)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onCustomerSelect?.(customer);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Ver detalhes de ${customer.name || customer.clientName || customer.id}`}
                sx={{ cursor: onCustomerSelect ? 'pointer' : 'default' }}
              >
                <TableCell>
                  <Typography variant="body2" fontWeight={700}>
                    {customer.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {customer.id}
                  </Typography>
                </TableCell>
                <TableCell>{customer.city || '-'}</TableCell>
                <TableCell>{customer.segment || '-'}</TableCell>
                <TableCell>{customer.pipelineStage || customer.status || '-'}</TableCell>
                <TableCell>{customer.responsableSalesperson || customer.responsibleSalesperson || customer.responsavel || customer.responsible || '-'}</TableCell>
                <TableCell align="right">{currencyBRL(customer.expectedRevenueValue ?? customer.expectedRevenue)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Ver todos os dados do cliente">
                    <IconButton
                      aria-label={`Ver detalhes de ${customer.name || customer.clientName || customer.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCustomerSelect?.(customer);
                      }}
                    >
                      <VisibilityOutlinedIcon />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={customers.length}
        page={page}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number(event.target.value));
          setPage(0);
        }}
        labelRowsPerPage="Linhas"
      />
    </Paper>
  );
}
