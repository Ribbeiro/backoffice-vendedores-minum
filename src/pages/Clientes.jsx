import { useMemo, useState } from 'react';
import CustomerFilters from '../components/CustomerFilters';
import CustomerDetailsDrawer from '../components/CustomerDetailsDrawer';
import CustomersTable from '../components/CustomersTable';
import PageHeader from '../components/PageHeader';
import { useData } from '../hooks/useData';
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

  return (
    <>
      <PageHeader title="Clientes" subtitle="Base compartilhada com o app Android. Clique em um cliente para consultar todos os dados e feedbacks." />
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
      />
    </>
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function includes(value, search) {
  return String(value || '').toLowerCase().includes(String(search || '').toLowerCase());
}
