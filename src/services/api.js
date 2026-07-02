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
  if (mode === 'replace') {
    await remove(ref(database, 'customers'));
  }

  const updates = {};
  customers.forEach((customer) => {
    updates[`customers/${customer.id}`] = {
      ...customer,
      importedAt: serverTimestamp(),
    };
  });

  if (Object.keys(updates).length > 0) {
    await update(ref(database), updates);
  }

  return { processed: customers.length };
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
