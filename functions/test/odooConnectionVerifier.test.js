const test = require('node:test');
const assert = require('node:assert/strict');
const {
  verifyOdooJson2Connection,
  verifyOdooJsonRpcConnection,
} = require('../src/odooConnectionVerifier');

function response(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}

test('descobre o modelo crm.lead e os tipos de atividade sem criar registros', async () => {
  const calls = [];
  const result = await verifyOdooJson2Connection({
    apiKey: 'test-api-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response([{ id: 42, model: 'crm.lead', name: 'Lead/Opportunity' }]);
      return response([{ id: 7, name: 'A Fazer', category: 'default' }]);
    },
  });

  assert.equal(result.status, 'json2_available');
  assert.equal(result.crmLeadModelId, 42);
  assert.deepEqual(result.activityTypes, [{ id: 7, name: 'A Fazer', category: 'default' }]);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/odoo\/json\/2\/ir.model\/search_read$/);
  assert.equal(calls[0].options.headers.Authorization, 'bearer test-api-key');
});

test('nao devolve chave quando os endpoints JSON-2 nao respondem', async () => {
  const result = await verifyOdooJson2Connection({
    apiKey: 'test-api-key',
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
  });

  assert.equal(result.status, 'json2_unavailable');
  assert.equal(result.available, false);
  assert.equal(result.attempts.length, 2);
  assert.equal(JSON.stringify(result).includes('test-api-key'), false);
});

test('descobre o banco unico e repete a verificacao JSON-2 com o cabecalho correto', async () => {
  const calls = [];
  const result = await verifyOdooJson2Connection({
    apiKey: 'test-api-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return { ok: false, status: 400, text: async () => '' };
      if (calls.length === 2) return response(['minum_producao']);
      if (calls.length === 3) return response([{ id: 42, model: 'crm.lead', name: 'Lead/Opportunity' }]);
      return response([{ id: 7, name: 'A Fazer', category: 'default' }]);
    },
  });

  assert.equal(result.status, 'json2_available');
  assert.equal(result.database, 'minum_producao');
  assert.equal(calls.length, 4);
  assert.match(calls[1].url, /\/odoo\/json\/2\/odoo\.database\/list$/);
  assert.equal(calls[1].options.headers['X-Odoo-Database'], 'openerp');
  assert.equal(calls[2].options.headers['X-Odoo-Database'], 'minum_producao');
});

test('usa o controller web/database/list quando o servico JSON-2 administrativo nao esta exposto', async () => {
  const calls = [];
  const result = await verifyOdooJson2Connection({
    apiKey: 'test-api-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return { ok: false, status: 400, text: async () => '' };
      if (calls.length === 2) return { ok: false, status: 404, text: async () => '' };
      if (calls.length === 3) return response({ result: ['minum_producao'] });
      if (calls.length === 4) return response([{ id: 42, model: 'crm.lead', name: 'Lead/Opportunity' }]);
      return response([{ id: 7, name: 'A Fazer', category: 'default' }]);
    },
  });

  assert.equal(result.status, 'json2_available');
  assert.equal(result.database, 'minum_producao');
  assert.match(calls[2].url, /\/odoo\/web\/database\/list$/);
  assert.equal(calls[2].options.headers['Content-Type'], 'application/json-rpc');
});

test('autentica no Odoo 18 via JSON-RPC e le crm.lead sem criar atividade', async () => {
  const calls = [];
  const result = await verifyOdooJsonRpcConnection({
    apiKey: 'test-api-key',
    env: {
      ODOO_BASE_URL: 'https://portal.example.com/odoo',
      ODOO_DATABASE: 'minum_producao',
      ODOO_LOGIN: 'integracao@example.com',
      ODOO_VERSION: '18.0+e',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response({ result: { server_version: '18.0+e' } });
      if (calls.length === 2) return response({ result: 14 });
      return response({ result: [{ id: 58680, name: 'Oportunidade de teste', activity_state: false }] });
    },
  });

  assert.equal(result.status, 'jsonrpc_available');
  assert.equal(result.baseUrl, 'https://portal.example.com/odoo');
  assert.equal(result.serverVersion, '18.0+e');
  assert.equal(result.userId, 14);
  assert.equal(result.authenticationMethod, 'authenticate');
  assert.equal(result.leadId, 58680);
  assert.equal(result.leadName, 'Oportunidade de teste');
  assert.equal(result.activityScheduling, 'crm_lead_activity_schedule');
  assert.deepEqual(result.activityTypes, []);
  assert.match(calls[1].url, /\/odoo\/jsonrpc$/);
  const authenticateRequest = JSON.parse(calls[1].options.body);
  assert.deepEqual(authenticateRequest.params.args, [
    'minum_producao',
    'integracao@example.com',
    'test-api-key',
    {},
  ]);
  const leadReadRequest = JSON.parse(calls[2].options.body);
  assert.equal(leadReadRequest.params.args[3], 'crm.lead');
  assert.equal(leadReadRequest.params.args[4], 'read');
});

test('classifica AccessDenied do RPC sem devolver detalhes da chave', async () => {
  const result = await verifyOdooJsonRpcConnection({
    apiKey: 'test-api-key',
    env: {
      ODOO_BASE_URL: 'https://portal.example.com',
      ODOO_DATABASE: 'minum_producao',
      ODOO_LOGIN: 'integracao@example.com',
    },
    fetchImpl: async (url, options) => {
      if (url.endsWith('/odoo/jsonrpc')) {
        return { ok: false, status: 400, text: async () => '' };
      }
      const method = JSON.parse(options.body).params.method;
      if (method === 'version') return response({ result: { server_version: '18.0+e' } });
      return response({
        error: {
          message: 'Odoo Server Error',
          data: { name: 'odoo.exceptions.AccessDenied', message: 'Access Denied' },
        },
      });
    },
  });

  assert.equal(result.available, false);
  assert.equal(result.attempts[0].code, 'rpc_auth_failed');
  assert.match(result.nextRequirement, /chave de API/i);
  assert.equal(JSON.stringify(result).includes('test-api-key'), false);
});
