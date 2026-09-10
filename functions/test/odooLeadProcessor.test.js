const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const {
  buildFirebaseCustomer,
  expectedRevenueNumberOrNull,
  mergeCustomer,
  processOdooWorkbook,
} = require('../src/odooLeadProcessor');

function createWorkbook(rows) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('interpreta corretamente os formatos monetarios recebidos do Odoo', () => {
  assert.equal(expectedRevenueNumberOrNull('15.000'), 15000);
  assert.equal(expectedRevenueNumberOrNull('15.000,00'), 15000);
  assert.equal(expectedRevenueNumberOrNull('15,000.00'), 15000);
  assert.equal(expectedRevenueNumberOrNull('15000.00'), 15000);
  assert.equal(expectedRevenueNumberOrNull('R$ 15.000,00'), 15000);
  assert.equal(expectedRevenueNumberOrNull('15,50'), 15.5);
});

test('salva a receita esperada agrupada como quinze mil no cliente Firebase', () => {
  const customer = buildFirebaseCustomer({
    ID: 'CL-RECEITA',
    Opportunity: 'Cliente receita',
    'Deal - Expected Revenue': '15.000',
  }, {
    jobId: 'job_receita',
    importedBy: 'admin_test',
    importedAt: 1,
  });

  assert.equal(customer.expectedRevenue, '15.000');
  assert.equal(customer.expectedRevenueValue, 15000);
});

test('consolida marcadores isolados e preserva identificadores como texto', async () => {
  const source = createWorkbook([
    [
      'Oportunidade',
      'CPF/CNPJ',
      'Codigo do sistema MINUM',
      'Endereco',
      'Estado/Codigo do estado',
      'Cidade',
      'Marcadores/Nome do marcador',
    ],
    ['Prospecto A', '00010478175', 'CL55904', 'Rua Teste, 10', 'MS', 'Campo Grande', 'reuniao_marcada'],
    ['', '', '', '', '', '', 'sdr_felipe'],
    ['', '', '', '', '', '', 'cnpj47080938000122'],
    ['Prospecto B', '00000000001', 'CL55905', 'Rua Dois, 20', 'MT', 'Cuiaba', 'novo'],
  ]);

  const result = await processOdooWorkbook(source, {
    lookupCnpj: async () => ({ data: null, source: 'BrasilAPI' }),
    mapboxGeocoderClient: {
      forwardGeocode: async (parsed) => {
        const latitude = parsed.region === 'MS' ? -20.4697 : -15.6014;
        const longitude = parsed.region === 'MS' ? -54.6201 : -56.0979;
        return {
          latitude,
          longitude,
          navigationLatitude: latitude,
          navigationLongitude: longitude,
          entranceLatitude: null,
          entranceLongitude: null,
          featureType: 'address',
          accuracy: 'rooftop',
          confidence: 'exact',
          matchCode: { address_number: 'matched', street: 'matched', place: 'matched', confidence: 'exact' },
          label: parsed.normalizedSearchAddress,
          rawFeature: {
            geometry: { coordinates: [longitude, latitude] },
            properties: {
              feature_type: 'address',
              match_code: { address_number: 'matched', street: 'matched', place: 'matched', confidence: 'exact' },
              coordinates: { latitude, longitude, accuracy: 'rooftop' },
              context: { region: { short_code: `BR-${parsed.region}` } },
            },
          },
        };
      },
      reverseGeocode: async (latitude) => (latitude === -20.4697
        ? { street: 'Rua Teste', houseNumber: '10', place: 'Campo Grande', region: 'MS', postcode: '' }
        : { street: 'Rua Dois', houseNumber: '20', place: 'Cuiaba', region: 'MT', postcode: '' }),
    },
  });

  assert.equal(result.records.length, 2);
  assert.equal(result.summary.extraTagRows, 2);
  assert.equal(result.summary.blockingIssues, 0);
  assert.equal(result.records[0]['(CPF/CNPJ)'], '00010478175');
  assert.match(result.records[0]['Deal - Tags'], /reuniao_marcada/);
  assert.match(result.records[0]['Deal - Tags'], /sdr_felipe/);
  assert.match(result.records[0]['Deal - Tags'], /cnpj47080938000122/);
  assert.equal(result.records[0].latitude, -20.4697);
  assert.equal(result.records[1].longitude, -56.0979);
});

