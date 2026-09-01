const crypto = require('crypto');
const { OdooSyncError } = require('./odooClient');

const PROCESSING_LOCK_TTL_MS = 10 * 60 * 1000;
const RETRY_DELAYS_MS = [5, 15, 60, 360, 1_440].map((minutes) => minutes * 60 * 1000);

function text(value) {
  return String(value ?? '').trim();
}

function positiveIntegerOrNull(value) {
  const candidate = text(value);
  if (!/^\d+$/.test(candidate)) return null;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function uniqueText(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

/**
 * CPF e CNPJ sao usados apenas como identificadores completos e com um
 * namespace proprio. Isso impede colisao com codigos numericos de clientes,
 * rotas ou oportunidades e preserva zeros a esquerda quando existirem.
 */
function documentIdentity(value) {
  const digits = text(value).replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14 ? `document:${digits}` : '';
}

function eventDocument(event) {
  return [event?.customerCnpjCpf, event?.cnpjCpf, event?.cpfCnpj]
    .map((value) => documentIdentity(value).replace(/^document:/, ''))
    .find(Boolean) || '';
}

function eventMinumCode(event) {
  return [event?.customerExternalId, event?.minumCode, event?.externalId]
    .map((value) => text(value))
    .find((value) => /^[a-zA-Z0-9_-]{2,120}$/.test(value)) || '';
}

/**
 * Monta um indice apenas com identificadores estaveis ja presentes no Firebase.
 * Nomes, telefones e textos livres nao participam da conciliacao para evitar
 * que uma atividade seja criada na oportunidade errada do Odoo.
 */
function createCustomerOdooLinkResolver(customers = {}) {
  const identities = new Map();

  Object.entries(customers || {}).forEach(([customerKey, customer]) => {
    const odooLeadId = positiveIntegerOrNull(customer?.odooLeadId);
    if (!odooLeadId) return;

    const candidate = {
      odooLeadId,
      odooExternalId: text(customer?.odooExternalId) || null,
    };

    uniqueText([
      customerKey,
      customer?.id,
      customer?.externalId,
      customer?.minumCode,
      customer?.odooExternalId,
      customer?.odooLeadId,
      documentIdentity(customer?.cnpjCpf),
      documentIdentity(customer?.cpfCnpj),
    ]).forEach((identity) => {
      const matches = identities.get(identity) || [];
      if (!matches.some((entry) => entry.odooLeadId === candidate.odooLeadId)) {
        matches.push(candidate);
      }
      identities.set(identity, matches);
    });
  });

  return (event, path) => {
    if (positiveIntegerOrNull(event?.odooLeadId)) return null;
    const pathParts = text(path).split('/').filter(Boolean);
    const stopId = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : null;
    const matches = uniqueText([
      stopId,
      event?.customerKey,
      event?.customerId,
      event?.customerExternalId,
      event?.externalId,
      event?.minumCode,
      event?.odooExternalId,
      documentIdentity(event?.customerCnpjCpf),
      documentIdentity(event?.cnpjCpf),
      documentIdentity(event?.cpfCnpj),
    ]).flatMap((identity) => identities.get(identity) || []);
    const leadIds = [...new Set(matches.map((candidate) => candidate.odooLeadId))];

    if (leadIds.length !== 1) return null;
    const matchingExternalIds = uniqueText(matches
      .filter((candidate) => candidate.odooLeadId === leadIds[0])
      .map((candidate) => candidate.odooExternalId));

    return matchingExternalIds.length === 1
      ? { odooLeadId: leadIds[0], odooExternalId: matchingExternalIds[0] }
      : { odooLeadId: leadIds[0] };
  };
}

function applyResolvedOdooLink(event, path, resolveOdooLeadLink, now) {
  const resolved = resolveOdooLeadLink?.(event, path);
  if (!resolved) return { event, resolved: false };

  const { source, ...link } = resolved;

  const canUnblock = text(event?.odooSyncStatus) === 'blocked'
    && text(event?.odooBlockReason) === 'missing_odoo_lead_id';
  return {
    resolved: true,
    event: {
      ...event,
      ...link,
      odooSyncStatus: canUnblock ? 'pending' : event.odooSyncStatus,
      odooRetryCount: canUnblock ? 0 : event.odooRetryCount,
      odooNextRetryAt: canUnblock ? null : event.odooNextRetryAt,
      odooBlockReason: canUnblock ? null : event.odooBlockReason,
      odooBlockedAt: canUnblock ? null : event.odooBlockedAt,
      odooLastError: canUnblock ? null : event.odooLastError,
      odooLinkSource: source || 'customers_exact_identity',
      odooLinkResolvedAt: now,
    },
  };
}

function isFeedbackEvent(event) {
  return text(event?.eventType) === 'feedback_submitted'
    && (!event?.odooOperation || text(event.odooOperation) === 'create_activity');
}

function canTryEvent(event, now, includeBlocked) {
  const status = text(event?.odooSyncStatus || 'pending');
  if (status === 'pending') return true;
  if (status === 'failed') return Number(event.odooNextRetryAt || 0) <= now;
  if (status === 'processing') {
    return Number(event.odooProcessingStartedAt || 0) + PROCESSING_LOCK_TTL_MS <= now;
  }
  return includeBlocked && status === 'blocked';
}

function flattenVisitEvents(node, path = ['visitEvents'], records = []) {
  if (!node || typeof node !== 'object') return records;
  if (node.id && node.eventType) {
    records.push({ path: path.join('/'), event: node });
    return records;
  }
  Object.entries(node).forEach(([key, child]) => flattenVisitEvents(child, [...path, key], records));
  return records;
}

function sanitizedErrorCode(error) {
  const raw = text(error?.code || 'odoo_sync_error').toLowerCase();
  return raw.replace(/[^a-z0-9_:-]/g, '_').slice(0, 120) || 'odoo_sync_error';
}

function retryAt(retryCount, now) {
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(retryCount - 1, 0), RETRY_DELAYS_MS.length - 1)];
  return now + delay;
}

