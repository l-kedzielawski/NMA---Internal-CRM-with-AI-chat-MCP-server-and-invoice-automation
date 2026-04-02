import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../config/database';
import { requireRole } from '../middleware/auth';
import { COST_DOCUMENTS_DIR, ensureStorageDirs } from '../services/fileStorage';
import { parseCostDocument, type ParsedCostDocumentResult } from '../services/costDocumentParser';

const router = Router();

router.use(requireRole('admin', 'manager', 'bookkeeping'));

const ALLOWED_COST_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const parsePreviewUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_COST_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const costDocumentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStorageDirs();
    cb(null, COST_DOCUMENTS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `cost-${unique}${ext}`);
  },
});

const costDocumentUpload = multer({
  storage: costDocumentStorage,
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_COST_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

interface InvoiceGroupRow extends RowDataPacket {
  id: number;
  code: string | null;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface CostEntryRow extends RowDataPacket {
  id: number;
  title: string;
  cost_date: string;
  amount_original: number;
  currency: string;
  exchange_rate_to_pln: number;
  amount_pln: number;
  notes: string | null;
  invoice_group_id: number | null;
  invoice_group_code: string | null;
  invoice_group_name: string | null;
  linked_invoice_count: number;
  document_count: number;
  created_by_user_id: number | null;
  created_by_username: string | null;
  created_by_full_name: string | null;
  created_at: string;
  updated_at: string;
}

interface CostDocumentRow extends RowDataPacket {
  id: number;
  cost_entry_id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  parse_result_json: string | null;
  parse_confidence: number | null;
  uploaded_by_user_id: number | null;
  uploaded_by_username: string | null;
  uploaded_by_full_name: string | null;
  created_at: string;
  updated_at: string;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: unknown, fallback = NaN): number {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function normalizeCurrencyCode(value: unknown): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return normalized;
}

function resolveExchangeRateToPln(currencyCode: string, value: unknown): number | null {
  if (currencyCode === 'PLN') {
    return 1;
  }

  const parsedRate = toNumber(value, NaN);
  if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
    return null;
  }

  return parsedRate;
}

function normalizeDateValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseEntityId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeInvoiceIdList(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = Array.from(
    new Set(
      value
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0)
    )
  ) as number[];

  if (normalized.length !== value.length) {
    return null;
  }

  return normalized;
}

function buildGroupFilter(
  rawValue: unknown,
  qualifiedColumnName: string
): { sql: string; params: Array<number> } {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return { sql: '', params: [] };
  }

  if (String(rawValue).trim().toLowerCase() === 'none') {
    return { sql: ` AND ${qualifiedColumnName} IS NULL`, params: [] };
  }

  const groupId = parseEntityId(rawValue);
  if (!groupId) {
    throw new Error('Invalid group_id filter');
  }

  return {
    sql: ` AND ${qualifiedColumnName} = ?`,
    params: [groupId],
  };
}

async function ensureGroupExists(groupId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM invoice_groups WHERE id = ? LIMIT 1',
    [groupId]
  );
  return rows.length > 0;
}

async function validateLinkedInvoices(invoiceIds: number[], groupId: number | null): Promise<{ valid: boolean; error?: string }> {
  if (invoiceIds.length === 0) {
    return { valid: true };
  }

  const [invoiceRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, invoice_group_id
     FROM invoices
     WHERE id IN (?)`,
    [invoiceIds]
  );

  if (invoiceRows.length !== invoiceIds.length) {
    return { valid: false, error: 'Some linked invoices were not found' };
  }

  if (groupId !== null) {
    const allBelongToGroup = invoiceRows.every((row) => Number(row.invoice_group_id || 0) === groupId);
    if (!allBelongToGroup) {
      return {
        valid: false,
        error: 'All linked invoices must belong to the selected group',
      };
    }
  }

  return { valid: true };
}

function parseStoredDocumentJson(value: string | null): ParsedCostDocumentResult | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ParsedCostDocumentResult;
  } catch {
    return null;
  }
}

// GET /api/costs/groups - list invoice groups
router.get('/groups', async (_req, res) => {
  try {
    const [rows] = await pool.query<InvoiceGroupRow[]>(
      `SELECT id, code, name, is_active, created_at, updated_at
       FROM invoice_groups
       ORDER BY is_active DESC, name ASC`
    );

    return res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('Error fetching invoice groups:', error);
    return res.status(500).json({ error: 'Failed to fetch invoice groups' });
  }
});

// POST /api/costs/groups - create invoice group
router.post('/groups', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const rawCode = String(req.body?.code || name)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    const code = rawCode || null;
    const isActive = req.body?.is_active === false ? 0 : 1;

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO invoice_groups (code, name, is_active)
       VALUES (?, ?, ?)`,
      [code, name, isActive]
    );

    return res.status(201).json({
      id: result.insertId,
      message: 'Invoice group created',
    });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Group code already exists' });
    }
    console.error('Error creating invoice group:', error);
    return res.status(500).json({ error: 'Failed to create invoice group' });
  }
});

