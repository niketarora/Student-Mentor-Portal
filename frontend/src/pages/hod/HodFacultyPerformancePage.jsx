import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { EmploymentBadge } from '../../components/ui/StatusBadge.jsx';
import { GroupedBarChart, CategoryBarChart } from '../../components/charts/Charts.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { apiClient } from '../../lib/apiClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { CHART_COLORS } from '../../lib/constants.js';
import { describeError, formatHours } from '../../lib/formatters.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

const SORTS = [
  { value: 'resolved_queries', label: 'Most resolved' },
  { value: 'total_queries', label: 'Most queries' },
  { value: 'mentee_count', label: 'Most mentees' },
  { value: 'avg_first_response_hours', label: 'Fastest first response', ascending: true },
  { value: 'resolution_rate_percent', label: 'Best resolution rate' },
  { value: 'avg_satisfaction', label: 'Highest rated' }
];

export default function HodFacultyPerformancePage() {
  const { departmentBase } = usePortalPaths();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('resolved_queries');
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState(null);

  /**
   * Feature 4 from the HOD's side: the same analytical report a faculty
   * member can pull for themselves, generated for any of them.
   */
  const downloadReport = async (row) => {
    setDownloading(row.faculty_id);
    try {
      await apiClient.downloadFile(
        '/reports/faculty-activity-report',
        { faculty_id: row.faculty_id, format: 'pdf' },
        `faculty-activity-report-${row.faculty_id}.pdf`
      );
      toast.success('Report downloaded.');
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setDownloading(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('faculty_performance_summary').select('*');
    if (error) toast.error(describeError(error));
    setRows(data ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(() => {
    const config = SORTS.find((s) => s.value === sort);
    const term = search.trim().toLowerCase();
    return [...rows]
      .filter((row) => !term || row.faculty_name?.toLowerCase().includes(term))
      .sort((a, b) => {
        const left = Number(a[sort] ?? 0);
        const right = Number(b[sort] ?? 0);
        return config?.ascending ? left - right : right - left;
      });
  }, [rows, sort, search]);

  const comparisonData = useMemo(
    () =>
      sorted.slice(0, 8).map((row) => ({
        name: row.faculty_name?.split(' ').slice(-1)[0] ?? '—',
        resolved: row.resolved_queries,
        active: row.open_queries + row.in_progress_queries
      })),
    [sorted]
  );

  const responseData = useMemo(
    () =>
      sorted
        .filter((row) => row.avg_first_response_hours != null)
        .slice(0, 8)
        .map((row, index) => ({
          name: row.faculty_name?.split(' ').slice(-1)[0] ?? '—',
          value: Number(row.avg_first_response_hours),
          color: CHART_COLORS.series[index % CHART_COLORS.series.length]
        })),
    [sorted]
  );

  return (
    <PortalShell searchPlaceholder="Search faculty by name..." onSearch={setSearch}>
      <PageHeader
        title="Faculty performance"
        subtitle="Comparative view of mentoring load, responsiveness and student satisfaction across the department."
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel tab="Resolved vs still active" tabIcon="stacked_bar_chart">
          <GroupedBarChart
            data={comparisonData}
            height={260}
            series={[
              { key: 'resolved', label: 'Resolved', color: CHART_COLORS.resolved },
              { key: 'active', label: 'Still active', color: CHART_COLORS.inProgress }
            ]}
          />
        </Panel>
        <Panel tab="Average first response (hours)" tabIcon="bolt">
          <CategoryBarChart data={responseData} height={260} />
        </Panel>
      </div>

      <Panel
        tab="All faculty"
        tabIcon="table_chart"
        bodyClassName=""
        actions={
          <div className="flex items-center gap-2 px-4 py-1">
            <label htmlFor="sort" className="text-label-sm text-tertiary">
              Sort by
            </label>
            <select
              id="sort"
              className="field-input w-52 py-1.5"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {loading ? (
          <SkeletonTable rows={8} columns={8} />
        ) : (
          <DataTable
            columns={[
              {
                key: 'faculty_name',
                header: 'Faculty',
                render: (row) => (
                  <span>
                    <span className="block text-on-surface">{row.faculty_name}</span>
                    <span className="text-label-sm text-tertiary">{row.faculty_email}</span>
                  </span>
                )
              },
              { key: 'branch', header: 'Branch' },
              { key: 'employment_status', header: 'Status', render: (row) => <EmploymentBadge status={row.employment_status} /> },
              { key: 'mentee_count', header: 'Mentees', align: 'right' },
              { key: 'total_queries', header: 'Queries', align: 'right' },
              { key: 'resolved_queries', header: 'Resolved', align: 'right' },
              { key: 'reopened_resolutions', header: 'Reopened', align: 'right' },
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
                render: (row) => `${row.resolution_rate_percent ?? 0}%`
              },
              {
                key: 'avg_satisfaction',
                header: 'Rating',
                align: 'right',
                render: (row) => (row.avg_satisfaction ? `${row.avg_satisfaction}/5` : '—')
              },
              {
                key: 'report',
                header: 'Report',
                render: (row) => (
                  <span className="flex flex-nowrap gap-1">
                    <NavLink to={`${departmentBase}/reports?faculty_id=${row.faculty_id}`} className="btn-ghost btn-sm">
                      <span className="material-symbols-outlined text-[16px]">analytics</span>
                      View
                    </NavLink>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => downloadReport(row)}
                      disabled={downloading === row.faculty_id}
                    >
                      <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                      {downloading === row.faculty_id ? '...' : 'PDF'}
                    </button>
                  </span>
                )
              }
            ]}
            rows={sorted}
            rowKey={(row) => row.faculty_id}
            emptyState={<EmptyState icon="badge" title="No faculty found" description="Import the faculty roster first." />}
          />
        )}
      </Panel>
    </PortalShell>
  );
}
