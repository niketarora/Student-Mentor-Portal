/**
 * AdminHodMappingPage — /admin/upload
 * The administrator's one addition to the department portal (migration
 * 0039): the mentor-HOD mapping.
 *
 * The department keeps one sheet listing every mentor and class
 * coordinator, their section, and the HOD they report to. Uploading it
 * here is what decides which faculty (and so which students) each HOD
 * sees. HODs and mentors without an account get one on the temporary
 * password, the same way the mentor-mentee mapping creates mentors.
 *
 * Below the upload is the mapping as it stands, so a correction is a
 * matter of fixing the sheet and uploading it again.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { SkeletonCards, SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { FilterPills, Pagination } from '../../components/ui/FormControls.jsx';
import AcademicUploadPanel from '../../components/clusterHead/AcademicUploadPanel.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { fetchAllRows } from '../../lib/fetchAllRows.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { describeError } from '../../lib/formatters.js';

const PAGE_SIZE = 25;

/** "A 3" before "A 4" before "B 3"; "P 12" after "P 3". */
const sectionCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const mappingSummary = (data) => [
  { label: 'Rows in file', value: data.total_rows ?? 0 },
  { label: 'Mapped', value: data.mapped ?? 0 },
  { label: 'Already correct', value: data.unchanged ?? 0 },
  { label: 'HODs', value: data.hods ?? 0 },
  { label: 'Not mapped', value: data.failed ?? 0 }
];

