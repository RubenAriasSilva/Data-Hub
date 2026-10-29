import * as XLSX from 'xlsx';
import { convertValue, ConversionError, parseNumber, parseDateParts } from '../utils/types.js';
import { normalizeHeader, slugify } from '../utils/identifiers.js';
import { HttpError } from '../utils/httpError.js';

const DETECT_SAMPLE = 500;
const CSV_SEPARATORS = [';', ',', '\t', '|'];

export const isCsv = (filename) => /\.csv$/i.test(filename ?? '');

function readWorkbook(buffer) {
  try {
    return XLSX.read(buffer, { type: 'buffer', cellNF: true, cellDates: false });
  } catch (err) {
    throw new HttpError(400, `No se pudo leer el archivo Excel: ${err.message}`);
  }
}

/** UTF-8 si es válido; si no, windows-1252 (lo que exporta Excel en Windows). */
function decodeText(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  return text.replace(/^﻿/, '');
}

/** Separador más frecuente (fuera de comillas) en la primera línea no vacía; "," si no hay ninguno. */
function detectSeparator(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const counts = new Map(CSV_SEPARATORS.map((s) => [s, 0]));
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  const [sep, n] = [...counts].reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  return n > 0 ? sep : ',';
}

/** CSV como libro de una hoja; raw deja todo como texto (conserva ceros a la izquierda). */
function readCsv(buffer) {
  try {
    const text = decodeText(buffer);
    return XLSX.read(text, { type: 'string', FS: detectSeparator(text), raw: true });
  } catch (err) {
    throw new HttpError(400, `No se pudo leer el archivo CSV: ${err.message}`);
  }
}

function pickSheet(wb, sheetName) {
  if (!wb.SheetNames.length) throw new HttpError(400, 'El archivo no contiene hojas');
  if (!sheetName) return wb.SheetNames[0];
  const found = wb.SheetNames.find((n) => normalizeHeader(n) === normalizeHeader(sheetName));
  if (!found) {
    throw new HttpError(400, `La hoja "${sheetName}" no existe. Hojas disponibles: ${wb.SheetNames.join(', ')}`);
  }
  return found;
}

function readCell(cell) {
  if (!cell || cell.t === 'z' || cell.t === 'e' || cell.v === undefined || cell.v === null) return null;
  if (cell.t === 's' && String(cell.v).trim() === '') return null;
  const isDate = cell.t === 'd' || (cell.t === 'n' && Boolean(cell.z) && XLSX.SSF.is_date(cell.z));
  return { t: cell.t, v: cell.v, w: cell.w ?? String(cell.v), isDate };
}

/**
 * Lee una hoja: encabezados (primera fila no vacía) y filas con su número real en el archivo.
 * Con un .csv se ignora sheetName (solo tiene una hoja).
 */
export function parseSheet(buffer, sheetName, filename) {
  const csv = isCsv(filename);
  const wb = csv ? readCsv(buffer) : readWorkbook(buffer);
  const name = csv ? wb.SheetNames[0] : pickSheet(wb, sheetName);
  const ws = wb.Sheets[name];
  if (!ws?.['!ref']) throw new HttpError(400, csv ? 'El archivo CSV está vacío' : `La hoja "${name}" está vacía`);
  const range = XLSX.utils.decode_range(ws['!ref']);

  let headers = null;
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = [];
    let blank = true;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = readCell(ws[XLSX.utils.encode_cell({ r, c })]);
      if (cell) blank = false;
      cells.push(cell);
    }
    if (blank) continue;
    if (!headers) headers = cells.map((cell) => (cell ? String(cell.isDate ? cell.w : cell.v).trim() : ''));
    else rows.push({ rowNumber: r + 1, cells });
  }
  if (!headers) throw new HttpError(400, csv ? 'El archivo CSV está vacío' : `La hoja "${name}" está vacía`);
  if (csv) return { sheet: null, sheets: [], csv, headers, rows };
  return { sheet: name, sheets: wb.SheetNames, csv, headers, rows };
}

/** Valor de entrada para convertValue según el tipo destino. */
function cellInput(cell, type) {
  if (!cell) return null;
  if (type === 'text' || type === 'longtext') {
    if (cell.isDate) return cell.w;
    if (cell.t === 'b') return cell.v ? 'true' : 'false';
    return cell.v;
  }
  return cell.v;
}

/**
 * Mapea filas del Excel a registros { db_name: valor } usando excel_name.
 * Lanza 400 si faltan columnas clave u obligatorias en los encabezados.
 */