// PUT /api/costs/groups/:id - update invoice group
router.put('/groups/:id', async (req, res) => {
  try {
    const groupId = parseEntityId(req.params.id);
    if (!groupId) {
      return res.status(400).json({ error: 'Invalid group id' });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (req.body?.name !== undefined) {
      const name = String(req.body?.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: 'Group name cannot be empty' });
      }
      updates.push('name = ?');
      values.push(name);
    }

    if (req.body?.code !== undefined) {
      const rawCode = String(req.body?.code || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
      updates.push('code = ?');
      values.push(rawCode || null);
    }

    if (req.body?.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(req.body?.is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(groupId);

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE invoice_groups
       SET ${updates.join(', ')}
       WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    return res.json({ message: 'Invoice group updated' });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Group code already exists' });
    }
    console.error('Error updating invoice group:', error);
    return res.status(500).json({ error: 'Failed to update invoice group' });
  }
});

// DELETE /api/costs/groups/:id - delete invoice group
router.delete('/groups/:id', async (req, res) => {
  try {
    const groupId = parseEntityId(req.params.id);
    if (!groupId) {
      return res.status(400).json({ error: 'Invalid group id' });
    }

    const [invoiceUsageRows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM invoices WHERE invoice_group_id = ?',
      [groupId]
    );
    const [costUsageRows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM cost_entries WHERE invoice_group_id = ?',
      [groupId]
    );

    const invoiceUsage = Number(invoiceUsageRows[0]?.count || 0);
    const costUsage = Number(costUsageRows[0]?.count || 0);
    if (invoiceUsage > 0 || costUsage > 0) {
      return res.status(409).json({
        error: 'Group is in use and cannot be deleted',
        invoices_count: invoiceUsage,
        costs_count: costUsage,
      });
    }

    const [result] = await pool.query<ResultSetHeader>('DELETE FROM invoice_groups WHERE id = ?', [groupId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    return res.json({ message: 'Invoice group deleted' });
  } catch (error) {
    console.error('Error deleting invoice group:', error);
    return res.status(500).json({ error: 'Failed to delete invoice group' });
  }
});

// POST /api/costs/parse-preview - parse uploaded cost document without saving
router.post('/parse-preview', parsePreviewUpload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'No file uploaded (field name: file)' });
    }

    const parsed = await parseCostDocument(req.file.buffer, req.file.mimetype, req.file.originalname);
    return res.json({
      file_name: req.file.originalname,
      mime_type: req.file.mimetype,
      file_size: req.file.size,
      parsed,
    });
  } catch (error) {
    console.error('Error generating cost parse preview:', error);
    return res.status(500).json({ error: 'Failed to parse cost document preview' });
  }
});