function configurationBlock(event, odooClient) {
  if (!positiveIntegerOrNull(event.odooLeadId)) return 'missing_odoo_lead_id';
  return null;
}

async function claimEvent(reference, odooClient, {
  now,
  includeBlocked,
  fallbackEvent = null,
  path,
  resolveOdooLeadLink = null,
}) {
  const lockId = crypto.randomUUID();
  const transaction = await reference.transaction((current) => {
    // Em Functions, uma transacao pode ser chamada primeiro com o cache local
    // vazio antes de receber o valor remoto. O evento lido previamente impede
    // que um feedback valido seja descartado como "skipped" nesse primeiro ciclo.
    const sourceEvent = current ?? fallbackEvent;
    const { event, resolved } = applyResolvedOdooLink(sourceEvent, path, resolveOdooLeadLink, now);
    if (!isFeedbackEvent(event) || !canTryEvent(event, now, includeBlocked)) return undefined;

    const blockReason = configurationBlock(event, odooClient);
    if (blockReason) {
      return {
        ...event,
        odooSyncStatus: 'blocked',
        odooBlockReason: blockReason,
        odooBlockedAt: now,
        odooProcessingLockId: null,
        odooProcessingStartedAt: null,
      };
    }

    return {
      ...event,
      odooSyncStatus: 'processing',
      odooProcessingLockId: lockId,
      odooProcessingStartedAt: now,
      odooLastError: null,
      odooOperation: 'create_activity',
      odooLinkResolved: resolved || Boolean(event.odooLinkSource),
      odooLinkResolvedFromCustomer: resolved
        ? text(event.odooLinkSource) === 'customers_exact_identity'
        : text(event.odooLinkSource) === 'customers_exact_identity',
    };
  });

  const event = transaction.snapshot.val();
  if (!transaction.committed || !event) return { action: 'skipped', event };
  if (text(event.odooSyncStatus) === 'blocked') return { action: 'blocked', event };
  if (event.odooProcessingLockId !== lockId) return { action: 'skipped', event };
  return { action: 'claimed', event, lockId };
}

async function finalizeClaim(reference, lockId, updater, fallbackEvent = null) {
  const transaction = await reference.transaction((current) => {
    const event = current ?? fallbackEvent;
    if (!event || event.odooProcessingLockId !== lockId) return undefined;
    return updater(event);
  });
  return transaction.committed ? transaction.snapshot.val() : null;
}

