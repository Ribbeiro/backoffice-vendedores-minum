import { useEffect, useRef, useState } from 'react';
import XLSX from 'xlsx-js-style';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  LinearProgress,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import EditLocationAltIcon from '@mui/icons-material/EditLocationAlt';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import SaveIcon from '@mui/icons-material/Save';
import PageHeader from '../components/PageHeader';
import { importCustomers } from '../services/api';
import {
  confirmOdooImport,
  createOdooImportPreview,
  downloadOdooAudit,
  downloadProcessedOdooWorkbook,
  inspectSpreadsheet,
  odooImportErrorMessage,
  reviewOdooImportCoordinatePreview,
  toPreviewCustomers,
} from '../services/odooImport';
import { excelHeaders, normalizeCustomer } from '../utils/helpers';

function auditChipColor(status) {
  if (status === 'FILLED' || status === 'OK') return 'success';
  if (status === 'INCONSISTENCY' || status === 'ERROR' || status === 'REJECTED') return 'error';
  return 'warning';
}

function SummaryMetric({ label, value, accent = 'text.primary' }) {
  return (
    <Box sx={{ borderLeft: '3px solid', borderColor: 'primary.main', pl: 1.5, minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" color={accent}>{value}</Typography>
    </Box>
  );
}

function isUsableCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

function formatCoordinate(latitude, longitude) {
  return isUsableCoordinate(latitude, longitude)
    ? `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`
    : 'Nao disponivel';
}

function coordinateStatusChip(record) {
  const status = String(record?.__meta?.coordinateStatus || 'missing').replaceAll('_', ' ');
  const confirmed = ['confirmed', 'manual_confirmed'].includes(record?.__meta?.coordinateStatus);
  return <Chip size="small" color={confirmed ? 'success' : 'warning'} label={status} />;
}

function CoordinateReviewDrawer({ record, onClose, onReview, saving }) {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [reason, setReason] = useState('');
  const meta = record?.__meta || {};
  const hasSuggestion = isUsableCoordinate(meta.geocodedLatitude, meta.geocodedLongitude);
  const hasCurrentCoordinate = isUsableCoordinate(record?.latitude, record?.longitude);

  useEffect(() => {
    setLatitude(meta.geocodedLatitude ?? record?.latitude ?? '');
    setLongitude(meta.geocodedLongitude ?? record?.longitude ?? '');
    setReason('');
  }, [record?.ID, meta.geocodedLatitude, meta.geocodedLongitude, record?.latitude, record?.longitude]);

  if (!record) return null;

  return (
    <Drawer anchor="right" open={Boolean(record)} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, p: 3 } }}>
      <Stack spacing={2.25}>
        <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="flex-start">
          <Box>
            <Typography variant="overline" color="secondary.main">Revisao antes da importacao</Typography>
            <Typography variant="h6">{record.opportunity || record.Opportunity || record.clientName || record['Client - Name']}</Typography>
            <Typography variant="body2" color="text.secondary">{record.dealAddress || record['Deal - Address'] || 'Endereco nao informado'}</Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Fechar revisao de coordenada"><CloseIcon /></IconButton>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{coordinateStatusChip(record)}</Stack>

        <Box>
          <Typography variant="caption" color="text.secondary">Coordenada atual</Typography>
          <Typography variant="body2">{formatCoordinate(record.latitude, record.longitude)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Proposta Mapbox</Typography>
          <Typography variant="body2">{formatCoordinate(meta.geocodedLatitude, meta.geocodedLongitude)}</Typography>
          <Typography variant="caption" color="text.secondary">{meta.geocoding?.reason || 'Sem proposta automatica para este endereco.'}</Typography>
        </Box>

        <Stack spacing={1}>
          <Button
            variant="contained"
            startIcon={<CheckCircleIcon />}
            disabled={saving || !hasSuggestion}
            onClick={() => onReview({ recordId: record.ID, action: 'accept_mapbox' })}
          >
            Usar proposta Mapbox
          </Button>
          <Button
            variant="outlined"
            startIcon={<MyLocationIcon />}
            disabled={saving || !hasCurrentCoordinate}
            onClick={() => onReview({ recordId: record.ID, action: 'confirm_current' })}
          >
            Confirmar coordenada atual
          </Button>
        </Stack>

        <Divider />
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Corrigir manualmente</Typography>
          <Typography variant="caption" color="text.secondary">Use uma fonte confiavel. A decisao fica vinculada ao endereco e nao sera reprocessada em uma nova auditoria.</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField label="Latitude" size="small" type="number" value={latitude} onChange={(event) => setLatitude(event.target.value)} inputProps={{ step: 'any' }} fullWidth />
          <TextField label="Longitude" size="small" type="number" value={longitude} onChange={(event) => setLongitude(event.target.value)} inputProps={{ step: 'any' }} fullWidth />
        </Stack>
        <TextField label="Motivo da correcao" size="small" multiline minRows={2} value={reason} onChange={(event) => setReason(event.target.value)} helperText="Minimo de 5 caracteres." />
        <Button
          variant="outlined"
          color="warning"
          startIcon={<EditLocationAltIcon />}
          disabled={saving || !isUsableCoordinate(latitude, longitude) || reason.trim().length < 5}
          onClick={() => onReview({ recordId: record.ID, action: 'manual', latitude: Number(latitude), longitude: Number(longitude), reason })}
        >
          Salvar coordenada manual
        </Button>
      </Stack>
    </Drawer>
  );
}

