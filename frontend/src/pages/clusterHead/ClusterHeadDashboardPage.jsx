/**
 * ClusterHeadDashboardPage
 * Deliberately sparse. A Cluster Head's whole job is uploading, so the
 * home screen is the cycle they are uploading into, their subjects, their
 * recent uploads, and shortcuts into the four upload screens. No queries,
 * no students, no reports — none of that is theirs to see.
 *
 * Everything here is the ACTIVE academic cycle's (migration 0036): its
 * subjects, and the uploads filed under it, which can be narrowed to one
 * of its two semesters.
 *
 * Also the HOD's "Uploads -> Overview" (/hod/uploads, migration 0039).
 * A HOD keeps no subject list, so the subjects shown are the ones their
 * attendance uploads were filed under, and the uploads are their own.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCards } from '../../components/ui/Skeleton.jsx';
import { FilterPills } from '../../components/ui/FormControls.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useToast } from '../../context/ToastProvider.jsx';
import { useActiveCycle } from '../../hooks/useActiveCycle.js';
import { formatDateTime, describeError } from '../../lib/formatters.js';
import { ACADEMIC_UPLOAD_LABELS } from '../../lib/constants.js';
import { SEMESTERS, cycleLabel, semesterOn, semesterTitle, todayInIndia, uploadScope } from '../../lib/academicCycles.js';
import { fetchUploadedSubjects } from '../../lib/uploadedSubjects.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

/** "Dr. Meera Iyer" -> "Dr. Iyer"; "Meera Iyer" -> "Meera". */
function greetingName(fullName) {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Cluster Head';
  if (parts.length > 1 && /^(dr|prof|mr|mrs|ms)\.?$/i.test(parts[0])) return `${parts[0]} ${parts[parts.length - 1]}`;
  return parts[0];
}

const SHORTCUTS = [
  { to: 'attendance', label: 'Upload attendance', icon: 'fact_check', tone: 'primary' },
  { to: 'gpa', label: 'Upload GPA', icon: 'grade', tone: 'info' },
  { to: 'backlogs', label: 'Upload backlogs', icon: 'assignment_late', tone: 'warning' },
  { to: 'black-dots', label: 'Upload black dots', icon: 'gavel', tone: 'error' }
];

