import path from 'path';

const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

export interface ParsedCostDocumentResult {
  suggested_amount_original: number | null;
  suggested_currency: string | null;
  suggested_exchange_rate_to_pln: number | null;
  suggested_cost_date: string | null;
  suggested_title: string | null;
  document_number: string | null;
  vendor_name: string | null;
  confidence: number;
  warnings: string[];
  raw_text_preview: string;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeCurrencyCode(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return normalized;
}

function toNumber(value: string): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/\s+/g, '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/(\..*)\./g, '$1')
    .replace(/,(?=.*,)/g, '')
    .replace(',', '.');

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const dmy = value.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const ymd = value.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function detectCurrency(text: string): string | null {
  const upper = text.toUpperCase();

  if (/\bPLN\b|\bZL\b|\bZL\.?\b|\bZLOTY\b/.test(upper) || /zł/i.test(text)) return 'PLN';
  if (/\bEUR\b/.test(upper) || /€/i.test(text)) return 'EUR';
  if (/\bUSD\b/.test(upper) || /\$/.test(text)) return 'USD';
  if (/\bHUF\b/.test(upper) || /\bFT\b/.test(upper)) return 'HUF';
  if (/\bCZK\b/.test(upper) || /\bK[ČC]\b/.test(upper)) return 'CZK';
  if (/\bGBP\b/.test(upper) || /£/.test(text)) return 'GBP';

  return null;
}

function detectDate(text: string): string | null {
  const keywordPatterns = [
    /(?:data\s+wystawienia|date\s+of\s+issue|invoice\s+date|data\s+faktury|issue\s+date)\s*[:\-]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2})/i,
    /(?:termin\s+p[łl]atno[sś]ci|due\s+date|payment\s+due)\s*[:\-]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2})/i,
  ];

  for (const pattern of keywordPatterns) {
    const match = text.match(pattern);
    const iso = toIsoDate(match?.[1] || null);
    if (iso) return iso;
  }

  const fallback = text.match(/(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2})/);
  return toIsoDate(fallback?.[1] || null);
}

function detectDocumentNumber(text: string): string | null {
  const patterns = [
    /(?:faktura|invoice)\s*(?:nr|no\.?|number)?\s*[:#]?\s*([A-Z0-9\-\/.]{4,64})/i,
    /\b(?:nr|no\.)\s*[:#]?\s*([A-Z0-9\-\/.]{4,64})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function detectVendorName(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2);

  if (lines.length === 0) return null;

  for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
    const line = lines[i];
    if (/^(sprzedawca|seller|vendor|from)\b/i.test(line)) {
      const cleaned = line.replace(/^(sprzedawca|seller|vendor|from)\s*:?\s*/i, '').trim();
      if (cleaned.length >= 3) return cleaned;
      if (lines[i + 1] && !/\d/.test(lines[i + 1])) return lines[i + 1];
    }
  }

  return lines[0] || null;
}

function extractAmountCandidates(text: string): Array<{ amount: number; score: number }> {
  const candidates: Array<{ amount: number; score: number }> = [];

  const keywordPatterns = [
    /(?:razem\s+do\s+zap[łl]aty|kwota\s+do\s+zap[łl]aty|do\s+zap[łl]aty|nale[żz]no[sś]ć\s+og[óo][łl]em|suma\s+ko[nń]cowa|total\s+amount|amount\s+due|grand\s+total|total)\s*[:=]?\s*([\-]?[0-9][0-9\s.,]{1,30})/gi,
    /(?:brutto|gross)\s*[:=]?\s*([\-]?[0-9][0-9\s.,]{1,30})/gi,
  ];

  for (const pattern of keywordPatterns) {
    for (const match of text.matchAll(pattern)) {
      const parsed = toNumber(match[1] || '');
      if (parsed !== null && parsed > 0) {
        candidates.push({ amount: parsed, score: 3 });
      }
    }
  }

  const allNumbers = text.match(/-?[0-9]{1,3}(?:[\s.][0-9]{3})*(?:,[0-9]{2,4})|-?[0-9]+(?:\.[0-9]{2,4})/g) || [];
  for (const value of allNumbers) {
    const parsed = toNumber(value);
    if (parsed !== null && parsed > 0) {
      candidates.push({ amount: parsed, score: 1 });
    }
  }

  return candidates;
}

function chooseBestAmount(candidates: Array<{ amount: number; score: number }>): {
  amount: number | null;
  confidence: number;
} {
  if (candidates.length === 0) {
    return { amount: null, confidence: 0.1 };
  }

  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.amount - a.amount;
  });

  const best = sorted[0];
  const confidence = best.score >= 3 ? 0.9 : 0.55;
  return {
    amount: roundMoney(best.amount),
    confidence,
  };
}

function detectExchangeRateToPln(currency: string | null): number | null {
  if (!currency || currency === 'PLN') {
    return 1;
  }
  return null;
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parsed = await pdfParse(buffer);
  return String(parsed?.text || '');
}

function extractTextFromSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return '';
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return '';
  return XLSX.utils.sheet_to_csv(sheet, { FS: ';' });
}

function extractTextFromCsvOrText(buffer: Buffer): string {
  return buffer.toString('utf8');
}

function composeSuggestedTitle(vendorName: string | null, documentNumber: string | null, fileName: string): string {
  if (vendorName && documentNumber) {
    return `${vendorName} ${documentNumber}`;
  }
  if (vendorName) {
    return vendorName;
  }
  if (documentNumber) {
    return `Cost ${documentNumber}`;
  }
  return path.basename(fileName || 'Uploaded cost document');
}

export async function parseCostDocument(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<ParsedCostDocumentResult> {
  const warnings: string[] = [];
  let text = '';

  try {
    if (mimeType === 'application/pdf') {
      text = await extractTextFromPdf(buffer);
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || mimeType === 'application/vnd.ms-excel'
    ) {
      text = extractTextFromSpreadsheet(buffer);
    } else if (
      mimeType === 'text/csv'
      || mimeType === 'text/plain'
      || mimeType === 'application/csv'
    ) {
      text = extractTextFromCsvOrText(buffer);
    } else {
      warnings.push(`Parsing not supported for MIME type: ${mimeType}`);
    }
  } catch (error) {
    warnings.push(`Could not parse document text: ${(error as Error).message}`);
  }

  if (!text || text.trim().length === 0) {
    warnings.push('Document text is empty or not extractable. You can still enter values manually.');
  }

  const currency = normalizeCurrencyCode(detectCurrency(text));
  const amountCandidates = extractAmountCandidates(text);
  const amountChoice = chooseBestAmount(amountCandidates);
  const costDate = detectDate(text);
  const documentNumber = detectDocumentNumber(text);
  const vendorName = detectVendorName(text);
  const exchangeRateToPln = detectExchangeRateToPln(currency);

  if (amountChoice.amount === null) {
    warnings.push('Could not confidently detect total amount. Please enter it manually.');
  }

  if (!currency) {
    warnings.push('Could not detect currency. Defaulting to PLN in UI is recommended.');
  }

  return {
    suggested_amount_original: amountChoice.amount,
    suggested_currency: currency,
    suggested_exchange_rate_to_pln: exchangeRateToPln,
    suggested_cost_date: costDate,
    suggested_title: composeSuggestedTitle(vendorName, documentNumber, fileName),
    document_number: documentNumber,
    vendor_name: vendorName,
    confidence: amountChoice.confidence,
    warnings,
    raw_text_preview: text.slice(0, 1000),
  };
}
