import { useMemo, useState } from 'react';
import {
  Alert,
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
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoadIcon from '@mui/icons-material/AddRoad';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CalculateIcon from '@mui/icons-material/Calculate';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PageHeader from '../components/PageHeader';
import RoutePreviewMap from '../components/RoutePreviewMap';
import { createSharedRouteAssignment, getSharedRoutePreview, optimizeSharedRoute } from '../services/api';
import { useData } from '../hooks/useData';

const initialForm = {
  sellerId: '',
  name: '',
  dueDate: new Date().toISOString().slice(0, 10),
  targetCompletionPercent: 90,
  notes: '',
};

export default function CriarRota() {
  const { customers, sellers, routes } = useData();
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedSeller = sellers.find((seller) => seller.id === form.sellerId);
  const customersById = useMemo(() => new Map(customers.map((customer) => [customerKey(customer), customer])), [customers]);
  const selectedCustomers = selectedIds.map((id) => customersById.get(id)).filter(Boolean);
  const availableCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const sellerState = String(selectedSeller?.state || '').trim().toUpperCase();
    return customers.filter((customer) => {
      const belongsToSellerState = !sellerState || String(customer.state || '').trim().toUpperCase() === sellerState;
      const searchable = [customer.name, customer.clientName, customer.opportunity, customer.city, customer.cnpjCpf]
        .join(' ')
        .toLowerCase();
      return belongsToSellerState && hasValidCoordinates(customer) && searchable.includes(normalizedSearch);
    }).slice(0, 150);
  }, [customers, search, selectedSeller]);
  const recentAssignments = useMemo(
    () => routes.filter((route) => route.assignmentType === 'shared' || route.source === 'admin_assignment').slice(0, 5),
    [routes],
  );

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function chooseSeller(sellerId) {
    setField('sellerId', sellerId);
    setSelectedIds([]);
    clearRoutePreview();
  }

  function toggleCustomer(customer) {
    const id = customerKey(customer);
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    clearRoutePreview();
  }

  function moveCustomer(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedIds.length) return;
    setSelectedIds((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    clearRoutePreview();
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
      clearRoutePreview();
    } catch (saveError) {
      setError(saveError.message || 'Nao foi possivel criar a rota compartilhada.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Criar rota" subtitle="Atribua clientes, prazo e meta de conclusao para um vendedor." />
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

        <Grid item xs={12} lg={4}>
          <Paper sx={{ overflow: 'hidden' }}>
            <Box p={2.5} borderBottom="1px solid" borderColor="divider">
              <Typography variant="h6">Selecionar clientes</Typography>
              <TextField label="Buscar cliente" value={search} onChange={(event) => setSearch(event.target.value)} fullWidth size="small" sx={{ mt: 1.5 }} />
              <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                {selectedSeller?.state ? `Mostrando clientes de ${selectedSeller.state}.` : 'Escolha um vendedor para filtrar pelo estado.'}
              </Typography>
            </Box>
            <TableContainer sx={{ maxHeight: 610 }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow><TableCell padding="checkbox" /><TableCell>Cliente</TableCell><TableCell>Cidade</TableCell></TableRow></TableHead>
                <TableBody>
                  {availableCustomers.map((customer) => {
                    const id = customerKey(customer);
                    return (
                      <TableRow key={id} hover onClick={() => toggleCustomer(customer)} sx={{ cursor: 'pointer' }}>
                        <TableCell padding="checkbox"><Checkbox checked={selectedIds.includes(id)} /></TableCell>
                        <TableCell><Typography variant="body2" fontWeight={700}>{customer.name || customer.clientName || customer.opportunity}</Typography><Typography variant="caption" color="text.secondary">{customer.cnpjCpf || customer.id}</Typography></TableCell>
                        <TableCell>{customer.city || '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                  {!selectedSeller && <TableRow><TableCell colSpan={3} align="center">Selecione um vendedor primeiro.</TableCell></TableRow>}
                  {selectedSeller && availableCustomers.length === 0 && <TableRow><TableCell colSpan={3} align="center">Nenhum cliente encontrado.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper sx={{ overflow: 'hidden' }}>
            <Box p={2.5} borderBottom="1px solid" borderColor="divider">
              <Typography variant="h6">Ordem da rota</Typography>
              <Typography variant="body2" color="text.secondary">{selectedCustomers.length} clientes selecionados</Typography>
            </Box>
            <TableContainer sx={{ maxHeight: 610 }}>
              <Table stickyHeader size="small">
                <TableHead><TableRow><TableCell>Ordem</TableCell><TableCell>Cliente</TableCell><TableCell align="right">Ajustar</TableCell></TableRow></TableHead>
                <TableBody>
                  {selectedCustomers.map((customer, index) => {
                    const previousLeg = index > 0 ? preview?.legs?.[index - 1] : null;
                    return (
                    <TableRow key={customerKey(customer)}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700}>{customer.name || customer.clientName || customer.opportunity}</Typography>
                        <Typography variant="caption" color="text.secondary" display="block">{customer.city || customer.state || '-'}</Typography>
                        <Typography variant="caption" color={previousLeg ? 'primary.main' : 'text.secondary'} display="block">
                          {index === 0 ? 'Inicio da rota' : previousLeg ? `${formatDistance(previousLeg.distanceMeters)} - ${formatDuration(previousLeg.durationSeconds)} desde a parada anterior` : 'Atualize o mapa para calcular este trecho'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Mover para cima"><span><IconButton size="small" onClick={() => moveCustomer(index, -1)} disabled={index === 0}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title="Mover para baixo"><span><IconButton size="small" onClick={() => moveCustomer(index, 1)} disabled={index === selectedCustomers.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title="Remover"><IconButton size="small" onClick={() => toggleCustomer(customer)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                  {selectedCustomers.length === 0 && <TableRow><TableCell colSpan={3} align="center">Selecione clientes ao lado.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper sx={{ mt: 2.5, p: 2.5 }}>
            <Typography variant="subtitle1" fontWeight={700}>Ultimas rotas atribuidas</Typography>
            <Stack spacing={1} mt={1.5}>
              {recentAssignments.map((route) => <Typography key={route.id} variant="body2">{route.name} - {route.sellerName || route.sellerUid} - {route.status}</Typography>)}
              {recentAssignments.length === 0 && <Typography variant="body2" color="text.secondary">Nenhuma rota atribuida ainda.</Typography>}
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1} mb={2}>
              <Box>
                <Typography variant="h6">Pre-visualizacao da rota</Typography>
                <Typography variant="body2" color="text.secondary">Verde: inicio. Vermelho: destino. Os demais pontos seguem a ordem exibida acima.</Typography>
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

function formatDistance(meters) {
  return Number(meters || 0) >= 1000 ? `${(Number(meters) / 1000).toFixed(1)} km` : `${Math.round(Number(meters || 0))} m`;
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(Number(seconds || 0) / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes} min`;
}
