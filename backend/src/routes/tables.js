import { Router } from 'express';
import { getPool } from '../config/db.js';
import { getTableMetaById, listTablesWithStats, countRows } from '../services/metaService.js';
import {
  validateColumns, normalizeColumn, buildCreateTableSql, addColumnSql, dropTableSql, truncateTableSql, MAX_TEXT_KEYS,
} from '../services/schemaService.js';
import { alterColumn } from '../services/columnService.js';
import { detectColumns, buildWorkbook } from '../services/excelService.js';
import { importExcel, resultHttpStatus } from '../services/importService.js';
import { queryRows, allRows, deleteById, SYSTEM_COLUMNS } from '../services/dataService.js';
import { slugify, isValidIdentifier, normalizeHeader } from '../utils/identifiers.js';
import { excelUpload, sendXlsx } from '../utils/upload.js';
import { HttpError } from '../utils/httpError.js';
import { DATA_TYPES } from '../utils/types.js';

const router = Router();
const RESERVED_QUERY = new Set(['page', 'limit', 'sort', 'order', 'q', 'updated_since']);

const tableResponse = async (id) => {
  const meta = await getTableMetaById(id);
  return { ...meta.table, columns: meta.columns, row_count: await countRows(meta.table.db_table) };
};

router.get('/', async (req, res) => {
  res.json(await listTablesWithStats());
});

// Excel de ejemplo -> columnas sugeridas para el formulario de creación
router.post('/detect', excelUpload, async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Adjunta un archivo Excel en el campo "file"');
  res.json(detectColumns(req.file.buffer, req.body?.sheet_name || null));
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const pool = getPool();
  const [[category]] = await pool.query('SELECT * FROM categories WHERE id = ?', [body.category_id]);
  if (!category) throw new HttpError(400, 'Categoría inválida');

  const name = String(body.name ?? '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'El nombre de la tabla es obligatorio (máx. 100 caracteres)');
  const slug = String(body.slug ?? '').trim() || slugify(name, 40);
  if (!isValidIdentifier(slug, 40)) {
    throw new HttpError(400, 'El identificador debe iniciar con letra y tener solo minúsculas, números y _ (máx. 40)');
  }
  const columns = validateColumns(body.columns);
  const dbTable = `dh_${category.slug}_${slug}`;

  const [[dup]] = await pool.query('SELECT id FROM hub_tables WHERE db_table = ?', [dbTable]);
  if (dup) throw new HttpError(409, `Ya existe la tabla "${slug}" en la categoría ${category.name}`);

  // El DDL hace commit implícito en MySQL: primero se crea la tabla física y, si
  // fallan los metadatos, se elimina para no dejar basura.
  try {
    await pool.query(buildCreateTableSql(dbTable, columns));
  } catch (err) {
    if (err.code === 'ER_TABLE_EXISTS_ERROR') throw new HttpError(409, `La tabla física ${dbTable} ya existe en MySQL`);
    throw new HttpError(400, `MySQL rechazó la definición: ${err.sqlMessage || err.message}`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO hub_tables (category_id, name, slug, db_table, description, sheet_name) VALUES (?, ?, ?, ?, ?, ?)',
      [category.id, name, slug, dbTable, String(body.description ?? '').trim() || null, String(body.sheet_name ?? '').trim() || null],
    );
    await conn.query(
      'INSERT INTO hub_columns (table_id, excel_name, db_name, data_type, is_key, nullable, position) VALUES ?',
      [columns.map((c) => [r.insertId, c.excel_name, c.db_name, c.data_type, c.is_key, c.nullable, c.position])],
    );
    await conn.commit();
    res.status(201).json(await tableResponse(r.insertId));
  } catch (err) {
    await conn.rollback();
    await pool.query(dropTableSql(dbTable)).catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
});

router.get('/:id', async (req, res) => {
  res.json(await tableResponse(req.params.id));
});

router.put('/:id', async (req, res) => {
  await getTableMetaById(req.params.id);
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'El nombre de la tabla es obligatorio (máx. 100 caracteres)');
  await getPool().query(
    'UPDATE hub_tables SET name = ?, description = ?, sheet_name = ? WHERE id = ?',
    [name, String(req.body?.description ?? '').trim() || null, String(req.body?.sheet_name ?? '').trim() || null, req.params.id],
  );
  res.json(await tableResponse(req.params.id));
});

router.delete('/:id', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  await getPool().query(dropTableSql(meta.table.db_table));
  await getPool().query('DELETE FROM hub_tables WHERE id = ?', [meta.table.id]);
  res.status(204).end();
});

