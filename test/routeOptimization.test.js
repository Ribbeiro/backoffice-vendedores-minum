import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeRoadOrder, routeCost } from '../src/utils/routeOptimization.js';
import { optimizeRoadRoute } from '../src/services/roadOptimizer.js';

const matrixFor = positions => positions.map(a => positions.map(b => Math.abs(a - b)));
test('16 and 24 stops stop doubling back and can finish beyond the last selected client', () => {
  for (const n of [16, 24]) {
    const positions = [0, ...Array.from({ length: n - 1 }, (_, i) => i + 1).sort((a, b) => (a % 2 - b % 2) || b - a)];
    const matrix = matrixFor(positions);
    const result = optimizeRoadOrder(matrix);
    assert.equal(result[0], 0);
    assert.equal(new Set(result).size, n);
    assert.equal(routeCost(result, matrix), n - 1);
    assert.ok(routeCost(result, matrix) < routeCost(positions.map((_, i) => i), matrix));
  }
});
test('fixed destination is respected, while a free end avoids returning to it', () => {
  const matrix = matrixFor([0, 10, 1, 9, 2]);
  const free = optimizeRoadOrder(matrix);
  const fixed = optimizeRoadOrder(matrix, { keepLast: true });
  assert.equal(fixed.at(-1), 4);
  assert.equal(fixed[0], 0);
  assert.ok(routeCost(free, matrix) < routeCost(fixed, matrix));
});
test('one-way road costs are evaluated in the travelled direction', () => {
  const matrix = [[0, 1, 20, 20], [30, 0, 30, 1], [30, 30, 0, 30], [30, 30, 1, 0]];
  assert.deepEqual(optimizeRoadOrder(matrix), [0, 1, 3, 2]);
});
test('unreachable roads are never mistaken for zero distance', () => {
  assert.throws(() => optimizeRoadOrder([[0, null], [null, 0]]), /percurso/);
  assert.throws(() => optimizeRoadOrder([[0, 1], [2]]), /incompleta/);
  assert.deepEqual(optimizeRoadOrder([[0, 0], [0, 0]]), [0, 1]);
});
test('road preview verifies the proposed order and rejects an actually longer route', async () => {
  const customers = [0, 3, 1, 2].map(longitude => ({ longitude, latitude: 1 }));
  let calls = 0;
  const request = async url => {
    assert.match(url, /directions-matrix\/v1\/mapbox\/driving\//);
    calls++;
    return { ok: true, json: async () => ({ code: 'Ok', distances: matrixFor([0, 3, 1, 2]) }) };
  };
  const result = await optimizeRoadRoute(customers, { token: 'test', request,
    preview: async rows => ({ distanceMeters: rows === customers ? 10 : 20, geometry: { type: 'LineString', coordinates: rows.map(c => [c.longitude, c.latitude]) } }) });
  assert.deepEqual(result.order, [0, 1, 2, 3]);
  assert.equal(result.distanceMeters, 10);
  assert.equal(calls, 1);
});
test('successful preview, order and savings describe the same road route', async () => {
  const customers = [0, 3, 1, 2].map(longitude => ({ longitude, latitude: 1 }));
  const result = await optimizeRoadRoute(customers, { token: 'test',
    request: async () => ({ ok: true, json: async () => ({ code: 'Ok', distances: matrixFor([0, 3, 1, 2]) }) }),
    preview: async rows => ({ distanceMeters: rows === customers ? 6 : 3, legs: rows.slice(1).map(c => c.longitude) }) });
  assert.deepEqual(result.order, [0, 2, 3, 1]);
  assert.deepEqual(result.legs, [1, 2, 3]);
  assert.equal(result.savedDistanceMeters, 3);
});
