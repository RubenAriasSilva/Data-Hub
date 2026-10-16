import mysql from 'mysql2/promise';
import { getPool } from '../config/db.js';
import { convertValue, ConversionError } from '../utils/types.js';
import { HttpError } from '../utils/httpError.js';

const { escapeId } = mysql;
const BATCH_SIZE = 500;
export const SYSTEM_COLUMNS = ['_id', '_created_at', '_updated_at'];

/** "Records: 3  Duplicates: 1  Warnings: 0" -> { inserted: 2, updated: 1 } */
function countResult(res, n) {
  const m = /Records:\s*(\d+)\s+Duplicates:\s*(\d+)/.exec(res.info || '');
  if (m) return { inserted: Number(m[1]) - Number(m[2]), updated: Number(m[2]) };
  // Inserción de una sola fila: affectedRows 1 = insert, 2 = update, 0 = sin cambios
  if (n === 1) return res.affectedRows === 1 ? { inserted: 1, updated: 0 } : { inserted: 0, updated: 1 };
  const updated = Math.max(0, res.affectedRows - n);
  return { inserted: n - updated, updated };
}

/**
 * Upsert por lotes usando el índice UNIQUE de las columnas clave.
 * Los registros se agrupan por el conjunto de columnas presentes, así una fila
 * parcial (vía API) no sobreescribe con NULL las columnas que no envió.
 */
export async function upsertRecords(meta, records) {
  if (!records.length) return { inserted: 0, updated: 0 };
  const keyCols = new Set(meta.columns.filter((c) => c.is_key).map((c) => c.db_name));

  const groups = new Map();
  for (const rec of records) {
    const cols = Object.keys(rec).sort();
    const sig = cols.join(',');
    if (!groups.has(sig)) groups.set(sig, { cols, rows: [] });
    groups.get(sig).rows.push(cols.map((c) => rec[c]));
  }

  const conn = await getPool().getConnection();
  let inserted = 0;
  let updated = 0;
  try {
    await conn.beginTransaction();
    for (const { cols, rows } of groups.values()) {
      const updCols = cols.filter((c) => !keyCols.has(c));
      const updateSql = updCols.length
        ? updCols.map((c) => `${escapeId(c)} = VALUES(${escapeId(c)})`).join(', ')
        : `${escapeId(cols[0])} = ${escapeId(cols[0])}`;
      const sql = `INSERT INTO ${escapeId(meta.table.db_table)} (${cols.map((c) => escapeId(c)).join(', ')})
        VALUES ? ON DUPLICATE KEY UPDATE ${updateSql}`;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const [res] = await conn.query(sql, [chunk]);
        const counts = countResult(res, chunk.length);
        inserted += counts.inserted;
        updated += counts.updated;
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { inserted, updated };
}

const boolColumns = (meta) => meta.columns.filter((c) => c.data_type === 'boolean').map((c) => c.db_name);

function presentRows(meta, rows) {
  const bools = boolColumns(meta);
  if (!bools.length) return rows;
  return rows.map((r) => {
    for (const b of bools) if (r[b] !== null && r[b] !== undefined) r[b] = Boolean(r[b]);
    return r;
  });
}

/** Convierte valores de filtro (texto del query string) al tipo de la columna. */
function filterValue(col, raw) {
  try {
    return convertValue(raw, col.data_type);
  } catch (err) {
    if (err instanceof ConversionError) throw new HttpError(400, `Filtro "${col.db_name}": ${err.message}`);
    throw err;
  }
}

/**
 * Consulta paginada.
 * opts: { page, limit, sort, order, q, filters: { col: valor }, updatedSince, maxLimit }
 */
export async function queryRows(meta, opts = {}) {
  const colByName = new Map(meta.columns.map((c) => [c.db_name, c]));
  const sortable = new Set([...SYSTEM_COLUMNS, ...colByName.keys()]);
  const where = [];
  const params = [];

  if (opts.q) {
    where.push(`(${meta.columns.map((c) => `CAST(${escapeId(c.db_name)} AS CHAR) LIKE ?`).join(' OR ')})`);
    meta.columns.forEach(() => params.push(`%${opts.q}%`));
  }
  for (const [name, raw] of Object.entries(opts.filters || {})) {
    if (name === '_id') {
      where.push('`_id` = ?');
      params.push(raw);
      continue;
    }
    const col = colByName.get(name);
    if (!col) throw new HttpError(400, `Columna de filtro desconocida: ${name}`);
    const value = filterValue(col, raw);
    if (value === null) where.push(`${escapeId(name)} IS NULL`);
    else {
      where.push(`${escapeId(name)} = ?`);
      params.push(value);
    }
  }
  if (opts.updatedSince) {
    where.push('`_updated_at` >= ?');
    params.push(filterValue({ db_name: 'updated_since', data_type: 'datetime' }, opts.updatedSince));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const maxLimit = opts.maxLimit ?? 1000;
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), maxLimit);
  const page = Math.max(parseInt(opts.page, 10) || 1, 1);
  const sort = sortable.has(opts.sort) ? opts.sort : '_id';
  const order = String(opts.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const table = escapeId(meta.table.db_table);

  const pool = getPool();
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${table} ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM ${table} ${whereSql} ORDER BY ${escapeId(sort)} ${order} LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  return {
    rows: presentRows(meta, rows),
    total: Number(total),
    page,
    limit,
    pages: Math.max(1, Math.ceil(Number(total) / limit)),
  };
}

/** Todas las filas (para exportar), con tope de seguridad. */
export async function allRows(meta, max = 200000) {
  const [rows] = await getPool().query(
    `SELECT * FROM ${escapeId(meta.table.db_table)} ORDER BY \`_id\` LIMIT ?`,
    [max],
  );
  return presentRows(meta, rows);
}

/** Borra filas por valores de TODAS las columnas clave. */
export async function deleteByKeys(meta, keyValues) {
  const keys = meta.columns.filter((c) => c.is_key);
  const missing = keys.filter((k) => keyValues[k.db_name] === undefined);
  if (missing.length) {
    throw new HttpError(400, `Indica todas las columnas clave: ${missing.map((k) => k.db_name).join(', ')}`);
  }
  const where = keys.map((k) => `${escapeId(k.db_name)} = ?`).join(' AND ');
  const params = keys.map((k) => filterValue(k, keyValues[k.db_name]));
  const [res] = await getPool().query(`DELETE FROM ${escapeId(meta.table.db_table)} WHERE ${where}`, params);
  return res.affectedRows;
}

export async function deleteById(meta, id) {
  const [res] = await getPool().query(`DELETE FROM ${escapeId(meta.table.db_table)} WHERE \`_id\` = ?`, [id]);
  return res.affectedRows;
}
