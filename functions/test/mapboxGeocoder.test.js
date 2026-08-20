const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateHaversineDistanceMeters,
  classifyDistance,
  validateMapboxResponse,
} = require('../src/mapboxGeocoder');

test('Cálculo de distância Haversine em metros', () => {
  // Distância entre dois pontos em Campo Grande (aprox. 642 m)
  const dist = calculateHaversineDistanceMeters(-20.49134, -54.64875, -20.48560, -54.64790);
  assert.ok(dist > 600 && dist < 700, `Distância esperada ~642m, obteve ${dist}m`);
});

test('Classificação de distância por faixas de auditoria', () => {
  assert.equal(classifyDistance(50), 'normal');
  assert.equal(classifyDistance(200), 'attention');
  assert.equal(classifyDistance(400), 'suspicious');
  assert.equal(classifyDistance(1200), 'critical');
  assert.equal(classifyDistance(3000), 'catastrophic');
});

test('Validação de resposta Mapbox: Endereço bom (rooftop + address + matched) é confirmado', () => {
  const mockFeature = {
    properties: {
      feature_type: 'address',
      match_code: { address_number: 'matched', confidence: 'exact' },
      coordinates: { accuracy: 'rooftop' },
      context: { region: { short_code: 'BR-MS' } },
    },
  };
  const parsedAddress = { houseNumber: '329', region: 'MS' };

  const res = validateMapboxResponse(mockFeature, parsedAddress);
  assert.equal(res.accepted, true);
  assert.equal(res.status, 'confirmed');
});

test('Validação de resposta Mapbox: feature_type street NÃO confirma porta de imóvel numerado', () => {
  const mockFeature = {
    properties: {
      feature_type: 'street',
      match_code: { confidence: 'high' },
      coordinates: { accuracy: 'street_centroid' },
      context: { region: { short_code: 'BR-MS' } },
    },
  };
  const parsedAddress = { houseNumber: '2716', region: 'MS' };

  const res = validateMapboxResponse(mockFeature, parsedAddress);
  assert.equal(res.accepted, false);
  assert.equal(res.status, 'needs_review');
});

test('Validação de resposta Mapbox: UF divergente causa rejeição', () => {
  const mockFeature = {
    properties: {
      feature_type: 'address',
      match_code: { address_number: 'matched' },
      context: { region: { short_code: 'BR-MT' } }, // Retornou MT
    },
  };
  const parsedAddress = { houseNumber: '100', region: 'MS' }; // Esperava MS

  const res = validateMapboxResponse(mockFeature, parsedAddress);
  assert.equal(res.accepted, false);
  assert.equal(res.status, 'source_conflict');
});
