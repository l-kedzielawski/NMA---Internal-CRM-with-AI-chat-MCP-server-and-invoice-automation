import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../config/database';

interface InvoiceBaseRow extends RowDataPacket {
  id: number;
  netto: number | null;
  koszt_logistyki: number | null;
  opiekun_id: number | null;
  waluta: string | null;
  kurs_waluty: number | null;
}

interface InvoiceProfitSumRow extends RowDataPacket {
  invoice_id: number;
  item_profit_sum: number | null;
}

interface OpiekunCommissionRow extends RowDataPacket {
  id: number;
  marza_procent: number | null;
}

interface InvoiceManagerSplitRow extends RowDataPacket {
  id: number;
  invoice_id: number;
  opiekun_id: number;
  commission_percent: number;
}

export interface InvoiceRecalculationSummary {
  invoice_ids: number[];
  invoice_count: number;
  item_prices_backfilled: number;
  items_recalculated: number;
  invoices_recalculated: number;
}

export interface InvoiceRecalculationOptions {
  syncItemPurchasePrices?: 'missing' | 'all';
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

function resolveExchangeRateToPln(currency: string | null, exchangeRate: number | null): number {
  const normalizedCurrency = String(currency || 'PLN').trim().toUpperCase();
  if (normalizedCurrency === 'PLN') {
    return 1;
  }

  const parsedRate = Number(exchangeRate || 0);
  if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
    return 1;
  }

  return parsedRate;
}

