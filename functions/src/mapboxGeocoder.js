const { normalizeString, canonicalKey } = require('./addressNormalizer');

/**
 * Calcula a distância em metros entre duas coordenadas utilizando a fórmula de Haversine.
 */
function calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const R = 6371000; // Raio da Terra em metros
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Classifica a distância entre a coordenada antiga e a nova conforme especificado no prompt:
 * 0–100 m: normal
 * 100–300 m: attention
 * 300–500 m: suspicious
 * 500 m–2 km: critical
 * >2 km: catastrophic
 */
function classifyDistance(distanceMeters) {
  if (distanceMeters === null || distanceMeters === undefined) return 'unknown';
  if (distanceMeters <= 100) return 'normal';
  if (distanceMeters <= 300) return 'attention';
  if (distanceMeters <= 500) return 'suspicious';
  if (distanceMeters <= 2000) return 'critical';
  return 'catastrophic';
}

/**
 * Extrai o estado/UF de um recurso (Feature) do Mapbox.
 */
function extractStateFromMapboxFeature(feature) {
  const context = feature?.properties?.context || feature?.context || {};
  const region = context.region || {};
  const code = String(region.region_code || region.short_code || '').toUpperCase();
  const codeMatch = code.match(/BR-([A-Z]{2})$/);
  if (codeMatch) return codeMatch[1];

  const regionName = normalizeString(region.name || '').toUpperCase();
  const STATE_NAMES = {
    AC: 'ACRE', AL: 'ALAGOAS', AP: 'AMAPA', AM: 'AMAZONAS', BA: 'BAHIA', CE: 'CEARA',
    DF: 'DISTRITO FEDERAL', ES: 'ESPIRITO SANTO', GO: 'GOIAS', MA: 'MARANHAO', MT: 'MATO GROSSO',
    MS: 'MATO GROSSO DO SUL', MG: 'MINAS GERAIS', PA: 'PARA', PB: 'PARAIBA', PR: 'PARANA',
    PE: 'PERNAMBUCO', PI: 'PIAUI', RJ: 'RIO DE JANEIRO', RN: 'RIO GRANDE DO NORTE',
    RS: 'RIO GRANDE DO SUL', RO: 'RONDONIA', RR: 'RORAIMA', SC: 'SANTA CATARINA', SP: 'SAO PAULO',
    SE: 'SERGIPE', TO: 'TOCANTINS',
  };
  const found = Object.entries(STATE_NAMES).find(([, name]) => name === regionName);
  return found?.[0] || '';
}

/**
 * Valida a resposta do Mapbox para um determinado endereço parsed.
 * Aplica as regras estritas do adendo/prompt.
 */
function validateMapboxResponse(feature, parsedAddress) {
  if (!feature) {
    return {
      accepted: false,
      status: 'not_found',
      reason: 'Nenhum resultado foi retornado pelo Mapbox.',
    };
  }

  const featureType = feature.properties?.feature_type || feature.place_type?.[0] || 'unknown';
  const matchCode = feature.properties?.match_code || {};
  const coordinates = feature.properties?.coordinates || {};
  const accuracy = coordinates.accuracy || feature.properties?.accuracy || null;
  const confidence = matchCode.confidence || feature.properties?.confidence || null;

  const resultState = extractStateFromMapboxFeature(feature);
  const expectedState = parsedAddress.region ? parsedAddress.region.toUpperCase() : '';

  // 1. Validação de Estado/UF
  if (expectedState && expectedState.length === 2 && resultState && resultState !== expectedState) {
    return {
      accepted: false,
      status: 'source_conflict',
      reason: `A UF retornada (${resultState}) diverge da UF esperada (${expectedState}).`,
    };
  }

  // 2. Para endereços numerados, exigir prova do número (Seção 8 do prompt)
  const isNumbered = Boolean(parsedAddress.houseNumber && !parsedAddress.hasNoNumber);

  if (isNumbered) {
    if (featureType !== 'address') {
      return {
        accepted: false,
        status: 'needs_review',
        reason: `Endereço numerado retornou nível '${featureType}' em vez de 'address'. Exige revisão.`,
      };
    }

    const numberMatch = matchCode.address_number;
    if (numberMatch && numberMatch !== 'matched') {
      return {
        accepted: false,
        status: 'needs_review',
        reason: `Correspondência do número do imóvel é '${numberMatch}' (não exata). Exige revisão.`,
      };
    }

    if (accuracy && ['interpolated', 'approximate', 'street_centroid', 'postcode_centroid'].includes(String(accuracy).toLowerCase())) {
      return {
        accepted: false,
        status: 'needs_review',
        reason: `A precisão da coordenada é '${accuracy}'. Não pode ser confirmada automaticamente como porta.`,
      };
    }
  }

  // 3. Validação de tipo genérico (street ou place nunca podem virar confirmed)
  if (['street', 'place', 'locality', 'postcode', 'district'].includes(featureType)) {
    return {
      accepted: false,
      status: 'partial',
      reason: `Resultado é um centroide de '${featureType}'. Não confirmado como porta exata.`,
    };
  }

  return {
    accepted: true,
    status: 'confirmed',
    reason: 'Endereço e número confirmados com alta precisão.',
  };
}

