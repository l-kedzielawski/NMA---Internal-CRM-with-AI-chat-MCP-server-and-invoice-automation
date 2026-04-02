import { useEffect, useMemo, useState } from 'react';
import { Plus, ReceiptText, Upload, Pencil, Trash2, Paperclip, Download, X } from 'lucide-react';
import { costsApi, invoicesApi } from '../services/api';
import type {
  CostDocument,
  CostDocumentParseResult,
  CostEntry,
  CostSummaryResponse,
  Invoice,
  InvoiceGroup,
} from '../types';
import { formatDate, formatMoney } from '../utils/formatters';
import toast from 'react-hot-toast';

interface CostFormState {
  id: number | null;
  title: string;
  cost_date: string;
  amount_original: string;
  currency: string;
  exchange_rate_to_pln: string;
  invoice_group_id: string;
  notes: string;
  linked_invoice_ids: number[];
  documents: CostDocument[];
  new_document_file: File | null;
  parse_preview: CostDocumentParseResult | null;
}

function createDefaultForm(initialGroupId?: string): CostFormState {
  return {
    id: null,
    title: '',
    cost_date: new Date().toISOString().slice(0, 10),
    amount_original: '',
    currency: 'PLN',
    exchange_rate_to_pln: '1',
    invoice_group_id: initialGroupId || '',
    notes: '',
    linked_invoice_ids: [],
    documents: [],
    new_document_file: null,
    parse_preview: null,
  };
}

