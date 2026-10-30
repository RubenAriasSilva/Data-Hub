// Debe coincidir con backend/src/utils/types.js y identifiers.js
export const DATA_TYPES = {
  text: { sql: 'VARCHAR(255)', label: 'Texto' },
  longtext: { sql: 'TEXT', label: 'Texto largo' },
  int: { sql: 'BIGINT', label: 'Entero' },
  decimal: { sql: 'DECIMAL(18,4)', label: 'Decimal' },
  date: { sql: 'DATE', label: 'Fecha' },
  datetime: { sql: 'DATETIME', label: 'Fecha y hora' },
  boolean: { sql: 'TINYINT(1)', label: 'Booleano' },
};

export const IDENT_RE = /^[a-z][a-z0-9_]{0,63}$/;

// Rutas de una tabla, directa de la categoría o dentro de una aplicación.
// Acepta filas de la API (category_slug, application_slug, slug | table_slug).
const appSegment = (t) => (t.application_slug ? `/a/${t.application_slug}` : '');
export const parentPath = (t) => `/c/${t.category_slug}${appSegment(t)}`;
export const tablePath = (t) => `${parentPath(t)}/t/${t.table_slug ?? t.slug}`;
// Las colecciones MongoDB tienen su propia API (/api/mongo/v1)
export const apiPath = (t) => `/api/${t.db_type === 'mongodb' ? 'mongo/' : ''}v1/${t.category_slug}${t.application_slug ? `/${t.application_slug}` : ''}/${t.table_slug ?? t.slug}`;

// Motor de base de datos de cada tabla (hub_tables.db_type)
export const ENGINES = {
  mysql: {
    label: 'MySQL', color: 'blue', container: 'Tabla MySQL', records: 'registros', noun: 'tabla', Noun: 'Tabla', nounPlural: 'tablas',
  },
  mongodb: {
    label: 'MongoDB', color: 'green', container: 'Colección MongoDB', records: 'documentos', noun: 'colección', Noun: 'Colección', nounPlural: 'colecciones',
  },
};

/** Textos de las pantallas que mezclan tablas MySQL y colecciones MongoDB (solo si MongoDB está configurado). */
export const collectionLabels = (mongoEnabled) => (mongoEnabled
  ? { plural: 'Tablas y colecciones', newItem: 'Nueva tabla o colección', create: 'Crear tabla o colección', none: 'tablas ni colecciones', one: 'tabla/colección', many: 'tablas/colecciones', column: 'Tabla / colección' }
  : { plural: 'Tablas', newItem: 'Nueva tabla', create: 'Crear tabla', none: 'tablas', one: 'tabla', many: 'tablas', column: 'Tabla' });
export const engineOf = (t) => ENGINES[t?.db_type] ?? ENGINES.mysql;
export const isMongo = (t) => t?.db_type === 'mongodb';

// Rutas de campos de MongoDB (claves): "cliente.id"
export const FIELD_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function slugify(input, max = 64) {
  let s = String(input ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (/^[0-9]/.test(s)) s = `c_${s}`;
  return s.slice(0, max).replace(/_+$/, '');
}

export const normalizeHeader = (h) =>
  String(h ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const numberFmt = new Intl.NumberFormat('es-MX');
export const fmtNumber = (n) => (n === null || n === undefined ? '—' : numberFmt.format(n));

/** "2024-05-15 10:30:00" (hora del servidor) -> "15 may 2024, 10:30" */
export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(value) {
  if (!value) return 'Sin cargas';
  const d = new Date(String(value).replace(' ', 'T'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(diff)) return String(value);
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `hace ${Math.floor(diff / 86400)} d`;
  return fmtDateTime(value);
}

// Origen de una carga (upload_logs.source)
export const SOURCES = {
  excel: { label: 'Excel', color: 'gray' },
  csv: { label: 'CSV', color: 'gray' },
  json: { label: 'JSON', color: 'blue' },
  ndjson: { label: 'NDJSON', color: 'blue' },
  bson: { label: 'BSON', color: 'green' },
  script: { label: 'Código', color: 'green' },
  api: { label: 'API', color: 'blue' },
};

export const STATUS = {
  success: { label: 'Completado', color: 'green' },
  partial: { label: 'Parcial', color: 'orange' },
  error: { label: 'Error', color: 'red' },
};

export function buildCreateSql(dbTable, columns) {
  const q = (n) => `\`${n || '?'}\``;
  const keys = columns.filter((c) => c.is_key).map((c) => q(c.db_name));
  const lines = [
    '`_id` BIGINT NOT NULL AUTO_INCREMENT',
    ...columns.map((c) => `${q(c.db_name)} ${DATA_TYPES[c.data_type]?.sql ?? '?'} ${c.is_key || !c.nullable ? 'NOT NULL' : 'NULL'}`),
    '`_created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '`_updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    'PRIMARY KEY (`_id`)',
    `UNIQUE KEY \`uk_upsert\` (${keys.join(', ') || '…'})`,
  ];
  return `CREATE TABLE \`${dbTable}\` (\n  ${lines.join(',\n  ')}\n);`;
}

export function sampleValue(type, i = 0) {
  switch (type) {
    case 'int': return 1000 + i;
    case 'decimal': return 1250.5 + i;
    case 'date': return '2024-05-15';
    case 'datetime': return '2024-05-15 08:30:00';
    case 'boolean': return true;
    default: return `ejemplo_${i + 1}`;
  }
}
