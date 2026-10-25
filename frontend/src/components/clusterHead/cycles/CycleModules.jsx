/**
 * CycleModules
 * The per-module panels of the Academic Cycles page: students, attendance,
 * GPA, backlogs, black dots and uploads, each drawn from
 * get_cycle_overview() for one cycle and, where it applies, one semester.
 *
 * Numbers only. The overview names no student and carries no GPA values
 * or at-risk flags, because a cluster head cannot read those; the panels
 * say so where someone might look for them.
 */

import { useState } from 'react';
import Panel from '../../ui/Panel.jsx';
import StatCard from '../../ui/StatCard.jsx';
import DataTable from '../../ui/DataTable.jsx';
import EmptyState from '../../ui/EmptyState.jsx';
import { formatDate, formatDateTime } from '../../../lib/formatters.js';
import { ACADEMIC_UPLOAD_LABELS } from '../../../lib/constants.js';
import { semesterTitle, uploadScope } from '../../../lib/academicCycles.js';

const count = (value) => Number(value ?? 0).toLocaleString('en-IN');
const percent = (value) => (value == null ? '—' : `${Number(value).toFixed(1).replace(/\.0$/, '')}%`);

const PREVIEW_ROWS = 10;

/**
 * The first rows of a long list (60 mentors, a term's uploads) and a
 * button for the rest, so one table does not push the page off screen.
 */
