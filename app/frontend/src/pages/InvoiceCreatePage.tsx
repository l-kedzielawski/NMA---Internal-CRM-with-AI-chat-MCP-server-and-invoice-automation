import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, RefreshCw } from 'lucide-react';
import { costsApi, customersApi, invoicesApi, opiekunowieApi, productsApi } from '../services/api';
import type { Customer, InvoiceGroup, Opiekun, Product } from '../types';
import toast from 'react-hot-toast';

interface InvoiceItemDraft {
  product_id: string;
  nazwa: string;
  ilosc: string;
  jednostka: string;
  cena_netto: string;
  stawka_vat: string;
  cena_zakupu: string;
  is_shipping: boolean;
}

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

function toNumber(value: string, fallback = 0): number {
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getOpiekunDisplayName(opiekun: Opiekun): string {
  const fullName = [opiekun.imie, opiekun.nazwisko || ''].join(' ').trim();
  if (fullName) {
    return `${fullName} (${Number(opiekun.marza_procent).toFixed(0)}%)`;
  }
  return `${opiekun.imie} (${Number(opiekun.marza_procent).toFixed(0)}%)`;
}

export function InvoiceCreatePage() {
  const navigate = useNavigate();

  const [saving, setSaving] = useState(false);
  const [loadingNextNumber, setLoadingNextNumber] = useState(false);
  const [customInvoiceNumber, setCustomInvoiceNumber] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [opiekunowie, setOpiekunowie] = useState<Opiekun[]>([]);
  const [invoiceGroups, setInvoiceGroups] = useState<InvoiceGroup[]>([]);

  const [invoice, setInvoice] = useState({
    numer_faktury: '',
    data_wystawienia: new Date().toISOString().slice(0, 10),
    data_sprzedazy: new Date().toISOString().slice(0, 10),
    termin_platnosci: '',
    forma_platnosci: 'przelew',
    waluta: 'PLN',
    kurs_waluty: '1',
    status_platnosci: 'nieoplacona' as 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot',
    zaplacono: '0',
    koszt_logistyki: '0',
    opiekun_id: '',
    invoice_group_id: '',
    uwagi: ''
  });

  const [customer, setCustomer] = useState({
    selected_id: '',
    nazwa: '',
    nip: '',
    ulica: '',
    kod_pocztowy: '',
    miasto: '',
    kraj: 'Polska',
    email: '',
    telefon: ''
  });

  const [items, setItems] = useState<InvoiceItemDraft[]>([
    {
      product_id: '',
      nazwa: '',
      ilosc: '1',
      jednostka: 'szt',
      cena_netto: '0',
      stawka_vat: '23',
      cena_zakupu: '',
      is_shipping: false
    }
  ]);

  useEffect(() => {
    void Promise.all([loadProducts(), loadCustomers(), loadOpiekunowie(), loadInvoiceGroups()]);
  }, []);

  useEffect(() => {
    if (customInvoiceNumber && invoice.numer_faktury.trim()) return;
    void suggestNextInvoiceNumber(invoice.data_wystawienia, true);
  }, [invoice.data_wystawienia]);

  const suggestNextInvoiceNumber = async (dateValue?: string, silent = false) => {
    try {
      setLoadingNextNumber(true);
      const response = await invoicesApi.getNextNumber({ date: dateValue || invoice.data_wystawienia });
      const nextNumber = response.data.number;
      if (!nextNumber) return;

      setInvoice((current) => ({
        ...current,
        numer_faktury: nextNumber,
      }));
      setCustomInvoiceNumber(false);
    } catch (nextNumberError) {
      console.error('Error suggesting next invoice number:', nextNumberError);
      if (!silent) {
        toast.error('Failed to generate next invoice number');
      }
    } finally {
      setLoadingNextNumber(false);
    }
  };

  const loadProducts = async () => {
    const response = await productsApi.getAll();
    setProducts(response.data || []);
  };

  const loadCustomers = async () => {
    const response = await customersApi.getAll();
    setCustomers(response.data || []);
  };

  const loadOpiekunowie = async () => {
    const response = await opiekunowieApi.getAll(false);
    setOpiekunowie(response.data || []);
  };

  const loadInvoiceGroups = async () => {
    const response = await costsApi.getGroups();
    setInvoiceGroups(response.data.data || []);
  };

  const totals = useMemo(() => {
    const net = items.reduce((sum, item) => sum + toNumber(item.ilosc) * toNumber(item.cena_netto), 0);
    const vat = items.reduce(
      (sum, item) => sum + (toNumber(item.ilosc) * toNumber(item.cena_netto) * toNumber(item.stawka_vat, 23)) / 100,
      0
    );
    const gross = net + vat;
    return {
      net,
      vat,
      gross
    };
  }, [items]);

  const invoiceCurrency = useMemo(() => {
    const normalized = invoice.waluta.trim().toUpperCase();
    return normalized || 'PLN';
  }, [invoice.waluta]);

  const exchangeRateToPln = useMemo(() => {
    if (invoiceCurrency === 'PLN') return 1;
    const parsed = toNumber(invoice.kurs_waluty, 0);
    return parsed > 0 ? parsed : 0;
  }, [invoice.kurs_waluty, invoiceCurrency]);

  const totalsInPln = useMemo(() => {
    if (invoiceCurrency === 'PLN') return totals;
    if (exchangeRateToPln <= 0) return null;
    return {
      net: totals.net * exchangeRateToPln,
      vat: totals.vat * exchangeRateToPln,
      gross: totals.gross * exchangeRateToPln,
    };
  }, [exchangeRateToPln, invoiceCurrency, totals]);

  const addItem = () => {
    setItems((current) => [
      ...current,
      {
        product_id: '',
        nazwa: '',
        ilosc: '1',
        jednostka: 'szt',
        cena_netto: '0',
        stawka_vat: '23',
        cena_zakupu: '',
        is_shipping: false
      }
    ]);
  };

  const updateItem = (index: number, patch: Partial<InvoiceItemDraft>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, i) => i !== index));
  };

  const onSelectCustomer = (customerId: string) => {
    setCustomer((current) => ({ ...current, selected_id: customerId }));
    if (!customerId) return;

    const selected = customers.find((entry) => String(entry.id) === customerId);
    if (!selected) return;

    setCustomer({
      selected_id: customerId,
      nazwa: selected.nazwa || '',
      nip: selected.nip || '',
      ulica: selected.ulica || '',
      kod_pocztowy: selected.kod_pocztowy || '',
      miasto: selected.miasto || '',
      kraj: selected.kraj || 'Polska',
      email: selected.email || '',
      telefon: selected.telefon || ''
    });
  };

  const onSelectProduct = (index: number, productId: string) => {
    const selected = products.find((product) => String(product.id) === productId);
    if (!selected) {
      updateItem(index, { product_id: '', nazwa: '' });
      return;
    }

    updateItem(index, {
      product_id: productId,
      nazwa: selected.nazwa,
      jednostka: selected.jednostka || 'szt',
      stawka_vat: selected.stawka_vat !== null ? String(selected.stawka_vat) : '23',
      cena_zakupu: selected.cena_zakupu !== null ? String(selected.cena_zakupu) : ''
    });
  };

  const createInvoice = async (openDetails = true) => {
    if (!invoice.numer_faktury.trim()) {
      setError('Invoice number is required.');
      return;
    }
    if (!customer.nazwa.trim()) {
      setError('Customer name is required.');
      return;
    }
    if (items.length === 0) {
      setError('Add at least one item.');
      return;
    }

    for (const [idx, item] of items.entries()) {
      if (!item.nazwa.trim()) {
        setError(`Item ${idx + 1}: product name is required.`);
        return;
      }
      if (toNumber(item.ilosc) <= 0) {
        setError(`Item ${idx + 1}: quantity must be greater than 0.`);
        return;
      }
    }

    const normalizedCurrency = invoice.waluta.trim().toUpperCase() || 'PLN';
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      setError('Currency must be a 3-letter ISO code (e.g. PLN, EUR, HUF).');
      return;
    }

    const normalizedRate = normalizedCurrency === 'PLN' ? 1 : toNumber(invoice.kurs_waluty, NaN);
    if (normalizedCurrency !== 'PLN' && (!Number.isFinite(normalizedRate) || normalizedRate <= 0)) {
      setError('For non-PLN invoices, set a valid exchange rate to PLN (PLN for 1 unit).');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const response = await invoicesApi.create({
        numer_faktury: invoice.numer_faktury.trim(),
        data_wystawienia: invoice.data_wystawienia || null,
        data_sprzedazy: invoice.data_sprzedazy || null,
        termin_platnosci: invoice.termin_platnosci || null,
        forma_platnosci: invoice.forma_platnosci || null,
        waluta: normalizedCurrency,
        kurs_waluty: normalizedRate,
        status_platnosci: invoice.status_platnosci,
        zaplacono: toNumber(invoice.zaplacono, 0),
        koszt_logistyki: toNumber(invoice.koszt_logistyki, 0),
        opiekun_id: invoice.opiekun_id ? parseInt(invoice.opiekun_id, 10) : null,
        invoice_group_id: invoice.invoice_group_id ? parseInt(invoice.invoice_group_id, 10) : null,
        uwagi: invoice.uwagi || null,
        customer_id: customer.selected_id ? parseInt(customer.selected_id, 10) : null,
        customer: customer.selected_id
          ? undefined
          : {
              nazwa: customer.nazwa.trim(),
              nip: customer.nip.trim() || null,
              ulica: customer.ulica.trim() || null,
              kod_pocztowy: customer.kod_pocztowy.trim() || null,
              miasto: customer.miasto.trim() || null,
              kraj: customer.kraj.trim() || 'Polska',
              email: customer.email.trim() || null,
              telefon: customer.telefon.trim() || null
            },
        items: items.map((item) => ({
          product_id: item.product_id ? parseInt(item.product_id, 10) : null,
          nazwa: item.nazwa.trim(),
          ilosc: toNumber(item.ilosc, 0),
          jednostka: item.jednostka || 'szt',
          cena_netto: toNumber(item.cena_netto, 0),
          stawka_vat: toNumber(item.stawka_vat, 23),
          cena_zakupu: item.cena_zakupu ? toNumber(item.cena_zakupu, 0) : null,
          is_shipping: item.is_shipping
        }))
      });

      const newId = response.data.id;
      toast.success('Invoice created successfully!');
      if (openDetails) {
        navigate(`/invoices/${newId}`);
      } else {
        navigate('/invoices');
      }
    } catch (createError: any) {
      console.error('Error creating invoice:', createError);
      const details = createError?.response?.data?.details;
      const errorMsg = createError?.response?.data?.error
        ? details
          ? `${createError.response.data.error}: ${details}`
          : createError.response.data.error
        : 'Failed to create invoice';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <button onClick={() => navigate('/invoices')} className="btn-secondary flex items-center gap-2">
          <ArrowLeft size={18} />
          Back to Invoices
        </button>
        <div className="flex gap-2">
          <button onClick={() => void createInvoice(true)} disabled={saving} className="btn-primary flex items-center gap-2">
            <Save size={18} />
            {saving ? 'Saving...' : 'Create Invoice'}
          </button>
        </div>
      </div>

      {error && <div className="card mb-4 bg-red-50 border-red-200 text-danger">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Invoice Data</h3>
            <p className="text-sm text-text-muted mb-3">
              Issue date is when invoice is created. Sale date is when goods/services were delivered.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Invoice Number</label>
                <div className="flex gap-2">
                  <input
                    className="input"
                    placeholder="Invoice Number"
                    value={invoice.numer_faktury}
                    onChange={(event) => {
                      setCustomInvoiceNumber(true);
                      setInvoice((current) => ({ ...current, numer_faktury: event.target.value }));
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void suggestNextInvoiceNumber(invoice.data_wystawienia)}
                    className="btn-secondary flex items-center gap-1 whitespace-nowrap"
                    disabled={loadingNextNumber}
                    title="Generate next invoice number"
                  >
                    <RefreshCw size={14} className={loadingNextNumber ? 'animate-spin' : ''} />
                    Next
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Issue Date</label>
                <input
                  type="date"
                  className="input"
                  value={invoice.data_wystawienia}
                  onChange={(event) => setInvoice((current) => ({ ...current, data_wystawienia: event.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Sale Date</label>
                <input
                  type="date"
                  className="input"
                  value={invoice.data_sprzedazy}
                  onChange={(event) => setInvoice((current) => ({ ...current, data_sprzedazy: event.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Payment Due Date</label>
                <input
                  type="date"
                  className="input"
                  value={invoice.termin_platnosci}
                  onChange={(event) => setInvoice((current) => ({ ...current, termin_platnosci: event.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Payment Method</label>
                <select
                  className="input"
                  value={invoice.forma_platnosci}
                  onChange={(event) => setInvoice((current) => ({ ...current, forma_platnosci: event.target.value }))}
                >
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <option key={`payment-method-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Invoice Manager</label>
                <select
                  className="input"
                  value={invoice.opiekun_id}
                  onChange={(event) => setInvoice((current) => ({ ...current, opiekun_id: event.target.value }))}
                >
                  <option value="">No Invoice Manager</option>
                  {opiekunowie.map((opiekun) => (
                    <option key={opiekun.id} value={opiekun.id}>
                      {getOpiekunDisplayName(opiekun)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Invoice Group</label>
                <select
                  className="input"
                  value={invoice.invoice_group_id}
                  onChange={(event) => setInvoice((current) => ({ ...current, invoice_group_id: event.target.value }))}
                >
                  <option value="">No Group</option>
                  {invoiceGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Currency</label>
                <input
                  className="input"
                  placeholder="PLN / EUR / HUF"
                  value={invoice.waluta}
                  onChange={(event) =>
                    setInvoice((current) => ({ ...current, waluta: event.target.value.toUpperCase() }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Rate to PLN (1 currency unit)</label>
                <input
                  className="input"
                  placeholder="e.g. 0.0108 for HUF"
                  value={invoice.kurs_waluty}
                  onChange={(event) => setInvoice((current) => ({ ...current, kurs_waluty: event.target.value }))}
                  disabled={invoiceCurrency === 'PLN'}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Customer</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select className="input md:col-span-2" value={customer.selected_id} onChange={(event) => onSelectCustomer(event.target.value)}>
                <option value="">New customer (enter details manually)</option>
                {customers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.nazwa} {entry.nip ? `(${entry.nip})` : ''}
                  </option>
                ))}
              </select>
              <input className="input" placeholder="Name" value={customer.nazwa} onChange={(e) => setCustomer((c) => ({ ...c, nazwa: e.target.value }))} />
              <input className="input" placeholder="Tax ID" value={customer.nip} onChange={(e) => setCustomer((c) => ({ ...c, nip: e.target.value }))} />
              <input className="input" placeholder="Street" value={customer.ulica} onChange={(e) => setCustomer((c) => ({ ...c, ulica: e.target.value }))} />
              <input className="input" placeholder="Postal Code" value={customer.kod_pocztowy} onChange={(e) => setCustomer((c) => ({ ...c, kod_pocztowy: e.target.value }))} />
              <input className="input" placeholder="City" value={customer.miasto} onChange={(e) => setCustomer((c) => ({ ...c, miasto: e.target.value }))} />
              <input className="input" placeholder="Country" value={customer.kraj} onChange={(e) => setCustomer((c) => ({ ...c, kraj: e.target.value }))} />
              <input className="input" placeholder="Email" value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} />
              <input className="input" placeholder="Phone" value={customer.telefon} onChange={(e) => setCustomer((c) => ({ ...c, telefon: e.target.value }))} />
            </div>
          </div>

          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Invoice Items</h3>
              <button onClick={addItem} className="btn-secondary flex items-center gap-2">
                <Plus size={16} /> Add Item
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={`item-${index}`} className="p-3 border border-border rounded-lg bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                    <select className="input" value={item.product_id} onChange={(event) => onSelectProduct(index, event.target.value)}>
                      <option value="">Select Product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.nazwa}
                        </option>
                      ))}
                    </select>
                    <input className="input md:col-span-2" placeholder="Item Name" value={item.nazwa} onChange={(event) => updateItem(index, { nazwa: event.target.value })} />
                    <input className="input" placeholder="Quantity" value={item.ilosc} onChange={(event) => updateItem(index, { ilosc: event.target.value })} />
                    <input className="input" placeholder="Unit" value={item.jednostka} onChange={(event) => updateItem(index, { jednostka: event.target.value })} />
                    <input className="input" placeholder="Net Price" value={item.cena_netto} onChange={(event) => updateItem(index, { cena_netto: event.target.value })} />
                    <div className="flex gap-2">
                      <input className="input" placeholder="VAT %" value={item.stawka_vat} onChange={(event) => updateItem(index, { stawka_vat: event.target.value })} />
                      <button
                        onClick={() => removeItem(index)}
                        disabled={items.length === 1}
                        className="btn-danger"
                        title="Remove Item"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <input className="input" placeholder="Purchase Price (optional)" value={item.cena_zakupu} onChange={(event) => updateItem(index, { cena_zakupu: event.target.value })} />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={item.is_shipping} onChange={(event) => updateItem(index, { is_shipping: event.target.checked })} />
                      Shipping Cost
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Net</span>
                <span className="font-medium">{totals.net.toFixed(2)} {invoiceCurrency}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT</span>
                <span className="font-medium">{totals.vat.toFixed(2)} {invoiceCurrency}</span>
              </div>
              <div className="flex justify-between text-base pt-2 border-t border-border">
                <span className="font-semibold">Gross</span>
                <span className="font-bold">{totals.gross.toFixed(2)} {invoiceCurrency}</span>
              </div>
              {invoiceCurrency !== 'PLN' && totalsInPln ? (
                <div className="text-xs text-text-muted pt-2 border-t border-border">
                  Approx in PLN: net {totalsInPln.net.toFixed(2)}, VAT {totalsInPln.vat.toFixed(2)}, gross {totalsInPln.gross.toFixed(2)} (rate {exchangeRateToPln.toFixed(6)})
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-3">Payment</h3>
            <div className="space-y-3">
              <input
                className="input"
                placeholder="Logistics Cost"
                value={invoice.koszt_logistyki}
                onChange={(event) => setInvoice((current) => ({ ...current, koszt_logistyki: event.target.value }))}
              />
              <input
                className="input"
                placeholder="Amount Paid"
                value={invoice.zaplacono}
                onChange={(event) => setInvoice((current) => ({ ...current, zaplacono: event.target.value }))}
              />
              <select
                className="input"
                value={invoice.status_platnosci}
                onChange={(event) =>
                  setInvoice((current) => ({
                    ...current,
                    status_platnosci: event.target.value as 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot'
                  }))
                }
              >
                <option value="nieoplacona">Unpaid</option>
                <option value="czesciowa">Partial</option>
                <option value="oplacona">Paid</option>
                <option value="zwrot">Refund</option>
              </select>
              <textarea
                className="input min-h-24"
                placeholder="Notes"
                value={invoice.uwagi}
                onChange={(event) => setInvoice((current) => ({ ...current, uwagi: event.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
