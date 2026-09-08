const crypto = require('crypto');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onValueCreated, onValueWritten } = require('firebase-functions/v2/database');
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
  isValidCoordinates,
  mergeCustomer,
  processOdooWorkbook,
  toFirebaseKey,
} = require('./src/odooLeadProcessor');
const {
  fromFirebaseSafeValue,
  toFirebaseSafeValue,
} = require('./src/firebaseSafeData');
const {
  auditExistingCustomers,
  selectCustomerIdsForAudit,
  summarizeAudit,
} = require('./src/revalidationService');
const { createOdooClient } = require('./src/odooClient');
const { processOdooVisitEvent, syncPendingOdooVisitEvents } = require('./src/odooVisitSyncService');
const { enqueueOdooEvent, syncQueuedOdooVisitEvents } = require('./src/odooQueue');
const { projectCustomer, rebuildSellerCustomers, sellerIdentity } = require('./src/sellerCustomers');
const { verifyOdooJsonRpcConnection } = require('./src/odooConnectionVerifier');

// A URL explicita permite que o Firebase CLI carregue os endpoints durante o
// deploy, quando o metadata automatico do Realtime Database ainda nao existe.
if (!getApps().length) {
  initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://vendedores-minum-default-rtdb.firebaseio.com',
  });
}

const database = getDatabase();
const REGION = 'southamerica-east1';
// A instancia padrao do Realtime Database deste projeto fica em us-central1.
// Gatilhos Eventarc de RTDB precisam nascer na mesma regiao da instancia.
const RTDB_TRIGGER_REGION = 'us-central1';
const MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const CNPJ_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const GEOCODING_AUDIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REVALIDATION_BATCH_SIZE = 50;
const MAPBOX_ACCESS_TOKEN = defineSecret('MAPBOX_ACCESS_TOKEN');
const MAPBOX_GEOCODING_PERMANENT = defineString('MAPBOX_GEOCODING_PERMANENT', { default: 'true' });
const ODOO_API_KEY = defineSecret('ODOO_API_KEY');

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
    // Segredos podem chegar com quebra de linha quando cadastrados por arquivo.
    // A URL do Mapbox exige o valor do token sem espacos adicionais.
    return String(MAPBOX_ACCESS_TOKEN.value() || '').trim();
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

function readOdooApiKey() {
  try {
    return String(ODOO_API_KEY.value() || '').trim();
  } catch {
    return '';
  }
}

function isOdooSyncEnabled() {
  // Estes valores ficam em functions/.env, fora do Git. Eles sao opcionais
  // durante a descoberta da API e so passam a ser usados apos a validacao.
  return String(process.env.ODOO_SYNC_ENABLED || 'false').trim().toLowerCase() === 'true';
}

function odooSyncBatchSize() {
  const value = Number(process.env.ODOO_SYNC_MAX_EVENTS || 20);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.floor(value))) : 20;
}

function odooRuntimeConfiguration() {
  return {
    ...process.env,
  };
}

/** Centraliza a criacao do cliente para todos os caminhos de sincronizacao. */
function createRuntimeOdooClient() {
  return createOdooClient({
    apiKey: readOdooApiKey(),
    env: odooRuntimeConfiguration(),
  });
}

function readVisitEventPathPart(value, fieldName) {
  const normalized = String(value || '').trim();
  const forbiddenCharacters = ['.', '#', '$', '[', ']', '/'];
  if (!normalized || normalized.length > 200 || forbiddenCharacters.some((character) => normalized.includes(character))) {
    throw new HttpsError('invalid-argument', `Informe um ${fieldName} de evento valido.`);
  }
  return normalized;
}

