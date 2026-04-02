import fs from 'fs';
import path from 'path';
import {
  INVOICE_PDF_DIR,
  ensureStorageDirs,
  formatInvoicePdfFileName,
  toStoredPath,
} from './fileStorage';

const PDFDocument = require('pdfkit');

const LOGO_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'logo', 'logo-200x200.jpg'),
];

const FONT_REGULAR_CANDIDATES = [
  '/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
];

const FONT_BOLD_CANDIDATES = [
  '/usr/share/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
];

function resolveFirstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const LOGO_PATH = resolveFirstExistingPath(LOGO_CANDIDATES);
const FONT_REGULAR_PATH = resolveFirstExistingPath(FONT_REGULAR_CANDIDATES);
const FONT_BOLD_PATH = resolveFirstExistingPath(FONT_BOLD_CANDIDATES);

const SELLER_LINES = [
  'NATURAL MYSTIC AROMA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  'ul. Pamiątkowa 2/56',
  '61-512 Poznań',
  'NIP: PL 7831881805',
];

const BANK_ACCOUNT = '28 1020 4027 0000 1202 1856 0681';
const BANK_NAME = 'Powszechna Kasa Oszczędności Bank Polski S.A.';

interface InvoicePdfCustomer {
  nazwa: string;
  nip: string | null;
  ulica: string | null;
  kodPocztowy: string | null;
  miasto: string | null;
}

interface InvoicePdfItem {
  lp: number;
  nazwa: string;
  ilosc: number;
  jednostka: string;
  cenaNetto: number;
  stawkaVat: number;
  wartoscNetto: number;
  wartoscBrutto: number;
}

interface InvoicePdfPayload {
  numerFaktury: string;
  dataWystawienia: string | null;
  dataSprzedazy: string | null;
  terminPlatnosci: string | null;
  formaPlatnosci: string | null;
  waluta: string;
  customer: InvoicePdfCustomer;
  items: InvoicePdfItem[];
  netto: number;
  vat: number;
  brutto: number;
  zaplacono: number;
  uwagi: string | null;
}

interface TableColumn {
  label: string;
  x: number;
  width: number;
  align?: 'left' | 'right' | 'center';
}

const MARGIN = 40;
const PAGE_BOTTOM_LIMIT = 780;
const TABLE_WIDTH = 515;
const TABLE_COLUMNS: TableColumn[] = [
  { label: 'Lp.', x: 46, width: 24 },
  { label: 'Nazwa towaru/usługi', x: 74, width: 208 },
  { label: 'Ilość', x: 286, width: 64, align: 'right' },
  { label: 'Cena netto', x: 354, width: 74, align: 'right' },
  { label: 'VAT', x: 432, width: 36, align: 'right' },
  { label: 'Netto', x: 472, width: 40, align: 'right' },
  { label: 'Brutto', x: 516, width: 38, align: 'right' },
];

