// Intérprete de código mongosh para crear y modificar colecciones. El código NO se ejecuta:
// se lee con un parser propio que solo entiende literales (objetos, arreglos, textos, números)
// y un conjunto cerrado de instrucciones (createCollection, createIndex, dropIndex, insertOne/Many).
import {
  EJSON, ObjectId, Long, Decimal128, UUID,
} from 'bson';
import { assertSafeQuery, validateKeyFields } from './mongoService.js';
import { HttpError } from '../utils/httpError.js';

const MAX_INDEXES = 30;
const MAX_DOCS = 50000;
const RESERVED_INDEXES = new Set(['_id_', 'uk_upsert', 'idx_updated_at']);
const INDEX_TYPES = new Set([1, -1, 'text', '2dsphere', '2d', 'hashed']);
const INDEX_FIELD_RE = /^([A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*(\.\$\*\*)?|\$\*\*)$/;
const COLLECTION_OPTIONS = new Set(['validator', 'validationLevel', 'validationAction', 'collation', 'capped', 'size', 'max']);
const INDEX_OPTIONS = new Set([
  'name', 'unique', 'sparse', 'partialFilterExpression', 'collation', 'expireAfterSeconds', 'hidden',
  'weights', 'default_language', 'language_override',
]);

const fail = (line, msg) => {
  throw new HttpError(400, `Línea ${line}: ${msg}`);
};

// ── Tokens ──────────────────────────────────────────────────────────────────

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', 0: '\0', v: '\v' };

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') {
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) fail(line, 'comentario /* sin cerrar');
      line += (src.slice(i, end).match(/\n/g) || []).length;
      i = end + 2;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const start = line;
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\') {
          const n = src[j + 1];
          if (n === 'u') {
            out += String.fromCharCode(parseInt(src.substr(j + 2, 4), 16));
            j += 6;
          } else {
            out += ESCAPES[n] ?? n;
            if (n === '\n') line++;
            j += 2;
          }
          continue;
        }
        if (src[j] === '\n') {
          if (ch !== '`') fail(start, 'texto sin cerrar');
          line++;
        }
        if (ch === '`' && src[j] === '$' && src[j + 1] === '{') fail(line, 'no se admiten variables dentro de textos (${…})');
        out += src[j];
        j++;
      }
      if (j >= src.length) fail(start, 'texto sin cerrar');
      tokens.push({ t: 'str', v: out, line: start });
      i = j + 1;
    } else {
      const rest = src.slice(i, i + 256);
      const num = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(rest);
      const id = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (num && (/[\d.]/.test(ch) || /[\d.]/.test(src[i + 1]))) {
        tokens.push({ t: 'num', v: Number(num[0]), line });
        i += num[0].length;
      } else if (id) {
        tokens.push({ t: 'id', v: id[0], line });
        i += id[0].length;
      } else if ('{}[](),:;.'.includes(ch)) {
        tokens.push({ t: ch, line });
        i++;
      } else fail(line, `carácter inesperado "${ch}"`);
    }
  }
  return tokens;
}

// ── Parser de valores e instrucciones ───────────────────────────────────────

const toDate = (line, args) => {
  const d = args.length ? new Date(args[0]) : new Date();
  if (Number.isNaN(d.getTime())) fail(line, `fecha inválida: ${JSON.stringify(args[0])}`);
  return d;
};

// Constructores de mongosh -> tipos BSON
const CONSTRUCTORS = {
  ObjectId: (line, [hex]) => {
    if (hex === undefined) return new ObjectId();
    if (typeof hex !== 'string' || !/^[0-9a-f]{24}$/i.test(hex)) fail(line, `ObjectId inválido: ${JSON.stringify(hex)}`);
    return new ObjectId(hex);
  },
  ISODate: toDate,
  Date: toDate,
  NumberInt: (line, [n]) => {
    if (!Number.isInteger(Number(n))) fail(line, `NumberInt inválido: ${JSON.stringify(n)}`);
    return Number(n);
  },
  NumberLong: (line, [n]) => {
    if (!/^-?\d+$/.test(String(n))) fail(line, `NumberLong inválido: ${JSON.stringify(n)}`);
    return Long.fromString(String(n));
  },
  NumberDecimal: (line, [n]) => {
    if (Number.isNaN(Number(n))) fail(line, `NumberDecimal inválido: ${JSON.stringify(n)}`);
    return Decimal128.fromString(String(n));
  },
  UUID: (line, [s]) => {
    if (s === undefined) return new UUID();
    if (typeof s !== 'string' || !/^[0-9a-f]{8}-?([0-9a-f]{4}-?){3}[0-9a-f]{12}$/i.test(s)) fail(line, `UUID inválido: ${JSON.stringify(s)}`);
    return new UUID(s);
  },
};
CONSTRUCTORS.Long = CONSTRUCTORS.NumberLong;
CONSTRUCTORS.Decimal128 = CONSTRUCTORS.NumberDecimal;

