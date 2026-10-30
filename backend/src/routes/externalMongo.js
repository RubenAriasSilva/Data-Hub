// API pública de las colecciones MongoDB en /api/mongo/v1/:categoria/:coleccion
// o /api/mongo/v1/:categoria/:aplicacion/:coleccion.
// Salida: JSON paginado con filtro de MongoDB, consulta libre por POST, documento por _id y CSV aplanado (Power BI).
// Entrada: documentos en el cuerpo JSON o archivo (JSON, NDJSON, BSON, Excel, CSV).
import { Router } from 'express';
import { getTableMetaBySlug, isMongo } from '../services/metaService.js';
import {
  queryDocuments, findDocuments, allDocuments, getDocument, replaceDocument, deleteDocument,
  flatten, cellValue, toJson,
} from '../services/mongoService.js';
import { importMongoFile, importMongoJson } from '../services/mongoImportService.js';
import { resultHttpStatus } from '../services/importService.js';
import { buildCsv } from '../services/excelService.js';
import { dataUpload } from '../utils/upload.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

async function resolve(req) {
  const meta = await getTableMetaBySlug(req.params.category, req.params.app ?? null, req.params.table);
  if (!isMongo(meta.table)) {
    const path = [req.params.category, req.params.app, req.params.table].filter(Boolean).join('/');
    throw new HttpError(400, `"${meta.table.name}" es una tabla MySQL: usa /api/v1/${path}`);
  }
  return meta;
}

/** CSV con una columna por ruta ("cliente.nombre"), en el orden en que aparecen. */
function documentsCsv(docs) {
  const headers = [];
  const seen = new Set();
  const flat = docs.map((d) => {
    const f = flatten(d);
    for (const k of Object.keys(f)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
    return f;
  });
  return buildCsv(headers, flat.map((f) => headers.map((h) => cellValue(f[h]))));
}

// JSON paginado: ?filter={"estado":"ok"}&fields=a,b.c&sort=campo&order=asc&page=1&limit=100&updated_since=…&q=texto
// ?format=csv devuelve todos los documentos (o los del filtro) como CSV aplanado.
async function list(req, res) {
  const meta = await resolve(req);
  if (req.query.format === 'csv') {
    const docs = req.query.filter
      ? (await findDocuments(meta, { filter: req.query.filter, limit: 200000 }, 200000, true)).documents
      : await allDocuments(meta);
    return res.type('text/csv; charset=utf-8').send(documentsCsv(docs));
  }
  res.json(await queryDocuments(meta, { ...req.query, updatedSince: req.query.updated_since, maxLimit: 5000 }));
}

// Consulta libre: { "filter": {...}, "projection": {...}, "sort": {...}, "skip": 0, "limit": 1000 }
async function query(req, res) {
  res.json(await findDocuments(await resolve(req), req.body ?? {}));
}

// Entrada: { ... }, [ {...} ] o { "documents": [ ... ] }
async function write(req, res) {
  const result = await importMongoJson(await resolve(req), req.body);
  res.status(resultHttpStatus(result)).json(result);
}

async function upload(req, res) {
  const result = await importMongoFile(await resolve(req), req.file);
  res.status(resultHttpStatus(result)).json(result);
}

async function getDoc(req, res) {
  res.json(toJson(await getDocument(await resolve(req), req.params.id)));
}

async function putDoc(req, res) {
  res.json(toJson(await replaceDocument(await resolve(req), req.params.id, req.body)));
}

async function deleteDoc(req, res) {
  if (!await deleteDocument(await resolve(req), req.params.id)) throw new HttpError(404, 'Documento no encontrado');
  res.status(204).end();
}

// Las rutas con segmento fijo (upload, query, docs) van antes que /:category/:app/:table
router.get('/:category/:table/docs/:id', getDoc);
router.get('/:category/:app/:table/docs/:id', getDoc);
router.put('/:category/:table/docs/:id', putDoc);
router.put('/:category/:app/:table/docs/:id', putDoc);
router.delete('/:category/:table/docs/:id', deleteDoc);
router.delete('/:category/:app/:table/docs/:id', deleteDoc);
router.post('/:category/:table/upload', dataUpload, upload);
router.post('/:category/:app/:table/upload', dataUpload, upload);
router.post('/:category/:table/query', query);
router.post('/:category/:app/:table/query', query);
router.get('/:category/:table', list);
router.get('/:category/:app/:table', list);
router.post('/:category/:table', write);
router.post('/:category/:app/:table', write);

export default router;
