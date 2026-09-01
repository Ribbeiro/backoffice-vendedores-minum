import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
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
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import MyLocationOutlinedIcon from '@mui/icons-material/MyLocationOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import PageHeader from '../components/PageHeader';
import { getFunctions, httpsCallable } from 'firebase/functions';

const JOB_STORAGE_KEY = 'minum.geocodingAuditJobId';

function auditErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code.includes('internal') || code.includes('unavailable') || message.includes('internal')) {
    return 'Nao foi possivel executar a auditoria agora. Verifique sua conexao e tente novamente; se persistir, envie este horario ao suporte tecnico.';
  }
  return error?.message || 'Não foi possível processar a auditoria de coordenadas.';
}

const FILTERS = [
  ['ALL', 'Todos'],
  ['APPROVAL_ELIGIBLE', 'Prontos para aprovação'],
  ['CONFIRMED', 'Confirmados'],
  ['PRESERVED', 'Preservadas sem nova consulta'],
  ['NEEDS_REVIEW', 'Exigem revisão'],
  ['POSTAL_CENTROID', 'Centroide de CEP/Rua'],
  ['DUPLICATE_COLLISION', 'Coordenada duplicada'],
  ['REVERSE_MISMATCH', 'Forward/Reverse divergente'],
  ['SOURCE_CONFLICT', 'Conflito com evidência de campo'],
  ['LEGACY', 'Legadas sem validação'],
  ['MISSING', 'Sem coordenada'],
  ['RURAL_OR_NO_NUMBER', 'Rural ou sem número'],
  ['DIST_500M', 'Variação acima de 500 m'],
  ['DIST_2KM', 'Variação acima de 2 km'],
];

function formatCoordinate(coordinate) {
  return coordinate ? `${Number(coordinate.latitude).toFixed(6)}, ${Number(coordinate.longitude).toFixed(6)}` : 'Não disponível';
}

