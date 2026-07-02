import { createContext, useEffect, useMemo, useReducer } from 'react';
import { subscribePath, updateUserAccess } from '../services/api';
import { asArray } from '../utils/helpers';
import { useAuth } from '../hooks/useAuth';

export const DataContext = createContext(null);

const initialState = {
  customersMap: {},
  routesMap: {},
  routeStopsMap: {},
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

    const unsubscribers = [
      subscribePath('customers', (value) => dispatch({ type: 'SET_COLLECTION', key: 'customersMap', value })),
      subscribePath('plannedRoutes', (value) => dispatch({ type: 'SET_COLLECTION', key: 'routesMap', value })),
      subscribePath('plannedRouteStops', (value) => dispatch({ type: 'SET_COLLECTION', key: 'routeStopsMap', value })),
      subscribePath('users', (value) => dispatch({ type: 'SET_COLLECTION', key: 'usersMap', value })),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [isAdmin]);

  const value = useMemo(() => {
    const customers = asArray(state.customersMap);
    const routes = asArray(state.routesMap);
    const sellers = asArray(state.usersMap).filter((user) => String(user.role || '').toLowerCase() === 'vendedor');
    const admins = asArray(state.usersMap).filter((user) => String(user.role || '').toLowerCase() === 'admin');

    return {
      ...state,
      customers,
      routes,
      routeStops: state.routeStopsMap,
      users: asArray(state.usersMap),
      sellers,
      admins,
      updateSellerAccess: updateUserAccess,
    };
  }, [state]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
