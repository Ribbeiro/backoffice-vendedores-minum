const crypto = require('crypto');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const {
  ProcessorError,
  buildFirebaseCustomer,
  mergeCustomer,
  processOdooWorkbook,
  toFirebaseKey,
} = require('./src/odooLeadProcessor');

if (!getApps().length) initializeApp();

const database = getDatabase();
const REGION = 'southamerica-east1';
const MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const CNPJ_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAPBOX_ACCESS_TOKEN = defineSecret('MAPBOX_ACCESS_TOKEN');
const MAPBOX_GEOCODING_PERMANENT = defineString('MAPBOX_GEOCODING_PERMANENT', { default: 'false' });

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

async function requireActiveAdmin(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Entre novamente para processar a importação.');
  }

  const snapshot = await database.ref(`users/${request.auth.uid}`).get();
  const profile = snapshot.val();
  const allowed = normalizeRole(profile?.role) === 'admin'
    && profile?.active === true
    && profile?.allowedAccess === true
    && profile?.deleted !== true;

  if (!allowed) {
    throw new HttpsError('permission-denied', 'Sua conta não possui permissão administrativa para importar dados.');
  }

  return profile;
}

function asFileBuffer(data) {
  const fileName = String(data?.fileName || '').trim();
  const base64 = String(data?.fileBase64 || '').trim();
  if (!fileName || !/\.(xlsx|xls)$/i.test(fileName)) {
    throw new HttpsError('invalid-argument', 'Envie uma planilha .xlsx ou .xls do Odoo.');
  }
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new HttpsError('invalid-argument', 'O arquivo enviado está incompleto ou inválido.');
  }

  const file = Buffer.from(base64, 'base64');
  if (!file.length || file.length > MAX_FILE_SIZE_BYTES) {
    throw new HttpsError('invalid-argument', 'A planilha deve ter até 6 MB para o processamento online.');
  }

  return { fileName, file };
}

