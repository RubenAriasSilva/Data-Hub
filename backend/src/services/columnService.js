// Operaciones sobre columnas de una tabla existente (agregar, editar conservando datos, eliminar).
// Las usan tanto las rutas REST como el modo SQL.
import mysql from 'mysql2/promise';
import { getPool } from '../config/db.js';
import { DATA_TYPES } from '../utils/types.js';
import { HttpError } from '../utils/httpError.js';
import { isValidIdentifier } from '../utils/identifiers.js';
import {
  columnSql, isStringType, planColumnConversion, normalizeColumn, columnConflict, addColumnSql, dropColumnSql,
} from './schemaService.js';

const { escapeId } = mysql;
const BATCH_SIZE = 500;
const MAX_REPORTED_ERRORS = 20;
// Tipo intermedio para columnas no textuales: cabe cualquier número, fecha o booleano como texto
const STAGING_TYPE = 'VARCHAR(64)';

const changeSql = (dbTable, from, def) => `ALTER TABLE ${escapeId(dbTable)} CHANGE COLUMN ${escapeId(from)} ${def}`;
const stagingDef = (col) => `${escapeId(col.db_name)} ${STAGING_TYPE} ${col.nullable ? 'NULL' : 'NOT NULL'}`;

/** Escribe valores por _id en lotes, sin alterar _updated_at (es un cambio de estructura, no de datos). */
async function writeValues(conn, dbTable, dbName, values) {
  const t = escapeId(dbTable);
  const c = escapeId(dbName);
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    await conn.query(
      `UPDATE ${t} SET ${c} = CASE \`_id\` ${batch.map(() => 'WHEN ? THEN ?').join(' ')} END, \`_updated_at\` = \`_updated_at\`
       WHERE \`_id\` IN (?)`,
      [...batch.flatMap((v) => [v.id, v.value]), batch.map((v) => v.id)],
    );
  }
}

const mysqlMessage = (err) => (err.code === 'ER_DUP_ENTRY'
  ? 'la conversión genera valores de clave duplicados'
  : err.sqlMessage || err.message);

/**
 * Renombra la columna y/o cambia su tipo. Si cambia el tipo:
 * 1) convierte y valida todos los valores en memoria (si alguno falla no se toca la tabla);
 * 2) pasa la columna a texto, escribe los valores convertidos y 3) la cambia al tipo final.
 * Si MySQL falla en 2 o 3, se restauran los valores y el tipo originales.
 */
export async function alterColumn(meta, col, { dbName, dataType }) {
  const dbTable = meta.table.db_table;
  const target = { ...col, db_name: dbName, data_type: dataType };

  if (dataType === col.data_type) {
    if (dbName !== col.db_name) await getPool().query(changeSql(dbTable, col.db_name, columnSql(target)));
    return;
  }

  const [rows] = await getPool().query(
    `SELECT \`_id\`, ${escapeId(col.db_name)} AS value FROM ${escapeId(dbTable)} WHERE ${escapeId(col.db_name)} IS NOT NULL`,
  );
  const fromString = isStringType(col.data_type);
  const { changes, errors } = planColumnConversion(rows, dataType, col.nullable, fromString);
  if (errors.length) {
    throw new HttpError(
      422,
      `${errors.length} de ${rows.length} valores no se pueden convertir a ${DATA_TYPES[dataType].label}. No se modificó la tabla.`,
      { errors: errors.slice(0, MAX_REPORTED_ERRORS).map((e) => ({ _id: e.id, value: e.value, message: e.message })) },
    );
  }

  const conn = await getPool().getConnection();
  let staged = false;
  let written = false;
  try {
    if (!fromString) {
      await conn.query(changeSql(dbTable, col.db_name, stagingDef(col)));
      staged = true;
    }
    written = true;
    await writeValues(conn, dbTable, col.db_name, changes.map((c) => ({ id: c.id, value: c.to })));
    await conn.query(changeSql(dbTable, col.db_name, columnSql(target)));
  } catch (err) {
    // El DDL de MySQL no es transaccional: se deshace a mano
    try {
      if (written) await writeValues(conn, dbTable, col.db_name, changes.map((c) => ({ id: c.id, value: c.from })));
      if (staged) await conn.query(changeSql(dbTable, col.db_name, columnSql(col)));
    } catch (restoreErr) {
      console.error(`[columns] No se pudo restaurar ${dbTable}.${col.db_name}:`, restoreErr);
      throw new HttpError(500, `MySQL rechazó el cambio (${mysqlMessage(err)}) y no se pudo restaurar la columna: ${mysqlMessage(restoreErr)}`);
    }
    throw new HttpError(400, `MySQL rechazó el cambio: ${mysqlMessage(err)}. La columna quedó como estaba.`);
  } finally {
    conn.release();
  }
}

