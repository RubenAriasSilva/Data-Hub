import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { slugify, isValidIdentifier, normalizeHeader } from '../src/utils/identifiers.js';
import { convertValue, parseNumber, ConversionError } from '../src/utils/types.js';
import { parseSheet, mapRows, detectColumns } from '../src/services/excelService.js';
import { validateColumns, buildCreateTableSql, planColumnConversion } from '../src/services/schemaService.js';
import { parseCreateTable, parseAlterTable, planAlter, toCreateSql } from '../src/services/sqlService.js';

test('slugify convierte nombres de Excel a identificadores válidos', () => {
  assert.equal(slugify('Número de Orden'), 'numero_de_orden');
  assert.equal(slugify('  Fecha/Hora (UTC) '), 'fecha_hora_utc');
  assert.equal(slugify('2024 Ventas'), 'c_2024_ventas');
  assert.equal(slugify('Año'), 'ano');
  assert.ok(isValidIdentifier(slugify('¿Qué pasó?')));
  assert.equal(isValidIdentifier('_id'), false);
  assert.equal(normalizeHeader('  Número   de ORDEN '), 'numero de orden');
});

test('parseNumber maneja separadores', () => {
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('1,5'), 1.5);
  assert.equal(parseNumber('$ 1 200'), 1200);
  assert.ok(Number.isNaN(parseNumber('abc')));
});

test('convertValue por tipo', () => {
  assert.equal(convertValue('', 'text'), null);
  assert.equal(convertValue(123, 'text'), '123');
  assert.equal(convertValue('42', 'int'), 42);
  assert.throws(() => convertValue('4.5', 'int'), ConversionError);
  assert.equal(convertValue('10,25', 'decimal'), 10.25);
  assert.equal(convertValue(45292, 'date'), '2024-01-01');
  assert.equal(convertValue(45292.5, 'datetime'), '2024-01-01 12:00:00');
  assert.equal(convertValue('31/01/2024', 'date'), '2024-01-31');
  assert.equal(convertValue('2024-01-31T08:15:00Z', 'datetime'), '2024-01-31 08:15:00');
  assert.equal(convertValue('31/01/2024 1:05 pm', 'datetime'), '2024-01-31 13:05:00');
  assert.throws(() => convertValue('31/02/2024', 'date'), ConversionError);
  assert.equal(convertValue('Sí', 'boolean'), 1);
  assert.equal(convertValue('no', 'boolean'), 0);
  assert.throws(() => convertValue('quizá', 'boolean'), ConversionError);
  assert.throws(() => convertValue('x'.repeat(256), 'text'), ConversionError);
});

function workbookBuffer(aoa, bookType = 'xlsx') {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return XLSX.write(wb, { type: 'buffer', bookType });
}

const COLUMNS = [
  { excel_name: 'Número de Orden', db_name: 'numero_orden', data_type: 'text', is_key: true, nullable: false },
  { excel_name: 'Fecha', db_name: 'fecha', data_type: 'date', is_key: false, nullable: true },
  { excel_name: 'Monto ($)', db_name: 'monto', data_type: 'decimal', is_key: false, nullable: true },
  { excel_name: 'Procesado', db_name: 'procesado', data_type: 'boolean', is_key: false, nullable: true },
];

for (const bookType of ['xlsx', 'biff8']) {
  test(`parseSheet + mapRows (${bookType === 'biff8' ? 'xls' : 'xlsx'})`, () => {
    const buf = workbookBuffer([
      ['numero de orden', 'Fecha', 'Monto ($)', 'Procesado', 'Extra'],
      [1001, new Date(2024, 4, 15), 1500.5, 'sí', 'x'],
      ['A-2', '20/05/2024', '2,300.75', 0, null],
      [null, null, null, null, null],
      ['A-3', 'no es fecha', 10, 1, null],
      [null, '2024-01-01', 5, 1, null],
    ], bookType);
    const parsed = parseSheet(buf);
    const { records, errors, warnings, totalRows } = mapRows(parsed, COLUMNS);
    assert.equal(totalRows, 4);
    assert.deepEqual(records, [
      { numero_orden: '1001', fecha: '2024-05-15', monto: 1500.5, procesado: 1 },
      { numero_orden: 'A-2', fecha: '2024-05-20', monto: 2300.75, procesado: 0 },
    ]);
    assert.equal(errors.length, 2);
    assert.equal(errors[0].row, 5);
    assert.equal(errors[1].message, 'La columna clave no puede estar vacía');
    assert.ok(warnings.some((w) => w.includes('Extra')));
  });
}

