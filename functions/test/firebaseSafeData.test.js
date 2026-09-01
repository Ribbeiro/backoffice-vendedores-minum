const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fromFirebaseSafeValue,
  isFirebaseKeySafe,
  toFirebaseSafeValue,
} = require('../src/firebaseSafeData');
const { buildFirebaseCustomer } = require('../src/odooLeadProcessor');

function isFirebaseSafeValue(value) {
  if (Array.isArray(value)) return value.every(isFirebaseSafeValue);
  if (value && typeof value === 'object') {
    return Object.entries(value).every(([key, item]) => isFirebaseKeySafe(key) && isFirebaseSafeValue(item));
  }
  return true;
}

test('serializa e restaura chaves invalidas do Firebase sem perder campos', () => {
  const original = {
    '(CPF/CNPJ)': '47080938000122',
    'Odoo Lead ID': '64208',
    nested: {
      'origem/planilha': 'Odoo',
      'campo.com.ponto': 'mantido',
    },
    lista: [{ 'status#interno': 'ok' }],
  };

  const stored = toFirebaseSafeValue(original);
  assert.ok(Object.keys(stored).every(isFirebaseKeySafe));
  assert.ok(Object.keys(stored.nested).every(isFirebaseKeySafe));
  assert.ok(Object.keys(stored.lista[0]).every(isFirebaseKeySafe));
  assert.deepEqual(fromFirebaseSafeValue(stored), original);
});

test('prepara o campo raw do cliente para o Realtime Database', () => {
  const customer = buildFirebaseCustomer({
    Opportunity: 'Cliente de teste',
    '(CPF/CNPJ)': '47080938000122',
    ID: 'odoo_lead_64208',
    'Odoo Lead ID': '64208',
    __meta: {},
  }, {
    jobId: 'teste',
    importedBy: 'admin',
    importedAt: 1,
  });

  assert.ok(isFirebaseSafeValue(customer));
  assert.equal(fromFirebaseSafeValue(customer.raw)['(CPF/CNPJ)'], '47080938000122');
});
