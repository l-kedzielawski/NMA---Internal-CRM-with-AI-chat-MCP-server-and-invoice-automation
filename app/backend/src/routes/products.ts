import { Router } from 'express';
import { pool } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { requireRole } from '../middleware/auth';
import type { PoolConnection } from 'mysql2/promise';
import { recalculateInvoicesImpactedByProduct } from '../services/invoiceRecalculation';

const router = Router();
const requireCatalogEditor = requireRole('admin', 'manager');

interface ProductTierRow extends RowDataPacket {
  id: number;
  product_id: number;
  quantity: number;
  unit_price_recommended: number;
  unit_purchase_price: number | null;
  commission_percent: number | null;
  currency: string;
  notes: string | null;
}

interface ProductStockAdjustmentRow extends RowDataPacket {
  id: number;
  product_id: number;
  change_type: 'out';
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reason: 'damaged' | 'sample' | 'lost' | 'expired' | 'other';
  notes: string | null;
  created_by_user_id: number | null;
  created_at: Date;
  created_by_username: string | null;
  created_by_full_name: string | null;
}

interface ProductStockAdjustmentMutationRow extends RowDataPacket {
  id: number;
  quantity: number;
  reason: 'damaged' | 'sample' | 'lost' | 'expired' | 'other';
  notes: string | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeStockReason(value: unknown): 'damaged' | 'sample' | 'lost' | 'expired' | 'other' | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'damaged' || normalized === 'sample' || normalized === 'lost' || normalized === 'expired' || normalized === 'other') {
    return normalized;
  }

  return null;
}

function getTrimmedNotes(value: unknown): string | null {
  const raw = value !== undefined ? String(value).trim() : '';
  return raw ? raw.slice(0, 500) : null;
}

async function loadProductStockForUpdate(connection: PoolConnection, productId: number): Promise<number | null> {
  const [productRows] = await connection.query<RowDataPacket[]>(
    'SELECT stan_magazynowy FROM products WHERE id = ? LIMIT 1 FOR UPDATE',
    [productId]
  );

  if (productRows.length === 0) {
    return null;
  }

  return toNumber(productRows[0].stan_magazynowy);
}

