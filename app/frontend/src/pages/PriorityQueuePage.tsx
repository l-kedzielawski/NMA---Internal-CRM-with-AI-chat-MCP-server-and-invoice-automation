import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Zap } from 'lucide-react';
import { crmApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { CrmActivityTemplate, CrmPriorityLead } from '../types';

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('pl-PL');
}

function getBucketBadge(bucket: string): string {
  if (bucket === 'high') return 'bg-red-100 text-red-700 border-red-300';
  if (bucket === 'medium') return 'bg-yellow-100 text-yellow-700 border-yellow-300';
  return 'bg-green-100 text-green-700 border-green-300';
}

export function PriorityQueuePage() {
  const { user } = useAuth();
  const [queueRows, setQueueRows] = useState<CrmPriorityLead[]>([]);
  const [templates, setTemplates] = useState<CrmActivityTemplate[]>([]);
  const [selectedTemplateByLead, setSelectedTemplateByLead] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [applyingLeadId, setApplyingLeadId] = useState<number | null>(null);
  const [updatingHotRankLeadId, setUpdatingHotRankLeadId] = useState<number | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [queueResponse, templatesResponse] = await Promise.all([
        crmApi.getPriorityQueue({ limit: 100 }),
        crmApi.getActivityTemplates()
      ]);

      const rows = queueResponse.data.data || [];
      const templateList = templatesResponse.data.data || [];
      setQueueRows(rows);
      setTemplates(templateList);

      if (templateList.length > 0) {
        setSelectedTemplateByLead((current) => {
          const next = { ...current };
          for (const row of rows) {
            if (!next[row.id]) {
              next[row.id] = templateList[0].id;
            }
          }
          return next;
        });
      }
    } catch (loadError) {
      console.error('Error loading CRM priority queue:', loadError);
      setError('Failed to load priority queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const applyTemplate = async (leadId: number) => {
    const templateId = selectedTemplateByLead[leadId];
    if (!templateId) return;

    try {
      setApplyingLeadId(leadId);
      setError(null);
      await crmApi.applyActivityTemplate(leadId, { template_id: templateId });
      await loadData();
    } catch (applyError) {
      console.error('Error applying activity template:', applyError);
      setError('Failed to apply template');
    } finally {
      setApplyingLeadId(null);
    }
  };

  const recalculateScores = async () => {
    try {
      setRecalculating(true);
      setError(null);
      await crmApi.recalculatePriorityScores();
      await loadData();
    } catch (recalculateError) {
      console.error('Error recalculating lead scores:', recalculateError);
      setError('Failed to recalculate lead scores');
    } finally {
      setRecalculating(false);
    }
  };

  const updateHotRank = async (leadId: number, nextRankRaw: string) => {
    const normalized = nextRankRaw.trim();
    const nextRank = normalized ? Number(normalized) : null;

    if (nextRank !== null && (!Number.isInteger(nextRank) || nextRank < 1 || nextRank > 10)) {
      setError('Hot rank must be an integer from 1 to 10');
      return;
    }

    try {
      setUpdatingHotRankLeadId(leadId);
      setError(null);
      await crmApi.updateLeadHotRank(leadId, nextRank);
      setQueueRows((current) =>
        current.map((row) => (row.id === leadId ? { ...row, hot_rank: nextRank } : row))
      );
    } catch (hotRankError) {
      console.error('Error updating hot rank:', hotRankError);
      setError('Failed to update hot rank');
    } finally {
      setUpdatingHotRankLeadId(null);
    }
  };

  const stats = useMemo(() => {
    return {
      total: queueRows.length,
      high: queueRows.filter((row) => row.priority_bucket === 'high').length,
      medium: queueRows.filter((row) => row.priority_bucket === 'medium').length,
      low: queueRows.filter((row) => row.priority_bucket === 'low').length,
      overdue: queueRows.filter((row) => Number(row.overdue_tasks || 0) > 0).length
    };
  }, [queueRows]);

  return (
    <div>
      <div className="flex justify-between items-center mb-6 gap-3">
        <div>
          <h2 className="text-2xl font-bold">Seller Priority Queue</h2>
          <p className="text-sm text-text-muted mt-1">Global scoring + urgency queue to focus daily seller work.</p>
        </div>
        <button onClick={loadData} className="btn-secondary flex items-center gap-2" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        {user?.role === 'admin' && (
          <button onClick={recalculateScores} className="btn-secondary" disabled={recalculating}>
            {recalculating ? 'Recalculating...' : 'Recalculate Scores'}
          </button>
        )}
      </div>

      {error && <div className="card mb-4 bg-red-50 border-red-200 text-danger">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
        <div className="card bg-gray-50"><p className="text-sm text-text-muted">Total</p><p className="text-2xl font-bold">{stats.total}</p></div>
        <div className="card bg-red-50"><p className="text-sm text-text-muted">High</p><p className="text-2xl font-bold text-red-700">{stats.high}</p></div>
        <div className="card bg-yellow-50"><p className="text-sm text-text-muted">Medium</p><p className="text-2xl font-bold text-yellow-700">{stats.medium}</p></div>
        <div className="card bg-green-50"><p className="text-sm text-text-muted">Low</p><p className="text-2xl font-bold text-green-700">{stats.low}</p></div>
        <div className="card bg-orange-50"><p className="text-sm text-text-muted">Overdue</p><p className="text-2xl font-bold text-orange-700">{stats.overdue}</p></div>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Hot Rank</th>
                <th>Score</th>
                <th>Priority</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Overdue</th>
                <th>Next Task</th>
                <th>Last Activity</th>
                <th>Source</th>
                <th>Template Action</th>
              </tr>
            </thead>
            <tbody>
              {queueRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-8 text-text-muted">
                    No leads in priority queue.
                  </td>
                </tr>
              ) : (
                queueRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>
                        <p className="font-medium">{row.company_name}</p>
                        <p className="text-xs text-text-muted">#{row.id} {row.country_code || ''}</p>
                      </div>
                    </td>
                    <td>
                      <select
                        className="input"
                        value={row.hot_rank ? String(row.hot_rank) : ''}
                        onChange={(event) => void updateHotRank(row.id, event.target.value)}
                        disabled={updatingHotRankLeadId === row.id}
                      >
                        <option value="">-</option>
                        {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((rank) => (
                          <option key={`priority-hot-rank-${row.id}-${rank}`} value={rank}>
                            {rank}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="font-semibold">{row.lead_score}</td>
                    <td>
                      <span className={`px-2 py-1 rounded-md border text-xs font-medium ${getBucketBadge(row.priority_bucket)}`}>
                        {row.priority_bucket}
                      </span>
                    </td>
                    <td>{row.lead_owner || '-'}</td>
                    <td>{row.status || '-'}</td>
                    <td className={Number(row.overdue_tasks || 0) > 0 ? 'text-danger font-semibold' : ''}>
                      {Number(row.overdue_tasks || 0)} / {Number(row.planned_tasks || 0)}
                    </td>
                    <td>{formatDateTime(row.next_task_due_at)}</td>
                    <td>{formatDateTime(row.last_activity_at)}</td>
                    <td>{row.source_channel || '-'}</td>
                    <td>
                      <div className="flex gap-2 items-center min-w-64">
                        <select
                          className="input"
                          value={selectedTemplateByLead[row.id] || ''}
                          onChange={(event) =>
                            setSelectedTemplateByLead((current) => ({
                              ...current,
                              [row.id]: event.target.value
                            }))
                          }
                        >
                          {templates.map((template) => (
                            <option key={`template-option-${template.id}`} value={template.id}>
                              {template.label}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-secondary flex items-center gap-1"
                          disabled={applyingLeadId === row.id || templates.length === 0}
                          onClick={() => applyTemplate(row.id)}
                        >
                          <Zap size={14} />
                          {applyingLeadId === row.id ? 'Applying...' : 'Apply'}
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
    </div>
  );
}
