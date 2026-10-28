// Tablas de metadatos del Data Hub. Idempotente: se ejecuta en cada arranque.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(20) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    icon VARCHAR(40) NOT NULL DEFAULT 'folder',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS hub_tables (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(40) NOT NULL,
    db_table VARCHAR(64) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    sheet_name VARCHAR(100) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_category_slug (category_id, slug),
    CONSTRAINT fk_tables_category FOREIGN KEY (category_id) REFERENCES categories(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS hub_columns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    table_id INT NOT NULL,
    excel_name VARCHAR(255) NOT NULL,
    db_name VARCHAR(64) NOT NULL,
    data_type VARCHAR(20) NOT NULL,
    is_key TINYINT(1) NOT NULL DEFAULT 0,
    nullable TINYINT(1) NOT NULL DEFAULT 1,
    position INT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_table_column (table_id, db_name),
    CONSTRAINT fk_columns_table FOREIGN KEY (table_id) REFERENCES hub_tables(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS upload_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    table_id INT NOT NULL,
    source VARCHAR(10) NOT NULL,
    filename VARCHAR(255) NULL,
    rows_total INT NOT NULL DEFAULT 0,
    inserted INT NOT NULL DEFAULT 0,
    updated INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL,
    duration_ms INT NOT NULL DEFAULT 0,
    details LONGTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_logs_table_date (table_id, created_at),
    CONSTRAINT fk_logs_table FOREIGN KEY (table_id) REFERENCES hub_tables(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `INSERT IGNORE INTO categories (name, slug, description, icon)
   VALUES ('RPAs', 'rpas', 'Transacciones generadas por los robots RPA', 'bot')`,

  // Nivel opcional Categoría -> Aplicación -> Tablas
  `CREATE TABLE IF NOT EXISTS applications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(20) NOT NULL,
    description VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_category_app (category_id, slug),
    CONSTRAINT fk_apps_category FOREIGN KEY (category_id) REFERENCES categories(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

// Cambios sobre tablas ya existentes. MySQL no tiene "ADD COLUMN IF NOT EXISTS"
// (MariaDB sí), así que cada paso se condiciona consultando information_schema.
const ALTERS = [
  {
    exists: { column: ['hub_tables', 'application_id'] },
    sql: 'ALTER TABLE hub_tables ADD COLUMN application_id INT NULL AFTER category_id',
  },
  {
    exists: { constraint: ['hub_tables', 'fk_tables_application'] },
    sql: `ALTER TABLE hub_tables ADD CONSTRAINT fk_tables_application
          FOREIGN KEY (application_id) REFERENCES applications(id)`,
  },
  // El índice nuevo se crea antes de borrar el viejo: uk_category_slug respalda la FK de categoría
  {
    exists: { index: ['hub_tables', 'uk_parent_slug'] },
    sql: 'ALTER TABLE hub_tables ADD UNIQUE KEY uk_parent_slug (category_id, application_id, slug)',
  },
  {
    missing: { index: ['hub_tables', 'uk_category_slug'] },
    sql: 'ALTER TABLE hub_tables DROP INDEX uk_category_slug',
  },
];

const CHECKS = {
  column: 'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
  index: 'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
  constraint: `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
};

async function found(pool, check) {
  const [kind, params] = Object.entries(check)[0];
  const [rows] = await pool.query(`${CHECKS[kind]} LIMIT 1`, params);
  return rows.length > 0;
}

export async function migrate(pool) {
  for (const sql of STATEMENTS) await pool.query(sql);
  for (const step of ALTERS) {
    if (step.exists && await found(pool, step.exists)) continue;
    if (step.missing && !await found(pool, step.missing)) continue;
    await pool.query(step.sql);
  }
}
