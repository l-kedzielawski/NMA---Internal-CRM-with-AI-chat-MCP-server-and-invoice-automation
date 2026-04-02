import { Router } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../config/database';
import { RESOURCE_FILES_DIR, ensureStorageDirs } from '../services/fileStorage';
import { requireRole, type AuthUser } from '../middleware/auth';

const router = Router();

router.use(requireRole('admin', 'manager', 'seller'));

interface ResourceTemplateRow extends RowDataPacket {
  id: number;
  title: string;
  category: string;
  content: string;
  tags: string | null;
  translations: string | null;
  created_by_user_id: number | null;
  created_by_username: string | null;
  created_by_full_name: string | null;
  created_at: string;
  updated_at: string;
}

interface TranslationRow extends RowDataPacket {
  id: number;
  template_id: number;
  language_code: string;
  version_number: number;
  version_label: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface SupportedLanguageRow extends RowDataPacket {
  code: string;
  name: string;
  native_name: string;
  enabled: boolean;
}

interface ResourceCategoryRow extends RowDataPacket {
  code: string;
  name: string;
  template_count?: number;
  created_at: string;
}

interface CategoryCountRow extends RowDataPacket {
  count: number;
}

function normalizeCategoryCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  if (!normalized) {
    return null;
  }

  return normalized;
}

function normalizeCategoryName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    return null;
  }

  return normalized;
}

async function categoryExists(categoryCode: string): Promise<boolean> {
  const [rows] = await pool.query<CategoryCountRow[]>(
    'SELECT COUNT(*) AS count FROM resource_categories WHERE code = ?',
    [categoryCode]
  );

  return rows[0]?.count > 0;
}

function normalizeTags(rawTags: unknown): string[] | null {
  if (rawTags === undefined) {
    return null;
  }

  if (!Array.isArray(rawTags)) {
    return null;
  }

  const tags = rawTags
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter((tag) => tag.length > 0);

  return tags;
}

function parseTranslations(raw: string | null): TranslationRow[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed.filter((row) => row && typeof row === 'object') as TranslationRow[];
    return normalized.sort((a, b) => {
      if (a.language_code === b.language_code) {
        return Number(b.version_number || 1) - Number(a.version_number || 1);
      }
      return String(a.language_code).localeCompare(String(b.language_code));
    });
  } catch {
    return [];
  }
}

function normalizeVersionNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return Math.floor(parsed);
}

function normalizeVersionLabel(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > 120) {
    return normalized.slice(0, 120);
  }

  return normalized;
}

function parseStoredTags(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((tag): tag is string => typeof tag === 'string');
  } catch {
    return [];
  }
}

