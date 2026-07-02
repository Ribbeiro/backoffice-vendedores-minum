import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { currencyBRL } from '../utils/formatters';

export default function CustomersTable({ customers }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const visibleRows = useMemo(
    () => customers.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [customers, page, rowsPerPage],
  );

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
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleRows.map((customer) => (
              <TableRow key={customer.id} hover>
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
              </TableRow>
            ))}
            {visibleRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            )}
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
