import { useEffect, useState } from 'react';
import { Plus, Edit2, Save, X, Trash2, ToggleLeft, ToggleRight, Users } from 'lucide-react';
import { opiekunowieApi } from '../services/api';
import type { LinkableUser, Opiekun } from '../types';
import toast from 'react-hot-toast';
import { EmptyState } from '../components/EmptyState';

export function OpiekunowiePage() {
  const [opiekunowie, setOpiekunowie] = useState<Opiekun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Opiekun>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [newOpiekun, setNewOpiekun] = useState<Partial<Opiekun>>({ imie: '', marza_procent: 10, user_id: null });
  const [error, setError] = useState<string | null>(null);
  const [linkableUsers, setLinkableUsers] = useState<LinkableUser[]>([]);

  useEffect(() => {
    void Promise.all([loadOpiekunowie(), loadLinkableUsers()]);
  }, [showInactive]);

  const loadOpiekunowie = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await opiekunowieApi.getAll(showInactive);
      setOpiekunowie(response.data);
    } catch (err: any) {
      console.error('Error loading opiekunowie:', err);
      setError(err?.response?.data?.error || 'Error loading data');
    } finally {
      setLoading(false);
    }
  };

  const loadLinkableUsers = async () => {
    try {
      const response = await opiekunowieApi.getLinkableUsers();
      setLinkableUsers(response.data || []);
    } catch (err: any) {
      console.error('Error loading linkable users:', err);
      setError(err?.response?.data?.error || 'Error loading login users');
    }
  };

  const getLinkableUserLabel = (user: LinkableUser) => {
    const activeSuffix = user.is_active ? '' : ' [inactive]';
    return `${user.full_name} (@${user.username}, ${user.role})${activeSuffix}`;
  };

  const startEditing = (opiekun: Opiekun) => {
    setEditingId(opiekun.id);
    setEditData({
      imie: opiekun.imie,
      nazwisko: opiekun.nazwisko,
      email: opiekun.email,
      user_id: opiekun.user_id,
      telefon: opiekun.telefon,
      marza_procent: opiekun.marza_procent,
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveOpiekun = async (id: number) => {
    try {
      setError(null);
      await opiekunowieApi.update(id, editData);
      setEditingId(null);
      toast.success('Account manager updated successfully!');
      void Promise.all([loadOpiekunowie(), loadLinkableUsers()]);
    } catch (err: any) {
      console.error('Error updating opiekun:', err);
      const errorMsg = err?.response?.data?.error || 'Failed to save';
      setError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const addOpiekun = async () => {
    if (!newOpiekun.imie?.trim()) {
      setError('Name is required');
      toast.error('Name is required');
      return;
    }
    
    try {
      setError(null);
      await opiekunowieApi.create(newOpiekun);
      setIsAdding(false);
      setNewOpiekun({ imie: '', marza_procent: 10, user_id: null });
      toast.success('Account manager created successfully!');
      void Promise.all([loadOpiekunowie(), loadLinkableUsers()]);
    } catch (err: any) {
      console.error('Error creating opiekun:', err);
      const errorMsg = err?.response?.data?.error || 'Failed to create';
      setError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const toggleActive = async (opiekun: Opiekun) => {
    try {
      setError(null);
      const willBecomeInactive = opiekun.aktywny;
      if (willBecomeInactive && !showInactive) {
        setShowInactive(true);
      }
      await opiekunowieApi.update(opiekun.id, { aktywny: !opiekun.aktywny });
      toast.success(`Account manager ${opiekun.aktywny ? 'deactivated' : 'activated'} successfully!`);
      void Promise.all([loadOpiekunowie(), loadLinkableUsers()]);
    } catch (err: any) {
      console.error('Error toggling opiekun:', err);
      const errorMsg = err?.response?.data?.error || 'Failed to change status';
      setError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const deleteOpiekun = async (id: number) => {
    if (!confirm('Are you sure you want to permanently delete this account manager from database?')) return;
    
    try {
      setError(null);
      await opiekunowieApi.delete(id);
      toast.success('Account manager deleted successfully!');
      void Promise.all([loadOpiekunowie(), loadLinkableUsers()]);
    } catch (err: any) {
      console.error('Error deleting opiekun:', err);
      const errorMsg = err?.response?.data?.error || 'Failed to delete';
      setError(errorMsg);
      toast.error(errorMsg);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Account Managers</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Include Inactive
          </label>
          <button
            onClick={() => setIsAdding(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            Add Account Manager
          </button>
        </div>
      </div>

      {error && (
        <div className="card mb-4 bg-red-50 border-red-200 text-danger">
          {error}
        </div>
      )}

      {/* Add New Form */}
      {isAdding && (
        <div className="card mb-6 bg-green-50 border-green-200">
          <h3 className="text-lg font-semibold mb-4">New Account Manager</h3>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <input
              type="text"
              placeholder="First Name *"
              className="input"
              value={newOpiekun.imie || ''}
              onChange={(e) => setNewOpiekun({ ...newOpiekun, imie: e.target.value })}
            />
            <input
              type="text"
              placeholder="Last Name"
              className="input"
              value={newOpiekun.nazwisko || ''}
              onChange={(e) => setNewOpiekun({ ...newOpiekun, nazwisko: e.target.value })}
            />
            <input
              type="email"
              placeholder="Email"
              className="input"
              value={newOpiekun.email || ''}
              onChange={(e) => setNewOpiekun({ ...newOpiekun, email: e.target.value })}
            />
            <select
              className="input"
              value={newOpiekun.user_id ? String(newOpiekun.user_id) : ''}
              onChange={(e) =>
                setNewOpiekun({
                  ...newOpiekun,
                  user_id: e.target.value ? parseInt(e.target.value, 10) : null,
                })
              }
            >
              <option value="">No linked login</option>
              {linkableUsers
                .filter((user) => user.linked_opiekun_id === null)
                .map((user) => (
                  <option key={`new-opiekun-user-${user.id}`} value={user.id}>
                    {getLinkableUserLabel(user)}
                  </option>
                ))}
            </select>
            <input
              type="tel"
              placeholder="Phone"
              className="input"
              value={newOpiekun.telefon || ''}
              onChange={(e) => setNewOpiekun({ ...newOpiekun, telefon: e.target.value })}
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="Commission %"
                className="input w-24"
                value={newOpiekun.marza_procent || ''}
                onChange={(e) => setNewOpiekun({ ...newOpiekun, marza_procent: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-sm text-text-muted">%</span>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={addOpiekun} className="btn-success flex items-center gap-2">
              <Save size={18} />
              Save
            </button>
            <button onClick={() => { setIsAdding(false); setNewOpiekun({ imie: '', marza_procent: 10, user_id: null }); }} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>First Name</th>
                <th>Last Name</th>
                <th>Email</th>
                <th>Linked Login</th>
                <th>Phone</th>
                <th>Commission %</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-text-muted">
                    Loading...
                  </td>
                </tr>
              ) : opiekunowie.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={Users}
                      title="No account managers yet"
                      description="Add your first account manager to start tracking sales performance and commissions."
                      action={
                        <button onClick={() => setIsAdding(true)} className="btn-primary">
                          <Plus size={16} className="inline mr-2" />
                          Add First Account Manager
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                opiekunowie.map((opiekun) => (
                  <tr 
                    key={opiekun.id}
                    className={!opiekun.aktywny ? 'bg-gray-100 opacity-60' : ''}
                  >
                    <td>
                      {editingId === opiekun.id ? (
                        <input
                          type="text"
                          className="input w-32"
                          value={editData.imie || ''}
                          onChange={(e) => setEditData({ ...editData, imie: e.target.value })}
                        />
                      ) : (
                        <span className="font-medium">{opiekun.imie}</span>
                      )}
                    </td>
                    <td>
                      {editingId === opiekun.id ? (
                        <input
                          type="text"
                          className="input w-32"
                          value={editData.nazwisko || ''}
                          onChange={(e) => setEditData({ ...editData, nazwisko: e.target.value })}
                        />
                      ) : (
                        opiekun.nazwisko || '-'
                      )}
                    </td>
                    <td>
                      {editingId === opiekun.id ? (
                        <input
                          type="email"
                          className="input w-40"
                          value={editData.email || ''}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                        />
                      ) : (
                        opiekun.email || '-'
                      )}
                    </td>
                    <td>
                      {editingId === opiekun.id ? (
                        <select
                          className="input w-56"
                          value={editData.user_id ? String(editData.user_id) : ''}
                          onChange={(e) =>
                            setEditData({
                              ...editData,
                              user_id: e.target.value ? parseInt(e.target.value, 10) : null,
                            })
                          }
                        >
                          <option value="">No linked login</option>
                          {linkableUsers
                            .filter((user) => user.linked_opiekun_id === null || user.id === opiekun.user_id)
                            .map((user) => (
                              <option key={`edit-opiekun-${opiekun.id}-user-${user.id}`} value={user.id}>
                                {getLinkableUserLabel(user)}
                              </option>
                            ))}
                        </select>
                      ) : (
                        opiekun.user_username ? (
                          <div>
                            <div className="font-medium">{opiekun.user_full_name || opiekun.user_username}</div>
                            <div className="text-xs text-text-muted">
                              @{opiekun.user_username}{opiekun.user_role ? ` • ${opiekun.user_role}` : ''}
                              {opiekun.user_is_active === 0 ? ' • inactive' : ''}
                            </div>
                          </div>
                        ) : (
                          '-'
                        )
                      )}
                    </td>
                    <td>
                      {editingId === opiekun.id ? (
                        <input
                          type="tel"
                          className="input w-32"
                          value={editData.telefon || ''}
                          onChange={(e) => setEditData({ ...editData, telefon: e.target.value })}
                        />
                      ) : (
                        opiekun.telefon || '-'
                      )}
                    </td>
                    <td>
                      {editingId === opiekun.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            className="input w-20"
                            value={editData.marza_procent || ''}
                            onChange={(e) => setEditData({ ...editData, marza_procent: parseFloat(e.target.value) || 0 })}
                          />
                          <span>%</span>
                        </div>
                      ) : (
                        <span className="font-medium text-primary">
                          {Number(opiekun.marza_procent).toFixed(2)}%
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => toggleActive(opiekun)}
                        className={`flex items-center gap-1 text-sm ${opiekun.aktywny ? 'text-success' : 'text-gray-400'}`}
                      >
                        {opiekun.aktywny ? (
                          <>
                            <ToggleRight size={20} />
                            Active
                          </>
                        ) : (
                          <>
                            <ToggleLeft size={20} />
                            Inactive
                          </>
                        )}
                      </button>
                    </td>
                    <td>
                      {editingId === opiekun.id ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveOpiekun(opiekun.id)}
                            className="text-success hover:text-green-700"
                          >
                            <Save size={18} />
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="text-danger hover:text-red-700"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEditing(opiekun)}
                            className="text-primary hover:text-blue-700"
                          >
                            <Edit2 size={18} />
                          </button>
                          {!opiekun.aktywny && (
                            <button
                              onClick={() => deleteOpiekun(opiekun.id)}
                              className="text-danger hover:text-red-700"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 text-sm text-text-muted">
        <p>Commission % - percentage of invoice profit that goes to the account manager as commission.</p>
        <p>Deleting an inactive account manager removes it permanently from database.</p>
      </div>
    </div>
  );
}
