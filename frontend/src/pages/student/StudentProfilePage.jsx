import { useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import { PageLoader } from '../../components/ui/Skeleton.jsx';
import { TextField } from '../../components/ui/FormControls.jsx';
import FormAFields, { useFormAState } from '../../components/student/FormAFields.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import Avatar from '../../components/ui/Avatar.jsx';
import { formatDate, formatDateTime } from '../../lib/formatters.js';

export default function StudentProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const { run, pending } = useAsyncAction();
  const formA = useFormAState(profile);
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [editingFormA, setEditingFormA] = useState(false);

  const saveFormA = (event) => {
    event.preventDefault();
    const payload = formA.validate();
    if (!payload) return;
    run(
      async () => {
        const { error } = await supabase.rpc('submit_student_form_a', { p_payload: payload });
        if (error) throw error;
      },
      {
        successMessage: 'Your Form A record has been updated.',
        onSuccess: async () => {
          setEditingFormA(false);
          await Promise.all([formA.reload(), refreshProfile()]);
        }
      }
    );
  };

  const saveContact = (event) => {
    event.preventDefault();
    if (phone && !/^[0-9]{10}$/.test(phone)) return;
    run(
      async () => {
        const { error } = await supabase
          .from('user_profiles')
          .update({ phone: phone || null })
          .eq('id', profile.id);
        if (error) throw error;
      },
      { successMessage: 'Contact details updated.', onSuccess: refreshProfile }
    );
  };

  if (formA.loading) return <PortalShell><PageLoader /></PortalShell>;

  return (
    <PortalShell>
      <PageHeader title="My profile" subtitle="Your department record and mentorship details." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel tab="Identity" tabIcon="badge">
          <div className="flex items-center gap-4">
            <Avatar path={profile.avatar_url} name={profile.full_name} size={68} />
            <div className="min-w-0">
              <h2 className="truncate text-headline-sm text-on-surface">{profile.full_name}</h2>
              <p className="truncate text-body-sm text-on-surface-variant">{profile.email}</p>
              {profile.is_star_mentee && (
                <span className="chip mt-1.5 bg-warning-container text-on-warning-container">
                  <span className="material-symbols-outlined text-[14px]">workspace_premium</span>
                  Student representative
                </span>
              )}
            </div>
          </div>

          <dl className="mt-5 space-y-3 text-body-sm">
            {[
              ['Registration no.', profile.login_id ?? '—'],
              ['Branch', profile.branch ?? '—'],
              ['Section', profile.section ?? '—'],
              ['Semester', profile.semester_label ?? '—'],
              ['Department', profile.department ?? '—'],
              ['Joined', formatDate(profile.created_at)]
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-tertiary">{label}</dt>
                <dd className="text-right text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel tab="My mentor" tabIcon="supervisor_account">
          {profile.mentor ? (
            <dl className="space-y-3 text-body-sm">
              {[
                ['Name', profile.mentor.full_name],
                ['Email', profile.mentor.email],
                ['Phone', profile.mentor.phone ?? 'Not provided'],
                ['Faculty ID', profile.mentor.login_id ?? '—']
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                  <dd className="mt-0.5 break-anywhere text-on-surface">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-body-sm text-on-surface-variant">
              No mentor assigned yet. Contact the HOD office.
            </p>
          )}
        </Panel>

        <Panel tab="Contact details" tabIcon="edit">
          <form onSubmit={saveContact} className="space-y-4">
            <TextField label="Email" value={profile.email} disabled hint="Managed by the university. Contact IT to change it." />
            <TextField
              name="phone"
              label="Mobile number"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
              error={phone && !/^[0-9]{10}$/.test(phone) ? 'Enter a 10-digit number.' : undefined}
            />
            <button type="submit" className="btn-primary w-full" disabled={pending}>
              {pending ? 'Saving...' : 'Save changes'}
            </button>
            <Link to="/change-password" className="btn-secondary w-full">
              Change password
            </Link>
          </form>
        </Panel>
      </div>

      <section className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-headline-sm text-on-surface">Form A — Mentor-Mentee record</h2>
            <p className="text-body-sm text-on-surface-variant">
              {formA.record?.submitted_at
                ? `First submitted on ${formatDateTime(formA.record.submitted_at)}. You can update it yourself at any time.`
                : 'Your departmental mentorship record.'}
            </p>
          </div>
          {editingFormA ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setEditingFormA(false);
                  formA.reload();
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button type="submit" form="profile-form-a" className="btn-primary" disabled={pending || formA.uploading !== null}>
                {pending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => setEditingFormA(true)}>
              <span className="material-symbols-outlined text-[18px]">edit</span>
              Edit my details
            </button>
          )}
        </div>

        <form id="profile-form-a" onSubmit={saveFormA}>
          <FormAFields
            form={formA.form}
            errors={formA.errors}
            setField={formA.setField}
            uploads={formA.uploads}
            uploading={formA.uploading}
            onUpload={formA.upload}
            disabled={!editingFormA}
          />
        </form>
      </section>

      {/* Sits BELOW Form A, and is read-only. The photo is captured once
          during onboarding (StudentProfilePhotoPage) and is part of the
          departmental record from then on — a student changing or removing
          it afterwards would break the thing it exists for, which is a
          mentor recognising their mentee. Staff who need it changed go
          through the HOD office. */}
      <Panel tab="Profile photo" tabIcon="photo_camera" className="mt-4">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar path={profile.avatar_url} name={profile.full_name} size={96} />
          <p className="max-w-md text-body-sm text-on-surface-variant">
            Submitted during onboarding and kept on your departmental record. Contact the HOD office if it
            needs to be replaced.
          </p>
        </div>
      </Panel>
    </PortalShell>
  );
}