async function runOdooVisitSync({ includeBlocked = false } = {}) {
  const odooClient = createRuntimeOdooClient();
  return syncPendingOdooVisitEvents({
    database,
    odooClient,
    maxEvents: odooSyncBatchSize(),
    includeBlocked,
  });
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

async function loadOrCreateRevalidationJob(request, customerIds, requestedJobId, metadata = {}) {
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
    customerIds: customerIds.sort(),
    total: customerIds.length,
    scope: metadata.includeReviewed ? 'full' : 'pending_or_changed',
    skippedReviewedCount: metadata.skippedReviewedCount || 0,
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
  return toFirebaseSafeValue(records.map((record) => ({
    ...record,
    __meta: record.__meta || {},
  })));
}

function previewCoordinateSummary(records, summary = {}) {
  const statusOf = (record) => String(record?.__meta?.coordinateStatus || '').trim().toLowerCase();
  const confirmedStatuses = new Set(['confirmed', 'manual_confirmed']);
  const confirmed = records.filter((record) => confirmedStatuses.has(statusOf(record))).length;
  const manual = records.filter((record) => statusOf(record) === 'manual_confirmed').length;
  const missing = records.filter((record) => !isValidCoordinates(record?.latitude, record?.longitude)).length;

  return {
    ...summary,
    coordinatesConfirmed: confirmed,
    coordinatesManualConfirmed: manual,
    coordinatesMissing: missing,
    coordinatesNeedsReview: records.filter((record) => !confirmedStatuses.has(statusOf(record))).length,
  };
}

function reviewedPreviewRecord(record, {
  action,
  latitude,
  longitude,
  reason,
  jobId,
  userId,
  profile,
}) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  const current = { ...record };
  const meta = { ...(record.__meta || {}) };
  const reviewedAt = Date.now();
  const proposedLatitude = Number(meta.geocodedLatitude);
  const proposedLongitude = Number(meta.geocodedLongitude);
  const currentLatitude = Number(record.latitude);
  const currentLongitude = Number(record.longitude);
  let selectedLatitude;
  let selectedLongitude;
  let selectedNavigationLatitude;
  let selectedNavigationLongitude;
  let reviewStatus;
  let coordinateStatus;
  let coordinateSource;
  let coordinatePrecisionLevel;
  let reviewReason;

  if (normalizedAction === 'accept_mapbox') {
    if (!isValidCoordinates(proposedLatitude, proposedLongitude)) {
      throw new HttpsError('failed-precondition', 'Esta oportunidade nao possui uma coordenada sugerida pelo Mapbox para aprovar.');
    }
    selectedLatitude = proposedLatitude;
    selectedLongitude = proposedLongitude;
    selectedNavigationLatitude = isValidCoordinates(meta.navigationLatitude, meta.navigationLongitude)
      ? Number(meta.navigationLatitude)
      : selectedLatitude;
    selectedNavigationLongitude = isValidCoordinates(meta.navigationLatitude, meta.navigationLongitude)
      ? Number(meta.navigationLongitude)
      : selectedLongitude;
    reviewStatus = 'approved_import';
    coordinateStatus = 'confirmed';
    coordinateSource = 'Mapbox Geocoding v6 (confirmada na importacao)';
    coordinatePrecisionLevel = meta.coordinatePrecisionLevel || 'unknown';
    reviewReason = 'Proposta Mapbox confirmada pelo administrador durante a importacao.';
  } else if (normalizedAction === 'confirm_current') {
    if (!isValidCoordinates(currentLatitude, currentLongitude)) {
      throw new HttpsError('failed-precondition', 'Nao ha coordenada atual valida para confirmar. Informe a coordenada manualmente.');
    }
    selectedLatitude = currentLatitude;
    selectedLongitude = currentLongitude;
    selectedNavigationLatitude = selectedLatitude;
    selectedNavigationLongitude = selectedLongitude;
    reviewStatus = 'manual_import';
    coordinateStatus = 'manual_confirmed';
    coordinateSource = 'Coordenada de origem confirmada na importacao';
    coordinatePrecisionLevel = 'manual';
    reviewReason = 'Coordenada de origem confirmada pelo administrador durante a importacao.';
  } else if (normalizedAction === 'manual') {
    selectedLatitude = Number(latitude);
    selectedLongitude = Number(longitude);
    if (!isValidCoordinates(selectedLatitude, selectedLongitude)) {
      throw new HttpsError('invalid-argument', 'Informe uma latitude e uma longitude validas.');
    }
    if (String(reason || '').trim().length < 5) {
      throw new HttpsError('invalid-argument', 'Explique a correcao manual em pelo menos 5 caracteres.');
    }
    selectedNavigationLatitude = selectedLatitude;
    selectedNavigationLongitude = selectedLongitude;
    reviewStatus = 'manual_import';
    coordinateStatus = 'manual_confirmed';
    coordinateSource = 'Correcao manual durante a importacao';
    coordinatePrecisionLevel = 'manual';
    reviewReason = String(reason).trim();
  } else {
    throw new HttpsError('invalid-argument', 'Acao de revisao de coordenada invalida.');
  }

  const coordinateReview = {
    status: reviewStatus,
    jobId,
    addressCanonicalKey: meta.canonicalKey || null,
    reason: reviewReason,
    reviewedAt,
    reviewedBy: userId,
    reviewedByName: profile?.name || profile?.email || 'Administrador',
    algorithmVersion: GEOCODING_ALGORITHM_VERSION,
  };
  const geocoding = {
    ...(meta.geocoding || {}),
    status: coordinateStatus,
    reason: reviewReason,
    reviewedAt,
    reviewedBy: userId,
    reviewedDuringImport: true,
    finalCoordinate: { latitude: selectedLatitude, longitude: selectedLongitude },
  };

  current.latitude = selectedLatitude;
  current.longitude = selectedLongitude;
  current.__meta = {
    ...meta,
    geocodedLatitude: normalizedAction === 'manual' ? selectedLatitude : (meta.geocodedLatitude ?? selectedLatitude),
    geocodedLongitude: normalizedAction === 'manual' ? selectedLongitude : (meta.geocodedLongitude ?? selectedLongitude),
    navigationLatitude: selectedNavigationLatitude,
    navigationLongitude: selectedNavigationLongitude,
    coordinateStatus,
    coordinateSource,
    coordinatePrecisionLevel,
    geocoding,
    geocodingReview: coordinateReview,
  };
  return current;
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
      const summary = previewCoordinateSummary(result.records, result.summary);

      const job = {
        id: jobId,
        status: 'preview_ready',
        createdAt: now,
        expiresAt: now + JOB_TTL_MS,
        createdBy: request.auth.uid,
        fileName,
        source: 'odoo_raw_export',
        summary,
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
        summary,
        audit: result.audit,
        // A resposta HTTP pode preservar os cabecalhos legiveis da planilha.
        // A codificacao e necessaria apenas para a copia temporaria no RTDB.
        records: result.records,
      };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);