function formatMeters(meters) {
  if (!Number.isFinite(meters)) return 'Não calculada';
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function mergeResults(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

function statusChip(item) {
  const status = item.coordinateStatus || 'unknown';
  if (item.reviewLocked) return <Chip icon={<CheckCircleIcon />} color="success" size="small" label="PRESERVADA" />;
  if (status === 'manual_confirmed') return <Chip icon={<CheckCircleIcon />} color="success" size="small" label="CONFIRMADA MANUALMENTE" />;
  if (item.reviewStatus === 'approved') return <Chip icon={<CheckCircleIcon />} color="success" size="small" label="APROVADA" />;
  if (item.approvalEligible) return <Chip icon={<FactCheckOutlinedIcon />} color="success" size="small" label="VALIDADA" />;
  if (status === 'reverse_mismatch' || status === 'source_conflict') return <Chip color="error" size="small" label={status.replaceAll('_', ' ')} />;
  if (status.includes('centroid') || status.includes('duplicate') || status === 'needs_review') return <Chip icon={<WarningAmberIcon />} color="warning" size="small" label={status.replaceAll('_', ' ')} />;
  return <Chip size="small" label={status.replaceAll('_', ' ')} />;
}

function matchesFilter(item, filter) {
  switch (filter) {
    case 'APPROVAL_ELIGIBLE': return item.approvalEligible && item.reviewStatus !== 'approved';
    case 'CONFIRMED': return item.reviewLocked || ['confirmed', 'manual_confirmed'].includes(item.coordinateStatus);
    case 'PRESERVED': return item.reviewLocked;
    case 'NEEDS_REVIEW': return !item.reviewLocked && item.coordinateStatus === 'needs_review';
    case 'POSTAL_CENTROID': return item.possiblePostalCentroid || item.coordinateStatus === 'postal_or_street_centroid_suspected';
    case 'DUPLICATE_COLLISION': return item.duplicateCoordinateDistinctAddress;
    case 'REVERSE_MISMATCH': return item.reverseMismatch || item.coordinateStatus === 'reverse_mismatch';
    case 'SOURCE_CONFLICT': return item.sourceConflict || item.coordinateStatus === 'source_conflict';
    case 'LEGACY': return item.coordinatePrecisionLevel === 'legacy_unverified' || item.coordinateSource === 'legacy';
    case 'MISSING': return !item.currentCoordinate || item.coordinateStatus === 'missing_coordinate';
    case 'RURAL_OR_NO_NUMBER': return item.isRural || item.hasNoNumber;
    case 'DIST_500M': return item.distanceFromPreviousMeters > 500;
    case 'DIST_2KM': return item.distanceFromPreviousMeters > 2000;
    default: return true;
  }
}

function DetailDrawer({ item, onClose, onApplyManual }) {
  const [manualLatitude, setManualLatitude] = useState('');
  const [manualLongitude, setManualLongitude] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  useEffect(() => {
    setManualLatitude(item?.geocodedCoordinate?.latitude ?? item?.currentCoordinate?.latitude ?? '');
    setManualLongitude(item?.geocodedCoordinate?.longitude ?? item?.currentCoordinate?.longitude ?? '');
    setManualReason('');
  }, [item]);

  const submitManual = async () => {
    if (!item) return;
    setManualSubmitting(true);
    try {
      await onApplyManual({
        customerId: item.id,
        latitude: manualLatitude,
        longitude: manualLongitude,
        reason: manualReason,
      });
    } finally {
      setManualSubmitting(false);
    }
  };

  return (
    <Drawer anchor="right" open={Boolean(item)} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, p: 3 } }}>
      {item && (
        <Stack spacing={2.25}>
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
            <Box>
              <Typography variant="overline" color="secondary.main">Auditoria de localização</Typography>
              <Typography variant="h6">{item.name}</Typography>
              <Typography variant="body2" color="text.secondary">{item.id}</Typography>
            </Box>
            <IconButton onClick={onClose} aria-label="Fechar detalhes"><CloseIcon /></IconButton>
          </Stack>
          {statusChip(item)}
          <Divider />
          <DetailSection title="Endereço">
            <Detail label="Original" value={item.originalAddress} />
            <Detail label="Normalizado" value={item.normalizedAddress} />
            <Detail label="Chave canônica" value={item.canonicalKey} mono />
          </DetailSection>
          <DetailSection title="Coordenadas">
            <Detail label="Recebida / atual" value={formatCoordinate(item.currentCoordinate)} />
            <Detail label="Geocodificada" value={formatCoordinate(item.geocodedCoordinate)} />
            <Detail label="Ponto de navegação" value={formatCoordinate(item.navigationCoordinate)} />
            <Detail label="Entrada" value={formatCoordinate(item.entranceCoordinate)} />
            <Detail label="Variação anterior" value={formatMeters(item.distanceFromPreviousMeters)} />
          </DetailSection>
          <DetailSection title="Evidências Mapbox">
            <Detail label="Tipo" value={item.featureType} />
            <Detail label="Precisão" value={item.accuracy} />
            <Detail label="Confiança" value={item.confidence} />
            <Detail label="Número" value={item.numberMatch} />
            <Detail label="Forward + reverse" value={item.reverseMatch?.matches === true ? 'Consistentes' : item.reverseMatch?.checked ? 'Divergentes' : 'Não disponível'} />
          </DetailSection>
          <DetailSection title="Sinal de campo">
            <Detail label="Amostras GPS confiáveis" value={item.fieldGroundTruth?.eligible ? `${item.fieldGroundTruth.count} de ${item.fieldGroundTruth.sampleCount}` : 'Ainda insuficientes'} />
            <Detail label="Atual x evidência de campo" value={formatMeters(item.fieldGroundTruthDistanceMeters)} />
            <Detail label="Proposta x evidência de campo" value={formatMeters(item.fieldGroundTruthCandidateDistanceMeters)} />
          </DetailSection>
          <Alert severity={item.approvalEligible ? 'success' : 'warning'}>{item.motivo}</Alert>
          <DetailSection title="Correção manual excepcional">
            <Typography variant="caption" color="text.secondary">Use apenas uma coordenada confirmada por fonte confiável. A justificativa e a coordenada anterior permanecem na auditoria.</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField label="Latitude" size="small" type="number" value={manualLatitude} onChange={(event) => setManualLatitude(event.target.value)} inputProps={{ step: 'any' }} />
              <TextField label="Longitude" size="small" type="number" value={manualLongitude} onChange={(event) => setManualLongitude(event.target.value)} inputProps={{ step: 'any' }} />
            </Stack>
            <TextField label="Motivo da correção" size="small" multiline minRows={2} value={manualReason} onChange={(event) => setManualReason(event.target.value)} helperText="Mínimo de 5 caracteres." />
            <Button variant="outlined" color="warning" disabled={manualSubmitting || manualReason.trim().length < 5} onClick={submitManual}>
              {manualSubmitting ? 'Registrando...' : 'Registrar correção manual'}
            </Button>
          </DetailSection>
        </Stack>
      )}
    </Drawer>
  );
}