class Parser {
  constructor(tokens) {
    this.tk = tokens;
    this.i = 0;
  }

  peek() { return this.tk[this.i]; }

  line() { return (this.peek() ?? this.tk[this.tk.length - 1])?.line ?? 1; }

  is(type, v) {
    const t = this.peek();
    return Boolean(t) && t.t === type && (v === undefined || t.v === v);
  }

  next() {
    const t = this.tk[this.i];
    if (!t) fail(this.line(), 'el código termina de forma inesperada');
    this.i++;
    return t;
  }

  expect(type, label) {
    if (!this.is(type)) {
      const t = this.peek();
      fail(this.line(), `se esperaba ${label ?? `"${type}"`}${t ? ` y se encontró ${t.t === 'id' || t.t === 'str' ? `"${t.v}"` : `"${t.t}"`}` : ''}`);
    }
    return this.next();
  }

  value() {
    const t = this.peek();
    if (!t) fail(this.line(), 'falta un valor');
    if (t.t === '{') return this.object();
    if (t.t === '[') return this.array();
    if (t.t === 'str' || t.t === 'num') {
      this.i++;
      return t.v;
    }
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') {
        this.i++;
        return t.v === 'true';
      }
      if (t.v === 'null' || t.v === 'undefined') {
        this.i++;
        return null;
      }
      if (t.v === 'new') this.i++;
      const name = this.expect('id', 'un constructor').v;
      if (!this.is('(')) fail(t.line, `"${name}" no es un valor (no se admiten variables ni expresiones)`);
      if (!CONSTRUCTORS[name]) fail(t.line, `función no soportada: ${name}()`);
      return CONSTRUCTORS[name](t.line, this.args());
    }
    return fail(t.line, `valor inesperado "${t.t}"`);
  }

  object() {
    this.expect('{');
    const out = {};
    while (!this.is('}')) {
      const k = this.next();
      if (!['str', 'id', 'num'].includes(k.t)) fail(k.line, 'se esperaba el nombre de un campo');
      this.expect(':', '":"');
      out[String(k.v)] = this.value();
      if (!this.is('}')) this.expect(',', '"," o "}"');
    }
    this.next();
    return out;
  }

  array() {
    this.expect('[');
    const out = [];
    while (!this.is(']')) {
      out.push(this.value());
      if (!this.is(']')) this.expect(',', '"," o "]"');
    }
    this.next();
    return out;
  }

  args() {
    this.expect('(');
    const out = [];
    while (!this.is(')')) {
      out.push(this.value());
      if (!this.is(')')) this.expect(',', '"," o ")"');
    }
    this.next();
    return out;
  }

  semicolon() {
    while (this.is(';')) this.i++;
  }

  /** Una instrucción: db.createCollection(…), db.<col>.<método>(…), db.getCollection("x").<método>(…) o use x. */
  statement(warnings) {
    const t = this.expect('id', 'una instrucción (db.…)');
    if (t.v === 'use') {
      const n = this.next();
      warnings.push(`Se ignoró "use ${n.v ?? ''}": la colección se crea en la base del Data Hub`);
      this.semicolon();
      return null;
    }
    if (t.v !== 'db') fail(t.line, `instrucción no soportada "${t.v}": usa db.createCollection, db.<colección>.createIndex o insertMany`);
    this.expect('.');
    const first = this.expect('id', 'un método o el nombre de la colección').v;
    let collection;
    let method;
    let args;
    if (first === 'createCollection') {
      method = first;
      args = this.args();
      collection = args[0];
    } else {
      if (first === 'getCollection') [collection] = this.args();
      else collection = first;
      this.expect('.');
      method = this.expect('id', 'un método').v;
      args = this.args();
    }
    if (this.is('.')) fail(this.line(), 'no se admiten llamadas encadenadas');
    this.semicolon();
    if (typeof collection !== 'string' || !collection.trim()) fail(t.line, 'nombre de colección inválido');
    return { line: t.line, collection, method, args };
  }
}

// ── Validación ──────────────────────────────────────────────────────────────

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPlain = (v) => isObject(v) && Object.getPrototypeOf(v) === Object.prototype;