async function processOdooVisitEvent({
  database,
  path,
  event: suppliedEvent = null,
  odooClient,
  now = Date.now(),
  includeBlocked = false,
  resolveOdooLeadLink = null,
}) {
  // Uma configuracao incompleta e corrigivel pelo administrador. Nao devemos
  // mudar feedbacks pendentes para "blocked" apenas porque o ambiente ainda
  // nao foi ativado por completo.
  if (!odooClient?.configuration?.ready) {
    return {
      status: 'not_configured',
      path,
      configurationCode: odooClient?.configuration?.code || 'odoo_not_configured',
    };
  }

  const reference = database.ref(path);
  const event = suppliedEvent ?? (await reference.get()).val();
  if (!event) return { status: 'not_found', path };

  const claim = await claimEvent(reference, odooClient, {
    now,
    includeBlocked,
    fallbackEvent: event,
    path,
    resolveOdooLeadLink,
  });
  if (claim.action !== 'claimed') return { status: claim.action, path };

  try {
    const odooActivityId = await odooClient.ensureActivity(claim.event);
    const finalized = await finalizeClaim(reference, claim.lockId, (current) => ({
      ...current,
      odooSyncStatus: 'synced',
      odooActivityId,
      odooSyncedAt: Date.now(),
      odooLastError: null,
      odooBlockReason: null,
      odooNextRetryAt: null,
      odooProcessingLockId: null,
      odooProcessingStartedAt: null,
    }), claim.event);
    if (!finalized) {
      return { status: 'finalization_pending', path, odooActivityId };
    }
    return {
      status: 'synced',
      path,
      odooActivityId,
      odooLinkResolved: Boolean(claim.event.odooLinkResolved),
      odooLinkResolvedFromCustomer: Boolean(claim.event.odooLinkResolvedFromCustomer),
    };
  } catch (error) {
    const retryCount = Number(claim.event.odooRetryCount || 0) + 1;
    const retryable = error instanceof OdooSyncError ? error.retryable : true;
    const terminal = !retryable || retryCount > RETRY_DELAYS_MS.length;
    const errorCode = sanitizedErrorCode(error);
    const finalized = await finalizeClaim(reference, claim.lockId, (current) => ({
      ...current,
      odooSyncStatus: terminal ? 'blocked' : 'failed',
      odooRetryCount: retryCount,
      odooLastError: errorCode,
      odooLastErrorAt: Date.now(),
      odooBlockReason: terminal ? errorCode : null,
      odooBlockedAt: terminal ? Date.now() : null,
      odooNextRetryAt: terminal ? null : retryAt(retryCount, Date.now()),
      odooProcessingLockId: null,
      odooProcessingStartedAt: null,
    }), claim.event);
    return {
      status: finalized?.odooSyncStatus || (terminal ? 'blocked' : 'failed'),
      path,
      errorCode,
    };
  }
}

async function createOdooDocumentLinkResolver(records, odooClient) {
  const canLookupDocument = typeof odooClient?.findLeadByExactDocument === 'function';
  const canLookupMinumCode = typeof odooClient?.findLeadByExactExternalId === 'function';
  if (!canLookupDocument && !canLookupMinumCode) {
    return {
      resolve: () => null,
      stats: {
        documentAttempted: 0,
        documentResolved: 0,
        documentUnmatched: 0,
        documentErrors: 0,
        codeAttempted: 0,
        codeResolved: 0,
        codeUnmatched: 0,
        codeErrors: 0,
      },
    };
  }

  const unresolvedRecords = records
    .filter(({ event }) => isFeedbackEvent(event) && !positiveIntegerOrNull(event?.odooLeadId))
    .filter(({ event }) => text(event?.odooSyncStatus) !== 'not_required');
  const linksByDocument = new Map();
  const linksByMinumCode = new Map();
  const documents = uniqueText(unresolvedRecords.map(({ event }) => eventDocument(event)));
  const minumCodes = uniqueText(unresolvedRecords.map(({ event }) => eventMinumCode(event)));
  const stats = {
    documentAttempted: 0,
    documentResolved: 0,
    documentUnmatched: 0,
    documentErrors: 0,
    codeAttempted: 0,
    codeResolved: 0,
    codeUnmatched: 0,
    codeErrors: 0,
  };
  for (const document of documents) {
    if (!canLookupDocument) break;
    stats.documentAttempted += 1;
    try {
      const link = await odooClient.findLeadByExactDocument(document);
      if (positiveIntegerOrNull(link?.odooLeadId)) {
        linksByDocument.set(document, link);
        stats.documentResolved += 1;
      } else {
        stats.documentUnmatched += 1;
      }
    } catch {
      // A fila preserva o feedback bloqueado se o CRM estiver indisponível ou
      // se o usuário da integração não puder consultar o campo customizado.
      stats.documentErrors += 1;
    }
  }

  for (const code of minumCodes) {
    if (!canLookupMinumCode) break;
    stats.codeAttempted += 1;
    try {
      const link = await odooClient.findLeadByExactExternalId(code);
      if (positiveIntegerOrNull(link?.odooLeadId)) {
        linksByMinumCode.set(code, link);
        stats.codeResolved += 1;
      } else {
        stats.codeUnmatched += 1;
      }
    } catch {
      stats.codeErrors += 1;
    }
  }

  return {
    resolve: (event) => linksByDocument.get(eventDocument(event))
      || linksByMinumCode.get(eventMinumCode(event))
      || null,
    stats,
  };
}

