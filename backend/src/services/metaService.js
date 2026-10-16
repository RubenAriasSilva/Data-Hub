import mysql from 'mysql2/promise';
import { getPool } from '../config/db.js';
import { HttpError } from '../utils/httpError.js';

const TABLE_SELECT = `
  SELECT t.*, c.slug AS category_slug, c.name AS category_name
  FROM hub_tables t JOIN categories c ON c.id = t.category_id`;

const normalizeColumn = (c) => ({ ...c, is_key: Boolean(c.is_key), nullable: Boolean(c.nullable) });

async function withColumns(table) {
  if (!table) throw new HttpError(404, 'Tabla no encontrada');
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

export async function getTableMetaBySlug(categorySlug, tableSlug) {
  const [[table]] = await getPool().query(`${TABLE_SELECT} WHERE c.slug = ? AND t.slug = ?`, [categorySlug, tableSlug]);
  return withColumns(table);
}

export async function countRows(dbTable) {
  try {
    const [[r]] = await getPool().query(`SELECT COUNT(*) AS n FROM ${mysql.escapeId(dbTable)}`);
    return Number(r.n);
  } catch {
    return null;
  }
}

/** Tablas (opcionalmente de una categoría) con número de columnas, filas y última carga. */
export async function listTablesWithStats(categoryId) {
  const [tables] = await getPool().query(
    `${TABLE_SELECT.replace('SELECT t.*', `SELECT t.*,
       (SELECT COUNT(*) FROM hub_columns hc WHERE hc.table_id = t.id) AS column_count,
       (SELECT MAX(u.created_at) FROM upload_logs u WHERE u.table_id = t.id) AS last_upload_at,
       (SELECT u.status FROM upload_logs u WHERE u.table_id = t.id ORDER BY u.id DESC LIMIT 1) AS last_upload_status`)}
     ${categoryId ? 'WHERE t.category_id = ?' : ''}
     ORDER BY t.name`,
    categoryId ? [categoryId] : [],
  );
  for (const t of tables) t.row_count = await countRows(t.db_table);
  return tables;
}
