import { useRef, useState } from 'react';
import XLSX from 'xlsx-js-style';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import PageHeader from '../components/PageHeader';
import { importCustomers } from '../services/api';
import { excelHeaders, normalizeCustomer } from '../utils/helpers';

export default function Upload() {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState('merge');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function parseFile(file) {
    setError('');
    setMessage('');
    setProgress(20);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
      const customers = jsonRows.map(normalizeCustomer).filter((customer) => customer.id);
      setRows(customers);
      setProgress(100);
      setMessage(`${customers.length} registros prontos para importacao.`);
    } catch {
      setError('Nao foi possivel ler a planilha. Verifique se o arquivo e .xlsx ou .xls.');
      setRows([]);
      setProgress(0);
    }
  }

  function handleFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError('Selecione um arquivo .xlsx ou .xls.');
      return;
    }
    parseFile(file);
  }

  async function handleImport() {
    setError('');
    setMessage('');
    setProgress(30);
    try {
      const result = await importCustomers(rows, mode);
      setProgress(100);
      setMessage(`${result.processed} clientes importados com sucesso.`);
    } catch (uploadError) {
      setError(`Falha ao salvar no Firebase: ${uploadError.message || 'confira sua conexao, variaveis .env e regras de acesso.'}`);
      setProgress(0);
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
        title="Upload de clientes"
        subtitle="Importe uma planilha Excel e grave os dados no no customers."
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
            <Box
              className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                handleFile(event.dataTransfer.files?.[0]);
              }}
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
              <Typography variant="body2" color="text.secondary" mt={2}>
                Arquivo: {fileName}
              </Typography>
            )}
            {progress > 0 && <LinearProgress variant="determinate" value={progress} sx={{ mt: 2 }} />}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <Card>
            <CardContent>
              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }} spacing={2} mb={2}>
                <FormControl>
                  <RadioGroup row value={mode} onChange={(event) => setMode(event.target.value)}>
                    <FormControlLabel value="merge" control={<Radio />} label="Mesclar por ID" />
                    <FormControlLabel value="replace" control={<Radio />} label="Substituir todos" />
                  </RadioGroup>
                </FormControl>
                <Button variant="contained" startIcon={<SaveIcon />} onClick={handleImport}>
                  Confirmar envio
                </Button>
              </Stack>
              <Typography variant="h6" mb={1}>
                Previa das primeiras 5 linhas
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {excelHeaders.slice(0, 7).map((header) => (
                        <TableCell key={header}>{header}</TableCell>
                      ))}
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
            </CardContent>
          </Card>
        )}
      </Stack>
    </>
  );
}
