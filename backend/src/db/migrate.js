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
];

export async function migrate(pool) {
  for (const sql of STATEMENTS) await pool.query(sql);
}
