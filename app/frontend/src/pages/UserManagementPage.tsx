import { useState, useEffect } from 'react';
import { authApi } from '../services/api';
import { Plus, Edit2, Trash2, UserCircle, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { OpiekunowiePage } from './OpiekunowiePage';

interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: 'admin' | 'manager' | 'bookkeeping' | 'seller';
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    full_name: '',
    role: 'seller' as 'admin' | 'manager' | 'bookkeeping' | 'seller',
    is_active: true,
  });

  const canManageUsers = currentUser?.role === 'admin';
  const canManageAccountManagers = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  useEffect(() => {
    if (canManageUsers) {
      loadUsers();
      return;
    }

    setLoading(false);
  }, [canManageUsers]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await authApi.getUsers();
      setUsers(response.data.data);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (editingUser) {
      // Update existing user
      try {
        const updateData: any = {
          email: formData.email,
          full_name: formData.full_name,
          role: formData.role,
          is_active: formData.is_active,
        };
        
        if (formData.password) {
          updateData.password = formData.password;
        }
        
        await authApi.updateUser(editingUser.id, updateData);
        toast.success('User updated successfully!');
        resetForm();
        loadUsers();
      } catch (error: any) {
        console.error('Error updating user:', error);
        toast.error(error.response?.data?.error || 'Failed to update user');
      }
    } else {
      // Create new user
      try {
        await authApi.createUser(formData);
        toast.success('User created successfully!');
        resetForm();
        loadUsers();
      } catch (error: any) {
        console.error('Error creating user:', error);
        toast.error(error.response?.data?.error || 'Failed to create user');
      }
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email,
      password: '',
      full_name: user.full_name,
      role: user.role,
      is_active: !!user.is_active,
    });
    setShowCreateForm(true);
  };

  const handleDelete = async (user: User) => {
    if (user.id === currentUser?.id) {
      toast.error('Cannot delete your own account');
      return;
    }
    
    if (!confirm(`Are you sure you want to delete user "${user.full_name}"?`)) {
      return;
    }
    
    try {
      await authApi.deleteUser(user.id);
      toast.success('User deleted successfully!');
      loadUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast.error(error.response?.data?.error || 'Failed to delete user');
    }
  };

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      password: '',
      full_name: '',
      role: 'seller',
      is_active: true,
    });
    setEditingUser(null);
    setShowCreateForm(false);
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'admin':
        return 'badge-danger';
      case 'bookkeeping':
        return 'badge-warning';
      case 'manager':
        return 'badge-primary';
      case 'seller':
        return 'badge-info';
      default:
        return 'badge-neutral';
    }
  };

  if (!canManageAccountManagers) {
    return (
      <div className="card">
        <div className="flex items-center gap-4 text-danger">
          <Shield size={48} />
          <div>
            <h2 className="text-xl font-bold mb-2">Access Denied</h2>
            <p className="text-text-muted">Only administrators and managers can access this page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canManageUsers) {
    return (
      <div className="space-y-6">
        <div className="card">
          <h1 className="text-3xl font-bold mb-2">Team Management</h1>
          <p className="text-text-muted">Account Managers section is now combined on this page.</p>
        </div>
        <OpiekunowiePage />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">User Management</h1>
          <p className="text-text-muted">Manage user accounts and permissions</p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="btn btn-primary flex items-center gap-2"
        >
          {showCreateForm ? (
            <>Cancel</>
          ) : (
            <>
              <Plus size={18} />
              Create User
            </>
          )}
        </button>
      </div>

      {showCreateForm && (
        <div className="card">
          <h2 className="text-xl font-bold mb-4">
            {editingUser ? 'Edit User' : 'Create New User'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Username <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="input w-full"
                  required
                  disabled={!!editingUser}
                  placeholder="username"
                />
                {editingUser && (
                  <p className="text-xs text-text-muted mt-1">Username cannot be changed</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Email <span className="text-danger">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input w-full"
                  required
                  placeholder="user@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Full Name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="input w-full"
                  required
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Password {!editingUser && <span className="text-danger">*</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="input w-full"
                  required={!editingUser}
                  placeholder={editingUser ? 'Leave blank to keep current' : 'Min 8 characters'}
                  minLength={8}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Role <span className="text-danger">*</span>
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="input w-full"
                  required
                >
                  <option value="seller">Seller</option>
                  <option value="manager">Manager</option>
                  <option value="bookkeeping">Bookkeeping</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Status</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-surface-2">
              <button type="submit" className="btn btn-primary">
                {editingUser ? 'Update User' : 'Create User'}
              </button>
              <button type="button" onClick={resetForm} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="loading-spinner loading-spinner-lg"></div>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <UserCircle size={20} className="text-primary" />
                        <div>
                          <div className="font-medium">{user.full_name}</div>
                          <div className="text-sm text-text-muted">@{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className={`badge ${getRoleBadgeClass(user.role)}`}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${user.is_active ? 'badge-success' : 'badge-neutral'}`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="text-sm text-text-muted">
                      {user.last_login_at 
                        ? new Date(user.last_login_at).toLocaleString()
                        : 'Never'
                      }
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(user)}
                          className="btn-secondary p-2"
                          aria-label="Edit user"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(user)}
                          className="btn-danger p-2"
                          disabled={user.id === currentUser?.id}
                          aria-label="Delete user"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="text-xl font-bold mb-2">Account Managers</h2>
        <p className="text-text-muted mb-4">This section is now combined with User Management.</p>
        <OpiekunowiePage />
      </div>
    </div>
  );
}