// GET /api/costs/summary - aggregated profitability with costs
router.get('/summary', async (req, res) => {
  try {
    const { date_from, date_to, group_id } = req.query;

    let invoiceWhere = 'WHERE 1=1';
    const invoiceParams: unknown[] = [];

    if (date_from) {
      invoiceWhere += ' AND i.data_wystawienia >= ?';
      invoiceParams.push(String(date_from));
    }

    if (date_to) {
      invoiceWhere += ' AND i.data_wystawienia <= ?';
      invoiceParams.push(String(date_to));
    }

    const invoiceGroupFilter = buildGroupFilter(group_id, 'i.invoice_group_id');
    invoiceWhere += invoiceGroupFilter.sql;
    invoiceParams.push(...invoiceGroupFilter.params);

    let costWhere = 'WHERE 1=1';
    const costParams: unknown[] = [];

    if (date_from) {
      costWhere += ' AND c.cost_date >= ?';
      costParams.push(String(date_from));
    }

    if (date_to) {
      costWhere += ' AND c.cost_date <= ?';
      costParams.push(String(date_to));
    }

    const costGroupFilter = buildGroupFilter(group_id, 'c.invoice_group_id');
    costWhere += costGroupFilter.sql;
    costParams.push(...costGroupFilter.params);

    const [invoiceRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS invoice_count,
         COALESCE(SUM(COALESCE(i.netto, 0) * COALESCE(i.kurs_waluty, 1)), 0) AS sales_net_pln,
         COALESCE(SUM(COALESCE(i.zysk, 0)), 0) AS invoice_profit_pln
       FROM invoices i
       ${invoiceWhere}`,
      invoiceParams
    );

    const [costRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS cost_count,
         COALESCE(SUM(COALESCE(c.amount_pln, 0)), 0) AS costs_pln
       FROM cost_entries c
       ${costWhere}`,
      costParams
    );

    const invoiceCount = Number(invoiceRows[0]?.invoice_count || 0);
    const salesNetPln = roundMoney(Number(invoiceRows[0]?.sales_net_pln || 0));
    const invoiceProfitPln = roundMoney(Number(invoiceRows[0]?.invoice_profit_pln || 0));
    const costCount = Number(costRows[0]?.cost_count || 0);
    const costsPln = roundMoney(Number(costRows[0]?.costs_pln || 0));
    const netAfterCostsPln = roundMoney(invoiceProfitPln - costsPln);

    return res.json({
      period: {
        date_from: date_from ? String(date_from) : null,
        date_to: date_to ? String(date_to) : null,
      },
      totals: {
        invoice_count: invoiceCount,
        sales_net_pln: salesNetPln,
        invoice_profit_pln: invoiceProfitPln,
        cost_count: costCount,
        costs_pln: costsPln,
        net_after_costs_pln: netAfterCostsPln,
      },
    });
  } catch (error) {
    if ((error as Error)?.message?.includes('Invalid group_id filter')) {
      return res.status(400).json({ error: 'Invalid group_id filter' });
    }
    console.error('Error fetching costs summary:', error);
    return res.status(500).json({ error: 'Failed to fetch costs summary' });
  }
});

// GET /api/costs - list costs
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(String(req.query.per_page || '25'), 10) || 25));
    const offset = (page - 1) * perPage;

    const { search, date_from, date_to, group_id } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (search) {
      whereClause += ' AND (c.title LIKE ? OR c.notes LIKE ?)';
      params.push(`%${String(search)}%`, `%${String(search)}%`);
    }

    if (date_from) {
      whereClause += ' AND c.cost_date >= ?';
      params.push(String(date_from));
    }

    if (date_to) {
      whereClause += ' AND c.cost_date <= ?';
      params.push(String(date_to));
    }

    const groupFilter = buildGroupFilter(group_id, 'c.invoice_group_id');
    whereClause += groupFilter.sql;
    params.push(...groupFilter.params);

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM cost_entries c
       ${whereClause}`,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.query<CostEntryRow[]>(
      `SELECT
         c.id,
         c.title,
         c.cost_date,
         c.amount_original,
         c.currency,
         c.exchange_rate_to_pln,
         c.amount_pln,
         c.notes,
         c.invoice_group_id,
         ig.code AS invoice_group_code,
         ig.name AS invoice_group_name,
         c.created_by_user_id,
         u.username AS created_by_username,
         u.full_name AS created_by_full_name,
         c.created_at,
         c.updated_at,
         (
           SELECT COUNT(*)
           FROM cost_entry_invoices cei
           WHERE cei.cost_entry_id = c.id
         ) AS linked_invoice_count,
         (
           SELECT COUNT(*)
           FROM cost_documents cd
           WHERE cd.cost_entry_id = c.id
         ) AS document_count
       FROM cost_entries c
       LEFT JOIN invoice_groups ig ON ig.id = c.invoice_group_id
       LEFT JOIN users u ON u.id = c.created_by_user_id
       ${whereClause}
       ORDER BY c.cost_date DESC, c.id DESC
       LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    return res.json({
      data: rows,
      total,
      page,
      per_page: perPage,
    });
  } catch (error) {
    if ((error as Error)?.message?.includes('Invalid group_id filter')) {
      return res.status(400).json({ error: 'Invalid group_id filter' });
    }
    console.error('Error fetching costs:', error);
    return res.status(500).json({ error: 'Failed to fetch costs' });
  }
});