// Formas EJSON que se convierten a su tipo BSON ({"$oid": …}, {"$date": …}, …)
const EJSON_WRAPPERS = new Set([
  '$oid', '$date', '$numberInt', '$numberLong', '$numberDouble', '$numberDecimal', '$uuid', '$binary', '$timestamp',
  '$regularExpression', '$minKey', '$maxKey', '$symbol',
]);

/** Convierte las formas EJSON a tipos BSON; deja intactos los valores que ya lo son (de los constructores). */
function ejson(v) {
  if (Array.isArray(v)) return v.map(ejson);
  if (!isPlain(v)) return v;
  const keys = Object.keys(v);
  if (keys.length && keys.every((k) => k.startsWith('$')) && EJSON_WRAPPERS.has(keys[0])) {
    // NumberLong grande: como Long para no perder precisión (el modo relajado lo pasaría a número)
    if (keys[0] === '$numberLong' && !Number.isSafeInteger(Number(v.$numberLong))) return Long.fromString(String(v.$numberLong));
    return EJSON.deserialize(v, { relaxed: true });
  }
  return Object.fromEntries(keys.map((k) => [k, ejson(v[k])]));
}

export const describeKey = (key) => Object.entries(key).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');

function describeIndex({ key, options }) {
  const parts = [`{ ${describeKey(key)} }`];
  if (options.unique) parts.push('único');
  if (options.collation) parts.push(`collation ${options.collation.locale}${options.collation.strength ? `/${options.collation.strength}` : ''}`);
  if (options.partialFilterExpression) parts.push('parcial');
  if (options.sparse) parts.push('sparse');
  if (options.expireAfterSeconds !== undefined) parts.push(`TTL ${options.expireAfterSeconds} s`);
  if (options.hidden) parts.push('oculto');
  return `Crear índice ${options.name ? `"${options.name}" ` : ''}${parts.join(' · ')}`;
}

function checkIndex(line, key, rawOptions = {}) {
  if (!isObject(key) || !Object.keys(key).length) fail(line, 'el índice necesita un objeto de campos, p. ej. { email: 1 }');
  for (const [field, type] of Object.entries(key)) {
    if (!INDEX_FIELD_RE.test(field)) fail(line, `campo de índice inválido: "${field}"`);
    if (!INDEX_TYPES.has(type)) fail(line, `tipo de índice inválido en "${field}": ${JSON.stringify(type)} (usa 1, -1, "text", "2dsphere", "2d" o "hashed")`);
  }
  if (!isObject(rawOptions)) fail(line, 'las opciones del índice deben ser un objeto');
  for (const k of Object.keys(rawOptions)) {
    if (!INDEX_OPTIONS.has(k)) fail(line, `opción de índice no soportada: ${k}`);
  }
  const options = ejson(rawOptions);
  if (options.name !== undefined && (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 120)) {
    fail(line, 'el nombre del índice debe ser un texto (máx. 120)');
  }
  if (RESERVED_INDEXES.has(options.name)) fail(line, `el nombre de índice "${options.name}" está reservado por el Data Hub`);
  if (options.partialFilterExpression !== undefined) {
    if (!isObject(options.partialFilterExpression)) fail(line, 'partialFilterExpression debe ser un objeto');
    try {
      assertSafeQuery(options.partialFilterExpression, 'partialFilterExpression');
    } catch (err) {
      fail(line, err.message);
    }
  }
  if (options.collation !== undefined && (!isObject(options.collation) || !options.collation.locale)) {
    fail(line, 'collation debe incluir locale, p. ej. { locale: "es", strength: 1 }');
  }
  return { key, options };
}

function checkCollectionOptions(line, raw = {}) {
  if (!isObject(raw)) fail(line, 'las opciones de createCollection deben ser un objeto');
  for (const k of Object.keys(raw)) {
    if (!COLLECTION_OPTIONS.has(k)) fail(line, `opción de colección no soportada: ${k}`);
  }
  const options = ejson(raw);
  if (options.validator !== undefined) {
    try {
      assertSafeQuery(options.validator, 'validator');
    } catch (err) {
      fail(line, err.message);
    }
  }
  return options;
}

function checkDocuments(line, docs) {
  for (const d of docs) if (!isObject(d)) fail(line, 'cada documento debe ser un objeto');
  return docs.map((d) => ejson(d));
}

