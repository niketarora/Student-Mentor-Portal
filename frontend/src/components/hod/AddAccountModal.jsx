/**
 * Single-account creation for the HOD and the administrator — for the
 * mid-semester joiner who is not in any roster spreadsheet.
 *
 * Since migration 0039 a HOD creates people inside their own scope: a
 * faculty member they add reports to them, a student can only be given
 * one of their faculty as mentor (the list below is already theirs), and
 * only the administrator creates HOD accounts.
 *
 * Goes through /api/admin/provision-user-accounts because creating a
 * Supabase Auth user (and assigning a non-student role) needs the
 * service-role key, which never exists in the browser.
 */

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import { TextField, SelectField } from '../ui/FormControls.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { apiClient } from '../../lib/apiClient.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { useAuth } from '../../context/AuthProvider.jsx';

const EMPTY = {
  role: 'student', full_name: '', email: '', login_id: '',
  branch: '', section: '', semester_label: '', phone: '', assigned_mentor_id: ''
};

export default function AddAccountModal({ open, onClose, onCreated }) {
  const { run, pending } = useAsyncAction();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [form, setForm] = useState(EMPTY);
  const [faculty, setFaculty] = useState([]);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setCreated(null);
    supabase
      .from('user_profiles')
      .select('id, full_name')
      .eq('role', 'faculty')
      .eq('employment_status', 'active')
      .order('full_name')
      .then(({ data }) => setFaculty((data ?? []).map((f) => ({ value: f.id, label: f.full_name }))));
  }, [open]);

  const update = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();
    run(
      async () => {
        const account = {
          role: form.role,
          full_name: form.full_name.trim(),
          email: form.email.trim().toLowerCase(),
          login_id: form.login_id.trim() || null,
          branch: form.branch.trim() || null,
          phone: form.phone.trim() || null,
          department: 'IoT & IS'
        };
        if (form.role === 'student') {
          account.section = form.section.trim() || null;
          account.semester_label = form.semester_label.trim() || null;
          account.assigned_mentor_id = form.assigned_mentor_id || null;
        }
        return apiClient.post('/admin/provision-user-accounts', { accounts: [account] });
      },
      {
        onSuccess: async (data) => {
          if (data.created.length) {
            setCreated(data.created[0]);
            await onCreated?.();
          } else {
            throw new Error(data.skipped[0]?.reason ?? data.failed[0]?.reason ?? 'Account was not created.');
          }
        }
      }
    );
  };

  if (created) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Account created"
        description="Share these credentials securely. The password is shown only once."
        size="sm"
        footer={
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <dl className="space-y-3">
          {[
            ['Name', created.full_name],
            ['Email (their login)', created.email],
            ['Temporary password', created.temporary_password]
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
              <dd className="mt-0.5 break-anywhere rounded bg-surface-container-low px-3 py-2 font-mono text-body-sm text-on-surface">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="btn-secondary mt-4 w-full"
          onClick={() =>
            navigator.clipboard?.writeText(
              `Email: ${created.email}\nTemporary password: ${created.temporary_password}`
            )
          }
        >
          <span className="material-symbols-outlined text-[18px]">content_copy</span>
          Copy credentials
        </button>
        <p className="mt-3 text-label-sm text-tertiary">
          They will be required to choose a new password the first time they sign in.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a single account"
      description="For someone who joined outside the roster import."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" form="add-account-form" className="btn-primary" disabled={pending}>
            {pending ? 'Creating...' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="add-account-form" onSubmit={submit} className="space-y-4">
        <SelectField
          label="Role"
          name="role"
          required
          value={form.role}
          onChange={update('role')}
          options={[
            { value: 'student', label: 'Student' },
            { value: 'faculty', label: 'Faculty mentor' },
            ...(isAdmin ? [{ value: 'hod', label: 'Head of Department' }] : []),
            { value: 'cluster_head', label: 'Cluster Head (data uploads only)' }
          ]}
        />

        {form.role === 'faculty' && !isAdmin && (
          <p className="rounded-lg bg-primary-fixed/50 px-4 py-3 text-body-sm text-on-surface-variant">
            They will report to you, so they and their mentees appear in your portal straight away.
          </p>
        )}

        {form.role === 'cluster_head' && (
          <p className="rounded-lg bg-primary-fixed/50 px-4 py-3 text-body-sm text-on-surface-variant">
            A Cluster Head can only upload attendance, GPA, backlog and black dot data. They get no access to
            queries or student profiles. On first sign-in they are asked which subjects they handle.
          </p>
        )}
        <TextField label="Full name" name="full_name" required minLength={2} value={form.full_name} onChange={update('full_name')} />
        <TextField
          label="University email"
          name="email"
          type="email"
          required
          value={form.email}
          onChange={update('email')}
          hint="This is what they will sign in with."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={form.role === 'student' ? 'Registration no.' : 'Staff ID'}
            name="login_id"
            value={form.login_id}
            onChange={update('login_id')}
          />
          <TextField label="Branch" name="branch" value={form.branch} onChange={update('branch')} />
        </div>

        {form.role === 'student' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Section" name="section" value={form.section} onChange={update('section')} />
              <TextField
                label="Semester"
                name="semester_label"
                placeholder="3rd Semester"
                value={form.semester_label}
                onChange={update('semester_label')}
              />
            </div>
            <SelectField
              label="Assign a faculty mentor"
              name="assigned_mentor_id"
              placeholder="Assign later"
              value={form.assigned_mentor_id}
              onChange={update('assigned_mentor_id')}
              options={faculty}
            />
          </>
        )}

        <TextField
          label="Mobile number"
          name="phone"
          inputMode="numeric"
          maxLength={10}
          value={form.phone}
          onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value.replace(/\D/g, '') }))}
        />
      </form>
    </Modal>
  );
}
