import multer from 'multer';
import path from 'node:path';
import { HttpError } from './httpError.js';

/** Middleware para un archivo en el campo "file" con las extensiones indicadas. */
export function fileUpload(extensions, maxMb = Number(process.env.MAX_UPLOAD_MB || 20)) {
  const allowed = new Set(extensions);
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      // multer entrega el nombre en latin1; lo pasamos a utf8 para conservar acentos
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.has(ext)) cb(null, true);
      else cb(new HttpError(400, `Formato no soportado (${ext || 'sin extensión'}). Usa ${extensions.join(', ')}`));
    },
  }).single('file');
}

export const excelUpload = fileUpload(['.xlsx', '.xls']);
// Cargas de datos: Excel o JSON
export const dataUpload = fileUpload(['.xlsx', '.xls', '.json']);

export function sendXlsx(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}
