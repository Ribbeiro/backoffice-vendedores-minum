const {
  canonicalKey,
  parseBrazilianAddress,
} = require('./addressNormalizer');
const { isFiniteCoordinate } = require('./mapboxGeocoder');

const CONFIRMED_COORDINATE_STATUSES = new Set([
  'confirmed',
  'manual_confirmed',
]);

const PRESERVED_COORDINATE_FIELDS = Object.freeze([
  'latitude',
  'longitude',
  'navigationLatitude',
  'navigationLongitude',
  'entranceLatitude',
  'entranceLongitude',
  'sourceLatitude',
  'sourceLongitude',
  'geocodedLatitude',
  'geocodedLongitude',
  'previousLatitude',
  'previousLongitude',
  'distanceFromPreviousMeters',
  'coordinatePrecisionLevel',
  'coordinateStatus',
  'coordinateSource',
  'canonicalKey',
  'normalizedAddress',
  'originalAddress',
  'parsedAddress',
  'geocoding',
  'geocodingReview',
]);

function coordinateFrom(value = {}) {
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  return isFiniteCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}

function optionalCoordinateValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalAddressKey({ address = '', city = '', state = '', country = 'Brasil' } = {}) {
  const parsed = parseBrazilianAddress(address, city, state, country);
  return canonicalKey(
    parsed.street,
    parsed.houseNumber,
    parsed.place,
    parsed.region,
    parsed.postcode,
    parsed.country,
    parsed.neighborhood,
  );
}

function canonicalAddressKeyForCustomer(customer = {}) {
  return canonicalAddressKey({
    address: customer.dealAddress || customer.address || '',
    city: customer.city || '',
    state: customer.state || '',
    country: customer.country || 'Brasil',
  });
}

function isConfirmedCoordinateStatus(status) {
  return CONFIRMED_COORDINATE_STATUSES.has(String(status || '').trim().toLowerCase());
}

/**
 * Uma coordenada aprovada fica protegida enquanto o endereco permanecer o
 * mesmo. Caso o endereco mude, ela volta para a fila de revisao.
 */
function isCoordinateReviewLocked(customer = {}, currentCanonicalKey = '') {
  if (!coordinateFrom(customer) || !isConfirmedCoordinateStatus(customer.coordinateStatus)) return false;

  const approvedForAddress = String(
    customer.geocodingReview?.addressCanonicalKey
      || customer.canonicalKey
      || '',
  ).trim();
  if (!approvedForAddress || !currentCanonicalKey) return true;
  return approvedForAddress === currentCanonicalKey;
}

function coordinateReviewSnapshot(customer = {}) {
  const coordinate = coordinateFrom(customer);
  if (!coordinate) return null;

  return {
    ...coordinate,
    navigationLatitude: Number(customer.navigationLatitude ?? coordinate.latitude),
    navigationLongitude: Number(customer.navigationLongitude ?? coordinate.longitude),
    entranceLatitude: optionalCoordinateValue(customer.entranceLatitude),
    entranceLongitude: optionalCoordinateValue(customer.entranceLongitude),
    sourceLatitude: optionalCoordinateValue(customer.sourceLatitude),
    sourceLongitude: optionalCoordinateValue(customer.sourceLongitude),
    geocodedLatitude: optionalCoordinateValue(customer.geocodedLatitude),
    geocodedLongitude: optionalCoordinateValue(customer.geocodedLongitude),
    previousLatitude: optionalCoordinateValue(customer.previousLatitude),
    previousLongitude: optionalCoordinateValue(customer.previousLongitude),
    distanceFromPreviousMeters: optionalCoordinateValue(customer.distanceFromPreviousMeters),
    coordinatePrecisionLevel: customer.coordinatePrecisionLevel || 'unknown',
    coordinateStatus: customer.coordinateStatus || 'confirmed',
    coordinateSource: customer.coordinateSource || 'Coordenada aprovada',
    canonicalKey: customer.geocodingReview?.addressCanonicalKey || customer.canonicalKey || null,
    normalizedAddress: customer.normalizedAddress || null,
    originalAddress: customer.originalAddress || customer.dealAddress || customer.address || null,
    parsedAddress: customer.parsedAddress || null,
    geocoding: customer.geocoding || null,
    geocodingReview: customer.geocodingReview || null,
  };
}

function preserveCoordinateReview(existing = {}, incoming = {}) {
  const incomingCanonicalKey = String(incoming.canonicalKey || '').trim();
  const existingCanonicalKey = String(
    existing.geocodingReview?.addressCanonicalKey
      || existing.canonicalKey
      || '',
  ).trim();
  if (!isCoordinateReviewLocked(existing, incomingCanonicalKey)) return false;
  if (existingCanonicalKey && incomingCanonicalKey && existingCanonicalKey !== incomingCanonicalKey) return false;
  return true;
}

module.exports = {
  CONFIRMED_COORDINATE_STATUSES,
  PRESERVED_COORDINATE_FIELDS,
  canonicalAddressKey,
  canonicalAddressKeyForCustomer,
  coordinateFrom,
  coordinateReviewSnapshot,
  isConfirmedCoordinateStatus,
  isCoordinateReviewLocked,
  preserveCoordinateReview,
};