function normalizeInvoiceIds(invoiceIds: number[]): number[] {
  return Array.from(
    new Set(
      invoiceIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

export async function recalculateInvoicesFromProductPrices(
  invoiceIds: number[],
  options: InvoiceRecalculationOptions = {}
): Promise<InvoiceRecalculationSummary> {
  const normalizedInvoiceIds = normalizeInvoiceIds(invoiceIds);
  const syncMode = options.syncItemPurchasePrices === 'all' ? 'all' : 'missing';

  if (normalizedInvoiceIds.length === 0) {
    return {
      invoice_ids: [],
      invoice_count: 0,
      item_prices_backfilled: 0,
      items_recalculated: 0,
      invoices_recalculated: 0,
    };
  }

  const purchasePriceSyncQuery = syncMode === 'all'
    ? `UPDATE invoice_items ii
       JOIN products p ON p.id = ii.product_id
       SET ii.cena_zakupu = p.cena_zakupu
       WHERE ii.invoice_id IN (?)
         AND p.cena_zakupu IS NOT NULL
         AND (
           ii.cena_zakupu IS NULL
           OR ABS(ii.cena_zakupu - p.cena_zakupu) > 0.009
         )`
    : `UPDATE invoice_items ii
       JOIN products p ON p.id = ii.product_id
       SET ii.cena_zakupu = p.cena_zakupu
       WHERE ii.invoice_id IN (?)
         AND ii.cena_zakupu IS NULL
         AND p.cena_zakupu IS NOT NULL`;

  const [backfillResult] = await pool.query<ResultSetHeader>(purchasePriceSyncQuery, [normalizedInvoiceIds]);

  const [recalcItemsResult] = await pool.query<ResultSetHeader>(
    `UPDATE invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     SET
       ii.koszt_calkowity = CASE
          WHEN ii.cena_zakupu IS NULL THEN NULL
          ELSE ROUND(ii.ilosc * ii.cena_zakupu, 2)
        END,
       ii.zysk = CASE
          WHEN ii.cena_zakupu IS NULL THEN NULL
          ELSE ROUND((
            (
              ii.wartosc_netto * CASE
                WHEN UPPER(COALESCE(i.waluta, 'PLN')) = 'PLN' THEN 1
                WHEN i.kurs_waluty IS NULL OR i.kurs_waluty <= 0 THEN 1
                ELSE i.kurs_waluty
              END
            ) - (ii.ilosc * ii.cena_zakupu)
          ), 2)
        END,
       ii.marza_procent = CASE
          WHEN ii.cena_zakupu IS NULL THEN NULL
          WHEN ii.wartosc_netto IS NULL OR ii.wartosc_netto = 0 THEN NULL
          ELSE ROUND((
            (
              (
                ii.wartosc_netto * CASE
                  WHEN UPPER(COALESCE(i.waluta, 'PLN')) = 'PLN' THEN 1
                  WHEN i.kurs_waluty IS NULL OR i.kurs_waluty <= 0 THEN 1
                  ELSE i.kurs_waluty
                END
              ) - (ii.ilosc * ii.cena_zakupu)
            ) / (
              ii.wartosc_netto * CASE
                WHEN UPPER(COALESCE(i.waluta, 'PLN')) = 'PLN' THEN 1
                WHEN i.kurs_waluty IS NULL OR i.kurs_waluty <= 0 THEN 1
                ELSE i.kurs_waluty
              END
            )
          ) * 100, 2)
        END
     WHERE ii.invoice_id IN (?)`,
    [normalizedInvoiceIds]
  );

  const [invoiceRows] = await pool.query<InvoiceBaseRow[]>(
    `SELECT id, netto, koszt_logistyki, opiekun_id, waluta, kurs_waluty
     FROM invoices
     WHERE id IN (?)`,
    [normalizedInvoiceIds]
  );

  if (invoiceRows.length === 0) {
    return {
      invoice_ids: normalizedInvoiceIds,
      invoice_count: 0,
      item_prices_backfilled: Number(backfillResult.affectedRows || 0),
      items_recalculated: Number(recalcItemsResult.affectedRows || 0),
      invoices_recalculated: 0,
    };
  }

  const [profitRows] = await pool.query<InvoiceProfitSumRow[]>(
    `SELECT ii.invoice_id, COALESCE(SUM(COALESCE(ii.zysk, 0)), 0) AS item_profit_sum
     FROM invoice_items ii
     WHERE ii.invoice_id IN (?)
     GROUP BY ii.invoice_id`,
    [normalizedInvoiceIds]
  );

  const invoiceProfitById = new Map<number, number>();
  for (const row of profitRows) {
    invoiceProfitById.set(Number(row.invoice_id), Number(row.item_profit_sum || 0));
  }

  const opiekunIds = Array.from(
    new Set(
      invoiceRows
        .map((row) => (row.opiekun_id !== null ? Number(row.opiekun_id) : null))
        .filter((value): value is number => value !== null)
    )
  );

  const opiekunCommissionById = new Map<number, number>();
  if (opiekunIds.length > 0) {
    const [opiekunRows] = await pool.query<OpiekunCommissionRow[]>(
      `SELECT id, marza_procent
       FROM opiekunowie
       WHERE id IN (?)`,
      [opiekunIds]
    );

    for (const row of opiekunRows) {
      opiekunCommissionById.set(Number(row.id), Number(row.marza_procent || 0));
    }
  }

  const [splitRows] = await pool.query<InvoiceManagerSplitRow[]>(
    `SELECT id, invoice_id, opiekun_id, commission_percent
     FROM invoice_manager_splits
     WHERE invoice_id IN (?)
     ORDER BY invoice_id ASC, sort_order ASC, id ASC`,
    [normalizedInvoiceIds]
  );

  const managerSplitsByInvoiceId = new Map<number, InvoiceManagerSplitRow[]>();
  for (const row of splitRows) {
    const invoiceId = Number(row.invoice_id);
    const current = managerSplitsByInvoiceId.get(invoiceId) || [];
    managerSplitsByInvoiceId.set(invoiceId, [...current, row]);
  }

  const opiekunNameById = new Map<number, string>();
  if (opiekunIds.length > 0) {
    const [nameRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, imie, nazwisko
       FROM opiekunowie
       WHERE id IN (?)`,
      [opiekunIds]
    );

    for (const row of nameRows) {
      const firstName = String(row.imie || '').trim();
      const lastName = String(row.nazwisko || '').trim();
      const fullName = `${firstName} ${lastName}`.trim() || firstName;
      opiekunNameById.set(Number(row.id), fullName || firstName || '');
    }
  }

  for (const row of invoiceRows) {
    const invoiceId = Number(row.id);
    const netto = Number(row.netto || 0);
    const exchangeRateToPln = resolveExchangeRateToPln(row.waluta, row.kurs_waluty);
    const nettoInPln = roundMoney(netto * exchangeRateToPln);
    const logisticsCost = Number(row.koszt_logistyki || 0);
    const itemProfit = Number(invoiceProfitById.get(invoiceId) || 0);
    const totalProfit = roundMoney(itemProfit - logisticsCost);
    const marginPercent = nettoInPln > 0
      ? clampMarginPercent(roundMoney((totalProfit / nettoInPln) * 100))
      : null;

    const splitRowsForInvoice = managerSplitsByInvoiceId.get(invoiceId) || [];

    let commission: number | null = null;
    let finalOpiekunId: number | null = row.opiekun_id !== null ? Number(row.opiekun_id) : null;
    let finalOpiekunName: string | null = finalOpiekunId !== null
      ? opiekunNameById.get(finalOpiekunId) || null
      : null;

    if (splitRowsForInvoice.length > 0) {
      const totalPercent = splitRowsForInvoice.reduce(
        (sum, split) => sum + Number(split.commission_percent || 0),
        0
      );
      const targetTotalCommission = roundMoney((totalProfit * totalPercent) / 100);
      let allocated = 0;

      for (let i = 0; i < splitRowsForInvoice.length; i += 1) {
        const split = splitRowsForInvoice[i];
        const percent = Number(split.commission_percent || 0);
        const amount = i === splitRowsForInvoice.length - 1
          ? roundMoney(targetTotalCommission - allocated)
          : roundMoney((totalProfit * percent) / 100);

        allocated += amount;
        await pool.query(
          `UPDATE invoice_manager_splits
           SET commission_amount = ?
           WHERE id = ?`,
          [amount, Number(split.id)]
        );
      }

      const primarySplit = splitRowsForInvoice[0];
      finalOpiekunId = Number(primarySplit.opiekun_id);
      finalOpiekunName = opiekunNameById.get(finalOpiekunId) || null;
      commission = targetTotalCommission;
    } else if (row.opiekun_id !== null) {
      const opiekunId = Number(row.opiekun_id);
      const commissionPercent = Number(opiekunCommissionById.get(opiekunId) || 0);
      commission = roundMoney((totalProfit * commissionPercent) / 100);
    }

    await pool.query(
      `UPDATE invoices
       SET zysk = ?, marza_procent = ?, prowizja_opiekuna = ?, opiekun_id = ?, opiekun = ?
       WHERE id = ?`,
      [totalProfit, marginPercent, commission, finalOpiekunId, finalOpiekunName, invoiceId]
    );
  }

  return {
    invoice_ids: invoiceRows.map((row) => Number(row.id)),
    invoice_count: invoiceRows.length,
    item_prices_backfilled: Number(backfillResult.affectedRows || 0),
    items_recalculated: Number(recalcItemsResult.affectedRows || 0),
    invoices_recalculated: invoiceRows.length,
  };
}

export async function recalculateInvoicesImpactedByProduct(productId: number): Promise<InvoiceRecalculationSummary> {
  const normalizedProductId = Number(productId);
  if (!Number.isInteger(normalizedProductId) || normalizedProductId <= 0) {
    return {
      invoice_ids: [],
      invoice_count: 0,
      item_prices_backfilled: 0,
      items_recalculated: 0,
      invoices_recalculated: 0,
    };
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT invoice_id
     FROM invoice_items
     WHERE product_id = ?`,
    [normalizedProductId]
  );

  const invoiceIds = rows.map((row) => Number(row.invoice_id));
  return recalculateInvoicesFromProductPrices(invoiceIds, {
    syncItemPurchasePrices: 'all',
  });
}
