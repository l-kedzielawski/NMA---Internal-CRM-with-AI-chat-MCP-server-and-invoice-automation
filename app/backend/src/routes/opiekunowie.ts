import { Router } from 'express';
import { pool } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { requireRole } from '../middleware/auth';

const router = Router();

router.use(requireRole('admin', 'manager'));

interface OpiekunRow extends RowDataPacket {
  id: number;
  imie: string;
  nazwisko: string | null;
  email: string | null;
  user_id: number | null;
  user_username: string | null;
  user_full_name: string | null;
  user_role: 'admin' | 'manager' | 'bookkeeping' | 'seller' | null;
  user_is_active: number | null;
  telefon: string | null;
  marza_procent: number;
  aktywny: number;
}

interface LinkableUserRow extends RowDataPacket {
  id: number;
  username: string;
  full_name: string;
  role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
  is_active: number;
  linked_opiekun_id: number | null;
  linked_opiekun_imie: string | null;
}

function normalizeLinkedUserId(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return 'invalid';
  }

  return parsed;
}

async function validateLinkedUser(userId: number): Promise<{ valid: boolean; message?: string }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, role, is_active FROM users WHERE id = ? LIMIT 1',
    [userId]
  );

  if (rows.length === 0) {
    return { valid: false, message: 'Linked login user not found' };
  }

  const row = rows[0];
  const role = String(row.role || '');
  if (!['admin', 'manager', 'seller'].includes(role)) {
    return { valid: false, message: 'Only admin, manager, or seller users can be linked as account manager' };
  }

  if (Number(row.is_active) !== 1) {
    return { valid: false, message: 'Linked login user must be active' };
  }

  return { valid: true };
}

// GET /api/opiekunowie/linkable-users - Users that can be linked with account manager profile
router.get('/linkable-users', async (_req, res) => {
  try {
    const [rows] = await pool.query<LinkableUserRow[]>(
      `SELECT
         u.id,
         u.username,
         u.full_name,
         u.role,
         u.is_active,
         o.id AS linked_opiekun_id,
         o.imie AS linked_opiekun_imie
       FROM users u
       LEFT JOIN opiekunowie o ON o.user_id = u.id
       WHERE u.role IN ('admin', 'manager', 'seller')
       ORDER BY u.is_active DESC, u.full_name ASC, u.username ASC`
    );

    res.json(rows);
  } catch (error) {
    console.error('Error fetching linkable users:', error);
    res.status(500).json({ error: 'Failed to fetch linkable users' });
  }
});

// GET /api/opiekunowie - List all opiekunowie
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    
    let query = `SELECT
      o.*,
      u.username AS user_username,
      u.full_name AS user_full_name,
      u.role AS user_role,
      u.is_active AS user_is_active
      FROM opiekunowie o
      LEFT JOIN users u ON u.id = o.user_id`;
    if (!includeInactive) {
      query += ' WHERE o.aktywny = 1';
    }
    query += ' ORDER BY o.imie ASC';
    
    const [rows] = await pool.query<OpiekunRow[]>(query);
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching opiekunowie:', error);
    res.status(500).json({ error: 'Failed to fetch opiekunowie' });
  }
});

// GET /api/opiekunowie/:id - Get single opiekun
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    const [rows] = await pool.query<OpiekunRow[]>(
      `SELECT
         o.*,
         u.username AS user_username,
         u.full_name AS user_full_name,
         u.role AS user_role,
         u.is_active AS user_is_active
       FROM opiekunowie o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = ?`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Opiekun not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching opiekun:', error);
    res.status(500).json({ error: 'Failed to fetch opiekun' });
  }
});

