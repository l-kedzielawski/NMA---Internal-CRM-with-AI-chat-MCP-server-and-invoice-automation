import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Download, Filter, ChevronLeft, ChevronRight, Trash2, CheckCircle, XCircle, Plus, FileText, Upload, AlertCircle, X, Eye, FileUp } from 'lucide-react';
import { costsApi, invoicesApi, opiekunowieApi } from '../services/api';
import type {
  Invoice,
  InvoiceFilters,
  Opiekun,
  InvoiceGroup,
  InvoiceCsvImportPreviewResponse,
} from '../types';
import toast from 'react-hot-toast';
import { formatMoney, formatDate } from '../utils/formatters';
import { DEFAULT_PAGE_SIZE } from '../utils/constants';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function InvoicesPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [opiekunowie, setOpiekunowie] = useState<Opiekun[]>([]);
  const [invoiceGroups, setInvoiceGroups] = useState<InvoiceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
  const [csvImportLoading, setCsvImportLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [csvImportError, setCsvImportError] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [skipExistingInCsvImport, setSkipExistingInCsvImport] = useState(true);
  const [csvPreview, setCsvPreview] = useState<InvoiceCsvImportPreviewResponse | null>(null);
  const [invoicePendingDelete, setInvoicePendingDelete] = useState<Invoice | null>(null);
  const [uploadResults, setUploadResults] = useState<Array<{
    success: boolean;
    invoiceId?: number;
    numerFaktury?: string;
    itemsNeedingPurchasePrice?: number;
    error?: string;
  }>>([]);
  const [filters, setFilters] = useState<InvoiceFilters>({
    page: 1,
    per_page: DEFAULT_PAGE_SIZE,
  });
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  const getOpiekunDisplayName = (opiekun: Opiekun) => {
    const fullName = [opiekun.imie, opiekun.nazwisko || ''].join(' ').trim();
    return fullName || opiekun.imie;
  };

  useEffect(() => {
    void loadInvoices();
  }, [filters]);

  useEffect(() => {
    void Promise.all([loadOpiekunowie(), loadInvoiceGroups()]);
  }, []);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const response = await invoicesApi.getAll(filters);
      setInvoices(response.data.data);
      setTotalPages(Math.ceil(response.data.total / (filters.per_page || 20)));
    } catch (error) {
      console.error('Error loading invoices:', error);
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

  const stopRowNavigation = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleToggleStatus = async (e: React.MouseEvent, invoice: Invoice) => {
    e.stopPropagation();
    const newStatus = invoice.status_platnosci === 'oplacona' ? 'nieoplacona' : 'oplacona';
    try {
      await invoicesApi.update(invoice.id, { status_platnosci: newStatus });
      setInvoices(invoices.map(inv => 
        inv.id === invoice.id ? { ...inv, status_platnosci: newStatus } : inv
      ));
      toast.success(`Invoice status updated to ${newStatus === 'oplacona' ? 'Paid' : 'Unpaid'}`);
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update invoice status');
    }
  };

  const handleDeleteInvoice = (e: React.MouseEvent, invoice: Invoice) => {
    stopRowNavigation(e);
    setInvoicePendingDelete(invoice);
  };

  const confirmDeleteInvoice = async () => {
    if (!invoicePendingDelete) return;

    try {
      await invoicesApi.delete(invoicePendingDelete.id);
      toast.success('Invoice deleted successfully!');
      setInvoicePendingDelete(null);
      loadInvoices();
    } catch (error) {
      console.error('Error deleting invoice:', error);
      toast.error('Failed to delete invoice');
    }
  };

  const handleOpenInvoicePdf = async (e: React.MouseEvent, invoice: Invoice) => {
    stopRowNavigation(e);

    try {
      const response = await invoicesApi.getPdf(invoice.id);
      const pdfBlob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: 'application/pdf' });
      const blobUrl = window.URL.createObjectURL(pdfBlob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      console.error('Error opening invoice PDF:', error);
      toast.error('Could not open invoice PDF');
    }
  };

  const handleDownloadInvoicePdf = async (e: React.MouseEvent, invoice: Invoice) => {
    stopRowNavigation(e);
    try {
      const response = await invoicesApi.downloadPdf(invoice.id);
      const blobUrl = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${invoice.numer_faktury || 'invoice'}.pdf`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30_000);
    } catch (error) {
      console.error('Error downloading invoice PDF:', error);
      toast.error('Could not download invoice PDF');
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters({ ...filters, search: searchQuery, page: 1 });
  };

  const handleExport = async () => {
    try {
      const response = await invoicesApi.export();
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'faktury.csv';
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Invoice data exported successfully!');
    } catch (error) {
      console.error('Error exporting invoices:', error);
      toast.error('Failed to export invoices');
    }
  };

  const handleDownloadCsvTemplate = () => {
    const separator = ';';
    const rows = [
      `sep=${separator}`,
      [
        'numer_faktury',
        'customer_nazwa',
        'customer_nip',
        'customer_ulica',
        'customer_kod_pocztowy',
        'customer_miasto',
        'customer_kraj',
        'customer_email',
        'customer_telefon',
        'data_wystawienia',
        'data_sprzedazy',
        'termin_platnosci',
        'forma_platnosci',
        'status_platnosci',
        'waluta',
        'kurs_waluty',
        'zaplacono',
        'opiekun_id',
        'item_nazwa',
        'ilosc',
        'jednostka',
        'cena_netto',
        'stawka_vat',
        'cena_zakupu',
        'is_shipping',
        'uwagi',
      ].join(separator),
      [
        'FT/8/02/2026',
        'Przyklad Sp. z o.o.',
        '7831881805',
        'ul. Pamiatkowa 2/56',
        '61-512',
        'Poznan',
        'Polska',
        'biuro@przyklad.pl',
        '600700800',
        '2026-02-20',
        '2026-02-20',
        '2026-03-06',
        'przelew',
        'nieoplacona',
        'PLN',
        '1',
        '0',
        '1',
        'Olejek eteryczny lawenda 10ml',
        '10',
        'szt',
        '25.00',
        '23',
        '12.50',
        '0',
        'Przykladowa faktura importowa',
      ].join(separator),
      [
        'FT/8/02/2026',
        'Przyklad Sp. z o.o.',
        '7831881805',
        'ul. Pamiatkowa 2/56',
        '61-512',
        'Poznan',
        'Polska',
        'biuro@przyklad.pl',
        '600700800',
        '2026-02-20',
        '2026-02-20',
        '2026-03-06',
        'przelew',
        'nieoplacona',
        'PLN',
        '1',
        '0',
        '1',
        'Wysylka kurierska',
        '1',
        'szt',
        '15.00',
        '23',
        '0',
        '1',
        'Przykladowa faktura importowa',
      ].join(separator),
    ];

    const csv = rows.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoice_import_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('CSV template downloaded');
  };

  const handleCsvPreview = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvImportError(null);
    setCsvPreview(null);
    setCsvFileName(file.name);
    setCsvFile(file);
    setCsvPreviewLoading(true);

    try {
      const response = await invoicesApi.importCsvPreview(file);
      setCsvPreview(response.data);
      if (response.data.errors.length > 0) {
        toast.error(`CSV parsed with ${response.data.errors.length} issue(s)`);
      } else {
        toast.success('CSV preview generated');
      }
    } catch (error: any) {
      console.error('Error generating CSV preview:', error);
      const message = error?.response?.data?.error || 'Failed to preview CSV import';
      setCsvImportError(message);
      toast.error(message);
    } finally {
      setCsvPreviewLoading(false);
    }
  };

  const handleCsvCommit = async () => {
    if (!csvFileName || !csvPreview) {
      toast.error('Select a CSV file and generate preview first');
      return;
    }

    if (!csvFile) {
      toast.error('Please select the CSV file again before import');
      return;
    }

    setCsvImportLoading(true);
    setCsvImportError(null);

    try {
      const response = await invoicesApi.importCsvCommit(csvFile, { skip_existing: skipExistingInCsvImport });
      toast.success(`Imported ${response.data.created_count} invoice(s)`);
      await loadInvoices();
      setCsvPreview(null);
      setCsvFileName(null);
      setCsvFile(null);
      if (csvInputRef.current) {
        csvInputRef.current.value = '';
      }
    } catch (error: any) {
      console.error('Error importing CSV:', error);
      const message = error?.response?.data?.error || 'Failed to import CSV';
      setCsvImportError(message);
      toast.error(message);
    } finally {
      setCsvImportLoading(false);
    }
  };

  const handleInvoiceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);
    setUploading(true);
    const newResults: Array<{
      success: boolean;
      invoiceId?: number;
      numerFaktury?: string;
      itemsNeedingPurchasePrice?: number;
      error?: string;
    }> = [];

    try {
      for (const file of Array.from(files)) {
        try {
          const response = await invoicesApi.upload(file);
          const uploadedResult = {
            success: true,
            invoiceId: response.data.invoiceId,
            numerFaktury: response.data.numerFaktury,
            itemsNeedingPurchasePrice: response.data.itemsNeedingPurchasePrice,
          };
          newResults.push(uploadedResult);
          toast.success(`Invoice ${response.data.numerFaktury} uploaded successfully`);
        } catch (uploadError: any) {
          console.error('Upload error:', uploadError);
          let errorMessage = 'Processing error';
          if (uploadError?.response?.data?.error) {
            errorMessage = uploadError.response.data.error;
            if (uploadError?.response?.data?.details) {
              errorMessage = `${errorMessage}: ${uploadError.response.data.details}`;
            }
          } else if (uploadError?.message) {
            errorMessage = uploadError.message;
          }
          newResults.push({ success: false, error: errorMessage });
          toast.error(`Upload failed: ${errorMessage}`);
        }
      }

      setUploadResults((current) => [...newResults, ...current].slice(0, 10));
      await loadInvoices();
    } catch (criticalError: any) {
      console.error('Critical upload error:', criticalError);
      const message = `Critical error: ${criticalError?.message || 'Unknown error'}`;
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Invoices</h2>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/invoices/new')}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            New Invoice
          </button>
          <button
            onClick={handleExport}
            className="btn-secondary flex items-center gap-2"
          >
            <Download size={18} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[320px] lg:min-w-[460px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
            <input
              type="text"
              placeholder="Search by invoice number or customer..."
              className="input input-with-leading-icon"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-56 lg:w-60 flex-none">
            <select
              className="input w-full"
              value={filters.status || ''}
              onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined, page: 1 })}
            >
              <option value="">All Statuses</option>
              <option value="oplacona">Paid</option>
              <option value="nieoplacona">Unpaid</option>
              <option value="czesciowa">Partial</option>
            </select>
          </div>
          <div className="w-full sm:w-72 lg:w-80 flex-none">
            <select
              className="input w-full"
              value={filters.opiekun_id ? String(filters.opiekun_id) : ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  opiekun: undefined,
                  opiekun_id: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  page: 1,
                })
              }
            >
              <option value="">All Invoice Managers</option>
              {opiekunowie.map((o) => (
                <option key={o.id} value={o.id}>{getOpiekunDisplayName(o)}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-64 lg:w-72 flex-none">
            <select
              className="input w-full"
              value={filters.invoice_group_id ? String(filters.invoice_group_id) : ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  invoice_group_id: e.target.value
                    ? (e.target.value === 'none' ? 'none' : parseInt(e.target.value, 10))
                    : undefined,
                  page: 1,
                })
              }
            >
              <option value="">All Groups</option>
              <option value="none">Unassigned</option>
              {invoiceGroups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto flex-none">
            <Filter size={18} />
            Filter
          </button>
        </form>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold">Upload Invoice PDF</h3>
            <p className="text-sm text-text-muted">Upload one or more PDFs directly from the invoices page.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf"
              multiple
              onChange={handleInvoiceUpload}
              disabled={uploading}
              className="hidden"
              id="invoice-upload-inline"
            />
            <label
              htmlFor="invoice-upload-inline"
              className={`btn-primary flex items-center gap-2 cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
            >
              <Upload size={18} />
              {uploading ? 'Uploading...' : 'Select PDF files'}
            </label>
            {uploadResults.length > 0 && (
              <button
                onClick={() => {
                  setUploadResults([]);
                  setUploadError(null);
                }}
                className="btn-secondary flex items-center gap-2"
              >
                <X size={16} />
                Clear
              </button>
            )}
          </div>
        </div>

        {uploadError && (
          <div className="mb-3 p-3 rounded border border-red-200 bg-red-50 text-danger flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{uploadError}</span>
          </div>
        )}

        {uploadResults.length > 0 && (
          <div className="space-y-2">
            {uploadResults.map((result, index) => (
              <div
                key={`invoice-upload-result-${index}`}
                className={`p-3 rounded border flex justify-between items-center gap-3 ${result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
              >
                {result.success ? (
                  <div className="flex items-center gap-3">
                    <CheckCircle size={18} className="text-success" />
                    <div>
                      <p className="font-medium">{result.numerFaktury}</p>
                      <p className="text-sm text-text-muted">
                        {result.itemsNeedingPurchasePrice && result.itemsNeedingPurchasePrice > 0
                          ? `${result.itemsNeedingPurchasePrice} product(s) need purchase price`
                          : 'All purchase prices filled'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-danger">
                    <AlertCircle size={18} />
                    <p>{result.error || 'Upload failed'}</p>
                  </div>
                )}

                {result.success && result.invoiceId ? (
                  <button
                    onClick={() => navigate(`/invoices/${result.invoiceId}`)}
                    className="btn-primary"
                  >
                    View
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold">Mass Invoice Import (CSV)</h3>
            <p className="text-sm text-text-muted">
              Upload a CSV, preview parsed invoices, then import them in bulk.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={csvInputRef}
              accept=".csv,text/csv"
              onChange={handleCsvPreview}
              disabled={csvPreviewLoading || csvImportLoading}
              className="hidden"
              id="invoice-import-csv"
            />
            <label
              htmlFor="invoice-import-csv"
              className={`btn-secondary flex items-center gap-2 cursor-pointer ${(csvPreviewLoading || csvImportLoading) ? 'opacity-60 pointer-events-none' : ''}`}
            >
              <FileUp size={18} />
              {csvPreviewLoading ? 'Parsing CSV...' : 'Select CSV'}
            </label>
            <button
              onClick={handleDownloadCsvTemplate}
              className="btn-secondary flex items-center gap-2"
              type="button"
            >
              <Download size={18} />
              Template CSV
            </button>
            <button
              onClick={handleCsvCommit}
              disabled={!csvPreview || csvImportLoading || csvPreviewLoading || csvPreview.errors.length > 0}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {csvImportLoading ? 'Importing...' : 'Import CSV'}
            </button>
            {(csvPreview || csvImportError) && (
              <button
                onClick={() => {
                  setCsvPreview(null);
                  setCsvImportError(null);
                  setCsvFileName(null);
                  setCsvFile(null);
                  if (csvInputRef.current) {
                    csvInputRef.current.value = '';
                  }
                }}
                className="btn-secondary flex items-center gap-2"
              >
                <X size={16} />
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="mb-3 flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={skipExistingInCsvImport}
              onChange={(e) => setSkipExistingInCsvImport(e.target.checked)}
            />
            <span>Skip existing invoice numbers</span>
          </label>
          {csvFileName && <span className="text-text-muted">File: {csvFileName}</span>}
        </div>

        {csvImportError && (
          <div className="mb-3 p-3 rounded border border-red-200 bg-red-50 text-danger flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{csvImportError}</span>
          </div>
        )}

        {csvPreview && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
              <div className="p-2 rounded bg-gray-50 border text-gray-800">Rows: <strong>{csvPreview.total_rows}</strong></div>
              <div className="p-2 rounded bg-gray-50 border text-gray-800">Invoices: <strong>{csvPreview.parsed_invoices}</strong></div>
              <div className="p-2 rounded bg-gray-50 border text-gray-800">Valid: <strong>{csvPreview.valid_invoices}</strong></div>
              <div className="p-2 rounded bg-gray-50 border text-gray-800">Duplicates: <strong>{csvPreview.duplicates_existing}</strong></div>
              <div className="p-2 rounded bg-gray-50 border text-gray-800">Owner refs invalid: <strong>{csvPreview.invalid_owner_refs}</strong></div>
            </div>

            {csvPreview.errors.length > 0 && (
              <div className="p-3 rounded border border-amber-300 bg-amber-50 text-amber-900">
                <p className="font-semibold mb-2 text-amber-900">Validation issues</p>
                <ul className="text-sm space-y-1 max-h-36 overflow-auto text-amber-800">
                  {csvPreview.errors.slice(0, 20).map((err, index) => (
                    <li key={`csv-error-${index}`}>Row {err.row}: {err.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Gross</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Duplicate</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.preview.slice(0, 30).map((row) => (
                    <tr key={`csv-preview-${row.invoice_number}`}>
                      <td className="font-medium">{row.invoice_number}</td>
                      <td>{row.customer_name}</td>
                      <td>{row.item_count}</td>
                      <td>{formatMoney(row.gross_total, 'PLN')}</td>
                      <td>{row.payment_status}</td>
                      <td>{row.owner_id ?? '-'}</td>
                      <td>
                        {row.duplicate_existing ? (
                          <span className="badge badge-danger">Existing</span>
                        ) : (
                          <span className="badge badge-success">New</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {csvPreview.preview.length > 30 && (
              <p className="text-xs text-text-muted">Showing first 30 invoices from preview.</p>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Net</th>
                <th>Profit</th>
                <th>Margin</th>
                <th>Group</th>
                <th>Status</th>
                <th>Invoice Manager</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-text-muted">
                    Loading...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      icon={FileText}
                      title="No invoices found"
                      description="Upload your first invoice PDF or create a new invoice manually to get started."
                      action={
                        <div className="flex gap-2">
                          <button onClick={() => navigate('/upload')} className="btn-primary">
                            Upload Invoice
                          </button>
                          <button onClick={() => navigate('/invoices/new')} className="btn-secondary">
                            Create Manually
                          </button>
                        </div>
                      }
                    />
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/invoices/${invoice.id}`)}
                  >
                    <td className="font-medium">{invoice.numer_faktury}</td>
                    <td>
                      <div>{invoice.customer_nazwa}</div>
                      {invoice.customer_nip && (
                        <div className="text-xs text-text-muted">NIP: {invoice.customer_nip}</div>
                      )}
                    </td>
                    <td>{formatDate(invoice.data_wystawienia)}</td>
                    <td>{formatMoney(invoice.netto, invoice.waluta || 'PLN')}</td>
                    <td className={invoice.zysk && Number(invoice.zysk) >= 0 ? 'text-success' : 'text-danger'}>
                      {formatMoney(invoice.zysk, 'PLN')}
                    </td>
                    <td>{invoice.marza_procent != null ? Number(invoice.marza_procent).toFixed(2) : '-'}%</td>
                    <td onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                      <select
                        className="input text-sm py-1 px-2"
                        value={invoice.invoice_group_id || ''}
                        onChange={async (e) => {
                          const invoiceGroupId = e.target.value ? parseInt(e.target.value, 10) : null;
                          try {
                            await invoicesApi.update(invoice.id, { invoice_group_id: invoiceGroupId });
                            setInvoices(invoices.map(inv =>
                              inv.id === invoice.id
                                ? {
                                    ...inv,
                                    invoice_group_id: invoiceGroupId,
                                    invoice_group_name: invoiceGroupId
                                      ? invoiceGroups.find((group) => group.id === invoiceGroupId)?.name || null
                                      : null,
                                  }
                                : inv
                            ));
                            toast.success('Invoice group updated');
                          } catch (error) {
                            console.error('Error updating invoice group:', error);
                            toast.error('Failed to update invoice group');
                          }
                        }}
                      >
                        <option value="">-</option>
                        {invoiceGroups.map((group) => (
                          <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={(e) => handleToggleStatus(e, invoice)}
                        className={`badge flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity ${
                          invoice.status_platnosci === 'oplacona'
                            ? 'badge-success'
                            : 'badge-danger'
                        }`}
                      >
                        {invoice.status_platnosci === 'oplacona' ? (
                          <><CheckCircle size={14} /> Paid</>
                        ) : (
                          <><XCircle size={14} /> Unpaid</>
                        )}
                      </button>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                      <select
                        className="input text-sm py-1 px-2"
                        value={invoice.opiekun_id || ''}
                        onChange={async (e) => {
                          const opiekunId = e.target.value ? parseInt(e.target.value, 10) : null;
                          try {
                            await invoicesApi.update(invoice.id, { opiekun_id: opiekunId });
                            setInvoices(invoices.map(inv => 
                              inv.id === invoice.id ? { 
                                ...inv, 
                                opiekun_id: opiekunId,
                                opiekun: opiekunId ? opiekunowie.find(o => o.id === opiekunId)?.imie ?? null : null
                              } : inv
                            ));
                            toast.success('Invoice manager updated');
                          } catch (error) {
                            console.error('Error updating invoice manager:', error);
                            toast.error('Failed to update invoice manager');
                          }
                        }}
                      >
                        <option value="">-</option>
                        {opiekunowie.map((o) => (
                          <option key={o.id} value={o.id}>{getOpiekunDisplayName(o)}</option>
                        ))}
                      </select>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {invoice.pdf_path && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => handleOpenInvoicePdf(e, invoice)}
                              className="text-primary hover:text-blue-700 p-1"
                              title="View PDF"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDownloadInvoicePdf(e, invoice)}
                              className="text-primary hover:text-blue-700 p-1"
                              title="Download PDF"
                            >
                              <Download size={16} />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleDeleteInvoice(e, invoice)}
                          className="text-danger hover:text-red-700 p-1"
                          title="Usun fakture"
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

        {/* Pagination */}
        <div className="flex justify-between items-center mt-4">
          <div className="text-sm text-text-muted">
            Strona {filters.page} z {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilters({ ...filters, page: (filters.page || 1) - 1 })}
              disabled={(filters.page || 1) <= 1}
              className="btn-secondary disabled:opacity-50"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setFilters({ ...filters, page: (filters.page || 1) + 1 })}
              disabled={(filters.page || 1) >= totalPages}
              className="btn-secondary disabled:opacity-50"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={invoicePendingDelete !== null}
        title="Delete Invoice"
        message={invoicePendingDelete ? `Delete invoice ${invoicePendingDelete.numer_faktury}?` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          void confirmDeleteInvoice();
        }}
        onCancel={() => setInvoicePendingDelete(null)}
      />
    </div>
  );
}
