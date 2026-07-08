import {
  child,
  get,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { auth } from './firebase';
import { database } from './firebase';

const dbRef = ref(database);

export async function getUserProfile(uid) {
  const snapshot = await get(child(dbRef, `users/${uid}`));
  return snapshot.exists() ? snapshot.val() : null;
}

export function subscribePath(path, callback) {
  return onValue(ref(database, path), (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : {});
  });
}

export async function importCustomers(customers, mode = 'merge') {
  if (!auth.currentUser) {
    throw new Error('usuario nao autenticado. Faca login novamente.');
  }

  if (mode === 'replace') {
    await remove(ref(database, 'customers'));
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

export async function updateUserAccess(uid, active) {
  await update(ref(database, `users/${uid}`), {
    active,
    allowedAccess: active,
    deleted: false,
    updatedAt: serverTimestamp(),
  });
}

export async function saveUserProfile(uid, profile) {
  await set(ref(database, `users/${uid}`), profile);
}