function DetailSection({ title, children }) {
  return <Box><Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{title}</Typography><Stack spacing={1}>{children}</Stack></Box>;
}

function Detail({ label, value, mono = false }) {
  return <Box><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{ fontFamily: mono ? 'monospace' : 'inherit', overflowWrap: 'anywhere' }}>{value || 'Não informado'}</Typography></Box>;
}

export default function Revalidacao() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState([]);
  const [job, setJob] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [includeReviewed, setIncludeReviewed] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const functions = useMemo(() => getFunctions(undefined, 'southamerica-east1'), []);

  const filteredResults = useMemo(() => results.filter((item) => matchesFilter(item, filter)), [results, filter]);
  const availableForApproval = filteredResults.filter((item) => item.approvalEligible && item.reviewStatus !== 'approved');

  const runBatch = async ({ fresh = false, jobId = null } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await httpsCallable(functions, 'revalidateCustomerCoordinates')({
        jobId: fresh ? undefined : (jobId || job?.id),
        batchSize: 50,
        includeReviewed: fresh ? includeReviewed : job?.scope === 'full',
      });
      const data = response.data;
      const nextJob = {
        id: data.jobId,
        status: data.status,
        total: data.total,
        processed: data.processed,
        summary: data.summary,
        scope: data.scope || (fresh && includeReviewed ? 'full' : 'pending_or_changed'),
        skippedReviewedCount: data.skippedReviewedCount || 0,
      };
      setJob(nextJob);
      globalThis.localStorage.setItem(JOB_STORAGE_KEY, data.jobId);
      setResults((current) => fresh ? data.results || [] : mergeResults(current, data.results || []));
      if (fresh) setSelectedIds(new Set());
    } catch (err) {
      setError(auditErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const resumeLastJob = async () => {
    const jobId = globalThis.localStorage.getItem(JOB_STORAGE_KEY);
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await httpsCallable(functions, 'getCoordinateRevalidationJob')({ jobId });
      const data = response.data;
      setJob({ id: jobId, ...data.job });
      setResults(data.results || []);
    } catch (err) {
      globalThis.localStorage.removeItem(JOB_STORAGE_KEY);
      setError(auditErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const applySelected = async () => {
    if (!job?.id || selectedIds.size === 0) return;
    setApplying(true);
    setError(null);
    try {
      const response = await httpsCallable(functions, 'applyCoordinateRevalidation')({
        jobId: job.id,
        customerIds: Array.from(selectedIds),
      });
      const applied = new Set(response.data?.applied || []);
      setResults((current) => current.map((item) => applied.has(item.id)
        ? { ...item, reviewStatus: 'approved', approvalEligible: false }
        : item));
      setSelectedIds(new Set());
    } catch (err) {
      setError(auditErrorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const applyManual = async ({ customerId, latitude, longitude, reason }) => {
    if (!job?.id) return;
    setApplying(true);
    setError(null);
    try {
      await httpsCallable(functions, 'applyManualCoordinateRevalidation')({
        jobId: job.id,
        customerId,
        latitude: Number(latitude),
        longitude: Number(longitude),
        reason,
      });
      setResults((current) => current.map((item) => item.id === customerId
        ? {
          ...item,
          currentCoordinate: { latitude: Number(latitude), longitude: Number(longitude) },
          navigationCoordinate: { latitude: Number(latitude), longitude: Number(longitude) },
          coordinateStatus: 'manual_confirmed',
          reviewStatus: 'manual',
          approvalEligible: false,
        }
        : item));
      setDetail((current) => current?.id === customerId
        ? {
          ...current,
          currentCoordinate: { latitude: Number(latitude), longitude: Number(longitude) },
          navigationCoordinate: { latitude: Number(latitude), longitude: Number(longitude) },
          coordinateStatus: 'manual_confirmed',
          reviewStatus: 'manual',
          approvalEligible: false,
        }
        : current);
    } catch (err) {
      setError(auditErrorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const toggleSelection = (id) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleVisibleSelection = () => setSelectedIds((current) => {
    const next = new Set(current);
    const everySelected = availableForApproval.length > 0 && availableForApproval.every((item) => next.has(item.id));
    availableForApproval.forEach((item) => everySelected ? next.delete(item.id) : next.add(item.id));
    return next;
  });

  const processedLabel = job ? `${job.processed || results.length} de ${job.total || 0}` : 'Nenhuma auditoria em andamento';

  return (
    <Box>
      <PageHeader title="Revalidação de coordenadas" subtitle="Confirme endereços antes de transformá-los em destinos de navegação." />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ lg: 'center' }}>
            <Box>
              <Typography variant="h6">Auditoria segura por lotes</Typography>
              <Typography variant="body2" color="text.secondary">Cada lote usa Mapbox Structured Input, compara forward/reverse, preserva a coordenada anterior e nunca altera clientes sem sua aprovação.</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                {job
                  ? `Progresso: ${processedLabel}${job.skippedReviewedCount ? ` · ${job.skippedReviewedCount} coordenadas ja aprovadas foram preservadas` : ''}`
                  : 'Por padrao, novas auditorias consultam apenas pendencias ou enderecos alterados.'}
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <FormControlLabel
                control={<Switch checked={includeReviewed} onChange={(event) => setIncludeReviewed(event.target.checked)} disabled={loading || Boolean(job?.status === 'running')} />}
                label={<Typography variant="caption">Auditoria completa</Typography>}
              />
              <Button variant="outlined" onClick={resumeLastJob} disabled={loading || !globalThis.localStorage.getItem(JOB_STORAGE_KEY)}>Retomar auditoria</Button>
              {job?.status === 'running' && <Button variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => runBatch()} disabled={loading}>Processar próximo lote</Button>}
              <Button variant="contained" startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />} onClick={() => runBatch({ fresh: true })} disabled={loading}>{loading ? 'Processando...' : 'Nova auditoria'}</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {job && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Metric label="Processados" value={processedLabel} />
            <Metric label="Preservadas" value={job.scope === 'full' ? (job.summary?.retained ?? 0) : (job.skippedReviewedCount ?? 0)} color="success.main" />
            <Metric label="Validados" value={job.summary?.approvalEligible ?? results.filter((item) => item.approvalEligible).length} color="success.main" />
            <Metric label="Exigem revisão" value={job.summary?.needsReview ?? 0} color="warning.main" />
            <Metric label="Variação acima de 2 km" value={job.summary?.catastrophicDistance ?? 0} color="error.main" />
          </Grid>

          <Card>
            <CardContent>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel>Filtro de auditoria</InputLabel>
                  <Select value={filter} label="Filtro de auditoria" onChange={(event) => setFilter(event.target.value)}>
                    {FILTERS.map(([value, label]) => <MenuItem value={value} key={value}>{label}</MenuItem>)}
                  </Select>
                </FormControl>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary">{filteredResults.length} registros visíveis</Typography>
                  <Button variant="contained" color="success" disabled={applying || selectedIds.size === 0} onClick={applySelected} startIcon={applying ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}>Aplicar {selectedIds.size || ''} aprovadas</Button>
                </Stack>
              </Stack>

              <Alert severity="info" sx={{ mb: 2 }}>
                {job.scope === 'full'
                  ? 'Auditoria completa: inclui coordenadas ja aprovadas. Use apenas quando precisar revisar a base inteira.'
                  : 'As coordenadas ja aprovadas para o mesmo endereco sao preservadas e nao geram nova consulta Mapbox. Coordenadas anteriores continuam armazenadas para auditoria.'}
              </Alert>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 620 }}>
                <Table stickyHeader size="small" aria-label="Resultados da auditoria de coordenadas">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox aria-label="Selecionar propostas visíveis" checked={availableForApproval.length > 0 && availableForApproval.every((item) => selectedIds.has(item.id))} indeterminate={availableForApproval.some((item) => selectedIds.has(item.id)) && !availableForApproval.every((item) => selectedIds.has(item.id))} onChange={toggleVisibleSelection} />
                      </TableCell>
                      <TableCell>Cliente</TableCell>
                      <TableCell>Atual</TableCell>
                      <TableCell>Geocodificada</TableCell>
                      <TableCell>Navegação</TableCell>
                      <TableCell>Variação</TableCell>
                      <TableCell>Qualidade</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredResults.map((item) => (
                      <TableRow key={item.id} hover onClick={() => setDetail(item)} sx={{ cursor: 'pointer' }}>
                        <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                          <Checkbox disabled={!item.approvalEligible || item.reviewStatus === 'approved'} checked={selectedIds.has(item.id)} onChange={() => toggleSelection(item.id)} inputProps={{ 'aria-label': `Selecionar ${item.name}` }} />
                        </TableCell>
                        <TableCell><Typography variant="body2" fontWeight={700}>{item.name}</Typography><Typography variant="caption" color="text.secondary">{item.city}/{item.state}</Typography></TableCell>
                        <TableCell>{formatCoordinate(item.currentCoordinate)}</TableCell>
                        <TableCell>{formatCoordinate(item.geocodedCoordinate)}</TableCell>
                        <TableCell><Stack direction="row" spacing={0.5} alignItems="center"><MyLocationOutlinedIcon fontSize="inherit" /><Typography variant="caption">{formatCoordinate(item.navigationCoordinate)}</Typography></Stack></TableCell>
                        <TableCell><Typography variant="body2">{formatMeters(item.distanceFromPreviousMeters)}</Typography><Typography variant="caption" color="text.secondary">{item.distanceClassification}</Typography></TableCell>
                        <TableCell><Typography variant="caption" display="block">{item.featureType} · {item.accuracy}</Typography><Typography variant="caption" color="text.secondary">{item.confidence} · nº {item.numberMatch}</Typography></TableCell>
                        <TableCell><Tooltip title={item.motivo || ''}>{statusChip(item)}</Tooltip></TableCell>
                      </TableRow>
                    ))}
                    {!filteredResults.length && <TableRow><TableCell colSpan={8}><Typography color="text.secondary" align="center" sx={{ py: 4 }}>Nenhum registro corresponde ao filtro atual.</Typography></TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </>
      )}
      <DetailDrawer item={detail} onClose={() => setDetail(null)} onApplyManual={applyManual} />
    </Box>
  );
}

function Metric({ label, value, color = 'text.primary' }) {
  return <Grid item xs={12} sm={6} lg={3}><Paper variant="outlined" sx={{ p: 2 }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h5" fontWeight={700} color={color}>{value}</Typography></Paper></Grid>;
}
