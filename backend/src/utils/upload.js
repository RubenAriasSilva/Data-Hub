import multer from 'multer';
import path from 'node:path';
import { HttpError } from './httpError.js';

const ALLOWED = new Set(['.xlsx', '.xls']);

export const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // multer entrega el nombre en latin1; lo pasamos a utf8 para conservar acentos
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED.has(ext)) cb(null, true);
    else cb(new HttpError(400, `Formato no soportado (${ext || 'sin extensión'}). Usa .xlsx o .xls`));
  },
}).single('file');

export function sendXlsx(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}
