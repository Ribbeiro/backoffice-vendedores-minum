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
  compareReverseAddress,
  createMapboxGeocoderClient,
  validateMapboxResponse,
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
  summarizeAudit,
} = require('./src/revalidationService');

if (!getApps().length) initializeApp();

const database = getDatabase();
const REGION = 'southamerica-east1';
const MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const CNPJ_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const GEOCODING_AUDIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REVALIDATION_BATCH_SIZE = 50;
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

async function fetchJson(url, { timeoutMs = 12000, method = 'GET', body = undefined } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
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

  const permanent = String(MAPBOX_GEOCODING_PERMANENT.value()).trim().toLowerCase() === 'true';
  const mapboxClient = createMapboxGeocoderClient(token, {
    fetchJsonFn: fetchJson,
    fetchBatchFn: (url, body) => fetchJson(url, { method: 'POST', body, timeoutMs: 30000 }),
    permanent,
  });
  const memory = new Map();

  const cacheIdentity = (parsedAddress) => {
    const canonical = canonicalKey(
      parsedAddress.street,
      parsedAddress.houseNumber,
      parsedAddress.place,
      parsedAddress.region,
      parsedAddress.postcode,
      parsedAddress.country,
      parsedAddress.neighborhood,
    );
    return { canonical, cacheKey: sha256(canonical) };
  };

  const cachePathFor = (cacheKey) => `leadImportCache/geocode_v${GEOCODING_ALGORITHM_VERSION}/${cacheKey}`;

  return {
    async forwardGeocode(parsedAddress) {
      const { cacheKey } = cacheIdentity(parsedAddress);

      if (memory.has(cacheKey)) return memory.get(cacheKey);

      const cachePath = cachePathFor(cacheKey);
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

    /** Usa cache por endereco completo e envia somente os misses no batch oficial do Mapbox. */
    async forwardGeocodeBatch(parsedAddresses) {
      const results = new Array(parsedAddresses.length).fill(null);
      const misses = [];
      await Promise.all(parsedAddresses.map(async (parsedAddress, index) => {
        const { cacheKey } = cacheIdentity(parsedAddress);
        if (memory.has(cacheKey)) {
          results[index] = memory.get(cacheKey);
          return;
        }
        const cached = await getCachedValue(cachePathFor(cacheKey), GEOCODE_CACHE_TTL_MS);
        if (cached) {
          memory.set(cacheKey, cached);
          results[index] = cached;
          return;
        }
        misses.push({ index, parsedAddress, cacheKey });
      }));

      for (let start = 0; start < misses.length; start += MAX_REVALIDATION_BATCH_SIZE) {
        const chunk = misses.slice(start, start + MAX_REVALIDATION_BATCH_SIZE);
        const batchResults = await mapboxClient.forwardGeocodeBatch(chunk.map((item) => item.parsedAddress));
        const updates = {};
        chunk.forEach((item, index) => {
          const result = batchResults[index] || null;
          results[item.index] = result;
          memory.set(item.cacheKey, result);
          if (result) updates[cachePathFor(item.cacheKey)] = { fetchedAt: Date.now(), value: result };
        });
        if (Object.keys(updates).length) await database.ref().update(updates);
      }
      return results;
    },

    async reverseGeocode(latitude, longitude) {
      return mapboxClient.reverseGeocode(latitude, longitude);
    },
  };
}

function sanitizeForRealtime(value) {
  if (value === undefined || Number.isNaN(value)) return null;
  if (Array.isArray(value)) return value.map(sanitizeForRealtime);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, sanitizeForRealtime(child)]));
  }
  return value;
}

function clampRevalidationBatchSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MAX_REVALIDATION_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_REVALIDATION_BATCH_SIZE, Math.floor(parsed)));
}

function collectVisitEvents(node, visitEventsByCustomer = {}) {
  if (!node || typeof node !== 'object') return visitEventsByCustomer;
  const customerId = node.customerId ?? node.customerKey ?? node.customerExternalId ?? node.externalCustomerId;
  const hasLocation = node.location || node.checkInLocation || node.feedbackLocation || node.checkOutLocation
    || (node.latitude !== undefined && node.longitude !== undefined);
  if (customerId !== undefined && customerId !== null && hasLocation) {
    const key = String(customerId);
    if (!visitEventsByCustomer[key]) visitEventsByCustomer[key] = [];
    visitEventsByCustomer[key].push(node);
    return visitEventsByCustomer;
  }
  Object.values(node).forEach((child) => collectVisitEvents(child, visitEventsByCustomer));
  return visitEventsByCustomer;
}

