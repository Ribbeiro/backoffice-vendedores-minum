const {
  GEOCODING_ALGORITHM_VERSION,
  canonicalKey,
  normalizeString,
  parseBrazilianAddress,
} = require('./addressNormalizer');
const {
  CENTROID_FEATURE_TYPES,
  MAX_BATCH_SIZE,
  calculateHaversineDistanceMeters,
  classifyDistance,
  compareReverseAddress,
  isFiniteCoordinate,
  validateMapboxResponse,
} = require('./mapboxGeocoder');

const DUPLICATE_DISTANCE_METERS = 5;
const FIELD_GROUND_TRUTH_MAX_ACCURACY_METERS = 100;
const FIELD_GROUND_TRUTH_CLUSTER_RADIUS_METERS = 150;
const FIELD_GROUND_TRUTH_MIN_SAMPLES = 2;
const SOURCE_CONFLICT_METERS = 500;
const REVERSE_CONCURRENCY = 5;

function coordinateFromEvent(event = {}) {
  const candidates = [
    event.location,
    event.checkInLocation,
    event.feedbackLocation,
    event.checkOutLocation,
    event,
  ];
  for (const candidate of candidates) {
    const latitude = Number(candidate?.latitude ?? candidate?.checkInLatitude);
    const longitude = Number(candidate?.longitude ?? candidate?.checkInLongitude);
    if (isFiniteCoordinate(latitude, longitude)) {
      return {
        latitude,
        longitude,
        accuracyMeters: Number(candidate?.gpsAccuracyMeters ?? candidate?.accuracy ?? event.gpsAccuracyMeters ?? event.locationAccuracyMeters),
      };
    }
  }
  return null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Check-ins reais so viram evidencia de campo quando ha pelo menos duas
 * amostras boas no mesmo aglomerado. Um unico GPS nunca altera endereco.
 */
function calculateCheckinGroundTruth(visitEvents = []) {
  const samples = (Array.isArray(visitEvents) ? visitEvents : [])
    .map(coordinateFromEvent)
    .filter((point) => point && (!Number.isFinite(point.accuracyMeters) || point.accuracyMeters <= FIELD_GROUND_TRUTH_MAX_ACCURACY_METERS));
  if (!samples.length) return null;

  const center = {
    latitude: median(samples.map((sample) => sample.latitude)),
    longitude: median(samples.map((sample) => sample.longitude)),
  };
  const cluster = samples.filter((sample) => calculateHaversineDistanceMeters(
    center.latitude,
    center.longitude,
    sample.latitude,
    sample.longitude,
  ) <= FIELD_GROUND_TRUTH_CLUSTER_RADIUS_METERS);
  if (cluster.length < FIELD_GROUND_TRUTH_MIN_SAMPLES) {
    return { ...center, count: cluster.length, sampleCount: samples.length, eligible: false };
  }

  return {
    latitude: median(cluster.map((sample) => sample.latitude)),
    longitude: median(cluster.map((sample) => sample.longitude)),
    count: cluster.length,
    sampleCount: samples.length,
    eligible: true,
  };
}

function customerCoordinate(customer = {}) {
  const latitude = Number(customer.latitude);
  const longitude = Number(customer.longitude);
  return isFiniteCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}

function parsedCustomer(customer = {}) {
  return parseBrazilianAddress(
    customer.address || customer.dealAddress || '',
    customer.city || '',
    customer.state || '',
    customer.country || 'Brasil',
  );
}

/** Detecta coordenadas iguais ou a <=5 m somente entre enderecos canonicos distintos. */
function detectDuplicateCoordinates(customers = {}) {
  const entries = Object.entries(customers).map(([id, customer]) => {
    const parsed = parsedCustomer(customer);
    return {
      id,
      customer,
      parsed,
      coordinate: customerCoordinate(customer),
      canonicalKey: canonicalKey(
        parsed.street,
        parsed.houseNumber,
        parsed.place,
        parsed.region,
        parsed.postcode,
        parsed.country,
        parsed.neighborhood,
      ),
    };
  });
  const groups = new Map();
  let sequence = 0;
  for (let left = 0; left < entries.length; left += 1) {
    if (!entries[left].coordinate) continue;
    for (let right = left + 1; right < entries.length; right += 1) {
      if (!entries[right].coordinate || entries[left].canonicalKey === entries[right].canonicalKey) continue;
      const distanceMeters = calculateHaversineDistanceMeters(
        entries[left].coordinate.latitude,
        entries[left].coordinate.longitude,
        entries[right].coordinate.latitude,
        entries[right].coordinate.longitude,
      );
      if (distanceMeters === null || distanceMeters > DUPLICATE_DISTANCE_METERS) continue;
      const groupId = `duplicate_${++sequence}`;
      const register = (entry, other) => {
        const existing = groups.get(entry.id) || [];
        existing.push({
          groupId,
          distanceMeters,
          collidedWithId: other.id,
          collidedWithAddress: other.customer.address || other.customer.dealAddress || '',
          collidedWithCanonicalKey: other.canonicalKey,
        });
        groups.set(entry.id, existing);
      };
      register(entries[left], entries[right]);
      register(entries[right], entries[left]);
    }
  }
  return groups;
}

function mapWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await handler(items[index], index);
    }
  };
  return Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker)).then(() => results);
}