test('mapRows exige columnas clave', () => {
  const buf = workbookBuffer([['Fecha'], ['2024-01-01']]);
  assert.throws(() => mapRows(parseSheet(buf), COLUMNS), /Número de Orden/);
});

test('detectColumns sugiere tipos y clave', () => {
  const buf = workbookBuffer([
    ['ID Bot', 'Inicio', 'Duración (s)', 'Exitoso', 'Comentario'],
    [1, new Date(2024, 0, 1, 8, 30), 12.5, true, 'ok'],
    [2, new Date(2024, 0, 2, 9, 0), 7, false, 'falló'],
  ]);
  const { columns } = detectColumns(buf);
  assert.deepEqual(columns.map((c) => [c.db_name, c.data_type]), [
    ['id_bot', 'int'], ['inicio', 'datetime'], ['duracion_s', 'decimal'], ['exitoso', 'boolean'], ['comentario', 'text'],
  ]);
  assert.equal(columns[0].is_key, true);
});

test('validateColumns y SQL de creación', () => {
  assert.throws(() => validateColumns([{ excel_name: 'A', db_name: 'a', data_type: 'text' }]), /clave/);
  assert.throws(() => validateColumns([{ excel_name: 'A', db_name: 'A b', data_type: 'text', is_key: true }]), /BD/);
  const cols = validateColumns(COLUMNS);
  const sql = buildCreateTableSql('dh_rpas_transacciones', cols);
  assert.match(sql, /`numero_orden` VARCHAR\(255\) NOT NULL/);
  assert.match(sql, /UNIQUE KEY `uk_upsert` \(`numero_orden`\)/);
});

test('planColumnConversion convierte valores existentes y reporta los incompatibles', () => {
  const rows = [{ _id: 1, value: '2026-09-07' }, { _id: 2, value: '07/09/2026' }, { _id: 3, value: 'mañana' }];
  const { changes, errors } = planColumnConversion(rows, 'date', true, true);
  assert.deepEqual(changes, [{ id: 2, from: '07/09/2026', to: '2026-09-07' }]);
  assert.deepEqual(errors.map((e) => e.id), [3]);

  const toText = planColumnConversion([{ _id: 1, value: 1500 }, { _id: 2, value: 0.5 }], 'text', false);
  assert.deepEqual(toText.changes.map((c) => c.to), ['1500', '0.5']);
  assert.equal(toText.errors.length, 0);

  const required = planColumnConversion([{ _id: 1, value: '  ' }], 'text', false);
  assert.equal(required.errors[0].message, 'Valor vacío en una columna obligatoria');
});

test('parseCreateTable traduce tipos, claves y nombres de Excel', () => {
  const r = parseCreateTable(`
    -- tabla de órdenes
    CREATE TABLE IF NOT EXISTS \`Ordenes\` (
      Orden BIGINT NOT NULL COMMENT 'Orden',
      autor VARCHAR(255) COMMENT 'Autor de la orden',
      inicio DATE,
      monto DECIMAL(18,4) DEFAULT 0,
      cerrada TINYINT(1),
      notas TEXT,
      PRIMARY KEY (orden)
    ) ENGINE=InnoDB;`);
  assert.equal(r.slug, 'ordenes');
  assert.deepEqual(r.columns.map((c) => c.data_type), ['int', 'text', 'date', 'decimal', 'boolean', 'longtext']);
  assert.deepEqual(r.columns[0], { excel_name: 'Orden', db_name: 'orden', data_type: 'int', is_key: true, nullable: false });
  assert.equal(r.columns[1].excel_name, 'Autor de la orden');
  assert.equal(r.columns[2].excel_name, 'inicio');
  assert.ok(r.warnings.some((w) => /DEFAULT/.test(w)));
  validateColumns(r.columns);

  assert.equal(parseCreateTable('CREATE TABLE t (a INT UNIQUE, b VARCHAR(10))').columns[0].is_key, true);
  assert.throws(() => parseCreateTable('CREATE TABLE t (\n  a GEOMETRY\n)'), /Línea 2: Tipo no soportado/);
  assert.throws(() => parseCreateTable('CREATE TABLE t (a INT, PRIMARY KEY (b))'), /no está definida/);
  assert.throws(() => parseCreateTable('CREATE TABLE t (_id INT)'), /sistema/);
  assert.throws(() => parseCreateTable('DROP TABLE t'), /CREATE/);
});

