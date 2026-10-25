import { useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import { TextField } from '../../components/ui/FormControls.jsx';
import { EmploymentBadge } from '../../components/ui/StatusBadge.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import Avatar from '../../components/ui/Avatar.jsx';
import { formatDate } from '../../lib/formatters.js';
import { ROLE_LABELS } from '../../lib/constants.js';

export default function FacultyProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const { run, pending } = useAsyncAction();
  const [phone, setPhone] = useState(profile?.phone ?? '');

  const save = (event) => {
    event.preventDefault();
    if (phone && !/^[0-9]{10}$/.test(phone)) return;
    run(
      async () => {
        const { error } = await supabase.from('user_profiles').update({ phone: phone || null }).eq('id', profile.id);
        if (error) throw error;
      },
      { successMessage: 'Contact details updated.', onSuccess: refreshProfile }
    );
  };

  return (
    <PortalShell>
      <PageHeader title="My profile" subtitle="Your department record and contact details." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel tab="Identity" tabIcon="badge" className="lg:col-span-2">
          <div className="flex items-center gap-4">
            <Avatar path={profile.avatar_url} name={profile.full_name} size={68} />
            <div className="min-w-0">
              <h2 className="truncate text-headline-sm text-on-surface">{profile.full_name}</h2>
              <p className="truncate text-body-sm text-on-surface-variant">{profile.email}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="chip bg-primary-fixed text-on-primary-fixed">{ROLE_LABELS[profile.role]}</span>
                {profile.role === 'faculty' && <EmploymentBadge status={profile.employment_status} />}
              </div>
            </div>
          </div>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* This page is shared by faculty, the HOD and the cluster head
                (both re-export it). Mentee capacity is meaningless for the
                latter two, so it only appears for an actual mentor. */}
            {[
              ['Staff ID', profile.login_id ?? '—'],
              ['Branch', profile.branch ?? '—'],
              ['Department', profile.department ?? '—'],
              ...(profile.role === 'faculty'
                ? [
                    ['Mentee capacity', String(profile.mentee_capacity ?? '—')],
                    ['Available for new mentees', profile.available_for_reassignment ? 'Yes' : 'No']
                  ]
                : []),
              ['Joined', formatDate(profile.created_at)]
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                <dd className="mt-0.5 text-body-sm text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel tab="Contact details" tabIcon="edit">
          <form onSubmit={save} className="space-y-4">
            <TextField label="Email" value={profile.email} disabled hint="Managed by the university." />
            <TextField
              name="phone"
              label="Mobile number"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
              hint="Shown to your mentees so they can reach you."
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
      {/* The Profile photo panel was removed from this page. The avatar is
          already shown in the Identity card above, in the sidebar and in the
          top bar, so a dedicated panel was three copies of the same face on
          one screen. Shared by faculty, HOD and cluster head. */}
    </PortalShell>
  );
}