function useShowMore(rows) {
  const [all, setAll] = useState(false);
  const list = rows ?? [];
  const footer =
    list.length > PREVIEW_ROWS ? (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-container px-5 py-2.5">
        <span className="text-label-sm text-tertiary">
          {all ? `All ${count(list.length)}` : `Showing ${PREVIEW_ROWS} of ${count(list.length)}`}
        </span>
        <button type="button" className="text-label-md text-primary hover:underline" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show all ${count(list.length)}`}
        </button>
      </div>
    ) : null;
  return { rows: all ? list : list.slice(0, PREVIEW_ROWS), footer };
}

const VIA_LABELS = {
  existing: 'On the portal before cycles',
  account: 'New account',
  roster: 'Roster import',
  mentor_map: 'Mentor mapping',
  carried_over: 'Carried over',
  profile: 'Profile change'
};

function SemesterChip({ cycle, semester }) {
  if (!semester) return <span className="text-tertiary">—</span>;
  return (
    <span
      className={`chip whitespace-nowrap ${
        semester === 'Odd' ? 'bg-info-container text-on-info-container' : 'bg-primary-fixed text-on-primary-fixed'
      }`}
    >
      {semesterTitle(cycle, semester)}
    </span>
  );
}

function LabelCountTable({ title, icon, rows, emptyText }) {
  return (
    <Panel tab={title} tabIcon={icon} bodyClassName="">
      <DataTable
        dense
        columns={[
          { key: 'label', header: title.replace(/^By /, '') },
          { key: 'students', header: 'Students', align: 'right', render: (row) => count(row.students) }
        ]}
        rows={rows ?? []}
        rowKey={(row) => row.label}
        emptyState={<EmptyState icon="group" title="Nobody yet" description={emptyText} />}
      />
    </Panel>
  );
}

export function StudentsModule({ overview }) {
  const students = overview?.students ?? {};
  const mentors = overview?.mentors ?? {};
  const via = Object.entries(students.by_via ?? {}).sort((a, b) => b[1] - a[1]);
  const mentorList = useShowMore(mentors.list);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Students in this cycle" value={count(students.activated)} icon="school" tone="primary"
          caption={students.not_activated ? `${count(students.not_activated)} accounts not activated yet` : null} />
        <StatCard label="With a mentor" value={count(students.with_mentor)} icon="supervisor_account" tone="success" />
        <StatCard label="Without a mentor" value={count(students.without_mentor)} icon="person_off"
          tone={students.without_mentor ? 'error' : 'success'} />
        <StatCard label="Mentors" value={count(mentors.count)} icon="badge" tone="info" />
      </div>

      {via.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
          <span className="text-label-sm uppercase tracking-wide text-tertiary">How they joined</span>
          {via.map(([key, value]) => (
            <span key={key} className="chip bg-surface-container text-on-surface-variant">
              {VIA_LABELS[key] ?? key}: {count(value)}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <LabelCountTable title="By semester" icon="stairs" rows={students.by_semester}
          emptyText="Import a roster or carry students over." />
        <LabelCountTable title="By section" icon="view_week" rows={students.by_section}
          emptyText="Sections come from the roster." />
        <LabelCountTable title="By branch" icon="account_tree" rows={students.by_branch}
          emptyText="Branches come from the roster." />
      </div>

      <Panel tab={`Mentor workload (${count(mentors.count)})`} tabIcon="supervisor_account" bodyClassName="">
        <DataTable
          dense
          columns={[
            { key: 'name', header: 'Mentor', render: (row) => row.name ?? '—' },
            { key: 'email', header: 'Email', render: (row) => <span className="break-anywhere">{row.email}</span> },
            { key: 'mentees', header: 'Mentees this cycle', align: 'right', render: (row) => count(row.mentees) }
          ]}
          rows={mentorList.rows}
          rowKey={(row) => row.mentor_id}
          emptyState={
            <EmptyState icon="supervisor_account" title="No mentors assigned in this cycle"
              description="Upload the mentor–mentee mapping under Rosters & Mentors." />
          }
        />
        {mentorList.footer}
      </Panel>
    </div>
  );
}

export function AttendanceModule({ overview }) {
  const cycle = overview?.cycle;
  const attendance = overview?.attendance ?? {};
  const bySemester = attendance.by_semester ?? [];

  if (!bySemester.length) {
    return (
      <Panel tab="Attendance" tabIcon="fact_check">
        <EmptyState icon="fact_check" title="No attendance in this cycle yet"
          description="Attendance uploaded while this cycle is active shows here, filed under the semester its reporting period ends in." />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {bySemester.map((row) => (
        <div key={row.semester}>
          <p className="mb-2 text-label-md text-on-surface">{semesterTitle(cycle, row.semester)}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Average attendance" value={percent(row.average)} icon="percent" tone="info"
              caption={`Latest period per student and subject · up to ${formatDate(row.last_period_end)}`} />
            <StatCard label="Students below 75%" value={count(row.students_below_75)} icon="event_busy"
              tone={row.students_below_75 ? 'error' : 'success'} caption={`Of ${count(row.students)} with attendance`} />
            <StatCard label="Subjects" value={count(row.subjects)} icon="menu_book" tone="primary" />
            <StatCard label="Sections" value={count(row.sections)} icon="view_week" tone="slate" />
          </div>
        </div>
      ))}

      <Panel tab="By subject" tabIcon="menu_book" bodyClassName="">
        <DataTable
          dense
          columns={[
            {
              key: 'course_code',
              header: 'Subject',
              render: (row) => (
                <span className="block min-w-[10rem]">
                  <span className="block text-label-md text-on-surface">{row.course_code}</span>
                  <span className="block text-label-sm text-tertiary">{row.course_name}</span>
                </span>
              )
            },
            { key: 'semester', header: 'Semester', render: (row) => <SemesterChip cycle={cycle} semester={row.semester} /> },
            { key: 'sections', header: 'Sections', align: 'right' },
            { key: 'students', header: 'Students', align: 'right', render: (row) => count(row.students) },
            { key: 'average', header: 'Average', align: 'right', render: (row) => percent(row.average) },
            {
              key: 'below_75',
              header: 'Below 75%',
              align: 'right',
              render: (row) => (row.below_75 ? <span className="text-error">{count(row.below_75)}</span> : '0')
            },
            { key: 'last_period_end', header: 'Up to', render: (row) => formatDate(row.last_period_end) }
          ]}
          rows={attendance.by_subject ?? []}
          rowKey={(row) => `${row.course_code}-${row.semester}`}
        />
      </Panel>
    </div>
  );
}

export function GpaModule({ overview }) {
  const gpa = overview?.gpa ?? {};
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="GPA uploads" value={count(gpa.uploads)} icon="grade" tone="primary" />
        <StatCard label="Student rows recorded" value={count(gpa.students_recorded)} icon="how_to_reg" tone="success" />
        <StatCard label="Last GPA upload" value={gpa.last_at ? formatDate(gpa.last_at) : 'None yet'} icon="schedule" tone="slate" />
      </div>
      <Panel tab="What was uploaded" tabIcon="grade">
        {gpa.scopes?.length ? (
          <ul className="flex flex-wrap gap-2">
            {gpa.scopes.map((scope) => (
              <li key={scope} className="chip bg-surface-container text-on-surface-variant">{scope}</li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-on-surface-variant">No GPA export has been uploaded in this cycle yet.</p>
        )}
        <p className="mt-3 text-body-sm text-tertiary">
          GPA values are not shown on the upload screens. Students, their mentors and the HOD see them on the
          student&apos;s record. A GPA belongs to a programme semester (1 to 8), so it carries on from cycle to cycle.
        </p>
      </Panel>
    </div>
  );
}

export function BacklogsModule({ overview }) {
  const cycle = overview?.cycle;
  const backlogs = overview?.backlogs ?? {};
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Backlogs recorded" value={count(backlogs.recorded)} icon="assignment_late" tone="primary"
          caption="First recorded in this cycle" />
        <StatCard label="Still open" value={count(backlogs.open)} icon="error" tone={backlogs.open ? 'error' : 'success'} />
        <StatCard label="Cleared" value={count(backlogs.cleared)} icon="task_alt" tone="success" />
        <StatCard label="Students with one open" value={count(backlogs.students_with_open)} icon="person_alert" tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel tab="By programme semester" tabIcon="stairs" bodyClassName="">
          <DataTable
            dense
            columns={[
              {
                key: 'semester_number',
                header: 'Semester',
                render: (row) => (row.semester_number ? `Semester ${row.semester_number}` : 'Not given')
              },
              {
                key: 'term',
                header: 'Filed under',
                render: (row) =>
                  row.semester_number ? (
                    <SemesterChip cycle={cycle} semester={row.semester_number % 2 === 1 ? 'Odd' : 'Even'} />
                  ) : (
                    '—'
                  )
              },
              { key: 'open', header: 'Open', align: 'right', render: (row) => count(row.open) },
              { key: 'cleared', header: 'Cleared', align: 'right', render: (row) => count(row.cleared) }
            ]}
            rows={backlogs.by_programme_semester ?? []}
            rowKey={(row) => String(row.semester_number)}
            emptyState={<EmptyState icon="task_alt" title="No backlogs recorded in this cycle" />}
          />
        </Panel>

        <Panel tab="Subjects with the most open backlogs" tabIcon="leaderboard" bodyClassName="">
          <DataTable
            dense
            columns={[
              {
                key: 'subject_code',
                header: 'Subject',
                render: (row) => (
                  <span className="block min-w-[10rem]">
                    <span className="block text-label-md text-on-surface">{row.subject_code}</span>
                    {row.subject_name && <span className="block text-label-sm text-tertiary">{row.subject_name}</span>}
                  </span>
                )
              },
              { key: 'open', header: 'Open', align: 'right', render: (row) => count(row.open) },
              { key: 'cleared', header: 'Cleared', align: 'right', render: (row) => count(row.cleared) }
            ]}
            rows={backlogs.top_subjects ?? []}
            rowKey={(row) => row.subject_code}
            emptyState={<EmptyState icon="task_alt" title="Nothing to rank yet" />}
          />
        </Panel>
      </div>
      <p className="text-body-sm text-tertiary">
        An odd programme semester (1, 3, 5, 7) is filed under the odd semester and an even one under the even
        semester. A backlog stays open across cycles until a later result clears it.
      </p>
    </div>
  );
}

export function BlackDotsModule({ overview }) {
  const cycle = overview?.cycle;
  const dots = overview?.black_dots ?? {};
  const caseList = useShowMore(dots.case_list);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Black dots" value={count(dots.black_dots)} icon="gavel" tone="error" />
        <StatCard label="Students" value={count(dots.students)} icon="person" tone="warning"
          caption="Each one is flagged at-risk while this cycle is active" />
        <StatCard label="Cases" value={count(dots.cases)} icon="folder_open" tone="slate" />
      </div>
      <Panel tab="Cases" tabIcon="gavel" bodyClassName="">
        <DataTable
          dense
          columns={[
            { key: 'case_number', header: 'Case', render: (row) => <span className="whitespace-nowrap text-label-md text-on-surface">{row.case_number}</span> },
            {
              key: 'case_details',
              header: 'About',
              render: (row) => <span className="block min-w-[14rem] text-on-surface-variant">{row.case_details || '—'}</span>
            },
            {
              key: 'incident_date',
              header: 'Incident',
              render: (row) => (
                <span className="whitespace-nowrap">
                  {row.incident_date ? formatDate(row.incident_date) : row.incident_date_text || '—'}
                </span>
              )
            },
            { key: 'semester', header: 'Semester', render: (row) => <SemesterChip cycle={cycle} semester={row.semester} /> },
            { key: 'students', header: 'Students', align: 'right', render: (row) => count(row.students) }
          ]}
          rows={caseList.rows}
          rowKey={(row) => row.case_number}
          emptyState={<EmptyState icon="verified_user" title="No black dots in this cycle" />}
        />
        {caseList.footer}
      </Panel>
      <p className="text-body-sm text-tertiary">
        A black dot is filed under the cycle and semester its incident date falls in, or when the notice was
        uploaded if it gives no date.
      </p>
    </div>
  );
}

export function UploadsModule({ overview }) {
  const cycle = overview?.cycle;
  const uploads = overview?.uploads ?? {};
  const rosters = overview?.roster_imports ?? {};
  const byType = uploads.by_type ?? [];
  const uploadList = useShowMore(uploads.list);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {['attendance', 'gpa', 'backlog', 'black_dot'].map((type) => {
          const rows = byType.filter((row) => row.upload_type === type);
          const total = rows.reduce((sum, row) => sum + Number(row.uploads), 0);
          const failed = rows.reduce((sum, row) => sum + Number(row.failed ?? 0), 0);
          return (
            <StatCard key={type} label={ACADEMIC_UPLOAD_LABELS[type] ?? type} value={count(total)} icon="cloud_upload"
              tone={total ? 'primary' : 'slate'} caption={failed ? `${count(failed)} rows not matched` : null} />
          );
        })}
        <StatCard label="Roster imports" value={count(rosters.count)} icon="group_add" tone="slate"
          caption={rosters.accounts_created ? `${count(rosters.accounts_created)} accounts created` : null} />
      </div>

      <Panel tab={`Uploads (${count(uploads.total)})`} tabIcon="history" bodyClassName="">
        <DataTable
          dense
          columns={[
            {
              key: 'created_at',
              header: 'When',
              render: (row) => (
                <span className="block whitespace-nowrap">
                  {formatDateTime(row.created_at)}
                  {row.uploaded_by_name && <span className="block text-label-sm text-tertiary">by {row.uploaded_by_name}</span>}
                </span>
              )
            },
            {
              key: 'upload_type',
              header: 'Upload',
              render: (row) => (
                <span className="block min-w-[10rem]">
                  <span className="block text-label-md text-on-surface">{ACADEMIC_UPLOAD_LABELS[row.upload_type] ?? row.upload_type}</span>
                  <span className="block text-label-sm text-tertiary">{uploadScope(row)}</span>
                </span>
              )
            },
            { key: 'semester', header: 'Semester', render: (row) => <SemesterChip cycle={cycle} semester={row.semester} /> },
            {
              key: 'original_filename',
              header: 'File',
              render: (row) => (
                <span className="block max-w-[14rem] truncate" title={row.original_filename}>{row.original_filename}</span>
              )
            },
            {
              key: 'matched_rows',
              header: 'Recorded',
              align: 'right',
              render: (row) => (
                <span className="block whitespace-nowrap tabular-nums">
                  {count(row.matched_rows)}
                  {row.failed_rows > 0 && (
                    <span className="mt-0.5 block text-label-sm text-error">{count(row.failed_rows)} not matched</span>
                  )}
                </span>
              )
            }
          ]}
          rows={uploadList.rows}
          rowKey={(row) => row.id}
          emptyState={
            <EmptyState icon="cloud_upload" title="Nothing uploaded in this cycle yet"
              description="Uploads made while this cycle is active are listed here." />
          }
        />
        {uploadList.footer}
      </Panel>
    </div>
  );
}
