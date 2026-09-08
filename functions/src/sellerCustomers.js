const { isCustomerAssignedToSeller } = require('./sellerCustomerAssignment');

function sellerIdentity(profile) {
  return JSON.stringify([profile?.name, profile?.displayName, profile?.email, profile?.role,
    profile?.active, profile?.allowedAccess, profile?.deleted]);
}

function canReceiveCustomers(profile) {
  return profile?.active === true && profile?.deleted !== true && profile?.allowedAccess !== false;
}

function customerProjection(customer) {
  if (!customer) return null;
  // Provider responses and audit evidence belong in the administrative base.
  const { geocoding, geocodingReview, ...projection } = customer;
  return {
    ...projection,
    navigationLatitude: customer.navigationLatitude ?? geocoding?.navigationCoordinate?.latitude ?? customer.latitude ?? null,
    navigationLongitude: customer.navigationLongitude ?? geocoding?.navigationCoordinate?.longitude ?? customer.longitude ?? null,
    coordinatePrecisionLevel: customer.coordinatePrecisionLevel ?? geocoding?.accuracy ?? 'unknown',
    coordinateStatus: customer.coordinateStatus ?? geocoding?.status ?? 'legacy_unverified',
    coordinateSource: customer.coordinateSource ?? geocoding?.provider ?? null,
  };
}

async function projectCustomer(database, customerId, attempt = 0) {
  const [customerSnapshot, usersSnapshot] = await Promise.all([
    database.ref(`customers/${customerId}`).get(), database.ref('users').get(),
  ]);
  const customer = customerSnapshot.val();
  const fingerprint = JSON.stringify([customer, usersSnapshot.val()]);
  const updates = {};
  for (const [uid, profile] of Object.entries(usersSnapshot.val() || {})) {
    updates[`customersBySeller/${uid}/${customerId}`] = customer && canReceiveCustomers(profile)
      && isCustomerAssignedToSeller(customer, profile) ? customerProjection(customer) : null;
  }
  if (Object.keys(updates).length) await database.ref().update(updates);
  const [latestCustomer, latestUsers] = await Promise.all([
    database.ref(`customers/${customerId}`).get(), database.ref('users').get(),
  ]);
  if (fingerprint !== JSON.stringify([latestCustomer.val(), latestUsers.val()])) {
    if (attempt >= 2) throw new Error('seller_projection_source_changed');
    return projectCustomer(database, customerId, attempt + 1);
  }
}

async function rebuildSellerCustomers(database, uid, attempt = 0) {
  const profile = (await database.ref(`users/${uid}`).get()).val();
  const identity = sellerIdentity(profile);
  if (!canReceiveCustomers(profile)) {
    await database.ref(`customersBySeller/${uid}`).remove();
    if (identity !== sellerIdentity((await database.ref(`users/${uid}`).get()).val())) {
      if (attempt >= 2) throw new Error('seller_projection_source_changed');
      return rebuildSellerCustomers(database, uid, attempt + 1);
    }
    return;
  }
  const customers = (await database.ref('customers').get()).val() || {};
  const fingerprint = JSON.stringify(customers);
  const assigned = Object.fromEntries(Object.entries(customers)
    .filter(([, customer]) => isCustomerAssignedToSeller(customer, profile))
    .map(([key, customer]) => [key, customerProjection(customer)]));
  await database.ref(`customersBySeller/${uid}`).set(assigned);
  // A customer edit or rename racing this rebuild must not leave a stale
  // assignment. Retry against current sources; Eventarc retries on contention.
  const [latestProfile, latestCustomers] = await Promise.all([
    database.ref(`users/${uid}`).get(), database.ref('customers').get(),
  ]);
  if (identity !== sellerIdentity(latestProfile.val()) || fingerprint !== JSON.stringify(latestCustomers.val() || {})) {
    if (attempt >= 2) throw new Error('seller_projection_source_changed');
    return rebuildSellerCustomers(database, uid, attempt + 1);
  }
}

module.exports = { sellerIdentity, canReceiveCustomers, customerProjection, projectCustomer, rebuildSellerCustomers };
