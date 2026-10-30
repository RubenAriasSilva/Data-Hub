// Colecciones MongoDB del Data Hub: documentos libres con campos clave opcionales para el upsert.
import { EJSON, ObjectId } from 'bson';
import { getMongoDb } from '../config/mongo.js';
import { HttpError } from '../utils/httpError.js';

const BATCH_SIZE = 500;
export const MAX_KEY_FIELDS = 5;
export const SYSTEM_FIELDS = ['_id', '_created_at', '_updated_at'];
const KEY_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
// Operadores que ejecutan JavaScript en el servidor
const FORBIDDEN_OPERATORS = new Set(['$where', '$function', '$accumulator']);
const UNIQUE_INDEX = 'uk_upsert';
// Índices que administra el Data Hub (no se eliminan desde la pestaña Estructura)
const SYSTEM_INDEXES = new Set(['_id_', UNIQUE_INDEX, 'idx_updated_at']);
// Campos de collation válidos en una operación (el índice devuelve además "version")
const COLLATION_FIELDS = ['locale', 'caseLevel', 'caseFirst', 'strength', 'numericOrdering', 'alternate', 'maxVariable', 'normalization', 'backwards'];

const collection = (meta) => getMongoDb().collection(meta.table.db_table);

/** Valida la lista de campos clave (rutas con punto). Devuelve el arreglo normalizado. */
export function validateKeyFields(raw) {
  const list = raw === null || raw === undefined || raw === '' ? [] : raw;
  if (!Array.isArray(list)) throw new HttpError(400, 'key_fields debe ser un arreglo de rutas');
  const keys = [...new Set(list.map((k) => String(k ?? '').trim()).filter(Boolean))];
  if (keys.length > MAX_KEY_FIELDS) throw new HttpError(400, `Máximo ${MAX_KEY_FIELDS} campos clave`);
  for (const k of keys) {
    if (k.length > 200 || !KEY_FIELD_RE.test(k)) {
      throw new HttpError(400, `Campo clave inválido: "${k}". Usa letras, números y _ separados por punto (ej. cliente.id)`);
    }
    if (SYSTEM_FIELDS.includes(k.split('.')[0]) && k !== '_id') {
      throw new HttpError(400, `"${k}" es un campo del sistema`);
    }
  }
  if (keys.includes('_id') && keys.length > 1) throw new HttpError(400, '_id no se puede combinar con otros campos clave');
  return keys;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** { "cliente.nombre": "A" } -> { cliente: { nombre: "A" } } */
export function unflatten(flat) {
  const out = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let node = out;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node[part] = value;
      else {
        if (!isPlainObject(node[part])) node[part] = {};
        node = node[part];
      }
    });
  }
  return out;
}

/** Objeto anidado -> { "a.b": valor }. Arreglos y tipos BSON se dejan como hoja. */
export function flatten(doc, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(doc ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

/** Valor de una ruta "a.b.c" dentro del documento. */
export function getPath(doc, path) {
  return path.split('.').reduce((node, part) => (node === null || node === undefined ? undefined : node[part]), doc);
}

export function assertSafeQuery(value, where) {
  if (Array.isArray(value)) value.forEach((v) => assertSafeQuery(v, where));
  else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_OPERATORS.has(k)) throw new HttpError(400, `${where}: el operador ${k} no está permitido`);
      assertSafeQuery(v, where);
    }
  }
}

/** Filtro de MongoDB como texto EJSON u objeto. Rechaza operadores que ejecutan JavaScript. */
export function parseFilter(raw, where = 'Filtro') {
  if (raw === undefined || raw === null || raw === '') return {};
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = EJSON.parse(raw, { relaxed: true });
    } catch (err) {
      throw new HttpError(400, `${where}: JSON inválido (${err.message})`);
    }
  } else value = EJSON.deserialize(raw, { relaxed: true });
  if (!isPlainObject(value)) throw new HttpError(400, `${where}: debe ser un objeto JSON, p. ej. {"estado": "ok"}`);
  assertSafeQuery(value, where);
  return value;
}

/** El _id de la URL: ObjectId si tiene su forma, si no número o texto. */
export function parseDocId(raw) {
  const s = String(raw);
  if (/^[0-9a-f]{24}$/i.test(s)) return new ObjectId(s);
  if (/^-?\d{1,15}$/.test(s)) return { $in: [Number(s), s] };
  return s;
}

/** Documento para la respuesta JSON: tipos BSON en EJSON relajado ({"$oid": …}, fechas ISO). */
export const toJson = (doc) => EJSON.serialize(doc, { relaxed: true });

// ── Colecciones ─────────────────────────────────────────────────────────────

