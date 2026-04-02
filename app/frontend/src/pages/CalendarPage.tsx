import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Trash2, CheckCircle2, ChevronDown, ChevronUp, PencilLine, AlertTriangle } from 'lucide-react';
import { crmApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type {
  CrmLead,
  CrmTask,
  CrmTaskItemKind,
  CrmTaskRecurrenceType,
  CrmTaskStatus,
  CrmTaskType,
  CrmTaskUser
} from '../types';

interface CalendarTaskDraft {
  lead_id: string;
  item_kind: CrmTaskItemKind;
  task_type: CrmTaskType;
  title: string;
  due_at: string;
  remind_at: string;
  description: string;
  assigned_user_id: string;
  recurrence_type: CrmTaskRecurrenceType;
  recurrence_interval: string;
  recurrence_until: string;
}

interface CalendarTaskEditDraft {
  item_kind: CrmTaskItemKind;
  task_type: CrmTaskType;
  status: CrmTaskStatus;
  title: string;
  due_at: string;
  remind_at: string;
  description: string;
  assigned_user_id: string;
  recurrence_type: CrmTaskRecurrenceType;
  recurrence_interval: string;
  recurrence_until: string;
}

interface QuickTodoItem {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
}

function getQuickTodoStorageKey(userId: number | undefined): string {
  return `calendar_quick_todos_v2_${userId ?? 'guest'}`;
}

function getLegacyQuickTodoStorageKey(userId: number | undefined): string {
  return `calendar_quick_todos_v1_${userId ?? 'guest'}`;
}

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

function formatDateTime(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('pl-PL');
}

function formatOptionalDateTime(input: string | null | undefined): string {
  if (!input) return '-';
  return formatDateTime(input);
}

function getLeadContactSummary(lead: CrmLead): string {
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
  const position = (lead.contact_position || '').trim();

  if (fullName && position) return `${fullName} - ${position}`;
  if (fullName) return fullName;
  if (position) return position;
  return '-';
}

function getLeadNotesPreview(notes: string | null | undefined): string {
  const clean = (notes || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '-';
  if (clean.length <= 220) return clean;
  return `${clean.slice(0, 217)}...`;
}

function getDefaultTaskDateTimeLocal(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return toDateTimeLocal(now.toISOString());
}

function getMonthCursorToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function getDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMonthFetchDateRange(monthCursor: string): { from: string; to: string } {
  const monthGrid = getMonthGrid(monthCursor);
  const first = new Date(monthGrid[0]);
  first.setHours(0, 0, 0, 0);
  const last = new Date(monthGrid[monthGrid.length - 1]);
  last.setHours(23, 59, 59, 999);
  return {
    from: first.toISOString(),
    to: last.toISOString()
  };
}

function shiftMonth(monthCursor: string, delta: number): string {
  const [yearRaw, monthRaw] = monthCursor.split('-');
  const date = new Date(Number(yearRaw), Number(monthRaw) - 1 + delta, 1);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthGrid(monthCursor: string): Date[] {
  const [yearRaw, monthRaw] = monthCursor.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const firstDay = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const weekdayMondayFirst = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month - 1, 1 - weekdayMondayFirst, 0, 0, 0, 0);

  return Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date;
  });
}

function dateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTaskTypeLabel(taskType: CrmTaskType): string {
  if (taskType === 'meeting') return 'Meeting';
  if (taskType === 'call') return 'Call';
  if (taskType === 'email') return 'Email';
  if (taskType === 'next_contact') return 'Next contact';
  if (taskType === 'other') return 'Other';
  return 'Follow-up';
}

const TASK_TYPE_OPTIONS: Array<{ value: CrmTaskType; label: string }> = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'next_contact', label: 'Next Contact' },
  { value: 'other', label: 'Other' }
];

