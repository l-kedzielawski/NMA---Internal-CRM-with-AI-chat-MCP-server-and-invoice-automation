import { ParsedInvoice } from '../models';

const fs = require('fs');
const pdfParse = require('pdf-parse');

// Regex patterns for extracting data from Polish invoices
const patterns = {
  numerFaktury: [
    /(?:nr\s*[:\s]*)([A-Z]+\s*\/\s*\d+\s*\/\s*\d+\s*\/\s*\d{4})/i,
    /(?:numer\s+(?:faktury\s+)?|nr)[:\s]+([A-Z0-9\/\-\.]+)/i,
    /faktura\s+(?:VAT\s+)?nr[:\s]*([A-Z0-9\/\-\.]+)/i,
    /(?:Faktura|FAKTURA)\s+(?:nr\.?\s*)?([A-Z]+\/[\d\/]+)/i,
    /nr\s+([A-Z]+\/\d+[\/\d]+)/i,
    /document\s+number[:\s]*([A-Z0-9\/\-\.]+)/i,
    /invoice\s+number[:\s]*([A-Z0-9\/\-\.]+)/i
  ],

  dataWystawienia: [
    /data\s+wystawienia[:\s]*(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /wystawiono[:\s]*(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /date\s+of\s+issue[:\s]*(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2})/i,
    /issue\s+date[:\s]*(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2})/i,
    /date\s+issued[:\s]*(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2})/i
  ],

  dataSprzedazy: [
    /data\s+dostawy\s*\/\s*wykonania\s+us[łl]ugi[:\s]*(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /data\s+dostawy[:\s]*(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /data\s+sprzeda[żz]y[:\s]*(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /data\s+wykonania[:\s]*(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /date\s+delivered(?:\/rendered)?[:\s]*(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2})/i,
    /date\s+of\s+supply[:\s]*(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2})/i,
    /service\s+date[:\s]*(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2})/i
  ],

  terminPlatnosci: [
    /termin\s+p[łl]atno[sś]ci[:\s]*(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /p[łl]atno[sś][cć]\s+do[:\s]*(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /Termin(\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/i,
    /due\s+date[:\s]*(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2})/i,
    /payment\s+due[:\s]*(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2})/i
  ],

  formaPlatnosci: [
    /forma\s+p[łl]atno[sś]ci[:\s]*(przelew|got[óo]wka)/i,
    /p[łl]atno[sś][cć][:\s]*(przelew|got[óo]wka)/i
  ],

  nip: [
    /NIP[:\s]*(PL\s*)?(\d{10})/i,
    /NIP[:\s]*(\d{3}[\-\s]?\d{3}[\-\s]?\d{2}[\-\s]?\d{2})/i,
    /NIP\s*[:\s]*PL(\d{10})/i
  ],

  razemNetto: [
    /razem[:\s]*([\d\s]+[,.]\d{2})/i,
    /Razem:([\d\s]+[,.]\d{2})/i,
    /warto[sś][cć]\s+netto[:\s]*([\d\s]+[,.]\d{2})/i
  ],

  razemBrutto: [
    /razem\s+do\s+zap[łl]aty[:\s]*([\d\s]+[,.]\d{2})/i,
    /do\s+zap[łl]aty[:\s]*([\d\s]+[,.]\d{2})\s*PLN/i,
    /PLN([\d\s]+[,.]\d{2})Razem\s+do\s+zap/i,
    /kwota\s+do\s+zap[łl]aty[:\s]*([\d\s]+[,.]\d{2})/i
  ],

  zaplacono: [
    /zap[łl]acono[:\s]*([\d\s]+[,.]\d{2})/i,
    /wp[łl]acono[:\s]*([\d\s]+[,.]\d{2})/i
  ],

  pozostaje: [
    /pozosta[łl]o\s+do\s+zap[łl]aty[:\s]*([\d\s]+[,.]\d{2})/i,
    /Pozostaje\s+do\s+zap[łl]aty[:\s]*([\d\s]+[,.]\d{2})/i
  ]
};

function parsePolishDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  dateStr = dateStr.trim().replace(/[\/-]/g, '.');
  
  let match = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    const year = parseInt(match[3]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day);
    }
  }

  match = dateStr.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (match) {
    const year = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    const day = parseInt(match[3]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day);
    }
  }

  return null;
}

