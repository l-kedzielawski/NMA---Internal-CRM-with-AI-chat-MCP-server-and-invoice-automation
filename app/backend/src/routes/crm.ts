import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import XLSX from 'xlsx';
import { pool } from '../config/database';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { LEAD_IMPORT_DIR, ensureStorageDirs } from '../services/fileStorage';
import { requireRole, type AuthUser } from '../middleware/auth';

const router = Router();

router.use(requireRole('admin', 'manager', 'seller'));

type PipelineType = 'cold_lead' | 'contact';
type ActivityType = 'note' | 'call' | 'email' | 'meeting' | 'import';
type TaskType = 'meeting' | 'call' | 'email' | 'follow_up' | 'next_contact' | 'other';
type TaskStatus = 'planned' | 'completed' | 'cancelled';
type TaskItemKind = 'task' | 'event';
type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly';
type DuplicateCaseAction = 'merge' | 'keep_separate' | 'request_handover';
type DuplicateCaseStatus = 'pending' | 'approved' | 'rejected';
type PriorityBucket = 'high' | 'medium' | 'low';

const CRM_DEFAULT_STATUS = 'Zimny lead';

const LOST_REASON_CODES = [
  'price_too_high',
  'timing_not_now',
  'no_decision_maker',
  'competitor_chosen',
  'no_need',
  'no_response',
  'quality_mismatch',
  'terms_not_accepted',
  'other'
] as const;

const ACTIVITY_TEMPLATES: Array<{
  id: string;
  label: string;
  description: string;
  activity_type: ActivityType;
  note_template: string;
  next_task: {
    item_kind: TaskItemKind;
    task_type: TaskType;
    due_in_days: number;
    title: string;
  } | null;
}> = [
  {
    id: 'no_answer_retry',
    label: 'No Answer - Retry',
    description: 'Could not reach lead. Set follow-up retry in 2 days.',
    activity_type: 'call',
    note_template: 'Call attempt: no answer. Retry planned.',
    next_task: {
      item_kind: 'task',
      task_type: 'follow_up',
      due_in_days: 2,
      title: 'Retry call'
    }
  },
  {
    id: 'interested_send_offer',
    label: 'Interested - Send Offer',
    description: 'Lead is interested. Prepare and send offer today.',
    activity_type: 'meeting',
    note_template: 'Lead interested after conversation. Offer to be sent.',
    next_task: {
      item_kind: 'task',
      task_type: 'email',
      due_in_days: 0,
      title: 'Send offer email'
    }
  },
  {
    id: 'needs_approval_followup',
    label: 'Needs Approval - Follow Up',
    description: 'Lead waiting for internal approval. Follow up in 7 days.',
    activity_type: 'email',
    note_template: 'Lead requires internal decision before next step.',
    next_task: {
      item_kind: 'task',
      task_type: 'next_contact',
      due_in_days: 7,
      title: 'Follow up on approval'
    }
  },
  {
    id: 'meeting_scheduled',
    label: 'Meeting Scheduled',
    description: 'Meeting has been scheduled with the lead.',
    activity_type: 'meeting',
    note_template: 'Meeting scheduled with lead.',
    next_task: {
      item_kind: 'event',
      task_type: 'meeting',
      due_in_days: 1,
      title: 'Lead meeting'
    }
  }
];

interface CrmLeadRow extends RowDataPacket {
  id: number;
  company_name: string;
  tax_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_type: string | null;
  contact_position: string | null;
  website: string | null;
  status: string | null;
  lost_reason_code: string | null;
  lead_owner: string | null;
  location: string | null;
  company_address: string | null;
  delivery_address: string | null;
  company_size: string | null;
  source_channel: string | null;
  notes: string | null;
  pipeline_type: PipelineType;
  region: string;
  country_code: string | null;
  phone: string | null;
  source_file: string | null;
  source_row: number | null;
  created_by: string | null;
  updated_by: string | null;
  last_contact_at: string | null;
  email_normalized: string | null;
  phone_normalized: string | null;
  website_domain: string | null;
  company_name_normalized: string | null;
  dedupe_key: string | null;
  lead_score: number;
  hot_rank: number | null;
  priority_bucket: PriorityBucket;
  score_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CrmActivityRow extends RowDataPacket {
  id: number;
  lead_id: number;
  activity_type: ActivityType;
  note: string;
  activity_at: string;
  created_by: string | null;
  created_at: string;
}

interface CrmLeadProductRow extends RowDataPacket {
  id: number;
  lead_id: number;
  product_id: number | null;
  product_name: string | null;
  relation_type: 'interested_in' | 'currently_using';
  volume_text: string | null;
  offered_price: number | null;
  currency: string;
  notes: string | null;
  product_name_resolved?: string | null;
  created_at: string;
  updated_at: string;
}

interface CrmLeadTaskRow extends RowDataPacket {
  id: number;
  lead_id: number | null;
  assigned_user_id: number;
  created_by_user_id: number | null;
  title: string;
  item_kind: TaskItemKind;
  task_type: TaskType;
  status: TaskStatus;
  description: string | null;
  due_at: string;
  remind_at: string | null;
  recurrence_type: RecurrenceType;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_parent_task_id: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  company_name?: string;
  assigned_user_name?: string;
  created_by_name?: string;
}

interface LeadPayload {
  company_name: string;
  tax_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_type: string | null;
  contact_position: string | null;
  website: string | null;
  status: string | null;
  lost_reason_code: string | null;
  lead_owner: string | null;
  location: string | null;
  company_address: string | null;
  delivery_address: string | null;
  company_size: string | null;
  source_channel: string | null;
  notes: string | null;
  pipeline_type: PipelineType;
  region: string;
  country_code: string | null;
  phone: string | null;
  source_file: string | null;
  source_row: number | null;
  created_by: string | null;
  updated_by: string | null;
  last_contact_at: string | null;
  email_normalized: string | null;
  phone_normalized: string | null;
  website_domain: string | null;
  company_name_normalized: string | null;
  dedupe_key: string | null;
}

interface DuplicateCaseRow extends RowDataPacket {
  id: number;
  existing_lead_id: number;
  requested_action: DuplicateCaseAction;
  candidate_company_name: string | null;
  candidate_email: string | null;
  candidate_phone: string | null;
  candidate_payload_json: string | null;
  reason: string | null;
  requested_by_user_id: number;
  requested_owner_user_id: number | null;
  status: DuplicateCaseStatus;
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

interface CrmDashboardUserRow extends RowDataPacket {
  id: number;
  username: string;
  full_name: string | null;
  role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
}

interface CrmDashboardTaskAggRow extends RowDataPacket {
  user_id: number;
  tasks_completed_mtd: number;
  overdue_tasks_open: number;
  tasks_next_7d: number;
}

interface CrmDashboardActivityAggRow extends RowDataPacket {
  created_by: string | null;
  activities_mtd: number;
  calls_mtd: number;
  emails_mtd: number;
  meetings_mtd: number;
  notes_mtd: number;
}

interface CrmDashboardLeadOwnerRow extends RowDataPacket {
  lead_owner: string | null;
  status: string | null;
  updated_at: string | Date;
}

interface CrmDashboardLinkedManagerRow extends RowDataPacket {
  user_id: number;
  imie: string | null;
  nazwisko: string | null;
}

interface ImportContext {
  fileName: string;
  importedBy: string;
  defaultOwner: string | null;
  defaultRegion: string | null;
  defaultSourceChannel: string | null;
  defaultPipelineType: PipelineType;
}

interface BuiltLeadFilters {
  whereClause: string;
  params: Array<string | number>;
}

interface LeadVisibilityScope {
  whereSql: string;
  params: Array<string | number>;
  ownerAliases: string[];
}

type QueryConnection = PoolConnection | typeof pool;

type AnalyticsRange = '30d' | '90d' | '180d' | '365d';
type AnalyticsGroupBy = 'day' | 'week' | 'month';

interface ManagerOwnerRow extends RowDataPacket {
  owner_name: string;
}

interface ColumnMapping {
  companyName: number | null;
  firstName: number | null;
  lastName: number | null;
  email: number | null;
  title: number | null;
  companyType: number | null;
  contactPosition: number | null;
  website: number | null;
  status: number | null;
  leadOwner: number | null;
  region: number | null;
  location: number | null;
  companySize: number | null;
  country: number | null;
  phone: number | null;
  sourceChannel: number | null;
  notes: number[];
}

interface ColumnMappingInput {
  companyName?: string | number | null;
  firstName?: string | number | null;
  lastName?: string | number | null;
  email?: string | number | null;
  title?: string | number | null;
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

function canManageCrmGlobally(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'manager';
}

function collectAlias(target: Set<string>, value: string | null): void {
  const cleaned = cleanString(value);
  if (!cleaned) return;
  target.add(cleaned);
}

function collectFirstTokenAlias(target: Set<string>, value: string | null): void {
  const cleaned = cleanString(value);
  if (!cleaned) return;
  const firstToken = cleanString(cleaned.split(/\s+/)[0] || null);
  if (!firstToken) return;
  target.add(firstToken);
}

async function resolveLeadOwnerAliasesForUser(connection: QueryConnection, user: AuthUser): Promise<string[]> {
  const aliases = new Set<string>();

  collectAlias(aliases, user.full_name);
  collectAlias(aliases, user.username);
  collectFirstTokenAlias(aliases, user.full_name);
  collectFirstTokenAlias(aliases, user.username);

  const [linkedOwnerRows] = await connection.query<RowDataPacket[]>(
    `SELECT TRIM(CONCAT_WS(' ', o.imie, o.nazwisko)) AS owner_name
     FROM opiekunowie o
     WHERE o.user_id = ?
       AND o.aktywny = 1
     LIMIT 1`,
    [user.id]
  );

  const linkedOwnerName = cleanString(linkedOwnerRows[0]?.owner_name);
  collectAlias(aliases, linkedOwnerName);
  collectFirstTokenAlias(aliases, linkedOwnerName);

  return Array.from(aliases);
}

function normalizeOwnerValue(value: string | null): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  return cleaned.toLowerCase();
}

async function resolveStrictLeadOwnerValuesForUser(connection: QueryConnection, user: AuthUser): Promise<string[]> {
  const strictValues = new Set<string>();
  const addValue = (value: string | null): void => {
    const normalized = normalizeOwnerValue(value);
    if (normalized) {
      strictValues.add(normalized);
    }
  };

  addValue(user.full_name);
  addValue(user.username);

  const [linkedOwnerRows] = await connection.query<RowDataPacket[]>(
    `SELECT TRIM(CONCAT_WS(' ', o.imie, o.nazwisko)) AS owner_name
     FROM opiekunowie o
     WHERE o.user_id = ?
       AND o.aktywny = 1
     LIMIT 1`,
    [user.id]
  );

  addValue(cleanString(linkedOwnerRows[0]?.owner_name));
  return Array.from(strictValues);
}

async function buildLeadVisibilityScope(
  connection: QueryConnection,
  user: AuthUser,
  leadAlias = 'l'
): Promise<LeadVisibilityScope> {
  if (canManageCrmGlobally(user)) {
    return {
      whereSql: '1=1',
      params: [],
      ownerAliases: [],
    };
  }

  const ownerAliases = await resolveLeadOwnerAliasesForUser(connection, user);
  const ownerMatchSql = ownerAliases.length > 0
    ? ownerAliases
        .map(() => `FIND_IN_SET(?, REPLACE(COALESCE(${leadAlias}.lead_owner, ''), ', ', ',')) > 0`)
        .join(' OR ')
    : '0';

  return {
    whereSql: `((${ownerMatchSql}) OR EXISTS (
      SELECT 1
      FROM crm_lead_tasks tx
      WHERE tx.lead_id = ${leadAlias}.id
        AND tx.assigned_user_id = ?
    ))`,
    params: [...ownerAliases, user.id],
    ownerAliases,
  };
}

async function buildScopedLeadFilters(
  connection: QueryConnection,
  query: Request['query'],
  user?: AuthUser
): Promise<BuiltLeadFilters> {
  const filters = buildLeadFilters(query);
  if (!user) return filters;

  const scope = await buildLeadVisibilityScope(connection, user, 'l');
  return {
    whereClause: `${filters.whereClause} AND ${scope.whereSql}`,
    params: [...filters.params, ...scope.params],
  };
}

async function canUserAccessLead(connection: QueryConnection, user: AuthUser, leadId: number): Promise<boolean> {
  const scope = await buildLeadVisibilityScope(connection, user, 'l');
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT l.id
     FROM crm_leads l
     WHERE l.id = ?
       AND ${scope.whereSql}
     LIMIT 1`,
    [leadId, ...scope.params]
  );

  return rows.length > 0;
}

// Configure multer for CRM imports
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStorageDirs();
    cb(null, LEAD_IMPORT_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
      return;
    }

    cb(new Error('Only CSV and Excel files are allowed (.csv, .xlsx, .xls)'));
  },
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

function cleanString(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const value = String(input).replace(/\s+/g, ' ').trim();
  if (!value) return null;
  if (value === '-' || value === '--' || value === '---' || value === '-----------') return null;
  return value;
}

function clampText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

function normalizeText(input: string | null): string | null {
  if (!input) return null;
  const normalized = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  return normalized || null;
}

function normalizeEmail(input: string | null): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (!value || !value.includes('@')) return null;
  return value;
}

function normalizePhone(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length < 6) return null;
  return hasPlus ? `+${digits}` : digits;
}

function extractWebsiteDomain(input: string | null): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^mailto:/, '');
  if (value.includes('@') && !value.startsWith('http')) {
    const parts = value.split('@');
    value = parts[parts.length - 1] || '';
  }

  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    value = `https://${value}`;
  }

  try {
    const host = new URL(value).hostname.replace(/^www\./, '').trim();
    if (!host || !host.includes('.')) return null;
    return host;
  } catch {
    const fallback = value
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .trim();

    if (!fallback || !fallback.includes('.')) return null;
    return fallback;
  }
}

function normalizeHeader(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function findFirstHeaderMatch(normalizedHeaders: string[], candidates: string[]): number | null {
  for (const candidate of candidates) {
    const foundIndex = normalizedHeaders.findIndex((header) => header === candidate || header.includes(candidate));
    if (foundIndex !== -1) return foundIndex;
  }
  return null;
}

function findAllHeaderMatches(normalizedHeaders: string[], candidates: string[]): number[] {
  const matches = new Set<number>();
  for (const candidate of candidates) {
    normalizedHeaders.forEach((header, index) => {
      if (header === candidate || header.includes(candidate)) {
        matches.add(index);
      }
    });
  }
  return Array.from(matches).sort((a, b) => a - b);
}

function detectColumnMapping(headers: string[]): ColumnMapping {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));

  const notesIndices = findAllHeaderMatches(normalizedHeaders, ['notatka', 'podsumowanie', 'notes', 'uwagi']);

  const mapping: ColumnMapping = {
    companyName: findFirstHeaderMatch(normalizedHeaders, ['companyname', 'company', 'nazwa firmy', 'nazwa', 'firma', '6']),
    firstName: findFirstHeaderMatch(normalizedHeaders, ['firstname', 'first name', 'imie']),
    lastName: findFirstHeaderMatch(normalizedHeaders, ['lastname', 'last name', 'nazwisko']),
    email: findFirstHeaderMatch(normalizedHeaders, ['e mail', 'email', 'mail']),
    title: findFirstHeaderMatch(normalizedHeaders, ['title', 'job title', 'stanowisko']),
    companyType: findFirstHeaderMatch(normalizedHeaders, ['type', 'typ', 'company type', 'typ firmy']),
    contactPosition: findFirstHeaderMatch(normalizedHeaders, ['position', 'pozycja', 'contact position', 'stanowisko']),
    website: findFirstHeaderMatch(normalizedHeaders, ['strona www', 'website', 'www', 'url']),
    status: findFirstHeaderMatch(normalizedHeaders, ['status']),
    leadOwner: findFirstHeaderMatch(normalizedHeaders, ['lead owner', 'opiekun', 'owner']),
    region: findFirstHeaderMatch(normalizedHeaders, ['region', 'wojewodztwo', 'województwo', 'obszar']),
    location: findFirstHeaderMatch(normalizedHeaders, ['location', 'adres', 'miasto', 'city']),
    companySize: findFirstHeaderMatch(normalizedHeaders, ['companysize', 'company size', 'size', 'wielkosc', 'employee count', 'employee_count', 'employees']),
    country: findFirstHeaderMatch(normalizedHeaders, ['country', 'kraj', 'kraj jezyk']),
    phone: findFirstHeaderMatch(normalizedHeaders, ['telefon', 'phone', 'tel']),
    sourceChannel: findFirstHeaderMatch(normalizedHeaders, ['source', 'zrodlo', 'źródło', 'kanal', 'kanał']),
    notes: notesIndices
  };

  if (mapping.companyName === null && headers.length > 0) {
    mapping.companyName = 0;
  }

  return mapping;
}

function scoreDecodedTextQuality(text: string): number {
  if (!text) return -1_000_000;

  const replacementCount = (text.match(/�/g) || []).length;
  const boxDrawingCount = (text.match(/[\u2500-\u257F]/g) || []).length;
  const suspiciousMojibakeCount = (text.match(/[ÃÄÅÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß]/g) || []).length;
  const commonPlDeCount = (text.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻäöüÄÖÜß]/g) || []).length;

  return commonPlDeCount * 8 - replacementCount * 30 - boxDrawingCount * 12 - suspiciousMojibakeCount * 2;
}

