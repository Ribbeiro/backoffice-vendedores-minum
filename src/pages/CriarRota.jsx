import { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoadIcon from '@mui/icons-material/AddRoad';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CalculateIcon from '@mui/icons-material/Calculate';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import PageHeader from '../components/PageHeader';
import RoutePreviewMap from '../components/RoutePreviewMap';
import { createSharedRouteAssignment, getSharedRoutePreview, optimizeSharedRoute } from '../services/api';
import { useData } from '../hooks/useData';
import { currencyBRL } from '../utils/formatters';
import { expectedRevenueValue } from '../utils/money';
import { distanceBetweenCustomersMeters } from '../utils/locationDistance';
import { getSellerDisplayName, isCustomerAssignedToSeller } from '../utils/sellerCustomerAssignment';
import { customerPrimaryName, customerSearchText } from '../utils/customerDisplay';

const initialForm = {
  sellerId: '',
  name: '',
  dueDate: new Date().toISOString().slice(0, 10),
  targetCompletionPercent: 90,
  notes: '',
};

export default function CriarRota() {
  const { customers, sellers } = useData();
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [anchorCustomerId, setAnchorCustomerId] = useState('');
  const [radiusKm, setRadiusKm] = useState(10);
  const [estimate, setEstimate] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draggedCustomerId, setDraggedCustomerId] = useState(null);
  const [dropTargetCustomerId, setDropTargetCustomerId] = useState(null);

  const selectedSeller = sellers.find((seller) => seller.id === form.sellerId);
  const selectedSellerName = getSellerDisplayName(selectedSeller);
  const customersById = useMemo(() => new Map(customers.map((customer) => [customerKey(customer), customer])), [customers]);
  const selectedCustomers = selectedIds.map((id) => customersById.get(id)).filter(Boolean);
  const anchorCustomer = anchorCustomerId ? customersById.get(anchorCustomerId) || null : null;
  const sellerCustomers = useMemo(() => {
    if (!selectedSeller) return [];
    return customers.filter((customer) => {
      return isCustomerAssignedToSeller(customer, selectedSeller) && hasValidCoordinates(customer);
    });
  }, [customers, selectedSeller]);
  const customersInRadius = useMemo(() => {
    if (!anchorCustomer) return sellerCustomers;
    return sellerCustomers.filter((customer) => isWithinRadius(customer, anchorCustomer, radiusKm));
  }, [anchorCustomer, radiusKm, sellerCustomers]);
  const availableCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return customersInRadius.map((customer) => {
      const searchable = customerSearchText(customer);
      return {
        customer,
        distanceMeters: anchorCustomer ? distanceBetweenCustomersMeters(customer, anchorCustomer) : null,
        matchesSearch: searchable.includes(normalizedSearch),
      };
    }).filter((item) => item.matchesSearch)
      .sort((first, second) => {
        if (anchorCustomer) return (first.distanceMeters || 0) - (second.distanceMeters || 0);
        return displayCustomerName(first.customer).localeCompare(displayCustomerName(second.customer), 'pt-BR');
      })
      .slice(0, 150);
  }, [anchorCustomer, customersInRadius, search]);
  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function chooseSeller(sellerId) {
    setField('sellerId', sellerId);
    setSelectedIds([]);
    setAnchorCustomerId('');
    clearRoutePreview();
  }

  function chooseAnchorCustomer(customer) {
    const nextAnchorId = customer ? customerKey(customer) : '';
    setAnchorCustomerId(nextAnchorId);
    setSelectedIds((current) => {
      if (!customer) return current;
      const customersInsideRadius = current.filter((id) => {
        const selectedCustomer = customersById.get(id);
        return selectedCustomer && isWithinRadius(selectedCustomer, customer, radiusKm);
      });
      return [nextAnchorId, ...customersInsideRadius.filter((id) => id !== nextAnchorId)];
    });
    clearRoutePreview();
  }

  function chooseRadius(nextRadiusKm) {
    if (!nextRadiusKm) return;
    setRadiusKm(nextRadiusKm);
    if (anchorCustomer) {
      setSelectedIds((current) => {
        const customersInsideRadius = current.filter((id) => {
          const selectedCustomer = customersById.get(id);
          return selectedCustomer && isWithinRadius(selectedCustomer, anchorCustomer, nextRadiusKm);
        });
        return [anchorCustomerId, ...customersInsideRadius.filter((id) => id !== anchorCustomerId)];
      });
    }
    clearRoutePreview();
  }

  function toggleCustomer(customer) {
    const id = customerKey(customer);
    if (id === anchorCustomerId) return;
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    clearRoutePreview();
  }

  function moveCustomer(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedIds.length) return;
    const movingCustomer = selectedCustomers[index];
    if (anchorCustomerId && (customerKey(movingCustomer) === anchorCustomerId || nextIndex === 0)) return;
    setSelectedIds((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    clearRoutePreview();
  }

  function reorderCustomer(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    if (draggedId === anchorCustomerId || targetId === anchorCustomerId) return;

    setSelectedIds((current) => {
      const fromIndex = current.indexOf(draggedId);
      const targetIndex = current.indexOf(targetId);
      if (fromIndex < 0 || targetIndex < 0) return current;

      const next = [...current];
      next.splice(fromIndex, 1);
      next.splice(targetIndex, 0, draggedId);
      return next;
    });
    clearRoutePreview();
  }

  function handleDragStart(event, customerId) {
    if (customerId === anchorCustomerId) return;
    setDraggedCustomerId(customerId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', customerId);
  }

  function handleDragOver(event, targetId) {
    if (!draggedCustomerId || targetId === anchorCustomerId || draggedCustomerId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetCustomerId(targetId);
  }

  function handleDrop(event, targetId) {
    event.preventDefault();
    const customerId = draggedCustomerId || event.dataTransfer.getData('text/plain');
    reorderCustomer(customerId, targetId);
    setDraggedCustomerId(null);
    setDropTargetCustomerId(null);
  }

  function clearRoutePreview() {
    setEstimate(null);
    setPreview(null);
  }

  async function handleEstimate() {
    setError('');
    if (selectedCustomers.length < 2) {
      const emptyPreview = { distanceMeters: 0, durationSeconds: 0, geometry: null, legs: [] };
      setEstimate(emptyPreview);
      setPreview(emptyPreview);
      return;
    }
    setIsEstimating(true);
    try {
      const nextPreview = await getSharedRoutePreview(selectedCustomers);
      setEstimate(nextPreview);
      setPreview(nextPreview);
    } catch (estimateError) {
      setError(estimateError.message || 'Nao foi possivel estimar a rota.');
    } finally {
      setIsEstimating(false);
    }
  }

  async function handleOptimizeRoute() {
    setError('');
    setSuccess('');
    if (selectedCustomers.length < 2) {
      setError('Selecione pelo menos dois clientes para otimizar a rota.');
      return;
    }

    setIsOptimizing(true);
    try {
      const optimizedPreview = await optimizeSharedRoute(selectedCustomers);
      const optimizedCustomers = optimizedPreview.order
        .map((originalIndex) => selectedCustomers[originalIndex])
        .filter(Boolean);

      setSelectedIds(optimizedCustomers.map(customerKey));
      setEstimate(optimizedPreview);
      setPreview(optimizedPreview);
      setSuccess('Ordem otimizada pelo Mapbox. Revise as paradas antes de atribuir a rota.');
    } catch (optimizationError) {
      setError(optimizationError.message || 'Nao foi possivel otimizar a rota.');
    } finally {
      setIsOptimizing(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!selectedSeller) {
      setError('Selecione o vendedor responsavel.');
      return;
    }
    setIsSaving(true);
    try {
      const route = await createSharedRouteAssignment({ ...form, seller: selectedSeller, customers: selectedCustomers, estimate });
      setSuccess(`Rota ${route.name} atribuida a ${route.sellerName}.`);
      setForm(initialForm);
      setSelectedIds([]);
      setAnchorCustomerId('');
      clearRoutePreview();
    } catch (saveError) {
      setError(saveError.message || 'Nao foi possivel criar a rota compartilhada.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Criar rota" subtitle="Selecione o vendedor, escolha clientes ja atribuidos a ele e concentre a rota por raio." />
      <Grid container spacing={2.5} component="form" onSubmit={handleSubmit}>
        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Dados da atribuicao</Typography>
              {error && <Alert severity="error">{error}</Alert>}
              {success && <Alert severity="success">{success}</Alert>}
              <FormControl fullWidth required>
                <InputLabel id="seller-route-label">Vendedor</InputLabel>
                <Select labelId="seller-route-label" label="Vendedor" value={form.sellerId} onChange={(event) => chooseSeller(event.target.value)}>
                  {sellers.map((seller) => (
                    <MenuItem key={seller.id} value={seller.id}>
                      {seller.name || seller.displayName || seller.email} {seller.state ? `(${seller.state})` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Box sx={{ p: 1.75, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' }}>
                <Stack spacing={1.25}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <MyLocationIcon color="primary" fontSize="small" />
                    <Typography variant="subtitle2">Prospecto principal e raio</Typography>
                  </Stack>
                  <Autocomplete
                    size="small"
                    options={sellerCustomers}
                    value={anchorCustomer}
                    disabled={!selectedSeller}
                    onChange={(_, customer) => chooseAnchorCustomer(customer)}
                    getOptionLabel={displayCustomerName}
                    isOptionEqualToValue={(option, value) => customerKey(option) === customerKey(value)}
                    noOptionsText={selectedSeller ? 'Nenhum cliente atribuido a este vendedor com coordenadas validas.' : 'Selecione um vendedor primeiro.'}
                    renderOption={(props, customer) => (
                      <Box component="li" {...props} key={customerKey(customer)}>
                        <Box>
                          <Typography variant="body2" fontWeight={700}>{displayCustomerName(customer)}</Typography>
                          <Typography variant="caption" color="text.secondary">{customer.city || '-'} - {customer.state || '-'}</Typography>
                        </Box>
                      </Box>
                    )}
                    renderInput={(params) => <TextField {...params} label="Prospecto principal" placeholder="Escolha o ponto de partida" />}
                  />
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>Raio de selecao</Typography>
                    <ToggleButtonGroup
                      exclusive
                      fullWidth
                      size="small"
                      value={radiusKm}
                      disabled={!anchorCustomer}
                      onChange={(_, value) => chooseRadius(value)}
                      aria-label="Raio em quilometros ao redor do prospecto principal"
                    >
                      {[5, 10, 15, 20].map((radius) => <ToggleButton key={radius} value={radius}>{radius} km</ToggleButton>)}
                    </ToggleButtonGroup>
                  </Box>
                  {anchorCustomer ? (
                    <Typography variant="caption" color="text.secondary">
                      {customersInRadius.length} clientes dentro de {radiusKm} km de {displayCustomerName(anchorCustomer)}. A lista e a selecao acompanham este raio.
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Selecione um prospecto principal para revelar somente os clientes proximos.
                    </Typography>
                  )}
                </Stack>
              </Box>
              <TextField label="Nome da rota" value={form.name} onChange={(event) => setField('name', event.target.value)} fullWidth placeholder="Ex.: Sorriso - semana 1" />
              <TextField label="Data para cumprir" type="date" value={form.dueDate} onChange={(event) => setField('dueDate', event.target.value)} InputLabelProps={{ shrink: true }} required fullWidth />
              <TextField label="Meta de conclusao" type="number" value={form.targetCompletionPercent} onChange={(event) => setField('targetCompletionPercent', event.target.value)} inputProps={{ min: 1, max: 100 }} helperText="Percentual desejado de clientes visitados." fullWidth />
              <TextField label="Orientacoes para o vendedor" value={form.notes} onChange={(event) => setField('notes', event.target.value)} multiline minRows={3} fullWidth />
              <Divider />
              <Typography variant="subtitle2">Previa entre as paradas</Typography>
              <Typography variant="body2" color="text.secondary">
                O mapa considera as ruas. No app, a primeira perna e recalculada a partir da localizacao do vendedor.
              </Typography>
              {estimate && <Chip label={`${formatDistance(estimate.distanceMeters)} - ${formatDuration(estimate.durationSeconds)}`} color="primary" variant="outlined" />}
              <Button variant="outlined" startIcon={isEstimating ? <CircularProgress size={18} /> : <CalculateIcon />} onClick={handleEstimate} disabled={isEstimating || selectedCustomers.length === 0}>
                Atualizar mapa
              </Button>
              <Button variant="outlined" color="secondary" startIcon={isOptimizing ? <CircularProgress size={18} /> : <AutoFixHighIcon />} onClick={handleOptimizeRoute} disabled={isOptimizing || selectedCustomers.length < 2}>
                Otimizar rota
              </Button>
              <Button type="submit" variant="contained" startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : <AddRoadIcon />} disabled={isSaving || !selectedSeller || selectedCustomers.length === 0}>
                Atribuir rota
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={8}>
          <Stack spacing={2.5}>
            <Paper sx={{ overflow: 'hidden' }}>
              <Box p={2.5} borderBottom="1px solid" borderColor="divider">
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} justifyContent="space-between" alignItems={{ sm: 'flex-start' }}>
                  <Box>
                    <Typography variant="h6">Selecionar clientes</Typography>
                    <Typography variant="body2" color="text.secondary" mt={0.5}>
                      {!selectedSeller
                        ? 'Escolha um vendedor para mostrar somente os clientes atribuidos a ele.'
                        : anchorCustomer
                          ? `Clientes atribuidos a ${selectedSellerName} em um raio de ${radiusKm} km do prospecto principal.`
                          : `Mostrando clientes atribuidos a ${selectedSellerName}. Escolha o prospecto principal para aplicar o raio.`}
                    </Typography>
                  </Box>
                  <Chip color="primary" variant="outlined" label={`${selectedCustomers.length} ${selectedCustomers.length === 1 ? 'cliente selecionado' : 'clientes selecionados'}`} />
                </Stack>
                <TextField label="Buscar cliente" value={search} onChange={(event) => setSearch(event.target.value)} fullWidth size="small" sx={{ mt: 2 }} />
              </Box>
              <TableContainer sx={{ maxHeight: { xs: 420, lg: 545 } }}>
                <Table stickyHeader size="small" sx={{ minWidth: 800 }} aria-label="Clientes disponiveis para a rota">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" />
                      <TableCell sx={{ minWidth: 205 }}>Cliente</TableCell>
                      <TableCell sx={{ minWidth: 105 }}>Cidade</TableCell>
                      <TableCell align="right" sx={{ minWidth: 130 }}>Receita esperada</TableCell>
                      <TableCell sx={{ minWidth: 135 }}>Estagio</TableCell>
                      <TableCell align="right" sx={{ minWidth: 100 }}>Distancia</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {availableCustomers.map(({ customer, distanceMeters }) => {
                      const id = customerKey(customer);
                      const isAnchor = id === anchorCustomerId;
                      return (
                        <TableRow key={id} hover onClick={() => toggleCustomer(customer)} sx={{ cursor: isAnchor ? 'default' : 'pointer', bgcolor: isAnchor ? 'action.selected' : 'inherit' }}>
                          <TableCell padding="checkbox"><Checkbox checked={selectedIds.includes(id)} disabled={isAnchor} /></TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={700}>{displayCustomerName(customer)}</Typography>
                            <Typography variant="caption" color="text.secondary">{customer.cnpjCpf || customer.id}</Typography>
                          </TableCell>
                          <TableCell>{customer.city || '-'}</TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatExpectedRevenue(customer)}</TableCell>
                          <TableCell>
                            {customer.pipelineStage || customer.status
                              ? <Chip size="small" variant="outlined" label={customer.pipelineStage || customer.status} />
                              : <Typography variant="body2" color="text.secondary">-</Typography>}
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {isAnchor ? <Chip size="small" color="primary" label="Principal" /> : anchorCustomer ? formatDistance(distanceMeters) : '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!selectedSeller && <TableRow><TableCell colSpan={6} align="center">Selecione um vendedor primeiro.</TableCell></TableRow>}
                    {selectedSeller && availableCustomers.length === 0 && <TableRow><TableCell colSpan={6} align="center">Nenhum cliente encontrado neste raio.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            <Paper sx={{ overflow: 'hidden' }}>
              <Box p={2.5} borderBottom="1px solid" borderColor="divider">
                <Typography variant="h6">Ordem da rota</Typography>
                <Typography variant="body2" color="text.secondary">Arraste as paradas pelo icone de pontos para reorganizar. Os botoes continuam disponiveis para ajuste fino.</Typography>
              </Box>
              <TableContainer sx={{ maxHeight: 330 }}>
                <Table stickyHeader size="small" aria-label="Ordem das paradas da rota">
                  <TableHead><TableRow><TableCell padding="checkbox" aria-label="Arrastar" /><TableCell>Ordem</TableCell><TableCell>Cliente</TableCell><TableCell align="right">Ajustar</TableCell></TableRow></TableHead>
                  <TableBody>
                    {selectedCustomers.map((customer, index) => {
                      const previousLeg = index > 0 ? preview?.legs?.[index - 1] : null;
                      const isAnchor = customerKey(customer) === anchorCustomerId;
                      const id = customerKey(customer);
                      const isDragging = draggedCustomerId === id;
                      const isDropTarget = dropTargetCustomerId === id;
                      return (
                        <TableRow
                          key={id}
                          draggable={!isAnchor}
                          onDragStart={(event) => handleDragStart(event, id)}
                          onDragOver={(event) => handleDragOver(event, id)}
                          onDrop={(event) => handleDrop(event, id)}
                          onDragEnd={() => {
                            setDraggedCustomerId(null);
                            setDropTargetCustomerId(null);
                          }}
                          sx={{
                            cursor: isAnchor ? 'default' : 'grab',
                            opacity: isDragging ? 0.55 : 1,
                            '& > *': {
                              borderTop: isDropTarget ? '2px solid' : undefined,
                              borderColor: isDropTarget ? 'primary.main' : undefined,
                            },
                          }}
                        >
                          <TableCell padding="checkbox">
                            <Tooltip title={isAnchor ? 'O prospecto principal permanece no inicio da rota' : 'Arraste para mudar a ordem'}>
                              <span>
                                <IconButton size="small" disabled={isAnchor} aria-label={`Arrastar ${displayCustomerName(customer)}`}>
                                  <DragIndicatorIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Typography variant="body2" fontWeight={700}>{displayCustomerName(customer)}</Typography>
                              {isAnchor && <Chip size="small" color="primary" label="Principal" />}
                            </Stack>
                            <Typography variant="caption" color="text.secondary" display="block">{customer.city || customer.state || '-'}</Typography>
                            <Typography variant="caption" color={previousLeg ? 'primary.main' : 'text.secondary'} display="block">
                              {isAnchor ? `Inicio da rota e centro do raio de ${radiusKm} km` : previousLeg ? `${formatDistance(previousLeg.distanceMeters)} - ${formatDuration(previousLeg.durationSeconds)} desde a parada anterior` : 'Atualize o mapa para calcular este trecho'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title={isAnchor ? 'O prospecto principal permanece como primeira parada' : 'Mover para cima'}><span><IconButton size="small" onClick={() => moveCustomer(index, -1)} disabled={index === 0 || isAnchor || (anchorCustomerId && index === 1)}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                            <Tooltip title={isAnchor ? 'O prospecto principal permanece como primeira parada' : 'Mover para baixo'}><span><IconButton size="small" onClick={() => moveCustomer(index, 1)} disabled={index === selectedCustomers.length - 1 || isAnchor}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                            <Tooltip title={isAnchor ? 'O prospecto principal permanece na rota' : 'Remover'}><span><IconButton size="small" onClick={() => toggleCustomer(customer)} disabled={isAnchor}><DeleteOutlineIcon fontSize="small" /></IconButton></span></Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {selectedCustomers.length === 0 && <TableRow><TableCell colSpan={4} align="center">Selecione clientes acima.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1} mb={2}>
              <Box>
                <Typography variant="h6">Pre-visualizacao da rota</Typography>
                <Typography variant="body2" color="text.secondary">Verde: inicio. Vermelho: destino. Os demais pontos seguem a ordem exibida acima. O raio e apenas um filtro em linha reta; a rota do mapa segue as ruas.</Typography>
              </Box>
              {preview && <Chip label={`${formatDistance(preview.distanceMeters)} - ${formatDuration(preview.durationSeconds)}`} color="primary" />}
            </Stack>
            <RoutePreviewMap customers={selectedCustomers} preview={preview} isLoading={isEstimating || isOptimizing} />
          </Paper>
        </Grid>
      </Grid>
    </>
  );
}

function customerKey(customer) {
  return String(customer.externalId || customer.id);
}

function hasValidCoordinates(customer) {
  const latitude = Number(customer?.latitude);
  const longitude = Number(customer?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 && !(latitude === 0 && longitude === 0);
}

function isWithinRadius(customer, anchorCustomer, radiusKm) {
  const distanceMeters = distanceBetweenCustomersMeters(customer, anchorCustomer);
  return Number.isFinite(distanceMeters) && distanceMeters <= Number(radiusKm) * 1_000;
}

function displayCustomerName(customer) {
  return customerPrimaryName(customer);
}

function formatExpectedRevenue(customer) {
  const parsedValue = expectedRevenueValue(customer);
  if (parsedValue !== null) return currencyBRL(parsedValue);
  return String(customer?.expectedRevenue || '').trim() || '-';
}

function formatDistance(meters) {
  return Number(meters || 0) >= 1000 ? `${(Number(meters) / 1000).toFixed(1)} km` : `${Math.round(Number(meters || 0))} m`;
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(Number(seconds || 0) / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes} min`;
}