async function readVisitEventsByCustomer() {
  const [attendances, events] = await Promise.all([
    database.ref('visitAttendances').get(),
    database.ref('visitEvents').get(),
  ]);
  const grouped = {};
  if (attendances.exists()) collectVisitEvents(attendances.val(), grouped);
  if (events.exists()) collectVisitEvents(events.val(), grouped);
  return grouped;
}

async function loadOrCreateRevalidationJob(request, customers, requestedJobId) {
  if (requestedJobId) {
    const reference = database.ref(`geocodingAuditJobs/${requestedJobId}`);
    const snapshot = await reference.get();
    const job = snapshot.val();
    if (!job) throw new HttpsError('not-found', 'A auditoria solicitada nao foi encontrada.');
    if (job.expiresAt && Number(job.expiresAt) < Date.now()) {
      throw new HttpsError('failed-precondition', 'Esta auditoria expirou. Inicie uma nova auditoria.');
    }
    return { id: requestedJobId, reference, job };
  }

  const now = Date.now();
  const id = `geo_${now}_${crypto.randomUUID().slice(0, 8)}`;
  const job = {
    id,
    status: 'running',
    createdAt: now,
    expiresAt: now + GEOCODING_AUDIT_TTL_MS,
    createdBy: request.auth.uid,
    algorithmVersion: GEOCODING_ALGORITHM_VERSION,
    customerIds: Object.keys(customers).sort(),
    total: Object.keys(customers).length,
    nextIndex: 0,
    processed: 0,
    approvedCount: 0,
    summary: {},
  };
  const reference = database.ref(`geocodingAuditJobs/${id}`);
  await reference.set(job);
  return { id, reference, job };
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
 * Processa a auditoria em lotes retomaveis. Nenhuma coordenada de customers e
 * modificada aqui: os resultados ficam congelados no job para revisao humana.
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
      const requestedJobId = String(request.data?.jobId || '').trim();
      const { id: jobId, reference: jobReference, job } = await loadOrCreateRevalidationJob(request, customers, requestedJobId);
      const customerIds = Array.isArray(job.customerIds) ? job.customerIds : Object.keys(customers).sort();
      const startIndex = Math.max(0, Number(job.nextIndex) || 0);
      const batchSize = clampRevalidationBatchSize(request.data?.batchSize);
      const batchIds = customerIds.slice(startIndex, startIndex + batchSize);

      if (!batchIds.length) {
        const previousResults = (await jobReference.child('results').get()).val() || {};
        const summary = summarizeAudit(Object.values(previousResults));
        await jobReference.update({ status: 'completed', summary, completedAt: Date.now(), nextIndex: customerIds.length });
        return { jobId, status: 'completed', total: customerIds.length, processed: customerIds.length, summary, results: [] };
      }

      const [visitEventsByCustomer, mapboxClient] = await Promise.all([
        readVisitEventsByCustomer(),
        Promise.resolve(createGeocodeLookup()),
      ]);
      const batchResults = await auditExistingCustomers({
        customers,
        visitEventsByCustomer,
        mapboxGeocoderClient: mapboxClient,
        customerIds: batchIds,
      });
      const updates = {};
      batchResults.forEach((result) => {
        updates[`geocodingAuditJobs/${jobId}/results/${result.id}`] = sanitizeForRealtime(result);
      });
      if (Object.keys(updates).length) await database.ref().update(updates);

      const nextIndex = startIndex + batchIds.length;
      const allResultsSnapshot = await jobReference.child('results').get();
      const allResults = Object.values(allResultsSnapshot.val() || {});
      const summary = summarizeAudit(allResults);
      const completed = nextIndex >= customerIds.length;
      await jobReference.update({
        status: completed ? 'completed' : 'running',
        nextIndex,
        processed: nextIndex,
        updatedAt: Date.now(),
        completedAt: completed ? Date.now() : null,
        summary,
      });

      return {
        jobId,
        status: completed ? 'completed' : 'running',
        total: customerIds.length,
        processed: nextIndex,
        batchSize: batchResults.length,
        summary,
        results: batchResults,
      };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);