/**
 * Registra a decisao do administrador ainda na previa da importacao. Esta
 * etapa reaproveita a proposta ja retornada pelo Mapbox e nunca faz uma nova
 * consulta de geocodificacao.
 */
exports.reviewOdooImportCoordinate = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
    maxInstances: 2,
    invoker: 'public',
  },
  async (request) => {
    try {
      const profile = await requireActiveAdmin(request);
      const jobId = String(request.data?.jobId || '').trim();
      const recordId = String(request.data?.recordId || '').trim();
      if (!jobId || !recordId) {
        throw new HttpsError('invalid-argument', 'Informe a previa e a oportunidade que sera revisada.');
      }

      const jobReference = database.ref(`leadImportJobs/${jobId}`);
      const jobSnapshot = await jobReference.get();
      const job = jobSnapshot.val();
      if (!job) throw new HttpsError('not-found', 'A previa expirou ou nao foi encontrada.');
      if (job.createdBy !== request.auth.uid) {
        throw new HttpsError('permission-denied', 'Apenas quem gerou esta previa pode revisar suas coordenadas.');
      }
      if (job.status !== 'preview_ready') {
        throw new HttpsError('failed-precondition', 'Esta previa ja foi importada e nao pode mais ser alterada.');
      }

      const storedRecords = Array.isArray(job.records) ? job.records : Object.values(job.records || {});
      const records = fromFirebaseSafeValue(storedRecords);
      const recordIndex = records.findIndex((record) => String(record?.ID || '').trim() === recordId);
      if (recordIndex < 0) {
        throw new HttpsError('not-found', 'A oportunidade solicitada nao pertence a esta previa.');
      }

      const reviewed = reviewedPreviewRecord(records[recordIndex], {
        action: request.data?.action,
        latitude: request.data?.latitude,
        longitude: request.data?.longitude,
        reason: request.data?.reason,
        jobId,
        userId: request.auth.uid,
        profile,
      });
      records[recordIndex] = reviewed;

      const audit = Array.isArray(job.audit) ? job.audit : Object.values(job.audit || {});
      audit.push({
        row: reviewed.__meta?.sourceRows?.join(', ') || null,
        id: reviewed.ID,
        minumCode: reviewed.ID,
        odooLeadId: reviewed['Odoo Lead ID'] || '',
        odooExternalId: reviewed['Odoo External ID'] || '',
        opportunity: reviewed.Opportunity || reviewed['Client - Name'] || reviewed.ID,
        stage: 'coordinate_review',
        status: 'FILLED',
        source: 'Revisao administrativa na importacao',
        fields: ['latitude', 'longitude'],
        details: reviewed.__meta?.geocodingReview?.reason || 'Coordenada revisada antes da importacao.',
      });
      const summary = previewCoordinateSummary(records, job.summary);
      await jobReference.update({
        records: compactPreview(records),
        audit: toFirebaseSafeValue(audit),
        summary,
        updatedAt: Date.now(),
        lastCoordinateReviewAt: Date.now(),
        lastCoordinateReviewBy: request.auth.uid,
      });

      return { record: reviewed, summary };
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
  {
    region: REGION,
    timeoutSeconds: 180,
    memory: '256MiB',
    maxInstances: 2,
    // O endpoint precisa aceitar a chamada do SDK Firebase no navegador. A
    // autorizacao comercial permanece restrita por requireActiveAdmin abaixo.
    invoker: 'public',
  },
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

      const storedRecords = Array.isArray(job.records) ? job.records : Object.values(job.records || {});
      const records = fromFirebaseSafeValue(storedRecords);
      if (!records.length) throw new HttpsError('failed-precondition', 'A prévia não contém oportunidades.');

      const customersReference = database.ref('customers');
      const customersSnapshot = await customersReference.get();
      const existingCustomers = customersSnapshot.val() || {};
      const importedAt = Date.now();
      const nextCustomers = {};

      records.forEach((record) => {
        const matchedCustomerKey = mode === 'merge'
          ? String(record.__meta?.matchedCustomerKey || '').trim()
          : '';
        const existingKey = matchedCustomerKey && existingCustomers[matchedCustomerKey]
          ? matchedCustomerKey
          : '';
        const existingCustomer = existingKey ? existingCustomers[existingKey] : null;
        const generatedFromOdoo = ['odoo_technical_id', 'odoo_external_id'].includes(record.__meta?.idSource);

        // Em uma exportacao direta do Odoo nao existe codigo Minum. Se o lead
        // ja esta no Firebase, conserva sua chave legada e apenas atualiza os
        // dados; se for novo, usa a chave deterministica odoo_lead_<id>.
        const minumCode = generatedFromOdoo && existingCustomer
          ? String(existingCustomer.minumCode || existingCustomer.externalId || record.ID || '').trim()
          : String(record.ID || '').trim();
        const key = existingKey || toFirebaseKey(minumCode);
        const incoming = {
          ...buildFirebaseCustomer(record, {
            jobId,
            importedBy: request.auth.uid,
            importedAt,
            minumCodeOverride: minumCode,
          }),
          id: key,
          externalId: minumCode,
          minumCode,
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
      const includeReviewed = request.data?.includeReviewed === true;
      const candidateIds = selectCustomerIdsForAudit(customers, { includeReviewed });
      const { id: jobId, reference: jobReference, job } = await loadOrCreateRevalidationJob(
        request,
        candidateIds,
        requestedJobId,
        {
          includeReviewed,
          skippedReviewedCount: Math.max(0, Object.keys(customers).length - candidateIds.length),
        },
      );
      const customerIds = Array.isArray(job.customerIds) ? job.customerIds : Object.keys(customers).sort();
      const startIndex = Math.max(0, Number(job.nextIndex) || 0);
      const batchSize = clampRevalidationBatchSize(request.data?.batchSize);
      const batchIds = customerIds.slice(startIndex, startIndex + batchSize);

      if (!batchIds.length) {
        const previousResults = (await jobReference.child('results').get()).val() || {};
        const summary = summarizeAudit(Object.values(previousResults));
        await jobReference.update({ status: 'completed', summary, completedAt: Date.now(), nextIndex: customerIds.length });
        return {
          jobId,
          status: 'completed',
          total: customerIds.length,
          processed: customerIds.length,
          scope: job.scope,
          skippedReviewedCount: job.skippedReviewedCount || 0,
          summary,
          results: [],
        };
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
        includeReviewed: job.scope === 'full',
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
        scope: job.scope,
        skippedReviewedCount: job.skippedReviewedCount || 0,
        summary,
        results: batchResults,
      };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);

/**
 * Processa feedbacks de visita no servidor. O job nao usa credenciais no app
 * nem no front-end e grava apenas o resultado da sincronizacao no evento.
 */
exports.syncPendingOdooVisitEvents = onSchedule(
  {
    region: REGION,
    schedule: 'every 5 minutes',
    timeZone: 'America/Sao_Paulo',
    memory: '256MiB',
    secrets: [ODOO_API_KEY],
  },
  async () => {
    if (!isOdooSyncEnabled()) {
      logger.info('Sincronizacao Odoo permanece desativada por configuracao.');
      return;
    }
    const summary = await syncQueuedOdooVisitEvents({
      database, odooClient: createRuntimeOdooClient(), maxEvents: odooSyncBatchSize(),
    });
    logger.info('Lote de feedbacks Odoo processado.', {
      scanned: summary.scanned,
      counts: summary.counts,
    });
  },
);

/**
 * Envia o feedback elegivel assim que ele e criado pelo aplicativo. O job
 * agendado continua como rede de seguranca para falhas temporarias,
 * indisponibilidade do Odoo ou eventos criados durante uma atualizacao.
 */
// Queue every feedback change, including retries, manual sends and deletions.
// Re-reading the canonical event in the worker handles out-of-order delivery.
exports.queueOdooVisitEvent = onValueWritten(
  { region: RTDB_TRIGGER_REGION, ref: '/visitEvents/{routeId}/{stopId}/{eventId}', retry: true },
  async (event) => {
    if (![event.data.before.val(), event.data.after.val()].some((value) => value?.eventType === 'feedback_submitted')) return;
    await enqueueOdooEvent(database, `visitEvents/${event.params.routeId}/${event.params.stopId}/${event.params.eventId}`);
  },
);

exports.projectSellerCustomer = onValueWritten(
  { region: RTDB_TRIGGER_REGION, ref: '/customers/{customerId}', retry: true },
  async (event) => projectCustomer(database, event.params.customerId),
);

exports.refreshSellerCustomers = onValueWritten(
  { region: RTDB_TRIGGER_REGION, ref: '/users/{uid}', retry: true },
  async (event) => {
    if (sellerIdentity(event.data.before.val()) === sellerIdentity(event.data.after.val())) return;
    await rebuildSellerCustomers(database, event.params.uid);
  },
);

exports.syncOdooVisitEventOnCreate = onValueCreated(
  {
    region: RTDB_TRIGGER_REGION,
    ref: '/visitEvents/{routeId}/{stopId}/{eventId}',
    memory: '256MiB',
    maxInstances: 2,
    concurrency: 1,
    secrets: [ODOO_API_KEY],
  },
  async (event) => {
    const feedback = event.data.val();
    const isEligible = String(feedback?.eventType || '').trim() === 'feedback_submitted'
      && Number.isSafeInteger(Number(feedback?.odooLeadId))
      && Number(feedback.odooLeadId) > 0
      && String(feedback?.odooSyncStatus || 'pending').trim() !== 'not_required';

    if (!isEligible) return;
    if (!isOdooSyncEnabled()) {
      logger.info('Feedback Odoo recebido enquanto a fila esta desativada.');
      return;
    }

    const path = `visitEvents/${event.params.routeId}/${event.params.stopId}/${event.params.eventId}`;
    try {
      const result = await processOdooVisitEvent({
        database,
        path,
        event: feedback,
        odooClient: createRuntimeOdooClient(),
      });
      logger.info('Feedback processado pela sincronizacao imediata Odoo.', {
        path,
        status: result.status,
      });
    } catch (error) {
      // O evento permanece pendente e o job de cinco minutos o retomara.
      logger.error('Falha inesperada na sincronizacao imediata de feedback Odoo.', {
        path,
        code: String(error?.code || 'odoo_immediate_sync_error'),
      });
    }
  },
);

/** Permite ao administrador testar um lote controlado apos configurar o Odoo. */
exports.processOdooVisitEvents = onCall(
  {
    region: REGION,
    timeoutSeconds: 180,
    memory: '256MiB',
    secrets: [ODOO_API_KEY],
  },
  async (request) => {
    await requireActiveAdmin(request);
    if (!isOdooSyncEnabled()) {
      throw new HttpsError(
        'failed-precondition',
        'A sincronizacao Odoo esta desativada. Valide o ambiente e habilite ODOO_SYNC_ENABLED=true no servidor.',
      );
    }
    const includeBlocked = request.data?.retryBlocked === true;
    return runOdooVisitSync({ includeBlocked });
  },
);

/**
 * Envia somente um feedback escolhido pelo administrador. Esta acao existe
 * para validar a integracao com um registro real do aplicativo sem ativar o
 * processamento automatico da fila inteira.
 */
exports.processSingleOdooVisitEvent = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
    // O SDK callable precisa atingir o endpoint; a autorizacao administrativa
    // continua obrigatoria dentro do handler.
    invoker: 'public',
    secrets: [ODOO_API_KEY],
  },
  async (request) => {
    await requireActiveAdmin(request);
    const routeId = readVisitEventPathPart(request.data?.routeId, 'identificador da rota');
    const stopId = readVisitEventPathPart(request.data?.stopId, 'identificador da parada');
    const eventId = readVisitEventPathPart(request.data?.eventId, 'identificador do feedback');
    const path = `visitEvents/${routeId}/${stopId}/${eventId}`;
    const eventSnapshot = await database.ref(path).get();
    const event = eventSnapshot.val();

    if (!event) {
      throw new HttpsError('not-found', 'O feedback selecionado nao foi encontrado no Firebase.');
    }
    if (String(event.eventType || '').trim() !== 'feedback_submitted') {
      throw new HttpsError('failed-precondition', 'Somente feedbacks de visita podem ser enviados ao Odoo.');
    }
    if (!Number.isSafeInteger(Number(event.odooLeadId)) || Number(event.odooLeadId) <= 0) {
      throw new HttpsError('failed-precondition', 'Este feedback nao possui um ID tecnico Odoo valido. Reimporte ou corrija o cliente antes de testar.');
    }
    if (String(event.odooSyncStatus || '').trim() === 'synced') {
      return {
        status: 'already_synced',
        path,
        odooActivityId: event.odooActivityId || null,
      };
    }

    const odooClient = createOdooClient({
      apiKey: readOdooApiKey(),
      env: odooRuntimeConfiguration(),
    });
    if (!odooClient.configuration.ready) {
      throw new HttpsError(
        'failed-precondition',
        'A integracao Odoo ainda nao possui a configuracao necessaria para enviar este feedback.',
      );
    }

    const result = await processOdooVisitEvent({
      database,
      path,
      event,
      odooClient,
      includeBlocked: request.data?.retryBlocked === true,
    });
    logger.info('Feedback individual enviado para validacao Odoo.', {
      status: result.status,
      path,
      requestedBy: request.auth.uid,
    });
    return result;
  },
);

/**
 * Cria uma unica atividade tecnica no lead combinado para validar a escrita
 * sem liberar o lote de feedbacks pendentes. O resumo fixo permite repetir o
 * teste sem duplicar atividades no Odoo.
 */
exports.createOdooIntegrationTestActivity = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [ODOO_API_KEY],
  },
  async (request) => {
    const profile = await requireActiveAdmin(request);
    const odooClient = createOdooClient({
      apiKey: readOdooApiKey(),
      env: odooRuntimeConfiguration(),
    });
    if (!odooClient.configuration.ready) {
      throw new HttpsError(
        'failed-precondition',
        'A integracao Odoo ainda nao possui a configuracao necessaria para criar a atividade de teste.',
      );
    }

    const activityId = await odooClient.ensureActivity({
      id: 'integration_test_crm_lead_58680',
      eventType: 'feedback_submitted',
      odooLeadId: 58680,
      odooActivitySummary: 'Minum | Teste de integracao',
      sellerName: String(profile?.name || request.auth?.token?.email || 'Administracao Minum'),
      feedback: 'Atividade tecnica idempotente para validar a integracao Minum com o CRM.',
      commercialOutcome: 'Teste de integracao',
      nextAction: 'Nenhuma acao comercial. Registro tecnico de validacao.',
    });

    logger.info('Atividade tecnica Odoo confirmada.', {
      leadId: 58680,
      activityId,
      requestedBy: request.auth.uid,
    });
    return {
      status: 'created_or_existing',
      leadId: 58680,
      activityId,
      summary: 'Minum | Teste de integracao',
    };
  },
);

