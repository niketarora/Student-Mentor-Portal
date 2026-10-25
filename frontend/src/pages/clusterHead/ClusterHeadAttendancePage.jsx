/**
 * ClusterHeadAttendancePage
 *
 * NOTHING TO FILL IN — just pick the file.
 * The ERP's "Class Attendance" export already states the course code,
 * course name, section and the From/To dates in its header block, so the
 * old Course / Section / period pickers were asking the Cluster Head to
 * retype what the file already said, with a fresh chance to get it wrong
 * each time. All four are now read out of the file.
 *
 * THE % COLUMN IS WHAT COUNTS
 * The export's own "%" is stored and displayed verbatim. Total class /
 * present / absent are kept for reference but nothing reads them — the
 * portal must never show a percentage the ERP disagrees with.
 *
 * THE FIRST UPLOAD IS THE MAPPING
 * There is still no separate screen for which student sits in which
 * section: the file's Registration No. column is matched against student
 * accounts, and the section from the header is recorded per course.
 *
 * TIMING IS UNCONSTRAINED
 * The From/To dates describe the data. They do not restrict when an upload
 * may happen — early, late or twice in a day is all fine.
 *
 * FROM THE HOD PORTAL (/hod/uploads/attendance, migration 0039)
 * A HOD keeps no subject list. The file's Course Code and Course Name
 * are the subject: the first upload of a code in the cycle creates it,
 * later ones file under it. So there is no "set up your subjects first"
 * step, and the list on this page is what their uploads created.
 */

import { useCallback, useEffect, useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import AcademicUploadPanel from '../../components/clusterHead/AcademicUploadPanel.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useAuth } from '../../context/AuthProvider.jsx';
import { useActiveCycle } from '../../hooks/useActiveCycle.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';
import { cycleLabel } from '../../lib/academicCycles.js';
import { fetchUploadedSubjects } from '../../lib/uploadedSubjects.js';
import { describeError, formatDate } from '../../lib/formatters.js';

export default function ClusterHeadAttendancePage() {
  const toast = useToast();
  const { profile } = useAuth();
  const { isHodUploads } = usePortalPaths();
  const { cycle } = useActiveCycle();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpload, setLastUpload] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = isHodUploads
      ? await fetchUploadedSubjects(profile?.id, cycle?.id)
      : await supabase
          .from('current_cycle_courses')
          .select('id, course_name, course_code')
          .order('display_order');
    if (error) toast.error(describeError(error));
    setCourses(data ?? []);
    setLoading(false);
  }, [toast, isHodUploads, profile?.id, cycle?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUploaded = (data) => {
    setLastUpload(data);
    // A HOD's first upload of a course creates the subject.
    if (isHodUploads) load();
  };

  return (
    <PortalShell>
      <PageHeader
        title="Upload attendance"
        subtitle="Drop in the ERP attendance export. The course, section and dates are read from the file — you can upload on any day."
      />

      {!isHodUploads && !loading && !courses.length ? (
        <Panel>
          <EmptyState
            icon="menu_book"
            title="No subjects set up"
            description="Add your subjects under My Subjects first. An upload is matched to one of them by its course code."
          />
        </Panel>
      ) : (
        <>
          <AcademicUploadPanel
            title="Attendance export"
            tabIcon="fact_check"
            hint="The ERP export (.xls), or a CSV/XLSX with the same layout. Must contain a Course Code line in the header and a % column in the table."
            accept=".xls,.csv,.xlsx"
            placeholder="Choose the attendance export (.xls, .csv or .xlsx)"
            submitLabel="Upload attendance"
            buildPayload={({ filename, file_base64 }) => ({
              action: 'attendance',
              filename,
              file_base64
            })}
            onUploaded={handleUploaded}
          />

          {lastUpload?.course_code && (
            <Panel className="mt-4" tab="Read from the file" tabIcon="description">
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  ['Course code', lastUpload.course_code],
                  [
                    'Course name',
                    isHodUploads && lastUpload.course_created
                      ? `${lastUpload.course_name ?? '—'} (new subject)`
                      : lastUpload.course_name
                  ],
                  ['Section', lastUpload.section],
                  [
                    'Period',
                    `${formatDate(lastUpload.period_start)} — ${formatDate(lastUpload.period_end)}`
                  ],
                  // The period's end date decides the semester (migration 0036).
                  [
                    'Filed under',
                    lastUpload.cycle
                      ? `${cycleLabel(lastUpload.cycle)} · ${lastUpload.semester === 'Even' ? 'even' : 'odd'} semester`
                      : null
                  ]
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                    <dd className="mt-0.5 break-anywhere text-body-sm text-on-surface">{value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}

          <Panel
            className="mt-4"
            tab={isHodUploads ? 'Subjects you have uploaded this cycle' : 'Your subjects'}
            tabIcon="menu_book"
            bodyClassName=""
          >
            <DataTable
              dense
              columns={[
                { key: 'course_code', header: 'Code' },
                { key: 'course_name', header: 'Course' }
              ]}
              rows={courses}
              rowKey={(row) => row.id}
              emptyState={
                isHodUploads ? (
                  <EmptyState
                    icon="menu_book"
                    title="None yet"
                    description="Upload an attendance export and its course appears here."
                  />
                ) : undefined
              }
            />
          </Panel>

          <Panel className="mt-4" tab="How the matching works" tabIcon="info">
            <ul className="space-y-2 text-body-sm text-on-surface-variant">
              {isHodUploads ? (
                <li>
                  <strong className="text-on-surface">Course</strong> — read from the{' '}
                  <em>Course Code</em> and <em>Course Name</em> lines in the file header. The first upload
                  of a code this cycle makes it a subject; later uploads of the same code file under it.
                  A code a cluster head already uploads under is filed with theirs, so a course never
                  appears twice on a student&apos;s record.
                </li>
              ) : (
                <li>
                  <strong className="text-on-surface">Course</strong> — matched on the{' '}
                  <em>Course Code</em> line in the file header against the list above. If the code is not
                  one of your subjects the upload is rejected rather than creating a new one, so a typo in
                  the export cannot invent a subject on a student&apos;s record.
                </li>
              )}
              <li>
                <strong className="text-on-surface">Student</strong> — matched on the{' '}
                <em>Registration No.</em> column. Rows that match nobody are listed back to you rather
                than silently dropped.
              </li>
              <li>
                <strong className="text-on-surface">Section</strong> — taken from the file header. This
                is the teaching section for the course and may differ from the section on the
                student&apos;s Form A; both are kept.
              </li>
              <li>
                <strong className="text-on-surface">Percentage</strong> — the file&apos;s own{' '}
                <em>%</em> column is stored and shown to the student exactly as given. It is never
                recalculated from total class / present / absent.
              </li>
            </ul>
          </Panel>
        </>
      )}
    </PortalShell>
  );
}