/** Recupera uma auditoria retomavel e seus resultados ja processados. */
exports.getCoordinateRevalidationJob = onCall(
  { region: REGION, timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    try {
      await requireActiveAdmin(request);
      const jobId = String(request.data?.jobId || '').trim();
      if (!jobId) throw new HttpsError('invalid-argument', 'Informe o identificador da auditoria.');
      const snapshot = await database.ref(`geocodingAuditJobs/${jobId}`).get();
      const job = snapshot.val();
      if (!job) throw new HttpsError('not-found', 'Auditoria nao encontrada.');
      const { results, ...jobMetadata } = job;
      return {
        job: jobMetadata,
        results: Object.values(results || {}),
      };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);

/**
 * Aplica somente coordenadas cuja proposta foi validada e escolhida pelo
 * administrador. O valor anterior e preservado em geocoding.previousCoordinate.
 */
exports.applyCoordinateRevalidation = onCall(
  { region: REGION, timeoutSeconds: 180, memory: '256MiB', maxInstances: 2 },
  async (request) => {
    try {
      const profile = await requireActiveAdmin(request);
      const jobId = String(request.data?.jobId || '').trim();
      const requestedIds = Array.from(new Set((Array.isArray(request.data?.customerIds) ? request.data.customerIds : [])
        .map((id) => String(id).trim()).filter(Boolean))).slice(0, 100);
      if (!jobId || !requestedIds.length) {
        throw new HttpsError('invalid-argument', 'Selecione ao menos uma coordenada confirmada para aplicar.');
      }
      const jobReference = database.ref(`geocodingAuditJobs/${jobId}`);
      const jobSnapshot = await jobReference.get();
      const job = jobSnapshot.val();
      if (!job) throw new HttpsError('not-found', 'Auditoria nao encontrada.');

      const reviewAt = Date.now();
      const updates = {};
      const applied = [];
      const skipped = [];
      requestedIds.forEach((customerId) => {
        const result = job.results?.[customerId];
        const candidate = result?.geocodedCoordinate;
        const navigation = result?.navigationCoordinate;
        if (!result?.approvalEligible || !candidate || !navigation || result.reviewStatus === 'approved') {
          skipped.push({ customerId, reason: 'A proposta nao possui evidencias suficientes para aplicacao ou ja foi aplicada.' });
          return;
        }
        const geocoding = {
          ...(result.geocoding || {}),
          status: 'confirmed',
          reason: 'Coordenada aprovada manualmente apos auditoria.',
          approvedAt: reviewAt,
          approvedBy: request.auth.uid,
          approvedByName: profile?.name || profile?.email || 'Administrador',
          previousCoordinate: result.currentCoordinate || result.previousCoordinate || null,
        };
        const review = {
          status: 'approved',
          jobId,
          approvedAt: reviewAt,
          approvedBy: request.auth.uid,
          approvedByName: profile?.name || profile?.email || 'Administrador',
          algorithmVersion: GEOCODING_ALGORITHM_VERSION,
        };
        updates[`customers/${customerId}/latitude`] = candidate.latitude;
        updates[`customers/${customerId}/longitude`] = candidate.longitude;
        updates[`customers/${customerId}/navigationLatitude`] = navigation.latitude;
        updates[`customers/${customerId}/navigationLongitude`] = navigation.longitude;
        updates[`customers/${customerId}/entranceLatitude`] = result.entranceCoordinate?.latitude || null;
        updates[`customers/${customerId}/entranceLongitude`] = result.entranceCoordinate?.longitude || null;
        updates[`customers/${customerId}/previousLatitude`] = result.currentCoordinate?.latitude || null;
        updates[`customers/${customerId}/previousLongitude`] = result.currentCoordinate?.longitude || null;
        updates[`customers/${customerId}/geocodedLatitude`] = candidate.latitude;
        updates[`customers/${customerId}/geocodedLongitude`] = candidate.longitude;
        updates[`customers/${customerId}/coordinatePrecisionLevel`] = result.accuracy;
        updates[`customers/${customerId}/coordinateStatus`] = 'confirmed';
        updates[`customers/${customerId}/coordinateSource`] = 'Mapbox Geocoding v6 (revisao administrativa)';
        updates[`customers/${customerId}/normalizedAddress`] = result.normalizedAddress || null;
        updates[`customers/${customerId}/canonicalKey`] = result.canonicalKey;
        updates[`customers/${customerId}/geocoding`] = sanitizeForRealtime(geocoding);
        updates[`customers/${customerId}/geocodingReview`] = review;
        updates[`geocodingAuditJobs/${jobId}/results/${customerId}/reviewStatus`] = 'approved';
        updates[`geocodingAuditJobs/${jobId}/results/${customerId}/review`] = review;
        applied.push(customerId);
      });
      if (Object.keys(updates).length) await database.ref().update(updates);
      if (applied.length) {
        await jobReference.update({
          approvedCount: Number(job.approvedCount || 0) + applied.length,
          lastApprovedAt: reviewAt,
          lastApprovedBy: request.auth.uid,
        });
      }
      return { jobId, applied, skipped };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);

/**
 * Registra uma correcao excepcional informada pelo administrador. Ela nao
 * tenta inferir endereco: a origem manual e o motivo ficam explicitamente
 * gravados para que a base continue auditavel.
 */
exports.applyManualCoordinateRevalidation = onCall(
  { region: REGION, timeoutSeconds: 60, memory: '256MiB', maxInstances: 2 },
  async (request) => {
    try {
      const profile = await requireActiveAdmin(request);
      const jobId = String(request.data?.jobId || '').trim();
      const customerId = String(request.data?.customerId || '').trim();
      const latitude = Number(request.data?.latitude);
      const longitude = Number(request.data?.longitude);
      const reason = String(request.data?.reason || '').trim();

      if (!jobId || !customerId) {
        throw new HttpsError('invalid-argument', 'Informe a auditoria e o cliente da correcao.');
      }
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new HttpsError('invalid-argument', 'Informe uma latitude e uma longitude validas.');
      }
      if (reason.length < 5) {
        throw new HttpsError('invalid-argument', 'Explique a origem da correcao manual em pelo menos 5 caracteres.');
      }

      const jobReference = database.ref(`geocodingAuditJobs/${jobId}`);
      const jobSnapshot = await jobReference.get();
      const job = jobSnapshot.val();
      const result = job?.results?.[customerId];
      if (!job || !result) throw new HttpsError('not-found', 'Registro de auditoria nao encontrado.');

      const reviewedAt = Date.now();
      const manualCoordinate = { latitude, longitude };
      const review = {
        status: 'manual',
        jobId,
        reason,
        reviewedAt,
        reviewedBy: request.auth.uid,
        reviewedByName: profile?.name || profile?.email || 'Administrador',
        algorithmVersion: GEOCODING_ALGORITHM_VERSION,
      };
      const geocoding = {
        ...(result.geocoding || {}),
        status: 'manual_confirmed',
        reason: `Coordenada corrigida manualmente: ${reason}`,
        manualCoordinate,
        manualReviewedAt: reviewedAt,
        manualReviewedBy: request.auth.uid,
        manualReviewedByName: profile?.name || profile?.email || 'Administrador',
        previousCoordinate: result.currentCoordinate || result.previousCoordinate || null,
      };
      const updates = {
        [`customers/${customerId}/latitude`]: latitude,
        [`customers/${customerId}/longitude`]: longitude,
        [`customers/${customerId}/navigationLatitude`]: latitude,
        [`customers/${customerId}/navigationLongitude`]: longitude,
        [`customers/${customerId}/previousLatitude`]: result.currentCoordinate?.latitude || null,
        [`customers/${customerId}/previousLongitude`]: result.currentCoordinate?.longitude || null,
        [`customers/${customerId}/coordinatePrecisionLevel`]: 'manual',
        [`customers/${customerId}/coordinateStatus`]: 'manual_confirmed',
        [`customers/${customerId}/coordinateSource`]: 'Correcao manual administrativa',
        [`customers/${customerId}/geocoding`]: sanitizeForRealtime(geocoding),
        [`customers/${customerId}/geocodingReview`]: review,
        [`geocodingAuditJobs/${jobId}/results/${customerId}/reviewStatus`]: 'manual',
        [`geocodingAuditJobs/${jobId}/results/${customerId}/review`]: review,
      };
      await database.ref().update(updates);
      await jobReference.update({
        manualReviewCount: Number(job.manualReviewCount || 0) + 1,
        lastManualReviewAt: reviewedAt,
        lastManualReviewBy: request.auth.uid,
      });
      return { customerId, reviewStatus: 'manual' };
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
      const validation = validateMapboxResponse(result.rawFeature, parsed);
      if (!validation.accepted) {
        return {
          found: false,
          status: validation.status,
          reason: validation.reason,
          featureType: result.featureType,
          accuracy: result.accuracy,
          confidence: result.confidence,
        };
      }

      const reverse = await mapboxClient.reverseGeocode(result.latitude, result.longitude);
      const reverseMatch = compareReverseAddress(parsed, reverse);
      if (reverseMatch.matches !== true) {
        return {
          found: false,
          status: 'reverse_mismatch',
          reason: reverseMatch.reason,
        };
      }

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