const INLINE_DATE_PATTERN = /(\d{4}[\.\-]\d{1,2}[\.\-]\d{1,2}|\d{1,2}[\.\-]\d{1,2}[\.\-]\d{4})/;

function extractDateNearLabel(text: string, labelPattern: RegExp): string | null {
  const matches = text.matchAll(labelPattern);
  for (const match of matches) {
    const startIndex = typeof match.index === 'number' ? match.index + match[0].length : -1;
    if (startIndex < 0) continue;

    const snippet = text.slice(startIndex, startIndex + 220);
    const dateMatch = snippet.match(INLINE_DATE_PATTERN);
    if (dateMatch && dateMatch[1]) {
      return dateMatch[1];
    }
  }

  return null;
}

function extractIssueDate(text: string): string | null {
  return (
    extractDateNearLabel(text, /data\s+wystawienia\s*:?/gi) ||
    extractDateNearLabel(text, /wystawiono\s*:?/gi) ||
    extractDateNearLabel(text, /date\s+of\s+issue\s*:?/gi) ||
    extractDateNearLabel(text, /issue\s+date\s*:?/gi) ||
    extractDateNearLabel(text, /date\s+issued\s*:?/gi) ||
    extractWithPatterns(text, patterns.dataWystawienia)
  );
}

function extractSaleDate(text: string): string | null {
  return (
    extractDateNearLabel(text, /data\s+dostawy\s*\/\s*wykonania\s+us[łl]ugi\s*:?/gi) ||
    extractDateNearLabel(text, /data\s+dostawy\s*:?/gi) ||
    extractDateNearLabel(text, /data\s+sprzeda[żz]y\s*:?/gi) ||
    extractDateNearLabel(text, /data\s+wykonania\s*:?/gi) ||
    extractDateNearLabel(text, /date\s+delivered(?:\/rendered)?\s*:?/gi) ||
    extractDateNearLabel(text, /date\s+of\s+supply\s*:?/gi) ||
    extractDateNearLabel(text, /service\s+date\s*:?/gi) ||
    extractWithPatterns(text, patterns.dataSprzedazy)
  );
}

function extractDueDate(text: string): string | null {
  return (
    extractDateNearLabel(text, /termin\s+p[łl]atno[sś]ci\s*:?/gi) ||
    extractDateNearLabel(text, /\btermin\b\s*:?/gi) ||
    extractDateNearLabel(text, /due\s+date\s*:?/gi) ||
    extractDateNearLabel(text, /payment\s+due\s*:?/gi) ||
    extractWithPatterns(text, patterns.terminPlatnosci)
  );
}

function extractWithPatterns(text: string, patternList: RegExp[]): string | null {
  for (const pattern of patternList) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function parsePolishNumber(numStr: string): number {
  if (!numStr) return 0;
  const cleaned = numStr.replace(/\s/g, '').replace(',', '.');
  const result = parseFloat(cleaned);
  return isNaN(result) ? 0 : result;
}

function cleanExtractedLine(line: string): string {
  const compact = line.replace(/\s+/g, ' ').trim();
  if (!compact) return '';

  if (compact.length % 2 === 0) {
    const half = compact.length / 2;
    const left = compact.slice(0, half).trim();
    const right = compact.slice(half).trim();
    if (left && left === right) {
      return left;
    }
  }

  return compact;
}

function normalizeNipCandidate(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) {
    return null;
  }
  return digits.slice(0, 10);
}

function extractNip(line: string): string | null {
  if (!/NIP/i.test(line)) {
    return null;
  }

  const match = line.match(/NIP[^\dA-Za-z]*(?:PL\s*)?([\d\s\-]{10,30})/i);
  if (match && match[1]) {
    return normalizeNipCandidate(match[1]);
  }

  const fallback = line.slice(line.toUpperCase().indexOf('NIP'));
  return normalizeNipCandidate(fallback);
}

function extractNipsFromText(text: string): string[] {
  const normalizedText = text.replace(/\s+/g, ' ');
  const matches = normalizedText.matchAll(/NIP[^\dA-Za-z]*(?:PL\s*)?([\d\s\-]{10,30})/gi);
  const uniqueNips = new Set<string>();

  for (const match of matches) {
    const candidate = match[1] || '';
    const nip = normalizeNipCandidate(candidate);
    if (nip) {
      uniqueNips.add(nip);
    }
  }

  return Array.from(uniqueNips);
}

function isStreetLine(line: string): boolean {
  return /^(ul\.?|al\.?|aleja|os\.?|plac\s)/i.test(line);
}