export function CostsPage() {
  const [groups, setGroups] = useState<InvoiceGroup[]>([]);
  const [costs, setCosts] = useState<CostEntry[]>([]);
  const [summary, setSummary] = useState<CostSummaryResponse | null>(null);
  const [linkableInvoices, setLinkableInvoices] = useState<Invoice[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingModalDetails, setLoadingModalDetails] = useState(false);
  const [parsingPreview, setParsingPreview] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<CostFormState>(createDefaultForm());

  const [filters, setFilters] = useState({
    search: '',
    date_from: '',
    date_to: '',
    group_id: '',
  });

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupCode, setNewGroupCode] = useState('');

  const groupFilterParam = useMemo<number | 'none' | undefined>(() => {
    if (!filters.group_id) return undefined;
    if (filters.group_id === 'none') return 'none';
    const parsed = Number(filters.group_id);
    if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
    return parsed;
  }, [filters.group_id]);

  const refreshData = async () => {
    try {
      setLoading(true);
      const [costsResponse, summaryResponse] = await Promise.all([
        costsApi.getAll({
          per_page: 100,
          search: filters.search || undefined,
          date_from: filters.date_from || undefined,
          date_to: filters.date_to || undefined,
          group_id: groupFilterParam,
        }),
        costsApi.getSummary({
          date_from: filters.date_from || undefined,
          date_to: filters.date_to || undefined,
          group_id: groupFilterParam,
        }),
      ]);

      setCosts(costsResponse.data.data || []);
      setSummary(summaryResponse.data);
    } catch (error) {
      console.error('Error loading costs page data:', error);
      toast.error('Failed to load costs data');
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      const response = await costsApi.getGroups();
      setGroups(response.data.data || []);
    } catch (error) {
      console.error('Error loading invoice groups:', error);
      toast.error('Failed to load invoice groups');
    }
  };

  const loadLinkableInvoices = async (groupId: string) => {
    try {
      const invoiceGroupFilter = !groupId
        ? undefined
        : Number.isInteger(Number(groupId))
          ? Number(groupId)
          : undefined;

      const response = await invoicesApi.getAll({
        page: 1,
        per_page: 100,
        invoice_group_id: invoiceGroupFilter,
      });
      setLinkableInvoices(response.data.data || []);
    } catch (error) {
      console.error('Error loading linkable invoices:', error);
      setLinkableInvoices([]);
    }
  };

  useEffect(() => {
    void loadGroups();
  }, []);

  useEffect(() => {
    void refreshData();
  }, [filters.search, filters.date_from, filters.date_to, groupFilterParam]);

  useEffect(() => {
    if (!isModalOpen) return;
    void loadLinkableInvoices(form.invoice_group_id);
  }, [isModalOpen, form.invoice_group_id]);

  const openCreateModal = () => {
    const preselectedGroup = Number.isInteger(Number(filters.group_id)) ? filters.group_id : '';
    setForm(createDefaultForm(preselectedGroup));
    setIsModalOpen(true);
  };

  const openEditModal = async (costId: number) => {
    try {
      setLoadingModalDetails(true);
      setIsModalOpen(true);
      const response = await costsApi.getById(costId);
      const cost = response.data;

      setForm({
        id: cost.id,
        title: cost.title,
        cost_date: cost.cost_date,
        amount_original: String(cost.amount_original ?? ''),
        currency: String(cost.currency || 'PLN').toUpperCase(),
        exchange_rate_to_pln: String(cost.exchange_rate_to_pln ?? 1),
        invoice_group_id: cost.invoice_group_id ? String(cost.invoice_group_id) : '',
        notes: cost.notes || '',
        linked_invoice_ids: (cost.linked_invoices || []).map((entry) => Number(entry.id)),
        documents: cost.documents || [],
        new_document_file: null,
        parse_preview: null,
      });
    } catch (error) {
      console.error('Error loading cost details:', error);
      toast.error('Failed to load cost details');
      setIsModalOpen(false);
    } finally {
      setLoadingModalDetails(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setForm(createDefaultForm());
    setParsingPreview(false);
    setLoadingModalDetails(false);
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast.error('Group name is required');
      return;
    }

    try {
      await costsApi.createGroup({
        name,
        code: newGroupCode.trim() || undefined,
      });
      toast.success('Group created');
      setNewGroupName('');
      setNewGroupCode('');
      await loadGroups();
    } catch (error: any) {
      console.error('Error creating group:', error);
      toast.error(error?.response?.data?.error || 'Failed to create group');
    }
  };

  const handleParsePreviewFromFile = async (file: File) => {
    try {
      setParsingPreview(true);
      const response = await costsApi.parsePreview(file);
      const parsed = response.data.parsed;

      setForm((current) => {
        const shouldUseSuggestedRate =
          (!current.exchange_rate_to_pln || current.exchange_rate_to_pln === '1')
          && parsed.suggested_exchange_rate_to_pln !== null;

        return {
          ...current,
          new_document_file: file,
          parse_preview: parsed,
          title: current.title || parsed.suggested_title || '',
          amount_original:
            current.amount_original || parsed.suggested_amount_original === null
              ? current.amount_original
              : String(parsed.suggested_amount_original),
          currency:
            current.currency === 'PLN' && parsed.suggested_currency
              ? parsed.suggested_currency
              : current.currency,
          exchange_rate_to_pln: shouldUseSuggestedRate
            ? String(parsed.suggested_exchange_rate_to_pln)
            : current.exchange_rate_to_pln,
          cost_date: current.cost_date || parsed.suggested_cost_date || current.cost_date,
        };
      });

      if (parsed.warnings.length > 0) {
        toast(`Parsed with ${parsed.warnings.length} warning(s)`);
      } else {
        toast.success('Document parsed successfully');
      }
    } catch (error: any) {
      console.error('Error parsing cost document:', error);
      toast.error(error?.response?.data?.error || 'Failed to parse document preview');
      setForm((current) => ({
        ...current,
        new_document_file: file,
        parse_preview: null,
      }));
    } finally {
      setParsingPreview(false);
    }
  };

  const handleSubmitCost = async (event: React.FormEvent) => {
    event.preventDefault();

    const normalizedCurrency = String(form.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      toast.error('Currency must be a 3-letter ISO code (e.g. PLN, EUR, HUF)');
      return;
    }

    const amountOriginal = Number(String(form.amount_original).replace(',', '.'));
    if (!Number.isFinite(amountOriginal) || amountOriginal <= 0) {
      toast.error('Amount must be greater than 0');
      return;
    }

    const exchangeRateToPln = normalizedCurrency === 'PLN'
      ? 1
      : Number(String(form.exchange_rate_to_pln).replace(',', '.'));
    if (normalizedCurrency !== 'PLN' && (!Number.isFinite(exchangeRateToPln) || exchangeRateToPln <= 0)) {
      toast.error('Set valid exchange rate to PLN for non-PLN costs');
      return;
    }

    if (!form.cost_date) {
      toast.error('Cost date is required');
      return;
    }

    const payload = {
      title: form.title.trim(),
      cost_date: form.cost_date,
      amount_original: amountOriginal,
      currency: normalizedCurrency,
      exchange_rate_to_pln: exchangeRateToPln,
      invoice_group_id: form.invoice_group_id ? Number(form.invoice_group_id) : null,
      notes: form.notes.trim() || null,
      linked_invoice_ids: form.linked_invoice_ids,
    };

    if (!payload.title) {
      toast.error('Cost title is required');
      return;
    }

    try {
      setSaving(true);
      let costId = form.id;

      if (form.id) {
        await costsApi.update(form.id, payload);
      } else {
        const response = await costsApi.create(payload);
        costId = response.data.id;
      }

      if (costId && form.new_document_file) {
        await costsApi.uploadDocument(costId, form.new_document_file);
      }

      toast.success(form.id ? 'Cost updated' : 'Cost created');
      closeModal();
      await refreshData();
    } catch (error: any) {
      console.error('Error saving cost:', error);
      toast.error(error?.response?.data?.error || 'Failed to save cost');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCost = async (cost: CostEntry) => {
    if (!window.confirm(`Delete cost "${cost.title}"?`)) return;

    try {
      await costsApi.delete(cost.id);
      toast.success('Cost deleted');
      await refreshData();
    } catch (error: any) {
      console.error('Error deleting cost:', error);
      toast.error(error?.response?.data?.error || 'Failed to delete cost');
    }
  };

  const handleToggleInvoiceLink = (invoiceId: number, checked: boolean) => {
    setForm((current) => {
      if (checked) {
        return {
          ...current,
          linked_invoice_ids: Array.from(new Set([...current.linked_invoice_ids, invoiceId])),
        };
      }

      return {
        ...current,
        linked_invoice_ids: current.linked_invoice_ids.filter((id) => id !== invoiceId),
      };
    });
  };

  const handleDeleteDocument = async (documentId: number) => {
    if (!window.confirm('Delete this document?')) return;
    try {
      await costsApi.deleteDocument(documentId);
      setForm((current) => ({
        ...current,
        documents: current.documents.filter((doc) => doc.id !== documentId),
      }));
      toast.success('Document deleted');
    } catch (error: any) {
      console.error('Error deleting document:', error);
      toast.error(error?.response?.data?.error || 'Failed to delete document');
    }
  };

  const handleDownloadDocument = async (costDocument: CostDocument) => {
    try {
      const response = await costsApi.downloadDocument(costDocument.id);
      const blobUrl = window.URL.createObjectURL(response.data);
      const anchor = window.document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = costDocument.original_name || `cost-document-${costDocument.id}`;
      anchor.click();
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30_000);
    } catch (error) {
      console.error('Error downloading cost document:', error);
      toast.error('Failed to download document');
    }
  };

  const totals = summary?.totals;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Costs</h2>
          <p className="text-sm text-text-muted">Track channel costs and real profitability after expenses.</p>
        </div>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
          <Plus size={16} />
          Add Cost
        </button>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs text-text-muted mb-1">Search</label>
            <input
              className="input"
              placeholder="Search title or notes..."
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </div>
          <div className="w-56">
            <label className="block text-xs text-text-muted mb-1">Group</label>
            <select
              className="input"
              value={filters.group_id}
              onChange={(event) => setFilters((current) => ({ ...current, group_id: event.target.value }))}
            >
              <option value="">All groups</option>
              <option value="none">Unassigned only</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Date from</label>
            <input
              type="date"
              className="input"
              value={filters.date_from}
              onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Date to</label>
            <input
              type="date"
              className="input"
              value={filters.date_to}
              onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <h3 className="text-lg font-semibold mb-3">Quick Group Create</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs text-text-muted mb-1">Group Name</label>
            <input
              className="input"
              placeholder="e.g. Allegro"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
            />
          </div>
          <div className="w-48">
            <label className="block text-xs text-text-muted mb-1">Code (optional)</label>
            <input
              className="input"
              placeholder="ALLEGRO"
              value={newGroupCode}
              onChange={(event) => setNewGroupCode(event.target.value.toUpperCase())}
            />
          </div>
          <button className="btn-secondary" onClick={() => void handleCreateGroup()}>
            Create Group
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-sm text-text-muted mb-1">Invoice Profit</p>
          <p className="text-2xl font-bold">{formatMoney(totals?.invoice_profit_pln, 'PLN')}</p>
        </div>
        <div className="card">
          <p className="text-sm text-text-muted mb-1">Linked Costs</p>
          <p className="text-2xl font-bold text-danger">{formatMoney(totals?.costs_pln, 'PLN')}</p>
        </div>
        <div className="card">
          <p className="text-sm text-text-muted mb-1">Net After Costs</p>
          <p className={`text-2xl font-bold ${(totals?.net_after_costs_pln || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatMoney(totals?.net_after_costs_pln, 'PLN')}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-text-muted mb-1">Sales Net (PLN)</p>
          <p className="text-2xl font-bold">{formatMoney(totals?.sales_net_pln, 'PLN')}</p>
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th>Group</th>
                <th>Amount</th>
                <th>Amount PLN</th>
                <th>Linked Invoices</th>
                <th>Documents</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">Loading...</td>
                </tr>
              ) : costs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">No costs found for selected filters.</td>
                </tr>
              ) : (
                costs.map((cost) => (
                  <tr key={cost.id}>
                    <td>{formatDate(cost.cost_date)}</td>
                    <td className="font-medium">{cost.title}</td>
                    <td>{cost.invoice_group_name || '-'}</td>
                    <td>{formatMoney(cost.amount_original, cost.currency)}</td>
                    <td>{formatMoney(cost.amount_pln, 'PLN')}</td>
                    <td>{cost.linked_invoice_count}</td>
                    <td>{cost.document_count}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          className="text-primary hover:text-blue-700 p-1"
                          onClick={() => void openEditModal(cost.id)}
                          title="Edit cost"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="text-danger hover:text-red-700 p-1"
                          onClick={() => void handleDeleteCost(cost)}
                          title="Delete cost"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 overflow-auto">
          <div className="max-w-5xl mx-auto bg-white rounded-xl shadow-lg p-5 mt-8 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">{form.id ? 'Edit Cost' : 'Add Cost'}</h3>
              <button className="btn-secondary p-2" onClick={closeModal}>
                <X size={16} />
              </button>
            </div>

            {loadingModalDetails ? (
              <p className="text-text-muted">Loading cost details...</p>
            ) : (
              <form onSubmit={handleSubmitCost} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-text-muted mb-1">Title</label>
                    <input
                      className="input"
                      value={form.title}
                      onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                      placeholder="e.g. Allegro Promotions Invoice"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Date</label>
                    <input
                      type="date"
                      className="input"
                      value={form.cost_date}
                      onChange={(event) => setForm((current) => ({ ...current, cost_date: event.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-text-muted mb-1">Currency</label>
                    <input
                      className="input"
                      value={form.currency}
                      onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                      placeholder="PLN / EUR / HUF"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Exchange Rate to PLN</label>
                    <input
                      className="input"
                      value={form.exchange_rate_to_pln}
                      onChange={(event) => setForm((current) => ({ ...current, exchange_rate_to_pln: event.target.value }))}
                      disabled={(form.currency || 'PLN').toUpperCase() === 'PLN'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Amount</label>
                    <input
                      className="input"
                      value={form.amount_original}
                      onChange={(event) => setForm((current) => ({ ...current, amount_original: event.target.value }))}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs text-text-muted mb-1">Group</label>
                    <select
                      className="input"
                      value={form.invoice_group_id}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        invoice_group_id: event.target.value,
                        linked_invoice_ids: [],
                      }))}
                    >
                      <option value="">No group</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs text-text-muted mb-1">Notes</label>
                    <textarea
                      className="input min-h-24"
                      value={form.notes}
                      onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Optional notes"
                    />
                  </div>
                </div>

                <div className="card bg-surface-1 border-border">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <Upload size={16} />
                    Cost Document Upload
                  </h4>
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <input
                      type="file"
                      id="cost-doc-upload"
                      className="hidden"
                      accept=".pdf,.txt,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        void handleParsePreviewFromFile(file);
                      }}
                    />
                    <label htmlFor="cost-doc-upload" className="btn-secondary cursor-pointer flex items-center gap-2">
                      <Upload size={16} />
                      {parsingPreview ? 'Parsing...' : 'Choose file'}
                    </label>
                    {form.new_document_file ? (
                      <span className="text-sm text-text-muted">Selected: {form.new_document_file.name}</span>
                    ) : null}
                  </div>

                  {form.parse_preview ? (
                    <div className="text-sm space-y-1 border border-border rounded-lg p-3 bg-white">
                      <p><strong>Confidence:</strong> {(form.parse_preview.confidence * 100).toFixed(0)}%</p>
                      <p><strong>Detected amount:</strong> {form.parse_preview.suggested_amount_original !== null ? formatMoney(form.parse_preview.suggested_amount_original, form.parse_preview.suggested_currency || form.currency || 'PLN') : '-'}</p>
                      <p><strong>Detected date:</strong> {formatDate(form.parse_preview.suggested_cost_date)}</p>
                      {form.parse_preview.warnings.length > 0 ? (
                        <ul className="text-amber-700 list-disc ml-5">
                          {form.parse_preview.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {form.id && form.documents.length > 0 ? (
                    <div className="mt-3">
                      <h5 className="font-medium mb-2">Uploaded Documents</h5>
                      <div className="space-y-2">
                        {form.documents.map((document) => (
                          <div key={document.id} className="flex items-center justify-between border border-border rounded px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Paperclip size={14} className="text-text-muted" />
                              <span className="truncate">{document.original_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button type="button" className="btn-secondary px-2 py-1" onClick={() => void handleDownloadDocument(document)}>
                                <Download size={14} />
                              </button>
                              <button type="button" className="btn-danger px-2 py-1" onClick={() => void handleDeleteDocument(document.id)}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="card bg-surface-1 border-border">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <ReceiptText size={16} />
                    Link Invoices ({form.linked_invoice_ids.length} selected)
                  </h4>
                  <p className="text-sm text-text-muted mb-2">
                    Link this cost to specific invoices from the selected group. Costs are counted once in summary and kept traceable.
                  </p>
                  <div className="max-h-56 overflow-auto border border-border rounded-lg p-2 bg-white">
                    {linkableInvoices.length === 0 ? (
                      <p className="text-sm text-text-muted p-2">No invoices found for current group filter.</p>
                    ) : (
                      linkableInvoices.map((invoice) => (
                        <label key={invoice.id} className="flex items-start gap-2 p-2 hover:bg-surface-1 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.linked_invoice_ids.includes(invoice.id)}
                            onChange={(event) => handleToggleInvoiceLink(invoice.id, event.target.checked)}
                          />
                          <span className="text-sm">
                            <strong>{invoice.numer_faktury}</strong> - {invoice.customer_nazwa} - {formatDate(invoice.data_wystawienia)} - Profit {formatMoney(invoice.zysk, 'PLN')}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving...' : form.id ? 'Save Changes' : 'Create Cost'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
