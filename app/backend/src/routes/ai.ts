import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../middleware/auth';
import { getRequestIp } from '../middleware/audit';
import { writeAuditLog } from '../services/auditLog';

const router = Router();

const HISTORY_LIMIT = 30;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CHAT_TIMEOUT_MS = parsePositiveInt(process.env.OPENROUTER_TIMEOUT_MS, 20_000);

const allowedActions = [
  'create_lead',
  'list_leads',
  'search_leads',
  'get_lead',
  'update_lead',
  'add_activity',
  'create_task',
  'list_tasks',
  'list_invoices',
  'get_dashboard',
  'list_products',
  'search_products',
  'list_customers',
  'search_customers',
] as const;

type AllowedAction = (typeof allowedActions)[number];

const allowedActionSet = new Set<string>(allowedActions);

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

const aiChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z.array(historyItemSchema).max(HISTORY_LIMIT).optional().default([]),
});

const modelActionSchema = z.object({
  type: z.enum(allowedActions),
  args: z.record(z.string(), z.unknown()).optional().default({}),
});

const modelResponseSchema = z.object({
  mode: z.enum(['chat', 'action']).default('chat'),
  reply: z.string().min(1).max(6000),
  action: modelActionSchema.optional(),
});

const internalApiErrorSchema = z.object({
  error: z.string().optional(),
  details: z.unknown().optional(),
});

const createLeadArgsSchema = z.object({
  company_name: z.string().min(1).max(255),
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  status: z.string().max(120).optional(),
  lead_owner: z.string().max(120).optional(),
  source_channel: z.string().max(120).optional(),
  notes: z.string().max(4000).optional(),
  pipeline_type: z.enum(['cold_lead', 'contact']).optional(),
  country_code: z.string().max(4).optional(),
  region: z.string().max(10).optional(),
});

const listLeadsArgsSchema = z.object({
  page: z.coerce.number().int().min(1).max(200).optional(),
  per_page: z.coerce.number().int().min(1).max(200).optional(),
  status: z.string().max(120).optional(),
  lead_owner: z.string().max(120).optional(),
});

const searchLeadsArgsSchema = z.object({
  search: z.string().min(1).max(255),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
});

const getLeadArgsSchema = z.object({
  lead_id: z.coerce.number().int().positive(),
});

const updateLeadArgsSchema = z.object({
  lead_id: z.coerce.number().int().positive(),
  data: z.record(z.string(), z.unknown()),
});

const addActivityArgsSchema = z.object({
  lead_id: z.coerce.number().int().positive(),
  note: z.string().min(1).max(4000),
  activity_type: z.enum(['note', 'call', 'email', 'meeting']).optional(),
  activity_at: z.string().optional(),
});

const createTaskArgsSchema = z.object({
  lead_id: z.coerce.number().int().positive().optional(),
  lead_name: z.string().max(255).optional(),
  company_name: z.string().max(255).optional(),
  name: z.string().max(255).optional(),
  due_at: z.string().min(1).optional(),
  follow_up_date: z.string().min(1).optional(),
  when: z.string().min(1).optional(),
  time: z.string().min(1).optional(),
  title: z.string().max(255).optional(),
  description: z.string().max(3000).optional(),
  task_type: z.enum(['meeting', 'call', 'email', 'follow_up', 'next_contact', 'other']).optional(),
  assigned_user_id: z.coerce.number().int().positive().optional(),
  remind_at: z.string().optional(),
});

const listTasksArgsSchema = z.object({
  assigned_user_id: z.coerce.number().int().positive().optional(),
  lead_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['planned', 'completed', 'cancelled']).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

const listInvoicesArgsSchema = z.object({
  page: z.coerce.number().int().min(1).max(200).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().max(255).optional(),
});

const listProductsArgsSchema = z.object({
  missing_price: z.coerce.boolean().optional(),
});

const searchProductsArgsSchema = z.object({
  search: z.string().min(1).max(255),
});

const searchCustomersArgsSchema = z.object({
  search: z.string().min(1).max(255),
});

interface AiActionResult {
  type: AllowedAction | 'blocked';
  success: boolean;
  reason?: string;
  data?: unknown;
  navigate?: string;
}

type ToolCallResult = {
  reply: string;
  action: AiActionResult;
};

class InternalApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

class InputValidationError extends Error {}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function getOpenRouterModelCandidates(): string[] {
  const modelListFromEnv = (process.env.OPENROUTER_MODELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (modelListFromEnv.length > 0) {
    return Array.from(new Set(modelListFromEnv));
  }

  const primary = process.env.OPENROUTER_MODEL?.trim() || 'google/gemma-2-9b-it:free';
  const fallback = process.env.OPENROUTER_FALLBACK_MODEL?.trim();
  const candidates = [primary];
  if (fallback) {
    candidates.push(fallback);
  }

  return Array.from(new Set(candidates));
}

function getInternalApiBaseUrl(): string {
  const configured = process.env.AI_INTERNAL_API_BASE_URL;
  if (configured && configured.trim()) {
    return configured.replace(/\/+$/, '');
  }
  const port = process.env.PORT || '3001';
  return `http://127.0.0.1:${port}/api`;
}

function systemPromptForUser(user: AuthUser): string {
  return [
    'Jestes asystentem AI wewnetrznej platformy CRM i operacji.',
    'Rozumiesz polecenia po polsku i po angielsku.',
    'Zawsze odpowiadaj w tym samym jezyku co ostatnia wiadomosc uzytkownika.',
    '',
    'ZASADY BEZPIECZENSTWA (NIE WOLNO LAMAC):',
    '- Nie wykonuj zadnych operacji usuwania.',
    '- Nie proponuj obejsc uprawnien i nie modyfikuj danych poza zakresem uzytkownika.',
    '- Jesli prosba dotyczy usuwania lub niedozwolonej modyfikacji: zwroc zwykla odpowiedz (mode=chat) i grzecznie odmow.',
    '',
    'DOSTEPNE AKCJE (tylko te):',
    '- create_lead',
    '- list_leads',
    '- search_leads',
    '- get_lead',
    '- update_lead',
    '- add_activity',
    '- create_task',
    '- list_tasks',
    '- list_invoices',
    '- get_dashboard',
    '- list_products',
    '- search_products',
    '- list_customers',
    '- search_customers',
    '',
    `KONTEKST UZYTKOWNIKA: id=${user.id}, rola=${user.role}, name=${user.full_name}`,
    '',
    'FORMAT ODPOWIEDZI: zawsze zwracaj poprawny JSON (bez markdown, bez ```).',
    'Zwracaj dokladnie JEDEN obiekt JSON, bez dodatkowego tekstu i bez drugiego JSON-a.',
    'Dozwolone ksztalty:',
    '{"mode":"chat","reply":"..."}',
    '{"mode":"action","reply":"...","action":{"type":"create_lead","args":{...}}}',
    '',
    'Wazne pola argumentow:',
    '- create_lead: company_name (wymagane), email lub phone (co najmniej jedno), opcjonalnie notes, status, follow_up_date',
    '- create_task: lead_id LUB company_name/lead_name, oraz due_at (wymagane)',
    '- due_at/remainder daty podawaj jako YYYY-MM-DD HH:mm:ss jesli to mozliwe',
    '',
    'Nigdy nie zwracaj akcji spoza listy.',
  ].join('\n');
}

function extractTextFromModelMessage(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (item && typeof item === 'object' && 'text' in item && typeof (item as { text?: unknown }).text === 'string') {
          return (item as { text: string }).text;
        }
        return '';
      })
      .join('\n')
      .trim();
    return text;
  }

  return '';
}

