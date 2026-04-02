-- Schema for Profit Calculator (local dev)
-- Safe to re-run; uses IF NOT EXISTS where possible

CREATE DATABASE IF NOT EXISTS app_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_polish_ci;

USE app_db;

-- Users (Authentication & Authorization)
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role ENUM('admin', 'manager', 'bookkeeping', 'seller') NOT NULL DEFAULT 'seller',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- App audit logs
CREATE TABLE IF NOT EXISTS app_audit_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  username VARCHAR(100) NULL,
  full_name VARCHAR(255) NULL,
  user_role ENUM('admin', 'manager', 'bookkeeping', 'seller') NULL,
  event_type VARCHAR(100) NOT NULL,
  method VARCHAR(10) NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  status_code SMALLINT UNSIGNED NOT NULL,
  ip_address VARCHAR(100) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_app_audit_logs_created_at (created_at),
  KEY idx_app_audit_logs_user (user_id),
  KEY idx_app_audit_logs_event_type (event_type),
  KEY idx_app_audit_logs_method (method),
  CONSTRAINT fk_app_audit_logs_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Opiekunowie (Account managers)
CREATE TABLE IF NOT EXISTS opiekunowie (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  imie VARCHAR(100) NOT NULL,
  nazwisko VARCHAR(100) NULL,
  email VARCHAR(255) NULL,
  user_id INT UNSIGNED NULL,
  telefon VARCHAR(50) NULL,
  marza_procent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  aktywny TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_opiekunowie_email (email),
  UNIQUE KEY uq_opiekunowie_user_id (user_id),
  CONSTRAINT fk_opiekunowie_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  KEY idx_opiekunowie_aktywny (aktywny)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nazwa VARCHAR(255) NOT NULL,
  nip VARCHAR(32) NULL,
  ulica VARCHAR(255) NULL,
  kod_pocztowy VARCHAR(16) NULL,
  miasto VARCHAR(100) NULL,
  kraj VARCHAR(100) NOT NULL DEFAULT 'Polska',
  email VARCHAR(255) NULL,
  telefon VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customers_nip (nip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Products
CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(50) NULL,
  gtin VARCHAR(32) NULL,
  nazwa VARCHAR(255) NOT NULL,
  cena_zakupu DECIMAL(12,2) NULL,
  cena_sprzedazy_rekomendowana DECIMAL(12,2) NULL,
  stawka_vat DECIMAL(5,2) NULL,
  kategoria VARCHAR(100) NULL,
  jednostka VARCHAR(20) NULL,
  stan_magazynowy DECIMAL(12,3) NULL,
  additional_info TEXT NULL,
  aktywny TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_products_sku (sku),
  UNIQUE KEY uq_products_gtin (gtin),
  KEY idx_products_nazwa (nazwa)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Product pricing tiers (offer ladders)
CREATE TABLE IF NOT EXISTS product_price_tiers (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Product stock adjustments (manual reductions: damaged, sample, lost, etc.)
CREATE TABLE IF NOT EXISTS product_stock_adjustments (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Invoices
CREATE TABLE IF NOT EXISTS invoice_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NULL,
  name VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_groups_code (code),
  KEY idx_invoice_groups_active_name (is_active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numer_faktury VARCHAR(100) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  data_wystawienia DATE DEFAULT NULL,
  data_sprzedazy DATE DEFAULT NULL,
  termin_platnosci DATE DEFAULT NULL,
  forma_platnosci VARCHAR(50) DEFAULT NULL,
  waluta VARCHAR(3) NOT NULL DEFAULT 'PLN',
  kurs_waluty DECIMAL(10,4) NOT NULL DEFAULT 1.0000,
  netto DECIMAL(12,2) DEFAULT NULL,
  vat DECIMAL(12,2) DEFAULT NULL,
  brutto DECIMAL(12,2) DEFAULT NULL,
  zaplacono DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status_platnosci ENUM('oplacona','nieoplacona','czesciowa','zwrot') DEFAULT 'nieoplacona',
  opiekun VARCHAR(100) DEFAULT NULL,
  opiekun_id INT UNSIGNED NULL,
  invoice_group_id INT UNSIGNED NULL,
  koszt_logistyki DECIMAL(12,2) DEFAULT NULL,
  zysk DECIMAL(12,2) DEFAULT NULL,
  marza_procent DECIMAL(7,4) DEFAULT NULL,
  pdf_path VARCHAR(255) DEFAULT NULL,
  uwagi TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoices_numer (numer_faktury),
  KEY idx_invoices_customer (customer_id),
  KEY idx_invoices_opiekun (opiekun_id),
  KEY idx_invoices_invoice_group (invoice_group_id),
  KEY idx_invoices_dates (data_wystawienia, data_sprzedazy),
  KEY idx_invoices_customer_date (customer_id, data_wystawienia),
  KEY idx_invoices_opiekun_date (opiekun_id, data_wystawienia),
  CONSTRAINT fk_invoices_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_opiekun
    FOREIGN KEY (opiekun_id) REFERENCES opiekunowie(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_invoices_invoice_group
    FOREIGN KEY (invoice_group_id) REFERENCES invoice_groups(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Invoice items
CREATE TABLE IF NOT EXISTS invoice_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NULL,
  lp INT NULL,
  nazwa VARCHAR(255) NOT NULL,
  ilosc DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  jednostka VARCHAR(20) NULL,
  cena_netto DECIMAL(12,2) NULL,
  stawka_vat DECIMAL(5,2) NULL,
  wartosc_netto DECIMAL(12,2) NULL,
  wartosc_vat DECIMAL(12,2) NULL,
  wartosc_brutto DECIMAL(12,2) NULL,
  cena_zakupu DECIMAL(12,2) NULL,
  koszt_calkowity DECIMAL(12,2) NULL,
  zysk DECIMAL(12,2) NULL,
  marza_procent DECIMAL(7,4) NULL,
  is_shipping TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_items_invoice (invoice_id),
  KEY idx_items_product (product_id),
  KEY idx_items_nazwa (nazwa),
  CONSTRAINT fk_items_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_items_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Additional cost entries tied to invoice groups and/or invoices
CREATE TABLE IF NOT EXISTS cost_entries (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Junction table for linking one cost entry to many invoices
CREATE TABLE IF NOT EXISTS cost_entry_invoices (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Uploaded vendor documents attached to cost entries
CREATE TABLE IF NOT EXISTS cost_documents (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- CRM leads
CREATE TABLE IF NOT EXISTS crm_leads (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  email VARCHAR(255) NULL,
  title VARCHAR(150) NULL,
  website VARCHAR(255) NULL,
  status VARCHAR(100) NULL,
  lead_owner VARCHAR(100) NULL,
  location VARCHAR(255) NULL,
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
  next_action_at DATETIME NULL,
  email_normalized VARCHAR(255) NULL,
  phone_normalized VARCHAR(64) NULL,
  website_domain VARCHAR(255) NULL,
  company_name_normalized VARCHAR(255) NULL,
  dedupe_key VARCHAR(255) NULL,
  lead_score INT NOT NULL DEFAULT 0,
  priority_bucket ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
  score_updated_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_leads_email_normalized (email_normalized),
  UNIQUE KEY uq_crm_leads_dedupe_key (dedupe_key),
  KEY idx_crm_leads_pipeline_status (pipeline_type, status),
  KEY idx_crm_leads_region_country (region, country_code),
  KEY idx_crm_leads_owner (lead_owner),
  KEY idx_crm_leads_company_norm (company_name_normalized)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- CRM activities
CREATE TABLE IF NOT EXISTS crm_activities (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- CRM import jobs
CREATE TABLE IF NOT EXISTS crm_import_jobs (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- CRM import rows (audit)
CREATE TABLE IF NOT EXISTS crm_import_rows (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id INT UNSIGNED NOT NULL,
  `row_number` INT NOT NULL,
  `action` ENUM('created', 'updated', 'skipped', 'error') NOT NULL,
  lead_id INT UNSIGNED NULL,
  status_message VARCHAR(500) NULL,
  raw_data_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_crm_import_rows_job (job_id),
  KEY idx_crm_import_rows_action (`action`),
  CONSTRAINT fk_crm_import_rows_job
    FOREIGN KEY (job_id) REFERENCES crm_import_jobs(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- CRM lead tasks/events calendar
CREATE TABLE IF NOT EXISTS crm_lead_tasks (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- CRM duplicate and ownership workflow cases
CREATE TABLE IF NOT EXISTS crm_duplicate_cases (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- CRM lead products (interested/using with volume and offered price)
CREATE TABLE IF NOT EXISTS crm_lead_products (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Additional Performance Indexes
CREATE INDEX IF NOT EXISTS idx_products_nazwa_active ON products(nazwa, aktywny);
CREATE INDEX IF NOT EXISTS idx_customers_nip_nazwa ON customers(nip, nazwa);
CREATE INDEX IF NOT EXISTS idx_crm_leads_region_status_pipeline ON crm_leads(region, status, pipeline_type);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_invoice ON invoice_items(product_id, invoice_id);