function bestEffortRepairMojibake(value: string): string {
  const candidates = new Set<string>();
  candidates.add(value);

  const addCandidate = (candidate: string | null | undefined) => {
    if (!candidate) return;
    candidates.add(candidate);
  };

  try {
    addCandidate(iconv.encode(value, 'cp852').toString('utf8'));
  } catch {
    // no-op
  }
  try {
    addCandidate(iconv.encode(value, 'cp850').toString('utf8'));
  } catch {
    // no-op
  }
  try {
    addCandidate(Buffer.from(value, 'latin1').toString('utf8'));
  } catch {
    // no-op
  }

  let best = value;
  let bestScore = scoreDecodedTextQuality(value);
  for (const candidate of candidates) {
    const score = scoreDecodedTextQuality(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function decodeCsvBuffer(buffer: Buffer): string {
  const decodedCandidates: string[] = [];

  decodedCandidates.push(buffer.toString('utf8'));
  decodedCandidates.push(iconv.decode(buffer, 'win1250'));
  decodedCandidates.push(iconv.decode(buffer, 'cp852'));
  decodedCandidates.push(iconv.decode(buffer, 'cp850'));
  decodedCandidates.push(iconv.decode(buffer, 'latin1'));

  let best = decodedCandidates[0] || '';
  let bestScore = scoreDecodedTextQuality(best);

  for (const candidate of decodedCandidates) {
    const repaired = bestEffortRepairMojibake(candidate);
    const score = scoreDecodedTextQuality(repaired);
    if (score > bestScore) {
      best = repaired;
      bestScore = score;
    }
  }

  return best;
}

function parseUploadedSheet(filePath: string): { headers: string[]; rows: unknown[][] } {
  const extension = path.extname(filePath).toLowerCase();

  const workbook = extension === '.csv'
    ? XLSX.read(decodeCsvBuffer(fs.readFileSync(filePath)), { type: 'string', raw: false, cellDates: false })
    : XLSX.readFile(filePath, { raw: false, cellDates: false });
  if (!workbook.SheetNames.length) {
    throw new Error('Uploaded file has no sheets');
  }

  const firstSheet = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  if (!rows.length) {
    throw new Error('Uploaded file is empty');
  }

  const headers = rows[0].map((headerCell) => String(headerCell || '').trim());
  return { headers, rows };
}

function resolveColumnRef(headers: string[], ref: string | number | null | undefined): number | null {
  if (ref === null || ref === undefined) return null;

  if (typeof ref === 'number' && Number.isInteger(ref)) {
    if (ref >= 0 && ref < headers.length) return ref;
    return null;
  }

  const raw = cleanString(ref);
  if (!raw) return null;

  const numeric = Number(raw);
  if (!Number.isNaN(numeric) && Number.isInteger(numeric) && numeric >= 0 && numeric < headers.length) {
    return numeric;
  }

  const target = normalizeHeader(raw);
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const exactIndex = normalizedHeaders.findIndex((header) => header === target);
  if (exactIndex !== -1) return exactIndex;

  const containsIndex = normalizedHeaders.findIndex((header) => header.includes(target) || target.includes(header));
  if (containsIndex !== -1) return containsIndex;

  return null;
}

function buildEffectiveMapping(headers: string[], input: ColumnMappingInput | null | undefined): ColumnMapping {
  const auto = detectColumnMapping(headers);
  if (!input) return auto;

  const mapSingle = (value: string | number | null | undefined, fallback: number | null): number | null => {
    const resolved = resolveColumnRef(headers, value);
    return resolved === null ? fallback : resolved;
  };

  const notesRefs = Array.isArray(input.notes)
    ? input.notes
    : input.notes !== undefined && input.notes !== null
      ? [input.notes]
      : [];
  if (input.notes2 !== undefined && input.notes2 !== null) {
    notesRefs.push(input.notes2);
  }

  const notesResolved = notesRefs
    .map((ref) => resolveColumnRef(headers, ref))
    .filter((index): index is number => index !== null);

  return {
    companyName: mapSingle(input.companyName, auto.companyName),
    firstName: mapSingle(input.firstName, auto.firstName),
    lastName: mapSingle(input.lastName, auto.lastName),
    email: mapSingle(input.email, auto.email),
    title: mapSingle(input.title, auto.title),
    companyType: mapSingle(input.companyType, auto.companyType),
    contactPosition: mapSingle(input.contactPosition, auto.contactPosition),
    website: mapSingle(input.website, auto.website),
    status: mapSingle(input.status, auto.status),
    leadOwner: mapSingle(input.leadOwner, auto.leadOwner),
    region: mapSingle(input.region, auto.region),
    location: mapSingle(input.location, auto.location),
    companySize: mapSingle(input.companySize, auto.companySize),
    country: mapSingle(input.country, auto.country),
    phone: mapSingle(input.phone, auto.phone),
    sourceChannel: mapSingle(input.sourceChannel, auto.sourceChannel),
    notes: notesResolved.length ? notesResolved : auto.notes
  };
}

function mappingToHeaderNames(headers: string[], mapping: ColumnMapping): Record<string, string | string[] | null> {
  const byIndex = (index: number | null) => (index === null ? null : headers[index] || null);
  return {
    companyName: byIndex(mapping.companyName),
    firstName: byIndex(mapping.firstName),
    lastName: byIndex(mapping.lastName),
    email: byIndex(mapping.email),
    title: byIndex(mapping.title),
    companyType: byIndex(mapping.companyType),
    contactPosition: byIndex(mapping.contactPosition),
    website: byIndex(mapping.website),
    status: byIndex(mapping.status),
    leadOwner: byIndex(mapping.leadOwner),
    region: byIndex(mapping.region),
    location: byIndex(mapping.location),
    companySize: byIndex(mapping.companySize),
    country: byIndex(mapping.country),
    phone: byIndex(mapping.phone),
    sourceChannel: byIndex(mapping.sourceChannel),
    notes: mapping.notes.map((index) => headers[index] || String(index))
  };
}

function parseMappingFromRequest(raw: unknown): ColumnMappingInput | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as ColumnMappingInput;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as ColumnMappingInput;
  }
  return null;
}

function parsePipelineType(value: unknown, fallback: PipelineType = 'cold_lead'): PipelineType {
  const raw = cleanString(value);
  if (!raw) return fallback;

  const normalized = normalizeText(raw);
  if (!normalized) return fallback;

  if (
    normalized === 'contact' ||
    normalized === 'contacts' ||
    normalized === 'kontakt' ||
    normalized === 'in talks' ||
    normalized === 'w trakcie'
  ) {
    return 'contact';
  }

  if (normalized === 'cold lead' || normalized === 'cold leads' || normalized === 'cold contact' || normalized === 'lead') {
    return 'cold_lead';
  }

  return fallback;
}

function normalizeCountryCode(input: string | null): string | null {
  if (!input) return null;
  const normalized = normalizeText(input);
  if (!normalized) return null;

  const map: Record<string, string> = {
    pl: 'PL',
    polska: 'PL',
    poland: 'PL',
    de: 'DE',
    germany: 'DE',
    deutschland: 'DE',
    at: 'AT',
    austria: 'AT',
    ch: 'CH',
    switzerland: 'CH',
    portugalia: 'PT',
    portugal: 'PT',
    pt: 'PT',
    hiszpania: 'ES',
    spain: 'ES',
    es: 'ES',
    italy: 'IT',
    italia: 'IT',
    it: 'IT',
    belgium: 'BE',
    belgia: 'BE',
    be: 'BE'
  };

  if (map[normalized]) return map[normalized];

  if (normalized.length === 2) {
    return normalized.toUpperCase();
  }

  return normalized.toUpperCase().slice(0, 20);
}

function inferRegionFromCountry(countryCode: string | null): string {
  if (!countryCode) return 'OTHER';
  const upper = countryCode.toUpperCase();

  if (upper === 'PL') return 'PL';
  if (upper === 'DE' || upper === 'AT' || upper === 'CH') return 'DACH';
  if (upper === 'PT') return 'PT';
  if (upper === 'ES') return 'ES';
  if (upper === 'IT') return 'IT';
  if (upper === 'BE') return 'BE';

  return 'OTHER';
}

function normalizeRegion(input: string | null, countryCode: string | null): string {
  const normalized = normalizeText(input);
  if (!normalized) return inferRegionFromCountry(countryCode);

  if (normalized === 'pl' || normalized === 'poland' || normalized === 'polska') return 'PL';
  if (normalized === 'dach' || normalized === 'de' || normalized === 'at' || normalized === 'ch') return 'DACH';
  if (normalized === 'pt' || normalized === 'portugal') return 'PT';
  if (normalized === 'es' || normalized === 'spain') return 'ES';
  if (normalized === 'it' || normalized === 'italy') return 'IT';
  if (normalized === 'be' || normalized === 'belgium') return 'BE';

  return normalized.toUpperCase().slice(0, 20);
}

function derivePipelineType(status: string | null, fallback: PipelineType): PipelineType {
  const normalizedStatus = normalizeText(status);
  if (!normalizedStatus) return fallback;

  const contactStatusTokens = [
    'wspolpraca',
    'negocjacje',
    'ponowny kontakt',
    'spotkanie',
    'wyslane probki',
    'wyslany mail',
    'mail marketing',
    'in talks',
    'contact',
    'kontakt'
  ];

  const coldStatusTokens = ['cold contact', 'cold lead', 'brak kontaktu'];

  if (contactStatusTokens.some((token) => normalizedStatus.includes(token))) {
    return 'contact';
  }

  if (coldStatusTokens.some((token) => normalizedStatus.includes(token))) {
    return 'cold_lead';
  }

  return fallback;
}

function normalizeCrmStatus(input: string | null): string {
  const cleaned = cleanString(input);
  if (!cleaned) return CRM_DEFAULT_STATUS;

  const normalized = normalizeText(cleaned);
  if (!normalized) return CRM_DEFAULT_STATUS;

  if (
    normalized.includes('zimny lead') ||
    normalized.includes('cold lead') ||
    normalized.includes('cold contact') ||
    normalized.includes('brak kontaktu')
  ) {
    return 'Zimny lead';
  }

  if (normalized.includes('meeting booked') || normalized.includes('umowione spotkanie') || normalized.includes('spotkanie umowione')) {
    return 'Umówione spotkanie';
  }

  if (normalized.includes('meeting completed') || normalized.includes('spotkanie zakonczone') || normalized.includes('spotkanie odbylo')) {
    return 'Spotkanie zakończone';
  }

  if (normalized.includes('wygrane') || normalized.includes('won') || normalized.includes('wspolpraca')) {
    return 'Wygrane';
  }

  if (normalized.includes('poza biurem') || normalized.includes('out of office') || normalized === 'ooo') {
    return 'Poza biurem';
  }

  if (normalized.includes('wrong person') || normalized.includes('nie ta osoba')) {
    return 'Nie ta osoba';
  }

  if (normalized.includes('niezainteresowany') || normalized.includes('not interested') || normalized.includes('odmowa')) {
    return 'Niezainteresowany';
  }

  if (normalized.includes('utracony') || normalized.includes('lost')) {
    return 'Utracony';
  }

  if (
    normalized === 'interested' ||
    normalized === 'zainteresowany' ||
    normalized.includes(' interested ') ||
    normalized.startsWith('interested ') ||
    normalized.endsWith(' interested') ||
    normalized.includes('ponowny kontakt') ||
    normalized.includes('wyslany mail') ||
    normalized.includes('wyslane probki') ||
    normalized.includes('mail marketing') ||
    normalized.includes('negocjacje')
  ) {
    return 'Zainteresowany';
  }

  return CRM_DEFAULT_STATUS;
}

function normalizeCrmStatusForFilter(input: string): string {
  const cleaned = cleanString(input);
  if (!cleaned) return CRM_DEFAULT_STATUS;

  const normalized = normalizeText(cleaned);
  if (!normalized) return cleaned;

  if (
    normalized.includes('zimny lead') ||
    normalized.includes('cold lead') ||
    normalized.includes('cold contact') ||
    normalized.includes('brak kontaktu')
  ) {
    return 'Zimny lead';
  }

  if (normalized.includes('meeting booked') || normalized.includes('umowione spotkanie') || normalized.includes('spotkanie umowione')) {
    return 'Umówione spotkanie';
  }

  if (normalized.includes('meeting completed') || normalized.includes('spotkanie zakonczone') || normalized.includes('spotkanie odbylo')) {
    return 'Spotkanie zakończone';
  }

  if (normalized.includes('wygrane') || normalized.includes('won') || normalized.includes('wspolpraca')) {
    return 'Wygrane';
  }

  if (normalized.includes('poza biurem') || normalized.includes('out of office') || normalized === 'ooo') {
    return 'Poza biurem';
  }

  if (normalized.includes('wrong person') || normalized.includes('nie ta osoba')) {
    return 'Nie ta osoba';
  }

  if (normalized.includes('niezainteresowany') || normalized.includes('not interested') || normalized.includes('odmowa')) {
    return 'Niezainteresowany';
  }

  if (normalized.includes('utracony') || normalized.includes('lost')) {
    return 'Utracony';
  }

  if (
    normalized === 'interested' ||
    normalized === 'zainteresowany' ||
    normalized.includes(' interested ') ||
    normalized.startsWith('interested ') ||
    normalized.endsWith(' interested') ||
    normalized.includes('ponowny kontakt') ||
    normalized.includes('wyslany mail') ||
    normalized.includes('wyslane probki') ||
    normalized.includes('mail marketing') ||
    normalized.includes('negocjacje')
  ) {
    return 'Zainteresowany';
  }

  return cleaned;
}

function normalizeSourceChannel(input: string | null): string | null {
  const cleaned = cleanString(input);
  if (!cleaned) return null;

  const normalized = normalizeText(cleaned);
  if (!normalized) return null;

  if (normalized.includes('internet') || normalized.includes('wyszuk') || normalized.includes('search')) {
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

  return clampText(cleaned, 100);
}

function getSourceChannelAliases(input: string | null): string[] {
  const canonical = normalizeSourceChannel(input);
  if (!canonical) return [];

  if (canonical === 'Referral') {
    return ['Referral', 'Polecenie'];
  }

  if (canonical === 'Targi') {
    return ['Targi', 'Trade Fair'];
  }

  return [canonical];
}

function isLostStatus(status: string | null): boolean {
  const normalized = normalizeText(status || '');
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('utracony')
    || normalized.includes('lost')
    || normalized.includes('niezainteresowany')
    || normalized.includes('not interested')
    || normalized.includes('odmowa')
  );
}

function parseLostReasonCode(input: unknown): string | 'invalid' | null {
  const cleaned = cleanString(input);
  if (!cleaned) return null;

  const normalized = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) return null;
  if (!LOST_REASON_CODES.includes(normalized as (typeof LOST_REASON_CODES)[number])) {
    return 'invalid';
  }

  return normalized;
}

function buildDedupeKey(payload: {
  emailNormalized: string | null;
  phoneNormalized: string | null;
  websiteDomain: string | null;
  companyNameNormalized: string | null;
}): string | null {
  if (payload.emailNormalized) return clampText(`email:${payload.emailNormalized}`, 255);
  if (payload.phoneNormalized) return clampText(`phone:${payload.phoneNormalized}`, 255);
  if (payload.websiteDomain && payload.companyNameNormalized) {
    return clampText(`domain_company:${payload.websiteDomain}|${payload.companyNameNormalized}`, 255);
  }
  return null;
}

function getRowCellValue(row: unknown[], index: number | null): string | null {
  if (index === null || index < 0 || index >= row.length) return null;
  return cleanString(row[index]);
}

