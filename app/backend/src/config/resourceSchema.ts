import { pool } from './database';
import type { RowDataPacket } from 'mysql2';

interface ExistsRow extends RowDataPacket {
  count: number;
}

interface CategoryCodeRow extends RowDataPacket {
  category: string;
}

async function tableColumnExists(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query<ExistsRow[]>(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );

  return rows[0]?.count > 0;
}

async function tableIndexExists(tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query<ExistsRow[]>(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );

  return rows[0]?.count > 0;
}

async function tableConstraintExists(tableName: string, constraintName: string): Promise<boolean> {
  const [rows] = await pool.query<ExistsRow[]>(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?`,
    [tableName, constraintName]
  );

  return rows[0]?.count > 0;
}

function normalizeCategoryCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function categoryCodeToName(code: string): string {
  return code
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Ensures resource templates and translations schema exists
 */
export async function ensureResourceSchema(): Promise<void> {
  try {
    // Create resource categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resource_categories (
        code VARCHAR(50) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      INSERT IGNORE INTO resource_categories (code, name) VALUES
      ('price', 'Price Objections'),
      ('timing', 'Timing Objections'),
      ('competitor', 'Competitor Objections'),
      ('authority', 'Authority Objections'),
      ('trust', 'Trust & Credibility')
    `);

    // Create resource_templates table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resource_templates (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        tags JSON,
        created_by_user_id INT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category (category),
        INDEX idx_created_at (created_at),
        INDEX idx_created_by (created_by_user_id),
        CONSTRAINT fk_resource_templates_user
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migration safety for existing databases:
    // older installs may miss created_by_user_id due unsupported IF NOT EXISTS syntax.
    const hasCreatedByUserId = await tableColumnExists('resource_templates', 'created_by_user_id');

    if (!hasCreatedByUserId) {
      await pool.query(
        'ALTER TABLE resource_templates ADD COLUMN created_by_user_id INT UNSIGNED NULL AFTER tags'
      );
    } else {
      await pool.query(
        'ALTER TABLE resource_templates MODIFY COLUMN created_by_user_id INT UNSIGNED NULL'
      );
    }

    const hasCreatedByIndex = await tableIndexExists('resource_templates', 'idx_created_by');
    if (!hasCreatedByIndex) {
      await pool.query('ALTER TABLE resource_templates ADD INDEX idx_created_by (created_by_user_id)');
    }

    await pool.query(`
      UPDATE resource_templates rt
      LEFT JOIN users u ON rt.created_by_user_id = u.id
      SET rt.created_by_user_id = NULL
      WHERE rt.created_by_user_id IS NOT NULL
        AND u.id IS NULL
    `);

    const hasCreatedByFk = await tableConstraintExists('resource_templates', 'fk_resource_templates_user');
    if (!hasCreatedByFk) {
      await pool.query(`
        ALTER TABLE resource_templates
        ADD CONSTRAINT fk_resource_templates_user
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      `);
    }

    // Backfill dynamic categories from existing template rows.
    const [categoryRows] = await pool.query<CategoryCodeRow[]>(
      `SELECT DISTINCT category
       FROM resource_templates
       WHERE category IS NOT NULL
         AND TRIM(category) <> ''`
    );

    for (const row of categoryRows) {
      const normalizedCode = normalizeCategoryCode(row.category);
      if (!normalizedCode) {
        continue;
      }

      if (normalizedCode !== row.category) {
        await pool.query(
          'UPDATE resource_templates SET category = ? WHERE category = ?',
          [normalizedCode, row.category]
        );
      }

      await pool.query(
        'INSERT IGNORE INTO resource_categories (code, name) VALUES (?, ?)',
        [normalizedCode, categoryCodeToName(normalizedCode)]
      );
    }

    // Create translations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resource_template_translations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        template_id INT NOT NULL,
        language_code VARCHAR(10) NOT NULL,
        version_number INT UNSIGNED NOT NULL DEFAULT 1,
        version_label VARCHAR(120) NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES resource_templates(id) ON DELETE CASCADE,
        UNIQUE KEY unique_template_language_version (template_id, language_code, version_number),
        INDEX idx_language (language_code),
        INDEX idx_language_version (language_code, version_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const hasVersionNumber = await tableColumnExists('resource_template_translations', 'version_number');
    if (!hasVersionNumber) {
      await pool.query(
        'ALTER TABLE resource_template_translations ADD COLUMN version_number INT UNSIGNED NOT NULL DEFAULT 1 AFTER language_code'
      );
      await pool.query(
        `UPDATE resource_template_translations
         SET version_number = 1
         WHERE version_number IS NULL OR version_number < 1`
      );
    }

    const hasVersionLabel = await tableColumnExists('resource_template_translations', 'version_label');
    if (!hasVersionLabel) {
      await pool.query(
        'ALTER TABLE resource_template_translations ADD COLUMN version_label VARCHAR(120) NULL AFTER version_number'
      );
    }

    await pool.query(
      'ALTER TABLE resource_template_translations MODIFY COLUMN language_code VARCHAR(10) NOT NULL'
    );

    const hasLanguageVersionUnique = await tableIndexExists(
      'resource_template_translations',
      'unique_template_language_version'
    );
    if (!hasLanguageVersionUnique) {
      await pool.query(
        `ALTER TABLE resource_template_translations
         ADD UNIQUE KEY unique_template_language_version (template_id, language_code, version_number)`
      );
    }

    const hasTemplateIdIndex = await tableIndexExists('resource_template_translations', 'idx_template_id');
    if (!hasTemplateIdIndex) {
      await pool.query(
        'ALTER TABLE resource_template_translations ADD INDEX idx_template_id (template_id)'
      );
    }

    const hasOldUnique = await tableIndexExists('resource_template_translations', 'unique_template_language');
    if (hasOldUnique) {
      await pool.query('ALTER TABLE resource_template_translations DROP INDEX unique_template_language');
    }

    const hasLanguageVersionIndex = await tableIndexExists('resource_template_translations', 'idx_language_version');
    if (!hasLanguageVersionIndex) {
      await pool.query(
        'ALTER TABLE resource_template_translations ADD INDEX idx_language_version (language_code, version_number)'
      );
    }

    // Create supported languages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supported_languages (
        code VARCHAR(10) PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        native_name VARCHAR(50) NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query('ALTER TABLE supported_languages MODIFY COLUMN code VARCHAR(10) NOT NULL');

    // Check if languages are already seeded
    const [existingLangs] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM supported_languages'
    );

    if (existingLangs[0].count === 0) {
      // Insert initial languages
      await pool.query(`
        INSERT INTO supported_languages (code, name, native_name) VALUES
        ('en', 'English', 'English'),
        ('de', 'German', 'Deutsch'),
        ('fr', 'French', 'Français'),
        ('pl', 'Polish', 'Polski')
      `);
      console.log('✓ Seeded supported languages (EN, DE, FR, PL)');
    }

    // Create resource_files table (spec sheets, PDFs, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resource_files (
        id INT PRIMARY KEY AUTO_INCREMENT,
        original_name VARCHAR(500) NOT NULL,
        stored_name VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size_bytes BIGINT UNSIGNED NOT NULL,
        category VARCHAR(100) NULL,
        description VARCHAR(500) NULL,
        uploaded_by_user_id INT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_rf_category (category),
        INDEX idx_rf_created_at (created_at),
        INDEX idx_rf_uploaded_by (uploaded_by_user_id),
        CONSTRAINT fk_resource_files_user
          FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✓ Resource templates schema ready');
  } catch (error) {
    console.error('Error ensuring resource schema:', error);
    throw error;
  }
}
