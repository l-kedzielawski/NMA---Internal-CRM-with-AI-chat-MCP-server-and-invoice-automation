import { Router } from 'express';
import { pool } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import {
  INVOICE_PDF_DIR,
  resolveStoredPath,
  isPathInsideBackendRoot,
  sanitizeFileNamePart,
  toStoredPath,
} from '../services/fileStorage';
import { generateInvoicePdf } from '../services/invoicePdf';
import { recalculateInvoicesFromProductPrices } from '../services/invoiceRecalculation';
import { requireRole } from '../middleware/auth';

const router = Router();
const requireAdmin = requireRole('admin');
const requireFinanceEditor = requireRole('admin', 'manager', 'bookkeeping');

const csvImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

router.use(requireRole('admin', 'manager', 'bookkeeping'));

interface InvoiceRow extends RowDataPacket {
  id: number;
  numer_faktury: string;
  customer_nazwa: string;
  customer_nip: string | null;
  data_wystawienia: Date;
  data_sprzedazy: Date;
  waluta: string;
  netto: number;
  brutto: number;
  zysk: number | null;
  marza_procent: number | null;
  status_platnosci: string;
  opiekun: string | null;
  opiekun_id: number | null;
  invoice_group_id: number | null;
  invoice_group_code: string | null;
  invoice_group_name: string | null;
  prowizja_opiekuna: number | null;
}

interface DashboardInvoiceRow extends RowDataPacket {
  id: number;
  data_wystawienia?: Date | string | null;
  netto: number | null;
  brutto: number | null;
  zaplacono: number | null;
  status_platnosci: string | null;
  zysk: number | null;
  marza_procent: number | null;
  prowizja_opiekuna: number | null;
  opiekun: string | null;
  opiekun_id: number | null;
  waluta: string | null;
  kurs_waluty: number | null;
}

interface DashboardManagerRow extends RowDataPacket {
  id: number;
  imie: string;
  nazwisko: string | null;
  user_id: number | null;
  marza_procent: number;
  aktywny: number;
}

interface OwnerAggregate {
  owner_id: number | null;
  owner_label: string;
  invoice_count: number;
  sales_net: number;
  profit_total: number;
  margin_weighted: number;
  commission_actual: number;
  commission_estimated: number;
}

interface CsvImportError {
  row: number;
  message: string;
}

interface CsvImportItemDraft {
  row: number;
  name: string;
  quantity: number;
  unit: string;
  netPrice: number;
  vatRate: number;
  purchasePrice: number | null;
  isShipping: boolean;
}

interface CsvImportInvoiceDraft {
  invoiceNumber: string;
  issueDate: string | null;
  saleDate: string | null;
  dueDate: string | null;
  paymentMethod: 'przelew' | 'pobranie' | 'karta' | 'gotowka' | null;
  currency: string;
  exchangeRateToPln: number;
  paymentStatus: 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot';
  paidAmount: number | null;
  notes: string | null;
  ownerId: number | null;
  customer: {
    name: string;
    nip: string | null;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    email: string | null;
    phone: string | null;
  };
  items: CsvImportItemDraft[];
}

interface CsvImportInvoiceComputed {
  invoiceNumber: string;
  customerName: string;
  itemCount: number;
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
  paymentStatus: 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot';
  paidAmount: number;
  ownerId: number | null;
}

interface InvoiceManagerSplitInput {
  opiekun_id: number;
  commission_percent: number;
}

interface InvoiceManagerSplitRow extends RowDataPacket {
  id: number;
  invoice_id: number;
  opiekun_id: number;
  commission_percent: number;
  commission_amount: number | null;
  sort_order: number;
  opiekun_imie: string | null;
  opiekun_nazwisko: string | null;
}

function normalizeManagerSplitsInput(value: unknown): InvoiceManagerSplitInput[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: InvoiceManagerSplitInput[] = [];
  const uniqueManagerIds = new Set<number>();

  for (const entry of value) {
    const managerId = Number((entry as { opiekun_id?: unknown })?.opiekun_id);
    const commissionPercent = Number((entry as { commission_percent?: unknown })?.commission_percent);

    if (!Number.isInteger(managerId) || managerId <= 0) {
      return null;
    }

    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      return null;
    }

    if (uniqueManagerIds.has(managerId)) {
      return null;
    }

    uniqueManagerIds.add(managerId);
    normalized.push({
      opiekun_id: managerId,
      commission_percent: roundMoney(commissionPercent),
    });
  }

  if (normalized.length > 2) {
    return null;
  }

  const totalPercent = normalized.reduce((sum, row) => sum + row.commission_percent, 0);
  if (totalPercent > 100.001) {
    return null;
  }

  return normalized;
}

function makeManagerDisplayName(firstName: unknown, lastName: unknown): string {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  return `${first} ${last}`.trim() || first;
}

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).replace(',', '.');
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampMarginPercent(value: number | null): number | null {
  if (value === null) return null;
  if (value > 999.99) return 999.99;
  if (value < -999.99) return -999.99;
  return value;
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

function normalizePersonName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeDateValue(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseOptionalEntityId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeInvoiceNumber(value: unknown): string {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\\/g, '/')
    .replace(/\s+/g, '')
    .replace(/\/+/g, '/');

  if (!raw) return '';

  const prefixed = raw.replace(/^(FT|FV|FS)(\d)/, '$1/$2');
  return prefixed.toLowerCase();
}

function canonicalInvoiceNumber(value: unknown): string {
  const normalized = normalizeInvoiceNumber(value);
  return normalized.toUpperCase();
}

function twoDigitMonth(value: number): string {
  return String(value).padStart(2, '0');
}

function normalizeCsvText(value: unknown): string {
  if (value === null || value === undefined) return '';

  return String(value)
    .normalize('NFC')
    .replace(/\uFEFF/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function toCsvCell(value: unknown, separator = ';'): string {
  const text = normalizeCsvText(value);
  const escaped = text.replace(/"/g, '""');
  if (escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r') || escaped.includes(separator)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function encodeCsvForDownload(csv: string, requestedEncoding: unknown): {
  content: Buffer;
  charset: string;
} {
  const encoding = String(requestedEncoding || '').toLowerCase();

  if (encoding === 'utf16le' || encoding === 'utf-16le' || encoding === 'excel') {
    const utf16Buffer = iconv.encode(csv, 'utf16-le');
    return {
      content: Buffer.concat([Buffer.from([0xff, 0xfe]), utf16Buffer]),
      charset: 'utf-16le',
    };
  }

  if (encoding === 'cp1250' || encoding === 'win1250' || encoding === 'windows-1250') {
    return {
      content: iconv.encode(csv, 'win1250'),
      charset: 'windows-1250',
    };
  }

  return {
    content: Buffer.from(`\uFEFF${csv}`, 'utf8'),
    charset: 'utf-8',
  };
}

function normalizePaymentMethod(value: unknown): 'przelew' | 'pobranie' | 'karta' | 'gotowka' | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[ąĄ]/g, 'a')
    .replace(/[ćĆ]/g, 'c')
    .replace(/[ęĘ]/g, 'e')
    .replace(/[łŁ]/g, 'l')
    .replace(/[ńŃ]/g, 'n')
    .replace(/[óÓ]/g, 'o')
    .replace(/[śŚ]/g, 's')
    .replace(/[źŹżŻ]/g, 'z')
    .replace(/\s+/g, ' ');

  if (normalized === 'przelew' || normalized === 'transfer' || normalized === 'bank transfer') {
    return 'przelew';
  }

  if (normalized === 'pobranie' || normalized === 'cod') {
    return 'pobranie';
  }

  if (normalized === 'karta' || normalized === 'karta platnicza' || normalized === 'card') {
    return 'karta';
  }

  if (normalized === 'gotowka' || normalized === 'cash') {
    return 'gotowka';
  }

  return null;
}

function normalizeCsvHeaderName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseImportPaymentStatus(value: unknown): 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot' {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!normalized) return 'nieoplacona';
  if (normalized === 'oplacona' || normalized === 'paid') return 'oplacona';
  if (normalized === 'nieoplacona' || normalized === 'unpaid') return 'nieoplacona';
  if (normalized === 'czesciowa' || normalized === 'czesciowo' || normalized === 'partial') return 'czesciowa';
  if (normalized === 'zwrot' || normalized === 'refund') return 'zwrot';
  return 'nieoplacona';
}

function parseImportDate(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const dotted = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const year = Number(dotted[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const normalized = normalizeDateValue(raw);
  return normalized;
}

function parseCsvMatrix(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const pushCell = () => {
    currentRow.push(currentCell.trim());
    currentCell = '';
  };

  const pushRow = () => {
    if (currentRow.length === 0) return;
    rows.push(currentRow);
    currentRow = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = i + 1 < text.length ? text[i + 1] : '';

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === separator) {
      pushCell();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') {
        i += 1;
      }
      pushCell();
      pushRow();
      continue;
    }

    currentCell += char;
  }

  pushCell();
  pushRow();

  return rows.filter((row) => row.some((cell) => String(cell || '').trim().length > 0));
}

function detectCsvSeparator(firstLine: string): string {
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

function extractMappedValue(
  row: Record<string, string>,
  candidates: string[]
): string {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return String(row[key] || '').trim();
    }
  }
  return '';
}

function parseInvoiceCsvBuffer(buffer: Buffer): {
  invoices: CsvImportInvoiceDraft[];
  errors: CsvImportError[];
  totalRows: number;
} {
  const textUtf8 = iconv.decode(buffer, 'utf8').replace(/\uFEFF/g, '').trim();
  if (!textUtf8) {
    return {
      invoices: [],
      errors: [{ row: 0, message: 'CSV file is empty' }],
      totalRows: 0,
    };
  }

  const firstLine = textUtf8.split(/\r?\n/).find((line) => line.trim().length > 0) || '';
  const separator = detectCsvSeparator(firstLine);
  const rows = parseCsvMatrix(textUtf8, separator);

  if (rows.length < 2) {
    return {
      invoices: [],
      errors: [{ row: 1, message: 'CSV must contain header and at least one data row' }],
      totalRows: 0,
    };
  }

  const headers = rows[0].map((header) => normalizeCsvHeaderName(header));
  const dataRows = rows.slice(1);
  const errors: CsvImportError[] = [];
  const invoiceMap = new Map<string, CsvImportInvoiceDraft>();

  const ensureRequiredHeader = (aliases: string[], label: string): void => {
    const hasHeader = aliases.some((alias) => headers.includes(alias));
    if (!hasHeader) {
      errors.push({ row: 1, message: `Missing required column: ${label}` });
    }
  };

  ensureRequiredHeader(['numer_faktury', 'invoice_number', 'nr_faktury'], 'numer_faktury');
  ensureRequiredHeader(['customer_nazwa', 'kontrahent', 'nabywca'], 'customer_nazwa');
  ensureRequiredHeader(['item_nazwa', 'nazwa_towaru', 'nazwa_produktu'], 'item_nazwa');
  ensureRequiredHeader(['ilosc', 'quantity'], 'ilosc');
  ensureRequiredHeader(['cena_netto', 'net_price', 'price_net'], 'cena_netto');

  if (errors.length > 0) {
    return { invoices: [], errors, totalRows: dataRows.length };
  }

  dataRows.forEach((rawRow, idx) => {
    const rowNumber = idx + 2;
    const row: Record<string, string> = {};
    headers.forEach((header, cellIndex) => {
      row[header] = String(rawRow[cellIndex] || '').trim();
    });

    const invoiceNumberRaw = extractMappedValue(row, ['numer_faktury', 'invoice_number', 'nr_faktury']);
    const invoiceNumber = canonicalInvoiceNumber(invoiceNumberRaw);
    if (!invoiceNumber) {
      errors.push({ row: rowNumber, message: 'numer_faktury is required' });
      return;
    }

    const customerName = extractMappedValue(row, ['customer_nazwa', 'kontrahent', 'nabywca']);
    if (!customerName) {
      errors.push({ row: rowNumber, message: `customer_nazwa is required for invoice ${invoiceNumber}` });
      return;
    }

    const itemName = extractMappedValue(row, ['item_nazwa', 'nazwa_towaru', 'nazwa_produktu']);
    if (!itemName) {
      errors.push({ row: rowNumber, message: `item_nazwa is required for invoice ${invoiceNumber}` });
      return;
    }

    const quantity = toNumber(extractMappedValue(row, ['ilosc', 'quantity']), NaN);
    const netPrice = toNumber(extractMappedValue(row, ['cena_netto', 'net_price', 'price_net']), NaN);
    const vatRateRaw = extractMappedValue(row, ['stawka_vat', 'vat_rate', 'vat']);
    const vatRate = vatRateRaw ? toNumber(vatRateRaw, NaN) : 23;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push({ row: rowNumber, message: `Invalid ilosc for invoice ${invoiceNumber}` });
      return;
    }

    if (!Number.isFinite(netPrice) || netPrice < 0) {
      errors.push({ row: rowNumber, message: `Invalid cena_netto for invoice ${invoiceNumber}` });
      return;
    }

    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      errors.push({ row: rowNumber, message: `Invalid stawka_vat for invoice ${invoiceNumber}` });
      return;
    }

    const currency = (extractMappedValue(row, ['waluta', 'currency']) || 'PLN').toUpperCase();
    const fxRateRaw = extractMappedValue(row, ['kurs_waluty', 'fx_rate', 'rate']);
    const exchangeRateToPln = currency === 'PLN'
      ? 1
      : toNumber(fxRateRaw, NaN);

    if (currency !== 'PLN' && (!Number.isFinite(exchangeRateToPln) || exchangeRateToPln <= 0)) {
      errors.push({ row: rowNumber, message: `Missing/invalid kurs_waluty for non-PLN invoice ${invoiceNumber}` });
      return;
    }

    const paymentMethodRaw = extractMappedValue(row, ['forma_platnosci', 'payment_method']);
    const paymentMethod = paymentMethodRaw ? normalizePaymentMethod(paymentMethodRaw) : null;
    if (paymentMethodRaw && paymentMethod === null) {
      errors.push({ row: rowNumber, message: `Invalid forma_platnosci for invoice ${invoiceNumber}` });
      return;
    }

    const paymentStatus = parseImportPaymentStatus(extractMappedValue(row, ['status_platnosci', 'payment_status', 'status']));
    const paidAmountRaw = extractMappedValue(row, ['zaplacono', 'paid_amount']);
    const paidAmount = paidAmountRaw ? toNumber(paidAmountRaw, NaN) : null;
    if (paidAmountRaw && (!Number.isFinite(paidAmount!) || paidAmount! < 0)) {
      errors.push({ row: rowNumber, message: `Invalid zaplacono for invoice ${invoiceNumber}` });
      return;
    }

    const ownerIdRaw = extractMappedValue(row, ['opiekun_id', 'owner_id']);
    const ownerId = ownerIdRaw ? Number(ownerIdRaw) : null;
    if (ownerIdRaw && (!Number.isInteger(ownerId) || Number(ownerId) <= 0)) {
      errors.push({ row: rowNumber, message: `Invalid opiekun_id for invoice ${invoiceNumber}` });
      return;
    }

    const invoiceDraft = invoiceMap.get(invoiceNumber) || {
      invoiceNumber,
      issueDate: parseImportDate(extractMappedValue(row, ['data_wystawienia', 'issue_date'])),
      saleDate: parseImportDate(extractMappedValue(row, ['data_sprzedazy', 'sale_date'])),
      dueDate: parseImportDate(extractMappedValue(row, ['termin_platnosci', 'due_date'])),
      paymentMethod,
      currency,
      exchangeRateToPln,
      paymentStatus,
      paidAmount: Number.isFinite(paidAmount as number) ? Number(paidAmount) : null,
      notes: extractMappedValue(row, ['uwagi', 'notes']) || null,
      ownerId,
      customer: {
        name: customerName,
        nip: extractMappedValue(row, ['customer_nip', 'nip']) || null,
        street: extractMappedValue(row, ['customer_ulica', 'ulica']) || null,
        postalCode: extractMappedValue(row, ['customer_kod_pocztowy', 'kod_pocztowy']) || null,
        city: extractMappedValue(row, ['customer_miasto', 'miasto']) || null,
        country: extractMappedValue(row, ['customer_kraj', 'kraj']) || 'Polska',
        email: extractMappedValue(row, ['customer_email', 'email']) || null,
        phone: extractMappedValue(row, ['customer_telefon', 'telefon']) || null,
      },
      items: [],
    };

    const purchasePriceRaw = extractMappedValue(row, ['cena_zakupu', 'purchase_price']);
    const purchasePrice = purchasePriceRaw ? toNumber(purchasePriceRaw, NaN) : null;
    if (purchasePriceRaw && (!Number.isFinite(purchasePrice!) || purchasePrice! < 0)) {
      errors.push({ row: rowNumber, message: `Invalid cena_zakupu for invoice ${invoiceNumber}` });
      return;
    }

    const isShippingRaw = extractMappedValue(row, ['is_shipping', 'shipping']);
    const isShipping = ['1', 'true', 'yes', 'tak'].includes(String(isShippingRaw || '').trim().toLowerCase());

    invoiceDraft.items.push({
      row: rowNumber,
      name: itemName,
      quantity: Number(quantity),
      unit: extractMappedValue(row, ['jednostka', 'unit']) || 'szt',
      netPrice: Number(netPrice),
      vatRate: Number(vatRate),
      purchasePrice: Number.isFinite(purchasePrice as number) ? Number(purchasePrice) : null,
      isShipping,
    });

    invoiceMap.set(invoiceNumber, invoiceDraft);
  });

  const invoices = Array.from(invoiceMap.values()).filter((entry) => entry.items.length > 0);
  return {
    invoices,
    errors,
    totalRows: dataRows.length,
  };
}