// GET /api/costs/:id - get single cost with invoice links and documents
router.get('/:id', async (req, res) => {
  try {
    const costId = parseEntityId(req.params.id);
    if (!costId) {
      return res.status(400).json({ error: 'Invalid cost id' });
    }

    const [costRows] = await pool.query<CostEntryRow[]>(
      `SELECT
         c.id,
         c.title,
         c.cost_date,
         c.amount_original,
         c.currency,
         c.exchange_rate_to_pln,
         c.amount_pln,
         c.notes,
         c.invoice_group_id,
         ig.code AS invoice_group_code,
         ig.name AS invoice_group_name,
         c.created_by_user_id,
         u.username AS created_by_username,
         u.full_name AS created_by_full_name,
         c.created_at,
         c.updated_at,
         0 AS linked_invoice_count,
         0 AS document_count
       FROM cost_entries c
       LEFT JOIN invoice_groups ig ON ig.id = c.invoice_group_id
       LEFT JOIN users u ON u.id = c.created_by_user_id
       WHERE c.id = ?
       LIMIT 1`,
      [costId]
    );

    if (costRows.length === 0) {
      return res.status(404).json({ error: 'Cost entry not found' });
    }

    const [linkedInvoiceRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         i.id,
         i.numer_faktury,
         i.data_wystawienia,
         i.waluta,
         i.netto,
         i.zysk,
         c.nazwa AS customer_nazwa
       FROM cost_entry_invoices cei
       JOIN invoices i ON i.id = cei.invoice_id
       JOIN customers c ON c.id = i.customer_id
       WHERE cei.cost_entry_id = ?
       ORDER BY i.data_wystawienia DESC, i.id DESC`,
      [costId]
    );

    const [documentRows] = await pool.query<CostDocumentRow[]>(
      `SELECT
         cd.id,
         cd.cost_entry_id,
         cd.original_name,
         cd.stored_name,
         cd.mime_type,
         cd.size_bytes,
         cd.parse_result_json,
         cd.parse_confidence,
         cd.uploaded_by_user_id,
         u.username AS uploaded_by_username,
         u.full_name AS uploaded_by_full_name,
         cd.created_at,
         cd.updated_at
       FROM cost_documents cd
       LEFT JOIN users u ON u.id = cd.uploaded_by_user_id
       WHERE cd.cost_entry_id = ?
       ORDER BY cd.created_at DESC`,
      [costId]
    );

    return res.json({
      ...costRows[0],
      linked_invoices: linkedInvoiceRows,
      documents: documentRows.map((row) => ({
        ...row,
        parse_result: parseStoredDocumentJson(row.parse_result_json),
      })),
    });
  } catch (error) {
    console.error('Error fetching cost details:', error);
    return res.status(500).json({ error: 'Failed to fetch cost details' });
  }
});

// POST /api/costs - create cost entry
router.post('/', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'Cost title is required' });
    }

    const normalizedCurrency = normalizeCurrencyCode(req.body?.currency || 'PLN');
    if (!normalizedCurrency) {
      return res.status(400).json({ error: 'Invalid currency. Use ISO code like PLN, EUR, HUF' });
    }

    const amountOriginal = toNumber(req.body?.amount_original, NaN);
    if (!Number.isFinite(amountOriginal) || amountOriginal <= 0) {
      return res.status(400).json({ error: 'amount_original must be greater than 0' });
    }

    const exchangeRateToPln = resolveExchangeRateToPln(normalizedCurrency, req.body?.exchange_rate_to_pln);
    if (exchangeRateToPln === null) {
      return res.status(400).json({ error: 'Invalid exchange rate to PLN' });
    }

    const groupId = parseEntityId(req.body?.invoice_group_id);
    if (req.body?.invoice_group_id !== undefined && req.body?.invoice_group_id !== null && req.body?.invoice_group_id !== '' && !groupId) {
      return res.status(400).json({ error: 'Invalid invoice_group_id' });
    }

    if (groupId) {
      const exists = await ensureGroupExists(groupId);
      if (!exists) {
        return res.status(400).json({ error: 'invoice_group_id was not found' });
      }
    }

    const linkedInvoiceIds = req.body?.linked_invoice_ids === undefined
      ? []
      : normalizeInvoiceIdList(req.body.linked_invoice_ids);

    if (linkedInvoiceIds === null) {
      return res.status(400).json({ error: 'linked_invoice_ids must be an array of unique positive integers' });
    }

    const linksValidation = await validateLinkedInvoices(linkedInvoiceIds, groupId || null);
    if (!linksValidation.valid) {
      return res.status(400).json({ error: linksValidation.error || 'Invalid linked invoices' });
    }

    const normalizedDate = normalizeDateValue(req.body?.cost_date) || new Date().toISOString().slice(0, 10);
    const notes = req.body?.notes !== undefined ? String(req.body.notes || '').trim() || null : null;
    const amountPln = roundMoney(amountOriginal * exchangeRateToPln);

    await connection.beginTransaction();

    const [insertResult] = await connection.query<ResultSetHeader>(
      `INSERT INTO cost_entries (
         title,
         cost_date,
         amount_original,
         currency,
         exchange_rate_to_pln,
         amount_pln,
         notes,
         invoice_group_id,
         created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        normalizedDate,
        roundMoney(amountOriginal),
        normalizedCurrency,
        exchangeRateToPln,
        amountPln,
        notes,
        groupId || null,
        req.user?.id || null,
      ]
    );

    const costId = insertResult.insertId;

    if (linkedInvoiceIds.length > 0) {
      const values = linkedInvoiceIds.map((invoiceId) => [costId, invoiceId]);
      await connection.query(
        'INSERT INTO cost_entry_invoices (cost_entry_id, invoice_id) VALUES ?',
        [values]
      );
    }

    await connection.commit();

    return res.status(201).json({
      id: costId,
      message: 'Cost entry created',
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating cost entry:', error);
    return res.status(500).json({ error: 'Failed to create cost entry' });
  } finally {
    connection.release();
  }
});

// PUT /api/costs/:id - update cost entry
router.put('/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const costId = parseEntityId(req.params.id);
    if (!costId) {
      return res.status(400).json({ error: 'Invalid cost id' });
    }

    const [existingRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, title, cost_date, amount_original, currency, exchange_rate_to_pln, notes, invoice_group_id
       FROM cost_entries
       WHERE id = ?
       LIMIT 1`,
      [costId]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Cost entry not found' });
    }

    const existing = existingRows[0];
    const hasGroupProp = Object.prototype.hasOwnProperty.call(req.body || {}, 'invoice_group_id');
    const hasLinkedInvoicesProp = Object.prototype.hasOwnProperty.call(req.body || {}, 'linked_invoice_ids');

    const title = req.body?.title !== undefined
      ? String(req.body.title || '').trim()
      : String(existing.title || '');
    if (!title) {
      return res.status(400).json({ error: 'Cost title is required' });
    }

    const currency = normalizeCurrencyCode(req.body?.currency !== undefined ? req.body.currency : existing.currency);
    if (!currency) {
      return res.status(400).json({ error: 'Invalid currency. Use ISO code like PLN, EUR, HUF' });
    }

    const amountOriginal = req.body?.amount_original !== undefined
      ? toNumber(req.body.amount_original, NaN)
      : Number(existing.amount_original || 0);

    if (!Number.isFinite(amountOriginal) || amountOriginal <= 0) {
      return res.status(400).json({ error: 'amount_original must be greater than 0' });
    }

    const exchangeRateInput = req.body?.exchange_rate_to_pln !== undefined
      ? req.body.exchange_rate_to_pln
      : existing.exchange_rate_to_pln;
    const exchangeRateToPln = resolveExchangeRateToPln(currency, exchangeRateInput);
    if (exchangeRateToPln === null) {
      return res.status(400).json({ error: 'Invalid exchange rate to PLN' });
    }

    let groupId: number | null = Number(existing.invoice_group_id || 0) || null;
    if (hasGroupProp) {
      if (req.body?.invoice_group_id === null || req.body?.invoice_group_id === '') {
        groupId = null;
      } else {
        groupId = parseEntityId(req.body?.invoice_group_id);
      }
      if (req.body?.invoice_group_id !== null && req.body?.invoice_group_id !== '' && !groupId) {
        return res.status(400).json({ error: 'Invalid invoice_group_id' });
      }
    }

    if (groupId) {
      const exists = await ensureGroupExists(groupId);
      if (!exists) {
        return res.status(400).json({ error: 'invoice_group_id was not found' });
      }
    }

    const linkedInvoiceIds = hasLinkedInvoicesProp
      ? normalizeInvoiceIdList(req.body?.linked_invoice_ids)
      : null;

    if (hasLinkedInvoicesProp && linkedInvoiceIds === null) {
      return res.status(400).json({ error: 'linked_invoice_ids must be an array of unique positive integers' });
    }

    if (linkedInvoiceIds) {
      const linksValidation = await validateLinkedInvoices(linkedInvoiceIds, groupId);
      if (!linksValidation.valid) {
        return res.status(400).json({ error: linksValidation.error || 'Invalid linked invoices' });
      }
    }

    const normalizedDate = req.body?.cost_date !== undefined
      ? normalizeDateValue(req.body.cost_date)
      : normalizeDateValue(existing.cost_date);

    if (!normalizedDate) {
      return res.status(400).json({ error: 'Invalid cost_date' });
    }

    const notes = req.body?.notes !== undefined
      ? String(req.body.notes || '').trim() || null
      : existing.notes || null;
    const amountPln = roundMoney(amountOriginal * exchangeRateToPln);

    await connection.beginTransaction();

    await connection.query(
      `UPDATE cost_entries
       SET
         title = ?,
         cost_date = ?,
         amount_original = ?,
         currency = ?,
         exchange_rate_to_pln = ?,
         amount_pln = ?,
         notes = ?,
         invoice_group_id = ?
       WHERE id = ?`,
      [
        title,
        normalizedDate,
        roundMoney(amountOriginal),
        currency,
        exchangeRateToPln,
        amountPln,
        notes,
        groupId,
        costId,
      ]
    );

    if (linkedInvoiceIds) {
      await connection.query('DELETE FROM cost_entry_invoices WHERE cost_entry_id = ?', [costId]);

      if (linkedInvoiceIds.length > 0) {
        const values = linkedInvoiceIds.map((invoiceId) => [costId, invoiceId]);
        await connection.query(
          'INSERT INTO cost_entry_invoices (cost_entry_id, invoice_id) VALUES ?',
          [values]
        );
      }
    }

    await connection.commit();
    return res.json({ message: 'Cost entry updated' });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating cost entry:', error);
    return res.status(500).json({ error: 'Failed to update cost entry' });
  } finally {
    connection.release();
  }
});

// PUT /api/costs/:id/invoices - replace linked invoices
router.put('/:id/invoices', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const costId = parseEntityId(req.params.id);
    if (!costId) {
      return res.status(400).json({ error: 'Invalid cost id' });
    }

    const invoiceIds = normalizeInvoiceIdList(req.body?.invoice_ids);
    if (!invoiceIds) {
      return res.status(400).json({ error: 'invoice_ids must be an array of unique positive integers' });
    }

    const [costRows] = await connection.query<RowDataPacket[]>(
      'SELECT invoice_group_id FROM cost_entries WHERE id = ? LIMIT 1',
      [costId]
    );

    if (costRows.length === 0) {
      return res.status(404).json({ error: 'Cost entry not found' });
    }

    const groupId = costRows[0].invoice_group_id ? Number(costRows[0].invoice_group_id) : null;
    const linksValidation = await validateLinkedInvoices(invoiceIds, groupId);
    if (!linksValidation.valid) {
      return res.status(400).json({ error: linksValidation.error || 'Invalid linked invoices' });
    }

    await connection.beginTransaction();
    await connection.query('DELETE FROM cost_entry_invoices WHERE cost_entry_id = ?', [costId]);

    if (invoiceIds.length > 0) {
      const values = invoiceIds.map((invoiceId) => [costId, invoiceId]);
      await connection.query(
        'INSERT INTO cost_entry_invoices (cost_entry_id, invoice_id) VALUES ?',
        [values]
      );
    }

    await connection.commit();
    return res.json({ message: 'Linked invoices updated' });
  } catch (error) {
    await connection.rollback();
    console.error('Error replacing linked invoices:', error);
    return res.status(500).json({ error: 'Failed to update linked invoices' });
  } finally {
    connection.release();
  }
});

// POST /api/costs/:id/documents - upload and parse cost document
router.post('/:id/documents', costDocumentUpload.single('file'), async (req, res) => {
  try {
    const costId = parseEntityId(req.params.id);
    if (!costId) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Invalid cost id' });
    }

    if (!req.file?.path) {
      return res.status(400).json({ error: 'No file uploaded (field name: file)' });
    }

    const [costRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM cost_entries WHERE id = ? LIMIT 1',
      [costId]
    );

    if (costRows.length === 0) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Cost entry not found' });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    const parsed = await parseCostDocument(fileBuffer, req.file.mimetype, req.file.originalname);

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO cost_documents (
         cost_entry_id,
         original_name,
         stored_name,
         mime_type,
         size_bytes,
         parse_result_json,
         parse_confidence,
         uploaded_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        costId,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        JSON.stringify(parsed),
        parsed.confidence,
        req.user?.id || null,
      ]
    );

    return res.status(201).json({
      id: result.insertId,
      message: 'Cost document uploaded',
      parsed,
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore cleanup errors
      }
    }
    console.error('Error uploading cost document:', error);
    return res.status(500).json({ error: 'Failed to upload cost document' });
  }
});

// GET /api/costs/:id/documents - list uploaded documents for a cost entry
router.get('/:id/documents', async (req, res) => {
  try {
    const costId = parseEntityId(req.params.id);
    if (!costId) {
      return res.status(400).json({ error: 'Invalid cost id' });
    }

    const [rows] = await pool.query<CostDocumentRow[]>(
      `SELECT
         cd.id,
         cd.cost_entry_id,
         cd.original_name,
         cd.stored_name,
         cd.mime_type,
         cd.size_bytes,
         cd.parse_result_json,
         cd.parse_confidence,
         cd.uploaded_by_user_id,
         u.username AS uploaded_by_username,
         u.full_name AS uploaded_by_full_name,
         cd.created_at,
         cd.updated_at
       FROM cost_documents cd
       LEFT JOIN users u ON u.id = cd.uploaded_by_user_id
       WHERE cd.cost_entry_id = ?
       ORDER BY cd.created_at DESC`,
      [costId]
    );

    return res.json({
      data: rows.map((row) => ({
        ...row,
        parse_result: parseStoredDocumentJson(row.parse_result_json),
      })),
      total: rows.length,
    });
  } catch (error) {
    console.error('Error listing cost documents:', error);
    return res.status(500).json({ error: 'Failed to list cost documents' });
  }
});

// GET /api/costs/documents/:id/download - download cost document
router.get('/documents/:id/download', async (req, res) => {
  try {
    const documentId = parseEntityId(req.params.id);
    if (!documentId) {
      return res.status(400).json({ error: 'Invalid document id' });
    }

    const [rows] = await pool.query<CostDocumentRow[]>(
      `SELECT id, original_name, stored_name, mime_type
       FROM cost_documents
       WHERE id = ?
       LIMIT 1`,
      [documentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const document = rows[0];
    const filePath = path.join(COST_DOCUMENTS_DIR, document.stored_name);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Document file missing from storage' });
    }

    res.setHeader('Content-Type', document.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.original_name)}"`);
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Error downloading cost document:', error);
    return res.status(500).json({ error: 'Failed to download cost document' });
  }
});

