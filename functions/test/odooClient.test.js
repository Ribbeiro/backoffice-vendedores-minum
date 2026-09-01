const test = require('node:test');
const assert = require('node:assert/strict');
const { createOdooClient, readOdooConfiguration } = require('../src/odooClient');

function response(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    text: async () => '',
  };
}

function configuredClient(fetchImpl) {
  return createOdooClient({
    apiKey: 'test-api-key',
    env: {
      ODOO_PROTOCOL: 'json2',
      ODOO_BASE_URL: 'https://odoo.example.test/odoo',
      ODOO_CRM_LEAD_MODEL_ID: '123',
      ODOO_ACTIVITY_TYPE_ID: '7',
    },
    fetchImpl,
  });
}

function configuredRpcClient(fetchImpl) {
  return createOdooClient({
    apiKey: 'test-api-key',
    env: {
      ODOO_PROTOCOL: 'jsonrpc',
      ODOO_BASE_URL: 'https://odoo.example.test/odoo',
      ODOO_DATABASE: 'minum_producao',
      ODOO_LOGIN: 'integracao@example.com',
    },
    fetchImpl,
  });
}

test('bloqueia o adapter quando o segredo Odoo nao esta disponivel', () => {
  const configuration = readOdooConfiguration({
    apiKey: '',
    env: { ODOO_PROTOCOL: 'json2' },
  });

  assert.equal(configuration.ready, false);
  assert.equal(configuration.code, 'odoo_api_key_not_configured');
});

test('JSON-2 procura a atividade pelo eventId antes de criar uma nova', async () => {
  const calls = [];
  const client = configuredClient(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response([]) : response(321);
  });

  const id = await client.ensureActivity({
    id: 'event_1',
    odooLeadId: 58680,
    sellerName: 'Vendedor de teste',
    feedback: 'Visita concluida com interesse.',
  });

  assert.equal(id, 321);
  assert.match(calls[0].url, /\/odoo\/json\/2\/mail.activity\/search_read$/);
  assert.match(calls[1].url, /\/odoo\/json\/2\/mail.activity\/create$/);
  assert.equal(calls[0].options.headers.Authorization, 'bearer test-api-key');
  assert.match(calls[1].options.body, /minum_event_id:event_1/);
});

test('reaproveita atividade existente e evita duplicidade em nova tentativa', async () => {
  const calls = [];
  const client = configuredClient(async (url, options) => {
    calls.push({ url, options });
    return response([{ id: 654 }]);
  });

  const id = await client.ensureActivity({ id: 'event_repetido', odooLeadId: 58680 });

  assert.equal(id, 654);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /mail.activity\/search_read$/);
});

test('mantem credenciais renovaveis e falhas temporarias na fila sem expor a resposta do Odoo', async () => {
  for (const [status, retryable] of [[401, true], [403, true], [404, false], [429, true], [500, true]]) {
    const client = configuredClient(async () => errorResponse(status));

    await assert.rejects(
      () => client.ensureActivity({ id: `event_${status}`, odooLeadId: 58680 }),
      (error) => error.code === `odoo_http_${status}` && error.retryable === retryable,
    );
  }
});

test('JSON-RPC reprocessa a autenticacao quando a chave pode ter sido renovada', async () => {
  const client = configuredRpcClient(async () => response({ result: false }));

  await assert.rejects(
    () => client.ensureActivity({ id: 'event_chave_renovada', odooLeadId: 58680 }),
    (error) => error.code === 'odoo_rpc_auth_failed' && error.retryable === true,
  );
});

test('trata interrupcao da requisicao como timeout com nova tentativa', async () => {
  const client = configuredClient(async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });

  await assert.rejects(
    () => client.ensureActivity({ id: 'event_timeout', odooLeadId: 58680 }),
    (error) => error.code === 'odoo_timeout' && error.retryable === true,
  );
});

