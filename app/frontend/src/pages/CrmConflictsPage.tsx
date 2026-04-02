import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { crmApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { CrmDuplicateCase, CrmDuplicateCaseStatus, CrmTaskUser } from '../types';

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('pl-PL');
}

export function CrmConflictsPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<CrmDuplicateCaseStatus>('pending');
  const [cases, setCases] = useState<CrmDuplicateCase[]>([]);
  const [taskUsers, setTaskUsers] = useState<CrmTaskUser[]>([]);
  const [ownerSelection, setOwnerSelection] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [resolvingCaseId, setResolvingCaseId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canResolve = user?.role === 'admin';

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [casesResponse, usersResponse] = await Promise.all([
        crmApi.getDuplicateCases({ status: statusFilter }),
        crmApi.getTaskUsers()
      ]);

      const caseRows = casesResponse.data.data || [];
      setCases(caseRows);
      setTaskUsers(usersResponse.data.data || []);
      setOwnerSelection((current) => {
        const next = { ...current };
        for (const row of caseRows) {
          if (!next[row.id] && row.requested_owner_user_id) {
            next[row.id] = String(row.requested_owner_user_id);
          }
        }
        return next;
      });
    } catch (loadError) {
      console.error('Error loading CRM conflicts queue:', loadError);
      setError('Failed to load conflicts queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const resolveCase = async (caseId: number, decision: 'approve' | 'reject') => {
    try {
      setResolvingCaseId(caseId);
      setError(null);
      await crmApi.resolveDuplicateCase(caseId, {
        decision,
        assign_owner_user_id: ownerSelection[caseId] ? Number(ownerSelection[caseId]) : undefined
      });
      await loadData();
    } catch (resolveError) {
      console.error('Error resolving duplicate case:', resolveError);
      setError('Failed to resolve case');
    } finally {
      setResolvingCaseId(null);
    }
  };

  const counts = useMemo(() => {
    return {
      pending: cases.filter((row) => row.status === 'pending').length,
      approved: cases.filter((row) => row.status === 'approved').length,
      rejected: cases.filter((row) => row.status === 'rejected').length
    };
  }, [cases]);

  return (
    <div>
      <div className="flex justify-between items-center mb-6 gap-3">
        <div>
          <h2 className="text-2xl font-bold">CRM Duplicate & Ownership Queue</h2>
          <p className="text-sm text-text-muted mt-1">Review merge requests, keep-separate decisions and ownership handovers.</p>
        </div>
        <button onClick={loadData} className="btn-secondary flex items-center gap-2" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && <div className="card mb-4 bg-red-50 border-red-200 text-danger">{error}</div>}

      <div className="card mb-4 flex flex-wrap gap-2 items-center">
        <button
          className={`btn-secondary ${statusFilter === 'pending' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setStatusFilter('pending')}
        >
          Pending ({counts.pending})
        </button>
        <button
          className={`btn-secondary ${statusFilter === 'approved' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setStatusFilter('approved')}
        >
          Approved ({counts.approved})
        </button>
        <button
          className={`btn-secondary ${statusFilter === 'rejected' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setStatusFilter('rejected')}
        >
          Rejected ({counts.rejected})
        </button>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Action</th>
                <th>Existing Lead</th>
                <th>Candidate</th>
                <th>Requested By</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Admin Action</th>
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">No cases for selected status.</td>
                </tr>
              ) : (
                cases.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>{row.requested_action}</td>
                    <td>
                      <p className="font-medium">{row.existing_company_name || '-'}</p>
                      <p className="text-xs text-text-muted">Owner: {row.existing_lead_owner || 'Unassigned'}</p>
                    </td>
                    <td>
                      <p className="font-medium">{row.candidate_company_name || '-'}</p>
                      <p className="text-xs text-text-muted">{row.candidate_email || row.candidate_phone || '-'}</p>
                    </td>
                    <td>{row.requested_by_name || row.requested_by_user_id}</td>
                    <td>{row.reason || '-'}</td>
                    <td>{row.status}</td>
                    <td>
                      {canResolve && row.status === 'pending' ? (
                        <div className="space-y-2 min-w-64">
                          {row.requested_action === 'request_handover' && (
                            <select
                              className="input"
                              value={ownerSelection[row.id] || ''}
                              onChange={(event) =>
                                setOwnerSelection((current) => ({
                                  ...current,
                                  [row.id]: event.target.value
                                }))
                              }
                            >
                              <option value="">Use requested owner</option>
                              {taskUsers.map((taskUser) => (
                                <option key={`resolve-owner-${row.id}-${taskUser.id}`} value={taskUser.id}>
                                  {taskUser.full_name}
                                </option>
                              ))}
                            </select>
                          )}

                          <div className="flex gap-2">
                            <button
                              className="btn-primary"
                              disabled={resolvingCaseId === row.id}
                              onClick={() => resolveCase(row.id, 'approve')}
                            >
                              {resolvingCaseId === row.id ? 'Processing...' : 'Approve'}
                            </button>
                            <button
                              className="btn-secondary"
                              disabled={resolvingCaseId === row.id}
                              onClick={() => resolveCase(row.id, 'reject')}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-text-muted">{row.status === 'pending' ? 'Admin review required' : formatDateTime(row.resolved_at)}</p>
                      )}
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
