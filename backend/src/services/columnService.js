// Cambio de nombre en BD y/o tipo de una columna existente, conservando sus datos.
import mysql from 'mysql2/promise';
import { getPool } from '../config/db.js';
import { DATA_TYPES } from '../utils/types.js';
import { HttpError } from '../utils/httpError.js';
import { columnSql, isStringType, planColumnConversion } from './schemaService.js';

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
