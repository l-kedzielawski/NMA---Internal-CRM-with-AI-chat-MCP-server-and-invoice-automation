import type { RowDataPacket } from 'mysql2';
import { pool } from '../config/database';

const CRM_TABLE_QUERIES: string[] = [
  `CREATE TABLE IF NOT EXISTS crm_leads (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(100) NULL,
    first_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    email VARCHAR(255) NULL,
    company_type VARCHAR(150) NULL,
    contact_position VARCHAR(150) NULL,
    website VARCHAR(255) NULL,
    status VARCHAR(100) NULL,
    lost_reason_code VARCHAR(60) NULL,
    lead_owner VARCHAR(100) NULL,
    location VARCHAR(255) NULL,
    company_address TEXT NULL,
    delivery_address TEXT NULL,
    company_size VARCHAR(100) NULL,
    source_channel VARCHAR(100) NULL,
    notes TEXT NULL,
    pipeline_type ENUM('cold_lead', 'contact') NOT NULL DEFAULT 'cold_lead',
    region VARCHAR(20) NOT NULL DEFAULT 'OTHER',
    country_code VARCHAR(20) NULL,
    phone VARCHAR(100) NULL,
    source_file VARCHAR(255) NULL,
    source_row INT NULL,
    created_by VARCHAR(100) NULL,
    updated_by VARCHAR(100) NULL,
    last_contact_at DATETIME NULL,
    email_normalized VARCHAR(255) NULL,
    phone_normalized VARCHAR(64) NULL,
    website_domain VARCHAR(255) NULL,
    company_name_normalized VARCHAR(255) NULL,
    dedupe_key VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_leads_email_normalized (email_normalized),
    UNIQUE KEY uq_crm_leads_dedupe_key (dedupe_key),
    KEY idx_crm_leads_pipeline_status (pipeline_type, status),
    KEY idx_crm_leads_region_country (region, country_code),
    KEY idx_crm_leads_owner (lead_owner),
    KEY idx_crm_leads_company_norm (company_name_normalized)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`,

  `CREATE TABLE IF NOT EXISTS crm_activities (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    lead_id INT UNSIGNED NOT NULL,
    activity_type ENUM('note', 'call', 'email', 'meeting', 'import') NOT NULL DEFAULT 'note',
    note TEXT NOT NULL,
    activity_at DATETIME NOT NULL,
    created_by VARCHAR(100) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_crm_activities_lead_date (lead_id, activity_at),
    CONSTRAINT fk_crm_activities_lead
      FOREIGN KEY (lead_id) REFERENCES crm_leads(id)
      ON UPDATE CASCADE
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`,

  `CREATE TABLE IF NOT EXISTS crm_import_jobs (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    source_region VARCHAR(20) NULL,
    pipeline_type_default ENUM('cold_lead', 'contact') NOT NULL DEFAULT 'cold_lead',
    imported_by VARCHAR(100) NULL,
    total_rows INT NOT NULL DEFAULT 0,
    created_count INT NOT NULL DEFAULT 0,
    updated_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    status ENUM('processing', 'completed', 'failed') NOT NULL DEFAULT 'processing',
    error_summary TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL DEFAULT NULL,
    KEY idx_crm_import_jobs_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`,

  `CREATE TABLE IF NOT EXISTS crm_import_rows (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id INT UNSIGNED NOT NULL,
    \`row_number\` INT NOT NULL,
    \`action\` ENUM('created', 'updated', 'skipped', 'error') NOT NULL,
    lead_id INT UNSIGNED NULL,
    status_message VARCHAR(500) NULL,
    raw_data_json LONGTEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_crm_import_rows_job (job_id),
    KEY idx_crm_import_rows_action (\`action\`),
    CONSTRAINT fk_crm_import_rows_job
      FOREIGN KEY (job_id) REFERENCES crm_import_jobs(id)
      ON UPDATE CASCADE
      ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`,

  `CREATE TABLE IF NOT EXISTS crm_lead_tasks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    lead_id INT UNSIGNED NULL,
    assigned_user_id INT UNSIGNED NOT NULL,
    created_by_user_id INT UNSIGNED NULL,
    title VARCHAR(255) NOT NULL,
    item_kind ENUM('task', 'event') NOT NULL DEFAULT 'task',
    task_type ENUM('meeting', 'call', 'email', 'follow_up', 'next_contact', 'other') NOT NULL DEFAULT 'follow_up',
    status ENUM('planned', 'completed', 'cancelled') NOT NULL DEFAULT 'planned',
    description TEXT NULL,
    due_at DATETIME NOT NULL,
    remind_at DATETIME NULL,
    recurrence_type ENUM('none', 'daily', 'weekly', 'monthly') NOT NULL DEFAULT 'none',
    recurrence_interval INT UNSIGNED NOT NULL DEFAULT 1,
    recurrence_until DATETIME NULL,
    recurrence_parent_task_id INT UNSIGNED NULL,
    completed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_crm_lead_tasks_lead_due (lead_id, due_at),
    KEY idx_crm_lead_tasks_user_due (assigned_user_id, due_at),
    KEY idx_crm_lead_tasks_status_due (status, due_at),
    KEY idx_crm_lead_tasks_recurrence (recurrence_type, recurrence_parent_task_id),
    CONSTRAINT fk_crm_lead_tasks_lead
      FOREIGN KEY (lead_id) REFERENCES crm_leads(id)
      ON UPDATE CASCADE
      ON DELETE CASCADE,
    CONSTRAINT fk_crm_lead_tasks_assigned_user
      FOREIGN KEY (assigned_user_id) REFERENCES users(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT,
    CONSTRAINT fk_crm_lead_tasks_created_user
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL,
    CONSTRAINT fk_crm_lead_tasks_parent
      FOREIGN KEY (recurrence_parent_task_id) REFERENCES crm_lead_tasks(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`,

  `CREATE TABLE IF NOT EXISTS crm_duplicate_cases (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    existing_lead_id INT UNSIGNED NOT NULL,
    requested_action ENUM('merge', 'keep_separate', 'request_handover') NOT NULL,
    candidate_company_name VARCHAR(255) NULL,
    candidate_email VARCHAR(255) NULL,
    candidate_phone VARCHAR(100) NULL,
    candidate_payload_json LONGTEXT NULL,
    reason TEXT NULL,
    requested_by_user_id INT UNSIGNED NOT NULL,
    requested_owner_user_id INT UNSIGNED NULL,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    resolved_note TEXT NULL,
    resolved_by_user_id INT UNSIGNED NULL,
    resolved_lead_id INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL DEFAULT NULL,
    KEY idx_crm_duplicate_cases_status (status),
    KEY idx_crm_duplicate_cases_existing (existing_lead_id),
    KEY idx_crm_duplicate_cases_requested_by (requested_by_user_id),
    CONSTRAINT fk_crm_duplicate_cases_existing_lead
      FOREIGN KEY (existing_lead_id) REFERENCES crm_leads(id)
      ON UPDATE CASCADE
      ON DELETE CASCADE,
    CONSTRAINT fk_crm_duplicate_cases_requested_by
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT,
    CONSTRAINT fk_crm_duplicate_cases_requested_owner
      FOREIGN KEY (requested_owner_user_id) REFERENCES users(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL,
    CONSTRAINT fk_crm_duplicate_cases_resolved_by
      FOREIGN KEY (resolved_by_user_id) REFERENCES users(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL,
    CONSTRAINT fk_crm_duplicate_cases_resolved_lead
      FOREIGN KEY (resolved_lead_id) REFERENCES crm_leads(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`,

  `CREATE TABLE IF NOT EXISTS crm_lead_products (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    lead_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NULL,
    product_name VARCHAR(255) NULL,
    relation_type ENUM('interested_in', 'currently_using') NOT NULL DEFAULT 'interested_in',
    volume_text VARCHAR(120) NULL,
    offered_price DECIMAL(12,2) NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'PLN',
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_crm_lead_products_lead (lead_id),
    KEY idx_crm_lead_products_product (product_id),
    CONSTRAINT fk_crm_lead_products_lead
      FOREIGN KEY (lead_id) REFERENCES crm_leads(id)
      ON UPDATE CASCADE
      ON DELETE CASCADE,
    CONSTRAINT fk_crm_lead_products_product
      FOREIGN KEY (product_id) REFERENCES products(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`
];