async function geocodeBatch(parsedAddresses, mapboxGeocoderClient) {
  if (!mapboxGeocoderClient || !parsedAddresses.length) return parsedAddresses.map(() => null);
  if (typeof mapboxGeocoderClient.forwardGeocodeBatch === 'function') {
    const chunks = [];
    for (let index = 0; index < parsedAddresses.length; index += MAX_BATCH_SIZE) {
      chunks.push(parsedAddresses.slice(index, index + MAX_BATCH_SIZE));
    }
    const batches = await Promise.all(chunks.map((chunk) => mapboxGeocoderClient.forwardGeocodeBatch(chunk)));
    return batches.flat();
  }
  return mapWithConcurrency(parsedAddresses, REVERSE_CONCURRENCY, (address) => mapboxGeocoderClient.forwardGeocode(address));
}

function coordinateMetadata(result, validation, parsed, previousCoordinate, reverseMatch) {
  return {
    provider: 'mapbox_geocoding_v6',
    algorithmVersion: GEOCODING_ALGORITHM_VERSION,
    geocodedAt: Date.now(),
    status: validation.status,
    reason: validation.reason,
    featureType: result?.featureType || 'unknown',
    accuracy: result?.accuracy || 'unknown',
    confidence: result?.confidence || 'unknown',
    matchCode: result?.matchCode || null,
    originalAddress: parsed.originalAddress,
    normalizedAddress: parsed.normalizedSearchAddress,
    providerAddress: result?.label || '',
    sourceCoordinate: previousCoordinate,
    geocodedCoordinate: result ? { latitude: result.latitude, longitude: result.longitude } : null,
    navigationCoordinate: result ? { latitude: result.navigationLatitude, longitude: result.navigationLongitude } : null,
    entranceCoordinate: result?.entranceLatitude !== null && result?.entranceLongitude !== null
      ? { latitude: result.entranceLatitude, longitude: result.entranceLongitude }
      : null,
    distanceFromPreviousMeters: previousCoordinate && result
      ? calculateHaversineDistanceMeters(previousCoordinate.latitude, previousCoordinate.longitude, result.latitude, result.longitude)
      : null,
    reverseMatch,
  };
}

