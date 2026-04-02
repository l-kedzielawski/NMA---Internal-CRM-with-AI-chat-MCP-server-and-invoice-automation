export interface Customer {
  id: number;
  nazwa: string;
  nip: string | null;
  ulica: string | null;
  kod_pocztowy: string | null;
  miasto: string | null;
  kraj: string;
  email: string | null;
  telefon: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  sku: string | null;
  gtin: string | null;
  nazwa: string;
  cena_zakupu: number | null;
  cena_sprzedazy_rekomendowana: number | null;
  stawka_vat: number | null;
  kategoria: string | null;
  jednostka: string | null;
  stan_magazynowy: number | null;
  additional_info: string | null;
  aktywny: boolean;
  created_at: string;
  updated_at: string;
  price_tiers?: ProductPriceTier[];
}

export interface ProductPriceTier {
  id: number;
  product_id: number;
  quantity: number;
  unit_price_recommended: number;
  unit_purchase_price: number | null;
  commission_percent: number | null;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductStockAdjustment {
  id: number;
  product_id: number;
  change_type: 'out';
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reason: 'damaged' | 'sample' | 'lost' | 'expired' | 'other';
  notes: string | null;
  created_by_user_id: number | null;
  created_at: string;
  created_by_username: string | null;
  created_by_full_name: string | null;
}

export interface StorageSummaryRow {
  id: number;
  nazwa: string;
  sku: string | null;
  jednostka: string | null;
  stan_magazynowy: number | null;
  sold_quantity: number;
  sold_value_net: number;
  estimated_remaining: number;
}

export interface StorageSummaryResponse {
  data: StorageSummaryRow[];
  total_sold_quantity: number;
  products_with_sales: number;
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  product_id: number | null;
  lp: number | null;
  nazwa: string;
  ilosc: number;
  jednostka: string | null;
  cena_netto: number | null;
  stawka_vat: number | null;
  wartosc_netto: number | null;
  wartosc_vat: number | null;
  wartosc_brutto: number | null;
  cena_zakupu: number | null;
  koszt_calkowity: number | null;
  zysk: number | null;
  marza_procent: number | null;
  is_shipping: boolean;
  created_at: string;
  updated_at: string;
  product_nazwa?: string;
  product_sku?: string;
}

export interface Invoice {
  id: number;
  numer_faktury: string;
  customer_id: number;
  data_wystawienia: string | null;
  data_sprzedazy: string | null;
  termin_platnosci: string | null;
  forma_platnosci: string | null;
  waluta: string;
  kurs_waluty: number;
  netto: number | null;
  vat: number | null;
  brutto: number | null;
  zaplacono: number;
  status_platnosci: 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot';
  opiekun: string | null;
  opiekun_id: number | null;
  invoice_group_id: number | null;
  invoice_group_code?: string | null;
  invoice_group_name?: string | null;
  prowizja_opiekuna: number | null;
  koszt_logistyki: number | null;
  zysk: number | null;
  marza_procent: number | null;
  pdf_path: string | null;
  uwagi: string | null;
  created_at: string;
  updated_at: string;
  items?: InvoiceItem[];
  customer_nazwa?: string;
  customer_nip?: string | null;
  opiekun_imie?: string;
  opiekun_marza?: number;
}

export interface Opiekun {
  id: number;
  imie: string;
  nazwisko: string | null;
  email: string | null;
  user_id: number | null;
  user_username?: string | null;
  user_full_name?: string | null;
  user_role?: 'admin' | 'manager' | 'bookkeeping' | 'seller' | null;
  user_is_active?: number | null;
  telefon: string | null;
  marza_procent: number;
  aktywny: boolean;
  created_at: string;
  updated_at: string;
}

export interface LinkableUser {
  id: number;
  username: string;
  full_name: string;
  role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
  is_active: number;
  linked_opiekun_id: number | null;
  linked_opiekun_imie: string | null;
}

export interface InvoiceListResponse {
  data: Invoice[];
  total: number;
  page: number;
  per_page: number;
}

export interface InvoiceFilters {
  page?: number;
  per_page?: number;
  opiekun?: string;
  opiekun_id?: number;
  invoice_group_id?: number | 'none';
  status?: string;
  data_od?: string;
  data_do?: string;
  search?: string;
}

export interface InvoiceGroup {
  id: number;
  code: string | null;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CostDocumentParseResult {
  suggested_amount_original: number | null;
  suggested_currency: string | null;
  suggested_exchange_rate_to_pln: number | null;
  suggested_cost_date: string | null;
  suggested_title: string | null;
  document_number: string | null;
  vendor_name: string | null;
  confidence: number;
  warnings: string[];
  raw_text_preview: string;
}

export interface CostDocument {
  id: number;
  cost_entry_id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  parse_result_json?: string | null;
  parse_confidence: number | null;
  uploaded_by_user_id: number | null;
  uploaded_by_username: string | null;
  uploaded_by_full_name: string | null;
  created_at: string;
  updated_at: string;
  parse_result?: CostDocumentParseResult | null;
}

export interface CostLinkedInvoice {
  id: number;
  numer_faktury: string;
  data_wystawienia: string | null;
  waluta: string;
  netto: number | null;
  zysk: number | null;
  customer_nazwa: string;
}

export interface CostEntry {
  id: number;
  title: string;
  cost_date: string;
  amount_original: number;
  currency: string;
  exchange_rate_to_pln: number;
  amount_pln: number;
  notes: string | null;
  invoice_group_id: number | null;
  invoice_group_code: string | null;
  invoice_group_name: string | null;
  linked_invoice_count: number;
  document_count: number;
  created_by_user_id: number | null;
  created_by_username: string | null;
  created_by_full_name: string | null;
  created_at: string;
  updated_at: string;
  linked_invoices?: CostLinkedInvoice[];
  documents?: CostDocument[];
}

export interface CostListResponse {
  data: CostEntry[];
  total: number;
  page: number;
  per_page: number;
}

export interface CostSummaryResponse {
  period: {
    date_from: string | null;
    date_to: string | null;
  };
  totals: {
    invoice_count: number;
    sales_net_pln: number;
    invoice_profit_pln: number;
    cost_count: number;
    costs_pln: number;
    net_after_costs_pln: number;
  };
}

export interface InvoiceCsvImportError {
  row: number;
  message: string;
}

export interface InvoiceCsvImportPreviewItem {
  invoice_number: string;
  customer_name: string;
  item_count: number;
  net_total: number;
  vat_total: number;
  gross_total: number;
  payment_status: 'oplacona' | 'nieoplacona' | 'czesciowa' | 'zwrot';
  paid_amount: number;
  owner_id: number | null;
  duplicate_existing: boolean;
  existing_invoice_id: number | null;
}

export interface InvoiceCsvImportPreviewResponse {
  total_rows: number;
  parsed_invoices: number;
  valid_invoices: number;
  duplicates_existing: number;
  invalid_owner_refs: number;
  errors: InvoiceCsvImportError[];
  preview: InvoiceCsvImportPreviewItem[];
}

export interface InvoiceCsvImportCommitResponse {
  message: string;
  created_count: number;
  skipped_duplicates: number;
  created_invoice_ids: number[];
  skipped?: Array<{
    invoice_number: string;
    existing_invoice_id: number;
    existing_invoice_number: string;
  }>;
}

export interface DashboardSellerSummary {
  owner_id: number | null;
  owner_label: string;
  invoice_count: number;
  sales_net: number;
  profit_total: number;
  margin_weighted: number;
  commission_actual: number;
  commission_estimated: number;
}

export interface DashboardSummaryResponse {
  period: {
    data_od: string | null;
    data_do: string | null;
  };
  totals: {
    invoice_count: number;
    unpaid_invoice_count: number;
    sales_net: number;
    sales_gross: number;
    paid_total: number;
    receivables_open: number;
    paid_ratio: number;
    profit_total: number;
    margin_weighted: number;
  };
  my_summary: {
    linked_manager_id: number | null;
    linked_manager_name: string | null;
    commission_percent: number | null;
    invoice_count: number;
    sales_net: number;
    profit_total: number;
    margin_weighted: number;
    commission_actual: number;
    commission_estimated: number;
    commission_gap: number;
  };
  sellers: DashboardSellerSummary[];
}

export interface DashboardMonthlyComboPoint {
  month: string;
  label: string;
  sales_net: number;
  profit_total: number;
  my_sales_net: number;
  my_earnings: number;
  selected_sales_net: number;
  selected_earnings: number;
}

export interface DashboardMonthlyComboResponse {
  period: {
    months: number;
    from: string;
    to: string;
  };
  selected_scope: {
    mode: 'my' | 'owner';
    owner_id: number | null;
    owner_label: string;
  };
  data: DashboardMonthlyComboPoint[];
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  full_name: string | null;
  user_role: 'admin' | 'manager' | 'bookkeeping' | 'seller' | null;
  event_type: string;
  method: string;
  endpoint: string;
  status_code: number;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditLogListResponse {
  data: AuditLog[];
  total: number;
  page: number;
  per_page: number;
}

export type CrmPipelineType = 'cold_lead' | 'contact';
export type CrmActivityType = 'note' | 'call' | 'email' | 'meeting' | 'import';
export type CrmTaskType = 'meeting' | 'call' | 'email' | 'follow_up' | 'next_contact' | 'other';
export type CrmTaskStatus = 'planned' | 'completed' | 'cancelled';
export type CrmTaskItemKind = 'task' | 'event';
export type CrmTaskRecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly';
export type CrmDuplicateCaseAction = 'merge' | 'keep_separate' | 'request_handover';
export type CrmDuplicateCaseStatus = 'pending' | 'approved' | 'rejected';
export type CrmPriorityBucket = 'high' | 'medium' | 'low';

export interface CrmActivity {
  id: number;
  lead_id: number;
  activity_type: CrmActivityType;
  note: string;
  activity_at: string;
  created_by: string | null;
  created_at: string;
}

export interface CrmLeadProduct {
  id: number;
  lead_id: number;
  product_id: number | null;
  product_name: string | null;
  relation_type: 'interested_in' | 'currently_using';
  volume_text: string | null;
  offered_price: number | null;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmTask {
  id: number;
  lead_id: number | null;
  assigned_user_id: number;
  created_by_user_id: number | null;
  title: string;
  item_kind: CrmTaskItemKind;
  task_type: CrmTaskType;
  status: CrmTaskStatus;
  description: string | null;
  due_at: string;
  remind_at: string | null;
  recurrence_type: CrmTaskRecurrenceType;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_parent_task_id: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  company_name?: string;
  assigned_user_name?: string;
  created_by_name?: string;
  is_overdue?: boolean;
  is_today?: boolean;
}

export interface CrmTaskUser {
  id: number;
  username: string;
  full_name: string;
}

export interface CrmActivityTemplate {
  id: string;
  label: string;
  description: string;
  activity_type: CrmActivityType;
  note_template: string;
  next_task: {
    item_kind: CrmTaskItemKind;
    task_type: CrmTaskType;
    due_in_days: number;
    title: string;
  } | null;
}

export interface CrmDuplicateCase {
  id: number;
  existing_lead_id: number;
  requested_action: CrmDuplicateCaseAction;
  candidate_company_name: string | null;
  candidate_email: string | null;
  candidate_phone: string | null;
  candidate_payload_json: string | null;
  reason: string | null;
  requested_by_user_id: number;
  requested_owner_user_id: number | null;
  status: CrmDuplicateCaseStatus;
  resolved_note: string | null;
  resolved_by_user_id: number | null;
  resolved_lead_id: number | null;
  created_at: string;
  resolved_at: string | null;
  existing_company_name?: string;
  existing_lead_owner?: string | null;
  requested_by_name?: string | null;
  requested_owner_name?: string | null;
  resolved_by_name?: string | null;
}

export interface CrmPriorityLead {
  id: number;
  company_name: string;
  status: string | null;
  lead_owner: string | null;
  hot_rank?: number | null;
  country_code: string | null;
  source_channel: string | null;
  lead_score: number;
  priority_bucket: CrmPriorityBucket;
  next_action_at: string | null;
  last_activity_at: string | null;
  next_task_due_at: string | null;
  overdue_tasks: number;
  planned_tasks: number;
}

export interface CrmLead {
  id: number;
  company_name: string;
  tax_id?: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_type: string | null;
  contact_position: string | null;
  website: string | null;
  status: string | null;
  lost_reason_code?: string | null;
  lead_owner: string | null;
  location: string | null;
  company_address?: string | null;
  delivery_address?: string | null;
  company_size: string | null;
  source_channel: string | null;
  notes: string | null;
  pipeline_type: CrmPipelineType;
  region: string;
  country_code: string | null;
  phone: string | null;
  source_file: string | null;
  source_row: number | null;
  created_by: string | null;
  updated_by: string | null;
  last_contact_at: string | null;
  last_action_at?: string | null;
  last_action_type?: string | null;
  last_action_task_title?: string | null;
  last_task_action_at?: string | null;
  last_task_type?: CrmTaskType | null;
  last_task_status?: CrmTaskStatus | null;
  last_task_title?: string | null;
  last_activity_type?: CrmActivityType | null;
  next_task_due_at?: string | null;
  next_task_type?: CrmTaskType | null;
  next_task_title?: string | null;
  lead_score: number;
  hot_rank?: number | null;
  priority_bucket: CrmPriorityBucket;
  score_updated_at: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at?: string | null;
  activities_count?: number;
  activities?: CrmActivity[];
  lead_products?: CrmLeadProduct[];
  lead_tasks?: CrmTask[];
}

export interface CrmLeadFilters {
  page?: number;
  per_page?: number;
  search?: string;
  status?: string;
  status_in?: string;
  source_channel?: string;
  lead_owner?: string;
  country_code?: string;
  pipeline_type?: CrmPipelineType;
  action_bucket?: 'no_action' | 'no_next_step' | 'overdue' | 'dormant';
  dormant_days?: number;
  hot_rank_min?: number;
}

export interface CrmLeadListResponse {
  data: CrmLead[];
  total: number;
  page: number;
  per_page: number;
}

export interface CrmQuickViewCounts {
  all: number;
  cold: number;
  talks: number;
  won: number;
  lost: number;
  no_action: number;
  no_next_step: number;
  overdue: number;
  dormant: number;
  hot: number;
}

export interface CrmDashboardTeamSummary {
  user_id: number;
  user_name: string;
  role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
  leads_owned: number;
  tasks_completed_mtd: number;
  overdue_tasks_open: number;
  tasks_next_7d: number;
  activities_mtd: number;
  calls_mtd: number;
  emails_mtd: number;
  meetings_mtd: number;
  notes_mtd: number;
  won_mtd: number;
}

export interface CrmDashboardSummaryResponse {
  period: {
    from: string;
    to: string;
    label: string;
  };
  kpis: {
    new_leads_mtd: number;
    won_mtd: number;
    lost_mtd: number;
    win_rate_mtd: number;
    overdue_tasks: number;
    no_next_step: number;
    dormant_14d: number;
  };
  pipeline: {
    all: number;
    cold: number;
    talks: number;
    won: number;
    lost: number;
  };
  team: CrmDashboardTeamSummary[];
}

export interface CrmMetaResponse {
  statuses: string[];
  owners: string[];
  countries: string[];
  sources: string[];
}

export interface CrmImportResponse {
  message: string;
  dry_run: boolean;
  job_id: number;
  file_name: string;
  total_rows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface CrmColumnMapping {
  companyName?: string | number | null;
  firstName?: string | number | null;
  lastName?: string | number | null;
  email?: string | number | null;
  companyType?: string | number | null;
  contactPosition?: string | number | null;
  website?: string | number | null;
  status?: string | number | null;
  leadOwner?: string | number | null;
  region?: string | number | null;
  location?: string | number | null;
  companySize?: string | number | null;
  country?: string | number | null;
  phone?: string | number | null;
  sourceChannel?: string | number | null;
  notes?: Array<string | number> | string | number | null;
  notes2?: string | number | null;
}

export interface CrmImportPreviewResponse {
  file_name: string;
  total_rows: number;
  headers: string[];
  mapping: Record<string, unknown>;
  mapping_headers: Record<string, string | string[] | null>;
  preview_rows: Array<{
    row_number: number;
    raw: unknown[];
    parsed: {
      company_name: string;
      email: string | null;
      phone: string | null;
      has_contact: boolean;
      lead_owner: string | null;
      source_channel: string | null;
      status: string | null;
      country_code: string | null;
      region: string;
      pipeline_type: CrmPipelineType;
    } | null;
  }>;
}

// Resource Templates
export type ResourceCategory = string;

export interface ResourceCategoryItem {
  code: string;
  name: string;
  template_count: number;
  created_at: string;
}

export interface Translation {
  id: number;
  template_id: number;
  language_code: string;
  version_number: number;
  version_label: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ResourceTemplate {
  id: number;
  title: string;
  category: ResourceCategory;
  content: string;
  tags: string[];
  created_by_user_id: number | null;
  created_by_username: string | null;
  created_by_full_name: string | null;
  translations: Translation[];
  created_at: string;
  updated_at: string;
}

export interface ResourceCreator {
  user_id: number;
  username: string;
  full_name: string;
  template_count: number;
}

export interface SupportedLanguage {
  code: string;
  name: string;
  native_name: string;
  enabled: boolean;
}

export interface ResourceTemplateListResponse {
  data: ResourceTemplate[];
  total: number;
}

export interface ResourceFile {
  id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  category: string | null;
  description: string | null;
  uploaded_by_user_id: number | null;
  uploaded_by_username: string | null;
  uploaded_by_full_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceFileListResponse {
  data: ResourceFile[];
  total: number;
}
