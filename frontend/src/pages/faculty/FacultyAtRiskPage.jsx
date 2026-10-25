/**
 * FacultyAtRiskPage
 * The at-risk roster, kept as its OWN section rather than mixed into My
 * Mentees — that separation is the whole point of the request: a mentor
 * should be able to see at a glance who is at risk and how to reach their
 * parents, without scanning a full mentee list for red flags.
 *
 * Every column a mentor needs to act is on the row: attendance, GPA,
 * backlog count, why they were flagged, and the parent contact number.
 * Clicking the student's name opens their existing full profile page —
 * the same FacultyMenteeDetailPage the mentee list links to, so there is
 * no second, divergent student view.
 *
 * Mounted twice (§ "Reuse pattern"): /faculty/at-risk and, with isHodView,
 * /hod/at-risk. Change one, check both.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { fetchAllRows } from '../../lib/fetchAllRows.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { describeError, formatDate, formatDateTime, initialsOf } from '../../lib/formatters.js';
import { AT_RISK_MEETING_STATUS_LABELS } from '../../lib/constants.js';
import { useActiveCycle } from '../../hooks/useActiveCycle.js';
import { cycleLabel } from '../../lib/academicCycles.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

function ReasonChips({ row }) {
  const chips = [
    row.low_attendance && { label: 'Attendance', tone: 'bg-error-container text-on-error-container' },
    row.low_gpa && { label: 'GPA', tone: 'bg-warning-container text-on-warning-container' },
    row.has_backlog && { label: 'Backlog', tone: 'bg-info-container text-on-info-container' },
    row.has_black_dot && { label: 'Black dot', tone: 'bg-inverse-surface text-inverse-on-surface' }
  ].filter(Boolean);

  if (!chips.length) return <span className="text-tertiary">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip.label} className={`chip ${chip.tone}`}>
          {chip.label}
        </span>
      ))}
    </span>
  );
}

/**
 * The things a mentor asks next: WHICH subjects, WHICH semester, and
 * WHICH incident. All come from tables and views that are already
 * RLS-scoped to this student — student_attendance_overview is one row per
 * course (latest period, active cycle), can_view_student_gpa() gates the
 * GPA rows, and the black dots are the ones in the active academic cycle,
 * the only ones the at-risk rule counts.
 *
 * Fetched on expand rather than up front: a mentor opens one or two of
 * these, not twenty, and the roster query stays a single round trip.
 */
function RiskDetail({ studentId, cycleId, cycleName }) {
  const [state, setState] = useState({ loading: true, subjects: [], gpas: [], dots: [] });

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase
        .from('student_attendance_overview')
        .select('course_id, course_code, course_name, section_label, attendance_percent')
        .eq('student_id', studentId)
        .lt('attendance_percent', 75)
        .order('attendance_percent'),
      supabase
        .from('student_semester_gpas')
        .select('semester_number, gpa')
        .eq('student_id', studentId)
        .order('semester_number'),
      cycleId
        ? supabase
            .from('student_black_dots')
            .select('case_number, case_details, incident_date, incident_date_text')
            .eq('student_id', studentId)
            .eq('cycle_id', cycleId)
            .order('incident_date', { ascending: false, nullsFirst: false })
        : Promise.resolve({ data: [] })
    ]).then(([subjects, gpas, dots]) => {
      if (!active) return;
      setState({ loading: false, subjects: subjects.data ?? [], gpas: gpas.data ?? [], dots: dots.data ?? [] });
    });
    return () => { active = false; };
  }, [studentId, cycleId]);

  if (state.loading) {
    return <p className="px-4 py-6 text-body-sm text-tertiary">Loading the breakdown...</p>;
  }

  return (
    <div className="grid gap-4 bg-surface-container-low p-4 lg:grid-cols-2">
      <Panel tab={`Subjects with low attendance (${state.subjects.length})`} tabIcon="bar_chart" bodyClassName="">
        <DataTable
          dense
          columns={[
            { key: 'course_code', header: 'Subject code' },
            { key: 'course_name', header: 'Subject name' },
            { key: 'section_label', header: 'Section', align: 'center' },
            {
              key: 'attendance_percent',
              header: 'Attendance',
              align: 'right',
              render: (row) => (
                <span className="text-error">
                  {Number(row.attendance_percent).toFixed(1)}%
                </span>
              )
            }
          ]}
          rows={state.subjects}
          rowKey={(row) => row.course_id}
          emptyState={
            <EmptyState
              icon="fact_check"
              title="No subject below 75%"
              description="This student was flagged on GPA or backlogs rather than attendance."
            />
          }
        />
      </Panel>

      <Panel tab="Semester-wise GPA" tabIcon="school" bodyClassName="">
        <DataTable
          dense
          columns={[
            { key: 'semester_number', header: 'Semester', render: (row) => `Semester ${row.semester_number}` },
            {
              key: 'gpa',
              header: 'GPA',
              align: 'right',
              render: (row) => (
                <span className={Number(row.gpa) < 6 ? 'text-error' : 'text-on-surface'}>
                  {Number(row.gpa).toFixed(2)}
                </span>
              )
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) =>
                Number(row.gpa) < 6 ? (
                  <span className="chip bg-error-container text-on-error-container">Low GPA</span>
                ) : (
                  <span className="chip bg-success-container text-on-success-container">Good</span>
                )
            }
          ]}
          rows={state.gpas}
          rowKey={(row) => row.semester_number}
          emptyState={
            <EmptyState
              icon="school"
              title="No GPA on record"
              description="Nothing has been published for this student yet."
            />
          }
        />
      </Panel>

      {state.dots.length > 0 && (
        <Panel
          className="lg:col-span-2"
          tab={`Black dots in ${cycleName} (${state.dots.length})`}
          tabIcon="gavel"
          bodyClassName=""
        >
          <DataTable
            dense
            columns={[
              { key: 'case_number', header: 'Case', render: (row) => <span className="whitespace-nowrap">{row.case_number}</span> },
              { key: 'case_details', header: 'About', render: (row) => row.case_details || '—' },
              {
                key: 'incident_date',
                header: 'Incident',
                render: (row) => (row.incident_date ? formatDate(row.incident_date) : row.incident_date_text || '—')
              }
            ]}
            rows={state.dots}
            rowKey={(row) => row.case_number}
          />
        </Panel>
      )}
    </div>
  );
}

