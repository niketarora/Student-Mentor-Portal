/**
 * ClusterHeadRosterPage
 * Student roster · faculty roster · mentor–mentee mapping. The student
 * roster still has to come first — the mapping matches students on their
 * registration number and cannot invent one. The faculty roster no
 * longer has to: the mapping creates an account for any mentor it names
 * who does not have one, because that file already carries their email.
 *
 * Moved here from the HOD's Semester setup screen — the Cluster Head is
 * the one holding these files. The endpoint is unchanged and still runs
 * on the service role; only who may call it moved.
 *
 * One page rather than three: the three uploads share a prerequisite
 * chain, and splitting them across three routes would hide it.
 *
 * ACADEMIC CYCLES (migration 0036)
 * Rosters and the mapping are steps 2 and 3 of a cycle. A student roster
 * creates the accounts that are missing and ACTIVATES the students who
 * already have one: they join the active cycle with the semester, section
 * and program in the file. The mapping records each student's mentor for
 * the cycle. Neither touches what a closed cycle recorded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import AcademicUploadPanel from '../../components/clusterHead/AcademicUploadPanel.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { useToast } from '../../context/ToastProvider.jsx';
import { useActiveCycle } from '../../hooks/useActiveCycle.js';
import { describeError, formatDateTime } from '../../lib/formatters.js';
import { cycleLabel } from '../../lib/academicCycles.js';
import { usePortalPaths } from '../../hooks/usePortalPaths.js';

/** created/skipped/failed, which is what the roster endpoint reports. */
const rosterSummary = (data) => [
  { label: 'Rows in file', value: data.total_rows ?? 0 },
  { label: 'Accounts created', value: data.created?.length ?? 0 },
  { label: 'Already existed', value: data.skipped?.length ?? 0 },
  { label: 'Problems', value: data.failed?.length ?? 0 }
];

/** The student roster also reports the existing students it activated. */
const studentRosterSummary = (data) => [
  { label: 'Rows in file', value: data.total_rows ?? 0 },
  { label: 'Accounts created', value: data.created?.length ?? 0 },
  { label: 'Existing students activated', value: data.activated?.length ?? 0 },
  { label: 'Problems', value: data.failed?.length ?? 0 }
];

const mentorSummary = (data) => [
  { label: 'Rows in file', value: data.total_rows ?? 0 },
  { label: 'Mapped', value: data.matched ?? 0 },
  { label: 'Mentor accounts created', value: data.mentors_created ?? 0 },
  { label: 'Already correct', value: data.unchanged ?? 0 },
  { label: 'Problems', value: data.failed ?? 0 }
];