interface RequiredColumn {
  tableName: string;
  columnName: string;
  definition: string;
}

const CRM_REQUIRED_COLUMNS: RequiredColumn[] = [
  { tableName: 'crm_leads', columnName: 'tax_id', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'first_name', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'last_name', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'email', definition: 'VARCHAR(255) NULL' },
  { tableName: 'crm_leads', columnName: 'company_type', definition: 'VARCHAR(150) NULL' },
  { tableName: 'crm_leads', columnName: 'contact_position', definition: 'VARCHAR(150) NULL' },
  { tableName: 'crm_leads', columnName: 'website', definition: 'VARCHAR(255) NULL' },
  { tableName: 'crm_leads', columnName: 'status', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'lost_reason_code', definition: 'VARCHAR(60) NULL' },
  { tableName: 'crm_leads', columnName: 'lead_owner', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'location', definition: 'VARCHAR(255) NULL' },
  { tableName: 'crm_leads', columnName: 'company_address', definition: 'TEXT NULL' },
  { tableName: 'crm_leads', columnName: 'delivery_address', definition: 'TEXT NULL' },
  { tableName: 'crm_leads', columnName: 'company_size', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'source_channel', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'notes', definition: 'TEXT NULL' },
  {
    tableName: 'crm_leads',
    columnName: 'pipeline_type',
    definition: "ENUM('cold_lead', 'contact') NOT NULL DEFAULT 'cold_lead'"
  },
  { tableName: 'crm_leads', columnName: 'region', definition: "VARCHAR(20) NOT NULL DEFAULT 'OTHER'" },
  { tableName: 'crm_leads', columnName: 'country_code', definition: 'VARCHAR(20) NULL' },
  { tableName: 'crm_leads', columnName: 'phone', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'source_file', definition: 'VARCHAR(255) NULL' },
  { tableName: 'crm_leads', columnName: 'source_row', definition: 'INT NULL' },
  { tableName: 'crm_leads', columnName: 'created_by', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'updated_by', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_leads', columnName: 'last_contact_at', definition: 'DATETIME NULL' },
  { tableName: 'crm_leads', columnName: 'email_normalized', definition: 'VARCHAR(255) NULL' },
  { tableName: 'crm_leads', columnName: 'phone_normalized', definition: 'VARCHAR(64) NULL' },
  { tableName: 'crm_leads', columnName: 'website_domain', definition: 'VARCHAR(255) NULL' },
  { tableName: 'crm_leads', columnName: 'company_name_normalized', definition: 'VARCHAR(255) NULL' },
  { tableName: 'crm_leads', columnName: 'dedupe_key', definition: 'VARCHAR(255) NULL' },
  { tableName: 'crm_leads', columnName: 'lead_score', definition: 'INT NOT NULL DEFAULT 0' },
  { tableName: 'crm_leads', columnName: 'hot_rank', definition: 'TINYINT UNSIGNED NULL' },
  {
    tableName: 'crm_leads',
    columnName: 'priority_bucket',
    definition: "ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium'"
  },
  { tableName: 'crm_leads', columnName: 'score_updated_at', definition: 'DATETIME NULL' },
  { tableName: 'crm_leads', columnName: 'created_at', definition: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' },
  {
    tableName: 'crm_leads',
    columnName: 'updated_at',
    definition: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
  },
  { tableName: 'crm_import_jobs', columnName: 'source_region', definition: 'VARCHAR(20) NULL' },
  {
    tableName: 'crm_import_jobs',
    columnName: 'pipeline_type_default',
    definition: "ENUM('cold_lead', 'contact') NOT NULL DEFAULT 'cold_lead'"
  },
  { tableName: 'crm_import_jobs', columnName: 'imported_by', definition: 'VARCHAR(100) NULL' },
  { tableName: 'crm_import_jobs', columnName: 'total_rows', definition: 'INT NOT NULL DEFAULT 0' },
  { tableName: 'crm_import_jobs', columnName: 'created_count', definition: 'INT NOT NULL DEFAULT 0' },
  { tableName: 'crm_import_jobs', columnName: 'updated_count', definition: 'INT NOT NULL DEFAULT 0' },
  { tableName: 'crm_import_jobs', columnName: 'skipped_count', definition: 'INT NOT NULL DEFAULT 0' },
  { tableName: 'crm_import_jobs', columnName: 'error_count', definition: 'INT NOT NULL DEFAULT 0' },
  {
    tableName: 'crm_import_jobs',
    columnName: 'status',
    definition: "ENUM('processing', 'completed', 'failed') NOT NULL DEFAULT 'processing'"
  },
  { tableName: 'crm_import_jobs', columnName: 'error_summary', definition: 'TEXT NULL' },
  { tableName: 'crm_import_jobs', columnName: 'finished_at', definition: 'TIMESTAMP NULL DEFAULT NULL' },
  {
    tableName: 'crm_lead_tasks',
    columnName: 'item_kind',
    definition: "ENUM('task', 'event') NOT NULL DEFAULT 'task'"
  },
  {
    tableName: 'crm_lead_tasks',
    columnName: 'recurrence_type',
    definition: "ENUM('none', 'daily', 'weekly', 'monthly') NOT NULL DEFAULT 'none'"
  },
  {
    tableName: 'crm_lead_tasks',
    columnName: 'recurrence_interval',
    definition: 'INT UNSIGNED NOT NULL DEFAULT 1'
  },
  {
    tableName: 'crm_lead_tasks',
    columnName: 'recurrence_until',
    definition: 'DATETIME NULL'
  },
  {
    tableName: 'crm_lead_tasks',
    columnName: 'recurrence_parent_task_id',
    definition: 'INT UNSIGNED NULL'
  }
];

async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function ensureCrmColumns(): Promise<void> {
  for (const column of CRM_REQUIRED_COLUMNS) {
    const exists = await hasColumn(column.tableName, column.columnName);
    if (exists) continue;

    await pool.query(
      `ALTER TABLE ${column.tableName} ADD COLUMN ${column.columnName} ${column.definition}`
    );
  }
}

async function ensureLeadTaskLeadNullable(): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT is_nullable
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'crm_lead_tasks'
       AND column_name = 'lead_id'
     LIMIT 1`
  );

  const isNullable = String(rows[0]?.is_nullable || '').toUpperCase() === 'YES';
  if (isNullable) return;

  await pool.query('ALTER TABLE crm_lead_tasks MODIFY COLUMN lead_id INT UNSIGNED NULL');
}

export async function ensureCrmSchema(): Promise<void> {
  for (const query of CRM_TABLE_QUERIES) {
    await pool.query(query);
  }

  await ensureCrmColumns();
  await ensureLeadTaskLeadNullable();
}
