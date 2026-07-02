import { useMemo, useState } from 'react';
import CustomerFilters from '../components/CustomerFilters';
import CustomersTable from '../components/CustomersTable';
import PageHeader from '../components/PageHeader';
import { useData } from '../hooks/useData';

const emptyFilters = {
  name: '',
  city: '',
  segment: '',
  status: '',
};

export default function Clientes() {
  const { customers } = useData();
  const [filters, setFilters] = useState(emptyFilters);

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

  return (
    <>
      <PageHeader title="Clientes" subtitle="Base importada do Excel e compartilhada com o app Android." />
      <CustomerFilters filters={filters} onChange={setFilters} segments={segments} statuses={statuses} />
      <CustomersTable customers={filteredCustomers} />
    </>
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function includes(value, search) {
  return String(value || '').toLowerCase().includes(String(search || '').toLowerCase());
}
