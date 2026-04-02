import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { authApi, logsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { AuditLog } from '../types';
import toast from 'react-hot-toast';

interface UserOption {
  id: number;
  username: string;
  full_name: string;
}

function toSqlDateTime(input: string): string | undefined {
  if (!input) return undefined;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function formatDateTime(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('pl-PL');
}

export function LogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [eventType, setEventType] = useState('');
  const [userId, setUserId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [clearing, setClearing] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  useEffect(() => {
    if (user?.role !== 'admin') {
      setLoading(false);
      return;
    }
    loadUsers();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    loadLogs();
  }, [user?.role, page, perPage, search, method, eventType, userId, dateFrom, dateTo]);

  const loadUsers = async () => {
    try {
      const response = await authApi.getUsers();
      setUsers(response.data.data || []);
    } catch (usersError) {
      console.error('Error loading users for log filter:', usersError);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await logsApi.getAll({
        page,
        per_page: perPage,
        search: search.trim() || undefined,
        method: method || undefined,
        event_type: eventType.trim() || undefined,
        user_id: userId ? Number(userId) : undefined,
        date_from: toSqlDateTime(dateFrom),
        date_to: toSqlDateTime(dateTo),
      });

      setLogs(response.data.data || []);
      setTotal(response.data.total || 0);
    } catch (logsError) {
      console.error('Error loading logs:', logsError);
      setError('Failed to load logs.');
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    const hasFilters = Boolean(
      search.trim() || method || eventType.trim() || userId || dateFrom || dateTo
    );

    const confirmMessage = hasFilters
      ? 'Delete logs matching current filters from database?'
      : 'Delete ALL logs from database?';

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      setClearing(true);
      setError(null);

      const response = await logsApi.delete({
        search: search.trim() || undefined,
        method: method || undefined,
        event_type: eventType.trim() || undefined,
        user_id: userId ? Number(userId) : undefined,
        date_from: toSqlDateTime(dateFrom),
        date_to: toSqlDateTime(dateTo),
      });

      setPage(1);
      await loadLogs();
      toast.success(`Deleted ${response.data.deleted_count} log entries.`);
    } catch (clearError: any) {
      console.error('Error deleting logs:', clearError);
      const message = clearError?.response?.data?.error || 'Failed to delete logs.';
      setError(message);
      toast.error(message);
    } finally {
      setClearing(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="card">
        <h2 className="text-xl font-bold mb-2">Access Denied</h2>
        <p className="text-text-muted">Only administrators can access logs.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">App Logs</h2>
            <p className="text-sm text-text-muted mt-1">Login and write-action history for the whole application.</p>
          </div>
          <button
            onClick={() => void clearLogs()}
            disabled={clearing}
            className="btn-danger flex items-center gap-2"
          >
            <Trash2 size={16} />
            {clearing ? 'Deleting...' : 'Clear Logs'}
          </button>
        </div>
      </div>

      {error && <div className="card mb-4 bg-red-50 border-red-200 text-danger">{error}</div>}

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3">
          <input
            className="input"
            placeholder="Search user, endpoint, event"
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />

          <select
            className="input"
            value={method}
            onChange={(event) => {
              setPage(1);
              setMethod(event.target.value);
            }}
          >
            <option value="">All methods</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
          </select>

          <input
            className="input"
            placeholder="Event type (e.g. auth_login_success)"
            value={eventType}
            onChange={(event) => {
              setPage(1);
              setEventType(event.target.value);
            }}
          />

          <select
            className="input"
            value={userId}
            onChange={(event) => {
              setPage(1);
              setUserId(event.target.value);
            }}
          >
            <option value="">All users</option>
            {users.map((userOption) => (
              <option key={`logs-user-${userOption.id}`} value={userOption.id}>
                {userOption.full_name} (@{userOption.username})
              </option>
            ))}
          </select>

          <input
            type="datetime-local"
            className="input"
            value={dateFrom}
            onChange={(event) => {
              setPage(1);
              setDateFrom(event.target.value);
            }}
          />

          <input
            type="datetime-local"
            className="input"
            value={dateTo}
            onChange={(event) => {
              setPage(1);
              setDateTo(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Role</th>
                <th>Event</th>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">Loading logs...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">No log entries found.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={`audit-log-${log.id}`}>
                    <td className="whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    <td>
                      <div className="font-medium">{log.full_name || '-'}</div>
                      <div className="text-xs text-text-muted">{log.username ? `@${log.username}` : '-'}</div>
                    </td>
                    <td>{log.user_role || '-'}</td>
                    <td>{log.event_type}</td>
                    <td>{log.method}</td>
                    <td className="max-w-[380px] truncate" title={log.endpoint}>{log.endpoint}</td>
                    <td>{log.status_code}</td>
                    <td>{log.ip_address || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-text-muted">
            {total} total log entries
          </p>

          <div className="flex items-center gap-2">
            <button
              className="btn-secondary p-2"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>

            <span className="text-sm text-text-muted min-w-24 text-center">
              Page {page} / {totalPages}
            </span>

            <button
              className="btn-secondary p-2"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