function computeImportedInvoiceTotals(invoice: CsvImportInvoiceDraft): CsvImportInvoiceComputed {
  const totals = invoice.items.reduce(
    (acc, item) => {
      const valueNet = roundMoney(item.quantity * item.netPrice);
      const valueVat = roundMoney((valueNet * item.vatRate) / 100);
      const valueGross = roundMoney(valueNet + valueVat);
      return {
        netTotal: roundMoney(acc.netTotal + valueNet),
        vatTotal: roundMoney(acc.vatTotal + valueVat),
        grossTotal: roundMoney(acc.grossTotal + valueGross),
      };
    },
    {
      netTotal: 0,
      vatTotal: 0,
      grossTotal: 0,
    }
  );

  return {
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer.name,
    itemCount: invoice.items.length,
    netTotal: totals.netTotal,
    vatTotal: totals.vatTotal,
    grossTotal: totals.grossTotal,
    paymentStatus: invoice.paymentStatus,
    paidAmount: normalizeImportedPaidAmount(invoice.paymentStatus, invoice.paidAmount, totals.grossTotal),
    ownerId: invoice.ownerId,
  };
}

function normalizeImportedPaidAmount(
  paymentStatus: CsvImportInvoiceDraft['paymentStatus'],
  paidAmount: number | null,
  grossTotal: number
): number {
  if (paymentStatus === 'oplacona') {
    return roundMoney(grossTotal);
  }

  if (paymentStatus === 'nieoplacona' || paymentStatus === 'zwrot') {
    return 0;
  }

  const raw = Number.isFinite(paidAmount as number) ? Number(paidAmount) : 0;
  if (raw <= 0) return 0;
  if (raw >= grossTotal) return roundMoney(grossTotal);
  return roundMoney(raw);
}

async function getRecalculationSnapshot(invoiceIds: number[]): Promise<{
  invoices_total: number;
  invoices_negative: number;
  total_profit: number;
  item_price_mismatches: number;
  non_pln_invoices: number;
}> {
  if (invoiceIds.length === 0) {
    return {
      invoices_total: 0,
      invoices_negative: 0,
      total_profit: 0,
      item_price_mismatches: 0,
      non_pln_invoices: 0,
    };
  }

  const [invoiceStatsRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS invoices_total,
       SUM(CASE WHEN zysk < 0 THEN 1 ELSE 0 END) AS invoices_negative,
       ROUND(SUM(COALESCE(zysk, 0)), 2) AS total_profit,
       SUM(CASE WHEN UPPER(COALESCE(waluta, 'PLN')) <> 'PLN' THEN 1 ELSE 0 END) AS non_pln_invoices
     FROM invoices
     WHERE id IN (?)`,
    [invoiceIds]
  );

  const [mismatchRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS item_price_mismatches
     FROM invoice_items ii
     JOIN products p ON p.id = ii.product_id
     WHERE ii.invoice_id IN (?)
       AND ii.cena_zakupu IS NOT NULL
       AND p.cena_zakupu IS NOT NULL
       AND ABS(ii.cena_zakupu - p.cena_zakupu) > 0.009`,
    [invoiceIds]
  );

  return {
    invoices_total: Number(invoiceStatsRows[0]?.invoices_total || 0),
    invoices_negative: Number(invoiceStatsRows[0]?.invoices_negative || 0),
    total_profit: Number(invoiceStatsRows[0]?.total_profit || 0),
    item_price_mismatches: Number(mismatchRows[0]?.item_price_mismatches || 0),
    non_pln_invoices: Number(invoiceStatsRows[0]?.non_pln_invoices || 0),
  };
}

async function getManagerSplitsForInvoices(invoiceIds: number[]): Promise<Map<number, Array<{
  id: number;
  opiekun_id: number;
  opiekun_name: string;
  commission_percent: number;
  commission_amount: number | null;
  sort_order: number;
}>>> {
  const map = new Map<number, Array<{
    id: number;
    opiekun_id: number;
    opiekun_name: string;
    commission_percent: number;
    commission_amount: number | null;
    sort_order: number;
  }>>();

  if (invoiceIds.length === 0) {
    return map;
  }

  const [rows] = await pool.query<InvoiceManagerSplitRow[]>(
    `SELECT
       ims.id,
       ims.invoice_id,
       ims.opiekun_id,
       ims.commission_percent,
       ims.commission_amount,
       ims.sort_order,
       o.imie AS opiekun_imie,
       o.nazwisko AS opiekun_nazwisko
     FROM invoice_manager_splits ims
     LEFT JOIN opiekunowie o ON o.id = ims.opiekun_id
     WHERE ims.invoice_id IN (?)
     ORDER BY ims.invoice_id ASC, ims.sort_order ASC, ims.id ASC`,
    [invoiceIds]
  );

  for (const row of rows) {
    const invoiceId = Number(row.invoice_id);
    const current = map.get(invoiceId) || [];
    current.push({
      id: Number(row.id),
      opiekun_id: Number(row.opiekun_id),
      opiekun_name: makeManagerDisplayName(row.opiekun_imie, row.opiekun_nazwisko),
      commission_percent: Number(row.commission_percent || 0),
      commission_amount: row.commission_amount === null ? null : Number(row.commission_amount || 0),
      sort_order: Number(row.sort_order || 1),
    });
    map.set(invoiceId, current);
  }

  return map;
}

