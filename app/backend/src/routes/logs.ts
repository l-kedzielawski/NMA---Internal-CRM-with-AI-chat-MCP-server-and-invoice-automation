import { Router } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../config/database';
import { requireRole } from '../middleware/auth';

const router = Router();

router.use(requireRole('admin'));

interface AuditLogRow extends RowDataPacket {
  id: number;
  user_id: number | null;
  username: string | null;
  full_name: string | null;
  user_role: 'admin' | 'manager' | 'bookkeeping' | 'seller' | null;
  event_type: string;
  method: string;
  endpoint: string;
  status_code: number;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function buildLogFilters(query: Record<string, unknown>): {
  whereClause: string;
  params: Array<string | number>;
} {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  const userIdRaw = String(query.user_id || '').trim();
  if (userIdRaw) {
    const userId = parseInt(userIdRaw, 10);
    if (!Number.isNaN(userId)) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
  }

  const methodRaw = String(query.method || '').trim().toUpperCase();
  if (methodRaw && ALLOWED_METHODS.has(methodRaw)) {
    conditions.push('method = ?');
    params.push(methodRaw);
  }

  const eventTypeRaw = String(query.event_type || '').trim();
  if (eventTypeRaw) {
    conditions.push('event_type = ?');
    params.push(eventTypeRaw.slice(0, 100));
  }

  const dateFromRaw = String(query.date_from || '').trim();
  if (dateFromRaw) {
    conditions.push('created_at >= ?');
    params.push(dateFromRaw);
  }

  const dateToRaw = String(query.date_to || '').trim();
  if (dateToRaw) {
    conditions.push('created_at <= ?');
    params.push(dateToRaw);
  }

  const searchRaw = String(query.search || '').trim();
  if (searchRaw) {
    const searchValue = `%${searchRaw}%`;
    conditions.push('(username LIKE ? OR full_name LIKE ? OR endpoint LIKE ? OR event_type LIKE ?)');
    params.push(searchValue, searchValue, searchValue, searchValue);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const perPage = Math.min(100, Math.max(1, parseInt(String(req.query.per_page || '20'), 10)));
    const offset = (page - 1) * perPage;

    const { whereClause, params } = buildLogFilters(req.query as Record<string, unknown>);

    const [countRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS total FROM app_audit_logs ${whereClause}`,
      params
    );

    const [rows] = await pool.query<AuditLogRow[]>(
      `SELECT
         id,
         user_id,
         username,
         full_name,
         user_role,
         event_type,
         method,
         endpoint,
         status_code,
         ip_address,
         user_agent,
         created_at
       FROM app_audit_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    res.json({
      data: rows,
      total: countRows[0]?.total || 0,
      page,
      per_page: perPage,
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { whereClause, params } = buildLogFilters(req.query as Record<string, unknown>);

    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM app_audit_logs ${whereClause}`,
      params
    );

    res.json({
      message: 'Logs deleted successfully',
      deleted_count: result.affectedRows,
    });
  } catch (error) {
    console.error('Error deleting audit logs:', error);
    res.status(500).json({ error: 'Failed to delete logs' });
  }
});

export default router;
