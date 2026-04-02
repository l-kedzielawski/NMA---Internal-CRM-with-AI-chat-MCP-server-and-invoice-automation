import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit2, Trash2, CheckCircle, XCircle, Download, Eye, RefreshCw } from 'lucide-react';
import { costsApi, invoicesApi, invoiceItemsApi, opiekunowieApi } from '../services/api';
import type { Invoice, InvoiceGroup, InvoiceItem, Opiekun } from '../types';
import { LoadingState } from '../components/LoadingState';
import toast from 'react-hot-toast';

interface PaymentMethodOption {
  value: 'przelew' | 'pobranie' | 'karta' | 'gotowka';
  label: string;
}

const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { value: 'przelew', label: 'Transfer' },
  { value: 'pobranie', label: 'COD' },
  { value: 'karta', label: 'Card' },
  { value: 'gotowka', label: 'Cash' },
];

function getOpiekunDisplayName(opiekun: Opiekun): string {
  const fullName = [opiekun.imie, opiekun.nazwisko || ''].join(' ').trim();
  if (fullName) {
    return `${fullName} (${Number(opiekun.marza_procent).toFixed(0)}%)`;
  }
  return `${opiekun.imie} (${Number(opiekun.marza_procent).toFixed(0)}%)`;
}

function getPaymentMethodLabel(value: string | null): string {
  const match = PAYMENT_METHOD_OPTIONS.find((option) => option.value === value);
  if (match) return match.label;
  return value || '-';
}

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [opiekunowie, setOpiekunowie] = useState<Opiekun[]>([]);
  const [invoiceGroups, setInvoiceGroups] = useState<InvoiceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [recalculatingInvoice, setRecalculatingInvoice] = useState(false);
  const [rebuildingTotals, setRebuildingTotals] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (id) {
      loadInvoice(parseInt(id));
      loadOpiekunowie();
      loadInvoiceGroups();
    }
  }, [id]);

  const loadInvoice = async (invoiceId: number) => {
    try {
      setLoading(true);
      const response = await invoicesApi.getById(invoiceId);
      setInvoice(response.data);
    } catch (error) {
      console.error('Error loading invoice:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadOpiekunowie = async () => {
    try {
      const response = await opiekunowieApi.getAll(false);
      setOpiekunowie(response.data);
    } catch (error) {
      console.error('Error loading opiekunowie:', error);
    }
  };

  const loadInvoiceGroups = async () => {
    try {
      const response = await costsApi.getGroups();
      setInvoiceGroups(response.data.data || []);
    } catch (error) {
      console.error('Error loading invoice groups:', error);
    }
  };

  const handleUpdateOpiekun = async (opiekunId: string) => {
    if (!invoice) return;
    try {
      const opiekun_id = opiekunId ? parseInt(opiekunId) : null;
      await invoicesApi.update(invoice.id, { opiekun_id });
      // Reload to get updated data including prowizja
      loadInvoice(invoice.id);
    } catch (error) {
      console.error('Error updating opiekun:', error);
    }
  };

  const handleUpdateStatus = async (status: 'oplacona' | 'nieoplacona') => {
    if (!invoice) return;
    try {
      await invoicesApi.update(invoice.id, { status_platnosci: status });
      setInvoice({ ...invoice, status_platnosci: status });
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleUpdateInvoiceGroup = async (invoiceGroupId: string) => {
    if (!invoice) return;
    try {
      const invoice_group_id = invoiceGroupId ? parseInt(invoiceGroupId, 10) : null;
      await invoicesApi.update(invoice.id, { invoice_group_id });
      setInvoice({
        ...invoice,
        invoice_group_id,
        invoice_group_name: invoice_group_id
          ? invoiceGroups.find((group) => group.id === invoice_group_id)?.name || null
          : null,
      });
      toast.success('Invoice group updated');
    } catch (error) {
      console.error('Error updating invoice group:', error);
      toast.error('Failed to update invoice group');
    }
  };

  const handleUpdateLogistics = async (koszt_logistyki: number) => {
    if (!invoice) return;
    try {
      await invoicesApi.update(invoice.id, { koszt_logistyki });
      setInvoice({ ...invoice, koszt_logistyki });
      loadInvoice(invoice.id);
    } catch (error) {
      console.error('Error updating logistics cost:', error);
    }
  };

  const handleUpdatePaymentMethod = async (paymentMethod: string) => {
    if (!invoice) return;
    try {
      await invoicesApi.update(invoice.id, { forma_platnosci: paymentMethod });
      setInvoice({ ...invoice, forma_platnosci: paymentMethod });
    } catch (error) {
      console.error('Error updating payment method:', error);
      toast.error('Failed to update payment method');
    }
  };

  const handleUpdateCurrencyAndRate = async (currencyRaw: string, rateRaw: string) => {
    if (!invoice) return;

    const currency = currencyRaw.trim().toUpperCase() || 'PLN';
    if (!/^[A-Z]{3}$/.test(currency)) {
      toast.error('Currency must be a 3-letter ISO code (e.g. PLN, EUR, HUF)');
      return;
    }

    const rate = currency === 'PLN' ? 1 : Number(String(rateRaw).replace(',', '.'));
    if (currency !== 'PLN' && (!Number.isFinite(rate) || rate <= 0)) {
      toast.error('Set valid exchange rate to PLN for non-PLN invoices');
      return;
    }

    try {
      await invoicesApi.update(invoice.id, {
        waluta: currency,
        kurs_waluty: rate,
      });
      toast.success('Currency updated and invoice recalculated');
      await loadInvoice(invoice.id);
    } catch (error) {
      console.error('Error updating invoice currency:', error);
      toast.error('Failed to update invoice currency');
    }
  };

  const handleDeleteInvoice = async () => {
    if (!invoice) return;
    if (!confirm(`Are you sure you want to delete invoice ${invoice.numer_faktury}?`)) return;
    
    try {
      setDeleting(true);
      await invoicesApi.delete(invoice.id);
      navigate('/invoices');
    } catch (error) {
      console.error('Error deleting invoice:', error);
      alert('Error deleting invoice');
    } finally {
      setDeleting(false);
    }
  };

  const startEditingItem = (item: InvoiceItem) => {
    setEditingItem(item.id);
    setEditPrice(item.cena_zakupu?.toString() || '');
  };

  const saveItemPrice = async (itemId: number) => {
    try {
      setSaving(true);
      const price = parseFloat(editPrice);

      await invoiceItemsApi.update(itemId, { cena_zakupu: price });
      
      setEditingItem(null);
      if (invoice) {
        loadInvoice(invoice.id);
      }
    } catch (error) {
      console.error('Error updating item price:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculateInvoiceFromProducts = async () => {
    if (!invoice) return;

    try {
      setRecalculatingInvoice(true);
      const response = await invoicesApi.recalculateFromProducts(invoice.id);
      const result = response.data;

      toast.success(
        `Recalculated invoice. Synced prices: ${result.item_prices_backfilled}, updated items: ${result.items_recalculated}`
      );

      await loadInvoice(invoice.id);
    } catch (error) {
      console.error('Error recalculating invoice from products:', error);
      toast.error('Failed to recalculate invoice from product prices');
    } finally {
      setRecalculatingInvoice(false);
    }
  };

  const handleRebuildTotalsFromItems = async () => {
    if (!invoice) return;

    try {
      setRebuildingTotals(true);
      const response = await invoicesApi.rebuildTotalsFromItems(invoice.id);
      const result = response.data;
      toast.success(
        `Totals rebuilt (Net ${result.previous_totals.netto.toFixed(2)} -> ${result.rebuilt_totals.netto.toFixed(2)} ${invoice.waluta || 'PLN'})`
      );
      await loadInvoice(invoice.id);
    } catch (error) {
      console.error('Error rebuilding invoice totals:', error);
      toast.error('Failed to rebuild invoice totals from items');
    } finally {
      setRebuildingTotals(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('pl-PL');
  };

  const formatMoney = (amount: number | string | null | undefined, currency = 'PLN') => {
    if (amount === null || amount === undefined) return '-';
    return `${Number(amount).toFixed(2)} ${currency}`;
  };

  const getInvoiceCurrency = () => String(invoice?.waluta || 'PLN').trim().toUpperCase();

  const getFxRateToPln = (): number | null => {
    const currency = getInvoiceCurrency();
    if (currency === 'PLN') return 1;
    const rate = Number(invoice?.kurs_waluty || 0);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  };

  const renderDualMoney = (amount: number | string | null | undefined, currency: string) => {
    const invoiceCurrency = currency.trim().toUpperCase() || 'PLN';
    const rateToPln = getFxRateToPln();
    const numericAmount = amount === null || amount === undefined ? null : Number(amount);

    if (numericAmount === null || Number.isNaN(numericAmount)) {
      return <span>-</span>;
    }

    if (invoiceCurrency === 'PLN') {
      return <span>{formatMoney(numericAmount, 'PLN')}</span>;
    }

    const plnAmount = rateToPln ? Number((numericAmount * rateToPln).toFixed(2)) : null;

    return (
      <div>
        <div>{formatMoney(numericAmount, invoiceCurrency)}</div>
        <div className="text-xs text-text-muted">~ {plnAmount !== null ? formatMoney(plnAmount, 'PLN') : 'Set FX rate'}</div>
      </div>
    );
  };

  const handleOpenPdf = async () => {
    if (!invoice) return;
    try {
      const response = await invoicesApi.getPdf(invoice.id);
      const blobUrl = window.URL.createObjectURL(response.data);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      console.error('Error opening invoice PDF:', error);
      toast.error('Could not open invoice PDF');
    }
  };

  const handleDownloadPdf = async () => {
    if (!invoice) return;
    try {
      const response = await invoicesApi.downloadPdf(invoice.id);
      const blobUrl = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${invoice.numer_faktury || 'invoice'}.pdf`;
      anchor.click();
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30_000);
    } catch (error) {
      console.error('Error downloading invoice PDF:', error);
      toast.error('Could not download invoice PDF');
    }
  };

  if (loading) {
    return <LoadingState message="Loading invoice details..." />;
  }

  if (!invoice) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted">Invoice not found</p>
        <button onClick={() => navigate('/invoices')} className="btn-primary mt-4">
          Back to List
        </button>
      </div>
    );
  }

  return (
    <div className="invoice-print-page">
      <div className="no-print flex justify-between items-center mb-6">
        <button
          onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-text-muted hover:text-text"
        >
          <ArrowLeft size={20} />
          Back to List
        </button>
        <div className="flex items-center gap-2">
          {invoice.pdf_path && (
            <>
              <button onClick={handleOpenPdf} className="btn-secondary flex items-center gap-2">
                <Eye size={18} />
                View PDF
              </button>
              <button onClick={handleDownloadPdf} className="btn-secondary flex items-center gap-2">
                <Download size={18} />
                Download PDF
              </button>
            </>
          )}
          <button
            onClick={handleDeleteInvoice}
            disabled={deleting}
            className="btn-danger flex items-center gap-2"
          >
            <Trash2 size={18} />
            {deleting ? 'Deleting...' : 'Delete Invoice'}
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="card mb-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold mb-2">{invoice.numer_faktury}</h2>
            <p className="text-text-muted">{invoice.customer_nazwa}</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-text-muted">Total Profit</div>
            <div className={`text-3xl font-bold ${invoice.zysk && Number(invoice.zysk) >= 0 ? 'text-success' : 'text-danger'}`}>
              {formatMoney(invoice.zysk, 'PLN')}
            </div>
            <div className="text-sm text-text-muted mt-1">
              Margin: {invoice.marza_procent != null ? Number(invoice.marza_procent).toFixed(2) : '-'}%
            </div>
            <div className="text-xs text-text-muted mt-1">
              Invoice currency: {getInvoiceCurrency()} @ {Number(invoice.kurs_waluty || 1).toFixed(6)} PLN
            </div>
            {invoice.prowizja_opiekuna && Number(invoice.prowizja_opiekuna) > 0 && (
              <div className="text-sm text-primary mt-1">
                Sales Commission: {formatMoney(invoice.prowizja_opiekuna, 'PLN')}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="text-sm text-text-muted">Issue Date</label>
            <p className="font-medium">{formatDate(invoice.data_wystawienia)}</p>
          </div>
          <div>
            <label className="text-sm text-text-muted">Payment Deadline</label>
            <p className="font-medium">{formatDate(invoice.termin_platnosci)}</p>
          </div>
          <div>
            <label className="text-sm text-text-muted">Payment Method</label>
            <select
              className="input mt-1 no-print"
              value={invoice.forma_platnosci || 'przelew'}
              onChange={(e) => handleUpdatePaymentMethod(e.target.value)}
            >
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={`invoice-payment-method-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="print-only font-medium">{getPaymentMethodLabel(invoice.forma_platnosci)}</p>
          </div>
          <div>
            <label className="text-sm text-text-muted">Currency</label>
            <div className="no-print mt-1 flex gap-2">
              <input
                className="input w-24"
                value={(invoice.waluta || 'PLN').toUpperCase()}
                onChange={(event) =>
                  setInvoice({
                    ...invoice,
                    waluta: event.target.value.toUpperCase(),
                  })
                }
              />
              <input
                className="input w-40"
                value={String(invoice.kurs_waluty ?? 1)}
                onChange={(event) =>
                  setInvoice({
                    ...invoice,
                    kurs_waluty: Number(String(event.target.value).replace(',', '.')) || 0,
                  })
                }
                disabled={(invoice.waluta || 'PLN').toUpperCase() === 'PLN'}
              />
              <button
                className="btn-secondary"
                onClick={() => void handleUpdateCurrencyAndRate(String(invoice.waluta || 'PLN'), String(invoice.kurs_waluty ?? 1))}
              >
                Save FX
              </button>
            </div>
            <p className="print-only font-medium">
              {(invoice.waluta || 'PLN').toUpperCase()} @ {Number(invoice.kurs_waluty || 1).toFixed(6)} PLN
            </p>
          </div>
          <div>
            <label className="text-sm text-text-muted">Payment Status</label>
            <div className="no-print flex gap-2 mt-1">
              <button
                onClick={() => handleUpdateStatus('oplacona')}
                className={`flex items-center gap-1 px-3 py-1 rounded text-sm ${
                  invoice.status_platnosci === 'oplacona'
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-green-50'
                }`}
              >
                <CheckCircle size={16} />
                Paid
              </button>
              <button
                onClick={() => handleUpdateStatus('nieoplacona')}
                className={`flex items-center gap-1 px-3 py-1 rounded text-sm ${
                  invoice.status_platnosci === 'nieoplacona'
                    ? 'bg-red-100 text-red-700 border border-red-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-red-50'
                }`}
              >
                <XCircle size={16} />
                Unpaid
              </button>
            </div>
            <p className="print-only font-medium">{invoice.status_platnosci}</p>
          </div>
          <div>
            <label className="text-sm text-text-muted">Invoice Manager</label>
            <select
              className="input mt-1 no-print"
              value={invoice.opiekun_id || ''}
              onChange={(e) => handleUpdateOpiekun(e.target.value)}
            >
                <option value="">Select...</option>
                {opiekunowie.map((o) => (
                  <option key={o.id} value={o.id}>
                    {getOpiekunDisplayName(o)}
                  </option>
                ))}
            </select>
            <p className="print-only font-medium">{invoice.opiekun || '-'}</p>
          </div>
          <div>
            <label className="text-sm text-text-muted">Invoice Group</label>
            <select
              className="input mt-1 no-print"
              value={invoice.invoice_group_id || ''}
              onChange={(e) => handleUpdateInvoiceGroup(e.target.value)}
            >
              <option value="">No Group</option>
              {invoiceGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <p className="print-only font-medium">{invoice.invoice_group_name || '-'}</p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-4">
            <label className="text-sm text-text-muted whitespace-nowrap">Logistics Cost:</label>
            <input
              type="number"
              step="0.01"
              className="input w-40 no-print"
              value={invoice.koszt_logistyki || ''}
              onChange={(e) => handleUpdateLogistics(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
            <span className="text-sm text-text-muted">PLN</span>
            <span className="print-only font-medium">{formatMoney(invoice.koszt_logistyki, 'PLN')}</span>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Invoice Items</h3>
        <p className="text-sm text-text-muted mb-3 no-print">
          Updating purchase price here also updates the linked product purchase price.
        </p>
        <div className="no-print mb-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleRecalculateInvoiceFromProducts}
              disabled={recalculatingInvoice}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={16} className={recalculatingInvoice ? 'animate-spin' : ''} />
              {recalculatingInvoice ? 'Recalculating...' : 'Recalculate from Product Prices'}
            </button>
            <button
              onClick={handleRebuildTotalsFromItems}
              disabled={rebuildingTotals}
              className="btn-secondary"
            >
              {rebuildingTotals ? 'Rebuilding...' : 'Rebuild Totals from Items'}
            </button>
          </div>
        </div>
        
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Quantity</th>
                <th>Net Price</th>
                <th>Net Value</th>
                <th>Purchase Price</th>
                <th>Profit</th>
                <th>Margin</th>
                <th className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((item) => (
                <tr key={item.id}>
                  <td>{item.lp}</td>
                  <td>
                    <div className="font-medium">{item.nazwa}</div>
                    {item.product_sku && (
                      <div className="text-xs text-text-muted">SKU: {item.product_sku}</div>
                    )}
                  </td>
                  <td>{Number(item.ilosc)} {item.jednostka}</td>
                  <td>{renderDualMoney(item.cena_netto, invoice.waluta || 'PLN')}</td>
                  <td>{renderDualMoney(item.wartosc_netto, invoice.waluta || 'PLN')}</td>
                  <td>
                    {editingItem === item.id ? (
                      <input
                        type="number"
                        step="0.01"
                        className="input w-28 no-print"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <span className={item.cena_zakupu ? '' : 'text-warning font-medium'}>
                        {item.cena_zakupu ? formatMoney(item.cena_zakupu, 'PLN') : 'No Price'}
                      </span>
                    )}
                  </td>
                  <td className={item.zysk && Number(item.zysk) >= 0 ? 'text-success' : 'text-danger'}>
                    {formatMoney(item.zysk, 'PLN')}
                  </td>
                  <td>{item.marza_procent != null ? Number(item.marza_procent).toFixed(2) : '-'}%</td>
                  <td className="no-print">
                    {editingItem === item.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveItemPrice(item.id)}
                          disabled={saving}
                          className="btn-primary text-xs px-2 py-1"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditingItem(item)}
                        className="text-primary hover:text-blue-700"
                      >
                        <Edit2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="card mt-6">
        <div className="flex justify-between items-center">
          <div className="grid grid-cols-3 gap-8">
              <div>
                <div className="text-sm text-text-muted">Net</div>
                <div className="text-lg font-semibold">{renderDualMoney(invoice.netto, invoice.waluta || 'PLN')}</div>
              </div>
              <div>
                <div className="text-sm text-text-muted">VAT</div>
                <div className="text-lg font-semibold">{renderDualMoney(invoice.vat, invoice.waluta || 'PLN')}</div>
              </div>
              <div>
                <div className="text-sm text-text-muted">Gross</div>
                <div className="text-lg font-semibold">{renderDualMoney(invoice.brutto, invoice.waluta || 'PLN')}</div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}
