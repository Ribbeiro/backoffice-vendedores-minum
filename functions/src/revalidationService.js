const {
  parseBrazilianAddress,
  canonicalKey,
} = require('./addressNormalizer');
const {
  calculateHaversineDistanceMeters,
  classifyDistance,
  validateMapboxResponse,
} = require('./mapboxGeocoder');

/**
 * Agrupa check-ins reais por cliente e calcula a mediana espacial robusta (Ground Truth).
 */
function calculateCheckinGroundTruth(visitEvents = []) {
  if (!Array.isArray(visitEvents) || visitEvents.length === 0) return null;

  // Filtrar eventos com coordenadas válidas e boa precisão GPS se disponível
  const validCheckins = visitEvents.filter((ev) => {
    const lat = Number(ev.latitude || ev.checkInLatitude);
    const lon = Number(ev.longitude || ev.checkInLongitude);
    const acc = Number(ev.gpsAccuracyMeters || ev.accuracy);
    const isValid = Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
    const isAccurate = !Number.isFinite(acc) || acc <= 100; // ignora GPS > 100m
    return isValid && isAccurate;
  });

  if (validCheckins.length === 0) return null;

  // Calcular mediana simples de Lat/Lon
  const lats = validCheckins.map((ev) => Number(ev.latitude || ev.checkInLatitude)).sort((a, b) => a - b);
  const lons = validCheckins.map((ev) => Number(ev.longitude || ev.checkInLongitude)).sort((a, b) => a - b);

  const medianLat = lats[Math.floor(lats.length / 2)];
  const medianLon = lons[Math.floor(lons.length / 2)];

  return {
    latitude: medianLat,
    longitude: medianLon,
    count: validCheckins.length,
  };
}

/**
 * Detecta colisões de coordenadas entre endereços normalizados diferentes (Seção 3 do prompt).
 * Identifica coordenadas iguais ou com distância <= 5m atribuídas a endereços com chaves canônicas distintas.
 */
function detectDuplicateCoordinates(customers = {}) {
  const duplicateGroups = new Map();
  const customerList = Object.entries(customers).map(([id, c]) => ({ id, ...c }));

  for (let i = 0; i < customerList.length; i += 1) {
    const c1 = customerList[i];
    if (!c1.latitude || !c1.longitude || (c1.latitude === 0 && c1.longitude === 0)) continue;

    for (let j = i + 1; j < customerList.length; j += 1) {
      const c2 = customerList[j];
      if (!c2.latitude || !c2.longitude || (c2.latitude === 0 && c2.longitude === 0)) continue;

      // Calcular distância Haversine
      const dist = calculateHaversineDistanceMeters(c1.latitude, c1.longitude, c2.latitude, c2.longitude);

      if (dist !== null && dist <= 5) {
        const addr1 = parseBrazilianAddress(c1.address || c1.dealAddress, c1.city, c1.state);
        const addr2 = parseBrazilianAddress(c2.address || c2.dealAddress, c2.city, c2.state);

        const key1 = canonicalKey(addr1.street, addr1.houseNumber, addr1.place, addr1.region);
        const key2 = canonicalKey(addr2.street, addr2.houseNumber, addr2.place, addr2.region);

        // Se possuem chaves canônicas de rua distintas, é uma colisão de coordenadas!
        if (key1 !== key2 && addr1.street !== addr2.street) {
          const groupId = `dup_${Math.min(i, j)}_${Math.max(i, j)}`;
          duplicateGroups.set(c1.id, { groupId, collidedWithId: c2.id, collidedWithAddress: c2.address });
          duplicateGroups.set(c2.id, { groupId, collidedWithId: c1.id, collidedWithAddress: c1.address });
        }
      }
    }
  }

  return duplicateGroups;
}

/**
 * Serviço de Revalidação da Base de Clientes Existentes (Seção 29 do prompt).
 */
