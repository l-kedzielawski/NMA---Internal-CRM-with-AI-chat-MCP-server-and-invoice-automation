// @ts-nocheck
/* eslint-disable */
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  Upload,
  Save,
  RefreshCw,
  PlusCircle,
  FileSpreadsheet,
  Trash2,
  X,
  Download,
  CheckSquare
} from 'lucide-react';
import { crmApi, productsApi } from '../services/api';
import type {
  CrmActivity,
  CrmActivityType,
  CrmColumnMapping,
  CrmImportResponse,
  CrmImportPreviewResponse,
  CrmLead,
  CrmLeadFilters,
  CrmLeadProduct,
  CrmQuickViewCounts,
  CrmMetaResponse,
  CrmPipelineType,
  CrmTask,
  CrmTaskStatus,
  CrmTaskType,
  CrmTaskUser,
  Product
} from '../types';
import { useAuth } from '../contexts/AuthContext';

interface LeadDraft {
  company_name: string;
  tax_id: string;
  first_name: string;
  last_name: string;
  company_type: string;
  contact_position: string;
  website: string;
  status: string;
  lost_reason_code: string;
  lead_owner: string;
  location: string;
  company_address: string;
  delivery_address: string;
  company_size: string;
  source_channel: string;
  country_code: string;
  pipeline_type: CrmPipelineType;
  email: string;
  phone: string;
  notes: string;
}

interface LeadInlineTaskDraft {
  title: string;
  task_type: CrmTaskType;
  due_at: string;
  remind_at: string;
  description: string;
}

interface ManualLeadForm {
  company_name: string;
  tax_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_type: string;
  contact_position: string;
  website: string;
  status: string;
  lost_reason_code: string;
  lead_owner: string;
  location: string;
  company_address: string;
  delivery_address: string;
  company_size: string;
  source_channel: string;
  notes: string;
  country_code: string;
  pipeline_type: CrmPipelineType;
}

interface TaskDraft {
  lead_id: string;
  title: string;
  task_type: CrmTaskType;
  due_at: string;
  remind_at: string;
  description: string;
  assigned_user_id: string;
}

interface TaskEditDraft {
  title: string;
  task_type: CrmTaskType;
  status: CrmTaskStatus;
  due_at: string;
  remind_at: string;
  description: string;
  assigned_user_id: string;
}

interface LeadProductDraft {
  product_id: string;
  product_name: string;
  relation_type: 'interested_in' | 'currently_using';
  volume_text: string;
  offered_price: string;
  currency: string;
  notes: string;
}

type CrmQuickView =
  | 'all'
  | 'cold'
  | 'talks'
  | 'won'
  | 'lost'
  | 'no_action'
  | 'no_next_step'
  | 'overdue'
  | 'dormant'
  | 'hot';

const QUICK_VIEW_OPTIONS: Array<{ id: CrmQuickView; label: string }> = [
  { id: 'all', label: 'All Leads' },
  { id: 'cold', label: 'Cold Leads' },
  { id: 'talks', label: 'In Talks' },
  { id: 'no_action', label: 'No Action Yet' },
  { id: 'no_next_step', label: 'No Next Step' },
  { id: 'overdue', label: 'Overdue Tasks' },
  { id: 'dormant', label: 'Dormant 14d' },
  { id: 'hot', label: 'Hot 8-10' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' }
];

const SOURCE_CHANNEL_OPTIONS = ['Internet search', 'Referral', 'Kampania', 'Targi'];
const COMPANY_SIZE_OPTIONS = ['Small fish', 'Medium fish', 'Big fish'];
const COMPANY_TYPE_OPTIONS = ['Manufacturer', 'Distributor', 'Processor'];
const PRODUCT_RELATION_OPTIONS: Array<{ value: 'interested_in' | 'currently_using'; label: string }> = [
  { value: 'interested_in', label: 'Interested in Product' },
  { value: 'currently_using', label: 'Currently Using' }
];

const TASK_TYPE_OPTIONS: Array<{ value: CrmTaskType; label: string }> = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'next_contact', label: 'Next Contact' },
  { value: 'other', label: 'Other' }
];

const ACTION_TYPE_LABELS: Record<string, string> = {
  meeting: 'Meeting',
  call: 'Call',
  email: 'Email',
  follow_up: 'Follow-up',
  next_contact: 'Next Contact',
  other: 'Task',
  note: 'Note',
  import: 'Import',
  contact: 'Contact Update',
  lead_created: 'Lead Created',
  activity: 'Activity',
  task: 'Task'
};

const TASK_ACTION_TYPES = new Set(['meeting', 'call', 'email', 'follow_up', 'next_contact', 'other']);

const TASK_STATUS_OPTIONS: Array<{ value: CrmTaskStatus; label: string }> = [
  { value: 'planned', label: 'Planned' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' }
];

const CRM_STATUS_GROUPS = {
  cold: ['Cold Lead'],
  talks: ['Interested', 'Meeting Booked', 'Meeting Completed', 'Out of Office', 'Wrong Person'],
  won: ['Won'],
  lost: ['Not Interested', 'Lost']
} as const;

const CRM_STATUS_OPTIONS = [
  { value: 'Cold Lead', bg: '#9ca3af', text: '#111827', border: '#6b7280' },
  { value: 'Interested', bg: '#86efac', text: '#14532d', border: '#22c55e' },
  { value: 'Meeting Booked', bg: '#d8b4fe', text: '#4c1d95', border: '#a855f7' },
  { value: 'Meeting Completed', bg: '#fde68a', text: '#78350f', border: '#f59e0b' },
  { value: 'Won', bg: '#facc15', text: '#713f12', border: '#eab308' },
  { value: 'Out of Office', bg: '#bae6fd', text: '#0c4a6e', border: '#38bdf8' },
  { value: 'Wrong Person', bg: '#93c5fd', text: '#1e3a8a', border: '#3b82f6' },
  { value: 'Not Interested', bg: '#fecaca', text: '#7f1d1d', border: '#f87171' },
  { value: 'Lost', bg: '#dc2626', text: '#ffffff', border: '#b91c1c' }
] as const;

const STATUS_ALIAS_MAP: Record<string, string> = {
  'cold lead': 'Cold Lead',
  'cold contact': 'Cold Lead',
  'brak kontaktu': 'Cold Lead',
  'zimny lead': 'Cold Lead',
  interested: 'Interested',
  'ponowny kontakt': 'Interested',
  'wyslany mail': 'Interested',
  'wyslane probki': 'Interested',
  zainteresowany: 'Interested',
  'meeting booked': 'Meeting Booked',
  'umowione spotkanie': 'Meeting Booked',
  'meeting completed': 'Meeting Completed',
  'spotkanie zakonczone': 'Meeting Completed',
  won: 'Won',
  wspolpraca: 'Won',
  wygrane: 'Won',
  'out of office': 'Out of Office',
  'poza biurem': 'Out of Office',
  'wrong person': 'Wrong Person',
  'nie ta osoba': 'Wrong Person',
  'not interested': 'Not Interested',
  odmowa: 'Not Interested',
  niezainteresowany: 'Not Interested',
  lost: 'Lost',
  utracony: 'Lost'
};

const LOST_REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'price_too_high', label: 'Price Too High' },
  { value: 'timing_not_now', label: 'Timing / Not Now' },
  { value: 'no_decision_maker', label: 'No Decision Maker' },
  { value: 'competitor_chosen', label: 'Competitor Chosen' },
  { value: 'no_need', label: 'No Current Need' },
  { value: 'no_response', label: 'No Response' },
  { value: 'quality_mismatch', label: 'Quality Mismatch' },
  { value: 'terms_not_accepted', label: 'Terms Not Accepted' },
  { value: 'other', label: 'Other' }
];

const MAPPING_FIELDS: Array<{ key: keyof CrmColumnMapping; label: string; optional?: boolean }> = [
  { key: 'companyName', label: 'Company Name' },
  { key: 'firstName', label: 'First Name', optional: true },
  { key: 'lastName', label: 'Last Name', optional: true },
  { key: 'email', label: 'Email', optional: true },
  { key: 'title', label: 'Title', optional: true },
  { key: 'companyType', label: 'Company Type', optional: true },
  { key: 'contactPosition', label: 'Position', optional: true },
  { key: 'website', label: 'Website', optional: true },
  { key: 'status', label: 'Status', optional: true },
  { key: 'leadOwner', label: 'Lead Owner', optional: true },
  { key: 'location', label: 'Location', optional: true },
  { key: 'companySize', label: 'Company Size', optional: true },
  { key: 'country', label: 'Country', optional: true },
  { key: 'phone', label: 'Phone', optional: true },
  { key: 'sourceChannel', label: 'Source Channel', optional: true },
  { key: 'notes', label: 'Notes #1', optional: true },
  { key: 'notes2', label: 'Notes #2', optional: true }
];

