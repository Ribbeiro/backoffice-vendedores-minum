const test = require('node:test');
const assert = require('node:assert/strict');

test('route pagination retains existing listeners, detaches removed routes and ignores stale callbacks', async () => {
  const { createRouteSubscriptions } = await import('../../src/utils/scopedSubscriptions.js');
  const calls = [], stopped = [], values = [];
  const subscribe = (path, callback) => { calls.push({ path, callback }); return () => stopped.push(path); };
  const manager = createRouteSubscriptions(subscribe, (...args) => values.push(args), assert.fail);
  manager.reconcile(['r1']);
  manager.reconcile(['r1', 'r2']);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.path.split('/').length === 2));
  manager.reconcile(['r2']);
  assert.deepEqual(stopped, ['plannedRouteStops/r1', 'visitEvents/r1']);
  calls[0].callback({ stale: true });
  calls[2].callback({ current: true });
  assert.deepEqual(values, [['routeStopsMap', 'r2', { current: true }]]);
  manager.close();
  calls[3].callback({ stale: true });
  assert.equal(values.length, 1);
  assert.equal(stopped.length, 4);
});