async function auditExistingCustomers({ customers = {}, visitEventsByCustomer = {}, mapboxGeocoderClient = null }) {
  const duplicateCollisions = detectDuplicateCoordinates(customers);
  const revalidationResults = [];

  for (const [id, customer] of Object.entries(customers)) {
    const rawAddress = customer.address || customer.dealAddress || '';
    const rawCity = customer.city || '';
    const rawState = customer.state || '';

    const parsed = parseBrazilianAddress(rawAddress, rawCity, rawState, customer.country || 'Brasil');
    const currentLat = Number(customer.latitude || 0);
    const currentLon = Number(customer.longitude || 0);
    const hasCurrent = currentLat !== 0 && currentLon !== 0;

    const recordResult = {
      id,
      name: customer.name || customer.clientName || customer.opportunity || id,
      originalAddress: rawAddress,
      normalizedAddress: parsed.normalizedSearchAddress,
      city: parsed.place,
      state: parsed.region,
      currentCoordinate: hasCurrent ? { latitude: currentLat, longitude: currentLon } : null,
      proposedCoordinate: null,
      navigationCoordinate: null,
      distanceFromPreviousMeters: null,
      distanceClassification: 'normal',
      featureType: 'unknown',
      confidence: 'unknown',
      accuracy: 'unknown',
      numberMatch: 'unmatched',
      coordinateStatus: 'legacy_unverified',
      possiblePostalCentroid: false,
      duplicateCoordinateDistinctAddress: Boolean(duplicateCollisions.get(id)),
      reverseMismatch: false,
      sourceConflict: false,
      fieldGroundTruthDistanceMeters: null,
      motivo: 'Aguardando auditoria',
    };

    // Verificar Ground Truth de Check-ins Reais
    const checkinGroundTruth = calculateCheckinGroundTruth(visitEventsByCustomer[id]);
    if (checkinGroundTruth && hasCurrent) {
      const distToCheckin = calculateHaversineDistanceMeters(currentLat, currentLon, checkinGroundTruth.latitude, checkinGroundTruth.longitude);
      recordResult.fieldGroundTruthDistanceMeters = distToCheckin;
      if (distToCheckin > 800) {
        recordResult.sourceConflict = true;
        recordResult.motivo = `Coordenada cadastrada a ${distToCheckin} m da mediana dos check-ins do vendedor.`;
      }
    }

    if (!parsed.street && !parsed.place) {
      recordResult.coordinateStatus = 'missing_coordinate';
      recordResult.motivo = 'Endereço insuficiente para geocodificação.';
      revalidationResults.push(recordResult);
      continue;
    }

    if (!mapboxGeocoderClient) {
      recordResult.coordinateStatus = 'pending_configuration';
      recordResult.motivo = 'Geocodificador Mapbox v6 não disponível.';
      revalidationResults.push(recordResult);
      continue;
    }

    try {
      const geocodeRes = await mapboxGeocoderClient.forwardGeocode(parsed);
      if (!geocodeRes) {
        recordResult.coordinateStatus = 'not_found';
        recordResult.motivo = 'Nenhuma correspondência encontrada no Mapbox.';
        revalidationResults.push(recordResult);
        continue;
      }

      const validation = validateMapboxResponse(geocodeRes.rawFeature, parsed);

      recordResult.proposedCoordinate = { latitude: geocodeRes.latitude, longitude: geocodeRes.longitude };
      recordResult.navigationCoordinate = { latitude: geocodeRes.navigationLatitude, longitude: geocodeRes.navigationLongitude };
      recordResult.featureType = geocodeRes.featureType;
      recordResult.confidence = geocodeRes.confidence;
      recordResult.accuracy = geocodeRes.accuracy;
      recordResult.numberMatch = geocodeRes.matchCode?.address_number || 'unmatched';

      // Calcular distância Haversine da antiga para a proposta
      if (hasCurrent) {
        const dist = calculateHaversineDistanceMeters(currentLat, currentLon, geocodeRes.latitude, geocodeRes.longitude);
        recordResult.distanceFromPreviousMeters = dist;
        recordResult.distanceClassification = classifyDistance(dist);
      }

      // Reverse Consistency Check
      const reverseRes = await mapboxGeocoderClient.reverseGeocode(geocodeRes.latitude, geocodeRes.longitude);
      if (reverseRes && parsed.street) {
        const normOriginalStreet = parsed.street.toLowerCase();
        const normReverseStreet = (reverseRes.street || '').toLowerCase();
        if (normReverseStreet && !normOriginalStreet.includes(normReverseStreet) && !normReverseStreet.includes(normOriginalStreet)) {
          recordResult.reverseMismatch = true;
          recordResult.coordinateStatus = 'reverse_mismatch';
          recordResult.motivo = `Reverse geocoding aponta para outra rua ('${reverseRes.street}').`;
        }
      }

      // Detecção de Centroide de Rua / CEP
      if (['street', 'place', 'postcode', 'locality'].includes(geocodeRes.featureType) && parsed.houseNumber) {
        recordResult.possiblePostalCentroid = true;
        if (recordResult.coordinateStatus !== 'reverse_mismatch') {
          recordResult.coordinateStatus = 'possibly_postal_centroid';
          recordResult.motivo = `Coordenada proposta é centroide de ${geocodeRes.featureType}, não porta do imóvel ${parsed.houseNumber}.`;
        }
      } else if (!recordResult.reverseMismatch) {
        recordResult.coordinateStatus = validation.status;
        recordResult.motivo = validation.reason;
      }

    } catch (err) {
      recordResult.coordinateStatus = 'error';
      recordResult.motivo = err.message || 'Erro na revalidação.';
    }

    revalidationResults.push(recordResult);
  }

  return revalidationResults;
}

module.exports = {
  auditExistingCustomers,
  calculateCheckinGroundTruth,
  detectDuplicateCoordinates,
};
