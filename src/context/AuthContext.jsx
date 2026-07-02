import { createContext, useEffect, useMemo, useReducer } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { getUserProfile } from '../services/api';

export const AuthContext = createContext(null);

const initialState = {
  user: null,
  profile: null,
  loading: true,
  error: null,
};

function authReducer(state, action) {
  switch (action.type) {
    case 'AUTH_LOADING':
      return { ...state, loading: true, error: null };
    case 'AUTH_SUCCESS':
      return { ...state, user: action.user, profile: action.profile, loading: false, error: null };
    case 'AUTH_ERROR':
      return { ...state, user: null, profile: null, loading: false, error: action.error };
    case 'AUTH_LOGOUT':
      return { ...initialState, loading: false };
    default:
      return state;
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        dispatch({ type: 'AUTH_LOGOUT' });
        return;
      }

      dispatch({ type: 'AUTH_LOADING' });
      try {
        const profile = await getUserProfile(firebaseUser.uid);
        if (!isAllowedAdmin(profile)) {
          await signOut(auth);
          dispatch({ type: 'AUTH_ERROR', error: 'Acesso permitido apenas para administradores ativos.' });
          return;
        }
        dispatch({ type: 'AUTH_SUCCESS', user: firebaseUser, profile });
      } catch {
        dispatch({ type: 'AUTH_ERROR', error: 'Nao foi possivel validar seu perfil.' });
      }
    });

    return unsubscribe;
  }, []);

  async function login(email, password) {
    dispatch({ type: 'AUTH_LOADING' });
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getUserProfile(credential.user.uid);

    if (!isAllowedAdmin(profile)) {
      await signOut(auth);
      dispatch({ type: 'AUTH_ERROR', error: 'Usuario sem permissao de administrador.' });
      return;
    }

    dispatch({ type: 'AUTH_SUCCESS', user: credential.user, profile });
  }

  async function logout() {
    await signOut(auth);
    dispatch({ type: 'AUTH_LOGOUT' });
  }

  const value = useMemo(
    () => ({
      ...state,
      isAdmin: isAllowedAdmin(state.profile),
      login,
      logout,
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function isAllowedAdmin(profile) {
  return (
    normalizeRole(profile?.role) === 'admin' &&
    profile?.active === true &&
    profile?.allowedAccess === true &&
    profile?.deleted !== true
  );
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}
