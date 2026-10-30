import { Router } from 'express';
import { getPool } from '../config/db.js';
import { listTablesWithStats, getTableMetaBySlug, countRecords } from '../services/metaService.js';
import { slugify, isValidIdentifier } from '../utils/identifiers.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

async function getCategory(field, value) {
  const [[category]] = await getPool().query(`SELECT * FROM categories WHERE ${field === 'id' ? 'id' : 'slug'} = ?`, [value]);
  if (!category) throw new HttpError(404, 'Categoría no encontrada');
  return category;
}

function readBody(body) {
  const name = String(body?.name ?? '').trim();
  if (!name) throw new HttpError(400, 'El nombre es obligatorio');
  if (name.length > 100) throw new HttpError(400, 'El nombre excede 100 caracteres');
  return {
    name,
    description: String(body?.description ?? '').trim().slice(0, 500) || null,
    icon: String(body?.icon ?? 'folder').trim().slice(0, 40) || 'folder',
  };
}

router.get('/', async (req, res) => {
  const [rows] = await getPool().query(
    `SELECT c.*, COUNT(t.id) AS table_count
     FROM categories c LEFT JOIN hub_tables t ON t.category_id = c.id
     GROUP BY c.id ORDER BY c.id`,
  );
  res.json(rows);
});

async function getApplication(category, appSlug) {
  const [[app]] = await getPool().query('SELECT * FROM applications WHERE category_id = ? AND slug = ?', [category.id, appSlug]);
  if (!app) throw new HttpError(404, 'Aplicación no encontrada');
  return app;
}

const tableDetail = async (meta) => ({ ...meta.table, columns: meta.columns, row_count: await countRecords(meta.table) });

// Categoría con sus aplicaciones y sus tablas directas (las que no pertenecen a una aplicación)
router.get('/:slug', async (req, res) => {
  const category = await getCategory('slug', req.params.slug);
  const [applications] = await getPool().query(
    `SELECT a.id, a.category_id, a.name, a.slug, a.description, a.created_at, COUNT(t.id) AS table_count
     FROM applications a LEFT JOIN hub_tables t ON t.application_id = a.id
     WHERE a.category_id = ? GROUP BY a.id ORDER BY a.name`,
    [category.id],
  );
  res.json({ ...category, applications, tables: await listTablesWithStats({ categoryId: category.id, applicationId: null }) });
});

router.get('/:slug/tables/:tableSlug', async (req, res) => {
  res.json(await tableDetail(await getTableMetaBySlug(req.params.slug, null, req.params.tableSlug)));
});

router.get('/:slug/apps/:appSlug', async (req, res) => {
  const category = await getCategory('slug', req.params.slug);
  const app = await getApplication(category, req.params.appSlug);
  res.json({
    ...app,
    category_slug: category.slug,
    category_name: category.name,
    tables: await listTablesWithStats({ categoryId: category.id, applicationId: app.id }),
  });
});

router.get('/:slug/apps/:appSlug/tables/:tableSlug', async (req, res) => {
  res.json(await tableDetail(await getTableMetaBySlug(req.params.slug, req.params.appSlug, req.params.tableSlug)));
});

router.post('/', async (req, res) => {
  const data = readBody(req.body);
  const slug = String(req.body?.slug ?? '').trim() || slugify(data.name, 20);
  if (!isValidIdentifier(slug, 20)) {
    throw new HttpError(400, 'El identificador debe iniciar con letra y tener solo minúsculas, números y _ (máx. 20)');
  }
  try {
    const [r] = await getPool().query(
      'INSERT INTO categories (name, slug, description, icon) VALUES (?, ?, ?, ?)',
      [data.name, slug, data.description, data.icon],
    );
    res.status(201).json(await getCategory('id', r.insertId));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, `Ya existe una categoría con el identificador "${slug}"`);
    throw err;
  }
});

// El slug no se modifica: forma parte del nombre físico de las tablas y de las URLs de la API.
router.put('/:id', async (req, res) => {
  await getCategory('id', req.params.id);
  const data = readBody(req.body);
  await getPool().query(
    'UPDATE categories SET name = ?, description = ?, icon = ? WHERE id = ?',
    [data.name, data.description, data.icon, req.params.id],
  );
  res.json(await getCategory('id', req.params.id));
});

router.delete('/:id', async (req, res) => {
  await getCategory('id', req.params.id);
  const [[{ n }]] = await getPool().query('SELECT COUNT(*) AS n FROM hub_tables WHERE category_id = ?', [req.params.id]);
  if (n > 0) throw new HttpError(409, 'La categoría tiene tablas. Elimínalas primero.');
  const [[{ apps }]] = await getPool().query('SELECT COUNT(*) AS apps FROM applications WHERE category_id = ?', [req.params.id]);
  if (apps > 0) throw new HttpError(409, 'La categoría tiene aplicaciones. Elimínalas primero.');
  await getPool().query('DELETE FROM categories WHERE id = ?', [req.params.id]);
  res.status(204).end();
});

export default router;
