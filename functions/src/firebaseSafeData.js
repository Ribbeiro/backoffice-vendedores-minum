const FIREBASE_KEY_PREFIX = '__minum_firebase_key__';
const INVALID_FIREBASE_KEY = /[.#$\/\[\]\u0000-\u001F\u007F]/;

/**
 * O Realtime Database nao aceita alguns caracteres em nomes de propriedades.
 * A codificacao abaixo preserva o nome original para que a previa continue
 * fiel a planilha, mas permite guarda-la de forma segura no Firebase.
 */
function isFirebaseKeySafe(value) {
  const key = String(value ?? '');
  return Boolean(key) && !INVALID_FIREBASE_KEY.test(key);
}

function encodeFirebaseKey(value) {
  const key = String(value ?? '');
  if (isFirebaseKeySafe(key) && !key.startsWith(FIREBASE_KEY_PREFIX)) return key;
  return `${FIREBASE_KEY_PREFIX}${Buffer.from(key, 'utf8').toString('base64url')}`;
}

function decodeFirebaseKey(value) {
  const key = String(value ?? '');
  if (!key.startsWith(FIREBASE_KEY_PREFIX)) return key;

  const encoded = key.slice(FIREBASE_KEY_PREFIX.length);
  if (!encoded) return key;

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    // Evita decodificar acidentalmente uma chave normal que apenas se parece
    // com o prefixo interno da serializacao.
    return encodeFirebaseKey(decoded) === key ? decoded : key;
  } catch {
    return key;
  }
}

function toFirebaseSafeValue(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toFirebaseSafeValue);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        encodeFirebaseKey(key),
        toFirebaseSafeValue(item),
      ]),
    );
  }

  return value;
}

function fromFirebaseSafeValue(value) {
  if (Array.isArray(value)) return value.map(fromFirebaseSafeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        decodeFirebaseKey(key),
        fromFirebaseSafeValue(item),
      ]),
    );
  }
  return value;
}

module.exports = {
  decodeFirebaseKey,
  encodeFirebaseKey,
  fromFirebaseSafeValue,
  isFirebaseKeySafe,
  toFirebaseSafeValue,
};
