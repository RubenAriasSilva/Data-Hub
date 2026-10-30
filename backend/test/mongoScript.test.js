import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, Long, Decimal128 } from 'bson';
import { parseMongoScript, tokenize } from '../src/services/mongoScriptService.js';

const USERS = `db.createCollection("users");
db.users.createIndex({ name: 1 }, { unique: true, collation: { locale: "es", strength: 1 } });
db.users.createIndex({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });`;

test('ejemplo con createCollection y dos índices', () => {
  const r = parseMongoScript(USERS);
  assert.equal(r.collection, 'users');
  assert.equal(r.steps.length, 2);
  assert.deepEqual(r.steps[0], { kind: 'index', key: { name: 1 }, options: { unique: true, collation: { locale: 'es', strength: 1 } } });
  assert.deepEqual(r.steps[1].options.partialFilterExpression, { email: { $type: 'string' } });
  assert.deepEqual(r.suggestedKeys, ['name']);
  assert.equal(r.plan.length, 3);
  assert.match(r.plan[1], /único · collation es\/1/);
});

test('índice multilínea con comentarios y coma final', () => {
  const r = parseMongoScript(`// Opción A: que el índice ignore mayúsculas
db.users.createIndex(
  { email: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 }, /* respeta acentos */
    partialFilterExpression: { email: { $type: "string" } },
  }
)`);
  assert.equal(r.collection, 'users');
  assert.deepEqual(r.steps[0].options.collation, { locale: 'en', strength: 2 });
  // índice parcial: no se sugiere como clave
  assert.deepEqual(r.suggestedKeys, []);
});

test('insertMany con EJSON y constructores de mongosh', () => {
  const r = parseMongoScript(`use datos
db.getCollection('users').insertMany([
  { "_id": { "$oid": "650000000000000000000001" }, name: 'Juan', createdAt: { "$date": "2026-10-01T00:00:00Z" }, coachAreas: [] },
  { _id: ObjectId("650000000000000000000002"), name: "Ana", createdAt: ISODate("2026-10-01"), n: NumberLong("9007199254740993"),
    d: NumberDecimal("1.10"), i: NumberInt(5), f: new Date(0), neg: -1.5e2, x: null, ok: true },
]);`);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.documentCount, 2);
  const [a, b] = r.steps[0].documents;
  assert.ok(a._id instanceof ObjectId);
  assert.ok(a.createdAt instanceof Date);
  assert.equal(b._id.toHexString(), '650000000000000000000002');
  assert.equal(b.createdAt.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.ok(b.n instanceof Long);
  assert.ok(b.d instanceof Decimal128);
  assert.equal(b.i, 5);
  assert.equal(b.f.getTime(), 0);
  assert.equal(b.neg, -150);
  assert.deepEqual(r.suggestedKeys, ['_id']);
});

test('opciones de colección y createIndexes', () => {
  const r = parseMongoScript(`db.createCollection("users", { validator: { $jsonSchema: { bsonType: "object", properties: { role: { enum: ["admin", "user"] } } } } })
db.users.createIndexes([{ a: 1 }, { b: -1, c: "text" }], { sparse: true })`);
  assert.ok(r.options.validator.$jsonSchema);
  assert.equal(r.steps.length, 2);
  assert.equal(r.steps[1].options.sparse, true);
  assert.match(r.plan[0], /validator/);
});

test('errores claros', () => {
  assert.throws(() => parseMongoScript(''), /Escribe/);
  assert.throws(() => parseMongoScript('db.a.createIndex({x:1}); db.b.createIndex({y:1})'), /varias colecciones \(a, b\)/);
  assert.throws(() => parseMongoScript('db.a.drop()'), /método no soportado: drop/);
  assert.throws(() => parseMongoScript('db.a.createIndex({x:1}, { partialFilterExpression: { $where: "1" } })'), /\$where/);
  assert.throws(() => parseMongoScript('db.a.createIndex({x:1}, { background: true })'), /no soportada: background/);
  assert.throws(() => parseMongoScript('db.a.createIndex({x:"abc"})'), /tipo de índice inválido/);
  assert.throws(() => parseMongoScript('db.a.createIndex({x:1}, { name: "uk_upsert" })'), /reservado/);
  assert.throws(() => parseMongoScript('db.a.dropIndex("x_1")'), /colección que ya existe/);
  assert.throws(() => parseMongoScript('print("hola")'), /no soportada "print"/);
  assert.throws(() => parseMongoScript('const x = 1'), /carácter inesperado "="/);
  assert.throws(() => parseMongoScript('db.a.insertOne({ v: miVariable })'), /no es un valor/);
  assert.throws(() => parseMongoScript('db.a.insertOne({ v: eval("1") })'), /función no soportada: eval/);
  assert.throws(() => parseMongoScript('db.a.insertOne({ v: ObjectId("123") })'), /ObjectId inválido/);
  assert.throws(() => parseMongoScript('db.a.createIndex({x:1}).hidden()'), /encadenadas/);
  assert.throws(() => parseMongoScript('\n\ndb.a.createIndex({ x: 1 '), /Línea 3/);
  assert.throws(() => tokenize('"abc'), /texto sin cerrar/);
});

test('modo alter: dropIndex y createCollection ignorado', () => {
  const r = parseMongoScript('db.createCollection("x"); db.x.dropIndex("email_1"); db.x.dropIndex({ name: 1 }); db.x.insertOne({ a: 1 })', { mode: 'alter' });
  assert.equal(r.steps.length, 3);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.plan, ['Eliminar índice "email_1"', 'Eliminar índice { name: 1 }', 'Insertar 1 documento(s)']);
  assert.throws(() => parseMongoScript('db.x.dropIndex("_id_")', { mode: 'alter' }), /administra/);
});