/** Valida una columna nueva (siempre opcional y no clave, porque la tabla puede tener datos). */
export function validateNewColumn(columns, raw) {
  // Tras eliminar columnas puede haber huecos en position: la nueva va después de la última
  const position = Math.max(-1, ...columns.map((c) => c.position ?? 0)) + 1;
  const { column, error } = normalizeColumn({ ...raw, is_key: false, nullable: true }, position);
  if (error) throw new HttpError(400, error);
  const conflict = columnConflict(columns, column);
  if (conflict) throw new HttpError(conflict.status, conflict.message);
  return column;
}

/** Valida la edición de una columna (nombre en Excel, nombre en BD y tipo). Devuelve la columna resultante. */
export function validateColumnUpdate(columns, col, changes) {
  const target = {
    ...col,
    excel_name: String(changes.excel_name ?? col.excel_name).trim(),
    db_name: String(changes.db_name ?? col.db_name).trim(),
    data_type: String(changes.data_type ?? col.data_type),
  };
  if (!target.excel_name || target.excel_name.length > 255) throw new HttpError(400, 'El nombre en Excel es obligatorio (máx. 255)');
  if (!isValidIdentifier(target.db_name)) {
    throw new HttpError(400, 'El nombre en BD debe iniciar con letra y contener solo minúsculas, números y _ (máx. 64)');
  }
  if (!DATA_TYPES[target.data_type]) throw new HttpError(400, `Tipo inválido: ${target.data_type}`);
  const conflict = columnConflict(columns.filter((c) => c.id !== col.id), target);
  if (conflict) throw new HttpError(conflict.status, conflict.message);
  return target;
}

/** Valida que la columna se pueda eliminar. */
export function validateColumnDrop(columns, col) {
  if (col.is_key) throw new HttpError(400, `No se puede eliminar "${col.db_name}": es columna clave`);
  if (columns.length <= 1) throw new HttpError(400, 'La tabla debe conservar al menos una columna');
}

export async function addColumn(meta, raw) {
  const column = validateNewColumn(meta.columns, raw);
  try {
    await getPool().query(addColumnSql(meta.table.db_table, column, meta.columns.at(-1)?.db_name ?? '_id'));
  } catch (err) {
    throw new HttpError(400, `MySQL rechazó la columna: ${err.sqlMessage || err.message}`);
  }
  await getPool().query(
    'INSERT INTO hub_columns (table_id, excel_name, db_name, data_type, is_key, nullable, position) VALUES (?, ?, ?, ?, 0, 1, ?)',
    [meta.table.id, column.excel_name, column.db_name, column.data_type, column.position],
  );
}

export async function updateColumn(meta, col, changes) {
  const target = validateColumnUpdate(meta.columns, col, changes);
  await alterColumn(meta, col, { dbName: target.db_name, dataType: target.data_type });
  await getPool().query(
    'UPDATE hub_columns SET excel_name = ?, db_name = ?, data_type = ? WHERE id = ?',
    [target.excel_name, target.db_name, target.data_type, col.id],
  );
}

export async function dropColumn(meta, col) {
  validateColumnDrop(meta.columns, col);
  try {
    await getPool().query(dropColumnSql(meta.table.db_table, col.db_name));
  } catch (err) {
    throw new HttpError(400, `MySQL rechazó eliminar la columna: ${err.sqlMessage || err.message}`);
  }
  await getPool().query('DELETE FROM hub_columns WHERE id = ?', [col.id]);
}
