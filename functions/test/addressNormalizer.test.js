const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalKey,
  normalizeCityAndState,
  parseBrazilianAddress,
  parseThousandHouseNumber,
} = require('../src/addressNormalizer');

test('Colisão de mesmo número em ruas diferentes produz canonical keys diferentes', () => {
  const key1 = canonicalKey('Avenida Florestal', '370', 'Campo Grande', 'MS');
  const key2 = canonicalKey('Avenida Três Barras', '370', 'Campo Grande', 'MS');

  assert.notEqual(key1, key2, 'Ruas diferentes com mesmo número 370 NÃO podem ter a mesma chave canônica!');
});

test('Mesmo endereço duplicado produz exatamente a mesma chave canônica', () => {
  const key1 = canonicalKey('RUA SOUTO MAIOR', '810', 'Campo Grande', 'MS');
  const key2 = canonicalKey('Rua Souto Maior', '810', 'Campo Grande', 'MS');

  assert.equal(key1, key2, 'Endereços iguais devem compartilhar a mesma chave canônica!');
});

test('Imóvel e complemento preservam número principal e diferenciam chave se necessário', () => {
  const parsed1 = parseBrazilianAddress('RUA SEVERINO PINHEIRO 817', 'Campo Grande', 'MS');
  const parsed2 = parseBrazilianAddress('RUA SEVERINO PINHEIRO 817 FUNDOS', 'Campo Grande', 'MS');

  assert.equal(parsed1.houseNumber, '817');
  assert.equal(parsed2.houseNumber, '817');
  assert.equal(parsed2.complement, 'FUNDOS');
});

test('Número com separador de milhar brasileiro (7.881 -> 7881)', () => {
  assert.equal(parseThousandHouseNumber('7.881'), '7881');
  assert.equal(parseThousandHouseNumber('1.234'), '1234');

  const parsed = parseBrazilianAddress('AVENIDA MARECHAL DEODORO, 7.881', 'Campo Grande', 'MS');
  assert.equal(parsed.houseNumber, '7881');
  assert.equal(parsed.street.toLowerCase(), 'avenida marechal deodoro');
});

test('Normalização do campo cidade quando contém estado incorporado ("MS - Campo Grande")', () => {
  const normalized = normalizeCityAndState('MS - Campo Grande', 'MS');
  assert.equal(normalized.place, 'Campo Grande');
  assert.equal(normalized.region, 'MS');

  const parsed = parseBrazilianAddress('Av Bom Pastor, 329', 'MS - Campo Grande', 'MS');
  assert.equal(parsed.place, 'Campo Grande');
  assert.equal(parsed.region, 'MS');
  assert.equal(parsed.houseNumber, '329');
});

test('Suíte de endereços reais do prompt', () => {
  // Complemento com sala
  const p1 = parseBrazilianAddress('AVENIDA TRES BARRAS, 370, SALA 03', 'Campo Grande', 'MS');
  assert.equal(p1.houseNumber, '370');
  assert.equal(p1.complement, 'SALA 03');

  // Casa com complemento
  const p2 = parseBrazilianAddress('RUA NOVA EUROPA, 35, CASA 02', 'Campo Grande', 'MS');
  assert.equal(p2.houseNumber, '35');
  assert.equal(p2.complement, 'CASA 02');

  // Endereço S/N
  const p3 = parseBrazilianAddress('RUA DUQUE DE CAIXAS, S/N', 'Aquidauana', 'MS');
  assert.equal(p3.hasNoNumber, true);

  // Endereço Rural com KM
  const p4 = parseBrazilianAddress('ESTRADA AQUIDAUANA/RIO NEGRO, S/N, KM 44 A DIREITA', 'Aquidauana', 'MS');
  assert.equal(p4.isRural, true);
  assert.equal(p4.km, '44');

  // Galpão/Portão
  const p5 = parseBrazilianAddress('RUA ARACA, 187, GALPAOPORTAO B', 'Campo Grande', 'MS');
  assert.equal(p5.houseNumber, '187');
  assert.equal(p5.complement, 'GALPAOPORTAO B');
});
