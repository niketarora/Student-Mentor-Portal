/**
 * ClusterHeadGpaPage
 * The ERP's "Student's CGPA / GPA & Credits" export goes in as it is. It
 * carries every semester the batch has finished, so one upload records all
 * of them, along with the official CGPA and the credits.
 *
 * NOTHING TO CHOOSE
 * Which semester a GPA belongs to is written above its column in the
 * export ("Semester I", "Semester II" ...). A semester showing "-" has not
 * been graded yet and is skipped, so the semester in progress never lands
 * as a zero.
 *
 * A figure uploaded here is the departmental record: it overwrites whatever
 * the student self-reported for that semester, and from then on the
 * student can no longer edit it (see upsert_semester_gpa in migration
 * 0021). That matters because GPA below 6 is one of the three at-risk
 * conditions — a student should not be able to edit away the reason they
 * were flagged.
 */

import { useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import AcademicUploadPanel from '../../components/clusterHead/AcademicUploadPanel.jsx';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const semesterList = (numbers) => (numbers?.length ? numbers.map((n) => ROMAN[n] ?? n).join(', ') : null);

export default function ClusterHeadGpaPage() {
  const [lastUpload, setLastUpload] = useState(null);
  const meta = lastUpload?.file_meta;
  const notGraded = (meta?.semesters_in_file ?? []).filter((n) => !(meta?.graded_semesters ?? []).includes(n));

  return (
    <PortalShell>
      <PageHeader
        title="Upload GPA"
        subtitle="Drop in the ERP's CGPA / GPA & Credits export. Every graded semester, the CGPA and the credits are read from the file and matched on registration number."
      />

      <AcademicUploadPanel
        title="CGPA / GPA & Credits export"
        tabIcon="grade"
        hint="The ERP export (.xls, as downloaded), or the same layout saved as .xlsx or .csv: Registration No., CGPA and credits, then GPA / Earned Credits / Req Credits under each Semester heading."
        accept=".xls,.xlsx,.csv"
        placeholder="Choose the GPA export (.xls, .xlsx or .csv)"
        submitLabel="Upload GPA"
        summarise={(data) => [
          { label: 'Students in file', value: data.total_rows ?? 0 },
          { label: 'Recorded', value: data.matched ?? 0 },
          { label: 'Not recorded', value: data.failed ?? 0 },
          { label: 'Semester GPAs', value: data.semester_gpas_recorded ?? 0 },
          { label: 'Students re-checked', value: data.students_reevaluated ?? 0 }
        ]}
        buildPayload={({ filename, file_base64 }) => ({
          action: 'gpa',
          filename,
          file_base64
        })}
        onUploaded={setLastUpload}
      />

      {meta && (
        <Panel className="mt-4" tab="Read from the file" tabIcon="description">
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Semesters in the file', semesterList(meta.semesters_in_file) ?? '—'],
              ['Recorded', semesterList(meta.graded_semesters) ?? 'None graded yet'],
              ['Not graded yet', semesterList(notGraded) ?? '—'],
              ['CGPA', meta.has_cgpa ? `${lastUpload.cgpa_recorded ?? 0} recorded` : 'Not in this file']
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                <dd className="mt-0.5 break-anywhere text-body-sm text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>
          {meta.ignored_semesters?.length > 0 && (
            <p className="mt-4 rounded-lg bg-warning-container/40 px-4 py-3 text-body-sm text-on-surface-variant">
              Semester {meta.ignored_semesters.join(', ')} columns were not recorded: the portal keeps
              semesters 1 to 8.
            </p>
          )}
        </Panel>
      )}

      <Panel className="mt-4" tab="What happens next" tabIcon="info">
        <div className="space-y-2 text-body-sm text-on-surface-variant">
          <p>
            Each student in the file is re-checked against the at-risk rule straight away: attendance below
            75%, a GPA below 6 in their latest graded semester, an uncleared backlog, or a black dot in the
            current academic cycle. A newly flagged
            student appears on their mentor&apos;s At-Risk Students page and the mentor is notified; the
            follow-up meeting is raised by the next at-risk meeting run. A corrected upload that clears the
            condition lifts the flag just as quickly.
          </p>
          <p>
            Uploading the export again is safe. Each student&apos;s semesters are updated in place and their
            CGPA is replaced with the one in the file.
          </p>
        </div>
      </Panel>
    </PortalShell>
  );
}