function toDateTimeLocal(input: string | null | undefined): string {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDateTimeLocal(input: string): string | null {
  if (!input) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getDefaultTaskDateTimeLocal(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return toDateTimeLocal(now.toISOString());
}

function getContactSummary(lead: CrmLead): string {
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
  const position = (lead.contact_position || '').trim();

  if (fullName && position) {
    return `${fullName} - ${position}`;
  }

  if (fullName) {
    return fullName;
  }

  if (position) {
    return position;
  }

  return '-';
}

function getNotesPreview(notes: string | null | undefined): string {
  const clean = (notes || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '-';

  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [];
  const previewSentences = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, 2);

  if (previewSentences.length > 0) {
    const merged = previewSentences.join(' ').trim();
    return merged.length > 220 ? `${merged.slice(0, 217)}...` : merged;
  }

  const words = clean.split(' ').filter(Boolean);
  if (words.length <= 30) {
    return clean;
  }

  return `${words.slice(0, 30).join(' ')}...`;
}

function formatDate(input: string | null | undefined): string {
  if (!input) return '-';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pl-PL');
}

function formatActionType(type: string | null | undefined, title?: string | null): string {
  if (!type) return '-';

  const normalized = type.trim();
  if (!normalized) return '-';

  const baseLabel = ACTION_TYPE_LABELS[normalized]
    || normalized
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const cleanTitle = (title || '').trim();
  if (cleanTitle) {
    return `${baseLabel} - ${cleanTitle}`;
  }

  return baseLabel;
}

function getTaskCompletionBadge(status: string | null | undefined): { symbol: string; label: string; className: string } {
  if (status === 'completed') {
    return {
      symbol: '✓',
      label: 'Completed',
      className: 'text-success font-semibold'
    };
  }

  if (status === 'planned') {
    return {
      symbol: '✗',
      label: 'Not completed',
      className: 'text-danger font-semibold'
    };
  }

  if (status === 'cancelled') {
    return {
      symbol: '✗',
      label: 'Cancelled',
      className: 'text-danger font-semibold'
    };
  }

  return {
    symbol: '-',
    label: 'No task',
    className: 'text-text-muted'
  };
}

function normalizeStatusForUi(input: string | null | undefined): string {
  if (!input || !input.trim()) return 'Cold Lead';
  const trimmed = input.trim();
  const exact = CRM_STATUS_OPTIONS.find((option) => option.value === trimmed);
  if (exact) return exact.value;

  const normalized = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return STATUS_ALIAS_MAP[normalized] || 'Cold Lead';
}

function isLostStatusForUi(input: string | null | undefined): boolean {
  const normalized = normalizeStatusForUi(input);
  return normalized === 'Lost' || normalized === 'Not Interested';
}

function normalizeSourceChannelForUi(input: string | null | undefined): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';

  const normalized = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';
  if (normalized.includes('internet') || normalized.includes('search') || normalized.includes('wyszuk')) {
    return 'Internet search';
  }

  if (normalized.includes('polecenie') || normalized.includes('referral') || normalized.includes('rekomend')) {
    return 'Referral';
  }

  if (normalized.includes('kampania') || normalized.includes('campaign')) {
    return 'Kampania';
  }

  if (normalized.includes('targi') || normalized.includes('trade fair') || normalized.includes('expo')) {
    return 'Targi';
  }

  return trimmed;
}

function getLostReasonLabel(code: string | null | undefined): string {
  if (!code) return '-';
  const match = LOST_REASON_OPTIONS.find((entry) => entry.value === code);
  return match?.label || code;
}

function getStatusInlineStyle(status: string | null | undefined): Record<string, string> {
  const normalized = normalizeStatusForUi(status);
  const theme = CRM_STATUS_OPTIONS.find((option) => option.value === normalized);
  if (!theme) {
    return {
      backgroundColor: '#9ca3af',
      color: '#111827',
      borderColor: '#6b7280'
    };
  }

  return {
    backgroundColor: theme.bg,
    color: theme.text,
    borderColor: theme.border
  };
}

function getOwnerInlineStyle(owner: string | null | undefined): Record<string, string> {
  if (!owner || !owner.trim()) {
    return {
      backgroundColor: '#3a4147',
      color: '#e5e7eb',
      borderColor: '#6b7280'
    };
  }

  return {
    backgroundColor: 'var(--surface-1)',
    color: 'var(--text)',
    borderColor: 'var(--border)'
  };
}

function getHotRankInlineStyle(rank: number | null | undefined): Record<string, string> {
  if (!rank) {
    return {
      backgroundColor: '#3a4147',
      color: '#e5e7eb',
      borderColor: '#6b7280'
    };
  }

  const clamped = Math.max(1, Math.min(10, Number(rank)));
  const intensity = clamped / 10;
  const hue = Math.round(190 - intensity * 170);

  return {
    backgroundColor: `hsl(${hue}, 92%, 90%)`,
    color: `hsl(${hue}, 70%, 24%)`,
    borderColor: `hsl(${hue}, 75%, 60%)`
  };
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const maybe = error as { response?: { data?: { error?: string; details?: string; message?: string } } };
  const data = maybe?.response?.data;
  if (data?.details) return `${fallback} (${data.details})`;
  if (data?.error) return `${fallback} (${data.error})`;
  if (data?.message) return `${fallback} (${data.message})`;
  return fallback;
}

export function CrmPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<CrmLeadFilters>({
    page: 1,
    per_page: 50
  });
  const [activeQuickView, setActiveQuickView] = useState<CrmQuickView>('all');
  const [searchInput, setSearchInput] = useState('');
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<CrmMetaResponse>({
    statuses: [],
    owners: [],
    countries: [],
    sources: []
  });
  const [quickViewCounts, setQuickViewCounts] = useState<CrmQuickViewCounts>({
    all: 0,
    cold: 0,
    talks: 0,
    won: 0,
    lost: 0,
    no_action: 0,
    no_next_step: 0,
    overdue: 0,
    dormant: 0,
    hot: 0
  });

  const [expandedLeadIds, setExpandedLeadIds] = useState<number[]>([]);
  const [leadDetails, setLeadDetails] = useState<Record<number, CrmLead>>({});
  const [leadDrafts, setLeadDrafts] = useState<Record<number, LeadDraft>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [activityTypeDrafts, setActivityTypeDrafts] = useState<Record<number, CrmActivityType>>({});
  const [savingLeadId, setSavingLeadId] = useState<number | null>(null);
  const [addingActivityLeadId, setAddingActivityLeadId] = useState<number | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLeadOwner, setImportLeadOwner] = useState('');
  const [importSourceChannel, setImportSourceChannel] = useState('Internet search');
  const [importDryRun, setImportDryRun] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<CrmImportResponse | null>(null);
  const [previewResult, setPreviewResult] = useState<CrmImportPreviewResponse | null>(null);
  const [mappingConfig, setMappingConfig] = useState<CrmColumnMapping>({});
  const [previewing, setPreviewing] = useState(false);
  const [productCatalog, setProductCatalog] = useState<Product[]>([]);
  const [leadProductDrafts, setLeadProductDrafts] = useState<Record<number, LeadProductDraft>>({});
  const [leadProductEditDrafts, setLeadProductEditDrafts] = useState<Record<number, LeadProductDraft>>({});
  const [leadTaskDrafts, setLeadTaskDrafts] = useState<Record<number, LeadInlineTaskDraft>>({});
  const [leadTaskEditDrafts, setLeadTaskEditDrafts] = useState<Record<number, TaskEditDraft>>({});
  const [productSavingLeadId, setProductSavingLeadId] = useState<number | null>(null);
  const [productDeletingId, setProductDeletingId] = useState<number | null>(null);
  const [productUpdatingId, setProductUpdatingId] = useState<number | null>(null);
  const [creatingTaskLeadId, setCreatingTaskLeadId] = useState<number | null>(null);
  const [editingLeadTaskId, setEditingLeadTaskId] = useState<number | null>(null);
  const [editingLeadProductId, setEditingLeadProductId] = useState<number | null>(null);
  const [editingCalendarTaskId, setEditingCalendarTaskId] = useState<number | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);

  const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>([]);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectingAllFiltered, setSelectingAllFiltered] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const [showManualForm, setShowManualForm] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<number[]>([]);
  const [ownerUpdatingIds, setOwnerUpdatingIds] = useState<number[]>([]);
  const [hotRankUpdatingIds, setHotRankUpdatingIds] = useState<number[]>([]);
  const [taskUsers, setTaskUsers] = useState<CrmTaskUser[]>([]);
  const [calendarDate, setCalendarDate] = useState(new Date().toISOString().slice(0, 10));
  const [calendarTasks, setCalendarTasks] = useState<CrmTask[]>([]);
  const [taskLeadSearch, setTaskLeadSearch] = useState('');
  const [taskLeadOptions, setTaskLeadOptions] = useState<CrmLead[]>([]);
  const [loadingTaskLeadOptions, setLoadingTaskLeadOptions] = useState(false);
  const [dailyTasks, setDailyTasks] = useState<CrmTask[]>([]);
  const [showDailyTasks, setShowDailyTasks] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({
    lead_id: '',
    title: '',
    task_type: 'follow_up',
    due_at: getDefaultTaskDateTimeLocal(),
    remind_at: '',
    description: '',
    assigned_user_id: ''
  });
  const [manualLead, setManualLead] = useState<ManualLeadForm>({
    company_name: '',
    tax_id: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company_type: '',
    contact_position: '',
    website: '',
    status: 'Cold Lead',
    lost_reason_code: '',
    lead_owner: '',
    location: '',
    company_address: '',
    delivery_address: '',
    company_size: '',
    source_channel: 'Internet search',
    notes: '',
    country_code: '',
    pipeline_type: 'cold_lead'
  });
  const [duplicateConflict, setDuplicateConflict] = useState<{
    existingLeadId: number;
    existingCompany: string;
    existingOwner: string | null;
    candidatePayload: Record<string, unknown>;
  } | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<'merge' | 'keep_separate' | 'request_handover'>('merge');
  const [duplicateReason, setDuplicateReason] = useState('');
  const [duplicateOwnerUserId, setDuplicateOwnerUserId] = useState('');
  const [submittingDuplicateCase, setSubmittingDuplicateCase] = useState(false);

  const ownerOptions = useMemo(() => {
    return Array.from(new Set(meta.owners.filter(Boolean)));
  }, [meta.owners]);

  const ownerSelectOptions = useMemo(() => {
    const normalized = ownerOptions.map((owner) => owner.trim()).filter((owner) => owner.length > 0);
    const options = [...normalized];

    for (let first = 0; first < normalized.length; first += 1) {
      for (let second = first + 1; second < normalized.length; second += 1) {
        options.push(`${normalized[first]}, ${normalized[second]}`);
      }
    }

    return options;
  }, [ownerOptions]);

  const sourceOptions = useMemo(() => {
    const merged = [
      ...SOURCE_CHANNEL_OPTIONS,
      ...meta.sources
        .map((source) => normalizeSourceChannelForUi(source))
        .filter(Boolean)
    ];
    return Array.from(new Set(merged));
  }, [meta.sources]);

  const sourceOptionsForInput = useMemo(() => sourceOptions.filter((source) => source !== 'Brak'), [sourceOptions]);

  const countryOptions = useMemo(() => {
    return Array.from(new Set(meta.countries.filter(Boolean)));
  }, [meta.countries]);

  const canAssignTasksToOtherUsers = user?.role === 'admin';

  const taskLeadSelectOptions = useMemo(() => {
    const query = taskLeadSearch.trim();
    const map = new Map<number, CrmLead>();

    if (query) {
      for (const lead of taskLeadOptions) {
        map.set(lead.id, lead);
      }
    } else {
      for (const lead of leads) {
        map.set(lead.id, lead);
      }
    }

    const selectedLeadId = Number(taskDraft.lead_id);
    if (selectedLeadId && !Number.isNaN(selectedLeadId) && !map.has(selectedLeadId)) {
      const selectedLeadDetail = leadDetails[selectedLeadId];
      if (selectedLeadDetail) {
        map.set(selectedLeadDetail.id, selectedLeadDetail);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [taskLeadOptions, leads, taskDraft.lead_id, leadDetails, taskLeadSearch]);

  const totalPages = useMemo(() => {
    const perPage = filters.per_page || 50;
    return Math.max(1, Math.ceil(total / perPage));
  }, [filters.per_page, total]);

  useEffect(() => {
    loadMeta();
    loadProductCatalog();
    loadTaskUsers();
  }, []);

  useEffect(() => {
    loadLeads();
  }, [filters]);

  useEffect(() => {
    setSelectedLeadIds((current) => current.filter((id) => leads.some((lead) => lead.id === id)));
  }, [leads]);

  useEffect(() => {
    if (!taskLeadSearch.trim()) {
      setTaskLeadOptions(leads.slice(0, 50));
    }
  }, [leads, taskLeadSearch]);

  useEffect(() => {
    const query = taskLeadSearch.trim();
    if (!query) return;

    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        setLoadingTaskLeadOptions(true);
        const response = await crmApi.getLeads({
          page: 1,
          per_page: 50,
          search: query,
        });

        if (!cancelled) {
          setTaskLeadOptions(response.data.data || []);
        }
      } catch (leadSearchError) {
        if (!cancelled) {
          console.error('Error searching leads for calendar select:', leadSearchError);
        }
      } finally {
        if (!cancelled) {
          setLoadingTaskLeadOptions(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [taskLeadSearch]);

  useEffect(() => {
    loadCalendarTasks();
  }, [calendarDate]);

  useEffect(() => {
    if (!user?.id) return;
    loadTodayTasksForDailyVisit();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    setTaskDraft((current) => ({
      ...current,
      assigned_user_id: current.assigned_user_id || String(user.id)
    }));
  }, [user?.id]);

  const loadMeta = async () => {
    try {
      const response = await crmApi.getMeta();
      setMeta(response.data);
    } catch (metaError) {
      console.error('Error loading CRM metadata:', metaError);
    }
  };

  const loadProductCatalog = async () => {
    try {
      const response = await productsApi.getAll();
      setProductCatalog(response.data || []);
    } catch (catalogError) {
      console.error('Error loading product catalog for CRM:', catalogError);
    }
  };

  const loadTaskUsers = async () => {
    try {
      const response = await crmApi.getTaskUsers();
      setTaskUsers(response.data.data || []);
      setTaskDraft((current) => ({
        ...current,
        assigned_user_id:
          current.assigned_user_id ||
          (user?.id ? String(user.id) : '')
      }));
    } catch (taskUsersError) {
      console.error('Error loading CRM task users:', taskUsersError);
    }
  };

  const loadCalendarTasks = async () => {
    try {
      setLoadingTasks(true);
      const dateFrom = `${calendarDate}T00:00`;
      const dateTo = `${calendarDate}T23:59`;
      const response = await crmApi.getTasks({
        date_from: dateFrom,
        date_to: dateTo,
        status: 'planned'
      });
      setCalendarTasks(response.data.data || []);
    } catch (calendarError) {
      console.error('Error loading CRM calendar tasks:', calendarError);
      setError(getApiErrorMessage(calendarError, 'Failed to load calendar tasks'));
    } finally {
      setLoadingTasks(false);
    }
  };

  const loadTodayTasksForDailyVisit = async () => {
    try {
      const response = await crmApi.getTodayTasks();
      const tasks = response.data.tasks || [];
      setDailyTasks(tasks);

      const key = `crm_daily_tasks_seen_${user?.id}_${response.data.date}`;
      const alreadySeen = localStorage.getItem(key) === '1';
      if (!alreadySeen && tasks.length > 0) {
        setShowDailyTasks(true);
        localStorage.setItem(key, '1');
      }
    } catch (dailyError) {
      console.error('Error loading daily tasks:', dailyError);
    }
  };

  const loadLeads = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await crmApi.getLeads(filters);
      setLeads(response.data.data);
      setTotal(response.data.total);
      void loadQuickViewCounts();
    } catch (loadError: unknown) {
      console.error('Error loading CRM leads:', loadError);
      setError('Failed to load CRM leads.');
    } finally {
      setLoading(false);
    }
  };

  const loadQuickViewCounts = async () => {
    try {
      const response = await crmApi.getQuickViewCounts(filters);
      setQuickViewCounts(response.data);
    } catch (countsError) {
      console.error('Error loading CRM quick view counts:', countsError);
    }
  };

  const applySearch = () => {
    setFilters((current) => ({ ...current, search: searchInput || undefined, page: 1 }));
  };

  const applyQuickView = (view: CrmQuickView) => {
    setActiveQuickView(view);

    setFilters((current) => {
      const next: CrmLeadFilters = {
        ...current,
        page: 1,
        status: undefined,
        status_in: undefined,
        pipeline_type: undefined,
        action_bucket: undefined,
        dormant_days: undefined,
        hot_rank_min: undefined
      };

      if (view === 'cold') {
        next.status_in = CRM_STATUS_GROUPS.cold.join(',');
      }

      if (view === 'talks') {
        next.status_in = CRM_STATUS_GROUPS.talks.join(',');
      }

      if (view === 'won') {
        next.status_in = CRM_STATUS_GROUPS.won.join(',');
      }

      if (view === 'lost') {
        next.status_in = CRM_STATUS_GROUPS.lost.join(',');
      }

      if (view === 'no_action') {
        next.action_bucket = 'no_action';
      }

      if (view === 'no_next_step') {
        next.action_bucket = 'no_next_step';
      }

      if (view === 'overdue') {
        next.action_bucket = 'overdue';
      }

      if (view === 'dormant') {
        next.action_bucket = 'dormant';
        next.dormant_days = 14;
      }

      if (view === 'hot') {
        next.hot_rank_min = 8;
      }

      return next;
    });
  };

  const getQuickViewCount = (view: CrmQuickView): number => {
    if (view === 'all') return quickViewCounts.all;
    if (view === 'cold') return quickViewCounts.cold;
    if (view === 'talks') return quickViewCounts.talks;
    if (view === 'won') return quickViewCounts.won;
    if (view === 'lost') return quickViewCounts.lost;
    if (view === 'no_action') return quickViewCounts.no_action;
    if (view === 'no_next_step') return quickViewCounts.no_next_step;
    if (view === 'overdue') return quickViewCounts.overdue;
    if (view === 'dormant') return quickViewCounts.dormant;
    if (view === 'hot') return quickViewCounts.hot;
    return 0;
  };

  const getImportPipelineType = (): CrmPipelineType => {
    if (activeQuickView === 'talks' || activeQuickView === 'won' || activeQuickView === 'lost') {
      return 'contact';
    }
    return 'cold_lead';
  };

  const toggleExpandLead = async (leadId: number) => {
    setExpandedLeadIds((current) =>
      current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]
    );

    if (!leadDetails[leadId]) {
      try {
        const response = await crmApi.getLeadById(leadId);
        const detailLead = response.data;
        setLeadDetails((current) => ({ ...current, [leadId]: detailLead }));
        setLeadDrafts((current) => ({
          ...current,
          [leadId]: {
            company_name: detailLead.company_name || '',
            tax_id: detailLead.tax_id || '',
            first_name: detailLead.first_name || '',
            last_name: detailLead.last_name || '',
            company_type: detailLead.company_type || '',
            contact_position: detailLead.contact_position || '',
            website: detailLead.website || '',
            status: normalizeStatusForUi(detailLead.status),
            lost_reason_code: detailLead.lost_reason_code || '',
            lead_owner: detailLead.lead_owner || '',
            location: detailLead.location || '',
            company_address: detailLead.company_address || '',
            delivery_address: detailLead.delivery_address || '',
            company_size: detailLead.company_size || '',
            source_channel: normalizeSourceChannelForUi(detailLead.source_channel),
            country_code: detailLead.country_code || '',
            pipeline_type: detailLead.pipeline_type || 'cold_lead',
            email: detailLead.email || '',
            phone: detailLead.phone || '',
            notes: detailLead.notes || ''
          }
        }));
        setActivityTypeDrafts((current) => ({ ...current, [leadId]: 'note' }));
        setLeadProductDrafts((current) => ({
          ...current,
          [leadId]: {
            product_id: '',
            product_name: '',
            relation_type: 'interested_in',
            volume_text: '',
            offered_price: '',
            currency: 'PLN',
            notes: ''
          }
        }));
        setLeadTaskDrafts((current) => ({
          ...current,
          [leadId]: {
            title: '',
            task_type: 'follow_up',
            due_at: getDefaultTaskDateTimeLocal(),
            remind_at: '',
            description: ''
          }
        }));
      } catch (detailsError) {
        console.error('Error loading CRM lead details:', detailsError);
      }
    }
  };

  const reloadLeadDetails = async (leadId: number) => {
    const detailResponse = await crmApi.getLeadById(leadId);
    setLeadDetails((current) => ({ ...current, [leadId]: detailResponse.data }));
  };

  const saveLeadDraft = async (leadId: number) => {
    const draft = leadDrafts[leadId];
    if (!draft) return;

    if (isLostStatusForUi(draft.status) && !draft.lost_reason_code) {
      setError('Select a lost reason code for Lost / Not Interested leads before saving.');
      return;
    }

    try {
      setSavingLeadId(leadId);
      await crmApi.updateLead(leadId, {
        company_name: draft.company_name || null,
        tax_id: draft.tax_id || null,
        first_name: draft.first_name || null,
        last_name: draft.last_name || null,
        company_type: draft.company_type || null,
        contact_position: draft.contact_position || null,
        website: draft.website || null,
        status: normalizeStatusForUi(draft.status),
        lost_reason_code: isLostStatusForUi(draft.status) ? (draft.lost_reason_code || null) : null,
        lead_owner: draft.lead_owner || null,
        location: draft.location || null,
        company_address: draft.company_address || null,
        delivery_address: draft.delivery_address || null,
        company_size: draft.company_size || null,
        source_channel: normalizeSourceChannelForUi(draft.source_channel) || null,
        country_code: draft.country_code || null,
        pipeline_type: draft.pipeline_type,
        email: draft.email || null,
        phone: draft.phone || null,
        notes: draft.notes || null
      });

      const detailResponse = await crmApi.getLeadById(leadId);
      setLeadDetails((current) => ({ ...current, [leadId]: detailResponse.data }));
      await Promise.all([loadLeads(), loadMeta()]);
    } catch (saveError) {
      console.error('Error saving CRM lead:', saveError);
      setError(getApiErrorMessage(saveError, 'Failed to save changes to lead.'));
    } finally {
      setSavingLeadId(null);
    }
  };

  const addActivity = async (leadId: number) => {
    const note = (noteDrafts[leadId] || '').trim();
    if (!note) return;

    try {
      setAddingActivityLeadId(leadId);
      const activityType = activityTypeDrafts[leadId] || 'note';
      await crmApi.addActivity(leadId, {
        activity_type: activityType,
        note,
        created_by: leadDrafts[leadId]?.lead_owner || undefined
      });

      const detailResponse = await crmApi.getLeadById(leadId);
      setLeadDetails((current) => ({ ...current, [leadId]: detailResponse.data }));
      setNoteDrafts((current) => ({ ...current, [leadId]: '' }));
      await loadLeads();
    } catch (activityError) {
      console.error('Error adding CRM activity:', activityError);
      setError('Failed to add activity.');
    } finally {
      setAddingActivityLeadId(null);
    }
  };

  const buildSubmittedMapping = (): CrmColumnMapping | undefined => {
    const entries = Object.entries(mappingConfig).filter(([, value]) => value !== null && value !== undefined && value !== '');
    if (!entries.length) return undefined;
    return entries.reduce<CrmColumnMapping>((acc, [key, value]) => {
      acc[key as keyof CrmColumnMapping] = value as string | number;
      return acc;
    }, {});
  };

  const getFiltersWithoutPagination = (): CrmLeadFilters => {
    const cleanFilters: CrmLeadFilters = { ...filters };
    delete cleanFilters.page;
    delete cleanFilters.per_page;
    return cleanFilters;
  };

  const runPreview = async () => {
    if (!importFile) {
      setError('Select a CSV or Excel file for preview.');
      return;
    }

    try {
      setPreviewing(true);
      setError(null);
      const response = await crmApi.previewImport({
        file: importFile,
        lead_owner: importLeadOwner || undefined,
        source_channel: normalizeSourceChannelForUi(importSourceChannel) || undefined,
        pipeline_type: getImportPipelineType(),
        imported_by: importLeadOwner || undefined,
        mapping: buildSubmittedMapping()
      });

      setPreviewResult(response.data);
      const suggestedMapping = response.data.mapping_headers;
      setMappingConfig({
        companyName: (suggestedMapping.companyName as string | null) || '',
        firstName: (suggestedMapping.firstName as string | null) || '',
        lastName: (suggestedMapping.lastName as string | null) || '',
        email: (suggestedMapping.email as string | null) || '',
        companyType: (suggestedMapping.companyType as string | null) || '',
        contactPosition: (suggestedMapping.contactPosition as string | null) || '',
        website: (suggestedMapping.website as string | null) || '',
        status: (suggestedMapping.status as string | null) || '',
        leadOwner: (suggestedMapping.leadOwner as string | null) || '',
        location: (suggestedMapping.location as string | null) || '',
        companySize: (suggestedMapping.companySize as string | null) || '',
        country: (suggestedMapping.country as string | null) || '',
        phone: (suggestedMapping.phone as string | null) || '',
        sourceChannel: (suggestedMapping.sourceChannel as string | null) || '',
        notes: Array.isArray(suggestedMapping.notes) ? suggestedMapping.notes[0] || '' : '',
        notes2: Array.isArray(suggestedMapping.notes) ? suggestedMapping.notes[1] || '' : ''
      });
    } catch (previewError: unknown) {
      console.error('Error previewing CRM import:', previewError);
      setError(getApiErrorMessage(previewError, 'Failed to prepare import preview'));
    } finally {
      setPreviewing(false);
    }
  };

  const runImport = async () => {
    if (!importFile) {
      setError('Select a CSV or Excel file to import.');
      return;
    }

    try {
      setImporting(true);
      setError(null);
      setImportResult(null);

      const response = await crmApi.importLeads({
        file: importFile,
        lead_owner: importLeadOwner || undefined,
        source_channel: normalizeSourceChannelForUi(importSourceChannel) || undefined,
        pipeline_type: getImportPipelineType(),
        dry_run: importDryRun,
        imported_by: importLeadOwner || undefined,
        mapping: buildSubmittedMapping()
      });

      setImportResult(response.data);

      if (!importDryRun) {
        await Promise.all([loadLeads(), loadMeta()]);
      }
    } catch (importError: unknown) {
      console.error('Error importing CRM leads:', importError);
      setError(getApiErrorMessage(importError, 'Import failed. Check file format and column mapping'));
    } finally {
      setImporting(false);
    }
  };

  const updateLeadStatus = async (leadId: number, nextStatus: string) => {
    const statusValue = normalizeStatusForUi(nextStatus);
    const keepLostReason = isLostStatusForUi(statusValue);

    try {
      setStatusUpdatingIds((current) => [...current, leadId]);
      await crmApi.updateLead(leadId, {
        status: statusValue,
        ...(keepLostReason ? {} : { lost_reason_code: null })
      });

      setLeads((current) =>
        current.map((lead) =>
          lead.id === leadId
            ? { ...lead, status: statusValue, lost_reason_code: keepLostReason ? lead.lost_reason_code || null : null }
            : lead
        )
      );
      setLeadDetails((current) => {
        const detail = current[leadId];
        if (!detail) return current;
        return {
          ...current,
          [leadId]: {
            ...detail,
            status: statusValue,
            lost_reason_code: keepLostReason ? detail.lost_reason_code || null : null
          }
        };
      });
      setLeadDrafts((current) => {
        const draft = current[leadId];
        if (!draft) return current;
        return {
          ...current,
          [leadId]: {
            ...draft,
            status: statusValue,
            lost_reason_code: keepLostReason ? draft.lost_reason_code : ''
          }
        };
      });
    } catch (statusError) {
      console.error('Error updating status:', statusError);
      setError(getApiErrorMessage(statusError, 'Failed to update status'));
    } finally {
      setStatusUpdatingIds((current) => current.filter((id) => id !== leadId));
    }
  };

  const updateLeadOwner = async (leadId: number, nextOwner: string) => {
    const ownerValue = nextOwner.trim();

    try {
      setOwnerUpdatingIds((current) => [...current, leadId]);
      await crmApi.updateLead(leadId, { lead_owner: ownerValue || null });

      setLeads((current) => current.map((lead) => (lead.id === leadId ? { ...lead, lead_owner: ownerValue || null } : lead)));
      setLeadDetails((current) => {
        const detail = current[leadId];
        if (!detail) return current;
        return {
          ...current,
          [leadId]: {
            ...detail,
            lead_owner: ownerValue || null
          }
        };
      });
      setLeadDrafts((current) => {
        const draft = current[leadId];
        if (!draft) return current;
        return {
          ...current,
          [leadId]: {
            ...draft,
            lead_owner: ownerValue
          }
        };
      });
    } catch (ownerError) {
      console.error('Error updating owner:', ownerError);
      setError(getApiErrorMessage(ownerError, 'Failed to update lead owner'));
    } finally {
      setOwnerUpdatingIds((current) => current.filter((id) => id !== leadId));
    }
  };

  const updateLeadHotRank = async (leadId: number, nextHotRankRaw: string) => {
    const normalizedHotRank = nextHotRankRaw.trim();
    const hotRankValue = normalizedHotRank ? Number(normalizedHotRank) : null;

    if (hotRankValue !== null && (!Number.isInteger(hotRankValue) || hotRankValue < 1 || hotRankValue > 10)) {
      setError('Hot rank must be a number from 1 to 10');
      return;
    }

    try {
      setHotRankUpdatingIds((current) => [...current, leadId]);
      await crmApi.updateLeadHotRank(leadId, hotRankValue);

      setLeads((current) => current.map((lead) => (lead.id === leadId ? { ...lead, hot_rank: hotRankValue } : lead)));
      setLeadDetails((current) => {
        const detail = current[leadId];
        if (!detail) return current;
        return {
          ...current,
          [leadId]: {
            ...detail,
            hot_rank: hotRankValue
          }
        };
      });
    } catch (rankError) {
      console.error('Error updating hot rank:', rankError);
      setError(getApiErrorMessage(rankError, 'Failed to update hot rank'));
    } finally {
      setHotRankUpdatingIds((current) => current.filter((id) => id !== leadId));
    }
  };

  const toggleLeadSelection = (leadId: number) => {
    setSelectedLeadIds((current) =>
      current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = leads.map((lead) => lead.id);
    const allVisibleSelected = visibleIds.every((id) => selectedLeadIds.includes(id));

    if (allVisibleSelected) {
      setSelectedLeadIds((current) => current.filter((id) => !visibleIds.includes(id)));
      return;
    }

    setSelectedLeadIds((current) => Array.from(new Set([...current, ...visibleIds])));
  };

  const deleteSelectedLeads = async () => {
    if (!selectedLeadIds.length) return;

    const confirmed = window.confirm(`Delete ${selectedLeadIds.length} selected lead(s)?`);
    if (!confirmed) return;

    try {
      setDeletingSelected(true);
      setError(null);
      await crmApi.bulkDeleteLeads(selectedLeadIds);
      setSelectedLeadIds([]);
      setExpandedLeadIds((current) => current.filter((id) => !selectedLeadIds.includes(id)));
      await Promise.all([loadLeads(), loadMeta()]);
    } catch (deleteError) {
      console.error('Error deleting selected leads:', deleteError);
      setError(getApiErrorMessage(deleteError, 'Failed to delete selected leads'));
    } finally {
      setDeletingSelected(false);
    }
  };

  const selectAllFilteredLeads = async () => {
    try {
      setSelectingAllFiltered(true);
      setError(null);
      const response = await crmApi.getLeadIds(getFiltersWithoutPagination());
      setSelectedLeadIds(response.data.ids);
    } catch (selectionError) {
      console.error('Error selecting all filtered leads:', selectionError);
      setError(getApiErrorMessage(selectionError, 'Failed to select all filtered leads'));
    } finally {
      setSelectingAllFiltered(false);
    }
  };

  const exportFilteredCsv = async () => {
    try {
      setExportingCsv(true);
      setError(null);

      const response = await crmApi.exportLeadsCsv(getFiltersWithoutPagination());
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateSuffix = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `crm_leads_${dateSuffix}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      console.error('Error exporting CSV:', exportError);
      setError(getApiErrorMessage(exportError, 'Failed to export CSV'));
    } finally {
      setExportingCsv(false);
    }
  };

  const createManualLead = async () => {
    if (!manualLead.company_name.trim()) {
      setError('Company Name is required.');
      return;
    }

    if (!manualLead.email.trim() && !manualLead.phone.trim()) {
      setError('Contact information required: email or phone.');
      return;
    }

    if (isLostStatusForUi(manualLead.status) && !manualLead.lost_reason_code) {
      setError('Select a lost reason code for Lost / Not Interested leads.');
      return;
    }

    try {
      setCreatingLead(true);
      setError(null);
      await crmApi.createLead({
        company_name: manualLead.company_name.trim(),
        tax_id: manualLead.tax_id.trim() || null,
        first_name: manualLead.first_name.trim() || null,
        last_name: manualLead.last_name.trim() || null,
        email: manualLead.email.trim() || null,
        phone: manualLead.phone.trim() || null,
        company_type: manualLead.company_type.trim() || null,
        contact_position: manualLead.contact_position.trim() || null,
        website: manualLead.website.trim() || null,
        status: normalizeStatusForUi(manualLead.status),
        lost_reason_code: isLostStatusForUi(manualLead.status) ? (manualLead.lost_reason_code || null) : null,
        lead_owner: manualLead.lead_owner.trim() || null,
        location: manualLead.location.trim() || null,
        company_address: manualLead.company_address.trim() || null,
        delivery_address: manualLead.delivery_address.trim() || null,
        company_size: manualLead.company_size.trim() || null,
        source_channel: normalizeSourceChannelForUi(manualLead.source_channel) || null,
        notes: manualLead.notes.trim() || null,
        country_code: manualLead.country_code.trim() || null,
        pipeline_type: manualLead.pipeline_type
      });

      setManualLead((current) => ({
        ...current,
        company_name: '',
        tax_id: '',
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        company_type: '',
        contact_position: '',
        website: '',
        status: 'Cold Lead',
        lost_reason_code: '',
        location: '',
        company_address: '',
        delivery_address: '',
        company_size: '',
        source_channel: manualLead.source_channel || 'Internet search',
        notes: '',
        country_code: ''
      }));
      setShowManualForm(false);
      await Promise.all([loadLeads(), loadMeta()]);
    } catch (createError) {
      console.error('Error creating lead manually:', createError);
      const maybe = createError as {
        response?: {
          status?: number;
          data?: {
            lead_id?: number;
            company_name?: string;
            lead_owner?: string | null;
          };
        };
      };

      if (maybe.response?.status === 409) {
        const duplicateCompany = maybe.response?.data?.company_name || 'Lead';
        const duplicateOwner = maybe.response?.data?.lead_owner || 'Unassigned';
        const existingLeadId = Number(maybe.response?.data?.lead_id || 0);
        setDuplicateConflict({
          existingLeadId,
          existingCompany: duplicateCompany,
          existingOwner: duplicateOwner,
          candidatePayload: {
            company_name: manualLead.company_name.trim(),
            tax_id: manualLead.tax_id.trim() || null,
            first_name: manualLead.first_name.trim() || null,
            last_name: manualLead.last_name.trim() || null,
            email: manualLead.email.trim() || null,
            phone: manualLead.phone.trim() || null,
            title: manualLead.title.trim() || null,
            company_type: manualLead.company_type.trim() || null,
            contact_position: manualLead.contact_position.trim() || null,
            website: manualLead.website.trim() || null,
            status: manualLead.status.trim() || null,
            lost_reason_code: isLostStatusForUi(manualLead.status) ? (manualLead.lost_reason_code || null) : null,
            lead_owner: manualLead.lead_owner.trim() || user?.full_name || null,
            location: manualLead.location.trim() || null,
            company_address: manualLead.company_address.trim() || null,
            delivery_address: manualLead.delivery_address.trim() || null,
            company_size: manualLead.company_size.trim() || null,
            source_channel: normalizeSourceChannelForUi(manualLead.source_channel) || null,
            notes: manualLead.notes.trim() || null,
            country_code: manualLead.country_code.trim() || null,
            pipeline_type: manualLead.pipeline_type
          }
        });
        setDuplicateAction('merge');
        setDuplicateReason('');
        setDuplicateOwnerUserId(user?.id ? String(user.id) : '');
      }

      setError(getApiErrorMessage(createError, 'Failed to create new lead'));
    } finally {
      setCreatingLead(false);
    }
  };

  const submitDuplicateCase = async () => {
    if (!duplicateConflict) return;
    if (!duplicateConflict.existingLeadId) {
      setError('Cannot submit duplicate case: missing existing lead ID.');
      return;
    }

    try {
      setSubmittingDuplicateCase(true);
      setError(null);
      await crmApi.createDuplicateCase({
        existing_lead_id: duplicateConflict.existingLeadId,
        requested_action: duplicateAction,
        reason: duplicateReason.trim() || undefined,
        requested_owner_user_id:
          duplicateAction === 'request_handover' && duplicateOwnerUserId
            ? Number(duplicateOwnerUserId)
            : undefined,
        candidate_payload: duplicateConflict.candidatePayload
      });

      setDuplicateConflict(null);
      setDuplicateReason('');
      setDuplicateAction('merge');
      setDuplicateOwnerUserId('');
      setError('Duplicate workflow request was submitted for manager review.');
    } catch (duplicateCaseError) {
      console.error('Error creating duplicate case:', duplicateCaseError);
      setError(getApiErrorMessage(duplicateCaseError, 'Failed to create duplicate workflow case'));
    } finally {
      setSubmittingDuplicateCase(false);
    }
  };

  const createTaskForLead = async () => {
    const leadId = Number(taskDraft.lead_id);
    if (!leadId || Number.isNaN(leadId)) {
      setError('Select a lead for this task.');
      return;
    }

    const dueAt = fromDateTimeLocal(taskDraft.due_at);
    if (!dueAt) {
      setError('Task date and time are required.');
      return;
    }

    const remindAt = taskDraft.remind_at ? fromDateTimeLocal(taskDraft.remind_at) : null;

    try {
      setSavingTask(true);
      setError(null);
      await crmApi.createLeadTask(leadId, {
        title: taskDraft.title.trim() || undefined,
        task_type: taskDraft.task_type,
        description: taskDraft.description.trim() || null,
        due_at: dueAt,
        remind_at: remindAt,
        assigned_user_id: taskDraft.assigned_user_id ? Number(taskDraft.assigned_user_id) : undefined
      });

      setTaskDraft((current) => ({
        ...current,
        title: '',
        description: '',
        due_at: getDefaultTaskDateTimeLocal(),
        remind_at: ''
      }));

      await Promise.all([
        loadCalendarTasks(),
        loadTodayTasksForDailyVisit(),
        reloadLeadDetails(leadId),
        loadLeads(),
      ]);
    } catch (taskCreateError) {
      console.error('Error creating CRM task:', taskCreateError);
      setError(getApiErrorMessage(taskCreateError, 'Failed to create task'));
    } finally {
      setSavingTask(false);
    }
  };

  const updateTaskStatus = async (taskId: number, status: CrmTaskStatus, leadId?: number | null) => {
    try {
      await crmApi.updateTask(taskId, { status });
      await Promise.all([
        loadCalendarTasks(),
        loadTodayTasksForDailyVisit(),
        leadId ? reloadLeadDetails(leadId) : Promise.resolve(),
        loadLeads(),
      ]);
    } catch (taskUpdateError) {
      console.error('Error updating CRM task:', taskUpdateError);
      setError(getApiErrorMessage(taskUpdateError, 'Failed to update task'));
    }
  };

  const deleteTask = async (taskId: number, leadId?: number | null) => {
    const confirmed = window.confirm('Delete this task?');
    if (!confirmed) return;

    try {
      await crmApi.deleteTask(taskId);
      await Promise.all([
        loadCalendarTasks(),
        loadTodayTasksForDailyVisit(),
        leadId ? reloadLeadDetails(leadId) : Promise.resolve(),
        loadLeads(),
      ]);

      setEditingLeadTaskId((current) => (current === taskId ? null : current));
      setEditingCalendarTaskId((current) => (current === taskId ? null : current));
    } catch (taskDeleteError) {
      console.error('Error deleting CRM task:', taskDeleteError);
      setError(getApiErrorMessage(taskDeleteError, 'Failed to delete task'));
    }
  };

  const beginTaskEdit = (task: CrmTask, mode: 'lead' | 'calendar') => {
    const draft: TaskEditDraft = {
      title: task.title || '',
      task_type: task.task_type,
      status: task.status,
      due_at: toDateTimeLocal(task.due_at),
      remind_at: toDateTimeLocal(task.remind_at),
      description: task.description || '',
      assigned_user_id: task.assigned_user_id ? String(task.assigned_user_id) : '',
    };

    setLeadTaskEditDrafts((current) => ({
      ...current,
      [task.id]: draft,
    }));

    if (mode === 'lead') {
      setEditingLeadTaskId(task.id);
    } else {
      setEditingCalendarTaskId(task.id);
    }
  };

  const cancelTaskEdit = (taskId: number, mode: 'lead' | 'calendar') => {
    if (mode === 'lead') {
      setEditingLeadTaskId((current) => (current === taskId ? null : current));
    } else {
      setEditingCalendarTaskId((current) => (current === taskId ? null : current));
    }

    setLeadTaskEditDrafts((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  };

  const saveTaskEdit = async (task: CrmTask, mode: 'lead' | 'calendar') => {
    const draft = leadTaskEditDrafts[task.id];
    if (!draft) return;

    const dueAt = fromDateTimeLocal(draft.due_at);
    if (!dueAt) {
      setError('Task date and time are required.');
      return;
    }

    const remindAt = draft.remind_at ? fromDateTimeLocal(draft.remind_at) : null;

    try {
      setUpdatingTaskId(task.id);
      setError(null);

      await crmApi.updateTask(task.id, {
        title: draft.title.trim() || undefined,
        task_type: draft.task_type,
        status: draft.status,
        description: draft.description.trim() || null,
        due_at: dueAt,
        remind_at: remindAt,
        assigned_user_id: draft.assigned_user_id ? Number(draft.assigned_user_id) : undefined,
      });

      await Promise.all([
        loadCalendarTasks(),
        loadTodayTasksForDailyVisit(),
        task.lead_id ? reloadLeadDetails(task.lead_id) : Promise.resolve(),
        loadLeads(),
      ]);

      cancelTaskEdit(task.id, mode);
    } catch (taskUpdateError) {
      console.error('Error updating CRM task:', taskUpdateError);
      setError(getApiErrorMessage(taskUpdateError, 'Failed to update task'));
    } finally {
      setUpdatingTaskId(null);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addLeadProductRelation = async (leadId: number) => {
    const draft = leadProductDrafts[leadId];
    if (!draft) return;

    if (!draft.product_id && !draft.product_name.trim()) {
      setError('Select a product from the list or enter product name.');
      return;
    }

    const offeredPrice = draft.offered_price.trim() ? Number(draft.offered_price.replace(',', '.')) : null;
    if (offeredPrice !== null && Number.isNaN(offeredPrice)) {
      setError('Offered price has invalid format.');
      return;
    }

    try {
      setProductSavingLeadId(leadId);
      setError(null);
      await crmApi.addLeadProduct(leadId, {
        product_id: draft.product_id ? Number(draft.product_id) : null,
        product_name: draft.product_name.trim() || null,
        relation_type: draft.relation_type,
        volume_text: draft.volume_text.trim() || null,
        offered_price: offeredPrice,
        currency: draft.currency.trim() || 'PLN',
        notes: draft.notes.trim() || null
      });

      const detailResponse = await crmApi.getLeadById(leadId);
      setLeadDetails((current) => ({ ...current, [leadId]: detailResponse.data }));
      setLeadProductDrafts((current) => ({
        ...current,
        [leadId]: {
          product_id: '',
          product_name: '',
          relation_type: 'interested_in',
          volume_text: '',
          offered_price: '',
          currency: 'PLN',
          notes: ''
        }
      }));
    } catch (relationError) {
      console.error('Error adding lead product relation:', relationError);
      setError(getApiErrorMessage(relationError, 'Failed to add product to lead'));
    } finally {
      setProductSavingLeadId(null);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const deleteLeadProductRelation = async (leadId: number, relationId: number) => {
    const confirmed = window.confirm('Remove this product from the lead?');
    if (!confirmed) return;

    try {
      setProductDeletingId(relationId);
      setError(null);
      await crmApi.deleteLeadProduct(leadId, relationId);
      const detailResponse = await crmApi.getLeadById(leadId);
      setLeadDetails((current) => ({ ...current, [leadId]: detailResponse.data }));
    } catch (relationError) {
      console.error('Error deleting lead product relation:', relationError);
      setError(getApiErrorMessage(relationError, 'Failed to remove product from lead'));
    } finally {
      setProductDeletingId(null);
    }
  };

  const beginLeadProductEdit = (relation: CrmLeadProduct) => {
    setEditingLeadProductId(relation.id);
    setLeadProductEditDrafts((current) => ({
      ...current,
      [relation.id]: {
        product_id: relation.product_id ? String(relation.product_id) : '',
        product_name: relation.product_name || '',
        relation_type: relation.relation_type,
        volume_text: relation.volume_text || '',
        offered_price: relation.offered_price != null ? String(relation.offered_price) : '',
        currency: relation.currency || 'PLN',
        notes: relation.notes || '',
      }
    }));
  };

  const cancelLeadProductEdit = (relationId: number) => {
    setEditingLeadProductId((current) => (current === relationId ? null : current));
    setLeadProductEditDrafts((current) => {
      const next = { ...current };
      delete next[relationId];
      return next;
    });
  };

  const saveLeadProductRelation = async (leadId: number, relationId: number) => {
    const draft = leadProductEditDrafts[relationId];
    if (!draft) return;

    const offeredPrice = draft.offered_price.trim() ? Number(draft.offered_price.replace(',', '.')) : null;
    if (offeredPrice !== null && Number.isNaN(offeredPrice)) {
      setError('Offered price has invalid format.');
      return;
    }

    try {
      setProductUpdatingId(relationId);
      setError(null);
      await crmApi.updateLeadProduct(leadId, relationId, {
        product_id: draft.product_id ? Number(draft.product_id) : null,
        product_name: draft.product_name.trim() || null,
        relation_type: draft.relation_type,
        volume_text: draft.volume_text.trim() || null,
        offered_price: offeredPrice,
        currency: draft.currency.trim() || 'PLN',
        notes: draft.notes.trim() || null,
      });

      await reloadLeadDetails(leadId);
      cancelLeadProductEdit(relationId);
    } catch (relationError) {
      console.error('Error updating lead product relation:', relationError);
      setError(getApiErrorMessage(relationError, 'Failed to update product relation'));
    } finally {
      setProductUpdatingId(null);
    }
  };

  const createInlineTaskForLead = async (leadId: number) => {
    const draft = leadTaskDrafts[leadId];
    if (!draft) return;

    const dueAt = fromDateTimeLocal(draft.due_at);
    if (!dueAt) {
      setError('Task date and time are required.');
      return;
    }

    const remindAt = draft.remind_at ? fromDateTimeLocal(draft.remind_at) : null;

    try {
      setCreatingTaskLeadId(leadId);
      setError(null);
      await crmApi.createLeadTask(leadId, {
        title: draft.title.trim() || undefined,
        task_type: draft.task_type,
        description: draft.description.trim() || null,
        due_at: dueAt,
        remind_at: remindAt,
      });

      const detailResponse = await crmApi.getLeadById(leadId);
      setLeadDetails((current) => ({ ...current, [leadId]: detailResponse.data }));
      setLeadTaskDrafts((current) => ({
        ...current,
        [leadId]: {
          title: '',
          task_type: draft.task_type,
          due_at: getDefaultTaskDateTimeLocal(),
          remind_at: '',
          description: ''
        }
      }));

      await Promise.all([loadCalendarTasks(), loadTodayTasksForDailyVisit()]);
      await loadLeads();
    } catch (taskCreateError) {
      console.error('Error creating inline lead task:', taskCreateError);
      setError(getApiErrorMessage(taskCreateError, 'Failed to create task'));
    } finally {
      setCreatingTaskLeadId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">CRM Leads</h2>
          <p className="text-sm text-text-muted mt-1">
            Simple multi-country CRM with deduplication and contact history.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportFilteredCsv}
            disabled={exportingCsv}
            className="btn-secondary flex items-center gap-2"
          >
            {exportingCsv ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
            {exportingCsv ? 'Exporting...' : 'Export CSV'}
          </button>
          <button
            onClick={() => {
              setShowManualForm((current) => {
                const next = !current;
                if (next) {
                  setManualLead((manual) => ({
                    ...manual,
                    pipeline_type:
                      activeQuickView === 'talks' || activeQuickView === 'won' || activeQuickView === 'lost'
                        ? 'contact'
                        : 'cold_lead',
                    status: manual.status || 'Cold Lead',
                    lost_reason_code: isLostStatusForUi(manual.status || 'Cold Lead') ? manual.lost_reason_code : '',
                    source_channel: manual.source_channel || importSourceChannel
                  }));
                }
                return next;
              });
            }}
            className="btn-secondary flex items-center gap-2"
          >
            {showManualForm ? <X size={16} /> : <PlusCircle size={16} />}
            {showManualForm ? 'Close Form' : 'Add Manually'}
          </button>
          <button onClick={loadLeads} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={16} />
            Refresh
          </button>
          <a href="/crm/priority" className="btn-secondary">
            Priority Queue
          </a>
          {user?.role === 'admin' && (
            <a href="/crm/conflicts" className="btn-secondary">
              Conflict Queue
            </a>
          )}
        </div>
      </div>

      {error && <div className="card mb-4 bg-red-50 border-red-200 text-danger">{error}</div>}

      {showDailyTasks && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-3xl max-h-[85vh] overflow-auto">
            <div className="flex justify-between items-start gap-3 mb-3">
              <div>
                <h3 className="text-lg font-semibold">Today&apos;s task list</h3>
                <p className="text-sm text-text-muted">
                  This appears once per day per user. You have {dailyTasks.length} planned item(s).
                </p>
              </div>
              <button className="btn-secondary" onClick={() => setShowDailyTasks(false)}>
                Close
              </button>
            </div>

            <div className="space-y-2">
              {dailyTasks.map((task) => (
                <div key={`daily-task-${task.id}`} className="border border-gray-200 rounded-md p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="text-sm text-text-muted">
                      {task.company_name || 'Lead'} • {task.task_type} • {formatDate(task.due_at)}
                    </p>
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={() => updateTaskStatus(task.id, 'completed')}
                  >
                    Mark done
                  </button>
                </div>
              ))}
              {dailyTasks.length === 0 && <p className="text-sm text-text-muted">No tasks for today.</p>}
            </div>
          </div>
        </div>
      )}

      {duplicateConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-2xl">
            <div className="flex justify-between items-start gap-3 mb-3">
              <div>
                <h3 className="text-lg font-semibold">Potential duplicate lead</h3>
                <p className="text-sm text-text-muted">
                  Existing lead: <strong>{duplicateConflict.existingCompany}</strong> (owner: {duplicateConflict.existingOwner || 'Unassigned'})
                </p>
              </div>
              <button
                className="btn-secondary"
                onClick={() => setDuplicateConflict(null)}
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
              <button
                className={`btn-secondary ${duplicateAction === 'merge' ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setDuplicateAction('merge')}
              >
                Request Merge
              </button>
              <button
                className={`btn-secondary ${duplicateAction === 'keep_separate' ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setDuplicateAction('keep_separate')}
              >
                Keep Separate
              </button>
              <button
                className={`btn-secondary ${duplicateAction === 'request_handover' ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setDuplicateAction('request_handover')}
              >
                Request Handover
              </button>
            </div>

            {duplicateAction === 'request_handover' && (
              <select
                className="input mb-3"
                value={duplicateOwnerUserId}
                onChange={(event) => setDuplicateOwnerUserId(event.target.value)}
              >
                <option value="">Assign to me</option>
                {taskUsers.map((taskUser) => (
                  <option key={`handover-user-${taskUser.id}`} value={taskUser.id}>
                    {taskUser.full_name}
                  </option>
                ))}
              </select>
            )}

            <textarea
              className="input min-h-20 mb-3"
              placeholder="Reason for this request (optional)"
              value={duplicateReason}
              onChange={(event) => setDuplicateReason(event.target.value)}
            />

            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={submittingDuplicateCase}
                onClick={submitDuplicateCase}
              >
                {submittingDuplicateCase ? 'Submitting...' : 'Submit for manager review'}
              </button>
              <button className="btn-secondary" onClick={() => setDuplicateConflict(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <datalist id="crm-company-sizes">
        {COMPANY_SIZE_OPTIONS.map((size) => (
          <option key={`size-${size}`} value={size} />
        ))}
      </datalist>

      {showManualForm && (
        <div className="card mb-6">
          <h3 className="text-lg font-semibold mb-3">Add Lead Manually</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <input
              className="input"
              placeholder="Company Name *"
              value={manualLead.company_name}
              onChange={(event) => setManualLead((current) => ({ ...current, company_name: event.target.value }))}
            />
            <input
              className="input"
              placeholder="First Name"
              value={manualLead.first_name}
              onChange={(event) => setManualLead((current) => ({ ...current, first_name: event.target.value }))}
            />
            <input
              className="input"
              placeholder="Tax ID"
              value={manualLead.tax_id}
              onChange={(event) => setManualLead((current) => ({ ...current, tax_id: event.target.value }))}
            />
            <input
              className="input"
              placeholder="Last Name"
              value={manualLead.last_name}
              onChange={(event) => setManualLead((current) => ({ ...current, last_name: event.target.value }))}
            />
            <input
              className="input"
              placeholder="Email"
              value={manualLead.email}
              onChange={(event) => setManualLead((current) => ({ ...current, email: event.target.value }))}
            />
            <input
              className="input"
              placeholder="Phone"
              value={manualLead.phone}
              onChange={(event) => setManualLead((current) => ({ ...current, phone: event.target.value }))}
            />
            <select
              className="input"
              value={manualLead.company_type}
              onChange={(event) => setManualLead((current) => ({ ...current, company_type: event.target.value }))}
            >
              <option value="">Select Company Type</option>
              {COMPANY_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Position"
              value={manualLead.contact_position}
              onChange={(event) => setManualLead((current) => ({ ...current, contact_position: event.target.value }))}
            />
            <input
              className="input"
              placeholder="Website"
              value={manualLead.website}
              onChange={(event) => setManualLead((current) => ({ ...current, website: event.target.value }))}
            />
            <select
              className="input"
              value={manualLead.status}
              onChange={(event) =>
                setManualLead((current) => {
                  const nextStatus = event.target.value;
                  return {
                    ...current,
                    status: nextStatus,
                    lost_reason_code: isLostStatusForUi(nextStatus) ? current.lost_reason_code : ''
                  };
                })
              }
              style={getStatusInlineStyle(manualLead.status)}
            >
              {CRM_STATUS_OPTIONS.map((statusOption) => (
                <option key={statusOption.value} value={statusOption.value}>
                  {statusOption.value}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={manualLead.lost_reason_code}
              onChange={(event) => setManualLead((current) => ({ ...current, lost_reason_code: event.target.value }))}
              disabled={!isLostStatusForUi(manualLead.status)}
            >
              <option value="">Lost reason code</option>
              {LOST_REASON_OPTIONS.map((reason) => (
                <option key={`manual-lost-reason-${reason.value}`} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
            <select
              className="input border"
              style={getOwnerInlineStyle(manualLead.lead_owner)}
              value={manualLead.lead_owner}
              onChange={(event) => setManualLead((current) => ({ ...current, lead_owner: event.target.value }))}
            >
              <option value="">Select Lead Owner</option>
              {ownerSelectOptions.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Location (optional info)"
              value={manualLead.location}
              onChange={(event) => setManualLead((current) => ({ ...current, location: event.target.value }))}
            />
            <input
              className="input"
              list="crm-company-sizes"
              placeholder="Company Size"
              value={manualLead.company_size}
              onChange={(event) => setManualLead((current) => ({ ...current, company_size: event.target.value }))}
            />
            <select
              className="input"
              value={manualLead.source_channel}
              onChange={(event) => setManualLead((current) => ({ ...current, source_channel: event.target.value }))}
            >
              {sourceOptionsForInput.map((source) => (
                <option key={`manual-source-${source}`} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Country Code (PL/CH/DE...)"
              value={manualLead.country_code}
              onChange={(event) => setManualLead((current) => ({ ...current, country_code: event.target.value }))}
            />
            <select
              className="input"
              value={manualLead.pipeline_type}
              onChange={(event) =>
                setManualLead((current) => ({ ...current, pipeline_type: event.target.value as CrmPipelineType }))
              }
            >
              <option value="cold_lead">Cold Leads</option>
              <option value="contact">Contacts (In Talks)</option>
            </select>
            <textarea
              className="input min-h-24 md:col-span-2"
              placeholder="Company address"
              value={manualLead.company_address}
              onChange={(event) => setManualLead((current) => ({ ...current, company_address: event.target.value }))}
            />
            <textarea
              className="input min-h-24 md:col-span-2"
              placeholder="Delivery address (optional, if different)"
              value={manualLead.delivery_address}
              onChange={(event) => setManualLead((current) => ({ ...current, delivery_address: event.target.value }))}
            />
          </div>
          <textarea
            className="input min-h-24 mb-3"
            placeholder="Notes"
            value={manualLead.notes}
            onChange={(event) => setManualLead((current) => ({ ...current, notes: event.target.value }))}
          />

          <div className="flex gap-2">
            <button onClick={createManualLead} disabled={creatingLead} className="btn-primary flex items-center gap-2">
              <Save size={16} />
              {creatingLead ? 'Saving...' : 'Add Lead'}
            </button>
            <button onClick={() => setShowManualForm(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card mb-6">
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => setFilters((current) => ({ ...current, source_channel: undefined, page: 1 }))}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              !filters.source_channel ? 'bg-primary text-white' : 'bg-gray-100 text-text'
            }`}
          >
            All Sources
          </button>
          {sourceOptions.map((source) => (
            <button
              key={source}
              onClick={() => setFilters((current) => ({ ...current, source_channel: source, page: 1 }))}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                filters.source_channel === source ? 'bg-primary text-white' : 'bg-gray-100 text-text'
              }`}
            >
              {source}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => setFilters((current) => ({ ...current, country_code: undefined, page: 1 }))}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              !filters.country_code ? 'bg-primary text-white' : 'bg-gray-100 text-text'
            }`}
          >
            All Countries
          </button>
          {countryOptions.map((countryCode) => (
            <button
              key={countryCode}
              onClick={() => setFilters((current) => ({ ...current, country_code: countryCode, page: 1 }))}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                filters.country_code === countryCode ? 'bg-primary text-white' : 'bg-gray-100 text-text'
              }`}
            >
              {countryCode}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {QUICK_VIEW_OPTIONS.map((view) => (
            <button
              key={view.id}
              onClick={() => applyQuickView(view.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                activeQuickView === view.id ? 'bg-primary text-white' : 'bg-gray-100 text-text'
              }`}
            >
              {view.label} ({getQuickViewCount(view.id)})
            </button>
          ))}
        </div>

        {activeQuickView === 'dormant' && (
          <p className="text-xs text-text-muted mb-4">
            Dormant = open leads with last meaningful action older than 14 days.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
            <input
              type="text"
              className="input input-with-leading-icon"
              placeholder="Search by company, email, location..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applySearch();
                }
              }}
            />
          </div>

          <select
            className="input"
            value={filters.status || ''}
            onChange={(event) => {
              setActiveQuickView('all');
              setFilters((current) => ({
                ...current,
                status: event.target.value || undefined,
                status_in: undefined,
                action_bucket: undefined,
                dormant_days: undefined,
                hot_rank_min: undefined,
                page: 1
              }));
            }}
          >
            <option value="">All Statuses</option>
            {CRM_STATUS_OPTIONS.map((statusOption) => (
              <option key={statusOption.value} value={statusOption.value}>
                {statusOption.value}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={filters.lead_owner || ''}
            onChange={(event) =>
              setFilters((current) => ({ ...current, lead_owner: event.target.value || undefined, page: 1 }))
            }
          >
            <option value="">All Lead Owners</option>
            {ownerOptions.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <input
              className="input"
              list="crm-countries-list"
              placeholder="Country (PL/DE/CH...)"
              value={filters.country_code || ''}
              onChange={(event) =>
                setFilters((current) => ({ ...current, country_code: event.target.value || undefined, page: 1 }))
              }
            />
            <datalist id="crm-countries-list">
              {countryOptions.map((countryCode) => (
                <option key={countryCode} value={countryCode} />
              ))}
            </datalist>

            <button onClick={applySearch} className="btn-primary whitespace-nowrap">
              Filter
            </button>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap justify-between gap-3 items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold">Leads</h3>
            <p className="text-sm text-text-muted">
              Current results for selected filters ({total} total).
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={toggleSelectAllVisible}>
              Toggle visible selection
            </button>
            <button
              className="btn-secondary flex items-center gap-2"
              onClick={selectAllFilteredLeads}
              disabled={selectingAllFiltered}
            >
              <CheckSquare size={16} />
              {selectingAllFiltered ? 'Selecting...' : 'Select all filtered'}
            </button>
            <button
              className="btn-secondary"
              onClick={deleteSelectedLeads}
              disabled={!selectedLeadIds.length || deletingSelected}
            >
              {deletingSelected ? 'Deleting...' : `Delete selected (${selectedLeadIds.length})`}
            </button>
          </div>
        </div>

        <div className="overflow-auto border border-gray-200 rounded-md">
          <table className="min-w-full text-sm">
             <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 w-10"></th>
                <th className="px-3 py-2 w-10"></th>
                <th className="px-3 py-2">Company / Contact</th>
                <th className="px-3 py-2">Company Type</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Country / Location</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Lead Owner</th>
                <th className="px-3 py-2">Hot Rank</th>
                <th className="px-3 py-2">Next Action</th>
                <th className="px-3 py-2">Previous Action</th>
                <th className="px-3 py-2">Last Task</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-3 text-text-muted" colSpan={14}>
                    Loading leads...
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-text-muted" colSpan={14}>
                    No leads found for current filters.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const isExpanded = expandedLeadIds.includes(lead.id);
                  const detail = leadDetails[lead.id];
                  const isStatusUpdating = statusUpdatingIds.includes(lead.id);
                  const isOwnerUpdating = ownerUpdatingIds.includes(lead.id);
                  const isHotRankUpdating = hotRankUpdatingIds.includes(lead.id);
                  const draft = leadDrafts[lead.id];
                  const productDraft = leadProductDrafts[lead.id];
                  const inlineTaskDraft = leadTaskDrafts[lead.id];
                  const activityDraft = noteDrafts[lead.id] || '';
                  const activityTypeDraft = activityTypeDrafts[lead.id] || 'note';
                  const leadProducts = detail?.lead_products || [];
                  const leadTasks = detail?.lead_tasks || [];
                  const leadActivities = detail?.activities || [];
                  const lastTaskBadge = getTaskCompletionBadge(lead.last_task_status);
                  const previousActionTitle = lead.last_action_type && TASK_ACTION_TYPES.has(lead.last_action_type)
                    ? lead.last_action_task_title
                    : null;

                  return (
                    <Fragment key={`lead-row-${lead.id}`}>
                      <tr className="border-t border-gray-100">
                        <td className="px-3 py-2 align-top">
                          <button className="btn-secondary p-1" onClick={() => void toggleExpandLead(lead.id)}>
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={selectedLeadIds.includes(lead.id)}
                            onChange={() => toggleLeadSelection(lead.id)}
                          />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium">{lead.company_name}</div>
                          <div className="text-xs text-text-muted">{getContactSummary(lead)}</div>
                          {lead.tax_id && <div className="text-xs text-text-muted">Tax ID: {lead.tax_id}</div>}
                        </td>
                        <td className="px-3 py-2 align-top">{lead.company_type || '-'}</td>
                        <td className="px-3 py-2 align-top">{lead.email || '-'}</td>
                        <td className="px-3 py-2 align-top">{lead.phone || '-'}</td>
                        <td className="px-3 py-2 align-top">
                          <div>{lead.country_code || '-'}</div>
                          <div className="text-xs text-text-muted">{lead.location || '-'}</div>
                          {lead.company_address && <div className="text-xs text-text-muted whitespace-pre-wrap">{lead.company_address}</div>}
                          {lead.delivery_address && lead.delivery_address !== lead.company_address && (
                            <div className="text-xs text-text-muted whitespace-pre-wrap">Delivery: {lead.delivery_address}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top max-w-[320px]">
                          <div className="text-xs text-text-muted whitespace-normal">{getNotesPreview(lead.notes)}</div>
                        </td>
                        <td className="px-3 py-2 align-top min-w-[180px]">
                          <select
                            className="input border"
                            style={getStatusInlineStyle(lead.status)}
                            value={normalizeStatusForUi(lead.status)}
                            onChange={(event) => void updateLeadStatus(lead.id, event.target.value)}
                            disabled={isStatusUpdating}
                          >
                            {CRM_STATUS_OPTIONS.map((statusOption) => (
                              <option key={`lead-status-${lead.id}-${statusOption.value}`} value={statusOption.value}>
                                {statusOption.value}
                              </option>
                            ))}
                          </select>
                          {lead.lost_reason_code && isLostStatusForUi(lead.status) && (
                            <div className="text-xs text-text-muted mt-1">{getLostReasonLabel(lead.lost_reason_code)}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top min-w-[180px]">
                          <select
                            className="input border"
                            style={getOwnerInlineStyle(lead.lead_owner)}
                            value={lead.lead_owner || ''}
                            onChange={(event) => void updateLeadOwner(lead.id, event.target.value)}
                            disabled={isOwnerUpdating}
                          >
                            <option value="">Unassigned</option>
                            {ownerSelectOptions.map((owner) => (
                              <option key={`lead-owner-${lead.id}-${owner}`} value={owner}>
                                {owner}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 align-top min-w-[120px]">
                          <select
                            className="input border"
                            style={getHotRankInlineStyle(lead.hot_rank)}
                            value={lead.hot_rank ? String(lead.hot_rank) : ''}
                            onChange={(event) => void updateLeadHotRank(lead.id, event.target.value)}
                            disabled={isHotRankUpdating}
                          >
                            <option value="">-</option>
                            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((rank) => (
                              <option key={`lead-hot-rank-${lead.id}-${rank}`} value={rank}>
                                {rank}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <div>{formatDate(lead.next_task_due_at)}</div>
                          <div className="text-xs text-text-muted">{formatActionType(lead.next_task_type, lead.next_task_title)}</div>
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <div>{formatDate(lead.last_action_at || lead.last_activity_at || lead.last_contact_at)}</div>
                          <div className="text-xs text-text-muted">{formatActionType(lead.last_action_type, previousActionTitle)}</div>
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <span
                            className={lastTaskBadge.className}
                            title={lead.last_task_title || lastTaskBadge.label}
                          >
                            {lastTaskBadge.symbol}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-t border-gray-100 bg-gray-50">
                          <td className="px-3 py-3" colSpan={14}>
                            {!draft || !productDraft || !inlineTaskDraft ? (
                              <div className="text-sm text-text-muted">Loading lead details...</div>
                            ) : (
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                  <input
                                    className="input"
                                    placeholder="Company"
                                    value={draft.company_name}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, company_name: event.target.value }
                                      }))
                                    }
                                  />
                                  <input
                                    className="input"
                                    placeholder="First name"
                                    value={draft.first_name}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, first_name: event.target.value }
                                      }))
                                    }
                                  />
                                  <input
                                    className="input"
                                    placeholder="Tax ID"
                                    value={draft.tax_id}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, tax_id: event.target.value }
                                      }))
                                    }
                                  />
                                  <input
                                    className="input"
                                    placeholder="Last name"
                                    value={draft.last_name}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, last_name: event.target.value }
                                      }))
                                    }
                                  />
                                  <select
                                    className="input"
                                    value={draft.company_type}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, company_type: event.target.value }
                                      }))
                                    }
                                  >
                                    <option value="">Select Company Type</option>
                                    {COMPANY_TYPE_OPTIONS.map((type) => (
                                      <option key={type} value={type}>
                                        {type}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    className="input"
                                    placeholder="Position"
                                    value={draft.contact_position}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, contact_position: event.target.value }
                                      }))
                                    }
                                  />
                                  <input
                                    className="input"
                                    placeholder="Email"
                                    value={draft.email}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, email: event.target.value }
                                      }))
                                    }
                                  />
                                  <input
                                    className="input"
                                    placeholder="Phone"
                                    value={draft.phone}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, phone: event.target.value }
                                      }))
                                    }
                                  />
                                  <input
                                    className="input"
                                    placeholder="Website"
                                    value={draft.website}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, website: event.target.value }
                                      }))
                                    }
                                  />
                                  <input
                                    className="input"
                                    placeholder="Location"
                                    value={draft.location}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, location: event.target.value }
                                      }))
                                    }
                                  />
                                  <input
                                    className="input"
                                    list="crm-company-sizes"
                                    placeholder="Company size"
                                    value={draft.company_size}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, company_size: event.target.value }
                                      }))
                                    }
                                  />
                                  <select
                                    className="input"
                                    value={draft.source_channel}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, source_channel: event.target.value }
                                      }))
                                    }
                                  >
                                    <option value="">Source</option>
                                    {sourceOptionsForInput.map((source) => (
                                      <option key={`lead-source-${lead.id}-${source}`} value={source}>
                                        {source}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    className="input"
                                    placeholder="Country code"
                                    value={draft.country_code}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, country_code: event.target.value }
                                      }))
                                    }
                                  />
                                  <select
                                    className="input"
                                    value={draft.pipeline_type}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, pipeline_type: event.target.value as CrmPipelineType }
                                      }))
                                    }
                                  >
                                    <option value="cold_lead">Cold Leads</option>
                                    <option value="contact">Contacts (In Talks)</option>
                                  </select>
                                  <select
                                    className="input"
                                    value={draft.lost_reason_code}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, lost_reason_code: event.target.value }
                                      }))
                                    }
                                    disabled={!isLostStatusForUi(draft.status)}
                                  >
                                    <option value="">Lost reason code</option>
                                    {LOST_REASON_OPTIONS.map((reason) => (
                                      <option key={`lead-lost-reason-${lead.id}-${reason.value}`} value={reason.value}>
                                        {reason.label}
                                      </option>
                                    ))}
                                  </select>
                                  <textarea
                                    className="input min-h-24 md:col-span-2"
                                    placeholder="Company address"
                                    value={draft.company_address}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, company_address: event.target.value }
                                      }))
                                    }
                                  />
                                  <textarea
                                    className="input min-h-24 md:col-span-2"
                                    placeholder="Delivery address (optional, if different)"
                                    value={draft.delivery_address}
                                    onChange={(event) =>
                                      setLeadDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...draft, delivery_address: event.target.value }
                                      }))
                                    }
                                  />
                                </div>

                                <textarea
                                  className="input min-h-20"
                                  placeholder="Lead notes"
                                  value={draft.notes}
                                  onChange={(event) =>
                                    setLeadDrafts((current) => ({
                                      ...current,
                                      [lead.id]: { ...draft, notes: event.target.value }
                                    }))
                                  }
                                />

                                <div className="flex gap-2">
                                  <button
                                    className="btn-primary"
                                    onClick={() => void saveLeadDraft(lead.id)}
                                    disabled={savingLeadId === lead.id}
                                  >
                                    {savingLeadId === lead.id ? 'Saving...' : 'Save lead changes'}
                                  </button>
                                </div>

                                <div className="border border-gray-200 rounded-md p-3 bg-white">
                                  <h4 className="font-semibold mb-2">Schedule task for this lead</h4>
                                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
                                    <input
                                      className="input"
                                      placeholder="Task title"
                                      value={inlineTaskDraft.title}
                                      onChange={(event) =>
                                        setLeadTaskDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...inlineTaskDraft, title: event.target.value }
                                        }))
                                      }
                                    />
                                    <select
                                      className="input"
                                      value={inlineTaskDraft.task_type}
                                      onChange={(event) =>
                                        setLeadTaskDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...inlineTaskDraft, task_type: event.target.value as CrmTaskType }
                                        }))
                                      }
                                    >
                                      {TASK_TYPE_OPTIONS.map((option) => (
                                        <option key={`inline-task-type-${lead.id}-${option.value}`} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="datetime-local"
                                      className="input"
                                      value={inlineTaskDraft.due_at}
                                      onChange={(event) =>
                                        setLeadTaskDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...inlineTaskDraft, due_at: event.target.value }
                                        }))
                                      }
                                    />
                                    <input
                                      type="datetime-local"
                                      className="input"
                                      value={inlineTaskDraft.remind_at}
                                      onChange={(event) =>
                                        setLeadTaskDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...inlineTaskDraft, remind_at: event.target.value }
                                        }))
                                      }
                                    />
                                  </div>
                                  <textarea
                                    className="input min-h-16 mb-2"
                                    placeholder="Task description"
                                    value={inlineTaskDraft.description}
                                    onChange={(event) =>
                                      setLeadTaskDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...inlineTaskDraft, description: event.target.value }
                                      }))
                                    }
                                  />
                                  <button
                                    className="btn-primary"
                                    onClick={() => void createInlineTaskForLead(lead.id)}
                                    disabled={creatingTaskLeadId === lead.id}
                                  >
                                    {creatingTaskLeadId === lead.id ? 'Scheduling...' : 'Schedule task'}
                                  </button>
                                </div>

                                <div className="border border-gray-200 rounded-md p-3 bg-white">
                                  <h4 className="font-semibold mb-2">Scheduled tasks for this lead</h4>
                                  {leadTasks.length === 0 ? (
                                    <p className="text-sm text-text-muted mb-2">No scheduled tasks yet.</p>
                                  ) : (
                                    <div className="space-y-2 mb-3">
                                      {leadTasks.map((task) => {
                                        const taskDraft = leadTaskEditDrafts[task.id];
                                        const isEditingTask = editingLeadTaskId === task.id;

                                        return (
                                          <div key={`lead-task-${lead.id}-${task.id}`} className="border border-gray-100 rounded p-2">
                                            {isEditingTask && taskDraft ? (
                                              <div className="space-y-2">
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                                  <input
                                                    className="input"
                                                    placeholder="Task title"
                                                    value={taskDraft.title}
                                                    onChange={(event) =>
                                                      setLeadTaskEditDrafts((current) => ({
                                                        ...current,
                                                        [task.id]: {
                                                          ...taskDraft,
                                                          title: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                  <select
                                                    className="input"
                                                    value={taskDraft.task_type}
                                                    onChange={(event) =>
                                                      setLeadTaskEditDrafts((current) => ({
                                                        ...current,
                                                        [task.id]: {
                                                          ...taskDraft,
                                                          task_type: event.target.value as CrmTaskType,
                                                        }
                                                      }))
                                                    }
                                                  >
                                                    {TASK_TYPE_OPTIONS.map((option) => (
                                                      <option key={`lead-task-edit-type-${task.id}-${option.value}`} value={option.value}>
                                                        {option.label}
                                                      </option>
                                                    ))}
                                                  </select>
                                                  <select
                                                    className="input"
                                                    value={taskDraft.status}
                                                    onChange={(event) =>
                                                      setLeadTaskEditDrafts((current) => ({
                                                        ...current,
                                                        [task.id]: {
                                                          ...taskDraft,
                                                          status: event.target.value as CrmTaskStatus,
                                                        }
                                                      }))
                                                    }
                                                  >
                                                    {TASK_STATUS_OPTIONS.map((option) => (
                                                      <option key={`lead-task-edit-status-${task.id}-${option.value}`} value={option.value}>
                                                        {option.label}
                                                      </option>
                                                    ))}
                                                  </select>
                                                  <select
                                                    className="input"
                                                    value={taskDraft.assigned_user_id}
                                                    onChange={(event) =>
                                                      setLeadTaskEditDrafts((current) => ({
                                                        ...current,
                                                        [task.id]: {
                                                          ...taskDraft,
                                                          assigned_user_id: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                    disabled={!canAssignTasksToOtherUsers && Boolean(user?.id)}
                                                  >
                                                    <option value="">Assign to me</option>
                                                    {taskUsers.map((taskUser) => (
                                                      <option key={`lead-task-edit-user-${task.id}-${taskUser.id}`} value={taskUser.id}>
                                                        {taskUser.full_name}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                  <input
                                                    type="datetime-local"
                                                    className="input"
                                                    value={taskDraft.due_at}
                                                    onChange={(event) =>
                                                      setLeadTaskEditDrafts((current) => ({
                                                        ...current,
                                                        [task.id]: {
                                                          ...taskDraft,
                                                          due_at: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                  <input
                                                    type="datetime-local"
                                                    className="input"
                                                    value={taskDraft.remind_at}
                                                    onChange={(event) =>
                                                      setLeadTaskEditDrafts((current) => ({
                                                        ...current,
                                                        [task.id]: {
                                                          ...taskDraft,
                                                          remind_at: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                </div>
                                                <textarea
                                                  className="input min-h-16"
                                                  placeholder="Task description"
                                                  value={taskDraft.description}
                                                  onChange={(event) =>
                                                    setLeadTaskEditDrafts((current) => ({
                                                      ...current,
                                                      [task.id]: {
                                                        ...taskDraft,
                                                        description: event.target.value,
                                                      }
                                                    }))
                                                  }
                                                />
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    className="btn-primary"
                                                    onClick={() => void saveTaskEdit(task, 'lead')}
                                                    disabled={updatingTaskId === task.id}
                                                  >
                                                    {updatingTaskId === task.id ? 'Saving...' : 'Save'}
                                                  </button>
                                                  <button
                                                    className="btn-secondary"
                                                    onClick={() => cancelTaskEdit(task.id, 'lead')}
                                                  >
                                                    Cancel
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="text-sm">
                                                  <div className="font-medium">{task.title}</div>
                                                  <div className="text-text-muted">
                                                    {TASK_TYPE_OPTIONS.find((option) => option.value === task.task_type)?.label || task.task_type}
                                                    {' • '}{formatDate(task.due_at)}
                                                    {' • '}{TASK_STATUS_OPTIONS.find((option) => option.value === task.status)?.label || task.status}
                                                  </div>
                                                  {task.description ? <div className="text-text-muted">{task.description}</div> : null}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  {task.status !== 'completed' && (
                                                    <button className="btn-secondary" onClick={() => void updateTaskStatus(task.id, 'completed', lead.id)}>
                                                      Complete
                                                    </button>
                                                  )}
                                                  {task.status !== 'planned' && (
                                                    <button className="btn-secondary" onClick={() => void updateTaskStatus(task.id, 'planned', lead.id)}>
                                                      Reopen
                                                    </button>
                                                  )}
                                                  <button className="btn-secondary" onClick={() => beginTaskEdit(task, 'lead')}>
                                                    Edit
                                                  </button>
                                                  <button className="btn-secondary" onClick={() => void deleteTask(task.id, lead.id)}>
                                                    Delete
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                <div className="border border-gray-200 rounded-md p-3 bg-white">
                                  <h4 className="font-semibold mb-2">Products for this lead</h4>
                                  {leadProducts.length === 0 ? (
                                    <p className="text-sm text-text-muted mb-2">No products linked yet.</p>
                                  ) : (
                                    <div className="space-y-2 mb-3">
                                      {leadProducts.map((relation) => {
                                        const relationDraft = leadProductEditDrafts[relation.id];
                                        const isEditingRelation = editingLeadProductId === relation.id;

                                        return (
                                          <div key={`lead-product-${lead.id}-${relation.id}`} className="border border-gray-100 rounded p-2">
                                            {isEditingRelation && relationDraft ? (
                                              <div className="space-y-2">
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                  <select
                                                    className="input"
                                                    value={relationDraft.product_id}
                                                    onChange={(event) =>
                                                      setLeadProductEditDrafts((current) => ({
                                                        ...current,
                                                        [relation.id]: {
                                                          ...relationDraft,
                                                          product_id: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  >
                                                    <option value="">Select product from catalog</option>
                                                    {productCatalog.map((productItem) => (
                                                      <option key={`lead-product-edit-option-${relation.id}-${productItem.id}`} value={productItem.id}>
                                                        {productItem.nazwa}
                                                      </option>
                                                    ))}
                                                  </select>
                                                  <input
                                                    className="input"
                                                    placeholder="Or custom product name"
                                                    value={relationDraft.product_name}
                                                    onChange={(event) =>
                                                      setLeadProductEditDrafts((current) => ({
                                                        ...current,
                                                        [relation.id]: {
                                                          ...relationDraft,
                                                          product_name: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                  <select
                                                    className="input"
                                                    value={relationDraft.relation_type}
                                                    onChange={(event) =>
                                                      setLeadProductEditDrafts((current) => ({
                                                        ...current,
                                                        [relation.id]: {
                                                          ...relationDraft,
                                                          relation_type: event.target.value as 'interested_in' | 'currently_using',
                                                        }
                                                      }))
                                                    }
                                                  >
                                                    {PRODUCT_RELATION_OPTIONS.map((option) => (
                                                      <option key={`relation-type-edit-${relation.id}-${option.value}`} value={option.value}>
                                                        {option.label}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                                  <input
                                                    className="input"
                                                    placeholder="Volume"
                                                    value={relationDraft.volume_text}
                                                    onChange={(event) =>
                                                      setLeadProductEditDrafts((current) => ({
                                                        ...current,
                                                        [relation.id]: {
                                                          ...relationDraft,
                                                          volume_text: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                  <input
                                                    className="input"
                                                    placeholder="Offered price"
                                                    value={relationDraft.offered_price}
                                                    onChange={(event) =>
                                                      setLeadProductEditDrafts((current) => ({
                                                        ...current,
                                                        [relation.id]: {
                                                          ...relationDraft,
                                                          offered_price: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                  <input
                                                    className="input"
                                                    placeholder="Currency"
                                                    value={relationDraft.currency}
                                                    onChange={(event) =>
                                                      setLeadProductEditDrafts((current) => ({
                                                        ...current,
                                                        [relation.id]: {
                                                          ...relationDraft,
                                                          currency: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                  <input
                                                    className="input"
                                                    placeholder="Note"
                                                    value={relationDraft.notes}
                                                    onChange={(event) =>
                                                      setLeadProductEditDrafts((current) => ({
                                                        ...current,
                                                        [relation.id]: {
                                                          ...relationDraft,
                                                          notes: event.target.value,
                                                        }
                                                      }))
                                                    }
                                                  />
                                                </div>

                                                <div className="flex items-center gap-2">
                                                  <button
                                                    className="btn-primary"
                                                    onClick={() => void saveLeadProductRelation(lead.id, relation.id)}
                                                    disabled={productUpdatingId === relation.id}
                                                  >
                                                    {productUpdatingId === relation.id ? 'Saving...' : 'Save'}
                                                  </button>
                                                  <button
                                                    className="btn-secondary"
                                                    onClick={() => cancelLeadProductEdit(relation.id)}
                                                  >
                                                    Cancel
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="flex items-center justify-between gap-2">
                                                <div className="text-sm">
                                                  <span className="font-medium">{relation.product_name || `Product #${relation.product_id || '-'}`}</span>
                                                  <span> • {relation.relation_type === 'currently_using' ? 'Currently using' : 'Interested in'}</span>
                                                  {relation.volume_text ? <span> • Volume: {relation.volume_text}</span> : null}
                                                  {relation.offered_price != null ? <span> • Offered: {Number(relation.offered_price).toFixed(2)} {relation.currency || 'PLN'}</span> : null}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <button
                                                    className="btn-secondary"
                                                    onClick={() => beginLeadProductEdit(relation)}
                                                  >
                                                    Edit
                                                  </button>
                                                  <button
                                                    className="btn-secondary"
                                                    onClick={() => void deleteLeadProductRelation(lead.id, relation.id)}
                                                    disabled={productDeletingId === relation.id}
                                                  >
                                                    {productDeletingId === relation.id ? 'Removing...' : 'Remove'}
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                                    <select
                                      className="input"
                                      value={productDraft.product_id}
                                      onChange={(event) =>
                                        setLeadProductDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...productDraft, product_id: event.target.value }
                                        }))
                                      }
                                    >
                                      <option value="">Select product from catalog</option>
                                      {productCatalog.map((productItem) => (
                                        <option key={`lead-product-option-${lead.id}-${productItem.id}`} value={productItem.id}>
                                          {productItem.nazwa}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      className="input"
                                      placeholder="Or custom product name"
                                      value={productDraft.product_name}
                                      onChange={(event) =>
                                        setLeadProductDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...productDraft, product_name: event.target.value }
                                        }))
                                      }
                                    />
                                    <select
                                      className="input"
                                      value={productDraft.relation_type}
                                      onChange={(event) =>
                                        setLeadProductDrafts((current) => ({
                                          ...current,
                                          [lead.id]: {
                                            ...productDraft,
                                            relation_type: event.target.value as 'interested_in' | 'currently_using'
                                          }
                                        }))
                                      }
                                    >
                                      {PRODUCT_RELATION_OPTIONS.map((option) => (
                                        <option key={`relation-type-${lead.id}-${option.value}`} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      className="input"
                                      placeholder="Volume"
                                      value={productDraft.volume_text}
                                      onChange={(event) =>
                                        setLeadProductDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...productDraft, volume_text: event.target.value }
                                        }))
                                      }
                                    />
                                    <input
                                      className="input"
                                      placeholder="Offered price"
                                      value={productDraft.offered_price}
                                      onChange={(event) =>
                                        setLeadProductDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...productDraft, offered_price: event.target.value }
                                        }))
                                      }
                                    />
                                    <input
                                      className="input"
                                      placeholder="Currency"
                                      value={productDraft.currency}
                                      onChange={(event) =>
                                        setLeadProductDrafts((current) => ({
                                          ...current,
                                          [lead.id]: { ...productDraft, currency: event.target.value }
                                        }))
                                      }
                                    />
                                  </div>
                                  <input
                                    className="input mb-2"
                                    placeholder="Product note"
                                    value={productDraft.notes}
                                    onChange={(event) =>
                                      setLeadProductDrafts((current) => ({
                                        ...current,
                                        [lead.id]: { ...productDraft, notes: event.target.value }
                                      }))
                                    }
                                  />
                                  <button
                                    className="btn-primary"
                                    onClick={() => void addLeadProductRelation(lead.id)}
                                    disabled={productSavingLeadId === lead.id}
                                  >
                                    {productSavingLeadId === lead.id ? 'Adding...' : 'Add product relation'}
                                  </button>
                                </div>

                                <div className="border border-gray-200 rounded-md p-3 bg-white">
                                  <h4 className="font-semibold mb-2">Activity history</h4>
                                  <div className="space-y-2 mb-3 max-h-48 overflow-auto">
                                    {leadActivities.length === 0 ? (
                                      <p className="text-sm text-text-muted">No activities yet.</p>
                                    ) : (
                                      leadActivities.map((activity) => (
                                        <div key={`lead-activity-${lead.id}-${activity.id}`} className="border border-gray-100 rounded p-2 text-sm">
                                          <p className="font-medium">{activity.activity_type} • {formatDate(activity.activity_at)}</p>
                                          <p className="text-text-muted whitespace-pre-wrap">{activity.note}</p>
                                        </div>
                                      ))
                                    )}
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
                                    <select
                                      className="input"
                                      value={activityTypeDraft}
                                      onChange={(event) =>
                                        setActivityTypeDrafts((current) => ({
                                          ...current,
                                          [lead.id]: event.target.value as CrmActivityType
                                        }))
                                      }
                                    >
                                      <option value="note">Note</option>
                                      <option value="call">Call</option>
                                      <option value="email">Email</option>
                                      <option value="meeting">Meeting</option>
                                    </select>
                                  </div>
                                  <textarea
                                    className="input min-h-20 mb-2"
                                    placeholder="Add activity note"
                                    value={activityDraft}
                                    onChange={(event) =>
                                      setNoteDrafts((current) => ({
                                        ...current,
                                        [lead.id]: event.target.value
                                      }))
                                    }
                                  />
                                  <button
                                    className="btn-primary"
                                    onClick={() => void addActivity(lead.id)}
                                    disabled={addingActivityLeadId === lead.id || !activityDraft.trim()}
                                  >
                                    {addingActivityLeadId === lead.id ? 'Saving note...' : 'Add activity'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap justify-between gap-3 items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold">Lead Calendar</h3>
            <p className="text-sm text-text-muted">
              Schedule calls, meetings, emails and next-contact tasks for each lead.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-text-muted">Date</label>
            <input
              type="date"
              className="input"
              value={calendarDate}
              onChange={(event) => setCalendarDate(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <input
            className="input"
            placeholder="Search lead by company, contact, email or phone..."
            value={taskLeadSearch}
            onChange={(event) => setTaskLeadSearch(event.target.value)}
          />

          <select
            className="input"
            value={taskDraft.lead_id}
            onChange={(event) => setTaskDraft((current) => ({ ...current, lead_id: event.target.value }))}
          >
            <option value="">Select lead</option>
            {taskLeadSelectOptions.map((lead) => (
              <option key={`task-lead-${lead.id}`} value={lead.id}>
                {lead.company_name} {lead.country_code ? `(${lead.country_code})` : ''}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={taskDraft.task_type}
            onChange={(event) => setTaskDraft((current) => ({ ...current, task_type: event.target.value as CrmTaskType }))}
          >
            {TASK_TYPE_OPTIONS.map((option) => (
              <option key={`task-type-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <input
            className="input"
            placeholder="Task title (optional)"
            value={taskDraft.title}
            onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))}
          />

          <input
            type="datetime-local"
            className="input"
            value={taskDraft.due_at}
            onChange={(event) => setTaskDraft((current) => ({ ...current, due_at: event.target.value }))}
          />

          <input
            type="datetime-local"
            className="input"
            value={taskDraft.remind_at}
            onChange={(event) => setTaskDraft((current) => ({ ...current, remind_at: event.target.value }))}
          />

          <select
            className="input"
            value={taskDraft.assigned_user_id}
            onChange={(event) => setTaskDraft((current) => ({ ...current, assigned_user_id: event.target.value }))}
            disabled={!canAssignTasksToOtherUsers && Boolean(user?.id)}
          >
            <option value="">Assign to me</option>
            {taskUsers.map((taskUser) => (
              <option key={`task-user-${taskUser.id}`} value={taskUser.id}>
                {taskUser.full_name}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-text-muted mb-3">
          {loadingTaskLeadOptions
            ? 'Searching leads...'
            : taskLeadSearch.trim() && taskLeadSelectOptions.length === 0
              ? 'No leads match your search.'
              : `Lead options: ${taskLeadSelectOptions.length}`}
        </p>

        <textarea
          className="input min-h-20 mb-3"
          placeholder="Task details (optional)"
          value={taskDraft.description}
          onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))}
        />

        <div className="flex gap-2 mb-4">
          <button onClick={createTaskForLead} disabled={savingTask} className="btn-primary">
            {savingTask ? 'Saving task...' : 'Add task to calendar'}
          </button>
          <button onClick={loadCalendarTasks} className="btn-secondary" disabled={loadingTasks}>
            {loadingTasks ? 'Refreshing...' : 'Refresh tasks'}
          </button>
          <button onClick={() => setShowDailyTasks(true)} className="btn-secondary" disabled={!dailyTasks.length}>
            Open today&apos;s list ({dailyTasks.length})
          </button>
        </div>

        <div className="overflow-auto border border-gray-200 rounded-md">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Assigned</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {calendarTasks.map((task) => {
                const taskDraft = leadTaskEditDrafts[task.id];
                const isEditingTask = editingCalendarTaskId === task.id;

                return (
                  <Fragment key={`calendar-task-${task.id}`}>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(task.due_at)}</td>
                      <td className="px-3 py-2">{task.company_name || '-'}</td>
                      <td className="px-3 py-2">{task.title}</td>
                      <td className="px-3 py-2">{task.task_type}</td>
                      <td className="px-3 py-2">{task.assigned_user_name || '-'}</td>
                      <td className="px-3 py-2">{task.status}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {task.status !== 'completed' && (
                            <button className="btn-secondary" onClick={() => void updateTaskStatus(task.id, 'completed', task.lead_id)}>
                              Complete
                            </button>
                          )}
                          {task.status !== 'planned' && (
                            <button className="btn-secondary" onClick={() => void updateTaskStatus(task.id, 'planned', task.lead_id)}>
                              Reopen
                            </button>
                          )}
                          <button className="btn-secondary" onClick={() => beginTaskEdit(task, 'calendar')}>
                            Edit
                          </button>
                          <button className="btn-secondary" onClick={() => void deleteTask(task.id, task.lead_id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isEditingTask && taskDraft && (
                      <tr className="border-t border-gray-100 bg-gray-50">
                        <td className="px-3 py-3" colSpan={7}>
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
                            <input
                              className="input"
                              placeholder="Task title"
                              value={taskDraft.title}
                              onChange={(event) =>
                                setLeadTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: {
                                    ...taskDraft,
                                    title: event.target.value,
                                  }
                                }))
                              }
                            />
                            <select
                              className="input"
                              value={taskDraft.task_type}
                              onChange={(event) =>
                                setLeadTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: {
                                    ...taskDraft,
                                    task_type: event.target.value as CrmTaskType,
                                  }
                                }))
                              }
                            >
                              {TASK_TYPE_OPTIONS.map((option) => (
                                <option key={`calendar-task-edit-type-${task.id}-${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <select
                              className="input"
                              value={taskDraft.status}
                              onChange={(event) =>
                                setLeadTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: {
                                    ...taskDraft,
                                    status: event.target.value as CrmTaskStatus,
                                  }
                                }))
                              }
                            >
                              {TASK_STATUS_OPTIONS.map((option) => (
                                <option key={`calendar-task-edit-status-${task.id}-${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <select
                              className="input"
                              value={taskDraft.assigned_user_id}
                              onChange={(event) =>
                                setLeadTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: {
                                    ...taskDraft,
                                    assigned_user_id: event.target.value,
                                  }
                                }))
                              }
                              disabled={!canAssignTasksToOtherUsers && Boolean(user?.id)}
                            >
                              <option value="">Assign to me</option>
                              {taskUsers.map((taskUser) => (
                                <option key={`calendar-task-edit-user-${task.id}-${taskUser.id}`} value={taskUser.id}>
                                  {taskUser.full_name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="datetime-local"
                              className="input"
                              value={taskDraft.due_at}
                              onChange={(event) =>
                                setLeadTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: {
                                    ...taskDraft,
                                    due_at: event.target.value,
                                  }
                                }))
                              }
                            />
                            <input
                              type="datetime-local"
                              className="input"
                              value={taskDraft.remind_at}
                              onChange={(event) =>
                                setLeadTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: {
                                    ...taskDraft,
                                    remind_at: event.target.value,
                                  }
                                }))
                              }
                            />
                          </div>
                          <textarea
                            className="input min-h-16 mb-2"
                            placeholder="Task description"
                            value={taskDraft.description}
                            onChange={(event) =>
                              setLeadTaskEditDrafts((current) => ({
                                ...current,
                                [task.id]: {
                                  ...taskDraft,
                                  description: event.target.value,
                                }
                              }))
                            }
                          />
                          <div className="flex gap-2">
                            <button
                              className="btn-primary"
                              onClick={() => void saveTaskEdit(task, 'calendar')}
                              disabled={updatingTaskId === task.id}
                            >
                              {updatingTaskId === task.id ? 'Saving...' : 'Save changes'}
                            </button>
                            <button className="btn-secondary" onClick={() => cancelTaskEdit(task.id, 'calendar')}>
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {calendarTasks.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-text-muted" colSpan={7}>
                    No planned tasks for selected date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-4">
          <FileSpreadsheet size={18} className="text-primary" />
          <h3 className="text-lg font-semibold">Import CSV / Excel</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="input"
            onChange={(event) => {
              setImportFile(event.target.files?.[0] || null);
              setPreviewResult(null);
              setMappingConfig({});
              setImportResult(null);
            }}
          />

          <select
            className="input"
            value={importLeadOwner}
            onChange={(event) => setImportLeadOwner(event.target.value)}
          >
            <option value="">Default Lead Owner (optional)</option>
            {ownerSelectOptions.map((owner) => (
              <option key={`import-owner-${owner}`} value={owner}>
                {owner}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={importSourceChannel}
            onChange={(event) => setImportSourceChannel(event.target.value)}
          >
            {sourceOptionsForInput.map((source) => (
              <option key={`import-source-${source}`} value={source}>
                {source}
              </option>
            ))}
          </select>

          <button onClick={runImport} disabled={importing || !importFile} className="btn-primary flex items-center justify-center gap-2">
            {importing ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? 'Importing...' : importDryRun ? 'Dry Run' : 'Import'}
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={runPreview} disabled={!importFile || previewing} className="btn-secondary flex items-center gap-2">
            {previewing ? <RefreshCw size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            {previewing ? 'Analyzing...' : 'Preview & Column Mapping'}
          </button>
          {previewResult && (
            <span className="text-sm text-text-muted self-center">
              Detected {previewResult.headers.length} columns, {previewResult.total_rows} data rows.
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={importDryRun}
            onChange={(event) => setImportDryRun(event.target.checked)}
          />
          Dry-run (analysis only, no database write)
        </label>

        {previewResult && (
          <div className="mt-4 border-t border-gray-200 pt-4">
            <div className="mb-3">
              <h4 className="text-base font-semibold">Column Mapping</h4>
              <p className="text-sm text-text-muted">
                Map file columns to CRM fields. You can preview and adjust before running import.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {MAPPING_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs uppercase tracking-wide text-text-muted mb-1">
                    {field.label}
                    {field.optional ? ' (optional)' : ''}
                  </label>
                  <select
                    className="input"
                    value={String(mappingConfig[field.key] ?? '')}
                    onChange={(event) => {
                      const value = event.target.value;
                      setMappingConfig((current) => ({
                        ...current,
                        [field.key]: value || ''
                      }));
                    }}
                  >
                    <option value="">Not mapped</option>
                    {previewResult.headers.map((header) => (
                      <option key={`${field.key}-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="overflow-auto border border-gray-200 rounded-md">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Country</th>
                    <th className="px-3 py-2">Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {previewResult.preview_rows.map((row) => (
                    <tr key={`preview-row-${row.row_number}`} className="border-t border-gray-100">
                      <td className="px-3 py-2 align-top text-text-muted">{row.row_number}</td>
                      <td className="px-3 py-2 align-top">{row.parsed?.company_name || '-'}</td>
                      <td className="px-3 py-2 align-top">{row.parsed?.email || '-'}</td>
                      <td className="px-3 py-2 align-top">{row.parsed?.phone || '-'}</td>
                      <td className="px-3 py-2 align-top">{row.parsed?.status || '-'}</td>
                      <td className="px-3 py-2 align-top">{row.parsed?.country_code || '-'}</td>
                      <td className="px-3 py-2 align-top">{row.parsed?.pipeline_type || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {importResult && (
          <div className="mt-4 border-t border-gray-200 pt-4">
            <h4 className="text-base font-semibold mb-2">Import Result</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="card bg-gray-50">Rows: {importResult.total_rows}</div>
              <div className="card bg-green-50">Created: {importResult.created}</div>
              <div className="card bg-blue-50">Updated: {importResult.updated}</div>
              <div className="card bg-yellow-50">Skipped: {importResult.skipped}</div>
              <div className="card bg-red-50">Errors: {importResult.errors}</div>
            </div>
            <p className="text-sm text-text-muted mt-2">{importResult.message}</p>
          </div>
        )}

      </div>

      {/* Pagination */}
      <div className="card mt-6">
        <div className="flex justify-between items-center text-sm">
          <div className="flex items-center gap-3 text-text-muted">
            <span>Page {filters.page || 1} / {totalPages} • records: {total}</span>
            <label className="flex items-center gap-2">
              <span>Rows:</span>
              <select
                className="input py-1 px-2 text-sm"
                value={filters.per_page || 50}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    per_page: Number(event.target.value),
                    page: 1
                  }))
                }
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              disabled={(filters.page || 1) <= 1}
              onClick={() => setFilters((current) => ({ ...current, page: Math.max((current.page || 1) - 1, 1) }))}
            >
              Previous
            </button>
            <button
              className="btn-secondary"
              disabled={(filters.page || 1) >= totalPages}
              onClick={() => setFilters((current) => ({ ...current, page: (current.page || 1) + 1 }))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