export default function FacultyAtRiskPage({ isHodView = false }) {
  const { departmentBase } = usePortalPaths();
  const { profile } = useAuth();
  const toast = useToast();
  const { run, pending } = useAsyncAction();
  const { cycle } = useActiveCycle();
  const cycleName = cycle ? cycleLabel(cycle.label) : 'this cycle';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  const basePath = isHodView ? `${departmentBase}/students` : '/faculty/mentees';

  const load = useCallback(async () => {
    setLoading(true);
    // RLS already scopes this view: a mentor sees their own mentees, the
    // HOD sees everyone. The explicit filter is a UX choice, not a
    // security one.
    //
    // Paged, because the HOD's list is department-wide and PostgREST
    // returns at most 1,000 rows per request. student_id breaks ties so no
    // student lands on two pages or none.
    const { data, error } = await fetchAllRows((withCount) => {
      let query = supabase
        .from('at_risk_student_overview')
        .select('*', withCount ? { count: 'exact' } : undefined)
        .eq('is_at_risk', true)
        .order('attendance_percent', { nullsFirst: false })
        .order('student_id');
      if (!isHodView) query = query.eq('assigned_mentor_id', profile.id);
      return query;
    });
    if (error) toast.error(describeError(error));
    setRows(data ?? []);
    setLoading(false);
  }, [isHodView, profile.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const markMeetingDone = (row) =>
    run(
      async () => {
        const { error } = await supabase.rpc('set_at_risk_meeting_status', {
          p_meeting_id: row.open_meeting_id,
          p_status: 'completed'
        });
        if (error) throw error;
      },
      { successMessage: `Meeting with ${row.student_name} marked as done.`, onSuccess: load }
    );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        row.student_name?.toLowerCase().includes(term) ||
        row.registration_no?.toLowerCase().includes(term) ||
        row.section?.toLowerCase().includes(term)
    );
  }, [rows, search]);

  const columns = [
    {
      key: 'student_name',
      header: 'Student',
      render: (row) => (
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-label-sm font-semibold text-on-primary-fixed"
          >
            {initialsOf(row.student_name)}
          </span>
          <Link
            to={`${basePath}/${row.student_id}`}
            className="min-w-0 text-on-surface hover:text-primary hover:underline"
          >
            {row.student_name}
          </Link>
        </span>
      )
    },
    {
      key: 'registration_no',
      header: 'Registration no.',
      render: (row) => row.registration_no ?? row.email
    },
    {
      key: 'backlog_count',
      header: 'Backlogs',
      align: 'right',
      render: (row) =>
        row.backlog_count > 0 ? (
          <span className="text-error">{row.backlog_count}</span>
        ) : (
          <span className="text-tertiary">0</span>
        )
    },
    {
      // In the active academic cycle: the only black dots the rule counts.
      key: 'black_dot_count',
      header: 'Black dots',
      align: 'right',
      render: (row) =>
        row.black_dot_count > 0 ? (
          <span className="text-error">{row.black_dot_count}</span>
        ) : (
          <span className="text-tertiary">0</span>
        )
    },
    { key: 'reasons', header: 'Flagged for', render: (row) => <ReasonChips row={row} /> },
    {
      key: 'primary_parent_mobile',
      header: 'Parent contact',
      render: (row) => {
        if (!row.primary_parent_mobile) {
          return <span className="text-tertiary">Not on Form A</span>;
        }
        const name = row.father_mobile ? row.father_name : row.mother_name;
        return (
          <span className="break-anywhere">
            <a href={`tel:${row.primary_parent_mobile}`} className="text-primary hover:underline">
              {row.primary_parent_mobile}
            </a>
            {name && <span className="block text-label-sm text-tertiary">{name}</span>}
          </span>
        );
      }
    },
    ...(isHodView ? [{ key: 'mentor_name', header: 'Mentor' }] : []),
    {
      key: 'open_meeting_status',
      header: 'Meeting',
      render: (row) => {
        if (!row.open_meeting_id) {
          return <span className="text-tertiary">Not raised yet</span>;
        }
        return (
          <span>
            <span className="chip bg-warning-container text-on-warning-container">
              {AT_RISK_MEETING_STATUS_LABELS[row.open_meeting_status] ?? row.open_meeting_status}
            </span>
            <span className="mt-0.5 block text-label-sm text-tertiary">
              {formatDateTime(row.open_meeting_created_at)}
            </span>
          </span>
        );
      }
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <span className="flex items-center justify-end gap-1">
          {row.open_meeting_id && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => markMeetingDone(row)}
              disabled={pending}
            >
              <span className="material-symbols-outlined text-[16px]">check</span>
              Mark done
            </button>
          )}
          <button
            type="button"
            className="rounded p-1.5 text-tertiary hover:bg-surface-container hover:text-on-surface"
            aria-expanded={expanded === row.student_id}
            aria-label={
              expanded === row.student_id
                ? `Hide the breakdown for ${row.student_name}`
                : `Show why ${row.student_name} is flagged`
            }
            onClick={() =>
              setExpanded((current) => (current === row.student_id ? null : row.student_id))
            }
          >
            <span className="material-symbols-outlined text-[20px]">
              {expanded === row.student_id ? 'expand_less' : 'expand_more'}
            </span>
          </button>
        </span>
      )
    }
  ];

  const withoutLink = rows.filter((row) => row.open_meeting_id && !row.open_meeting_join_url).length;

  return (
    <PortalShell searchPlaceholder="Search at-risk students..." onSearch={setSearch}>
      <PageHeader
        title="At-risk students"
        subtitle={
          isHodView
            ? 'Every student in the department currently flagged on attendance, GPA, backlogs or black dots, with parent contact details.'
            : 'Your mentees currently flagged on attendance, GPA, backlogs or black dots. Click a name to open their full profile.'
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Flagged students" value={rows.length} icon="e911_emergency" tone="error" />
        <StatCard
          label="Low attendance"
          value={rows.filter((row) => row.low_attendance).length}
          icon="event_busy"
          tone="warning"
          caption="Below 75%"
        />
        <StatCard
          label="Low GPA"
          value={rows.filter((row) => row.low_gpa).length}
          icon="trending_down"
          tone="warning"
          caption="Below 6"
        />
        <StatCard
          label="With backlogs"
          value={rows.filter((row) => row.has_backlog).length}
          icon="assignment_late"
          tone="info"
          caption="One is enough to flag"
        />
        <StatCard
          label="With black dots"
          value={rows.filter((row) => row.has_black_dot).length}
          icon="gavel"
          tone="slate"
          caption={`One in ${cycleName} is enough to flag`}
        />
      </div>

      {withoutLink > 0 && (
        <div className="mb-4 rounded-xl border border-topbar-border bg-primary-fixed/40 px-4 py-3">
          <p className="text-body-sm text-on-surface-variant">
            <span className="material-symbols-outlined mr-1 align-middle text-[18px] text-primary">info</span>
            {withoutLink} meeting{withoutLink === 1 ? '' : 's'} {withoutLink === 1 ? 'is' : 'are'} waiting on a
            join link. The meeting platform (Teams or Google Meet) has not been finalised yet, so links are
            not being generated — contact the student directly in the meantime.
          </p>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={6} columns={7} />
      ) : (
        <Panel bodyClassName="">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.student_id}
            renderExpanded={(row) =>
              expanded === row.student_id ? (
                <RiskDetail studentId={row.student_id} cycleId={cycle?.id} cycleName={cycleName} />
              ) : null
            }
            emptyState={
              <EmptyState
                icon="verified"
                title={rows.length ? 'No students match your search' : 'Nobody is flagged right now'}
                description={
                  rows.length
                    ? 'Try a different name, registration number or section.'
                    : 'Students appear here automatically when attendance drops below 75%, GPA falls below 6, a backlog is recorded, or a black dot is recorded in the current academic cycle.'
                }
              />
            }
          />
        </Panel>
      )}
    </PortalShell>
  );
}
