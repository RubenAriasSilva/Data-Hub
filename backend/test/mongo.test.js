import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { BSON, ObjectId } from 'bson';
import {
  validateKeyFields, unflatten, flatten, parseFilter, parseDocId, getPath, cellValue,
} from '../src/services/mongoService.js';
import {
  documentsFromBody, parseNdjson, parseBson, documentsFromSheet, validateDocuments,
} from '../src/services/mongoImportService.js';
import { parseSheet } from '../src/services/excelService.js';

test('validateKeyFields acepta rutas y rechaza las inválidas', () => {
  assert.deepEqual(validateKeyFields(undefined), []);
  assert.deepEqual(validateKeyFields([' codigo ', 'cliente.id', 'codigo']), ['codigo', 'cliente.id']);
  assert.deepEqual(validateKeyFields(['_id']), ['_id']);
  assert.throws(() => validateKeyFields(['a b']), /inválido/);
  assert.throws(() => validateKeyFields(['$x']), /inválido/);
  assert.throws(() => validateKeyFields(['_updated_at']), /sistema/);
  assert.throws(() => validateKeyFields(['_id', 'codigo']), /_id/);
  assert.throws(() => validateKeyFields(['a', 'b', 'c', 'd', 'e', 'f']), /Máximo/);
  assert.throws(() => validateKeyFields('codigo'), /arreglo/);
});

test('unflatten / flatten / getPath', () => {
  const doc = unflatten({ codigo: 1, 'cliente.nombre': 'Ana', 'cliente.dir.ciudad': 'GDL' });
  assert.deepEqual(doc, { codigo: 1, cliente: { nombre: 'Ana', dir: { ciudad: 'GDL' } } });
  assert.equal(getPath(doc, 'cliente.dir.ciudad'), 'GDL');
  assert.equal(getPath(doc, 'cliente.x.y'), undefined);
  const date = new Date('2024-01-31T00:00:00Z');
  assert.deepEqual(flatten({ a: { b: 1, c: [1, 2] }, d: date, e: {} }), { 'a.b': 1, 'a.c': [1, 2], d: date, e: {} });
});

test('parseFilter interpreta EJSON y bloquea operadores con JavaScript', () => {
  assert.deepEqual(parseFilter(''), {});
  assert.deepEqual(parseFilter('{"estado":"ok","n":{"$gte":2}}'), { estado: 'ok', n: { $gte: 2 } });
  const f = parseFilter('{"_id":{"$oid":"65a1b2c3d4e5f6a7b8c9d0e1"},"f":{"$date":"2024-01-31T00:00:00Z"}}');
  assert.ok(f._id instanceof ObjectId);
  assert.ok(f.f instanceof Date);
  assert.throws(() => parseFilter('{"$where":"sleep(1000)"}'), /no está permitido/);
  assert.throws(() => parseFilter('{"$or":[{"$where":"1"}]}'), /no está permitido/);
  assert.throws(() => parseFilter('[1]'), /objeto/);
  assert.throws(() => parseFilter('{mal'), /JSON inválido/);
});

test('parseDocId y cellValue', () => {
  assert.ok(parseDocId('65a1b2c3d4e5f6a7b8c9d0e1') instanceof ObjectId);
  assert.deepEqual(parseDocId('42'), { $in: [42, '42'] });
  assert.equal(parseDocId('abc'), 'abc');
  assert.equal(cellValue(new Date('2024-01-31T00:00:00Z')), '2024-01-31T00:00:00.000Z');
  assert.equal(cellValue(new ObjectId('65a1b2c3d4e5f6a7b8c9d0e1')), '65a1b2c3d4e5f6a7b8c9d0e1');
  assert.equal(cellValue([1, 'a']), '[1,"a"]');
  assert.equal(cellValue(null), null);
});

test('documentsFromBody acepta arreglo, documents, rows u objeto', () => {
  assert.equal(documentsFromBody([{ a: 1 }, { a: 2 }]).length, 2);
  assert.equal(documentsFromBody({ documents: [{ a: 1 }] }).length, 1);
  assert.equal(documentsFromBody({ rows: [{ a: 1 }] }).length, 1);
  assert.deepEqual(documentsFromBody({ a: 1 }), [{ a: 1 }]);
  assert.throws(() => documentsFromBody('x'), /documento/);
});

test('parseNdjson y parseBson', () => {
  const docs = parseNdjson('{"a":1}\n\n{"a":{"$date":"2024-01-31T00:00:00Z"}}\r\n', 'x.ndjson');
  assert.equal(docs.length, 2);
  assert.ok(docs[1].a instanceof Date);
  assert.throws(() => parseNdjson('{"a":1}\n{mal}', 'x.ndjson'), /línea 2/);

  const id = new ObjectId();
  const buf = Buffer.concat([BSON.serialize({ _id: id, n: 1 }), BSON.serialize({ n: 2, sub: { x: true } })]);
  const parsed = parseBson(buf, 'x.bson');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]._id.toHexString(), id.toHexString());
  assert.deepEqual(parsed[1], { n: 2, sub: { x: true } });
  assert.throws(() => parseBson(buf.subarray(0, buf.length - 3), 'x.bson'), /BSON/);
});

test('Excel/CSV con encabezados anidados se convierten en documentos', () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['codigo', 'cliente.nombre', 'cliente.edad', 'activo', 'fecha'],
    [1, 'Ana', 30, true, new Date(2024, 0, 31)], // SheetJS escribe las fechas JS en hora local
    [2, 'Luis', null, false, null],
  ], { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const items = documentsFromSheet(parseSheet(buffer, null, 'datos.xlsx'));
  assert.equal(items.length, 2);
  assert.equal(items[0].rowNumber, 2);
  assert.deepEqual(items[0].doc.cliente, { nombre: 'Ana', edad: 30 });
  assert.equal(items[0].doc.activo, true);
  assert.ok(items[0].doc.fecha instanceof Date);
  assert.equal(items[0].doc.fecha.toISOString().slice(0, 10), '2024-01-31');
  assert.deepEqual(items[1].doc, { codigo: 2, cliente: { nombre: 'Luis' }, activo: false });

  const csv = Buffer.from('codigo;cliente.nombre;cp;monto;ok\n00123;Ana;45000;10.5;true\n', 'utf8');
  const [row] = documentsFromSheet(parseSheet(csv, null, 'datos.csv'));
  assert.deepEqual(row.doc, { codigo: '00123', cliente: { nombre: 'Ana' }, cp: 45000, monto: 10.5, ok: true });

  const dup = Buffer.from('a,a\n1,2\n', 'utf8');
  assert.throws(() => documentsFromSheet(parseSheet(dup, null, 'dup.csv')), /repetido/);
});

test('validateDocuments exige claves y rechaza campos con $', () => {
  const meta = { keyFields: ['codigo', 'cliente.id'] };
  const { records, errors } = validateDocuments(meta, [
    { rowNumber: 1, doc: { codigo: 1, cliente: { id: 5 } } },
    { rowNumber: 2, doc: { codigo: 2 } },
    { rowNumber: 3, doc: { codigo: 3, cliente: { id: 1 }, x: { $set: 1 } } },
    { rowNumber: 4, doc: [1] },
  ]);
  assert.equal(records.length, 1);
  assert.deepEqual(errors.map((e) => e.row), [2, 3, 4]);
  assert.equal(errors[0].column, 'cliente.id');
  assert.equal(validateDocuments({ keyFields: [] }, [{ rowNumber: 1, doc: { a: 1 } }]).records.length, 1);
});
