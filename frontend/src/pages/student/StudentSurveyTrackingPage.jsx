/**
 * StudentSurveyTrackingPage
 * The student representative's follow-up list: how many of their mentor
 * group have filled in the current survey, and who has not, so they can
 * chase people.
 *
 * Backed by get_mentor_group_survey_status() — a narrow read-only
 * projection, the same technique as get_mentor_group_queries(). The rep
 * sees names and a yes/no, never anyone's ratings and never an email
 * address. Visible only when is_star_mentee is true; the nav item carries
 * the same `when` predicate as Group Queries.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { FilterPills } from '../../components/ui/FormControls.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { describeError, formatDate } from '../../lib/formatters.js';

const FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'pending', label: 'Not yet filled' },
  { value: 'done', label: 'Filled in' }
];

export default function StudentSurveyTrackingPage() {
  const { profile } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_mentor_group_survey_status');
    if (error) toast.error(describeError(error));
    setRows(data ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'pending') return rows.filter((row) => !row.has_submitted);
    if (filter === 'done') return rows.filter((row) => row.has_submitted);
    return rows;
  }, [rows, filter]);

  // Belt and braces alongside the nav predicate — a rep who is un-starred
  // while the tab is open should not be left on a page that now 403s.
  if (profile && !profile.is_star_mentee) {
    return <Navigate to="/student" replace />;
  }

  const submitted = rows.filter((row) => row.has_submitted).length;
  const cycle = rows[0];
  const percent = rows.length ? Math.round((submitted / rows.length) * 100) : 0;

  const columns = [
    {
      key: 'student_name',
      header: 'Student',
      render: (row) => (
        <span>
          {row.student_name}
          {row.is_me && <span className="ml-2 chip bg-primary-fixed text-on-primary-fixed">You</span>}
        </span>
      )
    },
    { key: 'registration_no', header: 'Reg. no.' },
    { key: 'section', header: 'Section', align: 'center' },
    {
      key: 'has_submitted',
      header: 'Survey',
      render: (row) =>
        row.has_submitted ? (
          <span className="chip bg-success-container text-on-success-container">Filled in</span>
        ) : (
          <span className="chip bg-warning-container text-on-warning-container">Pending</span>
        )
    }
  ];

  return (
    <PortalShell>
      <PageHeader
        title="Survey tracking"
        subtitle={
          cycle
            ? `Survey #${cycle.cycle_number} for your mentor group · closes ${formatDate(cycle.closes_on)}`
            : 'Completion status for your mentor group.'
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Students in group" value={rows.length} icon="groups" tone="primary" />
        <StatCard label="Filled in" value={submitted} icon="task_alt" tone="success" />
        <StatCard label="Still pending" value={rows.length - submitted} icon="pending_actions" tone="warning" />
        <StatCard label="Completion" value={`${percent}%`} icon="donut_large" tone="info" />
      </div>

      {loading ? (
        <SkeletonTable rows={6} columns={4} />
      ) : (
        <Panel
          tab="Who has responded"
          tabIcon="fact_check"
          bodyClassName=""
          actions={<FilterPills options={FILTERS} value={filter} onChange={setFilter} ariaLabel="Filter students" />}
        >
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => `${row.registration_no}-${row.student_name}`}
            emptyState={
              <EmptyState
                icon="ballot"
                title={rows.length ? 'Nobody in this group' : 'No survey is open right now'}
                description={
                  rows.length
                    ? 'Try a different filter.'
                    : 'A new survey opens every 15 days. Completion tracking appears here once it does.'
                }
              />
            }
          />
        </Panel>
      )}

      <Panel className="mt-4" tab="What you can see" tabIcon="lock">
        <p className="text-body-sm text-on-surface-variant">
          You can see whether each person in your mentor group has submitted, so you can remind whoever
          has not. You cannot see anyone&apos;s answers — those go only to the mentor and the department.
        </p>
      </Panel>
    </PortalShell>
  );
}
