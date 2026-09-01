const test = require('node:test');
const assert = require('node:assert/strict');
const {
  auditExistingCustomers,
  calculateCheckinGroundTruth,
  detectDuplicateCoordinates,
  selectCustomerIdsForAudit,
  summarizeAudit,
} = require('../src/revalidationService');

function mapboxResult(latitude, longitude, street, number, place = 'Campo Grande', region = 'MS') {
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
    label: `${street}, ${number}`,
    rawFeature: {
      geometry: { coordinates: [longitude, latitude] },
      properties: {
        feature_type: 'address',
        match_code: { address_number: 'matched', street: 'matched', place: 'matched', confidence: 'exact' },
        coordinates: { latitude, longitude, accuracy: 'rooftop' },
        context: { region: { short_code: `BR-${region}` } },
      },
    },
    reverse: { street, houseNumber: number, place, region, postcode: '' },
  };
}

test('detecta coordenadas duplicadas em enderecos canonicos distintos', () => {
  const duplicates = detectDuplicateCoordinates({
    florestal: { address: 'Avenida Florestal, 370', city: 'Campo Grande', state: 'MS', latitude: -20.4316143, longitude: -54.6571029 },
    tresBarras: { address: 'Avenida Tres Barras, 370, Sala 03', city: 'Campo Grande', state: 'MS', latitude: -20.4316143, longitude: -54.6571029 },
    duplicate: { address: 'Avenida Florestal, 370', city: 'Campo Grande', state: 'MS', latitude: -20.4316143, longitude: -54.6571029 },
  });
  assert.equal(duplicates.get('florestal').length, 1);
  assert.equal(duplicates.get('tresBarras').length, 2);
  assert.equal(duplicates.get('duplicate').length, 1);
});

test('evidencia de campo exige duas amostras GPS no mesmo aglomerado', () => {
  const single = calculateCheckinGroundTruth([{ location: { latitude: -20.4, longitude: -54.6 }, gpsAccuracyMeters: 10 }]);
  assert.equal(single.eligible, false);
  const clustered = calculateCheckinGroundTruth([
    { location: { latitude: -20.4, longitude: -54.6 }, gpsAccuracyMeters: 10 },
    { location: { latitude: -20.40003, longitude: -54.60003 }, gpsAccuracyMeters: 15 },
    { location: { latitude: -20.42, longitude: -54.62 }, gpsAccuracyMeters: 20 },
  ]);
  assert.equal(clustered.eligible, true);
  assert.equal(clustered.count, 2);
});

test('auditoria marca proposta validada como elegivel sem gravar customers', async () => {
  const candidate = mapboxResult(-20.4001, -54.6001, 'Rua Teste', '10');
  const results = await auditExistingCustomers({
    customers: {
      cliente: { name: 'Cliente', address: 'Rua Teste, 10', city: 'Campo Grande', state: 'MS', latitude: -20.401, longitude: -54.601 },
    },
    mapboxGeocoderClient: {
      forwardGeocodeBatch: async () => [candidate],
      reverseGeocode: async () => candidate.reverse,
    },
  });
  assert.equal(results[0].candidateVerified, true);
  assert.equal(results[0].approvalEligible, true);
  assert.equal(results[0].geocodedCoordinate.latitude, -20.4001);
});

test('coordenada manual aprovada nao consulta Mapbox nem volta como needs review', async () => {
  let mapboxCalls = 0;
  const customers = {
    manual: {
      name: 'Cliente manual',
      address: 'Rua Manual, 12',
      city: 'Campo Grande',
      state: 'MS',
      latitude: -20.45,
      longitude: -54.61,
      coordinateStatus: 'manual_confirmed',
      coordinateSource: 'Correcao manual administrativa',
      geocodingReview: { status: 'manual' },
    },
  };
  const results = await auditExistingCustomers({
    customers,
    mapboxGeocoderClient: {
      forwardGeocodeBatch: async () => {
        mapboxCalls += 1;
        return [];
      },
    },
  });

  assert.equal(mapboxCalls, 0);
  assert.equal(results[0].reviewLocked, true);
  assert.equal(results[0].coordinateStatus, 'manual_confirmed');
  assert.equal(summarizeAudit(results).needsReview, 0);
  assert.deepEqual(selectCustomerIdsForAudit(customers), []);
  assert.deepEqual(selectCustomerIdsForAudit(customers, { includeReviewed: true }), ['manual']);

  await auditExistingCustomers({
    customers,
    includeReviewed: true,
    mapboxGeocoderClient: {
      forwardGeocodeBatch: async () => {
        mapboxCalls += 1;
        return [mapboxResult(-20.45, -54.61, 'Rua Manual', '12')];
      },
      reverseGeocode: async () => ({ street: 'Rua Manual', houseNumber: '12', place: 'Campo Grande', region: 'MS', postcode: '' }),
    },
  });
  assert.equal(mapboxCalls, 1);
});

test('endereco alterado volta para a fila mesmo quando a coordenada anterior foi aprovada', () => {
  const customers = {
    changed: {
      address: 'Rua Nova, 99',
      city: 'Campo Grande',
      state: 'MS',
      latitude: -20.45,
      longitude: -54.61,
      coordinateStatus: 'manual_confirmed',
      canonicalKey: 'endereco_antigo|1|campo_grande|MS',
      geocodingReview: { status: 'manual', addressCanonicalKey: 'endereco_antigo|1|campo_grande|MS' },
    },
  };

  assert.deepEqual(selectCustomerIdsForAudit(customers), ['changed']);
});