test('preenche CNPJ extraido de marcador somente apos consulta confirmada', async () => {
  const source = createWorkbook([
    ['Oportunidade', 'Codigo do sistema MINUM', 'Marcadores/Nome do marcador'],
    ['Prospecto confirmado', 'CL55906', 'cnpj47080938000122'],
  ]);

  const result = await processOdooWorkbook(source, {
    enableGeocoding: false,
    lookupCnpj: async () => ({
      source: 'BrasilAPI',
      data: {
        razao_social: 'Empresa Confirmada LTDA',
        nome_fantasia: 'Empresa Confirmada',
        municipio: 'Campo Grande',
        uf: 'MS',
      },
    }),
  });

  assert.equal(result.records[0]['(CPF/CNPJ)'], '47080938000122');
  assert.equal(result.records[0].Cidade, 'Campo Grande');
  assert.ok(result.audit.some((entry) => entry.stage === 'cnpj_lookup'
    && entry.status === 'FILLED'
    && entry.fields.includes('(CPF/CNPJ)')));
});

test('mantem separados o ID tecnico Odoo, o codigo Minum e o ID externo', async () => {
  const source = createWorkbook([
    [
      'Oportunidade',
      'ID',
      'Codigo do sistema MINUM',
      'External ID',
      'Marcadores/Nome do marcador',
    ],
    ['Oportunidade controlada', 58680, 'CL53242', '__export__.crm_lead_58680_43866912', 'teste_odoo'],
  ]);

  const result = await processOdooWorkbook(source, {
    enableGeocoding: false,
    enableResearch: false,
  });
  const record = result.records[0];
  const customer = buildFirebaseCustomer(record, {
    jobId: 'job_test',
    importedBy: 'admin_test',
    importedAt: 1,
  });

  assert.equal(record.ID, 'CL53242');
  assert.equal(record['Odoo Lead ID'], '58680');
  assert.equal(record['Odoo External ID'], '__export__.crm_lead_58680_43866912');
  assert.equal(customer.externalId, 'CL53242');
  assert.equal(customer.minumCode, 'CL53242');
  assert.equal(customer.odooLeadId, 58680);
  assert.equal(customer.odooExternalId, '__export__.crm_lead_58680_43866912');
  const auditEntry = result.audit.find((entry) => entry.stage === 'consolidation');
  assert.equal(auditEntry.minumCode, 'CL53242');
  assert.equal(auditEntry.odooLeadId, '58680');
  assert.equal(auditEntry.odooExternalId, '__export__.crm_lead_58680_43866912');
});

test('aceita a exportacao direta do crm.lead e prepara o vinculo de atividades Odoo', async () => {
  const source = createWorkbook([
    [
      'id',
      'name',
      'cpf_cnpj_number',
      'street',
      'email_from',
      'state_id/name',
      'city',
      'phone',
      'segment',
      'user_id/name',
      'distribution_company',
      'tag_ids',
      'expected_revenue',
      'description',
      'source_id',
      'stage_id',
      'contact_name',
      'country_id',
    ],
    [
      '__export__.crm_lead_64208_cbc1fc8c',
      'True - ALEX DA SILVA PEREIRA',
      '82456470125',
      'R. Joao Leite Ribeiro, 1460',
      'alex@minum.com.br',
      'Mato Grosso do Sul',
      'MS - Anastacio',
      '67996738355',
      'Mercados',
      'FLAVIO DE PAULA TERRA',
      'Energisa MS',
      'lemit,Anastacio,cnpj12723924000103',
      3364.45,
      'Coordenadas: -20.4645512,-55.7881684',
      'Datlo',
      'Oferta Gerada',
      'ALEX DA SILVA PEREIRA',
      'Brasil',
    ],
  ]);

  const result = await processOdooWorkbook(source, {
    enableGeocoding: false,
    enableResearch: false,
  });

  const record = result.records[0];
  const customer = buildFirebaseCustomer(record, {
    jobId: 'job_raw_odoo',
    importedBy: 'admin_test',
    importedAt: 1,
  });

  assert.equal(result.summary.inputFormat, 'odoo_raw_export');
  assert.equal(result.summary.odooLeadsLinked, 1);
  assert.equal(record.ID, 'odoo_lead_64208');
  assert.equal(record['Odoo Lead ID'], '64208');
  assert.equal(record['Odoo External ID'], '__export__.crm_lead_64208_cbc1fc8c');
  assert.equal(record.Opportunity, 'ALEX DA SILVA PEREIRA');
  assert.equal(record['Client - State'], 'MS');
  assert.equal(record.Cidade, 'Anastacio');
  assert.equal(record.__meta.coordinateSource, 'Descricao da exportacao Odoo');
  assert.equal(customer.odooLeadId, 64208);
  assert.equal(customer.latitude, -20.4645512);
  assert.equal(customer.longitude, -55.7881684);
});

