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
  validateMapboxResponse,
} = require('./mapboxGeocoder');

const TARGET_HEADERS = Object.freeze([
  'Opportunity',
  '(CPF/CNPJ)',
  'ID',
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
  ['Codigo do sistema MINUM', 'ID'],
  ['Código do sistema MINUM', 'ID'],
  ['ID', 'ID'],
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

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = String(value).trim().replace(/\s/g, '');
  const parsed = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
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

function readAndConsolidate(buffer, fileName) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellText: true, cellDates: true });
  const sheet = chooseWorksheet(workbook);
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  const headers = matrix[0] || [];
  const targetByColumn = headers.map((header) => HEADER_MAP.get(normalizeHeader(header)) || null);
  const tagColumns = targetByColumn
    .map((target, index) => (target === 'Deal - Tags' ? index : -1))
    .filter((index) => index >= 0);

  if (!targetByColumn.includes('Opportunity') || !targetByColumn.includes('ID')) {
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

    const record = createRecord(index + 1);
    targetByColumn.forEach((target, column) => {
      if (!target) return;
      record[target] = cleanCell(row[column]);
    });
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
    Opportunity: cleanCell(customer.opportunity || customer.name || customer.clientName),
    '(CPF/CNPJ)': identifierAsText(customer.cpfCnpj || customer.cnpjCpf),
    ID: identifierAsText(customer.externalId || customer.id),
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
  };
}