// GET /api/resources - List all templates with translations
router.get('/', async (req, res) => {
  try {
    const { category, search, created_by_user_id } = req.query;

    let sql = `
      SELECT rt.*, 
        u.username as created_by_username,
        u.full_name as created_by_full_name,
        (SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', rtt.id,
            'language_code', rtt.language_code,
            'version_number', rtt.version_number,
            'version_label', rtt.version_label,
            'title', rtt.title,
            'content', rtt.content
          )
        )
        FROM resource_template_translations rtt
        WHERE rtt.template_id = rt.id
      ) as translations
      FROM resource_templates rt
      LEFT JOIN users u ON rt.created_by_user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (category) {
      sql += ' AND rt.category = ?';
      params.push(category);
    }

    if (search) {
      sql += ' AND (rt.title LIKE ? OR rt.content LIKE ? OR JSON_SEARCH(rt.tags, "one", ?) IS NOT NULL)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (created_by_user_id !== undefined) {
      sql += ' AND rt.created_by_user_id = ?';
      params.push(created_by_user_id);
    }

    sql += ' ORDER BY rt.created_at DESC';

    const [rows] = await pool.query<ResourceTemplateRow[]>(sql, params);

    const templates = rows.map(row => ({
      id: row.id,
      title: row.title,
      category: row.category,
      content: row.content,
      tags: parseStoredTags(row.tags),
      created_by_user_id: row.created_by_user_id,
      created_by_username: row.created_by_username,
      created_by_full_name: row.created_by_full_name,
      translations: parseTranslations(row.translations),
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    res.json({ data: templates, total: templates.length });
  } catch (error) {
    console.error('Error fetching resource templates:', error);
    res.status(500).json({ error: 'Failed to fetch resource templates' });
  }
});

// GET /api/resources/categories - List all categories with usage counts
router.get('/categories/all', async (_req, res) => {
  try {
    const [rows] = await pool.query<ResourceCategoryRow[]>(`
      SELECT
        rc.code,
        rc.name,
        rc.created_at,
        COUNT(rt.id) AS template_count
      FROM resource_categories rc
      LEFT JOIN resource_templates rt ON rt.category = rc.code
      GROUP BY rc.code, rc.name, rc.created_at
      ORDER BY rc.name ASC
    `);

    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('Error fetching resource categories:', error);
    res.status(500).json({ error: 'Failed to fetch resource categories' });
  }
});

// POST /api/resources/categories - Create category
router.post('/categories/add', async (req, res) => {
  try {
    const normalizedCode = normalizeCategoryCode(req.body?.code);
    const normalizedName = normalizeCategoryName(req.body?.name);

    if (!normalizedCode || !normalizedName) {
      return res.status(400).json({ error: 'Valid category code and name are required' });
    }

    await pool.query(
      'INSERT INTO resource_categories (code, name) VALUES (?, ?)',
      [normalizedCode, normalizedName]
    );

    res.status(201).json({ message: 'Category added successfully', code: normalizedCode });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Category code already exists' });
    }
    console.error('Error adding category:', error);
    res.status(500).json({ error: 'Failed to add category' });
  }
});

// PUT /api/resources/categories/:code - Update category
router.put('/categories/:code', async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const currentCode = normalizeCategoryCode(req.params.code);
    const nextCodeInput = req.body?.code;
    const nextNameInput = req.body?.name;

    if (!currentCode) {
      return res.status(400).json({ error: 'Invalid category code in path' });
    }

    const nextCode = nextCodeInput === undefined ? currentCode : normalizeCategoryCode(nextCodeInput);
    const nextName = nextNameInput === undefined ? undefined : normalizeCategoryName(nextNameInput);

    if (nextCodeInput !== undefined && !nextCode) {
      return res.status(400).json({ error: 'Invalid new category code' });
    }

    if (nextNameInput !== undefined && !nextName) {
      return res.status(400).json({ error: 'Invalid new category name' });
    }

    if (nextCodeInput === undefined && nextNameInput === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await connection.beginTransaction();

    const [existingRows] = await connection.query<ResourceCategoryRow[]>(
      'SELECT code, name FROM resource_categories WHERE code = ? FOR UPDATE',
      [currentCode]
    );

    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Category not found' });
    }

    const existing = existingRows[0];
    const finalCode = nextCode || currentCode;
    const finalName = nextName || existing.name;

    await connection.query(
      'UPDATE resource_categories SET code = ?, name = ? WHERE code = ?',
      [finalCode, finalName, currentCode]
    );

    if (finalCode !== currentCode) {
      await connection.query(
        'UPDATE resource_templates SET category = ? WHERE category = ?',
        [finalCode, currentCode]
      );
    }

    await connection.commit();

    res.json({
      message: 'Category updated successfully',
      code: finalCode,
      previous_code: currentCode,
    });
  } catch (error: any) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Category code already exists' });
    }
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  } finally {
    connection.release();
  }
});

// DELETE /api/resources/categories/:code - Delete category
router.delete('/categories/:code', async (req, res) => {
  try {
    const categoryCode = normalizeCategoryCode(req.params.code);
    if (!categoryCode) {
      return res.status(400).json({ error: 'Invalid category code' });
    }

    const [usageRows] = await pool.query<CategoryCountRow[]>(
      'SELECT COUNT(*) AS count FROM resource_templates WHERE category = ?',
      [categoryCode]
    );

    const templatesUsingCategory = usageRows[0]?.count || 0;
    if (templatesUsingCategory > 0) {
      return res.status(400).json({ error: 'Cannot delete category that is used by templates' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM resource_categories WHERE code = ?',
      [categoryCode]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Resource Files (spec sheets, PDFs, etc.)
// Must be registered BEFORE /:id to avoid route conflict
// ──────────────────────────────────────────────────────────────────────────────

interface ResourceFileRow extends RowDataPacket {
  id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  category: string | null;
  description: string | null;
  uploaded_by_user_id: number | null;
  uploaded_by_username: string | null;
  uploaded_by_full_name: string | null;
  created_at: string;
  updated_at: string;
}

const ALLOWED_RESOURCE_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const resourceFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStorageDirs();
    cb(null, RESOURCE_FILES_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `res-${unique}${ext}`);
  },
});

const resourceFileUpload = multer({
  storage: resourceFileStorage,
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_RESOURCE_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

// GET /api/resources/files — list all uploaded files
router.get('/files', async (_req, res) => {
  try {
    const [rows] = await pool.query<ResourceFileRow[]>(`
      SELECT
        rf.id,
        rf.original_name,
        rf.stored_name,
        rf.mime_type,
        rf.size_bytes,
        rf.category,
        rf.description,
        rf.uploaded_by_user_id,
        u.username  AS uploaded_by_username,
        u.full_name AS uploaded_by_full_name,
        rf.created_at,
        rf.updated_at
      FROM resource_files rf
      LEFT JOIN users u ON rf.uploaded_by_user_id = u.id
      ORDER BY rf.created_at DESC
    `);
    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('Error listing resource files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// POST /api/resources/files — upload a new file
router.post('/files', resourceFileUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const { category, description } = req.body as { category?: string; description?: string };
  const userId = req.user?.id ?? null;
  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO resource_files
         (original_name, stored_name, mime_type, size_bytes, category, description, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, category || null, description || null, userId]
    );
    res.status(201).json({ id: result.insertId, message: 'File uploaded successfully' });
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    console.error('Error saving resource file record:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// PATCH /api/resources/files/:id — update metadata
router.patch('/files/:id', async (req, res) => {
  const fileId = parseInt(String(req.params.id));
  if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file id' });
  const { category, description } = req.body as { category?: string; description?: string };
  try {
    await pool.query(
      'UPDATE resource_files SET category = ?, description = ? WHERE id = ?',
      [category || null, description || null, fileId]
    );
    res.json({ message: 'File updated' });
  } catch (error) {
    console.error('Error updating resource file:', error);
    res.status(500).json({ error: 'Failed to update file' });
  }
});

// GET /api/resources/files/:id/download — stream file to client
router.get('/files/:id/download', async (req, res) => {
  const fileId = parseInt(String(req.params.id));
  if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file id' });
  try {
    const [rows] = await pool.query<ResourceFileRow[]>(
      'SELECT * FROM resource_files WHERE id = ?',
      [fileId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'File not found' });
    const file = rows[0];
    const filePath = path.join(RESOURCE_FILES_DIR, file.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File missing from storage' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
    res.setHeader('Content-Type', file.mime_type);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error downloading resource file:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// DELETE /api/resources/files/:id — delete file record + disk file
router.delete('/files/:id', async (req, res) => {
  const fileId = parseInt(String(req.params.id));
  if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file id' });
  try {
    const [rows] = await pool.query<ResourceFileRow[]>(
      'SELECT stored_name FROM resource_files WHERE id = ?',
      [fileId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'File not found' });
    const filePath = path.join(RESOURCE_FILES_DIR, rows[0].stored_name);
    await pool.query('DELETE FROM resource_files WHERE id = ?', [fileId]);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    res.json({ message: 'File deleted' });
  } catch (error) {
    console.error('Error deleting resource file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────

// GET /api/resources/:id - Get single template with all translations
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query<ResourceTemplateRow[]>(
      'SELECT * FROM resource_templates WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const template = rows[0];

    // Get all translations
    const [translations] = await pool.query<TranslationRow[]>(
      'SELECT * FROM resource_template_translations WHERE template_id = ? ORDER BY language_code, version_number DESC',
      [id]
    );

    res.json({
      id: template.id,
      title: template.title,
      category: template.category,
      content: template.content,
      tags: parseStoredTags(template.tags),
      translations: translations,
      created_at: template.created_at,
      updated_at: template.updated_at
    });
  } catch (error) {
    console.error('Error fetching resource template:', error);
    res.status(500).json({ error: 'Failed to fetch resource template' });
  }
});

// POST /api/resources - Create new template (English only initially)
router.post('/', async (req, res) => {
  try {
    const { title, category, content, tags } = req.body;
    const userId = req.user?.id ?? null;

    if (!title || !category || !content) {
      return res.status(400).json({ error: 'Title, category, and content are required' });
    }

    const normalizedCategory = normalizeCategoryCode(category);
    if (!normalizedCategory) {
      return res.status(400).json({ error: 'Invalid category value' });
    }

    const categoryIsSupported = await categoryExists(normalizedCategory);
    if (!categoryIsSupported) {
      return res.status(400).json({ error: 'Category does not exist' });
    }

    const normalizedTags = normalizeTags(tags);
    if (tags !== undefined && normalizedTags === null) {
      return res.status(400).json({ error: 'Tags must be an array of strings' });
    }

    const tagsJson = normalizedTags ? JSON.stringify(normalizedTags) : JSON.stringify([]);

    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO resource_templates (title, category, content, tags, created_by_user_id) VALUES (?, ?, ?, ?, ?)',
      [title, normalizedCategory, content, tagsJson, userId]
    );

    res.status(201).json({
      message: 'Template created successfully',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error creating resource template:', error);
    res.status(500).json({ error: 'Failed to create resource template' });
  }
});

// PUT /api/resources/:id - Update base template
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, content, tags } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (category !== undefined) {
      const normalizedCategory = normalizeCategoryCode(category);
      if (!normalizedCategory) {
        return res.status(400).json({ error: 'Invalid category value' });
      }

      const categoryIsSupported = await categoryExists(normalizedCategory);
      if (!categoryIsSupported) {
        return res.status(400).json({ error: 'Category does not exist' });
      }

      updates.push('category = ?');
      params.push(normalizedCategory);
    }
    if (content !== undefined) {
      updates.push('content = ?');
      params.push(content);
    }
    if (tags !== undefined) {
      const normalizedTags = normalizeTags(tags);
      if (normalizedTags === null) {
        return res.status(400).json({ error: 'Tags must be an array of strings' });
      }
      updates.push('tags = ?');
      params.push(JSON.stringify(normalizedTags));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE resource_templates SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ message: 'Template updated successfully' });
  } catch (error) {
    console.error('Error updating resource template:', error);
    res.status(500).json({ error: 'Failed to update resource template' });
  }
});

// DELETE /api/resources/:id - Delete template and all translations
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM resource_templates WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting resource template:', error);
    res.status(500).json({ error: 'Failed to delete resource template' });
  }
});

// POST /api/resources/:id/translations - Add translation for specific language
router.post('/:id/translations', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      language_code,
      title,
      content,
      version_number,
      version_label,
      create_new_version,
    } = req.body;

    if (!language_code || !title || !content) {
      return res.status(400).json({ error: 'Language code, title, and content are required' });
    }

    // Check if template exists
    const [templates] = await pool.query<ResourceTemplateRow[]>(
      'SELECT id FROM resource_templates WHERE id = ?',
      [id]
    );

    if (templates.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const normalizedVersion = normalizeVersionNumber(version_number);
    if (version_number !== undefined && normalizedVersion === null) {
      return res.status(400).json({ error: 'Invalid version_number value' });
    }

    const normalizedVersionLabel = normalizeVersionLabel(version_label);
    if (version_label !== undefined && version_label !== null && typeof version_label !== 'string') {
      return res.status(400).json({ error: 'version_label must be a string' });
    }

    const shouldCreateNewVersion = create_new_version === true;

    if (normalizedVersion !== null) {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO resource_template_translations (template_id, language_code, version_number, version_label, title, content)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE version_label = VALUES(version_label), title = VALUES(title), content = VALUES(content)`,
        [id, language_code, normalizedVersion, normalizedVersionLabel, title, content]
      );

      return res.status(201).json({
        message: 'Translation version saved successfully',
        id: result.insertId,
        version_number: normalizedVersion,
      });
    }

    const [latestRows] = await pool.query<TranslationRow[]>(
      `SELECT id, version_number
       FROM resource_template_translations
       WHERE template_id = ? AND language_code = ?
       ORDER BY version_number DESC
       LIMIT 1`,
      [id, language_code]
    );

    if (latestRows.length === 0 || shouldCreateNewVersion) {
      const nextVersion = latestRows.length > 0 ? Number(latestRows[0].version_number) + 1 : 1;
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO resource_template_translations (template_id, language_code, version_number, version_label, title, content)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, language_code, nextVersion, normalizedVersionLabel, title, content]
      );

      return res.status(201).json({
        message: 'Translation version created successfully',
        id: result.insertId,
        version_number: nextVersion,
      });
    }

    const latest = latestRows[0];
    await pool.query<ResultSetHeader>(
      `UPDATE resource_template_translations
       SET version_label = ?, title = ?, content = ?
       WHERE id = ?`,
      [normalizedVersionLabel, title, content, latest.id]
    );

    return res.status(200).json({
      message: 'Latest translation version updated successfully',
      id: latest.id,
      version_number: latest.version_number,
    });
  } catch (error) {
    console.error('Error saving translation:', error);
    res.status(500).json({ error: 'Failed to save translation' });
  }
});

