import { Router } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { verifyToken, loginLimiter, type AuthUser } from '../middleware/auth';
import { getRequestIp } from '../middleware/audit';
import { z } from 'zod';
import { writeAuditLog } from '../services/auditLog';

const router = Router();

// Password complexity validation - requires at least 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
  is_active: number;
}

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: passwordSchema,
  full_name: z.string().min(1).max(255),
  role: z.enum(['admin', 'manager', 'bookkeeping', 'seller']),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  full_name: z.string().min(1).max(255).optional(),
  role: z.enum(['admin', 'manager', 'bookkeeping', 'seller']).optional(),
  is_active: z.boolean().optional(),
  password: passwordSchema.optional(),
});

const SERVICE_TOKEN_EXPIRES_IN = '365d';

interface ServiceUserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
  is_active: number;
}

function parseOwnerUserId(rawValue: string | undefined): number | null {
  if (!rawValue) return null;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function getServiceUserConfig(): {
  username: string;
  email: string;
  fullName: string;
} {
  const username = process.env.MCP_SERVICE_USERNAME?.trim() || 'mcp_service';
  const email = process.env.MCP_SERVICE_EMAIL?.trim() || `${username}@service.local`;
  const fullName = process.env.MCP_SERVICE_FULL_NAME?.trim() || 'MCP Service User';
  return { username, email, fullName };
}

async function ensureServiceUser(): Promise<ServiceUserRow> {
  const config = getServiceUserConfig();

  const [existingRows] = await pool.query<ServiceUserRow[]>(
    `SELECT id, username, email, full_name, role, is_active
     FROM users
     WHERE username = ?
     LIMIT 1`,
    [config.username]
  );

  if (existingRows.length > 0) {
    const existingUser = existingRows[0];
    if (existingUser.role !== 'admin') {
      throw new Error(`Service user "${config.username}" must have admin role`);
    }
    if (existingUser.is_active !== 1) {
      throw new Error(`Service user "${config.username}" is inactive`);
    }
    return existingUser;
  }

  const generatedPassword = randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(generatedPassword, 10);

  await pool.query<ResultSetHeader>(
    `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
     VALUES (?, ?, ?, ?, 'admin', 1)`,
    [config.username, config.email, passwordHash, config.fullName]
  );

  const [createdRows] = await pool.query<ServiceUserRow[]>(
    `SELECT id, username, email, full_name, role, is_active
     FROM users
     WHERE username = ?
     LIMIT 1`,
    [config.username]
  );

  if (createdRows.length === 0) {
    throw new Error('Failed to load created MCP service user');
  }

  return createdRows[0];
}

// POST /api/auth/login - Login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const ipAddress = getRequestIp(req);
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    
    const [users] = await pool.query<UserRow[]>(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );
    
    if (users.length === 0) {
      await writeAuditLog({
        userId: null,
        username,
        fullName: null,
        userRole: null,
        eventType: 'auth_login_failed',
        method: 'POST',
        endpoint: req.originalUrl,
        statusCode: 401,
        ipAddress,
        userAgent,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      await writeAuditLog({
        userId: user.id,
        username: user.username,
        fullName: user.full_name,
        userRole: user.role,
        eventType: 'auth_login_failed',
        method: 'POST',
        endpoint: req.originalUrl,
        statusCode: 401,
        ipAddress,
        userAgent,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = ?',
      [user.id]
    );
    
    const tokenPayload: AuthUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      full_name: user.full_name,
    };
    
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('FATAL: JWT_SECRET environment variable is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    const token = jwt.sign(
      tokenPayload,
      jwtSecret,
      { expiresIn: '8h' }
    );

    await writeAuditLog({
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      userRole: user.role,
      eventType: 'auth_login_success',
      method: 'POST',
      endpoint: req.originalUrl,
      statusCode: 200,
      ipAddress,
      userAgent,
    });
    
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      await writeAuditLog({
        userId: null,
        username: typeof req.body?.username === 'string' ? req.body.username : null,
        fullName: null,
        userRole: null,
        eventType: 'auth_login_failed',
        method: 'POST',
        endpoint: req.originalUrl,
        statusCode: 400,
        ipAddress: getRequestIp(req),
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', verifyToken, async (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/service-token - Issue long-lived MCP service token (admin owner only)
router.post('/service-token', verifyToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can issue service tokens' });
    }

    const ownerUserId = parseOwnerUserId(process.env.MCP_OWNER_USER_ID);
    if (ownerUserId && req.user.id !== ownerUserId) {
      return res.status(403).json({
        error: 'Only the configured MCP owner can issue service tokens',
        owner_user_id: ownerUserId,
      });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('FATAL: JWT_SECRET environment variable is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const serviceUser = await ensureServiceUser();
    const tokenPayload: AuthUser & { token_type: 'service'; scopes: string[] } = {
      id: serviceUser.id,
      username: serviceUser.username,
      email: serviceUser.email,
      role: 'admin',
      full_name: serviceUser.full_name,
      token_type: 'service',
      scopes: ['mcp:tools', 'ai:actions'],
    };

    const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: SERVICE_TOKEN_EXPIRES_IN });

    await writeAuditLog({
      userId: req.user.id,
      username: req.user.username,
      fullName: req.user.full_name,
      userRole: req.user.role,
      eventType: 'auth_service_token_issued',
      method: 'POST',
      endpoint: req.originalUrl,
      statusCode: 200,
      ipAddress: getRequestIp(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });

    return res.json({
      token,
      expires_in: SERVICE_TOKEN_EXPIRES_IN,
      service_user: {
        id: serviceUser.id,
        username: serviceUser.username,
        email: serviceUser.email,
        full_name: serviceUser.full_name,
        role: serviceUser.role,
      },
    });
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'Could not create MCP service user due to duplicate username/email. Set MCP_SERVICE_USERNAME and MCP_SERVICE_EMAIL.',
      });
    }

    console.error('Service token issue error:', error);
    return res.status(500).json({
      error: 'Failed to issue service token',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/auth/users - Create user (admin only)
router.post('/users', verifyToken, async (req, res) => {
  try {
    // Only admins can create users
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create users' });
    }
    
    const userData = createUserSchema.parse(req.body);
    
    // Hash password
    const password_hash = await bcrypt.hash(userData.password, 10);
    
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES (?, ?, ?, ?, ?)`,
      [userData.username, userData.email, password_hash, userData.full_name, userData.role]
    );

    await writeAuditLog({
      userId: req.user.id,
      username: req.user.username,
      fullName: req.user.full_name,
      userRole: req.user.role,
      eventType: 'user_create',
      method: 'POST',
      endpoint: req.originalUrl,
      statusCode: 201,
      ipAddress: getRequestIp(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    
    res.status(201).json({
      id: result.insertId,
      message: 'User created successfully',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// GET /api/auth/users - List users (admin only)
router.get('/users', verifyToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can list users' });
    }
    
    const [users] = await pool.query<UserRow[]>(
      `SELECT id, username, email, full_name, role, is_active, last_login_at, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    
    res.json({ data: users });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /api/auth/users/:id - Update user (admin only)
router.put('/users/:id', verifyToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update users' });
    }
    
    const userId = parseInt(String(req.params.id));
    const updates = updateUserSchema.parse(req.body);
    
    const updateFields: string[] = [];
    const values: any[] = [];
    
    if (updates.email !== undefined) {
      updateFields.push('email = ?');
      values.push(updates.email);
    }
    if (updates.full_name !== undefined) {
      updateFields.push('full_name = ?');
      values.push(updates.full_name);
    }
    if (updates.role !== undefined) {
      updateFields.push('role = ?');
      values.push(updates.role);
    }
    if (updates.is_active !== undefined) {
      updateFields.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }
    if (updates.password !== undefined) {
      const password_hash = await bcrypt.hash(updates.password, 10);
      updateFields.push('password_hash = ?');
      values.push(password_hash);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(userId);
    
    await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    await writeAuditLog({
      userId: req.user.id,
      username: req.user.username,
      fullName: req.user.full_name,
      userRole: req.user.role,
      eventType: 'user_update',
      method: 'PUT',
      endpoint: req.originalUrl,
      statusCode: 200,
      ipAddress: getRequestIp(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    
    res.json({ message: 'User updated successfully' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// PUT /api/auth/change-password - Change own password (any authenticated user)
const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: passwordSchema,
});

router.put('/change-password', verifyToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { current_password, new_password } = changePasswordSchema.parse(req.body);

    // Get user's current password hash
    const [users] = await pool.query<UserRow[]>(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(current_password, users[0].password_hash);
    if (!isValidPassword) {
      await writeAuditLog({
        userId: req.user.id,
        username: req.user.username,
        fullName: req.user.full_name,
        userRole: req.user.role,
        eventType: 'password_change_failed',
        method: 'PUT',
        endpoint: req.originalUrl,
        statusCode: 401,
        ipAddress: getRequestIp(req),
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password and update
    const newPasswordHash = await bcrypt.hash(new_password, 10);
    await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newPasswordHash, req.user.id]
    );

    await writeAuditLog({
      userId: req.user.id,
      username: req.user.username,
      fullName: req.user.full_name,
      userRole: req.user.role,
      eventType: 'password_change_success',
      method: 'PUT',
      endpoint: req.originalUrl,
      statusCode: 200,
      ipAddress: getRequestIp(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// DELETE /api/auth/users/:id - Delete user (admin only)
router.delete('/users/:id', verifyToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete users' });
    }
    
    const userId = parseInt(String(req.params.id));
    
    // Prevent deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const [result] = await pool.query<ResultSetHeader>('DELETE FROM users WHERE id = ?', [userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await writeAuditLog({
      userId: req.user.id,
      username: req.user.username,
      fullName: req.user.full_name,
      userRole: req.user.role,
      eventType: 'user_delete',
      method: 'DELETE',
      endpoint: req.originalUrl,
      statusCode: 200,
      ipAddress: getRequestIp(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
