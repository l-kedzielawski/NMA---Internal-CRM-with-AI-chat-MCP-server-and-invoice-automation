import { pool } from '../config/database';
import bcrypt from 'bcrypt';

const USER_TABLE_QUERY = `
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

const OPIEKUNOWIE_TABLE_QUERY = `
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci
`;

const APP_AUDIT_LOGS_TABLE_QUERY = `
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

export async function ensureUserSchema(): Promise<void> {
  try {
    // Create users table
    await pool.query(USER_TABLE_QUERY);
    console.log('✓ Users table ready');

    await pool.query(
      "ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'manager', 'bookkeeping', 'seller') NOT NULL DEFAULT 'seller'"
    );

    await pool.query(APP_AUDIT_LOGS_TABLE_QUERY);
    console.log('✓ App audit logs table ready');
    
    // Create opiekunowie table
    await pool.query(OPIEKUNOWIE_TABLE_QUERY);
    console.log('✓ Opiekunowie table ready');

    const [userIdColRows] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opiekunowie' AND COLUMN_NAME = 'user_id'`
    );
    if ((userIdColRows as any[]).length === 0) {
      await pool.query('ALTER TABLE opiekunowie ADD COLUMN user_id INT UNSIGNED NULL AFTER email');
    }

    const [userLinkIndexRows] = await pool.query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'opiekunowie'
         AND INDEX_NAME = 'uq_opiekunowie_user_id'`
    );

    if ((userLinkIndexRows as any[]).length === 0) {
      await pool.query(
        'ALTER TABLE opiekunowie ADD UNIQUE KEY uq_opiekunowie_user_id (user_id)'
      );
    }

    const [userLinkConstraintRows] = await pool.query(
      `SELECT CONSTRAINT_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'opiekunowie'
         AND CONSTRAINT_NAME = 'fk_opiekunowie_user'`
    );

    if ((userLinkConstraintRows as any[]).length === 0) {
      await pool.query(
        `ALTER TABLE opiekunowie
         ADD CONSTRAINT fk_opiekunowie_user
         FOREIGN KEY (user_id) REFERENCES users(id)
         ON UPDATE CASCADE
         ON DELETE SET NULL`
      );
    }

    await pool.query(
      `UPDATE opiekunowie o
       JOIN users u
         ON LOWER(TRIM(o.email)) COLLATE utf8mb4_general_ci
         = LOWER(TRIM(u.email)) COLLATE utf8mb4_general_ci
       SET o.user_id = u.id
       WHERE o.user_id IS NULL
         AND o.email IS NOT NULL
         AND o.email <> ''`
    );
    
    // Create default admin user if no users exist
    const [users] = await pool.query('SELECT COUNT(*) as count FROM users');
    const userCount = (users as any)[0].count;
    
    if (userCount === 0) {
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
      
      await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, role)
         VALUES (?, ?, ?, ?, ?)`,
        ['admin', 'admin@profitcalculator.com', passwordHash, 'Administrator', 'admin']
      );
      
      console.log('✓ Default admin user created');
      console.log('  Username: admin');
      console.log('  Password:', defaultPassword);
      console.log('  ⚠️  PLEASE CHANGE THIS PASSWORD IMMEDIATELY!');
    }
    
    // Check if opiekun_id column exists in invoices table
    const [columns] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'invoices' 
       AND COLUMN_NAME = 'opiekun_id'`
    );
    
    if ((columns as any[]).length === 0) {
      // Add opiekun_id column and foreign key
      await pool.query(
        'ALTER TABLE invoices ADD COLUMN opiekun_id INT UNSIGNED NULL AFTER opiekun'
      );
      await pool.query(
        'ALTER TABLE invoices ADD INDEX idx_invoices_opiekun (opiekun_id)'
      );
      await pool.query(
        `ALTER TABLE invoices ADD CONSTRAINT fk_invoices_opiekun 
         FOREIGN KEY (opiekun_id) REFERENCES opiekunowie(id) 
         ON UPDATE CASCADE ON DELETE SET NULL`
      );
      console.log('✓ Added opiekun_id column to invoices');
    }

    await pool.query(
      `CREATE TABLE IF NOT EXISTS invoice_manager_splits (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        invoice_id INT UNSIGNED NOT NULL,
        opiekun_id INT UNSIGNED NOT NULL,
        commission_percent DECIMAL(6,2) NOT NULL,
        commission_amount DECIMAL(12,2) NULL,
        sort_order TINYINT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_invoice_manager_split (invoice_id, opiekun_id),
        KEY idx_invoice_manager_splits_invoice (invoice_id),
        KEY idx_invoice_manager_splits_opiekun (opiekun_id),
        CONSTRAINT fk_invoice_manager_splits_invoice
          FOREIGN KEY (invoice_id) REFERENCES invoices(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        CONSTRAINT fk_invoice_manager_splits_opiekun
          FOREIGN KEY (opiekun_id) REFERENCES opiekunowie(id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci`
    );

    await pool.query(
      `INSERT INTO invoice_manager_splits (invoice_id, opiekun_id, commission_percent, commission_amount, sort_order)
       SELECT
         i.id,
         i.opiekun_id,
         COALESCE(o.marza_procent, 0),
         i.prowizja_opiekuna,
         1
       FROM invoices i
       JOIN opiekunowie o ON o.id = i.opiekun_id
       WHERE i.opiekun_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM invoice_manager_splits ims
           WHERE ims.invoice_id = i.id
         )`
    );
     
  } catch (error) {
    console.error('Error ensuring user schema:', error);
    throw error;
  }
}
