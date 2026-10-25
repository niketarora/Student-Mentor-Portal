/**
 * FEATURE 7 companion — the star mentee's read-only view of every query
 * raised inside their mentor group.
 *
 * Strictly view-only, and enforced in the database rather than here: the
 * get_mentor_group_queries() function returns a narrow projection with no
 * query ids, no message bodies, no emails and no registration numbers, so
 * there is nothing to click through to. The representative can see what
 * their group is struggling with; they cannot reply, resolve, or open a
 * classmate's profile.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { SelectField } from '../../components/ui/FormControls.jsx';
import { QueryStatusBadge, CategoryBadge, PriorityBadge } from '../../components/ui/StatusBadge.jsx';
import { CategoryBarChart, DonutChart } from '../../components/charts/Charts.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { CHART_COLORS, QUERY_CATEGORIES, QUERY_STATUSES } from '../../lib/constants.js';
import { countQueriesByCategory, queryCategoryChartData } from '../../lib/queryCategoryChart.js';
import { describeError, formatRelativeTime } from '../../lib/formatters.js';

export default function StudentGroupQueriesPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const [queries, setQueries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');
  const [category, setCategory] = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_mentor_group_queries');
    if (error) toast.error(describeError(error));
    setQueries(data ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    if (profile?.is_star_mentee) load();
  }, [profile?.is_star_mentee, load]);

  // Live: a classmate raising a query shows up without a refresh.
  useEffect(() => {
    if (!profile?.is_star_mentee) return undefined;
    const channel = supabase
      .channel('group-queries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_queries' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.is_star_mentee, load]);

  const filtered = useMemo(
    () =>
      queries.filter(
        (t) => (status === 'All' || t.status === status) && (category === 'All' || t.category === category)
      ),
    [queries, status, category]
  );

  const charts = useMemo(() => {
    const count = (key, value) => queries.filter((t) => t[key] === value).length;
    return {
      category: queryCategoryChartData(countQueriesByCategory(queries)),
      status: [
        { name: 'Open', value: count('status', 'Open'), color: CHART_COLORS.open },
        { name: 'In Progress', value: count('status', 'In Progress'), color: CHART_COLORS.inProgress },
        { name: 'Resolved', value: count('status', 'Resolved'), color: CHART_COLORS.resolved }
      ]
    };
  }, [queries]);

  // Not the representative (or no longer) — nothing to show.
  if (profile && !profile.is_star_mentee) return <Navigate to="/student" replace />;

  return (
    <PortalShell>
      <PageHeader
        title="Group queries"
        subtitle={`Every query raised by students mentored by ${profile?.mentor?.full_name ?? 'your mentor'}. View-only.`}
      />

      <div className="mb-4 flex items-start gap-3 rounded-lg border-l-4 border-info bg-info-container/50 p-4">
        <span className="material-symbols-outlined text-[22px] text-info" aria-hidden="true">info</span>
        <p className="text-body-sm text-on-surface-variant">
          You can see this because your mentor made you the <strong>student representative</strong>. It is a
          read-only overview — you cannot reply to these queries, resolve them, or open another student&apos;s
          profile.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queries in the group" value={queries.length} icon="groups" tone="primary" />
        <StatCard label="Open" value={charts.status[0].value} icon="pending" tone="error" />
        <StatCard label="In progress" value={charts.status[1].value} icon="autorenew" tone="warning" />
        <StatCard label="Resolved" value={charts.status[2].value} icon="task_alt" tone="success" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel tab="By category" tabIcon="bar_chart" className="lg:col-span-2">
          <CategoryBarChart data={charts.category} height={230} allLabels />
        </Panel>
        <Panel tab="By status" tabIcon="donut_small">
          <DonutChart data={charts.status} centerLabel="queries" height={230} />
        </Panel>
      </div>

      <Panel tab="Filters" tabIcon="filter_alt" className="mt-4">
        <div className="flex flex-wrap items-end gap-4">
          <SelectField
            label="Status"
            className="w-full sm:w-56"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={['All', ...QUERY_STATUSES]}
          />
          <SelectField
            label="Category"
            className="w-full sm:w-56"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            options={['All', ...QUERY_CATEGORIES]}
          />
        </div>
      </Panel>

      {loading ? (
        <SkeletonTable rows={6} columns={6} />
      ) : (
        <Panel className="mt-4" bodyClassName="">
          <DataTable
            columns={[
              {
                key: 'query_code',
                header: 'Ref',
                render: (row) => <span className="font-semibold text-primary">{row.query_code}</span>
              },
              {
                key: 'subject',
                header: 'Subject',
                render: (row) => (
                  <span>
                    <span className="block text-on-surface">{row.subject}</span>
                    {row.is_mine && <span className="text-label-sm text-tertiary">raised by you</span>}
                  </span>
                )
              },
              {
                key: 'student_name',
                header: 'Student',
                render: (row) => (
                  <span>
                    <span className="block text-on-surface">{row.student_name}</span>
                    <span className="text-label-sm text-tertiary">Section {row.section ?? '—'}</span>
                  </span>
                )
              },
              { key: 'category', header: 'Category', render: (row) => <CategoryBadge category={row.category} /> },
              { key: 'priority', header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
              { key: 'status', header: 'Status', render: (row) => <QueryStatusBadge status={row.status} /> },
              {
                key: 'last_message_at',
                header: 'Last update',
                render: (row) => <span className="text-tertiary">{formatRelativeTime(row.last_message_at)}</span>
              }
            ]}
            rows={filtered}
            rowKey={(row) => row.query_code}
            emptyState={
              <EmptyState
                icon="inbox"
                title={queries.length ? 'Nothing matches these filters' : 'No queries in your group yet'}
                description={
                  queries.length
                    ? 'Try a different status or category.'
                    : 'When students in your mentor group raise queries, they will appear here.'
                }
              />
            }
          />
        </Panel>
      )}
    </PortalShell>
  );
}