function baseAuditResult(id, customer, parsed, duplicateGroup, fieldGroundTruth) {
  const currentCoordinate = customerCoordinate(customer);
  return {
    id,
    name: customer.name || customer.clientName || customer.opportunity || id,
    originalAddress: parsed.originalAddress,
    normalizedAddress: parsed.normalizedSearchAddress,
    canonicalKey: canonicalKey(parsed.street, parsed.houseNumber, parsed.place, parsed.region, parsed.postcode, parsed.country, parsed.neighborhood),
    city: parsed.place,
    state: parsed.region,
    isRural: parsed.isRural,
    hasNoNumber: parsed.hasNoNumber,
    sourceCoordinate: customer.sourceLatitude !== undefined && customer.sourceLongitude !== undefined
      ? { latitude: Number(customer.sourceLatitude), longitude: Number(customer.sourceLongitude) }
      : currentCoordinate,
    currentCoordinate,
    previousCoordinate: currentCoordinate,
    geocodedCoordinate: null,
    proposedCoordinate: null,
    navigationCoordinate: null,
    entranceCoordinate: null,
    distanceFromPreviousMeters: null,
    distanceClassification: 'unknown',
    coordinatePrecisionLevel: customer.coordinatePrecisionLevel || 'legacy_unverified',
    coordinateStatus: customer.coordinateStatus || (currentCoordinate ? 'legacy_unverified' : 'missing_coordinate'),
    coordinateSource: customer.coordinateSource || 'legacy',
    featureType: 'unknown',
    confidence: 'unknown',
    accuracy: 'unknown',
    matchCode: null,
    numberMatch: 'unknown',
    possiblePostalCentroid: false,
    duplicateCoordinateDistinctAddress: Boolean(duplicateGroup?.length),
    duplicateCoordinateGroup: duplicateGroup || [],
    reverseMatch: null,
    reverseMismatch: false,
    sourceConflict: false,
    fieldGroundTruth,
    fieldGroundTruthDistanceMeters: null,
    fieldGroundTruthCandidateDistanceMeters: null,
    candidateVerified: false,
    approvalEligible: false,
    motivo: 'Aguardando auditoria.',
    geocoding: null,
  };
}

/**
 * Retorna resultados de auditoria sem atualizar customers. A aplicacao so e
 * feita por uma Cloud Function administrativa depois da escolha humana.
 */