function parseOptionalDateTime(value: unknown): string | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function parsePositiveInt(value: unknown): number | null {
  const cleaned = cleanString(value);
  if (!cleaned) return null;

  const parsed = parseInt(cleaned, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseHotRank(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 'invalid';
  }

  const rank = Math.floor(parsed);
  if (rank < 1 || rank > 10) {
    return 'invalid';
  }

  return rank;
}

function parseTaskType(value: unknown): TaskType {
  const cleaned = cleanString(value)?.toLowerCase() || '';
  if (cleaned === 'meeting') return 'meeting';
  if (cleaned === 'call') return 'call';
  if (cleaned === 'email') return 'email';
  if (cleaned === 'follow_up' || cleaned === 'follow up' || cleaned === 'followup') return 'follow_up';
  if (cleaned === 'next_contact' || cleaned === 'next contact') return 'next_contact';
  if (cleaned === 'other') return 'other';
  return 'follow_up';
}

function parseTaskStatus(value: unknown, fallback: TaskStatus = 'planned'): TaskStatus {
  const cleaned = cleanString(value)?.toLowerCase() || '';
  if (cleaned === 'completed') return 'completed';
  if (cleaned === 'cancelled' || cleaned === 'canceled') return 'cancelled';
  if (cleaned === 'planned') return 'planned';
  return fallback;
}

function parseTaskItemKind(value: unknown, fallback: TaskItemKind = 'task'): TaskItemKind {
  const cleaned = cleanString(value)?.toLowerCase() || '';
  if (cleaned === 'event') return 'event';
  if (cleaned === 'task') return 'task';
  return fallback;
}

function parseRecurrenceType(value: unknown, fallback: RecurrenceType = 'none'): RecurrenceType {
  const cleaned = cleanString(value)?.toLowerCase() || '';
  if (cleaned === 'daily') return 'daily';
  if (cleaned === 'weekly') return 'weekly';
  if (cleaned === 'monthly') return 'monthly';
  if (cleaned === 'none') return 'none';
  return fallback;
}

function parseRecurrenceInterval(value: unknown, fallback = 1): number {
  const parsed = parsePositiveInt(value);
  if (!parsed) return fallback;
  return Math.min(365, Math.max(1, parsed));
}

function parseDuplicateCaseAction(value: unknown): DuplicateCaseAction | null {
  const cleaned = cleanString(value)?.toLowerCase() || '';
  if (cleaned === 'merge') return 'merge';
  if (cleaned === 'keep_separate' || cleaned === 'keep-separate') return 'keep_separate';
  if (cleaned === 'request_handover' || cleaned === 'request-handover') return 'request_handover';
  return null;
}

function normalizeDateSql(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function addRecurrence(dueAt: string, recurrenceType: RecurrenceType, recurrenceInterval: number): string {
  const base = new Date(dueAt);
  if (Number.isNaN(base.getTime())) {
    return dueAt;
  }

  const next = new Date(base);
  if (recurrenceType === 'daily') {
    next.setDate(next.getDate() + recurrenceInterval);
  } else if (recurrenceType === 'weekly') {
    next.setDate(next.getDate() + recurrenceInterval * 7);
  } else if (recurrenceType === 'monthly') {
    next.setMonth(next.getMonth() + recurrenceInterval);
  }

  return normalizeDateSql(next);
}

function daysBetweenNow(dateString: string | null): number | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getPriorityBucket(score: number): PriorityBucket {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

async function recalculateLeadScore(connection: PoolConnection, leadId: number): Promise<void> {
  const [leadRows] = await connection.query<CrmLeadRow[]>(
    `SELECT
      id,
      status,
      source_channel,
      pipeline_type,
      email,
      phone,
      created_at,
      last_contact_at,
      lead_score,
      priority_bucket,
      score_updated_at
    FROM crm_leads
    WHERE id = ?
    LIMIT 1`,
    [leadId]
  );

  if (leadRows.length === 0) return;

  const lead = leadRows[0];

  const [activityRows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, MAX(activity_at) AS last_activity_at
     FROM crm_activities
     WHERE lead_id = ?`,
    [leadId]
  );

  const [taskRows] = await connection.query<RowDataPacket[]>(
    `SELECT
      SUM(CASE WHEN status = 'planned' AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue_tasks,
      SUM(CASE WHEN status = 'planned' AND due_at >= NOW() AND due_at < DATE_ADD(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS next_week_tasks
     FROM crm_lead_tasks
     WHERE lead_id = ?`,
    [leadId]
  );

  const activityCount = Number(activityRows[0]?.total || 0);
  const lastActivityDays = daysBetweenNow(String(activityRows[0]?.last_activity_at || lead.last_contact_at || ''));
  const overdueTasks = Number(taskRows[0]?.overdue_tasks || 0);
  const nextWeekTasks = Number(taskRows[0]?.next_week_tasks || 0);

  let score = 0;

  if (lead.email) score += 10;
  if (lead.phone) score += 10;
  if (lead.pipeline_type === 'contact') score += 12;

  const statusValue = (lead.status || '').toLowerCase();
  if (statusValue.includes('hot') || statusValue.includes('negocj') || statusValue.includes('talk')) score += 20;
  if (statusValue.includes('zimny') || statusValue.includes('cold')) score += 4;
  if (statusValue.includes('lost') || statusValue.includes('utrac') || statusValue.includes('niezainteres')) score -= 12;

  const source = (lead.source_channel || '').toLowerCase();
  if (source.includes('referral')) score += 16;
  else if (source.includes('internet search')) score += 8;
  else if (source.includes('all source')) score += 6;
  else if (source) score += 4;

  if (activityCount >= 4) score += 14;
  else if (activityCount >= 1) score += 7;

  if (lastActivityDays !== null) {
    if (lastActivityDays <= 7) score += 14;
    else if (lastActivityDays <= 21) score += 6;
    else if (lastActivityDays > 45) score -= 16;
  }

  if (nextWeekTasks > 0) score += 8;
  if (overdueTasks > 0) score -= Math.min(30, overdueTasks * 9);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const bucket = getPriorityBucket(score);

  await connection.query(
    `UPDATE crm_leads
     SET lead_score = ?, priority_bucket = ?, score_updated_at = NOW()
     WHERE id = ?`,
    [score, bucket, leadId]
  );
}

function toStartOfTodaySql(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString().slice(0, 19).replace('T', ' ');
}

function toStartOfTomorrowSql(): string {
  const now = new Date();
  const startTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return startTomorrow.toISOString().slice(0, 19).replace('T', ' ');
}

function getTaskTypeLabel(taskType: TaskType): string {
  if (taskType === 'meeting') return 'Meeting';
  if (taskType === 'call') return 'Call';
  if (taskType === 'email') return 'Email';
  if (taskType === 'next_contact') return 'Next contact';
  if (taskType === 'other') return 'Task';
  return 'Follow up';
}

function formatTaskRow(row: CrmLeadTaskRow): CrmLeadTaskRow & { is_overdue: boolean; is_today: boolean } {
  const dueDate = new Date(row.due_at);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const startTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

  return {
    ...row,
    is_overdue: row.status !== 'completed' && !Number.isNaN(dueDate.getTime()) && dueDate < startToday,
    is_today:
      !Number.isNaN(dueDate.getTime()) &&
      dueDate >= startToday &&
      dueDate < startTomorrow
  };
}

function prepareLeadPayload(input: {
  companyName: string;
  taxId?: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  companyType?: string | null;
  contactPosition?: string | null;
  website: string | null;
  status: string | null;
  lostReasonCode?: string | null;
  leadOwner: string | null;
  location: string | null;
  companyAddress?: string | null;
  deliveryAddress?: string | null;
  companySize: string | null;
  sourceChannel: string | null;
  notes: string | null;
  pipelineType: PipelineType;
  region: string;
  countryCode: string | null;
  phone: string | null;
  sourceFile: string | null;
  sourceRow: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  lastContactAt: string | null;
}): LeadPayload {
  const emailNormalized = normalizeEmail(input.email);
  const phoneNormalized = normalizePhone(input.phone);
  const websiteDomain = extractWebsiteDomain(input.website);
  const companyNameNormalized = normalizeText(input.companyName);
  const lostReasonCode = clampText(input.lostReasonCode || null, 60);
  const effectiveLostReasonCode = isLostStatus(input.status) ? lostReasonCode : null;

  return {
    company_name: clampText(input.companyName, 255) || input.companyName,
    tax_id: clampText(input.taxId || null, 100),
    first_name: clampText(input.firstName, 100),
    last_name: clampText(input.lastName, 100),
    email: clampText(input.email, 255),
    company_type: clampText(input.companyType || null, 150),
    contact_position: clampText(input.contactPosition || null, 150),
    website: clampText(input.website, 255),
    status: clampText(input.status || CRM_DEFAULT_STATUS, 100),
    lost_reason_code: effectiveLostReasonCode,
    lead_owner: clampText(input.leadOwner, 100),
    location: clampText(input.location, 255),
    company_address: input.companyAddress || null,
    delivery_address: input.deliveryAddress || null,
    company_size: clampText(input.companySize, 100),
    source_channel: clampText(normalizeSourceChannel(input.sourceChannel), 100),
    notes: input.notes,
    pipeline_type: input.pipelineType,
    region: clampText(input.region, 20) || input.region,
    country_code: clampText(input.countryCode, 20),
    phone: clampText(input.phone, 100),
    source_file: clampText(input.sourceFile, 255),
    source_row: input.sourceRow,
    created_by: clampText(input.createdBy, 100),
    updated_by: clampText(input.updatedBy, 100),
    last_contact_at: input.lastContactAt,
    email_normalized: clampText(emailNormalized, 255),
    phone_normalized: clampText(phoneNormalized, 64),
    website_domain: clampText(websiteDomain, 255),
    company_name_normalized: clampText(companyNameNormalized, 255),
    dedupe_key: buildDedupeKey({
      emailNormalized: clampText(emailNormalized, 255),
      phoneNormalized: clampText(phoneNormalized, 64),
      websiteDomain: clampText(websiteDomain, 255),
      companyNameNormalized: clampText(companyNameNormalized, 255)
    })
  };
}

async function findExistingLead(connection: PoolConnection, payload: LeadPayload): Promise<CrmLeadRow | null> {
  if (payload.dedupe_key) {
    const [rowsByDedupe] = await connection.query<CrmLeadRow[]>(
      'SELECT * FROM crm_leads WHERE dedupe_key = ? LIMIT 1',
      [payload.dedupe_key]
    );
    if (rowsByDedupe.length > 0) return rowsByDedupe[0];
  }

  if (payload.email_normalized) {
    const [rowsByEmail] = await connection.query<CrmLeadRow[]>(
      'SELECT * FROM crm_leads WHERE email_normalized = ? LIMIT 1',
      [payload.email_normalized]
    );
    if (rowsByEmail.length > 0) return rowsByEmail[0];
  }

  if (payload.phone_normalized) {
    const [rowsByPhone] = await connection.query<CrmLeadRow[]>(
      'SELECT * FROM crm_leads WHERE phone_normalized = ? LIMIT 1',
      [payload.phone_normalized]
    );
    if (rowsByPhone.length > 0) return rowsByPhone[0];
  }

  if (payload.website_domain && payload.company_name_normalized) {
    const [rowsByDomainAndCompany] = await connection.query<CrmLeadRow[]>(
      'SELECT * FROM crm_leads WHERE website_domain = ? AND company_name_normalized = ? LIMIT 1',
      [payload.website_domain, payload.company_name_normalized]
    );
    if (rowsByDomainAndCompany.length > 0) return rowsByDomainAndCompany[0];
  }

  return null;
}

async function insertLead(connection: PoolConnection, payload: LeadPayload): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO crm_leads (
      company_name, tax_id, first_name, last_name, email, company_type, contact_position, website, status, lost_reason_code, lead_owner,
      location, company_address, delivery_address, company_size, source_channel, notes, pipeline_type, region, country_code, phone,
      source_file, source_row, created_by, updated_by, last_contact_at,
      email_normalized, phone_normalized, website_domain, company_name_normalized, dedupe_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.company_name,
      payload.tax_id,
      payload.first_name,
      payload.last_name,
      payload.email,
      payload.company_type,
      payload.contact_position,
      payload.website,
      payload.status,
      payload.lost_reason_code,
      payload.lead_owner,
      payload.location,
      payload.company_address,
      payload.delivery_address,
      payload.company_size,
      payload.source_channel,
      payload.notes,
      payload.pipeline_type,
      payload.region,
      payload.country_code,
      payload.phone,
      payload.source_file,
      payload.source_row,
      payload.created_by,
      payload.updated_by,
      payload.last_contact_at,
      payload.email_normalized,
      payload.phone_normalized,
      payload.website_domain,
      payload.company_name_normalized,
      payload.dedupe_key
    ]
  );

  return result.insertId;
}

async function updateLead(connection: PoolConnection, leadId: number, payload: LeadPayload): Promise<void> {
  await connection.query(
    `UPDATE crm_leads SET
      company_name = ?,
      tax_id = ?,
      first_name = ?,
      last_name = ?,
      email = ?,
      company_type = ?,
      contact_position = ?,
      website = ?,
      status = ?,
      lost_reason_code = ?,
      lead_owner = ?,
      location = ?,
      company_address = ?,
      delivery_address = ?,
      company_size = ?,
      source_channel = ?,
      notes = ?,
      pipeline_type = ?,
      region = ?,
      country_code = ?,
      phone = ?,
      source_file = ?,
      source_row = ?,
      updated_by = ?,
      last_contact_at = ?,
      email_normalized = ?,
      phone_normalized = ?,
      website_domain = ?,
      company_name_normalized = ?,
      dedupe_key = ?
    WHERE id = ?`,
    [
      payload.company_name,
      payload.tax_id,
      payload.first_name,
      payload.last_name,
      payload.email,
      payload.company_type,
      payload.contact_position,
      payload.website,
      payload.status,
      payload.lost_reason_code,
      payload.lead_owner,
      payload.location,
      payload.company_address,
      payload.delivery_address,
      payload.company_size,
      payload.source_channel,
      payload.notes,
      payload.pipeline_type,
      payload.region,
      payload.country_code,
      payload.phone,
      payload.source_file,
      payload.source_row,
      payload.updated_by,
      payload.last_contact_at,
      payload.email_normalized,
      payload.phone_normalized,
      payload.website_domain,
      payload.company_name_normalized,
      payload.dedupe_key,
      leadId
    ]
  );
}

async function insertActivity(
  connection: PoolConnection,
  leadId: number,
  activityType: ActivityType,
  note: string,
  createdBy: string | null,
  activityAt?: string | null
): Promise<void> {
  const trimmedNote = note.trim();
  if (!trimmedNote) return;

  await connection.query(
    `INSERT INTO crm_activities (lead_id, activity_type, note, activity_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [leadId, activityType, trimmedNote, activityAt || new Date().toISOString().slice(0, 19).replace('T', ' '), createdBy]
  );
}

async function insertLeadTask(
  connection: PoolConnection,
  data: {
    leadId: number | null;
    assignedUserId: number;
    createdByUserId: number;
    title: string;
    itemKind: TaskItemKind;
    taskType: TaskType;
    description: string | null;
    dueAt: string;
    remindAt: string | null;
    recurrenceType: RecurrenceType;
    recurrenceInterval: number;
    recurrenceUntil: string | null;
    recurrenceParentTaskId?: number | null;
  }
): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO crm_lead_tasks (
      lead_id, assigned_user_id, created_by_user_id, title, item_kind, task_type, status,
      description, due_at, remind_at, recurrence_type, recurrence_interval, recurrence_until, recurrence_parent_task_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.leadId,
      data.assignedUserId,
      data.createdByUserId,
      data.title,
      data.itemKind,
      data.taskType,
      data.description,
      data.dueAt,
      data.remindAt,
      data.recurrenceType,
      data.recurrenceInterval,
      data.recurrenceUntil,
      data.recurrenceParentTaskId || null
    ]
  );

  const insertedId = result.insertId;

  if (data.recurrenceType !== 'none' && !data.recurrenceParentTaskId) {
    await connection.query(
      'UPDATE crm_lead_tasks SET recurrence_parent_task_id = ? WHERE id = ?',
      [insertedId, insertedId]
    );
  }

  return insertedId;
}

function buildPayloadFromRow(row: unknown[], mapping: ColumnMapping, context: ImportContext, rowNumber: number): LeadPayload | null {
  const companyName = getRowCellValue(row, mapping.companyName);
  const email = getRowCellValue(row, mapping.email);
  const website = getRowCellValue(row, mapping.website);
  const phone = getRowCellValue(row, mapping.phone);

  if (!companyName && !email && !website && !phone) {
    return null;
  }

  const countryRaw = getRowCellValue(row, mapping.country);
  const countryCode = normalizeCountryCode(countryRaw);
  const mappedRegionRaw = getRowCellValue(row, mapping.region);
  const region = normalizeRegion(mappedRegionRaw || context.defaultRegion, countryCode);
  const status = normalizeCrmStatus(getRowCellValue(row, mapping.status));
  const sourceChannel = normalizeSourceChannel(getRowCellValue(row, mapping.sourceChannel) || context.defaultSourceChannel);
  const contactPosition = getRowCellValue(row, mapping.contactPosition) || getRowCellValue(row, mapping.title);

  const notes = mapping.notes
    .map((columnIndex) => getRowCellValue(row, columnIndex))
    .filter((value): value is string => Boolean(value))
    .join(' | ');

  return prepareLeadPayload({
    companyName: companyName || (email ? `Lead ${email}` : `Lead ${rowNumber}`),
    taxId: null,
    firstName: getRowCellValue(row, mapping.firstName),
    lastName: getRowCellValue(row, mapping.lastName),
    email,
    contactPosition,
    website,
    status,
    leadOwner: getRowCellValue(row, mapping.leadOwner) || context.defaultOwner,
    location: getRowCellValue(row, mapping.location),
    companyAddress: null,
    deliveryAddress: null,
    companySize: getRowCellValue(row, mapping.companySize),
    sourceChannel,
    notes: notes || null,
    pipelineType: derivePipelineType(status, context.defaultPipelineType),
    region,
    countryCode,
    phone,
    sourceFile: context.fileName,
    sourceRow: rowNumber,
    createdBy: context.importedBy,
    updatedBy: context.importedBy,
    lastContactAt: null
  });
}

function mergeIncomingWithExisting(existing: CrmLeadRow, incoming: LeadPayload): LeadPayload {
  const mergedCompanyName = cleanString(existing.company_name) || incoming.company_name;
  const mergedStatus = cleanString(incoming.status)
    ? normalizeCrmStatus(incoming.status)
    : cleanString(existing.status) || CRM_DEFAULT_STATUS;
  const mergedOwner = cleanString(existing.lead_owner) || cleanString(incoming.lead_owner);
  const mergedNotes = (() => {
    const existingNotes = cleanString(existing.notes);
    const incomingNotes = cleanString(incoming.notes);

    if (!existingNotes) return incomingNotes;
    if (!incomingNotes) return existingNotes;
    if (existingNotes.includes(incomingNotes)) return existingNotes;
    return `${existingNotes}\n---\n${incomingNotes}`;
  })();

  const mergedPipelineType: PipelineType =
    existing.pipeline_type === 'contact' || incoming.pipeline_type === 'contact' ? 'contact' : 'cold_lead';

  return prepareLeadPayload({
    companyName: mergedCompanyName,
    taxId: cleanString(existing.tax_id) || cleanString(incoming.tax_id),
    firstName: cleanString(existing.first_name) || cleanString(incoming.first_name),
    lastName: cleanString(existing.last_name) || cleanString(incoming.last_name),
    email: cleanString(existing.email) || cleanString(incoming.email),
    companyType: cleanString(existing.company_type) || cleanString(incoming.company_type),
    contactPosition: cleanString(existing.contact_position) || cleanString(incoming.contact_position),
    website: cleanString(existing.website) || cleanString(incoming.website),
    status: mergedStatus,
    lostReasonCode: cleanString(existing.lost_reason_code) || cleanString(incoming.lost_reason_code),
    leadOwner: mergedOwner,
    location: cleanString(existing.location) || cleanString(incoming.location),
    companyAddress: cleanString(existing.company_address) || cleanString(incoming.company_address),
    deliveryAddress: cleanString(existing.delivery_address) || cleanString(incoming.delivery_address),
    companySize: cleanString(existing.company_size) || cleanString(incoming.company_size),
    sourceChannel: cleanString(existing.source_channel) || cleanString(incoming.source_channel),
    notes: mergedNotes,
    pipelineType: mergedPipelineType,
    region: cleanString(existing.region) || incoming.region,
    countryCode: cleanString(existing.country_code) || incoming.country_code,
    phone: cleanString(existing.phone) || cleanString(incoming.phone),
    sourceFile: incoming.source_file,
    sourceRow: incoming.source_row,
    createdBy: existing.created_by,
    updatedBy: incoming.updated_by,
    lastContactAt: cleanString(existing.last_contact_at) || incoming.last_contact_at
  });
}

function buildLeadPayloadFromRequestBody(body: Record<string, unknown>): LeadPayload | null {
  const companyName = cleanString(body.company_name || body.companyName);
  if (!companyName) return null;

  const countryCode = normalizeCountryCode(cleanString(body.country_code || body.countryCode));

  const parsedSourceRow =
    body.source_row !== undefined && body.source_row !== null && String(body.source_row).trim() !== ''
      ? Number(body.source_row)
      : null;

  return prepareLeadPayload({
    companyName,
    taxId: cleanString(body.tax_id || body.taxId),
    firstName: cleanString(body.first_name || body.firstName),
    lastName: cleanString(body.last_name || body.lastName),
    email: cleanString(body.email),
    companyType: cleanString(body.company_type || body.companyType),
    contactPosition: cleanString(body.contact_position || body.contactPosition),
    website: cleanString(body.website),
    status: normalizeCrmStatus(cleanString(body.status)),
    lostReasonCode: null,
    leadOwner: cleanString(body.lead_owner || body.leadOwner),
    location: cleanString(body.location),
    companyAddress: cleanString(body.company_address || body.companyAddress),
    deliveryAddress: cleanString(body.delivery_address || body.deliveryAddress),
    companySize: cleanString(body.company_size || body.companySize),
    sourceChannel: cleanString(body.source_channel || body.sourceChannel),
    notes: cleanString(body.notes),
    pipelineType: parsePipelineType(body.pipeline_type || body.pipelineType),
    region: normalizeRegion(cleanString(body.region), countryCode),
    countryCode,
    phone: cleanString(body.phone),
    sourceFile: cleanString(body.source_file || body.sourceFile),
    sourceRow: parsedSourceRow !== null && !Number.isNaN(parsedSourceRow) ? parsedSourceRow : null,
    createdBy: cleanString(body.created_by || body.createdBy || body.lead_owner || body.leadOwner),
    updatedBy: cleanString(body.updated_by || body.updatedBy || body.lead_owner || body.leadOwner),
    lastContactAt: parseOptionalDateTime(body.last_contact_at || body.lastContactAt)
  });
}

function makeForcedDuplicatePayload(payload: LeadPayload, updatedBy: string | null): LeadPayload {
  return {
    ...payload,
    updated_by: updatedBy || payload.updated_by,
    email_normalized: null,
    dedupe_key: null
  };
}

function parseCandidatePayload(rawJson: string | null): Record<string, unknown> | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

async function insertImportRow(
  connection: PoolConnection,
  jobId: number,
  rowNumber: number,
  action: 'created' | 'updated' | 'skipped' | 'error',
  message: string,
  leadId: number | null,
  rowValues: unknown[]
): Promise<void> {
  await connection.query(
    `INSERT INTO crm_import_rows (job_id, \`row_number\`, \`action\`, lead_id, status_message, raw_data_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [jobId, rowNumber, action, leadId, message.slice(0, 500), JSON.stringify(rowValues)]
  );
}

function buildLeadFilters(query: Request['query']): BuiltLeadFilters {
  const {
    search,
    status,
    status_in,
    source_channel,
    lead_owner,
    region,
    country_code,
    pipeline_type,
    action_bucket,
    dormant_days,
    hot_rank_min
  } = query;
  const where: string[] = ['1=1'];
  const params: Array<string | number> = [];
  const statusExpr = "COALESCE(NULLIF(TRIM(l.status), ''), 'Zimny lead')";
  const meaningfulActionAtExpr = `COALESCE(
    (SELECT MAX(a.activity_at) FROM crm_activities a WHERE a.lead_id = l.id),
    (
      SELECT MAX(
        CASE
          WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at
          WHEN t.status = 'cancelled' THEN t.updated_at
          ELSE NULL
        END
      )
      FROM crm_lead_tasks t
      WHERE t.lead_id = l.id
    ),
    l.last_contact_at
  )`;
  const hasPlannedTaskExpr = `EXISTS (
    SELECT 1
    FROM crm_lead_tasks t
    WHERE t.lead_id = l.id
      AND t.status = 'planned'
  )`;
  const hasOverdueTaskExpr = `EXISTS (
    SELECT 1
    FROM crm_lead_tasks t
    WHERE t.lead_id = l.id
      AND t.status = 'planned'
      AND t.due_at < NOW()
  )`;
  const openLeadExpr = `${statusExpr} NOT IN ('Won', 'Lost')`;

  if (pipeline_type) {
    where.push('l.pipeline_type = ?');
    params.push(String(pipeline_type));
  }

  if (status) {
    where.push(`${statusExpr} = ?`);
    params.push(normalizeCrmStatusForFilter(String(status)));
  }

  if (status_in) {
    const statuses = String(status_in)
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (statuses.length > 0) {
      const normalizedStatuses = statuses.map((value) => normalizeCrmStatusForFilter(value));
      const placeholders = statuses.map(() => '?').join(', ');
      where.push(`${statusExpr} IN (${placeholders})`);
      params.push(...normalizedStatuses);
    }
  }

  if (source_channel) {
    const aliases = getSourceChannelAliases(String(source_channel));
    const values = aliases.length > 0 ? aliases : [String(source_channel)];
    where.push(`COALESCE(NULLIF(TRIM(l.source_channel), ''), 'Brak') IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  }

  if (lead_owner) {
    where.push("FIND_IN_SET(?, REPLACE(COALESCE(l.lead_owner, ''), ', ', ',')) > 0");
    params.push(String(lead_owner));
  }

  if (region) {
    where.push('l.region = ?');
    params.push(String(region));
  }

  if (country_code) {
    where.push('l.country_code = ?');
    params.push(String(country_code));
  }

  if (search) {
    where.push('(l.company_name LIKE ? OR l.tax_id LIKE ? OR l.email LIKE ? OR l.website LIKE ? OR l.location LIKE ? OR l.company_address LIKE ? OR l.delivery_address LIKE ? OR l.first_name LIKE ? OR l.last_name LIKE ? OR l.phone LIKE ?)');
    const searchValue = `%${String(search)}%`;
    params.push(searchValue, searchValue, searchValue, searchValue, searchValue, searchValue, searchValue, searchValue, searchValue, searchValue);
  }

  const normalizedActionBucket = cleanString(action_bucket)?.toLowerCase() || null;
  if (normalizedActionBucket === 'no_action') {
    where.push(`${openLeadExpr}`);
    where.push(`${meaningfulActionAtExpr} IS NULL`);
  } else if (normalizedActionBucket === 'no_next_step') {
    where.push(`${openLeadExpr}`);
    where.push(`NOT ${hasPlannedTaskExpr}`);
  } else if (normalizedActionBucket === 'overdue') {
    where.push(`${openLeadExpr}`);
    where.push(`${hasOverdueTaskExpr}`);
  } else if (normalizedActionBucket === 'dormant') {
    const parsedDormantDays = parseInt(String(dormant_days || '14'), 10);
    const dormantDaysThreshold = Number.isNaN(parsedDormantDays)
      ? 14
      : Math.max(1, Math.min(365, parsedDormantDays));

    where.push(`${openLeadExpr}`);
    where.push(`${meaningfulActionAtExpr} IS NOT NULL`);
    where.push(`TIMESTAMPDIFF(DAY, ${meaningfulActionAtExpr}, NOW()) >= ?`);
    params.push(dormantDaysThreshold);
  }

  if (hot_rank_min !== undefined) {
    const parsedHotRankMin = parseInt(String(hot_rank_min), 10);
    if (!Number.isNaN(parsedHotRankMin)) {
      where.push('COALESCE(l.hot_rank, 0) >= ?');
      params.push(Math.max(0, Math.min(10, parsedHotRankMin)));
    }
  }

  return {
    whereClause: `WHERE ${where.join(' AND ')}`,
    params
  };
}

function normalizeCsvText(value: unknown): string {
  if (value === null || value === undefined) return '';

  const repaired = bestEffortRepairMojibake(String(value));

  return repaired
    .normalize('NFC')
    .replace(/\uFEFF/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function toCsvCell(value: unknown, separator = ';'): string {
  const text = normalizeCsvText(value);
  const escaped = text.replace(/"/g, '""');
  if (escaped.includes('"') || escaped.includes('\n') || escaped.includes('\r') || escaped.includes(separator)) {
    return `"${escaped}"`;
  }
  return escaped;
}

function encodeCsvForDownload(csv: string, requestedEncoding: unknown): {
  content: Buffer;
  charset: string;
} {
  const encoding = String(requestedEncoding || '').toLowerCase();

  if (encoding === 'utf16le' || encoding === 'utf-16le' || encoding === 'excel') {
    const utf16Buffer = iconv.encode(csv, 'utf16-le');
    return {
      content: Buffer.concat([Buffer.from([0xff, 0xfe]), utf16Buffer]),
      charset: 'utf-16le',
    };
  }

  if (encoding === 'cp1250' || encoding === 'win1250' || encoding === 'windows-1250') {
    return {
      content: iconv.encode(csv, 'win1250'),
      charset: 'windows-1250',
    };
  }

  return {
    content: Buffer.from(`\uFEFF${csv}`, 'utf8'),
    charset: 'utf-8',
  };
}

function parseAnalyticsRange(input: unknown): AnalyticsRange {
  const raw = String(input || '').toLowerCase();
  if (raw === '90d' || raw === '180d' || raw === '365d') return raw;
  return '30d';
}

function parseAnalyticsGroupBy(input: unknown): AnalyticsGroupBy {
  const raw = String(input || '').toLowerCase();
  if (raw === 'week' || raw === 'month') return raw;
  return 'day';
}

function getRangeDays(range: AnalyticsRange): number {
  if (range === '90d') return 90;
  if (range === '180d') return 180;
  if (range === '365d') return 365;
  return 30;
}

function isLeadOwnerProvided(body: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(body, 'lead_owner')
    || Object.prototype.hasOwnProperty.call(body, 'leadOwner');
}

async function fetchAllowedLeadOwners(
  connection: PoolConnection | typeof pool
): Promise<string[]> {
  const [rows] = await connection.query<ManagerOwnerRow[]>(
    `SELECT DISTINCT TRIM(CONCAT_WS(' ', o.imie, o.nazwisko)) AS owner_name
     FROM opiekunowie o
     WHERE o.aktywny = 1
       AND TRIM(CONCAT_WS(' ', o.imie, o.nazwisko)) <> ''
     ORDER BY owner_name ASC`
  );

  return rows
    .map((row) => String(row.owner_name || '').trim())
    .filter((owner) => owner.length > 0);
}

function validateLeadOwnerValue(owner: string | null, allowedOwners: string[]): string | null {
  const normalizedOwner = cleanString(owner);
  if (!normalizedOwner) {
    return null;
  }

  const requestedOwners = normalizedOwner
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (requestedOwners.length === 0) {
    return null;
  }

  if (requestedOwners.length > 2) {
    const error = new Error('Lead can have up to two account managers') as Error & { code: string };
    error.code = 'INVALID_LEAD_OWNER';
    throw error;
  }

  const uniqueOwners = Array.from(new Set(requestedOwners));
  if (uniqueOwners.length > 2) {
    const error = new Error('Lead can have up to two unique account managers') as Error & { code: string };
    error.code = 'INVALID_LEAD_OWNER';
    throw error;
  }

  const invalidOwner = uniqueOwners.find((entry) => !allowedOwners.includes(entry));
  if (!invalidOwner) {
    return uniqueOwners.join(', ');
  }

  const error = new Error('Lead owner must be selected from active account managers') as Error & { code: string };
  error.code = 'INVALID_LEAD_OWNER';
  throw error;
}

function getBucketDateExpression(groupBy: AnalyticsGroupBy, dateColumn: string): string {
  if (groupBy === 'month') {
    return `DATE_FORMAT(${dateColumn}, '%Y-%m-01')`;
  }
  if (groupBy === 'week') {
    return `DATE_SUB(DATE(${dateColumn}), INTERVAL WEEKDAY(${dateColumn}) DAY)`;
  }
  return `DATE(${dateColumn})`;
}

// GET /api/crm/meta - get filter options
router.get('/meta', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const scope = await buildLeadVisibilityScope(pool, req.user, 'l');

    const [statuses] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT l.status
       FROM crm_leads l
       WHERE l.status IS NOT NULL
         AND l.status <> ''
         AND ${scope.whereSql}
       ORDER BY l.status ASC`,
      scope.params
    );
    const owners = await fetchAllowedLeadOwners(pool);
    const [countries] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT l.country_code
       FROM crm_leads l
       WHERE l.country_code IS NOT NULL
         AND l.country_code <> ''
         AND ${scope.whereSql}
       ORDER BY l.country_code ASC`,
      scope.params
    );
    const [sources] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(source_channel), ''), 'Brak') AS source_channel
       FROM crm_leads l
       WHERE ${scope.whereSql}
       ORDER BY source_channel ASC`,
      scope.params
    );

    const normalizedSources = Array.from(
      new Set(
        sources.map((row) => normalizeSourceChannel(row.source_channel) || 'Brak')
      )
    ).sort((left, right) => left.localeCompare(right, 'pl-PL'));

    res.json({
      statuses: statuses.map((row) => row.status),
      owners,
      countries: countries.map((row) => row.country_code),
      sources: normalizedSources
    });
  } catch (error) {
    console.error('Error fetching CRM meta:', error);
    res.status(500).json({ error: 'Failed to fetch CRM metadata' });
  }
});

// GET /api/crm/quick-view-counts - counts for quick workflow buckets
router.get('/quick-view-counts', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const baseQuery: Record<string, unknown> = {
      ...req.query,
      status: undefined,
      status_in: undefined,
      action_bucket: undefined,
      dormant_days: undefined,
      hot_rank_min: undefined,
      page: undefined,
      per_page: undefined
    };

    const { whereClause, params } = await buildScopedLeadFilters(pool, baseQuery as Request['query'], req.user);

    const statusExpr = "COALESCE(NULLIF(TRIM(l.status), ''), 'Zimny lead')";
    const meaningfulActionAtExpr = `COALESCE(
      (SELECT MAX(a.activity_at) FROM crm_activities a WHERE a.lead_id = l.id),
      (
        SELECT MAX(
          CASE
            WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at
            WHEN t.status = 'cancelled' THEN t.updated_at
            ELSE NULL
          END
        )
        FROM crm_lead_tasks t
        WHERE t.lead_id = l.id
      ),
      l.last_contact_at
    )`;
    const hasPlannedTaskExpr = `EXISTS (
      SELECT 1
      FROM crm_lead_tasks t
      WHERE t.lead_id = l.id
        AND t.status = 'planned'
    )`;
    const hasOverdueTaskExpr = `EXISTS (
      SELECT 1
      FROM crm_lead_tasks t
      WHERE t.lead_id = l.id
        AND t.status = 'planned'
        AND t.due_at < NOW()
    )`;
    const openLeadExpr = `${statusExpr} NOT IN (?, ?)`;

    const coldStatuses = [normalizeCrmStatusForFilter('Cold Lead')];
    const talksStatuses = [
      normalizeCrmStatusForFilter('Interested'),
      normalizeCrmStatusForFilter('Meeting Booked'),
      normalizeCrmStatusForFilter('Meeting Completed'),
      normalizeCrmStatusForFilter('Out of Office'),
      normalizeCrmStatusForFilter('Wrong Person')
    ];
    const wonStatuses = [normalizeCrmStatusForFilter('Won')];
    const lostStatuses = [normalizeCrmStatusForFilter('Not Interested'), normalizeCrmStatusForFilter('Lost')];
    const openStatusExclusions = [normalizeCrmStatusForFilter('Won'), normalizeCrmStatusForFilter('Lost')];

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        COUNT(*) AS all_count,
        SUM(CASE WHEN ${statusExpr} IN (${coldStatuses.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS cold_count,
        SUM(CASE WHEN ${statusExpr} IN (${talksStatuses.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS talks_count,
        SUM(CASE WHEN ${statusExpr} IN (${wonStatuses.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS won_count,
        SUM(CASE WHEN ${statusExpr} IN (${lostStatuses.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS lost_count,
        SUM(CASE WHEN ${openLeadExpr} AND ${meaningfulActionAtExpr} IS NULL THEN 1 ELSE 0 END) AS no_action_count,
        SUM(CASE WHEN ${openLeadExpr} AND NOT ${hasPlannedTaskExpr} THEN 1 ELSE 0 END) AS no_next_step_count,
        SUM(CASE WHEN ${openLeadExpr} AND ${hasOverdueTaskExpr} THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN ${openLeadExpr} AND ${meaningfulActionAtExpr} IS NOT NULL AND TIMESTAMPDIFF(DAY, ${meaningfulActionAtExpr}, NOW()) >= 14 THEN 1 ELSE 0 END) AS dormant_count,
        SUM(CASE WHEN COALESCE(l.hot_rank, 0) >= 8 THEN 1 ELSE 0 END) AS hot_count
       FROM crm_leads l
       ${whereClause}`,
      [
        ...coldStatuses,
        ...talksStatuses,
        ...wonStatuses,
        ...lostStatuses,
        ...openStatusExclusions,
        ...openStatusExclusions,
        ...openStatusExclusions,
        ...openStatusExclusions,
        ...params
      ]
    );

    const row = rows[0] || {};
    res.json({
      all: Number(row.all_count || 0),
      cold: Number(row.cold_count || 0),
      talks: Number(row.talks_count || 0),
      won: Number(row.won_count || 0),
      lost: Number(row.lost_count || 0),
      no_action: Number(row.no_action_count || 0),
      no_next_step: Number(row.no_next_step_count || 0),
      overdue: Number(row.overdue_count || 0),
      dormant: Number(row.dormant_count || 0),
      hot: Number(row.hot_count || 0)
    });
  } catch (error) {
    console.error('Error fetching CRM quick view counts:', error);
    res.status(500).json({ error: 'Failed to fetch quick view counts' });
  }
});

// GET /api/crm/dashboard/summary - MTD CRM execution snapshot for dashboard
router.get('/dashboard/summary', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const now = new Date();
    const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEndExclusiveDate = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    const toSqlDate = (value: Date): string => {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const monthStartSqlDate = toSqlDate(monthStartDate);
    const monthEndExclusiveSqlDate = toSqlDate(monthEndExclusiveDate);

    const leadScope = await buildLeadVisibilityScope(pool, req.user, 'l');
    const leadScopeWhere: string[] = [leadScope.whereSql];
    const leadScopeParams: Array<string | number> = [...leadScope.params];

    const statusExpr = "COALESCE(NULLIF(TRIM(l.status), ''), 'Zimny lead')";
    const meaningfulActionAtExpr = `COALESCE(
      (SELECT MAX(a.activity_at) FROM crm_activities a WHERE a.lead_id = l.id),
      (
        SELECT MAX(
          CASE
            WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at
            WHEN t.status = 'cancelled' THEN t.updated_at
            ELSE NULL
          END
        )
        FROM crm_lead_tasks t
        WHERE t.lead_id = l.id
      ),
      l.last_contact_at
    )`;
    const hasPlannedTaskExpr = `EXISTS (
      SELECT 1
      FROM crm_lead_tasks t
      WHERE t.lead_id = l.id
        AND t.status = 'planned'
    )`;
    const hasOverdueTaskExpr = `EXISTS (
      SELECT 1
      FROM crm_lead_tasks t
      WHERE t.lead_id = l.id
        AND t.status = 'planned'
        AND t.due_at < NOW()
    )`;

    const coldStatuses = [normalizeCrmStatusForFilter('Cold Lead')];
    const talksStatuses = [
      normalizeCrmStatusForFilter('Interested'),
      normalizeCrmStatusForFilter('Meeting Booked'),
      normalizeCrmStatusForFilter('Meeting Completed'),
      normalizeCrmStatusForFilter('Out of Office'),
      normalizeCrmStatusForFilter('Wrong Person')
    ];
    const wonStatuses = [normalizeCrmStatusForFilter('Won')];
    const lostStatuses = [normalizeCrmStatusForFilter('Not Interested'), normalizeCrmStatusForFilter('Lost')];
    const openStatusExclusions = [normalizeCrmStatusForFilter('Won'), normalizeCrmStatusForFilter('Lost')];

    const [summaryRows] = await pool.query<RowDataPacket[]>(
      `SELECT
        COUNT(*) AS all_count,
        SUM(CASE WHEN l.created_at >= ? AND l.created_at < ? THEN 1 ELSE 0 END) AS new_leads_mtd,
        SUM(CASE WHEN ${statusExpr} IN (${coldStatuses.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS cold_count,
        SUM(CASE WHEN ${statusExpr} IN (${talksStatuses.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS talks_count,
        SUM(CASE WHEN ${statusExpr} IN (${wonStatuses.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS won_count,
        SUM(CASE WHEN ${statusExpr} IN (${lostStatuses.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS lost_count,
        SUM(CASE WHEN ${statusExpr} NOT IN (?, ?) AND ${hasOverdueTaskExpr} THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN ${statusExpr} NOT IN (?, ?) AND NOT ${hasPlannedTaskExpr} THEN 1 ELSE 0 END) AS no_next_step_count,
        SUM(CASE WHEN ${statusExpr} NOT IN (?, ?) AND ${meaningfulActionAtExpr} IS NOT NULL AND TIMESTAMPDIFF(DAY, ${meaningfulActionAtExpr}, NOW()) >= 14 THEN 1 ELSE 0 END) AS dormant_count,
        SUM(CASE WHEN ${statusExpr} IN (${wonStatuses.map(() => '?').join(', ')}) AND l.updated_at >= ? AND l.updated_at < ? THEN 1 ELSE 0 END) AS won_mtd,
        SUM(CASE WHEN ${statusExpr} IN (${lostStatuses.map(() => '?').join(', ')}) AND l.updated_at >= ? AND l.updated_at < ? THEN 1 ELSE 0 END) AS lost_mtd
       FROM crm_leads l
       WHERE ${leadScopeWhere.join(' AND ')}`,
      [
        monthStartSqlDate,
        monthEndExclusiveSqlDate,
        ...coldStatuses,
        ...talksStatuses,
        ...wonStatuses,
        ...lostStatuses,
        ...openStatusExclusions,
        ...openStatusExclusions,
        ...openStatusExclusions,
        ...wonStatuses,
        monthStartSqlDate,
        monthEndExclusiveSqlDate,
        ...lostStatuses,
        monthStartSqlDate,
        monthEndExclusiveSqlDate,
        ...leadScopeParams
      ]
    );

    const summaryRow = summaryRows[0] || {};

    const isSellerScope = req.user.role === 'seller';
    const [userRows] = await pool.query<CrmDashboardUserRow[]>(
      `SELECT id, username, full_name, role
       FROM users
       WHERE is_active = 1
         AND role IN ('admin', 'manager', 'seller')
         ${isSellerScope ? 'AND id = ?' : ''}
       ORDER BY FIELD(role, 'seller', 'manager', 'admin'), full_name ASC, username ASC`,
      isSellerScope ? [req.user.id] : []
    );

    const userIds = userRows.map((row) => Number(row.id));
    const linkedManagerRows: CrmDashboardLinkedManagerRow[] = userIds.length > 0
      ? await (async () => {
          const placeholders = userIds.map(() => '?').join(', ');
          const [rows] = await pool.query<CrmDashboardLinkedManagerRow[]>(
            `SELECT user_id, imie, nazwisko
             FROM opiekunowie
             WHERE aktywny = 1
               AND user_id IS NOT NULL
               AND user_id IN (${placeholders})`,
            userIds
          );
          return rows;
        })()
      : [];

    const linkedManagerByUserId = new Map<number, CrmDashboardLinkedManagerRow>();
    for (const row of linkedManagerRows) {
      linkedManagerByUserId.set(Number(row.user_id), row);
    }

    const userStrongAliases = new Map<number, Set<string>>();
    const userWeakAliases = new Map<number, Set<string>>();

    const addAlias = (set: Set<string>, value: string | null): void => {
      const normalized = normalizeText(cleanString(value));
      if (!normalized) return;
      set.add(normalized);
    };

    const addFirstTokenAlias = (set: Set<string>, value: string | null): void => {
      const normalized = normalizeText(cleanString(value));
      if (!normalized) return;
      const firstToken = normalized.split(' ')[0];
      if (!firstToken) return;
      set.add(firstToken);
    };

    for (const row of userRows) {
      const userId = Number(row.id);
      const strongAliases = new Set<string>();
      const weakAliases = new Set<string>();

      addAlias(strongAliases, cleanString(row.full_name));
      addAlias(strongAliases, cleanString(row.username));
      addFirstTokenAlias(weakAliases, cleanString(row.full_name));

      const linkedManager = linkedManagerByUserId.get(userId);
      if (linkedManager) {
        const managerFirstName = cleanString(linkedManager.imie);
        const managerLastName = cleanString(linkedManager.nazwisko);
        const managerFullName = cleanString(`${managerFirstName || ''} ${managerLastName || ''}`);

        addAlias(strongAliases, managerFullName);
        addFirstTokenAlias(weakAliases, managerFullName);
        addFirstTokenAlias(weakAliases, managerFirstName);
      }

      userStrongAliases.set(userId, strongAliases);
      userWeakAliases.set(userId, weakAliases);
    }

    const strongUserIdsByAlias = new Map<string, Set<number>>();
    const weakUserIdsByAlias = new Map<string, Set<number>>();

    for (const [userId, aliases] of userStrongAliases.entries()) {
      aliases.forEach((alias) => {
        const current = strongUserIdsByAlias.get(alias) || new Set<number>();
        current.add(userId);
        strongUserIdsByAlias.set(alias, current);
      });
    }

    for (const [userId, aliases] of userWeakAliases.entries()) {
      aliases.forEach((alias) => {
        const current = weakUserIdsByAlias.get(alias) || new Set<number>();
        current.add(userId);
        weakUserIdsByAlias.set(alias, current);
      });
    }

    const [taskRows] = await pool.query<CrmDashboardTaskAggRow[]>(
      `SELECT
         t.assigned_user_id AS user_id,
         SUM(CASE WHEN t.status = 'completed' AND t.completed_at >= ? AND t.completed_at < ? THEN 1 ELSE 0 END) AS tasks_completed_mtd,
         SUM(CASE WHEN t.status = 'planned' AND t.due_at < NOW() THEN 1 ELSE 0 END) AS overdue_tasks_open,
         SUM(CASE WHEN t.status = 'planned' AND t.due_at >= NOW() AND t.due_at < DATE_ADD(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS tasks_next_7d
       FROM crm_lead_tasks t
      ${isSellerScope ? 'WHERE t.assigned_user_id = ?' : ''}
       GROUP BY t.assigned_user_id`,
      isSellerScope
        ? [monthStartSqlDate, monthEndExclusiveSqlDate, req.user.id]
        : [monthStartSqlDate, monthEndExclusiveSqlDate]
    );

    const [activityRows] = await pool.query<CrmDashboardActivityAggRow[]>(
      `SELECT
         a.created_by,
         COUNT(*) AS activities_mtd,
         SUM(CASE WHEN a.activity_type = 'call' THEN 1 ELSE 0 END) AS calls_mtd,
         SUM(CASE WHEN a.activity_type = 'email' THEN 1 ELSE 0 END) AS emails_mtd,
         SUM(CASE WHEN a.activity_type = 'meeting' THEN 1 ELSE 0 END) AS meetings_mtd,
         SUM(CASE WHEN a.activity_type = 'note' THEN 1 ELSE 0 END) AS notes_mtd
       FROM crm_activities a
       WHERE a.activity_at >= ? AND a.activity_at < ?
       GROUP BY a.created_by`,
      [monthStartSqlDate, monthEndExclusiveSqlDate]
    );

    const [leadOwnerRows] = await pool.query<CrmDashboardLeadOwnerRow[]>(
      `SELECT l.lead_owner, l.status, l.updated_at
       FROM crm_leads l
       WHERE ${leadScopeWhere.join(' AND ')}`,
      leadScopeParams
    );

    const taskAggByUserId = new Map<number, { tasksCompletedMtd: number; overdueTasksOpen: number; tasksNext7d: number }>();
    for (const row of taskRows) {
      taskAggByUserId.set(Number(row.user_id), {
        tasksCompletedMtd: Number(row.tasks_completed_mtd || 0),
        overdueTasksOpen: Number(row.overdue_tasks_open || 0),
        tasksNext7d: Number(row.tasks_next_7d || 0),
      });
    }

    const activityAggByName = new Map<string, { activitiesMtd: number; callsMtd: number; emailsMtd: number; meetingsMtd: number; notesMtd: number }>();
    for (const row of activityRows) {
      const normalizedCreator = normalizeText(cleanString(row.created_by));
      if (!normalizedCreator) continue;

      const current = activityAggByName.get(normalizedCreator) || {
        activitiesMtd: 0,
        callsMtd: 0,
        emailsMtd: 0,
        meetingsMtd: 0,
        notesMtd: 0,
      };

      current.activitiesMtd += Number(row.activities_mtd || 0);
      current.callsMtd += Number(row.calls_mtd || 0);
      current.emailsMtd += Number(row.emails_mtd || 0);
      current.meetingsMtd += Number(row.meetings_mtd || 0);
      current.notesMtd += Number(row.notes_mtd || 0);
      activityAggByName.set(normalizedCreator, current);
    }

    const ownedLeadsByUserId = new Map<number, number>();
    const wonMtdByUserId = new Map<number, number>();

    const resolveOwnerAliasToUserId = (ownerAlias: string): number | null => {
      const strongCandidates = strongUserIdsByAlias.get(ownerAlias);
      if (strongCandidates && strongCandidates.size === 1) {
        return Array.from(strongCandidates)[0];
      }
      if (strongCandidates && strongCandidates.size > 1) {
        return null;
      }

      const weakCandidates = weakUserIdsByAlias.get(ownerAlias);
      if (weakCandidates && weakCandidates.size === 1) {
        return Array.from(weakCandidates)[0];
      }

      return null;
    };

    const isWithinMtdRange = (value: unknown): boolean => {
      if (!value) return false;
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) return false;
      return date >= monthStartDate && date < monthEndExclusiveDate;
    };

    for (const row of leadOwnerRows) {
      const ownerNames = String(row.lead_owner || '')
        .split(/[;,]/)
        .map((part) => normalizeText(cleanString(part)))
        .filter((value): value is string => Boolean(value));

      const ownerUserIds = Array.from(
        new Set(
          ownerNames
            .map((ownerName) => resolveOwnerAliasToUserId(ownerName))
            .filter((userId): userId is number => userId !== null)
        )
      );
      if (ownerUserIds.length === 0) continue;

      for (const ownerUserId of ownerUserIds) {
        ownedLeadsByUserId.set(ownerUserId, Number(ownedLeadsByUserId.get(ownerUserId) || 0) + 1);
      }

      const normalizedStatus = normalizeCrmStatusForFilter(String(row.status || ''));
      const isWon = wonStatuses.includes(normalizedStatus);
      if (!isWon || !isWithinMtdRange(row.updated_at)) continue;

      for (const ownerUserId of ownerUserIds) {
        wonMtdByUserId.set(ownerUserId, Number(wonMtdByUserId.get(ownerUserId) || 0) + 1);
      }
    }

    const team = userRows.map((row) => {
      const userId = Number(row.id);
      const normalizedNameSet = new Set<string>([
        ...(userStrongAliases.get(userId) || new Set<string>()),
        ...(userWeakAliases.get(userId) || new Set<string>()),
      ]);

      const taskAgg = taskAggByUserId.get(Number(row.id)) || {
        tasksCompletedMtd: 0,
        overdueTasksOpen: 0,
        tasksNext7d: 0,
      };

      let activitiesMtd = 0;
      let callsMtd = 0;
      let emailsMtd = 0;
      let meetingsMtd = 0;
      let notesMtd = 0;

      normalizedNameSet.forEach((name) => {
        const activityAgg = activityAggByName.get(name);
        if (activityAgg) {
          activitiesMtd += activityAgg.activitiesMtd;
          callsMtd += activityAgg.callsMtd;
          emailsMtd += activityAgg.emailsMtd;
          meetingsMtd += activityAgg.meetingsMtd;
          notesMtd += activityAgg.notesMtd;
        }
      });

      const leadsOwned = Number(ownedLeadsByUserId.get(userId) || 0);
      const wonMtd = Number(wonMtdByUserId.get(userId) || 0);

      return {
        user_id: userId,
        user_name: String(row.full_name || row.username || `User #${row.id}`),
        role: row.role,
        leads_owned: leadsOwned,
        tasks_completed_mtd: taskAgg.tasksCompletedMtd,
        overdue_tasks_open: taskAgg.overdueTasksOpen,
        tasks_next_7d: taskAgg.tasksNext7d,
        activities_mtd: activitiesMtd,
        calls_mtd: callsMtd,
        emails_mtd: emailsMtd,
        meetings_mtd: meetingsMtd,
        notes_mtd: notesMtd,
        won_mtd: wonMtd,
      };
    }).sort((a, b) => {
      if (b.won_mtd !== a.won_mtd) return b.won_mtd - a.won_mtd;
      if (b.tasks_completed_mtd !== a.tasks_completed_mtd) return b.tasks_completed_mtd - a.tasks_completed_mtd;
      if (b.activities_mtd !== a.activities_mtd) return b.activities_mtd - a.activities_mtd;
      return b.leads_owned - a.leads_owned;
    });

    const wonMtd = Number(summaryRow.won_mtd || 0);
    const lostMtd = Number(summaryRow.lost_mtd || 0);
    const decisionLeadsMtd = wonMtd + lostMtd;
    const winRateMtd = decisionLeadsMtd > 0
      ? Number(((wonMtd / decisionLeadsMtd) * 100).toFixed(2))
      : 0;

    const monthLabel = monthStartDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    res.json({
      period: {
        from: monthStartSqlDate,
        to: monthEndExclusiveSqlDate,
        label: `MTD ${monthLabel}`,
      },
      kpis: {
        new_leads_mtd: Number(summaryRow.new_leads_mtd || 0),
        won_mtd: wonMtd,
        lost_mtd: lostMtd,
        win_rate_mtd: winRateMtd,
        overdue_tasks: Number(summaryRow.overdue_count || 0),
        no_next_step: Number(summaryRow.no_next_step_count || 0),
        dormant_14d: Number(summaryRow.dormant_count || 0),
      },
      pipeline: {
        all: Number(summaryRow.all_count || 0),
        cold: Number(summaryRow.cold_count || 0),
        talks: Number(summaryRow.talks_count || 0),
        won: Number(summaryRow.won_count || 0),
        lost: Number(summaryRow.lost_count || 0),
      },
      team,
    });
  } catch (error) {
    console.error('Error fetching CRM dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch CRM dashboard summary' });
  }
});

