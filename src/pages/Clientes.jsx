import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import CustomerFilters from '../components/CustomerFilters';
import CustomerDetailsDrawer from '../components/CustomerDetailsDrawer';
import CustomersTable from '../components/CustomersTable';
import PageHeader from '../components/PageHeader';
import { useData } from '../hooks/useData';
import { deleteCustomer } from '../services/api';
import { buildCustomerVisitIndex, visitsForCustomer } from '../utils/customerVisits';

const emptyFilters = {
  name: '',
  city: '',
  segment: '',
  status: '',
};

export default function Clientes() {
  const { customers, routeStops, routes, users } = useData();
  const [filters, setFilters] = useState(emptyFilters);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [customerPendingDelete, setCustomerPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState(null);

  const segments = useMemo(() => unique(customers.map((customer) => customer.segment)), [customers]);
  const statuses = useMemo(() => unique(customers.map((customer) => customer.pipelineStage)), [customers]);

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => {
      const nameMatch = includes(customer.name, filters.name);
      const cityMatch = includes(customer.city, filters.city);
      const segmentMatch = !filters.segment || customer.segment === filters.segment;
      const statusMatch = !filters.status || customer.pipelineStage === filters.status;
      return nameMatch && cityMatch && segmentMatch && statusMatch;
    });
  }, [customers, filters]);
  const customerVisits = useMemo(() => buildCustomerVisitIndex(routeStops), [routeStops]);
  const customersById = useMemo(() => new Map(customers.map((customer) => [String(customer.id), customer])), [customers]);
  const routesById = useMemo(() => new Map(routes.map((route) => [String(route.id), route])), [routes]);
  const usersById = useMemo(() => new Map(users.map((user) => [String(user.id), user])), [users]);
  const selectedCustomer = selectedCustomerId ? customersById.get(String(selectedCustomerId)) : null;

  async function handleDeleteCustomer() {
    if (!customerPendingDelete) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteCustomer(customerPendingDelete.id);
      setCustomerPendingDelete(null);
      setSelectedCustomerId(null);
    } catch (error) {
      setActionError(error.message || 'Nao foi possivel excluir o cliente agora.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <PageHeader title="Clientes" subtitle="Base compartilhada com o app Android. Clique em um cliente para consultar todos os dados e feedbacks." />
      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
      <CustomerFilters filters={filters} onChange={setFilters} segments={segments} statuses={statuses} />
      <CustomersTable
        customers={filteredCustomers}
        selectedCustomerId={selectedCustomerId}
        onCustomerSelect={(customer) => setSelectedCustomerId(customer.id)}
      />
      <CustomerDetailsDrawer
        customer={selectedCustomer}
        open={Boolean(selectedCustomer)}
        onClose={() => setSelectedCustomerId(null)}
        visits={selectedCustomer ? visitsForCustomer(selectedCustomer, customerVisits) : []}
        routesById={routesById}
        usersById={usersById}
        onDelete={() => setCustomerPendingDelete(selectedCustomer)}
        isDeleting={isDeleting}
      />

      <Dialog open={Boolean(customerPendingDelete)} onClose={() => !isDeleting && setCustomerPendingDelete(null)}>
        <DialogTitle>Excluir cliente da base?</DialogTitle>
        <DialogContent>
          O cadastro de {customerPendingDelete?.name || customerPendingDelete?.clientName || 'este cliente'} deixara de aparecer no app e no backoffice. O historico de visitas ja realizado sera preservado para auditoria.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomerPendingDelete(null)} disabled={isDeleting}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={handleDeleteCustomer} disabled={isDeleting}>
            {isDeleting ? 'Excluindo...' : 'Excluir cliente'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function includes(value, search) {
  return String(value || '').toLowerCase().includes(String(search || '').toLowerCase());
}