const sameFields = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Índice único existente con exactamente los campos clave (ascendente o descendente), o null. */
export async function findKeyIndex(coll, keys) {
  if (!keys.length || keys[0] === '_id') return null;
  const indexes = await coll.listIndexes().toArray();
  return indexes.find((ix) => ix.unique && sameFields(Object.keys(ix.key), keys)
    && Object.values(ix.key).every((v) => v === 1 || v === -1)) ?? null;
}

/** Crea uk_upsert salvo que ya exista un índice único sobre las claves (p. ej. uno creado con código y collation). */
async function ensureKeyIndex(coll, keys) {
  if (!keys.length || keys[0] === '_id' || await findKeyIndex(coll, keys)) return;
  await coll.createIndex(Object.fromEntries(keys.map((k) => [k, 1])), { name: UNIQUE_INDEX, unique: true });
}

const keyDescription = (key) => Object.entries(key).map(([k, v]) => `${k}: ${v}`).join(', ');

/** Crea los índices en orden; el error indica cuál falló. */
export async function applyIndexes(coll, indexes) {
  for (const [i, { key, options }] of indexes.entries()) {
    try {
      await coll.createIndex(key, options);
    } catch (err) {
      const reason = err.code === 11000 ? 'hay documentos repetidos para este índice único' : err.message;
      throw new HttpError(400, `Índice ${i + 1} ({ ${keyDescription(key)} }): ${reason}`);
    }
  }
}

/**
 * Crea la colección con sus opciones e índices (código mongosh) más los del Data Hub.
 * Si algo falla, la colección se elimina para no dejarla a medias.
 */
export async function createCollection(name, keys, { options = {}, indexes = [] } = {}) {
  const db = getMongoDb();
  if (await db.listCollections({ name }, { nameOnly: true }).hasNext()) {
    throw new HttpError(409, `La colección ${name} ya existe en MongoDB`);
  }
  let coll;
  try {
    coll = await db.createCollection(name, options);
  } catch (err) {
    throw new HttpError(400, `MongoDB rechazó la colección: ${err.message}`);
  }
  try {
    await applyIndexes(coll, indexes);
    await ensureKeyIndex(coll, keys);
    await coll.createIndex({ _updated_at: 1 }, { name: 'idx_updated_at' });
  } catch (err) {
    await coll.drop().catch(() => {});
    throw err;
  }
}

/** Índices de la colección, marcando los del sistema y el que respalda los campos clave. */
export async function listIndexes(meta) {
  const coll = collection(meta);
  const [indexes, keyIndex] = await Promise.all([coll.listIndexes().toArray(), findKeyIndex(coll, meta.keyFields)]);
  return indexes.map((ix) => ({
    ...toJson(ix),
    system: SYSTEM_INDEXES.has(ix.name),
    key_index: ix.name === keyIndex?.name,
  }));
}

/** Elimina un índice por nombre o por sus campos; no permite los del sistema ni el de las claves. */
export async function dropIndex(meta, target) {
  const coll = collection(meta);
  const indexes = await coll.listIndexes().toArray();
  const ix = typeof target === 'string'
    ? indexes.find((i) => i.name === target)
    : indexes.find((i) => JSON.stringify(i.key) === JSON.stringify(target));
  const label = typeof target === 'string' ? `"${target}"` : `{ ${keyDescription(target)} }`;
  if (!ix) throw new HttpError(404, `No existe el índice ${label}`);
  if (SYSTEM_INDEXES.has(ix.name)) throw new HttpError(400, `El índice "${ix.name}" lo administra el Data Hub`);
  if (ix.name === (await findKeyIndex(coll, meta.keyFields))?.name) {
    throw new HttpError(400, `El índice "${ix.name}" respalda los campos clave (${meta.keyFields.join(', ')}): cambia las claves antes de eliminarlo`);
  }
  await coll.dropIndex(ix.name);
  return ix.name;
}

export async function dropCollection(name) {
  await getMongoDb().collection(name).drop().catch((err) => {
    if (err.codeName !== 'NamespaceNotFound') throw err;
  });
}

export async function clearCollection(meta) {
  await collection(meta).deleteMany({});
}

export async function countDocuments(name) {
  try {
    return await getMongoDb().collection(name).estimatedDocumentCount();
  } catch {
    return null;
  }
}

/** Cambia los campos clave reconstruyendo el índice único. */
export async function setKeyFields(meta, keys) {
  const coll = collection(meta);
  await coll.dropIndex(UNIQUE_INDEX).catch(() => {});
  try {
    await ensureKeyIndex(coll, keys);
  } catch (err) {
    await ensureKeyIndex(coll, meta.keyFields).catch(() => {});
    if (err.code === 11000) {
      throw new HttpError(409, `Hay documentos repetidos para la clave (${keys.join(', ')}): corrígelos antes de cambiarla`);
    }
    throw err;
  }
}