export default function AdminHodMappingPage() {
  const toast = useToast();
  const [faculty, setFaculty] = useState([]);
  const [hods, setHods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [accountErrors, setAccountErrors] = useState([]);

  const load = useCallback(async () => {
    const [facultyResult, hodResult] = await Promise.all([
      fetchAllRows((withCount) =>
        supabase
          .from('user_profiles')
          .select(
            'id, full_name, email, mentor_section, mentor_designation, hod_id, employment_status',
            withCount ? { count: 'exact' } : undefined
          )
          .eq('role', 'faculty')
          .order('full_name')
          .order('id')
      ),
      supabase.from('user_profiles').select('id, full_name, email, is_active').eq('role', 'hod').order('full_name')
    ]);
    if (facultyResult.error) toast.error(describeError(facultyResult.error));
    if (hodResult.error) toast.error(describeError(hodResult.error));
    setFaculty(facultyResult.data ?? []);
    setHods(hodResult.data ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = useCallback((term) => {
    setSearch(term);
    setPage(1);
  }, []);

  const hodById = useMemo(() => new Map(hods.map((hod) => [hod.id, hod])), [hods]);
  const mappedCount = faculty.filter((row) => row.hod_id).length;

  const countsByHod = useMemo(() => {
    const counts = new Map();
    for (const row of faculty) {
      if (row.hod_id) counts.set(row.hod_id, (counts.get(row.hod_id) ?? 0) + 1);
    }
    return counts;
  }, [faculty]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return faculty
      .filter((row) => {
        if (filter === 'unmapped' && row.hod_id) return false;
        if (filter !== 'all' && filter !== 'unmapped' && row.hod_id !== filter) return false;
        if (!term) return true;
        const hod = hodById.get(row.hod_id);
        return [row.full_name, row.email, row.mentor_section, hod?.full_name, hod?.email]
          .some((value) => value?.toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const hodA = hodById.get(a.hod_id)?.full_name ?? '￿';
        const hodB = hodById.get(b.hod_id)?.full_name ?? '￿';
        return (
          hodA.localeCompare(hodB) ||
          sectionCollator.compare(a.mentor_section ?? '￿', b.mentor_section ?? '￿') ||
          a.full_name.localeCompare(b.full_name)
        );
      });
  }, [faculty, filter, search, hodById]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // A re-upload can shrink the list under the page being viewed.
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const onUploaded = (data) => {
    setAccountErrors(Array.isArray(data?.account_errors) ? data.account_errors : []);
    load();
  };

  const filterOptions = [
    { value: 'all', label: `All (${faculty.length})` },
    ...hods
      .filter((hod) => countsByHod.get(hod.id))
      .map((hod) => ({ value: hod.id, label: `${hod.full_name} (${countsByHod.get(hod.id)})` })),
    { value: 'unmapped', label: `Not mapped (${faculty.length - mappedCount})` }
  ];

  return (
    <PortalShell searchPlaceholder="Search mentors, sections or HODs..." onSearch={handleSearch}>
      <PageHeader
        title="Upload"
        subtitle="The mentor–HOD mapping: which HOD each mentor and class coordinator reports to. Each HOD sees only the faculty mapped to them, and those faculty's students."
      />

      <AcademicUploadPanel
        title="Mentor–HOD mapping"
        tabIcon="account_tree"
        hint="The department's Mentor – Section – Email sheet (.xlsx or .csv). Columns: Section, Mentor / Class Coordinator Name, Role, Official Email, and the HOD's name and Official Email (headed HOD or Cluster Head)."
        accept=".xlsx,.csv"
        placeholder="Choose the mapping sheet (.xlsx or .csv)"
        submitLabel="Upload mapping"
        showCycle={false}
        identifierLabel="Email"
        idleNote="Upload it again whenever the sheet changes; mentors it does not mention keep their HOD."
        summarise={mappingSummary}
        buildPayload={({ filename, file_base64 }) => ({ action: 'hod-map', filename, file_base64 })}
        onUploaded={onUploaded}
      />

      {accountErrors.length > 0 && (
        <Panel className="mt-4" tab="Accounts that could not be created" tabIcon="person_off" bodyClassName="">
          <DataTable
            dense
            columns={[
              { key: 'email', header: 'Email' },
              { key: 'reason', header: 'Reason' }
            ]}
            rows={accountErrors.map((error, index) => ({ ...error, key: `${error.email}-${index}` }))}
            rowKey={(row) => row.key}
          />
        </Panel>
      )}

      <Panel className="mt-4" tab="How the mapping works" tabIcon="info">
        <ul className="space-y-2 text-body-sm text-on-surface-variant">
          <li>
            <strong className="text-on-surface">One row per mentor or class coordinator</strong> — matched on their
            Official Email. Their section and role are recorded with them.
          </li>
          <li>
            <strong className="text-on-surface">The HOD</strong> — matched on the HOD&apos;s Official Email. Anyone in
            the sheet without an account gets one (HODs as HOD, mentors as faculty) and signs in with the temporary
            password. A cluster head named as a HOD becomes one; a student never does.
          </li>
          <li>
            <strong className="text-on-surface">What each HOD sees</strong> — the faculty mapped to them, their
            students, queries, reports and at-risk lists. Faculty who are not mapped, and students without a mentor,
            are yours to see.
          </li>
          <li>
            <strong className="text-on-surface">Corrections</strong> — fix the sheet and upload it again. Mentors the
            sheet does not mention keep their current HOD, so a sheet for a few sections can be uploaded on its own.
          </li>
        </ul>
      </Panel>

      {loading ? (
        <div className="mt-4">
          <SkeletonCards count={3} />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="HODs" value={hods.length} icon="supervisor_account" tone="primary"
            caption={`${countsByHod.size} with faculty mapped`} />
          <StatCard label="Faculty mapped" value={mappedCount} icon="account_tree" tone="success"
            caption={`of ${faculty.length} faculty`} />
          <StatCard label="Not mapped" value={faculty.length - mappedCount} icon="person_search"
            tone={faculty.length - mappedCount ? 'warning' : 'slate'} caption="Seen only by you" />
        </div>
      )}

      <Panel className="mt-4" tab="Current mapping" tabIcon="table_view" bodyClassName="">
        {!loading && (
          <div className="border-b border-surface-container px-5 py-3">
            <FilterPills
              ariaLabel="HOD"
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setPage(1);
              }}
              options={filterOptions}
            />
          </div>
        )}
        {loading ? (
          <SkeletonTable rows={6} columns={4} />
        ) : (
          <DataTable
            columns={[
              {
                key: 'mentor_section',
                header: 'Section',
                render: (row) => <span className="whitespace-nowrap">{row.mentor_section ?? '—'}</span>
              },
              {
                key: 'full_name',
                header: 'Mentor / class coordinator',
                render: (row) => (
                  <span className="block min-w-[12rem]">
                    <span className="block text-on-surface">{row.full_name}</span>
                    <span className="block break-anywhere text-label-sm text-tertiary">{row.email}</span>
                  </span>
                )
              },
              {
                key: 'mentor_designation',
                header: 'Role',
                render: (row) => row.mentor_designation ?? '—'
              },
              {
                key: 'hod_id',
                header: 'HOD',
                render: (row) => {
                  const hod = hodById.get(row.hod_id);
                  if (!hod) return <span className="chip bg-warning-container text-on-warning-container">Not mapped</span>;
                  return (
                    <span className="block min-w-[12rem]">
                      <span className="block text-on-surface">{hod.full_name}</span>
                      <span className="block break-anywhere text-label-sm text-tertiary">{hod.email}</span>
                    </span>
                  );
                }
              }
            ]}
            rows={pageRows}
            rowKey={(row) => row.id}
            footer={
              rows.length > PAGE_SIZE ? (
                <Pagination page={currentPage} pageCount={pageCount} total={rows.length} onPageChange={setPage} />
              ) : null
            }
            emptyState={
              <EmptyState
                icon="account_tree"
                title={faculty.length ? 'Nobody matches' : 'No faculty yet'}
                description={
                  faculty.length
                    ? 'Try another HOD or clear the search.'
                    : 'Upload the mapping sheet above: it creates the HOD and faculty accounts it names.'
                }
              />
            }
          />
        )}
      </Panel>
    </PortalShell>
  );
}
