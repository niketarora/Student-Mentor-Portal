/**
 * FEATURE 4 — Per-faculty activity report.
 * Analytical on screen (KPI cards + four charts + tables) and downloadable
 * as a PDF built from exactly the same numbers, because both the page and
 * the PDF read get_faculty_activity_report().
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { EmploymentBadge } from '../../components/ui/StatusBadge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { PageLoader } from '../../components/ui/Skeleton.jsx';
import { TextField, SelectField } from '../../components/ui/FormControls.jsx';
import {
  CategoryBarChart, DonutChart, GroupedBarChart, GaugeChart
} from '../../components/charts/Charts.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { apiClient } from '../../lib/apiClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { CHART_COLORS } from '../../lib/constants.js';
import { countQueriesByCategory, queryCategoryChartData } from '../../lib/queryCategoryChart.js';
import { describeError, formatDate, formatHours } from '../../lib/formatters.js';

/** Sentinel for the consolidated department-wide report. */
const ALL_FACULTY = 'all';

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const PRESETS = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 182 },
  { label: 'Last 12 months', days: 365 }
];

export default function FacultyActivityReportPage({ isHodView = false }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [range, setRange] = useState(defaultRange);
  // Deep-linked from the HOD leaderboard: /hod/reports?faculty_id=...
  const [facultyId, setFacultyId] = useState(() => (isHodView ? (searchParams.get('faculty_id') ?? '') : ''));
  const [facultyOptions, setFacultyOptions] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [facultyListLoaded, setFacultyListLoaded] = useState(!isHodView);

  // The HOD is not a faculty member, so "my report" is meaningless for
  // them. Load the faculty list first and pre-select someone, otherwise
  // the report RPC is asked for a faculty_id that does not exist.
  useEffect(() => {
    if (!isHodView) return;
    supabase
      .from('user_profiles')
      .select('id, full_name')
      .eq('role', 'faculty')
      .order('full_name')
      .then(({ data }) => {
        const options = [
          { value: ALL_FACULTY, label: 'All faculty members (consolidated)' },
          ...(data ?? []).map((f) => ({ value: f.id, label: f.full_name }))
        ];
        setFacultyOptions(options);
        setFacultyId((current) => current || ALL_FACULTY);
        setFacultyListLoaded(true);
      });
  }, [isHodView]);

  const load = useCallback(async () => {
    // Wait for the faculty list before asking for a report, so the HOD
    // never triggers a "Faculty member not found" on first paint.
    if (isHodView && !facultyListLoaded) return;
    if (isHodView && !facultyId) {
      setReport(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const wantsDepartment = isHodView && facultyId === ALL_FACULTY;

    const { data, error } = wantsDepartment
      ? await supabase.rpc('get_department_faculty_report', { p_from: range.from, p_to: range.to })
      : await supabase.rpc('get_faculty_activity_report', {
          p_faculty_id: isHodView && facultyId ? facultyId : null,
          p_from: range.from,
          p_to: range.to
        });

    if (error) toast.error(describeError(error));
    setReport(data ?? null);
    setLoading(false);
  }, [range, facultyId, isHodView, facultyListLoaded, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (days) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setRange({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  };

  const download = async () => {
    setDownloading(true);
    try {
      await apiClient.downloadFile(
        '/reports/faculty-activity-report',
        { faculty_id: isHodView && facultyId ? facultyId : undefined, from: range.from, to: range.to, format: 'pdf' },
        isDepartmentView ? 'department-faculty-report.pdf' : 'faculty-activity-report.pdf'
      );
      toast.success('Report downloaded.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setDownloading(false);
    }
  };

  const isDepartmentView = isHodView && facultyId === ALL_FACULTY;

  const charts = useMemo(() => {
    if (!report || report.scope === 'department') return null;
    const confirmation = report.resolution_confirmation ?? {};
    return {
      category: queryCategoryChartData(countQueriesByCategory(report.by_category, (row) => row.total)),
      confirmation: [
        { name: 'Confirmed fixed', value: confirmation.confirmed_yes ?? 0, color: CHART_COLORS.resolved },
        { name: 'Reopened', value: confirmation.reopened_no ?? 0, color: CHART_COLORS.open },
        { name: 'Awaiting reply', value: confirmation.awaiting_response ?? 0, color: CHART_COLORS.inProgress },
        { name: 'Unresolved', value: confirmation.never_resolved ?? 0, color: '#c7c6c6' }
      ]
    };
  }, [report]);

  if (loading) return <PortalShell><PageLoader label="Building your report..." /></PortalShell>;

  if (!report) {
    return (
      <PortalShell>
        <EmptyState
          icon="analytics"
          title={isHodView && !facultyOptions.length ? 'No faculty on record yet' : 'No report data'}
          description={
            isHodView && !facultyOptions.length
              ? 'Import the faculty roster from Semester setup, then come back here.'
              : 'Try a different date range.'
          }
        />
      </PortalShell>
    );
  }

  const { summary } = report;

  return (
    <PortalShell>
      <PageHeader
        title={isDepartmentView ? 'Department faculty report' : isHodView ? 'Faculty activity report' : 'My activity report'}
        subtitle={`${isDepartmentView ? `${report.coverage === 'hod' ? 'Faculty reporting to you' : 'All faculty'} · ${report.department}` : report.faculty.name} · ${formatDate(report.period.from)} to ${formatDate(report.period.to)}`}
        actions={
          <button type="button" className="btn-primary" onClick={download} disabled={downloading}>
            <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
            {downloading ? 'Building PDF...' : 'Download PDF'}
          </button>
        }
      />

      <Panel tab="Report period" tabIcon="date_range" className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          {isHodView && (
            <SelectField
              label="Faculty member"
              className="w-64"
              value={facultyId}
              placeholder="Select a faculty member"
              options={facultyOptions}
              onChange={(event) => {
                setFacultyId(event.target.value);
                setSearchParams(event.target.value ? { faculty_id: event.target.value } : {}, { replace: true });
              }}
            />
          )}
          <TextField
            label="From"
            type="date"
            className="w-44"
            value={range.from}
            max={range.to}
            onChange={(event) => setRange((r) => ({ ...r, from: event.target.value }))}
          />
          <TextField
            label="To"
            type="date"
            className="w-44"
            value={range.to}
            min={range.from}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setRange((r) => ({ ...r, to: event.target.value }))}
          />
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            {PRESETS.map((preset) => (
              <button key={preset.label} type="button" className="btn-ghost btn-sm" onClick={() => applyPreset(preset.days)}>
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {isDepartmentView ? (
        <DepartmentReportBody report={report} />
      ) : (
        <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queries handled" value={summary.total_queries} icon="confirmation_number" tone="primary"
          caption={`${summary.resolved_queries} resolved`} />
        <StatCard label="Resolution rate" value={`${summary.resolution_rate_percent}%`} icon="task_alt" tone="success"
          caption={`${summary.open_queries + summary.in_progress_queries} still active`} />
        <StatCard label="Avg first response" value={formatHours(summary.avg_first_response_hours)} icon="bolt" tone="warning"
          caption="time to first reply" />
        <StatCard label="Avg resolution" value={formatHours(summary.avg_resolution_hours)} icon="timer" tone="info"
          caption="raised to resolved" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <Panel tab="Queries by category" tabIcon="bar_chart" className="lg:col-span-2">
          <CategoryBarChart data={charts.category} height={250} allLabels />
        </Panel>
        <Panel tab="Student confirmation" tabIcon="how_to_reg" className="lg:col-span-2">
          <DonutChart
            data={charts.confirmation}
            height={250}
            centerLabel="queries"
            subtitle="Feature 3 — did the student agree the issue was fixed?"
          />
        </Panel>
      </div>

      {/* "Weekly volume" and "Satisfaction ratings" used to sit here. Both
          were removed: the weekly bars are a thinner slice of the same data
          the category and confirmation charts already carry, and the rating
          distribution duplicated the Average rating gauge beside it. The
          underlying RPC still returns weekly_trend and rating_distribution,
          so the PDF and any future screen can use them without a migration. */}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel tab="Average rating" tabIcon="grade">
          <GaugeChart
            value={Number(summary.avg_satisfaction) || 0}
            max={5}
            label={`from ${summary.rated_queries} ratings`}
            height={230}
            color={CHART_COLORS.secondary}
          />
        </Panel>
        <Panel tab="Onboarding progress" tabIcon="assignment_turned_in">
          <GaugeChart
            value={
              report.mentees.length
                ? Math.round((report.mentees.filter((m) => m.form_a_completed).length / report.mentees.length) * 100)
                : 0
            }
            label="Form A submitted"
            height={230}
            color={CHART_COLORS.resolved}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel tab="Category breakdown" tabIcon="table_chart" bodyClassName="">
          <DataTable
            dense
            columns={[
              { key: 'category', header: 'Category' },
              { key: 'total', header: 'Total', align: 'right' },
              { key: 'resolved', header: 'Resolved', align: 'right' },
              { key: 'open_count', header: 'Active', align: 'right' },
              {
                key: 'rate',
                header: 'Resolved %',
                align: 'right',
                render: (row) => (row.total ? `${Math.round((row.resolved / row.total) * 100)}%` : '—')
              }
            ]}
            rows={report.by_category ?? []}
            rowKey={(row) => row.category}
            emptyState={<EmptyState icon="bar_chart" title="No queries in this period" />}
          />
        </Panel>

        <Panel tab={`Mentees (${report.mentees.length})`} tabIcon="groups" bodyClassName="">
          <DataTable
            dense
            columns={[
              { key: 'name', header: 'Student' },
              { key: 'registration_no', header: 'Reg. no.' },
              { key: 'section', header: 'Sec' },
              {
                key: 'form_a_completed',
                header: 'Form A',
                render: (row) => (row.form_a_completed ? 'Yes' : 'Pending')
              },
              { key: 'query_count', header: 'Queries', align: 'right' }
            ]}
            rows={report.mentees ?? []}
            rowKey={(row) => row.id}
            emptyState={<EmptyState icon="groups" title="No mentees assigned" />}
          />
        </Panel>
      </div>
        </>
      )}
    </PortalShell>
  );
}

/**
 * The HOD's consolidated view. Mixed on purpose: charts carry the story,
 * then one compact row per faculty member — the same shape as the PDF, so
 * the printed report never disagrees with the screen.
 */
function DepartmentReportBody({ report }) {
  const { summary } = report;

  const categoryData = queryCategoryChartData(countQueriesByCategory(report.by_category, (row) => row.total));

  const statusData = [
    { name: 'Resolved', value: report.by_status?.resolved ?? 0, color: CHART_COLORS.resolved },
    { name: 'In Progress', value: report.by_status?.in_progress ?? 0, color: CHART_COLORS.inProgress },
    { name: 'Open', value: report.by_status?.open ?? 0, color: CHART_COLORS.open }
  ];

  const monthly = (report.monthly_trend ?? []).map((m) => ({
    name: m.month, created: m.created, resolved: m.resolved
  }));

  const loadByFaculty = [...(report.faculty ?? [])]
    .sort((a, b) => b.total_queries - a.total_queries)
    .slice(0, 8)
    .map((f) => ({
      name: f.name.split(' ').slice(-1)[0],
      resolved: f.resolved_queries,
      active: f.open_queries + f.in_progress_queries
    }));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queries raised" value={summary.total_queries} icon="confirmation_number" tone="primary"
          caption={`${summary.resolved_queries} resolved`} />
        <StatCard label="Resolution rate" value={`${summary.resolution_rate_percent}%`} icon="task_alt" tone="success"
          caption={`${summary.open_queries + summary.in_progress_queries} still active`} />
        <StatCard label="Avg first response" value={formatHours(summary.avg_first_response_hours)} icon="bolt" tone="warning" />
        <StatCard label="Avg resolution" value={formatHours(summary.avg_resolution_hours)} icon="timer" tone="info" />
        <StatCard label="Faculty" value={summary.faculty_count} icon="badge" tone="secondary"
          caption={`${summary.active_faculty} active`} />
        <StatCard label="Students" value={summary.student_count} icon="school" tone="primary"
          caption={report.coverage === 'hod' ? 'Mentees of your faculty' : `${summary.unassigned_students} unassigned`} />
        <StatCard label="Satisfaction" value={summary.avg_satisfaction ? `${summary.avg_satisfaction}/5` : '—'}
          icon="grade" tone="warning" />
        <StatCard label="Referred to HOD" value={summary.escalated_queries} icon="flag"
          tone={summary.escalated_queries ? 'error' : 'slate'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel tab="Queries by category" tabIcon="bar_chart">
          <CategoryBarChart data={categoryData} height={250} allLabels />
        </Panel>
        <Panel tab="Status mix" tabIcon="donut_small">
          <DonutChart data={statusData} height={250} centerLabel="queries" />
        </Panel>
      </div>

      <Panel tab="Monthly volume — raised vs resolved" tabIcon="stacked_bar_chart" className="mt-4">
        <GroupedBarChart
          data={monthly}
          height={280}
          series={[
            { key: 'created', label: 'Raised', color: CHART_COLORS.primary },
            { key: 'resolved', label: 'Resolved', color: CHART_COLORS.resolved }
          ]}
        />
      </Panel>

      <Panel tab="Load by faculty member" tabIcon="leaderboard" className="mt-4">
        <GroupedBarChart
          data={loadByFaculty}
          height={280}
          series={[
            { key: 'resolved', label: 'Resolved', color: CHART_COLORS.resolved },
            { key: 'active', label: 'Still active', color: CHART_COLORS.inProgress }
          ]}
        />
      </Panel>

      <Panel tab={`All faculty (${report.faculty?.length ?? 0})`} tabIcon="table_chart" className="mt-4" bodyClassName="">
        <DataTable
          dense
          columns={[
            {
              key: 'name',
              header: 'Faculty',
              render: (row) => (
                <span>
                  <span className="block text-on-surface">{row.name}</span>
                  <span className="text-label-sm text-tertiary">{row.login_id ?? '—'}</span>
                </span>
              )
            },
            { key: 'branch', header: 'Branch' },
            { key: 'employment_status', header: 'Status', render: (row) => <EmploymentBadge status={row.employment_status} /> },
            { key: 'mentee_count', header: 'Mentees', align: 'right' },
            { key: 'total_queries', header: 'Queries', align: 'right' },
            { key: 'resolved_queries', header: 'Resolved', align: 'right' },
            { key: 'reopened', header: 'Reopened', align: 'right' },
            {
              key: 'avg_first_response_hours',
              header: 'Avg 1st response',
              align: 'right',
              render: (row) => formatHours(row.avg_first_response_hours)
            },
            {
              key: 'avg_resolution_hours',
              header: 'Avg resolution',
              align: 'right',
              render: (row) => formatHours(row.avg_resolution_hours)
            },
            {
              key: 'resolution_rate_percent',
              header: 'Rate',
              align: 'right',
              render: (row) => `${row.resolution_rate_percent}%`
            },
            {
              key: 'avg_satisfaction',
              header: 'Rating',
              align: 'right',
              render: (row) => (row.avg_satisfaction ? `${row.avg_satisfaction}/5` : '—')
            }
          ]}
          rows={report.faculty ?? []}
          rowKey={(row) => row.id}
          emptyState={<EmptyState icon="badge" title="No faculty on record" description="Import the faculty roster first." />}
        />
      </Panel>
    </>
  );
}