function isPostCodeLine(line: string): boolean {
  return /^\d{2}-\d{3}\b/.test(line);
}

function isCustomerNoiseLine(line: string): boolean {
  return /^(Nabywca|Odbiorca|Sprzedawca|Bank|Strona|Data\s+wystawienia|Data\s+dostawy|Nazwa\s+towaru|Forma\s+p[łl]atno[sś]ci)/i.test(line) ||
    /nr\s+rachunku/i.test(line);
}

function extractCustomerFromNabywcaSection(text: string): {
  nazwa: string;
  nip: string | null;
  ulica: string;
  kodPocztowy: string;
  miasto: string;
} | null {
  const lines = text
    .split(/\n/)
    .map(cleanExtractedLine)
    .filter((line) => line.length > 0);

  const nabywcaIndex = lines.findIndex((line) => /Nabywca/i.test(line));
  if (nabywcaIndex < 0) {
    return null;
  }

  const sectionLines: string[] = [];
  for (let i = nabywcaIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(Nazwa\s+towaru|Forma\s+p[łl]atno[sś]ci|Stawka|Razem|Podpis|Data\s+odbioru)/i.test(line)) {
      break;
    }
    sectionLines.push(line);
    if (sectionLines.length >= 20) {
      break;
    }
  }

  if (sectionLines.length === 0) {
    return null;
  }

  let nazwa = '';
  let nip: string | null = null;
  let ulica = '';
  let kodPocztowy = '';
  let miasto = '';
  const nameLines: string[] = [];
  let collectingName = false;

  for (const rawLine of sectionLines) {
    const line = cleanExtractedLine(rawLine);
    if (!line) continue;

    if (!nip) {
      nip = extractNip(line);
    }

    if (isStreetLine(line)) {
      ulica = line;
      if (collectingName && nameLines.length > 0) {
        collectingName = false;
      }
      continue;
    }

    if (isPostCodeLine(line)) {
      const match = line.match(/(\d{2}-\d{3})\s+(.+)/);
      if (match) {
        kodPocztowy = match[1];
        miasto = match[2].trim();
      }
      if (collectingName && nameLines.length > 0) {
        collectingName = false;
      }
      continue;
    }

    if (/^NIP/i.test(line) || isCustomerNoiseLine(line)) {
      if (collectingName && nameLines.length > 0) {
        collectingName = false;
      }
      continue;
    }

    if (!collectingName && nameLines.length === 0) {
      collectingName = true;
      nameLines.push(line);
      continue;
    }

    if (collectingName) {
      nameLines.push(line);
      continue;
    }
  }

  if (nameLines.length > 0) {
    nazwa = nameLines.join(' ').replace(/\s+/g, ' ').trim();
  }

  if (!nazwa) {
    return null;
  }

  return {
    nazwa,
    nip,
    ulica,
    kodPocztowy,
    miasto
  };
}