function extractFirstJsonObject(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    const fenced = fenceMatch[1].trim();
    if (fenced.startsWith('{') && fenced.endsWith('}')) {
      return fenced;
    }
  }

  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return trimmed.slice(start, i + 1);
      }
      if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }

  return null;
}

function extractBalancedJsonObjects(input: string, maxObjects = 4): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === '\\') {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth > 0) {
        depth -= 1;
      }
      if (depth === 0 && start >= 0) {
        results.push(input.slice(start, i + 1));
        start = -1;
        if (results.length >= maxObjects) {
          return results;
        }
      }
    }
  }

  return results;
}

function tryParseModelResponseCandidate(candidate: string): z.infer<typeof modelResponseSchema> | null {
  try {
    const parsed = JSON.parse(candidate);
    return modelResponseSchema.parse(parsed);
  } catch {
    return null;
  }
}

function parseModelResponseText(rawText: string): z.infer<typeof modelResponseSchema> | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const direct = tryParseModelResponseCandidate(trimmed);
  if (direct) return direct;

  const candidates = new Set<string>();
  const firstObject = extractFirstJsonObject(trimmed);
  if (firstObject) {
    candidates.add(firstObject);
  }

  const fencedBlocks = trimmed.match(/```json\s*([\s\S]*?)```/gi) || [];
  for (const block of fencedBlocks) {
    const content = block.replace(/```json/i, '').replace(/```/g, '').trim();
    if (content) {
      candidates.add(content);
    }
  }

  for (const objectText of extractBalancedJsonObjects(trimmed)) {
    candidates.add(objectText);
  }

  for (const candidate of candidates) {
    const parsed = tryParseModelResponseCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function pickFirstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function mapLeadStatus(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;

  switch (normalized) {
    case 'interested':
    case 'zainteresowany':
      return 'Zainteresowany';
    case 'hot':
    case 'hot lead':
    case 'goracy':
    case 'goracy lead':
      return 'Goracy lead';
    case 'cold':
    case 'zimny':
    case 'new':
      return 'Zimny lead';
    default:
      return input;
  }
}

interface NormalizedCreateLeadActionArgs {
  payload: z.infer<typeof createLeadArgsSchema>;
  followUpAt?: string;
  followUpTitle?: string;
  followUpTaskType?: 'meeting' | 'call' | 'email' | 'follow_up' | 'next_contact' | 'other';
  hotRank?: number;
}

function normalizeCreateLeadActionArgs(rawArgs: Record<string, unknown>): NormalizedCreateLeadActionArgs {
  const customFields =
    rawArgs.custom_fields && typeof rawArgs.custom_fields === 'object'
      ? (rawArgs.custom_fields as Record<string, unknown>)
      : null;

  const companyName = pickFirstString(
    rawArgs.company_name,
    rawArgs.companyName,
    rawArgs.name,
    rawArgs.company,
    rawArgs.firma
  );

  const email = pickFirstString(rawArgs.email, rawArgs.mail);
  const phone = pickFirstString(rawArgs.phone, rawArgs.telephone, rawArgs.tel, rawArgs.nr_tel, rawArgs.phone_number);

  const interestedIn = pickFirstString(
    customFields?.interested_in,
    customFields?.interest,
    rawArgs.interested_in,
    rawArgs.interest
  );

  const baseNotes = pickFirstString(rawArgs.notes, rawArgs.note, rawArgs.description);
  const notes = interestedIn
    ? [baseNotes, `Produkt zainteresowania: ${interestedIn}`].filter(Boolean).join('. ')
    : baseNotes;

  const status = mapLeadStatus(
    pickFirstString(rawArgs.status, rawArgs.lead_status, rawArgs.stage)
  );

  const pipelineTypeRaw = pickFirstString(rawArgs.pipeline_type, rawArgs.pipelineType);
  const pipelineType = pipelineTypeRaw === 'contact' || pipelineTypeRaw === 'cold_lead'
    ? pipelineTypeRaw
    : undefined;

  const normalizedPayload = createLeadArgsSchema.parse({
    company_name: companyName,
    first_name: pickFirstString(rawArgs.first_name, rawArgs.firstName),
    last_name: pickFirstString(rawArgs.last_name, rawArgs.lastName),
    email,
    phone,
    status,
    lead_owner: pickFirstString(rawArgs.lead_owner, rawArgs.leadOwner, rawArgs.owner),
    source_channel: pickFirstString(rawArgs.source_channel, rawArgs.sourceChannel),
    notes,
    pipeline_type: pipelineType,
    country_code: pickFirstString(rawArgs.country_code, rawArgs.countryCode),
    region: pickFirstString(rawArgs.region),
  });

  const followUpTaskTypeRaw = pickFirstString(rawArgs.follow_up_task_type, rawArgs.followUpTaskType)?.toLowerCase();
  const followUpTaskType =
    followUpTaskTypeRaw && ['meeting', 'call', 'email', 'follow_up', 'next_contact', 'other'].includes(followUpTaskTypeRaw)
      ? (followUpTaskTypeRaw as 'meeting' | 'call' | 'email' | 'follow_up' | 'next_contact' | 'other')
      : 'follow_up';

  const hotRank = pickFirstNumber(rawArgs.hot_rank, rawArgs.hotRank);

  return {
    payload: normalizedPayload,
    followUpAt: pickFirstString(
      rawArgs.follow_up_date,
      rawArgs.follow_up_at,
      rawArgs.followUpDate,
      rawArgs.followUpAt
    ),
    followUpTitle: pickFirstString(rawArgs.follow_up_title, rawArgs.followUpTitle) || 'Follow up',
    followUpTaskType,
    hotRank:
      hotRank && Number.isInteger(hotRank) && hotRank >= 1 && hotRank <= 10
        ? hotRank
        : undefined,
  };
}

function extractCreatedLeadId(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const raw = (data as { id?: unknown }).id;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toSqlDateTime(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function parseTimeHint(input: string): { hour: number; minute: number } | null {
  const withMinutes = input.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (withMinutes) {
    return {
      hour: Number(withMinutes[1]),
      minute: Number(withMinutes[2]),
    };
  }

  const hourOnly = input.match(/\b(?:o|at)?\s*([01]?\d|2[0-3])\b/i);
  if (hourOnly) {
    return {
      hour: Number(hourOnly[1]),
      minute: 0,
    };
  }

  return null;
}

const MONTH_NAMES: Record<string, number> = {
  january: 0, jan: 0, stycznia: 0, styczen: 0, styczeń: 0,
  february: 1, feb: 1, lutego: 1, luty: 1, lutym: 1,
  march: 2, mar: 2, marca: 2, marzec: 2,
  april: 3, apr: 3, kwietnia: 3, kwiecien: 3, kwiecień: 3,
  may: 4, maja: 4, maj: 4,
  june: 5, jun: 5, czerwca: 5, czerwiec: 5,
  july: 6, jul: 6, lipca: 6, lipiec: 6,
  august: 7, aug: 7, sierpnia: 7, sierpien: 7, sierpień: 7,
  september: 8, sep: 8, sept: 8, wrzesnia: 8, września: 8, wrzesien: 8, wrzesień: 8,
  october: 9, oct: 9, pazdziernika: 9, października: 9, pazdziernik: 9, październik: 9,
  november: 10, nov: 10, listopada: 10, listopad: 10,
  december: 11, dec: 11, grudnia: 11, grudzien: 11, grudzień: 11,
};

function parseDateFromNaturalText(input: string): { day: number; month: number; year?: number } | null {
  const lowered = input.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim();

  // Match "24th of february", "24 feb", "february 24", "24. februar" etc.
  const ordinalStripped = lowered.replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1');

  // Day + month name: "24 feb", "24 of february", "24th february"
  const dayMonthMatch = ordinalStripped.match(/\b(\d{1,2})\s+(?:of\s+)?([a-zżźćńółśąę]+)(?:\s+(\d{4}))?\b/);
  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1]);
    const monthKey = dayMonthMatch[2].toLowerCase();
    const year = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : undefined;
    const month = MONTH_NAMES[monthKey];
    if (month !== undefined && day >= 1 && day <= 31) {
      return { day, month, year };
    }
  }

  // Month name + day: "february 24", "feb 24th"
  const monthDayMatch = ordinalStripped.match(/\b([a-zżźćńółśąę]+)\s+(\d{1,2})(?:\s+(\d{4}))?\b/);
  if (monthDayMatch) {
    const monthKey = monthDayMatch[1].toLowerCase();
    const day = Number(monthDayMatch[2]);
    const year = monthDayMatch[3] ? Number(monthDayMatch[3]) : undefined;
    const month = MONTH_NAMES[monthKey];
    if (month !== undefined && day >= 1 && day <= 31) {
      return { day, month, year };
    }
  }

  // Numeric date: "24/02", "24.02", "24-02" (day/month)
  const numericMatch = ordinalStripped.match(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]) - 1;
    const year = numericMatch[3] ? Number(numericMatch[3]) : undefined;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      return { day, month, year };
    }
  }

  return null;
}

