/**
 * ClusterHeadBlackDotPage
 * The Proctorial Board's "Notice of PB meeting" goes in as it is: a Word
 * document with one table per case. Every student listed under a case gets
 * a black dot on their record, matched on registration number.
 *
 * NOTHING TO FILL IN — just pick the file.
 * Case numbers, what each case is about and the dates of incidence are all
 * in the notice, so there is nothing to choose on this screen.
 *
 * MOST ROWS MAY NOT BE OURS
 * A PB notice covers the whole university. Students who are not in this
 * portal are listed back as "not in the portal" and nothing is recorded
 * for them; that is the expected outcome, not a failed upload.
 *
 * Black dots show on the student's record — on their own Academics page
 * and on the student page their mentor and the HOD open.
 *
 * AT-RISK (migration 0036)
 * One black dot in the active academic cycle flags the student at-risk,
 * the same as one uncleared backlog, and the upload re-checks everyone it
 * names. A black dot cannot be cleared, so it counts only in the cycle its
 * incident falls in; the next cycle lifts the flag.
 */

import { useState } from 'react';
import PortalShell from '../../components/layout/PortalShell.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Panel from '../../components/ui/Panel.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import AcademicUploadPanel from '../../components/clusterHead/AcademicUploadPanel.jsx';

export default function ClusterHeadBlackDotPage() {
  const [lastUpload, setLastUpload] = useState(null);
  const cases = lastUpload?.file_meta?.cases ?? [];

  return (
    <PortalShell>
      <PageHeader
        title="Upload Black dot"
        subtitle="Upload the Proctorial Board notice. Every student listed under a case gets a black dot on their record, matched on registration number."
      />

      <AcademicUploadPanel
        title="PB notice"
        tabIcon="gavel"
        hint={'The notice as a Word file (.docx), or the same table as .xlsx or .csv. Each case needs its "Case No:" line above the table, and each student a Regn No.'}
        accept=".docx,.xlsx,.csv,.xls"
        placeholder="Choose the PB notice (.docx, .xlsx or .csv)"
        submitLabel="Upload black dots"
        summarise={(data) => [
          { label: 'Students in notice', value: data.total_rows ?? 0 },
          { label: 'Black dots recorded', value: data.matched ?? 0 },
          { label: 'Not recorded', value: data.failed ?? 0 },
          { label: 'Cases', value: data.cases ?? 0 },
          { label: 'Students re-checked', value: data.students_reevaluated ?? 0 }
        ]}
        buildPayload={({ filename, file_base64 }) => ({
          action: 'black-dot',
          filename,
          file_base64
        })}
        onUploaded={setLastUpload}
      />

      {cases.length > 0 && (
        <Panel className="mt-4" tab="Read from the notice" tabIcon="description" bodyClassName="">
          <DataTable
            dense
            columns={[
              { key: 'case_number', header: 'Case no.' },
              { key: 'case_details', header: 'About', render: (row) => row.case_details || '—' },
              { key: 'students', header: 'Students listed', align: 'right' }
            ]}
            rows={cases}
            rowKey={(row) => row.case_number}
          />
        </Panel>
      )}

      <Panel className="mt-4" tab="How the matching works" tabIcon="info">
        <ul className="space-y-2 text-body-sm text-on-surface-variant">
          <li>
            <strong className="text-on-surface">Student</strong> — matched on the <em>Regn No</em> column,
            and nothing else. Students from other departments are listed back as not in the portal, and
            nothing is recorded for them.
          </li>
          <li>
            <strong className="text-on-surface">Name check</strong> — the notice is typed by hand, so the{' '}
            <em>Name</em> in it has to share a word with the student&apos;s name in the portal. If it does
            not, that row is not recorded, in case the registration number was mistyped.
          </li>
          <li>
            <strong className="text-on-surface">Case</strong> — taken from the <em>Case No:</em> line above
            each table. The text after the case number is kept as what the case is about. The date of
            incidence can be written once per case.
          </li>
          <li>
            <strong className="text-on-surface">Uploading again</strong> — the same student and case number
            updates the existing black dot instead of adding a second one, so a corrected notice can simply
            be uploaded again.
          </li>
          <li>
            <strong className="text-on-surface">At-risk</strong> — one black dot flags the student at-risk
            for the academic cycle it falls in, the same as one uncleared backlog, and their mentor is told
            straight away. It is filed under the cycle of its date of incidence (the upload date if the
            notice gives none), so a new cycle starts every student afresh.
          </li>
          <li>
            <strong className="text-on-surface">Who sees it</strong> — the student, on their Academics page,
            and their mentor and the HOD, on the student&apos;s record and the At-Risk Students page.
          </li>
        </ul>
      </Panel>
    </PortalShell>
  );
}
