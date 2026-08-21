const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateHaversineDistanceMeters,
  classifyDistance,
  compareReverseAddress,
  validateMapboxResponse,
} = require('../src/mapboxGeocoder');

function validFeature(overrides = {}) {
  const { properties: propertyOverrides = {}, ...featureOverrides } = overrides;
  return {
    geometry: { coordinates: [-54.64875, -20.49134] },
    properties: {
      feature_type: 'address',
      match_code: { address_number: 'matched', street: 'matched', place: 'matched', confidence: 'exact' },
      coordinates: { latitude: -20.49134, longitude: -54.64875, accuracy: 'rooftop' },
      context: { region: { short_code: 'BR-MS' } },
      ...propertyOverrides,
    },
    ...featureOverrides,
  };
}

test('Calcula Haversine em metros', () => {
  const distance = calculateHaversineDistanceMeters(-20.49134, -54.64875, -20.48560, -54.64790);
  assert.ok(distance > 600 && distance < 700);
});

test('Classifica distancia pelas faixas de auditoria', () => {
  assert.equal(classifyDistance(50), 'normal');
  assert.equal(classifyDistance(200), 'attention');
  assert.equal(classifyDistance(400), 'suspicious');
  assert.equal(classifyDistance(1200), 'critical');
  assert.equal(classifyDistance(3000), 'catastrophic');
});

test('Confirma somente endereco numerado com prova completa do Mapbox', () => {
  const result = validateMapboxResponse(validFeature(), { houseNumber: '7881', street: 'Avenida Marechal Deodoro', place: 'Campo Grande', region: 'MS' });
  assert.equal(result.accepted, true);
  assert.equal(result.status, 'confirmed');
});

test('Rejeita endereco numerado sem match_code do numero', () => {
  const result = validateMapboxResponse(validFeature({ properties: { match_code: null } }), { houseNumber: '2716', street: 'Avenida Afonso Pena', place: 'Campo Grande', region: 'MS' });
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'needs_review');
});

test('Rejeita numero plausivel e precisao interpolada', () => {
  const result = validateMapboxResponse(validFeature({
    properties: {
      match_code: { address_number: 'plausible', street: 'matched', place: 'matched', confidence: 'high' },
      coordinates: { latitude: -20.49134, longitude: -54.64875, accuracy: 'interpolated' },
    },
  }), { houseNumber: '2716', street: 'Avenida Afonso Pena', place: 'Campo Grande', region: 'MS' });
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'needs_review');
});

test('Nao transforma feature street em porta de endereco numerado', () => {
  const result = validateMapboxResponse(validFeature({ properties: { feature_type: 'street' } }), { houseNumber: '2716', street: 'Avenida Afonso Pena', place: 'Campo Grande', region: 'MS' });
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'needs_review');
});

test('UF divergente gera conflito de fonte', () => {
  const result = validateMapboxResponse(validFeature({ properties: { context: { region: { short_code: 'BR-MT' } } } }), { houseNumber: '100', street: 'Rua Um', place: 'Campo Grande', region: 'MS' });
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'source_conflict');
});

test('Compara forward e reverse em todos os componentes relevantes', () => {
  const reverse = compareReverseAddress(
    { street: 'Avenida Marechal Deodoro', houseNumber: '7881', place: 'Campo Grande', region: 'MS', postcode: '79000000' },
    { street: 'Avenida Marechal Deodoro', houseNumber: '7881', place: 'Campo Grande', region: 'MS', postcode: '79000000' },
  );
  assert.equal(reverse.matches, true);
  assert.equal(compareReverseAddress(
    { street: 'Avenida Marechal Deodoro', houseNumber: '7881', place: 'Campo Grande', region: 'MS' },
    { street: 'Avenida Outra', houseNumber: '7881', place: 'Campo Grande', region: 'MS' },
  ).matches, false);
});