function parseFlexibleDateTime(input: string, timeHint?: string): string | null {
  const cleaned = input.trim();
  if (!cleaned) return null;

  // Try direct ISO parse first
  const direct = new Date(cleaned);
  if (!Number.isNaN(direct.getTime())) {
    return toSqlDateTime(direct);
  }

  const lowered = cleaned.toLowerCase();
  const time = parseTimeHint(cleaned) || (timeHint ? parseTimeHint(timeHint) : null) || { hour: 9, minute: 0 };
  const now = new Date();

  // Relative keywords
  let dayOffset: number | null = null;
  if (lowered.includes('pojutrze')) {
    dayOffset = 2;
  } else if (lowered.includes('jutro') || lowered.includes('tomorrow')) {
    dayOffset = 1;
  } else if (lowered.includes('dzis') || lowered.includes('today')) {
    dayOffset = 0;
  }

  if (dayOffset !== null) {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, time.hour, time.minute, 0, 0);
    return toSqlDateTime(target);
  }

  // Natural language date (e.g. "24th of feb", "24 lutego", "march 5")
  const parsed = parseDateFromNaturalText(cleaned);
  if (parsed) {
    let year = parsed.year ?? now.getFullYear();
    // If the two-digit year was given, expand it
    if (year < 100) year += 2000;
    // If the date is in the past (earlier this year), assume next year
    const candidate = new Date(year, parsed.month, parsed.day, time.hour, time.minute, 0, 0);
    if (!parsed.year && candidate < now) {
      candidate.setFullYear(now.getFullYear() + 1);
    }
    return toSqlDateTime(candidate);
  }

  return null;
}

