// Tipos de columna soportados y su conversión desde valores de Excel / JSON.
export const DATA_TYPES = {
  text: { sql: 'VARCHAR(255)', label: 'Texto' },
  longtext: { sql: 'TEXT', label: 'Texto largo' },
  int: { sql: 'BIGINT', label: 'Entero' },
  decimal: { sql: 'DECIMAL(18,4)', label: 'Decimal' },
  date: { sql: 'DATE', label: 'Fecha' },
  datetime: { sql: 'DATETIME', label: 'Fecha y hora' },
  boolean: { sql: 'TINYINT(1)', label: 'Booleano' },
};

export class ConversionError extends Error {}

const pad = (n) => String(n).padStart(2, '0');

/** Convierte un número de serie de Excel (sistema 1900) a partes de fecha. */
function excelSerialToParts(serial) {
  const d = new Date(Math.round((serial - 25569) * 86400) * 1000);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
  };
}

function validParts(p) {
  if (!p || p.y < 1000 || p.y > 9999 || p.h > 23 || p.mi > 59 || p.s > 59) return null;
  const check = new Date(Date.UTC(p.y, p.m - 1, p.d));
  if (check.getUTCMonth() !== p.m - 1 || check.getUTCDate() !== p.d) return null;
  return p;
}

/**
 * Acepta: Date, número de serie de Excel, "YYYY-MM-DD[ HH:MM[:SS]]", ISO con "T",
 * y "DD/MM/YYYY[ HH:MM[:SS] [am|pm]]" (día primero).
 */
export function parseDateParts(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return validParts({
      y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate(),
      h: value.getHours(), mi: value.getMinutes(), s: value.getSeconds(),
    });
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return null;
    return validParts(excelSerialToParts(value));
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return validParts({ y: +m[1], m: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) });
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?)?$/i);
  if (m) {
    let h = +(m[4] ?? 0);
    const ampm = m[7]?.toLowerCase();
    if (ampm === 'p' && h < 12) h += 12;
    if (ampm === 'a' && h === 12) h = 0;
    return validParts({ y: +m[3], m: +m[2], d: +m[1], h, mi: +(m[5] ?? 0), s: +(m[6] ?? 0) });
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseDateParts(Number(s));
  return null;
}

/** "1,234.5" / "1.234,5" / "1,5" / "$ 1 200" -> número. NaN si no es numérico. */
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'boolean') return value ? 1 : 0;
  let s = String(value).trim().replace(/[\s$€]/g, '');
  if (s === '') return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

const TRUE_VALUES = new Set(['1', 'true', 'si', 'sí', 's', 'yes', 'y', 'verdadero', 'x', 'ok']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'falso']);

const formatDate = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
const formatDateTime = (p) => `${formatDate(p)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;

/** Convierte un valor al tipo de la columna. Devuelve null para vacíos; lanza ConversionError si es inválido. */
export function convertValue(value, type) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  switch (type) {
    case 'text':
    case 'longtext': {
      let s;
      if (value instanceof Date) s = formatDateTime(parseDateParts(value));
      else if (typeof value === 'number') s = Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
      else s = String(value).trim();
      if (type === 'text' && s.length > 255) throw new ConversionError(`Texto excede 255 caracteres (${s.length})`);
      if (type === 'longtext' && Buffer.byteLength(s, 'utf8') > 65535) throw new ConversionError('Texto largo excede 64 KB');
      return s;
    }
    case 'int': {
      const n = parseNumber(value);
      if (Number.isNaN(n)) throw new ConversionError(`"${value}" no es un número`);
      const r = Math.round(n);
      if (Math.abs(n - r) > 1e-9) throw new ConversionError(`"${value}" no es un entero`);
      if (!Number.isSafeInteger(r)) throw new ConversionError(`"${value}" está fuera de rango`);
      return r;
    }
    case 'decimal': {
      const n = parseNumber(value);
      if (Number.isNaN(n)) throw new ConversionError(`"${value}" no es un número`);
      if (Math.abs(n) >= 1e14) throw new ConversionError(`"${value}" está fuera de rango`);
      return Math.round(n * 10000) / 10000;
    }
    case 'date': {
      const p = parseDateParts(value);
      if (!p) throw new ConversionError(`"${value}" no es una fecha válida`);
      return formatDate(p);
    }
    case 'datetime': {
      const p = parseDateParts(value);
      if (!p) throw new ConversionError(`"${value}" no es una fecha/hora válida`);
      return formatDateTime(p);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value === 'number') {
        if (value === 1 || value === 0) return value;
        throw new ConversionError(`"${value}" no es booleano (use 1/0, sí/no, true/false)`);
      }
      const s = String(value).trim().toLowerCase();
      if (TRUE_VALUES.has(s)) return 1;
      if (FALSE_VALUES.has(s)) return 0;
      throw new ConversionError(`"${value}" no es booleano (use 1/0, sí/no, true/false)`);
    }
    default:
      throw new ConversionError(`Tipo desconocido: ${type}`);
  }
}
