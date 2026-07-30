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
import { createUserWithEmailAndPassword, deleteUser, signOut } from 'firebase/auth';
import { auth, database, provisioningAuth } from './firebase';

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