interface NormalizedCreateTaskActionArgs {
  leadId: number;
  dueAt: string;
  title?: string;
  description?: string;
  taskType?: 'meeting' | 'call' | 'email' | 'follow_up' | 'next_contact' | 'other';
  assignedUserId?: number;
  remindAt?: string;
}

interface LeadListRow {
  id: number;
  company_name: string;
  lead_owner?: string | null;
}

function extractLeadSearchQuery(rawArgs: z.infer<typeof createTaskArgsSchema>): string | undefined {
  return pickFirstString(rawArgs.company_name, rawArgs.lead_name, rawArgs.name);
}

async function resolveLeadIdFromQuery(req: Request, token: string, query: string): Promise<number> {
  const rows = await fetchLeadsBySearch(req, token, query);

  if (rows.length === 0) {
    throw new InputValidationError(`Nie znalazlem leada dla frazy: ${query}`);
  }

  const target = query.trim().toLowerCase();
  const exact = rows.find((row) => String(row.company_name || '').trim().toLowerCase() === target);
  const chosen = exact || rows[0];
  const leadId = Number(chosen.id);
  if (!Number.isInteger(leadId) || leadId <= 0) {
    throw new InputValidationError('Nie udalo sie ustalic poprawnego lead_id dla zadania');
  }

  return leadId;
}

async function fetchLeadsBySearch(req: Request, token: string, query: string): Promise<LeadListRow[]> {
  const data = await callInternalApi(req, token, 'GET', '/crm/leads', {
    query: {
      search: query,
      per_page: 25,
      page: 1,
    },
  });

  const rows =
    data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)
      ? ((data as { data: unknown[] }).data as Array<Record<string, unknown>>)
      : [];

  return rows
    .map((row) => ({
      id: Number(row.id),
      company_name: String(row.company_name || ''),
      lead_owner: row.lead_owner ? String(row.lead_owner) : null,
    }))
    .filter((row) => Number.isInteger(row.id) && row.id > 0 && row.company_name.trim().length > 0);
}