export function CalendarPage() {
  const { user } = useAuth();
  const [monthCursor, setMonthCursor] = useState(getMonthCursorToday());
  const [selectedDate, setSelectedDate] = useState(getDateToday());
  const [calendarItems, setCalendarItems] = useState<CrmTask[]>([]);
  const [taskUsers, setTaskUsers] = useState<CrmTaskUser[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<CalendarTaskEditDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | CrmTaskStatus>('planned');
  const [itemKindFilter, setItemKindFilter] = useState<'all' | CrmTaskItemKind>('all');
  const [leadScopeFilter, setLeadScopeFilter] = useState<'all' | 'lead' | 'general'>('all');
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [expandedLeadPreviewId, setExpandedLeadPreviewId] = useState<number | null>(null);
  const [loadingLeadPreviewId, setLoadingLeadPreviewId] = useState<number | null>(null);
  const [leadPreviewCache, setLeadPreviewCache] = useState<Record<number, CrmLead>>({});
  const [quickTodos, setQuickTodos] = useState<QuickTodoItem[]>([]);
  const [todoDraft, setTodoDraft] = useState('');
  const [todosLoaded, setTodosLoaded] = useState(false);
  const [draft, setDraft] = useState<CalendarTaskDraft>({
    lead_id: '',
    item_kind: 'task',
    task_type: 'follow_up',
    title: '',
    due_at: getDefaultTaskDateTimeLocal(),
    remind_at: '',
    description: '',
    assigned_user_id: '',
    recurrence_type: 'none',
    recurrence_interval: '1',
    recurrence_until: ''
  });

  useEffect(() => {
    loadSetupData();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setDraft((current) => ({
      ...current,
      assigned_user_id: current.assigned_user_id || String(user.id)
    }));
  }, [user?.id]);

  useEffect(() => {
    loadCalendarItems();
  }, [monthCursor, statusFilter, itemKindFilter, user?.id]);

  const loadSetupData = async () => {
    try {
      const [usersResponse, leadsResponse] = await Promise.all([
        crmApi.getTaskUsers(),
        crmApi.getLeads({ page: 1, per_page: 1000 })
      ]);

      setTaskUsers(usersResponse.data.data || []);
      setLeads(leadsResponse.data.data || []);
    } catch (setupError) {
      console.error('Error loading calendar setup data:', setupError);
      setError('Failed to load calendar setup data.');
    }
  };

  const loadCalendarItems = async () => {
    try {
      setLoading(true);
      setError(null);
      const range = getMonthFetchDateRange(monthCursor);
      const response = await crmApi.getTasks({
        date_from: range.from,
        date_to: range.to,
        status: statusFilter === 'all' ? undefined : statusFilter,
        item_kind: itemKindFilter === 'all' ? undefined : itemKindFilter
      });
      setCalendarItems(response.data.data || []);
    } catch (loadError) {
      console.error('Error loading calendar items:', loadError);
      setError('Failed to load calendar events and tasks.');
    } finally {
      setLoading(false);
    }
  };

  const createCalendarItem = async () => {
    const leadId = draft.lead_id ? Number(draft.lead_id) : null;
    if (leadId !== null && Number.isNaN(leadId)) {
      setError('Invalid lead selection.');
      return;
    }

    const dueAt = fromDateTimeLocal(draft.due_at);
    if (!dueAt) {
      setError('Please provide a valid date and time.');
      return;
    }

    const remindAt = draft.remind_at ? fromDateTimeLocal(draft.remind_at) : null;

    try {
      setCreating(true);
      setError(null);
      await crmApi.createTask({
        lead_id: leadId,
        item_kind: draft.item_kind,
        task_type: draft.task_type,
        title: draft.title.trim() || undefined,
        description: draft.description.trim() || null,
        due_at: dueAt,
        remind_at: remindAt,
        assigned_user_id: draft.assigned_user_id ? Number(draft.assigned_user_id) : undefined,
        recurrence_type: draft.recurrence_type,
        recurrence_interval: Number(draft.recurrence_interval || 1),
        recurrence_until: draft.recurrence_until ? fromDateTimeLocal(draft.recurrence_until) : null
      });

      const createdDate = dueAt.slice(0, 10);
      setSelectedDate(createdDate);
      setDraft((current) => ({
        ...current,
        title: '',
        description: '',
        due_at: getDefaultTaskDateTimeLocal(),
        remind_at: '',
        recurrence_type: 'none',
        recurrence_interval: '1',
        recurrence_until: ''
      }));
      await loadCalendarItems();
    } catch (createError) {
      console.error('Error creating calendar item:', createError);
      setError('Failed to create calendar item.');
    } finally {
      setCreating(false);
    }
  };

  const updateTaskStatus = async (taskId: number, status: CrmTaskStatus) => {
    try {
      setUpdatingTaskId(taskId);
      await crmApi.updateTask(taskId, { status });
      await loadCalendarItems();
    } catch (updateError) {
      console.error('Error updating task status:', updateError);
      setError('Failed to update item status.');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const deleteTask = async (taskId: number) => {
    if (!window.confirm('Delete this item?')) return;

    try {
      setDeletingTaskId(taskId);
      await crmApi.deleteTask(taskId);
      await loadCalendarItems();
    } catch (deleteError) {
      console.error('Error deleting calendar item:', deleteError);
      setError('Failed to delete item.');
    } finally {
      setDeletingTaskId(null);
    }
  };

  const startEditingTask = (task: CrmTask) => {
    setEditingTaskId(task.id);
    setEditDraft({
      item_kind: task.item_kind,
      task_type: task.task_type,
      status: task.status,
      title: task.title || '',
      due_at: toDateTimeLocal(task.due_at),
      remind_at: toDateTimeLocal(task.remind_at),
      description: task.description || '',
      assigned_user_id: String(task.assigned_user_id || user?.id || ''),
      recurrence_type: task.recurrence_type,
      recurrence_interval: String(task.recurrence_interval || 1),
      recurrence_until: toDateTimeLocal(task.recurrence_until)
    });
  };

  const cancelEditingTask = () => {
    setEditingTaskId(null);
    setEditDraft(null);
  };

  const saveTaskEdits = async (taskId: number) => {
    if (!editDraft) return;

    const dueAt = fromDateTimeLocal(editDraft.due_at);
    if (!dueAt) {
      setError('Please provide a valid due date and time.');
      return;
    }

    const remindAt = editDraft.remind_at ? fromDateTimeLocal(editDraft.remind_at) : null;
    const recurrenceUntil =
      editDraft.recurrence_type === 'none'
        ? null
        : (editDraft.recurrence_until ? fromDateTimeLocal(editDraft.recurrence_until) : null);

    try {
      setUpdatingTaskId(taskId);
      setError(null);
      await crmApi.updateTask(taskId, {
        item_kind: editDraft.item_kind,
        task_type: editDraft.task_type,
        status: editDraft.status,
        title: editDraft.title.trim() || undefined,
        description: editDraft.description.trim() || null,
        due_at: dueAt,
        remind_at: remindAt,
        assigned_user_id: editDraft.assigned_user_id ? Number(editDraft.assigned_user_id) : undefined,
        recurrence_type: editDraft.recurrence_type,
        recurrence_interval:
          editDraft.recurrence_type === 'none'
            ? 1
            : Math.max(1, Number(editDraft.recurrence_interval || 1) || 1),
        recurrence_until: recurrenceUntil,
      });
      await loadCalendarItems();
      cancelEditingTask();
    } catch (updateError) {
      console.error('Error updating task details:', updateError);
      setError('Failed to update item details.');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const toggleLeadPreview = async (leadId: number) => {
    if (expandedLeadPreviewId === leadId) {
      setExpandedLeadPreviewId(null);
      return;
    }

    setExpandedLeadPreviewId(leadId);
    if (leadPreviewCache[leadId]) return;

    try {
      setLoadingLeadPreviewId(leadId);
      const response = await crmApi.getLeadById(leadId);
      setLeadPreviewCache((current) => ({
        ...current,
        [leadId]: response.data
      }));
    } catch (leadLoadError) {
      console.error('Error loading lead preview:', leadLoadError);
      setError('Failed to load lead preview.');
    } finally {
      setLoadingLeadPreviewId((current) => (current === leadId ? null : current));
    }
  };

  const monthGrid = useMemo(() => getMonthGrid(monthCursor), [monthCursor]);

  const filteredCalendarItems = useMemo(() => {
    if (leadScopeFilter === 'all') return calendarItems;
    return calendarItems.filter((item) => {
      if (leadScopeFilter === 'lead') return item.lead_id !== null;
      return item.lead_id === null;
    });
  }, [calendarItems, leadScopeFilter]);

  const itemsByDate = useMemo(() => {
    return filteredCalendarItems.reduce<Record<string, CrmTask[]>>((acc, item) => {
      const key = item.due_at.slice(0, 10);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [filteredCalendarItems]);

  const selectedDateItems = useMemo(() => {
    return (itemsByDate[selectedDate] || []).slice().sort((a, b) => a.due_at.localeCompare(b.due_at));
  }, [itemsByDate, selectedDate]);

  const overdueBeforeSelectedDateItems = useMemo(() => {
    const selectedStart = new Date(`${selectedDate}T00:00:00`).getTime();
    if (Number.isNaN(selectedStart)) return [];

    return filteredCalendarItems
      .filter((item) => {
        if (item.item_kind !== 'task') return false;
        if (item.status !== 'planned') return false;
        const dueAt = new Date(item.due_at).getTime();
        if (Number.isNaN(dueAt)) return false;
        return dueAt < selectedStart;
      })
      .slice()
      .sort((a, b) => a.due_at.localeCompare(b.due_at));
  }, [filteredCalendarItems, selectedDate]);

  useEffect(() => {
    setExpandedTaskId(null);
    setExpandedLeadPreviewId(null);
    cancelEditingTask();
  }, [selectedDate]);

  useEffect(() => {
    setTodosLoaded(false);
    try {
      const storageKey = getQuickTodoStorageKey(user?.id);
      const legacyStorageKey = getLegacyQuickTodoStorageKey(user?.id);
      const raw = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey);
      if (!raw) {
        setQuickTodos([]);
        setTodosLoaded(true);
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setQuickTodos([]);
        setTodosLoaded(true);
        return;
      }

      const normalized = parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const maybe = item as Partial<QuickTodoItem>;
          return {
            id: String(maybe.id || ''),
            text: String(maybe.text || '').trim(),
            done: Boolean(maybe.done),
            created_at: String(maybe.created_at || new Date().toISOString()),
          };
        })
        .filter((item) => item.id && item.text);

      setQuickTodos(normalized);
      setTodosLoaded(true);
    } catch {
      setQuickTodos([]);
      setTodosLoaded(true);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!todosLoaded) {
      return;
    }

    const storageKey = getQuickTodoStorageKey(user?.id);
    try {
      localStorage.setItem(storageKey, JSON.stringify(quickTodos));
    } catch {
      // Ignore storage write errors (quota/private mode)
    }
  }, [quickTodos, user?.id, todosLoaded]);

  const monthTitle = useMemo(() => {
    const [yearRaw, monthRaw] = monthCursor.split('-');
    const date = new Date(Number(yearRaw), Number(monthRaw) - 1, 1);
    return date.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  }, [monthCursor]);

  const visibleQuickTodos = useMemo(() => {
    return quickTodos
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [quickTodos]);

  const addQuickTodo = () => {
    const text = todoDraft.trim();
    if (!text) return;

    const now = new Date().toISOString();
    const todo: QuickTodoItem = {
      id: `${Date.now()}_${Math.round(Math.random() * 1000000)}`,
      text,
      done: false,
      created_at: now,
    };

    setQuickTodos((current) => [...current, todo]);
    setTodoDraft('');
  };

  const toggleQuickTodo = (todoId: string) => {
    setQuickTodos((current) =>
      current.map((item) => (item.id === todoId ? { ...item, done: !item.done } : item))
    );
  };

  const deleteQuickTodo = (todoId: string) => {
    setQuickTodos((current) => current.filter((item) => item.id !== todoId));
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Calendar</h2>
          <p className="text-sm text-text-muted mt-1">Private calendar for your own planned tasks and events.</p>
        </div>
        <button onClick={loadCalendarItems} className="btn-secondary flex items-center gap-2" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <div className="card mb-4 bg-red-50 border-red-200 text-danger">{error}</div>}

      <div className="card mb-6">
        <h3 className="text-lg font-semibold mb-3">New Task / Event</h3>
        <p className="text-sm text-text-muted mb-3">
          Due date/time is when the item happens. Reminder date/time is optional and only controls notification timing.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Lead</label>
            <select
              className="input"
              value={draft.lead_id}
              onChange={(event) => setDraft((current) => ({ ...current, lead_id: event.target.value }))}
            >
              <option value="">No lead (general item)</option>
              {leads.map((lead) => (
                <option key={`calendar-lead-${lead.id}`} value={lead.id}>
                  {lead.company_name} {lead.country_code ? `(${lead.country_code})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Item Type</label>
            <select
              className="input"
              value={draft.item_kind}
              onChange={(event) => setDraft((current) => ({ ...current, item_kind: event.target.value as CrmTaskItemKind }))}
            >
              <option value="task">Task</option>
              <option value="event">Event</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Task/Event Category</label>
            <select
              className="input"
              value={draft.task_type}
              onChange={(event) => setDraft((current) => ({ ...current, task_type: event.target.value as CrmTaskType }))}
            >
              {TASK_TYPE_OPTIONS.map((option) => (
                <option key={`calendar-type-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Title</label>
            <input
              className="input"
              placeholder="Title (optional)"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Due Date & Time</label>
            <input
              type="datetime-local"
              className="input"
              value={draft.due_at}
              onChange={(event) => setDraft((current) => ({ ...current, due_at: event.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Reminder Date & Time</label>
            <input
              type="datetime-local"
              className="input"
              value={draft.remind_at}
              onChange={(event) => setDraft((current) => ({ ...current, remind_at: event.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Recurrence</label>
            <select
              className="input"
              value={draft.recurrence_type}
              onChange={(event) => setDraft((current) => ({ ...current, recurrence_type: event.target.value as CrmTaskRecurrenceType }))}
            >
              <option value="none">No recurrence</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Recurrence Interval</label>
            <input
              type="number"
              min={1}
              className="input"
              placeholder="Recurrence interval"
              value={draft.recurrence_interval}
              onChange={(event) => setDraft((current) => ({ ...current, recurrence_interval: event.target.value }))}
              disabled={draft.recurrence_type === 'none'}
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Recurrence End Date & Time</label>
            <input
              type="datetime-local"
              className="input"
              value={draft.recurrence_until}
              onChange={(event) => setDraft((current) => ({ ...current, recurrence_until: event.target.value }))}
              disabled={draft.recurrence_type === 'none'}
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Assigned To</label>
            <select
              className="input"
              value={draft.assigned_user_id}
              onChange={(event) => setDraft((current) => ({ ...current, assigned_user_id: event.target.value }))}
              disabled={Boolean(user?.id)}
            >
              <option value="">Assign to me</option>
              {taskUsers.map((taskUser) => (
                <option key={`calendar-user-${taskUser.id}`} value={taskUser.id}>
                  {taskUser.full_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={createCalendarItem} disabled={creating}>
              {creating ? 'Saving...' : 'Create'}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">Description</label>
          <textarea
            className="input min-h-20"
            placeholder="Description (optional)"
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="card xl:col-span-2">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <button className="btn-secondary p-2" onClick={() => setMonthCursor((current) => shiftMonth(current, -1))}>
                <ChevronLeft size={16} />
              </button>
              <h3 className="text-lg font-semibold capitalize min-w-40 text-center">{monthTitle}</h3>
              <button className="btn-secondary p-2" onClick={() => setMonthCursor((current) => shiftMonth(current, 1))}>
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | CrmTaskStatus)}
              >
                <option value="planned">Planned only</option>
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <select
                className="input"
                value={itemKindFilter}
                onChange={(event) => setItemKindFilter(event.target.value as 'all' | CrmTaskItemKind)}
              >
                <option value="all">Tasks + Events</option>
                <option value="task">Tasks only</option>
                <option value="event">Events only</option>
              </select>

              <select
                className="input"
                value={leadScopeFilter}
                onChange={(event) => setLeadScopeFilter(event.target.value as 'all' | 'lead' | 'general')}
              >
                <option value="all">All items</option>
                <option value="lead">Lead-linked only</option>
                <option value="general">General only</option>
              </select>

            </div>
          </div>

          <div className="grid grid-cols-7 gap-2 mb-2 text-xs uppercase tracking-wide text-text-muted font-medium">
            <div>Pon</div>
            <div>Wt</div>
            <div>Śr</div>
            <div>Czw</div>
            <div>Pt</div>
            <div>Sob</div>
            <div>Nd</div>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {monthGrid.map((date) => {
              const isoDate = dateToIso(date);
              const dayItems = itemsByDate[isoDate] || [];
              const isCurrentMonth = isoDate.slice(0, 7) === monthCursor;
              const isToday = isoDate === getDateToday();
              const isSelected = isoDate === selectedDate;
              const tasksCount = dayItems.filter((item) => item.item_kind === 'task').length;
              const eventsCount = dayItems.filter((item) => item.item_kind === 'event').length;

              return (
                <button
                  key={`calendar-day-${isoDate}`}
                  className={`text-left border rounded-lg p-2 min-h-[92px] transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : isToday
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-surface-2 hover:bg-surface-1'
                  } ${isCurrentMonth ? '' : 'opacity-50'}`}
                  onClick={() => setSelectedDate(isoDate)}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-sm font-semibold">{date.getDate()}</span>
                    <div className="flex flex-col items-end gap-1">
                      {tasksCount > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Tasks {tasksCount}</span>}
                      {eventsCount > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Events {eventsCount}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-1">{new Date(`${selectedDate}T00:00:00`).toLocaleDateString('pl-PL')}</h3>
          <p className="text-sm text-text-muted mb-4">{selectedDateItems.length} item(s)</p>

          {overdueBeforeSelectedDateItems.length > 0 && (
            <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg p-3">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                <AlertTriangle size={15} />
                {overdueBeforeSelectedDateItems.length} missed task(s) from earlier day(s)
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Complete or reschedule these to keep your daily page clean.
              </p>
              <div className="mt-2 space-y-1">
                {overdueBeforeSelectedDateItems.slice(0, 3).map((item) => (
                  <button
                    key={`overdue-jump-${item.id}`}
                    className="w-full text-left text-xs text-amber-900 hover:underline"
                    onClick={() => setSelectedDate(item.due_at.slice(0, 10))}
                  >
                    {formatDateTime(item.due_at)} - {item.title || getTaskTypeLabel(item.task_type)}
                  </button>
                ))}
                {overdueBeforeSelectedDateItems.length > 3 && (
                  <p className="text-xs text-amber-700">+{overdueBeforeSelectedDateItems.length - 3} more overdue item(s)</p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {selectedDateItems.map((item) => {
              const leadPreview =
                item.lead_id === null
                  ? null
                  : leadPreviewCache[item.lead_id] || leads.find((lead) => lead.id === item.lead_id) || null;
              const isLeadPreviewExpanded = item.lead_id !== null && expandedLeadPreviewId === item.lead_id;

              return (
              <div key={`selected-item-${item.id}`} className="border border-surface-2 rounded-lg p-3">
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedTaskId((current) => (current === item.id ? null : item.id))}
                >
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-text-muted">
                        {item.company_name || 'General'} • {getTaskTypeLabel(item.task_type)} • {formatDateTime(item.due_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${item.item_kind === 'event' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                        {item.item_kind}
                      </span>
                      {expandedTaskId === item.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </button>

                {expandedTaskId === item.id && (
                  <div className="mt-2 pt-2 border-t border-surface-2">
                    {editingTaskId === item.id && editDraft ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Title</label>
                            <input
                              className="input"
                              value={editDraft.title}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, title: event.target.value } : current))}
                              placeholder="Title"
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Status</label>
                            <select
                              className="input"
                              value={editDraft.status}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, status: event.target.value as CrmTaskStatus } : current))}
                            >
                              <option value="planned">Planned</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Item Type</label>
                            <select
                              className="input"
                              value={editDraft.item_kind}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, item_kind: event.target.value as CrmTaskItemKind } : current))}
                            >
                              <option value="task">Task</option>
                              <option value="event">Event</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Category</label>
                            <select
                              className="input"
                              value={editDraft.task_type}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, task_type: event.target.value as CrmTaskType } : current))}
                            >
                              {TASK_TYPE_OPTIONS.map((option) => (
                                <option key={`edit-calendar-type-${option.value}`} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Due Date & Time</label>
                            <input
                              type="datetime-local"
                              className="input"
                              value={editDraft.due_at}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, due_at: event.target.value } : current))}
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Reminder Date & Time</label>
                            <input
                              type="datetime-local"
                              className="input"
                              value={editDraft.remind_at}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, remind_at: event.target.value } : current))}
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Recurrence</label>
                            <select
                              className="input"
                              value={editDraft.recurrence_type}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, recurrence_type: event.target.value as CrmTaskRecurrenceType } : current))}
                            >
                              <option value="none">No recurrence</option>
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Recurrence Interval</label>
                            <input
                              type="number"
                              min={1}
                              className="input"
                              value={editDraft.recurrence_interval}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, recurrence_interval: event.target.value } : current))}
                              disabled={editDraft.recurrence_type === 'none'}
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Recurrence End</label>
                            <input
                              type="datetime-local"
                              className="input"
                              value={editDraft.recurrence_until}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, recurrence_until: event.target.value } : current))}
                              disabled={editDraft.recurrence_type === 'none'}
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-text-muted mb-1">Assigned To</label>
                            <select
                              className="input"
                              value={editDraft.assigned_user_id}
                              onChange={(event) => setEditDraft((current) => (current ? { ...current, assigned_user_id: event.target.value } : current))}
                              disabled={Boolean(user?.id)}
                            >
                              {taskUsers.map((taskUser) => (
                                <option key={`edit-calendar-user-${taskUser.id}`} value={taskUser.id}>
                                  {taskUser.full_name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs text-text-muted mb-1">Description</label>
                          <textarea
                            className="input min-h-20"
                            value={editDraft.description}
                            onChange={(event) => setEditDraft((current) => (current ? { ...current, description: event.target.value } : current))}
                            placeholder="Description"
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn-primary"
                            onClick={() => saveTaskEdits(item.id)}
                            disabled={updatingTaskId === item.id}
                          >
                            {updatingTaskId === item.id ? 'Saving...' : 'Save changes'}
                          </button>
                          <button className="btn-secondary" onClick={cancelEditingTask}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {item.lead_id !== null && (
                          <button
                            className="btn-secondary mb-2"
                            onClick={() => void toggleLeadPreview(item.lead_id as number)}
                            disabled={loadingLeadPreviewId === item.lead_id}
                          >
                            {isLeadPreviewExpanded ? 'Hide lead snapshot' : 'Show lead snapshot'}
                          </button>
                        )}

                        {isLeadPreviewExpanded && item.lead_id !== null && (
                          <div className="mb-3 border border-surface-2 rounded-lg bg-surface-1 p-3">
                            {loadingLeadPreviewId === item.lead_id ? (
                              <p className="text-sm text-text-muted">Loading lead details...</p>
                            ) : leadPreview ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                <p><span className="text-text-muted">Company:</span> {leadPreview.company_name}</p>
                                <p><span className="text-text-muted">Status:</span> {leadPreview.status || '-'}</p>
                                <p><span className="text-text-muted">Owner:</span> {leadPreview.lead_owner || '-'}</p>
                                <p><span className="text-text-muted">Contact:</span> {getLeadContactSummary(leadPreview)}</p>
                                <p><span className="text-text-muted">Email:</span> {leadPreview.email || '-'}</p>
                                <p><span className="text-text-muted">Phone:</span> {leadPreview.phone || '-'}</p>
                                <p><span className="text-text-muted">Tax ID:</span> {leadPreview.tax_id || '-'}</p>
                                <p><span className="text-text-muted">Country/Location:</span> {leadPreview.country_code || '-'}{leadPreview.location ? ` / ${leadPreview.location}` : ''}</p>
                                <p className="md:col-span-2 whitespace-pre-wrap"><span className="text-text-muted">Company Address:</span> {leadPreview.company_address || '-'}</p>
                                <p className="md:col-span-2 whitespace-pre-wrap"><span className="text-text-muted">Delivery Address:</span> {leadPreview.delivery_address || leadPreview.company_address || '-'}</p>
                                <p><span className="text-text-muted">Source:</span> {leadPreview.source_channel || '-'}</p>
                                <p><span className="text-text-muted">Next Action:</span> {formatOptionalDateTime(leadPreview.next_task_due_at)}</p>
                                <p><span className="text-text-muted">Last Action:</span> {formatOptionalDateTime(leadPreview.last_action_at || leadPreview.last_contact_at)}</p>
                                <p className="md:col-span-2 whitespace-pre-wrap"><span className="text-text-muted">Notes:</span> {getLeadNotesPreview(leadPreview.notes)}</p>
                              </div>
                            ) : (
                              <p className="text-sm text-text-muted">Lead details unavailable.</p>
                            )}
                          </div>
                        )}

                        {item.recurrence_type !== 'none' && (
                          <p className="text-xs text-text-muted mb-2">
                            Recurs: {item.recurrence_type} every {item.recurrence_interval}
                            {item.recurrence_until ? ` until ${formatDateTime(item.recurrence_until)}` : ''}
                          </p>
                        )}

                        {item.description && <p className="text-sm mb-2 whitespace-pre-wrap">{item.description}</p>}

                        <p className="text-xs text-text-muted mb-2">Assigned: {item.assigned_user_name || '-'}</p>

                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn-secondary flex items-center gap-1"
                            onClick={() => startEditingTask(item)}
                            disabled={updatingTaskId === item.id || deletingTaskId === item.id}
                          >
                            <PencilLine size={14} />
                            Edit
                          </button>
                          {item.status !== 'completed' && (
                            <button
                              className="btn-secondary flex items-center gap-1"
                              onClick={() => updateTaskStatus(item.id, 'completed')}
                              disabled={updatingTaskId === item.id}
                            >
                              <CheckCircle2 size={14} />
                              Complete
                            </button>
                          )}
                          {item.status !== 'planned' && (
                            <button
                              className="btn-secondary"
                              onClick={() => updateTaskStatus(item.id, 'planned')}
                              disabled={updatingTaskId === item.id}
                            >
                              Reopen
                            </button>
                          )}
                          <button
                            className="btn-secondary flex items-center gap-1"
                            onClick={() => deleteTask(item.id)}
                            disabled={deletingTaskId === item.id}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
            })}

            {selectedDateItems.length === 0 && <p className="text-sm text-text-muted">No items on this day.</p>}
          </div>

          <div className="mt-5 pt-4 border-t border-surface-2">
            <h4 className="text-base font-semibold mb-1">Quick To-Do</h4>
            <p className="text-sm text-text-muted mb-3">Simple personal list that rolls over every day.</p>

            <div className="flex gap-2 mb-3">
              <input
                className="input flex-1"
                placeholder="Add a to-do item"
                value={todoDraft}
                onChange={(event) => setTodoDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addQuickTodo();
                  }
                }}
              />
              <button className="btn-primary" onClick={addQuickTodo}>
                Add
              </button>
            </div>

            <div className="space-y-2">
              {visibleQuickTodos.map((todo) => (
                <div key={`quick-todo-${todo.id}`} className="border border-surface-2 rounded-lg p-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={() => toggleQuickTodo(todo.id)}
                  />
                  <span className={`text-sm flex-1 ${todo.done ? 'line-through text-text-muted' : ''}`}>{todo.text}</span>
                  <button className="btn-secondary" onClick={() => deleteQuickTodo(todo.id)}>
                    Delete
                  </button>
                </div>
              ))}

              {visibleQuickTodos.length === 0 && (
                <p className="text-sm text-text-muted">No to-do items yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
