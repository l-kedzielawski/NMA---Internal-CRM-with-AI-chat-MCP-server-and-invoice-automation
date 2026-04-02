import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { pool } from '../config/database';
import { parseInvoicePDF } from '../services/pdfParser';
import { calculateItemProfit, calculateInvoiceProfit } from '../services/profitCalculator';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import fs from 'fs';
import {
  INVOICE_PDF_DIR,
  ensureStorageDirs,
  formatInvoicePdfFileName,
  toStoredPath,
} from '../services/fileStorage';
import { requireRole } from '../middleware/auth';

const router = Router();

router.use(requireRole('admin', 'manager', 'bookkeeping'));

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
  return normalizeInvoiceNumber(value).toUpperCase();
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req: Express.Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    ensureStorageDirs();
    cb(null, INVOICE_PDF_DIR);
  },
  filename: (_req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `upload-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// POST /api/invoices/upload - Upload and parse PDF
router.post('/', upload.single('pdf'), async (req: Request, res: Response) => {
  let currentPdfPath: string | null = req.file?.path || null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const pdfPath = req.file.path;
    
    // Read PDF file
    const pdfBuffer = fs.readFileSync(pdfPath);

    // Parse PDF
    const parsedInvoice = await parseInvoicePDF(pdfBuffer);
    const invoiceNumber = canonicalInvoiceNumber(parsedInvoice.numerFaktury);
    if (!invoiceNumber) {
      fs.unlinkSync(pdfPath);
      currentPdfPath = null;
      return res.status(400).json({ error: 'Invoice number missing in PDF' });
    }

    // Check if invoice already exists
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id, numer_faktury
       FROM invoices
       WHERE REPLACE(LOWER(TRIM(numer_faktury)), ' ', '') = ?
       LIMIT 1`,
      [normalizeInvoiceNumber(invoiceNumber)]
    );

    if (existing.length > 0) {
      // Clean up uploaded file
      fs.unlinkSync(pdfPath);
      currentPdfPath = null;
      return res.status(409).json({ 
        error: 'Invoice already exists',
        details: `Invoice ${existing[0].numer_faktury} is already in the system`,
        invoiceId: existing[0].id
      });
    }

    const canonicalPdfName = formatInvoicePdfFileName(invoiceNumber);
    const canonicalPdfPath = path.join(INVOICE_PDF_DIR, canonicalPdfName);

    if (fs.existsSync(canonicalPdfPath)) {
      fs.unlinkSync(canonicalPdfPath);
    }

    if (pdfPath !== canonicalPdfPath) {
      fs.renameSync(pdfPath, canonicalPdfPath);
      currentPdfPath = canonicalPdfPath;
    }
    const storedPdfPath = toStoredPath(canonicalPdfPath);

    // Find or create customer
    const incomingName = String(parsedInvoice.nabywca.nazwa || '').replace(/\s+/g, ' ').trim();
    const incomingNip = parsedInvoice.nabywca.nip ? String(parsedInvoice.nabywca.nip).trim() : '';
    const incomingStreet = parsedInvoice.nabywca.ulica ? String(parsedInvoice.nabywca.ulica).trim() : '';
    const incomingPostCode = parsedInvoice.nabywca.kodPocztowy ? String(parsedInvoice.nabywca.kodPocztowy).trim() : '';
    const incomingCity = parsedInvoice.nabywca.miasto ? String(parsedInvoice.nabywca.miasto).trim() : '';

    let customerId: number;
    let matchedByNip = false;
    let existingCustomer: RowDataPacket[] = [];

    if (incomingNip) {
      const [byNipRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, nazwa, nip, ulica, kod_pocztowy, miasto FROM customers WHERE nip = ? LIMIT 1',
        [incomingNip]
      );
      existingCustomer = byNipRows;
      matchedByNip = byNipRows.length > 0;
    }

    if (existingCustomer.length === 0 && incomingName) {
      const [byNameRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, nazwa, nip, ulica, kod_pocztowy, miasto FROM customers WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) LIMIT 1',
        [incomingName]
      );
      existingCustomer = byNameRows;
    }

    if (existingCustomer.length > 0) {
      const existing = existingCustomer[0];
      customerId = Number(existing.id);

      const existingName = existing.nazwa ? String(existing.nazwa).replace(/\s+/g, ' ').trim() : '';
      const existingNip = existing.nip ? String(existing.nip).trim() : '';
      const existingStreet = existing.ulica ? String(existing.ulica).trim() : '';
      const existingPostCode = existing.kod_pocztowy ? String(existing.kod_pocztowy).trim() : '';
      const existingCity = existing.miasto ? String(existing.miasto).trim() : '';

      const existingLooksCorrupted = /bank\s+polski|powszechna\s+kasa\s+oszcz|nr\s+rachunku/i.test(existingName);
      const shouldUpdateName =
        incomingName.length > 0 &&
        incomingName !== existingName &&
        (matchedByNip || !existingName || existingLooksCorrupted);

      const shouldUpdate =
        shouldUpdateName ||
        (!existingNip && incomingNip) ||
        (!existingStreet && incomingStreet) ||
        (!existingPostCode && incomingPostCode) ||
        (!existingCity && incomingCity);

      if (shouldUpdate) {
        await pool.query(
          `UPDATE customers
           SET nazwa = ?, nip = ?, ulica = ?, kod_pocztowy = ?, miasto = ?
           WHERE id = ?`,
          [
            shouldUpdateName ? incomingName : existingName,
            existingNip || incomingNip || null,
            existingStreet || incomingStreet || null,
            existingPostCode || incomingPostCode || null,
            existingCity || incomingCity || null,
            customerId
          ]
        );
      }
    } else {
      // Create new customer
      const [customerResult] = await pool.query<ResultSetHeader>(
        `INSERT INTO customers (nazwa, nip, ulica, kod_pocztowy, miasto)
         VALUES (?, ?, ?, ?, ?)`,
        [
          incomingName || 'Nieznany kontrahent',
          incomingNip || null,
          incomingStreet || null,
          incomingPostCode || null,
          incomingCity || null,
        ]
      );
      customerId = customerResult.insertId;
    }

    // Create invoice
    const [invoiceResult] = await pool.query<ResultSetHeader>(
      `INSERT INTO invoices (
        numer_faktury, customer_id, data_wystawienia, data_sprzedazy,
        termin_platnosci, forma_platnosci, waluta, kurs_waluty,
        netto, vat, brutto, zaplacono, status_platnosci, pdf_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNumber,
        customerId,
        parsedInvoice.dataWystawienia,
        parsedInvoice.dataSprzedazy,
        parsedInvoice.terminPlatnosci,
        parsedInvoice.formaPlatnosci,
        'PLN',
        1.0,
        parsedInvoice.podsumowanie.netto,
        parsedInvoice.podsumowanie.vat,
          parsedInvoice.podsumowanie.brutto,
          parsedInvoice.podsumowanie.zaplacono,
          parsedInvoice.podsumowanie.pozostaje <= 0 ? 'oplacona' : 'nieoplacona',
          storedPdfPath
        ]
      );

    const invoiceId = invoiceResult.insertId;

    // Process items
    const invoiceItems = [];
    for (const item of parsedInvoice.pozycje) {
      // Find or create product
      let productId: number | null = null;
      const [existingProduct] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM products WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) LIMIT 1',
        [item.nazwa]
      );

      if (existingProduct.length > 0) {
        productId = existingProduct[0].id;
      } else {
        // Create new product without purchase price
        const [productResult] = await pool.query<ResultSetHeader>(
          `INSERT INTO products (nazwa, jednostka, stawka_vat, cena_zakupu)
           VALUES (?, ?, ?, NULL)`,
          [item.nazwa, item.jednostka, item.stawkaVat]
        );
        productId = productResult.insertId;
      }

      // Calculate profit if we have purchase price
      const purchasePrice = existingProduct?.[0]?.cena_zakupu || null;
      const profit = calculateItemProfit({
        ilosc: item.ilosc,
        cena_netto: item.cenaNetto,
        wartosc_netto: item.wartoscNetto,
        cena_zakupu: purchasePrice
      });

      // Create invoice item
      const [itemResult] = await pool.query<ResultSetHeader>(
        `INSERT INTO invoice_items (
          invoice_id, product_id, lp, nazwa, ilosc, jednostka,
          cena_netto, stawka_vat, wartosc_netto, wartosc_vat, wartosc_brutto,
          cena_zakupu, koszt_calkowity, zysk, marza_procent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          productId,
          item.lp,
          item.nazwa,
          item.ilosc,
          item.jednostka,
          item.cenaNetto,
          item.stawkaVat,
          item.wartoscNetto,
          item.wartoscNetto * (item.stawkaVat / 100),
          item.wartoscNetto * (1 + item.stawkaVat / 100),
          purchasePrice,
          profit.koszt_calkowity,
          profit.zysk,
          profit.marza_procent
        ]
      );

      invoiceItems.push({
        id: itemResult.insertId,
        nazwa: item.nazwa,
        productId,
        hasPurchasePrice: purchasePrice !== null
      });
    }

    // Calculate invoice totals
    const [itemsWithProfit] = await pool.query<RowDataPacket[]>(
      'SELECT zysk, marza_procent FROM invoice_items WHERE invoice_id = ?',
      [invoiceId]
    );

    const invoiceProfit = calculateInvoiceProfit({
      items: itemsWithProfit.map((item: any) => ({
        zysk: item.zysk || 0,
        marza_procent: item.marza_procent || 0
      })),
      koszt_logistyki: 0,
      netto: parsedInvoice.podsumowanie.netto
    });

    // Update invoice with calculated profit
    await pool.query(
      'UPDATE invoices SET zysk = ?, marza_procent = ? WHERE id = ?',
      [invoiceProfit.zysk_calkowity, invoiceProfit.marza_calkowita, invoiceId]
    );

    res.status(201).json({
      message: 'Invoice uploaded and parsed successfully',
      invoiceId,
      numerFaktury: invoiceNumber,
      items: invoiceItems,
      itemsNeedingPurchasePrice: invoiceItems.filter((item: any) => !item.hasPurchasePrice).length
    });

  } catch (error: unknown) {
    console.error('Error uploading invoice:', error);

    const errorMessage = (error as Error)?.message || '';
    if (errorMessage.includes('Invoice number could not be extracted')) {
      if (currentPdfPath) {
        try {
          fs.unlinkSync(currentPdfPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      return res.status(400).json({
        error: 'Invoice number could not be extracted from PDF',
        details: 'Upload blocked because invoice dedup requires invoice number'
      });
    }

    const mysqlError = error as { code?: string };
    if (mysqlError.code === 'ER_DUP_ENTRY') {
      if (currentPdfPath) {
        try {
          fs.unlinkSync(currentPdfPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      return res.status(409).json({
        error: 'Invoice already exists',
        details: 'This invoice number already exists in the system'
      });
    }

    if (errorMessage.includes('Invoice issue date')) {
      if (currentPdfPath) {
        try {
          fs.unlinkSync(currentPdfPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      return res.status(400).json({
        error: 'Invoice issue date could not be extracted from PDF',
        details: 'Upload blocked to avoid using upload date instead of invoice issue date',
      });
    }
    
    // Clean up uploaded file on error
    if (currentPdfPath) {
      try {
        fs.unlinkSync(currentPdfPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    res.status(500).json({ 
      error: 'Failed to process PDF',
      details: (error as Error).message 
    });
  }
});

export default router;
