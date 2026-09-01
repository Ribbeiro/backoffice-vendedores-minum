const DEFAULT_TIMEOUT_MS = 15_000;

// O portal informado e testado somente em caminhos conhecidos. O callable nao
// aceita URL arbitraria do navegador para evitar que ele seja usado como proxy.
const ODOO_BASE_CANDIDATES = Object.freeze([
  'https://portal.minum.com.br/odoo',
  'https://portal.minum.com.br',
]);

function text(value) {
  return String(value ?? '').trim();
}

function normalizeBaseUrl(value) {
  return text(value).replace(/\/+$/, '');
}

function sanitizedCode(status) {
  return Number.isFinite(Number(status)) ? `http_${Number(status)}` : 'request_failed';
}

function requestError(code, message, status = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

// Odoo devolve falhas RPC com HTTP 200. A interface administrativa precisa
// orientar a correcao certa sem expor o texto bruto, o traceback ou qualquer
// argumento da chamada que possa conter a chave de API.
function rpcFaultCode(fault) {
  const summary = [
    text(fault?.data?.name),
    text(fault?.data?.message),
    text(fault?.message),
  ].join(' ').toLowerCase();

  if (/accessdenied|access denied|authentication|invalid api|invalid password/.test(summary)) {
    return 'rpc_auth_failed';
  }
  if (/accesserror|permission|forbidden|not allowed/.test(summary)) {
    return 'rpc_permission_denied';
  }
  if (/database|unknown db|db.*not.*exist/.test(summary)) {
    return 'rpc_database_failed';
  }
  if (/attributeerror|method.*not.*found|unknown method/.test(summary)) {
    return 'rpc_method_unavailable';
  }
  return 'rpc_error';
}

async function postJson(url, {
  apiKey,
  body,
  headers = {},
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        ...(text(apiKey) ? { Authorization: `bearer ${apiKey}` } : {}),
        'User-Agent': 'Minum-Odoo-Connection-Check/1.0',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      // Respostas HTML de login/proxy nao sao devolvidas ao administrador.
    }
    if (!response.ok) {
      throw requestError(sanitizedCode(response.status), `Odoo respondeu HTTP ${response.status}.`, response.status);
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw requestError('timeout', 'A verificacao do Odoo excedeu o tempo limite.');
    }
    if (error?.code) throw error;
    throw requestError('network_error', 'Nao foi possivel conectar ao Odoo.');
  } finally {
    clearTimeout(timeout);
  }
}

function json2Url(baseUrl, model, method) {
  const prefix = normalizeBaseUrl(baseUrl);
  return `${prefix}/json/2/${encodeURIComponent(model)}/${encodeURIComponent(method)}`;
}

function jsonRpcUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/jsonrpc`;
}

async function callJson2(baseUrl, model, method, body, { database, ...options } = {}) {
  return postJson(json2Url(baseUrl, model, method), {
    ...options,
    body,
    headers: text(database) ? { 'X-Odoo-Database': text(database) } : {},
  });
}

async function callJsonRpc(baseUrl, service, method, args, options = {}) {
  const requestOptions = { ...options };
  // No Odoo 18 a chave de API ocupa a posicao de senha nos argumentos RPC.
  // Removemos o header Bearer para manter o transporte exatamente no formato
  // documentado e nao depender de comportamento do proxy reverso.
  delete requestOptions.apiKey;
  const payload = await postJson(jsonRpcUrl(baseUrl), {
    ...requestOptions,
    body: {
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: 1,
    },
  });
  if (payload?.error) {
    const code = rpcFaultCode(payload.error);
    throw requestError(
      code,
      'Odoo recusou a verificacao RPC.',
      code === 'rpc_auth_failed' ? 401 : null,
    );
  }
  return payload?.result;
}

async function callWebDatabaseList(baseUrl, options) {
  const payload = await postJson(`${normalizeBaseUrl(baseUrl)}/web/database/list`, {
    ...options,
    // O controller legado aceita um objeto JSON vazio e devolve a lista em
    // `result`. O content type especifico evita o redirecionamento para login.
    body: {},
    headers: { 'Content-Type': 'application/json-rpc' },
  });
  return payload?.result ?? payload;
}

function normalizeActivityTypes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: Number(item?.id),
      name: text(item?.name),
      category: text(item?.category),
    }))
    .filter((item) => Number.isSafeInteger(item.id) && item.id > 0 && item.name)
    .slice(0, 20);
}

function normalizeDatabaseNames(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(text)
    .filter((name) => /^[a-zA-Z0-9_-]{1,80}$/.test(name))
    .slice(0, 8);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function rpcBaseCandidates(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return [];
  const odooPath = normalized.endsWith('/odoo')
    ? normalized
    : `${normalized}/odoo`;
  return [...new Set([normalized, odooPath])];
}

async function executeKw(baseUrl, {
  apiKey,
  database,
  userId,
  model,
  method,
  args,
  kwargs = {},
  fetchImpl,
}) {
  return callJsonRpc(baseUrl, 'object', 'execute_kw', [
    database,
    userId,
    apiKey,
    model,
    method,
    args,
    kwargs,
  ], { apiKey, fetchImpl });
}

async function verifyJson2AtBase(baseUrl, { apiKey, database, fetchImpl }) {
  const models = await callJson2(
    baseUrl,
    'ir.model',
    'search_read',
    {
      domain: [['model', '=', 'crm.lead']],
      fields: ['id', 'model', 'name'],
      limit: 1,
    },
    { apiKey, database, fetchImpl },
  );
  const crmLead = Array.isArray(models)
    ? models.find((model) => text(model?.model) === 'crm.lead')
    : null;

  if (!crmLead || !Number.isSafeInteger(Number(crmLead.id)) || Number(crmLead.id) <= 0) {
    throw requestError('crm_lead_model_not_found', 'O modelo crm.lead nao foi encontrado.');
  }

  const activityTypes = await callJson2(
    baseUrl,
    'mail.activity.type',
    'search_read',
    {
      domain: [],
      fields: ['id', 'name', 'category'],
      limit: 20,
      order: 'name asc',
    },
    { apiKey, database, fetchImpl },
  );

  return {
    status: 'json2_available',
    available: true,
    protocol: 'json2',
    baseUrl,
    ...(text(database) ? { database: text(database) } : {}),
    crmLeadModelId: Number(crmLead.id),
    crmLeadModelName: text(crmLead.name) || 'crm.lead',
    activityTypes: normalizeActivityTypes(activityTypes),
  };
}

async function discoverDatabaseNames(baseUrl, options) {
  const discoverers = [
    // Odoo 19 oferece o model administrativo documentado para este fim. O
    // banco `openerp` e o banco de servico usado pelo endpoint no exemplo oficial.
    () => callJson2(baseUrl, 'odoo.database', 'list', {}, { ...options, database: 'openerp' }),
    // Versoes anteriores expoem a mesma lista no controller do Database Manager.
    () => callWebDatabaseList(baseUrl, options),
    // Ultima alternativa para instalacoes que ainda mantem o servico JSON-RPC.
    () => callJsonRpc(baseUrl, 'db', 'list', [], options),
  ];

  for (const discover of discoverers) {
    try {
      const databases = normalizeDatabaseNames(await discover());
      if (databases.length) return databases;
    } catch {
      // Em ambientes produtivos a listagem costuma ser bloqueada. Isso nao e erro
      // da chave e a integracao continua podendo usar um banco informado pelo admin.
    }
  }
  return [];
}

/**
 * Descobre a API JSON-2 sem criar registros. Se a instancia exigir o nome do
 * banco, tenta obtê-lo pela API publica de bancos e reexecuta a leitura com o
 * cabecalho X-Odoo-Database. Nenhuma chave ou resposta bruta e devolvida.
 */
async function verifyOdooJson2Connection({ apiKey, fetchImpl = fetch } = {}) {
  if (!text(apiKey)) {
    return { status: 'secret_not_available', available: false, attempts: [] };
  }

  const attempts = [];
  for (const baseUrl of ODOO_BASE_CANDIDATES) {
    try {
      return {
        ...(await verifyJson2AtBase(baseUrl, { apiKey, fetchImpl })),
        attempts,
      };
    } catch (error) {
      attempts.push({
        baseUrl,
        code: text(error?.code) || 'request_failed',
        status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
      });

      // HTTP 400 e o retorno normal de instancias multi-banco quando falta o
      // cabecalho X-Odoo-Database. Tentamos descobrir o unico banco disponivel
      // antes de pedir qualquer dado adicional ao administrador.
      if (text(error?.code) !== 'http_400') continue;

      const databases = await discoverDatabaseNames(baseUrl, { apiKey, fetchImpl });
      for (const database of databases) {
        try {
          return {
            ...(await verifyJson2AtBase(baseUrl, { apiKey, database, fetchImpl })),
            attempts,
          };
        } catch (databaseError) {
          attempts.push({
            baseUrl,
            code: `database_${text(databaseError?.code) || 'request_failed'}`,
            status: Number.isFinite(Number(databaseError?.status)) ? Number(databaseError.status) : null,
          });
        }
      }
    }
  }

  return {
    status: 'json2_unavailable',
    available: false,
    attempts,
    nextRequirement: 'Confirme ODOO_DATABASE. Se a sua instancia nao for Odoo 19 ou nao expuser JSON-2, informe tambem ODOO_LOGIN para testar JSON-RPC.',
  };
}

/**
 * Verifica o protocolo oficial de Odoo 18 sem gravar registros: autentica o
 * usuario da integracao e le uma oportunidade conhecida. O fluxo evita
 * consultar ir.model: esse modelo tecnico costuma ser inacessivel a usuarios
 * comerciais, enquanto crm.lead.activity_schedule resolve o modelo internamente.
 */
async function verifyOdooJsonRpcConnection({
  apiKey,
  env = process.env,
  fetchImpl = fetch,
  leadId = 58680,
} = {}) {
  const database = text(env.ODOO_DATABASE);
  const login = text(env.ODOO_LOGIN);
  const configuredBaseUrl = normalizeBaseUrl(env.ODOO_BASE_URL);
  const numericLeadId = positiveInteger(leadId);

  if (!text(apiKey) || !database || !login || !configuredBaseUrl || !numericLeadId) {
    return {
      status: 'jsonrpc_configuration_incomplete',
      available: false,
      attempts: [],
      nextRequirement: 'Configure ODOO_BASE_URL, ODOO_DATABASE e ODOO_LOGIN no servidor.',
    };
  }

  const attempts = [];
  const detectedVersions = {};
  for (const baseUrl of rpcBaseCandidates(configuredBaseUrl)) {
    try {
      const version = await callJsonRpc(baseUrl, 'common', 'version', [], { fetchImpl });
      const serverVersion = text(version?.server_version || version?.version);
      if (serverVersion) detectedVersions[baseUrl] = serverVersion;

      let authenticationMethod = 'authenticate';
      let userId = positiveInteger(await callJsonRpc(
        baseUrl,
        'common',
        'authenticate',
        [database, login, apiKey, {}],
        { apiKey, fetchImpl },
      ));
      if (!userId) {
        authenticationMethod = 'login';
        userId = positiveInteger(await callJsonRpc(
          baseUrl,
          'common',
          'login',
          [database, login, apiKey],
          { apiKey, fetchImpl },
        ));
      }
      if (!userId) {
        throw requestError('rpc_auth_failed', 'Odoo nao autenticou a integracao.', 401);
      }

      const leads = await executeKw(baseUrl, {
        apiKey,
        database,
        userId,
        model: 'crm.lead',
        method: 'read',
        args: [[numericLeadId]],
        kwargs: { fields: ['id', 'name', 'activity_state'] },
        fetchImpl,
      });
      const lead = Array.isArray(leads)
        ? leads.find((item) => positiveInteger(item?.id) === numericLeadId)
        : null;
      if (!lead) {
        throw requestError('crm_lead_not_readable', `A oportunidade ${numericLeadId} nao foi localizada para este usuario.`);
      }

      return {
        status: 'jsonrpc_available',
        available: true,
        protocol: 'jsonrpc',
        baseUrl,
        database,
        serverVersion: serverVersion || text(env.ODOO_VERSION) || null,
        userId,
        authenticationMethod,
        crmLeadModelName: 'crm.lead',
        leadId: numericLeadId,
        leadName: text(lead?.name) || null,
        activityScheduling: 'crm_lead_activity_schedule',
        activityTypes: [],
        attempts,
      };
    } catch (error) {
      attempts.push({
        baseUrl,
        code: text(error?.code) || 'request_failed',
        status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
      });
    }
  }

  return {
    status: 'jsonrpc_unavailable',
    available: false,
    protocol: 'jsonrpc',
    attempts,
    detectedVersions,
    nextRequirement: attempts.some((attempt) => attempt.code === 'rpc_auth_failed')
      ? 'A chave de API foi recusada pelo Odoo. Gere ou confirme uma chave pertencente ao login configurado.'
      : attempts.some((attempt) => attempt.code === 'rpc_permission_denied')
        ? 'O usuario autenticou, mas precisa ler a oportunidade de teste no CRM e usar Atividades.'
        : attempts.some((attempt) => attempt.code === 'rpc_database_failed')
          ? 'O Odoo nao reconheceu o banco configurado. Confirme ODOO_DATABASE no servidor.'
          : 'Verifique se o usuario da API possui acesso a CRM e a Atividades.',
  };
}

module.exports = {
  ODOO_BASE_CANDIDATES,
  verifyOdooJsonRpcConnection,
  verifyOdooJson2Connection,
};
