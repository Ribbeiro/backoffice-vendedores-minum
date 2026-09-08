/* global fetch */

import {
  child,
  get,
  onValue,
  query,
  orderByChild,
  limitToLast,
  equalTo,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { createUserWithEmailAndPassword, deleteUser, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, cloudFunctions, database, provisioningAuth } from './firebase';

const dbRef = ref(database);

export async function getUserProfile(uid) {
  const snapshot = await get(child(dbRef, `users/${uid}`));
  return snapshot.exists() ? snapshot.val() : null;
}

export function subscribePath(path, callback, onError) {
  return onValue(
    ref(database, path),
    (snapshot) => callback(snapshot.exists() ? snapshot.val() : {}),
    (error) => onError?.(error),
  );
}

export function subscribeRecentRoutes(limit, callback, onError) {
  return onValue(query(ref(database, 'plannedRoutes'), orderByChild('createdAt'), limitToLast(limit)),
    (snapshot) => callback(snapshot.val() || {}), onError);
}

export function subscribeRoutesByStatus(status, callback, onError) {
  return onValue(query(ref(database, 'plannedRoutes'), orderByChild('status'), equalTo(status)),
    (snapshot) => callback(snapshot.val() || {}), onError);
}

export async function importCustomers(customers, mode = 'merge') {
  if (!auth.currentUser) {
    throw new Error('usuario nao autenticado. Faca login novamente.');
  }

  if (mode === 'replace') {
    await remove(ref(database, 'customers'));
  } else {
    await removePlaceholderCustomers();
  }

  const updates = {};
  customers.forEach((customer) => {
    const minumCode = customer.minumCode || customer.externalId || customer.id;
    const key = toFirebaseKey(minumCode);

    updates[`customers/${key}`] = {
      ...toFirebaseCustomer(customer),
      id: key,
      externalId: minumCode,
      minumCode,
      importedAt: serverTimestamp(),
    };
  });

  const entries = Object.entries(updates);
  for (let index = 0; index < entries.length; index += 400) {
    const batch = Object.fromEntries(entries.slice(index, index + 400));
    await update(ref(database), batch);
  }

  return { processed: customers.length };
}

async function removePlaceholderCustomers() {
  const snapshot = await get(child(dbRef, 'customers'));
  if (!snapshot.exists()) return;

  const updates = {};
  snapshot.forEach((customerSnapshot) => {
    const key = customerSnapshot.key || '';
    const value = customerSnapshot.val() || {};
    const externalId = String(value.externalId || value.id || key);

    if (/^linha-\d+$/i.test(key) || /^linha-\d+$/i.test(externalId)) {
      updates[`customers/${key}`] = null;
    }
  });

  if (Object.keys(updates).length > 0) {
    await update(ref(database), updates);
  }
}

function toFirebaseCustomer(customer) {
  const opportunity = String(customer.opportunity || '').trim();
  const clientName = String(customer.clientName || '').trim();
  return {
    opportunity: opportunity || null,
    cpfCnpj: customer.cpfCnpj,
    cnpjCpf: customer.cnpjCpf,
    minumCode: customer.minumCode || customer.externalId || customer.id,
    odooLeadId: customer.odooLeadId ?? null,
    odooExternalId: customer.odooExternalId ?? null,
    dealAddress: customer.dealAddress,
    address: customer.address,
    email: customer.email,
    state: customer.state,
    city: customer.city,
    phone: customer.phone,
    segment: customer.segment,
    responsible: customer.responsible,
    responsavel: customer.responsavel,
    lastUpdate: customer.lastUpdate,
    ultimaAtualizacao: customer.ultimaAtualizacao,
    distributor: customer.distributor,
    responsibleSalesperson: customer.responsibleSalesperson,
    responsableSalesperson: customer.responsableSalesperson,
    tags: customer.tags,
    expectedRevenue: customer.expectedRevenue,
    expectedRevenueValue: customer.expectedRevenueValue,
    notes: customer.notes,
    origin: customer.origin,
    origem: customer.origem,
    pipelineStage: customer.pipelineStage,
    status: customer.status,
    name: opportunity || customer.name || clientName || customer.id,
    clientName: clientName || null,
    latitude: customer.latitude,
    longitude: customer.longitude,
    country: customer.country,
    active: customer.active,
  };
}

function toFirebaseKey(value) {
  const rawKey = String(value || '').trim();
  if (!rawKey) {
    return `cliente_${Date.now()}`;
  }

  return rawKey
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('')
    .map((char) => (isInvalidFirebaseKeyChar(char) ? '_' : char))
    .join('')
    .replace(/\s+/g, '_')
    .slice(0, 180);
}

function isInvalidFirebaseKeyChar(char) {
  const code = char.charCodeAt(0);
  return code <= 31 || code === 127 || ['.', '#', '$', '/', '[', ']'].includes(char);
}

function hasValidCoordinates(customer) {
  const latitude = Number(customer?.latitude);
  const longitude = Number(customer?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 && !(latitude === 0 && longitude === 0);
}

export async function updateUserAccess(uid, active) {
  await update(ref(database, `users/${uid}`), {
    active,
    allowedAccess: active,
    deleted: false,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Atualiza o acompanhamento de um proximo passo diretamente no evento que o
 * originou. Assim a fila da Dashboard fica em tempo real, rastreavel e nao
 * cria uma segunda fonte de verdade fora do historico da visita.
 */
export async function updateFollowUpTask({ routeId, stopId, eventId, status, completedByName }) {
  if (!auth.currentUser) throw new Error('Sua sessao expirou. Entre novamente.');

  const normalizedRouteId = String(routeId || '').trim();
  const normalizedStopId = String(stopId || '').trim();
  const normalizedEventId = String(eventId || '').trim();
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (!normalizedRouteId || !normalizedStopId || !normalizedEventId) {
    throw new Error('Nao foi possivel identificar o proximo passo a atualizar.');
  }
  if (!['open', 'in_progress', 'completed'].includes(normalizedStatus)) {
    throw new Error('O status selecionado para o acompanhamento nao e valido.');
  }

  const path = `visitEvents/${normalizedRouteId}/${normalizedStopId}/${normalizedEventId}`;
  const isCompleted = normalizedStatus === 'completed';
  await update(ref(database), {
    [`${path}/followUpStatus`]: normalizedStatus,
    [`${path}/followUpUpdatedAt`]: serverTimestamp(),
    [`${path}/followUpUpdatedBy`]: auth.currentUser.uid,
    [`${path}/followUpUpdatedByName`]: completedByName || auth.currentUser.displayName || auth.currentUser.email || auth.currentUser.uid,
    [`${path}/followUpCompletedAt`]: isCompleted ? serverTimestamp() : null,
    [`${path}/followUpCompletedBy`]: isCompleted ? auth.currentUser.uid : null,
  });
}

/** Remove apenas o cadastro ativo do cliente. O historico de visitas continua
 * preservado dentro das rotas para manter a auditoria comercial intacta. */
export async function deleteCustomer(customerId) {
  const key = String(customerId || '').trim();
  if (!key) throw new Error('Nao foi possivel identificar o cliente a excluir.');
  if (!auth.currentUser) throw new Error('Sua sessao expirou. Entre novamente.');

  await remove(ref(database, `customers/${key}`));
}

/**
 * Remove todos os espelhos da rota em uma unica operacao do Realtime Database.
 * Assim ela some ao mesmo tempo do backoffice, do historico do aplicativo e da
 * caixa de entrada do vendedor, sem deixar paradas ou eventos orfaos.
 */
export async function deleteRoute(route) {
  const routeId = String(route?.id || '').trim();
  if (!routeId) throw new Error('Nao foi possivel identificar a rota a excluir.');
  if (!auth.currentUser) throw new Error('Sua sessao expirou. Entre novamente.');

  const sellerUid = String(route?.sellerUid || route?.vendedor || route?.uid || '').trim();
  const updates = {
    [`plannedRoutes/${routeId}`]: null,
    [`plannedRouteStops/${routeId}`]: null,
    [`visitEvents/${routeId}`]: null,
  };

  if (sellerUid) {
    updates[`sharedRoutesBySeller/${sellerUid}/${routeId}`] = null;
  }

  await update(ref(database), updates);
}

export async function saveUserProfile(uid, profile) {
  await set(ref(database, `users/${uid}`), profile);
}

/**
 * Busca a rota que sera efetivamente percorrida entre as paradas escolhidas.
 * A geometria e os trechos sao usados tanto no mapa de previa quanto na lista
 * de distancias entre clientes.
 */
export async function getSharedRoutePreview(customers) {
  if (customers.length < 2) return emptyRoutePreview();
  validateRouteCustomers(customers);

  const coordinates = serializeRouteCoordinates(customers);
  const payload = await requestMapboxRoute(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}?geometries=geojson&overview=full&steps=false`,
    'O Mapbox nao conseguiu calcular a rota entre as paradas.',
  );

  return toRoutePreview(payload.routes[0]);
}

/**
 * Otimiza somente os clientes intermediarios. A primeira e a ultima parada
 * continuam sendo a origem e o destino definidos pelo administrador.
 */
export async function optimizeSharedRoute(customers) {
  if (customers.length < 3) {
    return { ...await getSharedRoutePreview(customers), order: customers.map((_, index) => index) };
  }
  validateRouteCustomers(customers);

  const coordinates = serializeRouteCoordinates(customers);
  const payload = await requestMapboxRoute(
    `https://api.mapbox.com/optimized-trips/v1/mapbox/driving-traffic/${coordinates}?source=first&destination=last&roundtrip=false&geometries=geojson&overview=full&steps=false`,
    'O Mapbox nao conseguiu otimizar a ordem das paradas.',
  );
  const trip = payload.trips?.[0];
  const order = (payload.waypoints || [])
    .map((waypoint, originalIndex) => ({
      originalIndex,
      routeIndex: Number(waypoint.waypoint_index),
    }))
    .filter(({ routeIndex }) => Number.isInteger(routeIndex))
    .sort((first, second) => first.routeIndex - second.routeIndex)
    .map(({ originalIndex }) => originalIndex);

  if (!trip || order.length !== customers.length) {
    throw new Error('O Mapbox retornou uma otimizacao incompleta. Tente novamente.');
  }

  return { ...toRoutePreview(trip), order };
}

/** Mantem a API anterior para consumidores que precisem apenas do total da rota. */
export async function estimateSharedRoute(customers) {
  const preview = await getSharedRoutePreview(customers);
  return {
    distanceMeters: preview.distanceMeters,
    durationSeconds: preview.durationSeconds,
  };
}

function validateRouteCustomers(customers) {
  if (customers.length > 24) throw new Error('Uma rota compartilhada aceita no maximo 24 clientes.');
  if (customers.some((customer) => !hasValidCoordinates(customer))) {
    throw new Error('Todos os clientes da rota precisam ter latitude e longitude validas.');
  }
}

function serializeRouteCoordinates(customers) {
  return customers
    .map((customer) => `${Number(customer.longitude)},${Number(customer.latitude)}`)
    .join(';');
}

async function requestMapboxRoute(url, fallbackMessage) {
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error('Token publico do Mapbox nao configurado.');

  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}access_token=${encodeURIComponent(token)}`);
  const payload = await response.json();
  if (!response.ok || (!payload.routes?.[0] && !payload.trips?.[0])) {
    throw new Error(payload.message || fallbackMessage);
  }
  return payload;
}

function toRoutePreview(route) {
  return {
    distanceMeters: Number(route?.distance || 0),
    durationSeconds: Number(route?.duration || 0),
    geometry: route?.geometry?.type === 'LineString' ? route.geometry : null,
    legs: (route?.legs || []).map((leg, index) => ({
      fromIndex: index,
      toIndex: index + 1,
      distanceMeters: Number(leg.distance || 0),
      durationSeconds: Number(leg.duration || 0),
    })),
  };
}

function emptyRoutePreview() {
  return {
    distanceMeters: 0,
    durationSeconds: 0,
    geometry: null,
    legs: [],
  };
}

/**
 * Cria a missao no historico central e uma copia privada para o vendedor designado.
 * A copia e somente o canal de distribuicao; o desempenho permanece em plannedRoutes.
 */
export async function createSharedRouteAssignment({ seller, name, dueDate, targetCompletionPercent, notes, customers, estimate }) {
  if (!auth.currentUser) throw new Error('Sua sessao expirou. Entre novamente.');
  if (!seller?.id) throw new Error('Selecione o vendedor responsavel.');
  if (!dueDate) throw new Error('Informe a data para cumprimento da rota.');
  if (!customers?.length) throw new Error('Selecione pelo menos um cliente.');
  if (customers.length > 24) throw new Error('Selecione no maximo 24 clientes por rota.');
  if (customers.some((customer) => !hasValidCoordinates(customer))) {
    throw new Error('Todos os clientes da rota precisam ter latitude e longitude validas.');
  }

  const routeReference = push(ref(database, 'plannedRoutes'));
  const routeId = routeReference.key;
  if (!routeId) throw new Error('Nao foi possivel gerar o identificador da rota.');

  const target = Math.min(100, Math.max(1, Number(targetCompletionPercent) || 90));
  const routeName = String(name || '').trim() || `Rota ${dueDate}`;
  const route = {
    id: routeId,
    name: routeName,
    source: 'admin_assignment',
    assignmentType: 'shared',
    sellerUid: seller.id,
    sellerName: seller.name || seller.displayName || seller.email || seller.id,
    sellerEmail: seller.email || null,
    state: seller.state || null,
    dueDate,
    targetCompletionPercent: target,
    targetCompletedStops: Math.ceil((customers.length * target) / 100),
    assignmentNotes: String(notes || '').trim() || null,
    status: 'assigned',
    isCompleted: false,
    stopCount: customers.length,
    estimatedDistanceMeters: estimate?.distanceMeters ?? null,
    estimatedDurationSeconds: estimate?.durationSeconds ?? null,
    createdByUid: auth.currentUser.uid,
    createdByName: auth.currentUser.displayName || auth.currentUser.email || auth.currentUser.uid,
    createdAt: serverTimestamp(),
    createdAtTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const stops = {};
  customers.forEach((customer, index) => {
    const customerKey = String(customer.externalId || customer.id || index + 1);
    const stopId = `stop_${String(index + 1).padStart(3, '0')}_${toFirebaseKey(customerKey)}`;
    stops[stopId] = {
      id: stopId,
      routeId,
      customerId: String(customer.id || customerKey),
      customerExternalId: String(customer.externalId || customerKey),
      minumCode: customer.minumCode || customer.externalId || customerKey,
      odooLeadId: customer.odooLeadId ?? null,
      odooExternalId: customer.odooExternalId ?? null,
      customerName: customer.opportunity || customer.name || customer.clientName || customerKey,
      clientName: customer.clientName || null,
      opportunity: customer.opportunity || null,
      cnpjCpf: customer.cnpjCpf || customer.cpfCnpj || null,
      address: customer.address || customer.dealAddress || null,
      city: customer.city || null,
      state: customer.state || seller.state || null,
      phone: customer.phone || null,
      email: customer.email || null,
      segment: customer.segment || null,
      pipelineStage: customer.pipelineStage || customer.status || null,
      expectedRevenue: customer.expectedRevenue || null,
      latitude: Number(customer.latitude),
      longitude: Number(customer.longitude),
      order: index + 1,
      status: 'assigned',
      timestamp: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  });

  const updates = {
    [`plannedRoutes/${routeId}`]: route,
    [`sharedRoutesBySeller/${seller.id}/${routeId}`]: { ...route, stops },
  };
  Object.entries(stops).forEach(([stopId, stop]) => {
    updates[`plannedRouteStops/${routeId}/${stopId}`] = stop;
  });

  await update(ref(database), updates);
  return { id: routeId, ...route };
}

/**
 * Atualiza uma rota atribuida sem separar a base central da copia recebida pelo
 * vendedor. Paradas com atendimento iniciado nunca sao trocadas, removidas ou
 * reordenadas: o historico de visita continua auditavel.
 */
export async function updateSharedRouteAssignment({
  route,
  seller,
  name,
  dueDate,
  targetCompletionPercent,
  notes,
  customers,
  estimate,
}) {
  if (!auth.currentUser) throw new Error('Sua sessao expirou. Entre novamente.');

  const routeId = String(route?.id || '').trim();
  if (!routeId) throw new Error('Nao foi possivel identificar a rota a editar.');
  if (!seller?.id) throw new Error('Selecione o vendedor responsavel.');
  if (!dueDate) throw new Error('Informe a data para cumprimento da rota.');
  if (!Array.isArray(customers) || customers.length === 0) {
    throw new Error('Selecione pelo menos um cliente para a rota.');
  }
  if (customers.length > 24) throw new Error('Uma rota compartilhada aceita no maximo 24 clientes.');

  const routeSnapshot = await get(ref(database, `plannedRoutes/${routeId}`));
  if (!routeSnapshot.exists()) throw new Error('Esta rota nao existe mais no Firebase. Atualize a pagina e tente novamente.');

  const currentRoute = { id: routeId, ...routeSnapshot.val() };
  const currentSellerUid = String(currentRoute.sellerUid || currentRoute.vendedor || currentRoute.uid || '').trim();
  const [stopsSnapshot, sharedRouteSnapshot] = await Promise.all([
    get(ref(database, `plannedRouteStops/${routeId}`)),
    currentSellerUid ? get(ref(database, `sharedRoutesBySeller/${currentSellerUid}/${routeId}`)) : Promise.resolve(null),
  ]);

  const currentStops = stopsSnapshot?.exists() ? stopsSnapshot.val() || {} : {};
  const currentSharedRoute = sharedRouteSnapshot?.exists() ? sharedRouteSnapshot.val() || {} : null;
  const existingStopEntries = Object.entries(currentStops);
  const existingStopsByCustomer = new Map(
    existingStopEntries
      .map(([stopId, stop]) => [routeStopCustomerKey(stop), { stopId, stop }])
      .filter(([customerKey]) => Boolean(customerKey)),
  );
  const requestedCustomerKeys = customers.map(routeCustomerKey);

  if (requestedCustomerKeys.some((customerKey) => !customerKey)) {
    throw new Error('Todos os clientes selecionados precisam ter um identificador valido.');
  }
  if (new Set(requestedCustomerKeys).size !== requestedCustomerKeys.length) {
    throw new Error('Um mesmo cliente nao pode aparecer duas vezes na mesma rota.');
  }

  const currentCustomerOrder = existingStopEntries
    .sort(([, first], [, second]) => Number(first.order ?? first.ordem ?? 0) - Number(second.order ?? second.ordem ?? 0))
    .map(([, stop]) => routeStopCustomerKey(stop))
    .filter(Boolean);
  const stopsChanged = !sameCustomerOrder(currentCustomerOrder, requestedCustomerKeys);
  const sellerChanged = currentSellerUid && currentSellerUid !== String(seller.id);
  const hasRecordedExecution = routeHasRecordedExecution(currentRoute, Object.values(currentStops));

  if (hasRecordedExecution && (stopsChanged || sellerChanged)) {
    throw new Error('Esta rota ja possui check-in, feedback ou navegacao registrada. Para preservar a auditoria, somente os detalhes administrativos podem ser editados.');
  }

  customers.forEach((customer) => {
    const isExistingStop = existingStopsByCustomer.has(routeCustomerKey(customer));
    if (!isExistingStop && !hasValidCoordinates(customer)) {
      throw new Error(`O cliente ${customer.opportunity || customer.name || customer.id} precisa ter coordenadas validas antes de entrar na rota.`);
    }
  });

  const target = Math.min(100, Math.max(1, Number(targetCompletionPercent) || 90));
  const routeName = String(name || '').trim() || `Rota ${dueDate}`;
  const routePatch = {
    id: routeId,
    name: routeName,
    sellerUid: seller.id,
    sellerName: seller.name || seller.displayName || seller.email || seller.id,
    sellerEmail: seller.email || null,
    state: seller.state || currentRoute.state || null,
    dueDate,
    targetCompletionPercent: target,
    targetCompletedStops: Math.ceil((customers.length * target) / 100),
    assignmentNotes: String(notes || '').trim() || null,
    stopCount: customers.length,
    updatedAt: serverTimestamp(),
    lastEditedAt: serverTimestamp(),
    lastEditedByUid: auth.currentUser.uid,
    lastEditedByName: auth.currentUser.displayName || auth.currentUser.email || auth.currentUser.uid,
  };

  if (stopsChanged) {
    routePatch.estimatedDistanceMeters = estimate?.distanceMeters ?? null;
    routePatch.estimatedDurationSeconds = estimate?.durationSeconds ?? null;
  }

  const nextRoute = { ...currentRoute, ...routePatch };
  const updates = {
    [`plannedRoutes/${routeId}`]: nextRoute,
  };

  let nextStops = currentStops;
  let nextSharedStops = currentSharedRoute?.stops || currentStops;
  if (stopsChanged) {
    nextStops = {};
    nextSharedStops = {};

    customers.forEach((customer, index) => {
      const customerKey = routeCustomerKey(customer);
      const existing = existingStopsByCustomer.get(customerKey);
      const stopId = existing?.stopId || `stop_${String(index + 1).padStart(3, '0')}_${toFirebaseKey(customerKey)}`;
      const nextStop = buildRouteStop({
        currentStop: existing?.stop,
        customer,
        routeId,
        seller,
        stopId,
        order: index + 1,
      });
      const mirroredStop = currentSharedRoute?.stops?.[stopId];

      nextStops[stopId] = nextStop;
      nextSharedStops[stopId] = mirroredStop
        ? { ...nextStop, ...mirroredStop, ...nextStop, attendances: mirroredStop.attendances || nextStop.attendances }
        : nextStop;
      updates[`plannedRouteStops/${routeId}/${stopId}`] = nextStop;
    });

    existingStopEntries.forEach(([stopId]) => {
      if (!nextStops[stopId]) updates[`plannedRouteStops/${routeId}/${stopId}`] = null;
    });
  }

  const isSharedRoute = Boolean(currentSharedRoute)
    || currentRoute.assignmentType === 'shared'
    || currentRoute.source === 'admin_assignment';

  if (isSharedRoute) {
    updates[`sharedRoutesBySeller/${seller.id}/${routeId}`] = {
      ...(currentSharedRoute || currentRoute),
      ...nextRoute,
      stops: nextSharedStops,
    };

    if (currentSellerUid && currentSellerUid !== String(seller.id)) {
      updates[`sharedRoutesBySeller/${currentSellerUid}/${routeId}`] = null;
    }
  }

  await update(ref(database), updates);
  return { ...nextRoute, stops: nextStops };
}

function buildRouteStop({ currentStop = {}, customer, routeId, seller, stopId, order }) {
  const customerKey = routeCustomerKey(customer);
  return {
    ...currentStop,
    id: stopId,
    routeId,
    customerId: String(customer.id || customerKey),
    customerExternalId: String(customer.externalId || customerKey),
    minumCode: customer.minumCode || customer.externalId || customerKey,
    odooLeadId: customer.odooLeadId ?? currentStop.odooLeadId ?? null,
    odooExternalId: customer.odooExternalId ?? currentStop.odooExternalId ?? null,
    customerName: customer.opportunity || customer.name || customer.clientName || customerKey,
    clientName: customer.clientName || null,
    opportunity: customer.opportunity || customer.name || null,
    cnpjCpf: customer.cnpjCpf || customer.cpfCnpj || null,
    address: customer.address || customer.dealAddress || null,
    city: customer.city || null,
    state: customer.state || seller.state || currentStop.state || null,
    phone: customer.phone || null,
    email: customer.email || null,
    segment: customer.segment || null,
    pipelineStage: customer.pipelineStage || customer.status || null,
    expectedRevenue: customer.expectedRevenue || null,
    latitude: Number(customer.latitude),
    longitude: Number(customer.longitude),
    order,
    status: currentStop.status || 'assigned',
    timestamp: currentStop.timestamp ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function routeHasRecordedExecution(route, stops) {
  const routeStatus = String(route?.status || '').trim().toLowerCase();
  if (['in_progress', 'completed', 'concluida', 'not_completed'].includes(routeStatus)) return true;

  return stops.some((stop) => {
    const status = String(stop?.status || stop?.result || '').trim().toLowerCase();
    return Boolean(
      stop?.checkInAt
      || stop?.checkOutAt
      || stop?.feedbackAt
      || stop?.visitedAt
      || stop?.arrivedAt
      || ['visited', 'not_visited', 'in_progress', 'awaiting_feedback'].includes(status)
      || Object.keys(stop?.attendances || {}).length,
    );
  });
}

function sameCustomerOrder(first, second) {
  return first.length === second.length && first.every((customerKey, index) => customerKey === second[index]);
}

function routeCustomerKey(customer) {
  return String(customer?.externalId || customer?.minumCode || customer?.id || '').trim();
}

function routeStopCustomerKey(stop) {
  return String(stop?.customerExternalId || stop?.minumCode || stop?.customerId || '').trim();
}

/** Corrige cadastros legados cujo nome principal foi salvo como contato. */
export async function normalizeCustomerPrimaryNames() {
  if (!auth.currentUser) throw new Error('Sua sessao expirou. Entre novamente para atualizar os nomes.');
  await auth.currentUser.getIdToken(true);
  const callable = httpsCallable(cloudFunctions, 'normalizeCustomerPrimaryNames', { timeout: 120000 });
  const response = await callable();
  return response.data;
}

/**
 * Cria a credencial no Firebase Authentication e o perfil que o Android e o
 * backoffice usam para identificar papel, acesso e estado do usuario.
 */
export async function createManagedUser({ name, email, password, role, state }) {
  if (!auth.currentUser) {
    throw new Error('Sua sessao expirou. Entre novamente para criar usuarios.');
  }

  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedState = String(state || '').trim().toUpperCase();

  if (!normalizedName || !normalizedEmail || !password) {
    throw new Error('Preencha nome, email e senha.');
  }
  if (!['admin', 'vendedor'].includes(normalizedRole)) {
    throw new Error('Selecione um tipo de usuario valido.');
  }
  if (normalizedRole === 'vendedor' && !normalizedState) {
    throw new Error('Selecione o estado do vendedor.');
  }

  let createdUser = null;
  try {
    const credential = await createUserWithEmailAndPassword(provisioningAuth, normalizedEmail, password);
    createdUser = credential.user;

    const profile = {
      name: normalizedName,
      displayName: normalizedName,
      email: normalizedEmail,
      role: normalizedRole,
      active: true,
      allowedAccess: true,
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: auth.currentUser.uid,
    };

    if (normalizedRole === 'vendedor') {
      profile.state = normalizedState;
    }

    await set(ref(database, `users/${createdUser.uid}`), profile);
    return { uid: createdUser.uid, ...profile };
  } catch (error) {
    // Evita deixar uma conta no Authentication sem o perfil correspondente.
    if (createdUser) {
      try {
        await deleteUser(createdUser);
      } catch {
        // A mensagem original continua sendo mais util para o administrador.
      }
    }
    throw error;
  } finally {
    await signOut(provisioningAuth);
  }
}
