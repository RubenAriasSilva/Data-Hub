// Cargas a colecciones MongoDB: JSON (EJSON), NDJSON/JSONL, BSON (mongodump) y Excel/CSV.
import { BSON, EJSON } from 'bson';
import { parseSheet, isCsv } from './excelService.js';
import { finalize } from './importService.js';
import { upsertDocuments, unflatten, getPath, emptyValue, assertNoOperators } from './mongoService.js';
import { convertValue } from '../utils/types.js';
import { HttpError } from '../utils/httpError.js';

const MAX_DOCS = 50000;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !v._bsontype && !(v instanceof Date);

/** [ {...} ], { documents: [...] }, { rows: [...] } o un solo objeto -> arreglo de documentos. */
export function documentsFromBody(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.documents)) return body.documents;
  if (Array.isArray(body?.rows)) return body.rows;
  if (isPlainObject(body)) return [body];
  throw new HttpError(400, 'El cuerpo debe ser un documento, un arreglo de documentos o { "documents": [ ... ] }');
}

const parseEjson = (text, where) => {
  try {
    return EJSON.parse(text, { relaxed: true });
  } catch (err) {
    throw new HttpError(400, `JSON inválido en ${where}: ${err.message}`);
  }
};

/** Una línea JSON por documento; las líneas vacías se ignoran. */
export function parseNdjson(text, filename) {
  const docs = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim()) docs.push(parseEjson(line, `${filename}, línea ${i + 1}`));
  });
  return docs;
}

/** Documentos BSON concatenados (formato de mongodump): cada uno inicia con su longitud int32. */
export function parseBson(buffer, filename) {
  const docs = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset < 5) throw new HttpError(400, `${filename}: el archivo BSON termina de forma incompleta`);
    const size = buffer.readInt32LE(offset);
    if (size < 5 || offset + size > buffer.length) {
      throw new HttpError(400, `${filename}: BSON inválido en el byte ${offset} (documento ${docs.length + 1})`);
    }
    try {
      docs.push(BSON.deserialize(buffer.subarray(offset, offset + size), { promoteValues: true }));
    } catch (err) {
      throw new HttpError(400, `${filename}: BSON inválido en el documento ${docs.length + 1}: ${err.message}`);
    }
    offset += size;
  }
  return docs;
}

const NUMBER_TEXT = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/; // sin ceros a la izquierda: códigos como 00123 quedan en texto

/** Valor de una celda para MongoDB: conserva números, booleanos y fechas. En CSV (todo texto) se infieren. */
function cellToValue(cell, csv) {
  if (!cell) return undefined;
  if (csv && typeof cell.v === 'string') {
    const t = cell.v.trim();
    if (NUMBER_TEXT.test(t)) return Number(t);
    if (t === 'true' || t === 'false') return t === 'true';
    return cell.v;
  }
  if (cell.isDate) {
    const text = convertValue(cell.v, 'datetime');
    return new Date(`${text.replace(' ', 'T')}Z`);
  }
  if (cell.t === 'n' || cell.t === 'b') return cell.v;
  return String(cell.v);
}

/**
 * Excel/CSV -> documentos. Encabezados con punto ("cliente.nombre") forman objetos anidados;
 * las celdas vacías no generan campo.
 */
export function documentsFromSheet(parsed) {
  const headers = parsed.headers.map((h) => h.trim());
  const used = headers.filter(Boolean);
  const dup = used.find((h, i) => used.indexOf(h) !== i);
  if (dup) throw new HttpError(400, `Encabezado repetido en el archivo: "${dup}"`);
  const invalid = used.find((h) => h.startsWith('$') || h.split('.').some((p) => !p));
  if (invalid) throw new HttpError(400, `Encabezado inválido para MongoDB: "${invalid}"`);
  return parsed.rows.map((row) => {
    const flat = {};
    headers.forEach((h, i) => {
      const value = h ? cellToValue(row.cells[i], parsed.csv) : undefined;
      if (value !== undefined) flat[h] = value;
    });
    return { rowNumber: row.rowNumber, doc: unflatten(flat) };
  });
}

/** Valida documentos (objeto, sin campos con $, claves presentes). items: [{ rowNumber, doc }]. */
export function validateDocuments(meta, items) {
  const records = [];
  const errors = [];
  for (const { rowNumber, doc } of items) {
    if (!isPlainObject(doc)) {
      errors.push({ row: rowNumber, column: null, value: null, message: 'El documento debe ser un objeto' });
      continue;
    }
    try {
      assertNoOperators(doc);
    } catch (err) {
      errors.push({ row: rowNumber, column: null, value: null, message: err.message });
      continue;
    }
    const missing = meta.keyFields.find((k) => k !== '_id' && emptyValue(getPath(doc, k)));
    if (missing) {
      errors.push({ row: rowNumber, column: missing, value: null, message: 'Falta el campo clave' });
      continue;
    }
    records.push(doc);
  }
  return { records, errors };
}

function run(meta, items, { source, filename, startedAt, warnings = [] }) {
  if (items.length > MAX_DOCS) throw new HttpError(413, `Máximo ${MAX_DOCS} documentos por carga`);
  const { records, errors } = validateDocuments(meta, items);
  return finalize(meta, {
    source, filename, records, errors, warnings, totalRows: items.length, startedAt,
  }, upsertDocuments);
}

const numbered = (docs) => docs.map((doc, i) => ({ rowNumber: i + 1, doc }));

/** Documentos en el cuerpo HTTP (API o escritos en la app). */
export function importMongoJson(meta, body, { source = 'api', filename = null } = {}) {
  const startedAt = Date.now();
  // express.json entrega JSON plano: se interpretan los tipos extendidos ({"$oid": …}, {"$date": …})
  const docs = documentsFromBody(EJSON.deserialize(body ?? null, { relaxed: true }));
  return run(meta, numbered(docs), { source, filename, startedAt });
}

/** Archivo subido: .json, .ndjson/.jsonl, .bson, .csv o Excel. */
export function importMongoFile(meta, file) {
  if (!file) throw new HttpError(400, 'Adjunta un archivo JSON, NDJSON, BSON, Excel o CSV en el campo "file"');
  const startedAt = Date.now();
  const name = file.originalname;
  const lower = name.toLowerCase();
  const text = () => file.buffer.toString('utf8').replace(/^﻿/, '');
  let items;
  let source;
  if (lower.endsWith('.json')) {
    items = numbered(documentsFromBody(parseEjson(text(), name)));
    source = 'json';
  } else if (lower.endsWith('.ndjson') || lower.endsWith('.jsonl')) {
    items = numbered(parseNdjson(text(), name));
    source = 'ndjson';
  } else if (lower.endsWith('.bson')) {
    items = numbered(parseBson(file.buffer, name));
    source = 'bson';
  } else {
    items = documentsFromSheet(parseSheet(file.buffer, meta.table.sheet_name, name));
    source = isCsv(name) ? 'csv' : 'excel';
  }
  return run(meta, items, { source, filename: name, startedAt });
}