function cleanIntentToken(value: string): string {
  return value.trim().replace(/^['"`]|['"`]$/g, '').trim();
}

function parseOwnerChangeIntent(message: string): { leadQuery: string; newOwner: string } | null {
  const normalized = message.trim();
  if (!normalized) return null;

  const english = normalized.match(/(?:change|set|update)\s+(?:the\s+)?lead\s+owner\s+(?:for|of)\s+(.+?)\s+(?:to)\s+(.+)$/i);
  if (english) {
    const leadQuery = cleanIntentToken(english[1]);
    const newOwner = cleanIntentToken(english[2]);
    if (leadQuery && newOwner) return { leadQuery, newOwner };
  }

  const polish = normalized.match(/(?:zmien|zmień|ustaw)\s+(?:opiekuna|wlasciciela|właściciela)\s+(?:leada\s+)?(?:dla\s+)?(.+?)\s+(?:na)\s+(.+)$/i);
  if (polish) {
    const leadQuery = cleanIntentToken(polish[1]);
    const newOwner = cleanIntentToken(polish[2]);
    if (leadQuery && newOwner) return { leadQuery, newOwner };
  }

  return null;
}

function parseCalendarCallIntent(message: string): { leadQuery: string; dueHint: string } | null {
  const normalized = message.trim();
  if (!normalized) return null;

  const hasCalendarWord = /(kalendarz|kalendarza|calendar|zadanie|task)/i.test(normalized);
  const hasCallWord = /(zadzwonic|zadzwonić|zadzwon|telefon|call|adzwoni)/i.test(normalized);
  if (!hasCalendarWord && !hasCallWord) {
    return null;
  }

  // Stop-words: date words, prepositions, digits — anything after these is NOT part of the name
  const NAME_STOP = /\s+(?:\d|jutro|dzis|dzisiaj|tomorrow|today|o\s+\d|na\s+|w\s+\d|po\s+|ze?\s+|ze\b|i\b|oraz\b|aby\b|żeby\b|\d{1,2}\s*(?:st|nd|rd|th|[\/.\-]))/i;

  function extractName(raw: string): string {
    // Cut off at stop-word pattern
    const cut = raw.replace(NAME_STOP, '||').split('||')[0];
    return cleanIntentToken(cut);
  }

  // Polish: find "do <name>" that comes AFTER a call verb
  const afterCallVerb = normalized.match(/(?:zadzwoni[ćc]|zadzwon|call|telefon(?:owa[ćc])?)\s+do\s+([\w\s\-]+?)(?=\s+\d|\s+jutro|\s+dzis|\s+o\s|\s+ze\b|,|$)/i);
  if (afterCallVerb) {
    const leadQuery = extractName(afterCallVerb[1]);
    if (leadQuery) return { leadQuery, dueHint: normalized };
  }

  // Polish: last "do <CapitalisedName>" in sentence
  const allDoMatches = [...normalized.matchAll(/\bdo\s+([A-ZŻŹĆŃÓŁŚĄĘ][a-zżźćńółśąę]+(?:\s+[A-ZŻŹĆŃÓŁŚĄĘ][a-zżźćńółśąę]+)?)/g)];
  if (allDoMatches.length > 0) {
    const leadQuery = extractName(allDoMatches[allDoMatches.length - 1][1]);
    if (leadQuery) return { leadQuery, dueHint: normalized };
  }

  // English: "call <name>"
  const englishLead = normalized.match(/call\s+(.+?)(?:\s+at\s+|\s+tomorrow|\s+today|\s+on\s+|$)/i);
  if (englishLead) {
    const leadQuery = extractName(englishLead[1]);
    if (leadQuery) return { leadQuery, dueHint: normalized };
  }

  return null;
}

function isHighestInvoiceIntent(message: string): boolean {
  const normalized = message.toLowerCase();
  const mentionsInvoice = /(faktur|invoice)/.test(normalized);
  const mentionsHighest = /(highest|biggest|largest|most|greatest|najwy|najwieks|największ|top|max|wielk|największ|największa|najwyzs)/.test(normalized);
  const mentionsIncome = /(income|revenue|przychod|przychód|zysk|profit)/.test(normalized);
  const followUpLike = /(ktora|która|which one|which|ktory|który)/.test(normalized);
  return (mentionsInvoice && (mentionsHighest || mentionsIncome)) || (followUpLike && mentionsHighest && mentionsIncome);
}

function parseLeadStatusChangeIntent(message: string): { leadQuery: string; statusText: string } | null {
  const normalized = message.trim();
  if (!normalized) return null;

  const english = normalized.match(
    /(?:change|set|update)\s+(?:my\s+)?lead\s+(.+?)\s+(?:to|as)\s+(.+)$/i
  );
  if (english) {
    const leadQuery = cleanIntentToken(english[1]);
    const statusText = cleanIntentToken(english[2]);
    if (leadQuery && statusText) return { leadQuery, statusText };
  }

  const polish = normalized.match(
    /(?:zmien|zmień|ustaw)\s+(?:status\s+)?(?:leada|lead)\s+(?:dla\s+)?(.+?)\s+(?:na)\s+(.+)$/i
  );
  if (polish) {
    const leadQuery = cleanIntentToken(polish[1]);
    const statusText = cleanIntentToken(polish[2]);
    if (leadQuery && statusText) return { leadQuery, statusText };
  }

  return null;
}

async function handleOwnerChangeIntent(req: Request, token: string, message: string): Promise<ToolCallResult | null> {
  const parsed = parseOwnerChangeIntent(message);
  if (!parsed) return null;

  const leads = await fetchLeadsBySearch(req, token, parsed.leadQuery);
  if (leads.length === 0) {
    throw new InputValidationError(`Nie znalazlem leada: ${parsed.leadQuery}`);
  }

  const target = parsed.leadQuery.trim().toLowerCase();
  const lead = leads.find((row) => row.company_name.trim().toLowerCase() === target) || leads[0];
  await callInternalApi(req, token, 'PUT', `/crm/leads/${lead.id}`, {
    body: {
      lead_owner: parsed.newOwner,
    },
  });

  return {
    reply: `Zmienilem opiekuna leada ${lead.company_name} na ${parsed.newOwner}.`,
    action: {
      type: 'update_lead',
      success: true,
      data: {
        lead_id: lead.id,
        lead_company_name: lead.company_name,
        lead_owner: parsed.newOwner,
      },
      navigate: '/crm',
    },
  };
}

async function handleCalendarCallIntent(req: Request, token: string, message: string): Promise<ToolCallResult | null> {
  const parsed = parseCalendarCallIntent(message);
  if (!parsed) return null;

  return executeAllowedAction(req, token, 'create_task', {
    lead_name: parsed.leadQuery,
    due_at: parsed.dueHint,
    task_type: 'call',
    title: `Call ${parsed.leadQuery}`,
  });
}

async function handleLeadStatusChangeIntent(req: Request, token: string, message: string): Promise<ToolCallResult | null> {
  const parsed = parseLeadStatusChangeIntent(message);
  if (!parsed) return null;

  const leads = await fetchLeadsBySearch(req, token, parsed.leadQuery);
  if (leads.length === 0) {
    throw new InputValidationError(`Nie znalazlem leada: ${parsed.leadQuery}`);
  }

  const target = parsed.leadQuery.trim().toLowerCase();
  const lead = leads.find((row) => row.company_name.trim().toLowerCase() === target) || leads[0];

  await callInternalApi(req, token, 'PUT', `/crm/leads/${lead.id}`, {
    body: {
      status: parsed.statusText,
    },
  });

  return {
    reply: `Zmienilem status leada ${lead.company_name} na ${parsed.statusText}.`,
    action: {
      type: 'update_lead',
      success: true,
      data: {
        lead_id: lead.id,
        lead_company_name: lead.company_name,
        status: parsed.statusText,
      },
      navigate: '/crm',
    },
  };
}

async function fetchAllInvoiceRows(req: Request, token: string): Promise<Array<Record<string, unknown>>> {
  const PAGE_SIZE = 200;
  const allRows: Array<Record<string, unknown>> = [];
  let page = 1;

  while (true) {
    const data = await callInternalApi(req, token, 'GET', '/invoices', {
      query: { page, per_page: PAGE_SIZE },
    });

    const pageRows =
      data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)
        ? ((data as { data: unknown[] }).data as Array<Record<string, unknown>>)
        : [];

    allRows.push(...pageRows);

    const total =
      data && typeof data === 'object' && typeof (data as { total?: unknown }).total === 'number'
        ? (data as { total: number }).total
        : null;

    if (pageRows.length < PAGE_SIZE || (total !== null && allRows.length >= total)) {
      break;
    }

    page += 1;
    if (page > 50) break; // safety cap
  }

  return allRows;
}

async function handleHighestInvoiceIntent(req: Request, token: string, message: string): Promise<ToolCallResult | null> {
  if (!isHighestInvoiceIntent(message)) return null;

  const rows = await fetchAllInvoiceRows(req, token);

  if (rows.length === 0) {
    return {
      reply: 'Nie znalazlem faktur do analizy.',
      action: {
        type: 'list_invoices',
        success: true,
        data: null,
        navigate: '/invoices',
      },
    };
  }

  const compareByProfit = /(zysk|profit)/i.test(message);
  const metricKey = compareByProfit ? 'zysk' : 'netto';
  const metricLabel = compareByProfit ? 'zysk' : 'przychod netto';

  const ranked = rows
    .map((row) => ({
      id: Number(row.id),
      numer_faktury: String(row.numer_faktury || ''),
      customer_nazwa: String(row.customer_nazwa || ''),
      netto: Number(row.netto || 0),
      brutto: Number(row.brutto || 0),
      zysk: Number(row.zysk || 0),
    }))
    .filter((row) => Number.isInteger(row.id) && row.id > 0);

  if (ranked.length === 0) {
    throw new InputValidationError('Brak poprawnych danych faktur do analizy');
  }

  const top = ranked.reduce((best, current) => {
    const bestValue = metricKey === 'zysk' ? best.zysk : best.netto;
    const currentValue = metricKey === 'zysk' ? current.zysk : current.netto;
    return currentValue > bestValue ? current : best;
  }, ranked[0]);

  const topValue = metricKey === 'zysk' ? top.zysk : top.netto;

  return {
    reply: `Najwyzsza faktura wg ${metricLabel} (z ${ranked.length} faktur): ${top.numer_faktury} — ${top.customer_nazwa}. Wartosc netto: ${top.netto.toFixed(2)} PLN, brutto: ${top.brutto.toFixed(2)} PLN, zysk: ${top.zysk.toFixed(2)} PLN.`,
    action: {
      type: 'list_invoices',
      success: true,
      data: {
        top_invoice: top,
        metric: metricKey,
        total_scanned: ranked.length,
      },
      navigate: '/invoices',
    },
  };
}

async function tryDeterministicIntent(req: Request, token: string, message: string): Promise<ToolCallResult | null> {
  const ownerChange = await handleOwnerChangeIntent(req, token, message);
  if (ownerChange) return ownerChange;

  const statusChange = await handleLeadStatusChangeIntent(req, token, message);
  if (statusChange) return statusChange;

  const calendarCall = await handleCalendarCallIntent(req, token, message);
  if (calendarCall) return calendarCall;

  const highestInvoice = await handleHighestInvoiceIntent(req, token, message);
  if (highestInvoice) return highestInvoice;

  return null;
}

async function normalizeCreateTaskActionArgs(
  req: Request,
  token: string,
  rawArgs: Record<string, unknown>
): Promise<NormalizedCreateTaskActionArgs> {
  const parsed = createTaskArgsSchema.parse(rawArgs);

  const dueRaw = pickFirstString(parsed.due_at, parsed.follow_up_date, parsed.when);
  if (!dueRaw) {
    throw new InputValidationError('Brakuje terminu zadania (due_at)');
  }

  const dueAt = parseFlexibleDateTime(dueRaw, parsed.time);
  if (!dueAt) {
    throw new InputValidationError('Nie rozpoznalem daty/czasu. Uzyj formatu YYYY-MM-DD HH:mm:ss');
  }

  let leadId = parsed.lead_id;
  if (!leadId) {
    const leadQuery = extractLeadSearchQuery(parsed);
    if (!leadQuery) {
      throw new InputValidationError('Brakuje lead_id albo nazwy firmy (company_name/lead_name)');
    }
    leadId = await resolveLeadIdFromQuery(req, token, leadQuery);
  }

  let remindAt: string | undefined;
  if (parsed.remind_at) {
    const parsedRemindAt = parseFlexibleDateTime(parsed.remind_at);
    if (!parsedRemindAt) {
      throw new InputValidationError('Nie rozpoznalem remind_at. Uzyj formatu YYYY-MM-DD HH:mm:ss');
    }
    remindAt = parsedRemindAt;
  }

  return {
    leadId,
    dueAt,
    title: parsed.title,
    description: parsed.description,
    taskType: parsed.task_type,
    assignedUserId: parsed.assigned_user_id,
    remindAt,
  };
}

async function callOpenRouterModel(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  apiKey: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CHAT_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 700,
        messages,
      }),
      signal: controller.signal,
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      const errorText = payload?.error?.message || `OpenRouter request failed: HTTP ${response.status}`;
      throw new Error(errorText);
    }

    const content = payload.choices?.[0]?.message?.content;
    const text = extractTextFromModelMessage(content);
    if (!text) {
      throw new Error('OpenRouter returned an empty response');
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveModelOutput(
  user: AuthUser,
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<z.infer<typeof modelResponseSchema>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPromptForUser(user) },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: message },
  ];

  const modelCandidates = getOpenRouterModelCandidates();
  let lastError: Error | null = null;
  const modelErrors: string[] = [];

  for (const model of modelCandidates) {
    try {
      const rawText = await callOpenRouterModel(model, messages, apiKey);
      const parsed = parseModelResponseText(rawText);
      if (parsed) {
        return parsed;
      }

      return {
        mode: 'chat',
        reply: rawText,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown AI provider error');
      modelErrors.push(`${model}: ${lastError.message}`);
    }
  }

  if (modelErrors.length > 0) {
    throw new Error(`All configured OpenRouter models failed. ${modelErrors.join(' | ')}`);
  }

  throw lastError || new Error('Failed to get AI response');
}

