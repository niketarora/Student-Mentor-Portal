import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { FilterPills, Pagination } from '../../components/ui/FormControls.jsx';
import AddAccountModal from '../../components/hod/AddAccountModal.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { fetchAllRows } from '../../lib/fetchAllRows.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { describeError } from '../../lib/formatters.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

const PAGE_SIZE = 50;

export default function HodStudentsPage() {
  const { departmentBase } = usePortalPaths();
  const toast = useToast();
  const [students, setStudents] = useState([]);
  const [mentorNames, setMentorNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // The department has more students than PostgREST hands back in one
    // response (1,000), so page through all of them. Asking once used to
    // show 1,000 students here while the dashboard, which counts in SQL,
    // showed the real number. The student_id tie-break keeps the pages
    // from overlapping when two students share a name.
    const [{ data: rows, error }, { data: faculty }] = await Promise.all([
      fetchAllRows((withCount) =>
        supabase
          .from('student_query_summary')
          .select('*', withCount ? { count: 'exact' } : undefined)
          .order('student_name')
          .order('student_id')
      ),
      supabase.from('user_profiles').select('id, full_name').eq('role', 'faculty')
    ]);
    if (error) toast.error(describeError(error));
    setStudents(rows ?? []);
    setMentorNames(Object.fromEntries((faculty ?? []).map((f) => [f.id, f.full_name])));
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Stable on purpose: the top bar re-sends the search term whenever this
  // function changes, which would throw the table back to page 1 on every
  // render.
  const handleSearch = useCallback((term) => {
    setSearch(term);
    setPage(1);
  }, []);

  const handleFilter = (value) => {
    setFilter(value);
    setPage(1);
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students.filter((student) => {
      if (filter === 'unassigned' && student.assigned_mentor_id) return false;
      if (filter === 'pending_form_a' && student.form_a_completed) return false;
      if (filter === 'with_open' && student.open_queries + student.in_progress_queries === 0) return false;
      if (!term) return true;
      return (
        student.student_name?.toLowerCase().includes(term) ||
        student.registration_no?.toLowerCase().includes(term) ||
        student.email?.toLowerCase().includes(term)
      );
    });
  }, [students, search, filter]);

  const summary = useMemo(
    () => ({
      total: students.length,
      unassigned: students.filter((s) => !s.assigned_mentor_id).length,
      pendingForm: students.filter((s) => !s.form_a_completed).length,
      withOpen: students.filter((s) => s.open_queries + s.in_progress_queries > 0).length
    }),
    [students]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // A reload can shrink the list under the page being viewed.
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <PortalShell searchPlaceholder="Search students by name, registration number or email..." onSearch={handleSearch}>
      <PageHeader
        title="Students"
        subtitle="Every student in the department, their mentor and their onboarding status."
        actions={
          <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            Add account
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total students" value={summary.total} icon="school" tone="primary" />
        <StatCard label="Without a mentor" value={summary.unassigned} icon="person_off"
          tone={summary.unassigned ? 'error' : 'success'} />
        <StatCard label="Form A pending" value={summary.pendingForm} icon="assignment_late"
          tone={summary.pendingForm ? 'warning' : 'success'} />
        <StatCard label="With active queries" value={summary.withOpen} icon="pending_actions" tone="info" />
      </div>

      <Panel tab="Filters" tabIcon="filter_alt" className="mb-4">
        <FilterPills
          ariaLabel="Filter students"
          value={filter}
          onChange={handleFilter}
          options={[
            { value: 'all', label: 'All', count: students.length },
            { value: 'unassigned', label: 'No mentor', count: summary.unassigned },
            { value: 'pending_form_a', label: 'Form A pending', count: summary.pendingForm },
            { value: 'with_open', label: 'Active queries', count: summary.withOpen }
          ]}
        />
      </Panel>

      {loading ? (
        <SkeletonTable rows={10} columns={8} />
      ) : (
        <Panel bodyClassName="">
          <DataTable
            columns={[
              {
                key: 'student_name',
                header: 'Student',
                render: (row) => (
                  <Link to={`${departmentBase}/students/${row.student_id}`} className="text-on-surface hover:text-primary hover:underline">
                    <span className="block">{row.student_name}</span>
                    <span className="text-label-sm text-tertiary">{row.email}</span>
                  </Link>
                )
              },
              { key: 'registration_no', header: 'Reg. no.' },
              { key: 'branch', header: 'Branch' },
              { key: 'section', header: 'Sec' },
              {
                key: 'assigned_mentor_id',
                header: 'Mentor',
                render: (row) =>
                  row.assigned_mentor_id ? (
                    mentorNames[row.assigned_mentor_id] ?? '—'
                  ) : (
                    <span className="chip bg-error-container text-on-error-container">Unassigned</span>
                  )
              },
              {
                key: 'form_a_completed',
                header: 'Form A',
                render: (row) =>
                  row.form_a_completed ? (
                    <span className="chip bg-success-container text-on-success-container">Submitted</span>
                  ) : (
                    <span className="chip bg-warning-container text-on-warning-container">Pending</span>
                  )
              },
              { key: 'total_queries', header: 'Queries', align: 'right' }
            ]}
            rows={pageRows}
            rowKey={(row) => row.student_id}
            emptyState={<EmptyState icon="school" title="No students found" description="Try clearing the filters." />}
            footer={
              <Pagination page={currentPage} pageCount={pageCount} total={filtered.length} onPageChange={setPage} />
            }
          />
        </Panel>
      )}

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={load} />

    </PortalShell>
  );
}
