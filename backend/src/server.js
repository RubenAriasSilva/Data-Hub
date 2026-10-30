import './env.js';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { connectWithRetry, dbState } from './config/db.js';
import { connectMongoWithRetry, mongoState } from './config/mongo.js';
import categoriesRouter from './routes/categories.js';
import applicationsRouter from './routes/applications.js';
import tablesRouter from './routes/tables.js';
import externalRouter from './routes/external.js';
import externalMongoRouter from './routes/externalMongo.js';
import statsRouter from './routes/stats.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (req, res) => {
  const db = dbState();
  // MongoDB es opcional: su estado se informa pero no cambia el status general
  res.status(db.ready ? 200 : 503).json({ status: db.ready ? 'ok' : 'degraded', db, mongo: mongoState() });
});

app.use('/api/categories', categoriesRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/stats', statsRouter);
app.use('/api/v1', externalRouter);
app.use('/api/mongo/v1', externalMongoRouter);
app.use('/api', (req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` }));

// En producción, el backend sirve el frontend compilado (frontend/dist)
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(distDir, 'index.html')) : next()));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message;
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE'
      ? `El archivo excede ${process.env.MAX_UPLOAD_MB || 20} MB`
      : `Error en la carga: ${err.message}`;
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'El cuerpo de la solicitud es demasiado grande';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'JSON inválido';
  }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
});

const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = accesible desde otras computadoras de la red
// Express 5 pasa los errores de listen al callback en vez de lanzarlos: se termina el proceso para que PM2 lo muestre
app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error(`[api] No se pudo escuchar en ${HOST}:${PORT}: ${err.code ?? ''} ${err.message}`);
    process.exit(1);
  }
  console.log(`[api] Data Hub escuchando en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
connectWithRetry();
connectMongoWithRetry();