function isProviderUnavailableError(message: string): boolean {
  return /no endpoints found|model.*not found|provider unavailable|service unavailable|temporarily unavailable|429|rate limit/i.test(
    message
  );
}

function readBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice('Bearer '.length);
}

function buildNavigatePath(actionType: AllowedAction): string | undefined {
  switch (actionType) {
    case 'create_lead':
    case 'list_leads':
    case 'search_leads':
    case 'get_lead':
    case 'update_lead':
    case 'add_activity':
      return '/crm';
    case 'create_task':
    case 'list_tasks':
      return '/calendar';
    case 'list_products':
    case 'search_products':
      return '/products';
    case 'list_invoices':
    case 'get_dashboard':
    case 'list_customers':
    case 'search_customers':
      return '/invoices';
    default:
      return undefined;
  }
}

async function callInternalApi(
  req: Request,
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  endpointPath: string,
  options?: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  }
): Promise<unknown> {
  const baseUrl = getInternalApiBaseUrl();
  const url = new URL(`${baseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`);

  if (options?.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, String(value));
    });
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-ai-origin': 'in-app-ai-route',
      'x-request-id': typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : 'ai-chat',
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const textPayload = await response.text();
  let payload: unknown = null;
  if (textPayload.trim()) {
    try {
      payload = JSON.parse(textPayload);
    } catch {
      payload = { raw: textPayload };
    }
  }

  if (!response.ok) {
    const parsed = internalApiErrorSchema.safeParse(payload);
    const message = parsed.success && parsed.data.error
      ? parsed.data.error
      : `Internal API error: HTTP ${response.status}`;
    throw new InternalApiError(response.status, payload, message);
  }

  return payload;
}

