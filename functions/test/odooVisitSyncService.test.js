const test = require('node:test');
const assert = require('node:assert/strict');
const { OdooSyncError } = require('../src/odooClient');
const { processOdooVisitEvent, syncPendingOdooVisitEvents } = require('../src/odooVisitSyncService');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getAt(root, path) {
  return path.split('/').filter(Boolean).reduce((value, key) => value?.[key], root);
}

function setAt(root, path, value) {
  const parts = path.split('/').filter(Boolean);
  const last = parts.pop();
  const parent = parts.reduce((value, key) => {
    value[key] ||= {};
    return value[key];
  }, root);
  parent[last] = value;
}

function fakeDatabase(initial, { transactionStartsWithEmptyCache = false } = {}) {
  const root = clone(initial);
  return {
    root,
    ref(path = '') {
      return {
        async get() {
          return { val: () => clone(getAt(root, path)) };
        },
        async transaction(updater) {
          const current = clone(getAt(root, path));
          if (transactionStartsWithEmptyCache) {
            // Reproduz o primeiro callback de transacao sem o valor remoto.
            // A implementacao deve usar o evento lido previamente como fallback.
            const localProposal = updater(null);
            if (localProposal === undefined) {
              return { committed: false, snapshot: { val: () => current } };
            }
          }
          const next = updater(current);
          if (next === undefined) {
            return { committed: false, snapshot: { val: () => current } };
          }
          setAt(root, path, clone(next));
          return { committed: true, snapshot: { val: () => clone(next) } };
        },
      };
    },
  };
}

function pendingEvent() {
  return {
    id: 'event_1',
    eventType: 'feedback_submitted',
    odooOperation: 'create_activity',
    odooSyncStatus: 'pending',
    odooRetryCount: 0,
    odooLeadId: 58680,
  };
}

test('sincroniza uma vez e persiste o ID retornado pelo Odoo', async () => {
  const database = fakeDatabase({
    visitEvents: { route_1: { stop_1: { event_1: pendingEvent() } } },
  });
  const summary = await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async () => 456,
    },
    now: 100,
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(summary.counts.synced, 1);
  assert.equal(event.odooSyncStatus, 'synced');
  assert.equal(event.odooActivityId, 456);
});

test('processa somente o feedback escolhido no teste manual', async () => {
  const database = fakeDatabase({
    visitEvents: {
      route_1: {
        stop_1: {
          event_1: pendingEvent(),
          event_2: { ...pendingEvent(), id: 'event_2' },
        },
      },
    },
  });

  const result = await processOdooVisitEvent({
    database,
    path: 'visitEvents/route_1/stop_1/event_1',
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async () => 654,
    },
    now: 100,
  });

  assert.equal(result.status, 'synced');
  assert.equal(database.root.visitEvents.route_1.stop_1.event_1.odooActivityId, 654);
  assert.equal(database.root.visitEvents.route_1.stop_1.event_2.odooSyncStatus, 'pending');
});

test('sincroniza mesmo quando a transacao inicia sem cache local do Firebase', async () => {
  const database = fakeDatabase({
    visitEvents: { route_1: { stop_1: { event_1: pendingEvent() } } },
  }, { transactionStartsWithEmptyCache: true });

  const result = await processOdooVisitEvent({
    database,
    path: 'visitEvents/route_1/stop_1/event_1',
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async () => 777,
    },
    now: 100,
  });

  assert.equal(result.status, 'synced');
  assert.equal(database.root.visitEvents.route_1.stop_1.event_1.odooActivityId, 777);
  assert.equal(database.root.visitEvents.route_1.stop_1.event_1.odooSyncStatus, 'synced');
});

