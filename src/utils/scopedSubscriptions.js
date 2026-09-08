// Reconcile route children without restarting listeners for unchanged routes.
// Each returned callback belongs to one subscription generation.
export function createRouteSubscriptions(subscribe, onValue, onError) {
  const subscriptions = new Map();
  return {
    reconcile(ids) {
      const wanted = new Set(ids);
      for (const [id, entry] of subscriptions) {
        if (wanted.has(id)) continue;
        entry.active = false;
        entry.stops();
        entry.events();
        subscriptions.delete(id);
      }
      for (const id of wanted) {
        if (subscriptions.has(id)) continue;
        const entry = { active: true };
        entry.stops = subscribe(`plannedRouteStops/${id}`, (value) => {
          if (entry.active) onValue('routeStopsMap', id, value);
        }, onError);
        entry.events = subscribe(`visitEvents/${id}`, (value) => {
          if (entry.active) onValue('visitEventsMap', id, value);
        }, onError);
        subscriptions.set(id, entry);
      }
    },
    close() {
      for (const entry of subscriptions.values()) {
        entry.active = false;
        entry.stops();
        entry.events();
      }
      subscriptions.clear();
    },
  };
}
