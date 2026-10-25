import { Link, useParams } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PageLoader } from '../../components/ui/Skeleton.jsx';
import {
  QueryStatusBadge, CategoryBadge, PriorityBadge, ResolutionBadge, MentorKindBadge, EscalationBadges
} from '../../components/ui/StatusBadge.jsx';
import QueryConversation from '../../components/queries/QueryConversation.jsx';
import ResolutionConfirmation from '../../components/queries/ResolutionConfirmation.jsx';
import SatisfactionRating from '../../components/queries/SatisfactionRating.jsx';
import { useQueryThread } from '../../hooks/useRealtimeQueries.js';
import { formatDateTime } from '../../lib/formatters.js';
import { MENTOR_KIND_LABELS } from '../../lib/constants.js';

export default function StudentQueryDetailPage() {
  const { queryId } = useParams();
  const { query, messages, loading, error, reload, appendMessage } = useQueryThread(queryId);

  if (loading) return <PortalShell><PageLoader label="Loading query..." /></PortalShell>;

  if (error || !query) {
    return (
      <PortalShell>
        <EmptyState
          icon="error"
          title="Query not available"
          description={error ?? 'This query does not exist, or it is not yours to view.'}
          action={<Link to="/student/queries" className="btn-primary">Back to my queries</Link>}
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <PageHeader
        breadcrumb={
          <Link to="/student/queries" className="hover:text-primary hover:underline">
            ← My queries
          </Link>
        }
        title={query.subject}
        subtitle={`${query.query_code} · raised ${formatDateTime(query.created_at)}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <QueryStatusBadge status={query.status} />
        <ResolutionBadge resolutionStatus={query.resolution_status} />
        <CategoryBadge category={query.category} />
        <PriorityBadge priority={query.priority} />
        <MentorKindBadge kind={query.mentor_kind} />
        <EscalationBadges query={query} />
      </div>

      {(query.escalated_to_hod || query.referred_to_faculty) && (
        <div className="mb-4 space-y-1 rounded-lg border-l-4 border-warning bg-warning-container/40 p-4">
          {query.referred_to_faculty && (
            <p className="text-body-sm text-on-surface">
              <strong>Raised to your faculty mentor</strong>
              {query.referred_faculty?.full_name ? ` (${query.referred_faculty.full_name})` : ''} on{' '}
              {formatDateTime(query.referred_at)}. They can read and reply to this conversation.
            </p>
          )}
          {query.escalated_to_hod && (
            <p className="text-body-sm text-on-surface">
              <strong>Escalated to the HOD</strong> on {formatDateTime(query.escalated_at)}
              {query.escalation_source === 'senior' ? ' by your senior mentor' : ' by your mentor'}. The Head of
              Department can reply here and resolve it.
            </p>
          )}
        </div>
      )}

      <div className="mb-4">
        <ResolutionConfirmation query={query} onDone={reload} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel tab="Conversation" tabIcon="forum" className="lg:col-span-2" bodyClassName="">
          <div className="h-[560px]">
            <QueryConversation
              query={query}
              messages={messages}
              onPosted={reload}
              onOptimisticMessage={appendMessage}
              readOnly={query.resolution_status === 'confirmed'}
            />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel tab="Details" tabIcon="info">
            <dl className="space-y-3 text-body-sm">
              {[
                ['Sent to', MENTOR_KIND_LABELS[query.mentor_kind] ?? MENTOR_KIND_LABELS.faculty],
                ['Mentor', query.mentor?.full_name ?? '—'],
                ['Mentor email', query.mentor?.email ?? '—'],
                ['Raised on', formatDateTime(query.created_at)],
                ['Last update', formatDateTime(query.last_message_at)],
                ['Resolved on', query.resolved_at ? formatDateTime(query.resolved_at) : 'Not yet'],
                ['Times reopened', String(query.reopen_count ?? 0)]
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                  <dd className="mt-0.5 break-anywhere text-on-surface">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          {query.status === 'Resolved' && (
            <Panel tab="Your feedback" tabIcon="star">
              <SatisfactionRating query={query} onRated={reload} />
            </Panel>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