// GET /api/products - List all products
router.get('/', async (req, res) => {
  try {
    const { search, missing_price } = req.query;
    
    let query = 'SELECT * FROM products WHERE aktywny = 1';
    const params: any[] = [];

    if (missing_price === 'true') {
      query += ' AND cena_zakupu IS NULL';
    }

    if (search) {
      query += ' AND (nazwa LIKE ? OR sku LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY nazwa ASC';

    const [rows] = await pool.query<RowDataPacket[]>(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/products/:id - Get single product
router.get('/:id', async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM products WHERE id = ?',
      [productId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = rows[0];

    const [tierRows] = await pool.query<ProductTierRow[]>(
      `SELECT *
       FROM product_price_tiers
       WHERE product_id = ?
       ORDER BY quantity ASC, id ASC`,
      [productId]
    );

    product.price_tiers = tierRows;

    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// POST /api/products - Create new product
router.post('/', requireCatalogEditor, async (req, res) => {
  try {
    const {
      sku,
      nazwa,
      cena_zakupu,
      stawka_vat,
      kategoria,
      jednostka,
      stan_magazynowy
    } = req.body;

    if (!nazwa) {
      return res.status(400).json({ error: 'Nazwa is required' });
    }

    const trimmedName = String(nazwa).trim();
    const [existingRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, nazwa FROM products WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) LIMIT 1',
      [trimmedName]
    );

    if (existingRows.length > 0) {
      return res.status(409).json({
        error: 'Product already exists',
        details: `Product ${existingRows[0].nazwa} already exists`,
        product_id: Number(existingRows[0].id)
      });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO products (
         sku, nazwa, cena_zakupu, stawka_vat, kategoria, jednostka, stan_magazynowy,
         gtin, cena_sprzedazy_rekomendowana, additional_info
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sku || null,
        trimmedName,
        cena_zakupu ?? null,
        stawka_vat ?? null,
        kategoria || null,
        jednostka || null,
        stan_magazynowy ?? null,
        req.body.gtin || null,
        req.body.cena_sprzedazy_rekomendowana ?? null,
        req.body.additional_info || null
      ]
    );

    res.status(201).json({
      id: result.insertId,
      message: 'Product created successfully'
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id - Update product
router.put('/:id', requireCatalogEditor, async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    const {
      sku,
      nazwa,
      cena_zakupu,
      stawka_vat,
      kategoria,
      jednostka,
      stan_magazynowy,
      aktywny
    } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (sku !== undefined) {
      updates.push('sku = ?');
      values.push(sku);
    }

    if (nazwa !== undefined) {
      const normalizedName = String(nazwa).trim();
      const [duplicateRows] = await pool.query<RowDataPacket[]>(
        'SELECT id, nazwa FROM products WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1',
        [normalizedName, productId]
      );

      if (duplicateRows.length > 0) {
        return res.status(409).json({
          error: 'Product already exists',
          details: `Product ${duplicateRows[0].nazwa} already exists`,
          product_id: Number(duplicateRows[0].id)
        });
      }

      updates.push('nazwa = ?');
      values.push(normalizedName);
    }

    if (cena_zakupu !== undefined) {
      updates.push('cena_zakupu = ?');
      values.push(cena_zakupu);
    }

    if (stawka_vat !== undefined) {
      updates.push('stawka_vat = ?');
      values.push(stawka_vat);
    }

    if (kategoria !== undefined) {
      updates.push('kategoria = ?');
      values.push(kategoria);
    }

    if (jednostka !== undefined) {
      updates.push('jednostka = ?');
      values.push(jednostka);
    }

    if (stan_magazynowy !== undefined) {
      updates.push('stan_magazynowy = ?');
      values.push(stan_magazynowy);
    }

    if (req.body.gtin !== undefined) {
      updates.push('gtin = ?');
      values.push(req.body.gtin || null);
    }

    if (req.body.cena_sprzedazy_rekomendowana !== undefined) {
      updates.push('cena_sprzedazy_rekomendowana = ?');
      values.push(req.body.cena_sprzedazy_rekomendowana ?? null);
    }

    if (req.body.additional_info !== undefined) {
      updates.push('additional_info = ?');
      values.push(req.body.additional_info || null);
    }

    if (aktywny !== undefined) {
      updates.push('aktywny = ?');
      values.push(aktywny ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(productId);

    await pool.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    let recalculation = null;
    const shouldRecalculateInvoices = cena_zakupu !== undefined
      && cena_zakupu !== null
      && String(cena_zakupu).trim() !== '';

    if (shouldRecalculateInvoices) {
      recalculation = await recalculateInvoicesImpactedByProduct(productId);
    }

    res.json({
      message: 'Product updated successfully',
      recalculation,
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// GET /api/products/:id/tiers - Product tier pricing list
router.get('/:id/tiers', async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const [rows] = await pool.query<ProductTierRow[]>(
      `SELECT *
       FROM product_price_tiers
       WHERE product_id = ?
       ORDER BY quantity ASC, id ASC`,
      [productId]
    );

    res.json(rows);
  } catch (error) {
    console.error('Error fetching product tiers:', error);
    res.status(500).json({ error: 'Failed to fetch product tiers' });
  }
});

// POST /api/products/:id/tiers - Add a tier price for product
router.post('/:id/tiers', requireCatalogEditor, async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const quantity = toNumber(req.body.quantity);
    const unitPriceRecommended = toNumber(req.body.unit_price_recommended);

    if (quantity === null || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be greater than 0' });
    }

    if (unitPriceRecommended === null || unitPriceRecommended < 0) {
      return res.status(400).json({ error: 'unit_price_recommended is required and must be >= 0' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO product_price_tiers (
         product_id, quantity, unit_price_recommended, unit_purchase_price, commission_percent, currency, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        quantity,
        unitPriceRecommended,
        toNumber(req.body.unit_purchase_price),
        toNumber(req.body.commission_percent),
        req.body.currency || 'PLN',
        req.body.notes || null
      ]
    );

    res.status(201).json({ id: result.insertId, message: 'Tier added successfully' });
  } catch (error) {
    console.error('Error creating product tier:', error);
    res.status(500).json({ error: 'Failed to create product tier' });
  }
});

// PUT /api/products/:id/tiers/:tierId - Update a tier price
router.put('/:id/tiers/:tierId', requireCatalogEditor, async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    const tierId = parseInt(String(req.params.tierId), 10);
    if (Number.isNaN(productId) || Number.isNaN(tierId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const quantity = toNumber(req.body.quantity);
    const unitPriceRecommended = toNumber(req.body.unit_price_recommended);

    if (quantity === null || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be greater than 0' });
    }

    if (unitPriceRecommended === null || unitPriceRecommended < 0) {
      return res.status(400).json({ error: 'unit_price_recommended is required and must be >= 0' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE product_price_tiers
       SET quantity = ?, unit_price_recommended = ?, unit_purchase_price = ?, commission_percent = ?, currency = ?, notes = ?
       WHERE id = ? AND product_id = ?`,
      [
        quantity,
        unitPriceRecommended,
        toNumber(req.body.unit_purchase_price),
        toNumber(req.body.commission_percent),
        req.body.currency || 'PLN',
        req.body.notes || null,
        tierId,
        productId
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tier not found' });
    }

    res.json({ message: 'Tier updated successfully' });
  } catch (error) {
    console.error('Error updating product tier:', error);
    res.status(500).json({ error: 'Failed to update product tier' });
  }
});

// DELETE /api/products/:id/tiers/:tierId - Remove a tier price
router.delete('/:id/tiers/:tierId', requireCatalogEditor, async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    const tierId = parseInt(String(req.params.tierId), 10);
    if (Number.isNaN(productId) || Number.isNaN(tierId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM product_price_tiers WHERE id = ? AND product_id = ?',
      [tierId, productId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tier not found' });
    }

    res.json({ message: 'Tier removed successfully' });
  } catch (error) {
    console.error('Error deleting product tier:', error);
    res.status(500).json({ error: 'Failed to delete product tier' });
  }
});

// GET /api/products/stats - Get product statistics
router.get('/stats/summary', async (req, res) => {
  try {
    // Get stats for products with sales
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        p.id,
        p.nazwa,
        p.sku,
        p.cena_zakupu,
        p.stan_magazynowy,
        p.jednostka,
        COUNT(ii.id) as times_sold,
        SUM(ii.ilosc) as total_quantity,
        AVG(ii.marza_procent) as avg_margin,
        SUM(ii.zysk) as total_profit,
        (COALESCE(p.stan_magazynowy, 0) - COALESCE(SUM(ii.ilosc), 0)) as remaining_quantity
      FROM products p
      LEFT JOIN invoice_items ii ON p.id = ii.product_id
      WHERE p.aktywny = 1
      GROUP BY p.id
      HAVING times_sold > 0
      ORDER BY total_profit DESC`
    );

    res.json(rows);
  } catch (error) {
    console.error('Error fetching product stats:', error);
    res.status(500).json({ error: 'Failed to fetch product stats' });
  }
});

// GET /api/products/:id/stock-adjustments - List recent manual stock adjustments
router.get('/:id/stock-adjustments', async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const limitRaw = parseInt(String(req.query.limit || '20'), 10);
    const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);

    const [rows] = await pool.query<ProductStockAdjustmentRow[]>(
      `SELECT
         psa.*,
         u.username AS created_by_username,
         u.full_name AS created_by_full_name
       FROM product_stock_adjustments psa
       LEFT JOIN users u ON u.id = psa.created_by_user_id
       WHERE psa.product_id = ?
       ORDER BY psa.created_at DESC, psa.id DESC
       LIMIT ?`,
      [productId, limit]
    );

    res.json(rows);
  } catch (error) {
    console.error('Error fetching stock adjustments:', error);
    res.status(500).json({ error: 'Failed to fetch stock adjustments' });
  }
});

// POST /api/products/:id/stock-adjustments - Manual stock reduction (damage/sample/lost/etc.)
router.post('/:id/stock-adjustments', requireCatalogEditor, async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const quantity = toNumber(req.body.quantity);
    if (quantity === null || quantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const reason = normalizeStockReason(req.body.reason);
    if (!reason) {
      return res.status(400).json({ error: 'reason is required (damaged, sample, lost, expired, other)' });
    }

    const notes = getTrimmedNotes(req.body.notes);

    const [productRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, nazwa, jednostka, stan_magazynowy FROM products WHERE id = ? LIMIT 1',
      [productId]
    );

    if (productRows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productRows[0];
    const currentStock = toNumber(product.stan_magazynowy);
    if (currentStock === null) {
      return res.status(400).json({ error: 'Stock level is not set. Set stock level first.' });
    }

    const roundedQuantity = roundQuantity(quantity);
    const newStock = roundQuantity(currentStock - roundedQuantity);

    if (newStock < 0) {
      return res.status(400).json({
        error: 'Not enough stock for this operation',
        available: currentStock,
        requested: roundedQuantity,
      });
    }

    await pool.query('UPDATE products SET stan_magazynowy = ? WHERE id = ?', [newStock, productId]);

    const [adjustmentResult] = await pool.query<ResultSetHeader>(
      `INSERT INTO product_stock_adjustments (
         product_id, change_type, quantity, quantity_before, quantity_after, reason, notes, created_by_user_id
       ) VALUES (?, 'out', ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        roundedQuantity,
        currentStock,
        newStock,
        reason,
        notes,
        req.user?.id || null,
      ]
    );

    res.status(201).json({
      id: adjustmentResult.insertId,
      message: 'Stock reduced successfully',
      product_id: productId,
      product_name: product.nazwa,
      unit: product.jednostka || 'szt',
      quantity_removed: roundedQuantity,
      previous_stock: currentStock,
      stan_magazynowy: newStock,
      reason,
    });
  } catch (error) {
    console.error('Error reducing product stock:', error);
    res.status(500).json({ error: 'Failed to reduce product stock' });
  }
});

// PUT /api/products/:id/stock-adjustments/:adjustmentId - Edit a stock reduction entry
router.put('/:id/stock-adjustments/:adjustmentId', requireCatalogEditor, async (req, res) => {
  const productId = parseInt(String(req.params.id), 10);
  const adjustmentId = parseInt(String(req.params.adjustmentId), 10);

  if (Number.isNaN(productId) || Number.isNaN(adjustmentId)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  const quantity = toNumber(req.body.quantity);
  if (quantity === null || quantity <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive number' });
  }

  const reason = normalizeStockReason(req.body.reason);
  if (!reason) {
    return res.status(400).json({ error: 'reason is required (damaged, sample, lost, expired, other)' });
  }

  const notes = getTrimmedNotes(req.body.notes);
  const roundedQuantity = roundQuantity(quantity);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [adjustmentRows] = await connection.query<ProductStockAdjustmentMutationRow[]>(
      `SELECT id, quantity, reason, notes
       FROM product_stock_adjustments
       WHERE id = ? AND product_id = ?
       LIMIT 1
       FOR UPDATE`,
      [adjustmentId, productId]
    );

    if (adjustmentRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Stock adjustment not found' });
    }

    const existingAdjustment = adjustmentRows[0];
    const currentStock = await loadProductStockForUpdate(connection, productId);
    if (currentStock === null) {
      await connection.rollback();
      return res.status(404).json({ error: 'Product not found' });
    }

    const oldQuantity = Number(existingAdjustment.quantity || 0);
    const stockWithoutOldAdjustment = roundQuantity(currentStock + oldQuantity);
    const newStock = roundQuantity(stockWithoutOldAdjustment - roundedQuantity);

    if (newStock < 0) {
      await connection.rollback();
      return res.status(400).json({
        error: 'Not enough stock for this edited value',
        available: stockWithoutOldAdjustment,
        requested: roundedQuantity,
      });
    }

    await connection.query(
      'UPDATE products SET stan_magazynowy = ? WHERE id = ?',
      [newStock, productId]
    );

    await connection.query(
      `UPDATE product_stock_adjustments
       SET quantity = ?, quantity_before = ?, quantity_after = ?, reason = ?, notes = ?
       WHERE id = ? AND product_id = ?`,
      [roundedQuantity, stockWithoutOldAdjustment, newStock, reason, notes, adjustmentId, productId]
    );

    await connection.commit();

    res.json({
      message: 'Stock adjustment updated successfully',
      product_id: productId,
      adjustment_id: adjustmentId,
      quantity_removed: roundedQuantity,
      stan_magazynowy: newStock,
      reason,
      notes,
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating stock adjustment:', error);
    res.status(500).json({ error: 'Failed to update stock adjustment' });
  } finally {
    connection.release();
  }
});

// DELETE /api/products/:id/stock-adjustments/:adjustmentId - Undo stock reduction entry
router.delete('/:id/stock-adjustments/:adjustmentId', requireCatalogEditor, async (req, res) => {
  const productId = parseInt(String(req.params.id), 10);
  const adjustmentId = parseInt(String(req.params.adjustmentId), 10);

  if (Number.isNaN(productId) || Number.isNaN(adjustmentId)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [adjustmentRows] = await connection.query<ProductStockAdjustmentMutationRow[]>(
      `SELECT id, quantity
       FROM product_stock_adjustments
       WHERE id = ? AND product_id = ?
       LIMIT 1
       FOR UPDATE`,
      [adjustmentId, productId]
    );

    if (adjustmentRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Stock adjustment not found' });
    }

    const currentStock = await loadProductStockForUpdate(connection, productId);
    if (currentStock === null) {
      await connection.rollback();
      return res.status(404).json({ error: 'Product not found' });
    }

    const oldQuantity = Number(adjustmentRows[0].quantity || 0);
    const newStock = roundQuantity(currentStock + oldQuantity);

    await connection.query(
      'UPDATE products SET stan_magazynowy = ? WHERE id = ?',
      [newStock, productId]
    );

    await connection.query(
      'DELETE FROM product_stock_adjustments WHERE id = ? AND product_id = ?',
      [adjustmentId, productId]
    );

    await connection.commit();

    res.json({
      message: 'Stock adjustment deleted successfully',
      product_id: productId,
      adjustment_id: adjustmentId,
      stan_magazynowy: newStock,
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting stock adjustment:', error);
    res.status(500).json({ error: 'Failed to delete stock adjustment' });
  } finally {
    connection.release();
  }
});

// Find or create product by name
router.post('/find-or-create', requireCatalogEditor, async (req, res) => {
  try {
    const { nazwa, jednostka, stawka_vat } = req.body;

    if (!nazwa || String(nazwa).trim() === '') {
      return res.status(400).json({ error: 'nazwa is required' });
    }

    const trimmedName = String(nazwa).trim();

    // Try to find by name
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM products WHERE LOWER(TRIM(nazwa)) = LOWER(TRIM(?)) LIMIT 1',
      [trimmedName]
    );

    if (existing.length > 0) {
      return res.json(existing[0]);
    }

    // Create new product
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO products (nazwa, jednostka, stawka_vat, cena_zakupu)
       VALUES (?, ?, ?, NULL)`,
      [trimmedName, jednostka || 'szt', stawka_vat || 23]
    );

    const [newProduct] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM products WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newProduct[0]);
  } catch (error) {
    console.error('Error finding/creating product:', error);
    res.status(500).json({ error: 'Failed to find or create product' });
  }
});

// DELETE /api/products/:id - Hard delete product from database
router.delete('/:id', requireCatalogEditor, async (req, res) => {
  try {
    const productId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM products WHERE id = ?',
      [productId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// POST /api/products/merge - Merge multiple products into one
router.post('/merge', requireCatalogEditor, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { target_product_id, source_product_ids, transfer_stock, deactivate_sources } = req.body;

    if (!target_product_id || Number.isNaN(parseInt(String(target_product_id), 10))) {
      return res.status(400).json({ error: 'target_product_id is required' });
    }

    if (!Array.isArray(source_product_ids) || source_product_ids.length === 0) {
      return res.status(400).json({ error: 'source_product_ids must be a non-empty array' });
    }

    const targetId = parseInt(String(target_product_id), 10);
    const sourceIds = source_product_ids
      .map((id: unknown) => parseInt(String(id), 10))
      .filter((id: number) => !Number.isNaN(id) && id !== targetId);

    if (sourceIds.length === 0) {
      return res.status(400).json({ error: 'No valid source product IDs to merge' });
    }

    await connection.beginTransaction();

    const [targetRows] = await connection.query<RowDataPacket[]>(
      'SELECT id, nazwa, stan_magazynowy, cena_zakupu FROM products WHERE id = ? LIMIT 1 FOR UPDATE',
      [targetId]
    );

    if (targetRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Target product not found' });
    }

    const targetProduct = targetRows[0];

    const [sourceRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, nazwa, stan_magazynowy, cena_zakupu FROM products WHERE id IN (?) FOR UPDATE`,
      [sourceIds]
    );

    if (sourceRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'No source products found' });
    }

    const foundSourceIds = sourceRows.map((r) => r.id);
    let totalTransferredStock = 0;

    for (const source of sourceRows) {
      const [itemResult] = await connection.query<ResultSetHeader>(
        'UPDATE invoice_items SET product_id = ? WHERE product_id = ?',
        [targetId, source.id]
      );

      await connection.query(
        'UPDATE product_price_tiers SET product_id = ? WHERE product_id = ?',
        [targetId, source.id]
      );

      if (transfer_stock && source.stan_magazynowy != null) {
        totalTransferredStock += Number(source.stan_magazynowy);
      }
    }

    if (transfer_stock && totalTransferredStock > 0) {
      const currentTargetStock = Number(targetProduct.stan_magazynowy) || 0;
      const newStock = currentTargetStock + totalTransferredStock;
      await connection.query(
        'UPDATE products SET stan_magazynowy = ? WHERE id = ?',
        [newStock, targetId]
      );
    }

    if (deactivate_sources) {
      await connection.query(
        'UPDATE products SET aktywny = 0 WHERE id IN (?)',
        [foundSourceIds]
      );
    } else {
      await connection.query(
        'DELETE FROM products WHERE id IN (?)',
        [foundSourceIds]
      );
    }

    await connection.commit();

    res.json({
      message: 'Products merged successfully',
      target_product_id: targetId,
      target_product_name: targetProduct.nazwa,
      merged_count: foundSourceIds.length,
      merged_product_ids: foundSourceIds,
      transferred_stock: transfer_stock ? totalTransferredStock : 0
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error merging products:', error);
    res.status(500).json({ error: 'Failed to merge products' });
  } finally {
    connection.release();
  }
});

export default router;