test('agenda retry para falha temporaria sem perder o evento', async () => {
  const database = fakeDatabase({
    visitEvents: { route_1: { stop_1: { event_1: pendingEvent() } } },
  });
  await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async () => {
        throw new OdooSyncError('odoo_http_429', 'rate limited', { retryable: true, status: 429 });
      },
    },
    now: 100,
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(event.odooSyncStatus, 'failed');
  assert.equal(event.odooRetryCount, 1);
  assert.ok(event.odooNextRetryAt > 100);
});

test('aguarda configuracao valida sem bloquear feedbacks pendentes', async () => {
  const database = fakeDatabase({
    visitEvents: { route_1: { stop_1: { event_1: pendingEvent() } } },
  });

  const summary = await syncPendingOdooVisitEvents({
    database,
    odooClient: { configuration: { ready: false, code: 'odoo_api_key_not_configured' } },
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(summary.counts.not_configured, 1);
  assert.equal(event.odooSyncStatus, 'pending');
});

test('bloqueia apenas o feedback sem o ID tecnico do Odoo', async () => {
  const eventWithoutLead = pendingEvent();
  delete eventWithoutLead.odooLeadId;
  const database = fakeDatabase({
    visitEvents: { route_1: { stop_1: { event_1: eventWithoutLead } } },
  });
  let called = false;

  const summary = await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async () => {
        called = true;
        return 1;
      },
    },
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(summary.counts.blocked, 1);
  assert.equal(event.odooSyncStatus, 'blocked');
  assert.equal(event.odooBlockReason, 'missing_odoo_lead_id');
  assert.equal(called, false);
});

test('recupera o ID tecnico de um feedback antigo somente por identificador exato do cliente', async () => {
  const eventWithoutLead = {
    ...pendingEvent(),
    customerId: 'cliente_1',
    odooSyncStatus: 'blocked',
    odooBlockReason: 'missing_odoo_lead_id',
  };
  delete eventWithoutLead.odooLeadId;
  const database = fakeDatabase({
    customers: {
      cliente_1: {
        id: 'cliente_1',
        odooLeadId: 58680,
        odooExternalId: '__export__.crm_lead_58680_test',
      },
    },
    visitEvents: { route_1: { stop_1: { event_1: eventWithoutLead } } },
  });

  const summary = await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async (event) => {
        assert.equal(event.odooLeadId, 58680);
        return 987;
      },
    },
    now: 100,
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(summary.counts.synced, 1);
  assert.equal(summary.counts.relinked_from_customer, 1);
  assert.equal(event.odooSyncStatus, 'synced');
  assert.equal(event.odooLeadId, 58680);
  assert.equal(event.odooLinkSource, 'customers_exact_identity');
});

test('recupera o ID tecnico por CPF/CNPJ completo quando ele aponta para uma unica oportunidade', async () => {
  const eventWithoutLead = {
    ...pendingEvent(),
    customerCnpjCpf: '24.752.339/0001-02',
    odooSyncStatus: 'blocked',
    odooBlockReason: 'missing_odoo_lead_id',
  };
  delete eventWithoutLead.odooLeadId;
  const database = fakeDatabase({
    customers: {
      cliente_1: {
        cnpjCpf: '24752339000102',
        odooLeadId: 58680,
      },
    },
    visitEvents: { route_1: { stop_1: { event_1: eventWithoutLead } } },
  });

  const summary = await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async (event) => {
        assert.equal(event.odooLeadId, 58680);
        return 988;
      },
    },
    now: 100,
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(summary.counts.synced, 1);
  assert.equal(event.odooSyncStatus, 'synced');
  assert.equal(event.odooLeadId, 58680);
});

