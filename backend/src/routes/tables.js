import { Router } from 'express';
import { getPool } from '../config/db.js';
import { getTableMetaById, listTablesWithStats, countRows } from '../services/metaService.js';
import {
  validateColumns, buildCreateTableSql, dropTableSql, truncateTableSql,
} from '../services/schemaService.js';
import { addColumn, updateColumn, dropColumn } from '../services/columnService.js';
import { parseCreateTable, planAlter, toCreateSql } from '../services/sqlService.js';
import { detectColumns, buildWorkbook } from '../services/excelService.js';
import { importExcel, resultHttpStatus } from '../services/importService.js';
import { queryRows, allRows, deleteById } from '../services/dataService.js';
import { slugify, isValidIdentifier } from '../utils/identifiers.js';
import { excelUpload, sendXlsx } from '../utils/upload.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
const RESERVED_QUERY = new Set(['page', 'limit', 'sort', 'order', 'q', 'updated_since']);
const MAX_DB_NAME = 64; // límite de MySQL para nombres de tabla

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

// Modo SQL: CREATE TABLE -> columnas para revisar en el formulario antes de crear
router.post('/sql/parse', async (req, res) => {
  res.json(parseCreateTable(req.body?.sql));
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const pool = getPool();
  const [[category]] = await pool.query('SELECT * FROM categories WHERE id = ?', [body.category_id]);
  if (!category) throw new HttpError(400, 'Categoría inválida');
  let application = null;
  if (body.application_id) {
    [[application]] = await pool.query('SELECT * FROM applications WHERE id = ? AND category_id = ?', [body.application_id, category.id]);
    if (!application) throw new HttpError(400, 'Aplicación inválida para esta categoría');
  }

  // dh_<categoria>[_<aplicacion>]_<tabla> no puede pasar de 64 caracteres
  const prefix = `dh_${category.slug}_${application ? `${application.slug}_` : ''}`;
  const maxSlug = Math.min(40, MAX_DB_NAME - prefix.length);
  const name = String(body.name ?? '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'El nombre de la tabla es obligatorio (máx. 100 caracteres)');
  const slug = String(body.slug ?? '').trim() || slugify(name, maxSlug);
  if (!isValidIdentifier(slug, maxSlug)) {
    throw new HttpError(400, `El identificador debe iniciar con letra y tener solo minúsculas, números y _ (máx. ${maxSlug})`);
  }
  const columns = validateColumns(body.columns);
  const dbTable = `${prefix}${slug}`;
  const parentName = application ? `la aplicación ${application.name}` : `la categoría ${category.name}`;

  const [[dup]] = await pool.query(
    `SELECT id FROM hub_tables WHERE db_table = ?
     OR (category_id = ? AND slug = ? AND ${application ? 'application_id = ?' : 'application_id IS NULL'})`,
    application ? [dbTable, category.id, slug, application.id] : [dbTable, category.id, slug],
  );
  if (dup) throw new HttpError(409, `Ya existe la tabla "${slug}" en ${parentName}`);

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
      'INSERT INTO hub_tables (category_id, application_id, name, slug, db_table, description, sheet_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [category.id, application?.id ?? null, name, slug, dbTable, String(body.description ?? '').trim() || null, String(body.sheet_name ?? '').trim() || null],
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
  await addColumn(meta, req.body ?? {});
  res.status(201).json(await tableResponse(meta.table.id));
});

// Editar una columna: nombre en Excel, nombre en BD y tipo (los datos existentes se convierten)
router.put('/:id/columns/:columnId', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const col = meta.columns.find((c) => String(c.id) === String(req.params.columnId));
  if (!col) throw new HttpError(404, 'Columna no encontrada');
  await updateColumn(meta, col, req.body ?? {});
  res.json(await tableResponse(meta.table.id));
});

// Modo SQL: definición actual como CREATE TABLE (referencia para escribir el ALTER)
router.get('/:id/sql', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  res.json({ sql: toCreateSql(meta.table.slug, meta.columns) });
});

// Modo SQL: ALTER TABLE. Con dryRun solo valida y devuelve el plan.
// El DDL de MySQL no es transaccional: si un paso falla, los anteriores quedan aplicados y se informa.
router.post('/:id/sql', async (req, res) => {
  let meta = await getTableMetaById(req.params.id);
  const { steps, warnings } = planAlter(meta, req.body?.sql);
  const plan = steps.map((s) => s.description);
  if (req.body?.dryRun || !steps.length) return res.json({ plan, warnings, applied: 0 });

  for (const [i, step] of steps.entries()) {
    const col = meta.columns.find((c) => c.db_name === step.column);
    try {
      if (step.kind === 'add') await addColumn(meta, step.raw);
      else if (step.kind === 'update') await updateColumn(meta, col, step.changes);
      else await dropColumn(meta, col);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      const done = i ? ` Se aplicaron los ${i} pasos anteriores.` : ' No se aplicó ningún cambio.';
      throw new HttpError(err.status, `Paso ${i + 1} (${step.description}): ${err.message}${done}`, {
        ...err.details, plan, applied: i,
      });
    }
    meta = await getTableMetaById(meta.table.id);
  }
  res.json({ plan, warnings, applied: steps.length, table: await tableResponse(meta.table.id) });
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