// PUT /api/resources/:id/translations/:lang/versions - Replace all versions for language
router.put('/:id/translations/:lang/versions', async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id, lang } = req.params;
    const { versions } = req.body as {
      versions?: Array<{ version_label?: string | null; title?: string; content?: string }>;
    };

    if (!Array.isArray(versions)) {
      return res.status(400).json({ error: 'versions array is required' });
    }

    const normalizedVersions = versions.map((version, index) => ({
      version_number: index + 1,
      version_label: normalizeVersionLabel(version?.version_label),
      title: String(version?.title || '').trim(),
      content: String(version?.content || '').trim(),
    }));

    const invalidVersion = normalizedVersions.find((version) => !version.title || !version.content);
    if (invalidVersion) {
      return res.status(400).json({ error: 'Each version must include title and content' });
    }

    const [templates] = await connection.query<ResourceTemplateRow[]>(
      'SELECT id FROM resource_templates WHERE id = ? LIMIT 1',
      [id]
    );

    if (templates.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await connection.beginTransaction();

    await connection.query(
      'DELETE FROM resource_template_translations WHERE template_id = ? AND language_code = ?',
      [id, lang]
    );

    for (const version of normalizedVersions) {
      await connection.query(
        `INSERT INTO resource_template_translations (template_id, language_code, version_number, version_label, title, content)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, lang, version.version_number, version.version_label, version.title, version.content]
      );
    }

    await connection.commit();

    res.json({
      message: 'Translation versions saved successfully',
      language_code: lang,
      total_versions: normalizedVersions.length,
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error replacing translation versions:', error);
    res.status(500).json({ error: 'Failed to save translation versions' });
  } finally {
    connection.release();
  }
});

// PUT /api/resources/:id/translations/:lang - Update translation
router.put('/:id/translations/:lang', async (req, res) => {
  try {
    const { id, lang } = req.params;
    const { title, content, version_number, version_label } = req.body;

    const normalizedVersion = normalizeVersionNumber(version_number);
    if (version_number !== undefined && normalizedVersion === null) {
      return res.status(400).json({ error: 'Invalid version_number value' });
    }

    if (version_label !== undefined && version_label !== null && typeof version_label !== 'string') {
      return res.status(400).json({ error: 'version_label must be a string' });
    }

    const normalizedVersionLabel = normalizeVersionLabel(version_label);

    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (content !== undefined) {
      updates.push('content = ?');
      params.push(content);
    }
    if (version_label !== undefined) {
      updates.push('version_label = ?');
      params.push(normalizedVersionLabel);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    let result: ResultSetHeader;

    if (normalizedVersion !== null) {
      params.push(id, lang, normalizedVersion);
      const [versionedResult] = await pool.query<ResultSetHeader>(
        `UPDATE resource_template_translations
         SET ${updates.join(', ')}
         WHERE template_id = ? AND language_code = ? AND version_number = ?`,
        params
      );
      result = versionedResult;
    } else {
      const [latestRows] = await pool.query<TranslationRow[]>(
        `SELECT id
         FROM resource_template_translations
         WHERE template_id = ? AND language_code = ?
         ORDER BY version_number DESC
         LIMIT 1`,
        [id, lang]
      );

      if (latestRows.length === 0) {
        return res.status(404).json({ error: 'Translation not found' });
      }

      params.push(latestRows[0].id);
      const [latestResult] = await pool.query<ResultSetHeader>(
        `UPDATE resource_template_translations SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
      result = latestResult;
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    res.json({ message: 'Translation updated successfully' });
  } catch (error) {
    console.error('Error updating translation:', error);
    res.status(500).json({ error: 'Failed to update translation' });
  }
});