/**
 * Teste administrativo sem escrita: autentica a instancia Odoo 18 via RPC,
 * localiza crm.lead, valida uma oportunidade conhecida e lista os tipos de
 * atividade disponiveis para configuracao.
 */
exports.verifyOdooIntegration = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [ODOO_API_KEY],
  },
  async (request) => {
    await requireActiveAdmin(request);
    const result = await verifyOdooJsonRpcConnection({
      apiKey: readOdooApiKey(),
      env: odooRuntimeConfiguration(),
      leadId: 58680,
    });
    logger.info('Verificacao segura da integracao Odoo concluida.', {
      status: result.status,
      available: result.available,
      baseUrl: result.baseUrl || null,
      attempts: result.attempts?.map((attempt) => ({
        baseUrl: attempt.baseUrl,
        code: attempt.code,
        status: attempt.status || null,
      })),
    });
    return result;
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
          addressCanonicalKey: result.canonicalKey || null,
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
        addressCanonicalKey: result.canonicalKey || null,
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
        [`customers/${customerId}/canonicalKey`]: result.canonicalKey || null,
        [`customers/${customerId}/normalizedAddress`]: result.normalizedAddress || null,
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

function textValue(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** A oportunidade identifica o prospecto; o contato nunca deve substitui-la. */
function primaryCustomerName(customer) {
  return textValue(customer?.opportunity)
    || textValue(customer?.name)
    || textValue(customer?.clientName)
    || textValue(customer?.contactName)
    || textValue(customer?.externalId)
    || textValue(customer?.id);
}

function addCustomerIdentity(index, type, value, customer) {
  const normalized = textValue(value);
  if (normalized) index.set(`${type}:${normalized}`, customer);
}

function buildCustomerNameIndex(customers) {
  const index = new Map();
  Object.entries(customers || {}).forEach(([key, rawCustomer]) => {
    const name = primaryCustomerName(rawCustomer);
    if (!name) return;

    const customer = {
      name,
      opportunity: textValue(rawCustomer?.opportunity),
      clientName: textValue(rawCustomer?.clientName) || textValue(rawCustomer?.contactName),
    };
    addCustomerIdentity(index, 'key', key, customer);
    addCustomerIdentity(index, 'id', rawCustomer?.id, customer);
    addCustomerIdentity(index, 'external', rawCustomer?.externalId, customer);
    addCustomerIdentity(index, 'minum', rawCustomer?.minumCode, customer);
    addCustomerIdentity(index, 'odoo', rawCustomer?.odooLeadId, customer);
    addCustomerIdentity(index, 'odooExternal', rawCustomer?.odooExternalId, customer);
  });
  return index;
}

function findCustomerForSnapshot(snapshot, customerIndex) {
  const identities = [
    ['key', snapshot?.customerKey],
    ['id', snapshot?.customerId],
    ['external', snapshot?.customerExternalId],
    ['external', snapshot?.externalId],
    ['minum', snapshot?.minumCode],
    ['odoo', snapshot?.odooLeadId],
    ['odooExternal', snapshot?.odooExternalId],
  ];
  for (const [type, value] of identities) {
    const customer = customerIndex.get(`${type}:${textValue(value)}`);
    if (customer) return customer;
  }
  return null;
}

function normalizeSnapshotNames(node, path, customerIndex, updates, counts) {
  if (!node || typeof node !== 'object') return;

  if (Object.prototype.hasOwnProperty.call(node, 'customerName')) {
    const customer = findCustomerForSnapshot(node, customerIndex);
    if (customer) {
      if (textValue(node.customerName) !== customer.name) {
        updates[`${path}/customerName`] = customer.name;
        counts.snapshotsUpdated += 1;
      }
      // Mantem as copias de rota autossuficientes para Android, historico e
      // relatorios mesmo quando o cadastro principal for removido no futuro.
      if (customer.opportunity && textValue(node.opportunity) !== customer.opportunity) {
        updates[`${path}/opportunity`] = customer.opportunity;
      }
      if (customer.clientName && !textValue(node.clientName)) {
        updates[`${path}/clientName`] = customer.clientName;
      }
    }
  }

  Object.entries(node).forEach(([childKey, childValue]) => {
    if (childValue && typeof childValue === 'object') {
      normalizeSnapshotNames(childValue, `${path}/${childKey}`, customerIndex, updates, counts);
    }
  });
}

/**
 * Corrige cadastros e copias historicas criadas antes da separacao entre
 * oportunidade e contato. A chamada e administrativa, idempotente e nao
 * altera dados de visita, localizacao ou feedback.
 */
exports.normalizeCustomerPrimaryNames = onCall(
  { region: REGION, timeoutSeconds: 120, memory: '512MiB', maxInstances: 1 },
  async (request) => {
    try {
      await requireActiveAdmin(request);
      const [
        customersSnapshot,
        plannedStopsSnapshot,
        sharedRoutesSnapshot,
        visitEventsSnapshot,
        visitAttendancesSnapshot,
      ] = await Promise.all([
        database.ref('customers').get(),
        database.ref('plannedRouteStops').get(),
        database.ref('sharedRoutesBySeller').get(),
        database.ref('visitEvents').get(),
        database.ref('visitAttendances').get(),
      ]);

      const customers = customersSnapshot.val() || {};
      const customerIndex = buildCustomerNameIndex(customers);
      const updates = {};
      const counts = { customersUpdated: 0, snapshotsUpdated: 0 };

      Object.entries(customers).forEach(([customerId, customer]) => {
        const primaryName = primaryCustomerName(customer);
        if (primaryName && textValue(customer?.name) !== primaryName) {
          updates[`customers/${customerId}/name`] = primaryName;
          counts.customersUpdated += 1;
        }
      });

      [
        ['plannedRouteStops', plannedStopsSnapshot.val()],
        ['sharedRoutesBySeller', sharedRoutesSnapshot.val()],
        ['visitEvents', visitEventsSnapshot.val()],
        ['visitAttendances', visitAttendancesSnapshot.val()],
      ].forEach(([path, node]) => normalizeSnapshotNames(node, path, customerIndex, updates, counts));

      const entries = Object.entries(updates);
      for (let index = 0; index < entries.length; index += 350) {
        await database.ref().update(Object.fromEntries(entries.slice(index, index + 350)));
      }

      logger.info('Normalizacao de nomes principais concluida.', {
        customersUpdated: counts.customersUpdated,
        snapshotsUpdated: counts.snapshotsUpdated,
        fieldsUpdated: entries.length,
      });
      return { ...counts, fieldsUpdated: entries.length };
    } catch (error) {
      throw toFunctionError(error);
    }
  },
);
