import { getPool } from '../config/db.js';
import { parseSheet, mapRows } from './excelService.js';
import { upsertRecords } from './dataService.js';
import { convertValue, ConversionError } from '../utils/types.js';
import { normalizeHeader } from '../utils/identifiers.js';
import { HttpError } from '../utils/httpError.js';

const MAX_ERRORS = 500;
const MAX_JSON_ROWS = 50000;

/** Ejecuta el upsert, registra en upload_logs y arma el resultado. */
async function finalize(meta, { source, filename, records, errors, warnings, totalRows, startedAt }) {
  let inserted = 0;
  let updated = 0;
  let dbError = null;
  if (totalRows === 0) warnings.push('No se recibieron filas de datos');
  try {
    ({ inserted, updated } = await upsertRecords(meta, records));
  } catch (err) {
    if (err.status) throw err;
    dbError = err.sqlMessage || err.message;
  }

  const failed = dbError ? totalRows : totalRows - records.length;
  let status = 'success';
  if (dbError || totalRows === 0 || (failed > 0 && records.length === 0)) status = 'error';
  else if (failed > 0) status = 'partial';

  const result = {
    status,
    total: totalRows,
    inserted: dbError ? 0 : inserted,
    updated: dbError ? 0 : updated,
    failed,
    errors: errors.slice(0, MAX_ERRORS),
    errors_truncated: errors.length > MAX_ERRORS,
    error_count: errors.length,
    warnings,
    db_error: dbError,
    duration_ms: Date.now() - startedAt,
  };

  const [log] = await getPool().query(
    `INSERT INTO upload_logs (table_id, source, filename, rows_total, inserted, updated, failed, status, duration_ms, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meta.table.id, source, filename ?? null, result.total, result.inserted, result.updated, result.failed,
      status, result.duration_ms,
      JSON.stringify({ errors: result.errors, error_count: result.error_count, warnings, db_error: dbError }),
    ],
  );
  return { upload_id: log.insertId, ...result };
}

export async function importExcel(meta, file, source = 'excel') {
  if (!file) throw new HttpError(400, 'Adjunta un archivo Excel (.xlsx o .xls) en el campo "file"');
  const startedAt = Date.now();
  const parsed = parseSheet(file.buffer, meta.table.sheet_name);
  const mapped = mapRows(parsed, meta.columns);
  return finalize(meta, { source, filename: file.originalname, startedAt, ...mapped });
}

/**
 * Acepta [ {...} ] o { rows: [ {...} ] } con llaves por db_name o excel_name.
 * source/filename se registran en el historial (api = cuerpo HTTP, json = archivo o texto desde la app).
 */
export async function importJson(meta, body, { source = 'api', filename = null } = {}) {
  const input = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : null;
  if (!input) throw new HttpError(400, 'El cuerpo debe ser un arreglo de objetos o { "rows": [ ... ] }');
  if (input.length > MAX_JSON_ROWS) throw new HttpError(413, `Máximo ${MAX_JSON_ROWS} filas por solicitud`);
  const startedAt = Date.now();

  const byDb = new Map(meta.columns.map((c) => [c.db_name, c]));
  const byExcel = new Map(meta.columns.map((c) => [normalizeHeader(c.excel_name), c]));
  const required = meta.columns.filter((c) => !c.nullable);
  const unknown = new Set();
  const records = [];
  const errors = [];

  input.forEach((item, i) => {
    const row = i + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ row, column: null, value: null, message: 'La fila debe ser un objeto' });
      return;
    }
    const record = {};
    let ok = true;
    for (const [key, raw] of Object.entries(item)) {
      const col = byDb.get(key) ?? byExcel.get(normalizeHeader(key));
      if (!col) {
        unknown.add(key);
        continue;
      }
      try {
        const value = convertValue(raw, col.data_type);
        if (value === null && !col.nullable) throw new ConversionError(col.is_key ? 'La columna clave no puede estar vacía' : 'Valor obligatorio');
        record[col.db_name] = value;
      } catch (err) {
        if (!(err instanceof ConversionError)) throw err;
        ok = false;
        errors.push({ row, column: col.db_name, value: raw ?? null, message: err.message });
      }
    }
    for (const col of required) {
      if (ok && !(col.db_name in record)) {
        ok = false;
        errors.push({ row, column: col.db_name, value: null, message: col.is_key ? 'Falta la columna clave' : 'Falta columna obligatoria' });
      }
    }
    if (ok) records.push(record);
  });

  const warnings = unknown.size ? [`Campos ignorados (no definidos en la tabla): ${[...unknown].join(', ')}`] : [];
  return finalize(meta, { source, filename, records, errors, warnings, totalRows: input.length, startedAt });
}

/** Carga un archivo subido: .json se interpreta como JSON; cualquier otro, como Excel. */
export async function importFile(meta, file) {
  if (!file) throw new HttpError(400, 'Adjunta un archivo Excel (.xlsx o .xls) o JSON (.json) en el campo "file"');
  if (!file.originalname.toLowerCase().endsWith('.json')) return importExcel(meta, file);
  let body;
  try {
    body = JSON.parse(file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new HttpError(400, `JSON inválido en ${file.originalname}: ${err.message}`);
  }
  return importJson(meta, body, { source: 'json', filename: file.originalname });
}

export const resultHttpStatus = (result) => (result.status === 'error' ? 422 : 200);
