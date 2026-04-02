import type { NextFunction, Request, Response } from 'express';
import { writeAuditLog } from '../services/auditLog';

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE']);

function getForwardedIp(value: string): string {
  return value.split(',')[0].trim();
}

export function getRequestIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return getForwardedIp(forwarded);
  }

  if (Array.isArray(forwarded) && forwarded.length > 0 && forwarded[0]) {
    return getForwardedIp(forwarded[0]);
  }

  if (req.ip) {
    return req.ip;
  }

  return null;
}

export function auditWriteActions(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !WRITE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const user = req.user;
  const method = req.method.toUpperCase();
  const endpoint = req.originalUrl;
  const ipAddress = getRequestIp(req);
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

  res.on('finish', () => {
    void writeAuditLog({
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      userRole: user.role,
      eventType: 'api_write',
      method,
      endpoint,
      statusCode: res.statusCode,
      ipAddress,
      userAgent,
    });
  });

  next();
}
