import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
  full_name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function verifyToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized - No token provided' });
    return;
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('FATAL: JWT_SECRET environment variable is not set');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }
    const decoded = jwt.verify(token, jwtSecret) as AuthUser;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
}

export function requireRole(...allowedRoles: Array<'admin' | 'manager' | 'bookkeeping' | 'seller'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ 
        error: 'Forbidden - Insufficient permissions',
        required: allowedRoles,
        current: req.user.role
      });
      return;
    }
    
    next();
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function shouldSkipApiRateLimit(): boolean {
  if (process.env.DISABLE_RATE_LIMIT === 'true') {
    return true;
  }

  if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_RATE_LIMIT !== 'true') {
    return true;
  }

  return false;
}

function sendRateLimitResponse(req: Request, res: Response, message: string): void {
  const retryAfterRaw = (req as any).rateLimit?.resetTime;
  const retryAfterSeconds = retryAfterRaw
    ? Math.max(1, Math.ceil((new Date(retryAfterRaw).getTime() - Date.now()) / 1000))
    : undefined;

  res.status(429).json({
    error: message,
    retry_after_seconds: retryAfterSeconds,
  });
}

const loginWindowMs = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const loginMax = parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 10);

const apiWindowMs = parsePositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60 * 1000);
const apiMax = parsePositiveInt(process.env.API_RATE_LIMIT_MAX, 600);

const uploadWindowMs = parsePositiveInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000);
const uploadMax = parsePositiveInt(process.env.UPLOAD_RATE_LIMIT_MAX, 60);

function getUserRateKey(req: Request, scope: string): string {
  if (req.user?.id) {
    return `${scope}:user:${req.user.id}`;
  }
  return `${scope}:ip:${req.ip}`;
}

export const loginLimiter = rateLimit({
  windowMs: loginWindowMs,
  max: loginMax,
  skip: shouldSkipApiRateLimit,
  handler: (req, res) => {
    sendRateLimitResponse(req, res, 'Too many login attempts, please try again later');
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export function createApiLimiter(scope: string) {
  return rateLimit({
    windowMs: apiWindowMs,
    max: apiMax,
    skip: shouldSkipApiRateLimit,
    keyGenerator: (req: Request) => getUserRateKey(req, `api:${scope}`),
    handler: (req, res) => {
      sendRateLimitResponse(req, res, 'Too many requests, please wait and try again');
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export const apiLimiter = createApiLimiter('global');

export const uploadLimiter = rateLimit({
  windowMs: uploadWindowMs,
  max: uploadMax,
  skip: shouldSkipApiRateLimit,
  keyGenerator: (req: Request) => getUserRateKey(req, 'upload'),
  handler: (req, res) => {
    sendRateLimitResponse(req, res, 'Too many file uploads, please try again later');
  },
  standardHeaders: true,
  legacyHeaders: false,
});
