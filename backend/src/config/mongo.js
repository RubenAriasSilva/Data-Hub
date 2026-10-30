// Conexión opcional a MongoDB para las tablas con db_type = 'mongodb'.
// Sin MONGO_URI la opción queda deshabilitada y el resto del Data Hub funciona igual (solo MySQL).
import { MongoClient } from 'mongodb';
import { HttpError } from '../utils/httpError.js';

const uri = () => (process.env.MONGO_URI || '').trim();
const databaseName = () => process.env.MONGO_DB || process.env.DB_NAME || 'data_hub';

let client = null;
let db = null;
let lastError = null;

export const mongoEnabled = () => Boolean(uri());

export function getMongoDb() {
  if (!mongoEnabled()) throw new HttpError(400, 'MongoDB no está configurado (MONGO_URI en backend/.env)');
  if (!db) throw new HttpError(503, `MongoDB no disponible${lastError ? `: ${lastError}` : ''}`);
  return db;
}

export const mongoState = () => ({
  enabled: mongoEnabled(),
  ready: Boolean(db),
  error: lastError,
  database: mongoEnabled() ? databaseName() : null,
});

/** URI sin contraseña, para los mensajes de log. */
const safeUri = () => uri().replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');

export async function connectMongoWithRetry(delayMs = 10000) {
  if (!mongoEnabled()) return;
  try {
    const c = new MongoClient(uri(), { serverSelectionTimeoutMS: 5000 });
    await c.connect();
    await c.db(databaseName()).command({ ping: 1 });
    client = c;
    db = c.db(databaseName());
    lastError = null;
    console.log(`[mongo] Conectado a ${safeUri()} (base ${databaseName()})`);
    // Si el servidor se cae, el driver reconecta solo; solo se informa el estado
    client.on('serverHeartbeatFailed', (e) => { lastError = e.failure?.message ?? 'sin respuesta'; });
    client.on('serverHeartbeatSucceeded', () => { lastError = null; });
  } catch (err) {
    lastError = `${err.name ?? 'ERROR'}: ${err.message || 'error desconocido'}`;
    console.error(`[mongo] No se pudo conectar a ${safeUri()} (${lastError}). Reintentando en ${delayMs / 1000}s...`);
    setTimeout(() => connectMongoWithRetry(delayMs), delayMs);
  }
}