// Agregar columna (siempre opcional y no clave, porque la tabla puede tener datos)
router.post('/:id/columns', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const { column, error } = normalizeColumn({ ...req.body, is_key: false, nullable: true }, meta.columns.length);
  if (error) throw new HttpError(400, error);
  if (meta.columns.some((c) => c.db_name === column.db_name) || SYSTEM_COLUMNS.includes(column.db_name)) {
    throw new HttpError(409, `La columna "${column.db_name}" ya existe`);
  }
  if (meta.columns.some((c) => normalizeHeader(c.excel_name) === normalizeHeader(column.excel_name))) {
    throw new HttpError(409, `El nombre en Excel "${column.excel_name}" ya está en uso`);
  }
  try {
    await getPool().query(addColumnSql(meta.table.db_table, column, meta.columns.at(-1)?.db_name ?? '_id'));
  } catch (err) {
    throw new HttpError(400, `MySQL rechazó la columna: ${err.sqlMessage || err.message}`);
  }
  await getPool().query(
    'INSERT INTO hub_columns (table_id, excel_name, db_name, data_type, is_key, nullable, position) VALUES (?, ?, ?, ?, 0, 1, ?)',
    [meta.table.id, column.excel_name, column.db_name, column.data_type, column.position],
  );
  res.status(201).json(await tableResponse(meta.table.id));
});

// Editar una columna: nombre en Excel, nombre en BD y tipo (los datos existentes se convierten)
router.put('/:id/columns/:columnId', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const col = meta.columns.find((c) => String(c.id) === String(req.params.columnId));
  if (!col) throw new HttpError(404, 'Columna no encontrada');
  const body = req.body ?? {};
  const excelName = String(body.excel_name ?? col.excel_name).trim();
  const dbName = String(body.db_name ?? col.db_name).trim();
  const dataType = String(body.data_type ?? col.data_type);
  const others = meta.columns.filter((c) => c.id !== col.id);

  if (!excelName || excelName.length > 255) throw new HttpError(400, 'El nombre en Excel es obligatorio (máx. 255)');
  if (others.some((c) => normalizeHeader(c.excel_name) === normalizeHeader(excelName))) {
    throw new HttpError(409, `El nombre en Excel "${excelName}" ya está en uso`);
  }
  if (!isValidIdentifier(dbName)) {
    throw new HttpError(400, 'El nombre en BD debe iniciar con letra y contener solo minúsculas, números y _ (máx. 64)');
  }
  if (others.some((c) => c.db_name === dbName) || SYSTEM_COLUMNS.includes(dbName)) {
    throw new HttpError(409, `La columna "${dbName}" ya existe`);
  }
  if (!DATA_TYPES[dataType]) throw new HttpError(400, `Tipo inválido: ${dataType}`);
  if (col.is_key && dataType === 'longtext') throw new HttpError(400, 'Una columna clave no puede ser Texto largo');
  if (col.is_key && dataType === 'text' && others.filter((c) => c.is_key && c.data_type === 'text').length >= MAX_TEXT_KEYS) {
    throw new HttpError(400, `Máximo ${MAX_TEXT_KEYS} columnas clave de tipo Texto`);
  }

  await alterColumn(meta, col, { dbName, dataType });
  await getPool().query(
    'UPDATE hub_columns SET excel_name = ?, db_name = ?, data_type = ? WHERE id = ?',
    [excelName, dbName, dataType, col.id],
  );
  res.json(await tableResponse(meta.table.id));
});

router.get('/:id/rows', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const filters = Object.fromEntries(Object.entries(req.query).filter(([k]) => !RESERVED_QUERY.has(k)));
  res.json(await queryRows(meta, { ...req.query, filters, updatedSince: req.query.updated_since }));
});

router.delete('/:id/rows', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  await getPool().query(truncateTableSql(meta.table.db_table));
  res.status(204).end();
});

router.delete('/:id/rows/:rowId', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const n = await deleteById(meta, req.params.rowId);
  if (!n) throw new HttpError(404, 'Fila no encontrada');
  res.status(204).end();
});

router.post('/:id/upload', excelUpload, async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const result = await importExcel(meta, req.file);
  res.status(resultHttpStatus(result)).json(result);
});

router.get('/:id/uploads', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const [rows] = await getPool().query(
    'SELECT * FROM upload_logs WHERE table_id = ? ORDER BY id DESC LIMIT ?',
    [meta.table.id, limit],
  );
  res.json(rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })));
});

router.get('/:id/template', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const buffer = buildWorkbook(meta.columns.map((c) => c.excel_name), [], meta.table.sheet_name || meta.table.name);
  sendXlsx(res, buffer, `${meta.table.slug}_plantilla.xlsx`);
});

router.get('/:id/export', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const rows = await allRows(meta);
  const buffer = buildWorkbook(
    meta.columns.map((c) => c.excel_name),
    rows.map((r) => meta.columns.map((c) => r[c.db_name])),
    meta.table.sheet_name || meta.table.name,
  );
  sendXlsx(res, buffer, `${meta.table.slug}.xlsx`);
});

export default router;
