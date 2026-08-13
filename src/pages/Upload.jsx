import { useRef, useState } from 'react';
import XLSX from 'xlsx-js-style';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  LinearProgress,
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
  Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import FactCheckIcon from '@mui/icons-material/FactCheck';
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

  const isOdooImport = importFormat === 'odoo' && Boolean(odooPreview);
  const hasBlockingIssues = Number(odooPreview?.summary?.blockingIssues || 0) > 0;
  const busy = isProcessing || isSaving;
  const canConfirm = rows.length > 0
    && !busy
    && (!isOdooImport || (!hasBlockingIssues && odooPreview?.status !== 'imported'));

  async function parseFile(file) {
    setError('');
    setMessage('');
    setRows([]);
    setOdooPreview(null);
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
        subtitle="Envie uma planilha pronta ou a exportacao bruta do Odoo. Nada e gravado antes da sua revisao."
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
                  A exportacao bruta e identificada automaticamente. Marcadores soltos sao consolidados, campos vazios podem ser confirmados por fontes publicas e cada alteracao fica registrada em uma auditoria.
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
                  <SummaryMetric label="Marcadores consolidados" value={odooPreview.summary.extraTagRows} />
                  <SummaryMetric label="Coordenadas confirmadas" value={odooPreview.summary.coordinatesConfirmed} accent="success.main" />
                  <SummaryMetric label="Pendencias de revisao" value={odooPreview.summary.inconsistencies + odooPreview.summary.notFound} accent={hasBlockingIssues ? 'error.main' : 'warning.main'} />
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
                        {excelHeaders.slice(0, 7).map((header) => <TableCell key={header}>{header}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.slice(0, 5).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.opportunity}</TableCell>
                          <TableCell>{row.cpfCnpj}</TableCell>
                          <TableCell>{row.id}</TableCell>
                          <TableCell>{row.dealAddress}</TableCell>
                          <TableCell>{row.email}</TableCell>
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
    </>
  );
}