async function fetchJson(url, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Consulta externa respondeu HTTP ${response.status}.`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getCachedValue(path, ttlMs) {
  const snapshot = await database.ref(path).get();
  const cached = snapshot.val();
  if (!cached?.fetchedAt || !Object.prototype.hasOwnProperty.call(cached, 'value')) return null;
  if (Date.now() - Number(cached.fetchedAt) > ttlMs) return null;
  return cached.value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function cleanupExpiredJobs() {
  const snapshot = await database.ref('leadImportJobs')
    .orderByChild('expiresAt')
    .endAt(Date.now())
    .get();
  const updates = {};
  snapshot.forEach((child) => {
    updates[child.key] = null;
  });
  if (Object.keys(updates).length) {
    await database.ref('leadImportJobs').update(updates);
  }
  return Object.keys(updates).length;
}

function createCnpjLookup() {
  const memory = new Map();

  return async (cnpj) => {
    if (memory.has(cnpj)) return memory.get(cnpj);

    const cachePath = `leadImportCache/cnpj/${cnpj}`;
    const cached = await getCachedValue(cachePath, CNPJ_CACHE_TTL_MS);
    if (cached) {
      const result = { data: cached, source: 'BrasilAPI (cache)' };
      memory.set(cnpj, result);
      return result;
    }

    const data = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if (data) {
      await database.ref(cachePath).set({ fetchedAt: Date.now(), value: data });
    }

    const result = { data, source: 'BrasilAPI' };
    memory.set(cnpj, result);
    return result;
  };
}

function stateFromMapboxFeature(feature) {
  const context = feature?.properties?.context || feature?.context || {};
  const region = context.region || {};
  const code = String(region.region_code || region.short_code || '').toUpperCase();
  const codeMatch = code.match(/BR-([A-Z]{2})$/);
  if (codeMatch) return codeMatch[1];

  const regionName = String(region.name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const found = Object.entries({
    AC: 'ACRE', AL: 'ALAGOAS', AP: 'AMAPA', AM: 'AMAZONAS', BA: 'BAHIA', CE: 'CEARA', DF: 'DISTRITO FEDERAL',
    ES: 'ESPIRITO SANTO', GO: 'GOIAS', MA: 'MARANHAO', MT: 'MATO GROSSO', MS: 'MATO GROSSO DO SUL',
    MG: 'MINAS GERAIS', PA: 'PARA', PB: 'PARAIBA', PR: 'PARANA', PE: 'PERNAMBUCO', PI: 'PIAUI',
    RJ: 'RIO DE JANEIRO', RN: 'RIO GRANDE DO NORTE', RS: 'RIO GRANDE DO SUL', RO: 'RONDONIA',
    RR: 'RORAIMA', SC: 'SANTA CATARINA', SP: 'SAO PAULO', SE: 'SERGIPE', TO: 'TOCANTINS',
  }).find(([, name]) => name === regionName);
  return found?.[0] || '';
}

function mapboxResult(feature) {
  const coordinates = feature?.properties?.coordinates || {};
  const [longitude, latitude] = feature?.geometry?.coordinates || [];
  const matchCode = feature?.properties?.match_code || {};
  return {
    latitude: Number(coordinates.latitude ?? latitude),
    longitude: Number(coordinates.longitude ?? longitude),
    state: stateFromMapboxFeature(feature),
    accuracy: coordinates.accuracy || null,
    confidence: matchCode.confidence || null,
    label: feature?.properties?.full_address || feature?.properties?.name || feature?.place_name || '',
    source: 'Mapbox Geocoding v6 (permanente)',
  };
}

function readMapboxToken() {
  try {
    return MAPBOX_ACCESS_TOKEN.value();
  } catch (error) {
    logger.warn('O segredo MAPBOX_ACCESS_TOKEN ainda não está configurado.', error);
    return '';
  }
}

function createGeocodeLookup() {
  const token = readMapboxToken();
  const permanent = String(MAPBOX_GEOCODING_PERMANENT.value()).toLowerCase() === 'true';
  if (!token || !permanent) return null;

  const memory = new Map();
  return async (query) => {
    const cacheKey = sha256(query.toLowerCase());
    if (memory.has(cacheKey)) return memory.get(cacheKey);

    const cachePath = `leadImportCache/geocode/${cacheKey}`;
    const cached = await getCachedValue(cachePath, GEOCODE_CACHE_TTL_MS);
    if (cached) {
      memory.set(cacheKey, cached);
      return cached;
    }

    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.searchParams.set('q', query);
    url.searchParams.set('country', 'BR');
    url.searchParams.set('types', 'address,street,place');
    url.searchParams.set('autocomplete', 'false');
    url.searchParams.set('limit', '1');
    url.searchParams.set('permanent', 'true');
    url.searchParams.set('access_token', token);

    const response = await fetchJson(url.toString());
    const feature = response?.features?.[0];
    const result = feature ? mapboxResult(feature) : null;
    if (result) {
      await database.ref(cachePath).set({ fetchedAt: Date.now(), value: result });
    }
    memory.set(cacheKey, result);
    return result;
  };
}

function compactPreview(records) {
  return records.map((record) => ({
    ...record,
    __meta: record.__meta || {},
  }));
}

function toFunctionError(error) {
  if (error instanceof HttpsError) return error;
  if (error instanceof ProcessorError) return new HttpsError(error.code || 'invalid-argument', error.message);
  logger.error('Falha na importação Odoo', error);
  return new HttpsError('internal', 'Não foi possível processar a planilha agora. Confira o arquivo e tente novamente.');
}

exports.processOdooLeadImport = onCall(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 2,
    secrets: [MAPBOX_ACCESS_TOKEN],
  },
  async (request) => {
    try {
      await requireActiveAdmin(request);
      await cleanupExpiredJobs();
      const { fileName, file } = asFileBuffer(request.data);
      const options = request.data?.options || {};
      const customersSnapshot = await database.ref('customers').get();
      const now = Date.now();
      const jobId = `odoo_${now}_${crypto.randomUUID().slice(0, 8)}`;
      const result = await processOdooWorkbook(file, {
        fileName,
        customers: customersSnapshot.val() || {},
        lookupCnpj: createCnpjLookup(),
        lookupGeocode: createGeocodeLookup(),
        enableResearch: options.enableResearch !== false,
        enableGeocoding: options.enableGeocoding !== false,
      });

      const job = {
        id: jobId,
        status: 'preview_ready',
        createdAt: now,
        expiresAt: now + JOB_TTL_MS,
        createdBy: request.auth.uid,
        fileName,
        source: 'odoo_raw_export',
        summary: result.summary,
        audit: result.audit,
        records: compactPreview(result.records),
        options: {
          enableResearch: options.enableResearch !== false,
          enableGeocoding: options.enableGeocoding !== false,
        },
      };

      await database.ref(`leadImportJobs/${jobId}`).set(job);
      return {
        jobId,
        status: job.status,
        summary: result.summary,
        audit: result.audit,
        records: compactPreview(result.records),
      };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);

exports.cleanupExpiredOdooImportJobs = onSchedule(
  {
    region: REGION,
    schedule: 'every 24 hours',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
  },
  async () => {
    const removed = await cleanupExpiredJobs();
    logger.info('Previews Odoo expiradas removidas.', { removed });
  },
);

exports.commitOdooLeadImport = onCall(
  { region: REGION, timeoutSeconds: 180, memory: '256MiB', maxInstances: 2 },
  async (request) => {
    try {
      await requireActiveAdmin(request);
      const jobId = String(request.data?.jobId || '').trim();
      const mode = request.data?.mode === 'replace' ? 'replace' : 'merge';
      if (!jobId) throw new HttpsError('invalid-argument', 'Nenhuma prévia de importação foi selecionada.');

      const jobReference = database.ref(`leadImportJobs/${jobId}`);
      const jobSnapshot = await jobReference.get();
      const job = jobSnapshot.val();
      if (!job) throw new HttpsError('not-found', 'A prévia expirou ou não foi encontrada. Processe a planilha novamente.');
      if (job.createdBy !== request.auth.uid) throw new HttpsError('permission-denied', 'Apenas quem gerou esta prévia pode confirmá-la.');
      if (job.status !== 'preview_ready') throw new HttpsError('failed-precondition', 'Esta prévia já foi importada ou não está disponível para confirmação.');
      if (Number(job.expiresAt || 0) < Date.now()) throw new HttpsError('failed-precondition', 'A prévia expirou. Processe a planilha novamente.');
      if (Number(job.summary?.blockingIssues || 0) > 0) {
        throw new HttpsError('failed-precondition', 'Há inconsistências estruturais na planilha. Baixe o relatório, corrija o arquivo e processe-o novamente.');
      }

      const records = Array.isArray(job.records) ? job.records : Object.values(job.records || {});
      if (!records.length) throw new HttpsError('failed-precondition', 'A prévia não contém oportunidades para importar.');

      const keySources = new Map();
      records.forEach((record) => {
        const key = toFirebaseKey(record.ID);
        const previous = keySources.get(key);
        if (previous && previous !== record.ID) {
          throw new HttpsError('failed-precondition', `Os IDs ${previous} e ${record.ID} geram a mesma chave do Firebase. Revise a planilha antes de importar.`);
        }
        keySources.set(key, record.ID);
      });

      const customersReference = database.ref('customers');
      const customersSnapshot = await customersReference.get();
      const existingCustomers = customersSnapshot.val() || {};
      const importedAt = Date.now();
      const nextCustomers = {};

      records.forEach((record) => {
        const key = toFirebaseKey(record.ID);
        const incoming = {
          ...buildFirebaseCustomer(record, {
            jobId,
            importedBy: request.auth.uid,
            importedAt,
          }),
          id: key,
          externalId: String(record.ID || '').trim(),
          importedAt,
          importedBy: request.auth.uid,
          updatedAt: importedAt,
        };
        nextCustomers[key] = mode === 'merge'
          ? mergeCustomer(existingCustomers[key], incoming)
          : incoming;
      });

      if (mode === 'replace') {
        await customersReference.set(nextCustomers);
      } else {
        const updates = {};
        Object.entries(existingCustomers).forEach(([key, customer]) => {
          const externalId = String(customer?.externalId || '').trim();
          if (/^linha-\d+$/i.test(key) || /^linha-\d+$/i.test(externalId)) {
            updates[`customers/${key}`] = null;
          }
        });
        Object.entries(nextCustomers).forEach(([key, customer]) => {
          updates[`customers/${key}`] = customer;
        });
        await database.ref().update(updates);
      }

      await jobReference.update({
        status: 'imported',
        importMode: mode,
        importedAt,
        importedBy: request.auth.uid,
        processed: records.length,
      });

      return { processed: records.length, mode, jobId };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);
