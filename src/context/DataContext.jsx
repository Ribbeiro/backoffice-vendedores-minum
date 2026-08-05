import { createContext, useEffect, useMemo, useReducer } from 'react';
import { subscribePath, updateUserAccess } from '../services/api';
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
      subscribeCollection('customers', 'customersMap'),
      subscribeCollection('plannedRoutes', 'routesMap'),
      subscribeCollection('plannedRouteStops', 'routeStopsMap'),
      subscribeCollection('visitEvents', 'visitEventsMap'),
      subscribeCollection('users', 'usersMap'),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [isAdmin]);

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
      updateSellerAccess: updateUserAccess,
    };
  }, [state]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function isSeller(user) {
  const role = normalizeRole(user.role);
  return ['vendedor', 'seller', 'salesperson'].includes(role) || (!role && Boolean(user.state));
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}
