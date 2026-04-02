import { useState } from 'react';
import { X, Lock, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const validatePassword = (password: string): string[] => {
    const validationErrors: string[] = [];
    if (password.length < 8) {
      validationErrors.push('At least 8 characters');
    }
    if (!/[A-Z]/.test(password)) {
      validationErrors.push('At least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      validationErrors.push('At least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      validationErrors.push('At least one number');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      validationErrors.push('At least one special character');
    }
    return validationErrors;
  };

  const passwordRequirements = [
    { label: 'At least 8 characters', check: (p: string) => p.length >= 8 },
    { label: 'Uppercase letter', check: (p: string) => /[A-Z]/.test(p) },
    { label: 'Lowercase letter', check: (p: string) => /[a-z]/.test(p) },
    { label: 'Number', check: (p: string) => /[0-9]/.test(p) },
    { label: 'Special character', check: (p: string) => /[^A-Za-z0-9]/.test(p) },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);

    // Validate new password
    const validationErrors = validatePassword(newPassword);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    // Check passwords match
    if (newPassword !== confirmPassword) {
      setErrors(['New passwords do not match']);
      return;
    }

    // Check new password is different from current
    if (currentPassword === newPassword) {
      setErrors(['New password must be different from current password']);
      return;
    }

    setIsLoading(true);

    try {
      await authApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      toast.success('Password changed successfully');
      handleClose();
    } catch (error: any) {
      const message = error.response?.data?.error || 'Failed to change password';
      if (error.response?.data?.details) {
        const details = error.response.data.details;
        setErrors(details.map((d: { message: string }) => d.message));
      } else {
        setErrors([message]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrors([]);
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative bg-surface-0 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Change Password</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-surface-1 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {errors.length > 0 && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle size={18} className="text-danger mt-0.5 flex-shrink-0" />
              <ul className="text-sm text-danger space-y-1">
                {errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Current Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={18} />
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input w-full input-with-leading-icon pr-10"
                placeholder="Enter current password"
                disabled={isLoading}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={18} />
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input w-full input-with-leading-icon pr-10"
                placeholder="Enter new password"
                disabled={isLoading}
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Password requirements */}
          {newPassword && (
            <div className="p-3 bg-surface-1 rounded-lg">
              <p className="text-xs font-medium text-text-muted mb-2">Password Requirements:</p>
              <ul className="space-y-1">
                {passwordRequirements.map((req, index) => {
                  const isMet = req.check(newPassword);
                  return (
                    <li key={index} className="flex items-center gap-2 text-xs">
                      {isMet ? (
                        <CheckCircle size={14} className="text-success" />
                      ) : (
                        <AlertCircle size={14} className="text-text-muted" />
                      )}
                      <span className={isMet ? 'text-success' : 'text-text-muted'}>
                        {req.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Confirm New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={18} />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input w-full input-with-leading-icon pr-10"
                placeholder="Confirm new password"
                disabled={isLoading}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="mt-1 text-xs text-danger">Passwords do not match</p>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-secondary flex-1"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={isLoading || !currentPassword || !newPassword || !confirmPassword}
            >
              {isLoading ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
