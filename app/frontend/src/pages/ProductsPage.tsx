import { Fragment, useEffect, useMemo, useState } from 'react';
import { Search, Plus, ChevronDown, ChevronRight, Save, Trash2, Package, MinusCircle, Edit2, X, GitMerge, CheckSquare, Square } from 'lucide-react';
import { productsApi } from '../services/api';
import type { Product, ProductPriceTier, ProductStockAdjustment } from '../types';
import toast from 'react-hot-toast';
import { formatMoney as formatMoneyUtil } from '../utils/formatters';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';

interface ProductDraft {
  sku: string;
  gtin: string;
  nazwa: string;
  kategoria: string;
  jednostka: string;
  stawka_vat: string;
  cena_zakupu: string;
  cena_sprzedazy_rekomendowana: string;
  stan_magazynowy: string;
  additional_info: string;
}

interface NewProductForm extends ProductDraft {
  aktywny: boolean;
}

interface TierDraft {
  quantity: string;
  unit_price_recommended: string;
  unit_purchase_price: string;
  currency: string;
  notes: string;
}

interface StockAdjustmentDraft {
  quantity: string;
  reason: 'damaged' | 'sample' | 'lost' | 'expired' | 'other';
  notes: string;
}

const PRODUCT_CATEGORY_OPTIONS = [
  'Laski Wanili',
  'Nasiona & Proszki Waniliowe',
  'Ekstrakty',
  'Inne Produkty',
  'Zestawy',
  'Kakao'
] as const;

const STOCK_REASON_LABELS: Record<StockAdjustmentDraft['reason'], string> = {
  damaged: 'Damaged package',
  sample: 'Given as sample',
  lost: 'Lost / missing',
  expired: 'Expired / unusable',
  other: 'Other reason',
};

function formatMoney(value: number | null | undefined, currency = 'PLN'): string {
  if (value === null || value === undefined) return '-';
  if (currency === 'PLN') return formatMoneyUtil(value);
  return `${Number(value).toFixed(2)} ${currency}`;
}

function toNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isNaN(parsed) ? null : parsed;
}

