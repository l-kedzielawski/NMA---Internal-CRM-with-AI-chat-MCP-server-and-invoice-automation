import fs from 'fs';
import path from 'path';

export const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
export const UPLOADS_ROOT = path.join(BACKEND_ROOT, 'uploads');
export const INVOICE_PDF_DIR = path.join(UPLOADS_ROOT, 'invoices');
export const LEAD_IMPORT_DIR = path.join(UPLOADS_ROOT, 'leads');
export const RESOURCE_FILES_DIR = path.join(UPLOADS_ROOT, 'resources');
export const COST_DOCUMENTS_DIR = path.join(UPLOADS_ROOT, 'costs');

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

export function ensureStorageDirs(): void {
  fs.mkdirSync(INVOICE_PDF_DIR, { recursive: true });
  fs.mkdirSync(LEAD_IMPORT_DIR, { recursive: true });
  fs.mkdirSync(RESOURCE_FILES_DIR, { recursive: true });
  fs.mkdirSync(COST_DOCUMENTS_DIR, { recursive: true });
}

export function sanitizeFileNamePart(value: string): string {
  return String(value)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'file';
}

export function formatInvoicePdfFileName(invoiceNumber: string): string {
  const normalized = String(invoiceNumber || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

  const ftMatch = normalized.match(/^FT\D*(\d{1,2})\D*(\d{1,2})\D*(\d{4})$/i);
  if (ftMatch) {
    const serial = ftMatch[1].padStart(2, '0');
    const month = ftMatch[2].padStart(2, '0');
    const year = ftMatch[3];
    return `FT_${serial}_${month}_${year}.pdf`;
  }

  return `${sanitizeFileNamePart(normalized || 'invoice')}.pdf`;
}

export function toStoredPath(absolutePath: string): string {
  const relative = path.relative(BACKEND_ROOT, absolutePath);
  return normalizeSlashes(relative);
}

export function resolveStoredPath(storedPath: string): string {
  if (!storedPath) return '';
  const absolutePath = path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(BACKEND_ROOT, storedPath);
  return absolutePath;
}

export function isPathInsideBackendRoot(absolutePath: string): boolean {
  const normalizedRoot = normalizeSlashes(path.resolve(BACKEND_ROOT)) + '/';
  const normalizedTarget = normalizeSlashes(path.resolve(absolutePath));
  return normalizedTarget === normalizeSlashes(path.resolve(BACKEND_ROOT)) || normalizedTarget.startsWith(normalizedRoot);
}
