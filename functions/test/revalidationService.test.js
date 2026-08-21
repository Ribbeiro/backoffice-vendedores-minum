const test = require('node:test');
const assert = require('node:assert/strict');
const {
  auditExistingCustomers,
  calculateCheckinGroundTruth,
  detectDuplicateCoordinates,
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
