const { normalizeString, normalizeState } = require('./addressNormalizer');

const MAX_BATCH_SIZE = 50;
const CONFIRMED_ACCURACIES = new Set(['rooftop', 'parcel', 'point']);
const CONFIRMED_CONFIDENCES = new Set(['exact', 'high']);
const CENTROID_FEATURE_TYPES = new Set(['street', 'place', 'locality', 'postcode', 'district', 'neighborhood']);

function isFiniteCoordinate(latitude, longitude) {
  return Number.isFinite(Number(latitude))
    && Number.isFinite(Number(longitude))
    && (Number(latitude) !== 0 || Number(longitude) !== 0);
}

function calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const radius = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const a = Math.sin(toRadians(lat2 - lat1) / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(toRadians(lon2 - lon1) / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function classifyDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return 'unknown';
  if (distanceMeters <= 100) return 'normal';
  if (distanceMeters <= 300) return 'attention';
  if (distanceMeters <= 500) return 'suspicious';
  if (distanceMeters <= 2000) return 'critical';
  return 'catastrophic';
}

function featureTypeOf(feature) {
  return String(feature?.properties?.feature_type || feature?.place_type?.[0] || 'unknown').toLowerCase();
}

function featureCoordinates(feature) {
  const coordinates = feature?.properties?.coordinates || {};
  const [longitude, latitude] = feature?.geometry?.coordinates || [];
  return {
    latitude: Number(coordinates.latitude ?? latitude),
    longitude: Number(coordinates.longitude ?? longitude),
    accuracy: String(coordinates.accuracy || feature?.properties?.accuracy || 'unknown').toLowerCase(),
    routablePoints: Array.isArray(coordinates.routable_points) ? coordinates.routable_points : [],
  };
}

function contextOf(feature) {
  return feature?.properties?.context || feature?.context || {};
}

function extractStateFromMapboxFeature(feature) {
  const region = contextOf(feature).region || {};
  const code = String(region.region_code || region.short_code || '').toUpperCase();
  const match = code.match(/(?:BR-)?([A-Z]{2})$/);
  return match?.[1] || normalizeState(region.name || '');
}

function extractFeatureAddress(feature) {
  const context = contextOf(feature);
  const coordinates = featureCoordinates(feature);
  return {
    featureType: featureTypeOf(feature),
    street: context.street?.name || feature?.properties?.street || '',
    houseNumber: context.address?.address_number || feature?.properties?.address_number || feature?.properties?.address || '',
    place: context.place?.name || context.locality?.name || '',
    region: extractStateFromMapboxFeature(feature),
    postcode: String(context.postcode?.name || '').replace(/\D/g, ''),
    label: feature?.properties?.full_address || feature?.properties?.name || feature?.place_name || '',
    accuracy: coordinates.accuracy,
  };
}

function matchesText(expected, actual) {
  const a = normalizeString(expected).toLowerCase();
  const b = normalizeString(actual).toLowerCase();
  return !a || !b || a === b || a.includes(b) || b.includes(a);
}

/** A resposta so vira destino confirmado quando o Mapbox prova a porta do imovel. */
function validateMapboxResponse(feature, parsedAddress) {
  if (!feature) return { accepted: false, status: 'not_found', reason: 'Nenhum resultado foi retornado pelo Mapbox.' };

  const featureType = featureTypeOf(feature);
  const matchCode = feature?.properties?.match_code;
  const coordinates = featureCoordinates(feature);
  const accuracy = coordinates.accuracy;
  const confidence = String(matchCode?.confidence || feature?.properties?.confidence || 'unknown').toLowerCase();
  const resultState = extractStateFromMapboxFeature(feature);
  const expectedState = normalizeState(parsedAddress.region);
  const isNumbered = Boolean(parsedAddress.houseNumber && !parsedAddress.hasNoNumber && !parsedAddress.isRural);

  if (!isFiniteCoordinate(coordinates.latitude, coordinates.longitude)) {
    return { accepted: false, status: 'not_found', reason: 'O resultado do Mapbox nao contem coordenadas validas.' };
  }
  if (expectedState && resultState && resultState !== expectedState) {
    return { accepted: false, status: 'source_conflict', reason: `A UF retornada (${resultState}) diverge da UF esperada (${expectedState}).` };
  }
  if (isNumbered) {
    if (featureType !== 'address') {
      return { accepted: false, status: 'needs_review', reason: `Endereco numerado retornou '${featureType}', e nao uma porta de imovel.` };
    }
    if (!matchCode) {
      return { accepted: false, status: 'needs_review', reason: 'O Mapbox nao forneceu match_code para confirmar o numero do imovel.' };
    }
    if (matchCode.address_number !== 'matched') {
      return { accepted: false, status: 'needs_review', reason: `Numero do imovel '${matchCode.address_number || 'ausente'}' nao foi confirmado.` };
    }
    if (parsedAddress.street && matchCode.street !== 'matched') {
      return { accepted: false, status: 'needs_review', reason: `Logradouro '${matchCode.street || 'ausente'}' nao foi confirmado.` };
    }
    if (parsedAddress.place && !['matched', 'inferred', 'not_applicable'].includes(matchCode.place || '')) {
      return { accepted: false, status: 'needs_review', reason: `Cidade '${matchCode.place || 'ausente'}' nao foi confirmada.` };
    }
    if (!CONFIRMED_CONFIDENCES.has(confidence)) {
      return { accepted: false, status: 'needs_review', reason: `Confianca '${confidence}' requer revisao humana.` };
    }
    if (!CONFIRMED_ACCURACIES.has(accuracy)) {
      return { accepted: false, status: 'needs_review', reason: `Precisao '${accuracy}' nao confirma a porta do imovel.` };
    }
    return { accepted: true, status: 'confirmed', reason: 'Porta confirmada por tipo address, match_code, confianca e precisao.' };
  }

  if (CENTROID_FEATURE_TYPES.has(featureType) || parsedAddress.isRural || parsedAddress.hasNoNumber) {
    return { accepted: false, status: 'needs_review', reason: 'Endereco sem numero, rural ou aproximado exige revisao humana antes de ser usado na navegacao.' };
  }
  return { accepted: false, status: 'partial', reason: `Resultado '${featureType}' nao possui evidencias suficientes para confirmacao automatica.` };
}

function toStructuredQuery(parsedAddress) {
  const query = { country: parsedAddress.countryCode || 'BR', limit: 1, autocomplete: false, entrances: true };
  if (parsedAddress.street) query.street = parsedAddress.street;
  if (parsedAddress.houseNumber && !parsedAddress.hasNoNumber && !parsedAddress.isRural) query.address_number = parsedAddress.houseNumber;
  if (parsedAddress.place) query.place = parsedAddress.place;
  if (parsedAddress.region) query.region = parsedAddress.region;
  if (parsedAddress.postcode) query.postcode = parsedAddress.postcode;
  if (parsedAddress.houseNumber) query.types = ['address'];
  if (!parsedAddress.street && parsedAddress.normalizedSearchAddress) query.q = parsedAddress.normalizedSearchAddress;
  return query;
}

function mapFeatureToResult(feature) {
  if (!feature) return null;
  const coordinates = featureCoordinates(feature);
  if (!isFiniteCoordinate(coordinates.latitude, coordinates.longitude)) return null;
  const defaultPoint = coordinates.routablePoints.find((point) => point?.name === 'default') || coordinates.routablePoints[0];
  const entrancePoint = coordinates.routablePoints.find((point) => point?.name === 'entrance') || null;
  const navigationLatitude = Number(defaultPoint?.latitude ?? coordinates.latitude);
  const navigationLongitude = Number(defaultPoint?.longitude ?? coordinates.longitude);
  const matchCode = feature?.properties?.match_code || null;
  return {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    navigationLatitude: isFiniteCoordinate(navigationLatitude, navigationLongitude) ? navigationLatitude : coordinates.latitude,
    navigationLongitude: isFiniteCoordinate(navigationLatitude, navigationLongitude) ? navigationLongitude : coordinates.longitude,
    entranceLatitude: isFiniteCoordinate(entrancePoint?.latitude, entrancePoint?.longitude) ? Number(entrancePoint.latitude) : null,
    entranceLongitude: isFiniteCoordinate(entrancePoint?.latitude, entrancePoint?.longitude) ? Number(entrancePoint.longitude) : null,
    featureType: featureTypeOf(feature),
    accuracy: coordinates.accuracy,
    confidence: String(matchCode?.confidence || feature?.properties?.confidence || 'unknown').toLowerCase(),
    matchCode,
    label: extractFeatureAddress(feature).label,
    rawFeature: feature,
  };
}

function createMapboxGeocoderClient(token, { fetchJsonFn, fetchBatchFn = null, permanent = false } = {}) {
  if (typeof fetchJsonFn !== 'function') throw new Error('fetchJsonFn e obrigatoria para o geocodificador Mapbox.');
  const queryUrl = (path, query) => {
    const url = new URL(`https://api.mapbox.com/search/geocode/v6/${path}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    });
    url.searchParams.set('access_token', token);
    if (permanent) url.searchParams.set('permanent', 'true');
    return url.toString();
  };

  return {
    async forwardGeocode(parsedAddress) {
      const data = await fetchJsonFn(queryUrl('forward', toStructuredQuery(parsedAddress)));
      return mapFeatureToResult(data?.features?.[0]);
    },
    async forwardGeocodeBatch(parsedAddresses) {
      if (!Array.isArray(parsedAddresses) || parsedAddresses.length === 0) return [];
      if (parsedAddresses.length > MAX_BATCH_SIZE) throw new Error(`O lote Mapbox suporta ate ${MAX_BATCH_SIZE} enderecos por chamada.`);
      if (!fetchBatchFn) return Promise.all(parsedAddresses.map((address) => this.forwardGeocode(address)));
      const data = await fetchBatchFn(queryUrl('batch', {}), parsedAddresses.map(toStructuredQuery));
      return (data?.batch || []).map((entry) => mapFeatureToResult(entry?.features?.[0]));
    },
    async reverseGeocode(latitude, longitude) {
      const data = await fetchJsonFn(queryUrl('reverse', { latitude, longitude, country: 'BR', limit: 1, types: ['address'] }));
      const feature = data?.features?.[0];
      return feature ? extractFeatureAddress(feature) : null;
    },
  };
}

function compareReverseAddress(parsedAddress, reverseAddress) {
  if (!reverseAddress) return { checked: false, matches: null, reason: 'Reverse geocoding indisponivel.' };
  const streetMatch = matchesText(parsedAddress.street, reverseAddress.street);
  const numberMatch = !parsedAddress.houseNumber || String(parsedAddress.houseNumber) === String(reverseAddress.houseNumber || '');
  const placeMatch = matchesText(parsedAddress.place, reverseAddress.place);
  const regionMatch = !parsedAddress.region || normalizeState(parsedAddress.region) === normalizeState(reverseAddress.region);
  const postcodeMatch = !parsedAddress.postcode || !reverseAddress.postcode || String(parsedAddress.postcode) === String(reverseAddress.postcode).replace(/\D/g, '');
  const matches = Boolean(streetMatch && numberMatch && placeMatch && regionMatch && postcodeMatch);
  return {
    checked: true,
    matches,
    streetMatch,
    numberMatch,
    placeMatch,
    regionMatch,
    postcodeMatch,
    reason: matches ? 'Forward e reverse consistentes.' : 'Forward e reverse divergem em ao menos um componente do endereco.',
  };
}

module.exports = {
  CENTROID_FEATURE_TYPES,
  CONFIRMED_ACCURACIES,
  CONFIRMED_CONFIDENCES,
  MAX_BATCH_SIZE,
  calculateHaversineDistanceMeters,
  classifyDistance,
  compareReverseAddress,
  createMapboxGeocoderClient,
  extractFeatureAddress,
  extractStateFromMapboxFeature,
  featureTypeOf,
  isFiniteCoordinate,
  mapFeatureToResult,
  toStructuredQuery,
  validateMapboxResponse,
};
