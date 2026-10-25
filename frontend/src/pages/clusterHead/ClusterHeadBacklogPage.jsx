/**
 * ClusterHeadBacklogPage
 * The ERP's "Defaulter Grade" result goes in as it is: one column per
 * subject, one row per student who failed something, with the grade (F,
 * UFM, DT ...). The semester and the exam are read from its title lines,
 * subject names and credits from the table underneath.
 *
 * THE LIST IS THE WHOLE TRUTH FOR ITS SUBJECTS
 * It only lists defaulters. So for the semester and subjects in the file,
 * a backlog that was open before and is now blank, or whose student is no
 * longer listed, has been cleared. That is how the at-risk backlog flag
 * lifts after a make-up exam: upload the new result, nothing else.
 *
 * A single uncleared backlog is enough to flag a student.
 */

import { useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { SelectField, TextField } from '../../components/ui/FormControls.jsx';
import AcademicUploadPanel from '../../components/clusterHead/AcademicUploadPanel.jsx';
import { SEMESTER_OPTIONS } from '../../lib/constants.js';

export default function ClusterHeadBacklogPage() {
  const [semester, setSemester] = useState('');
  const [examSession, setExamSession] = useState('');
  const [lastUpload, setLastUpload] = useState(null);
  const meta = lastUpload?.file_meta;

  return (
    <PortalShell>
      <PageHeader
        title="Upload backlogs"
        subtitle="Drop in the ERP's Defaulter Grade result. The semester, exam and subjects are read from the file, and students are matched on registration number."
      />

      {/* Both are fallbacks. The export names its semester and exam in its
          title, and the file wins for the semester. */}
      <Panel className="mb-4" tab="Only needed if the file does not say" tabIcon="tune">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SelectField
            label="Semester"
            name="semester"
            placeholder="Read it from the file"
            options={SEMESTER_OPTIONS}
            value={semester}
            onChange={(event) => setSemester(event.target.value)}
            hint="Used only when the file's title names no semester"
          />
          <TextField
            label="Exam label"
            name="exam_session"
            placeholder="Read it from the file"
            maxLength={60}
            value={examSession}
            onChange={(event) => setExamSession(event.target.value)}
            hint="Optional. Replaces the exam name from the file's title"
          />
        </div>
      </Panel>

      <AcademicUploadPanel
        title="Defaulter Grade result"
        tabIcon="assignment_late"
        hint="The ERP export (.xls, as downloaded), or the same layout saved as .xlsx or .csv: Registration No, Student Name, then one column per subject code with the grade (F, UFM, DT ...)."
        accept=".xls,.xlsx,.csv"
        placeholder="Choose the result export (.xls, .xlsx or .csv)"
        submitLabel="Upload backlogs"
        summarise={(data) => [
          { label: 'Students in file', value: data.total_rows ?? 0 },
          { label: 'Backlogs recorded', value: data.backlogs_recorded ?? 0 },
          { label: 'Backlogs cleared', value: data.backlogs_cleared ?? 0 },
          { label: 'Not matched', value: data.failed ?? 0 },
          { label: 'Students re-checked', value: data.students_reevaluated ?? 0 }
        ]}
        buildPayload={({ filename, file_base64 }) => ({
          action: 'backlog',
          semester_number: semester ? Number(semester) : null,
          exam_session: examSession.trim() || null,
          filename,
          file_base64
        })}
        onUploaded={setLastUpload}
      />

      {meta && (
        <Panel className="mt-4" tab="Read from the file" tabIcon="description">
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Semester', lastUpload.semester_number ? `Semester ${lastUpload.semester_number}` : '—'],
              ['Exam', lastUpload.exam_session || '—'],
              ['Programme', meta.programme || '—'],
              ['Subjects', meta.subject_codes?.length ? String(meta.subject_codes.length) : 'One per row (hand-made list)']
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-label-sm uppercase tracking-wide text-tertiary">{label}</dt>
                <dd className="mt-0.5 break-anywhere text-body-sm text-on-surface">{value}</dd>
              </div>
            ))}
          </dl>

          {meta.subjects?.length > 0 && (
            <div className="mt-4">
              <DataTable
                dense
                columns={[
                  { key: 'code', header: 'Code' },
                  { key: 'name', header: 'Subject', render: (row) => row.name || '—' },
                  { key: 'credits', header: 'Credits', align: 'right', render: (row) => row.credits || '—' }
                ]}
                rows={meta.subjects}
                rowKey={(row) => row.code}
              />
            </div>
          )}
        </Panel>
      )}

      <Panel className="mt-4" tab="How clearing works" tabIcon="info">
        <div className="space-y-2 text-body-sm text-on-surface-variant">
          <p>
            The Defaulter Grade result names only the students who still owe a subject. So for the semester
            and subjects in the file, a backlog that was open before and is now blank, or whose student is no
            longer listed, is marked cleared. Always upload the latest result for a semester: an older one
            uploaded afterwards would reopen what the newer one cleared.
          </p>
          <p>
            Only fail grades (F, UFM, DT, AB, I and the like) count as backlogs. Anything else in a subject
            column is listed back to you, and that subject is left as it was.
          </p>
          <p>
            Everyone the upload touches is re-checked against the at-risk rule straight away. If a cleared
            backlog was the only reason a student was flagged, the flag lifts and their mentor is told.
          </p>
        </div>
      </Panel>
    </PortalShell>
  );
}
