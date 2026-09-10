const XLSX = require('xlsx');
const {
  GEOCODING_ALGORITHM_VERSION,
  canonicalKey,
  cleanCell,
  normalizeCityAndState,
  normalizeString,
  parseBrazilianAddress,
  parseThousandHouseNumber,
} = require('./addressNormalizer');
const {
  calculateHaversineDistanceMeters,
  classifyDistance,
  compareReverseAddress,
  validateMapboxResponse,
} = require('./mapboxGeocoder');
const { toFirebaseSafeValue } = require('./firebaseSafeData');
const {
  PRESERVED_COORDINATE_FIELDS,
  canonicalAddressKeyForCustomer,
  coordinateReviewSnapshot,
  isCoordinateReviewLocked,
  preserveCoordinateReview,
} = require('./coordinateReview');

const TARGET_HEADERS = Object.freeze([
  'Opportunity',
  '(CPF/CNPJ)',
  'ID',
  'Odoo Lead ID',
  'Odoo External ID',
  'Deal - Address',
  'Client - Email',
  'Client - State',
  'Cidade',
  'Client - Phone',
  'Deal - Segment',
  'Responsavel',
  'Ultima Atualizacao',
  'Deal - Distributor',
  'Deal - Responsable Salesperson',
  'Deal - Tags',
  'Deal - Expected Revenue',
  'Deal - Notes',
  'Deal - Origem',
  'Deal - Pipeline Stage',
  'Client - Name',
  'latitude',
  'longitude',
  'Country',
]);

const HEADER_ALIASES = [
  ['Oportunidade', 'Opportunity'],
  ['Opportunity', 'Opportunity'],
  ['CPF/CNPJ', '(CPF/CNPJ)'],
  ['(CPF/CNPJ)', '(CPF/CNPJ)'],
  // O export do Odoo contem dois identificadores diferentes. O codigo Minum
  // continua em ID para preservar a chave legada do Firebase; o ID tecnico
  // do crm.lead nunca pode sobrescreve-lo.
  ['Codigo do sistema MINUM', 'ID'],
  ['Código do sistema MINUM', 'ID'],
  ['Minum Code', 'ID'],
  ['ID', 'Odoo Lead ID'],
  ['Odoo Lead ID', 'Odoo Lead ID'],
  ['Odoo Lead Id', 'Odoo Lead ID'],
  ['CRM Lead ID', 'Odoo Lead ID'],
  ['CRM Lead Id', 'Odoo Lead ID'],
  ['ID tecnico do Odoo', 'Odoo Lead ID'],
  ['ID técnico do Odoo', 'Odoo Lead ID'],
  ['External ID', 'Odoo External ID'],
  ['External Id', 'Odoo External ID'],
  ['Odoo External ID', 'Odoo External ID'],
  ['Odoo External Id', 'Odoo External ID'],
  ['ID externo do Odoo', 'Odoo External ID'],
  ['ID externo', 'Odoo External ID'],
  ['Endereco', 'Deal - Address'],
  ['Endereço', 'Deal - Address'],
  ['Deal - Address', 'Deal - Address'],
  ['E-mail', 'Client - Email'],
  ['Email', 'Client - Email'],
  ['Client - Email', 'Client - Email'],
  ['Estado/Codigo do estado', 'Client - State'],
  ['Estado/Código do estado', 'Client - State'],
  ['Client - State', 'Client - State'],
  ['Cidade', 'Cidade'],
  ['Telefone', 'Client - Phone'],
  ['Client - Phone', 'Client - Phone'],
  ['Segmento', 'Deal - Segment'],
  ['Deal - Segment', 'Deal - Segment'],
  ['Usuario responsavel', 'Responsavel'],
  ['Usuário responsável', 'Responsavel'],
  ['Responsavel', 'Responsavel'],
  ['Ultima atualizacao de estagio', 'Ultima Atualizacao'],
  ['Última atualização de estágio', 'Ultima Atualizacao'],
  ['Ultima Atualizacao', 'Ultima Atualizacao'],
  ['Distribuidora', 'Deal - Distributor'],
  ['Deal - Distributor', 'Deal - Distributor'],
  ['Vendedor/Nome', 'Deal - Responsable Salesperson'],
  ['Deal - Responsable Salesperson', 'Deal - Responsable Salesperson'],
  ['Marcadores/Nome do marcador', 'Deal - Tags'],
  ['Deal - Tags', 'Deal - Tags'],
  ['Receita esperada', 'Deal - Expected Revenue'],
  ['Deal - Expected Revenue', 'Deal - Expected Revenue'],
  ['Notas', 'Deal - Notes'],
  ['Deal - Notes', 'Deal - Notes'],
  ['Origem', 'Deal - Origem'],
  ['Deal - Origem', 'Deal - Origem'],
  ['Estagio/Nome do estagio', 'Deal - Pipeline Stage'],
  ['Estágio/Nome do estágio', 'Deal - Pipeline Stage'],
  ['Deal - Pipeline Stage', 'Deal - Pipeline Stage'],
  ['Nome do contato', 'Client - Name'],
  ['Client - Name', 'Client - Name'],
  ['Pais/Nome do pais', 'Country'],
  ['País/Nome do país', 'Country'],
  ['Country', 'Country'],
  ['latitude', 'latitude'],
  ['Latitude', 'latitude'],
  ['longitude', 'longitude'],
  ['Longitude', 'longitude'],
];

const HEADER_MAP = new Map(HEADER_ALIASES.map(([source, target]) => [normalizeHeader(source), target]));

// Esta e a assinatura da exportacao direta de crm.lead feita pelo Odoo.
// Ela nao contem o codigo Minum nem latitude/longitude, portanto precisa ser
// adaptada antes de seguir pelo mesmo fluxo auditavel do modelo Minum.
const RAW_ODOO_REQUIRED_HEADERS = Object.freeze(['id', 'name', 'street', 'tagids']);

class ProcessorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function onlyDigits(value) {
  return cleanCell(value).replace(/\D/g, '');
}

function identifierAsText(value) {
  const text = cleanCell(value);
  if (!text) return '';
  if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
  return text;
}

/** Extrai o ID numerico de "__export__.crm_lead_64208_xxx" sem adivinhar valores. */
function extractOdooLeadId(value) {
  const identifier = identifierAsText(value);
  const direct = odooLeadIdOrNull(identifier);
  if (direct) return String(direct);

  const match = identifier.match(/(?:^|[._-])crm[_-]?lead[_-](\d+)(?:[._-]|$)/i);
  return match?.[1] || '';
}

