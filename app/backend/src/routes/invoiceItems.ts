import { Router } from 'express';
import { pool } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { calculateItemProfit } from '../services/profitCalculator';
import { recalculateInvoicesFromProductPrices } from '../services/invoiceRecalculation';
import { requireRole } from '../middleware/auth';

const router = Router();

router.use(requireRole('admin', 'manager', 'bookkeeping'));

function parsePurchasePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

async function updateInvoiceItemPurchasePrice(itemId: number, purchasePrice: number): Promise<{ profit: ReturnType<typeof calculateItemProfit>; invoiceId: number }> {
  const [itemRows] = await pool.query<RowDataPacket[]>(
    `SELECT ii.*, p.id as product_id
     FROM invoice_items ii
     LEFT JOIN products p ON ii.product_id = p.id
     WHERE ii.id = ?`,
    [itemId]
  );

  if (itemRows.length === 0) {
    throw new Error('INVOICE_ITEM_NOT_FOUND');
  }

  const item = itemRows[0];
  const profit = calculateItemProfit({
    ilosc: item.ilosc,
    cena_netto: item.cena_netto,
    wartosc_netto: item.wartosc_netto,
    cena_zakupu: purchasePrice,
  });

  await pool.query(
    `UPDATE invoice_items
     SET cena_zakupu = ?, koszt_calkowity = ?, zysk = ?, marza_procent = ?
     WHERE id = ?`,
    [purchasePrice, profit.koszt_calkowity, profit.zysk, profit.marza_procent, itemId]
  );

  if (item.product_id) {
    await pool.query(
      'UPDATE products SET cena_zakupu = ? WHERE id = ?',
      [purchasePrice, item.product_id]
    );
  }

  await recalculateInvoicesFromProductPrices([Number(item.invoice_id)], {
    syncItemPurchasePrices: 'all',
  });

  return {
    profit,
    invoiceId: Number(item.invoice_id),
  };
}

// PUT /api/invoice-items/:id - Update invoice item (mainly purchase price)
router.put('/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const { cena_zakupu } = req.body;

    if (Number.isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid invoice item ID' });
    }

    if (cena_zakupu === undefined || cena_zakupu === null || cena_zakupu === '') {
      return res.status(400).json({ error: 'cena_zakupu is required' });
    }

    const purchasePrice = parsePurchasePrice(cena_zakupu);
    if (purchasePrice === null) {
      return res.status(400).json({ error: 'cena_zakupu must be a valid non-negative number' });
    }

    const { profit } = await updateInvoiceItemPurchasePrice(itemId, purchasePrice);

    res.json({
      message: 'Item and linked product updated successfully',
      profit,
    });
  } catch (error) {
    if ((error as Error).message === 'INVOICE_ITEM_NOT_FOUND') {
      return res.status(404).json({ error: 'Invoice item not found' });
    }

    console.error('Error updating invoice item:', error);
    res.status(500).json({ error: 'Failed to update invoice item' });
  }
});

// POST /api/invoice-items/:id/update-product - Update item and product default price
router.post('/:id/update-product', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const { cena_zakupu } = req.body;

    if (Number.isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid invoice item ID' });
    }

    if (cena_zakupu === undefined || cena_zakupu === null || cena_zakupu === '') {
      return res.status(400).json({ error: 'cena_zakupu is required' });
    }

    const purchasePrice = parsePurchasePrice(cena_zakupu);
    if (purchasePrice === null) {
      return res.status(400).json({ error: 'cena_zakupu must be a valid non-negative number' });
    }

    const { profit } = await updateInvoiceItemPurchasePrice(itemId, purchasePrice);

    res.json({
      message: 'Item and product updated successfully',
      profit,
    });
  } catch (error) {
    if ((error as Error).message === 'INVOICE_ITEM_NOT_FOUND') {
      return res.status(404).json({ error: 'Invoice item not found' });
    }

    console.error('Error updating invoice item and product:', error);
    res.status(500).json({ error: 'Failed to update invoice item and product' });
  }
});

export default router;
