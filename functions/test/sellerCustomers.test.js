const test = require('node:test');
const assert = require('node:assert/strict');
const { isCustomerAssignedToSeller } = require('../src/sellerCustomerAssignment');
const { projectCustomer, rebuildSellerCustomers, customerProjection, sellerIdentity } = require('../src/sellerCustomers');

function fakeDatabase(root) {
  const writes = [];
  return {
    writes,
    ref(path = '') {
      return {
        get: async () => ({ val: () => path.split('/').filter(Boolean).reduce((value, key) => value?.[key], root) }),
        update: async (value) => writes.push({ path, value }),
        set: async (value) => writes.push({ path, value }),
        remove: async () => writes.push({ path, value: null }),
      };
    },
  };
}

const seller = { active: true, name: 'Joao da Silva', email: 'joao@minum.com', role: 'vendedor' };
test('assignment keeps accented names, first/last names, multiple assignees and email compatibility', () => {
  assert.equal(isCustomerAssignedToSeller({ responsible: 'JOÃO SILVA' }, seller), true);
  assert.equal(isCustomerAssignedToSeller({ responsibleSalesperson: 'Maria Santos; JOAO@MINUM.COM' }, seller), true);
  assert.equal(isCustomerAssignedToSeller({ responsible: 'Joao Souza' }, seller), false);
});

test('reassignment removes the former seller copy and writes only the new seller copy', async () => {
  const database = fakeDatabase({ customers: { c1: { responsible: seller.name, latitude: -20, longitude: -54 } },
    users: { u1: seller, u2: { ...seller, name: 'Maria Santos', email: 'maria@minum.com' }, u3: { ...seller, active: false } } });
  await projectCustomer(database, 'c1');
  const updates = database.writes[0].value;
  assert.equal(updates['customersBySeller/u1/c1'].latitude, -20);
  assert.equal(updates['customersBySeller/u2/c1'], null);
  assert.equal(updates['customersBySeller/u3/c1'], null);
});

test('customer deletion clears each seller copy', async () => {
  const database = fakeDatabase({ users: { u1: seller, u2: seller } });
  await projectCustomer(database, 'c1');
  assert.deepEqual(database.writes[0].value, { 'customersBySeller/u1/c1': null, 'customersBySeller/u2/c1': null });
});

test('disabled or deleted profile clears its complete projection', async () => {
  for (const profile of [null, { ...seller, active: false }, { ...seller, deleted: true }, { ...seller, allowedAccess: false }]) {
    const database = fakeDatabase({ users: { u1: profile } });
    await rebuildSellerCustomers(database, 'u1');
    assert.deepEqual(database.writes, [{ path: 'customersBySeller/u1', value: null }]);
  }
});

test('navigation and audit status survive removal of the bulky provider response', () => {
  const projected = customerProjection({ latitude: -20, longitude: -54,
    geocoding: { navigationCoordinate: { latitude: -20.1, longitude: -54.1 }, status: 'confirmed', provider: 'mapbox', accuracy: 'rooftop', response: 'large' } });
  assert.equal(projected.navigationLatitude, -20.1);
  assert.equal(projected.coordinateStatus, 'confirmed');
  assert.equal(projected.geocoding, undefined);
});

test('telemetry or unrelated profile changes do not trigger a full wallet rebuild', () => {
  assert.equal(sellerIdentity(seller), sellerIdentity({ ...seller, updatedAt: 123, lastLogin: 456 }));
  assert.notEqual(sellerIdentity(seller), sellerIdentity({ ...seller, name: 'Maria' }));
});

test('backend matcher stays identical to the backoffice assignment matcher', async () => {
  const { isCustomerAssignedToSeller: frontend } = await import('../../src/utils/sellerCustomerAssignment.js');
  for (const responsible of ['João Silva', 'Joao da Silva', 'joao@minum.com', 'Maria / JOAO SILVA', 'Joao Souza', '', 'Joao']) {
    const customer = { responsible };
    assert.equal(isCustomerAssignedToSeller(customer, seller), frontend(customer, seller));
  }
});