test('parseAlterTable reconoce cada cláusula y varias sentencias', () => {
  const { tables, ops } = parseAlterTable(`
    ALTER TABLE ordenes ADD COLUMN moneda VARCHAR(255) COMMENT 'Moneda', MODIFY COLUMN autor TEXT;
    ALTER TABLE ordenes CHANGE inicio inicio_programado DATETIME, RENAME COLUMN monto TO total, DROP COLUMN notas;`);
  assert.deepEqual(tables.map((t) => t.name), ['ordenes', 'ordenes']);
  assert.deepEqual(ops.map((o) => o.op), ['add', 'modify', 'change', 'rename', 'drop']);
  assert.equal(ops[2].name, 'inicio');
  assert.equal(ops[2].column.db_name, 'inicio_programado');
  assert.equal(ops[3].to, 'total');
  assert.throws(() => parseAlterTable('ALTER TABLE t ADD INDEX i (a)'), /índices/);
  assert.throws(() => parseAlterTable('ALTER TABLE t RENAME TO x'), /no soportada/);
});

test('planAlter valida en orden sobre la tabla y rechaza cambios inválidos', () => {
  const meta = {
    table: { slug: 'ordenes', db_table: 'dh_rpas_ordenes' },
    columns: [
      { id: 1, excel_name: 'Orden', db_name: 'orden', data_type: 'int', is_key: true, nullable: false, position: 0 },
      { id: 2, excel_name: 'Autor', db_name: 'autor', data_type: 'text', is_key: false, nullable: true, position: 1 },
    ],
  };
  const { steps } = planAlter(meta, `ALTER TABLE dh_rpas_ordenes
    ADD moneda VARCHAR(255) COMMENT 'Moneda', MODIFY autor TEXT COMMENT 'Autor', RENAME COLUMN moneda TO divisa, DROP autor`);
  assert.deepEqual(steps.map((s) => s.kind), ['add', 'update', 'update', 'drop']);
  assert.equal(steps[1].changes.data_type, 'longtext');
  assert.equal(steps[2].column, 'moneda'); // renombra la columna agregada en el mismo SQL
  assert.equal(steps[3].column, 'autor');

  assert.throws(() => planAlter(meta, 'ALTER TABLE otra DROP autor'), /esta tabla es "ordenes"/);
  assert.throws(() => planAlter(meta, 'ALTER TABLE ordenes DROP orden'), /clave/);
  assert.throws(() => planAlter(meta, 'ALTER TABLE ordenes ADD x INT NOT NULL'), /opcionales/);
  assert.throws(() => planAlter(meta, 'ALTER TABLE ordenes ADD autor INT'), /ya existe/);
  assert.throws(() => planAlter(meta, 'ALTER TABLE ordenes MODIFY nada INT'), /no existe/);
  assert.throws(() => planAlter(meta, 'ALTER TABLE ordenes MODIFY orden TEXT'), /Texto largo/);
});

test('toCreateSql genera SQL que el propio intérprete entiende', () => {
  const columns = validateColumns(COLUMNS);
  const back = parseCreateTable(toCreateSql('transacciones', columns));
  assert.deepEqual(back.columns, columns.map(({ excel_name, db_name, data_type, is_key, nullable }) => ({
    excel_name, db_name, data_type, is_key, nullable,
  })));
});