// ── Escritura ───────────────────────────────────────────────────────────────

/**
 * Upsert por lotes. Con campos clave: actualiza el documento que coincide ($set, conserva
 * los campos no enviados) o lo inserta. Sin campos clave: inserta siempre.
 */
export async function upsertDocuments(meta, docs) {
  if (!docs.length) return { inserted: 0, updated: 0 };
  const keys = meta.keyFields;
  const now = new Date();
  const ops = docs.map((doc) => {
    const data = { ...doc };
    if (!keys.length || (keys[0] === '_id' && data._id === undefined)) {
      return { insertOne: { document: { ...data, _created_at: now, _updated_at: now } } };
    }
    const filter = Object.fromEntries(keys.map((k) => [k, getPath(doc, k)]));
    // El _id enviado (p. ej. de un .bson de mongodump) se usa solo al insertar: el de un documento existente no cambia
    const onInsert = { _created_at: now };
    if (data._id !== undefined && keys[0] !== '_id') onInsert._id = data._id;
    delete data._id;
    delete data._created_at;
    return {
      updateOne: {
        filter,
        update: { $set: { ...flattenForSet(data, keys), _updated_at: now }, $setOnInsert: onInsert },
        upsert: true,
      },
    };
  });

  let inserted = 0;
  let updated = 0;
  const coll = collection(meta);
  // Si el índice de las claves tiene collation (p. ej. sin distinguir mayúsculas), el upsert compara igual que él
  const keyIndex = await findKeyIndex(coll, keys);
  if (keyIndex?.collation) {
    const collation = Object.fromEntries(COLLATION_FIELDS.filter((f) => f in keyIndex.collation).map((f) => [f, keyIndex.collation[f]]));
    for (const op of ops) if (op.updateOne) op.updateOne.collation = collation;
  }
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    // ordered: un error detiene la carga en ese documento (como la transacción de MySQL, aunque sin revertir lotes previos)
    const res = await coll.bulkWrite(ops.slice(i, i + BATCH_SIZE), { ordered: true });
    inserted += res.insertedCount + res.upsertedCount;
    updated += res.matchedCount;
  }
  return { inserted, updated };
}

/**
 * $set con los campos de primer nivel, salvo los objetos que contienen una clave
 * (cliente.id): esos se aplanan para no chocar con el filtro del upsert.
 */
function flattenForSet(data, keys) {
  const roots = new Set(keys.filter((k) => k.includes('.')).map((k) => k.split('.')[0]));
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (roots.has(k) && isPlainObject(v)) Object.assign(out, flatten(v, k));
    else out[k] = v;
  }
  return out;
}

export async function getDocument(meta, id) {
  const doc = await collection(meta).findOne({ _id: parseDocId(id) });
  if (!doc) throw new HttpError(404, 'Documento no encontrado');
  return doc;
}

/** Reemplaza el documento completo (conserva _id y _created_at). */
export async function replaceDocument(meta, id, body) {
  const current = await getDocument(meta, id);
  const data = parseFilter(body, 'Documento');
  delete data._id;
  delete data._created_at;
  delete data._updated_at;
  assertNoOperators(data);
  for (const k of meta.keyFields) {
    if (k !== '_id' && emptyValue(getPath(data, k))) throw new HttpError(400, `Falta el campo clave "${k}"`);
  }
  try {
    await collection(meta).replaceOne(
      { _id: current._id },
      { ...data, _created_at: current._created_at ?? new Date(), _updated_at: new Date() },
    );
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'Ya existe otro documento con esa clave');
    throw err;
  }
  return getDocument(meta, String(current._id));
}

export async function deleteDocument(meta, id) {
  const res = await collection(meta).deleteOne({ _id: parseDocId(id) });
  return res.deletedCount;
}

export const emptyValue = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Los nombres de campo no pueden empezar con $ (Mongo los toma como operadores). */
export function assertNoOperators(doc, path = '') {
  if (Array.isArray(doc)) return doc.forEach((v, i) => assertNoOperators(v, `${path}[${i}]`));
  if (!isPlainObject(doc)) return undefined;
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('$')) throw new HttpError(400, `Campo no permitido "${path ? `${path}.` : ''}${k}": no puede empezar con $`);
    assertNoOperators(v, path ? `${path}.${k}` : k);
  }
  return undefined;
}

// ── Lectura ─────────────────────────────────────────────────────────────────

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function projection(fields) {
  const list = (Array.isArray(fields) ? fields : String(fields ?? '').split(','))
    .map((f) => f.trim()).filter(Boolean);
  if (!list.length) return undefined;
  for (const f of list) if (!KEY_FIELD_RE.test(f)) throw new HttpError(400, `Campo inválido en fields: ${f}`);
  return Object.fromEntries(list.map((f) => [f, 1]));
}

