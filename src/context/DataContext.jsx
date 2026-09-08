import { createContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { subscribePath, subscribeRecentRoutes, subscribeRoutesByStatus, updateUserAccess } from '../services/api';
import { createRouteSubscriptions } from '../utils/scopedSubscriptions';
import { asArray } from '../utils/helpers';
import { useAuth } from '../hooks/useAuth';

export const DataContext = createContext(null);

const initialState = {
  customersMap: {},
  routesMap: {},
  routeStopsMap: {},
  visitEventsMap: {},
  usersMap: {},
  loading: true,
  error: null,
};

function dataReducer(state, action) {
  switch (action.type) {
    case 'SET_COLLECTION':
      return { ...state, [action.key]: action.value || {}, loading: false };
    case 'SET_ROUTE_CHILD':
      return { ...state, [action.key]: { ...state[action.key], [action.id]: action.value || {} } };
    case 'PRUNE_ROUTE_CHILDREN': {
      const ids = new Set(action.ids);
      return { ...state,
        routeStopsMap: Object.fromEntries(Object.entries(state.routeStopsMap).filter(([id]) => ids.has(id))),
        visitEventsMap: Object.fromEntries(Object.entries(state.visitEventsMap).filter(([id]) => ids.has(id))),
      };
    }
    case 'DATA_ERROR':
      return { ...state, error: action.error, loading: false };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

export function DataProvider({ children }) {
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();
  const needsOperations = ['/dashboard', '/historico', '/inteligencia', '/vendedores', '/clientes'].includes(pathname);
  const needsCustomers = pathname !== '/usuarios' && pathname !== '/login';
  const [routeLimit, setRouteLimit] = useState(50);
  const [recentRouteCount, setRecentRouteCount] = useState(0);
  const [routesReady, setRoutesReady] = useState(false);
  const childSubscriptions = useRef(null);
  const [state, dispatch] = useReducer(dataReducer, initialState);

  useEffect(() => {
    if (!isAdmin) {
      dispatch({ type: 'RESET' });
      return undefined;
    }

    const subscribeCollection = (path, key) => subscribePath(
      path,
      (value) => dispatch({ type: 'SET_COLLECTION', key, value }),
      (error) => dispatch({ type: 'DATA_ERROR', error: `Nao foi possivel sincronizar ${path}: ${error.message}` }),
    );

    const unsubscribers = [
      subscribeCollection('users', 'usersMap'),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !needsCustomers) return undefined;
    return subscribePath('customers', (value) => dispatch({ type: 'SET_COLLECTION', key: 'customersMap', value }),
      (error) => dispatch({ type: 'DATA_ERROR', error: error.message }));
  }, [isAdmin, needsCustomers]);

  useEffect(() => {
    if (!isAdmin || !needsOperations) return undefined;
    setRoutesReady(false);
    const collections = new Map();
    const activeStatuses = ['assigned', 'planned', 'in_progress', 'em andamento', 'awaiting_feedback'];
    let active = true;
    const receive = (key) => (value) => {
      if (!active) return;
      collections.set(key, value);
      if (key === 'recent') setRecentRouteCount(Object.keys(value).length);
      if (collections.size !== activeStatuses.length + 1) return;
      dispatch({ type: 'SET_COLLECTION', key: 'routesMap', value: Object.assign({}, ...collections.values()) });
      setRoutesReady(true);
    };
    const onError = (error) => dispatch({ type: 'DATA_ERROR', error: error.message });
    const unsubscribe = [
      subscribeRecentRoutes(routeLimit, receive('recent'), onError),
      ...activeStatuses.map((status) => subscribeRoutesByStatus(status, receive(status), onError)),
    ];
    return () => { active = false; unsubscribe.forEach((stop) => stop()); };
  }, [isAdmin, needsOperations, routeLimit]);

  useEffect(() => {
    if (!isAdmin || !needsOperations) return undefined;
    const manager = createRouteSubscriptions(subscribePath,
      (key, id, value) => dispatch({ type: 'SET_ROUTE_CHILD', key, id, value }),
      (error) => dispatch({ type: 'DATA_ERROR', error: error.message }));
    childSubscriptions.current = manager;
    return () => { manager.close(); childSubscriptions.current = null; };
  }, [isAdmin, needsOperations]);

  const routeIdsKey = JSON.stringify(Object.keys(state.routesMap).sort());
  useEffect(() => {
    const ids = JSON.parse(routeIdsKey);
    childSubscriptions.current?.reconcile(ids);
    dispatch({ type: 'PRUNE_ROUTE_CHILDREN', ids });
  }, [routeIdsKey, isAdmin, needsOperations]);

  const value = useMemo(() => {
    const customers = asArray(state.customersMap);
    const routes = asArray(state.routesMap);
    const users = asArray(state.usersMap);
    const sellers = users.filter(isSeller);
    const admins = users.filter((user) => normalizeRole(user.role) === 'admin');

    return {
      ...state,
      customers,
      routes,
      routeStops: state.routeStopsMap,
      visitEvents: state.visitEventsMap,
      users,
      sellers,
      admins,
      needsOperations,
      routeLimit,
      canLoadOlderRoutes: recentRouteCount >= routeLimit,
      loadOlderRoutes: () => setRouteLimit((limit) => limit + 50),
      operationsLoading: !routesReady || routes.some((route) =>
        !Object.hasOwn(state.routeStopsMap, route.id) || !Object.hasOwn(state.visitEventsMap, route.id)),
      updateSellerAccess: updateUserAccess,
    };
  }, [state, needsOperations, routeLimit, recentRouteCount, routesReady]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function isSeller(user) {
  const role = normalizeRole(user.role);
  return ['vendedor', 'seller', 'salesperson'].includes(role) || (!role && Boolean(user.state));
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}
