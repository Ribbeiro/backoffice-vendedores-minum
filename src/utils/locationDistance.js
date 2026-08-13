const EARTH_RADIUS_METERS = 6_371_008.8;

/**
 * Centraliza leituras de coordenadas para que o historico sempre compare
 * a posicao reportada pelo vendedor com a mesma referencia do cliente.
 */
export function coordinatesFromFeedback(stop) {
  return coordinatesFromValues(
    stop?.checkOutLocation?.latitude ?? stop?.feedbackLocation?.latitude ?? stop?.feedbackLatitude ?? stop?.visitLocation?.latitude ?? stop?.checkInLocation?.latitude,
    stop?.checkOutLocation?.longitude ?? stop?.feedbackLocation?.longitude ?? stop?.feedbackLongitude ?? stop?.visitLocation?.longitude ?? stop?.checkInLocation?.longitude,
  );
}

export function coordinatesFromCustomer(customer) {
  return coordinatesFromValues(customer?.latitude, customer?.longitude);
}

/**
 * Calcula a distancia em linha reta entre dois clientes com coordenadas validas.
 * Ela e adequada para o filtro de raio; a distancia por ruas continua sendo
 * calculada pelo Mapbox somente para a rota efetivamente selecionada.
 */
export function distanceBetweenCustomersMeters(firstCustomer, secondCustomer) {
  const first = coordinatesFromCustomer(firstCustomer);
  const second = coordinatesFromCustomer(secondCustomer);
  if (!first || !second) return null;
  return haversineMeters(first, second);
}

export function buildCustomerLookup(customers) {
  const lookup = new Map();

  customers.forEach((customer) => {
    customerKeys(customer).forEach((key) => {
      if (!lookup.has(key)) lookup.set(key, customer);
    });
  });

  return lookup;
}

export function customerForStop(stop, customerLookup) {
  return stopKeys(stop)
    .map((key) => customerLookup.get(key))
    .find(Boolean) || null;
}

/**
 * A distancia e geodesica (linha reta sobre a superficie terrestre), nao a
 * distancia pelas ruas. Isso permite auditar o ponto do feedback sem uma
 * nova chamada ao Mapbox para cada registro do historico.
 */
export function feedbackDistanceFromCustomer(stop, customerLookup) {
  const feedbackCoordinates = coordinatesFromFeedback(stop);
  if (!feedbackCoordinates) {
    return { meters: null, reason: 'Sem localizacao do vendedor', customer: null, targetSource: null };
  }

  const customer = customerForStop(stop, customerLookup);
  const customerCoordinates = coordinatesFromCustomer(customer) || coordinatesFromCustomer(stop);
  if (!customerCoordinates) {
    return { meters: null, reason: 'Cliente sem coordenadas', customer, targetSource: null };
  }

  return {
    meters: haversineMeters(feedbackCoordinates, customerCoordinates),
    reason: null,
    customer,
    targetSource: customer ? 'base de clientes' : 'parada salva na rota',
  };
}

export function formatDistanceMeters(meters) {
  if (!Number.isFinite(meters)) return '-';
  if (meters < 1_000) return `${Math.round(meters)} m`;

  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(meters / 1_000)} km`;
}

export function distanceAssessment(meters) {
  if (!Number.isFinite(meters)) return { label: 'Indisponivel', color: 'default' };
  if (meters <= 150) return { label: 'Proximo', color: 'success' };
  if (meters <= 500) return { label: 'Nas proximidades', color: 'info' };
  if (meters <= 1_500) return { label: 'Distante', color: 'warning' };
  return { label: 'Muito distante', color: 'error' };
}

function haversineMeters(first, second) {
  const latitudeDelta = degreesToRadians(second.latitude - first.latitude);
  const longitudeDelta = degreesToRadians(second.longitude - first.longitude);
  const firstLatitude = degreesToRadians(first.latitude);
  const secondLatitude = degreesToRadians(second.latitude);
  const halfChord = (
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2
  );

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord));
}

function coordinatesFromValues(latitudeValue, longitudeValue) {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);

  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90
    || Math.abs(longitude) > 180
    || (latitude === 0 && longitude === 0)
  ) {
    return null;
  }

  return { latitude, longitude };
}

function customerKeys(customer) {
  return uniqueKeys([customer?.id, customer?.externalId, customer?.cnpjCpf, customer?.cpfCnpj]);
}

function stopKeys(stop) {
  return uniqueKeys([
    stop?.customerId,
    stop?.customerExternalId,
    stop?.externalId,
    stop?.cnpjCpf,
    stop?.cpfCnpj,
  ]);
}

function uniqueKeys(values) {
  return [...new Set(values.flatMap(keyVariants).filter(Boolean))];
}

function keyVariants(value) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('pt-BR');
  if (!normalized) return [];

  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, '');
  return compact && compact !== normalized ? [normalized, compact] : [normalized];
}

function degreesToRadians(value) {
  return value * (Math.PI / 180);
}
