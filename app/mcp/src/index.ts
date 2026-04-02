import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

type ToolName =
  | 'create_lead'
  | 'list_leads'
  | 'search_leads'
  | 'get_lead'
  | 'update_lead'
  | 'add_activity'
  | 'create_task'
  | 'list_tasks'
  | 'list_invoices'
  | 'get_dashboard'
  | 'list_products'
  | 'search_products'
  | 'list_customers'
  | 'search_customers';

type ToolArgs = Record<string, unknown>;

const apiUrl = process.env.MCP_API_URL?.replace(/\/+$/, '');
const apiToken = process.env.MCP_API_TOKEN;

if (!apiUrl || !apiToken) {
  throw new Error('Missing MCP_API_URL or MCP_API_TOKEN in environment');
}

const api = axios.create({
  baseURL: apiUrl,
  timeout: 20_000,
  headers: {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  },
});

const tools = [
  {
    name: 'create_lead',
    description: 'Tworzy nowy lead w CRM. Operacja niedestrukcyjna.',
    inputSchema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Nazwa firmy (wymagane)' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        status: { type: 'string' },
        lead_owner: { type: 'string' },
        source_channel: { type: 'string' },
        notes: { type: 'string' },
        pipeline_type: { type: 'string', enum: ['cold_lead', 'contact'] },
      },
      required: ['company_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_leads',
    description: 'Pobiera liste leadow z CRM.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number' },
        per_page: { type: 'number' },
        status: { type: 'string' },
        lead_owner: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_leads',
    description: 'Wyszukuje leady po frazie.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        per_page: { type: 'number' },
      },
      required: ['search'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_lead',
    description: 'Pobiera szczegoly jednego leada.',
    inputSchema: {
      type: 'object',
      properties: {
        lead_id: { type: 'number' },
      },
      required: ['lead_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_lead',
    description: 'Aktualizuje dane leada (bez usuwania).',
    inputSchema: {
      type: 'object',
      properties: {
        lead_id: { type: 'number' },
        data: { type: 'object' },
      },
      required: ['lead_id', 'data'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_activity',
    description: 'Dodaje aktywnosc do leada.',
    inputSchema: {
      type: 'object',
      properties: {
        lead_id: { type: 'number' },
        note: { type: 'string' },
        activity_type: { type: 'string', enum: ['note', 'call', 'email', 'meeting'] },
        activity_at: { type: 'string' },
      },
      required: ['lead_id', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description: 'Tworzy zadanie powiazane z leadem.',
    inputSchema: {
      type: 'object',
      properties: {
        lead_id: { type: 'number' },
        due_at: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        task_type: { type: 'string' },
        assigned_user_id: { type: 'number' },
        remind_at: { type: 'string' },
      },
      required: ['lead_id', 'due_at'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description: 'Pobiera liste zadan CRM.',
    inputSchema: {
      type: 'object',
      properties: {
        assigned_user_id: { type: 'number' },
        lead_id: { type: 'number' },
        status: { type: 'string', enum: ['planned', 'completed', 'cancelled'] },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_invoices',
    description: 'Pobiera liste faktur.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number' },
        per_page: { type: 'number' },
        search: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_dashboard',
    description: 'Pobiera podsumowanie dashboardu faktur.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_products',
    description: 'Pobiera liste produktow.',
    inputSchema: {
      type: 'object',
      properties: {
        missing_price: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_products',
    description: 'Wyszukuje produkty po frazie.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
      },
      required: ['search'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_customers',
    description: 'Pobiera liste klientow.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'search_customers',
    description: 'Wyszukuje klientow po frazie.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
      },
      required: ['search'],
      additionalProperties: false,
    },
  },
] as const;

function asNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Expected numeric value');
  }
  return parsed;
}

function readString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  return fallback;
}

function normalizeArgs(input: unknown): ToolArgs {
  if (input && typeof input === 'object') {
    return input as ToolArgs;
  }
  return {};
}

function toPolishError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const payload = error.response?.data;
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const msg = String((payload as { error?: unknown }).error || '');
      if (msg.trim()) {
        return `Blad API (${status || 'n/a'}): ${msg}`;
      }
    }
    return `Blad API (${status || 'n/a'}): ${error.message}`;
  }

  if (error instanceof Error) {
    return `Blad: ${error.message}`;
  }

  return 'Nieznany blad';
}

async function runTool(name: ToolName, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case 'create_lead':
      return (await api.post('/crm/leads', args)).data;

    case 'list_leads':
      return (await api.get('/crm/leads', { params: args })).data;

    case 'search_leads':
      return (await api.get('/crm/leads', {
        params: {
          search: readString(args.search),
          per_page: args.per_page,
        },
      })).data;

    case 'get_lead':
      return (await api.get(`/crm/leads/${asNumber(args.lead_id)}`)).data;

    case 'update_lead':
      return (await api.put(`/crm/leads/${asNumber(args.lead_id)}`, args.data || {})).data;

    case 'add_activity': {
      const leadId = asNumber(args.lead_id);
      return (await api.post(`/crm/leads/${leadId}/activities`, {
        note: readString(args.note),
        activity_type: args.activity_type,
        activity_at: args.activity_at,
      })).data;
    }

    case 'create_task': {
      const leadId = asNumber(args.lead_id);
      return (await api.post(`/crm/leads/${leadId}/tasks`, {
        due_at: readString(args.due_at),
        title: args.title,
        description: args.description,
        task_type: args.task_type,
        assigned_user_id: args.assigned_user_id,
        remind_at: args.remind_at,
      })).data;
    }

    case 'list_tasks':
      return (await api.get('/crm/tasks', { params: args })).data;

    case 'list_invoices':
      return (await api.get('/invoices', { params: args })).data;

    case 'get_dashboard':
      return (await api.get('/invoices/dashboard/summary')).data;

    case 'list_products':
      return (await api.get('/products', { params: args })).data;

    case 'search_products':
      return (await api.get('/products', {
        params: {
          search: readString(args.search),
        },
      })).data;

    case 'list_customers':
      return (await api.get('/customers')).data;

    case 'search_customers':
      return (await api.get('/customers', {
        params: {
          search: readString(args.search),
        },
      })).data;

    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}

const server = new Server(
  {
    name: 'app-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [...tools],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name as ToolName;
  const toolExists = tools.some((tool) => tool.name === toolName);

  if (!toolExists) {
    return {
      content: [
        {
          type: 'text',
          text: `Nieznane narzedzie: ${request.params.name}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const args = normalizeArgs(request.params.arguments);
    const data = await runTool(toolName, args);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, tool: toolName, data }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: false, tool: toolName, error: toPolishError(error) }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