// GET /api/crm/task-users - active users for task assignment
router.get('/task-users', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, full_name
       FROM users
       WHERE is_active = 1
       AND id = ?
       ORDER BY full_name ASC, username ASC`,
      [req.user.id]
    );

    res.json({
      data: rows.map((row) => ({
        id: Number(row.id),
        username: String(row.username || ''),
        full_name: String(row.full_name || row.username || '')
      }))
    });
  } catch (error) {
    console.error('Error fetching CRM task users:', error);
    res.status(500).json({ error: 'Failed to fetch CRM task users' });
  }
});

// GET /api/crm/tasks/today - tasks for the current user for the first daily check
router.get('/tasks/today', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const startToday = toStartOfTodaySql();
    const startTomorrow = toStartOfTomorrowSql();

    const [rows] = await pool.query<CrmLeadTaskRow[]>(
      `SELECT
         t.*,
         l.company_name,
         au.full_name AS assigned_user_name,
         cu.full_name AS created_by_name
       FROM crm_lead_tasks t
       LEFT JOIN crm_leads l ON l.id = t.lead_id
       LEFT JOIN users au ON au.id = t.assigned_user_id
       LEFT JOIN users cu ON cu.id = t.created_by_user_id
       WHERE t.assigned_user_id = ?
         AND t.status = 'planned'
         AND t.due_at < ?
       ORDER BY t.due_at ASC, t.id ASC`,
      [req.user.id, startTomorrow]
    );

    const tasks = rows.map((row) => formatTaskRow(row));

    res.json({
      user_id: req.user.id,
      date: startToday.slice(0, 10),
      total: tasks.length,
      tasks
    });
  } catch (error) {
    console.error('Error fetching CRM today tasks:', error);
    res.status(500).json({ error: 'Failed to fetch today tasks' });
  }
});

// GET /api/crm/tasks - list tasks by date range/user/lead
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const where: string[] = ['1=1'];
    const params: Array<string | number> = [];

    const requestedAssignedUserId = parsePositiveInt(req.query.assigned_user_id);
    const requestedLeadId = parsePositiveInt(req.query.lead_id);
    const status = cleanString(req.query.status);
    const itemKind = cleanString(req.query.item_kind);
    const dateFrom = parseOptionalDateTime(req.query.date_from);
    const dateTo = parseOptionalDateTime(req.query.date_to);

    if (requestedAssignedUserId && requestedAssignedUserId !== req.user.id) {
      return res.status(403).json({ error: 'Private calendar scope only allows your own account' });
    }

    where.push('t.assigned_user_id = ?');
    params.push(req.user.id);

    if (requestedLeadId) {
      where.push('t.lead_id = ?');
      params.push(requestedLeadId);
    }

    if (status && ['planned', 'completed', 'cancelled'].includes(status)) {
      where.push('t.status = ?');
      params.push(status);
    }

    if (itemKind && ['task', 'event'].includes(itemKind)) {
      where.push('t.item_kind = ?');
      params.push(itemKind);
    }

    if (dateFrom) {
      where.push('t.due_at >= ?');
      params.push(dateFrom);
    }

    if (dateTo) {
      where.push('t.due_at <= ?');
      params.push(dateTo);
    }

    const [rows] = await pool.query<CrmLeadTaskRow[]>(
      `SELECT
         t.*,
         l.company_name,
         au.full_name AS assigned_user_name,
         cu.full_name AS created_by_name
       FROM crm_lead_tasks t
       LEFT JOIN crm_leads l ON l.id = t.lead_id
       LEFT JOIN users au ON au.id = t.assigned_user_id
       LEFT JOIN users cu ON cu.id = t.created_by_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.due_at ASC, t.id ASC
       LIMIT 2000`,
      params
    );

    res.json({
      data: rows.map((row) => formatTaskRow(row)),
      total: rows.length
    });
  } catch (error) {
    console.error('Error fetching CRM tasks:', error);
    res.status(500).json({ error: 'Failed to fetch CRM tasks' });
  }
});

// POST /api/crm/tasks - create task/event (lead optional)
router.post('/tasks', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parsePositiveInt(req.body.lead_id || req.body.leadId);
    let leadCompanyName: string | null = null;

    if (leadId) {
      const [leadRows] = await connection.query<RowDataPacket[]>(
        'SELECT id, company_name FROM crm_leads WHERE id = ? LIMIT 1',
        [leadId]
      );
      if (leadRows.length === 0) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      leadCompanyName = String(leadRows[0].company_name || '');
    }

    const taskType = parseTaskType(req.body.task_type || req.body.taskType);
    const itemKind = parseTaskItemKind(req.body.item_kind || req.body.itemKind, 'task');
    const recurrenceType = parseRecurrenceType(req.body.recurrence_type || req.body.recurrenceType, 'none');
    const recurrenceInterval = parseRecurrenceInterval(req.body.recurrence_interval || req.body.recurrenceInterval, 1);
    const recurrenceUntil = parseOptionalDateTime(req.body.recurrence_until || req.body.recurrenceUntil);
    const title =
      clampText(cleanString(req.body.title), 255) ||
      (leadCompanyName ? `${getTaskTypeLabel(taskType)} with ${leadCompanyName}` : getTaskTypeLabel(taskType));
    const description = cleanString(req.body.description);
    const dueAt = parseOptionalDateTime(req.body.due_at || req.body.dueAt);
    const remindAt = parseOptionalDateTime(req.body.remind_at || req.body.remindAt);

    if (!dueAt) {
      return res.status(400).json({ error: 'due_at is required and must be a valid date/time' });
    }

    const requestedAssignedUserId = parsePositiveInt(req.body.assigned_user_id || req.body.assignedUserId);
    if (requestedAssignedUserId && requestedAssignedUserId !== req.user.id) {
      return res.status(403).json({ error: 'Private calendar scope only allows creating items for your own account' });
    }
    const assignedUserId = req.user.id;

    const [userRows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [assignedUserId]
    );
    if (userRows.length === 0) {
      return res.status(400).json({ error: 'Assigned user is invalid or inactive' });
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const insertedId = await insertLeadTask(connection, {
      leadId: leadId || null,
      assignedUserId,
      createdByUserId: req.user.id,
      title,
      itemKind,
      taskType,
      description,
      dueAt,
      remindAt,
      recurrenceType,
      recurrenceInterval,
      recurrenceUntil
    });

    if (leadId) {
      await recalculateLeadScore(connection, leadId);
    }

    await connection.commit();
    transactionStarted = false;

    res.status(201).json({
      id: insertedId,
      lead_id: leadId || null,
      message: 'Task created successfully'
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error('Error creating CRM task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  } finally {
    connection.release();
  }
});

// GET /api/crm/activity-templates - predefined outcome templates
router.get('/activity-templates', async (_req: Request, res: Response) => {
  res.json({ data: ACTIVITY_TEMPLATES });
});

// POST /api/crm/leads/:id/apply-template - apply activity outcome template
router.post('/leads/:id/apply-template', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const hasAccess = await canUserAccessLead(connection, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const templateId = cleanString(req.body.template_id || req.body.templateId);
    const template = ACTIVITY_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) {
      return res.status(400).json({ error: 'Invalid template_id' });
    }

    const [leadRows] = await connection.query<CrmLeadRow[]>(
      'SELECT * FROM crm_leads WHERE id = ? LIMIT 1',
      [leadId]
    );
    if (leadRows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const requestedAssignedUserId = parsePositiveInt(req.body.assigned_user_id || req.body.assignedUserId);
    const assignedUserId = requestedAssignedUserId || req.user.id;
    if (!canManageCrmGlobally(req.user) && assignedUserId !== req.user.id) {
      return res.status(403).json({ error: 'Only admins and managers can assign template tasks to other users' });
    }

    const [assignedRows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [assignedUserId]
    );
    if (assignedRows.length === 0) {
      return res.status(400).json({ error: 'Assigned user is invalid or inactive' });
    }

    const finalNote = cleanString(req.body.note_override || req.body.noteOverride) || template.note_template;

    await connection.beginTransaction();
    await insertActivity(connection, leadId, template.activity_type, finalNote, req.user.full_name);

    if (template.next_task) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + template.next_task.due_in_days);

      const taskTitle = `${template.next_task.title} - ${leadRows[0].company_name}`;
      await connection.query<ResultSetHeader>(
        `INSERT INTO crm_lead_tasks (
          lead_id, assigned_user_id, created_by_user_id, title, item_kind, task_type, status,
          description, due_at, remind_at, recurrence_type, recurrence_interval, recurrence_until, recurrence_parent_task_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, 'none', 1, NULL, NULL)`,
        [
          leadId,
          assignedUserId,
          req.user.id,
          taskTitle,
          template.next_task.item_kind,
          template.next_task.task_type,
          finalNote,
          normalizeDateSql(dueDate),
          null
        ]
      );
    }

    await connection.query(
      'UPDATE crm_leads SET last_contact_at = ?, updated_by = ? WHERE id = ?',
      [normalizeDateSql(new Date()), req.user.full_name, leadId]
    );

    await recalculateLeadScore(connection, leadId);
    await connection.commit();

    res.status(201).json({ message: 'Template applied successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error applying CRM activity template:', error);
    res.status(500).json({ error: 'Failed to apply activity template' });
  } finally {
    connection.release();
  }
});

// GET /api/crm/priority-queue - seller priority queue based on score and urgency
router.get('/priority-queue', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const where: string[] = ['1=1'];
    const params: Array<string | number> = [];

    if (!canManageCrmGlobally(req.user)) {
      const ownerCandidates = Array.from(
        new Set(
          [cleanString(req.user.full_name), cleanString(req.user.username)].filter(
            (value): value is string => Boolean(value)
          )
        )
      );

      const [linkedOwnerRows] = await pool.query<RowDataPacket[]>(
        `SELECT TRIM(CONCAT_WS(' ', o.imie, o.nazwisko)) AS owner_name
         FROM opiekunowie o
         WHERE o.user_id = ?
           AND o.aktywny = 1
         LIMIT 1`,
        [req.user.id]
      );

      const linkedOwnerName = cleanString(linkedOwnerRows[0]?.owner_name);
      if (linkedOwnerName) {
        ownerCandidates.push(linkedOwnerName);
      }

      const uniqueOwnerCandidates = Array.from(new Set(ownerCandidates));
      const ownerMatchSql = uniqueOwnerCandidates.length > 0
        ? uniqueOwnerCandidates
            .map(() => "FIND_IN_SET(?, REPLACE(COALESCE(l.lead_owner, ''), ', ', ',')) > 0")
            .join(' OR ')
        : '0';

      where.push(
        `((${ownerMatchSql}) OR EXISTS (
          SELECT 1
          FROM crm_lead_tasks tx
          WHERE tx.lead_id = l.id
            AND tx.assigned_user_id = ?
            AND tx.status = 'planned'
        ))`
      );
      params.push(...uniqueOwnerCandidates, req.user.id);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        l.id,
        l.company_name,
        l.status,
        l.lead_owner,
        l.hot_rank,
        l.country_code,
        l.source_channel,
        l.lead_score,
        l.priority_bucket,
        (
          SELECT MAX(a.activity_at)
          FROM crm_activities a
          WHERE a.lead_id = l.id
        ) AS last_activity_at,
        (
          SELECT MIN(t.due_at)
          FROM crm_lead_tasks t
          WHERE t.lead_id = l.id
            AND t.status = 'planned'
        ) AS next_task_due_at,
        (
          SELECT COUNT(*)
          FROM crm_lead_tasks t
          WHERE t.lead_id = l.id
            AND t.status = 'planned'
            AND t.due_at < NOW()
        ) AS overdue_tasks,
        (
          SELECT COUNT(*)
          FROM crm_lead_tasks t
          WHERE t.lead_id = l.id
            AND t.status = 'planned'
        ) AS planned_tasks
      FROM crm_leads l
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(l.hot_rank, 0) DESC, overdue_tasks DESC, l.lead_score DESC, COALESCE(next_task_due_at, '9999-12-31 00:00:00') ASC, l.id DESC
      LIMIT ?`,
      [...params, limit]
    );

    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('Error fetching CRM priority queue:', error);
    res.status(500).json({ error: 'Failed to fetch priority queue' });
  }
});

