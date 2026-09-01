import XLSX from 'xlsx-js-style';
import { httpsCallable } from 'firebase/functions';
import { auth, cloudFunctions } from './firebase';
import { excelHeaders, normalizeCustomer } from '../utils/helpers';

const processOdooLeadImport = httpsCallable(cloudFunctions, 'processOdooLeadImport', { timeout: 570000 });
const commitOdooLeadImport = httpsCallable(cloudFunctions, 'commitOdooLeadImport', { timeout: 210000 });
const reviewOdooImportCoordinate = httpsCallable(cloudFunctions, 'reviewOdooImportCoordinate', { timeout: 70000 });
const verifyOdooIntegration = httpsCallable(cloudFunctions, 'verifyOdooIntegration', { timeout: 70000 });
const createOdooIntegrationTestActivity = httpsCallable(cloudFunctions, 'createOdooIntegrationTestActivity', { timeout: 70000 });
const processSingleOdooVisitEvent = httpsCallable(cloudFunctions, 'processSingleOdooVisitEvent', { timeout: 70000 });

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo selecionado.'));
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.readAsDataURL(file);
  });
}

export function inspectSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const headers = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    range: 0,
    defval: '',
  })[0] || [];
  const normalizedHeaders = new Set(headers.map(normalizeHeader));
  const legacyOdooHeaders = [
    'oportunidade',
    'codigodosistemaminum',
    'marcadoresnomedomarcador',
  ];
  // Assinatura da exportacao direta de crm.lead do Odoo 18. Ela chega sem
  // coordenadas e sem codigo Minum, mas o backend a adapta automaticamente.
  const rawOdooHeaders = ['id', 'name', 'street', 'tagids'];

  return {
    workbook,
    worksheet,
    isRawOdooExport: legacyOdooHeaders.every((header) => normalizedHeaders.has(header))
      || rawOdooHeaders.every((header) => normalizedHeaders.has(header)),
  };
}

export async function createOdooImportPreview(file, options) {
  const fileBase64 = await fileToBase64(file);
  const response = await processOdooLeadImport({
    fileName: file.name,
    fileBase64,
    options,
  });
  return response.data;
}

export async function confirmOdooImport(jobId, mode) {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error('Sua sessao expirou. Entre novamente para confirmar a importacao.');
    error.code = 'unauthenticated';
    throw error;
  }

  // Garante que a chamada callable use um ID token vigente, inclusive quando
  // a revisao da planilha demorou mais que o tempo normal da sessao.
  await user.getIdToken(true);
  const response = await commitOdooLeadImport({ jobId, mode });
  return response.data;
}

/** Atualiza somente a previa temporaria; nenhum cliente e gravado nesta etapa. */
export async function reviewOdooImportCoordinatePreview(jobId, review) {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error('Sua sessao expirou. Entre novamente para revisar coordenadas.');
    error.code = 'unauthenticated';
    throw error;
  }
  await user.getIdToken(true);
  const response = await reviewOdooImportCoordinate({ jobId, ...review });
  return response.data;
}

export async function verifyOdooConnection() {
  const response = await verifyOdooIntegration();
  return response.data;
}

export async function createOdooTestActivity() {
  const response = await createOdooIntegrationTestActivity();
  return response.data;
}

/** Envia somente o feedback selecionado pelo administrador para o Odoo. */
export async function processSingleOdooFeedback({ routeId, stopId, eventId }) {
  const response = await processSingleOdooVisitEvent({ routeId, stopId, eventId });
  return response.data;
}

export function toPreviewCustomers(records) {
  return (records || [])
    .map((record, index) => ({
      ...normalizeCustomer(record, index),
      automation: record.__meta || {},
    }))
    .filter((customer) => customer.id);
}

export function downloadProcessedOdooWorkbook(records) {
  const exportRows = (records || []).map((record) => Object.fromEntries(
    excelHeaders.map((header) => [header, record[header] ?? '']),
  ));
  const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: excelHeaders });
  worksheet['!cols'] = excelHeaders.map((header) => ({ wch: Math.max(15, Math.min(34, header.length + 8)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads prontos');
  XLSX.writeFile(workbook, 'leads-odoo-prontos-para-importacao.xlsx');
}

function csvValue(value) {
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadOdooAudit(audit) {
  const headers = [
    'Linha',
    'Codigo Minum',
    'ID tecnico Odoo',
    'ID externo Odoo',
    'Oportunidade',
    'Etapa',
    'Status',
    'Fonte',
    'Campos',
    'Detalhes',
  ];
  const rows = (audit || []).map((entry) => [
    entry.row,
    entry.minumCode || entry.id,
    entry.odooLeadId,
    entry.odooExternalId,
    entry.opportunity,
    entry.stage,
    entry.status,
    entry.source,
    entry.fields,
    entry.details,
  ].map(csvValue).join(';'));
  const blob = new Blob([`\ufeff${headers.map(csvValue).join(';')}\n${rows.join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'auditoria-importacao-odoo.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export function odooImportErrorMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('unauthenticated')) return 'Sua sessao expirou. Entre novamente para processar a planilha.';
  if (code.includes('permission-denied')) return 'Somente administradores ativos podem processar ou confirmar esta importacao.';
  if (code.includes('failed-precondition')) return error?.message || 'A previa precisa ser processada novamente antes da confirmacao.';
  if (code.includes('invalid-argument')) return error?.message || 'A planilha nao segue o formato esperado para a exportacao do Odoo.';
  if (code.includes('not-found')) return error?.message || 'A previa expirou. Processe a planilha novamente.';
  return error?.message || 'Nao foi possivel processar a planilha agora. Tente novamente em alguns instantes.';
}