// DELETE /api/costs/documents/:id - delete cost document
router.delete('/documents/:id', async (req, res) => {
  try {
    const documentId = parseEntityId(req.params.id);
    if (!documentId) {
      return res.status(400).json({ error: 'Invalid document id' });
    }

    const [rows] = await pool.query<CostDocumentRow[]>(
      `SELECT id, stored_name
       FROM cost_documents
       WHERE id = ?
       LIMIT 1`,
      [documentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await pool.query('DELETE FROM cost_documents WHERE id = ?', [documentId]);

    const filePath = path.join(COST_DOCUMENTS_DIR, rows[0].stored_name);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup errors
      }
    }

    return res.json({ message: 'Cost document deleted' });
  } catch (error) {
    console.error('Error deleting cost document:', error);
    return res.status(500).json({ error: 'Failed to delete cost document' });
  }
});

// DELETE /api/costs/:id - delete cost entry
router.delete('/:id', async (req, res) => {
  try {
    const costId = parseEntityId(req.params.id);
    if (!costId) {
      return res.status(400).json({ error: 'Invalid cost id' });
    }

    const [documentRows] = await pool.query<CostDocumentRow[]>(
      'SELECT stored_name FROM cost_documents WHERE cost_entry_id = ?',
      [costId]
    );

    const [result] = await pool.query<ResultSetHeader>('DELETE FROM cost_entries WHERE id = ?', [costId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Cost entry not found' });
    }

    for (const doc of documentRows) {
      const filePath = path.join(COST_DOCUMENTS_DIR, doc.stored_name);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    return res.json({ message: 'Cost entry deleted' });
  } catch (error) {
    console.error('Error deleting cost entry:', error);
    return res.status(500).json({ error: 'Failed to delete cost entry' });
  }
});

export default router;