// POST /api/crm/priority-queue/recalculate - recalculate lead scores
router.post('/priority-queue/recalculate', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!canManageCrmGlobally(req.user)) {
      return res.status(403).json({ error: 'Only admins and managers can recalculate scores' });
    }

    const [leadRows] = await connection.query<RowDataPacket[]>('SELECT id FROM crm_leads ORDER BY id ASC');
    for (const row of leadRows) {
      await recalculateLeadScore(connection, Number(row.id));
    }

    res.json({ message: 'Lead scores recalculated', total: leadRows.length });
  } catch (error) {
    console.error('Error recalculating lead scores:', error);
    res.status(500).json({ error: 'Failed to recalculate lead scores' });
  } finally {
    connection.release();
  }
});

// POST /api/crm/duplicate-cases - create duplicate workflow case
router.post('/duplicate-cases', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const existingLeadId = parsePositiveInt(req.body.existing_lead_id || req.body.existingLeadId);
    if (!existingLeadId) {
      return res.status(400).json({ error: 'existing_lead_id is required' });
    }

    const requestedAction = parseDuplicateCaseAction(req.body.requested_action || req.body.requestedAction);
    if (!requestedAction) {
      return res.status(400).json({ error: 'requested_action is invalid' });
    }

    const requestedOwnerUserId = parsePositiveInt(req.body.requested_owner_user_id || req.body.requestedOwnerUserId);
    const reason = cleanString(req.body.reason);
    const candidateInput = req.body.candidate_payload && typeof req.body.candidate_payload === 'object'
      ? req.body.candidate_payload
      : req.body;

    const candidatePayload = buildLeadPayloadFromRequestBody(candidateInput as Record<string, unknown>);

    const [existingLeadRows] = await pool.query<CrmLeadRow[]>(
      'SELECT id, company_name, lead_owner FROM crm_leads WHERE id = ? LIMIT 1',
      [existingLeadId]
    );
    if (existingLeadRows.length === 0) {
      return res.status(404).json({ error: 'Existing lead not found' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO crm_duplicate_cases (
        existing_lead_id,
        requested_action,
        candidate_company_name,
        candidate_email,
        candidate_phone,
        candidate_payload_json,
        reason,
        requested_by_user_id,
        requested_owner_user_id,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        existingLeadId,
        requestedAction,
        candidatePayload?.company_name || cleanString((candidateInput as Record<string, unknown>).company_name || (candidateInput as Record<string, unknown>).companyName),
        candidatePayload?.email || cleanString((candidateInput as Record<string, unknown>).email),
        candidatePayload?.phone || cleanString((candidateInput as Record<string, unknown>).phone),
        JSON.stringify(candidateInput || {}),
        reason,
        req.user.id,
        requestedAction === 'request_handover' ? (requestedOwnerUserId || req.user.id) : requestedOwnerUserId
      ]
    );

    res.status(201).json({
      id: result.insertId,
      message: 'Duplicate case created and sent for review'
    });
  } catch (error) {
    console.error('Error creating CRM duplicate case:', error);
    res.status(500).json({ error: 'Failed to create duplicate case' });
  }
});

