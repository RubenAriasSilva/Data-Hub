import { Router } from 'express';
import { getPool } from '../config/db.js';
import { EJSON } from 'bson';
import { getTableMetaById, listTablesWithStats, countRecords, isMongo } from '../services/metaService.js';
import { mongoEnabled } from '../config/mongo.js';
import {
  validateKeyFields, createCollection, dropCollection, clearCollection, setKeyFields, queryDocuments,
  getDocument, replaceDocument, deleteDocument, inferFields, allDocuments, toJson,
} from '../services/mongoService.js';
import { importMongoFile, importMongoJson } from '../services/mongoImportService.js';
import {
  validateColumns, buildCreateTableSql, dropTableSql, truncateTableSql,
} from '../services/schemaService.js';
import { addColumn, updateColumn, dropColumn } from '../services/columnService.js';
import { parseCreateTable, planAlter, toCreateSql } from '../services/sqlService.js';
import { detectColumns, buildWorkbook } from '../services/excelService.js';
import { importFile, importJson, resultHttpStatus } from '../services/importService.js';
import { queryRows, allRows, deleteById } from '../services/dataService.js';
import { slugify, isValidIdentifier } from '../utils/identifiers.js';
import { excelUpload, dataUpload, sendXlsx } from '../utils/upload.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
const RESERVED_QUERY = new Set(['page', 'limit', 'sort', 'order', 'q', 'updated_since']);
const MAX_DB_NAME = 64; // límite de MySQL para nombres de tabla (también se aplica a las colecciones)
// Segmentos fijos de las URLs de la API: /upload, /query y /docs/:id
const RESERVED_SLUGS = new Set(['upload', 'query', 'docs']);
const ENGINES = new Set(['mysql', 'mongodb']);

const tableResponse = async (id) => {
  const meta = await getTableMetaById(id);
  return { ...meta.table, columns: meta.columns, row_count: await countRecords(meta.table) };
};

/** Carga la tabla y exige el motor indicado (columnas/SQL/filas son solo MySQL; documentos solo MongoDB). */
async function metaFor(id, engine) {
  const meta = await getTableMetaById(id);
  if ((engine === 'mongodb') !== isMongo(meta.table)) {
    throw new HttpError(400, engine === 'mongodb' ? 'Solo disponible para tablas MongoDB' : 'Solo disponible para tablas MySQL');
  }
  return meta;
}

router.get('/', async (req, res) => {
  res.json(await listTablesWithStats());
});

// Excel o CSV de ejemplo -> columnas sugeridas para el formulario de creación
router.post('/detect', excelUpload, async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Adjunta un archivo Excel o CSV en el campo "file"');
  res.json(detectColumns(req.file.buffer, req.body?.sheet_name || null, req.file.originalname));
});

// Modo SQL: CREATE TABLE -> columnas para revisar en el formulario antes de crear
router.post('/sql/parse', async (req, res) => {
  res.json(parseCreateTable(req.body?.sql));
});

router.post('/', async (req, res) => {
  const body = req.body ?? {};
  const dbType = body.db_type || 'mysql';
  if (!ENGINES.has(dbType)) throw new HttpError(400, `Motor inválido: ${dbType}`);
  if (dbType === 'mongodb' && !mongoEnabled()) throw new HttpError(400, 'MongoDB no está configurado (MONGO_URI en backend/.env)');
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
  // POST /api/v1/<cat>/<tabla>/upload tiene la misma forma que POST /api/v1/<cat>/<app>/<tabla>
  if (RESERVED_SLUGS.has(slug)) throw new HttpError(400, `El identificador "${slug}" está reservado para la API`);
  const mongo = dbType === 'mongodb';
  const keyFields = mongo ? validateKeyFields(body.key_fields) : null;
  const columns = mongo ? [] : validateColumns(body.columns);
  const dbTable = `${prefix}${slug}`;
  const parentName = application ? `la aplicación ${application.name}` : `la categoría ${category.name}`;

  const [[dup]] = await pool.query(
    `SELECT id FROM hub_tables WHERE db_table = ?
     OR (category_id = ? AND slug = ? AND ${application ? 'application_id = ?' : 'application_id IS NULL'})`,
    application ? [dbTable, category.id, slug, application.id] : [dbTable, category.id, slug],
  );
  if (dup) throw new HttpError(409, `Ya existe la tabla "${slug}" en ${parentName}`);

  // El DDL hace commit implícito en MySQL: primero se crea la tabla física (o la colección) y,
  // si fallan los metadatos, se elimina para no dejar basura.
  if (mongo) await createCollection(dbTable, keyFields);
  else {
    try {
      await pool.query(buildCreateTableSql(dbTable, columns));
    } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR') throw new HttpError(409, `La tabla física ${dbTable} ya existe en MySQL`);
      throw new HttpError(400, `MySQL rechazó la definición: ${err.sqlMessage || err.message}`);
    }
  }
  const dropPhysical = () => (mongo ? dropCollection(dbTable) : pool.query(dropTableSql(dbTable)));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO hub_tables (category_id, application_id, name, slug, db_table, db_type, key_fields, description, sheet_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        category.id, application?.id ?? null, name, slug, dbTable, dbType, mongo ? JSON.stringify(keyFields) : null,
        String(body.description ?? '').trim() || null, String(body.sheet_name ?? '').trim() || null,
      ],
    );
    if (columns.length) {
      await conn.query(
        'INSERT INTO hub_columns (table_id, excel_name, db_name, data_type, is_key, nullable, position) VALUES ?',
        [columns.map((c) => [r.insertId, c.excel_name, c.db_name, c.data_type, c.is_key, c.nullable, c.position])],
      );
    }
    await conn.commit();
    res.status(201).json(await tableResponse(r.insertId));
  } catch (err) {
    await conn.rollback();
    await dropPhysical().catch(() => {});
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
  if (isMongo(meta.table)) await dropCollection(meta.table.db_table);
  else await getPool().query(dropTableSql(meta.table.db_table));
  await getPool().query('DELETE FROM hub_tables WHERE id = ?', [meta.table.id]);
  res.status(204).end();
});

