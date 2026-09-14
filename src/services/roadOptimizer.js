/* global fetch */
import { optimizeRoadOrder } from '../utils/routeOptimization.js';

export async function optimizeRoadRoute(customers, { token, preview, keepLast = false, request = fetch }) {
  const coordinates = customers.map(c => `${Number(c.longitude)},${Number(c.latitude)}`).join(';');
  // driving supports 25 coordinates in one matrix; traffic only supports 10.
  const response = await request(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordinates}?annotations=distance&access_token=${encodeURIComponent(token)}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 'Ok' || !Array.isArray(payload.distances) || payload.distances.length !== customers.length) {
    throw new Error(payload.message || 'Nao foi possivel consultar as distancias por ruas. Tente novamente.');
  }
  const order = optimizeRoadOrder(payload.distances, { keepLast });
  const optimized = await preview(order.map(index => customers[index]));
  // Matrix edges and a continuous route can differ at turns. Verify against
  // the actual original road route so optimization never increases its length.
  if (order.some((value, i) => value !== i)) {
    const original = await preview(customers);
    if (optimized.distanceMeters >= original.distanceMeters) {
      return { ...original, order: customers.map((_, i) => i), savedDistanceMeters: 0 };
    }
    return { ...optimized, order, savedDistanceMeters: original.distanceMeters - optimized.distanceMeters };
  }
  return { ...optimized, order, savedDistanceMeters: 0 };
}