// GET /api/crm/duplicate-cases - duplicate and ownership case queue
router.get('/duplicate-cases', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const statusFilterRaw = cleanString(req.query.status)?.toLowerCase() || 'pending';
    const allowedStatuses: DuplicateCaseStatus[] = ['pending', 'approved', 'rejected'];
    const statusFilter = allowedStatuses.includes(statusFilterRaw as DuplicateCaseStatus)
      ? (statusFilterRaw as DuplicateCaseStatus)
      : 'pending';

    const where: string[] = ['c.status = ?'];
    const params: Array<string | number> = [statusFilter];

    if (!canManageCrmGlobally(req.user)) {
      where.push('c.requested_by_user_id = ?');
      params.push(req.user.id);
    }

    const [rows] = await pool.query<DuplicateCaseRow[]>(
      `SELECT
        c.*,
        l.company_name AS existing_company_name,
        l.lead_owner AS existing_lead_owner,
        req_u.full_name AS requested_by_name,
        req_owner.full_name AS requested_owner_name,
        res_u.full_name AS resolved_by_name
      FROM crm_duplicate_cases c
      JOIN crm_leads l ON l.id = c.existing_lead_id
      LEFT JOIN users req_u ON req_u.id = c.requested_by_user_id
      LEFT JOIN users req_owner ON req_owner.id = c.requested_owner_user_id
      LEFT JOIN users res_u ON res_u.id = c.resolved_by_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 500`,
      params
    );

    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('Error fetching CRM duplicate cases:', error);
    res.status(500).json({ error: 'Failed to fetch duplicate cases' });
  }
});

// POST /api/crm/duplicate-cases/:id/resolve - approve/reject duplicate workflow case
router.post('/duplicate-cases/:id/resolve', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!canManageCrmGlobally(req.user)) {
      return res.status(403).json({ error: 'Only admins and managers can resolve duplicate cases' });
    }

    const caseId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(caseId)) {
      return res.status(400).json({ error: 'Invalid case ID' });
    }

    const decision = cleanString(req.body.decision)?.toLowerCase();
    if (decision !== 'approve' && decision !== 'reject') {
      return res.status(400).json({ error: 'decision must be approve or reject' });
    }

    const resolvedNote = cleanString(req.body.resolved_note || req.body.resolvedNote);
    const assignOwnerUserId = parsePositiveInt(req.body.assign_owner_user_id || req.body.assignOwnerUserId);

    await connection.beginTransaction();

    const [caseRows] = await connection.query<DuplicateCaseRow[]>(
      'SELECT * FROM crm_duplicate_cases WHERE id = ? LIMIT 1 FOR UPDATE',
      [caseId]
    );
    if (caseRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Case not found' });
    }

    const caseRow = caseRows[0];
    if (caseRow.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ error: 'Case is already resolved' });
    }

    if (decision === 'reject') {
      await connection.query(
        `UPDATE crm_duplicate_cases
         SET status = 'rejected', resolved_note = ?, resolved_by_user_id = ?, resolved_at = NOW()
         WHERE id = ?`,
        [resolvedNote, req.user.id, caseId]
      );
      await connection.commit();
      return res.json({ message: 'Case rejected' });
    }

    let resolvedLeadId: number | null = caseRow.resolved_lead_id || null;

    if (caseRow.requested_action === 'merge') {
      const [existingLeadRows] = await connection.query<CrmLeadRow[]>(
        'SELECT * FROM crm_leads WHERE id = ? LIMIT 1',
        [caseRow.existing_lead_id]
      );
      if (existingLeadRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Existing lead no longer exists' });
      }

      const candidateRaw = parseCandidatePayload(caseRow.candidate_payload_json);
      if (candidateRaw) {
        const candidatePayload = buildLeadPayloadFromRequestBody(candidateRaw);
        if (candidatePayload) {
          const merged = mergeIncomingWithExisting(existingLeadRows[0], candidatePayload);
          await updateLead(connection, caseRow.existing_lead_id, merged);
        }
      }

      await insertActivity(
        connection,
        caseRow.existing_lead_id,
        'note',
        `Duplicate case #${caseRow.id} approved as merge by ${req.user.full_name}`,
        req.user.full_name
      );

      await recalculateLeadScore(connection, caseRow.existing_lead_id);
      resolvedLeadId = caseRow.existing_lead_id;
    }

    if (caseRow.requested_action === 'keep_separate') {
      const candidateRaw = parseCandidatePayload(caseRow.candidate_payload_json);
      const candidatePayload = candidateRaw ? buildLeadPayloadFromRequestBody(candidateRaw) : null;
      if (!candidatePayload) {
        await connection.rollback();
        return res.status(400).json({ error: 'Case has no valid candidate payload to create separate lead' });
      }

      const forcedPayload = makeForcedDuplicatePayload(candidatePayload, req.user.full_name);
      const newLeadId = await insertLead(connection, forcedPayload);

      if (forcedPayload.notes) {
        await insertActivity(connection, newLeadId, 'note', forcedPayload.notes, req.user.full_name);
      }

      await recalculateLeadScore(connection, newLeadId);
      resolvedLeadId = newLeadId;
    }

    if (caseRow.requested_action === 'request_handover') {
      const targetOwnerId = assignOwnerUserId || caseRow.requested_owner_user_id || caseRow.requested_by_user_id;
      const [userRows] = await connection.query<RowDataPacket[]>(
        `SELECT u.id, TRIM(CONCAT_WS(' ', o.imie, o.nazwisko)) AS owner_name
         FROM users u
         JOIN opiekunowie o ON o.user_id = u.id
         WHERE u.id = ?
           AND u.is_active = 1
           AND o.aktywny = 1
         LIMIT 1`,
        [targetOwnerId]
      );
      if (userRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Selected owner must be a linked active account manager' });
      }

      const ownerName = String(userRows[0].owner_name || '').trim();
      if (!ownerName) {
        await connection.rollback();
        return res.status(400).json({ error: 'Selected owner has no full_name configured' });
      }

      await connection.query(
        'UPDATE crm_leads SET lead_owner = ?, updated_by = ? WHERE id = ?',
        [ownerName, req.user.full_name, caseRow.existing_lead_id]
      );

      await insertActivity(
        connection,
        caseRow.existing_lead_id,
        'note',
        `Ownership handover approved by ${req.user.full_name}. New owner: ${ownerName}`,
        req.user.full_name
      );

      await recalculateLeadScore(connection, caseRow.existing_lead_id);
      resolvedLeadId = caseRow.existing_lead_id;
    }

    await connection.query(
      `UPDATE crm_duplicate_cases
       SET status = 'approved',
           resolved_note = ?,
           resolved_by_user_id = ?,
           resolved_lead_id = ?,
           resolved_at = NOW()
       WHERE id = ?`,
      [resolvedNote, req.user.id, resolvedLeadId, caseId]
    );

    await connection.commit();
    res.json({ message: 'Case approved successfully', resolved_lead_id: resolvedLeadId });
  } catch (error) {
    await connection.rollback();
    console.error('Error resolving duplicate case:', error);
    res.status(500).json({ error: 'Failed to resolve duplicate case' });
  } finally {
    connection.release();
  }
});

// GET /api/crm/leads - list leads
router.get('/leads', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const perPage = Math.min(1000, Math.max(1, parseInt(String(req.query.per_page || '50'), 10)));
    const offset = (page - 1) * perPage;

    const { whereClause, params } = await buildScopedLeadFilters(pool, req.query, req.user);

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM crm_leads l ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        lead_rows.*,
        GREATEST(
          COALESCE(lead_rows.last_activity_at, '1000-01-01 00:00:00'),
          COALESCE(lead_rows.last_task_action_at, '1000-01-01 00:00:00'),
          COALESCE(lead_rows.last_contact_at, '1000-01-01 00:00:00'),
          COALESCE(lead_rows.created_at, '1000-01-01 00:00:00')
        ) AS last_action_at,
        CASE
          WHEN COALESCE(lead_rows.last_activity_at, '1000-01-01 00:00:00') >= COALESCE(lead_rows.last_task_action_at, '1000-01-01 00:00:00')
            AND COALESCE(lead_rows.last_activity_at, '1000-01-01 00:00:00') >= COALESCE(lead_rows.last_contact_at, '1000-01-01 00:00:00')
            AND COALESCE(lead_rows.last_activity_at, '1000-01-01 00:00:00') >= COALESCE(lead_rows.created_at, '1000-01-01 00:00:00')
            THEN COALESCE(lead_rows.last_activity_type, 'activity')
          WHEN COALESCE(lead_rows.last_task_action_at, '1000-01-01 00:00:00') >= COALESCE(lead_rows.last_contact_at, '1000-01-01 00:00:00')
            AND COALESCE(lead_rows.last_task_action_at, '1000-01-01 00:00:00') >= COALESCE(lead_rows.created_at, '1000-01-01 00:00:00')
            THEN COALESCE(lead_rows.last_task_type, 'task')
          WHEN COALESCE(lead_rows.last_contact_at, '1000-01-01 00:00:00') >= COALESCE(lead_rows.created_at, '1000-01-01 00:00:00')
            THEN 'contact'
          ELSE 'lead_created'
        END AS last_action_type
      FROM (
        SELECT
          l.*,
          (
            SELECT MAX(a.activity_at)
            FROM crm_activities a
            WHERE a.lead_id = l.id
          ) AS last_activity_at,
          (
            SELECT a.activity_type
            FROM crm_activities a
            WHERE a.lead_id = l.id
            ORDER BY a.activity_at DESC, a.id DESC
            LIMIT 1
          ) AS last_activity_type,
          (
            SELECT MAX(
              CASE
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at
                WHEN t.status = 'cancelled' THEN t.updated_at
                ELSE NULL
              END
            )
            FROM crm_lead_tasks t
            WHERE t.lead_id = l.id
          ) AS last_task_action_at,
          (
            SELECT t.task_type
            FROM crm_lead_tasks t
            WHERE t.lead_id = l.id
              AND t.status IN ('completed', 'cancelled')
            ORDER BY
              CASE
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at
                WHEN t.status = 'cancelled' THEN t.updated_at
                ELSE t.updated_at
              END DESC,
              t.id DESC
            LIMIT 1
          ) AS last_task_type,
          (
            SELECT t.title
            FROM crm_lead_tasks t
            WHERE t.lead_id = l.id
              AND t.status IN ('completed', 'cancelled')
            ORDER BY
              CASE
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at
                WHEN t.status = 'cancelled' THEN t.updated_at
                ELSE t.updated_at
              END DESC,
              t.id DESC
            LIMIT 1
          ) AS last_action_task_title,
          (
            SELECT t.status
            FROM crm_lead_tasks t
            WHERE t.lead_id = l.id
            ORDER BY
              CASE
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at
                WHEN t.status = 'planned' THEN t.updated_at
                ELSE t.updated_at
              END DESC,
              t.id DESC
            LIMIT 1
          ) AS last_task_status,
          (
            SELECT t.title
            FROM crm_lead_tasks t
            WHERE t.lead_id = l.id
            ORDER BY
              CASE
                WHEN t.status = 'completed' AND t.completed_at IS NOT NULL THEN t.completed_at
                WHEN t.status = 'planned' THEN t.updated_at
                ELSE t.updated_at
              END DESC,
              t.id DESC
            LIMIT 1
          ) AS last_task_title,
          (
            SELECT COUNT(*)
            FROM crm_activities a
            WHERE a.lead_id = l.id
          ) AS activities_count,
          (
            SELECT MIN(t.due_at)
            FROM crm_lead_tasks t
            WHERE t.lead_id = l.id
              AND t.status = 'planned'
          ) AS next_task_due_at,
          (
            SELECT t.task_type
            FROM crm_lead_tasks t
            WHERE t.lead_id = l.id
              AND t.status = 'planned'
            ORDER BY t.due_at ASC, t.id ASC
            LIMIT 1
          ) AS next_task_type,
          (
            SELECT t.title
            FROM crm_lead_tasks t
            WHERE t.lead_id = l.id
              AND t.status = 'planned'
            ORDER BY t.due_at ASC, t.id ASC
            LIMIT 1
          ) AS next_task_title
        FROM crm_leads l
        ${whereClause}
      ) AS lead_rows
      ORDER BY lead_rows.updated_at DESC, lead_rows.id DESC
      LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    res.json({
      data: rows,
      total,
      page,
      per_page: perPage
    });
  } catch (error) {
    console.error('Error fetching CRM leads:', error);
    res.status(500).json({ error: 'Failed to fetch CRM leads' });
  }
});

