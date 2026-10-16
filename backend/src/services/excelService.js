import * as XLSX from 'xlsx';
import { convertValue, ConversionError } from '../utils/types.js';
import { normalizeHeader, slugify } from '../utils/identifiers.js';
import { HttpError } from '../utils/httpError.js';

const DETECT_SAMPLE = 500;

function readWorkbook(buffer) {
  try {
    return XLSX.read(buffer, { type: 'buffer', cellNF: true, cellDates: false });
  } catch (err) {
    throw new HttpError(400, `No se pudo leer el archivo Excel: ${err.message}`);
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

/** Lee una hoja: encabezados (primera fila no vacía) y filas con su número real en Excel. */
export function parseSheet(buffer, sheetName) {
  const wb = readWorkbook(buffer);
  const name = pickSheet(wb, sheetName);
  const ws = wb.Sheets[name];
  if (!ws['!ref']) throw new HttpError(400, `La hoja "${name}" está vacía`);
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
  if (!headers) throw new HttpError(400, `La hoja "${name}" está vacía`);
  return { sheet: name, sheets: wb.SheetNames, headers, rows };
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
      `Faltan columnas ${missingRequired.some((c) => c.is_key) ? 'clave/obligatorias' : 'obligatorias'} en el Excel: ${missingRequired.map((c) => `"${c.excel_name}"`).join(', ')}`,
      { missing: missingRequired.map((c) => c.excel_name), headers: parsed.headers.filter(Boolean) },
    );
  }

  const mappedIdx = new Set(mapping.map((m) => m.idx));
  const warnings = [];
  if (missing.length) warnings.push(`Columnas no encontradas en el Excel (se conservan sus valores actuales): ${missing.map((c) => c.excel_name).join(', ')}`);
  const unknown = parsed.headers.filter((h, i) => h && !mappedIdx.has(i));
  if (unknown.length) warnings.push(`Encabezados del Excel ignorados (no definidos en la tabla): ${unknown.join(', ')}`);

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

/** Propone columnas a partir de un Excel de ejemplo. */
export function detectColumns(buffer, sheetName) {
  const parsed = parseSheet(buffer, sheetName);
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
      data_type: detectType(cells),
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
export function buildWorkbook(headers, rows, sheetName = 'Datos') {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, String(h).length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
