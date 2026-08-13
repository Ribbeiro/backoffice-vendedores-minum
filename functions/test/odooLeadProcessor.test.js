const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { processOdooWorkbook } = require('../src/odooLeadProcessor');

function createWorkbook(rows) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

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
    lookupGeocode: async (query, context) => ({
      latitude: context.state === 'MS' ? -20.4697 : -15.6014,
      longitude: context.state === 'MS' ? -54.6201 : -56.0979,
      state: context.state,
      accuracy: 'rooftop',
      confidence: 'exact',
      label: query,
      source: 'Teste',
    }),
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