/**
 * Cria o cliente de Geocodificação Mapbox v6 com Structured Input.
 */
function createMapboxGeocoderClient(token, { fetchJsonFn }) {
  return {
    /**
     * Executa Forward Geocoding Estruturado.
     */
    async forwardGeocode(parsedAddress) {
      if (!token) throw new Error('Token do Mapbox não configurado.');

      const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
      url.searchParams.set('country', 'BR');
      url.searchParams.set('limit', '1');
      url.searchParams.set('permanent', 'true');
      url.searchParams.set('access_token', token);

      // Usar Structured Input conforme recomendado
      if (parsedAddress.street) url.searchParams.set('street', parsedAddress.street);
      if (parsedAddress.houseNumber) url.searchParams.set('address_number', parsedAddress.houseNumber);
      if (parsedAddress.place) url.searchParams.set('place', parsedAddress.place);
      if (parsedAddress.region) url.searchParams.set('region', parsedAddress.region);
      if (parsedAddress.postcode) url.searchParams.set('postcode', parsedAddress.postcode);

      // Se não tiver rua, usa a busca por query
      if (!parsedAddress.street && parsedAddress.normalizedSearchAddress) {
        url.searchParams.set('q', parsedAddress.normalizedSearchAddress);
      }

      const data = await fetchJsonFn(url.toString());
      const feature = data?.features?.[0];
      if (!feature) return null;

      const [longitude, latitude] = feature.geometry?.coordinates || [];
      const coordinatesProp = feature.properties?.coordinates || {};
      const routablePoints = coordinatesProp.routable_points || [];

      // Ponto de navegação veicular
      let navigationLatitude = Number(coordinatesProp.latitude ?? latitude);
      let navigationLongitude = Number(coordinatesProp.longitude ?? longitude);

      if (routablePoints.length > 0 && routablePoints[0].latitude && routablePoints[0].longitude) {
        navigationLatitude = Number(routablePoints[0].latitude);
        navigationLongitude = Number(routablePoints[0].longitude);
      }

      const featureType = feature.properties?.feature_type || feature.place_type?.[0] || 'unknown';
      const matchCode = feature.properties?.match_code || {};
      const accuracy = coordinatesProp.accuracy || feature.properties?.accuracy || 'unknown';
      const confidence = matchCode.confidence || feature.properties?.confidence || 'unknown';

      return {
        latitude: Number(coordinatesProp.latitude ?? latitude),
        longitude: Number(coordinatesProp.longitude ?? longitude),
        navigationLatitude,
        navigationLongitude,
        featureType,
        accuracy,
        confidence,
        matchCode,
        label: feature.properties?.full_address || feature.properties?.name || '',
        rawFeature: feature,
      };
    },

    /**
     * Executa Reverse Geocoding para Forward + Reverse Consistency Check (Seção 7 do prompt).
     */
    async reverseGeocode(latitude, longitude) {
      if (!token) return null;

      const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
      url.searchParams.set('longitude', String(longitude));
      url.searchParams.set('latitude', String(latitude));
      url.searchParams.set('access_token', token);
      url.searchParams.set('limit', '1');

      try {
        const data = await fetchJsonFn(url.toString());
        const feature = data?.features?.[0];
        if (!feature) return null;

        const context = feature.properties?.context || {};
        return {
          street: context.street?.name || '',
          houseNumber: context.address?.address_number || '',
          place: context.place?.name || '',
          region: extractStateFromMapboxFeature(feature),
          postcode: context.postcode?.name || '',
          label: feature.properties?.full_address || '',
        };
      } catch (err) {
        return null;
      }
    },
  };
}

module.exports = {
  calculateHaversineDistanceMeters,
  classifyDistance,
  createMapboxGeocoderClient,
  extractStateFromMapboxFeature,
  validateMapboxResponse,
};
