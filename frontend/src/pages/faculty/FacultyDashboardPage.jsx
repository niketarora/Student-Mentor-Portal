import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { QueryStatusBadge, CategoryBadge, PriorityBadge, ResolutionBadge } from '../../components/ui/StatusBadge.jsx';
import { DonutChart, CategoryBarChart, GaugeChart } from '../../components/charts/Charts.jsx';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics.js';
import { useRealtimeQueries } from '../../hooks/useRealtimeQueries.js';
import { formatRelativeTime, formatHours, percentage } from '../../lib/formatters.js';
import { CHART_COLORS } from '../../lib/constants.js';
import { queryCategoryChartData } from '../../lib/queryCategoryChart.js';

export default function FacultyDashboardPage() {
  const { profile } = useAuth();
  const { metrics, loading } = useDashboardMetrics();
  const { queries } = useRealtimeQueries({ pageSize: 8, mentorId: profile?.id });

  const needsAttention = queries.filter(
    (t) => t.status === 'Open' || t.resolution_status === 'reopened'
  );

  const statusData = useMemo(
    () => [
      { name: 'Open', value: metrics?.open_queries ?? 0, color: CHART_COLORS.open },
      { name: 'In Progress', value: metrics?.in_progress_queries ?? 0, color: CHART_COLORS.inProgress },
      { name: 'Resolved', value: metrics?.resolved_queries ?? 0, color: CHART_COLORS.resolved }
    ],
    [metrics]
  );

  // Every query assigned to this mentor, counted in SQL (0041).
  const categoryData = useMemo(() => queryCategoryChartData(metrics?.queries_by_category), [metrics]);

  const weekOverWeek = (metrics?.resolved_this_week ?? 0) - (metrics?.resolved_last_week ?? 0);

  return (
    <PortalShell>
      <PageHeader
        title={`Good to see you, ${profile?.full_name?.split(' ').slice(-1)[0] ?? 'Professor'}`}
        subtitle="Your mentee group, your query queue and how you are tracking this week."
        actions={
          <>
            <Link to="/faculty/queries" className="btn-secondary">
              <span className="material-symbols-outlined text-[18px]">inbox</span>
              Query queue
            </Link>
            <Link to="/faculty/report" className="btn-primary">
              <span className="material-symbols-outlined text-[18px]">analytics</span>
              My report
            </Link>
          </>
        }
      />

      {loading ? (
        <SkeletonCards count={4} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Assigned mentees" value={metrics?.mentee_count ?? 0} icon="groups" tone="primary"
              caption={`${metrics?.onboarding_pending ?? 0} yet to submit Form A`} />
            <StatCard label="Open queries" value={metrics?.open_queries ?? 0} icon="pending" tone="error"
              caption="waiting for your first reply" />
            <StatCard label="In progress" value={metrics?.in_progress_queries ?? 0} icon="autorenew" tone="warning" />
            <StatCard label="Resolved" value={metrics?.resolved_queries ?? 0} icon="task_alt" tone="success"
              caption={`${metrics?.resolved_this_week ?? 0} this week`} trend={weekOverWeek} />
          </div>

          {/* "My Impact" panel */}
          <div className="mt-5 grid gap-4 lg:grid-cols-4">
            <Panel tab="My impact" tabIcon="insights" className="lg:col-span-2">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-label-sm uppercase tracking-wide text-tertiary">Avg first response</p>
                  <p className="mt-1 text-headline-md text-on-surface">{formatHours(metrics?.avg_first_response_hours)}</p>
                  <p className="text-label-sm text-tertiary">time to your first reply</p>
                </div>
                <div>
                  <p className="text-label-sm uppercase tracking-wide text-tertiary">Avg resolution</p>
                  <p className="mt-1 text-headline-md text-on-surface">{formatHours(metrics?.avg_resolution_hours)}</p>
                  <p className="text-label-sm text-tertiary">raised to resolved</p>
                </div>
                <div>
                  <p className="text-label-sm uppercase tracking-wide text-tertiary">Satisfaction</p>
                  <p className="mt-1 text-headline-md text-on-surface">
                    {metrics?.avg_satisfaction ? `${metrics.avg_satisfaction}/5` : '—'}
                  </p>
                  <p className="text-label-sm text-tertiary">from student ratings</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 border-t border-surface-container pt-4 sm:grid-cols-3">
                <div className="rounded bg-surface-container-low p-3">
                  <p className="text-label-sm text-tertiary">Awaiting student confirmation</p>
                  <p className="text-headline-sm text-on-surface">{metrics?.awaiting_confirmation ?? 0}</p>
                </div>
                <div className="rounded bg-surface-container-low p-3">
                  <p className="text-label-sm text-tertiary">Reopened by students</p>
                  <p className="text-headline-sm text-error">{metrics?.reopened_queries ?? 0}</p>
                </div>
                <div className="rounded bg-surface-container-low p-3">
                  <p className="text-label-sm text-tertiary">Star mentee</p>
                  <p className="truncate text-body-md font-semibold text-on-surface">
                    {metrics?.star_mentee?.name ?? 'Not set'}
                  </p>
                </div>
              </div>
            </Panel>

            <Panel tab="Resolution rate" tabIcon="speed">
              <GaugeChart
                value={percentage(metrics?.resolved_queries, metrics?.total_queries, 1)}
                label="resolved"
                height={210}
              />
            </Panel>

            <Panel tab="Status mix" tabIcon="donut_small">
              <DonutChart data={statusData} centerLabel="queries" height={210} />
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Panel tab="Load by category" tabIcon="bar_chart">
              <CategoryBarChart data={categoryData} height={230} allLabels />
            </Panel>

            <Panel tab="Needs your attention" tabIcon="priority_high" className="lg:col-span-2" bodyClassName="">
              {needsAttention.length === 0 ? (
                <EmptyState
                  icon="check_circle"
                  title="Nothing urgent right now"
                  description="No unanswered or reopened queries in your queue. Nice work."
                />
              ) : (
                <ul className="divide-y divide-surface-container">
                  {needsAttention.slice(0, 6).map((query) => (
                    <li key={query.id}>
                      <Link
                        to={`/faculty/queries/${query.id}`}
                        className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-container-low"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label-md text-on-surface">{query.subject}</span>
                          <span className="text-label-sm text-tertiary">
                            {query.student?.full_name} · {query.query_code} ·{' '}
                            {formatRelativeTime(query.last_message_at)}
                          </span>
                        </span>
                        <PriorityBadge priority={query.priority} />
                        <CategoryBadge category={query.category} />
                        <QueryStatusBadge status={query.status} />
                        <ResolutionBadge resolutionStatus={query.resolution_status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </PortalShell>
  );
}