// GET /api/invoices - List all invoices with pagination and filters
// GET /api/invoices/next-number - Suggest next sequential invoice number
router.get('/next-number', async (req, res) => {
  try {
    const normalizedDate = normalizeDateValue(req.query.date);
    const basis = normalizedDate ? new Date(`${normalizedDate}T00:00:00Z`) : new Date();
    const year = basis.getUTCFullYear();
    const month = twoDigitMonth(basis.getUTCMonth() + 1);
    const requestedPrefixRaw = String(req.query.prefix || '').trim().toUpperCase();
    const requestedPrefix = ['FT', 'FV', 'FS'].includes(requestedPrefixRaw) ? requestedPrefixRaw : null;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT numer_faktury
       FROM invoices
       WHERE numer_faktury REGEXP ?`,
      [`^(FT|FV|FS)/[0-9]+/${month}/${year}$`]
    );

    const parsedRows = rows
      .map((row) => {
        const raw = String(row.numer_faktury || '').trim().toUpperCase();
        const match = raw.match(/^(FT|FV|FS)\/(\d+)\/(\d{2})\/(\d{4})$/);
        if (!match) return null;

        return {
          prefix: match[1],
          sequence: Number(match[2]),
        };
      })
      .filter((entry): entry is { prefix: string; sequence: number } => Boolean(entry));

    const availablePrefixes = new Set(parsedRows.map((entry) => entry.prefix));
    const prefix = requestedPrefix
      || (availablePrefixes.has('FT') ? 'FT' : availablePrefixes.has('FV') ? 'FV' : availablePrefixes.has('FS') ? 'FS' : 'FT');

    const maxSequence = parsedRows
      .filter((entry) => entry.prefix === prefix)
      .reduce((max, entry) => Math.max(max, entry.sequence), 0);

    const nextSequence = maxSequence + 1;
    const nextNumber = `${prefix}/${nextSequence}/${month}/${year}`;

    return res.json({
      number: nextNumber,
      prefix,
      sequence: nextSequence,
      period: {
        month,
        year,
      },
    });
  } catch (error) {
    console.error('Error generating next invoice number:', error);
    return res.status(500).json({ error: 'Failed to generate next invoice number' });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string) || 20));
    const offset = (page - 1) * perPage;

    const { opiekun, opiekun_id, status, data_od, data_do, search, invoice_group_id } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    const opiekunId = opiekun_id ? parseInt(String(opiekun_id), 10) : null;

    if (opiekunId !== null && !Number.isNaN(opiekunId)) {
      whereClause += ` AND (
        i.opiekun_id = ?
        OR EXISTS (
          SELECT 1
          FROM invoice_manager_splits ims_filter
          WHERE ims_filter.invoice_id = i.id
            AND ims_filter.opiekun_id = ?
        )
      )`;
      params.push(opiekunId);
      params.push(opiekunId);
    } else if (opiekun) {
      whereClause += ' AND i.opiekun = ?';
      params.push(opiekun);
    }

    if (status) {
      whereClause += ' AND i.status_platnosci = ?';
      params.push(status);
    }

    if (data_od) {
      whereClause += ' AND i.data_wystawienia >= ?';
      params.push(data_od);
    }

    if (data_do) {
      whereClause += ' AND i.data_wystawienia <= ?';
      params.push(data_do);
    }

    if (search) {
      whereClause += ' AND (i.numer_faktury LIKE ? OR c.nazwa LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (invoice_group_id !== undefined) {
      const rawGroupFilter = String(invoice_group_id).trim().toLowerCase();
      if (rawGroupFilter === 'none') {
        whereClause += ' AND i.invoice_group_id IS NULL';
      } else {
        const groupId = parseOptionalEntityId(invoice_group_id);
        if (!groupId) {
          return res.status(400).json({ error: 'Invalid invoice_group_id filter' });
        }
        whereClause += ' AND i.invoice_group_id = ?';
        params.push(groupId);
      }
    }

    // Count total
    const [countResult] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM invoices i 
       JOIN customers c ON i.customer_id = c.id ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;

    // Get invoices
    const [rows] = await pool.query<InvoiceRow[]>(
      `SELECT 
        i.id,
        i.numer_faktury,
        c.nazwa as customer_nazwa,
        c.nip as customer_nip,
        i.data_wystawienia,
        i.data_sprzedazy,
        i.waluta,
        i.netto,
        i.brutto,
        i.zysk,
        i.marza_procent,
        i.pdf_path,
        i.prowizja_opiekuna,
        i.status_platnosci,
        i.opiekun,
        i.opiekun_id,
        i.invoice_group_id,
        ig.code as invoice_group_code,
        ig.name as invoice_group_name,
        o.imie as opiekun_imie,
        o.marza_procent as opiekun_marza
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      LEFT JOIN opiekunowie o ON i.opiekun_id = o.id
      LEFT JOIN invoice_groups ig ON i.invoice_group_id = ig.id
      ${whereClause}
      ORDER BY i.data_wystawienia DESC
      LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    const invoiceIds = rows.map((row) => Number(row.id));
    const managerSplitsByInvoiceId = await getManagerSplitsForInvoices(invoiceIds);

    const rowsWithManagers = rows.map((row) => ({
      ...row,
      managers: managerSplitsByInvoiceId.get(Number(row.id)) || [],
    }));

    res.json({
      data: rowsWithManagers,
      total,
      page,
      per_page: perPage
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// GET /api/invoices/dashboard/summary - aggregated finance metrics for dashboard
router.get('/dashboard/summary', async (req, res) => {
  try {
    const { data_od, data_do } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: string[] = [];

    if (data_od) {
      whereClause += ' AND i.data_wystawienia >= ?';
      params.push(String(data_od));
    }

    if (data_do) {
      whereClause += ' AND i.data_wystawienia <= ?';
      params.push(String(data_do));
    }

    const [invoiceRows] = await pool.query<DashboardInvoiceRow[]>(
      `SELECT
         i.id,
         i.netto,
         i.brutto,
         i.zaplacono,
         i.status_platnosci,
         i.zysk,
         i.marza_procent,
         i.prowizja_opiekuna,
         i.opiekun,
         i.opiekun_id,
         i.waluta,
         i.kurs_waluty
       FROM invoices i
       ${whereClause}`,
      params
    );

    const [managerRows] = await pool.query<DashboardManagerRow[]>(
      `SELECT id, imie, nazwisko, user_id, marza_procent, aktywny
       FROM opiekunowie`
    );

    const managerById = new Map<number, { displayName: string; commissionPercent: number; names: Set<string>; userId: number | null }>();
    const managerIdsByName = new Map<string, number[]>();

    for (const row of managerRows) {
      const id = Number(row.id);
      const firstName = String(row.imie || '').trim();
      const lastName = String(row.nazwisko || '').trim();
      const displayName = `${firstName} ${lastName}`.trim() || firstName;
      const normalizedNames = new Set<string>();
      const normalizedFirstName = normalizePersonName(firstName);
      const normalizedDisplayName = normalizePersonName(displayName);

      if (normalizedFirstName) normalizedNames.add(normalizedFirstName);
      if (normalizedDisplayName) normalizedNames.add(normalizedDisplayName);

      managerById.set(id, {
        displayName,
        commissionPercent: Number(row.marza_procent || 0),
        names: normalizedNames,
        userId: row.user_id !== null ? Number(row.user_id) : null,
      });

      normalizedNames.forEach((name) => {
        const current = managerIdsByName.get(name) || [];
        managerIdsByName.set(name, [...current, id]);
      });
    }

    const linkedManager = req.user?.id
      ? managerRows.find((row) => row.user_id !== null && Number(row.user_id) === req.user?.id) || null
      : null;

    const linkedManagerId = linkedManager ? Number(linkedManager.id) : null;
    const linkedManagerMeta = linkedManagerId ? managerById.get(linkedManagerId) : null;
    const currentUserNames = new Set<string>();

    const userFullName = normalizePersonName(req.user?.full_name);
    if (userFullName) currentUserNames.add(userFullName);

    if (linkedManagerMeta) {
      linkedManagerMeta.names.forEach((name) => currentUserNames.add(name));
    }

    const ownerAggMap = new Map<string, OwnerAggregate & { margin_profit_sum: number; margin_sales_sum: number }>();

    const totals = {
      invoice_count: 0,
      unpaid_invoice_count: 0,
      sales_net: 0,
      sales_gross: 0,
      paid_total: 0,
      receivables_open: 0,
      paid_ratio: 0,
      profit_total: 0,
      margin_weighted: 0,
    };

    const mySummary = {
      linked_manager_id: linkedManagerId,
      linked_manager_name: linkedManagerMeta?.displayName || null,
      commission_percent: linkedManagerMeta?.commissionPercent ?? null,
      invoice_count: 0,
      sales_net: 0,
      profit_total: 0,
      margin_weighted: 0,
      commission_actual: 0,
      commission_estimated: 0,
      commission_gap: 0,
    };

    for (const row of invoiceRows) {
      const salesNetRaw = Number(row.netto || 0);
      const salesGrossRaw = Number(row.brutto || 0);
      const paymentStatus = String(row.status_platnosci || '').trim().toLowerCase();
      const paidRawExplicit = row.zaplacono === null || row.zaplacono === undefined
        ? null
        : Number(row.zaplacono || 0);
      const isPaidStatus = paymentStatus === 'oplacona';
      const isUnpaidStatus = paymentStatus === 'nieoplacona';
      const paidRaw = isPaidStatus
        ? salesGrossRaw
        : isUnpaidStatus
          ? 0
          : (paidRawExplicit ?? 0);
      const currencyCode = String(row.waluta || 'PLN').trim().toUpperCase();
      const exchangeRateToPln = currencyCode === 'PLN'
        ? 1
        : (() => {
            const rate = Number(row.kurs_waluty || 0);
            return Number.isFinite(rate) && rate > 0 ? rate : 1;
          })();
      const salesNet = roundMoney(salesNetRaw * exchangeRateToPln);
      const salesGross = roundMoney(salesGrossRaw * exchangeRateToPln);
      const paidTotal = roundMoney(paidRaw * exchangeRateToPln);
      const receivablesOpen = Math.max(roundMoney(salesGross - paidTotal), 0);
      const isUnpaidByStatus = isUnpaidStatus || paymentStatus === 'czesciowa';
      const isUnpaidLegacyFallback = !paymentStatus && receivablesOpen > 0.01;
      const profit = Number(row.zysk || 0);
      const rawOwner = String(row.opiekun || '').trim();
      const normalizedRawOwner = normalizePersonName(rawOwner);

      let ownerId = row.opiekun_id !== null ? Number(row.opiekun_id) : null;
      if (ownerId !== null && !managerById.has(ownerId)) {
        ownerId = null;
      }

      if (ownerId === null && normalizedRawOwner) {
        const candidateIds = managerIdsByName.get(normalizedRawOwner) || [];
        if (candidateIds.length === 1) {
          ownerId = candidateIds[0];
        }
      }

      const ownerManager = ownerId !== null ? managerById.get(ownerId) : null;
      const ownerLabel = ownerManager?.displayName || rawOwner || 'Unassigned';
      const ownerKey = ownerId !== null
        ? `id:${ownerId}`
        : `name:${normalizePersonName(ownerLabel) || 'unassigned'}`;

      const commissionActual = row.prowizja_opiekuna === null ? 0 : Number(row.prowizja_opiekuna || 0);
      const commissionEstimated = ownerManager
        ? roundMoney((profit * ownerManager.commissionPercent) / 100)
        : 0;

      const ownerAgg = ownerAggMap.get(ownerKey) || {
        owner_id: ownerId,
        owner_label: ownerLabel,
        invoice_count: 0,
        sales_net: 0,
        profit_total: 0,
        margin_weighted: 0,
        commission_actual: 0,
        commission_estimated: 0,
        margin_profit_sum: 0,
        margin_sales_sum: 0,
      };

      ownerAgg.invoice_count += 1;
      ownerAgg.sales_net += salesNet;
      ownerAgg.profit_total += profit;
      ownerAgg.commission_actual += commissionActual;
      ownerAgg.commission_estimated += commissionEstimated;
      ownerAgg.margin_profit_sum += profit;
      ownerAgg.margin_sales_sum += salesNet;
      ownerAggMap.set(ownerKey, ownerAgg);

      totals.invoice_count += 1;
      if (isUnpaidByStatus || isUnpaidLegacyFallback) {
        totals.unpaid_invoice_count += 1;
      }
      totals.sales_net += salesNet;
      totals.sales_gross += salesGross;
      totals.paid_total += paidTotal;
      totals.receivables_open += receivablesOpen;
      totals.profit_total += profit;

      const ownerMatchesUserById = linkedManagerId !== null && ownerId === linkedManagerId;
      const ownerMatchesUserByName = normalizedRawOwner && currentUserNames.has(normalizedRawOwner);

      if (ownerMatchesUserById || ownerMatchesUserByName) {
        mySummary.invoice_count += 1;
        mySummary.sales_net += salesNet;
        mySummary.profit_total += profit;
        mySummary.commission_actual += commissionActual;

        const userCommissionPercent = linkedManagerMeta?.commissionPercent ?? ownerManager?.commissionPercent ?? 0;
        mySummary.commission_estimated += roundMoney((profit * userCommissionPercent) / 100);
      }
    }

    totals.margin_weighted = totals.sales_net > 0
      ? roundMoney((totals.profit_total / totals.sales_net) * 100)
      : 0;
    totals.paid_ratio = totals.sales_gross > 0
      ? roundMoney((totals.paid_total / totals.sales_gross) * 100)
      : 0;

    mySummary.margin_weighted = mySummary.sales_net > 0
      ? roundMoney((mySummary.profit_total / mySummary.sales_net) * 100)
      : 0;
    mySummary.commission_gap = roundMoney(mySummary.commission_estimated - mySummary.commission_actual);

    const sellers = Array.from(ownerAggMap.values())
      .map((row) => ({
        owner_id: row.owner_id,
        owner_label: row.owner_label,
        invoice_count: row.invoice_count,
        sales_net: roundMoney(row.sales_net),
        profit_total: roundMoney(row.profit_total),
        margin_weighted: row.margin_sales_sum > 0
          ? roundMoney((row.margin_profit_sum / row.margin_sales_sum) * 100)
          : 0,
        commission_actual: roundMoney(row.commission_actual),
        commission_estimated: roundMoney(row.commission_estimated),
      }))
      .sort((a, b) => {
        if (b.commission_estimated !== a.commission_estimated) {
          return b.commission_estimated - a.commission_estimated;
        }
        if (b.profit_total !== a.profit_total) {
          return b.profit_total - a.profit_total;
        }
        return b.sales_net - a.sales_net;
      });

    res.json({
      period: {
        data_od: data_od ? String(data_od) : null,
        data_do: data_do ? String(data_do) : null,
      },
      totals: {
        invoice_count: totals.invoice_count,
        unpaid_invoice_count: totals.unpaid_invoice_count,
        sales_net: roundMoney(totals.sales_net),
        sales_gross: roundMoney(totals.sales_gross),
        paid_total: roundMoney(totals.paid_total),
        receivables_open: roundMoney(totals.receivables_open),
        paid_ratio: totals.paid_ratio,
        profit_total: roundMoney(totals.profit_total),
        margin_weighted: totals.margin_weighted,
      },
      my_summary: {
        linked_manager_id: mySummary.linked_manager_id,
        linked_manager_name: mySummary.linked_manager_name,
        commission_percent: mySummary.commission_percent,
        invoice_count: mySummary.invoice_count,
        sales_net: roundMoney(mySummary.sales_net),
        profit_total: roundMoney(mySummary.profit_total),
        margin_weighted: mySummary.margin_weighted,
        commission_actual: roundMoney(mySummary.commission_actual),
        commission_estimated: roundMoney(mySummary.commission_estimated),
        commission_gap: mySummary.commission_gap,
      },
      sellers,
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

// GET /api/invoices/dashboard/monthly-combo - monthly trend for company + my portfolio
router.get('/dashboard/monthly-combo', async (req, res) => {
  try {
    const parsedMonths = Number(req.query.months || 12);
    const months = Number.isFinite(parsedMonths)
      ? Math.max(3, Math.min(36, Math.trunc(parsedMonths)))
      : 12;
    const parsedOwnerId = Number(req.query.owner_id);
    const selectedOwnerId = Number.isInteger(parsedOwnerId) && parsedOwnerId > 0
      ? parsedOwnerId
      : null;

    const now = new Date();
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startMonthUtc = new Date(Date.UTC(
      currentMonthStart.getUTCFullYear(),
      currentMonthStart.getUTCMonth() - (months - 1),
      1
    ));
    const nextMonthUtc = new Date(Date.UTC(
      currentMonthStart.getUTCFullYear(),
      currentMonthStart.getUTCMonth() + 1,
      1
    ));

    const startSql = startMonthUtc.toISOString().slice(0, 10);
    const nextMonthSql = nextMonthUtc.toISOString().slice(0, 10);

    const [invoiceRows] = await pool.query<DashboardInvoiceRow[]>(
      `SELECT
         i.id,
         i.data_wystawienia,
         i.netto,
         i.zysk,
         i.opiekun,
         i.opiekun_id,
         i.waluta,
         i.kurs_waluty
       FROM invoices i
       WHERE i.data_wystawienia >= ?
         AND i.data_wystawienia < ?`,
      [startSql, nextMonthSql]
    );

    const [managerRows] = await pool.query<DashboardManagerRow[]>(
      `SELECT id, imie, nazwisko, user_id, marza_procent, aktywny
       FROM opiekunowie`
    );

    const managerById = new Map<number, { displayName: string; commissionPercent: number; names: Set<string>; userId: number | null }>();
    const managerIdsByName = new Map<string, number[]>();

    for (const row of managerRows) {
      const id = Number(row.id);
      const firstName = String(row.imie || '').trim();
      const lastName = String(row.nazwisko || '').trim();
      const displayName = `${firstName} ${lastName}`.trim() || firstName;
      const normalizedNames = new Set<string>();
      const normalizedFirstName = normalizePersonName(firstName);
      const normalizedDisplayName = normalizePersonName(displayName);

      if (normalizedFirstName) normalizedNames.add(normalizedFirstName);
      if (normalizedDisplayName) normalizedNames.add(normalizedDisplayName);

      managerById.set(id, {
        displayName,
        commissionPercent: Number(row.marza_procent || 0),
        names: normalizedNames,
        userId: row.user_id !== null ? Number(row.user_id) : null,
      });

      normalizedNames.forEach((name) => {
        const current = managerIdsByName.get(name) || [];
        managerIdsByName.set(name, [...current, id]);
      });
    }

    const linkedManager = req.user?.id
      ? managerRows.find((row) => row.user_id !== null && Number(row.user_id) === req.user?.id) || null
      : null;

    const linkedManagerId = linkedManager ? Number(linkedManager.id) : null;
    const linkedManagerMeta = linkedManagerId ? managerById.get(linkedManagerId) : null;
    const selectedOwnerMeta = selectedOwnerId !== null ? managerById.get(selectedOwnerId) : null;
    if (selectedOwnerId !== null && !selectedOwnerMeta) {
      return res.status(400).json({ error: 'Invalid owner_id. Manager not found.' });
    }
    const currentUserNames = new Set<string>();

    const userFullName = normalizePersonName(req.user?.full_name);
    if (userFullName) currentUserNames.add(userFullName);
    if (linkedManagerMeta) {
      linkedManagerMeta.names.forEach((name) => currentUserNames.add(name));
    }

    const monthBuckets = new Map<string, {
      month: string;
      label: string;
      sales_net: number;
      profit_total: number;
      my_sales_net: number;
      my_earnings: number;
      selected_sales_net: number;
      selected_earnings: number;
    }>();

    for (let index = 0; index < months; index += 1) {
      const bucketDate = new Date(Date.UTC(
        startMonthUtc.getUTCFullYear(),
        startMonthUtc.getUTCMonth() + index,
        1
      ));
      const monthKey = bucketDate.toISOString().slice(0, 7);
      const label = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(bucketDate);

      monthBuckets.set(monthKey, {
        month: monthKey,
        label,
        sales_net: 0,
        profit_total: 0,
        my_sales_net: 0,
        my_earnings: 0,
        selected_sales_net: 0,
        selected_earnings: 0,
      });
    }

    for (const row of invoiceRows) {
      const issueDate = row.data_wystawienia ? new Date(row.data_wystawienia) : null;
      if (!issueDate || Number.isNaN(issueDate.getTime())) continue;

      const monthKey = issueDate.toISOString().slice(0, 7);
      const monthBucket = monthBuckets.get(monthKey);
      if (!monthBucket) continue;

      const salesNetRaw = Number(row.netto || 0);
      const currencyCode = String(row.waluta || 'PLN').trim().toUpperCase();
      const exchangeRateToPln = currencyCode === 'PLN'
        ? 1
        : (() => {
            const rate = Number(row.kurs_waluty || 0);
            return Number.isFinite(rate) && rate > 0 ? rate : 1;
          })();
      const salesNet = roundMoney(salesNetRaw * exchangeRateToPln);
      const profit = Number(row.zysk || 0);

      const rawOwner = String(row.opiekun || '').trim();
      const normalizedRawOwner = normalizePersonName(rawOwner);

      let ownerId = row.opiekun_id !== null ? Number(row.opiekun_id) : null;
      if (ownerId !== null && !managerById.has(ownerId)) {
        ownerId = null;
      }

      if (ownerId === null && normalizedRawOwner) {
        const candidateIds = managerIdsByName.get(normalizedRawOwner) || [];
        if (candidateIds.length === 1) {
          ownerId = candidateIds[0];
        }
      }

      const ownerManager = ownerId !== null ? managerById.get(ownerId) : null;
      const ownerMatchesUserById = linkedManagerId !== null && ownerId === linkedManagerId;
      const ownerMatchesUserByName = normalizedRawOwner && currentUserNames.has(normalizedRawOwner);
      const userCommissionPercent = linkedManagerMeta?.commissionPercent ?? ownerManager?.commissionPercent ?? 0;

      monthBucket.sales_net += salesNet;
      monthBucket.profit_total += profit;

      if (ownerMatchesUserById || ownerMatchesUserByName) {
        monthBucket.my_sales_net += salesNet;
        monthBucket.my_earnings += roundMoney((profit * userCommissionPercent) / 100);
      }

      const selectedOwnerMatches = selectedOwnerId !== null
        ? ownerId === selectedOwnerId
        : (ownerMatchesUserById || ownerMatchesUserByName);

      if (selectedOwnerMatches) {
        const selectedCommissionPercent = selectedOwnerId !== null
          ? Number(selectedOwnerMeta?.commissionPercent || 0)
          : userCommissionPercent;

        monthBucket.selected_sales_net += salesNet;
        monthBucket.selected_earnings += roundMoney((profit * selectedCommissionPercent) / 100);
      }
    }

    const data = Array.from(monthBuckets.values()).map((bucket) => ({
      month: bucket.month,
      label: bucket.label,
      sales_net: roundMoney(bucket.sales_net),
      profit_total: roundMoney(bucket.profit_total),
      my_sales_net: roundMoney(bucket.my_sales_net),
      my_earnings: roundMoney(bucket.my_earnings),
      selected_sales_net: roundMoney(bucket.selected_sales_net),
      selected_earnings: roundMoney(bucket.selected_earnings),
    }));

    res.json({
      period: {
        months,
        from: startMonthUtc.toISOString().slice(0, 7),
        to: currentMonthStart.toISOString().slice(0, 7),
      },
      selected_scope: {
        mode: selectedOwnerId !== null ? 'owner' : 'my',
        owner_id: selectedOwnerId,
        owner_label: selectedOwnerId !== null
          ? selectedOwnerMeta?.displayName || `Owner #${selectedOwnerId}`
          : (linkedManagerMeta?.displayName || req.user?.full_name || req.user?.username || 'My portfolio'),
      },
      data,
    });
  } catch (error) {
    console.error('Error fetching monthly combo trend:', error);
    res.status(500).json({ error: 'Failed to fetch monthly combo trend' });
  }
});

// GET /api/invoices/admin/recalculate-all/preview - safety preview before bulk recalculation
router.get('/admin/recalculate-all/preview', requireAdmin, async (_req, res) => {
  try {
    const [invoiceRows] = await pool.query<RowDataPacket[]>('SELECT id FROM invoices');
    const invoiceIds = invoiceRows.map((row) => Number(row.id));
    const snapshot = await getRecalculationSnapshot(invoiceIds);

    res.json({
      invoice_ids_count: invoiceIds.length,
      ...snapshot,
      requires_confirmation_text: 'RECALCULATE_ALL',
    });
  } catch (error) {
    console.error('Error preparing recalculation preview:', error);
    res.status(500).json({ error: 'Failed to prepare recalculation preview' });
  }
});

// POST /api/invoices/admin/recalculate-all - bulk sync item purchase prices and recalculate all invoices
router.post('/admin/recalculate-all', requireAdmin, async (req, res) => {
  try {
    const confirmationText = String(req.body?.confirm_text || '').trim();
    if (confirmationText !== 'RECALCULATE_ALL') {
      return res.status(400).json({
        error: 'Invalid confirmation text',
        required: 'RECALCULATE_ALL',
      });
    }

    const [invoiceRows] = await pool.query<RowDataPacket[]>('SELECT id FROM invoices');
    const invoiceIds = invoiceRows.map((row) => Number(row.id));

    if (invoiceIds.length === 0) {
      return res.json({
        message: 'No invoices to recalculate',
        invoice_ids_count: 0,
        before: await getRecalculationSnapshot([]),
        recalculation: {
          invoice_ids: [],
          invoice_count: 0,
          item_prices_backfilled: 0,
          items_recalculated: 0,
          invoices_recalculated: 0,
        },
        after: await getRecalculationSnapshot([]),
      });
    }

    const before = await getRecalculationSnapshot(invoiceIds);
    const recalculation = await recalculateInvoicesFromProductPrices(invoiceIds, {
      syncItemPurchasePrices: 'all',
    });
    const after = await getRecalculationSnapshot(invoiceIds);

    res.json({
      message: 'Bulk recalculation completed successfully',
      invoice_ids_count: invoiceIds.length,
      before,
      recalculation,
      after,
    });
  } catch (error) {
    console.error('Error recalculating all invoices:', error);
    res.status(500).json({ error: 'Failed to recalculate all invoices' });
  }
});

// POST /api/invoices/:id/recalculate-from-products - refresh invoice profit/commission from current product prices
router.post('/:id/recalculate-from-products', async (req, res) => {
  try {
    const invoiceId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(invoiceId)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }

    const [invoiceRows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM invoices WHERE id = ? LIMIT 1',
      [invoiceId]
    );

    if (invoiceRows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const summary = await recalculateInvoicesFromProductPrices([invoiceId], {
      syncItemPurchasePrices: 'all',
    });
    res.json({
      message: 'Invoice recalculated from product prices',
      ...summary,
    });
  } catch (error) {
    console.error('Error recalculating invoice from products:', error);
    res.status(500).json({ error: 'Failed to recalculate invoice' });
  }
});

// POST /api/invoices/:id/rebuild-totals-from-items - force header totals from line items, then recalculate profits
router.post('/:id/rebuild-totals-from-items', requireFinanceEditor, async (req, res) => {
  try {
    const invoiceId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(invoiceId)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }

    const [invoiceRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, netto, vat, brutto FROM invoices WHERE id = ? LIMIT 1',
      [invoiceId]
    );

    if (invoiceRows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const [sumRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         ROUND(COALESCE(SUM(COALESCE(wartosc_netto, 0)), 0), 2) AS sum_netto,
         ROUND(COALESCE(SUM(COALESCE(wartosc_vat, 0)), 0), 2) AS sum_vat,
         ROUND(COALESCE(SUM(COALESCE(wartosc_brutto, 0)), 0), 2) AS sum_brutto,
         COUNT(*) AS item_count
       FROM invoice_items
       WHERE invoice_id = ?`,
      [invoiceId]
    );

    const itemCount = Number(sumRows[0]?.item_count || 0);
    if (itemCount === 0) {
      return res.status(400).json({ error: 'Invoice has no items to rebuild totals from' });
    }

    const rebuiltTotals = {
      netto: Number(sumRows[0]?.sum_netto || 0),
      vat: Number(sumRows[0]?.sum_vat || 0),
      brutto: Number(sumRows[0]?.sum_brutto || 0),
    };

    await pool.query(
      'UPDATE invoices SET netto = ?, vat = ?, brutto = ? WHERE id = ?',
      [rebuiltTotals.netto, rebuiltTotals.vat, rebuiltTotals.brutto, invoiceId]
    );

    const recalculation = await recalculateInvoicesFromProductPrices([invoiceId], {
      syncItemPurchasePrices: 'all',
    });

    res.json({
      message: 'Invoice totals rebuilt from items and recalculated',
      previous_totals: {
        netto: Number(invoiceRows[0].netto || 0),
        vat: Number(invoiceRows[0].vat || 0),
        brutto: Number(invoiceRows[0].brutto || 0),
      },
      rebuilt_totals: rebuiltTotals,
      recalculation,
    });
  } catch (error) {
    console.error('Error rebuilding invoice totals:', error);
    res.status(500).json({ error: 'Failed to rebuild invoice totals' });
  }
});

// POST /api/invoices - Create invoice manually (invoice machine)
router.post('/', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      numer_faktury,
      data_wystawienia,
      data_sprzedazy,
      termin_platnosci,
      forma_platnosci,
      waluta = 'PLN',
      kurs_waluty = 1,
      status_platnosci = 'nieoplacona',
      zaplacono = 0,
      koszt_logistyki = 0,
      opiekun_id,
      invoice_group_id,
      managers,
      uwagi,
      customer,
      customer_id,
      items
    } = req.body;

    if (!numer_faktury || String(numer_faktury).trim() === '') {
      return res.status(400).json({ error: 'numer_faktury is required' });
    }

    const invoiceNumber = canonicalInvoiceNumber(numer_faktury);
    const normalizedInvoiceNumber = normalizeInvoiceNumber(invoiceNumber);
    const normalizedPaymentMethod = normalizePaymentMethod(forma_platnosci);
    const normalizedCurrency = normalizeCurrencyCode(waluta);

    if (!invoiceNumber) {
      return res.status(400).json({ error: 'numer_faktury is required' });
    }

    if (forma_platnosci !== undefined && normalizedPaymentMethod === null) {
      return res.status(400).json({ error: 'Invalid forma_platnosci. Allowed: przelew, pobranie, karta, gotowka' });
    }

    if (!normalizedCurrency) {
      return res.status(400).json({ error: 'Invalid waluta. Use ISO code like PLN, EUR, HUF' });
    }

    const exchangeRateToPln = resolveExchangeRateToPln(normalizedCurrency, kurs_waluty);
    if (exchangeRateToPln === null) {
      return res.status(400).json({ error: 'Invalid kurs_waluty. Provide PLN rate for 1 unit of invoice currency' });
    }

    const normalizedInvoiceGroupId = parseOptionalEntityId(invoice_group_id);
    if (invoice_group_id !== undefined && invoice_group_id !== null && invoice_group_id !== '' && !normalizedInvoiceGroupId) {
      return res.status(400).json({ error: 'Invalid invoice_group_id' });
    }

    if (normalizedInvoiceGroupId) {
      const [groupRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM invoice_groups WHERE id = ? LIMIT 1',
        [normalizedInvoiceGroupId]
      );
      if (groupRows.length === 0) {
        return res.status(400).json({ error: 'invoice_group_id was not found' });
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one invoice item is required' });
    }

    const normalizedManagersInput = managers === undefined
      ? null
      : normalizeManagerSplitsInput(managers);

    if (managers !== undefined && normalizedManagersInput === null) {
      return res.status(400).json({
        error: 'Invalid managers payload. Use up to 2 unique managers with commission_percent between 0 and 100 and total <= 100',
      });
    }

    const [existingInvoiceRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, numer_faktury
       FROM invoices
       WHERE REPLACE(LOWER(TRIM(numer_faktury)), ' ', '') = ?
       LIMIT 1`,
      [normalizedInvoiceNumber]
    );

    if (existingInvoiceRows.length > 0) {
      return res.status(409).json({
        error: 'Invoice already exists',
        details: `Invoice ${existingInvoiceRows[0].numer_faktury} is already in the system`,
        invoice_id: Number(existingInvoiceRows[0].id)
      });
    }

    await connection.beginTransaction();

    let finalCustomerId: number | null = customer_id ? parseInt(String(customer_id), 10) : null;

    if (finalCustomerId && Number.isNaN(finalCustomerId)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Invalid customer_id' });
    }

    if (!finalCustomerId) {
      const customerName = customer?.nazwa ? String(customer.nazwa).trim() : '';
      if (!customerName) {
        await connection.rollback();
        return res.status(400).json({ error: 'customer.nazwa is required when customer_id is not provided' });
      }

      const customerNip = customer?.nip ? String(customer.nip).trim() : null;
      let existingByNip: RowDataPacket[] = [];
      if (customerNip) {
        const [rowsByNip] = await connection.query<RowDataPacket[]>('SELECT id FROM customers WHERE nip = ? LIMIT 1', [customerNip]);
        existingByNip = rowsByNip;
      }

      if (existingByNip.length > 0) {
        finalCustomerId = Number(existingByNip[0].id);
      } else {
        const [existingByName] = await connection.query<RowDataPacket[]>(
          'SELECT id FROM customers WHERE nazwa = ? LIMIT 1',
          [customerName]
        );

        if (existingByName.length > 0) {
          finalCustomerId = Number(existingByName[0].id);
        } else {
          const [insertCustomerResult] = await connection.query<ResultSetHeader>(
            `INSERT INTO customers (nazwa, nip, ulica, kod_pocztowy, miasto, kraj, email, telefon)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              customerName,
              customerNip,
              customer?.ulica || null,
              customer?.kod_pocztowy || null,
              customer?.miasto || null,
              customer?.kraj || 'Polska',
              customer?.email || null,
              customer?.telefon || null
            ]
          );
          finalCustomerId = insertCustomerResult.insertId;
        }
      }
    }

    if (!finalCustomerId) {
      await connection.rollback();
      return res.status(400).json({ error: 'Could not resolve customer for invoice' });
    }

    const [resolvedCustomerRows] = await connection.query<RowDataPacket[]>(
      `SELECT nazwa, nip, ulica, kod_pocztowy, miasto
       FROM customers
       WHERE id = ?
       LIMIT 1`,
      [finalCustomerId]
    );

    if (resolvedCustomerRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Could not load resolved customer data' });
    }

    const resolvedCustomer = resolvedCustomerRows[0];

    let opiekunName: string | null = null;
    let opiekunCommissionPercent: number | null = null;
    let finalOpiekunId: number | null = null;
    let finalManagers: InvoiceManagerSplitInput[] = [];

    if (normalizedManagersInput && normalizedManagersInput.length > 0) {
      const managerIds = normalizedManagersInput.map((entry) => entry.opiekun_id);
      const [managerRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, imie, nazwisko
         FROM opiekunowie
         WHERE id IN (?)`,
        [managerIds]
      );

      const managerById = new Map<number, RowDataPacket>();
      for (const row of managerRows) {
        managerById.set(Number(row.id), row);
      }

      for (const manager of normalizedManagersInput) {
        if (!managerById.has(manager.opiekun_id)) {
          await connection.rollback();
          return res.status(400).json({ error: `Invoice manager ${manager.opiekun_id} not found` });
        }
      }

      finalManagers = normalizedManagersInput;
      finalOpiekunId = finalManagers[0].opiekun_id;
      const primary = managerById.get(finalOpiekunId) as RowDataPacket;
      opiekunName = makeManagerDisplayName(primary.imie, primary.nazwisko);
      opiekunCommissionPercent = finalManagers.reduce((sum, row) => sum + row.commission_percent, 0);
    }

    if (opiekun_id !== undefined && opiekun_id !== null && String(opiekun_id).trim() !== '') {
      if (finalManagers.length > 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Use either opiekun_id or managers array, not both' });
      }

      finalOpiekunId = parseInt(String(opiekun_id), 10);
      if (Number.isNaN(finalOpiekunId)) {
        await connection.rollback();
        return res.status(400).json({ error: 'Invalid opiekun_id' });
      }

      const [opiekunRows] = await connection.query<RowDataPacket[]>(
        'SELECT imie, nazwisko, marza_procent FROM opiekunowie WHERE id = ? LIMIT 1',
        [finalOpiekunId]
      );

      if (opiekunRows.length > 0) {
        opiekunName = makeManagerDisplayName(opiekunRows[0].imie, opiekunRows[0].nazwisko);
        opiekunCommissionPercent = Number(opiekunRows[0].marza_procent) || 0;
        finalManagers = [
          {
            opiekun_id: finalOpiekunId,
            commission_percent: opiekunCommissionPercent,
          },
        ];
      }
    }

    const normalizedItems: Array<{
      product_id: number | null;
      nazwa: string;
      lp: number;
      ilosc: number;
      jednostka: string;
      cena_netto: number;
      stawka_vat: number;
      wartosc_netto: number;
      wartosc_vat: number;
      wartosc_brutto: number;
      cena_zakupu: number | null;
      koszt_calkowity: number | null;
      zysk: number | null;
      marza_procent: number | null;
      is_shipping: number;
    }> = [];

    for (let i = 0; i < items.length; i += 1) {
      const raw = items[i] || {};
      const qty = toNumber(raw.ilosc, 0);
      const netPrice = toNumber(raw.cena_netto, 0);
      const vatRate = toNumber(raw.stawka_vat, 23);
      const isShipping = raw.is_shipping ? 1 : 0;

      if (qty <= 0) {
        await connection.rollback();
        return res.status(400).json({ error: `Invalid quantity in row ${i + 1}` });
      }

      let productId = raw.product_id ? parseInt(String(raw.product_id), 10) : null;
      if (productId !== null && Number.isNaN(productId)) {
        await connection.rollback();
        return res.status(400).json({ error: `Invalid product_id in row ${i + 1}` });
      }

      const itemName = String(raw.nazwa || raw.product_name || '').trim();
      if (!itemName) {
        await connection.rollback();
        return res.status(400).json({ error: `Item name is required in row ${i + 1}` });
      }

      let productPurchasePrice: number | null = raw.cena_zakupu !== undefined && raw.cena_zakupu !== null && raw.cena_zakupu !== ''
        ? toNumber(raw.cena_zakupu, 0)
        : null;

      if (!productId) {
        const [existingProductRows] = await connection.query<RowDataPacket[]>(
          'SELECT id, cena_zakupu FROM products WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) LIMIT 1',
          [itemName]
        );

        if (existingProductRows.length > 0) {
          productId = Number(existingProductRows[0].id);
          if (productPurchasePrice === null && existingProductRows[0].cena_zakupu !== null) {
            productPurchasePrice = Number(existingProductRows[0].cena_zakupu);
          }
        } else {
          const [insertProductResult] = await connection.query<ResultSetHeader>(
            'INSERT INTO products (nazwa, jednostka, stawka_vat, cena_zakupu) VALUES (?, ?, ?, ?)',
            [itemName, raw.jednostka || 'szt', vatRate, productPurchasePrice]
          );
          productId = insertProductResult.insertId;
        }
      } else {
        const [productRows] = await connection.query<RowDataPacket[]>(
          'SELECT cena_zakupu FROM products WHERE id = ? LIMIT 1',
          [productId]
        );
        if (productRows.length > 0 && productPurchasePrice === null && productRows[0].cena_zakupu !== null) {
          productPurchasePrice = Number(productRows[0].cena_zakupu);
        }
      }

      const valueNet = roundMoney(qty * netPrice);
      const valueVat = roundMoney((valueNet * vatRate) / 100);
      const valueGross = roundMoney(valueNet + valueVat);
      const valueNetInPln = roundMoney(valueNet * exchangeRateToPln);
      const totalCost = productPurchasePrice !== null ? roundMoney(qty * productPurchasePrice) : null;
      const profit = totalCost !== null ? roundMoney(valueNetInPln - totalCost) : null;
      const margin = profit !== null && valueNetInPln > 0
        ? clampMarginPercent(roundMoney((profit / valueNetInPln) * 100))
        : null;

      normalizedItems.push({
        product_id: productId,
        nazwa: itemName,
        lp: i + 1,
        ilosc: qty,
        jednostka: raw.jednostka || 'szt',
        cena_netto: netPrice,
        stawka_vat: vatRate,
        wartosc_netto: valueNet,
        wartosc_vat: valueVat,
        wartosc_brutto: valueGross,
        cena_zakupu: productPurchasePrice,
        koszt_calkowity: totalCost,
        zysk: profit,
        marza_procent: margin,
        is_shipping: isShipping
      });
    }

    const totalNet = roundMoney(normalizedItems.reduce((sum, item) => sum + item.wartosc_netto, 0));
    const totalVat = roundMoney(normalizedItems.reduce((sum, item) => sum + item.wartosc_vat, 0));
    const totalGross = roundMoney(normalizedItems.reduce((sum, item) => sum + item.wartosc_brutto, 0));
    const totalItemProfit = roundMoney(
      normalizedItems.reduce((sum, item) => sum + (item.zysk !== null ? item.zysk : 0), 0)
    );

    const logisticsCost = roundMoney(toNumber(koszt_logistyki, 0));
    const totalProfit = roundMoney(totalItemProfit - logisticsCost);
    const totalNetInPln = roundMoney(totalNet * exchangeRateToPln);
    const marginPercent = totalNetInPln > 0
      ? clampMarginPercent(roundMoney((totalProfit / totalNetInPln) * 100))
      : null;
    const paidAmount = roundMoney(toNumber(zaplacono, 0));
    const commission =
      opiekunCommissionPercent !== null ? roundMoney((totalProfit * opiekunCommissionPercent) / 100) : null;

    const [insertInvoiceResult] = await connection.query<ResultSetHeader>(
      `INSERT INTO invoices (
        numer_faktury, customer_id, data_wystawienia, data_sprzedazy, termin_platnosci,
        forma_platnosci, waluta, kurs_waluty, netto, vat, brutto, zaplacono, status_platnosci,
        opiekun, opiekun_id, invoice_group_id, koszt_logistyki, zysk, marza_procent, prowizja_opiekuna, uwagi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNumber,
        finalCustomerId,
        normalizeDateValue(data_wystawienia),
        normalizeDateValue(data_sprzedazy),
        normalizeDateValue(termin_platnosci),
        normalizedPaymentMethod,
        normalizedCurrency,
        exchangeRateToPln,
        totalNet,
        totalVat,
        totalGross,
        paidAmount,
        status_platnosci || 'nieoplacona',
        opiekunName,
        finalOpiekunId,
        normalizedInvoiceGroupId,
        logisticsCost,
        totalProfit,
        marginPercent,
        commission,
        uwagi || null
      ]
    );

    const invoiceId = insertInvoiceResult.insertId;

    // Batch insert invoice items (fixes N+1 query problem)
    if (normalizedItems.length > 0) {
      const itemValues = normalizedItems.map(item => [
        invoiceId,
        item.product_id,
        item.lp,
        item.nazwa,
        item.ilosc,
        item.jednostka,
        item.cena_netto,
        item.stawka_vat,
        item.wartosc_netto,
        item.wartosc_vat,
        item.wartosc_brutto,
        item.cena_zakupu,
        item.koszt_calkowity,
        item.zysk,
        item.marza_procent,
        item.is_shipping
      ]);

      await connection.query(
        `INSERT INTO invoice_items (
          invoice_id, product_id, lp, nazwa, ilosc, jednostka, cena_netto, stawka_vat,
          wartosc_netto, wartosc_vat, wartosc_brutto, cena_zakupu, koszt_calkowity,
          zysk, marza_procent, is_shipping
        ) VALUES ?`,
        [itemValues]
      );
    }

    const generatedPdfPath = await generateInvoicePdf({
      numerFaktury: invoiceNumber,
      dataWystawienia: normalizeDateValue(data_wystawienia),
      dataSprzedazy: normalizeDateValue(data_sprzedazy),
      terminPlatnosci: normalizeDateValue(termin_platnosci),
      formaPlatnosci: normalizedPaymentMethod,
      waluta: normalizedCurrency,
      customer: {
        nazwa: String(resolvedCustomer.nazwa || customer?.nazwa || ''),
        nip: resolvedCustomer.nip ? String(resolvedCustomer.nip) : null,
        ulica: resolvedCustomer.ulica ? String(resolvedCustomer.ulica) : null,
        kodPocztowy: resolvedCustomer.kod_pocztowy ? String(resolvedCustomer.kod_pocztowy) : null,
        miasto: resolvedCustomer.miasto ? String(resolvedCustomer.miasto) : null,
      },
      items: normalizedItems.map((item) => ({
        lp: item.lp,
        nazwa: item.nazwa,
        ilosc: item.ilosc,
        jednostka: item.jednostka,
        cenaNetto: item.cena_netto,
        stawkaVat: item.stawka_vat,
        wartoscNetto: item.wartosc_netto,
        wartoscBrutto: item.wartosc_brutto,
      })),
      netto: totalNet,
      vat: totalVat,
      brutto: totalGross,
      zaplacono: paidAmount,
      uwagi: uwagi || null,
    });

    await connection.query(
      'UPDATE invoices SET pdf_path = ? WHERE id = ?',
      [generatedPdfPath, invoiceId]
    );

    await connection.commit();

    res.status(201).json({
      id: invoiceId,
      message: 'Invoice created successfully'
    });
  } catch (error: unknown) {
    await connection.rollback();
    const mysqlError = error as { code?: string };
    if (mysqlError.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'Invoice already exists',
        details: 'This invoice number already exists in the system'
      });
    }
    console.error('Error creating invoice:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  } finally {
    connection.release();
  }
});

// POST /api/invoices/import/csv/preview - validate CSV and show import preview
router.post('/import/csv/preview', csvImportUpload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'CSV file is required (field name: file)' });
    }

    const parsed = parseInvoiceCsvBuffer(req.file.buffer);
    const normalizedInvoiceNumbers = parsed.invoices.map((invoice) => normalizeInvoiceNumber(invoice.invoiceNumber));

    const existingInvoicesByNormalized = new Map<string, { id: number; numer_faktury: string }>();
    if (normalizedInvoiceNumbers.length > 0) {
      const [existingRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, numer_faktury, REPLACE(LOWER(TRIM(numer_faktury)), ' ', '') AS normalized_number
         FROM invoices
         WHERE REPLACE(LOWER(TRIM(numer_faktury)), ' ', '') IN (?)`,
        [normalizedInvoiceNumbers]
      );

      for (const row of existingRows) {
        existingInvoicesByNormalized.set(String(row.normalized_number || ''), {
          id: Number(row.id),
          numer_faktury: String(row.numer_faktury || ''),
        });
      }
    }

    const ownerIds = Array.from(
      new Set(parsed.invoices.map((invoice) => invoice.ownerId).filter((id): id is number => Number.isInteger(id)))
    );
    const validOwnerIds = new Set<number>();
    if (ownerIds.length > 0) {
      const [ownerRows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM opiekunowie WHERE id IN (?)`,
        [ownerIds]
      );
      for (const row of ownerRows) {
        validOwnerIds.add(Number(row.id));
      }
    }

    const preview = parsed.invoices.map((invoice) => {
      const computed = computeImportedInvoiceTotals(invoice);
      const normalizedNumber = normalizeInvoiceNumber(invoice.invoiceNumber);
      const duplicate = existingInvoicesByNormalized.get(normalizedNumber) || null;
      const ownerMissing = computed.ownerId !== null && !validOwnerIds.has(computed.ownerId);

      if (ownerMissing) {
        parsed.errors.push({
          row: invoice.items[0]?.row || 0,
          message: `Invoice ${invoice.invoiceNumber}: opiekun_id ${computed.ownerId} was not found`,
        });
      }

      return {
        invoice_number: computed.invoiceNumber,
        customer_name: computed.customerName,
        item_count: computed.itemCount,
        net_total: computed.netTotal,
        vat_total: computed.vatTotal,
        gross_total: computed.grossTotal,
        payment_status: computed.paymentStatus,
        paid_amount: computed.paidAmount,
        owner_id: computed.ownerId,
        duplicate_existing: Boolean(duplicate),
        existing_invoice_id: duplicate?.id || null,
      };
    });

    const duplicateCount = preview.filter((entry) => entry.duplicate_existing).length;
    const invalidOwnerCount = preview.filter(
      (entry) => entry.owner_id !== null && !validOwnerIds.has(entry.owner_id)
    ).length;

    return res.json({
      total_rows: parsed.totalRows,
      parsed_invoices: parsed.invoices.length,
      valid_invoices: parsed.invoices.length - duplicateCount - invalidOwnerCount,
      duplicates_existing: duplicateCount,
      invalid_owner_refs: invalidOwnerCount,
      errors: parsed.errors,
      preview,
    });
  } catch (error) {
    console.error('Error building CSV import preview:', error);
    return res.status(500).json({ error: 'Failed to preview CSV import' });
  }
});

// POST /api/invoices/import/csv/commit - create invoices from CSV
router.post('/import/csv/commit', csvImportUpload.single('file'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'CSV file is required (field name: file)' });
    }

    const parsed = parseInvoiceCsvBuffer(req.file.buffer);
    if (parsed.errors.length > 0) {
      return res.status(400).json({
        error: 'CSV validation failed',
        errors: parsed.errors,
      });
    }

    const skipExisting = req.body?.skip_existing !== false && req.body?.skip_existing !== 'false';
    const normalizedInvoiceNumbers = parsed.invoices.map((invoice) => normalizeInvoiceNumber(invoice.invoiceNumber));
    const existingInvoicesByNormalized = new Map<string, { id: number; numer_faktury: string }>();

    if (normalizedInvoiceNumbers.length > 0) {
      const [existingRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, numer_faktury, REPLACE(LOWER(TRIM(numer_faktury)), ' ', '') AS normalized_number
         FROM invoices
         WHERE REPLACE(LOWER(TRIM(numer_faktury)), ' ', '') IN (?)`,
        [normalizedInvoiceNumbers]
      );

      for (const row of existingRows) {
        existingInvoicesByNormalized.set(String(row.normalized_number || ''), {
          id: Number(row.id),
          numer_faktury: String(row.numer_faktury || ''),
        });
      }
    }

    const duplicates = parsed.invoices
      .map((invoice) => {
        const existing = existingInvoicesByNormalized.get(normalizeInvoiceNumber(invoice.invoiceNumber));
        if (!existing) return null;
        return {
          invoice_number: invoice.invoiceNumber,
          existing_invoice_id: existing.id,
          existing_invoice_number: existing.numer_faktury,
        };
      })
      .filter((entry): entry is { invoice_number: string; existing_invoice_id: number; existing_invoice_number: string } => Boolean(entry));

    if (!skipExisting && duplicates.length > 0) {
      return res.status(409).json({
        error: 'Duplicate invoice numbers found',
        duplicates,
      });
    }

    const invoicesToCreate = parsed.invoices.filter(
      (invoice) => !existingInvoicesByNormalized.has(normalizeInvoiceNumber(invoice.invoiceNumber))
    );

    if (invoicesToCreate.length === 0) {
      return res.json({
        message: 'No new invoices to import',
        created_count: 0,
        skipped_duplicates: duplicates.length,
        created_invoice_ids: [],
      });
    }

    const ownerIds = Array.from(
      new Set(invoicesToCreate.map((invoice) => invoice.ownerId).filter((id): id is number => Number.isInteger(id)))
    );
    const ownerById = new Map<number, RowDataPacket>();

    if (ownerIds.length > 0) {
      const [ownerRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, imie, nazwisko, marza_procent FROM opiekunowie WHERE id IN (?)`,
        [ownerIds]
      );
      for (const row of ownerRows) {
        ownerById.set(Number(row.id), row);
      }

      for (const ownerId of ownerIds) {
        if (!ownerById.has(ownerId)) {
          return res.status(400).json({
            error: `opiekun_id ${ownerId} was not found`,
          });
        }
      }
    }

    await connection.beginTransaction();

    const createdInvoiceIds: number[] = [];
    const productCache = new Map<string, { id: number; purchasePrice: number | null }>();

    for (const draft of invoicesToCreate) {
      const normalizedCurrency = normalizeCurrencyCode(draft.currency) || 'PLN';
      const exchangeRateToPln = resolveExchangeRateToPln(normalizedCurrency, draft.exchangeRateToPln);
      if (exchangeRateToPln === null) {
        throw new Error(`Invalid exchange rate for invoice ${draft.invoiceNumber}`);
      }

      let finalCustomerId: number | null = null;
      const customerName = String(draft.customer.name || '').trim();
      const customerNip = draft.customer.nip ? String(draft.customer.nip).trim() : null;

      if (customerNip) {
        const [rowsByNip] = await connection.query<RowDataPacket[]>(
          'SELECT id FROM customers WHERE nip = ? LIMIT 1',
          [customerNip]
        );
        if (rowsByNip.length > 0) {
          finalCustomerId = Number(rowsByNip[0].id);
        }
      }

      if (!finalCustomerId) {
        const [rowsByName] = await connection.query<RowDataPacket[]>(
          'SELECT id FROM customers WHERE nazwa = ? LIMIT 1',
          [customerName]
        );
        if (rowsByName.length > 0) {
          finalCustomerId = Number(rowsByName[0].id);
        }
      }

      if (!finalCustomerId) {
        const [insertCustomerResult] = await connection.query<ResultSetHeader>(
          `INSERT INTO customers (nazwa, nip, ulica, kod_pocztowy, miasto, kraj, email, telefon)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerName,
            customerNip,
            draft.customer.street,
            draft.customer.postalCode,
            draft.customer.city,
            draft.customer.country || 'Polska',
            draft.customer.email,
            draft.customer.phone,
          ]
        );
        finalCustomerId = insertCustomerResult.insertId;
      }

      if (!finalCustomerId) {
        throw new Error(`Could not resolve customer for invoice ${draft.invoiceNumber}`);
      }

      const [resolvedCustomerRows] = await connection.query<RowDataPacket[]>(
        `SELECT nazwa, nip, ulica, kod_pocztowy, miasto
         FROM customers
         WHERE id = ?
         LIMIT 1`,
        [finalCustomerId]
      );
      const resolvedCustomer = resolvedCustomerRows[0] || {};

      const normalizedItems: Array<{
        product_id: number | null;
        lp: number;
        nazwa: string;
        ilosc: number;
        jednostka: string;
        cena_netto: number;
        stawka_vat: number;
        wartosc_netto: number;
        wartosc_vat: number;
        wartosc_brutto: number;
        cena_zakupu: number | null;
        koszt_calkowity: number | null;
        zysk: number | null;
        marza_procent: number | null;
        is_shipping: number;
      }> = [];

      for (let index = 0; index < draft.items.length; index += 1) {
        const item = draft.items[index];
        const productCacheKey = normalizePersonName(item.name);
        let cachedProduct = productCache.get(productCacheKey);

        if (!cachedProduct) {
          const [productRows] = await connection.query<RowDataPacket[]>(
            'SELECT id, cena_zakupu FROM products WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) LIMIT 1',
            [item.name]
          );

          if (productRows.length > 0) {
            cachedProduct = {
              id: Number(productRows[0].id),
              purchasePrice: productRows[0].cena_zakupu !== null ? Number(productRows[0].cena_zakupu) : null,
            };
          } else {
            const [insertProductResult] = await connection.query<ResultSetHeader>(
              'INSERT INTO products (nazwa, jednostka, stawka_vat, cena_zakupu) VALUES (?, ?, ?, ?)',
              [item.name, item.unit || 'szt', item.vatRate, item.purchasePrice]
            );
            cachedProduct = {
              id: insertProductResult.insertId,
              purchasePrice: item.purchasePrice,
            };
          }

          productCache.set(productCacheKey, cachedProduct);
        }

        const productPurchasePrice = item.purchasePrice ?? cachedProduct.purchasePrice;
        const valueNet = roundMoney(item.quantity * item.netPrice);
        const valueVat = roundMoney((valueNet * item.vatRate) / 100);
        const valueGross = roundMoney(valueNet + valueVat);
        const valueNetInPln = roundMoney(valueNet * exchangeRateToPln);
        const totalCost = productPurchasePrice !== null ? roundMoney(item.quantity * productPurchasePrice) : null;
        const profit = totalCost !== null ? roundMoney(valueNetInPln - totalCost) : null;
        const margin = profit !== null && valueNetInPln > 0
          ? clampMarginPercent(roundMoney((profit / valueNetInPln) * 100))
          : null;

        normalizedItems.push({
          product_id: cachedProduct.id,
          lp: index + 1,
          nazwa: item.name,
          ilosc: item.quantity,
          jednostka: item.unit || 'szt',
          cena_netto: item.netPrice,
          stawka_vat: item.vatRate,
          wartosc_netto: valueNet,
          wartosc_vat: valueVat,
          wartosc_brutto: valueGross,
          cena_zakupu: productPurchasePrice,
          koszt_calkowity: totalCost,
          zysk: profit,
          marza_procent: margin,
          is_shipping: item.isShipping ? 1 : 0,
        });
      }

      const totalNet = roundMoney(normalizedItems.reduce((sum, item) => sum + item.wartosc_netto, 0));
      const totalVat = roundMoney(normalizedItems.reduce((sum, item) => sum + item.wartosc_vat, 0));
      const totalGross = roundMoney(normalizedItems.reduce((sum, item) => sum + item.wartosc_brutto, 0));
      const totalItemProfit = roundMoney(
        normalizedItems.reduce((sum, item) => sum + (item.zysk !== null ? item.zysk : 0), 0)
      );
      const totalNetInPln = roundMoney(totalNet * exchangeRateToPln);
      const totalProfit = totalItemProfit;
      const marginPercent = totalNetInPln > 0
        ? clampMarginPercent(roundMoney((totalProfit / totalNetInPln) * 100))
        : null;

      const ownerRow = draft.ownerId ? ownerById.get(draft.ownerId) : null;
      const ownerCommissionPercent = ownerRow ? Number(ownerRow.marza_procent) || 0 : null;
      const commission = ownerCommissionPercent !== null
        ? roundMoney((totalProfit * ownerCommissionPercent) / 100)
        : null;

      const opiekunName = ownerRow ? makeManagerDisplayName(ownerRow.imie, ownerRow.nazwisko) : null;
      const paidAmount = normalizeImportedPaidAmount(draft.paymentStatus, draft.paidAmount, totalGross);
      const statusPlatnosci = draft.paymentStatus || 'nieoplacona';

      const [insertInvoiceResult] = await connection.query<ResultSetHeader>(
        `INSERT INTO invoices (
          numer_faktury, customer_id, data_wystawienia, data_sprzedazy, termin_platnosci,
          forma_platnosci, waluta, kurs_waluty, netto, vat, brutto, zaplacono, status_platnosci,
          opiekun, opiekun_id, koszt_logistyki, zysk, marza_procent, prowizja_opiekuna, uwagi
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          draft.invoiceNumber,
          finalCustomerId,
          normalizeDateValue(draft.issueDate),
          normalizeDateValue(draft.saleDate),
          normalizeDateValue(draft.dueDate),
          draft.paymentMethod,
          normalizedCurrency,
          exchangeRateToPln,
          totalNet,
          totalVat,
          totalGross,
          paidAmount,
          statusPlatnosci,
          opiekunName,
          draft.ownerId,
          0,
          totalProfit,
          marginPercent,
          commission,
          draft.notes || null,
        ]
      );

      const invoiceId = insertInvoiceResult.insertId;

      const itemValues = normalizedItems.map((item) => [
        invoiceId,
        item.product_id,
        item.lp,
        item.nazwa,
        item.ilosc,
        item.jednostka,
        item.cena_netto,
        item.stawka_vat,
        item.wartosc_netto,
        item.wartosc_vat,
        item.wartosc_brutto,
        item.cena_zakupu,
        item.koszt_calkowity,
        item.zysk,
        item.marza_procent,
        item.is_shipping,
      ]);

      await connection.query(
        `INSERT INTO invoice_items (
          invoice_id, product_id, lp, nazwa, ilosc, jednostka, cena_netto, stawka_vat,
          wartosc_netto, wartosc_vat, wartosc_brutto, cena_zakupu, koszt_calkowity,
          zysk, marza_procent, is_shipping
        ) VALUES ?`,
        [itemValues]
      );

      const generatedPdfPath = await generateInvoicePdf({
        numerFaktury: draft.invoiceNumber,
        dataWystawienia: normalizeDateValue(draft.issueDate),
        dataSprzedazy: normalizeDateValue(draft.saleDate),
        terminPlatnosci: normalizeDateValue(draft.dueDate),
        formaPlatnosci: draft.paymentMethod,
        waluta: normalizedCurrency,
        customer: {
          nazwa: String(resolvedCustomer.nazwa || draft.customer.name || ''),
          nip: resolvedCustomer.nip ? String(resolvedCustomer.nip) : draft.customer.nip,
          ulica: resolvedCustomer.ulica ? String(resolvedCustomer.ulica) : draft.customer.street,
          kodPocztowy: resolvedCustomer.kod_pocztowy ? String(resolvedCustomer.kod_pocztowy) : draft.customer.postalCode,
          miasto: resolvedCustomer.miasto ? String(resolvedCustomer.miasto) : draft.customer.city,
        },
        items: normalizedItems.map((item) => ({
          lp: item.lp,
          nazwa: item.nazwa,
          ilosc: item.ilosc,
          jednostka: item.jednostka,
          cenaNetto: item.cena_netto,
          stawkaVat: item.stawka_vat,
          wartoscNetto: item.wartosc_netto,
          wartoscBrutto: item.wartosc_brutto,
        })),
        netto: totalNet,
        vat: totalVat,
        brutto: totalGross,
        zaplacono: paidAmount,
        uwagi: draft.notes || null,
      });

      await connection.query('UPDATE invoices SET pdf_path = ? WHERE id = ?', [generatedPdfPath, invoiceId]);
      createdInvoiceIds.push(invoiceId);
    }

    await connection.commit();

    return res.status(201).json({
      message: `Imported ${createdInvoiceIds.length} invoice(s)`,
      created_count: createdInvoiceIds.length,
      skipped_duplicates: duplicates.length,
      created_invoice_ids: createdInvoiceIds,
      skipped: duplicates,
    });
  } catch (error: unknown) {
    await connection.rollback();
    const mysqlError = error as { code?: string; message?: string };
    if (mysqlError.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'Duplicate invoice number detected during import',
      });
    }

    console.error('Error importing invoices from CSV:', error);
    return res.status(500).json({
      error: mysqlError.message || 'Failed to import invoices from CSV',
    });
  } finally {
    connection.release();
  }
});

// GET /api/invoices/storage/summary - sold quantities and estimated stock
router.get('/storage/summary', async (req, res) => {
  try {
    const { data_od, data_do } = req.query;

    let dateClause = '';
    const params: Array<string> = [];

    if (data_od) {
      dateClause += ' AND i.data_wystawienia >= ?';
      params.push(String(data_od));
    }

    if (data_do) {
      dateClause += ' AND i.data_wystawienia <= ?';
      params.push(String(data_do));
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         p.id,
         p.nazwa,
         p.sku,
         p.jednostka,
         p.stan_magazynowy,
         COALESCE(SUM(ii.ilosc), 0) AS sold_quantity,
         COALESCE(SUM(ii.wartosc_netto), 0) AS sold_value_net,
         (COALESCE(p.stan_magazynowy, 0) - COALESCE(SUM(ii.ilosc), 0)) AS estimated_remaining
       FROM products p
       LEFT JOIN invoice_items ii ON ii.product_id = p.id
       LEFT JOIN invoices i ON i.id = ii.invoice_id
       WHERE p.aktywny = 1 ${dateClause}
       GROUP BY p.id, p.nazwa, p.sku, p.jednostka, p.stan_magazynowy
       ORDER BY sold_quantity DESC, p.nazwa ASC`,
      params
    );

    const totalSold = rows.reduce((sum, row) => sum + Number(row.sold_quantity || 0), 0);
    const productsWithSales = rows.filter((row) => Number(row.sold_quantity || 0) > 0).length;

    res.json({
      data: rows,
      total_sold_quantity: totalSold,
      products_with_sales: productsWithSales
    });
  } catch (error) {
    console.error('Error fetching storage summary:', error);
    res.status(500).json({ error: 'Failed to fetch storage summary' });
  }
});

// GET /api/invoices/orphan-items - Find invoice items without linked products
router.get('/orphan-items', async (req, res) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
         ii.id,
         ii.invoice_id,
         ii.lp,
         ii.nazwa,
         ii.ilosc,
         ii.jednostka,
         ii.cena_netto,
         ii.wartosc_netto,
         ii.cena_zakupu,
         ii.zysk,
         ii.marza_procent,
         i.numer_faktury,
         i.data_wystawienia,
         c.nazwa as customer_nazwa
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       JOIN customers c ON c.id = i.customer_id
       WHERE ii.product_id IS NULL
       ORDER BY i.data_wystawienia DESC, ii.lp ASC`
    );

    res.json({
      data: rows,
      total: rows.length
    });
  } catch (error) {
    console.error('Error fetching orphan items:', error);
    res.status(500).json({ error: 'Failed to fetch orphan items' });
  }
});

// PUT /api/invoices/orphan-items/:id/link - Link orphan item to existing product
router.put('/orphan-items/:id/link', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id, 10);
    const { product_id } = req.body;

    if (Number.isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid item ID' });
    }

    if (!product_id || Number.isNaN(parseInt(String(product_id), 10))) {
      return res.status(400).json({ error: 'product_id is required' });
    }

    const productId = parseInt(String(product_id), 10);

    const [itemRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, invoice_id, nazwa, ilosc, wartosc_netto FROM invoice_items WHERE id = ? LIMIT 1',
      [itemId]
    );

    if (itemRows.length === 0) {
      return res.status(404).json({ error: 'Invoice item not found' });
    }

    const [productRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, nazwa, cena_zakupu FROM products WHERE id = ? LIMIT 1',
      [productId]
    );

    if (productRows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productRows[0];

    await pool.query(
      'UPDATE invoice_items SET product_id = ? WHERE id = ?',
      [productId, itemId]
    );

    res.json({
      message: 'Item linked to product successfully',
      item_id: itemId,
      product_id: productId,
      product_name: product.nazwa
    });
  } catch (error) {
    console.error('Error linking orphan item:', error);
    res.status(500).json({ error: 'Failed to link orphan item' });
  }
});

// POST /api/invoices/orphan-items/:id/create-product - Create product from orphan item and link
router.post('/orphan-items/:id/create-product', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const itemId = parseInt(req.params.id, 10);

    if (Number.isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid item ID' });
    }

    const [itemRows] = await connection.query<RowDataPacket[]>(
      `SELECT ii.id, ii.nazwa, ii.jednostka, ii.stawka_vat, ii.cena_zakupu, ii.cena_netto
       FROM invoice_items ii
       WHERE ii.id = ? AND ii.product_id IS NULL
       LIMIT 1`,
      [itemId]
    );

    if (itemRows.length === 0) {
      return res.status(404).json({ error: 'Orphan invoice item not found' });
    }

    const item = itemRows[0];

    const [existingProductRows] = await connection.query<RowDataPacket[]>(
      'SELECT id, nazwa FROM products WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) LIMIT 1',
      [item.nazwa]
    );

    if (existingProductRows.length > 0) {
      const existingProduct = existingProductRows[0];
      await connection.query(
        'UPDATE invoice_items SET product_id = ? WHERE id = ?',
        [existingProduct.id, itemId]
      );
      return res.json({
        message: 'Linked to existing product',
        item_id: itemId,
        product_id: existingProduct.id,
        product_name: existingProduct.nazwa,
        was_created: false
      });
    }

    const [insertResult] = await connection.query<ResultSetHeader>(
      `INSERT INTO products (nazwa, jednostka, stawka_vat, cena_zakupu, cena_sprzedazy_rekomendowana, aktywny)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        item.nazwa,
        item.jednostka || 'szt',
        item.stawka_vat ?? 23,
        item.cena_zakupu ?? null,
        item.cena_netto ?? null
      ]
    );

    const newProductId = insertResult.insertId;

    await connection.query(
      'UPDATE invoice_items SET product_id = ? WHERE id = ?',
      [newProductId, itemId]
    );

    res.status(201).json({
      message: 'Product created and linked successfully',
      item_id: itemId,
      product_id: newProductId,
      product_name: item.nazwa,
      was_created: true
    });
  } catch (error) {
    console.error('Error creating product from orphan item:', error);
    res.status(500).json({ error: 'Failed to create product from orphan item' });
  } finally {
    connection.release();
  }
});

// POST /api/invoices/orphan-items/create-all - Create products for all orphan items
router.post('/orphan-items/create-all', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [orphanRows] = await connection.query<RowDataPacket[]>(
      `SELECT ii.id, ii.nazwa, ii.jednostka, ii.stawka_vat, ii.cena_zakupu, ii.cena_netto
       FROM invoice_items ii
       WHERE ii.product_id IS NULL
       ORDER BY ii.nazwa ASC`
    );

    if (orphanRows.length === 0) {
      return res.json({
        message: 'No orphan items found',
        created_count: 0,
        linked_count: 0
      });
    }

    let createdCount = 0;
    let linkedCount = 0;
    const results: Array<{ item_id: number; product_id: number; product_name: string; was_created: boolean }> = [];

    for (const item of orphanRows) {
      const [existingProductRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, nazwa FROM products WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) LIMIT 1',
        [item.nazwa]
      );

      if (existingProductRows.length > 0) {
        const existingProduct = existingProductRows[0];
        await connection.query(
          'UPDATE invoice_items SET product_id = ? WHERE id = ?',
          [existingProduct.id, item.id]
        );
        linkedCount++;
        results.push({
          item_id: item.id,
          product_id: existingProduct.id,
          product_name: existingProduct.nazwa,
          was_created: false
        });
      } else {
        const [insertResult] = await connection.query<ResultSetHeader>(
          `INSERT INTO products (nazwa, jednostka, stawka_vat, cena_zakupu, cena_sprzedazy_rekomendowana, aktywny)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [
            item.nazwa,
            item.jednostka || 'szt',
            item.stawka_vat ?? 23,
            item.cena_zakupu ?? null,
            item.cena_netto ?? null
          ]
        );

        const newProductId = insertResult.insertId;

        await connection.query(
          'UPDATE invoice_items SET product_id = ? WHERE id = ?',
          [newProductId, item.id]
        );

        createdCount++;
        results.push({
          item_id: item.id,
          product_id: newProductId,
          product_name: item.nazwa,
          was_created: true
        });
      }
    }

    res.status(201).json({
      message: `Processed ${orphanRows.length} orphan items`,
      created_count: createdCount,
      linked_count: linkedCount,
      total_processed: orphanRows.length,
      results
    });
  } catch (error) {
    console.error('Error creating products from orphan items:', error);
    res.status(500).json({ error: 'Failed to create products from orphan items' });
  } finally {
    connection.release();
  }
});

async function resolveInvoicePdf(invoiceId: number): Promise<{
  absolutePath: string;
  downloadName: string;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT numer_faktury, pdf_path
     FROM invoices
     WHERE id = ?
     LIMIT 1`,
    [invoiceId]
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  const invoiceNumber = sanitizeFileNamePart(String(row.numer_faktury || `invoice-${invoiceId}`));
  const originalStoredPath = row.pdf_path ? String(row.pdf_path) : '';
  let storedPath = originalStoredPath;
  if (!storedPath) {
    const regenerated = await regenerateInvoicePdfFromDb(invoiceId);
    if (!regenerated) {
      return null;
    }
    storedPath = regenerated;
  }

  let absolutePath = resolveStoredPath(storedPath);
  const validDirectPath =
    absolutePath && isPathInsideBackendRoot(absolutePath) && fs.existsSync(absolutePath);

  if (!validDirectPath) {
    const movedCandidate = path.join(INVOICE_PDF_DIR, path.basename(storedPath));
    const movedCandidateValid =
      isPathInsideBackendRoot(movedCandidate) && fs.existsSync(movedCandidate);

    if (!movedCandidateValid) {
      const regenerated = await regenerateInvoicePdfFromDb(invoiceId);
      if (!regenerated) {
        return null;
      }
      const regeneratedAbsolutePath = resolveStoredPath(regenerated);
      if (!regeneratedAbsolutePath || !fs.existsSync(regeneratedAbsolutePath)) {
        return null;
      }
      return {
        absolutePath: regeneratedAbsolutePath,
        downloadName: `${invoiceNumber}.pdf`,
      };
    }

    absolutePath = movedCandidate;
    storedPath = toStoredPath(movedCandidate);

    if (storedPath !== originalStoredPath) {
      await pool.query(
        'UPDATE invoices SET pdf_path = ? WHERE id = ?',
        [storedPath, invoiceId]
      );
    }
  }

  return {
    absolutePath,
    downloadName: `${invoiceNumber}.pdf`,
  };
}

function toIsoDateString(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function regenerateInvoicePdfFromDb(invoiceId: number): Promise<string | null> {
  const [invoiceRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       i.id,
       i.numer_faktury,
       i.data_wystawienia,
       i.data_sprzedazy,
       i.termin_platnosci,
       i.forma_platnosci,
       i.waluta,
       i.netto,
       i.vat,
       i.brutto,
       i.zaplacono,
       i.uwagi,
       c.nazwa AS customer_nazwa,
       c.nip AS customer_nip,
       c.ulica AS customer_ulica,
       c.kod_pocztowy AS customer_kod_pocztowy,
       c.miasto AS customer_miasto
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = ?
     LIMIT 1`,
    [invoiceId]
  );

  if (invoiceRows.length === 0) return null;
  const invoice = invoiceRows[0];

  const [itemRows] = await pool.query<RowDataPacket[]>(
    `SELECT lp, nazwa, ilosc, jednostka, cena_netto, stawka_vat, wartosc_netto, wartosc_brutto
     FROM invoice_items
     WHERE invoice_id = ?
     ORDER BY lp ASC, id ASC`,
    [invoiceId]
  );

  if (itemRows.length === 0) return null;

  const generatedPdfPath = await generateInvoicePdf({
    numerFaktury: String(invoice.numer_faktury || `invoice-${invoiceId}`),
    dataWystawienia: toIsoDateString(invoice.data_wystawienia),
    dataSprzedazy: toIsoDateString(invoice.data_sprzedazy),
    terminPlatnosci: toIsoDateString(invoice.termin_platnosci),
    formaPlatnosci: invoice.forma_platnosci ? String(invoice.forma_platnosci) : null,
    waluta: String(invoice.waluta || 'PLN').toUpperCase(),
    customer: {
      nazwa: String(invoice.customer_nazwa || '-'),
      nip: invoice.customer_nip ? String(invoice.customer_nip) : null,
      ulica: invoice.customer_ulica ? String(invoice.customer_ulica) : null,
      kodPocztowy: invoice.customer_kod_pocztowy ? String(invoice.customer_kod_pocztowy) : null,
      miasto: invoice.customer_miasto ? String(invoice.customer_miasto) : null,
    },
    items: itemRows.map((item, index) => ({
      lp: Number(item.lp || index + 1),
      nazwa: String(item.nazwa || '-'),
      ilosc: Number(item.ilosc || 0),
      jednostka: String(item.jednostka || 'szt'),
      cenaNetto: Number(item.cena_netto || 0),
      stawkaVat: Number(item.stawka_vat || 0),
      wartoscNetto: Number(item.wartosc_netto || 0),
      wartoscBrutto: Number(item.wartosc_brutto || 0),
    })),
    netto: Number(invoice.netto || 0),
    vat: Number(invoice.vat || 0),
    brutto: Number(invoice.brutto || 0),
    zaplacono: Number(invoice.zaplacono || 0),
    uwagi: invoice.uwagi ? String(invoice.uwagi) : null,
  });

  await pool.query(
    'UPDATE invoices SET pdf_path = ? WHERE id = ?',
    [generatedPdfPath, invoiceId]
  );

  return generatedPdfPath;
}

router.get('/:id/pdf', async (req, res) => {
  try {
    const invoiceId = parseInt(req.params.id, 10);
    if (Number.isNaN(invoiceId)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }

    const pdfData = await resolveInvoicePdf(invoiceId);
    if (!pdfData) {
      return res.status(404).json({ error: 'Invoice PDF not found' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfData.downloadName}"`);
    res.sendFile(path.resolve(pdfData.absolutePath));
  } catch (error) {
    console.error('Error opening invoice PDF:', error);
    res.status(500).json({ error: 'Failed to open invoice PDF' });
  }
});

router.get('/:id/pdf/download', async (req, res) => {
  try {
    const invoiceId = parseInt(req.params.id, 10);
    if (Number.isNaN(invoiceId)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }

    const pdfData = await resolveInvoicePdf(invoiceId);
    if (!pdfData) {
      return res.status(404).json({ error: 'Invoice PDF not found' });
    }

    res.download(path.resolve(pdfData.absolutePath), pdfData.downloadName);
  } catch (error) {
    console.error('Error downloading invoice PDF:', error);
    res.status(500).json({ error: 'Failed to download invoice PDF' });
  }
});

// GET /api/invoices/:id - Get single invoice with items
router.get('/:id', async (req, res) => {
  try {
    const invoiceId = parseInt(req.params.id);
    
    // Get invoice with customer
    const [invoiceRows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        i.*,
        c.nazwa as customer_nazwa,
        c.nip as customer_nip,
        c.ulica as customer_ulica,
        c.kod_pocztowy as customer_kod_pocztowy,
        c.miasto as customer_miasto,
        c.kraj as customer_kraj,
        ig.code as invoice_group_code,
        ig.name as invoice_group_name
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      LEFT JOIN invoice_groups ig ON i.invoice_group_id = ig.id
      WHERE i.id = ?`,
      [invoiceId]
    );

    if (invoiceRows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceRows[0];

    // Get invoice items
    const [itemRows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        ii.*,
        p.nazwa as product_nazwa,
        p.sku as product_sku
      FROM invoice_items ii
      LEFT JOIN products p ON ii.product_id = p.id
      WHERE ii.invoice_id = ?
      ORDER BY ii.lp ASC`,
      [invoiceId]
    );

    invoice.items = itemRows;

    res.json(invoice);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// PUT /api/invoices/:id - Update invoice
router.put('/:id', async (req, res) => {
  try {
    const invoiceId = parseInt(req.params.id);
    if (Number.isNaN(invoiceId)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }

    const { opiekun, opiekun_id, invoice_group_id, forma_platnosci, koszt_logistyki, status_platnosci, uwagi, waluta, kurs_waluty } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let shouldRecalculateFinancials = false;

    if (opiekun !== undefined) {
      updates.push('opiekun = ?');
      values.push(opiekun);
    }

    if (opiekun_id !== undefined) {
      updates.push('opiekun_id = ?');
      values.push(opiekun_id || null);
      
      // If opiekun_id is set, get the opiekun's name and calculate commission
      if (opiekun_id) {
        const [opiekunRows] = await pool.query<RowDataPacket[]>(
          'SELECT imie, marza_procent FROM opiekunowie WHERE id = ?',
          [opiekun_id]
        );
        
        if (opiekunRows.length > 0) {
          const opiekunData = opiekunRows[0];
          updates.push('opiekun = ?');
          values.push(opiekunData.imie);
          
          // Get invoice zysk to calculate commission
          const [invoiceRows] = await pool.query<RowDataPacket[]>(
            'SELECT zysk FROM invoices WHERE id = ?',
            [invoiceId]
          );
          
          if (invoiceRows.length > 0 && invoiceRows[0].zysk) {
            const prowizja = (Number(invoiceRows[0].zysk) * Number(opiekunData.marza_procent)) / 100;
            updates.push('prowizja_opiekuna = ?');
            values.push(prowizja);
          }
        }
      } else {
        // Clear opiekun if opiekun_id is null
        updates.push('opiekun = NULL');
        updates.push('prowizja_opiekuna = NULL');
      }
    }

    if (koszt_logistyki !== undefined) {
      updates.push('koszt_logistyki = ?');
      values.push(koszt_logistyki);
      shouldRecalculateFinancials = true;
    }

    if (status_platnosci !== undefined) {
      updates.push('status_platnosci = ?');
      values.push(status_platnosci);

      if (status_platnosci === 'oplacona') {
        updates.push('zaplacono = brutto');
      } else if (status_platnosci === 'nieoplacona') {
        updates.push('zaplacono = 0');
      }
    }

    if (forma_platnosci !== undefined) {
      const normalizedPaymentMethod = normalizePaymentMethod(forma_platnosci);
      if (normalizedPaymentMethod === null && forma_platnosci !== null && String(forma_platnosci).trim() !== '') {
        return res.status(400).json({ error: 'Invalid forma_platnosci. Allowed: przelew, pobranie, karta, gotowka' });
      }

      updates.push('forma_platnosci = ?');
      values.push(normalizedPaymentMethod);
    }

    if (uwagi !== undefined) {
      updates.push('uwagi = ?');
      values.push(uwagi);
    }

    if (invoice_group_id !== undefined) {
      if (invoice_group_id === null || invoice_group_id === '') {
        updates.push('invoice_group_id = ?');
        values.push(null);
      } else {
        const normalizedGroupId = parseOptionalEntityId(invoice_group_id);
        if (!normalizedGroupId) {
          return res.status(400).json({ error: 'Invalid invoice_group_id' });
        }

        const [groupRows] = await pool.query<RowDataPacket[]>(
          'SELECT id FROM invoice_groups WHERE id = ? LIMIT 1',
          [normalizedGroupId]
        );
        if (groupRows.length === 0) {
          return res.status(400).json({ error: 'invoice_group_id was not found' });
        }

        updates.push('invoice_group_id = ?');
        values.push(normalizedGroupId);
      }
    }

    if (waluta !== undefined || kurs_waluty !== undefined) {
      const [currentInvoiceRows] = await pool.query<RowDataPacket[]>(
        'SELECT waluta, kurs_waluty FROM invoices WHERE id = ? LIMIT 1',
        [invoiceId]
      );

      if (currentInvoiceRows.length === 0) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const currentCurrency = String(currentInvoiceRows[0].waluta || 'PLN').trim().toUpperCase();
      const targetCurrency = waluta !== undefined
        ? normalizeCurrencyCode(waluta)
        : currentCurrency;

      if (!targetCurrency) {
        return res.status(400).json({ error: 'Invalid waluta. Use ISO code like PLN, EUR, HUF' });
      }

      const currentRate = Number(currentInvoiceRows[0].kurs_waluty || 1);
      const requestedRate = kurs_waluty !== undefined ? kurs_waluty : currentRate;
      const targetRate = resolveExchangeRateToPln(targetCurrency, requestedRate);

      if (targetRate === null) {
        return res.status(400).json({ error: 'Invalid kurs_waluty. Provide PLN rate for 1 unit of invoice currency' });
      }

      if (waluta !== undefined) {
        updates.push('waluta = ?');
        values.push(targetCurrency);
      }

      if (kurs_waluty !== undefined || targetCurrency === 'PLN' || waluta !== undefined) {
        updates.push('kurs_waluty = ?');
        values.push(targetRate);
      }

      shouldRecalculateFinancials = true;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(invoiceId);

    await pool.query(
      `UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    let recalculation = null;
    if (shouldRecalculateFinancials) {
      recalculation = await recalculateInvoicesFromProductPrices([invoiceId], {
        syncItemPurchasePrices: 'all',
      });
    }

    res.json({ message: 'Invoice updated successfully', recalculation });
  } catch (error) {
    console.error('Error updating invoice:', error);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// DELETE /api/invoices/:id - Delete invoice
router.delete('/:id', async (req, res) => {
  try {
    const invoiceId = parseInt(req.params.id, 10);
    if (Number.isNaN(invoiceId)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT pdf_path FROM invoices WHERE id = ? LIMIT 1',
      [invoiceId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const storedPath = rows[0].pdf_path ? String(rows[0].pdf_path) : '';
    let absolutePath = storedPath ? resolveStoredPath(storedPath) : '';

    const hasValidDirectPath =
      absolutePath && isPathInsideBackendRoot(absolutePath) && fs.existsSync(absolutePath);

    if (!hasValidDirectPath && storedPath) {
      const movedCandidate = path.join(INVOICE_PDF_DIR, path.basename(storedPath));
      if (isPathInsideBackendRoot(movedCandidate) && fs.existsSync(movedCandidate)) {
        absolutePath = movedCandidate;
      }
    }

    await pool.query('DELETE FROM invoices WHERE id = ?', [invoiceId]);

    if (absolutePath && isPathInsideBackendRoot(absolutePath) && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
    
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// GET /api/invoices/export - Export to CSV
router.get('/export/all', async (req, res) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        i.numer_faktury,
        c.nazwa as customer_nazwa,
        c.nip as customer_nip,
        i.data_wystawienia,
        i.data_sprzedazy,
        i.termin_platnosci,
        i.waluta,
        i.netto,
        i.vat,
        i.brutto,
        i.zysk,
        i.marza_procent,
        i.status_platnosci,
        i.opiekun,
        i.koszt_logistyki,
        ig.name as invoice_group_name
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      LEFT JOIN invoice_groups ig ON ig.id = i.invoice_group_id
      ORDER BY i.data_wystawienia DESC`
    );

    // Convert to CSV
    const headers = [
      'Numer Faktury', 'Kontrahent', 'NIP', 'Data Wystawienia', 'Data Sprzedaży',
      'Termin Płatności', 'Waluta', 'Netto', 'VAT', 'Brutto', 'Zysk', 'Marża %',
      'Status', 'Opiekun', 'Grupa', 'Koszt Logistyki'
    ];

    const separator = ';';
    const csvRows = [`sep=${separator}`, headers.join(separator)];

    for (const row of rows) {
      csvRows.push([
        row.numer_faktury,
        row.customer_nazwa,
        row.customer_nip || '',
        row.data_wystawienia,
        row.data_sprzedazy,
        row.termin_platnosci,
        row.waluta,
        row.netto,
        row.vat,
        row.brutto,
        row.zysk || '',
        row.marza_procent || '',
        row.status_platnosci,
        row.opiekun || '',
        row.invoice_group_name || '',
        row.koszt_logistyki || ''
      ].map((value) => toCsvCell(value, separator)).join(separator));
    }

    const encoded = encodeCsvForDownload(csvRows.join('\r\n'), req.query.encoding);

    res.setHeader('Content-Type', `text/csv; charset=${encoded.charset}`);
    res.setHeader('Content-Disposition', 'attachment; filename=invoices.csv');
    res.send(encoded.content);
  } catch (error) {
    console.error('Error exporting invoices:', error);
    res.status(500).json({ error: 'Failed to export invoices' });
  }
});

export default router;
