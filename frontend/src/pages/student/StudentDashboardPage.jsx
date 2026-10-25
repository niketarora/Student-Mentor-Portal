import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import {
  QueryStatusBadge, CategoryBadge, ResolutionBadge, MentorKindBadge, EscalationBadges
} from '../../components/ui/StatusBadge.jsx';
import { DonutChart, CategoryBarChart } from '../../components/charts/Charts.jsx';
import CreateQueryModal from '../../components/queries/CreateQueryModal.jsx';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics.js';
import { useRealtimeQueries } from '../../hooks/useRealtimeQueries.js';
import { formatRelativeTime, formatHours } from '../../lib/formatters.js';
import { CHART_COLORS } from '../../lib/constants.js';
import { queryCategoryChartData } from '../../lib/queryCategoryChart.js';

export default function StudentDashboardPage() {
  const { profile } = useAuth();
  const { metrics, loading, reload } = useDashboardMetrics();
  const { queries, reload: reloadQueries } = useRealtimeQueries({ pageSize: 5, studentId: profile?.id });
  const [createOpen, setCreateOpen] = useState(false);

  const statusData = useMemo(
    () => [
      { name: 'Open', value: metrics?.open_queries ?? 0, color: CHART_COLORS.open },
      { name: 'In Progress', value: metrics?.in_progress_queries ?? 0, color: CHART_COLORS.inProgress },
      { name: 'Resolved', value: metrics?.resolved_queries ?? 0, color: CHART_COLORS.resolved }
    ],
    [metrics]
  );

  // Every query the student has raised, counted in SQL (0041) — the same
  // total as the status donut, not just the recent list below.
  const categoryData = useMemo(() => queryCategoryChartData(metrics?.queries_by_category), [metrics]);

  const awaiting = queries.filter((t) => t.resolution_status === 'pending_confirmation');

  return (
    <PortalShell>
      <PageHeader
        title={`Welcome, ${profile?.full_name?.split(' ')[0] ?? 'Student'}`}
        subtitle="Raise a support request, follow its progress, and keep your mentorship record up to date."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <span className="material-symbols-outlined text-[18px]">add</span>
            Raise a query
          </button>
        }
      />

      {/* Mentor card — mirrors the SLCM "Class Coordinator Information" block */}
      <Panel tab="My Faculty Mentor" tabIcon="badge" className="mb-5">
        {profile?.mentor ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Name', profile.mentor.full_name],
              ['Email', profile.mentor.email],
              ['Phone', profile.mentor.phone ?? 'Not provided'],
              ['Faculty ID', profile.mentor.login_id ?? '—']
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                <dd className="mt-0.5 break-anywhere text-body-sm font-semibold text-primary">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            No mentor has been assigned to you yet. Please contact the HOD office.
          </p>
        )}
      </Panel>

      {/* The second mentor (0042): a senior or alumni mentor for the student's section. */}
      <Panel tab="My Senior Mentor" tabIcon="workspace_premium" className="mb-5">
        {profile?.senior_mentor ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Name', profile.senior_mentor.full_name],
              ['Email', profile.senior_mentor.email],
              ['Section', profile.senior_mentor.section ?? '—']
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                <dd className="mt-0.5 break-anywhere text-body-sm font-semibold text-primary">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            No senior mentor is assigned to you yet. Your queries go to your faculty mentor until one is.
          </p>
        )}
      </Panel>

      {awaiting.length > 0 && (
        <div className="mb-5 rounded-lg border-l-4 border-info bg-info-container/50 p-4">
          <p className="text-label-md text-on-surface">
            {awaiting.length} query{awaiting.length > 1 ? 's are' : ' is'} waiting for your confirmation
          </p>
          <p className="mt-0.5 text-body-sm text-on-surface-variant">
            Your mentor marked them resolved. Let us know whether the issue is actually fixed.
          </p>
          <Link to="/student/queries" className="btn-primary btn-sm mt-3">
            Review now
          </Link>
        </div>
      )}

      {loading ? (
        <SkeletonCards count={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total queries" value={metrics?.total_queries ?? 0} icon="confirmation_number" tone="primary" />
          <StatCard label="Open" value={metrics?.open_queries ?? 0} icon="pending" tone="error" caption="not yet picked up" />
          <StatCard label="In progress" value={metrics?.in_progress_queries ?? 0} icon="autorenew" tone="warning" />
          <StatCard
            label="Avg resolution time"
            value={formatHours(metrics?.avg_resolution_hours)}
            icon="timer"
            tone="success"
            caption={`${metrics?.resolved_queries ?? 0} resolved`}
          />
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Panel tab="Status mix" tabIcon="donut_small" className="lg:col-span-1">
          <DonutChart data={statusData} centerLabel="queries" height={240} />
        </Panel>
        <Panel tab="Queries by category" tabIcon="bar_chart" className="lg:col-span-2">
          <CategoryBarChart data={categoryData} height={240} allLabels />
        </Panel>
      </div>

      <Panel
        tab="My recent queries"
        tabIcon="history"
        className="mt-5"
        bodyClassName=""
        actions={null}
      >
        {queries.length === 0 ? (
          <EmptyState
            icon="confirmation_number"
            title="No queries yet"
            description="When you need academic, ERP or infrastructure help, raise a query and your mentor will pick it up."
            action={
              <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                Raise your first query
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-surface-container">
            {queries.map((query) => (
              <li key={query.id}>
                <Link
                  to={`/student/queries/${query.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-container-low"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label-md text-on-surface">{query.subject}</span>
                    <span className="text-label-sm text-tertiary">
                      {query.query_code} · updated {formatRelativeTime(query.last_message_at)}
                    </span>
                  </span>
                  <MentorKindBadge kind={query.mentor_kind} />
                  <CategoryBadge category={query.category} />
                  <QueryStatusBadge status={query.status} />
                  <ResolutionBadge resolutionStatus={query.resolution_status} />
                  <EscalationBadges query={query} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <CreateQueryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          reload();
          reloadQueries();
        }}
      />
    </PortalShell>
  );
}