export default function Upload() {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState('merge');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [importFormat, setImportFormat] = useState('');
  const [odooPreview, setOdooPreview] = useState(null);
  const [enableResearch, setEnableResearch] = useState(true);
  const [enableGeocoding, setEnableGeocoding] = useState(true);
  const [coordinateReviewRecord, setCoordinateReviewRecord] = useState(null);
  const [isReviewingCoordinates, setIsReviewingCoordinates] = useState(false);

  const isOdooImport = importFormat === 'odoo' && Boolean(odooPreview);
  const hasBlockingIssues = Number(odooPreview?.summary?.blockingIssues || 0) > 0;
  const coordinateReviewRecords = isOdooImport
    ? (odooPreview.records || []).filter((record) => !['confirmed', 'manual_confirmed'].includes(record?.__meta?.coordinateStatus))
    : [];
  const busy = isProcessing || isSaving || isReviewingCoordinates;
  const canConfirm = rows.length > 0
    && !busy
    && (!isOdooImport || (!hasBlockingIssues && odooPreview?.status !== 'imported'));

  async function parseFile(file) {
    setError('');
    setMessage('');
    setRows([]);
    setOdooPreview(null);
    setCoordinateReviewRecord(null);
    setImportFormat('');
    setProgress(12);
    setFileName(file.name);
    setIsProcessing(true);

    try {
      const buffer = await file.arrayBuffer();
      const inspection = inspectSpreadsheet(buffer);

      if (inspection.isRawOdooExport) {
        setImportFormat('odoo');
        setProgress(32);
        const preview = await createOdooImportPreview(file, {
          enableResearch,
          enableGeocoding,
        });
        const customers = toPreviewCustomers(preview.records);
        if (!customers.length) throw new Error('Nenhuma oportunidade valida foi encontrada na planilha do Odoo.');

        setRows(customers);
        setOdooPreview(preview);
        setProgress(100);
        setMessage(`${preview.summary.opportunities} oportunidades consolidadas e prontas para revisao.`);
        return;
      }

      const jsonRows = XLSX.utils.sheet_to_json(inspection.worksheet, { defval: '' });
      const customers = jsonRows.map(normalizeCustomer).filter((customer) => customer.id);
      if (!customers.length) throw new Error('Nenhum cliente com ID valido foi encontrado na planilha.');

      setImportFormat('standard');
      setRows(customers);
      setProgress(100);
      setMessage(`${customers.length} registros prontos para importacao.`);
    } catch (parseError) {
      setRows([]);
      setOdooPreview(null);
      setProgress(0);
      setError(parseError?.code
        ? odooImportErrorMessage(parseError)
        : parseError?.message || 'Nao foi possivel ler a planilha. Verifique se o arquivo e .xlsx ou .xls.');
    } finally {
      setIsProcessing(false);
    }
  }

  function handleFile(file) {
    if (!file || busy) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError('Selecione uma planilha .xlsx ou .xls.');
      return;
    }
    parseFile(file);
  }

  async function handleImport() {
    if (!canConfirm) return;
    setError('');
    setMessage('');
    setProgress(35);
    setIsSaving(true);

    try {
      if (isOdooImport) {
        const result = await confirmOdooImport(odooPreview.jobId, mode);
        setOdooPreview((previous) => ({ ...previous, status: 'imported' }));
        setProgress(100);
        setMessage(`${result.processed} oportunidades importadas com sucesso pelo modo ${result.mode === 'replace' ? 'substituir todos' : 'mesclar por ID'}.`);
        return;
      }

      const result = await importCustomers(rows, mode);
      setProgress(100);
      setMessage(`${result.processed} clientes importados com sucesso.`);
    } catch (uploadError) {
      setProgress(0);
      setError(isOdooImport
        ? odooImportErrorMessage(uploadError)
        : `Falha ao salvar no Firebase: ${uploadError.message || 'confira sua conexao, variaveis .env e regras de acesso.'}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCoordinateReview(review) {
    if (!odooPreview?.jobId) return;
    setError('');
    setMessage('');
    setIsReviewingCoordinates(true);
    try {
      const result = await reviewOdooImportCoordinatePreview(odooPreview.jobId, review);
      const nextRecords = (odooPreview.records || []).map((record) => String(record.ID) === String(result.record.ID)
        ? result.record
        : record);
      setOdooPreview((previous) => previous ? {
        ...previous,
        records: nextRecords,
        summary: result.summary,
      } : previous);
      setRows(toPreviewCustomers(nextRecords));
      setCoordinateReviewRecord(null);
      setMessage('Coordenada revisada na previa. Ela sera gravada somente quando a importacao for confirmada.');
    } catch (reviewError) {
      setError(odooImportErrorMessage(reviewError));
    } finally {
      setIsReviewingCoordinates(false);
    }
  }

  function handleDownloadTemplate() {
    const worksheet = XLSX.utils.aoa_to_sheet([excelHeaders]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Modelo leads');
    XLSX.writeFile(workbook, 'modelo-importacao-leads-minum.xlsx');
  }

  return (
    <>
      <PageHeader
        title="Importar clientes"
        subtitle="Envie a exportacao direta do crm.lead ou o modelo Minum. Nada e gravado antes da sua revisao."
        action={
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownloadTemplate}>
            Baixar modelo
          </Button>
        }
      />

      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {message && <Alert severity="success">{message}</Alert>}

        <Card>
          <CardContent>
            <Stack spacing={2.5}>
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                  <AutoFixHighIcon color="primary" fontSize="small" />
                  <Typography variant="h6">Importacao inteligente do Odoo</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  A exportacao bruta do Odoo e identificada automaticamente. O sistema vincula o ID tecnico do lead, consolida marcadores, valida enderecos com Mapbox e registra cada decisao na auditoria.
                </Typography>
              </Box>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 0, md: 3 }} divider={<Divider flexItem orientation="vertical" />}>
                <FormControlLabel
                  control={<Switch checked={enableResearch} onChange={(event) => setEnableResearch(event.target.checked)} disabled={busy || rows.length > 0} />}
                  label="Completar campos vazios por CNPJ confirmado"
                />
                <FormControlLabel
                  control={<Switch checked={enableGeocoding} onChange={(event) => setEnableGeocoding(event.target.checked)} disabled={busy || rows.length > 0} />}
                  label="Buscar coordenadas para enderecos confirmados"
                />
              </Stack>

              <Box
                className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
                onClick={() => !busy && inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!busy) setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  handleFile(event.dataTransfer.files?.[0]);
                }}
                sx={{ opacity: busy ? 0.65 : 1, cursor: busy ? 'wait' : 'pointer' }}
              >
                <CloudUploadIcon color="primary" sx={{ fontSize: 44 }} />
                <Typography variant="h6">Arraste a planilha ou clique para selecionar</Typography>
                <Typography color="text.secondary">Formatos aceitos: .xlsx e .xls</Typography>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  hidden
                  onChange={(event) => handleFile(event.target.files?.[0])}
                />
              </Box>

              {fileName && (
                <Typography variant="body2" color="text.secondary">
                  Arquivo selecionado: {fileName}
                </Typography>
              )}
              {progress > 0 && <LinearProgress variant="determinate" value={progress} />}
            </Stack>
          </CardContent>
        </Card>

        {isOdooImport && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1}>
                  <Box>
                    <Typography variant="h6">Previa auditavel da exportacao Odoo</Typography>
                    <Typography variant="body2" color="text.secondary">A confirmacao grava somente as oportunidades consolidadas nesta previa.</Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadProcessedOdooWorkbook(odooPreview.records)}>
                      Baixar planilha tratada
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<FactCheckIcon />} onClick={() => downloadOdooAudit(odooPreview.audit)}>
                      Baixar auditoria
                    </Button>
                  </Stack>
                </Stack>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, py: 1 }}>
                  <SummaryMetric label="Oportunidades" value={odooPreview.summary.opportunities} />
                  <SummaryMetric
                    label="Formato identificado"
                    value={odooPreview.summary.inputFormat === 'odoo_raw_export' ? 'Odoo CRM' : 'Modelo Minum'}
                  />
                  <SummaryMetric label="Leads Odoo vinculados" value={odooPreview.summary.odooLeadsLinked ?? 0} accent="success.main" />
                  <SummaryMetric label="Marcadores consolidados" value={odooPreview.summary.extraTagRows} />
                  <SummaryMetric label="Coordenadas confirmadas" value={odooPreview.summary.coordinatesConfirmed} accent="success.main" />
                  <SummaryMetric label="Coordenadas a revisar" value={odooPreview.summary.coordinatesNeedsReview ?? (odooPreview.summary.inconsistencies + odooPreview.summary.notFound)} accent={hasBlockingIssues ? 'error.main' : 'warning.main'} />
                </Box>

                <Alert severity={hasBlockingIssues ? 'error' : 'info'}>
                  {hasBlockingIssues
                    ? `Foram encontradas ${odooPreview.summary.blockingIssues} inconsistencias estruturais. Corrija a planilha antes de confirmar a importacao.`
                    : 'Revise os apontamentos abaixo. Pendencias de pesquisa nao impedem a importacao; elas ficam registradas para tratamento posterior.'}
                </Alert>

                <TableContainer sx={{ maxHeight: 300 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Linha</TableCell>
                        <TableCell>Etapa</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Detalhe</TableCell>
                        <TableCell>Fonte</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {odooPreview.audit.filter((entry) => entry.status !== 'OK').slice(0, 12).map((entry, index) => (
                        <TableRow key={`${entry.row}-${entry.stage}-${index}`}>
                          <TableCell>{entry.row || '-'}</TableCell>
                          <TableCell>{entry.stage}</TableCell>
                          <TableCell><Chip size="small" color={auditChipColor(entry.status)} label={entry.status} /></TableCell>
                          <TableCell>{entry.details}</TableCell>
                          <TableCell>{entry.source || '-'}</TableCell>
                        </TableRow>
                      ))}
                      {!odooPreview.audit.some((entry) => entry.status !== 'OK') && (
                        <TableRow><TableCell colSpan={5}>Nenhuma pendencia encontrada nesta previa.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </CardContent>
          </Card>
        )}

        {isOdooImport && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1}>
                  <Box>
                    <Typography variant="h6">Revisar coordenadas antes de importar</Typography>
                    <Typography variant="body2" color="text.secondary">Use a proposta Mapbox, confirme a coordenada de origem ou corrija manualmente. Esta etapa reaproveita a busca ja feita na previa.</Typography>
                  </Box>
                  <Chip color={coordinateReviewRecords.length ? 'warning' : 'success'} label={coordinateReviewRecords.length ? `${coordinateReviewRecords.length} para revisar` : 'Todas confirmadas'} />
                </Stack>

                {coordinateReviewRecords.length > 0 ? (
                  <TableContainer sx={{ maxHeight: 380 }}>
                    <Table stickyHeader size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Oportunidade</TableCell>
                          <TableCell>Endereco</TableCell>
                          <TableCell>Atual</TableCell>
                          <TableCell>Proposta Mapbox</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Acao</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {coordinateReviewRecords.map((record) => (
                          <TableRow key={record.ID} hover>
                            <TableCell><Typography variant="body2" fontWeight={700}>{record.Opportunity || record['Client - Name'] || record.ID}</Typography><Typography variant="caption" color="text.secondary">{record.ID}</Typography></TableCell>
                            <TableCell>{record['Deal - Address'] || '-'}</TableCell>
                            <TableCell>{formatCoordinate(record.latitude, record.longitude)}</TableCell>
                            <TableCell>{formatCoordinate(record.__meta?.geocodedLatitude, record.__meta?.geocodedLongitude)}</TableCell>
                            <TableCell>{coordinateStatusChip(record)}</TableCell>
                            <TableCell align="right"><Button size="small" startIcon={<FactCheckIcon />} onClick={() => setCoordinateReviewRecord(record)}>Revisar</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="success">Todas as coordenadas desta previa estao confirmadas ou foram aprovadas manualmente. Nenhuma nova auditoria sera necessaria para estes mesmos enderecos.</Alert>
                )}
              </Stack>
            </CardContent>
          </Card>
        )}

        {rows.length > 0 && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }} spacing={2}>
                  <FormControl>
                    <RadioGroup row value={mode} onChange={(event) => setMode(event.target.value)}>
                      <FormControlLabel value="merge" control={<Radio />} label="Mesclar por ID" />
                      <FormControlLabel value="replace" control={<Radio />} label="Substituir todos" />
                    </RadioGroup>
                  </FormControl>
                  <Button variant="contained" startIcon={<SaveIcon />} onClick={handleImport} disabled={!canConfirm}>
                    {isSaving ? 'Salvando...' : odooPreview?.status === 'imported' ? 'Importacao concluida' : 'Confirmar importacao'}
                  </Button>
                </Stack>

                {mode === 'replace' && (
                  <Alert severity="warning">Substituir todos remove a base atual de clientes antes de gravar a planilha revisada.</Alert>
                )}

                <Typography variant="h6">Previa das primeiras 5 oportunidades</Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Oportunidade</TableCell>
                        <TableCell>CPF/CNPJ</TableCell>
                        <TableCell>Codigo Minum</TableCell>
                        <TableCell>ID tecnico Odoo</TableCell>
                        <TableCell>ID externo Odoo</TableCell>
                        <TableCell>Endereco</TableCell>
                        <TableCell>Estado</TableCell>
                        <TableCell>Cidade</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.slice(0, 5).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.opportunity}</TableCell>
                          <TableCell>{row.cpfCnpj}</TableCell>
                          <TableCell>{row.minumCode || row.externalId || row.id}</TableCell>
                          <TableCell>{row.odooLeadId || '-'}</TableCell>
                          <TableCell>{row.odooExternalId || '-'}</TableCell>
                          <TableCell>{row.dealAddress}</TableCell>
                          <TableCell>{row.state}</TableCell>
                          <TableCell>{row.city}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
      <CoordinateReviewDrawer
        record={coordinateReviewRecord}
        saving={isReviewingCoordinates}
        onClose={() => !isReviewingCoordinates && setCoordinateReviewRecord(null)}
        onReview={handleCoordinateReview}
      />
    </>
  );
}
