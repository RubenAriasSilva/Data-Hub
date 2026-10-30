// API pública por tabla en /api/v1/:categoria/:tabla o /api/v1/:categoria/:aplicacion/:tabla
// Salida: CSV (Power BI) o JSON (apps/RPAs). Entrada: archivo Excel/.json o cuerpo JSON.
import { Router } from 'express';
import { getTableMetaBySlug, isMongo } from '../services/metaService.js';
import { importFile, importJson, resultHttpStatus } from '../services/importService.js';
import { queryRows, allRows } from '../services/dataService.js';
import { buildCsv } from '../services/excelService.js';
import { dataUpload } from '../utils/upload.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
const RESERVED_QUERY = new Set(['page', 'limit', 'sort', 'order', 'q', 'updated_since', 'format']);
async function resolve(req) {
  const meta = await getTableMetaBySlug(req.params.category, req.params.app ?? null, req.params.table);
  if (isMongo(meta.table)) {
    const path = [req.params.category, req.params.app, req.params.table].filter(Boolean).join('/');
    throw new HttpError(400, `"${meta.table.name}" es una colección MongoDB: usa /api/mongo/v1/${path}`);
  }
  return meta;
}

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

// Entrada: upsert desde un archivo Excel o .json (multipart, campo "file")
async function uploadFile(req, res) {
  const meta = await resolve(req);
  const result = await importFile(meta, req.file);
  res.status(resultHttpStatus(result)).json(result);
}

// Entrada: upsert desde el cuerpo JSON: [ {...} ] o { "rows": [ ... ] }
async function writeJson(req, res) {
  const meta = await resolve(req);
  const result = await importJson(meta, req.body);
  res.status(resultHttpStatus(result)).json(result);
}

// Tablas directas de la categoría y tablas dentro de una aplicación
router.get('/:category/:table', readTable);
router.get('/:category/:app/:table', readTable);
router.post('/:category/:table/upload', dataUpload, uploadFile);
router.post('/:category/:app/:table/upload', dataUpload, uploadFile);
router.post('/:category/:table', writeJson);
router.post('/:category/:app/:table', writeJson);

export default router;
