import axios from 'axios';
import type {
  AuditLogListResponse,
  Invoice,
  InvoiceListResponse,
  InvoiceFilters,
  InvoiceCsvImportPreviewResponse,
  InvoiceCsvImportCommitResponse,
  InvoiceGroup,
  CostEntry,
  CostListResponse,
  CostSummaryResponse,
  CostDocument,
  CostDocumentParseResult,
  DashboardSummaryResponse,
  DashboardMonthlyComboResponse,
  StorageSummaryResponse,
  Customer,
  Product,
  ProductPriceTier,
  ProductStockAdjustment,
  Opiekun,
  LinkableUser,
  CrmLead,
  CrmLeadFilters,
  CrmLeadListResponse,
  CrmQuickViewCounts,
  CrmDashboardSummaryResponse,
  CrmMetaResponse,
  CrmImportResponse,
  CrmImportPreviewResponse,
  CrmColumnMapping,
  CrmActivityType,
  CrmActivityTemplate,
  CrmDuplicateCase,
  CrmDuplicateCaseAction,
  CrmPipelineType,
  CrmPriorityLead,
  CrmTask,
  CrmTaskItemKind,
  CrmTaskRecurrenceType,
  CrmTaskStatus,
  CrmTaskType,
  CrmTaskUser,
  ResourceTemplate,
  ResourceTemplateListResponse,
  ResourceCreator,
  SupportedLanguage,
  ResourceCategory,
  ResourceCategoryItem,
  ResourceFileListResponse
} from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors (unauthorized)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 429) {
      const payload = error.response?.data;
      let message = 'Too many requests, please wait and try again.';

      if (typeof payload === 'string' && payload.trim()) {
        message = payload.trim();
      } else if (payload && typeof payload === 'object') {
        const errorText = typeof payload.error === 'string' ? payload.error.trim() : '';
        const retrySeconds = typeof payload.retry_after_seconds === 'number'
          ? payload.retry_after_seconds
          : null;

        if (errorText) {
          message = retrySeconds && retrySeconds > 0
            ? `${errorText} Retry in about ${retrySeconds}s.`
            : errorText;
        }
      }

      error.message = message;
    }

    if (error.response?.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('auth_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Invoices API
export const invoicesApi = {
  getAll: (filters?: InvoiceFilters) => 
    api.get<InvoiceListResponse>('/invoices', { params: filters }),

  getNextNumber: (params?: { date?: string; prefix?: 'FT' | 'FV' | 'FS' }) =>
    api.get<{ number: string; prefix: 'FT' | 'FV' | 'FS'; sequence: number; period: { month: string; year: number } }>(
      '/invoices/next-number',
      { params }
    ),
  
  getById: (id: number) => 
    api.get<Invoice>(`/invoices/${id}`),

  recalculateFromProducts: (id: number) =>
    api.post<{
      message: string;
      invoice_ids: number[];
      invoice_count: number;
      item_prices_backfilled: number;
      items_recalculated: number;
      invoices_recalculated: number;
    }>(`/invoices/${id}/recalculate-from-products`),

  rebuildTotalsFromItems: (id: number) =>
    api.post<{
      message: string;
      previous_totals: {
        netto: number;
        vat: number;
        brutto: number;
      };
      rebuilt_totals: {
        netto: number;
        vat: number;
        brutto: number;
      };
      recalculation: {
        invoice_ids: number[];
        invoice_count: number;
        item_prices_backfilled: number;
        items_recalculated: number;
        invoices_recalculated: number;
      };
    }>(`/invoices/${id}/rebuild-totals-from-items`),

  getRecalculateAllPreview: () =>
    api.get<{
      invoice_ids_count: number;
      invoices_total: number;
      invoices_negative: number;
      total_profit: number;
      item_price_mismatches: number;
      non_pln_invoices: number;
      requires_confirmation_text: string;
    }>('/invoices/admin/recalculate-all/preview'),

  recalculateAllInvoices: (confirmText: string) =>
    api.post<{
      message: string;
      invoice_ids_count: number;
      before: {
        invoices_total: number;
        invoices_negative: number;
        total_profit: number;
        item_price_mismatches: number;
        non_pln_invoices: number;
      };
      recalculation: {
        invoice_ids: number[];
        invoice_count: number;
        item_prices_backfilled: number;
        items_recalculated: number;
        invoices_recalculated: number;
      };
      after: {
        invoices_total: number;
        invoices_negative: number;
        total_profit: number;
        item_price_mismatches: number;
        non_pln_invoices: number;
      };
    }>('/invoices/admin/recalculate-all', { confirm_text: confirmText }),

  create: (data: {
    numer_faktury: string;
    data_wystawienia?: string | null;
    data_sprzedazy?: string | null;
    termin_platnosci?: string | null;
    forma_platnosci?: string | null;
    waluta?: string;
    kurs_waluty?: number;
    status_platnosci?: 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot';
    zaplacono?: number;
    koszt_logistyki?: number;
    opiekun_id?: number | null;
    invoice_group_id?: number | null;
    uwagi?: string | null;
    customer_id?: number | null;
    customer?: {
      nazwa: string;
      nip?: string | null;
      ulica?: string | null;
      kod_pocztowy?: string | null;
      miasto?: string | null;
      kraj?: string | null;
      email?: string | null;
      telefon?: string | null;
    };
    items: Array<{
      product_id?: number | null;
      nazwa: string;
      ilosc: number;
      jednostka?: string | null;
      cena_netto: number;
      stawka_vat?: number;
      cena_zakupu?: number | null;
      is_shipping?: boolean;
    }>;
  }) => api.post<{ id: number; message: string }>('/invoices', data),
  
  update: (id: number, data: Partial<Invoice>) => 
    api.put(`/invoices/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/invoices/${id}`),
  
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('pdf', file);
    return api.post('/invoices/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  
  export: () => 
    api.get('/invoices/export/all', {
      params: { encoding: 'utf8' },
      responseType: 'blob',
    }),

  importCsvPreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<InvoiceCsvImportPreviewResponse>('/invoices/import/csv/preview', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  importCsvCommit: (file: File, options?: { skip_existing?: boolean }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.skip_existing !== undefined) {
      formData.append('skip_existing', String(options.skip_existing));
    }
    return api.post<InvoiceCsvImportCommitResponse>('/invoices/import/csv/commit', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  getPdf: (id: number) =>
    api.get<Blob>(`/invoices/${id}/pdf`, {
      responseType: 'blob',
    }),

  downloadPdf: (id: number) =>
    api.get<Blob>(`/invoices/${id}/pdf/download`, {
      responseType: 'blob',
    }),

  getStorageSummary: (params?: { data_od?: string; data_do?: string }) =>
    api.get<StorageSummaryResponse>('/invoices/storage/summary', { params }),

  getDashboardSummary: (params?: { data_od?: string; data_do?: string }) =>
    api.get<DashboardSummaryResponse>('/invoices/dashboard/summary', { params }),

  getMonthlyCombo: (params?: { months?: number; owner_id?: number }) =>
    api.get<DashboardMonthlyComboResponse>('/invoices/dashboard/monthly-combo', { params }),

  getOrphanItems: () =>
    api.get<{ data: Array<{
      id: number;
      invoice_id: number;
      lp: number;
      nazwa: string;
      ilosc: number;
      jednostka: string;
      cena_netto: number;
      wartosc_netto: number;
      cena_zakupu: number | null;
      zysk: number | null;
      marza_procent: number | null;
      numer_faktury: string;
      data_wystawienia: string;
      customer_nazwa: string;
    }>; total: number }>('/invoices/orphan-items'),

  linkOrphanItem: (itemId: number, productId: number) =>
    api.put<{ message: string; item_id: number; product_id: number; product_name: string }>(
      `/invoices/orphan-items/${itemId}/link`,
      { product_id: productId }
    ),

  createProductFromOrphanItem: (itemId: number) =>
    api.post<{ message: string; item_id: number; product_id: number; product_name: string; was_created: boolean }>(
      `/invoices/orphan-items/${itemId}/create-product`
    ),

  createProductsFromAllOrphans: () =>
    api.post<{
      message: string;
      created_count: number;
      linked_count: number;
      total_processed: number;
      results: Array<{ item_id: number; product_id: number; product_name: string; was_created: boolean }>;
    }>('/invoices/orphan-items/create-all'),
};

// Costs API
export const costsApi = {
  getGroups: () =>
    api.get<{ data: InvoiceGroup[]; total: number }>('/costs/groups'),

  createGroup: (data: { name: string; code?: string; is_active?: boolean }) =>
    api.post<{ id: number; message: string }>('/costs/groups', data),

  updateGroup: (id: number, data: { name?: string; code?: string; is_active?: boolean }) =>
    api.put<{ message: string }>(`/costs/groups/${id}`, data),

  deleteGroup: (id: number) =>
    api.delete<{ message: string }>(`/costs/groups/${id}`),

  getSummary: (params?: { group_id?: number | 'none'; date_from?: string; date_to?: string }) =>
    api.get<CostSummaryResponse>('/costs/summary', { params }),

  getAll: (params?: {
    page?: number;
    per_page?: number;
    search?: string;
    group_id?: number | 'none';
    date_from?: string;
    date_to?: string;
  }) => api.get<CostListResponse>('/costs', { params }),

  getById: (id: number) =>
    api.get<CostEntry>(`/costs/${id}`),

  create: (data: {
    title: string;
    cost_date: string;
    amount_original: number;
    currency: string;
    exchange_rate_to_pln: number;
    invoice_group_id?: number | null;
    notes?: string | null;
    linked_invoice_ids?: number[];
  }) => api.post<{ id: number; message: string }>('/costs', data),

  update: (id: number, data: {
    title?: string;
    cost_date?: string;
    amount_original?: number;
    currency?: string;
    exchange_rate_to_pln?: number;
    invoice_group_id?: number | null;
    notes?: string | null;
    linked_invoice_ids?: number[];
  }) => api.put<{ message: string }>(`/costs/${id}`, data),

  replaceLinkedInvoices: (id: number, invoiceIds: number[]) =>
    api.put<{ message: string }>(`/costs/${id}/invoices`, { invoice_ids: invoiceIds }),

  delete: (id: number) =>
    api.delete<{ message: string }>(`/costs/${id}`),

  parsePreview: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{
      file_name: string;
      mime_type: string;
      file_size: number;
      parsed: CostDocumentParseResult;
    }>('/costs/parse-preview', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  uploadDocument: (costId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ id: number; message: string; parsed: CostDocumentParseResult }>(
      `/costs/${costId}/documents`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
  },

  getDocuments: (costId: number) =>
    api.get<{ data: CostDocument[]; total: number }>(`/costs/${costId}/documents`),

  deleteDocument: (documentId: number) =>
    api.delete<{ message: string }>(`/costs/documents/${documentId}`),

  downloadDocument: (documentId: number) =>
    api.get<Blob>(`/costs/documents/${documentId}/download`, {
      responseType: 'blob',
    }),

  getDocumentDownloadUrl: (documentId: number) =>
    `${API_URL}/costs/documents/${documentId}/download`,
};

// Customers API
export const customersApi = {
  getAll: (search?: string) => 
    api.get<Customer[]>('/customers', { params: { search } }),
  
  getById: (id: number) => 
    api.get<Customer>(`/customers/${id}`),
  
  create: (data: Partial<Customer>) => 
    api.post<Customer>('/customers', data),
  
  update: (id: number, data: Partial<Customer>) => 
    api.put(`/customers/${id}`, data),
  
  findOrCreate: (data: Partial<Customer>) => 
    api.post<Customer>('/customers/find-or-create', data),
};

// Products API
export const productsApi = {
  getAll: (params?: { search?: string; missing_price?: boolean }) => 
    api.get<Product[]>('/products', { params }),
  
  getById: (id: number) => 
    api.get<Product>(`/products/${id}`),
  
  create: (data: Partial<Product>) => 
    api.post<Product>('/products', data),
   
  update: (id: number, data: Partial<Product>) => 
    api.put(`/products/${id}`, data),

  delete: (id: number) =>
    api.delete(`/products/${id}`),

  getTiers: (id: number) =>
    api.get<ProductPriceTier[]>(`/products/${id}/tiers`),

  addTier: (
    id: number,
    data: {
      quantity: number;
      unit_price_recommended: number;
      unit_purchase_price?: number | null;
      commission_percent?: number | null;
      currency?: string;
      notes?: string | null;
    }
  ) => api.post<{ id: number; message: string }>(`/products/${id}/tiers`, data),

  updateTier: (
    id: number,
    tierId: number,
    data: {
      quantity: number;
      unit_price_recommended: number;
      unit_purchase_price?: number | null;
      commission_percent?: number | null;
      currency?: string;
      notes?: string | null;
    }
  ) => api.put<{ message: string }>(`/products/${id}/tiers/${tierId}`, data),

  deleteTier: (id: number, tierId: number) =>
    api.delete<{ message: string }>(`/products/${id}/tiers/${tierId}`),

  getStockAdjustments: (id: number, params?: { limit?: number }) =>
    api.get<ProductStockAdjustment[]>(`/products/${id}/stock-adjustments`, { params }),

  reduceStock: (
    id: number,
    data: {
      quantity: number;
      reason: 'damaged' | 'sample' | 'lost' | 'expired' | 'other';
      notes?: string | null;
    }
  ) =>
    api.post<{
      id: number;
      message: string;
      product_id: number;
      product_name: string;
      unit: string;
      quantity_removed: number;
      previous_stock: number;
      stan_magazynowy: number;
      reason: 'damaged' | 'sample' | 'lost' | 'expired' | 'other';
    }>(`/products/${id}/stock-adjustments`, data),

  updateStockAdjustment: (
    id: number,
    adjustmentId: number,
    data: {
      quantity: number;
      reason: 'damaged' | 'sample' | 'lost' | 'expired' | 'other';
      notes?: string | null;
    }
  ) =>
    api.put<{
      message: string;
      product_id: number;
      adjustment_id: number;
      quantity_removed: number;
      stan_magazynowy: number;
      reason: 'damaged' | 'sample' | 'lost' | 'expired' | 'other';
      notes: string | null;
    }>(`/products/${id}/stock-adjustments/${adjustmentId}`, data),

  deleteStockAdjustment: (id: number, adjustmentId: number) =>
    api.delete<{
      message: string;
      product_id: number;
      adjustment_id: number;
      stan_magazynowy: number;
    }>(`/products/${id}/stock-adjustments/${adjustmentId}`),
  
  findOrCreate: (data: Partial<Product>) => 
    api.post<Product>('/products/find-or-create', data),
  
  getStats: () => 
    api.get('/products/stats/summary'),

  mergeProducts: (data: {
    target_product_id: number;
    source_product_ids: number[];
    transfer_stock?: boolean;
    deactivate_sources?: boolean;
  }) =>
    api.post<{
      message: string;
      target_product_id: number;
      target_product_name: string;
      merged_count: number;
      merged_product_ids: number[];
      transferred_stock: number;
    }>('/products/merge', data),
};

// Invoice Items API
export const invoiceItemsApi = {
  update: (id: number, data: { cena_zakupu: number }) => 
    api.put(`/invoice-items/${id}`, data),
  
  updateAndSaveToProduct: (id: number, data: { cena_zakupu: number }) => 
    api.post(`/invoice-items/${id}/update-product`, data),
};

// Opiekunowie API
export const opiekunowieApi = {
  getAll: (includeInactive?: boolean) => 
    api.get<Opiekun[]>('/opiekunowie', { params: { include_inactive: includeInactive } }),

  getLinkableUsers: () =>
    api.get<LinkableUser[]>('/opiekunowie/linkable-users'),
  
  getById: (id: number) => 
    api.get<Opiekun>(`/opiekunowie/${id}`),
  
  create: (data: Partial<Opiekun>) => 
    api.post<{ id: number; message: string }>('/opiekunowie', data),
  
  update: (id: number, data: Partial<Opiekun>) => 
    api.put(`/opiekunowie/${id}`, data),
  
  delete: (id: number) => 
    api.delete(`/opiekunowie/${id}`),
  
  getStats: (id: number) => 
    api.get(`/opiekunowie/${id}/stats`),
};

// Health check
export const healthApi = {
  check: () => api.get('/health'),
};

// Auth API
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  
  getMe: (token: string) =>
    api.get('/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    }),
  
  getUsers: () =>
    api.get('/auth/users'),
  
  createUser: (data: {
    username: string;
    email: string;
    password: string;
    full_name: string;
    role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
  }) => api.post('/auth/users', data),
  
  updateUser: (id: number, data: {
    email?: string;
    full_name?: string;
    role?: 'admin' | 'manager' | 'bookkeeping' | 'seller';
    is_active?: boolean;
    password?: string;
  }) => api.put(`/auth/users/${id}`, data),
  
  deleteUser: (id: number) =>
    api.delete(`/auth/users/${id}`),
  
  changePassword: (data: {
    current_password: string;
    new_password: string;
  }) => api.put('/auth/change-password', data),
};

// Audit Logs API
export const logsApi = {
  getAll: (params?: {
    page?: number;
    per_page?: number;
    user_id?: number;
    method?: string;
    event_type?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
  }) => api.get<AuditLogListResponse>('/logs', { params }),

  delete: (params?: {
    user_id?: number;
    method?: string;
    event_type?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
  }) => api.delete<{ message: string; deleted_count: number }>('/logs', { params }),
};

// CRM API
export const crmApi = {
  getMeta: () => api.get<CrmMetaResponse>('/crm/meta'),

  getDashboardSummary: () => api.get<CrmDashboardSummaryResponse>('/crm/dashboard/summary'),

  getQuickViewCounts: (filters?: CrmLeadFilters) =>
    api.get<CrmQuickViewCounts>('/crm/quick-view-counts', { params: filters }),

  getLeads: (filters?: CrmLeadFilters) =>
    api.get<CrmLeadListResponse>('/crm/leads', { params: filters }),

  getLeadIds: (filters?: CrmLeadFilters) =>
    api.get<{ ids: number[]; total: number }>('/crm/leads/ids', { params: filters }),

  exportLeadsCsv: (filters?: CrmLeadFilters) =>
    api.get<Blob>('/crm/export/csv', {
      params: {
        ...(filters || {}),
        encoding: 'utf8',
      },
      responseType: 'blob'
    }),

  getLeadById: (id: number) =>
    api.get<CrmLead>(`/crm/leads/${id}`),

  createLead: (data: Partial<CrmLead>) =>
    api.post<{ id: number; message: string }>('/crm/leads', data),

  updateLead: (id: number, data: Partial<CrmLead>) =>
    api.put<{ message: string }>(`/crm/leads/${id}`, data),

  updateLeadHotRank: (id: number, hotRank: number | null) =>
    api.put<{ message: string; hot_rank: number | null }>(`/crm/leads/${id}/hot-rank`, {
      hot_rank: hotRank,
    }),

  deleteLead: (id: number) =>
    api.delete<{ message: string }>(`/crm/leads/${id}`),

  bulkDeleteLeads: (ids: number[]) =>
    api.post<{ message: string; requested_count: number; deleted_count: number }>('/crm/leads/bulk-delete', { ids }),

  addActivity: (
    leadId: number,
    data: {
      activity_type?: CrmActivityType;
      note: string;
      activity_at?: string;
      created_by?: string;
    }
  ) => api.post<{ message: string }>(`/crm/leads/${leadId}/activities`, data),

  addLeadProduct: (
    leadId: number,
    data: {
      product_id?: number | null;
      product_name?: string | null;
      relation_type?: 'interested_in' | 'currently_using';
      volume_text?: string | null;
      offered_price?: number | null;
      currency?: string | null;
      notes?: string | null;
    }
  ) => api.post<{ id: number; message: string }>(`/crm/leads/${leadId}/products`, data),

  updateLeadProduct: (
    leadId: number,
    productLinkId: number,
    data: {
      product_id?: number | null;
      product_name?: string | null;
      relation_type?: 'interested_in' | 'currently_using';
      volume_text?: string | null;
      offered_price?: number | null;
      currency?: string | null;
      notes?: string | null;
    }
  ) => api.put<{ message: string }>(`/crm/leads/${leadId}/products/${productLinkId}`, data),

  deleteLeadProduct: (leadId: number, productLinkId: number) =>
    api.delete<{ message: string }>(`/crm/leads/${leadId}/products/${productLinkId}`),

  getTaskUsers: () =>
    api.get<{ data: CrmTaskUser[] }>('/crm/task-users'),

  getTasks: (params?: {
    assigned_user_id?: number;
    lead_id?: number;
    item_kind?: CrmTaskItemKind;
    status?: CrmTaskStatus;
    date_from?: string;
    date_to?: string;
  }) =>
    api.get<{ data: CrmTask[]; total: number }>('/crm/tasks', { params }),

  getPriorityQueue: (params?: { limit?: number }) =>
    api.get<{ data: CrmPriorityLead[]; total: number }>('/crm/priority-queue', { params }),

  recalculatePriorityScores: () =>
    api.post<{ message: string; total: number }>('/crm/priority-queue/recalculate'),

  getActivityTemplates: () =>
    api.get<{ data: CrmActivityTemplate[] }>('/crm/activity-templates'),

  applyActivityTemplate: (
    leadId: number,
    data: {
      template_id: string;
      note_override?: string;
      assigned_user_id?: number;
    }
  ) => api.post<{ message: string }>(`/crm/leads/${leadId}/apply-template`, data),

  getDuplicateCases: (params?: { status?: 'pending' | 'approved' | 'rejected' }) =>
    api.get<{ data: CrmDuplicateCase[]; total: number }>('/crm/duplicate-cases', { params }),

  createDuplicateCase: (data: {
    existing_lead_id: number;
    requested_action: CrmDuplicateCaseAction;
    reason?: string;
    requested_owner_user_id?: number;
    candidate_payload?: Record<string, unknown>;
  }) => api.post<{ id: number; message: string }>('/crm/duplicate-cases', data),

  resolveDuplicateCase: (
    caseId: number,
    data: {
      decision: 'approve' | 'reject';
      resolved_note?: string;
      assign_owner_user_id?: number;
    }
  ) => api.post<{ message: string; resolved_lead_id?: number }>(`/crm/duplicate-cases/${caseId}/resolve`, data),

  getTodayTasks: () =>
    api.get<{ user_id: number; date: string; total: number; tasks: CrmTask[] }>('/crm/tasks/today'),

  createTask: (data: {
    lead_id?: number | null;
    title?: string;
    item_kind?: CrmTaskItemKind;
    task_type?: CrmTaskType;
    description?: string | null;
    due_at: string;
    remind_at?: string | null;
    assigned_user_id?: number;
    recurrence_type?: CrmTaskRecurrenceType;
    recurrence_interval?: number;
    recurrence_until?: string | null;
  }) => api.post<{ id: number; lead_id: number | null; message: string }>('/crm/tasks', data),

  createLeadTask: (
    leadId: number,
    data: {
      title?: string;
      item_kind?: CrmTaskItemKind;
      task_type?: CrmTaskType;
      description?: string | null;
      due_at: string;
      remind_at?: string | null;
      assigned_user_id?: number;
      recurrence_type?: CrmTaskRecurrenceType;
      recurrence_interval?: number;
      recurrence_until?: string | null;
    }
  ) => api.post<{ id: number; message: string }>(`/crm/leads/${leadId}/tasks`, data),

  updateTask: (
    taskId: number,
    data: {
      title?: string;
      item_kind?: CrmTaskItemKind;
      task_type?: CrmTaskType;
      status?: CrmTaskStatus;
      description?: string | null;
      due_at?: string;
      remind_at?: string | null;
      assigned_user_id?: number;
      recurrence_type?: CrmTaskRecurrenceType;
      recurrence_interval?: number;
      recurrence_until?: string | null;
    }
  ) => api.put<{ message: string }>(`/crm/tasks/${taskId}`, data),

  deleteTask: (taskId: number) =>
    api.delete<{ message: string }>(`/crm/tasks/${taskId}`),

  importLeads: (payload: {
    file: File;
    lead_owner?: string;
    source_channel?: string;
    pipeline_type?: CrmPipelineType;
    dry_run?: boolean;
    imported_by?: string;
    mapping?: CrmColumnMapping;
  }) => {
    const formData = new FormData();
    formData.append('file', payload.file);
    if (payload.lead_owner) formData.append('lead_owner', payload.lead_owner);
    if (payload.source_channel) formData.append('source_channel', payload.source_channel);
    if (payload.pipeline_type) formData.append('pipeline_type', payload.pipeline_type);
    if (payload.imported_by) formData.append('imported_by', payload.imported_by);
    if (payload.mapping) formData.append('mapping', JSON.stringify(payload.mapping));
    formData.append('dry_run', payload.dry_run ? 'true' : 'false');

    return api.post<CrmImportResponse>('/crm/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
  },

  previewImport: (payload: {
    file: File;
    lead_owner?: string;
    source_channel?: string;
    pipeline_type?: CrmPipelineType;
    imported_by?: string;
    mapping?: CrmColumnMapping;
  }) => {
    const formData = new FormData();
    formData.append('file', payload.file);
    if (payload.lead_owner) formData.append('lead_owner', payload.lead_owner);
    if (payload.source_channel) formData.append('source_channel', payload.source_channel);
    if (payload.pipeline_type) formData.append('pipeline_type', payload.pipeline_type);
    if (payload.imported_by) formData.append('imported_by', payload.imported_by);
    if (payload.mapping) formData.append('mapping', JSON.stringify(payload.mapping));

    return api.post<CrmImportPreviewResponse>('/crm/import/preview', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
  }
};

// Resources API
export const resourcesApi = {
  getAll: (filters?: { category?: ResourceCategory; search?: string; created_by_user_id?: number }) =>
    api.get<ResourceTemplateListResponse>('/resources', { params: filters }),

  getCategories: () =>
    api.get<{ data: ResourceCategoryItem[]; total: number }>('/resources/categories/all'),

  getById: (id: number) =>
    api.get<ResourceTemplate>(`/resources/${id}`),

  getCreators: () =>
    api.get<{ data: ResourceCreator[]; total: number }>('/resources/creators/all'),

  create: (data: {
    title: string;
    category: ResourceCategory;
    content: string;
    tags?: string[];
  }) => api.post<{ message: string; id: number }>('/resources', data),

  update: (id: number, data: {
    title?: string;
    category?: ResourceCategory;
    content?: string;
    tags?: string[];
  }) => api.put<{ message: string }>(`/resources/${id}`, data),

  delete: (id: number) =>
    api.delete<{ message: string }>(`/resources/${id}`),

  addTranslation: (
    templateId: number,
    data: {
      language_code: string;
      title: string;
      content: string;
    }
  ) => api.post<{ message: string; id: number }>(`/resources/${templateId}/translations`, data),

  updateTranslation: (
    templateId: number,
    languageCode: string,
    data: {
      title?: string;
      content?: string;
    }
  ) => api.put<{ message: string }>(`/resources/${templateId}/translations/${languageCode}`, data),

  deleteTranslation: (templateId: number, languageCode: string) =>
    api.delete<{ message: string }>(`/resources/${templateId}/translations/${languageCode}`),

  replaceTranslationVersions: (
    templateId: number,
    languageCode: string,
    versions: Array<{ version_label?: string | null; title: string; content: string }>
  ) => api.put<{ message: string; language_code: string; total_versions: number }>(
    `/resources/${templateId}/translations/${languageCode}/versions`,
    { versions }
  ),

  getLanguages: () =>
    api.get<{ data: SupportedLanguage[]; total: number }>('/resources/languages/all'),

  addLanguage: (data: {
    code: string;
    name: string;
    native_name: string;
  }) => api.post<{ message: string; code: string }>('/resources/languages/add', data),

  addCategory: (data: {
    code: string;
    name: string;
  }) => api.post<{ message: string; code: string }>('/resources/categories/add', data),

  updateCategory: (
    code: string,
    data: {
      code?: string;
      name?: string;
    }
  ) => api.put<{ message: string; code: string; previous_code: string }>(`/resources/categories/${code}`, data),

  deleteCategory: (code: string) =>
    api.delete<{ message: string }>(`/resources/categories/${code}`),

  // File management
  getFiles: () =>
    api.get<ResourceFileListResponse>('/resources/files'),

  uploadFile: (formData: FormData) =>
    api.post<{ id: number; message: string }>('/resources/files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  updateFileMeta: (id: number, data: { category?: string; description?: string }) =>
    api.patch<{ message: string }>(`/resources/files/${id}`, data),

  deleteFile: (id: number) =>
    api.delete<{ message: string }>(`/resources/files/${id}`),

  getFileDownloadUrl: (id: number) =>
    `${API_URL}/resources/files/${id}/download`,
};

export default api;
