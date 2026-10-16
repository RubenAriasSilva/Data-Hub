// API pública para aplicaciones y RPAs: /api/v1/:categoria/:tabla
import { Router } from 'express';
import { getPool } from '../config/db.js';
import { getTableMetaBySlug } from '../services/metaService.js';
import { importExcel, importJson, resultHttpStatus } from '../services/importService.js';
import { queryRows, allRows, deleteByKeys } from '../services/dataService.js';
import { buildWorkbook } from '../services/excelService.js';
import { DATA_TYPES } from '../utils/types.js';
import { excelUpload, sendXlsx } from '../utils/upload.js';

const router = Router();
const RESERVED_QUERY = new Set(['page', 'limit', 'sort', 'order', 'q', 'updated_since']);
const resolve = (req) => getTableMetaBySlug(req.params.category, req.params.table);

const baseUrl = (req) => `${req.protocol}://${req.get('host')}/api/v1`;

// Catálogo de endpoints disponibles
router.get('/', async (req, res) => {
  const [tables] = await getPool().query(
    `SELECT c.slug AS category, c.name AS category_name, t.slug AS \`table\`, t.name
     FROM hub_tables t JOIN categories c ON c.id = t.category_id ORDER BY c.slug, t.slug`,
  );
  res.json(tables.map((t) => ({ ...t, url: `${baseUrl(req)}/${t.category}/${t.table}` })));
});

router.get('/:category/:table/schema', async (req, res) => {
  const { table, columns } = await resolve(req);
  const url = `${baseUrl(req)}/${table.category_slug}/${table.slug}`;
  res.json({
    category: table.category_slug,
    table: table.slug,
    name: table.name,
    description: table.description,
    keys: columns.filter((c) => c.is_key).map((c) => c.db_name),
    columns: columns.map((c) => ({
      name: c.db_name,
      excel_name: c.excel_name,
      type: c.data_type,
      sql_type: DATA_TYPES[c.data_type].sql,
      key: c.is_key,
      nullable: c.nullable,
    })),
    endpoints: {
      read: `GET ${url}`,
      write_json: `POST ${url}`,
      write_excel: `POST ${url}/upload`,
      export_excel: `GET ${url}/export`,
      delete: `DELETE ${url}?<clave>=<valor>`,
    },
  });
});

router.get('/:category/:table/export', async (req, res) => {
  const meta = await resolve(req);
  const rows = await allRows(meta);
  const buffer = buildWorkbook(
    meta.columns.map((c) => c.excel_name),
    rows.map((r) => meta.columns.map((c) => r[c.db_name])),
    meta.table.sheet_name || meta.table.name,
  );
  sendXlsx(res, buffer, `${meta.table.slug}.xlsx`);
});

router.get('/:category/:table', async (req, res) => {
  const meta = await resolve(req);
  const filters = Object.fromEntries(Object.entries(req.query).filter(([k]) => !RESERVED_QUERY.has(k)));
  res.json(await queryRows(meta, {
    ...req.query, filters, updatedSince: req.query.updated_since, maxLimit: 5000,
  }));
});

router.post('/:category/:table/upload', excelUpload, async (req, res) => {
  const meta = await resolve(req);
  const result = await importExcel(meta, req.file);
  res.status(resultHttpStatus(result)).json(result);
});

router.post('/:category/:table', async (req, res) => {
  const meta = await resolve(req);
  const result = await importJson(meta, req.body);
  res.status(resultHttpStatus(result)).json(result);
});

router.delete('/:category/:table', async (req, res) => {
  const meta = await resolve(req);
  const deleted = await deleteByKeys(meta, req.query);
  res.json({ deleted });
});

export default router;