test('JSON-RPC usa login como fallback quando authenticate nao retorna usuario', async () => {
  const calls = [];
  const client = configuredRpcClient(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return response({ result: false });
    if (calls.length === 2) return response({ result: 19 });
    if (calls.length === 3) return response({ result: [] });
    return response({ result: [321] });
  });

  const id = await client.ensureActivity({ id: 'event_rpc', odooLeadId: 58680 });

  assert.equal(id, 321);
  assert.equal(calls.length, 4);
  const methods = calls.slice(0, 2).map((call) => JSON.parse(call.options.body).params.method);
  assert.deepEqual(methods, ['authenticate', 'login']);
  assert.match(calls[0].url, /\/odoo\/jsonrpc$/);
  const searchRequest = JSON.parse(calls[2].options.body);
  assert.equal(searchRequest.params.args[3], 'mail.activity');
  assert.equal(searchRequest.params.args[4], 'search_read');
  const scheduleRequest = JSON.parse(calls[3].options.body);
  assert.equal(scheduleRequest.params.args[3], 'crm.lead');
  assert.equal(scheduleRequest.params.args[4], 'activity_schedule');
  assert.deepEqual(scheduleRequest.params.args[5], [[58680]]);
  assert.equal(scheduleRequest.params.args[6].activity_type_id, undefined);
});

test('JSON-RPC recupera a atividade por resumo quando activity_schedule nao devolve ID', async () => {
  const calls = [];
  const client = configuredRpcClient(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return response({ result: 19 });
    if (calls.length === 2) return response({ result: [] });
    if (calls.length === 3) return response({ result: false });
    return response({ result: [{ id: 654 }] });
  });

  const id = await client.ensureActivity({ id: 'event_sem_retorno', odooLeadId: 58680 });

  assert.equal(id, 654);
  assert.equal(calls.length, 4);
  const retrySearchRequest = JSON.parse(calls[3].options.body);
  assert.equal(retrySearchRequest.params.args[3], 'mail.activity');
  assert.equal(retrySearchRequest.params.args[4], 'search_read');
});

test('JSON-RPC encontra oportunidade somente por CPF/CNPJ completo em campo confirmado', async () => {
  const calls = [];
  const client = configuredRpcClient(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return response({ result: 19 });
    if (calls.length === 2) {
      return response({
        result: {
          x_cpf_cnpj: { string: 'CPF/CNPJ Number', type: 'char' },
          name: { string: 'Opportunity', type: 'char' },
        },
      });
    }
    return response({ result: [{ id: 58680, x_cpf_cnpj: '24.752.339/0001-02' }] });
  });

  const link = await client.findLeadByExactDocument('24752339000102');

  assert.deepEqual(link, { odooLeadId: 58680, source: 'odoo_exact_document' });
  const fieldRequest = JSON.parse(calls[1].options.body);
  assert.equal(fieldRequest.params.args[4], 'fields_get');
  const searchRequest = JSON.parse(calls[2].options.body);
  assert.equal(searchRequest.params.args[4], 'search_read');
  assert.deepEqual(searchRequest.params.args[6].fields, ['id', 'x_cpf_cnpj']);
});

test('JSON-RPC encontra oportunidade somente pelo codigo Minum em campo confirmado', async () => {
  const calls = [];
  const client = configuredRpcClient(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return response({ result: 19 });
    if (calls.length === 2) {
      return response({
        result: {
          x_codigo_minum: { string: 'Codigo do sistema MINUM', type: 'char' },
          name: { string: 'Opportunity', type: 'char' },
        },
      });
    }
    return response({ result: [{ id: 58680, x_codigo_minum: 'CL12345' }] });
  });

  const link = await client.findLeadByExactExternalId('CL12345');

  assert.deepEqual(link, { odooLeadId: 58680, source: 'odoo_exact_minum_code' });
  const searchRequest = JSON.parse(calls[2].options.body);
  assert.equal(searchRequest.params.args[4], 'search_read');
  assert.deepEqual(searchRequest.params.args[6].fields, ['id', 'x_codigo_minum']);
});