/**
 * Consulta paginada.
 * opts: { page, limit, sort, order, q, filter, fields, updatedSince, maxLimit }
 */
export async function queryDocuments(meta, opts = {}) {
  const filter = parseFilter(opts.filter);
  const and = [filter];
  if (opts.q) {
    // Búsqueda de texto en los campos de texto detectados en una muestra
    const fields = (await inferFields(meta, 100)).filter((f) => f.types.includes('string')).map((f) => f.path);
    const re = new RegExp(escapeRegex(String(opts.q)), 'i');
    and.push(fields.length ? { $or: fields.map((f) => ({ [f]: re })) } : { _id: null });
  }
  if (opts.updatedSince) {
    const since = new Date(opts.updatedSince);
    if (Number.isNaN(since.getTime())) throw new HttpError(400, 'updated_since: fecha inválida');
    and.push({ _updated_at: { $gte: since } });
  }
  const where = and.length === 1 ? and[0] : { $and: and };

  const maxLimit = opts.maxLimit ?? 1000;
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), maxLimit);
  const page = Math.max(parseInt(opts.page, 10) || 1, 1);
  const sortField = opts.sort && KEY_FIELD_RE.test(String(opts.sort)) ? String(opts.sort) : '_id';
  const order = String(opts.order).toLowerCase() === 'asc' ? 1 : -1;

  const coll = collection(meta);
  try {
    const [total, docs] = await Promise.all([
      coll.countDocuments(where),
      coll.find(where, { projection: projection(opts.fields) })
        .sort({ [sortField]: order, ...(sortField === '_id' ? {} : { _id: order }) })
        .skip((page - 1) * limit).limit(limit).toArray(),
    ]);
    return { documents: docs.map(toJson), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  } catch (err) {
    if (err.name === 'MongoServerError') throw new HttpError(400, `MongoDB rechazó la consulta: ${err.message}`);
    throw err;
  }
}

/** Consulta libre (POST .../query): { filter, projection, sort, skip, limit }. raw = sin pasar a EJSON. */
export async function findDocuments(meta, body = {}, maxLimit = 5000, raw = false) {
  const filter = parseFilter(body.filter ?? {});
  const proj = body.projection === undefined ? undefined : parseFilter(body.projection, 'projection');
  const sort = body.sort === undefined ? { _id: 1 } : parseFilter(body.sort, 'sort');
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 1000, 1), maxLimit);
  const skip = Math.max(parseInt(body.skip, 10) || 0, 0);
  const coll = collection(meta);
  try {
    const [total, docs] = await Promise.all([
      coll.countDocuments(filter),
      coll.find(filter, { projection: proj }).sort(sort).skip(skip).limit(limit).toArray(),
    ]);
    return { documents: raw ? docs : docs.map(toJson), total, skip, limit };
  } catch (err) {
    if (err.name === 'MongoServerError') throw new HttpError(400, `MongoDB rechazó la consulta: ${err.message}`);
    throw err;
  }
}

/** Todos los documentos (para exportar), con tope de seguridad. */
export async function allDocuments(meta, max = 200000) {
  return collection(meta).find({}).sort({ _id: 1 }).limit(max).toArray();
}

const bsonType = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  if (v?._bsontype) return v._bsontype === 'ObjectId' ? 'objectId' : v._bsontype.toLowerCase();
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'object') return 'object';
  return typeof v;
};

/** Campos de una muestra: [{ path, types, count, percent }], ordenados por ruta. */
export async function inferFields(meta, sample = 200) {
  return describeFields(await collection(meta).aggregate([{ $sample: { size: sample } }]).toArray());
}

/** Campos presentes en documentos ya leídos (también los de un archivo que aún no se guarda). */
export function describeFields(docs) {
  const fields = new Map();
  const visit = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (!fields.has(path)) fields.set(path, { path, types: new Set(), count: 0 });
      const f = fields.get(path);
      f.types.add(bsonType(v));
      f.count += 1;
      if (isPlainObject(v)) visit(v, path);
    }
  };
  docs.forEach((d) => visit(d, ''));
  return [...fields.values()]
    .map((f) => ({ ...f, types: [...f.types], percent: docs.length ? Math.round((f.count / docs.length) * 100) : 0 }))
    .sort((a, b) => (SYSTEM_FIELDS.indexOf(b.path) - SYSTEM_FIELDS.indexOf(a.path)) || a.path.localeCompare(b.path));
}

/** Valor para una celda CSV: fechas ISO, ObjectId como texto, objetos/arreglos como JSON. */
export function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v?._bsontype) return v._bsontype === 'ObjectId' ? v.toHexString() : String(v);
  if (typeof v === 'object') return EJSON.stringify(v, { relaxed: true });
  return v;
}