test('usa a oportunidade como nome principal e preserva o contato separadamente', async () => {
  const source = createWorkbook([
    ['id', 'name', 'street', 'state_id/name', 'city', 'tag_ids', 'contact_name'],
    [
      '__export__.crm_lead_64059_ad6d3e47',
      'On Fit',
      'Av. Teste, 100',
      'Goias',
      'GO - Goiania',
      'novo',
      'DYONATHAN PATROCINIO XAVIER',
    ],
  ]);

  const result = await processOdooWorkbook(source, {
    enableGeocoding: false,
    enableResearch: false,
  });
  const customer = buildFirebaseCustomer(result.records[0], {
    jobId: 'job_name_priority',
    importedBy: 'admin_test',
    importedAt: 1,
  });

  assert.equal(result.records[0].Opportunity, 'On Fit');
  assert.equal(result.records[0]['Client - Name'], 'DYONATHAN PATROCINIO XAVIER');
  assert.equal(customer.name, 'On Fit');
  assert.equal(customer.opportunity, 'On Fit');
  assert.equal(customer.clientName, 'DYONATHAN PATROCINIO XAVIER');
});

test('preserva coordenada manual aprovada e nao consulta Mapbox novamente para o mesmo endereco', async () => {
  const source = createWorkbook([
    ['Oportunidade', 'Codigo do sistema MINUM', 'Endereco', 'Estado/Codigo do estado', 'Cidade', 'Marcadores/Nome do marcador'],
    ['Cliente revisado', 'CL55999', 'Rua da Revisao, 10', 'MS', 'Campo Grande', 'teste'],
  ]);
  let mapboxCalls = 0;

  const result = await processOdooWorkbook(source, {
    customers: {
      cliente_revisado: {
        id: 'cliente_revisado',
        minumCode: 'CL55999',
        address: 'Rua da Revisao, 10',
        city: 'Campo Grande',
        state: 'MS',
        latitude: -20.45001,
        longitude: -54.61001,
        navigationLatitude: -20.45002,
        navigationLongitude: -54.61002,
        coordinateStatus: 'manual_confirmed',
        coordinatePrecisionLevel: 'manual',
        coordinateSource: 'Correcao manual administrativa',
        geocodingReview: { status: 'manual', reason: 'Confirmada no mapa.' },
      },
    },
    enableResearch: false,
    mapboxGeocoderClient: {
      forwardGeocode: async () => {
        mapboxCalls += 1;
        throw new Error('Mapbox nao deveria ser chamado');
      },
    },
  });

  assert.equal(mapboxCalls, 0);
  assert.equal(result.records[0].latitude, -20.45001);
  assert.equal(result.records[0].longitude, -54.61001);
  assert.equal(result.records[0].__meta.coordinateStatus, 'manual_confirmed');
  assert.ok(result.audit.some((entry) => entry.stage === 'coordinate_reuse'));
});

test('merge conserva uma coordenada aprovada quando o endereco nao mudou', () => {
  const existing = {
    opportunity: 'Cliente revisado',
    latitude: -20.45,
    longitude: -54.61,
    navigationLatitude: -20.4501,
    navigationLongitude: -54.6101,
    coordinateStatus: 'manual_confirmed',
    coordinateSource: 'Correcao manual administrativa',
    coordinatePrecisionLevel: 'manual',
    canonicalKey: 'rua_da_revisao|10|campo_grande|MS',
    geocodingReview: { status: 'manual', addressCanonicalKey: 'rua_da_revisao|10|campo_grande|MS' },
  };
  const incoming = {
    opportunity: 'Cliente revisado atualizado',
    latitude: -20.99,
    longitude: -54.99,
    navigationLatitude: -20.99,
    navigationLongitude: -54.99,
    coordinateStatus: 'needs_review',
    coordinateSource: 'Mapbox',
    canonicalKey: 'rua_da_revisao|10|campo_grande|MS',
    importMetadata: { coordinateStatus: 'needs_review' },
    raw: {},
  };

  const merged = mergeCustomer(existing, incoming);
  assert.equal(merged.opportunity, 'Cliente revisado atualizado');
  assert.equal(merged.latitude, -20.45);
  assert.equal(merged.longitude, -54.61);
  assert.equal(merged.coordinateStatus, 'manual_confirmed');
  assert.equal(merged.geocodingReview.status, 'manual');
  assert.equal(merged.importMetadata.coordinateReviewPreserved, true);
});