function extractCustomer(text: string): { nazwa: string; nip: string | null; ulica: string; kodPocztowy: string; miasto: string } | null {
  console.log('=== Extracting customer ===');

  const nips = extractNipsFromText(text);
  console.log('Found NIPs:', nips);

  const nabywcaSectionCustomer = extractCustomerFromNabywcaSection(text);
  if (nabywcaSectionCustomer) {
    if (!nabywcaSectionCustomer.nip && nips.length > 1) {
      nabywcaSectionCustomer.nip = nips[1];
    }
    console.log('Customer extracted from Nabywca section:', nabywcaSectionCustomer);
    return nabywcaSectionCustomer;
  }
  
  // For Comarch invoices, the customer (Nabywca) info appears with NIP
  // Find all NIPs in the document - typically the second one is the customer
  // The customer NIP is usually the second one (first is seller)
  const customerNip = nips.length > 1 ? nips[1] : nips[0];
  
  // Find the company name before this NIP
  let nazwa = 'Nieznany kontrahent';
  let ulica = '';
  let kodPocztowy = '';
  let miasto = '';
  
  if (customerNip) {
    // Look for section containing this NIP
    const nipIndex = text.indexOf(`NIP: ${customerNip}`) >= 0
      ? text.indexOf(`NIP: ${customerNip}`)
      : text.indexOf(`NIP:${customerNip}`);
    if (nipIndex > 0) {
      // Get text before the NIP (about 500 chars should be enough)
      const beforeNip = text.substring(Math.max(0, nipIndex - 500), nipIndex);
      const lines = beforeNip
        .split(/\n/)
        .map(cleanExtractedLine)
        .filter(l => l.length > 2);
      
      // Work backwards to find company name
      // Skip address lines and find the company name
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        // Skip lines that look like addresses or headers
        if (line.match(/^\d{2}-\d{3}/) || 
            isStreetLine(line) ||
            line.match(/^(Nabywca|Odbiorca|Bank|Sprzedawca)/i) ||
            line.match(/rachunku/i)) {
          
          // Extract address if found
          if (isStreetLine(line)) {
            ulica = line;
          }
          if (line.match(/^\d{2}-\d{3}/)) {
            const match = line.match(/(\d{2}-\d{3})\s+(.+)/);
            if (match) {
              kodPocztowy = match[1];
              miasto = match[2].trim();
            }
          }
          continue;
        }
        
        // This might be the company name
        if (line.length > 5 && !line.match(/^NIP/i)) {
          nazwa = line;
          // Check if previous line is also part of the name (multi-line company names)
          if (i > 0 && lines[i-1].length > 5 && 
              !lines[i-1].match(/^(Nabywca|Odbiorca|Bank|Sprzedawca|ul\.|NIP|\d{2}-\d{3})/i)) {
            nazwa = lines[i-1] + ' ' + nazwa;
          }
          break;
        }
      }
    }
  }
  
  // Clean up the company name
  nazwa = nazwa
    .replace(/Nabywca:?/gi, '')
    .replace(/Odbiorca:?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  console.log('Extracted customer:', { nazwa, nip: customerNip, ulica, kodPocztowy, miasto });
  
  return {
    nazwa: nazwa || 'Nieznany kontrahent',
    nip: customerNip || null,
    ulica,
    kodPocztowy,
    miasto
  };
}

/**
 * Extract line items from Comarch ERP invoices
 * Format example:
 * szt1    14,63    23 %    1         przesyłka pobraniowa        14,63
 * szt2    684,37   8 %     4         Laski wanilii Gourmet 250 g - całe    171,09
 */
