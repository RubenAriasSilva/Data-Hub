import mysql from 'mysql2/promise';
import { getPool } from '../config/db.js';
import { countDocuments } from './mongoService.js';
import { HttpError } from '../utils/httpError.js';

const TABLE_SELECT = `
  SELECT t.*, c.slug AS category_slug, c.name AS category_name, a.slug AS application_slug, a.name AS application_name
  FROM hub_tables t
  JOIN categories c ON c.id = t.category_id
  LEFT JOIN applications a ON a.id = t.application_id`;

const normalizeColumn = (c) => ({ ...c, is_key: Boolean(c.is_key), nullable: Boolean(c.nullable) });

export const isMongo = (table) => table?.db_type === 'mongodb';

function parseKeyFields(table) {
  try {
    table.key_fields = table.key_fields ? JSON.parse(table.key_fields) : [];
  } catch {
    table.key_fields = [];
  }
  return table;
}

async function withColumns(table) {
  if (!table) throw new HttpError(404, 'Tabla o colección no encontrada');
  parseKeyFields(table);
  // Las colecciones MongoDB no tienen columnas: solo campos clave opcionales
  if (isMongo(table)) return { table, columns: [], keyFields: table.key_fields };
  const [columns] = await getPool().query(
    'SELECT * FROM hub_columns WHERE table_id = ? ORDER BY position, id',
    [table.id],
  );
  return { table, columns: columns.map(normalizeColumn) };
}

export async function getTableMetaById(id) {
  const [[table]] = await getPool().query(`${TABLE_SELECT} WHERE t.id = ?`, [id]);
  return withColumns(table);
}

/** appSlug null = tabla directa de la categoría (sin aplicación). */
export async function getTableMetaBySlug(categorySlug, appSlug, tableSlug) {
  const [[table]] = await getPool().query(
    `${TABLE_SELECT} WHERE c.slug = ? AND t.slug = ? AND ${appSlug ? 'a.slug = ?' : 't.application_id IS NULL'}`,
    appSlug ? [categorySlug, tableSlug, appSlug] : [categorySlug, tableSlug],
  );
  return withColumns(table);
}

/** Filas (MySQL) o documentos (MongoDB); null si la base no responde. */
export const countRecords = (table) => (isMongo(table) ? countDocuments(table.db_table) : countRows(table.db_table));

export async function countRows(dbTable) {
  try {
    const [[r]] = await getPool().query(`SELECT COUNT(*) AS n FROM ${mysql.escapeId(dbTable)}`);
    return Number(r.n);
  } catch {
    return null;
  }
}

/**
 * Tablas con número de columnas, filas y última carga.
 * filter: { categoryId, applicationId } — applicationId null = solo las tablas directas de la categoría.
 */
export async function listTablesWithStats(filter = {}) {
  const where = [];
  const params = [];
  if (filter.categoryId) {
    where.push('t.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.applicationId === null) where.push('t.application_id IS NULL');
  else if (filter.applicationId) {
    where.push('t.application_id = ?');
    params.push(filter.applicationId);
  }
  const [tables] = await getPool().query(
    `${TABLE_SELECT.replace('SELECT t.*', `SELECT t.*,
       (SELECT COUNT(*) FROM hub_columns hc WHERE hc.table_id = t.id) AS column_count,
       (SELECT MAX(u.created_at) FROM upload_logs u WHERE u.table_id = t.id) AS last_upload_at,
       (SELECT u.status FROM upload_logs u WHERE u.table_id = t.id ORDER BY u.id DESC LIMIT 1) AS last_upload_status`)}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.name`,
    params,
  );
  for (const t of tables) {
    parseKeyFields(t);
    t.row_count = await countRecords(t);
  }
  return tables;
}