// DELETE /api/resources/:id/translations/:lang - Delete translation
router.delete('/:id/translations/:lang', async (req, res) => {
  try {
    const { id, lang } = req.params;
    const versionNumber = normalizeVersionNumber(req.query.version_number);

    if (req.query.version_number !== undefined && versionNumber === null) {
      return res.status(400).json({ error: 'Invalid version_number value' });
    }

    let result: ResultSetHeader;

    if (versionNumber !== null) {
      const [versionDeleteResult] = await pool.query<ResultSetHeader>(
        'DELETE FROM resource_template_translations WHERE template_id = ? AND language_code = ? AND version_number = ?',
        [id, lang, versionNumber]
      );
      result = versionDeleteResult;
    } else {
      const [allDeleteResult] = await pool.query<ResultSetHeader>(
        'DELETE FROM resource_template_translations WHERE template_id = ? AND language_code = ?',
        [id, lang]
      );
      result = allDeleteResult;
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Translation not found' });
    }

    res.json({ message: 'Translation deleted successfully' });
  } catch (error) {
    console.error('Error deleting translation:', error);
    res.status(500).json({ error: 'Failed to delete translation' });
  }
});

// GET /api/resources/creators - Get all unique creators
router.get('/creators/all', async (_req, res) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT DISTINCT 
        u.id as user_id,
        u.username,
        u.full_name,
        COUNT(rt.id) as template_count
      FROM users u
      INNER JOIN resource_templates rt ON u.id = rt.created_by_user_id
      GROUP BY u.id, u.username, u.full_name
      ORDER BY u.full_name
    `);

    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('Error fetching creators:', error);
    res.status(500).json({ error: 'Failed to fetch creators' });
  }
});

// GET /api/resources/languages - Get all supported languages
router.get('/languages/all', async (_req, res) => {
  try {
    const [rows] = await pool.query<SupportedLanguageRow[]>(
      'SELECT * FROM supported_languages WHERE enabled = TRUE ORDER BY code'
    );

    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('Error fetching supported languages:', error);
    res.status(500).json({ error: 'Failed to fetch supported languages' });
  }
});

// POST /api/resources/languages - Add new language support
router.post('/languages/add', async (req, res) => {
  try {
    const { code, name, native_name } = req.body;

    if (!code || !name || !native_name) {
      return res.status(400).json({ error: 'Code, name, and native_name are required' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO supported_languages (code, name, native_name) VALUES (?, ?, ?)',
      [code, name, native_name]
    );

    res.status(201).json({
      message: 'Language added successfully',
      code: code
    });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Language code already exists' });
    }
    console.error('Error adding language:', error);
    res.status(500).json({ error: 'Failed to add language' });
  }
});

export default router;