function extractItems(text: string): Array<{
  lp: number;
  nazwa: string;
  ilosc: number;
  jednostka: string;
  stawkaVat: number;
  cenaNetto: number;
  wartoscNetto: number;
}> {
  const items: Array<{
    lp: number;
    nazwa: string;
    ilosc: number;
    jednostka: string;
    stawkaVat: number;
    cenaNetto: number;
    wartoscNetto: number;
  }> = [];

  console.log('=== Extracting items from text ===');
  
  // Comarch format: the items are between "Nazwa towaru/usługi" and "Forma płatności"
  const itemSectionMatch = text.match(/Nazwa\s+towaru\/us[łl]ugi([^]*?)(?:Forma\s+p[łl]atno|Stawka\s*Netto)/is);
  
  if (!itemSectionMatch) {
    console.log('Could not find item section');
    return [];
  }
  
  const itemSection = itemSectionMatch[1];
  console.log('Item section found:', itemSection.substring(0, 500));
  
  // Pattern for Comarch items:
  // "szt" + number (LP) + price + VAT% + quantity + product name + unit price
  // Example: "szt1    14,63    23 %    1         przesyłka pobraniowa        14,63"
  // Or: "szt2    684,37   8 %     4         Laski wanilii Gourmet 250 g - całe    171,09"
  
  // Try to match the pattern: unit+LP, total value, VAT%, quantity, name, unit price
  const itemPattern = /(szt|kg|l|mb|m|opak|kpl)(\d+)\s+([\d\s,\.]+)\s+(\d+)\s*%\s+(\d+(?:[,\.]\d+)?)\s+(.+?)\s+([\d\s,\.]+)$/gim;
  
  let match;
  while ((match = itemPattern.exec(itemSection)) !== null) {
    const jednostka = match[1];
    const lp = parseInt(match[2]);
    const wartoscNetto = parsePolishNumber(match[3]);
    const stawkaVat = parseInt(match[4]);
    const ilosc = parsePolishNumber(match[5]);
    const nazwa = match[6].trim();
    const cenaNetto = parsePolishNumber(match[7]);
    
    console.log(`Found item ${lp}: ${nazwa}, qty: ${ilosc}, price: ${cenaNetto}, total: ${wartoscNetto}`);
    
    items.push({
      lp,
      nazwa,
      ilosc,
      jednostka,
      stawkaVat,
      cenaNetto,
      wartoscNetto
    });
  }
  
  // If no items found with first pattern, try alternative approach
  if (items.length === 0) {
    console.log('Trying alternative item extraction...');
    
    // Split by lines and look for patterns
    const lines = text.split(/\n/).map(l => l.trim()).filter(l => l);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Look for lines starting with "szt" followed by a number
      const sztMatch = line.match(/^(szt|kg|l|mb|m|opak)(\d+)/i);
      if (sztMatch) {
        const lp = parseInt(sztMatch[2]);
        const jednostka = sztMatch[1].toLowerCase();
        
        // Extract numbers from the line
        const numbers = line.match(/[\d]+[,\.][\d]{2}/g) || [];
        const parsedNumbers = numbers.map(n => parsePolishNumber(n));
        
        // VAT percentage
        const vatMatch = line.match(/(\d+)\s*%/);
        const stawkaVat = vatMatch ? parseInt(vatMatch[1]) : 23;
        
        // Quantity (usually a whole number after VAT %)
        const qtyMatch = line.match(/(\d+)\s*%\s+(\d+)/);
        const ilosc = qtyMatch ? parseInt(qtyMatch[2]) : 1;
        
        // Product name - text between quantity and last number
        let nazwa = line
          .replace(/^(szt|kg|l|mb|m|opak)\d+\s*/i, '')
          .replace(/[\d]+[,\.][\d]{2}/g, '')
          .replace(/\d+\s*%/g, '')
          .replace(/^\d+\s+/, '')
          .trim();
        
        // If name is too short, check next line
        if (nazwa.length < 3 && i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (!nextLine.match(/^(szt|kg|Forma|Stawka|Razem)/i)) {
            nazwa = nextLine.trim();
          }
        }
        
        // wartoscNetto is usually the first number (total), cenaNetto is usually the last
        const wartoscNetto = parsedNumbers[0] || 0;
        const cenaNetto = parsedNumbers.length > 1 ? parsedNumbers[parsedNumbers.length - 1] : wartoscNetto;
        
        if (nazwa.length >= 3) {
          console.log(`Alt found item ${lp}: ${nazwa}, qty: ${ilosc}, total: ${wartoscNetto}`);
          items.push({
            lp,
            nazwa,
            ilosc,
            jednostka,
            stawkaVat,
            cenaNetto,
            wartoscNetto
          });
        }
      }
    }
  }
  
  // Third attempt - more aggressive pattern matching
  if (items.length === 0) {
    console.log('Trying third extraction method...');
    
    // Look for any line with product-like content between the headers and summary
    const productLines = itemSection.split(/\n/).filter(line => {
      const trimmed = line.trim();
      // Skip empty lines and headers
      if (trimmed.length < 5) return false;
      if (trimmed.match(/^(Nazwa|Wartość|Cena|VAT|J\.m\.|Ilość|Kod|L\.?p)/i)) return false;
      // Must contain at least one number with decimals (price)
      if (!trimmed.match(/\d+[,\.]\d{2}/)) return false;
      return true;
    });
    
    let lpCounter = 1;
    for (const line of productLines) {
      // Extract all prices from line
      const prices = (line.match(/[\d\s]+[,\.]\d{2}/g) || []).map(p => parsePolishNumber(p));
      if (prices.length === 0) continue;
      
      // VAT percentage
      const vatMatch = line.match(/(\d+)\s*%/);
      const stawkaVat = vatMatch ? parseInt(vatMatch[1]) : 23;
      
      // Try to find quantity
      const qtyMatch = line.match(/(\d+)\s*%\s+(\d+)/);
      const ilosc = qtyMatch ? parseFloat(qtyMatch[2]) : 1;
      
      // Product name - remove numbers and common prefixes
      let nazwa = line
        .replace(/[\d\s]+[,\.]\d{2}/g, ' ')
        .replace(/\d+\s*%/g, ' ')
        .replace(/^(szt|kg|l|mb|m|opak)\d*\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Skip if name is too short or looks like a header
      if (nazwa.length < 3 || nazwa.match(/^(Razem|Suma|Netto|Brutto|VAT)/i)) continue;
      
      const wartoscNetto = prices[0];
      const cenaNetto = prices.length > 1 ? prices[prices.length - 1] : wartoscNetto / ilosc;
      
      console.log(`Third method item ${lpCounter}: ${nazwa}, total: ${wartoscNetto}`);
      
      items.push({
        lp: lpCounter++,
        nazwa,
        ilosc,
        jednostka: 'szt',
        stawkaVat,
        cenaNetto,
        wartoscNetto
      });
    }
  }
  
  console.log(`Total items extracted: ${items.length}`);
  return items;
}

