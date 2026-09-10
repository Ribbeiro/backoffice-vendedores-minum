import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, set, update } from 'firebase/database';

const projectId = 'vendedores-minum-rules-test';
const sellerUid = 'seller-1';
const routeId = 'route-1';
const stopId = 'stop-1';
const customerExternalId = 'MINUM-42';
let testEnvironment;

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: await readFile(new URL('../database.rules.json', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearDatabase();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database()), {
      users: {
        [sellerUid]: {
          active: true,
          deleted: false,
          allowedAccess: true,
          role: 'vendedor',
        },
        'seller-2': {
          active: true,
          deleted: false,
          allowedAccess: true,
          role: 'vendedor',
        },
      },
      customers: {
        [customerExternalId]: {
          externalId: customerExternalId,
          minumCode: customerExternalId,
          odooLeadId: 58_680,
        },
      },
      customersBySeller: {
        [sellerUid]: {
          [customerExternalId]: {
            externalId: customerExternalId,
            minumCode: customerExternalId,
            odooLeadId: 58_680,
          },
        },
      },
      plannedRoutes: {
        [routeId]: { sellerUid },
      },
      plannedRouteStops: {
        [routeId]: {
          [stopId]: {
            customerId: 42,
            customerExternalId,
          },
        },
      },
    });
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

test('accepts the real check-in payload without Odoo identifiers', async () => {
  await assertSucceeds(writeEvent('check-in-1', eventPayload('check_in')));
});

test('accepts linked feedback and check-out in the same atomic update', async () => {
  const database = sellerDatabase();
  await assertSucceeds(update(ref(database), {
    [`visitEvents/${routeId}/${stopId}/feedback-1`]: eventPayload('feedback_submitted', {
      id: 'feedback-1',
      feedback: 'Cliente visitado',
      odooLeadId: 58_680,
      odooSyncStatus: 'pending',
      odooOperation: 'create_activity',
    }),
    [`visitEvents/${routeId}/${stopId}/check-out-1`]: eventPayload('check_out', {
      id: 'check-out-1',
    }),
  }));
});

test('accepts feedback without an Odoo link as not required', async () => {
  await assertSucceeds(writeEvent('feedback-unlinked', eventPayload('feedback_submitted', {
    id: 'feedback-unlinked',
    feedback: 'Sem oportunidade vinculada',
  })));
});

test('keeps compatibility with the installed APK pending feedback without a lead id', async () => {
  await assertSucceeds(writeEvent('feedback-legacy', eventPayload('feedback_submitted', {
    id: 'feedback-legacy',
    feedback: 'Payload do APK anterior',
    odooSyncStatus: 'pending',
    odooOperation: 'create_activity',
  })));
});

test('rejects legacy pending feedback forged for a different route customer', async () => {
  const write = writeEvent('feedback-forged', eventPayload('feedback_submitted', {
    id: 'feedback-forged',
    customerId: 999,
    customerExternalId: 'OTHER-CUSTOMER',
    feedback: 'Nao pertence a parada',
    odooSyncStatus: 'pending',
    odooOperation: 'create_activity',
  }));
  await assertFails(write);
});

test('rejects Odoo identifiers on check-in and check-out events', async () => {
  await assertFails(writeEvent('check-in-invalid', eventPayload('check_in', {
    id: 'check-in-invalid',
    odooLeadId: 58_680,
  })));
  await assertFails(writeEvent('check-out-invalid', eventPayload('check_out', {
    id: 'check-out-invalid',
    odooLeadId: 58_680,
  })));
});

test('rejects events written by a seller who does not own the route', async () => {
  const database = testEnvironment.authenticatedContext('seller-2').database();
  const write = set(
    ref(database, `visitEvents/${routeId}/${stopId}/foreign-event`),
    eventPayload('check_in', { id: 'foreign-event', sellerUid: 'seller-2' }),
  );
  await assertFails(write);
});

function sellerDatabase() {
  return testEnvironment.authenticatedContext(sellerUid).database();
}

function writeEvent(eventId, payload) {
  return set(ref(sellerDatabase(), `visitEvents/${routeId}/${stopId}/${eventId}`), {
    ...payload,
    id: eventId,
  });
}

function eventPayload(eventType, overrides = {}) {
  return {
    id: 'event-1',
    routeId,
    stopId,
    customerId: 42,
    customerExternalId,
    customerName: 'Empresa Minum',
    sellerUid,
    eventType,
    location: {
      latitude: -20.4697,
      longitude: -54.6201,
      accuracyMeters: 8.5,
    },
    createdAt: 1_788_972_400_000,
    odooSyncStatus: 'not_required',
    odooRetryCount: 0,
    ...overrides,
  };
}