function formatMoney(value: number, currency = 'PLN'): string {
  return `${Number(value || 0).toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function formatDateForPdf(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pl-PL');
}

function formatQty(value: number): string {
  return Number(value || 0).toLocaleString('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function isBankTransferPayment(formaPlatnosci: string | null): boolean {
  const normalized = String(formaPlatnosci || '').toLowerCase();
  return normalized.includes('przelew') || normalized.includes('transfer') || normalized.includes('bank');
}

function isCodPayment(formaPlatnosci: string | null): boolean {
  const normalized = String(formaPlatnosci || '').toLowerCase();
  return normalized.includes('pobranie') || normalized.includes('cod');
}

function createPdfWritePromise(doc: any, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);
  });
}

function getFontNames(doc: any): { regular: string; bold: string } {
  if (FONT_REGULAR_PATH && FONT_BOLD_PATH) {
    doc.registerFont('InvoiceRegular', FONT_REGULAR_PATH);
    doc.registerFont('InvoiceBold', FONT_BOLD_PATH);
    return { regular: 'InvoiceRegular', bold: 'InvoiceBold' };
  }

  return { regular: 'Helvetica', bold: 'Helvetica-Bold' };
}

function drawWrappedLines(
  doc: any,
  lines: string[],
  x: number,
  y: number,
  width: number,
  lineGap = 2
): number {
  let cursorY = y;
  for (const line of lines) {
    const content = String(line || '-').trim() || '-';
    doc.text(content, x, cursorY, { width, lineGap });
    cursorY = doc.y + 1;
  }
  return cursorY;
}

function estimateWrappedLinesHeight(doc: any, lines: string[], width: number): number {
  let height = 0;
  for (const line of lines) {
    const content = String(line || '-').trim() || '-';
    height += doc.heightOfString(content, { width, lineGap: 2 }) + 1;
  }
  return height;
}

function drawTableHeader(doc: any, y: number, boldFont: string): void {
  doc.save();
  doc.rect(MARGIN, y, TABLE_WIDTH, 24).fill('#EFEFEF');
  doc.restore();

  doc.font(boldFont).fontSize(9.5).fillColor('#111111');
  for (const column of TABLE_COLUMNS) {
    doc.text(column.label, column.x, y + 7, {
      width: column.width,
      align: column.align || 'left',
    });
  }
}

function ensureTableRowSpace(doc: any, y: number, rowHeight: number, boldFont: string): number {
  if (y + rowHeight <= 730) {
    return y;
  }

  doc.addPage();
  const nextY = 44;
  drawTableHeader(doc, nextY, boldFont);
  return nextY + 28;
}

function getPaymentInfoLines(paymentMethod: string | null): string[] {
  if (isBankTransferPayment(paymentMethod)) {
    return [
      `Forma płatności: ${paymentMethod || 'przelew'}`,
      `Bank: ${BANK_NAME}`,
      `Numer rachunku: ${BANK_ACCOUNT}`,
    ];
  }

  if (isCodPayment(paymentMethod)) {
    return ['Forma płatności: pobranie (COD).'];
  }

  const normalized = String(paymentMethod || '').toLowerCase();
  if (normalized.includes('gotow')) {
    return ['Forma płatności: gotówka.'];
  }

  if (normalized.includes('karta') || normalized.includes('card')) {
    return ['Forma płatności: karta płatnicza.'];
  }

  return [`Forma płatności: ${paymentMethod || '-'}`];
}

export async function generateInvoicePdf(payload: InvoicePdfPayload): Promise<string> {
  ensureStorageDirs();

  const fileName = formatInvoicePdfFileName(payload.numerFaktury || 'invoice');
  const absoluteFilePath = path.join(INVOICE_PDF_DIR, fileName);

  if (fs.existsSync(absoluteFilePath)) {
    fs.unlinkSync(absoluteFilePath);
  }

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, compress: true });
  const done = createPdfWritePromise(doc, absoluteFilePath);
  const fonts = getFontNames(doc);

  try {
    doc.fillColor('#111111');

    const logoSize = 96;
    const logoX = MARGIN;
    const logoY = 36;
    if (LOGO_PATH) {
      doc.image(LOGO_PATH, logoX, logoY, { fit: [logoSize, logoSize] });
    }

    const titleX = LOGO_PATH ? logoX + logoSize + 16 : MARGIN;
    doc.font(fonts.bold).fontSize(24).fillColor('#111111').text('FAKTURA VAT', titleX, 46, { width: 220 });
    doc.font(fonts.regular).fontSize(11).fillColor('#111111').text(`Nr ${payload.numerFaktury}`, titleX, 78);

    const detailsBoxX = 356;
    const detailsBoxY = 40;
    const detailsBoxWidth = 199;
    const detailsBoxHeight = 102;
    doc.lineWidth(1).strokeColor('#111111').rect(detailsBoxX, detailsBoxY, detailsBoxWidth, detailsBoxHeight).stroke();

    doc.font(fonts.bold).fontSize(9.5).fillColor('#111111');
    doc.text('Data wystawienia', detailsBoxX + 10, detailsBoxY + 10, { width: 88 });
    doc.text('Data sprzedaży', detailsBoxX + 10, detailsBoxY + 38, { width: 88 });
    doc.text('Termin płatności', detailsBoxX + 10, detailsBoxY + 66, { width: 88 });

    doc.font(fonts.regular).fontSize(10.5).fillColor('#111111');
    doc.text(formatDateForPdf(payload.dataWystawienia), detailsBoxX + 104, detailsBoxY + 10, { width: 84, align: 'right' });
    doc.text(formatDateForPdf(payload.dataSprzedazy), detailsBoxX + 104, detailsBoxY + 38, { width: 84, align: 'right' });
    doc.text(formatDateForPdf(payload.terminPlatnosci), detailsBoxX + 104, detailsBoxY + 66, { width: 84, align: 'right' });

    const cardY = 160;
    const cardGap = 14;
    const cardWidth = (TABLE_WIDTH - cardGap) / 2;
    const sellerX = MARGIN;
    const buyerX = MARGIN + cardWidth + cardGap;

    const buyerLines = [
      payload.customer.nazwa || '-',
      payload.customer.ulica || '-',
      [payload.customer.kodPocztowy || '', payload.customer.miasto || ''].filter(Boolean).join(' ') || '-',
      payload.customer.nip ? `NIP: ${payload.customer.nip}` : 'NIP: -',
    ];

    doc.font(fonts.regular).fontSize(12);
    const sellerContentHeight = estimateWrappedLinesHeight(doc, SELLER_LINES, cardWidth - 24);
    const buyerContentHeight = estimateWrappedLinesHeight(doc, buyerLines, cardWidth - 24);
    const cardHeight = Math.max(116, Math.ceil(Math.max(sellerContentHeight, buyerContentHeight)) + 34);

    doc.strokeColor('#111111').lineWidth(1);
    doc.rect(sellerX, cardY, cardWidth, cardHeight).stroke();
    doc.rect(buyerX, cardY, cardWidth, cardHeight).stroke();

    doc.font(fonts.bold).fontSize(10).fillColor('#111111');
    doc.text('SPRZEDAWCA', sellerX + 12, cardY + 10);
    doc.text('NABYWCA', buyerX + 12, cardY + 10);

    doc.font(fonts.regular).fontSize(11).fillColor('#111111');
    drawWrappedLines(doc, SELLER_LINES, sellerX + 12, cardY + 28, cardWidth - 24);
    drawWrappedLines(doc, buyerLines, buyerX + 12, cardY + 28, cardWidth - 24);

    const infoY = cardY + cardHeight + 12;
    doc.font(fonts.regular).fontSize(10).fillColor('#111111');
    doc.text(`Forma płatności: ${payload.formaPlatnosci || '-'}`, MARGIN, infoY, { width: 270 });
    doc.text(`Waluta: ${payload.waluta || 'PLN'}`, 420, infoY, { width: 135, align: 'right' });

    let tableY = infoY + 20;
    drawTableHeader(doc, tableY, fonts.bold);
    tableY += 28;

    doc.font(fonts.regular).fontSize(10).fillColor('#111111');
    payload.items.forEach((item, index) => {
      const itemName = item.nazwa || '-';
      const qtyText = `${formatQty(item.ilosc)} ${item.jednostka || ''}`.trim();
      const nameHeight = doc.heightOfString(itemName, { width: TABLE_COLUMNS[1].width, lineGap: 1 });
      const qtyHeight = doc.heightOfString(qtyText, { width: TABLE_COLUMNS[2].width, align: 'right' });
      const rowHeight = Math.max(24, Math.ceil(Math.max(nameHeight, qtyHeight)) + 8);
      tableY = ensureTableRowSpace(doc, tableY, rowHeight, fonts.bold);

      if (index % 2 === 0) {
        doc.save();
        doc.rect(MARGIN, tableY - 1, TABLE_WIDTH, rowHeight + 1).fill('#F8F8F8');
        doc.restore();
      }

      doc.font(fonts.regular).fontSize(10).fillColor('#111111');
      doc.text(String(item.lp), TABLE_COLUMNS[0].x, tableY + 4, { width: TABLE_COLUMNS[0].width });
      doc.text(itemName, TABLE_COLUMNS[1].x, tableY + 4, { width: TABLE_COLUMNS[1].width, lineGap: 1 });
      doc.text(qtyText, TABLE_COLUMNS[2].x, tableY + 4, { width: TABLE_COLUMNS[2].width, align: 'right' });
      doc.text(Number(item.cenaNetto || 0).toFixed(2), TABLE_COLUMNS[3].x, tableY + 4, {
        width: TABLE_COLUMNS[3].width,
        align: 'right',
      });
      doc.text(`${Number(item.stawkaVat || 0).toFixed(0)}%`, TABLE_COLUMNS[4].x, tableY + 4, {
        width: TABLE_COLUMNS[4].width,
        align: 'right',
      });
      doc.text(Number(item.wartoscNetto || 0).toFixed(2), TABLE_COLUMNS[5].x, tableY + 4, {
        width: TABLE_COLUMNS[5].width,
        align: 'right',
      });
      doc.text(Number(item.wartoscBrutto || 0).toFixed(2), TABLE_COLUMNS[6].x, tableY + 4, {
        width: TABLE_COLUMNS[6].width,
        align: 'right',
      });

      doc.strokeColor('#D0D0D0').moveTo(MARGIN, tableY + rowHeight).lineTo(MARGIN + TABLE_WIDTH, tableY + rowHeight).stroke();
      tableY += rowHeight;
    });

    const totalPaid = Number(payload.zaplacono || 0);
    const totalDue = Math.max(0, Number(payload.brutto || 0) - totalPaid);
    const paymentLines = getPaymentInfoLines(payload.formaPlatnosci);

    const paymentWidth = 305;
    const totalsWidth = 196;
    const sectionGap = TABLE_WIDTH - paymentWidth - totalsWidth;
    const paymentX = MARGIN;
    const totalsX = MARGIN + paymentWidth + sectionGap;

    let sectionY = tableY + 16;
    const notesHeight = payload.uwagi
      ? doc.heightOfString(payload.uwagi, { width: TABLE_WIDTH - 20, lineGap: 2 }) + 28
      : 0;
    const sectionHeight = 128 + notesHeight;

    if (sectionY + sectionHeight > PAGE_BOTTOM_LIMIT) {
      doc.addPage();
      sectionY = 56;
    }

    doc.rect(paymentX, sectionY, paymentWidth, 102).stroke();
    doc.font(fonts.bold).fontSize(10).fillColor('#111111').text('Informacje o płatności', paymentX + 10, sectionY + 10);
    doc.font(fonts.regular).fontSize(10).fillColor('#111111');
    drawWrappedLines(doc, paymentLines, paymentX + 10, sectionY + 28, paymentWidth - 20);

    doc.save();
    doc.rect(totalsX, sectionY, totalsWidth, 102).fill('#F2F2F2');
    doc.restore();
    doc.rect(totalsX, sectionY, totalsWidth, 102).stroke();

    doc.font(fonts.regular).fontSize(10).fillColor('#111111');
    doc.text('Razem netto', totalsX + 10, sectionY + 12, { width: 90 });
    doc.text(formatMoney(payload.netto, payload.waluta), totalsX + 98, sectionY + 12, { width: 88, align: 'right' });
    doc.text('VAT', totalsX + 10, sectionY + 32, { width: 90 });
    doc.text(formatMoney(payload.vat, payload.waluta), totalsX + 98, sectionY + 32, { width: 88, align: 'right' });
    doc.font(fonts.bold).fontSize(10.5);
    doc.text('Brutto', totalsX + 10, sectionY + 52, { width: 90 });
    doc.text(formatMoney(payload.brutto, payload.waluta), totalsX + 98, sectionY + 52, { width: 88, align: 'right' });
    doc.font(fonts.regular).fontSize(10);
    doc.text('Zapłacono', totalsX + 10, sectionY + 72, { width: 90 });
    doc.text(formatMoney(totalPaid, payload.waluta), totalsX + 98, sectionY + 72, { width: 88, align: 'right' });
    doc.font(fonts.bold).fontSize(10.5);
    doc.text('Do zapłaty', totalsX + 10, sectionY + 90, { width: 90 });
    doc.text(formatMoney(totalDue, payload.waluta), totalsX + 98, sectionY + 90, { width: 88, align: 'right' });

    let footerY = sectionY + 116;
    if (payload.uwagi) {
      doc.rect(MARGIN, footerY, TABLE_WIDTH, notesHeight).stroke();
      doc.font(fonts.bold).fontSize(10).fillColor('#111111').text('Uwagi', MARGIN + 10, footerY + 10);
      doc.font(fonts.regular).fontSize(10).fillColor('#111111').text(payload.uwagi, MARGIN + 10, footerY + 26, {
        width: TABLE_WIDTH - 20,
        lineGap: 2,
      });
      footerY += notesHeight + 10;
    }

    doc.strokeColor('#111111').moveTo(MARGIN, footerY).lineTo(MARGIN + TABLE_WIDTH, footerY).stroke();
    doc.font(fonts.regular).fontSize(8.5).fillColor('#111111').text('Dokument wygenerowany automatycznie.', MARGIN, footerY + 8);

    doc.end();
    await done;
  } catch (error) {
    doc.end();
    if (fs.existsSync(absoluteFilePath)) {
      fs.unlinkSync(absoluteFilePath);
    }
    throw error;
  }

  return toStoredPath(absoluteFilePath);
}
