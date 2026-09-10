import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomer } from '../src/utils/helpers.js';
import { expectedRevenueValue, parseMoneyValue } from '../src/utils/money.js';

test('interpreta os formatos monetarios usados nas exportacoes Odoo', () => {
  assert.equal(parseMoneyValue('15.000'), 15000);
  assert.equal(parseMoneyValue('15.000,00'), 15000);
  assert.equal(parseMoneyValue('15,000.00'), 15000);
  assert.equal(parseMoneyValue('15000.00'), 15000);
  assert.equal(parseMoneyValue('R$ 15.000,00'), 15000);
  assert.equal(parseMoneyValue('15,50'), 15.5);
});

test('corrige a exibicao de clientes ja salvos com o valor numerico incorreto', () => {
  assert.equal(expectedRevenueValue({
    expectedRevenue: '15.000',
    expectedRevenueValue: 15,
  }), 15000);
});

test('normaliza nova importacao de quinze mil sem alterar o texto de origem', () => {
  const customer = normalizeCustomer({
    ID: 'CL-RECEITA',
    Opportunity: 'Cliente receita',
    'Deal - Expected Revenue': '15.000',
  }, 0);

  assert.equal(customer.expectedRevenue, '15.000');
  assert.equal(customer.expectedRevenueValue, 15000);
});