// Agregar columna (siempre opcional y no clave, porque la tabla puede tener datos)
router.post('/:id/columns', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mysql');
  await addColumn(meta, req.body ?? {});
  res.status(201).json(await tableResponse(meta.table.id));
});

// Editar una columna: nombre en Excel, nombre en BD y tipo (los datos existentes se convierten)
router.put('/:id/columns/:columnId', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mysql');
  const col = meta.columns.find((c) => String(c.id) === String(req.params.columnId));
  if (!col) throw new HttpError(404, 'Columna no encontrada');
  await updateColumn(meta, col, req.body ?? {});
  res.json(await tableResponse(meta.table.id));
});

// Modo SQL: definición actual como CREATE TABLE (referencia para escribir el ALTER)
router.get('/:id/sql', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mysql');
  res.json({ sql: toCreateSql(meta.table.slug, meta.columns) });
});

// Modo SQL: ALTER TABLE. Con dryRun solo valida y devuelve el plan.
// El DDL de MySQL no es transaccional: si un paso falla, los anteriores quedan aplicados y se informa.
router.post('/:id/sql', async (req, res) => {
  let meta = await metaFor(req.params.id, 'mysql');
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
  const meta = await metaFor(req.params.id, 'mysql');
  const filters = Object.fromEntries(Object.entries(req.query).filter(([k]) => !RESERVED_QUERY.has(k)));
  res.json(await queryRows(meta, { ...req.query, filters, updatedSince: req.query.updated_since }));
});

// Vaciar: TRUNCATE en MySQL, deleteMany en MongoDB
router.delete('/:id/rows', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  if (isMongo(meta.table)) await clearCollection(meta);
  else await getPool().query(truncateTableSql(meta.table.db_table));
  res.status(204).end();
});

router.delete('/:id/rows/:rowId', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mysql');
  const n = await deleteById(meta, req.params.rowId);
  if (!n) throw new HttpError(404, 'Fila no encontrada');
  res.status(204).end();
});

// Archivo Excel, CSV o .json (MongoDB además .ndjson/.jsonl y .bson)
router.post('/:id/upload', dataUpload, async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  const result = isMongo(meta.table) ? await importMongoFile(meta, req.file) : await importFile(meta, req.file);
  res.status(resultHttpStatus(result)).json(result);
});

// JSON escrito en la app: [ {...} ] o { "rows": [ ... ] }
router.post('/:id/json', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mysql');
  const result = await importJson(meta, req.body, { source: 'json' });
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
  const meta = await metaFor(req.params.id, 'mysql');
  const buffer = buildWorkbook(meta.columns.map((c) => c.excel_name), [], meta.table.sheet_name || meta.table.name);
  sendXlsx(res, buffer, `${meta.table.slug}_plantilla.xlsx`);
});

router.get('/:id/export', async (req, res) => {
  const meta = await getTableMetaById(req.params.id);
  if (isMongo(meta.table)) {
    // EJSON relajado: se puede volver a cargar sin perder ObjectId ni fechas
    res.setHeader('Content-Disposition', `attachment; filename="${meta.table.slug}.json"`);
    return res.type('application/json').send(EJSON.stringify(await allDocuments(meta), null, 2, { relaxed: true }));
  }
  const rows = await allRows(meta);
  const buffer = buildWorkbook(
    meta.columns.map((c) => c.excel_name),
    rows.map((r) => meta.columns.map((c) => r[c.db_name])),
    meta.table.sheet_name || meta.table.name,
  );
  sendXlsx(res, buffer, `${meta.table.slug}.xlsx`);
});

// ── Solo MongoDB ────────────────────────────────────────────────────────────

// Documentos paginados: ?filter={"campo": valor}, q, sort, order, page, limit, fields
router.get('/:id/documents', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mongodb');
  res.json(await queryDocuments(meta, { ...req.query, updatedSince: req.query.updated_since }));
});

// Documentos escritos en la app: { ... }, [ {...} ] o { "documents": [ ... ] }
router.post('/:id/documents', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mongodb');
  const result = await importMongoJson(meta, req.body, { source: 'json' });
  res.status(resultHttpStatus(result)).json(result);
});

router.get('/:id/documents/:docId', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mongodb');
  res.json(toJson(await getDocument(meta, req.params.docId)));
});

router.put('/:id/documents/:docId', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mongodb');
  res.json(toJson(await replaceDocument(meta, req.params.docId, req.body)));
});

router.delete('/:id/documents/:docId', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mongodb');
  if (!await deleteDocument(meta, req.params.docId)) throw new HttpError(404, 'Documento no encontrado');
  res.status(204).end();
});

// Campos detectados en una muestra de documentos
router.get('/:id/fields', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mongodb');
  res.json(await inferFields(meta));
});

// Cambiar los campos clave (reconstruye el índice único)
router.put('/:id/keys', async (req, res) => {
  const meta = await metaFor(req.params.id, 'mongodb');
  const keys = validateKeyFields(req.body?.key_fields);
  await setKeyFields(meta, keys);
  await getPool().query('UPDATE hub_tables SET key_fields = ? WHERE id = ?', [JSON.stringify(keys), meta.table.id]);
  res.json(await tableResponse(meta.table.id));
});

export default router;