export default function ClusterHeadRosterPage() {
  const { uploadsBase, isHodUploads } = usePortalPaths();
  const toast = useToast();
  const { cycle } = useActiveCycle();
  const [batches, setBatches] = useState([]);
  const [credentials, setCredentials] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('roster_import_batches')
      .select('*, cycle:academic_cycles(label)')
      .order('created_at', { ascending: false })
      .limit(15);
    if (error) toast.error(describeError(error));
    setBatches(data ?? []);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Temporary passwords are returned once and never again — losing this
   * download means every account has to be reset by hand, so it is
   * offered the moment an import finishes.
   */
  const onRosterUploaded = (data) => {
    load();
    if (data?.created?.length) setCredentials(data.created);
  };

  const sharedPassword =
    credentials?.length && credentials.every((row) => row.temporary_password === credentials[0].temporary_password)
      ? credentials[0].temporary_password
      : null;

  const downloadCredentials = () => {
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'Name,Email,Login ID,Temporary Password',
      ...credentials.map((row) =>
        [row.full_name, row.email, row.login_id, row.temporary_password].map(escape).join(',')
      )
    ].join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `smp-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  return (
    <PortalShell>
      <PageHeader
        title="Rosters and mentors"
        subtitle={
          cycle
            ? `Steps 2 and 3 of ${cycleLabel(cycle.label)}: bring this year's students into the cycle, then map each one to their allotted mentor.`
            : 'Create accounts from the departmental spreadsheets, then map each student to their allotted mentor.'
        }
        actions={
          <Link to={`${uploadsBase}/cycles`} className="btn-secondary">
            <span className="material-symbols-outlined text-[18px]">event_repeat</span>
            Academic cycle
          </Link>
        }
      />

      {credentials && (
        <Panel className="mb-4" tab="Credentials — download this now" tabIcon="key">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-on-surface-variant">
              {credentials.length} account{credentials.length === 1 ? '' : 's'} created.{' '}
              {sharedPassword ? (
                <>
                  They all start on <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-label-md text-on-surface">{sharedPassword}</code> and are
                  forced to choose their own at first sign-in.
                </>
              ) : (
                <>
                  Temporary passwords are shown only in this download; every account is forced to set a new
                  password at first sign-in.
                </>
              )}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-primary" onClick={downloadCredentials}>
                <span className="material-symbols-outlined text-[18px]">download</span>
                Download CSV
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCredentials(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </Panel>
      )}

      {/* 1 — students. Accounts are created against the Email Id column,
             which is what they then sign in with. */}
      <AcademicUploadPanel
        title="1 · Student roster"
        tabIcon="school"
        endpoint="/admin/import-roster-spreadsheet"
        summarise={studentRosterSummary}
        hint="CSV or XLSX. Columns: Registration No, Student Name, Email Id. Optional: Section, Semester, Program Name, Mobile Number, Father's Name / Number / Email. Students who already have an account are activated in this cycle with the Semester, Section and Program in the file."
        submitLabel="Import student roster"
        buildPayload={({ filename, file_base64 }) => ({
          import_type: 'student',
          create_accounts: true,
          filename,
          file_base64
        })}
        onUploaded={onRosterUploaded}
      />

      <div className="mt-4">
        <AcademicUploadPanel
          title="2 · Faculty roster"
          tabIcon="badge"
          endpoint="/admin/import-roster-spreadsheet"
          summarise={rosterSummary}
          hint={
            'CSV or XLSX. Columns: Faculty ID, Name, Email. Optional: Department, Password.' +
            (isHodUploads ? ' Faculty you add here report to you.' : '')
          }
          submitLabel="Create faculty accounts"
          showCycle={false}
          buildPayload={({ filename, file_base64 }) => ({
            import_type: 'faculty',
            create_accounts: true,
            filename,
            file_base64
          })}
          onUploaded={onRosterUploaded}
        />
      </div>

      {/* 3 — the mapping. Deliberately last: it matches on existing
             accounts and reports anything it cannot find, rather than
             creating either side silently. */}
      <div className="mt-4">
        <AcademicUploadPanel
          title="3 · Mentor–mentee mapping"
          tabIcon="supervisor_account"
          summarise={mentorSummary}
          hint={
            'CSV or XLSX. Columns: Registration No. and Mentor Email. Optional: Mentor Name, used to name any account this creates. The Mentor Phone No. column is ignored.' +
            (isHodUploads ? ' Mentor accounts this creates report to you.' : '')
          }
          submitLabel="Map students to mentors"
          buildPayload={({ filename, file_base64 }) => ({
            action: 'mentor-map',
            filename,
            file_base64
          })}
        />
      </div>

      <Panel className="mt-4" tab="How the three fit together" tabIcon="info">
        <ul className="space-y-2 text-body-sm text-on-surface-variant">
          <li>
            <strong className="text-on-surface">Upload the student roster first.</strong> The mapping
            matches students on their registration number, so they have to exist. A row it cannot match is
            listed back to you with the reason rather than being skipped silently.
          </li>
          <li>
            <strong className="text-on-surface">Mentors do not have to exist.</strong> Any mentor email in
            the mapping file that has no account gets one, on the same temporary password, and can sign in
            with that address straight away.
          </li>
          <li>
            <strong className="text-on-surface">Everyone signs in with their email</strong> and the shared
            temporary password, then has to set their own before they can reach anything else.
          </li>
          <li>
            <strong className="text-on-surface">A full roster takes a few minutes.</strong> Each account is
            created individually, so 2,700 students is sent in several passes — the counter under the button
            shows how far through the file it is. Leave the tab open until it finishes.
          </li>
          <li>
            <strong className="text-on-surface">Re-uploading is safe.</strong> An email that already has
            an account is never created twice, so if an upload is interrupted you can simply run the same
            file again and it picks up what is missing. Re-running the mapping only changes students whose
            mentor actually changed.
          </li>
          <li>
            <strong className="text-on-surface">Existing students are activated, not skipped.</strong> A
            student on the roster who already has an account joins the current academic cycle, and the
            Semester, Section and Program in the file become their current ones. A blank cell changes
            nothing, and guardian details only fill in what is missing. This is how next year&apos;s roster
            moves everyone into the new cycle.
          </li>
          <li>
            <strong className="text-on-surface">Each cycle keeps its own record.</strong> The semester,
            section and mentor a student had in a closed cycle stay in that cycle and its report, whatever
            this year&apos;s files say.
          </li>
          <li>
            <strong className="text-on-surface">Changing a mentor notifies everyone.</strong> The student,
            the outgoing mentor and the incoming one are all told, and the move is written to the
            reassignment log.
          </li>
        </ul>
      </Panel>

      <Panel className="mt-4" tab="Import history" tabIcon="history" bodyClassName="">
        <DataTable
          dense
          columns={[
            { key: 'created_at', header: 'When', render: (row) => formatDateTime(row.created_at) },
            { key: 'cycle', header: 'Cycle', render: (row) => cycleLabel(row.cycle?.label) },
            { key: 'import_type', header: 'Type' },
            { key: 'original_filename', header: 'File' },
            { key: 'total_rows', header: 'Rows', align: 'right' },
            { key: 'created_count', header: 'Created', align: 'right' },
            { key: 'skipped_count', header: 'Skipped', align: 'right' },
            {
              key: 'failed_count',
              header: 'Failed',
              align: 'right',
              render: (row) => (
                <span className={row.failed_count > 0 ? 'text-error' : ''}>{row.failed_count}</span>
              )
            }
          ]}
          rows={batches}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState
              icon="upload_file"
              title="No roster imports yet"
              description="Start with the student roster above."
            />
          }
        />
      </Panel>
    </PortalShell>
  );
}