async function syncPendingOdooVisitEvents({ database, odooClient, maxEvents = 20, includeBlocked = false, now = Date.now() }) {
  if (!odooClient?.configuration?.ready) {
    return {
      scanned: 0,
      counts: { not_configured: 1 },
      results: [],
      configurationCode: odooClient?.configuration?.code || 'odoo_not_configured',
    };
  }

  const [snapshot, customersSnapshot] = await Promise.all([
    database.ref('visitEvents').get(),
    database.ref('customers').get(),
  ]);
  const records = flattenVisitEvents(snapshot.val());
  const resolveCustomerOdooLink = createCustomerOdooLinkResolver(customersSnapshot.val() || {});
  const documentResolver = await createOdooDocumentLinkResolver(records, odooClient);
  const resolveOdooLeadLink = (event, path) => resolveCustomerOdooLink(event, path)
    || documentResolver.resolve(event, path);
  const candidates = records
    .filter(({ path, event }) => {
      const resolved = applyResolvedOdooLink(event, path, resolveOdooLeadLink, now);
      return isFeedbackEvent(resolved.event) && canTryEvent(resolved.event, now, includeBlocked);
    })
    .slice(0, Math.max(1, Math.min(100, Number(maxEvents) || 20)));

  const results = [];
  for (const candidate of candidates) {
    results.push(await processOdooVisitEvent({
      database,
      path: candidate.path,
      event: candidate.event,
      odooClient,
      now,
      includeBlocked,
      resolveOdooLeadLink,
    }));
  }

  const counts = results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    if (result.odooLinkResolvedFromCustomer) {
      summary.relinked_from_customer = (summary.relinked_from_customer || 0) + 1;
    }
    if (result.odooLinkResolved) {
      summary.relinked_to_odoo = (summary.relinked_to_odoo || 0) + 1;
    }
    return summary;
  }, {});
  if (documentResolver.stats.documentAttempted) {
    counts.odoo_document_lookup_attempted = documentResolver.stats.documentAttempted;
    counts.odoo_document_lookup_resolved = documentResolver.stats.documentResolved;
    counts.odoo_document_lookup_unmatched = documentResolver.stats.documentUnmatched;
    counts.odoo_document_lookup_errors = documentResolver.stats.documentErrors;
  }
  if (documentResolver.stats.codeAttempted) {
    counts.odoo_minum_code_lookup_attempted = documentResolver.stats.codeAttempted;
    counts.odoo_minum_code_lookup_resolved = documentResolver.stats.codeResolved;
    counts.odoo_minum_code_lookup_unmatched = documentResolver.stats.codeUnmatched;
    counts.odoo_minum_code_lookup_errors = documentResolver.stats.codeErrors;
  }
  return { scanned: candidates.length, counts, results };
}

module.exports = {
  RETRY_DELAYS_MS,
  canTryEvent,
  flattenVisitEvents,
  processOdooVisitEvent,
  syncPendingOdooVisitEvents,
};