async function auditExistingCustomers({ customers = {}, visitEventsByCustomer = {}, mapboxGeocoderClient = null, customerIds = null }) {
  const duplicateCollisions = detectDuplicateCoordinates(customers);
  const ids = (customerIds || Object.keys(customers)).filter((id) => customers[id]);
  const entries = ids.map((id) => {
    const customer = customers[id];
    const parsed = parsedCustomer(customer);
    const eventKeys = [id, customer.id, customer.externalId].filter((key) => key !== undefined && key !== null).map(String);
    const fieldGroundTruth = calculateCheckinGroundTruth(eventKeys.flatMap((key) => visitEventsByCustomer[key] || []));
    return { id, customer, parsed, fieldGroundTruth };
  });
  const geocoded = await geocodeBatch(entries.map((entry) => entry.parsed), mapboxGeocoderClient);

  const results = entries.map((entry, index) => baseAuditResult(
    entry.id,
    entry.customer,
    entry.parsed,
    duplicateCollisions.get(entry.id),
    entry.fieldGroundTruth,
  ));

  await mapWithConcurrency(results, REVERSE_CONCURRENCY, async (recordResult, index) => {
    const { customer, parsed, fieldGroundTruth } = entries[index];
    const result = geocoded[index];
    if (fieldGroundTruth?.eligible && recordResult.currentCoordinate) {
      recordResult.fieldGroundTruthDistanceMeters = calculateHaversineDistanceMeters(
        recordResult.currentCoordinate.latitude,
        recordResult.currentCoordinate.longitude,
        fieldGroundTruth.latitude,
        fieldGroundTruth.longitude,
      );
      if (recordResult.fieldGroundTruthDistanceMeters > SOURCE_CONFLICT_METERS) recordResult.sourceConflict = true;
    }

    if (!parsed.street && !parsed.place) {
      recordResult.coordinateStatus = 'missing_coordinate';
      recordResult.motivo = 'Endereco insuficiente para geocodificacao.';
      return recordResult;
    }
    if (!mapboxGeocoderClient) {
      recordResult.coordinateStatus = 'pending_configuration';
      recordResult.motivo = 'Geocodificador Mapbox v6 nao esta configurado.';
      return recordResult;
    }
    if (!result) {
      recordResult.coordinateStatus = 'not_found';
      recordResult.motivo = 'Nenhuma correspondencia encontrada no Mapbox.';
      return recordResult;
    }

    const validation = validateMapboxResponse(result.rawFeature, parsed);
    let reverse = null;
    try {
      reverse = await mapboxGeocoderClient.reverseGeocode(result.latitude, result.longitude);
    } catch (error) {
      reverse = null;
    }
    const reverseMatch = compareReverseAddress(parsed, reverse);
    const geocoding = coordinateMetadata(result, validation, parsed, recordResult.currentCoordinate, reverseMatch);

    recordResult.geocodedCoordinate = geocoding.geocodedCoordinate;
    recordResult.proposedCoordinate = geocoding.geocodedCoordinate;
    recordResult.navigationCoordinate = geocoding.navigationCoordinate;
    recordResult.entranceCoordinate = geocoding.entranceCoordinate;
    recordResult.distanceFromPreviousMeters = geocoding.distanceFromPreviousMeters;
    recordResult.distanceClassification = classifyDistance(geocoding.distanceFromPreviousMeters);
    recordResult.featureType = geocoding.featureType;
    recordResult.confidence = geocoding.confidence;
    recordResult.accuracy = geocoding.accuracy;
    recordResult.matchCode = geocoding.matchCode;
    recordResult.numberMatch = geocoding.matchCode?.address_number || 'unknown';
    recordResult.reverseMatch = reverseMatch;
    recordResult.reverseMismatch = reverseMatch.checked && reverseMatch.matches === false;
    recordResult.possiblePostalCentroid = Boolean(parsed.houseNumber && (
      CENTROID_FEATURE_TYPES.has(result.featureType) || ['interpolated', 'approximate', 'unknown'].includes(result.accuracy)
    ));
    recordResult.geocoding = geocoding;

    if (fieldGroundTruth?.eligible) {
      recordResult.fieldGroundTruthCandidateDistanceMeters = calculateHaversineDistanceMeters(
        fieldGroundTruth.latitude,
        fieldGroundTruth.longitude,
        result.latitude,
        result.longitude,
      );
    }

    if (recordResult.reverseMismatch) {
      recordResult.coordinateStatus = 'reverse_mismatch';
      recordResult.motivo = reverseMatch.reason;
    } else if (recordResult.duplicateCoordinateDistinctAddress) {
      recordResult.coordinateStatus = 'duplicate_coordinate_distinct_address';
      recordResult.motivo = 'Coordenada atual coincide com endereco canonico distinto; exige revisao humana.';
    } else if (recordResult.possiblePostalCentroid) {
      recordResult.coordinateStatus = 'postal_or_street_centroid_suspected';
      recordResult.motivo = 'Resultado aproximado nao pode ser usado como porta de endereco numerado.';
    } else if (recordResult.sourceConflict && fieldGroundTruth?.eligible) {
      recordResult.coordinateStatus = 'source_conflict';
      recordResult.motivo = `Coordenada atual diverge ${recordResult.fieldGroundTruthDistanceMeters} m da evidencia de campo consolidada.`;
    } else {
      recordResult.coordinateStatus = validation.status;
      recordResult.motivo = validation.reason;
    }

    recordResult.candidateVerified = validation.accepted && reverseMatch.matches === true;
    recordResult.geocoding.status = recordResult.coordinateStatus;
    recordResult.geocoding.reason = recordResult.motivo;
    recordResult.approvalEligible = recordResult.candidateVerified;
    return recordResult;
  });

  return results;
}

function summarizeAudit(results = []) {
  const byStatus = results.reduce((summary, item) => {
    summary[item.coordinateStatus] = (summary[item.coordinateStatus] || 0) + 1;
    return summary;
  }, {});
  return {
    total: results.length,
    confirmed: byStatus.confirmed || 0,
    approvalEligible: results.filter((item) => item.approvalEligible).length,
    needsReview: results.filter((item) => item.coordinateStatus !== 'confirmed').length,
    missingCoordinate: byStatus.missing_coordinate || 0,
    duplicateCoordinateDistinctAddress: byStatus.duplicate_coordinate_distinct_address || 0,
    reverseMismatch: byStatus.reverse_mismatch || 0,
    sourceConflict: byStatus.source_conflict || 0,
    postalOrStreetCentroid: byStatus.postal_or_street_centroid_suspected || 0,
    catastrophicDistance: results.filter((item) => item.distanceClassification === 'catastrophic').length,
  };
}

module.exports = {
  DUPLICATE_DISTANCE_METERS,
  FIELD_GROUND_TRUTH_MIN_SAMPLES,
  auditExistingCustomers,
  calculateCheckinGroundTruth,
  detectDuplicateCoordinates,
  summarizeAudit,
};
