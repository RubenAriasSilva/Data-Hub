import { Router } from 'express';
import { getPool } from '../config/db.js';
import { listTablesWithStats } from '../services/metaService.js';

const router = Router();

router.get('/', async (req, res) => {
  const pool = getPool();
  const [[{ categories }]] = await pool.query('SELECT COUNT(*) AS categories FROM categories');
  const tables = await listTablesWithStats();
  const [[today]] = await pool.query(
    `SELECT COUNT(*) AS uploads, COALESCE(SUM(inserted), 0) AS inserted, COALESCE(SUM(updated), 0) AS updated
     FROM upload_logs WHERE created_at >= CURDATE()`,
  );
  const [recent] = await pool.query(
    `SELECT u.id, u.source, u.filename, u.rows_total, u.inserted, u.updated, u.failed, u.status, u.created_at,
            t.id AS table_id, t.name AS table_name, t.slug AS table_slug, c.slug AS category_slug, c.name AS category_name,
            a.slug AS application_slug, a.name AS application_name
     FROM upload_logs u
     JOIN hub_tables t ON t.id = u.table_id
     JOIN categories c ON c.id = t.category_id
     LEFT JOIN applications a ON a.id = t.application_id
     ORDER BY u.id DESC LIMIT 10`,
  );
  res.json({
    categories: Number(categories),
    tables: tables.length,
    rows: tables.reduce((sum, t) => sum + (t.row_count || 0), 0),
    today: { uploads: Number(today.uploads), inserted: Number(today.inserted), updated: Number(today.updated) },
    recent,
    top_tables: [...tables].sort((a, b) => (b.row_count || 0) - (a.row_count || 0)).slice(0, 8),
  });
});

export default router;
