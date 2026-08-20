const crypto = require('crypto');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

const {
  GEOCODING_ALGORITHM_VERSION,
  canonicalKey,
  parseBrazilianAddress,
} = require('./src/addressNormalizer');
const {
  createMapboxGeocoderClient,
} = require('./src/mapboxGeocoder');
const {
  ProcessorError,
  buildFirebaseCustomer,
  mergeCustomer,
  processOdooWorkbook,
  toFirebaseKey,
} = require('./src/odooLeadProcessor');
const {
  auditExistingCustomers,
} = require('./src/revalidationService');

if (!getApps().length) initializeApp();

const database = getDatabase();
const REGION = 'southamerica-east1';
const MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const CNPJ_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAPBOX_ACCESS_TOKEN = defineSecret('MAPBOX_ACCESS_TOKEN');
const MAPBOX_GEOCODING_PERMANENT = defineString('MAPBOX_GEOCODING_PERMANENT', { default: 'true' });

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

async function requireActiveAdmin(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Entre novamente para continuar.');
  }

  const snapshot = await database.ref(`users/${request.auth.uid}`).get();
  const profile = snapshot.val();
  const allowed = normalizeRole(profile?.role) === 'admin'
    && profile?.active === true
    && profile?.allowedAccess === true
    && profile?.deleted !== true;

  if (!allowed) {
    throw new HttpsError('permission-denied', 'Sua conta não possui permissão administrativa.');
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
  if (!token) return null;

  const mapboxClient = createMapboxGeocoderClient(token, { fetchJsonFn: fetchJson });
  const memory = new Map();

  return {
    async forwardGeocode(parsedAddress) {
      const key = canonicalKey(
        parsedAddress.street,
        parsedAddress.houseNumber,
        parsedAddress.place,
        parsedAddress.region,
        parsedAddress.postcode,
        parsedAddress.country
      );
      const cacheKey = sha256(key);

      if (memory.has(cacheKey)) return memory.get(cacheKey);

      const cachePath = `leadImportCache/geocode_v${GEOCODING_ALGORITHM_VERSION}/${cacheKey}`;
      const cached = await getCachedValue(cachePath, GEOCODE_CACHE_TTL_MS);
      if (cached) {
        memory.set(cacheKey, cached);
        return cached;
      }

      const result = await mapboxClient.forwardGeocode(parsedAddress);
      if (result) {
        await database.ref(cachePath).set({ fetchedAt: Date.now(), value: result });
      }
      memory.set(cacheKey, result);
      return result;
    },

    async reverseGeocode(latitude, longitude) {
      return mapboxClient.reverseGeocode(latitude, longitude);
    },
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
  logger.error('Falha na função de backend', error);
  return new HttpsError('internal', 'Não foi possível concluir o processamento.');
}

/**
 * Cloud Function para processar a importação bruta de planilhas do Odoo.
 */
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
        mapboxGeocoderClient: createGeocodeLookup(),
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

/**
 * Cloud Function para confirmar e gravar os clientes aprovados da prévia no Firebase.
 */
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
      if (!job) throw new HttpsError('not-found', 'A prévia expirou ou não foi encontrada.');
      if (job.createdBy !== request.auth.uid) throw new HttpsError('permission-denied', 'Apenas quem gerou esta prévia pode confirmá-la.');
      if (job.status !== 'preview_ready') throw new HttpsError('failed-precondition', 'Esta prévia já foi importada.');

      const records = Array.isArray(job.records) ? job.records : Object.values(job.records || {});
      if (!records.length) throw new HttpsError('failed-precondition', 'A prévia não contém oportunidades.');

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

/**
 * Cloud Function para Revalidação da Base de Clientes Existentes (Seções 14, 17, 29 do prompt).
 */
exports.revalidateCustomerCoordinates = onCall(
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
      const customersSnapshot = await database.ref('customers').get();
      const customers = customersSnapshot.val() || {};

      const visitEventsSnapshot = await database.ref('visitAttendances').get();
      const visitEventsByCustomer = {};
      if (visitEventsSnapshot.exists()) {
        visitEventsSnapshot.forEach((child) => {
          const val = child.val();
          const customerId = val.customerId || val.customerKey;
          if (customerId) {
            if (!visitEventsByCustomer[customerId]) visitEventsByCustomer[customerId] = [];
            visitEventsByCustomer[customerId].push(val);
          }
        });
      }

      const mapboxClient = createGeocodeLookup();
      const auditResults = await auditExistingCustomers({
        customers,
        visitEventsByCustomer,
        mapboxGeocoderClient: mapboxClient,
      });

      return {
        total: auditResults.length,
        results: auditResults,
      };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);

/**
 * Cloud Function para busca segura e unificada de endereços utilizada pelo aplicativo Android (Seção 34).
 */
exports.geocodeAddress = onCall(
  {
    region: REGION,
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [MAPBOX_ACCESS_TOKEN],
  },
  async (request) => {
    try {
      if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Autenticação necessária.');
      }
      const rawAddress = String(request.data?.address || '').trim();
      const rawCity = String(request.data?.city || '').trim();
      const rawState = String(request.data?.state || '').trim();

      if (!rawAddress && !rawCity) {
        throw new HttpsError('invalid-argument', 'Forneça um endereço ou cidade para busca.');
      }

      const parsed = parseBrazilianAddress(rawAddress, rawCity, rawState, 'Brasil');
      const mapboxClient = createGeocodeLookup();
      if (!mapboxClient) {
        throw new HttpsError('failed-precondition', 'Serviço de geocodificação indisponível.');
      }

      const result = await mapboxClient.forwardGeocode(parsed);
      if (!result) return { found: false };

      return {
        found: true,
        latitude: result.latitude,
        longitude: result.longitude,
        navigationLatitude: result.navigationLatitude,
        navigationLongitude: result.navigationLongitude,
        featureType: result.featureType,
        accuracy: result.accuracy,
        confidence: result.confidence,
        label: result.label,
      };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);