export function mapRows(parsed, columns) {
  const headerIndex = new Map();
  parsed.headers.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (key && !headerIndex.has(key)) headerIndex.set(key, i);
  });

  const mapping = [];
  const missing = [];
  for (const col of columns) {
    const idx = headerIndex.get(normalizeHeader(col.excel_name));
    if (idx === undefined) missing.push(col);
    else mapping.push({ col, idx });
  }

  const missingRequired = missing.filter((c) => c.is_key || !c.nullable);
  if (missingRequired.length) {
    throw new HttpError(
      400,
      `Faltan columnas ${missingRequired.some((c) => c.is_key) ? 'clave/obligatorias' : 'obligatorias'} en el archivo:${missingRequired.map((c) => `"${c.excel_name}"`).join(', ')}`,
      { missing: missingRequired.map((c) => c.excel_name), headers: parsed.headers.filter(Boolean) },
    );
  }

  const mappedIdx = new Set(mapping.map((m) => m.idx));
  const warnings = [];
  if (missing.length) warnings.push(`Columnas no encontradas en el archivo (se conservan sus valores actuales): ${missing.map((c) => c.excel_name).join(', ')}`);
  const unknown = parsed.headers.filter((h, i) => h && !mappedIdx.has(i));
  if (unknown.length) warnings.push(`Encabezados del archivo ignorados (no definidos en la tabla): ${unknown.join(', ')}`);

  const records = [];
  const errors = [];
  for (const row of parsed.rows) {
    const record = {};
    let ok = true;
    for (const { col, idx } of mapping) {
      const cell = row.cells[idx];
      try {
        const value = convertValue(cellInput(cell, col.data_type), col.data_type);
        if (value === null && !col.nullable) {
          throw new ConversionError(col.is_key ? 'La columna clave no puede estar vacía' : 'Valor obligatorio');
        }
        record[col.db_name] = value;
      } catch (err) {
        if (!(err instanceof ConversionError)) throw err;
        ok = false;
        errors.push({ row: row.rowNumber, column: col.excel_name, value: cell?.w ?? null, message: err.message });
      }
    }
    if (ok) records.push(record);
  }
  return { records, errors, warnings, totalRows: parsed.rows.length };
}

function detectType(cells) {
  const values = cells.filter(Boolean);
  if (!values.length) return 'text';
  if (values.every((c) => c.isDate)) {
    return values.some((c) => Math.abs(c.v % 1) > 1e-9) ? 'datetime' : 'date';
  }
  if (values.every((c) => c.t === 'b')) return 'boolean';
  if (values.every((c) => c.t === 'n' && !c.isDate)) {
    return values.every((c) => Number.isInteger(c.v)) ? 'int' : 'decimal';
  }
  return values.some((c) => String(c.w ?? c.v).length > 255) ? 'longtext' : 'text';
}

const INT_TEXT = /^[-+]?(0|[1-9]\d*)$/; // sin ceros a la izquierda (códigos como 00123 quedan en texto)
const DATE_TEXT = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/;
const TIME_TEXT = /\d{1,2}:\d{2}/;
const BOOL_TEXT = new Set(['true', 'false', 'si', 'sí', 'no', 'yes', 'verdadero', 'falso']);

/** Tipo a partir del texto (CSV: todas las celdas llegan como texto). */
function detectTextType(cells) {
  const values = cells.filter(Boolean).map((c) => String(c.v).trim());
  if (!values.length) return 'text';
  if (values.every((v) => INT_TEXT.test(v) && Number.isSafeInteger(Number(v)))) return 'int';
  if (values.every((v) => !/^[-+]?0\d/.test(v) && !Number.isNaN(parseNumber(v)))) return 'decimal';
  if (values.every((v) => DATE_TEXT.test(v) && parseDateParts(v))) {
    return values.some((v) => TIME_TEXT.test(v)) ? 'datetime' : 'date';
  }
  if (values.every((v) => BOOL_TEXT.has(v.toLowerCase()))) return 'boolean';
  return values.some((v) => v.length > 255) ? 'longtext' : 'text';
}

/** Propone columnas a partir de un Excel o CSV de ejemplo. */
export function detectColumns(buffer, sheetName, filename) {
  const parsed = parseSheet(buffer, sheetName, filename);
  const typeOf = parsed.csv ? detectTextType : detectType;
  const sample = parsed.rows.slice(0, DETECT_SAMPLE);
  const usedDb = new Set();
  const columns = [];

  parsed.headers.forEach((header, idx) => {
    if (!header) return;
    const base = slugify(header) || `columna_${idx + 1}`;
    let dbName = base;
    for (let n = 2; usedDb.has(dbName); n++) dbName = `${base.slice(0, 60)}_${n}`;
    usedDb.add(dbName);
    const cells = sample.map((r) => r.cells[idx]);
    columns.push({
      excel_name: header,
      db_name: dbName,
      data_type: typeOf(cells),
      is_key: false,
      nullable: true,
      _unique: cells.every(Boolean) && new Set(cells.map((c) => String(c.v))).size === cells.length,
    });
  });

  // Sugerir como clave la primera columna sin vacíos ni repetidos.
  const keyCandidate = columns.find((c) => c._unique && c.data_type !== 'longtext');
  if (keyCandidate && sample.length) {
    keyCandidate.is_key = true;
    keyCandidate.nullable = false;
  }
  columns.forEach((c) => delete c._unique);

  return {
    sheet: parsed.sheet,
    sheets: parsed.sheets,
    columns,
    rowCount: parsed.rows.length,
    preview: parsed.rows.slice(0, 5).map((r) => r.cells.map((c) => (c ? c.w : null))),
  };
}

/** Genera un .xlsx a partir de encabezados y filas (arreglos). */
const csvField = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV UTF-8 con BOM (para que Power BI y Excel respeten acentos). */
export function buildCsv(headers, rows) {
  return `\uFEFF${[headers, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}

export function buildWorkbook(headers, rows, sheetName = 'Datos') {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, String(h).length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
