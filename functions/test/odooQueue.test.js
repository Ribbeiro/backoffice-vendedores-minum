const test = require('node:test');
const assert = require('node:assert/strict');
const { enqueueOdooEvent, syncQueuedOdooVisitEvents, nextAttemptAt, queueKey } = require('../src/odooQueue');

function fakeDatabase(initial, { emptyTransactionCache = false } = {}) {
  const root = structuredClone(initial);
  const reads = [];
  const read = (path) => path.split('/').reduce((value, key) => value?.[key], root);
  const write = (path, value) => {
    const parts = path.split('/');
    const last = parts.pop();
    const parent = parts.reduce((node, key) => (node[key] ||= {}), root);
    if (value === null) delete parent[last]; else parent[last] = structuredClone(value);
  };
  return {
    root, reads,
    ref(path) {
      let order, end, limit;
      return {
        orderByChild(key) { order = key; return this; },
        endAt(value) { end = value; return this; },
        limitToFirst(value) { limit = value; return this; },
        async get() {
          reads.push(path);
          assert.notEqual(path, 'customers', 'must never scan all customers');
          assert.notEqual(path, 'visitEvents', 'must never scan event history');
          let value = structuredClone(read(path));
          if (order) value = Object.fromEntries(Object.entries(value || {})
            .filter(([, item]) => item[order] <= end)
            .sort(([, a], [, b]) => a[order] - b[order]).slice(0, limit));
          return { val: () => value };
        },
        async transaction(update) {
          if (emptyTransactionCache && update(null) === undefined) {
            return { committed: false, snapshot: { val: () => read(path) } };
          }
          const next = update(structuredClone(read(path)) ?? null);
          if (next === undefined) return { committed: false, snapshot: { val: () => read(path) } };
          write(path, next);
          return { committed: true, snapshot: { val: () => next } };
        },
      };
    },
  };
}

const path = 'visitEvents/r/s/e';
const feedback = { id: 'e', eventType: 'feedback_submitted', odooSyncStatus: 'pending', odooLeadId: 123 };
const client = { configuration: { ready: true }, ensureActivity: async () => 987 };

test('empty queue reads only its bounded index, regardless of historical volume', async () => {
  const database = fakeDatabase({ visitEvents: { r: { s: { e: feedback } } } });
  const result = await syncQueuedOdooVisitEvents({ database, odooClient: client });
  assert.equal(result.scanned, 0);
  assert.deepEqual(database.reads, ['odooSyncQueue']);
});

test('queued feedback is sent once and removed; repeated wakes do not duplicate it', async () => {
  const database = fakeDatabase({ visitEvents: { r: { s: { e: feedback } } } });
  let calls = 0;
  const odooClient = { ...client, ensureActivity: async () => { calls++; return 987; } };
  await enqueueOdooEvent(database, path);
  await syncQueuedOdooVisitEvents({ database, odooClient });
  await enqueueOdooEvent(database, path);
  await syncQueuedOdooVisitEvents({ database, odooClient });
  assert.equal(calls, 1);
  assert.equal(database.root.visitEvents.r.s.e.odooActivityId, 987);
  assert.deepEqual(database.root.odooSyncQueue, {});
});

test('new wake during processing survives the old worker cleanup', async () => {
  const database = fakeDatabase({ visitEvents: { r: { s: { e: feedback } } } });
  await enqueueOdooEvent(database, path);
  await syncQueuedOdooVisitEvents({ database, odooClient: {
    ...client, ensureActivity: async () => { await enqueueOdooEvent(database, path); return 987; },
  } });
  assert.equal(database.root.odooSyncQueue[queueKey(path)].version, 3);
});

test('temporary failure waits until retry date instead of reprocessing every tick', async () => {
  const database = fakeDatabase({ visitEvents: { r: { s: { e: feedback } } } });
  await enqueueOdooEvent(database, path);
  await syncQueuedOdooVisitEvents({ database, odooClient: { ...client, ensureActivity: async () => { throw new Error('offline'); } } });
  const due = database.root.odooSyncQueue[queueKey(path)].nextAttemptAt;
  assert.ok(due > Date.now());
  const result = await syncQueuedOdooVisitEvents({ database, odooClient: client, now: due - 1 });
  assert.equal(result.scanned, 0);
  const retry = await syncQueuedOdooVisitEvents({ database, odooClient: client, now: due + 1 });
  assert.equal(retry.counts.synced, 1);
});

test('deleted feedback leaves no queue entry and cannot be recreated', async () => {
  const database = fakeDatabase({});
  await enqueueOdooEvent(database, path);
  await syncQueuedOdooVisitEvents({ database, odooClient: client });
  assert.deepEqual(database.root.odooSyncQueue, {});
});

test('disabled configuration preserves queued feedback without database reads', async () => {
  const database = fakeDatabase({});
  await enqueueOdooEvent(database, path);
  await syncQueuedOdooVisitEvents({ database, odooClient: { configuration: { ready: false } } });
  assert.equal(database.reads.length, 0);
  assert.ok(database.root.odooSyncQueue[queueKey(path)]);
});

test('worker respects batch size and resolves only the referenced customer', async () => {
  const database = fakeDatabase({ customers: { c1: { odooLeadId: 123 } }, visitEvents: { r: { s: {
    e: { ...feedback, odooLeadId: null, customerExternalId: 'c1' }, e2: { ...feedback, id: 'e2' },
  } } } });
  await enqueueOdooEvent(database, path);
  await enqueueOdooEvent(database, 'visitEvents/r/s/e2');
  const result = await syncQueuedOdooVisitEvents({ database, odooClient: client, maxEvents: 1 });
  assert.equal(result.scanned, 1);
  assert.equal(result.counts.synced, 1);
  assert.ok(database.reads.includes('customers/c1'));
  assert.equal(Object.keys(database.root.odooSyncQueue).length, 1);
});

test('in-flight locks and missing links retain scheduled recovery', () => {
  assert.equal(nextAttemptAt({ ...feedback, odooSyncStatus: 'processing', odooProcessingStartedAt: 50 }, 100), 600050);
  assert.equal(nextAttemptAt({ ...feedback, odooSyncStatus: 'blocked', odooBlockReason: 'missing_odoo_lead_id' }, 100), 86400100);
  assert.equal(nextAttemptAt({ ...feedback, odooSyncStatus: 'synced' }, 100), null);
});

test('cold Admin transaction cache does not prevent acquiring a queued item', async () => {
  const database = fakeDatabase({
    visitEvents: { r: { s: { e: feedback } } },
    odooSyncQueue: { [queueKey(path)]: { path, version: 1, nextAttemptAt: 0 } },
  }, { emptyTransactionCache: true });
  const result = await syncQueuedOdooVisitEvents({ database, odooClient: client });
  assert.equal(result.counts.synced, 1);
});
