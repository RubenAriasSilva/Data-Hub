import mysql from 'mysql2/promise';
import { DATA_TYPES, convertValue, ConversionError } from '../utils/types.js';
import { isValidIdentifier, normalizeHeader } from '../utils/identifiers.js';
import { HttpError } from '../utils/httpError.js';

const { escapeId } = mysql;
const MAX_COLUMNS = 200;
export const MAX_TEXT_KEYS = 3; // índice UNIQUE de InnoDB: 3072 bytes; VARCHAR(255) utf8mb4 = 1020 bytes

/** Valida y normaliza la definición de una columna. Devuelve { column, error }. */
export function normalizeColumn(raw, index) {
  const column = {
    excel_name: String(raw?.excel_name ?? '').trim(),
    db_name: String(raw?.db_name ?? '').trim(),
    data_type: String(raw?.data_type ?? 'text'),
    is_key: Boolean(raw?.is_key),
    nullable: raw?.nullable === undefined ? true : Boolean(raw.nullable),
    position: index,
  };
  if (column.is_key) column.nullable = false;

  let error = null;
  if (!column.excel_name) error = 'El nombre en Excel es obligatorio';
  else if (column.excel_name.length > 255) error = 'El nombre en Excel excede 255 caracteres';
  else if (!isValidIdentifier(column.db_name)) {
    error = 'El nombre en BD debe iniciar con letra y contener solo minúsculas, números y _ (máx. 64)';
  } else if (!DATA_TYPES[column.data_type]) error = `Tipo inválido: ${column.data_type}`;
  else if (column.is_key && column.data_type === 'longtext') error = 'Una columna clave no puede ser Texto largo';
  return { column, error };
}

/** Valida el conjunto completo de columnas de una tabla nueva. */
export function validateColumns(rawColumns) {
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) {
    throw new HttpError(400, 'Define al menos una columna');
  }
  if (rawColumns.length > MAX_COLUMNS) throw new HttpError(400, `Máximo ${MAX_COLUMNS} columnas`);

  const fieldErrors = [];
  const seenDb = new Set();
  const seenExcel = new Set();
  const columns = rawColumns.map((raw, i) => {
    const { column, error } = normalizeColumn(raw, i);
    if (error) fieldErrors.push({ index: i, message: error });
    else if (seenDb.has(column.db_name)) fieldErrors.push({ index: i, message: `Nombre en BD duplicado: ${column.db_name}` });
    else if (seenExcel.has(normalizeHeader(column.excel_name))) {
      fieldErrors.push({ index: i, message: `Nombre en Excel duplicado: ${column.excel_name}` });
    }
    seenDb.add(column.db_name);
    seenExcel.add(normalizeHeader(column.excel_name));
    return column;
  });

  const keys = columns.filter((c) => c.is_key);
  if (keys.length === 0) fieldErrors.push({ index: null, message: 'Marca al menos una columna como clave (para el upsert)' });
  if (keys.filter((c) => c.data_type === 'text').length > MAX_TEXT_KEYS) {
    fieldErrors.push({ index: null, message: `Máximo ${MAX_TEXT_KEYS} columnas clave de tipo Texto` });
  }
  if (fieldErrors.length) throw new HttpError(400, fieldErrors[0].message, { fieldErrors });
  return columns;
}

const SYSTEM_COLUMN_NAMES = ['_id', '_created_at', '_updated_at'];

/**
 * Conflictos de una columna nueva o editada con el resto de la tabla (others = las demás columnas).
 * Devuelve { status, message } o null.
 */
export function columnConflict(others, column) {
  if (others.some((c) => c.db_name === column.db_name) || SYSTEM_COLUMN_NAMES.includes(column.db_name)) {
    return { status: 409, message: `La columna "${column.db_name}" ya existe` };
  }
  if (others.some((c) => normalizeHeader(c.excel_name) === normalizeHeader(column.excel_name))) {
    return { status: 409, message: `El nombre en Excel "${column.excel_name}" ya está en uso` };
  }
  if (column.is_key && column.data_type === 'longtext') return { status: 400, message: 'Una columna clave no puede ser Texto largo' };
  if (column.is_key && column.data_type === 'text' && others.filter((c) => c.is_key && c.data_type === 'text').length >= MAX_TEXT_KEYS) {
    return { status: 400, message: `Máximo ${MAX_TEXT_KEYS} columnas clave de tipo Texto` };
  }
  return null;
}

export function columnSql(col) {
  return `${escapeId(col.db_name)} ${DATA_TYPES[col.data_type].sql} ${col.nullable ? 'NULL' : 'NOT NULL'}`;
}

export function buildCreateTableSql(dbTable, columns) {
  const keys = columns.filter((c) => c.is_key).map((c) => escapeId(c.db_name));
  const lines = [
    '`_id` BIGINT NOT NULL AUTO_INCREMENT',
    ...columns.map(columnSql),
    '`_created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '`_updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    'PRIMARY KEY (`_id`)',
    `UNIQUE KEY \`uk_upsert\` (${keys.join(', ')})`,
    'KEY `idx_updated_at` (`_updated_at`)',
  ];
  return `CREATE TABLE ${escapeId(dbTable)} (\n  ${lines.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

/** Agrega la columna después de la última columna de usuario (antes de las de sistema). */
export const addColumnSql = (dbTable, col, afterColumn) =>
  `ALTER TABLE ${escapeId(dbTable)} ADD COLUMN ${columnSql(col)} AFTER ${escapeId(afterColumn)}`;

export const dropColumnSql = (dbTable, dbName) => `ALTER TABLE ${escapeId(dbTable)} DROP COLUMN ${escapeId(dbName)}`;

export const dropTableSql = (dbTable) => `DROP TABLE IF EXISTS ${escapeId(dbTable)}`;
export const truncateTableSql = (dbTable) => `TRUNCATE TABLE ${escapeId(dbTable)}`;

const STRING_TYPES = new Set(['text', 'longtext']);
export const isStringType = (type) => STRING_TYPES.has(type);

/**
 * Convierte los valores actuales de una columna al tipo nuevo (sin tocar la BD).
 * rows: [{ _id, value }]. Devuelve { changes: [{ id, from, to }], errors: [{ id, value, message }] }
 * con los valores como texto canónico, listos para escribirse en una columna de texto.
 * Con onlyChanged se omiten las filas cuyo texto no cambia.
 */
export function planColumnConversion(rows, newType, nullable, onlyChanged = false) {
  const changes = [];
  const errors = [];
  for (const { _id: id, value } of rows) {
    let converted;
    try {
      converted = convertValue(value, newType);
    } catch (err) {
      if (!(err instanceof ConversionError)) throw err;
      errors.push({ id, value, message: err.message });
      continue;
    }
    if (converted === null && !nullable) {
      errors.push({ id, value, message: 'Valor vacío en una columna obligatoria' });
      continue;
    }
    const to = converted === null ? null : String(converted);
    if (!onlyChanged || to !== String(value)) changes.push({ id, from: value, to });
  }
  return { changes, errors };
}