export async function parseInvoicePDF(buffer: Buffer): Promise<ParsedInvoice> {
  try {
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text;

    console.log('PDF parsed successfully');
    console.log('Pages:', pdfData.numpages);
    console.log('Text length:', text.length);

    if (!text || text.length < 50) {
      throw new Error('PDF contains no extractable text - it might be a scanned image');
    }

    console.log('=== Full PDF text ===');
    console.log(text);
    console.log('=== End PDF text ===');

    // Extract invoice number
    let numerFaktury: string = extractWithPatterns(text, patterns.numerFaktury) || '';
    if (!numerFaktury) {
      const fallbackMatch = text.match(/([A-Z]{2,}\/\d+\/\d+\/\d{4})/);
      numerFaktury = fallbackMatch ? fallbackMatch[1] : '';
    }
    if (!numerFaktury) {
      throw new Error('Invoice number could not be extracted from PDF');
    }
    // Clean up invoice number
    numerFaktury = numerFaktury.replace(/\s+/g, '').toUpperCase();

    // Extract dates
    const dataWystawieniaStr = extractIssueDate(text);
    const dataSprzedazyStr = extractSaleDate(text) || dataWystawieniaStr;
    const terminPlatnosciStr = extractDueDate(text);

    const dataWystawienia = parsePolishDate(dataWystawieniaStr || '');
    if (!dataWystawienia) {
      throw new Error('Invoice issue date could not be extracted from PDF');
    }

    const dataSprzedazy = parsePolishDate(dataSprzedazyStr || '') || dataWystawienia;
    const terminPlatnosci = parsePolishDate(terminPlatnosciStr || '') || dataWystawienia;

    // Extract payment form
    const formaPlatnosciMatch = extractWithPatterns(text, patterns.formaPlatnosci);
    const formaPlatnosci = formaPlatnosciMatch ? formaPlatnosciMatch.toLowerCase() : 'przelew';

    // Extract customer
    const nabywca = extractCustomer(text) || {
      nazwa: 'Nieznany kontrahent',
      nip: null,
      ulica: '',
      kodPocztowy: '',
      miasto: ''
    };

    // Extract items
    const pozycje = extractItems(text);

    // Extract summary totals
    const bruttoStr = extractWithPatterns(text, patterns.razemBrutto);
    const nettoStr = extractWithPatterns(text, patterns.razemNetto);
    const zaplaconoStr = extractWithPatterns(text, patterns.zaplacono);
    const pozostajeStr = extractWithPatterns(text, patterns.pozostaje);

    const brutto = parsePolishNumber(bruttoStr || '0');
    const netto = parsePolishNumber(nettoStr || '0') || (brutto / 1.23); // Default 23% VAT
    const vat = brutto - netto;

    console.log('Parsed totals:', { netto, vat, brutto });

    const podsumowanie = {
      netto,
      vat,
      brutto,
      zaplacono: parsePolishNumber(zaplaconoStr || '0'),
      pozostaje: parsePolishNumber(pozostajeStr || bruttoStr || '0')
    };

    // If no items found, create a default one
    const finalItems = pozycje.length > 0 ? pozycje : [{
      lp: 1,
      nazwa: 'Pozycja na fakturze',
      ilosc: 1,
      jednostka: 'szt',
      stawkaVat: 23,
      cenaNetto: netto,
      wartoscNetto: netto
    }];

    const result: ParsedInvoice = {
      numerFaktury,
      dataWystawienia,
      dataSprzedazy,
      terminPlatnosci,
      formaPlatnosci,
      nabywca,
      pozycje: finalItems,
      podsumowanie
    };

    console.log('Parsed invoice:', {
      numerFaktury: result.numerFaktury,
      customer: result.nabywca.nazwa,
      customerNip: result.nabywca.nip,
      items: result.pozycje.length,
      itemNames: result.pozycje.map(p => p.nazwa),
      total: result.podsumowanie.brutto
    });

    return result;
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw new Error('Failed to parse PDF: ' + (error as Error).message);
  }
}
