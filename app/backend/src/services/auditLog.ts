import { pool } from '../config/database';

export interface CreateAuditLogPayload {
  userId: number | null;
  username: string | null;
  fullName: string | null;
  userRole: 'admin' | 'manager' | 'bookkeeping' | 'seller' | null;
  eventType: string;
  method: string;
  endpoint: string;
  statusCode: number;
  ipAddress: string | null;
  userAgent: string | null;
}

function limitText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  return value.slice(0, maxLength);
}

export async function writeAuditLog(payload: CreateAuditLogPayload): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO app_audit_logs (
         user_id,
         username,
         full_name,
         user_role,
         event_type,
         method,
         endpoint,
         status_code,
         ip_address,
         user_agent
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.userId,
        limitText(payload.username, 100),
        limitText(payload.fullName, 255),
        payload.userRole,
        limitText(payload.eventType, 100) || 'unknown',
        limitText(payload.method.toUpperCase(), 10) || 'GET',
        limitText(payload.endpoint, 500) || '-',
        payload.statusCode,
        limitText(payload.ipAddress, 100),
        limitText(payload.userAgent, 500),
      ]
    );
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}
