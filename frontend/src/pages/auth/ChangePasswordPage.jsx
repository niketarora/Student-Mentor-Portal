import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { PasswordField } from '../../components/ui/FormControls.jsx';
import { HOME_PATH } from '../../lib/constants.js';
import { describeError } from '../../lib/formatters.js';

/** Password rules mirrored from Supabase Auth's configured policy. */
function assessPassword(password) {
  const checks = [
    { label: 'At least 10 characters', ok: password.length >= 10 },
    { label: 'One uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', ok: /[a-z]/.test(password) },
    { label: 'One number', ok: /[0-9]/.test(password) },
    { label: 'One symbol', ok: /[^A-Za-z0-9]/.test(password) }
  ];
  return { checks, allPassed: checks.every((c) => c.ok) };
}

export default function ChangePasswordPage() {
  const { profile, changePassword, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [submitting, setSubmitting] = useState(false);

  const { checks, allPassed } = assessPassword(form.password);
  const matches = form.password.length > 0 && form.password === form.confirm;

  const submit = async (event) => {
    event.preventDefault();
    if (!allPassed || !matches) return;
    setSubmitting(true);
    try {
      await changePassword(form.password);
      toast.success('Password updated.');
      navigate(HOME_PATH[profile?.role] ?? '/', { replace: true });
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="panel w-full max-w-md p-7">
        <h1 className="text-headline-md text-on-surface">
          {profile?.must_change_password ? 'Set your password' : 'Change password'}
        </h1>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          {profile?.must_change_password
            ? 'You are signed in with a temporary password. Choose a new one to continue.'
            : 'Choose a new password for your account.'}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          {/* Both fields carry their own eye toggle. Typing a password you
              cannot see against five live rules is needlessly hostile, and
              this screen is the very first thing a new account meets. */}
          <PasswordField
            name="password"
            label="New password"
            required
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))}
          />
          <PasswordField
            name="confirm"
            label="Confirm new password"
            required
            autoComplete="new-password"
            value={form.confirm}
            onChange={(event) => setForm((f) => ({ ...f, confirm: event.target.value }))}
            error={form.confirm && !matches ? 'The two passwords do not match.' : undefined}
          />

          <ul className="space-y-1">
            {checks.map((check) => (
              <li
                key={check.label}
                className={`flex items-center gap-2 text-label-sm ${check.ok ? 'text-success' : 'text-tertiary'}`}
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                  {check.ok ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                {check.label}
              </li>
            ))}
          </ul>

          <button type="submit" className="btn-primary w-full" disabled={submitting || !allPassed || !matches}>
            {submitting ? 'Updating...' : 'Update password'}
          </button>
        </form>

        <button type="button" onClick={signOut} className="mt-4 text-label-sm text-primary hover:underline">
          Sign out instead
        </button>
      </div>
    </div>
  );
}