// GET /api/crm/leads/ids - ids matching current filters
router.get('/leads/ids', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { whereClause, params } = await buildScopedLeadFilters(pool, req.query, req.user);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT l.id FROM crm_leads l ${whereClause} ORDER BY l.updated_at DESC, l.id DESC LIMIT 100000`,
      params
    );

    res.json({
      ids: rows.map((row) => Number(row.id)),
      total: rows.length
    });
  } catch (error) {
    console.error('Error fetching CRM lead IDs:', error);
    res.status(500).json({ error: 'Failed to fetch lead IDs' });
  }
});

// GET /api/crm/export/csv - export filtered leads to CSV
router.get('/export/csv', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { whereClause, params } = await buildScopedLeadFilters(pool, req.query, req.user);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        l.id,
        l.company_name,
        l.tax_id,
        l.first_name,
        l.last_name,
        l.email,
        l.phone,
        l.title,
        l.website,
        l.status,
        l.lead_owner,
        l.location,
        l.company_address,
        l.delivery_address,
        l.company_size,
        l.source_channel,
        l.region,
        l.country_code,
        l.pipeline_type,
        l.last_contact_at,
        l.notes,
        l.source_file,
        l.created_at,
        l.updated_at
      FROM crm_leads l
      ${whereClause}
      ORDER BY l.updated_at DESC, l.id DESC
      LIMIT 100000`,
      params
    );

    const headers = [
      'id',
      'company_name',
      'tax_id',
      'first_name',
      'last_name',
      'email',
      'phone',
      'company_type',
      'contact_position',
      'website',
      'status',
      'lead_owner',
      'location',
      'company_address',
      'delivery_address',
      'company_size',
      'source_channel',
      'region',
      'country_code',
      'pipeline_type',
      'last_contact_at',
      'notes',
      'source_file',
      'created_at',
      'updated_at'
    ];

    const separator = ';';
    const lines: string[] = [];
    lines.push(`sep=${separator}`);
    lines.push(headers.join(separator));
    for (const row of rows) {
      const line = headers.map((header) => toCsvCell(row[header], separator)).join(separator);
      lines.push(line);
    }

    const csv = lines.join('\r\n');
    const encoded = encodeCsvForDownload(csv, req.query.encoding);
    const fileName = `crm_leads_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', `text/csv; charset=${encoded.charset}`);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(encoded.content);
  } catch (error) {
    console.error('Error exporting CRM CSV:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// GET /api/crm/leads/:id - lead details + activities
router.get('/leads/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const hasAccess = await canUserAccessLead(pool, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const [leadRows] = await pool.query<CrmLeadRow[]>(
      'SELECT * FROM crm_leads WHERE id = ? LIMIT 1',
      [leadId]
    );

    if (leadRows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const [activityRows] = await pool.query<CrmActivityRow[]>(
      `SELECT *
       FROM crm_activities
       WHERE lead_id = ?
       ORDER BY activity_at DESC, id DESC
       LIMIT 200`,
      [leadId]
    );

    const [productRows] = await pool.query<CrmLeadProductRow[]>(
      `SELECT
         lp.*,
         p.nazwa AS product_name_resolved
       FROM crm_lead_products lp
       LEFT JOIN products p ON p.id = lp.product_id
       WHERE lp.lead_id = ?
       ORDER BY lp.updated_at DESC, lp.id DESC`,
      [leadId]
    );

    const [taskRows] = await pool.query<CrmLeadTaskRow[]>(
      `SELECT
         t.*,
         l.company_name,
         au.full_name AS assigned_user_name,
         cu.full_name AS created_by_name
       FROM crm_lead_tasks t
       JOIN crm_leads l ON l.id = t.lead_id
       LEFT JOIN users au ON au.id = t.assigned_user_id
       LEFT JOIN users cu ON cu.id = t.created_by_user_id
       WHERE t.lead_id = ?
       ORDER BY t.due_at ASC, t.id ASC
       LIMIT 300`,
      [leadId]
    );

    res.json({
      ...leadRows[0],
      activities: activityRows,
      lead_products: productRows.map((row) => ({
        ...row,
        product_name: row.product_name || row.product_name_resolved || null
      })),
      lead_tasks: taskRows.map((row) => formatTaskRow(row))
    });
  } catch (error) {
    console.error('Error fetching CRM lead details:', error);
    res.status(500).json({ error: 'Failed to fetch lead details' });
  }
});

// POST /api/crm/leads - create lead
router.post('/leads', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = buildLeadPayloadFromRequestBody(req.body as Record<string, unknown>);
    if (!payload) {
      return res.status(400).json({ error: 'company_name is required' });
    }

    const parsedLostReasonCode = parseLostReasonCode(req.body.lost_reason_code ?? req.body.lostReasonCode);
    if (parsedLostReasonCode === 'invalid') {
      return res.status(400).json({ error: `Invalid lost_reason_code. Allowed: ${LOST_REASON_CODES.join(', ')}` });
    }
    payload.lost_reason_code = isLostStatus(payload.status) ? parsedLostReasonCode : null;

    if (!payload.email && !payload.phone) {
      return res.status(400).json({ error: 'Wymagany jest kontakt: email lub telefon' });
    }

    const allowedOwners = await fetchAllowedLeadOwners(connection);
    payload.lead_owner = validateLeadOwnerValue(payload.lead_owner, allowedOwners);

    if (!canManageCrmGlobally(req.user) && payload.lead_owner) {
      const strictOwnerValues = await resolveStrictLeadOwnerValuesForUser(connection, req.user);
      const requestedOwnerValue = normalizeOwnerValue(payload.lead_owner);
      if (!requestedOwnerValue || !strictOwnerValues.includes(requestedOwnerValue)) {
        return res.status(403).json({
          error: 'You cannot assign leads to a different owner',
        });
      }
    }

    await connection.beginTransaction();
    const existing = await findExistingLead(connection, payload);
    if (existing) {
      const canAccessExisting = await canUserAccessLead(connection, req.user, existing.id);
      await connection.rollback();

      if (!canAccessExisting) {
        return res.status(409).json({
          error: 'Potential duplicate lead already exists',
          details: 'Duplicate found in another owner scope. Submit a duplicate case for handover or merge review.',
          lead_id: existing.id,
          duplicate_payload: {
            company_name: payload.company_name,
            tax_id: payload.tax_id,
            email: payload.email,
            phone: payload.phone,
            contact_position: payload.contact_position,
            website: payload.website,
            status: payload.status,
            source_channel: payload.source_channel,
            location: payload.location,
            company_address: payload.company_address,
            delivery_address: payload.delivery_address,
            country_code: payload.country_code,
            notes: payload.notes
          }
        });
      }

      return res.status(409).json({
        error: 'Potential duplicate lead already exists',
        details: `Existing lead owner: ${existing.lead_owner || 'Unassigned'}`,
        lead_id: existing.id,
        company_name: existing.company_name,
        lead_owner: existing.lead_owner,
        duplicate_payload: {
          company_name: payload.company_name,
          tax_id: payload.tax_id,
          email: payload.email,
          phone: payload.phone,
          contact_position: payload.contact_position,
          website: payload.website,
          status: payload.status,
          source_channel: payload.source_channel,
          location: payload.location,
          company_address: payload.company_address,
          delivery_address: payload.delivery_address,
          country_code: payload.country_code,
          notes: payload.notes
        }
      });
    }

    const leadId = await insertLead(connection, payload);

    if (payload.notes) {
      await insertActivity(connection, leadId, 'note', payload.notes, payload.created_by);
    }

    await recalculateLeadScore(connection, leadId);

    await connection.commit();
    res.status(201).json({ id: leadId, message: 'Lead created successfully' });
  } catch (error) {
    await connection.rollback();
    const leadOwnerError = error as { code?: string };
    if (leadOwnerError.code === 'INVALID_LEAD_OWNER') {
      return res.status(400).json({ error: 'Lead owner must be selected from active account managers (max 2)' });
    }
    console.error('Error creating CRM lead:', error);
    res.status(500).json({ error: 'Failed to create lead' });
  } finally {
    connection.release();
  }
});

// PUT /api/crm/leads/:id - update lead
router.put('/leads/:id', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const hasAccess = await canUserAccessLead(connection, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const [leadRows] = await connection.query<CrmLeadRow[]>(
      'SELECT * FROM crm_leads WHERE id = ? LIMIT 1',
      [leadId]
    );

    if (leadRows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const existing = leadRows[0];
    const requestBody = req.body as Record<string, unknown>;
    const requestedLastContactRaw = req.body.last_contact_at ?? req.body.lastContactAt;

    const existingLastContact = parseOptionalDateTime(existing.last_contact_at);

    const sourceRowFromBodyRaw = req.body.source_row ?? req.body.sourceRow;
    const parsedSourceRow =
      sourceRowFromBodyRaw !== undefined && sourceRowFromBodyRaw !== null && String(sourceRowFromBodyRaw).trim() !== ''
        ? Number(sourceRowFromBodyRaw)
        : null;
    const sourceRow =
      sourceRowFromBodyRaw !== undefined
        ? Number.isNaN(parsedSourceRow)
          ? null
          : parsedSourceRow
        : existing.source_row;

    const countryCode = normalizeCountryCode(
      cleanString(req.body.country_code || req.body.countryCode) || cleanString(existing.country_code)
    );

    const parsedLostReasonCode = parseLostReasonCode(req.body.lost_reason_code ?? req.body.lostReasonCode);
    if (parsedLostReasonCode === 'invalid') {
      return res.status(400).json({ error: `Invalid lost_reason_code. Allowed: ${LOST_REASON_CODES.join(', ')}` });
    }

    const payload = prepareLeadPayload({
      companyName: cleanString(req.body.company_name || req.body.companyName) || existing.company_name,
      taxId: cleanString(req.body.tax_id || req.body.taxId) || cleanString(existing.tax_id),
      firstName: cleanString(req.body.first_name || req.body.firstName) || cleanString(existing.first_name),
      lastName: cleanString(req.body.last_name || req.body.lastName) || cleanString(existing.last_name),
      email: cleanString(req.body.email) || cleanString(existing.email),
      companyType: cleanString(req.body.company_type || req.body.companyType) || cleanString(existing.company_type),
      contactPosition: cleanString(req.body.contact_position || req.body.contactPosition) || cleanString(existing.contact_position),
      website: cleanString(req.body.website) || cleanString(existing.website),
      status: cleanString(req.body.status)
        ? normalizeCrmStatus(cleanString(req.body.status))
        : cleanString(existing.status) || CRM_DEFAULT_STATUS,
      lostReasonCode:
        req.body.lost_reason_code !== undefined || req.body.lostReasonCode !== undefined
          ? parsedLostReasonCode
          : cleanString(existing.lost_reason_code),
      leadOwner: cleanString(req.body.lead_owner || req.body.leadOwner) || cleanString(existing.lead_owner),
      location: cleanString(req.body.location) || cleanString(existing.location),
      companyAddress: cleanString(req.body.company_address || req.body.companyAddress) || cleanString(existing.company_address),
      deliveryAddress: cleanString(req.body.delivery_address || req.body.deliveryAddress) || cleanString(existing.delivery_address),
      companySize: cleanString(req.body.company_size || req.body.companySize) || cleanString(existing.company_size),
      sourceChannel: cleanString(req.body.source_channel || req.body.sourceChannel) || cleanString(existing.source_channel),
      notes: cleanString(req.body.notes) || cleanString(existing.notes),
      pipelineType: parsePipelineType(req.body.pipeline_type || req.body.pipelineType, existing.pipeline_type),
      region: normalizeRegion(cleanString(req.body.region) || cleanString(existing.region), countryCode),
      countryCode,
      phone: cleanString(req.body.phone) || cleanString(existing.phone),
      sourceFile: cleanString(req.body.source_file || req.body.sourceFile) || cleanString(existing.source_file),
      sourceRow,
      createdBy: cleanString(existing.created_by),
      updatedBy: cleanString(req.body.updated_by || req.body.updatedBy || req.body.lead_owner || req.body.leadOwner),
      lastContactAt:
        requestedLastContactRaw !== undefined
          ? parseOptionalDateTime(requestedLastContactRaw)
          : existingLastContact
    });

    if (isLeadOwnerProvided(requestBody)) {
      const requestedOwnerRaw = cleanString(req.body.lead_owner || req.body.leadOwner);
      const existingOwnerRaw = cleanString(existing.lead_owner);

      if (requestedOwnerRaw !== existingOwnerRaw) {
        if (!canManageCrmGlobally(req.user)) {
          return res.status(403).json({ error: 'You cannot change lead ownership' });
        }
        const allowedOwners = await fetchAllowedLeadOwners(connection);
        payload.lead_owner = validateLeadOwnerValue(requestedOwnerRaw, allowedOwners);
      }
    }

    await connection.beginTransaction();
    await updateLead(connection, leadId, payload);
    await recalculateLeadScore(connection, leadId);
    await connection.commit();

    res.json({ message: 'Lead updated successfully' });
  } catch (error: unknown) {
    await connection.rollback();
    const mysqlError = error as { code?: string };
    if (mysqlError.code === 'INVALID_LEAD_OWNER') {
      return res.status(400).json({ error: 'Lead owner must be selected from active account managers (max 2)' });
    }
    if (mysqlError.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Update would create a duplicate lead' });
    }

    console.error('Error updating CRM lead:', error);
    const detailedError = error as { code?: string; message?: string };
    res.status(500).json({
      error: 'Failed to update lead',
      details: detailedError.message || detailedError.code || 'Unknown error',
    });
  } finally {
    connection.release();
  }
});

// PUT /api/crm/leads/:id/hot-rank - set manual hotness rank (1-10)
router.put('/leads/:id/hot-rank', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const hasAccess = await canUserAccessLead(pool, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const parsedRank = parseHotRank(req.body.hot_rank ?? req.body.hotRank);
    if (parsedRank === 'invalid') {
      return res.status(400).json({ error: 'hot_rank must be an integer between 1 and 10' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE crm_leads SET hot_rank = ?, updated_by = ? WHERE id = ?',
      [parsedRank, req.user?.full_name || null, leadId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({ message: 'Lead hot rank updated successfully', hot_rank: parsedRank });
  } catch (error) {
    console.error('Error updating lead hot rank:', error);
    res.status(500).json({ error: 'Failed to update lead hot rank' });
  }
});

// DELETE /api/crm/leads/:id - delete single lead
router.delete('/leads/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const hasAccess = await canUserAccessLead(pool, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const [result] = await pool.query<ResultSetHeader>('DELETE FROM crm_leads WHERE id = ?', [leadId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Error deleting CRM lead:', error);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// POST /api/crm/leads/bulk-delete - delete many leads at once
router.post('/leads/bulk-delete', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idsRaw = Array.isArray(req.body.ids) ? req.body.ids : [];
    const ids = idsRaw
      .map((value: unknown) => parseInt(String(value), 10))
      .filter((value: number) => Number.isInteger(value) && value > 0);

    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      return res.status(400).json({ error: 'No lead IDs provided' });
    }

    let idsToDelete = uniqueIds;
    if (!canManageCrmGlobally(req.user)) {
      const placeholders = uniqueIds.map(() => '?').join(', ');
      const scope = await buildLeadVisibilityScope(pool, req.user, 'l');
      const [allowedRows] = await pool.query<RowDataPacket[]>(
        `SELECT l.id
         FROM crm_leads l
         WHERE l.id IN (${placeholders})
           AND ${scope.whereSql}`,
        [...uniqueIds, ...scope.params]
      );

      idsToDelete = allowedRows.map((row) => Number(row.id));
      if (idsToDelete.length === 0) {
        return res.status(404).json({ error: 'No accessible leads found for deletion' });
      }
    }

    const placeholders = idsToDelete.map(() => '?').join(', ');
    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM crm_leads WHERE id IN (${placeholders})`,
      idsToDelete
    );

    res.json({
      message: 'Leads deleted successfully',
      requested_count: uniqueIds.length,
      deleted_count: result.affectedRows,
      skipped_count: uniqueIds.length - idsToDelete.length
    });
  } catch (error) {
    console.error('Error bulk deleting CRM leads:', error);
    res.status(500).json({ error: 'Failed to bulk delete leads' });
  }
});

// POST /api/crm/leads/:id/activities - add activity
router.post('/leads/:id/activities', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const hasAccess = await canUserAccessLead(connection, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const note = cleanString(req.body.note);
    if (!note) {
      return res.status(400).json({ error: 'note is required' });
    }

    const allowedActivityTypes: ActivityType[] = ['note', 'call', 'email', 'meeting', 'import'];
    const requestedType = cleanString(req.body.activity_type)?.toLowerCase() as ActivityType | undefined;
    const finalType: ActivityType = requestedType && allowedActivityTypes.includes(requestedType) ? requestedType : 'note';

    const [leadRows] = await connection.query<CrmLeadRow[]>('SELECT id FROM crm_leads WHERE id = ? LIMIT 1', [leadId]);
    if (leadRows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await connection.beginTransaction();
    await insertActivity(
      connection,
      leadId,
      finalType,
      note,
      cleanString(req.body.created_by || req.body.createdBy || req.body.lead_owner || req.body.leadOwner),
      parseOptionalDateTime(req.body.activity_at || req.body.activityAt)
    );

    await connection.query('UPDATE crm_leads SET last_contact_at = ? WHERE id = ?', [
      parseOptionalDateTime(req.body.activity_at || req.body.activityAt) || new Date().toISOString().slice(0, 19).replace('T', ' '),
      leadId
    ]);

    await recalculateLeadScore(connection, leadId);

    await connection.commit();
    res.status(201).json({ message: 'Activity added' });
  } catch (error) {
    await connection.rollback();
    console.error('Error adding CRM activity:', error);
    res.status(500).json({ error: 'Failed to add activity' });
  } finally {
    connection.release();
  }
});

// POST /api/crm/leads/:id/products - add product relation for lead
router.post('/leads/:id/products', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const hasAccess = await canUserAccessLead(pool, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const relationTypeRaw = cleanString(req.body.relation_type || req.body.relationType);
    const relationType = relationTypeRaw === 'currently_using' ? 'currently_using' : 'interested_in';
    const productIdRaw = req.body.product_id ?? req.body.productId;
    const productId = productIdRaw !== undefined && productIdRaw !== null && String(productIdRaw).trim() !== ''
      ? parseInt(String(productIdRaw), 10)
      : null;

    if (productId !== null && Number.isNaN(productId)) {
      return res.status(400).json({ error: 'Invalid product_id' });
    }

    const offeredPriceRaw = cleanString(req.body.offered_price ?? req.body.offeredPrice);
    const offeredPrice = offeredPriceRaw ? Number(offeredPriceRaw.replace(',', '.')) : null;
    if (offeredPrice !== null && Number.isNaN(offeredPrice)) {
      return res.status(400).json({ error: 'Invalid offered_price' });
    }

    const [leadRows] = await pool.query<RowDataPacket[]>('SELECT id FROM crm_leads WHERE id = ? LIMIT 1', [leadId]);
    if (leadRows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO crm_lead_products (
         lead_id, product_id, product_name, relation_type, volume_text, offered_price, currency, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leadId,
        productId,
        clampText(cleanString(req.body.product_name || req.body.productName), 255),
        relationType,
        clampText(cleanString(req.body.volume_text || req.body.volumeText), 120),
        offeredPrice,
        clampText(cleanString(req.body.currency) || 'PLN', 10),
        cleanString(req.body.notes)
      ]
    );

    res.status(201).json({ id: result.insertId, message: 'Lead product added' });
  } catch (error) {
    console.error('Error adding lead product:', error);
    res.status(500).json({ error: 'Failed to add lead product' });
  }
});