function buildReferenceIndex(customers) {
  const byId = new Map();
  const byDocument = new Map();

  Object.entries(customers || {}).forEach(([key, customer]) => {
    const reference = getCustomerReference({ id: key, ...customer });
    if (reference.ID) byId.set(reference.ID, reference);
    const document = onlyDigits(reference['(CPF/CNPJ)']);
    if (document) byDocument.set(document, reference);
  });

  return { byId, byDocument };
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
  const reference = references.byId.get(record.ID) || (document ? references.byDocument.get(document) : null);
  if (!reference) return;

  const filled = applyMissingValues(record, reference);
  if (!isValidCoordinates(record.latitude, record.longitude) && isValidCoordinates(reference.latitude, reference.longitude)) {
    record.latitude = Number(reference.latitude);
    record.longitude = Number(reference.longitude);

    // Seção 3.4 do prompt: Coordenadas antigas do Firebase não se transformam automaticamente em confirmed
    record.__meta.coordinateStatus = 'legacy_unverified';
    record.__meta.coordinatePrecisionLevel = 'legacy_unverified';
    record.__meta.coordinateSource = 'Firebase customers';
    filled.push('latitude', 'longitude');
  }

  if (filled.length) {
    appendSource(record, 'Firebase customers');
    updateResearchStatus(record, 'confirmed');
    audit.push(createAudit(record, 'reference', 'FILLED', 'Campos vazios reaproveitados de um cliente já existente no Firebase com o mesmo ID ou CPF/CNPJ.', filled, 'Firebase customers'));
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
    parsedAddress.country
  );

  record.__meta.canonicalKey = key;
  record.__meta.parsedAddress = parsedAddress;

  // Se já possui coordenadas na planilha (Odoo), inicializa como legacy_unverified se ainda não revalidado
  if (isValidCoordinates(record.latitude, record.longitude)) {
    if (record.__meta.coordinateStatus === 'missing') {
      record.__meta.coordinateStatus = 'legacy_unverified';
      record.__meta.coordinatePrecisionLevel = 'legacy_unverified';
      record.__meta.coordinateSource = 'Planilha Odoo';
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

    // Salvar valores propostos
    record.__meta.geocodedLatitude = result.latitude;
    record.__meta.geocodedLongitude = result.longitude;
    record.__meta.navigationLatitude = result.navigationLatitude;
    record.__meta.navigationLongitude = result.navigationLongitude;
    record.__meta.coordinatePrecisionLevel = result.accuracy || 'unknown';
    record.__meta.providerReturnedAddress = result.label;

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
    }

    if (validation.accepted) {
      record.latitude = result.latitude;
      record.longitude = result.longitude;
      record.__meta.coordinateStatus = 'confirmed';
      record.__meta.coordinateSource = 'Mapbox Geocoding v6';
      appendSource(record, 'Mapbox Geocoding v6');
      updateResearchStatus(record, 'confirmed');
      audit.push(createAudit(record, 'geocoding', 'FILLED', `Coordenadas confirmadas para ${result.label}.`, ['latitude', 'longitude'], 'Mapbox Geocoding v6'));
    } else {
      record.__meta.coordinateStatus = validation.status;
      updateResearchStatus(record, 'needs_review');
      audit.push(createAudit(record, 'geocoding', 'REJECTED', validation.reason, ['latitude', 'longitude'], 'Mapbox Geocoding v6'));
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

function buildFirebaseCustomer(record, { jobId, importedBy, importedAt }) {
  const hasCoordinates = isValidCoordinates(record.latitude, record.longitude);
  const meta = record.__meta || {};

  return {
    opportunity: cleanCell(record.Opportunity),
    cpfCnpj: identifierAsText(record['(CPF/CNPJ)']),
    cnpjCpf: identifierAsText(record['(CPF/CNPJ)']),
    externalId: identifierAsText(record.ID),
    dealAddress: cleanCell(record['Deal - Address']),
    address: cleanCell(record['Deal - Address']),
    email: cleanCell(record['Client - Email']),
    state: cleanCell(record['Client - State']).toUpperCase(),
    city: cleanCell(record.Cidade),
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
    expectedRevenueValue: numberOrNull(record['Deal - Expected Revenue']),
    notes: cleanCell(record['Deal - Notes']),
    origin: cleanCell(record['Deal - Origem']),
    origem: cleanCell(record['Deal - Origem']),
    pipelineStage: cleanCell(record['Deal - Pipeline Stage']),
    status: cleanCell(record['Deal - Pipeline Stage']),
    name: cleanCell(record['Client - Name']) || cleanCell(record.Opportunity) || identifierAsText(record.ID),
    clientName: cleanCell(record['Client - Name']),

    // Coordenadas Geográficas Principais
    latitude: hasCoordinates ? Number(record.latitude) : 0,
    longitude: hasCoordinates ? Number(record.longitude) : 0,

    // Ponto de Navegação Veicular (Routable Point)
    navigationLatitude: meta.navigationLatitude ?? (hasCoordinates ? Number(record.latitude) : 0),
    navigationLongitude: meta.navigationLongitude ?? (hasCoordinates ? Number(record.longitude) : 0),

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

    country: cleanCell(record.Country) || 'Brasil',
    active: true,
    raw: Object.fromEntries(TARGET_HEADERS.map((header) => [header, record[header] ?? ''])),
    importMetadata: {
      source: 'odoo_raw_export',
      jobId,
      importedBy,
      importedAt,
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
  Object.entries(incoming).forEach(([key, value]) => {
    if (key === 'raw' || key === 'importMetadata') return;
    const incomingHasCoordinate = (key === 'latitude' || key === 'longitude') && Number(value) !== 0;
    const hasValue = incomingHasCoordinate || (key !== 'latitude' && key !== 'longitude' && value !== '' && value !== null && value !== undefined);
    if (hasValue || !(key in merged)) merged[key] = value;
  });
  merged.raw = { ...(existing?.raw || {}), ...(incoming.raw || {}) };
  merged.importMetadata = incoming.importMetadata;
  return merged;
}

function toExportRows(records) {
  return records.map((record) => Object.fromEntries(TARGET_HEADERS.map((header) => [header, record[header] ?? ''])));
}

module.exports = {
  TARGET_HEADERS,
  ProcessorError,
  buildFirebaseCustomer,
  isValidCoordinates,
  mergeCustomer,
  processOdooWorkbook,
  toExportRows,
  toFirebaseKey,
};
