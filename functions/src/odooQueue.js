const crypto = require('crypto');
const { processOdooVisitEvent, canTryEvent } = require('./odooVisitSyncService');

const QUEUE_PATH = 'odooSyncQueue';
const LOCK_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const queueKey = (path) => crypto.createHash('sha256').update(path).digest('hex');

// Every source change wakes a small queue entry. A version prevents a worker
// from deleting a newer wake-up while it is processing the canonical event.
async function enqueueOdooEvent(database, path) {
  await database.ref(`${QUEUE_PATH}/${queueKey(path)}`).transaction((current) => ({
    path,
    version: (current?.version || 0) + 1,
    nextAttemptAt: 0,
  }));
}

function nextAttemptAt(event, now) {
  if (!event || event.eventType !== 'feedback_submitted') return null;
  const status = event.odooSyncStatus || 'pending';
  if (status === 'pending') return now;
  if (status === 'failed') return Number(event.odooNextRetryAt || now);
  if (status === 'processing') return Number(event.odooProcessingStartedAt || now) + LOCK_MS;
  // Legacy links can be repaired by later customer imports. Recheck these
  // individually once a day, without scanning customers or visit history.
  if (status === 'blocked' && event.odooBlockReason === 'missing_odoo_lead_id') return now + DAY_MS;
  return null;
}

async function resolveEventLink(database, event, odooClient) {
  if (Number.isSafeInteger(Number(event.odooLeadId)) && Number(event.odooLeadId) > 0) return null;
  const keys = [...new Set([event.customerKey, event.customerExternalId, event.customerId, event.minumCode]
    .map((value) => String(value || '').trim()).filter((key) => key && !/[.#$\[\]/]/.test(key)))];
  const candidates = [];
  for (const key of keys) {
    const customer = (await database.ref(`customers/${key}`).get()).val();
    if (Number.isSafeInteger(Number(customer?.odooLeadId)) && Number(customer.odooLeadId) > 0) {
      candidates.push({ odooLeadId: Number(customer.odooLeadId), odooExternalId: customer.odooExternalId || null });
    }
  }
  const leadIds = new Set(candidates.map((candidate) => candidate.odooLeadId));
  if (leadIds.size > 1) return null;
  if (leadIds.size === 1) return candidates[0];
  const document = String(event.customerCnpjCpf || event.cnpjCpf || event.cpfCnpj || '').replace(/\D/g, '');
  if ([11, 14].includes(document.length) && odooClient.findLeadByExactDocument) {
    const link = await odooClient.findLeadByExactDocument(document);
    if (link) return link;
  }
  const code = String(event.customerExternalId || event.minumCode || event.externalId || '');
  if (/^[a-zA-Z0-9_-]{2,120}$/.test(code) && odooClient.findLeadByExactExternalId) {
    return odooClient.findLeadByExactExternalId(code);
  }
  return null;
}

async function syncQueuedOdooVisitEvents({ database, odooClient, maxEvents = 20, now = Date.now() }) {
  if (!odooClient?.configuration?.ready) {
    return { scanned: 0, counts: { not_configured: 1 }, results: [] };
  }
  const limit = Math.max(1, Math.min(100, Number(maxEvents) || 20));
  const snapshot = await database.ref(QUEUE_PATH).orderByChild('nextAttemptAt').endAt(now).limitToFirst(limit).get();
  const entries = Object.entries(snapshot.val() || {});
  const results = [];
  for (const [key, entry] of entries) {
    const queueRef = database.ref(`${QUEUE_PATH}/${key}`);
    // Reserve entries so overlapping scheduled runs do not repeatedly read
    // the same event. The canonical event transaction still owns the Odoo lock.
    const lease = await queueRef.transaction((current) => {
      // The Admin SDK may first call the updater with an empty local cache.
      // Use the queried entry; Firebase retries against the server value.
      const candidate = current ?? entry;
      if (candidate.version !== entry.version || candidate.nextAttemptAt > now) return undefined;
      return { ...candidate, version: candidate.version + 1, nextAttemptAt: now + LOCK_MS };
    });
    if (!lease.committed) continue;
    const leaseVersion = lease.snapshot.val().version;
    let next = now + 5 * 60 * 1000;
    try {
      const event = (await database.ref(entry.path).get()).val();
      const missingLink = event?.odooSyncStatus === 'blocked' && event.odooBlockReason === 'missing_odoo_lead_id';
      if (event?.eventType === 'feedback_submitted' && (canTryEvent(event, now, false) || missingLink)) {
        const link = await resolveEventLink(database, event, odooClient);
        const result = await processOdooVisitEvent({
          database, path: entry.path, event, odooClient, now,
          resolveOdooLeadLink: () => link,
        });
        results.push(result);
      }
      next = nextAttemptAt((await database.ref(entry.path).get()).val(), now);
    } catch (error) {
      results.push({ path: entry.path, status: 'failed', errorCode: String(error.code || 'queue_processing_error') });
    }
    await queueRef.transaction((current) => {
      if (!current || current.version !== leaseVersion) return undefined;
      return next === null ? null : { ...current, nextAttemptAt: next };
    });
  }
  const counts = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  return { scanned: entries.length, counts, results };
}

module.exports = { enqueueOdooEvent, syncQueuedOdooVisitEvents, nextAttemptAt, queueKey };
