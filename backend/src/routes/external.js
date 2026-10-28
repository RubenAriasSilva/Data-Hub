// API pública por tabla en /api/v1/:categoria/:tabla o /api/v1/:categoria/:aplicacion/:tabla
// Salida: CSV (Power BI) o JSON (apps/RPAs). Entrada: Excel.
import { Router } from 'express';
import { getTableMetaBySlug } from '../services/metaService.js';
import { importExcel, resultHttpStatus } from '../services/importService.js';
import { queryRows, allRows } from '../services/dataService.js';
import { buildCsv } from '../services/excelService.js';
import { excelUpload } from '../utils/upload.js';

const router = Router();
const RESERVED_QUERY = new Set(['page', 'limit', 'sort', 'order', 'q', 'updated_since', 'format']);
const resolve = (req) => getTableMetaBySlug(req.params.category, req.params.app ?? null, req.params.table);

// JSON si se pide con ?format=json o Accept: application/json; CSV en cualquier otro caso
// (Power BI manda Accept: */*, así que sigue recibiendo CSV).
const wantsJson = (req) => {
  if (req.query.format) return req.query.format === 'json';
  return req.accepts(['text/csv', 'application/json']) === 'application/json';
};

async function readTable(req, res) {
  const meta = await resolve(req);

  // JSON: paginado y filtrable (?<columna>=valor, page, limit, sort, order, q, updated_since)
  if (wantsJson(req)) {
    const filters = Object.fromEntries(Object.entries(req.query).filter(([k]) => !RESERVED_QUERY.has(k)));
    return res.json(await queryRows(meta, {
      ...req.query, filters, updatedSince: req.query.updated_since, maxLimit: 5000,
    }));
  }

  // CSV: todas las filas con los encabezados originales del Excel
  const rows = await allRows(meta);
  res.type('text/csv; charset=utf-8').send(buildCsv(
    meta.columns.map((c) => c.excel_name),
    rows.map((r) => meta.columns.map((c) => r[c.db_name])),
  ));
}

// Entrada: upsert desde Excel (multipart, campo "file")
async function uploadExcel(req, res) {
  const meta = await resolve(req);
  const result = await importExcel(meta, req.file);
  res.status(resultHttpStatus(result)).json(result);
}

// Tablas directas de la categoría y tablas dentro de una aplicación
router.get('/:category/:table', readTable);
router.get('/:category/:app/:table', readTable);
router.post('/:category/:table/upload', excelUpload, uploadExcel);
router.post('/:category/:app/:table/upload', excelUpload, uploadExcel);

export default router;
