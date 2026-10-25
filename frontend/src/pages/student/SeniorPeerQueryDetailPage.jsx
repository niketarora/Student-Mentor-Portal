/**
 * SeniorPeerQueryDetailPage — /student/peer-queries/:queryId
 * One peer query, for the senior mentor it was sent to (migration 0042):
 *   * the live conversation with the junior (Realtime, as for faculty);
 *   * Mark resolved, after which the junior confirms as usual;
 *   * Ask HOD / Escalate: to the junior's faculty mentor or to the HOD,
 *     always with a reason. The faculty member or HOD then joins this
 *     same conversation and can resolve it. The junior is told it was
 *     raised, but does not see the reason.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Modal, { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { PageLoader } from '../../components/ui/Skeleton.jsx';
import { TextAreaField } from '../../components/ui/FormControls.jsx';
import {
  QueryStatusBadge, CategoryBadge, PriorityBadge, ResolutionBadge, EscalationBadges
} from '../../components/ui/StatusBadge.jsx';
import QueryConversation from '../../components/queries/QueryConversation.jsx';
import EscalationHistory from '../../components/queries/EscalationHistory.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useQueryThread } from '../../hooks/useRealtimeQueries.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { formatDateTime } from '../../lib/formatters.js';

export default function SeniorPeerQueryDetailPage() {
  const { queryId } = useParams();
  const { profile } = useAuth();
  const { query, messages, escalations, loading, error, reload, appendMessage } = useQueryThread(queryId);
  const { run, pending } = useAsyncAction();
  const [peer, setPeer] = useState(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [target, setTarget] = useState('faculty');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  // The junior's section and faculty mentor, which a senior cannot read
  // from the profiles themselves.
  const loadPeer = useCallback(async () => {
    const { data } = await supabase.rpc('get_peer_queries');
    setPeer((Array.isArray(data) ? data : []).find((row) => row.id === queryId) ?? null);
  }, [queryId]);

  useEffect(() => {
    loadPeer();
  }, [loadPeer, query?.referred_to_faculty, query?.escalated_to_hod]);

  if (loading) return <PortalShell><PageLoader label="Loading query..." /></PortalShell>;

  const isMine = query && query.mentor_kind === 'senior' && query.mentor_id === profile?.id;
  if (error || !query || !isMine) {
    return (
      <PortalShell>
        <EmptyState
          icon="error"
          title="Query not available"
          description={error ?? 'This query does not exist, or it was not sent to you.'}
          action={<Link to="/student/peer-queries" className="btn-primary">Back to peer queries</Link>}
        />
      </PortalShell>
    );
  }

  const closed = query.resolution_status === 'confirmed';
  const canResolve = !closed && (query.status !== 'Resolved' || query.resolution_status === 'reopened');
  const facultyMentor = peer?.faculty_mentor ?? null;
  const canRaiseToFaculty = Boolean(facultyMentor) && !query.referred_to_faculty;
  const canRaiseToHod = !query.escalated_to_hod;
  const canEscalate = !closed && (canRaiseToFaculty || canRaiseToHod);
  const studentName = query.student?.full_name ?? peer?.student?.full_name ?? 'the student';

  const openEscalate = () => {
    setTarget(canRaiseToFaculty ? 'faculty' : 'hod');
    setReason('');
    setReasonError('');
    setEscalateOpen(true);
  };

  const escalate = () => {
    if (!reason.trim()) {
      setReasonError('Say what your concern or doubt is, so they know how to help.');
      return;
    }
    run(
      async () => {
        const { error: rpcError } = await supabase.rpc('escalate_peer_query', {
          p_query_id: query.id,
          p_to: target,
          p_reason: reason.trim()
        });
        if (rpcError) throw rpcError;
      },
      {
        successMessage:
          target === 'hod'
            ? 'Escalated to the HOD. They can reply here; the student has been told.'
            : `Raised to ${facultyMentor?.full_name ?? 'the faculty mentor'}. They can reply here; the student has been told.`,
        onSuccess: () => {
          setEscalateOpen(false);
          reload();
          loadPeer();
        }
      }
    );
  };

  const resolve = () =>
    run(
      async () => {
        const { error: rpcError } = await supabase.rpc('resolve_support_query', { p_query_id: query.id, p_note: null });
        if (rpcError) throw rpcError;
      },
      {
        successMessage: 'Marked resolved. The student has been asked to confirm.',
        onSuccess: () => {
          setResolveOpen(false);
          reload();
        }
      }
    );

  const targets = [
    {
      value: 'faculty',
      title: "The student's faculty mentor",
      detail: facultyMentor
        ? query.referred_to_faculty
          ? `${facultyMentor.full_name} — already raised`
          : facultyMentor.full_name
        : 'This student has no faculty mentor yet',
      disabled: !canRaiseToFaculty
    },
    {
      value: 'hod',
      title: 'The HOD',
      detail: query.escalated_to_hod ? 'Already escalated' : 'The Head of Department for this student',
      disabled: !canRaiseToHod
    }
  ];

  return (
    <PortalShell>
      <PageHeader
        breadcrumb={
          <Link to="/student/peer-queries" className="hover:text-primary hover:underline">
            ← Peer queries
          </Link>
        }
        title={query.subject}
        subtitle={`${query.query_code} · from ${studentName} · ${formatDateTime(query.created_at)}`}
        actions={
          <>
            {canEscalate && (
              <button type="button" className="btn-secondary" onClick={openEscalate} disabled={pending}>
                <span className="material-symbols-outlined text-[18px]">flag</span>
                Ask HOD / Escalate
              </button>
            )}
            {canResolve && (
              <button type="button" className="btn-primary" onClick={() => setResolveOpen(true)} disabled={pending}>
                <span className="material-symbols-outlined text-[18px]">task_alt</span>
                Mark resolved
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <QueryStatusBadge status={query.status} />
        <ResolutionBadge resolutionStatus={query.resolution_status} />
        <CategoryBadge category={query.category} />
        <PriorityBadge priority={query.priority} />
        <EscalationBadges query={query} />
      </div>

      {query.resolution_status === 'reopened' && (
        <div className="mb-4 rounded-lg border-l-4 border-error bg-error-container/50 p-4">
          <p className="text-label-md text-on-surface">{studentName} reopened this query</p>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            {query.student_confirmation_comment || 'They reported the issue is not resolved.'}
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel tab="Live chat" tabIcon="forum" className="lg:col-span-2" bodyClassName="">
          <div className="h-[600px]">
            <QueryConversation
              query={query}
              messages={messages}
              onPosted={reload}
              onOptimisticMessage={appendMessage}
              readOnly={closed}
            />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel tab="Student" tabIcon="person">
            <dl className="space-y-3 text-body-sm">
              {[
                ['Name', studentName],
                ['Registration no.', query.student?.login_id ?? peer?.student?.login_id],
                ['Section', peer?.student?.section ?? query.student?.section],
                ['Email', query.student?.email],
                ['Faculty mentor', facultyMentor?.full_name ?? 'Not assigned']
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                  <dd className="mt-0.5 break-anywhere text-on-surface">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <EscalationHistory escalations={escalations} />

          <Panel tab="About peer queries" tabIcon="info">
            <ul className="space-y-2 text-body-sm text-on-surface-variant">
              <li>Replies appear for {studentName} straight away, and they get a notification.</li>
              <li>
                Not sure how to help? <strong className="text-on-surface">Ask HOD / Escalate</strong> brings in their faculty
                mentor or the HOD, who reply in this same chat.
              </li>
              <li>When you mark it resolved, {studentName} confirms whether it is fixed.</li>
            </ul>
          </Panel>
        </div>
      </div>

      <Modal
        open={escalateOpen}
        onClose={() => setEscalateOpen(false)}
        size="md"
        title="Ask for help with this query"
        description={`${studentName}'s query stays with you; whoever you choose joins this conversation and can resolve it.`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setEscalateOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={escalate} disabled={pending}>
              {pending ? 'Sending...' : target === 'hod' ? 'Escalate to HOD' : 'Raise to faculty mentor'}
            </button>
          </>
        }
      >
        <fieldset className="mb-4">
          <legend className="field-label">
            Send to <span className="text-error">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {targets.map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-2.5 rounded border px-3 py-2.5 text-body-sm ${
                  option.disabled
                    ? 'cursor-not-allowed border-outline-variant bg-surface-container-low opacity-70'
                    : target === option.value
                      ? 'cursor-pointer border-primary bg-primary-fixed/60'
                      : 'cursor-pointer border-outline-variant hover:bg-surface-container-low'
                }`}
              >
                <input
                  type="radio"
                  name="escalate-to"
                  value={option.value}
                  checked={target === option.value}
                  disabled={option.disabled}
                  onChange={() => setTarget(option.value)}
                  className="mt-0.5 text-primary focus:ring-primary"
                />
                <span>
                  <span className="block text-label-md text-on-surface">{option.title}</span>
                  <span className="block text-label-sm text-tertiary">{option.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <TextAreaField
          label="Reason"
          name="escalation-reason"
          required
          rows={4}
          maxLength={1000}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (reasonError) setReasonError('');
          }}
          error={reasonError}
          placeholder="e.g. She needs to know whether the elective counts toward her minor; I am not sure of the rule."
          hint="Your concern or doubt. They see it; the student only sees that you asked for help."
        />
      </Modal>

      <ConfirmDialog
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        onConfirm={resolve}
        pending={pending}
        title="Mark this query resolved?"
        confirmLabel="Mark resolved"
        message={`${studentName} will be asked to confirm whether the issue is actually fixed. If they say no, the query reopens and comes back to you.`}
      />
    </PortalShell>
  );
}
