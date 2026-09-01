const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Erro sanitizado para que o worker decida entre retry e bloqueio sem registrar
 * corpo de resposta, chave de API ou detalhes internos do Odoo no Firebase.
 */
class OdooSyncError extends Error {
  constructor(code, message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'OdooSyncError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function positiveIntegerOrNull(value) {
  const candidate = text(value);
  if (!/^\d+$/.test(candidate)) return null;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function documentDigits(value) {
  const digits = text(value).replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14 ? digits : '';
}

function documentVariants(value) {
  const digits = documentDigits(value);
  if (!digits) return [];
  if (digits.length === 11) {
    return [digits, `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`];
  }
  return [
    digits,
    `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`,
  ];
}

function externalIdentifier(value) {
  const candidate = text(value);
  return /^[a-zA-Z0-9_-]{2,120}$/.test(candidate) ? candidate : '';
}

function normalizedFieldToken(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function isDocumentField(fieldName, definition) {
  const type = text(definition?.type).toLowerCase();
  if (!['char', 'text'].includes(type)) return false;
  const haystack = [fieldName, definition?.string, definition?.help]
    .map(normalizedFieldToken)
    .join(' ');
  return /cpf|cnpj/.test(haystack);
}

function isMinumCodeField(fieldName, definition) {
  const type = text(definition?.type).toLowerCase();
  if (!['char', 'text'].includes(type)) return false;
  const haystack = [fieldName, definition?.string, definition?.help]
    .map(normalizedFieldToken)
    .join(' ');
  return /minum|externalid|codigo.*sistema/.test(haystack);
}

function normalizeBaseUrl(value) {
  return text(value).replace(/\/+$/, '');
}

function isRetryableHttpStatus(status) {
  // A chave de API da instancia atual pode ser renovada diariamente. Um 401
  // ou 403 deve aguardar a nova chave com backoff em vez de descartar o
  // feedback de campo como erro definitivo logo na primeira tentativa.
  return status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Le somente configuracoes server-side. A URL candidata recebida do usuario
 * nao e assumida aqui: o administrador precisa confirmar e configurar o host
 * e o protocolo efetivamente publicados pelo Odoo/proxy.
 */
function readOdooConfiguration({ apiKey, env = process.env } = {}) {
  const protocol = text(env.ODOO_PROTOCOL).toLowerCase();
  const baseUrl = normalizeBaseUrl(env.ODOO_BASE_URL);
  const crmLeadModelId = positiveIntegerOrNull(env.ODOO_CRM_LEAD_MODEL_ID);
  const activityTypeId = positiveIntegerOrNull(env.ODOO_ACTIVITY_TYPE_ID);
  const defaultUserId = positiveIntegerOrNull(env.ODOO_DEFAULT_USER_ID);

  if (!text(apiKey)) {
    return { ready: false, code: 'odoo_api_key_not_configured' };
  }
  if (!baseUrl) {
    return { ready: false, code: 'odoo_base_url_not_configured' };
  }
  if (!['json2', 'jsonrpc'].includes(protocol)) {
    return { ready: false, code: 'odoo_protocol_not_confirmed' };
  }
  // JSON-2 cria o registro mail.activity diretamente e precisa dos IDs
  // tecnicos. No Odoo 18 via JSON-RPC usamos crm.lead.activity_schedule(),
  // que resolve o modelo internamente e funciona para usuarios comerciais.
  if (protocol === 'json2' && !crmLeadModelId) {
    return { ready: false, code: 'odoo_crm_lead_model_id_not_configured' };
  }
  if (protocol === 'json2' && !activityTypeId) {
    return { ready: false, code: 'odoo_activity_type_id_not_configured' };
  }
  if (protocol === 'jsonrpc' && (!text(env.ODOO_DATABASE) || !text(env.ODOO_LOGIN))) {
    return { ready: false, code: 'odoo_rpc_credentials_not_configured' };
  }

  return {
    ready: true,
    protocol,
    baseUrl,
    apiKey: text(apiKey),
    database: text(env.ODOO_DATABASE),
    login: text(env.ODOO_LOGIN),
    crmLeadModelId,
    activityTypeId,
    defaultUserId,
  };
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildActivityValues(event, configuration) {
  const summary = text(event?.odooActivitySummary) || `Minum | Visita ${event.id}`;
  const feedback = escapeHtml(event.feedback || event.notVisitedReason || 'Sem observacao adicional.');
  const status = escapeHtml(event.visitStatus || 'registrado');
  const seller = escapeHtml(event.sellerName || event.sellerEmail || event.sellerUid || 'Vendedor Minum');
  const nextAction = escapeHtml(event.nextAction || 'Sem proximo passo informado.');
  const dueDate = escapeHtml(event.nextActionDueDate || 'Nao definida');
  const outcome = escapeHtml(event.commercialOutcome || event.notVisitedReason || 'Nao informado');

  const values = {
    summary,
    // O marcador permite consultar antes de criar e evita uma atividade dupla
    // caso a Function falhe depois de o Odoo aceitar a primeira requisicao.
    note: [
      '<p><strong>Registro de visita Minum</strong></p>',
      `<p>Vendedor: ${seller}<br>Status: ${status}<br>Resultado: ${outcome}<br>Proximo passo: ${nextAction}<br>Data sugerida: ${dueDate}</p>`,
      `<p>Feedback: ${feedback}</p>`,
      `<p>minum_event_id:${escapeHtml(event.id)}</p>`,
    ].join(''),
  };

  if (configuration.protocol === 'json2') {
    values.res_model_id = configuration.crmLeadModelId;
    values.res_id = Number(event.odooLeadId);
    values.activity_type_id = configuration.activityTypeId;
  } else if (configuration.activityTypeId) {
    // Opcional no JSON-RPC: sem esse valor, o CRM usa o tipo padrao dele.
    values.activity_type_id = configuration.activityTypeId;
  }

  const eventUserId = positiveIntegerOrNull(event.odooUserId);
  const assigneeId = eventUserId || configuration.defaultUserId;
  if (assigneeId) values.user_id = assigneeId;
  return values;
}

function json2BaseUrl(configuration) {
  return configuration.baseUrl.endsWith('/json/2')
    ? configuration.baseUrl
    : `${configuration.baseUrl}/json/2`;
}

function rpcUrl(configuration) {
  return configuration.baseUrl.endsWith('/jsonrpc')
    ? configuration.baseUrl
    : `${configuration.baseUrl}/jsonrpc`;
}

async function requestJson(url, { headers = {}, body, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'Minum-Visit-Sync/1.0',
        ...headers,
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      // A mensagem final deliberadamente nao inclui o corpo do servidor.
    }
    if (!response.ok) {
      throw new OdooSyncError(
        `odoo_http_${response.status}`,
        `Odoo respondeu HTTP ${response.status}.`,
        { status: response.status, retryable: isRetryableHttpStatus(response.status) },
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof OdooSyncError) throw error;
    if (error?.name === 'AbortError') {
      throw new OdooSyncError('odoo_timeout', 'A comunicacao com o Odoo excedeu o tempo limite.', { retryable: true });
    }
    throw new OdooSyncError('odoo_network_error', 'Nao foi possivel comunicar com o Odoo.', { retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

function createJson2Adapter(configuration, fetchImpl) {
  const baseUrl = json2BaseUrl(configuration);
  const headers = {
    Authorization: `bearer ${configuration.apiKey}`,
    ...(configuration.database ? { 'X-Odoo-Database': configuration.database } : {}),
  };

  const call = (model, method, body) => requestJson(
    `${baseUrl}/${encodeURIComponent(model)}/${encodeURIComponent(method)}`,
    { headers, body, fetchImpl },
  );

  return {
    async findActivity(summary, event) {
      const result = await call('mail.activity', 'search_read', {
        domain: [
          ['res_model_id', '=', configuration.crmLeadModelId],
          ['res_id', '=', Number(event.odooLeadId)],
          ['summary', '=', summary],
        ],
        fields: ['id'],
        limit: 1,
      });
      return Array.isArray(result) ? positiveIntegerOrNull(result[0]?.id) : null;
    },
    async createActivity(values) {
      return positiveIntegerOrNull(await call('mail.activity', 'create', { vals: values }));
    },
  };
}

function createJsonRpcAdapter(configuration, fetchImpl) {
  let authenticatedUserId = null;
  let requestId = 0;
  let crmLeadFieldDefinitions = null;

  async function call(service, method, args) {
    requestId += 1;
    const response = await requestJson(rpcUrl(configuration), {
      fetchImpl,
      body: {
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id: requestId,
      },
    });
    if (response?.error) {
      // A resposta RPC nao expoe detalhes no Firebase. Ela tambem pode
      // representar uma chave recem-expirada, por isso segue a politica de
      // retentativa limitada do worker.
      throw new OdooSyncError('odoo_rpc_error', 'Odoo recusou a operacao RPC.', { retryable: true });
    }
    return response?.result;
  }

  async function userId() {
    if (authenticatedUserId) return authenticatedUserId;
    let uid = positiveIntegerOrNull(await call('common', 'authenticate', [
      configuration.database,
      configuration.login,
      configuration.apiKey,
      {},
    ]));
    // Algumas configuracoes antigas do Odoo 18 ainda aceitam a mesma chave de
    // API pelo metodo login. O fallback mantem o worker compativel sem trocar
    // a credencial ou enfraquecer a verificacao de acesso.
    if (!uid) {
      uid = positiveIntegerOrNull(await call('common', 'login', [
        configuration.database,
        configuration.login,
        configuration.apiKey,
      ]));
    }
    if (!uid) {
      throw new OdooSyncError('odoo_rpc_auth_failed', 'Odoo nao autenticou a integracao.', { retryable: true, status: 401 });
    }
    authenticatedUserId = uid;
    return uid;
  }

  async function execute(model, method, args, kwargs = {}) {
    return call('object', 'execute_kw', [
      configuration.database,
      await userId(),
      configuration.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  async function leadFieldDefinitions() {
    if (crmLeadFieldDefinitions) return crmLeadFieldDefinitions;
    crmLeadFieldDefinitions = await execute('crm.lead', 'fields_get', [], {
      attributes: ['string', 'type', 'help'],
    });
    return crmLeadFieldDefinitions || {};
  }

  async function findLeadByExactDocument(document) {
    const variants = documentVariants(document);
    if (!variants.length) return null;

    // O campo de CPF/CNPJ pode ser customizado no Odoo. Descobrimos apenas
    // campos textuais cujo nome ou rótulo indica CPF/CNPJ, sem supor o nome
    // técnico criado na instância, e confirmamos o número completo no retorno.
    const definitions = await leadFieldDefinitions();
    const documentFields = Object.entries(definitions || {})
      .filter(([fieldName, definition]) => isDocumentField(fieldName, definition))
      .map(([fieldName]) => fieldName)
      .slice(0, 8);
    if (!documentFields.length) return null;

    const matchingLeadIds = new Set();
    for (const fieldName of documentFields) {
      const records = await execute('crm.lead', 'search_read', [[
        [fieldName, 'in', variants],
      ]], {
        fields: ['id', fieldName],
        limit: 10,
      });
      (Array.isArray(records) ? records : []).forEach((record) => {
        if (documentDigits(record?.[fieldName]) !== documentDigits(document)) return;
        const id = positiveIntegerOrNull(record?.id);
        if (id) matchingLeadIds.add(id);
      });
    }

    return matchingLeadIds.size === 1
      ? { odooLeadId: [...matchingLeadIds][0], source: 'odoo_exact_document' }
      : null;
  }

  async function findLeadByExactExternalId(value) {
    const identifier = externalIdentifier(value);
    if (!identifier) return null;

    const definitions = await leadFieldDefinitions();
    const codeFields = Object.entries(definitions || {})
      .filter(([fieldName, definition]) => isMinumCodeField(fieldName, definition))
      .map(([fieldName]) => fieldName)
      .slice(0, 8);
    if (!codeFields.length) return null;

    const matchingLeadIds = new Set();
    for (const fieldName of codeFields) {
      const records = await execute('crm.lead', 'search_read', [[
        [fieldName, '=', identifier],
      ]], {
        fields: ['id', fieldName],
        limit: 10,
      });
      (Array.isArray(records) ? records : []).forEach((record) => {
        if (text(record?.[fieldName]) !== identifier) return;
        const id = positiveIntegerOrNull(record?.id);
        if (id) matchingLeadIds.add(id);
      });
    }

    return matchingLeadIds.size === 1
      ? { odooLeadId: [...matchingLeadIds][0], source: 'odoo_exact_minum_code' }
      : null;
  }

  return {
    async findActivity(summary, event) {
      const result = await execute('mail.activity', 'search_read', [[
        ['res_model', '=', 'crm.lead'],
        ['res_id', '=', Number(event.odooLeadId)],
        ['summary', '=', summary],
      ]], { fields: ['id'], limit: 1 });
      return Array.isArray(result) ? positiveIntegerOrNull(result[0]?.id) : null;
    },
    async createActivity(values, event) {
      const leadId = positiveIntegerOrNull(event?.odooLeadId);
      if (!leadId) {
        throw new OdooSyncError('odoo_lead_id_invalid', 'O feedback nao possui uma oportunidade Odoo valida.', { retryable: false });
      }

      // activity_schedule pertence ao proprio lead. Assim o Odoo resolve
      // res_model_id internamente, sem exigir permissao externa em ir.model.
      const result = await execute('crm.lead', 'activity_schedule', [[leadId]], {
        summary: values.summary,
        note: values.note,
        ...(positiveIntegerOrNull(values.activity_type_id)
          ? { activity_type_id: positiveIntegerOrNull(values.activity_type_id) }
          : {}),
        ...(positiveIntegerOrNull(values.user_id)
          ? { user_id: positiveIntegerOrNull(values.user_id) }
          : {}),
      });
      const activityId = Array.isArray(result)
        ? positiveIntegerOrNull(result[0])
        : positiveIntegerOrNull(result);
      return activityId;
    },
    findLeadByExactDocument,
    findLeadByExactExternalId,
  };
}

/**
 * Adapter unico consumido pelo worker. Trocar de JSON-2 para JSON-RPC nao
 * espalha detalhes de transporte nem toca no historico de visitEvents.
 */
function createOdooClient({ apiKey, env = process.env, fetchImpl = fetch } = {}) {
  const configuration = readOdooConfiguration({ apiKey, env });
  if (!configuration.ready) {
    return {
      configuration,
      async ensureActivity() {
        throw new OdooSyncError(configuration.code, 'A integracao Odoo ainda nao esta configurada.', { retryable: false });
      },
    };
  }

  const adapter = configuration.protocol === 'json2'
    ? createJson2Adapter(configuration, fetchImpl)
    : createJsonRpcAdapter(configuration, fetchImpl);

  return {
    configuration,
    async ensureActivity(event) {
      const values = buildActivityValues(event, configuration);
      const existingActivityId = await adapter.findActivity(values.summary, event);
      if (existingActivityId) return existingActivityId;

      const createdActivityId = await adapter.createActivity(values, event);
      if (createdActivityId) return createdActivityId;

      // activity_schedule pode devolver um recordset vazio no JSON-RPC mesmo
      // apos persistir a atividade. Consultamos novamente pelo resumo unico
      // antes de falhar, evitando uma segunda criacao em uma nova tentativa.
      const recoveredActivityId = await adapter.findActivity(values.summary, event);
      if (recoveredActivityId) return recoveredActivityId;

      throw new OdooSyncError('odoo_invalid_create_response', 'Odoo nao confirmou a atividade criada.', { retryable: true });
    },
    async findLeadByExactDocument(document) {
      if (typeof adapter.findLeadByExactDocument !== 'function') return null;
      return adapter.findLeadByExactDocument(document);
    },
    async findLeadByExactExternalId(value) {
      if (typeof adapter.findLeadByExactExternalId !== 'function') return null;
      return adapter.findLeadByExactExternalId(value);
    },
  };
}

module.exports = {
  OdooSyncError,
  buildActivityValues,
  createOdooClient,
  readOdooConfiguration,
};