async function executeAllowedAction(
  req: Request,
  token: string,
  actionType: AllowedAction,
  rawArgs: Record<string, unknown>
): Promise<ToolCallResult> {
  switch (actionType) {
    case 'create_lead': {
      const args = normalizeCreateLeadActionArgs(rawArgs);
      const data = await callInternalApi(req, token, 'POST', '/crm/leads', { body: args.payload });
      const leadId = extractCreatedLeadId(data);
      const postActions: string[] = [];
      const postActionWarnings: string[] = [];

      if (leadId && args.hotRank !== undefined) {
        try {
          await callInternalApi(req, token, 'PUT', `/crm/leads/${leadId}/hot-rank`, {
            body: { hot_rank: args.hotRank },
          });
          postActions.push('hot_rank_set');
        } catch (error) {
          postActionWarnings.push(error instanceof Error ? error.message : 'hot_rank_failed');
        }
      }

      if (leadId && args.followUpAt) {
        try {
          await callInternalApi(req, token, 'POST', `/crm/leads/${leadId}/tasks`, {
            body: {
              due_at: args.followUpAt,
              title: args.followUpTitle,
              task_type: args.followUpTaskType,
            },
          });
          postActions.push('follow_up_created');
        } catch (error) {
          postActionWarnings.push(error instanceof Error ? error.message : 'follow_up_failed');
        }
      }

      const followUpText = postActions.includes('follow_up_created')
        ? ' Dodalem tez follow up.'
        : '';

      return {
        reply: `Lead zostal utworzony.${followUpText}`,
        action: {
          type: actionType,
          success: true,
          data: {
            create_lead: data,
            lead_id: leadId,
            post_actions: postActions,
            post_action_warnings: postActionWarnings,
          },
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'list_leads': {
      const args = listLeadsArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'GET', '/crm/leads', {
        query: {
          page: args.page,
          per_page: args.per_page,
          status: args.status,
          lead_owner: args.lead_owner,
        },
      });
      return {
        reply: 'Oto lista leadow.',
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'search_leads': {
      const args = searchLeadsArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'GET', '/crm/leads', {
        query: {
          search: args.search,
          per_page: args.per_page || 25,
        },
      });
      return {
        reply: `Wyniki wyszukiwania leadow dla frazy: ${args.search}`,
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'get_lead': {
      const args = getLeadArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'GET', `/crm/leads/${args.lead_id}`);
      return {
        reply: `Szczegoly leada #${args.lead_id}.`,
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'update_lead': {
      const args = updateLeadArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'PUT', `/crm/leads/${args.lead_id}`, { body: args.data });
      return {
        reply: `Lead #${args.lead_id} zostal zaktualizowany.`,
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'add_activity': {
      const args = addActivityArgsSchema.parse(rawArgs);
      const body = {
        note: args.note,
        activity_type: args.activity_type,
        activity_at: args.activity_at,
      };
      const data = await callInternalApi(req, token, 'POST', `/crm/leads/${args.lead_id}/activities`, { body });
      return {
        reply: 'Aktywnosc zostala dodana.',
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'create_task': {
      const args = await normalizeCreateTaskActionArgs(req, token, rawArgs);
      const body = {
        title: args.title,
        description: args.description,
        task_type: args.taskType,
        due_at: args.dueAt,
        remind_at: args.remindAt,
        assigned_user_id: args.assignedUserId,
      };
      const data = await callInternalApi(req, token, 'POST', `/crm/leads/${args.leadId}/tasks`, { body });
      return {
        reply: 'Zadanie zostalo utworzone.',
        action: {
          type: actionType,
          success: true,
          data: {
            create_task: data,
            lead_id: args.leadId,
            due_at: args.dueAt,
          },
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'list_tasks': {
      const args = listTasksArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'GET', '/crm/tasks', {
        query: {
          assigned_user_id: args.assigned_user_id,
          lead_id: args.lead_id,
          status: args.status,
          date_from: args.date_from,
          date_to: args.date_to,
        },
      });
      return {
        reply: 'Oto lista zadan.',
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'list_invoices': {
      const args = listInvoicesArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'GET', '/invoices', {
        query: {
          page: args.page,
          per_page: args.per_page,
          search: args.search,
        },
      });
      return {
        reply: 'Oto lista faktur.',
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'get_dashboard': {
      const data = await callInternalApi(req, token, 'GET', '/invoices/dashboard/summary');
      return {
        reply: 'Oto podsumowanie dashboardu.',
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'list_products': {
      const args = listProductsArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'GET', '/products', {
        query: {
          missing_price: args.missing_price,
        },
      });
      return {
        reply: 'Oto lista produktow.',
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'search_products': {
      const args = searchProductsArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'GET', '/products', {
        query: {
          search: args.search,
        },
      });
      return {
        reply: `Wyniki wyszukiwania produktow dla frazy: ${args.search}`,
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'list_customers': {
      const data = await callInternalApi(req, token, 'GET', '/customers');
      return {
        reply: 'Oto lista klientow.',
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    case 'search_customers': {
      const args = searchCustomersArgsSchema.parse(rawArgs);
      const data = await callInternalApi(req, token, 'GET', '/customers', {
        query: {
          search: args.search,
        },
      });
      return {
        reply: `Wyniki wyszukiwania klientow dla frazy: ${args.search}`,
        action: {
          type: actionType,
          success: true,
          data,
          navigate: buildNavigatePath(actionType),
        },
      };
    }

    default:
      return {
        reply: 'Ta akcja nie jest wspierana.',
        action: {
          type: 'blocked',
          success: false,
          reason: 'unsupported_action',
        },
      };
  }
}

function buildBlockedReply(): string {
  return 'Nie moge wykonac tej operacji. Usuwanie i zmiany poza Twoim zakresem uprawnien sa zablokowane.';
}

async function writeAiAudit(
  req: Request,
  user: AuthUser,
  eventType: string,
  statusCode: number,
  endpointSuffix?: string
): Promise<void> {
  await writeAuditLog({
    userId: user.id,
    username: user.username,
    fullName: user.full_name,
    userRole: user.role,
    eventType,
    method: req.method,
    endpoint: endpointSuffix ? `${req.originalUrl}#${endpointSuffix}` : req.originalUrl,
    statusCode,
    ipAddress: getRequestIp(req),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });
}

router.post('/chat', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = aiChatRequestSchema.parse(req.body);
    const token = readBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized - Missing bearer token' });
    }

    try {
      const deterministic = await tryDeterministicIntent(req, token, body.message);
      if (deterministic) {
        await writeAiAudit(req, req.user, 'ai_action_executed_rule', 200, deterministic.action.type);
        return res.json(deterministic);
      }
    } catch (error) {
      if (error instanceof InternalApiError) {
        if (error.status === 403) {
          await writeAiAudit(req, req.user, 'ai_action_blocked_forbidden', 403, 'deterministic');
          return res.status(403).json({
            reply: buildBlockedReply(),
            action: {
              type: 'blocked',
              success: false,
              reason: 'forbidden_or_destructive',
            },
          });
        }

        if (error.status === 404) {
          await writeAiAudit(req, req.user, 'ai_action_not_found_or_scoped', 404, 'deterministic');
          return res.status(404).json({
            reply: 'Nie znalazlem tego rekordu albo nie masz do niego dostepu.',
            action: {
              type: 'blocked',
              success: false,
              reason: 'not_found_or_forbidden',
            },
          });
        }

        await writeAiAudit(req, req.user, 'ai_action_failed', error.status, 'deterministic');
        return res.status(error.status).json({
          reply: 'Nie udalo sie wykonac akcji. Sprobuj ponownie.',
          action: {
            type: 'blocked',
            success: false,
            reason: 'execution_failed',
            data: error.payload,
          },
        });
      }

      if (error instanceof InputValidationError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.message,
        });
      }

      throw error;
    }

    const modelOutput = await resolveModelOutput(req.user, body.message, body.history);

    if (modelOutput.mode === 'chat' || !modelOutput.action) {
      return res.json({
        reply: modelOutput.reply,
        action: null,
      });
    }

    const requestedAction = modelOutput.action.type;
    const rawArgs = modelOutput.action.args || {};

    if (!allowedActionSet.has(requestedAction)) {
      await writeAiAudit(req, req.user, 'ai_action_blocked_delete', 403, requestedAction);
      return res.status(403).json({
        reply: buildBlockedReply(),
        action: {
          type: 'blocked',
          success: false,
          reason: 'forbidden_or_destructive',
        },
      });
    }

    try {
      const execution = await executeAllowedAction(req, token, requestedAction, rawArgs);
      await writeAiAudit(req, req.user, 'ai_action_executed', 200, requestedAction);
      return res.json(execution);
    } catch (error) {
      if (error instanceof InternalApiError) {
        if (error.status === 403) {
          await writeAiAudit(req, req.user, 'ai_action_blocked_forbidden', 403, requestedAction);
          return res.status(403).json({
            reply: buildBlockedReply(),
            action: {
              type: 'blocked',
              success: false,
              reason: 'forbidden_or_destructive',
            },
          });
        }

        if (error.status === 404) {
          await writeAiAudit(req, req.user, 'ai_action_not_found_or_scoped', 404, requestedAction);
          return res.status(404).json({
            reply: 'Nie znalazlem tego rekordu albo nie masz do niego dostepu.',
            action: {
              type: 'blocked',
              success: false,
              reason: 'not_found_or_forbidden',
            },
          });
        }

        await writeAiAudit(req, req.user, 'ai_action_failed', error.status, requestedAction);
        return res.status(error.status).json({
          reply: 'Nie udalo sie wykonac akcji. Sprobuj ponownie.',
          action: {
            type: requestedAction,
            success: false,
            reason: 'execution_failed',
            data: error.payload,
          },
        });
      }

      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.issues,
      });
    }

    if (error instanceof InputValidationError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.message,
      });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    if (isProviderUnavailableError(message)) {
      return res.status(503).json({
        error: 'AI provider unavailable',
        details: message,
      });
    }

    console.error('AI chat route error:', error);
    return res.status(500).json({
      error: 'AI service failed',
      details: message,
    });
  }
});

export default router;