test('consulta o CRM por CPF/CNPJ completo quando o cliente legado nao existe mais na base atual', async () => {
  const eventWithoutLead = {
    ...pendingEvent(),
    customerCnpjCpf: '24752339000102',
    odooSyncStatus: 'blocked',
    odooBlockReason: 'missing_odoo_lead_id',
  };
  delete eventWithoutLead.odooLeadId;
  const database = fakeDatabase({
    visitEvents: { route_1: { stop_1: { event_1: eventWithoutLead } } },
  });

  const summary = await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      findLeadByExactDocument: async (document) => {
        assert.equal(document, '24752339000102');
        return { odooLeadId: 58680, source: 'odoo_exact_document' };
      },
      ensureActivity: async (event) => {
        assert.equal(event.odooLeadId, 58680);
        return 989;
      },
    },
    now: 100,
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(summary.counts.synced, 1);
  assert.equal(summary.counts.relinked_to_odoo, 1);
  assert.equal(summary.counts.odoo_document_lookup_attempted, 1);
  assert.equal(summary.counts.odoo_document_lookup_resolved, 1);
  assert.equal(event.odooLinkSource, 'odoo_exact_document');
  assert.equal(event.odooSyncStatus, 'synced');
});

test('consulta o CRM pelo codigo Minum completo quando o feedback legado nao possui CPF/CNPJ', async () => {
  const eventWithoutLead = {
    ...pendingEvent(),
    customerExternalId: 'CL12345',
    odooSyncStatus: 'blocked',
    odooBlockReason: 'missing_odoo_lead_id',
  };
  delete eventWithoutLead.odooLeadId;
  const database = fakeDatabase({
    visitEvents: { route_1: { stop_1: { event_1: eventWithoutLead } } },
  });

  const summary = await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      findLeadByExactExternalId: async (code) => {
        assert.equal(code, 'CL12345');
        return { odooLeadId: 58680, source: 'odoo_exact_minum_code' };
      },
      ensureActivity: async () => 990,
    },
    now: 100,
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(summary.counts.synced, 1);
  assert.equal(summary.counts.odoo_minum_code_lookup_attempted, 1);
  assert.equal(summary.counts.odoo_minum_code_lookup_resolved, 1);
  assert.equal(event.odooLinkSource, 'odoo_exact_minum_code');
  assert.equal(event.odooSyncStatus, 'synced');
});

test('nao recupera o ID Odoo por CPF/CNPJ quando o documento e compartilhado por oportunidades diferentes', async () => {
  const eventWithoutLead = {
    ...pendingEvent(),
    customerCnpjCpf: '24.752.339/0001-02',
  };
  delete eventWithoutLead.odooLeadId;
  const database = fakeDatabase({
    customers: {
      cliente_1: { cnpjCpf: '24752339000102', odooLeadId: 101 },
      cliente_2: { cnpjCpf: '24.752.339/0001-02', odooLeadId: 202 },
    },
    visitEvents: { route_1: { stop_1: { event_1: eventWithoutLead } } },
  });
  let called = false;

  await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async () => {
        called = true;
        return 1;
      },
    },
    now: 100,
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(event.odooSyncStatus, 'blocked');
  assert.equal(event.odooBlockReason, 'missing_odoo_lead_id');
  assert.equal(called, false);
});

test('nao recupera o ID Odoo quando o identificador aponta para oportunidades diferentes', async () => {
  const eventWithoutLead = {
    ...pendingEvent(),
    customerId: 'duplicado',
  };
  delete eventWithoutLead.odooLeadId;
  const database = fakeDatabase({
    customers: {
      cliente_1: { externalId: 'duplicado', odooLeadId: 101 },
      cliente_2: { externalId: 'duplicado', odooLeadId: 202 },
    },
    visitEvents: { route_1: { stop_1: { event_1: eventWithoutLead } } },
  });
  let called = false;

  await syncPendingOdooVisitEvents({
    database,
    odooClient: {
      configuration: { ready: true },
      ensureActivity: async () => {
        called = true;
        return 1;
      },
    },
    now: 100,
  });

  const event = database.root.visitEvents.route_1.stop_1.event_1;
  assert.equal(event.odooSyncStatus, 'blocked');
  assert.equal(event.odooBlockReason, 'missing_odoo_lead_id');
  assert.equal(called, false);
});