/** Campos del primer índice único "simple" (sin partial/sparse, ±1) o _id si todos los documentos lo traen. */
function suggestKeys(steps) {
  for (const s of steps) {
    if (s.kind !== 'index' || !s.options.unique || s.options.partialFilterExpression || s.options.sparse) continue;
    if (!Object.values(s.key).every((v) => v === 1 || v === -1)) continue;
    try {
      return validateKeyFields(Object.keys(s.key));
    } catch {
      // campos no válidos como clave: se prueba el siguiente
    }
  }
  const docs = steps.filter((s) => s.kind === 'insert').flatMap((s) => s.documents);
  return docs.length && docs.every((d) => d._id !== undefined) ? ['_id'] : [];
}

/**
 * Interpreta el código. mode 'create' (nueva colección) o 'alter' (colección existente).
 * Devuelve { collection, options, steps, warnings, plan, suggestedKeys, documentCount }.
 * steps: { kind: 'index', key, options } | { kind: 'dropIndex', target } | { kind: 'insert', documents }
 */
export function parseMongoScript(text, { mode = 'create' } = {}) {
  const src = String(text ?? '');
  if (!src.trim()) throw new HttpError(400, 'Escribe o sube el código de MongoDB');
  if (src.length > 20 * 1024 * 1024) throw new HttpError(413, 'El código excede 20 MB');
  const parser = new Parser(tokenize(src));
  const warnings = [];
  const statements = [];
  while (parser.peek()) {
    const st = parser.statement(warnings);
    if (st) statements.push(st);
  }
  if (!statements.length) throw new HttpError(400, 'El código no contiene instrucciones db.…');

  const names = [...new Set(statements.map((s) => s.collection))];
  if (names.length > 1) {
    throw new HttpError(400, `El código usa varias colecciones (${names.join(', ')}): crea una colección a la vez`);
  }

  let options = {};
  const steps = [];
  let documentCount = 0;
  for (const { line, method, args } of statements) {
    switch (method) {
      case 'createCollection':
        if (mode === 'alter') warnings.push(`Línea ${line}: la colección ya existe, se ignoró createCollection`);
        else options = checkCollectionOptions(line, args[1]);
        break;
      case 'createIndex':
        steps.push({ kind: 'index', ...checkIndex(line, args[0], args[1]) });
        break;
      case 'createIndexes': {
        if (!Array.isArray(args[0])) fail(line, 'createIndexes espera un arreglo de índices');
        const common = args[1] ?? {};
        for (const key of args[0]) steps.push({ kind: 'index', ...checkIndex(line, key, common) });
        break;
      }
      case 'dropIndex':
        if (mode !== 'alter') fail(line, 'dropIndex solo se puede usar en una colección que ya existe (pestaña Estructura)');
        if (typeof args[0] !== 'string' && !isObject(args[0])) fail(line, 'dropIndex espera el nombre del índice o sus campos');
        if (RESERVED_INDEXES.has(args[0])) fail(line, `el índice "${args[0]}" lo administra el Data Hub`);
        steps.push({ kind: 'dropIndex', target: args[0] });
        break;
      case 'insertOne':
        steps.push({ kind: 'insert', documents: checkDocuments(line, [args[0]]) });
        documentCount += 1;
        break;
      case 'insertMany':
        if (!Array.isArray(args[0])) fail(line, 'insertMany espera un arreglo de documentos');
        steps.push({ kind: 'insert', documents: checkDocuments(line, args[0]) });
        documentCount += args[0].length;
        break;
      default:
        fail(line, `método no soportado: ${method}() (se admiten createCollection, createIndex, createIndexes, dropIndex, insertOne, insertMany)`);
    }
  }
  if (steps.filter((s) => s.kind === 'index').length > MAX_INDEXES) throw new HttpError(400, `Máximo ${MAX_INDEXES} índices`);
  if (documentCount > MAX_DOCS) throw new HttpError(413, `Máximo ${MAX_DOCS} documentos en el código`);

  const plan = [];
  if (mode === 'create') {
    const opts = Object.keys(options);
    plan.push(`Crear la colección${opts.length ? ` con ${opts.join(', ')}` : ''}`);
  }
  for (const s of steps) {
    if (s.kind === 'index') plan.push(describeIndex(s));
    else if (s.kind === 'dropIndex') plan.push(`Eliminar índice ${typeof s.target === 'string' ? `"${s.target}"` : `{ ${describeKey(s.target)} }`}`);
    else plan.push(`Insertar ${s.documents.length} documento(s)`);
  }

  return { collection: names[0], options, steps, warnings, plan, suggestedKeys: suggestKeys(steps), documentCount };
}
