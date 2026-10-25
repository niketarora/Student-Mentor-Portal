import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import mujLogo from '../../assets/manipal-university-jaipur-logo.png';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { TextField } from '../../components/ui/FormControls.jsx';
import { HOME_PATH } from '../../lib/constants.js';
import { describeError } from '../../lib/formatters.js';

export default function LoginPage() {
  const { signIn, sendPasswordReset, isAuthenticated, profile, loading } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  if (!loading && isAuthenticated && profile) {
    return <Navigate to={location.state?.from ?? HOME_PATH[profile.role] ?? '/'} replace />;
  }

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loadedProfile = await signIn(form.email, form.password);
      toast.success(`Welcome back, ${loadedProfile?.full_name ?? 'there'}.`);
      navigate(HOME_PATH[loadedProfile?.role] ?? '/', { replace: true });
    } catch (signInError) {
      setError(describeError(signInError));
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async () => {
    if (!form.email.trim()) {
      setError('Enter your university email first, then choose "Forgot password".');
      return;
    }
    try {
      await sendPasswordReset(form.email);
      toast.success('If that email exists, a reset link is on its way.');
    } catch (resetError) {
      toast.error(describeError(resetError));
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-primary p-10 text-white lg:flex">
        <div className="w-fit rounded-xl bg-white p-4 shadow-card">
          <img src={mujLogo} alt="Manipal University Jaipur" className="h-14 w-auto object-contain" />
        </div>
        <div>
          <h1 className="max-w-lg text-display-lg leading-tight">Student Mentorship Portal</h1>
          <p className="mt-4 max-w-md text-body-lg text-primary-fixed">
            One place for students, faculty mentors and the department head to raise, track and resolve
            academic support requests.
          </p>
          <ul className="mt-8 space-y-3 text-body-md text-primary-fixed">
            {[
              ['confirmation_number', 'Raise and track queries in real time'],
              ['groups', 'Stay connected with your assigned mentor'],
              ['analytics', 'Analytical reports for faculty and the HOD']
            ].map(([icon, text]) => (
              <li key={icon} className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                  {icon}
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-label-sm text-primary-fixed/80">
          {import.meta.env.VITE_DEPARTMENT_NAME ?? 'Department of IoT & Intelligent Systems'} ·{' '}
          {import.meta.env.VITE_INSTITUTION_NAME ?? 'Manipal University Jaipur'}
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center lg:hidden">
            <img src={mujLogo} alt="Manipal University Jaipur" className="h-12 w-auto object-contain" />
          </div>

          <div className="panel p-8">
            <h2 className="text-headline-md text-on-surface">Sign in</h2>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Use the university email address issued to you.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded border border-error/30 bg-error-container/60 px-3 py-2.5 text-body-sm text-on-error-container"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  error
                </span>
                {error}
              </div>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4">
              <TextField
                name="email"
                type="email"
                label="University email"
                required
                autoComplete="username"
                autoFocus
                placeholder="you@jaipur.manipal.edu"
                value={form.email}
                onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
              />

              <div>
                <label htmlFor="password" className="field-label">
                  Password <span className="text-error">*</span>
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    className="field-input pr-11"
                    value={form.password}
                    onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-tertiary hover:text-on-surface"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <span className="material-symbols-outlined text-[19px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <button type="button" onClick={resetPassword} className="mt-4 text-label-sm text-primary hover:underline">
              Forgot your password?
            </button>

            <p className="mt-6 border-t border-topbar-border pt-4 text-label-sm text-tertiary">
              Accounts are created by the department. If you do not have one yet, contact your HOD office.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
