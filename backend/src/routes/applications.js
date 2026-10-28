// Aplicaciones: nivel opcional entre la categoría y sus tablas (Categoría -> Aplicación -> Tablas)
import { Router } from 'express';
import { getPool } from '../config/db.js';
import { slugify, isValidIdentifier } from '../utils/identifiers.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();
export const MAX_APP_SLUG = 20;

async function getApplication(id) {
  const [[app]] = await getPool().query(
    `SELECT a.*, c.slug AS category_slug, c.name AS category_name
     FROM applications a JOIN categories c ON c.id = a.category_id WHERE a.id = ?`,
    [id],
  );
  if (!app) throw new HttpError(404, 'Aplicación no encontrada');
  return app;
}

function readBody(body) {
  const name = String(body?.name ?? '').trim();
  if (!name) throw new HttpError(400, 'El nombre es obligatorio');
  if (name.length > 100) throw new HttpError(400, 'El nombre excede 100 caracteres');
  return { name, description: String(body?.description ?? '').trim().slice(0, 500) || null };
}

router.post('/', async (req, res) => {
  const data = readBody(req.body);
  const [[category]] = await getPool().query('SELECT id FROM categories WHERE id = ?', [req.body?.category_id]);
  if (!category) throw new HttpError(400, 'Categoría inválida');
  const slug = String(req.body?.slug ?? '').trim() || slugify(data.name, MAX_APP_SLUG);
  if (!isValidIdentifier(slug, MAX_APP_SLUG)) {
    throw new HttpError(400, `El identificador debe iniciar con letra y tener solo minúsculas, números y _ (máx. ${MAX_APP_SLUG})`);
  }
  try {
    const [r] = await getPool().query(
      'INSERT INTO applications (category_id, name, slug, description) VALUES (?, ?, ?, ?)',
      [category.id, data.name, slug, data.description],
    );
    res.status(201).json(await getApplication(r.insertId));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, `Ya existe una aplicación con el identificador "${slug}" en esta categoría`);
    throw err;
  }
});

// El slug no se modifica: forma parte del nombre físico de las tablas y de las URLs de la API.
router.put('/:id', async (req, res) => {
  await getApplication(req.params.id);
  const data = readBody(req.body);
  await getPool().query('UPDATE applications SET name = ?, description = ? WHERE id = ?', [data.name, data.description, req.params.id]);
  res.json(await getApplication(req.params.id));
});

router.delete('/:id', async (req, res) => {
  await getApplication(req.params.id);
  const [[{ n }]] = await getPool().query('SELECT COUNT(*) AS n FROM hub_tables WHERE application_id = ?', [req.params.id]);
  if (n > 0) throw new HttpError(409, 'La aplicación tiene tablas. Elimínalas primero.');
  await getPool().query('DELETE FROM applications WHERE id = ?', [req.params.id]);
  res.status(204).end();
});

export default router;
