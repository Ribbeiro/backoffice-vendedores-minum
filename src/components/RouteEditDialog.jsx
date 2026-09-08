import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditRoadOutlinedIcon from '@mui/icons-material/EditRoadOutlined';
import { asArray } from '../utils/helpers';
import { isCustomerAssignedToSeller } from '../utils/sellerCustomerAssignment';
import { customerPrimaryName, customerSearchText } from '../utils/customerDisplay';

const MAX_ROUTE_STOPS = 24;

/**
 * Editor administrativo de uma rota. A protecao de execucao tambem existe no
 * servico Firebase; este aviso evita que a operacao tente alterar uma visita
 * que ja possui registros de campo.
 */
export default function RouteEditDialog({
  route,
  stops,
  sellers = [],
  customers = [],
  open,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState(emptyForm);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const routeStops = useMemo(
    () => asArray(stops).sort((first, second) => Number(first.order ?? first.ordem ?? 0) - Number(second.order ?? second.ordem ?? 0)),
    [stops],
  );
  const customersById = useMemo(() => new Map(customers.map((customer) => [customerKey(customer), customer])), [customers]);
  const routeCustomers = useMemo(
    () => routeStops.map((stop) => customerForStop(stop, customersById)).filter(Boolean),
    [routeStops, customersById],
  );
  const allCustomersById = useMemo(
    () => new Map([...routeCustomers, ...customers].map((customer) => [customerKey(customer), customer])),
    [routeCustomers, customers],
  );
  const sellerOptions = useMemo(() => {
    const routeSellerId = String(route?.sellerUid || route?.vendedor || route?.uid || '').trim();
    if (!routeSellerId || sellers.some((seller) => String(seller.id) === routeSellerId)) return sellers;
    return [{
      id: routeSellerId,
      name: route?.sellerName || route?.sellerEmail || routeSellerId,
      email: route?.sellerEmail || null,
      state: route?.state || null,
    }, ...sellers];
  }, [route, sellers]);
  const selectedSeller = sellerOptions.find((seller) => String(seller.id) === String(form.sellerId)) || null;
  const routeHasExecution = useMemo(() => hasRouteExecution(route, routeStops), [route, routeStops]);
  const selectedCustomers = useMemo(
    () => selectedCustomerIds.map((id) => allCustomersById.get(id)).filter(Boolean),
    [selectedCustomerIds, allCustomersById],
  );
  const sellerCustomers = useMemo(() => {
    if (!selectedSeller) return [];
    return customers.filter((customer) => isCustomerAssignedToSeller(customer, selectedSeller) && hasValidCoordinates(customer));
  }, [customers, selectedSeller]);
  const customerOptions = useMemo(
    () => uniqueCustomers([...selectedCustomers, ...routeCustomers, ...sellerCustomers]),
    [selectedCustomers, routeCustomers, sellerCustomers],
  );

  useEffect(() => {
    if (!open || !route) return;

    setForm({
      sellerId: String(route.sellerUid || route.vendedor || route.uid || ''),
      name: String(route.name || route.nome || ''),
      dueDate: String(route.dueDate || '').slice(0, 10),
      targetCompletionPercent: Number(route.targetCompletionPercent || 90),
      notes: String(route.assignmentNotes || route.notes || ''),
    });
    setSelectedCustomerIds(routeCustomers.map(customerKey));
    setError('');
  }, [open, route?.id]);

  if (!route) return null;

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeSeller(sellerId) {
    if (routeHasExecution) return;
    const nextSeller = sellerOptions.find((seller) => String(seller.id) === String(sellerId));
    const availableIds = new Set(
      customers
        .filter((customer) => nextSeller && isCustomerAssignedToSeller(customer, nextSeller) && hasValidCoordinates(customer))
        .map(customerKey),
    );

    setField('sellerId', sellerId);
    setSelectedCustomerIds((current) => current.filter((id) => availableIds.has(id)));
    setError('');
  }

  function changeCustomers(nextCustomers) {
    if (routeHasExecution) return;
    if (nextCustomers.length > MAX_ROUTE_STOPS) {
      setError(`Selecione no maximo ${MAX_ROUTE_STOPS} clientes por rota.`);
      return;
    }
    setSelectedCustomerIds(nextCustomers.map(customerKey));
    setError('');
  }

  function moveCustomer(index, direction) {
    if (routeHasExecution) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedCustomerIds.length) return;
    setSelectedCustomerIds((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function removeCustomer(customerId) {
    if (routeHasExecution) return;
    setSelectedCustomerIds((current) => current.filter((id) => id !== customerId));
  }

  async function handleSave() {
    setError('');
    if (!selectedSeller) {
      setError('Selecione o vendedor responsavel.');
      return;
    }
    if (!form.dueDate) {
      setError('Informe a data para cumprir a rota.');
      return;
    }
    if (selectedCustomers.length === 0) {
      setError('A rota precisa ter ao menos um cliente.');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        route,
        seller: selectedSeller,
        name: form.name,
        dueDate: form.dueDate,
        targetCompletionPercent: form.targetCompletionPercent,
        notes: form.notes,
        customers: selectedCustomers,
        // A nova previa sera calculada pelo app quando a rota for iniciada.
        estimate: null,
      });
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'Nao foi possivel salvar as alteracoes da rota.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => !isSaving && onClose()} fullWidth maxWidth="md" aria-labelledby="editar-rota-title">
      <DialogTitle id="editar-rota-title">
        <Stack direction="row" spacing={1} alignItems="center">
          <EditRoadOutlinedIcon color="primary" />
          <Box>
            <Typography variant="h6">Editar rota</Typography>
            <Typography variant="body2" color="text.secondary">As alteracoes sao refletidas no historico e na rota entregue ao vendedor.</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.25}>
          {error && <Alert severity="error">{error}</Alert>}
          {routeHasExecution && (
            <Alert severity="info">
              Esta rota ja possui navegacao, check-in ou feedback. Nome, prazo, meta e orientacoes podem ser corrigidos, mas vendedor e paradas ficam protegidos para preservar a auditoria.
            </Alert>
          )}

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }} gap={1.5}>
            <TextField
              select
              label="Vendedor responsavel"
              value={form.sellerId}
              onChange={(event) => changeSeller(event.target.value)}
              disabled={routeHasExecution}
              fullWidth
            >
              {sellerOptions.map((seller) => (
                <MenuItem key={seller.id} value={seller.id}>
                  {seller.name || seller.displayName || seller.email || seller.id}{seller.state ? ` (${seller.state})` : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Data para cumprir"
              type="date"
              value={form.dueDate}
              onChange={(event) => setField('dueDate', event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
              required
            />
            <TextField
              label="Nome da rota"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              placeholder="Ex.: Rota comercial - segunda-feira"
              fullWidth
            />
            <TextField
              label="Meta de conclusao (%)"
              type="number"
              value={form.targetCompletionPercent}
              onChange={(event) => setField('targetCompletionPercent', event.target.value)}
              inputProps={{ min: 1, max: 100 }}
              fullWidth
            />
          </Box>

          <TextField
            label="Orientacoes para o vendedor"
            value={form.notes}
            onChange={(event) => setField('notes', event.target.value)}
            multiline
            minRows={3}
            fullWidth
          />

          <Divider />
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>Clientes e ordem da rota</Typography>
              <Typography variant="body2" color="text.secondary">A sequencia abaixo sera enviada ao aplicativo do vendedor.</Typography>
            </Box>
            <Chip label={`${selectedCustomers.length}/${MAX_ROUTE_STOPS} clientes`} size="small" color="primary" variant="outlined" />
          </Stack>

          <Autocomplete
            multiple
            disableCloseOnSelect
            options={customerOptions}
            value={selectedCustomers}
            onChange={(_, nextCustomers) => changeCustomers(nextCustomers)}
            disabled={routeHasExecution || !selectedSeller}
            getOptionLabel={customerPrimaryName}
            isOptionEqualToValue={(option, value) => customerKey(option) === customerKey(value)}
            filterOptions={(options, state) => {
              const search = String(state.inputValue || '').trim().toLocaleLowerCase('pt-BR');
              return search ? options.filter((customer) => customerSearchText(customer).includes(search)) : options;
            }}
            renderOption={(props, customer, { selected }) => (
              <Box component="li" {...props}>
                <Checkbox checked={selected} tabIndex={-1} disableRipple />
                <Box>
                  <Typography variant="body2" fontWeight={700}>{customerPrimaryName(customer)}</Typography>
                  <Typography variant="caption" color="text.secondary">{[customer.city, customer.state, customer.cnpjCpf || customer.id].filter(Boolean).join(' - ')}</Typography>
                </Box>
              </Box>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Adicionar ou remover clientes"
                placeholder={selectedCustomers.length ? 'Buscar cliente' : 'Digite o nome do cliente'}
              />
            )}
          />

          <Stack spacing={0} divider={<Divider flexItem />} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
            {selectedCustomers.map((customer, index) => (
              <Stack key={customerKey(customer)} direction="row" alignItems="center" spacing={1.25} sx={{ px: 1.5, py: 1.15 }}>
                <Box minWidth={28} height={28} borderRadius="50%" display="grid" sx={{ placeItems: 'center', bgcolor: 'action.selected', color: 'primary.main', fontSize: 13, fontWeight: 700 }}>
                  {index + 1}
                </Box>
                <Box flex={1} minWidth={0}>
                  <Typography variant="body2" fontWeight={700} noWrap>{customerPrimaryName(customer)}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{[customer.city, customer.state].filter(Boolean).join(' - ') || 'Localizacao nao informada'}</Typography>
                </Box>
                {!routeHasExecution && (
                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title="Mover para cima"><span><IconButton size="small" onClick={() => moveCustomer(index, -1)} disabled={index === 0} aria-label={`Mover ${customerPrimaryName(customer)} para cima`}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title="Mover para baixo"><span><IconButton size="small" onClick={() => moveCustomer(index, 1)} disabled={index === selectedCustomers.length - 1} aria-label={`Mover ${customerPrimaryName(customer)} para baixo`}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title="Remover da rota"><IconButton size="small" color="error" onClick={() => removeCustomer(customerKey(customer))} aria-label={`Remover ${customerPrimaryName(customer)} da rota`}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                )}
              </Stack>
            ))}
            {selectedCustomers.length === 0 && <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>Nenhum cliente selecionado.</Typography>}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={isSaving}>Cancelar</Button>
        <Button variant="contained" onClick={handleSave} disabled={isSaving} startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : <EditRoadOutlinedIcon />}>
          {isSaving ? 'Salvando...' : 'Salvar alteracoes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function emptyForm() {
  return {
    sellerId: '',
    name: '',
    dueDate: '',
    targetCompletionPercent: 90,
    notes: '',
  };
}

function customerForStop(stop, customersById) {
  const keys = [stop.customerExternalId, stop.minumCode, stop.customerId, stop.id]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const currentCustomer = keys.map((key) => customersById.get(key)).find(Boolean);
  if (currentCustomer) return currentCustomer;

  const fallbackId = keys[0];
  if (!fallbackId) return null;
  return {
    id: fallbackId,
    externalId: stop.customerExternalId || stop.minumCode || fallbackId,
    minumCode: stop.minumCode || stop.customerExternalId || fallbackId,
    opportunity: stop.opportunity || stop.customerName || stop.clienteNome || stop.name || fallbackId,
    clientName: stop.clientName || null,
    city: stop.city || null,
    state: stop.state || null,
    cnpjCpf: stop.cnpjCpf || stop.cpfCnpj || null,
    phone: stop.phone || null,
    email: stop.email || null,
    address: stop.address || null,
    segment: stop.segment || null,
    pipelineStage: stop.pipelineStage || null,
    expectedRevenue: stop.expectedRevenue || null,
    latitude: stop.latitude,
    longitude: stop.longitude,
  };
}

function hasRouteExecution(route, stops) {
  const routeStatus = String(route?.status || '').trim().toLowerCase();
  if (['in_progress', 'completed', 'concluida', 'not_completed'].includes(routeStatus)) return true;
  return stops.some((stop) => {
    const status = String(stop?.status || stop?.result || '').trim().toLowerCase();
    return Boolean(
      stop?.checkInAt
      || stop?.checkOutAt
      || stop?.feedbackAt
      || stop?.visitedAt
      || stop?.arrivedAt
      || Object.keys(stop?.attendances || {}).length
      || ['visited', 'not_visited', 'in_progress', 'awaiting_feedback'].includes(status),
    );
  });
}

function hasValidCoordinates(customer) {
  const latitude = Number(customer?.latitude);
  const longitude = Number(customer?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 && !(latitude === 0 && longitude === 0);
}

function customerKey(customer) {
  return String(customer?.externalId || customer?.minumCode || customer?.id || '').trim();
}

function uniqueCustomers(customers) {
  const seen = new Set();
  return customers.filter((customer) => {
    const key = customerKey(customer);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