export default function ClusterHeadDashboardPage() {
  const { profile } = useAuth();
  const { uploadsBase, isHodUploads } = usePortalPaths();
  const toast = useToast();
  const { cycle, loading: cycleLoading } = useActiveCycle();

  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [uploadCount, setUploadCount] = useState(0);
  const [semester, setSemester] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!cycle) {
      if (!cycleLoading) setLoading(false);
      return;
    }
    let history = supabase
      .from('academic_upload_history')
      .select('id, upload_type, semester, course_code, section_label, period_start, period_end, semester_number, scope_label, original_filename, total_rows, matched_rows, failed_rows, created_at', { count: 'exact' })
      .eq('cycle_id', cycle.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (semester !== 'all') history = history.eq('semester', semester);
    // A cluster head only ever reads their own uploads; a HOD can read the
    // department's, so their overview asks for their own.
    if (isHodUploads) history = history.eq('uploaded_by', profile?.id);

    const [courseResult, batchResult] = await Promise.all([
      isHodUploads
        ? fetchUploadedSubjects(profile?.id, cycle.id)
        : supabase
            .from('current_cycle_courses')
            .select('id, course_name, course_code')
            .order('display_order'),
      history
    ]);

    if (courseResult.error) toast.error(describeError(courseResult.error));
    if (batchResult.error) toast.error(describeError(batchResult.error));

    setCourses(courseResult.data ?? []);
    setBatches(batchResult.data ?? []);
    setUploadCount(batchResult.count ?? (batchResult.data ?? []).length);
    setLoading(false);
  }, [cycle, cycleLoading, semester, toast, isHodUploads, profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const lastUpload = batches[0];
  const currentSemester = cycle ? semesterOn(cycle, todayInIndia()) : null;

  return (
    <PortalShell>
      {isHodUploads ? (
        <PageHeader
          title="Uploads overview"
          subtitle="Upload attendance and academic records for the department. Subjects are read from each attendance file, so there is no subject list to keep. There is no fixed day — upload whenever the data is ready."
        />
      ) : (
        <PageHeader
          title={`Welcome, ${greetingName(profile?.full_name)}`}
          subtitle="Upload attendance and academic records for the subjects you handle. There is no fixed day for this — upload whenever the data is ready."
        />
      )}

      {loading || cycleLoading ? (
        <SkeletonCards count={4} />
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Academic cycle"
            value={cycle ? cycleLabel(cycle.label) : 'None'}
            caption={cycle ? `Now: ${semesterTitle(cycle, currentSemester)}` : 'Start one under Academic Cycles'}
            icon="event_repeat"
            tone="primary"
          />
          <StatCard
            label={isHodUploads ? 'Subjects uploaded' : 'Subjects this cycle'}
            value={courses.length}
            icon="menu_book"
            tone="info"
          />
          <StatCard
            label={semester === 'all' ? 'Uploads this cycle' : `Uploads, ${semesterTitle(cycle, semester)}`}
            value={uploadCount}
            icon="cloud_upload"
            tone="success"
          />
          <StatCard
            label="Last upload"
            value={lastUpload ? ACADEMIC_UPLOAD_LABELS[lastUpload.upload_type] ?? '—' : 'None yet'}
            caption={lastUpload ? formatDateTime(lastUpload.created_at) : 'Start with attendance'}
            icon="schedule"
            tone="slate"
          />
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SHORTCUTS.map((shortcut) => (
          <Link
            key={shortcut.to}
            to={`${uploadsBase}/${shortcut.to}`}
            className="panel flex items-center gap-3 p-5 transition-shadow hover:shadow-raised"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
              <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                {shortcut.icon}
              </span>
            </span>
            <span className="text-label-md text-on-surface">{shortcut.label}</span>
            <span className="material-symbols-outlined ml-auto text-[18px] text-tertiary" aria-hidden="true">
              chevron_right
            </span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-2"
          tab={
            isHodUploads
              ? cycle ? `Subjects uploaded · ${cycleLabel(cycle.label)}` : 'Subjects uploaded'
              : cycle ? `My subjects · ${cycleLabel(cycle.label)}` : 'My subjects'
          }
          tabIcon="menu_book"
          bodyClassName=""
        >
          <DataTable
            columns={[
              { key: 'course_name', header: 'Course' },
              { key: 'course_code', header: 'Code' }
            ]}
            rows={courses}
            rowKey={(row) => row.id}
            emptyState={
              isHodUploads ? (
                <EmptyState
                  icon="menu_book"
                  title="No attendance uploaded in this cycle yet"
                  description="Each attendance file's course code and name become a subject the first time they are uploaded."
                />
              ) : (
                <EmptyState
                  icon="menu_book"
                  title="No subjects in this cycle yet"
                  description="Add your subjects from My Subjects to start uploading."
                />
              )
            }
          />
        </Panel>

        <Panel
          className="xl:col-span-3"
          tab="Recent uploads"
          tabIcon="history"
          bodyClassName=""
          actions={
            <Link to={`${uploadsBase}/cycles`} className="text-label-md text-primary hover:underline">
              Whole cycle
            </Link>
          }
        >
          {cycle && (
            <div className="border-b border-surface-container px-5 py-3">
              <FilterPills
                ariaLabel="Semester"
                value={semester}
                onChange={setSemester}
                options={[
                  { value: 'all', label: 'Whole cycle' },
                  ...SEMESTERS.map((value) => ({ value, label: semesterTitle(cycle, value) }))
                ]}
              />
            </div>
          )}
          <DataTable
            dense
            columns={[
              {
                key: 'upload_type',
                header: 'Upload',
                render: (row) => (
                  <span className="block min-w-[9rem]">
                    <span className="block text-label-md text-on-surface">
                      {ACADEMIC_UPLOAD_LABELS[row.upload_type] ?? row.upload_type}
                    </span>
                    <span className="block text-label-sm text-tertiary">{uploadScope(row)}</span>
                  </span>
                )
              },
              {
                key: 'semester',
                header: 'Semester',
                render: (row) => (row.semester ? <span className="whitespace-nowrap">{row.semester}</span> : '—')
              },
              {
                key: 'matched_rows',
                header: 'Recorded',
                align: 'right',
                render: (row) => (
                  <span className="block whitespace-nowrap tabular-nums">
                    {Number(row.matched_rows ?? 0).toLocaleString('en-IN')}
                    {row.failed_rows > 0 && (
                      <span className="mt-0.5 block text-label-sm text-error">{row.failed_rows} not matched</span>
                    )}
                  </span>
                )
              },
              {
                key: 'created_at',
                header: 'When',
                render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>
              }
            ]}
            rows={batches}
            rowKey={(row) => row.id}
            emptyState={
              <EmptyState
                icon="cloud_upload"
                title="Nothing uploaded yet"
                description="Your uploads in this cycle and any rows that could not be matched will appear here."
              />
            }
          />
        </Panel>
      </div>
    </PortalShell>
  );
}
