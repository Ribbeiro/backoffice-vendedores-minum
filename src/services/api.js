/* global fetch */

import {
  child,
  get,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { createUserWithEmailAndPassword, deleteUser, signOut } from 'firebase/auth';
import { auth, database, provisioningAuth } from './firebase';

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
    const key = toFirebaseKey(customer.externalId || customer.id);

    updates[`customers/${key}`] = {
      ...toFirebaseCustomer(customer),
      id: key,
      externalId: customer.externalId || customer.id,
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
  return {
    opportunity: customer.opportunity,
    cpfCnpj: customer.cpfCnpj,
    cnpjCpf: customer.cnpjCpf,
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
    name: customer.name,
    clientName: customer.clientName,
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
      customerName: customer.name || customer.clientName || customer.opportunity || customerKey,
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