export function ProductsPage() {
  const { user } = useAuth();
  const canManageCatalog = user?.role === 'admin' || user?.role === 'manager';
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; tierId: number; productId: number } | null>(null);
  const [deleteProductDialog, setDeleteProductDialog] = useState<{ isOpen: boolean; productId: number; productName: string } | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newProduct, setNewProduct] = useState<NewProductForm>({
    sku: '',
    gtin: '',
    nazwa: '',
    kategoria: '',
    jednostka: 'szt',
    stawka_vat: '23',
    cena_zakupu: '',
    cena_sprzedazy_rekomendowana: '',
    stan_magazynowy: '',
    additional_info: '',
    aktywny: true
  });

  const [expandedProductIds, setExpandedProductIds] = useState<number[]>([]);
  const [productDrafts, setProductDrafts] = useState<Record<number, ProductDraft>>({});
  const [productTiers, setProductTiers] = useState<Record<number, ProductPriceTier[]>>({});
  const [tierDrafts, setTierDrafts] = useState<Record<number, TierDraft>>({});
  const [productAdjustments, setProductAdjustments] = useState<Record<number, ProductStockAdjustment[]>>({});
  const [adjustmentDrafts, setAdjustmentDrafts] = useState<Record<number, StockAdjustmentDraft>>({});
  const [adjustmentEditDrafts, setAdjustmentEditDrafts] = useState<Record<number, StockAdjustmentDraft>>({});
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<number | null>(null);
  const [savingProductId, setSavingProductId] = useState<number | null>(null);
  const [savingTierForProductId, setSavingTierForProductId] = useState<number | null>(null);
  const [reducingStockProductId, setReducingStockProductId] = useState<number | null>(null);
  const [savingAdjustmentId, setSavingAdjustmentId] = useState<number | null>(null);
  const [deletingAdjustmentId, setDeletingAdjustmentId] = useState<number | null>(null);
  const [deletingTierId, setDeletingTierId] = useState<number | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<number | null>(null);

  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<number[]>([]);
  const [mergeDialog, setMergeDialog] = useState<{
    isOpen: boolean;
    targetId: number | null;
    transferStock: boolean;
    deactivateSources: boolean;
  } | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    void loadProducts();
  }, [searchQuery, showMissingOnly]);

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl-PL')),
    [products]
  );

  const loadProducts = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await productsApi.getAll({
        search: searchQuery || undefined,
        missing_price: showMissingOnly || undefined
      });
      setProducts(response.data);
    } catch (loadError) {
      console.error('Error loading products:', loadError);
      setError('Nie udało się załadować produktów.');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpandProduct = async (product: Product) => {
    const productId = product.id;
    const currentlyExpanded = expandedProductIds.includes(productId);

    setExpandedProductIds((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]
    );

    if (currentlyExpanded) return;

    if (!productDrafts[productId]) {
      try {
        const [details, adjustments] = await Promise.all([
          productsApi.getById(productId),
          productsApi.getStockAdjustments(productId, { limit: 10 })
        ]);
        const full = details.data;
        setProductDrafts((current) => ({
          ...current,
          [productId]: {
            sku: full.sku || '',
            gtin: full.gtin || '',
            nazwa: full.nazwa || '',
            kategoria: full.kategoria || '',
            jednostka: full.jednostka || 'szt',
            stawka_vat: full.stawka_vat != null ? String(full.stawka_vat) : '23',
            cena_zakupu: full.cena_zakupu != null ? String(full.cena_zakupu) : '',
            cena_sprzedazy_rekomendowana:
              full.cena_sprzedazy_rekomendowana != null ? String(full.cena_sprzedazy_rekomendowana) : '',
            stan_magazynowy: full.stan_magazynowy != null ? String(full.stan_magazynowy) : '',
            additional_info: full.additional_info || ''
          }
        }));
        setProductTiers((current) => ({
          ...current,
          [productId]: full.price_tiers || []
        }));
        setTierDrafts((current) => ({
          ...current,
          [productId]: {
            quantity: '1',
            unit_price_recommended: '',
            unit_purchase_price: '',
            currency: 'PLN',
            notes: ''
          }
        }));
        setProductAdjustments((current) => ({
          ...current,
          [productId]: adjustments.data || []
        }));
        setAdjustmentDrafts((current) => ({
          ...current,
          [productId]: {
            quantity: '',
            reason: 'damaged',
            notes: ''
          }
        }));
      } catch (expandError) {
        console.error('Error loading product details:', expandError);
        setError('Nie udało się pobrać szczegółów produktu.');
      }
    }
  };

  const createProduct = async () => {
    if (!newProduct.nazwa.trim()) {
      setError('Product name is required.');
      return;
    }

    try {
      setCreating(true);
      setError(null);
      await productsApi.create({
        nazwa: newProduct.nazwa.trim(),
        sku: newProduct.sku.trim() || null,
        gtin: newProduct.gtin.trim() || null,
        kategoria: newProduct.kategoria.trim() || null,
        jednostka: newProduct.jednostka.trim() || 'szt',
        stawka_vat: toNumber(newProduct.stawka_vat),
        cena_zakupu: toNumber(newProduct.cena_zakupu),
        cena_sprzedazy_rekomendowana: toNumber(newProduct.cena_sprzedazy_rekomendowana),
        stan_magazynowy: toNumber(newProduct.stan_magazynowy),
        additional_info: newProduct.additional_info.trim() || null,
        aktywny: newProduct.aktywny
      });

      setNewProduct({
        sku: '',
        gtin: '',
        nazwa: '',
        kategoria: '',
        jednostka: 'szt',
        stawka_vat: '23',
        cena_zakupu: '',
        cena_sprzedazy_rekomendowana: '',
        stan_magazynowy: '',
        additional_info: '',
        aktywny: true
      });
      setShowCreateForm(false);
      toast.success('Product created successfully!');
      await loadProducts();
    } catch (createError: any) {
      console.error('Error creating product:', createError);
      const details = createError?.response?.data?.details;
      const errorMsg = createError?.response?.data?.error
        ? details
          ? `${createError.response.data.error}: ${details}`
          : createError.response.data.error
        : 'Failed to create product';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setCreating(false);
    }
  };

  const saveProduct = async (productId: number) => {
    const draft = productDrafts[productId];
    if (!draft) return;
    if (!draft.nazwa.trim()) {
      setError('Product name is required.');
      return;
    }

    try {
      setSavingProductId(productId);
      setError(null);
      await productsApi.update(productId, {
        nazwa: draft.nazwa.trim(),
        sku: draft.sku.trim() || null,
        gtin: draft.gtin.trim() || null,
        kategoria: draft.kategoria.trim() || null,
        jednostka: draft.jednostka.trim() || 'szt',
        stawka_vat: toNumber(draft.stawka_vat),
        cena_zakupu: toNumber(draft.cena_zakupu),
        cena_sprzedazy_rekomendowana: toNumber(draft.cena_sprzedazy_rekomendowana),
        stan_magazynowy: toNumber(draft.stan_magazynowy),
        additional_info: draft.additional_info.trim() || null
      });
      toast.success('Product updated successfully!');
      await loadProducts();
    } catch (saveError: any) {
      console.error('Error saving product:', saveError);
      const details = saveError?.response?.data?.details;
      const errorMsg = saveError?.response?.data?.error
        ? details
          ? `${saveError.response.data.error}: ${details}`
          : saveError.response.data.error
        : 'Failed to save product';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSavingProductId(null);
    }
  };

  const addTier = async (productId: number) => {
    const draft = tierDrafts[productId];
    if (!draft) return;
    const qty = toNumber(draft.quantity);
    const unitPrice = toNumber(draft.unit_price_recommended);

    if (qty === null || qty <= 0) {
      setError('Threshold quantity must be greater than 0.');
      return;
    }
    if (unitPrice === null || unitPrice < 0) {
      setError('Recommended price must be a valid number.');
      return;
    }

    try {
      setSavingTierForProductId(productId);
      setError(null);
      await productsApi.addTier(productId, {
        quantity: qty,
        unit_price_recommended: unitPrice,
        unit_purchase_price: toNumber(draft.unit_purchase_price),
        currency: draft.currency || 'PLN',
        notes: draft.notes.trim() || null
      });

      const refreshed = await productsApi.getTiers(productId);
      setProductTiers((current) => ({ ...current, [productId]: refreshed.data || [] }));
      setTierDrafts((current) => ({
        ...current,
        [productId]: {
          quantity: '1',
          unit_price_recommended: '',
          unit_purchase_price: '',
          currency: 'PLN',
          notes: ''
        }
      }));
      toast.success('Price tier added successfully!');
    } catch (tierError: any) {
      console.error('Error adding tier:', tierError);
      const errorMsg = tierError?.response?.data?.error || 'Failed to add price tier';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSavingTierForProductId(null);
    }
  };

  const deleteTier = async (productId: number, tierId: number) => {
    try {
      setDeletingTierId(tierId);
      setError(null);
      await productsApi.deleteTier(productId, tierId);
      setProductTiers((current) => ({
        ...current,
        [productId]: (current[productId] || []).filter((tier) => tier.id !== tierId)
      }));
      setConfirmDialog(null);
      toast.success('Price tier deleted successfully!');
    } catch (tierError: any) {
      console.error('Error deleting tier:', tierError);
      const errorMsg = tierError?.response?.data?.error || 'Failed to delete price tier';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setDeletingTierId(null);
    }
  };

  const deleteProduct = async (productId: number) => {
    try {
      setDeletingProductId(productId);
      setError(null);
      await productsApi.delete(productId);
      setDeleteProductDialog(null);
      toast.success('Product deleted successfully!');
      await loadProducts();
    } catch (deleteError: any) {
      console.error('Error deleting product:', deleteError);
      const errorMsg = deleteError?.response?.data?.error || 'Failed to delete product';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setDeletingProductId(null);
    }
  };

  const toggleMergeMode = () => {
    setMergeMode((current) => !current);
    setSelectedForMerge([]);
    setMergeDialog(null);
  };

  const toggleProductSelection = (productId: number) => {
    setSelectedForMerge((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    );
  };

  const openMergeDialog = () => {
    if (selectedForMerge.length < 2) {
      setError('Select at least 2 products to merge.');
      return;
    }
    setMergeDialog({
      isOpen: true,
      targetId: selectedForMerge[0],
      transferStock: true,
      deactivateSources: true
    });
  };

  const executeMerge = async () => {
    if (!mergeDialog || !mergeDialog.targetId) return;
    const sourceIds = selectedForMerge.filter((id) => id !== mergeDialog.targetId);
    if (sourceIds.length === 0) {
      setError('No source products to merge.');
      return;
    }

    try {
      setMerging(true);
      setError(null);
      await productsApi.mergeProducts({
        target_product_id: mergeDialog.targetId,
        source_product_ids: sourceIds,
        transfer_stock: mergeDialog.transferStock,
        deactivate_sources: mergeDialog.deactivateSources
      });
      toast.success(`Merged ${sourceIds.length} product(s) successfully!`);
      setMergeDialog(null);
      setMergeMode(false);
      setSelectedForMerge([]);
      await loadProducts();
    } catch (mergeError: any) {
      console.error('Error merging products:', mergeError);
      const errorMsg = mergeError?.response?.data?.error || 'Failed to merge products';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setMerging(false);
    }
  };

  const reduceStock = async (product: Product) => {
    const draft = adjustmentDrafts[product.id];
    if (!draft) return;

    const qty = toNumber(draft.quantity);
    if (qty === null || qty <= 0) {
      setError('Quantity to remove must be a positive number.');
      return;
    }

    try {
      setReducingStockProductId(product.id);
      setError(null);

      const response = await productsApi.reduceStock(product.id, {
        quantity: qty,
        reason: draft.reason,
        notes: draft.notes.trim() || null,
      });

      syncProductStockInState(product.id, response.data.stan_magazynowy);

      const refreshedAdjustments = await productsApi.getStockAdjustments(product.id, { limit: 10 });
      setProductAdjustments((current) => ({
        ...current,
        [product.id]: refreshedAdjustments.data || []
      }));

      setAdjustmentDrafts((current) => ({
        ...current,
        [product.id]: {
          quantity: '',
          reason: draft.reason,
          notes: ''
        }
      }));

      toast.success('Stock adjusted successfully!');
    } catch (adjustError: any) {
      console.error('Error reducing stock:', adjustError);
      const errorMsg = adjustError?.response?.data?.error || 'Failed to adjust stock';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setReducingStockProductId(null);
    }
  };

  const syncProductStockInState = (productId: number, updatedStock: number) => {
    setProducts((current) =>
      current.map((entry) =>
        entry.id === productId
          ? {
              ...entry,
              stan_magazynowy: updatedStock,
            }
          : entry
      )
    );

    setProductDrafts((current) => {
      const existing = current[productId];
      if (!existing) return current;
      return {
        ...current,
        [productId]: {
          ...existing,
          stan_magazynowy: String(updatedStock),
        }
      };
    });
  };

  const startEditingAdjustment = (adjustment: ProductStockAdjustment) => {
    setEditingAdjustmentId(adjustment.id);
    setAdjustmentEditDrafts((current) => ({
      ...current,
      [adjustment.id]: {
        quantity: String(adjustment.quantity),
        reason: adjustment.reason,
        notes: adjustment.notes || '',
      }
    }));
  };

  const cancelEditingAdjustment = (adjustmentId: number) => {
    setEditingAdjustmentId((current) => (current === adjustmentId ? null : current));
    setAdjustmentEditDrafts((current) => {
      const { [adjustmentId]: _removed, ...rest } = current;
      return rest;
    });
  };

  const saveAdjustmentEdit = async (product: Product, adjustmentId: number) => {
    const draft = adjustmentEditDrafts[adjustmentId];
    if (!draft) return;

    const qty = toNumber(draft.quantity);
    if (qty === null || qty <= 0) {
      setError('Quantity to remove must be a positive number.');
      return;
    }

    try {
      setSavingAdjustmentId(adjustmentId);
      setError(null);

      const response = await productsApi.updateStockAdjustment(product.id, adjustmentId, {
        quantity: qty,
        reason: draft.reason,
        notes: draft.notes.trim() || null,
      });

      syncProductStockInState(product.id, response.data.stan_magazynowy);

      const refreshedAdjustments = await productsApi.getStockAdjustments(product.id, { limit: 10 });
      setProductAdjustments((current) => ({
        ...current,
        [product.id]: refreshedAdjustments.data || []
      }));

      cancelEditingAdjustment(adjustmentId);
      toast.success('Stock adjustment updated successfully!');
    } catch (saveError: any) {
      console.error('Error updating stock adjustment:', saveError);
      const errorMsg = saveError?.response?.data?.error || 'Failed to update stock adjustment';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSavingAdjustmentId(null);
    }
  };

  const deleteAdjustment = async (product: Product, adjustmentId: number) => {
    if (!confirm('Delete this stock adjustment and restore stock?')) {
      return;
    }

    try {
      setDeletingAdjustmentId(adjustmentId);
      setError(null);

      const response = await productsApi.deleteStockAdjustment(product.id, adjustmentId);
      syncProductStockInState(product.id, response.data.stan_magazynowy);

      const refreshedAdjustments = await productsApi.getStockAdjustments(product.id, { limit: 10 });
      setProductAdjustments((current) => ({
        ...current,
        [product.id]: refreshedAdjustments.data || []
      }));

      cancelEditingAdjustment(adjustmentId);
      toast.success('Stock adjustment deleted successfully!');
    } catch (deleteError: any) {
      console.error('Error deleting stock adjustment:', deleteError);
      const errorMsg = deleteError?.response?.data?.error || 'Failed to delete stock adjustment';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setDeletingAdjustmentId(null);
    }
  };

  const formatAdjustmentDate = (dateStr: string): string => {
    try {
      return new Date(dateStr).toLocaleString('pl-PL');
    } catch {
      return dateStr;
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Products & Catalog</h2>
        <div className="flex items-center gap-4">
          {mergeMode && selectedForMerge.length > 0 && (
            <span className="text-sm text-primary font-medium">
              {selectedForMerge.length} selected
            </span>
          )}
          <div className="flex items-center gap-2 text-text-muted">
            <Package size={20} />
            <span>{sortedProducts.length} products</span>
          </div>
        </div>
      </div>

      {error && <div className="card mb-4 bg-red-50 border-red-200 text-danger">{error}</div>}

      {!canManageCatalog && (
        <div className="card mb-4 bg-surface-1 border-surface-2 text-text-muted">
          Read-only access: only admins and managers can manage products, catalog tiers, and stock adjustments.
        </div>
      )}

      <div className="card mb-6">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 relative min-w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
            <input
              type="text"
              placeholder="Search by name, SKU, GTIN..."
              className="input input-with-leading-icon"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showMissingOnly}
              onChange={(event) => setShowMissingOnly(event.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm">Only missing purchase price</span>
          </label>
          {canManageCatalog && (
            <>
              <button
                onClick={toggleMergeMode}
                className={`flex items-center gap-2 ${mergeMode ? 'btn-primary' : 'btn-secondary'}`}
              >
                <GitMerge size={16} />
                {mergeMode ? 'Cancel Merge' : 'Merge Products'}
              </button>
              {mergeMode && (
                <button
                  onClick={openMergeDialog}
                  disabled={selectedForMerge.length < 2}
                  className="btn-primary flex items-center gap-2"
                >
                  Merge Selected ({selectedForMerge.length})
                </button>
              )}
            </>
          )}
          {canManageCatalog && !mergeMode && (
            <button
              onClick={() => setShowCreateForm((current) => !current)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} />
              {showCreateForm ? 'Close Form' : 'Add New Product'}
            </button>
          )}
        </div>
      </div>

      <datalist id="product-categories-list">
        {PRODUCT_CATEGORY_OPTIONS.map((category) => (
          <option key={`product-category-${category}`} value={category} />
        ))}
      </datalist>

      {canManageCatalog && showCreateForm && (
        <div className="card mb-6">
          <h3 className="text-lg font-semibold mb-4">New Product (independent of invoices)</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <input className="input" placeholder="Name *" value={newProduct.nazwa} onChange={(e) => setNewProduct((p) => ({ ...p, nazwa: e.target.value }))} />
            <input className="input" placeholder="SKU" value={newProduct.sku} onChange={(e) => setNewProduct((p) => ({ ...p, sku: e.target.value }))} />
            <input className="input" placeholder="GTIN" value={newProduct.gtin} onChange={(e) => setNewProduct((p) => ({ ...p, gtin: e.target.value }))} />
            <input
              className="input"
              list="product-categories-list"
              placeholder="Category"
              value={newProduct.kategoria}
              onChange={(e) => setNewProduct((p) => ({ ...p, kategoria: e.target.value }))}
            />
            <input className="input" placeholder="Unit" value={newProduct.jednostka} onChange={(e) => setNewProduct((p) => ({ ...p, jednostka: e.target.value }))} />
            <input className="input" placeholder="VAT %" value={newProduct.stawka_vat} onChange={(e) => setNewProduct((p) => ({ ...p, stawka_vat: e.target.value }))} />
            <input className="input" placeholder="Purchase Price" value={newProduct.cena_zakupu} onChange={(e) => setNewProduct((p) => ({ ...p, cena_zakupu: e.target.value }))} />
            <input
              className="input"
              placeholder="Recommended Price"
              value={newProduct.cena_sprzedazy_rekomendowana}
              onChange={(e) => setNewProduct((p) => ({ ...p, cena_sprzedazy_rekomendowana: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Stock Level"
              value={newProduct.stan_magazynowy}
              onChange={(e) => setNewProduct((p) => ({ ...p, stan_magazynowy: e.target.value }))}
            />
          </div>
          <textarea
            className="input min-h-24 mb-3"
            placeholder="Additional catalog information (specifications, features, classification, etc.)"
            value={newProduct.additional_info}
            onChange={(e) => setNewProduct((p) => ({ ...p, additional_info: e.target.value }))}
          />
          <button onClick={createProduct} disabled={creating} className="btn-primary flex items-center gap-2">
            <Save size={16} />
            {creating ? 'Saving...' : 'Create Product'}
          </button>
        </div>
      )}

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Category</th>
                <th>SKU</th>
                <th>GTIN</th>
                <th>Purchase Price</th>
                <th>Recommended Price</th>
                <th>Stock Level</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">Loading...</td>
                </tr>
              ) : sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={Package}
                      title="No products in catalog"
                      description="Add your first product to start building your catalog. Products can also be created automatically when uploading invoices."
                      action={
                        canManageCatalog ? (
                          <button onClick={() => setShowCreateForm(true)} className="btn-primary">
                            <Plus size={16} className="inline mr-2" />
                            Add First Product
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                sortedProducts.map((product) => {
                  const isExpanded = expandedProductIds.includes(product.id);
                  const draft = productDrafts[product.id];
                  const tiers = productTiers[product.id] || [];
                  const tierDraft = tierDrafts[product.id];
                  const stockAdjustments = productAdjustments[product.id] || [];
                  const stockDraft = adjustmentDrafts[product.id];

                  return (
                    <Fragment key={product.id}>
                      <tr className={selectedForMerge.includes(product.id) ? 'bg-blue-50' : ''}>
                        <td className="w-10">
                          {mergeMode ? (
                            <button 
                              onClick={() => toggleProductSelection(product.id)} 
                              className="p-1"
                            >
                              {selectedForMerge.includes(product.id) ? (
                                <CheckSquare size={18} className="text-primary" />
                              ) : (
                                <Square size={18} className="text-gray-400" />
                              )}
                            </button>
                          ) : (
                            <button onClick={() => void toggleExpandProduct(product)} className="p-1">
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          )}
                        </td>
                        <td className="font-medium">{product.nazwa}</td>
                        <td>{product.kategoria || '-'}</td>
                        <td>{product.sku || '-'}</td>
                        <td>{product.gtin || '-'}</td>
                        <td>{formatMoney(product.cena_zakupu)}</td>
                        <td>{formatMoney(product.cena_sprzedazy_rekomendowana)}</td>
                        <td>{product.stan_magazynowy != null ? Number(product.stan_magazynowy).toFixed(3) : '-'}</td>
                      </tr>

                      {isExpanded && draft && tierDraft && stockDraft ? (
                        <tr>
                          <td colSpan={8} className="bg-gray-50">
                            <div className="p-4 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                <input className="input" value={draft.nazwa} onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, nazwa: e.target.value } }))} placeholder="Name" disabled={!canManageCatalog} />
                                <input className="input" value={draft.sku} onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, sku: e.target.value } }))} placeholder="SKU" disabled={!canManageCatalog} />
                                <input className="input" value={draft.gtin} onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, gtin: e.target.value } }))} placeholder="GTIN" disabled={!canManageCatalog} />
                                <input
                                  className="input"
                                  list="product-categories-list"
                                  value={draft.kategoria}
                                  onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, kategoria: e.target.value } }))}
                                  placeholder="Category"
                                  disabled={!canManageCatalog}
                                />
                                <input className="input" value={draft.jednostka} onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, jednostka: e.target.value } }))} placeholder="Unit" disabled={!canManageCatalog} />
                                <input className="input" value={draft.stawka_vat} onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, stawka_vat: e.target.value } }))} placeholder="VAT %" disabled={!canManageCatalog} />
                                <input className="input" value={draft.cena_zakupu} onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, cena_zakupu: e.target.value } }))} placeholder="Purchase Price" disabled={!canManageCatalog} />
                                <input className="input" value={draft.cena_sprzedazy_rekomendowana} onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, cena_sprzedazy_rekomendowana: e.target.value } }))} placeholder="Recommended Price" disabled={!canManageCatalog} />
                                <input className="input" value={draft.stan_magazynowy} onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, stan_magazynowy: e.target.value } }))} placeholder="Stock Level" disabled={!canManageCatalog} />
                                {canManageCatalog && (
                                  <button onClick={() => void saveProduct(product.id)} disabled={savingProductId === product.id} className="btn-primary">
                                    {savingProductId === product.id ? 'Saving...' : 'Save Product'}
                                  </button>
                                )}
                                {canManageCatalog && (
                                  <button
                                    onClick={() => setDeleteProductDialog({ isOpen: true, productId: product.id, productName: product.nazwa })}
                                    disabled={deletingProductId === product.id}
                                    className="btn-danger"
                                  >
                                    {deletingProductId === product.id ? 'Deleting...' : 'Delete Product'}
                                  </button>
                                )}
                              </div>

                              <textarea
                                className="input min-h-20"
                                value={draft.additional_info}
                                onChange={(e) => setProductDrafts((c) => ({ ...c, [product.id]: { ...draft, additional_info: e.target.value } }))}
                                placeholder="Additional catalog information (description, parameters, origin, classification, sales notes)"
                                disabled={!canManageCatalog}
                              />

                              <div className="border border-border rounded p-3 bg-white">
                                <h4 className="font-semibold mb-3">Manual Stock Reduction</h4>
                                <p className="text-sm text-text-muted mb-3">
                                  Use this when products leave stock without invoice sale (damaged package, sample, lost, expired).
                                </p>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
                                  <input
                                    className="input"
                                    placeholder="Quantity to remove"
                                    value={stockDraft.quantity}
                                    onChange={(e) =>
                                      setAdjustmentDrafts((current) => ({
                                        ...current,
                                        [product.id]: {
                                          ...stockDraft,
                                          quantity: e.target.value,
                                        }
                                      }))
                                    }
                                    disabled={!canManageCatalog}
                                  />
                                  <select
                                    className="input"
                                    value={stockDraft.reason}
                                    onChange={(e) =>
                                      setAdjustmentDrafts((current) => ({
                                        ...current,
                                        [product.id]: {
                                          ...stockDraft,
                                          reason: e.target.value as StockAdjustmentDraft['reason'],
                                        }
                                      }))
                                    }
                                    disabled={!canManageCatalog}
                                  >
                                    {Object.entries(STOCK_REASON_LABELS).map(([value, label]) => (
                                      <option key={`stock-reason-${product.id}-${value}`} value={value}>{label}</option>
                                    ))}
                                  </select>
                                  <input
                                    className="input md:col-span-2"
                                    placeholder="Note (optional)"
                                    value={stockDraft.notes}
                                    onChange={(e) =>
                                      setAdjustmentDrafts((current) => ({
                                        ...current,
                                        [product.id]: {
                                          ...stockDraft,
                                          notes: e.target.value,
                                        }
                                      }))
                                    }
                                    disabled={!canManageCatalog}
                                  />
                                </div>

                                {canManageCatalog && (
                                  <button
                                    onClick={() => void reduceStock(product)}
                                    disabled={reducingStockProductId === product.id}
                                    className="btn-danger flex items-center gap-2"
                                  >
                                    <MinusCircle size={16} />
                                    {reducingStockProductId === product.id ? 'Adjusting...' : 'Remove From Stock'}
                                  </button>
                                )}

                                <div className="mt-4">
                                  <h5 className="text-sm font-semibold mb-2">Recent Stock Adjustments</h5>
                                  {stockAdjustments.length === 0 ? (
                                    <p className="text-sm text-text-muted">No manual stock adjustments yet.</p>
                                  ) : (
                                    <div className="space-y-2">
                                      {stockAdjustments.map((adjustment) => {
                                        const editDraft = adjustmentEditDrafts[adjustment.id];
                                        const isEditing = editingAdjustmentId === adjustment.id;

                                        return (
                                          <div
                                            key={`stock-adjustment-${adjustment.id}`}
                                            className="text-sm p-2 border border-border rounded bg-gray-50"
                                          >
                                            {isEditing && editDraft ? (
                                              <div className="space-y-2">
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                                  <input
                                                    className="input"
                                                    value={editDraft.quantity}
                                                    onChange={(e) =>
                                                      setAdjustmentEditDrafts((current) => ({
                                                        ...current,
                                                        [adjustment.id]: {
                                                          ...editDraft,
                                                          quantity: e.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                  <select
                                                    className="input"
                                                    value={editDraft.reason}
                                                    onChange={(e) =>
                                                      setAdjustmentEditDrafts((current) => ({
                                                        ...current,
                                                        [adjustment.id]: {
                                                          ...editDraft,
                                                          reason: e.target.value as StockAdjustmentDraft['reason'],
                                                        }
                                                      }))
                                                    }
                                                  >
                                                    {Object.entries(STOCK_REASON_LABELS).map(([value, label]) => (
                                                      <option key={`stock-edit-reason-${adjustment.id}-${value}`} value={value}>{label}</option>
                                                    ))}
                                                  </select>
                                                  <input
                                                    className="input md:col-span-2"
                                                    value={editDraft.notes}
                                                    onChange={(e) =>
                                                      setAdjustmentEditDrafts((current) => ({
                                                        ...current,
                                                        [adjustment.id]: {
                                                          ...editDraft,
                                                          notes: e.target.value,
                                                        }
                                                      }))
                                                    }
                                                    placeholder="Note (optional)"
                                                  />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    onClick={() => void saveAdjustmentEdit(product, adjustment.id)}
                                                    disabled={savingAdjustmentId === adjustment.id}
                                                    className="btn-primary flex items-center gap-2"
                                                  >
                                                    <Save size={14} />
                                                    {savingAdjustmentId === adjustment.id ? 'Saving...' : 'Save'}
                                                  </button>
                                                  <button
                                                    onClick={() => cancelEditingAdjustment(adjustment.id)}
                                                    className="btn-secondary flex items-center gap-2"
                                                  >
                                                    <X size={14} />
                                                    Cancel
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <>
                                                <div className="font-medium">
                                                  -{Number(adjustment.quantity).toFixed(3)} {draft.jednostka || 'szt'} ({STOCK_REASON_LABELS[adjustment.reason] || adjustment.reason})
                                                </div>
                                                <div className="text-text-muted">
                                                  Stock: {Number(adjustment.quantity_before).toFixed(3)} to {Number(adjustment.quantity_after).toFixed(3)}
                                                </div>
                                                <div className="text-text-muted">
                                                  {formatAdjustmentDate(adjustment.created_at)}
                                                  {adjustment.created_by_full_name ? ` • ${adjustment.created_by_full_name}` : ''}
                                                </div>
                                                {adjustment.notes ? (
                                                  <div className="text-text-muted">{adjustment.notes}</div>
                                                ) : null}
                                                {canManageCatalog && (
                                                  <div className="mt-2 flex items-center gap-2">
                                                    <button
                                                      onClick={() => startEditingAdjustment(adjustment)}
                                                      className="btn-secondary flex items-center gap-2"
                                                    >
                                                      <Edit2 size={14} />
                                                      Edit
                                                    </button>
                                                    <button
                                                      onClick={() => void deleteAdjustment(product, adjustment.id)}
                                                      disabled={deletingAdjustmentId === adjustment.id}
                                                      className="btn-danger flex items-center gap-2"
                                                    >
                                                      <Trash2 size={14} />
                                                      {deletingAdjustmentId === adjustment.id ? 'Deleting...' : 'Delete'}
                                                    </button>
                                                  </div>
                                                )}
                                              </>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="border border-border rounded p-3 bg-white">
                                <h4 className="font-semibold mb-3">Price Tiers (official recommendation)</h4>
                                {tiers.length === 0 ? (
                                  <div className="text-sm text-text-muted mb-3">No price tiers for this product.</div>
                                ) : (
                                  <div className="space-y-2 mb-3">
                                    {tiers.map((tier) => (
                                      <div key={tier.id} className="flex flex-wrap items-center justify-between gap-2 p-2 border border-border rounded bg-gray-50">
                                        <div className="text-sm">
                                          <span className="font-medium">From {Number(tier.quantity).toFixed(3)} {draft.jednostka || 'pcs'}</span>
                                          <span> • Price: {formatMoney(tier.unit_price_recommended, tier.currency)}</span>
                                          <span> • Purchase: {formatMoney(tier.unit_purchase_price, tier.currency)}</span>
                                          {tier.notes ? <span> • {tier.notes}</span> : null}
                                        </div>
                                        {canManageCatalog && (
                                          <button onClick={() => setConfirmDialog({ isOpen: true, tierId: tier.id, productId: product.id })} disabled={deletingTierId === tier.id} className="btn-danger">
                                            <Trash2 size={14} />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {canManageCatalog && (
                                  <>
                                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                                      <input className="input" placeholder="Qty from" value={tierDraft.quantity} onChange={(e) => setTierDrafts((c) => ({ ...c, [product.id]: { ...tierDraft, quantity: e.target.value } }))} />
                                      <input className="input" placeholder="Recom. Price" value={tierDraft.unit_price_recommended} onChange={(e) => setTierDrafts((c) => ({ ...c, [product.id]: { ...tierDraft, unit_price_recommended: e.target.value } }))} />
                                      <input className="input" placeholder="Purchase Price" value={tierDraft.unit_purchase_price} onChange={(e) => setTierDrafts((c) => ({ ...c, [product.id]: { ...tierDraft, unit_purchase_price: e.target.value } }))} />
                                      <input className="input" placeholder="Currency" value={tierDraft.currency} onChange={(e) => setTierDrafts((c) => ({ ...c, [product.id]: { ...tierDraft, currency: e.target.value } }))} />
                                      <button onClick={() => void addTier(product.id)} disabled={savingTierForProductId === product.id} className="btn-primary">
                                        {savingTierForProductId === product.id ? '...' : 'Add Tier'}
                                      </button>
                                    </div>
                                    <input className="input mt-2" placeholder="Tier note" value={tierDraft.notes} onChange={(e) => setTierDrafts((c) => ({ ...c, [product.id]: { ...tierDraft, notes: e.target.value } }))} />
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDialog?.isOpen || false}
        title="Delete Price Tier"
        message="Are you sure you want to delete this price tier? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          if (confirmDialog) {
            void deleteTier(confirmDialog.productId, confirmDialog.tierId);
          }
        }}
        onCancel={() => setConfirmDialog(null)}
      />

      <ConfirmDialog
        isOpen={deleteProductDialog?.isOpen || false}
        title="Delete Product"
        message={deleteProductDialog ? `Permanently delete product "${deleteProductDialog.productName}" from database?` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          if (deleteProductDialog) {
            void deleteProduct(deleteProductDialog.productId);
          }
        }}
        onCancel={() => setDeleteProductDialog(null)}
      />

      {mergeDialog?.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">Merge Products</h3>
            <p className="text-sm text-text-muted mb-4">
              Select the target product to keep. All other selected products will be merged into it.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Target Product (keep this one):</label>
              <select
                className="input w-full"
                value={mergeDialog.targetId || ''}
                onChange={(e) => setMergeDialog({ ...mergeDialog, targetId: parseInt(e.target.value) })}
              >
                {selectedForMerge.map((id) => {
                  const product = products.find((p) => p.id === id);
                  return product ? (
                    <option key={`merge-target-${id}`} value={id}>
                      {product.nazwa} {product.sku ? `(${product.sku})` : ''}
                    </option>
                  ) : null;
                })}
              </select>
            </div>

            <div className="space-y-3 mb-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mergeDialog.transferStock}
                  onChange={(e) => setMergeDialog({ ...mergeDialog, transferStock: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Transfer stock levels to target product</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mergeDialog.deactivateSources}
                  onChange={(e) => setMergeDialog({ ...mergeDialog, deactivateSources: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Deactivate source products (recommended)</span>
              </label>
            </div>

            <div className="bg-gray-50 rounded p-3 mb-6 text-sm">
              <p className="font-medium mb-1">Summary:</p>
              <p>Target: {products.find((p) => p.id === mergeDialog.targetId)?.nazwa || '-'}</p>
              <p>Products to merge: {selectedForMerge.filter((id) => id !== mergeDialog.targetId).length}</p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setMergeDialog(null)}
                className="btn-secondary"
                disabled={merging}
              >
                Cancel
              </button>
              <button
                onClick={executeMerge}
                disabled={merging}
                className="btn-primary"
              >
                {merging ? 'Merging...' : 'Merge Products'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