// POST /api/opiekunowie - Create opiekun
router.post('/', async (req, res) => {
  try {
    const { imie, nazwisko, email, user_id, telefon, marza_procent } = req.body;
    
    if (!imie) {
      return res.status(400).json({ error: 'Imię jest wymagane' });
    }
    
    const linkedUserId = normalizeLinkedUserId(user_id);
    if (linkedUserId === 'invalid') {
      return res.status(400).json({ error: 'Invalid linked user ID' });
    }

    if (typeof linkedUserId === 'number') {
      const validation = await validateLinkedUser(linkedUserId);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.message || 'Invalid linked user' });
      }
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO opiekunowie (imie, nazwisko, email, user_id, telefon, marza_procent) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [imie, nazwisko || null, email || null, linkedUserId, telefon || null, marza_procent || 0]
    );
    
    res.status(201).json({ 
      id: result.insertId, 
      message: 'Opiekun created successfully' 
    });
  } catch (error: any) {
    console.error('Error creating opiekun:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      if (String(error.message || '').includes('uq_opiekunowie_user_id')) {
        return res.status(400).json({ error: 'This login user is already linked to another account manager' });
      }
      return res.status(400).json({ error: 'Opiekun o tym imieniu już istnieje' });
    }
    res.status(500).json({ error: 'Failed to create opiekun' });
  }
});

// PUT /api/opiekunowie/:id - Update opiekun
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { imie, nazwisko, email, user_id, telefon, marza_procent, aktywny } = req.body;
    
    const updates: string[] = [];
    const values: any[] = [];
    
    if (imie !== undefined) {
      updates.push('imie = ?');
      values.push(imie);
    }
    if (nazwisko !== undefined) {
      updates.push('nazwisko = ?');
      values.push(nazwisko);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email);
    }
    if (user_id !== undefined) {
      const linkedUserId = normalizeLinkedUserId(user_id);
      if (linkedUserId === 'invalid') {
        return res.status(400).json({ error: 'Invalid linked user ID' });
      }

      if (typeof linkedUserId === 'number') {
        const validation = await validateLinkedUser(linkedUserId);
        if (!validation.valid) {
          return res.status(400).json({ error: validation.message || 'Invalid linked user' });
        }
      }

      updates.push('user_id = ?');
      values.push(linkedUserId);
    }
    if (telefon !== undefined) {
      updates.push('telefon = ?');
      values.push(telefon);
    }
    if (marza_procent !== undefined) {
      updates.push('marza_procent = ?');
      values.push(marza_procent);
    }
    if (aktywny !== undefined) {
      updates.push('aktywny = ?');
      values.push(aktywny ? 1 : 0);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(id);
    
    await pool.query(
      `UPDATE opiekunowie SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    res.json({ message: 'Opiekun updated successfully' });
  } catch (error: any) {
    console.error('Error updating opiekun:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      if (String(error.message || '').includes('uq_opiekunowie_user_id')) {
        return res.status(400).json({ error: 'This login user is already linked to another account manager' });
      }
      return res.status(400).json({ error: 'Opiekun o tym imieniu już istnieje' });
    }
    res.status(500).json({ error: 'Failed to update opiekun' });
  }
});

// DELETE /api/opiekunowie/:id - Hard delete opiekun
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid opiekun ID' });
    }

    const [result] = await pool.query<ResultSetHeader>('DELETE FROM opiekunowie WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Opiekun not found' });
    }
    
    res.json({ message: 'Opiekun deleted successfully' });
  } catch (error) {
    console.error('Error deleting opiekun:', error);
    res.status(500).json({ error: 'Failed to delete opiekun' });
  }
});

// GET /api/opiekunowie/:id/stats - Get opiekun statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    const [stats] = await pool.query<RowDataPacket[]>(
      `SELECT 
        COUNT(*) as total_invoices,
        COALESCE(SUM(zysk), 0) as total_profit,
        COALESCE(SUM(prowizja_opiekuna), 0) as total_commission,
        COALESCE(AVG(marza_procent), 0) as avg_margin
       FROM invoices 
       WHERE opiekun_id = ?`,
      [id]
    );
    
    res.json(stats[0]);
  } catch (error) {
    console.error('Error fetching opiekun stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
