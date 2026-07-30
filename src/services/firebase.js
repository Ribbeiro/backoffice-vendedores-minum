import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// Uma segunda instancia do Auth cria a conta sem trocar a sessao do administrador
// que esta usando o backoffice.
const provisioningAppName = 'user-provisioning';
const provisioningApp = getApps().some((item) => item.name === provisioningAppName)
  ? getApp(provisioningAppName)
  : initializeApp(firebaseConfig, provisioningAppName);

export const auth = getAuth(app);
export const database = getDatabase(app);
export const provisioningAuth = getAuth(provisioningApp);
export default app;

// A protecao real deve estar nas regras do Firebase Realtime Database.
// Use o frontend apenas como barreira de UX; valide role admin nas regras.
