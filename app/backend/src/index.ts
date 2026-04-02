import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pingDb } from './config/database';
import invoicesRouter from './routes/invoices';
import customersRouter from './routes/customers';
import productsRouter from './routes/products';
import invoiceItemsRouter from './routes/invoiceItems';
import uploadRouter from './routes/upload';
import opiekunowieRouter from './routes/opiekunowie';
import crmRouter from './routes/crm';
import authRouter from './routes/auth';
import logsRouter from './routes/logs';
import resourcesRouter from './routes/resources';
import costsRouter from './routes/costs';
import aiRouter from './routes/ai';
import { ensureCrmSchema } from './services/crmSchema';
import { ensureStorageDirs } from './services/fileStorage';
import { ensureInvoiceSchema } from './services/invoiceSchema';
import { ensureUserSchema } from './services/userSchema';
import { ensureResourceSchema } from './config/resourceSchema';
import { verifyToken, createApiLimiter, uploadLimiter } from './middleware/auth';
import { auditWriteActions } from './middleware/audit';

const app = express();
const PORT = Number(process.env.PORT || 3001);

const invoicesLimiter = createApiLimiter('invoices');
const customersLimiter = createApiLimiter('customers');
const productsLimiter = createApiLimiter('products');
const invoiceItemsLimiter = createApiLimiter('invoice-items');
const opiekunowieLimiter = createApiLimiter('opiekunowie');
const crmLimiter = createApiLimiter('crm');
const logsLimiter = createApiLimiter('logs');
const resourcesLimiter = createApiLimiter('resources');
const costsLimiter = createApiLimiter('costs');
const aiLimiter = createApiLimiter('ai');

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Configure CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400 // 24 hours preflight cache
}));

// Request size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Health check (public - no auth required)
app.get('/api/health', async (_req, res) => {
  const dbOk = await pingDb();
  if (dbOk) {
    return res.json({ ok: true, db: 'connected' });
  }
  return res.status(500).json({ ok: false, db: 'failed' });
});

// Auth routes (public - no auth required for login)
app.use('/api/auth', authRouter);

// Protected API Routes - all require authentication
app.use('/api/invoices/upload', verifyToken, uploadLimiter, auditWriteActions, uploadRouter);
app.use('/api/invoices', verifyToken, invoicesLimiter, auditWriteActions, invoicesRouter);
app.use('/api/customers', verifyToken, customersLimiter, auditWriteActions, customersRouter);
app.use('/api/products', verifyToken, productsLimiter, auditWriteActions, productsRouter);
app.use('/api/invoice-items', verifyToken, invoiceItemsLimiter, auditWriteActions, invoiceItemsRouter);
app.use('/api/opiekunowie', verifyToken, opiekunowieLimiter, auditWriteActions, opiekunowieRouter);
app.use('/api/crm', verifyToken, crmLimiter, auditWriteActions, crmRouter);
app.use('/api/logs', verifyToken, logsLimiter, logsRouter);
app.use('/api/resources', verifyToken, resourcesLimiter, auditWriteActions, resourcesRouter);
app.use('/api/costs', verifyToken, costsLimiter, auditWriteActions, costsRouter);
app.use('/api/ai', verifyToken, aiLimiter, auditWriteActions, aiRouter);

// Error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error',
    ...(isDevelopment && { stack: err.stack })
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

async function bootstrap(): Promise<void> {
  console.log('Bootstrap starting...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('PORT:', process.env.PORT);
  console.log('DB_HOST:', process.env.DB_HOST);
  console.log('DB_PORT:', process.env.DB_PORT);
  console.log('DB_NAME:', process.env.DB_NAME);
  console.log('DB_USER:', process.env.DB_USER);
  console.log('DB_PASSWORD set:', !!process.env.DB_PASSWORD);

  console.log('Ensuring storage dirs...');
  ensureStorageDirs();

  console.log('Running ensureUserSchema...');
  await ensureUserSchema();

  console.log('Running ensureInvoiceSchema...');
  await ensureInvoiceSchema();

  console.log('Running ensureCrmSchema...');
  await ensureCrmSchema();

  console.log('Running ensureResourceSchema...');
  await ensureResourceSchema();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start API:', error);
  console.error('Error stack:', error?.stack);
  process.exit(1);
});
