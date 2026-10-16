import mysql from 'mysql2/promise';
import { migrate } from '../db/migrate.js';
import { HttpError } from '../utils/httpError.js';

const config = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
});

let pool = null;
let ready = false;
let lastError = null;

export function getPool() {
  if (!pool || !ready) throw new HttpError(503, `Base de datos no disponible${lastError ? `: ${lastError}` : ''}`);
  return pool;
}

export const dbState = () => ({ ready, error: lastError, database: process.env.DB_NAME || 'data_hub' });

async function initDatabase() {
  const database = process.env.DB_NAME || 'data_hub';
  const conn = await mysql.createConnection(config());
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await conn.end();
  }

  const p = mysql.createPool({
    ...config(),
    database,
    connectionLimit: 10,
    dateStrings: true, // DATE/DATETIME como texto, sin conversión de zona horaria
    decimalNumbers: true,
    charset: 'utf8mb4',
  });
  try {
    await migrate(p);
  } catch (err) {
    await p.end();
    throw err;
  }
  pool = p;
  ready = true;
  lastError = null;
}

export async function connectWithRetry(delayMs = 10000) {
  try {
    await initDatabase();
    console.log(`[db] Conectado a MySQL ${config().host}:${config().port}/${dbState().database}`);
  } catch (err) {
    lastError = err.code ? `${err.code} ${err.message}` : err.message;
    console.error(`[db] No se pudo conectar a MySQL (${lastError}). Reintentando en ${delayMs / 1000}s...`);
    setTimeout(() => connectWithRetry(delayMs), delayMs);
  }
}
