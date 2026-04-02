import { pool } from '../config/database';

async function addColumnIfMissing(table: string, column: string, definition: string, afterColumn: string): Promise<void> {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if ((rows as any[]).length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition} AFTER \`${afterColumn}\``);
  }
}

async function addIndexIfMissing(table: string, indexName: string, definitionSql: string): Promise<void> {
  const [rows] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );

  if ((rows as any[]).length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD ${definitionSql}`);
  }
}

async function addConstraintIfMissing(table: string, constraintName: string, definitionSql: string): Promise<void> {
  const [rows] = await pool.query(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, constraintName]
  );

  if ((rows as any[]).length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraintName}\` ${definitionSql}`);
  }
}

export async function ensureInvoiceSchema(): Promise<void> {
  await addColumnIfMissing('products', 'stan_magazynowy', 'DECIMAL(12,3) NULL', 'jednostka');
  await addColumnIfMissing('products', 'gtin', 'VARCHAR(32) NULL', 'sku');
  await addColumnIfMissing('products', 'cena_sprzedazy_rekomendowana', 'DECIMAL(12,2) NULL', 'cena_zakupu');
  await addColumnIfMissing('products', 'additional_info', 'TEXT NULL', 'stan_magazynowy');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS product_price_tiers (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      product_id INT UNSIGNED NOT NULL,
      quantity DECIMAL(12,3) NOT NULL,
      unit_price_recommended DECIMAL(12,2) NOT NULL,
      unit_purchase_price DECIMAL(12,2) NULL,
      commission_percent DECIMAL(5,2) NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'PLN',
      notes VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_product_price_tiers_product (product_id),
      KEY idx_product_price_tiers_quantity (quantity),
      CONSTRAINT fk_product_price_tiers_product
        FOREIGN KEY (product_id) REFERENCES products(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS product_stock_adjustments (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      product_id INT UNSIGNED NOT NULL,
      change_type ENUM('out') NOT NULL DEFAULT 'out',
      quantity DECIMAL(12,3) NOT NULL,
      quantity_before DECIMAL(12,3) NOT NULL,
      quantity_after DECIMAL(12,3) NOT NULL,
      reason ENUM('damaged', 'sample', 'lost', 'expired', 'other') NOT NULL,
      notes VARCHAR(500) NULL,
      created_by_user_id INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_stock_adj_product (product_id),
      KEY idx_stock_adj_created_at (created_at),
      KEY idx_stock_adj_created_by (created_by_user_id),
      CONSTRAINT fk_stock_adj_product
        FOREIGN KEY (product_id) REFERENCES products(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
      CONSTRAINT fk_stock_adj_user
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS invoice_groups (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NULL,
      name VARCHAR(255) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_invoice_groups_code (code),
      KEY idx_invoice_groups_active_name (is_active, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`
  );

  await addColumnIfMissing('invoices', 'invoice_group_id', 'INT UNSIGNED NULL', 'opiekun_id');
  await addIndexIfMissing('invoices', 'idx_invoices_invoice_group', 'INDEX `idx_invoices_invoice_group` (`invoice_group_id`)');
  await addConstraintIfMissing(
    'invoices',
    'fk_invoices_invoice_group',
    'FOREIGN KEY (`invoice_group_id`) REFERENCES `invoice_groups`(`id`) ON UPDATE CASCADE ON DELETE SET NULL'
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS cost_entries (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      cost_date DATE NOT NULL,
      amount_original DECIMAL(12,2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'PLN',
      exchange_rate_to_pln DECIMAL(14,6) NOT NULL DEFAULT 1.000000,
      amount_pln DECIMAL(12,2) NOT NULL,
      notes TEXT NULL,
      invoice_group_id INT UNSIGNED NULL,
      created_by_user_id INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_cost_entries_date (cost_date),
      KEY idx_cost_entries_group_date (invoice_group_id, cost_date),
      KEY idx_cost_entries_created_by (created_by_user_id),
      CONSTRAINT fk_cost_entries_group
        FOREIGN KEY (invoice_group_id) REFERENCES invoice_groups(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
      CONSTRAINT fk_cost_entries_user
        FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS cost_entry_invoices (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      cost_entry_id INT UNSIGNED NOT NULL,
      invoice_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cost_entry_invoice (cost_entry_id, invoice_id),
      KEY idx_cost_entry_invoices_cost (cost_entry_id),
      KEY idx_cost_entry_invoices_invoice (invoice_id),
      CONSTRAINT fk_cost_entry_invoices_cost
        FOREIGN KEY (cost_entry_id) REFERENCES cost_entries(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
      CONSTRAINT fk_cost_entry_invoices_invoice
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS cost_documents (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      cost_entry_id INT UNSIGNED NOT NULL,
      original_name VARCHAR(500) NOT NULL,
      stored_name VARCHAR(500) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      size_bytes BIGINT UNSIGNED NOT NULL,
      parse_result_json LONGTEXT NULL,
      parse_confidence DECIMAL(5,4) NULL,
      uploaded_by_user_id INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_cost_documents_cost (cost_entry_id),
      KEY idx_cost_documents_uploaded_by (uploaded_by_user_id),
      CONSTRAINT fk_cost_documents_cost
        FOREIGN KEY (cost_entry_id) REFERENCES cost_entries(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
      CONSTRAINT fk_cost_documents_user
        FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`
  );
}