/** A exportacao pura nao possui codigo Minum; o ID do crm.lead vira a chave estavel. */
function odooImportStableId(odooLeadId, odooExternalId) {
  if (odooLeadId) return `odoo_lead_${odooLeadId}`;
  const fallback = identifierAsText(odooExternalId)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return fallback ? `odoo_external_${fallback}` : '';
}

function cleanOdooOpportunity(value) {
  return cleanCell(value).replace(/^(?:true|false)\s*[-:]\s*/i, '').trim();
}

function extractCoordinatesFromNotes(value) {
  const text = cleanCell(value);
  const match = text.match(/(?:coordenadas?|coordinates?)\s*:\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)/i);
  if (!match) return null;

  const latitude = Number(match[1].replace(',', '.'));
  const longitude = Number(match[2].replace(',', '.'));
  return isValidCoordinates(latitude, longitude) ? { latitude, longitude } : null;
}

/** Mantem o ID tecnico do crm.lead como inteiro apenas quando ele e valido. */
function odooLeadIdOrNull(value) {
  const identifier = identifierAsText(value);
  if (!/^\d+$/.test(identifier)) return null;
  const parsed = Number(identifier);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = String(value).trim().replace(/\s/g, '');
  const parsed = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(parsed) ? parsed : null;
}

function expectedRevenueNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const compact = String(value)
    .trim()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/R\$/gi, '')
    .replace(/[^\d.,+-]/g, '');
  const match = compact.match(/^([+-]?)(\d[\d.,]*)$/);
  if (!match) return null;

  const sign = match[1] === '-' ? '-' : '';
  const valueText = match[2];
  const lastDot = valueText.lastIndexOf('.');
  const lastComma = valueText.lastIndexOf(',');
  let normalized;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    const thousandSeparator = decimalSeparator === '.' ? ',' : '.';
    const parts = valueText.split(thousandSeparator).join('').split(decimalSeparator);
    if (parts.length !== 2 || !parts.every((part) => /^\d+$/.test(part))) return null;
    normalized = `${parts[0]}.${parts[1]}`;
  } else {
    const separator = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
    if (!separator) {
      normalized = /^\d+$/.test(valueText) ? valueText : null;
    } else {
      const parts = valueText.split(separator);
      if (!parts.every((part) => /^\d+$/.test(part))) return null;
      if (parts.length === 2) {
        normalized = parts[1].length === 3 ? parts.join('') : `${parts[0]}.${parts[1]}`;
      } else if (parts.slice(1).every((part) => part.length === 3)) {
        normalized = parts.join('');
      } else {
        const fraction = parts.at(-1);
        const integerGroups = parts.slice(0, -1);
        normalized = fraction.length <= 2 && integerGroups.slice(1).every((part) => part.length === 3)
          ? `${integerGroups.join('')}.${fraction}`
          : null;
      }
    }
  }

  if (!normalized) return null;
  const parsed = Number(`${sign}${normalized}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidCoordinates(latitude, longitude) {
  const lat = numberOrNull(latitude);
  const lon = numberOrNull(longitude);
  return lat !== null && lon !== null
    && lat >= -90 && lat <= 90
    && lon >= -180 && lon <= 180
    && !(lat === 0 && lon === 0);
}

function splitTags(value) {
  return cleanCell(value)
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniquePreservingOrder(items) {
  const known = new Set();
  return items.filter((item) => {
    const key = normalizeString(item).toLowerCase();
    if (!key || known.has(key)) return false;
    known.add(key);
    return true;
  });
}

function createRecord(rowNumber) {
  const record = Object.fromEntries(TARGET_HEADERS.map((header) => [header, '']));
  record.Country = 'Brasil';
  record.__meta = {
    sourceRows: [rowNumber],
    researchStatus: 'not_checked',
    researchSources: [],
    coordinateStatus: 'missing',
    coordinateSource: null,
    coordinatePrecisionLevel: 'unknown',
  };
  return record;
}

function createAudit(record, stage, status, details, fields = [], source = '') {
  return {
    row: record?.__meta?.sourceRows?.join(', ') || null,
    id: cleanCell(record?.ID),
    minumCode: cleanCell(record?.ID),
    odooLeadId: identifierAsText(record?.['Odoo Lead ID']),
    odooExternalId: identifierAsText(record?.['Odoo External ID']),
    opportunity: cleanCell(record?.Opportunity),
    stage,
    status,
    source,
    fields,
    details,
  };
}

function appendSource(record, source) {
  if (!source) return;
  record.__meta.researchSources = uniquePreservingOrder([...(record.__meta.researchSources || []), source]);
}

function updateResearchStatus(record, status) {
  const priority = {
    not_checked: 0,
    not_found: 1,
    pending_configuration: 2,
    confirmed: 3,
    needs_review: 4,
  };

  const current = record.__meta.researchStatus || 'not_checked';
  if ((priority[status] ?? 0) >= (priority[current] ?? 0)) {
    record.__meta.researchStatus = status;
  }
}

function chooseWorksheet(workbook) {
  const preferred = workbook.SheetNames.find((name) => normalizeString(name).toLowerCase() === 'sheet1')
    || workbook.SheetNames.find((name) => normalizeString(name).toLowerCase() === 'modelo leads')
    || workbook.SheetNames[0];
  return workbook.Sheets[preferred];
}

function hasHeaders(headers, requiredHeaders) {
  const available = new Set(headers.map(normalizeHeader));
  return requiredHeaders.every((header) => available.has(header));
}

function inputFormatFor(headers, targetByColumn) {
  if (hasHeaders(headers, RAW_ODOO_REQUIRED_HEADERS)) return 'odoo_raw_export';
  if (targetByColumn.includes('Opportunity') && targetByColumn.includes('ID')) return 'minum_model';
  return 'unknown';
}

/**
 * O modelo atual traz as duas colunas "ID" (codigo Minum) e "Odoo Lead ID".
 * Em exportacoes legadas, "Codigo do sistema MINUM" existe e o "ID" puro era
 * o identificador tecnico do Odoo. A leitura e contextual para aceitar ambos.
 */
function targetColumnsFor(headers) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const hasSeparateMinumCode = normalizedHeaders.some((header) => [
    'codigodosistemaminum',
    'minumcode',
  ].includes(header));

  return normalizedHeaders.map((header) => {
    if (header === 'id') return hasSeparateMinumCode ? 'Odoo Lead ID' : 'ID';
    return HEADER_MAP.get(header) || null;
  });
}

function rawOdooValues(headers, row) {
  return Object.fromEntries(headers.map((header, column) => [normalizeHeader(header), cleanCell(row[column])]));
}

/** Converte a linha direta do Odoo para o modelo interno sem perder a origem. */
function createRecordFromRawOdoo(headers, row, rowNumber) {
  const values = rawOdooValues(headers, row);
  const record = createRecord(rowNumber);
  const odooExternalId = identifierAsText(values.id);
  const odooLeadId = extractOdooLeadId(odooExternalId);
  const location = normalizeCityAndState(values.city, values.stateidname);
  const sourceCoordinates = extractCoordinatesFromNotes(values.description);

  record.Opportunity = cleanOdooOpportunity(values.name);
  record['(CPF/CNPJ)'] = identifierAsText(values.cpfcnpjnumber);
  record.ID = odooImportStableId(odooLeadId, odooExternalId);
  record['Odoo Lead ID'] = odooLeadId;
  record['Odoo External ID'] = odooExternalId;
  record['Deal - Address'] = cleanCell(values.street);
  record['Client - Email'] = cleanCell(values.emailfrom);
  record['Client - State'] = location.region;
  record.Cidade = location.place;
  record['Client - Phone'] = identifierAsText(values.phone);
  record['Deal - Segment'] = cleanCell(values.segment);
  record.Responsavel = cleanCell(values.useridname);
  record['Deal - Responsable Salesperson'] = cleanCell(values.useridname);
  record['Deal - Distributor'] = cleanCell(values.distributioncompany);
  record['Deal - Tags'] = uniquePreservingOrder(splitTags(values.tagids)).join(', ');
  record['Deal - Expected Revenue'] = cleanCell(values.expectedrevenue);
  record['Deal - Notes'] = cleanCell(values.description);
  record['Deal - Origem'] = cleanCell(values.sourceid);
  record['Deal - Pipeline Stage'] = cleanCell(values.stageid);
  record['Client - Name'] = cleanCell(values.contactname) || record.Opportunity;
  record.Country = cleanCell(values.countryid) || 'Brasil';

  if (sourceCoordinates) {
    record.latitude = sourceCoordinates.latitude;
    record.longitude = sourceCoordinates.longitude;
    record.__meta.sourceLatitude = sourceCoordinates.latitude;
    record.__meta.sourceLongitude = sourceCoordinates.longitude;
    record.__meta.coordinateSource = 'Descricao da exportacao Odoo';
  }

  record.__meta.inputFormat = 'odoo_raw_export';
  record.__meta.idSource = odooLeadId ? 'odoo_technical_id' : 'odoo_external_id';
  record.__meta.odooLinkStatus = odooLeadId ? 'linked' : 'missing_technical_id';
  record.__meta.originalOdooOpportunity = cleanCell(values.name);
  return record;
}

function readAndConsolidate(buffer, fileName) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellText: true, cellDates: true });
  const sheet = chooseWorksheet(workbook);
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  const headers = matrix[0] || [];
  const targetByColumn = targetColumnsFor(headers);
  const inputFormat = inputFormatFor(headers, targetByColumn);
  const tagColumns = inputFormat === 'odoo_raw_export'
    ? headers.map((header, index) => (normalizeHeader(header) === 'tagids' ? index : -1)).filter((index) => index >= 0)
    : targetByColumn.map((target, index) => (target === 'Deal - Tags' ? index : -1)).filter((index) => index >= 0);

  if (inputFormat === 'unknown') {
    throw new ProcessorError('invalid-argument', 'A planilha não contém as colunas Oportunidade e Código do sistema MINUM/ID esperadas.');
  }

  if (!tagColumns.length) {
    throw new ProcessorError('invalid-argument', 'A coluna Marcadores/Nome do marcador não foi encontrada.');
  }

  const records = [];
  const audit = [];
  let currentRecord = null;
  let extraTagRows = 0;
  let orphanTagRows = 0;
  let populatedRows = 0;

  for (let index = 1; index < matrix.length; index += 1) {
    const row = matrix[index] || [];
    const nonemptyColumns = row
      .map((value, column) => (cleanCell(value) ? column : -1))
      .filter((column) => column >= 0);

    if (!nonemptyColumns.length) continue;
    populatedRows += 1;

    const tagOnlyRow = nonemptyColumns.every((column) => tagColumns.includes(column));
    if (tagOnlyRow) {
      const tags = uniquePreservingOrder(tagColumns.flatMap((column) => splitTags(row[column])));
      if (!currentRecord) {
        orphanTagRows += 1;
        audit.push({
          row: index + 1,
          id: '',
          opportunity: '',
          stage: 'consolidation',
          status: 'INCONSISTENCY',
          source: fileName,
          fields: ['Deal - Tags'],
          details: `Marcador sem oportunidade anterior: ${tags.join(', ') || 'sem valor legível'}.`,
        });
        continue;
      }

      currentRecord['Deal - Tags'] = uniquePreservingOrder([
        ...splitTags(currentRecord['Deal - Tags']),
        ...tags,
      ]).join(', ');
      currentRecord.__meta.sourceRows.push(index + 1);
      extraTagRows += 1;
      continue;
    }

    const record = inputFormat === 'odoo_raw_export'
      ? createRecordFromRawOdoo(headers, row, index + 1)
      : createRecord(index + 1);
    if (inputFormat !== 'odoo_raw_export') {
      targetByColumn.forEach((target, column) => {
        if (!target) return;
        record[target] = cleanCell(row[column]);
      });
    }
    record.Opportunity = cleanCell(record.Opportunity);
    record.ID = identifierAsText(record.ID);
    record['(CPF/CNPJ)'] = identifierAsText(record['(CPF/CNPJ)']);
    record['Client - Phone'] = identifierAsText(record['Client - Phone']);
    record['Deal - Tags'] = uniquePreservingOrder(splitTags(record['Deal - Tags'])).join(', ');
    record.Country = cleanCell(record.Country) || 'Brasil';
    records.push(record);
    currentRecord = record;
  }

  if (!records.length) {
    throw new ProcessorError('invalid-argument', 'Nenhuma oportunidade foi encontrada na planilha enviada.');
  }

  records.forEach((record) => {
    audit.push(createAudit(
      record,
      'consolidation',
      'OK',
      'Marcadores consolidados; somente linhas com marcador isolado foram incorporadas à oportunidade anterior.',
      ['Deal - Tags'],
      fileName,
    ));
  });

  return {
    records,
    audit,
    stats: {
      inputFormat,
      sourceRows: populatedRows,
      extraTagRows,
      orphanTagRows,
      opportunities: records.length,
    },
  };
}

function validateRecords(records, audit) {
  const ids = new Map();
  let blockingIssues = 0;

  records.forEach((record) => {
    if (!cleanCell(record.ID)) {
      blockingIssues += 1;
      audit.push(createAudit(record, 'validation', 'INCONSISTENCY', 'A oportunidade não possui ID. A importação foi bloqueada para não criar um cliente sem chave estável.', ['ID']));
    } else if (ids.has(record.ID)) {
      blockingIssues += 1;
      const previous = ids.get(record.ID);
      audit.push(createAudit(record, 'validation', 'INCONSISTENCY', `ID duplicado na linha da oportunidade ${previous.__meta.sourceRows[0]}. A revisão humana é necessária antes de importar.`, ['ID']));
    } else {
      ids.set(record.ID, record);
    }

    if (!cleanCell(record.Opportunity) && !cleanCell(record['Client - Name'])) {
      blockingIssues += 1;
      audit.push(createAudit(record, 'validation', 'INCONSISTENCY', 'A linha não possui nome de oportunidade nem nome de contato.', ['Opportunity', 'Client - Name']));
    }
  });

  return blockingIssues;
}

function getCustomerReference(customer) {
  return {
    __key: cleanCell(customer.id),
    Opportunity: cleanCell(customer.opportunity || customer.name || customer.clientName),
    '(CPF/CNPJ)': identifierAsText(customer.cpfCnpj || customer.cnpjCpf),
    ID: identifierAsText(customer.minumCode || customer.externalId || customer.id),
    'Odoo Lead ID': identifierAsText(customer.odooLeadId),
    'Odoo External ID': identifierAsText(customer.odooExternalId),
    'Deal - Address': cleanCell(customer.dealAddress || customer.address),
    'Client - Email': cleanCell(customer.email),
    'Client - State': cleanCell(customer.state),
    Cidade: cleanCell(customer.city),
    'Client - Phone': identifierAsText(customer.phone),
    'Deal - Segment': cleanCell(customer.segment),
    Responsavel: cleanCell(customer.responsible || customer.responsavel),
    'Ultima Atualizacao': cleanCell(customer.lastUpdate || customer.ultimaAtualizacao),
    'Deal - Distributor': cleanCell(customer.distributor),
    'Deal - Responsable Salesperson': cleanCell(customer.responsibleSalesperson || customer.responsableSalesperson),
    'Deal - Tags': cleanCell(customer.tags),
    'Deal - Expected Revenue': cleanCell(customer.expectedRevenue),
    'Deal - Notes': cleanCell(customer.notes),
    'Deal - Origem': cleanCell(customer.origin || customer.origem),
    'Deal - Pipeline Stage': cleanCell(customer.pipelineStage || customer.status),
    'Client - Name': cleanCell(customer.clientName || customer.name),
    latitude: isValidCoordinates(customer.latitude, customer.longitude) ? Number(customer.latitude) : '',
    longitude: isValidCoordinates(customer.latitude, customer.longitude) ? Number(customer.longitude) : '',
    Country: cleanCell(customer.country) || 'Brasil',
    __coordinateReviewLocked: isCoordinateReviewLocked(
      customer,
      customer.canonicalKey || canonicalAddressKeyForCustomer(customer),
    ),
    __coordinateReviewSnapshot: coordinateReviewSnapshot(customer),
  };
}

function buildReferenceIndex(customers) {
  const byId = new Map();
  const byDocument = new Map();
  const byOdooLeadId = new Map();
  const byOdooExternalId = new Map();

  Object.entries(customers || {}).forEach(([key, customer]) => {
    const reference = getCustomerReference({ id: key, ...customer });
    if (reference.ID) byId.set(reference.ID, reference);
    const document = onlyDigits(reference['(CPF/CNPJ)']);
    if (document) byDocument.set(document, reference);
    if (reference['Odoo Lead ID']) byOdooLeadId.set(reference['Odoo Lead ID'], reference);
    if (reference['Odoo External ID']) byOdooExternalId.set(reference['Odoo External ID'], reference);
  });

  return { byId, byDocument, byOdooLeadId, byOdooExternalId };
}

function applyMissingValues(record, values, allowedFields = TARGET_HEADERS) {
  const filled = [];
  allowedFields.forEach((field) => {
    const value = values[field];
    if (field === 'latitude' || field === 'longitude') {
      return;
    }
    if (!cleanCell(record[field]) && cleanCell(value)) {
      record[field] = cleanCell(value);
      filled.push(field);
    }
  });
  return filled;
}

function applyReference(record, references, audit) {
  const document = onlyDigits(record['(CPF/CNPJ)']);
  const odooLeadId = identifierAsText(record['Odoo Lead ID']);
  const odooExternalId = identifierAsText(record['Odoo External ID']);
  const reference = (odooLeadId ? references.byOdooLeadId.get(odooLeadId) : null)
    || (odooExternalId ? references.byOdooExternalId.get(odooExternalId) : null)
    || references.byId.get(record.ID)
    || (document ? references.byDocument.get(document) : null);
  if (!reference) return;

  // A referencia e usada apenas no commit para atualizar o mesmo cliente em
  // vez de duplicar uma oportunidade que ja possui uma chave legada Minum.
  record.__meta.matchedCustomerKey = reference.__key || null;

  // Uma revisao humana nao pode ser apagada por uma nova exportacao do Odoo.
  // O endereco sera comparado na etapa de geocodificacao; se mudou, a
  // coordenada volta naturalmente para a fila de revisao.
  if (reference.__coordinateReviewLocked && reference.__coordinateReviewSnapshot) {
    record.__meta.existingCoordinateReview = reference.__coordinateReviewSnapshot;
  }

  const filled = applyMissingValues(record, reference);
  if (!isValidCoordinates(record.latitude, record.longitude) && isValidCoordinates(reference.latitude, reference.longitude)) {
    record.latitude = Number(reference.latitude);
    record.longitude = Number(reference.longitude);

    if (record.__meta.existingCoordinateReview) {
      const reviewed = record.__meta.existingCoordinateReview;
      record.__meta.coordinateStatus = reviewed.coordinateStatus;
      record.__meta.coordinatePrecisionLevel = reviewed.coordinatePrecisionLevel;
      record.__meta.coordinateSource = reviewed.coordinateSource;
      record.__meta.geocodingReview = reviewed.geocodingReview || null;
    } else {
      // Coordenadas antigas do Firebase nao se tornam confirmed automaticamente.
      record.__meta.coordinateStatus = 'legacy_unverified';
      record.__meta.coordinatePrecisionLevel = 'legacy_unverified';
      record.__meta.coordinateSource = 'Firebase customers';
    }
    filled.push('latitude', 'longitude');
  }

  if (filled.length) {
    appendSource(record, 'Firebase customers');
    updateResearchStatus(record, 'confirmed');
    audit.push(createAudit(record, 'reference', 'FILLED', 'Campos vazios reaproveitados de um cliente já existente no Firebase com o mesmo ID, lead Odoo, ID externo ou CPF/CNPJ.', filled, 'Firebase customers'));
  }
}

function isValidCnpj(value) {
  const digits = onlyDigits(value);
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const calculateDigit = (base, weights) => {
    const sum = base.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const result = sum % 11;
    return result < 2 ? 0 : 11 - result;
  };
  const first = calculateDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculateDigit(digits.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.endsWith(`${first}${second}`);
}

function extractCnpj(record) {
  const direct = onlyDigits(record['(CPF/CNPJ)']);
  if (isValidCnpj(direct)) return direct;

  const haystack = [record['Deal - Tags'], record['Deal - Notes'], record.Opportunity].join(' ');
  const candidates = haystack.match(/(?:cnpj\D*)?\d[\d.\-/]{11,20}/gi) || [];
  return candidates
    .map((candidate) => onlyDigits(candidate))
    .find((candidate) => isValidCnpj(candidate)) || '';
}

function brasilApiValues(data, cnpj) {
  const address = [data.logradouro, data.numero, data.complemento, data.bairro]
    .map(cleanCell)
    .filter(Boolean)
    .join(', ');
  return {
    '(CPF/CNPJ)': identifierAsText(cnpj),
    Opportunity: cleanCell(data.razao_social || data.nome_fantasia),
    'Client - Name': cleanCell(data.nome_fantasia || data.razao_social),
    'Deal - Address': address,
    'Client - Email': cleanCell(data.email),
    'Client - State': cleanCell(data.uf).toUpperCase(),
    Cidade: cleanCell(data.municipio),
    'Client - Phone': identifierAsText(data.ddd_telefone_1 || data.ddd_telefone_2),
    Country: 'Brasil',
  };
}

function hasMissingResearchFields(record) {
  return [
    '(CPF/CNPJ)',
    'Opportunity',
    'Client - Name',
    'Deal - Address',
    'Client - Email',
    'Client - State',
    'Cidade',
    'Client - Phone',
  ].some((field) => !cleanCell(record[field]));
}

async function enrichByCnpj(record, lookupCnpj, audit, enabled) {
  if (!enabled || !hasMissingResearchFields(record)) return;
  const cnpj = extractCnpj(record);
  if (!cnpj) return;

  try {
    const result = await lookupCnpj(cnpj);
    if (!result?.data) {
      updateResearchStatus(record, 'not_found');
      audit.push(createAudit(record, 'cnpj_lookup', 'NOT_FOUND', `Nenhum cadastro confirmado foi retornado para o CNPJ ${cnpj}.`, [], result?.source || 'BrasilAPI'));
      return;
    }

    const filled = applyMissingValues(record, brasilApiValues(result.data, cnpj));
    if (filled.length) {
      appendSource(record, result.source || 'BrasilAPI');
      updateResearchStatus(record, 'confirmed');
      audit.push(createAudit(record, 'cnpj_lookup', 'FILLED', `Campos vazios confirmados pelo CNPJ ${cnpj}.`, filled, result.source || 'BrasilAPI'));
    } else {
      audit.push(createAudit(record, 'cnpj_lookup', 'OK', `O CNPJ ${cnpj} foi confirmado, mas não havia campos vazios elegíveis para completar.`, [], result.source || 'BrasilAPI'));
    }
  } catch (error) {
    audit.push(createAudit(record, 'cnpj_lookup', 'ERROR', cleanCell(error.message) || 'Falha ao consultar o CNPJ.', [], 'BrasilAPI'));
  }
}

async function enrichCoordinates(record, geocodeClient, audit, enabled) {
  const parsedAddress = parseBrazilianAddress(
    record['Deal - Address'],
    record.Cidade,
    record['Client - State'],
    record.Country || 'Brasil'
  );

  const key = canonicalKey(
    parsedAddress.street,
    parsedAddress.houseNumber,
    parsedAddress.place,
    parsedAddress.region,
    parsedAddress.postcode,
    parsedAddress.country,
    parsedAddress.neighborhood
  );

  record.__meta.canonicalKey = key;
  record.__meta.parsedAddress = parsedAddress;

  const existingReview = record.__meta.existingCoordinateReview;
  if (existingReview && (!existingReview.canonicalKey || existingReview.canonicalKey === key)) {
    // A mesma oportunidade e o mesmo endereco ja foram aprovados. Reutilizar
    // a coordenada evita nova consulta paga e conserva a decisao administrativa.
    record.latitude = existingReview.latitude;
    record.longitude = existingReview.longitude;
    record.__meta.navigationLatitude = existingReview.navigationLatitude;
    record.__meta.navigationLongitude = existingReview.navigationLongitude;
    record.__meta.entranceLatitude = existingReview.entranceLatitude;
    record.__meta.entranceLongitude = existingReview.entranceLongitude;
    record.__meta.geocodedLatitude = existingReview.geocodedLatitude;
    record.__meta.geocodedLongitude = existingReview.geocodedLongitude;
    record.__meta.coordinateStatus = existingReview.coordinateStatus;
    record.__meta.coordinatePrecisionLevel = existingReview.coordinatePrecisionLevel;
    record.__meta.coordinateSource = existingReview.coordinateSource;
    record.__meta.geocodingReview = existingReview.geocodingReview || null;
    record.__meta.geocoding = {
      ...(existingReview.geocoding || {}),
      status: existingReview.coordinateStatus,
      reason: 'Coordenada previamente aprovada para este mesmo endereco; consulta Mapbox nao repetida.',
      preservedAtImport: true,
    };
    appendSource(record, 'Firebase customers (coordenada aprovada)');
    updateResearchStatus(record, 'confirmed');
    audit.push(createAudit(
      record,
      'coordinate_reuse',
      'OK',
      'Coordenada previamente aprovada foi preservada para o mesmo endereco; nenhuma nova consulta Mapbox foi feita.',
      ['latitude', 'longitude'],
      'Firebase customers',
    ));
    return;
  }

  // Se já possui coordenadas na planilha (Odoo), inicializa como legacy_unverified se ainda não revalidado
  if (isValidCoordinates(record.latitude, record.longitude)) {
    if (record.__meta.coordinateStatus === 'missing') {
      record.__meta.coordinateStatus = 'legacy_unverified';
      record.__meta.coordinatePrecisionLevel = 'legacy_unverified';
      record.__meta.coordinateSource = record.__meta.coordinateSource || 'Planilha Odoo';
      record.__meta.sourceLatitude = Number(record.latitude);
      record.__meta.sourceLongitude = Number(record.longitude);
    }
  }

  if (!enabled || !geocodeClient) {
    if (!isValidCoordinates(record.latitude, record.longitude)) {
      record.__meta.coordinateStatus = 'pending_configuration';
    }
    return;
  }

  if (!parsedAddress.street && !parsedAddress.place) {
    record.__meta.coordinateStatus = 'missing_address';
    updateResearchStatus(record, 'not_found');
    audit.push(createAudit(record, 'geocoding', 'MISSING_ADDRESS', 'Não há endereço suficiente para geocodificar.', ['latitude', 'longitude'], ''));
    return;
  }

  try {
    let result = null;
    if (typeof geocodeClient.forwardGeocode === 'function') {
      result = await geocodeClient.forwardGeocode(parsedAddress);
    } else if (typeof geocodeClient === 'function') {
      // Suporte para função legada lookupGeocode(query, context)
      const legacyRes = await geocodeClient(parsedAddress.normalizedSearchAddress, {
        state: parsedAddress.region,
        city: parsedAddress.place,
      });
      if (legacyRes) {
        result = {
          latitude: legacyRes.latitude,
          longitude: legacyRes.longitude,
          navigationLatitude: legacyRes.latitude,
          navigationLongitude: legacyRes.longitude,
          accuracy: legacyRes.accuracy || 'rooftop',
          confidence: legacyRes.confidence || 'exact',
          matchCode: { address_number: 'matched' },
          label: legacyRes.label || parsedAddress.normalizedSearchAddress,
          rawFeature: {
            properties: {
              feature_type: 'address',
              match_code: { address_number: 'matched', confidence: legacyRes.confidence || 'exact' },
              coordinates: { accuracy: legacyRes.accuracy || 'rooftop' },
              context: { region: { short_code: `BR-${legacyRes.state || parsedAddress.region}` } },
            },
          },
        };
      }
    }

    if (!result) {
      record.__meta.coordinateStatus = 'not_found';
      updateResearchStatus(record, 'not_found');
      audit.push(createAudit(record, 'geocoding', 'NOT_FOUND', 'Nenhuma coordenada foi encontrada para o endereço.', ['latitude', 'longitude'], 'Mapbox Geocoding v6'));
      return;
    }

    const validation = validateMapboxResponse(result.rawFeature, parsedAddress);
    let reverseMatch = { checked: false, matches: null, reason: 'Reverse geocoding indisponivel.' };
    if (typeof geocodeClient.reverseGeocode === 'function') {
      try {
        const reverse = await geocodeClient.reverseGeocode(result.latitude, result.longitude);
        reverseMatch = compareReverseAddress(parsedAddress, reverse);
      } catch (error) {
        // A ausencia do reverse impede confirmacao automatica, mas preserva a proposta para revisao.
      }
    }

    // Salvar valores propostos
    record.__meta.geocodedLatitude = result.latitude;
    record.__meta.geocodedLongitude = result.longitude;
    record.__meta.navigationLatitude = result.navigationLatitude;
    record.__meta.navigationLongitude = result.navigationLongitude;
    record.__meta.entranceLatitude = result.entranceLatitude;
    record.__meta.entranceLongitude = result.entranceLongitude;
    record.__meta.coordinatePrecisionLevel = result.accuracy || 'unknown';
    record.__meta.providerReturnedAddress = result.label;
    record.__meta.geocoding = {
      provider: 'mapbox_geocoding_v6',
      algorithmVersion: GEOCODING_ALGORITHM_VERSION,
      geocodedAt: Date.now(),
      originalAddress: parsedAddress.originalAddress,
      normalizedAddress: parsedAddress.normalizedSearchAddress,
      parsedAddress,
      query: {
        street: parsedAddress.street || null,
        houseNumber: parsedAddress.houseNumber || null,
        neighborhood: parsedAddress.neighborhood || null,
        place: parsedAddress.place || null,
        region: parsedAddress.region || null,
        postcode: parsedAddress.postcode || null,
        country: parsedAddress.countryCode || 'BR',
      },
      providerAddress: result.label || '',
      featureType: result.featureType || 'unknown',
      accuracy: result.accuracy || 'unknown',
      confidence: result.confidence || 'unknown',
      matchCode: result.matchCode || null,
      geocodedCoordinate: { latitude: result.latitude, longitude: result.longitude },
      navigationCoordinate: { latitude: result.navigationLatitude, longitude: result.navigationLongitude },
      entranceCoordinate: result.entranceLatitude !== null && result.entranceLongitude !== null
        ? { latitude: result.entranceLatitude, longitude: result.entranceLongitude }
        : null,
      reverseMatch,
    };

    // Calcular diferença Haversine em relação à coordenada antiga se houver
    if (isValidCoordinates(record.latitude, record.longitude)) {
      const distanceMeters = calculateHaversineDistanceMeters(
        Number(record.latitude),
        Number(record.longitude),
        result.latitude,
        result.longitude
      );
      record.__meta.previousLatitude = Number(record.latitude);
      record.__meta.previousLongitude = Number(record.longitude);
      record.__meta.distanceFromPreviousMeters = distanceMeters;
      record.__meta.distanceClassification = classifyDistance(distanceMeters);
      record.__meta.geocoding.previousCoordinate = {
        latitude: Number(record.latitude),
        longitude: Number(record.longitude),
      };
      record.__meta.geocoding.distanceFromPreviousMeters = distanceMeters;
    }

    if (validation.accepted && reverseMatch.matches === true) {
      record.latitude = result.latitude;
      record.longitude = result.longitude;
      record.__meta.coordinateStatus = 'confirmed';
      record.__meta.coordinateSource = 'Mapbox Geocoding v6';
      record.__meta.geocoding.status = 'confirmed';
      record.__meta.geocoding.reason = validation.reason;
      appendSource(record, 'Mapbox Geocoding v6');
      updateResearchStatus(record, 'confirmed');
      audit.push(createAudit(record, 'geocoding', 'FILLED', `Coordenadas confirmadas para ${result.label}.`, ['latitude', 'longitude'], 'Mapbox Geocoding v6'));
    } else {
      record.__meta.coordinateStatus = reverseMatch.checked && reverseMatch.matches === false
        ? 'reverse_mismatch'
        : validation.status === 'confirmed'
          ? 'needs_review'
          : validation.status;
      record.__meta.geocoding.status = record.__meta.coordinateStatus;
      record.__meta.geocoding.reason = reverseMatch.checked && reverseMatch.matches === false
        ? reverseMatch.reason
        : validation.accepted
          ? 'Reverse geocoding nao confirmou o endereco; requer revisao humana.'
          : validation.reason;
      updateResearchStatus(record, 'needs_review');
      audit.push(createAudit(record, 'geocoding', 'REJECTED', record.__meta.geocoding.reason, ['latitude', 'longitude'], 'Mapbox Geocoding v6'));
    }
  } catch (error) {
    record.__meta.coordinateStatus = 'error';
    audit.push(createAudit(record, 'geocoding', 'ERROR', cleanCell(error.message) || 'Falha ao consultar o geocodificador.', ['latitude', 'longitude'], 'Mapbox Geocoding v6'));
  }
}

function auditSummary(audit) {
  const count = (statuses) => audit.filter((entry) => statuses.includes(entry.status)).length;
  return {
    found: audit.filter((entry) => entry.status === 'FILLED'
      || (entry.stage === 'cnpj_lookup' && entry.status === 'OK')).length,
    notFound: count(['NOT_FOUND', 'MISSING_ADDRESS', 'PENDING_CONFIGURATION']),
    inconsistencies: count(['INCONSISTENCY', 'REJECTED', 'ERROR']),
  };
}

async function processOdooWorkbook(buffer, {
  fileName = 'exportacao-odoo.xlsx',
  customers = {},
  lookupCnpj = null,
  mapboxGeocoderClient = null,
  lookupGeocode = null,
  enableResearch = true,
  enableGeocoding = true,
} = {}) {
  const { records, audit, stats } = readAndConsolidate(buffer, fileName);
  const references = buildReferenceIndex(customers);
  const blockingIssues = validateRecords(records, audit) + stats.orphanTagRows;

  const geocoder = mapboxGeocoderClient || lookupGeocode;

  for (const record of records) {
    applyReference(record, references, audit);
    await enrichByCnpj(record, lookupCnpj, audit, enableResearch && Boolean(lookupCnpj));
    await enrichCoordinates(record, geocoder, audit, enableGeocoding);
  }

  const summary = {
    ...stats,
    blockingIssues,
    odooLeadsLinked: records.filter((record) => Boolean(odooLeadIdOrNull(record['Odoo Lead ID']))).length,
    odooLeadsMissing: records.filter((record) => !odooLeadIdOrNull(record['Odoo Lead ID'])).length,
    coordinatesConfirmed: records.filter((record) => record.__meta?.coordinateStatus === 'confirmed').length,
    coordinatesMissing: records.filter((record) => !isValidCoordinates(record.latitude, record.longitude)).length,
    ...auditSummary(audit),
  };

  return { records, audit, summary };
}

function toFirebaseKey(value) {
  const rawKey = String(value || '').trim();
  if (!rawKey) return `cliente_${Date.now()}`;

  return rawKey
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((char) => (char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127 || ['.', '#', '$', '/', '[', ']'].includes(char) ? '_' : char))
    .join('')
    .replace(/\s+/g, '_')
    .slice(0, 180);
}

function buildFirebaseCustomer(record, { jobId, importedBy, importedAt, minumCodeOverride = null }) {
  const hasCoordinates = isValidCoordinates(record.latitude, record.longitude);
  const meta = record.__meta || {};
  const minumCode = identifierAsText(minumCodeOverride || record.ID);
  const odooLeadId = odooLeadIdOrNull(record['Odoo Lead ID']);
  const odooExternalId = identifierAsText(record['Odoo External ID']);
  const location = normalizeCityAndState(record.Cidade, record['Client - State']);
  // Odoo separa claramente a oportunidade do contato. A oportunidade deve
  // ser o titulo apresentado no app e no backoffice; o contato permanece em
  // clientName para telefone, abordagem e historico comercial.
  const opportunity = cleanCell(record.Opportunity);
  const clientName = cleanCell(record['Client - Name']);

  return {
    opportunity,
    cpfCnpj: identifierAsText(record['(CPF/CNPJ)']),
    cnpjCpf: identifierAsText(record['(CPF/CNPJ)']),
    // externalId permanece como alias legado do codigo Minum. Isso preserva
    // chaves de customers, rotas e dados historicos ja publicados.
    externalId: minumCode,
    minumCode,
    odooLeadId,
    odooExternalId,
    dealAddress: cleanCell(record['Deal - Address']),
    address: cleanCell(record['Deal - Address']),
    email: cleanCell(record['Client - Email']),
    state: location.region || cleanCell(record['Client - State']).toUpperCase(),
    city: location.place || cleanCell(record.Cidade),
    phone: identifierAsText(record['Client - Phone']),
    segment: cleanCell(record['Deal - Segment']),
    responsible: cleanCell(record.Responsavel),
    responsavel: cleanCell(record.Responsavel),
    lastUpdate: cleanCell(record['Ultima Atualizacao']),
    ultimaAtualizacao: cleanCell(record['Ultima Atualizacao']),
    distributor: cleanCell(record['Deal - Distributor']),
    responsibleSalesperson: cleanCell(record['Deal - Responsable Salesperson']),
    responsableSalesperson: cleanCell(record['Deal - Responsable Salesperson']),
    tags: cleanCell(record['Deal - Tags']),
    expectedRevenue: cleanCell(record['Deal - Expected Revenue']),
    expectedRevenueValue: expectedRevenueNumberOrNull(record['Deal - Expected Revenue']),
    notes: cleanCell(record['Deal - Notes']),
    origin: cleanCell(record['Deal - Origem']),
    origem: cleanCell(record['Deal - Origem']),
    pipelineStage: cleanCell(record['Deal - Pipeline Stage']),
    status: cleanCell(record['Deal - Pipeline Stage']),
    name: opportunity || clientName || minumCode,
    clientName,

    // Coordenadas Geográficas Principais
    latitude: hasCoordinates ? Number(record.latitude) : 0,
    longitude: hasCoordinates ? Number(record.longitude) : 0,

    // Ponto de Navegação Veicular (Routable Point)
    navigationLatitude: meta.navigationLatitude ?? (hasCoordinates ? Number(record.latitude) : 0),
    navigationLongitude: meta.navigationLongitude ?? (hasCoordinates ? Number(record.longitude) : 0),
    entranceLatitude: meta.entranceLatitude ?? null,
    entranceLongitude: meta.entranceLongitude ?? null,

    // Proveniência e Detalhes
    sourceLatitude: meta.sourceLatitude ?? null,
    sourceLongitude: meta.sourceLongitude ?? null,
    geocodedLatitude: meta.geocodedLatitude ?? null,
    geocodedLongitude: meta.geocodedLongitude ?? null,
    previousLatitude: meta.previousLatitude ?? null,
    previousLongitude: meta.previousLongitude ?? null,
    distanceFromPreviousMeters: meta.distanceFromPreviousMeters ?? null,
    coordinatePrecisionLevel: meta.coordinatePrecisionLevel || 'unknown',
    coordinateStatus: meta.coordinateStatus || 'missing',
    coordinateSource: meta.coordinateSource || null,
    canonicalKey: meta.canonicalKey || null,
    normalizedAddress: meta.parsedAddress?.normalizedSearchAddress || null,
    originalAddress: meta.parsedAddress?.originalAddress || cleanCell(record['Deal - Address']),
    parsedAddress: meta.parsedAddress || null,
    geocoding: meta.geocoding || {
      provider: meta.coordinateSource || 'legacy',
      algorithmVersion: GEOCODING_ALGORITHM_VERSION,
      status: meta.coordinateStatus || (hasCoordinates ? 'legacy_unverified' : 'missing_coordinate'),
      originalAddress: cleanCell(record['Deal - Address']),
      normalizedAddress: meta.parsedAddress?.normalizedSearchAddress || null,
      sourceCoordinate: hasCoordinates ? { latitude: Number(record.latitude), longitude: Number(record.longitude) } : null,
      geocodedCoordinate: null,
      navigationCoordinate: hasCoordinates ? { latitude: Number(record.latitude), longitude: Number(record.longitude) } : null,
    },
    geocodingReview: meta.geocodingReview || null,

    country: cleanCell(record.Country) || 'Brasil',
    active: true,
    // "(CPF/CNPJ)" e alguns cabecalhos externos contem caracteres que o
    // Realtime Database nao aceita como chave. O valor continua preservado,
    // apenas a representacao interna e codificada para armazenamento seguro.
    raw: toFirebaseSafeValue(Object.fromEntries(TARGET_HEADERS.map((header) => [header, record[header] ?? '']))),
    importMetadata: {
      source: 'odoo_raw_export',
      jobId,
      importedBy,
      importedAt,
      inputFormat: meta.inputFormat || 'minum_model',
      odooLinkStatus: meta.odooLinkStatus || (odooLeadId ? 'linked' : 'missing_technical_id'),
      idSource: meta.idSource || 'minum_code',
      researchStatus: meta.researchStatus || 'not_checked',
      researchSources: meta.researchSources || [],
      coordinateStatus: meta.coordinateStatus || 'missing',
      coordinateSource: meta.coordinateSource || null,
      coordinatePrecisionLevel: meta.coordinatePrecisionLevel || 'unknown',
      sourceRows: meta.sourceRows || [],
    },
  };
}

function mergeCustomer(existing, incoming) {
  const merged = { ...(existing || {}) };
  const preserveReviewedCoordinate = preserveCoordinateReview(existing, incoming);
  Object.entries(incoming).forEach(([key, value]) => {
    if (key === 'raw' || key === 'importMetadata') return;
    const incomingHasCoordinate = (key === 'latitude' || key === 'longitude') && Number(value) !== 0;
    const hasValue = incomingHasCoordinate || (key !== 'latitude' && key !== 'longitude' && value !== '' && value !== null && value !== undefined);
    if (hasValue || !(key in merged)) merged[key] = value;
  });
  merged.raw = { ...(existing?.raw || {}), ...(incoming.raw || {}) };
  merged.importMetadata = incoming.importMetadata;

  if (preserveReviewedCoordinate) {
    PRESERVED_COORDINATE_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(existing || {}, field)) {
        merged[field] = existing[field];
      }
    });
    merged.importMetadata = {
      ...(incoming.importMetadata || {}),
      coordinateStatus: existing.coordinateStatus || incoming.importMetadata?.coordinateStatus || 'confirmed',
      coordinateSource: existing.coordinateSource || incoming.importMetadata?.coordinateSource || null,
      coordinatePrecisionLevel: existing.coordinatePrecisionLevel || incoming.importMetadata?.coordinatePrecisionLevel || 'unknown',
      coordinateReviewPreserved: true,
    };
  }
  return merged;
}

function toExportRows(records) {
  return records.map((record) => Object.fromEntries(TARGET_HEADERS.map((header) => [header, record[header] ?? ''])));
}

module.exports = {
  TARGET_HEADERS,
  ProcessorError,
  buildFirebaseCustomer,
  expectedRevenueNumberOrNull,
  isValidCoordinates,
  mergeCustomer,
  processOdooWorkbook,
  toExportRows,
  toFirebaseKey,
};
