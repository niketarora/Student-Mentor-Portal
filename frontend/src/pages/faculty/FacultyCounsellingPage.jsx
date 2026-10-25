/**
 * FacultyCounsellingPage
 * Every mentee who has asked to talk, with what they said. RLS scopes it
 * to this mentor's own requests — the explicit filter is only to keep the
 * query narrow.
 *
 * Not mounted with isHodView, unlike the other shared faculty pages: the
 * brief says these go to the assigned mentor, and migration 0029's policy
 * enforces that. An HOD opening this route would see nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { TextAreaField, FilterPills } from '../../components/ui/FormControls.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { COUNSELLING_STATUS, counsellingTypeLabel } from '../../lib/constants.js';
import { describeError, formatDateTime, formatRelativeTime, initialsOf } from '../../lib/formatters.js';

const FILTERS = [
  { value: 'open', label: 'Needs a reply' },
  { value: 'all', label: 'Everyone' },
  { value: 'closed', label: 'Closed' }
];

export default function FacultyCounsellingPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const { run, pending } = useAsyncAction();

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('counselling_requests')
      .select('*, student:student_id (id, full_name, login_id, section, branch, email, phone)')
      .eq('mentor_id', profile.id)
      .order('created_at', { ascending: false });
    if (error) toast.error(describeError(error));
    setRequests(data ?? []);
    setLoading(false);
  }, [profile.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const respond = (close) =>
    run(
      async () => {
        if (!close && !note.trim()) throw new Error('Write a reply, or use "Reply and close".');
        const { error } = await supabase.rpc('respond_to_counselling', {
          p_request_id: target.id,
          p_note: note.trim() || null,
          p_close: close
        });
        if (error) throw error;
      },
      {
        successMessage: close ? 'Replied and closed.' : 'Reply sent to the student.',
        onSuccess: () => {
          setTarget(null);
          setNote('');
          load();
        }
      }
    );

  const filtered = useMemo(() => {
    if (filter === 'open') return requests.filter((r) => r.status !== 'closed');
    if (filter === 'closed') return requests.filter((r) => r.status === 'closed');
    return requests;
  }, [requests, filter]);

  const awaiting = requests.filter((r) => r.status === 'open').length;

  return (
    <PortalShell>
      <PageHeader
        title="Counselling"
        subtitle="Mentees who have asked to talk, and what they said. Visible only to you."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Waiting on you"
          value={awaiting}
          icon="pending_actions"
          tone={awaiting ? 'error' : 'success'}
          caption={awaiting ? 'No reply sent yet' : 'All caught up'}
        />
        <StatCard
          label="In conversation"
          value={requests.filter((r) => r.status === 'acknowledged').length}
          icon="forum"
          tone="warning"
        />
        <StatCard
          label="Closed"
          value={requests.filter((r) => r.status === 'closed').length}
          icon="task_alt"
          tone="slate"
        />
        <StatCard
          label="Students"
          value={new Set(requests.map((r) => r.student_id)).size}
          icon="groups"
          tone="primary"
          caption="who have reached out"
        />
      </div>

      <Panel className="mb-4" tab="Show" tabIcon="filter_alt">
        <FilterPills
          ariaLabel="Filter counselling requests"
          options={FILTERS.map((f) => ({
            ...f,
            count:
              f.value === 'all'
                ? requests.length
                : f.value === 'closed'
                  ? requests.filter((r) => r.status === 'closed').length
                  : requests.filter((r) => r.status !== 'closed').length
          }))}
          value={filter}
          onChange={setFilter}
        />
      </Panel>

      {loading ? (
        <SkeletonCards count={3} />
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon="volunteer_activism"
            title={requests.length ? 'Nothing in this filter' : 'No one has reached out'}
            description={
              requests.length
                ? 'Try a different filter.'
                : 'When a mentee sends something from their Counselling page, it appears here and you get a notification.'
            }
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {filtered.map((request) => {
            const status = COUNSELLING_STATUS[request.status] ?? COUNSELLING_STATUS.open;
            const student = request.student;
            const typeLabel = counsellingTypeLabel(request.counselling_type);
            return (
              <Panel key={request.id} bodyClassName="p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-label-sm font-semibold text-on-primary-fixed"
                  >
                    {initialsOf(student?.full_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/faculty/mentees/${request.student_id}`}
                      className="text-label-md text-on-surface hover:text-primary hover:underline"
                    >
                      {student?.full_name ?? 'Student'}
                    </Link>
                    <p className="text-label-sm text-tertiary">
                      {student?.login_id ?? '—'}
                      {student?.section ? ` · Section ${student.section}` : ''} ·{' '}
                      {formatRelativeTime(request.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {typeLabel && <span className="chip bg-primary-fixed text-on-primary-fixed">{typeLabel}</span>}
                    <span className={`chip ${status.className}`}>{status.mentorLabel}</span>
                  </div>
                </div>

                <p className="mt-4 whitespace-pre-wrap text-body-sm text-on-surface">{request.concern}</p>

                {request.mentor_note && (
                  <div className="mt-4 rounded-lg bg-surface-container-low p-4">
                    <p className="text-label-sm uppercase tracking-wide text-tertiary">
                      Your reply · {formatDateTime(request.responded_at)}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-body-sm text-on-surface-variant">
                      {request.mentor_note}
                    </p>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-surface-container pt-4">
                  {student?.phone && (
                    <a href={`tel:${student.phone}`} className="btn-ghost btn-sm">
                      <span className="material-symbols-outlined text-[16px]">call</span>
                      {student.phone}
                    </a>
                  )}
                  {student?.email && (
                    <a href={`mailto:${student.email}`} className="btn-ghost btn-sm break-anywhere">
                      <span className="material-symbols-outlined text-[16px]">mail</span>
                      Email
                    </a>
                  )}
                  {request.status !== 'closed' && (
                    <button
                      type="button"
                      className="btn-primary btn-sm ml-auto"
                      onClick={() => {
                        setTarget(request);
                        setNote('');
                      }}
                    >
                      {request.mentor_note ? 'Add a reply' : 'Reply'}
                    </button>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        size="md"
        title={`Reply to ${target?.student?.full_name ?? 'your mentee'}`}
        description="They see this on their own Counselling page and get a notification."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="btn-secondary" onClick={() => respond(false)} disabled={pending}>
              Send reply
            </button>
            <button type="button" className="btn-primary" onClick={() => respond(true)} disabled={pending}>
              {pending ? 'Saving...' : 'Reply and close'}
            </button>
          </>
        }
      >
        {target?.counselling_type && (
          <p className="mb-2 text-label-sm uppercase tracking-wide text-tertiary">
            {counsellingTypeLabel(target.counselling_type)}
          </p>
        )}
        <p className="mb-3 whitespace-pre-wrap rounded bg-surface-container-low p-3 text-body-sm text-on-surface-variant">
          {target?.concern}
        </p>
        <TextAreaField
          label="Your reply"
          name="mentor-note"
          rows={5}
          maxLength={3000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          hint="Closing marks it handled. Reply without closing to keep it on your list."
        />
      </Modal>
    </PortalShell>
  );
}
