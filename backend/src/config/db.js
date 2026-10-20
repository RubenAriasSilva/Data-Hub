import mysql from 'mysql2/promise';
import { migrate } from '../db/migrate.js';
import { HttpError } from '../utils/httpError.js';

const config = () => ({
  // 127.0.0.1 y no "localhost": Node puede resolver localhost a IPv6 (::1) y MySQL suele escuchar solo en IPv4
  host: process.env.DB_HOST || '127.0.0.1',
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
    const { host, port } = config();
    const hints = {
      ECONNREFUSED: `nada escucha en ${host}:${port}; ¿está iniciado MySQL y es correcto DB_PORT?`,
      ER_ACCESS_DENIED_ERROR: 'usuario o contraseña incorrectos (DB_USER / DB_PASSWORD)',
      ENOTFOUND: `no se encontró el host "${host}" (DB_HOST)`,
      ETIMEDOUT: `${host}:${port} no responde (¿firewall o IP incorrecta?)`,
    };
    lastError = `${err.code ?? 'ERROR'}: ${hints[err.code] ?? (err.message || 'error desconocido')}`;
    console.error(`[db] No se pudo conectar a MySQL (${lastError}). Reintentando en ${delayMs / 1000}s...`);
    setTimeout(() => connectWithRetry(delayMs), delayMs);
  }
}
