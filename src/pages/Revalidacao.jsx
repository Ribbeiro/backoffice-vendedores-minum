import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  Grid,
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
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningIcon from '@mui/icons-material/Warning';
import PageHeader from '../components/PageHeader';
import { getFunctions, httpsCallable } from 'firebase/functions';

export default function Revalidacao() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState(null);
  const [auditDone, setAuditDone] = useState(false);

  const handleRunAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const functions = getFunctions(undefined, 'southamerica-east1');
      const revalidateFn = httpsCallable(functions, 'revalidateCustomerCoordinates');
      const response = await revalidateFn();
      setResults(response.data?.results || []);
      setAuditDone(true);
    } catch (err) {
      setError(err.message || 'Falha ao executar auditoria de revalidação.');
    } finally {
      setLoading(false);
    }
  };

  const filteredResults = results.filter((item) => {
    if (filter === 'ALL') return true;
    if (filter === 'CONFIRMED') return item.coordinateStatus === 'confirmed';
    if (filter === 'NEEDS_REVIEW') return item.coordinateStatus === 'needs_review';
    if (filter === 'POSTAL_CENTROID') return item.possiblePostalCentroid || item.coordinateStatus === 'possibly_postal_centroid';
    if (filter === 'DUPLICATE_COLLISION') return item.duplicateCoordinateDistinctAddress;
    if (filter === 'REVERSE_MISMATCH') return item.reverseMismatch || item.coordinateStatus === 'reverse_mismatch';
    if (filter === 'DIST_500M') return item.distanceFromPreviousMeters > 500;
    if (filter === 'DIST_2KM') return item.distanceFromPreviousMeters > 2000;
    return true;
  });

  const statusChip = (status) => {
    switch (status) {
      case 'confirmed':
        return <Chip icon={<CheckCircleIcon />} label="CONFIRMADO" color="success" size="small" />;
      case 'needs_review':
        return <Chip icon={<WarningIcon />} label="REVISÃO" color="warning" size="small" />;
      case 'possibly_postal_centroid':
        return <Chip icon={<WarningIcon />} label="CENTROIDE CEP/RUA" color="warning" size="small" />;
      case 'reverse_mismatch':
        return <Chip icon={<ErrorIcon />} label="REVERSE DIVERGENTE" color="error" size="small" />;
      default:
        return <Chip label={status.toUpperCase()} size="small" />;
    }
  };

  const distBadge = (meters, classification) => {
    if (meters === null || meters === undefined) return '-';
    let color = 'default';
    if (classification === 'attention') color = 'info';
    if (classification === 'suspicious') color = 'warning';
    if (classification === 'critical' || classification === 'catastrophic') color = 'error';

    return <Chip label={`${meters} m (${classification})`} color={color} variant="outlined" size="small" />;
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <PageHeader
        title="Auditoria & Revalidação de Coordenadas"
        subtitle="Audite a base existente do Firebase e identifique imprecisões e centroides."
      />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="h6" fontWeight="bold">
                Executar Auditoria de Geolocalização
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Verifica coordenadas com o Mapbox v6, detecta centroides, colisões de endereço e calcula distâncias Haversine.
              </Typography>
            </Box>

            <Button
              variant="contained"
              size="large"
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
              onClick={handleRunAudit}
              disabled={loading}
            >
              {loading ? 'Auditando...' : 'Iniciar Auditoria'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {auditDone && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={3}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary">Total Analisado</Typography>
                <Typography variant="h4" fontWeight="bold">{results.length}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Paper sx={{ p: 2, textAlign: 'center', borderColor: 'success.main' }}>
                <Typography variant="caption" color="text.secondary">Confirmados</Typography>
                <Typography variant="h4" fontWeight="bold" color="success.main">
                  {results.filter((r) => r.coordinateStatus === 'confirmed').length}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Paper sx={{ p: 2, textAlign: 'center', borderColor: 'warning.main' }}>
                <Typography variant="caption" color="text.secondary">Exigem Revisão / Centroide</Typography>
                <Typography variant="h4" fontWeight="bold" color="warning.main">
                  {results.filter((r) => r.coordinateStatus === 'needs_review' || r.possiblePostalCentroid).length}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Paper sx={{ p: 2, textAlign: 'center', borderColor: 'error.main' }}>
                <Typography variant="caption" color="text.secondary">Variação &gt; 500m</Typography>
                <Typography variant="h4" fontWeight="bold" color="error.main">
                  {results.filter((r) => r.distanceFromPreviousMeters > 500).length}
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel>Filtrar Status de Auditoria</InputLabel>
                  <Select
                    value={filter}
                    label="Filtrar Status de Auditoria"
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <MenuItem value="ALL">Todos os Registros ({results.length})</MenuItem>
                    <MenuItem value="CONFIRMED">Confirmados</MenuItem>
                    <MenuItem value="NEEDS_REVIEW">Exigem Revisão</MenuItem>
                    <MenuItem value="POSTAL_CENTROID">Centroide de CEP / Rua Suspeito</MenuItem>
                    <MenuItem value="DUPLICATE_COLLISION">Colisão de Coordenadas (Ruas Distintas)</MenuItem>
                    <MenuItem value="REVERSE_MISMATCH">Reverse Geocoding Divergente</MenuItem>
                    <MenuItem value="DIST_500M">Variação &gt; 500 m</MenuItem>
                    <MenuItem value="DIST_2KM">Variação &gt; 2 km</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cliente</TableCell>
                      <TableCell>Endereço Original</TableCell>
                      <TableCell>Endereço Normalizado</TableCell>
                      <TableCell>Atual (Lat, Lon)</TableCell>
                      <TableCell>Proposto (Lat, Lon)</TableCell>
                      <TableCell>Distância Haversine</TableCell>
                      <TableCell>Precisão / Tipo</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Observação / Motivo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredResults.map((item) => (
                      <TableRow key={item.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight="bold">{item.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{item.id}</Typography>
                        </TableCell>
                        <TableCell>{item.originalAddress || '-'}</TableCell>
                        <TableCell>{item.normalizedAddress || '-'}</TableCell>
                        <TableCell>
                          {item.currentCoordinate ? `${item.currentCoordinate.latitude.toFixed(5)}, ${item.currentCoordinate.longitude.toFixed(5)}` : '-'}
                        </TableCell>
                        <TableCell>
                          {item.proposedCoordinate ? `${item.proposedCoordinate.latitude.toFixed(5)}, ${item.proposedCoordinate.longitude.toFixed(5)}` : '-'}
                        </TableCell>
                        <TableCell>{distBadge(item.distanceFromPreviousMeters, item.distanceClassification)}</TableCell>
                        <TableCell>
                          <Typography variant="caption" display="block">{item.featureType}</Typography>
                          <Typography variant="caption" color="text.secondary">{item.accuracy}</Typography>
                        </TableCell>
                        <TableCell>{statusChip(item.coordinateStatus)}</TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">{item.motivo}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </>
      )}
    </Container>
  );
}