// PUT /api/crm/leads/:id/products/:productLinkId - update lead product relation
router.put('/leads/:id/products/:productLinkId', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    const productLinkId = parseInt(String(req.params.productLinkId), 10);
    if (Number.isNaN(leadId) || Number.isNaN(productLinkId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const hasAccess = await canUserAccessLead(pool, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const relationTypeRaw = cleanString(req.body.relation_type || req.body.relationType);
    const relationType = relationTypeRaw === 'currently_using' ? 'currently_using' : 'interested_in';
    const productIdRaw = req.body.product_id ?? req.body.productId;
    const productId = productIdRaw !== undefined && productIdRaw !== null && String(productIdRaw).trim() !== ''
      ? parseInt(String(productIdRaw), 10)
      : null;

    if (productId !== null && Number.isNaN(productId)) {
      return res.status(400).json({ error: 'Invalid product_id' });
    }

    const offeredPriceRaw = cleanString(req.body.offered_price ?? req.body.offeredPrice);
    const offeredPrice = offeredPriceRaw ? Number(offeredPriceRaw.replace(',', '.')) : null;
    if (offeredPrice !== null && Number.isNaN(offeredPrice)) {
      return res.status(400).json({ error: 'Invalid offered_price' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE crm_lead_products
       SET product_id = ?, product_name = ?, relation_type = ?, volume_text = ?, offered_price = ?, currency = ?, notes = ?
       WHERE id = ? AND lead_id = ?`,
      [
        productId,
        clampText(cleanString(req.body.product_name || req.body.productName), 255),
        relationType,
        clampText(cleanString(req.body.volume_text || req.body.volumeText), 120),
        offeredPrice,
        clampText(cleanString(req.body.currency) || 'PLN', 10),
        cleanString(req.body.notes),
        productLinkId,
        leadId
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Lead product relation not found' });
    }

    res.json({ message: 'Lead product updated' });
  } catch (error) {
    console.error('Error updating lead product:', error);
    res.status(500).json({ error: 'Failed to update lead product' });
  }
});

// DELETE /api/crm/leads/:id/products/:productLinkId - delete lead product relation
router.delete('/leads/:id/products/:productLinkId', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    const productLinkId = parseInt(String(req.params.productLinkId), 10);
    if (Number.isNaN(leadId) || Number.isNaN(productLinkId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const hasAccess = await canUserAccessLead(pool, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM crm_lead_products WHERE id = ? AND lead_id = ?',
      [productLinkId, leadId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Lead product relation not found' });
    }

    res.json({ message: 'Lead product removed' });
  } catch (error) {
    console.error('Error deleting lead product:', error);
    res.status(500).json({ error: 'Failed to delete lead product' });
  }
});

// POST /api/crm/leads/:id/tasks - create calendar task for a lead
router.post('/leads/:id/tasks', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const leadId = parseInt(String(req.params.id), 10);
    if (Number.isNaN(leadId)) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const hasAccess = await canUserAccessLead(connection, req.user, leadId);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const [leadRows] = await connection.query<RowDataPacket[]>(
      'SELECT id, company_name FROM crm_leads WHERE id = ? LIMIT 1',
      [leadId]
    );
    if (leadRows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const taskType = parseTaskType(req.body.task_type || req.body.taskType);
    const itemKind = parseTaskItemKind(req.body.item_kind || req.body.itemKind, 'task');
    const recurrenceType = parseRecurrenceType(req.body.recurrence_type || req.body.recurrenceType, 'none');
    const recurrenceInterval = parseRecurrenceInterval(req.body.recurrence_interval || req.body.recurrenceInterval, 1);
    const recurrenceUntil = parseOptionalDateTime(req.body.recurrence_until || req.body.recurrenceUntil);
    const title = clampText(cleanString(req.body.title), 255) || `${getTaskTypeLabel(taskType)} with ${leadRows[0].company_name}`;
    const description = cleanString(req.body.description);
    const dueAt = parseOptionalDateTime(req.body.due_at || req.body.dueAt);
    const remindAt = parseOptionalDateTime(req.body.remind_at || req.body.remindAt);
    if (!dueAt) {
      return res.status(400).json({ error: 'due_at is required and must be a valid date/time' });
    }

    const requestedAssignedUserId = parsePositiveInt(req.body.assigned_user_id || req.body.assignedUserId);
    if (requestedAssignedUserId && requestedAssignedUserId !== req.user.id) {
      return res.status(403).json({ error: 'Private calendar scope only allows creating items for your own account' });
    }
    const assignedUserId = req.user.id;

    const [userRows] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [assignedUserId]
    );
    if (userRows.length === 0) {
      return res.status(400).json({ error: 'Assigned user is invalid or inactive' });
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const insertedId = await insertLeadTask(connection, {
      leadId,
      assignedUserId,
      createdByUserId: req.user.id,
      title,
      itemKind,
      taskType,
      description,
      dueAt,
      remindAt,
      recurrenceType,
      recurrenceInterval,
      recurrenceUntil
    });

    await recalculateLeadScore(connection, leadId);
    await connection.commit();
    transactionStarted = false;

    res.status(201).json({ id: insertedId, message: 'Task created successfully' });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error('Error creating CRM lead task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  } finally {
    connection.release();
  }
});

// PUT /api/crm/tasks/:taskId - update task status/details
router.put('/tasks/:taskId', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const taskId = parseInt(String(req.params.taskId), 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const [taskRows] = await connection.query<CrmLeadTaskRow[]>(
      'SELECT * FROM crm_lead_tasks WHERE id = ? LIMIT 1',
      [taskId]
    );
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const existingTask = taskRows[0];
    const canManageTask = existingTask.assigned_user_id === req.user.id;
    if (!canManageTask) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const requestedAssignedUserId = parsePositiveInt(req.body.assigned_user_id || req.body.assignedUserId);
    if (requestedAssignedUserId && requestedAssignedUserId !== req.user.id) {
      return res.status(403).json({ error: 'Private calendar scope only allows assigning items to your own account' });
    }

    const assignedUserId = req.user.id;

    const taskType = parseTaskType(req.body.task_type || req.body.taskType || existingTask.task_type);
    const itemKind = parseTaskItemKind(req.body.item_kind || req.body.itemKind, existingTask.item_kind);
    const recurrenceType =
      req.body.recurrence_type !== undefined || req.body.recurrenceType !== undefined
        ? parseRecurrenceType(req.body.recurrence_type || req.body.recurrenceType, existingTask.recurrence_type)
        : existingTask.recurrence_type;
    const recurrenceInterval =
      req.body.recurrence_interval !== undefined || req.body.recurrenceInterval !== undefined
        ? parseRecurrenceInterval(req.body.recurrence_interval || req.body.recurrenceInterval, existingTask.recurrence_interval)
        : existingTask.recurrence_interval;
    const recurrenceUntil =
      req.body.recurrence_until !== undefined || req.body.recurrenceUntil !== undefined
        ? parseOptionalDateTime(req.body.recurrence_until || req.body.recurrenceUntil)
        : existingTask.recurrence_until;
    const status = parseTaskStatus(req.body.status, existingTask.status);
    const title =
      clampText(cleanString(req.body.title), 255) ||
      existingTask.title;
    const description =
      req.body.description !== undefined ? cleanString(req.body.description) : existingTask.description;
    const dueAt =
      req.body.due_at !== undefined || req.body.dueAt !== undefined
        ? parseOptionalDateTime(req.body.due_at || req.body.dueAt)
        : existingTask.due_at;
    const remindAt =
      req.body.remind_at !== undefined || req.body.remindAt !== undefined
        ? parseOptionalDateTime(req.body.remind_at || req.body.remindAt)
        : existingTask.remind_at;

    if (!dueAt) {
      return res.status(400).json({ error: 'due_at must be a valid date/time' });
    }

    const completedAt = status === 'completed' ? normalizeDateSql(new Date()) : null;

    await connection.beginTransaction();
    transactionStarted = true;

    const [result] = await connection.query<ResultSetHeader>(
      `UPDATE crm_lead_tasks
       SET assigned_user_id = ?,
           title = ?,
           item_kind = ?,
           task_type = ?,
           status = ?,
           description = ?,
           due_at = ?,
           remind_at = ?,
           recurrence_type = ?,
           recurrence_interval = ?,
           recurrence_until = ?,
           completed_at = ?
       WHERE id = ?`,
      [
        assignedUserId,
        title,
        itemKind,
        taskType,
        status,
        description,
        dueAt,
        remindAt,
        recurrenceType,
        recurrenceInterval,
        recurrenceUntil,
        completedAt,
        taskId
      ]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Task not found' });
    }

    const becameCompleted = existingTask.status !== 'completed' && status === 'completed';
    if (becameCompleted && recurrenceType !== 'none') {
      const nextDueAt = addRecurrence(dueAt, recurrenceType, recurrenceInterval);
      const recurrenceUntilDate = recurrenceUntil ? new Date(recurrenceUntil) : null;
      const nextDueDate = new Date(nextDueAt);
      const canCreateNext =
        !Number.isNaN(nextDueDate.getTime()) &&
        (!recurrenceUntilDate || Number.isNaN(recurrenceUntilDate.getTime()) || nextDueDate <= recurrenceUntilDate);

      if (canCreateNext) {
        let nextRemindAt: string | null = null;
        if (remindAt) {
          const remindDate = new Date(remindAt);
          const dueDateCurrent = new Date(dueAt);
          if (!Number.isNaN(remindDate.getTime()) && !Number.isNaN(dueDateCurrent.getTime())) {
            const deltaMs = remindDate.getTime() - dueDateCurrent.getTime();
            nextRemindAt = normalizeDateSql(new Date(nextDueDate.getTime() + deltaMs));
          }
        }

        await connection.query<ResultSetHeader>(
          `INSERT INTO crm_lead_tasks (
            lead_id, assigned_user_id, created_by_user_id, title, item_kind, task_type, status,
            description, due_at, remind_at, recurrence_type, recurrence_interval, recurrence_until, recurrence_parent_task_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`,
          [
            existingTask.lead_id,
            assignedUserId,
            req.user.id,
            title,
            itemKind,
            taskType,
            description,
            nextDueAt,
            nextRemindAt,
            recurrenceType,
            recurrenceInterval,
            recurrenceUntil,
            existingTask.recurrence_parent_task_id || existingTask.id
          ]
        );
      }
    }

    if (existingTask.lead_id) {
      await recalculateLeadScore(connection, existingTask.lead_id);
    }
    await connection.commit();
    transactionStarted = false;

    res.json({ message: 'Task updated successfully' });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error('Error updating CRM task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  } finally {
    connection.release();
  }
});

// DELETE /api/crm/tasks/:taskId - remove task
router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const taskId = parseInt(String(req.params.taskId), 10);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const [taskRows] = await connection.query<CrmLeadTaskRow[]>(
      'SELECT * FROM crm_lead_tasks WHERE id = ? LIMIT 1',
      [taskId]
    );
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const existingTask = taskRows[0];
    const canDeleteTask = existingTask.assigned_user_id === req.user.id;
    if (!canDeleteTask) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await connection.beginTransaction();
    transactionStarted = true;

    await connection.query<ResultSetHeader>('DELETE FROM crm_lead_tasks WHERE id = ?', [taskId]);
    if (existingTask.lead_id) {
      await recalculateLeadScore(connection, existingTask.lead_id);
    }
    await connection.commit();
    transactionStarted = false;

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error('Error deleting CRM task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  } finally {
    connection.release();
  }
});

// POST /api/crm/import/preview - preview headers and mapping for CSV/XLSX
router.post('/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const importedBy = cleanString(req.body.imported_by || req.body.importedBy || req.body.lead_owner || req.body.leadOwner) || 'system';
    const allowedOwners = await fetchAllowedLeadOwners(pool);
    const defaultOwner = validateLeadOwnerValue(cleanString(req.body.lead_owner || req.body.leadOwner), allowedOwners);
    const defaultSourceChannel = normalizeSourceChannel(cleanString(req.body.source_channel || req.body.sourceChannel));
    const defaultPipelineType = parsePipelineType(req.body.pipeline_type || req.body.pipelineType, 'cold_lead');
    const defaultRegion = cleanString(req.body.region) || 'PL';

    const { headers, rows } = parseUploadedSheet(req.file.path);
    const manualMapping = parseMappingFromRequest(req.body.mapping);
    const mapping = buildEffectiveMapping(headers, manualMapping);

    const context: ImportContext = {
      fileName: req.file.originalname,
      importedBy,
      defaultOwner,
      defaultRegion,
      defaultSourceChannel,
      defaultPipelineType
    };

    const previewRows = rows.slice(1, 11).map((row, index) => {
      const payload = buildPayloadFromRow(row, mapping, context, index + 2);

      if (payload) {
        payload.lead_owner = validateLeadOwnerValue(payload.lead_owner, allowedOwners);
      }

      return {
        row_number: index + 2,
        raw: row,
        parsed: payload
          ? {
              company_name: payload.company_name,
              email: payload.email,
              phone: payload.phone,
              has_contact: Boolean(payload.email || payload.phone),
              lead_owner: payload.lead_owner,
              source_channel: payload.source_channel,
              status: payload.status,
              country_code: payload.country_code,
              region: payload.region,
              pipeline_type: payload.pipeline_type
            }
          : null
      };
    });

    res.json({
      file_name: req.file.originalname,
      total_rows: Math.max(rows.length - 1, 0),
      headers,
      mapping,
      mapping_headers: mappingToHeaderNames(headers, mapping),
      preview_rows: previewRows
    });
  } catch (error) {
    const leadOwnerError = error as { code?: string };
    if (leadOwnerError.code === 'INVALID_LEAD_OWNER') {
      return res.status(400).json({ error: 'Lead owner must be selected from active account managers (max 2)' });
    }
    console.error('Error previewing CRM import:', error);
    res.status(500).json({
      error: 'Failed to preview import file',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // no-op
      }
    }
  }
});

// POST /api/crm/import - import CSV/XLSX leads with dedupe
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  const connection = await pool.getConnection();

  let jobId: number | null = null;
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const dryRun = String(req.body.dry_run || 'false').toLowerCase() === 'true';
    const importedBy = cleanString(
      req.body.imported_by || req.body.importedBy || req.body.lead_owner || req.body.leadOwner || req.user.full_name
    ) || 'system';
    const canManageAll = canManageCrmGlobally(req.user);
    const allowedOwners = await fetchAllowedLeadOwners(connection);
    const defaultOwner = validateLeadOwnerValue(cleanString(req.body.lead_owner || req.body.leadOwner), allowedOwners);
    const defaultSourceChannel = normalizeSourceChannel(cleanString(req.body.source_channel || req.body.sourceChannel));
    const defaultPipelineType = parsePipelineType(req.body.pipeline_type || req.body.pipelineType, 'cold_lead');
    const defaultRegion = cleanString(req.body.region) || 'PL';

    const [jobResult] = await connection.query<ResultSetHeader>(
      `INSERT INTO crm_import_jobs (file_name, source_region, pipeline_type_default, imported_by, status)
       VALUES (?, ?, ?, ?, 'processing')`,
      [req.file.originalname, defaultRegion, defaultPipelineType, importedBy]
    );
    jobId = jobResult.insertId;

    const { headers, rows } = parseUploadedSheet(req.file.path);
    const manualMapping = parseMappingFromRequest(req.body.mapping);
    const mapping = buildEffectiveMapping(headers, manualMapping);
    const context: ImportContext = {
      fileName: req.file.originalname,
      importedBy,
      defaultOwner,
      defaultRegion,
      defaultSourceChannel,
      defaultPipelineType
    };

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    if (!dryRun) {
      await connection.beginTransaction();
    }

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      try {
        const payload = buildPayloadFromRow(row, mapping, context, rowIndex + 1);
        if (!payload) {
          skippedCount += 1;
          if (jobId) {
            await insertImportRow(connection, jobId, rowIndex + 1, 'skipped', 'Empty row', null, row);
          }
          continue;
        }

        payload.lead_owner = validateLeadOwnerValue(payload.lead_owner, allowedOwners);

        if (!payload.email && !payload.phone) {
          skippedCount += 1;
          if (jobId) {
            await insertImportRow(
              connection,
              jobId,
              rowIndex + 1,
              'skipped',
              'Missing contact info: email or phone required',
              null,
              row
            );
          }
          continue;
        }

        const existing = await findExistingLead(connection, payload);

        if (existing) {
          if (!canManageAll) {
            const hasAccess = await canUserAccessLead(connection, req.user, existing.id);
            if (!hasAccess) {
              skippedCount += 1;
              if (jobId) {
                await insertImportRow(
                  connection,
                  jobId,
                  rowIndex + 1,
                  'skipped',
                  'Duplicate exists in another owner scope; row skipped',
                  existing.id,
                  row
                );
              }
              continue;
            }
          }

          if (!dryRun) {
            const mergedPayload = mergeIncomingWithExisting(existing, payload);
            await updateLead(connection, existing.id, mergedPayload);
            if (payload.notes) {
              await insertActivity(connection, existing.id, 'import', payload.notes, context.importedBy);
            }
            await recalculateLeadScore(connection, existing.id);
          }

          updatedCount += 1;
          if (jobId) {
            await insertImportRow(connection, jobId, rowIndex + 1, 'updated', 'Matched and updated existing lead', existing.id, row);
          }
        } else {
          let leadIdForLog: number | null = null;
          if (!dryRun) {
            const insertedLeadId = await insertLead(connection, payload);
            leadIdForLog = insertedLeadId;
            if (payload.notes) {
              await insertActivity(connection, insertedLeadId, 'import', payload.notes, context.importedBy);
            }
            await recalculateLeadScore(connection, insertedLeadId);
          }

          createdCount += 1;
          if (jobId) {
            await insertImportRow(connection, jobId, rowIndex + 1, 'created', dryRun ? 'Would create new lead (dry run)' : 'Created new lead', leadIdForLog, row);
          }
        }
      } catch (rowError: unknown) {
        errorCount += 1;
        if (jobId) {
          const message = rowError instanceof Error ? rowError.message : 'Unknown row error';
          await insertImportRow(connection, jobId, rowIndex + 1, 'error', message, null, row);
        }
      }
    }

    if (!dryRun) {
      await connection.commit();
    }

    const totalRows = Math.max(rows.length - 1, 0);
    await connection.query(
      `UPDATE crm_import_jobs
       SET total_rows = ?, created_count = ?, updated_count = ?, skipped_count = ?, error_count = ?, status = 'completed', finished_at = NOW()
       WHERE id = ?`,
      [totalRows, createdCount, updatedCount, skippedCount, errorCount, jobId]
    );

    res.status(201).json({
      message: dryRun ? 'Dry-run completed' : 'Import completed',
      dry_run: dryRun,
      job_id: jobId,
      file_name: req.file.originalname,
      total_rows: totalRows,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      errors: errorCount,
      mapping,
      mapping_headers: mappingToHeaderNames(headers, mapping)
    });
  } catch (error) {
    const leadOwnerError = error as { code?: string };

    if (jobId) {
      await connection.query(
        `UPDATE crm_import_jobs
         SET status = 'failed', error_summary = ?, finished_at = NOW()
         WHERE id = ?`,
        [error instanceof Error ? error.message : 'Import failed', jobId]
      );
    }

    try {
      await connection.rollback();
    } catch {
      // no-op
    }

    if (leadOwnerError.code === 'INVALID_LEAD_OWNER') {
      return res.status(400).json({ error: 'Lead owner must be selected from active account managers (max 2)' });
    }

    console.error('Error importing CRM leads:', error);
    res.status(500).json({
      error: 'Failed to import CRM leads',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // no-op
      }
    }

    connection.release();
  }
});

export default router;
