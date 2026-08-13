import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import MetricCard from './MetricCard';
import MinumLine from './MinumLine';
import { minumTokens } from '../design/tokens';
import { formatTelemetryDistance, formatTelemetryDuration } from '../utils/routeTelemetry';
import {
  buildRouteReport,
  feedbackCoverageLabel,
  routeStatusLabel,
  routeTypeLabel,
} from '../utils/routeReport';
import { exportRouteReportWorkbook } from '../utils/routeReportExport';

const initialFilters = {
  search: '',
  dateFrom: '',
  dateTo: '',
  sellerId: '',
  state: '',
  status: '',
  routeType: 'all',
};

const statusOptions = [
  { value: 'planned', label: 'Planejada' },
  { value: 'assigned', label: 'Atribuida' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'completed', label: 'Concluida' },
  { value: 'not_completed', label: 'Nao realizada' },
];

/** Painel de filtros e exportacao para transformar o historico em relatorios de gestao. */
export default function RouteReportPanel({ customers, routes, routeStops, users, visitEvents }) {
  const [filters, setFilters] = useState(initialFilters);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const report = useMemo(
    () => buildRouteReport({ customers, routes, routeStops, users, visitEvents, filters }),
    [customers, routes, routeStops, users, visitEvents, filters],
  );
  const summary = report.summary;

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    setFilters(initialFilters);
  }

  function exportReport() {
    if (!report.routes.length || isExporting) return;
    setExportError(null);
    setIsExporting(true);

    // Permite que a interface apresente o estado de carregamento antes do arquivo ser montado.
    window.setTimeout(() => {
      try {
        exportRouteReportWorkbook({
          report,
          filterLabels: buildFilterLabels(filters, report),
        });
      } catch (error) {
        setExportError(error.message || 'Nao foi possivel gerar a planilha agora.');
      } finally {
        setIsExporting(false);
      }
    }, 0);
  }

  return (
    <Box component="section" aria-labelledby="relatorios-title" mb={3.5}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.5 },
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" alignItems={{ lg: 'flex-start' }} gap={2}>
          <Stack spacing={0.65} maxWidth={720}>
            <Stack direction="row" spacing={1} alignItems="center">
              <AssessmentOutlinedIcon color="secondary" />
              <Typography id="relatorios-title" variant="h6">Relatorios gerenciais</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Filtre o historico e gere uma planilha organizada com resumo executivo, rotas, visitas e desempenho por vendedor.
            </Typography>
            <MinumLine sx={{ mt: 0.9 }} />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="Limpar filtros">
              <span>
                <IconButton onClick={resetFilters} aria-label="Limpar filtros do relatorio" disabled={isExporting}>
                  <RestartAltIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<DownloadOutlinedIcon />}
              onClick={exportReport}
              disabled={!report.routes.length || isExporting}
            >
              {isExporting ? 'Gerando planilha...' : 'Baixar relatorio Excel'}
            </Button>
          </Stack>
        </Stack>

        <Divider sx={{ my: 2.25 }} />

        <Box
          display="grid"
          gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }}
          gap={1.5}
        >
          <TextField
            label="Buscar rota, vendedor ou cliente"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            placeholder="Digite um nome ou ID"
            fullWidth
          />
          <TextField
            label="Data inicial"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            label="Data final"
            type="date"
            value={filters.dateTo}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            select
            label="Vendedor"
            value={filters.sellerId}
            onChange={(event) => updateFilter('sellerId', event.target.value)}
            fullWidth
          >
            <MenuItem value="">Todos os vendedores</MenuItem>
            {report.options.sellers.map((seller) => (
              <MenuItem key={seller.id} value={seller.id}>{seller.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Estado"
            value={filters.state}
            onChange={(event) => updateFilter('state', event.target.value)}
            fullWidth
          >
            <MenuItem value="">Todos os estados</MenuItem>
            {report.options.states.map((state) => <MenuItem key={state} value={state}>{state}</MenuItem>)}
          </TextField>
          <TextField
            select
            label="Situacao da rota"
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            fullWidth
          >
            <MenuItem value="">Todas as situacoes</MenuItem>
            {statusOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
          </TextField>
          <TextField
            select
            label="Origem da rota"
            value={filters.routeType}
            onChange={(event) => updateFilter('routeType', event.target.value)}
            fullWidth
          >
            <MenuItem value="all">Todas as rotas</MenuItem>
            <MenuItem value="shared">Atribuidas pelo administrador</MenuItem>
            <MenuItem value="seller">Criadas pelo vendedor</MenuItem>
          </TextField>
          <Stack justifyContent="center" spacing={0.6} sx={{ minHeight: 56 }}>
            <Typography variant="caption" color="text.secondary">Resultado do filtro</Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap">
              <Chip label={`${summary.routes} rotas`} size="small" color="primary" />
              <Chip label={`${summary.totalStops} clientes`} size="small" variant="outlined" />
              <Chip label={`${summary.sellers} vendedores`} size="small" variant="outlined" />
            </Stack>
          </Stack>
        </Box>
      </Paper>

      {exportError && <Alert severity="error" sx={{ mt: 1.5 }}>{exportError}</Alert>}

      <Box
        display="grid"
        gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }}
        gap={1.5}
        mt={1.5}
      >
        <MetricCard label="Rotas no recorte" value={summary.routes} icon={RouteOutlinedIcon} />
        <MetricCard
          label="Cobertura de feedback"
          value={`${summary.reportedStops}/${summary.totalStops} (${feedbackCoverageLabel(summary.feedbackCoveragePercent)})`}
          icon={FactCheckOutlinedIcon}
          color={minumTokens.brand.primary}
        />
        <MetricCard
          label="Distancia percorrida"
          value={formatTelemetryDistance(summary.actualDistanceMeters)}
          icon={RouteOutlinedIcon}
          color={minumTokens.brand.blue}
        />
        <MetricCard
          label="Tempo medio por visita"
          value={formatTelemetryDuration(summary.averageVisitDurationSeconds)}
          icon={TimerOutlinedIcon}
          color={minumTokens.brand.energy}
        />
      </Box>

      <Paper
        variant="outlined"
        sx={{
          mt: 1.5,
          p: { xs: 1.75, md: 2 },
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.25}>
          <Box>
            <Typography variant="subtitle2">O arquivo inclui quatro abas para analise</Typography>
            <Typography variant="body2" color="text.secondary" mt={0.35}>
              Resumo executivo, rotas filtradas, visitas e feedbacks, desempenho por vendedor e uma aba explicando os indicadores.
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" alignContent="flex-start">
            <Chip label={`${summary.completedRoutes} concluidas`} size="small" color="success" />
            <Chip label={`${summary.notCompletedRoutes} nao realizadas`} size="small" color={summary.notCompletedRoutes ? 'warning' : 'default'} />
            <Chip label={`${summary.visitedStops} visitados`} size="small" color="info" />
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}

function buildFilterLabels(filters, report) {
  const selectedSeller = report.options.sellers.find((seller) => seller.id === filters.sellerId)?.label;
  const period = [formatInputDate(filters.dateFrom), formatInputDate(filters.dateTo)].filter(Boolean).join(' a ');
  return {
    Periodo: period || 'Todo o historico',
    Busca: filters.search || 'Sem busca',
    Vendedor: selectedSeller || 'Todos os vendedores',
    Estado: filters.state || 'Todos os estados',
    Situacao: filters.status ? routeStatusLabel(filters.status) : 'Todas as situacoes',
    Origem: filters.routeType && filters.routeType !== 'all' ? routeTypeLabel(filters.routeType) : 'Todas as rotas',
  };
}

function formatInputDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}
