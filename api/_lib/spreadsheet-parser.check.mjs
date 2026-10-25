/**
 * node api/_lib/spreadsheet-parser.check.mjs
 *
 * The parser is the only place that knows a student can be listed twice
 * for one course and that the section lives on the row, not in the
 * header. Both are silent failures — wrong numbers, not errors — so they
 * get the one check.
 *
 * The same goes for the three ERP / PB-notice layouts: a GPA filed under
 * the wrong semester, a subject code read as a student, or a black dot on
 * the wrong case would all "work". Each layout is checked as the real
 * source produces it (the sample generator mirrors those files) and in the
 * other formats a Cluster Head might re-save it as.
 */
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  parseAttendanceExport,
  parseBacklogExport,
  parseBlackDotNotice,
  parseGpaExport,
  parseHodMappingFile,
  parseMentorMappingFile,
  parseNoticeDate
} from './spreadsheet-parser.js';
import {
  SAMPLE_BACKLOG_RESULTS,
  SAMPLE_GPA_EXPORT,
  buildBlackDotNoticeDocx,
  buildDefaulterGradeHtml,
  buildGpaExportHtml,
  buildHodMappingCsv,
  SAMPLE_HOD_MAPPING
} from '../../sample-data/cluster-head-sample-data.mjs';

const enc = (s) => Buffer.from(s, 'utf8');

const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const sheet = (header, dataRows) => enc(
  `<table>
     <tr><td>Consolidated Attendance</td><td>Academic Year: 26-27</td></tr>
     <tr><td></td><td>From Date: 23/07/2026</td><td>To Date:18/08/2026</td></tr>
     <tr><td>Course Code: DOA2099</td><td>Course Name: PRINCIPLES OF MANAGEMENT</td><td>Section: ${header}</td></tr>
     ${row(['S.No.', 'Registration No.', 'Name', 'Faculty Name', 'Course Code', 'Section', 'Total Class', 'Present', 'Absent', '%'])}
     ${dataRows.map(row).join('')}
   </table>`
);

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (error) { failures += 1; console.log(`  FAIL  ${name}\n        ${error.message}`); }
};

console.log('\nConsolidated attendance export');

await check('section comes from the row, not the blank header', async () => {
  const { meta, records } = await parseAttendanceExport(sheet('', [
    ['1', '2502050231', 'A ONE', 'Ritika Bhatia', 'DOA2099', 'B', '8', '7', '1', '87.00'],
    ['2', '2502050232', 'A TWO', 'Anuj Dixit', 'DOA2099', 'N', '8', '4', '4', '50.00']
  ]), 'ConsolidatedAttendance.xls');

  assert.equal(meta.course_code, 'DOA2099');
  assert.equal(meta.course_name, 'PRINCIPLES OF MANAGEMENT');
  assert.equal(meta.period_start, '2026-07-23');
  assert.equal(meta.period_end, '2026-08-18');
  assert.deepEqual(records.map((r) => r.section), ['B', 'N'], 'each row keeps its own section');
  assert.deepEqual(meta.sections, ['B', 'N']);
});

await check('a repeated registration number is summed, not overwritten', async () => {
  // 4/4 and 0/2 for the same student: 66.67%, which is below 75 and
  // therefore at risk. Keeping either row alone gets this wrong in
  // opposite directions (100% or 0%).
  const { records } = await parseAttendanceExport(sheet('', [
    ['1', '2502051271', 'DUPE', 'Ritika Bhatia', 'DOA2099', 'G', '4', '4', '0', '100.00'],
    ['2', '2502051271', 'DUPE', 'Anuj Dixit', 'DOA2099', 'G', '2', '0', '2', '0.00']
  ]), 'x.xls');

  assert.equal(records.length, 1, 'one row per registration number');
  assert.equal(records[0].classes_held, '6');
  assert.equal(records[0].classes_attended, '4');
  assert.equal(records[0].attendance_percent, '66.67');
});

await check('a single row keeps the ERP percentage verbatim', async () => {
  // 7/8 is 87.5, the ERP says 87.00. The ERP wins.
  const { records } = await parseAttendanceExport(sheet('', [
    ['1', '2502050231', 'SOLO', 'Ritika Bhatia', 'DOA2099', 'B', '8', '7', '1', '87.00']
  ]), 'x.xls');
  assert.equal(records[0].attendance_percent, '87');
});

await check('the header section still works as a fallback', async () => {
  const { records } = await parseAttendanceExport(enc(
    `<table>
       <tr><td>Course Code: CS2001</td><td>Course Name: DSA</td><td>Section: R 3</td></tr>
       ${row(['S.No.', 'Registration No.', 'Name', 'Total Class', 'Present', '%'])}
       ${row(['1', '2502050231', 'NO SECTION COLUMN', '10', '6', '60.00'])}
     </table>`
  ), 'x.xls');
  assert.equal(records[0].section, 'R 3');
});

console.log('\nMentor mentee list');

await check('maps registration number to mentor email and name, ignoring the phone', async () => {
  const records = await parseMentorMappingFile(enc(
    `<table>
       ${row(['S.No.', 'Registration No.', 'Name', 'Mentor Name', 'Mentor Phone No.', 'Mentor Email'])}
       ${row(['1', '2502051124', 'SAVI SAINI', 'Dr Bagesh Kumar', '9431645778', 'bagesh.kumar@jaipur.manipal.edu'])}
       ${row(['2', '2502051127', 'FADEEL REZA', 'Mr Chandrapal Singh Dangi', '', 'chandrapalsingh.dangi@jaipur.manipal.edu'])}
     </table>`
  ), 'Mentor Mentee List.xlsx');

  assert.equal(records.length, 2);
  assert.equal(records[0].identifier, '2502051124');
  assert.equal(records[0].mentor_email, 'bagesh.kumar@jaipur.manipal.edu');
  assert.equal(records[1].mentor_email, 'chandrapalsingh.dangi@jaipur.manipal.edu');
  assert.equal(records[1].identifier, '2502051127', 'a blank mentor phone does not shift the columns');

  // The mentor account this upload may have to create is named from here.
  assert.equal(records[0].mentor_name, 'Dr Bagesh Kumar');
  assert.equal(records[1].mentor_name, 'Mr Chandrapal Singh Dangi');
  assert.equal(
    records[0].mentor_name !== 'SAVI SAINI',
    true,
    'the student "Name" column must not be read as the mentor name'
  );
});

await check('an email column no longer stands in for the registration number', async () => {
  await assert.rejects(
    parseMentorMappingFile(enc(
      `<table>
         ${row(['S.No.', 'Student Email', 'Mentor Email'])}
         ${row(['1', 'john.doe@muj.manipal.edu', 'bagesh.kumar@jaipur.manipal.edu'])}
       </table>`
    ), 'map.xlsx'),
    /Registration No/
  );
});

console.log('\nMentor-HOD mapping (administrator)');

await check('reads the department sheet, "Cluster Head" columns as the HOD', async () => {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Mentor - Section - Email');
  ws.addRow(['Section', 'Mentor / Class Coordinator Name', 'Role', 'Official Email', 'Cluster Head', 'Official Email of Cluster Head']);
  ws.addRow(['O3', '  Dr  Asha   Verma ', 'Mentor', 'Asha.Verma@example.edu', 'Dr. Ravi Kumar', 'Ravi.Kumar@example.edu']);
  ws.addRow(['O 3', 'Mr. Dev Nair', 'Class Coordinator (fallback)', 'dev.nair@example.edu', 'Dr. Ravi Kumar', 'ravi.kumar@example.edu']);
  ws.addRow(['p 12', 'Ms. Ira Sen', 'Mentor', { text: 'ira.sen@example.edu', hyperlink: 'mailto:ira.sen@example.edu' }, 'Dr. Meera Iyer', 'meera.iyer@example.edu']);
  ws.addRow([]);
  ws.addRow(['', '', '', '', '', '']);
  const records = await parseHodMappingFile(Buffer.from(await workbook.xlsx.writeBuffer()), 'Mentor_Section_Email_List.xlsx');

  assert.equal(records.length, 3, 'blank trailing rows are skipped');
  assert.equal(records[0].section, 'O 3', '"O3" is written "O 3"');
  assert.equal(records[1].section, 'O 3');
  assert.equal(records[2].section, 'P 12');
  assert.equal(records[0].mentor_name, 'Dr Asha Verma', 'stray spaces in names are tidied');
  assert.equal(records[0].mentor_email, 'asha.verma@example.edu', 'emails are lower-cased');
  assert.equal(records[0].hod_email, 'ravi.kumar@example.edu');
  assert.equal(records[0].hod_name, 'Dr. Ravi Kumar');
  assert.equal(records[1].designation, 'Class Coordinator (fallback)');
  assert.equal(records[2].mentor_email, 'ira.sen@example.edu', 'a hyperlinked email cell reads as its text');
  assert.equal(records[0].row, 2, 'row numbers are the spreadsheet\'s');
});

await check('the sample file, with "HOD" headers', async () => {
  const records = await parseHodMappingFile(Buffer.from(buildHodMappingCsv()), 'mentor-hod-mapping-sample.csv');
  assert.equal(records.length, SAMPLE_HOD_MAPPING.length);
  assert.deepEqual(records.map((r) => r.hod_email), SAMPLE_HOD_MAPPING.map((m) => m.hod_email));
  assert.equal(records[0].hod_name, 'Dr. Sarah Jenkins');
});

await check('a file without both email columns is refused', async () => {
  await assert.rejects(
    parseHodMappingFile(enc('Section,Mentor Name,Official Email\nA 3,Dr X,x@example.edu\n'), 'map.csv'),
    /HOD's email/
  );
});

console.log('\nCGPA / GPA & Credits export');

const jane = (records) => records.find((record) => record.identifier === '2428020222');

await check('each GPA lands under the semester written above it; "-" is left out', async () => {
  const { meta, records } = await parseGpaExport(enc(buildGpaExportHtml(SAMPLE_GPA_EXPORT)), 'Students_CGPA___GPA__Credits_.xls');
  assert.equal(meta.layout, 'erp');
  assert.deepEqual(meta.semesters_in_file, [1, 2, 3]);
  assert.deepEqual(meta.graded_semesters, [1, 2], 'semester III is "-" in the export: not graded yet');
  assert.equal(records.length, 4);
  const record = jane(records);
  assert.equal(record.cgpa, '5.78');
  assert.equal(record.total_earned_credits, '37.00');
  assert.deepEqual(
    record.semesters.map((s) => [s.semester_number, s.gpa, s.earned_credits]),
    [[1, '6.10', '20.00'], [2, '5.40', '17.00']]
  );
});

const gpaCsv = [
  'S. No.,Registration No.,Student Name,CGPA,Total Earned Credits,Total Required Credits,Semester I,,,Semester II,,',
  ',,,,,,GPA,Earned Credits,Req Credits,GPA,Earned Credits,Req Credits',
  '1,2502050550,A ONE,7.26,40.00,-,7.68,20.00,-,6.84,20.00,-'
].join('\n');

await check('the same export re-saved as CSV (merged cells become blanks)', async () => {
  const { records } = await parseGpaExport(enc(gpaCsv), 'gpa.csv');
  assert.equal(records.length, 1);
  assert.equal(records[0].identifier, '2502050550');
  assert.equal(records[0].cgpa, '7.26');
  assert.deepEqual(records[0].semesters.map((s) => [s.semester_number, s.gpa]), [[1, '7.68'], [2, '6.84']]);
});

await check('and as .xlsx with merged header cells', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  gpaCsv.split('\n').forEach((line, index) => { sheet.getRow(index + 1).values = line.split(','); });
  for (const range of ['A1:A2', 'B1:B2', 'C1:C2', 'D1:D2', 'E1:E2', 'F1:F2', 'G1:I1', 'J1:L1']) sheet.mergeCells(range);
  const { records } = await parseGpaExport(Buffer.from(await workbook.xlsx.writeBuffer()), 'gpa.xlsx');
  assert.deepEqual(records[0].semesters.map((s) => [s.semester_number, s.gpa, s.earned_credits]), [[1, '7.68', '20.00'], [2, '6.84', '20.00']]);
});

await check('a plain one-semester GPA sheet still works', async () => {
  const { meta, records } = await parseGpaExport(enc('Reg No,Student Name,GPA,Semester\n2428020221,John Doe,6.80,3rd Semester\n'), 'gpa.csv');
  assert.equal(meta.layout, 'flat');
  assert.equal(records[0].gpa, '6.80');
  assert.equal(records[0].semester_number, '3');
});

await check('an Email column is not a registration number', async () => {
  await assert.rejects(parseGpaExport(enc('Email,GPA,Semester\njohn.doe@muj.manipal.edu,7,3\n'), 'gpa.csv'), /Registration No/);
});

console.log('\nDefaulter Grade result export');

await check('semester and exam from the title, names and credits from the subject table', async () => {
  const [endTerm] = SAMPLE_BACKLOG_RESULTS;
  const { meta, records } = await parseBacklogExport(enc(buildDefaulterGradeHtml(endTerm)), 'Defaulter_Grade.xls');
  assert.equal(meta.layout, 'erp');
  assert.equal(meta.semester, 2);
  assert.equal(meta.exam_session, 'END TERM EXAMINATION 25-26');
  assert.deepEqual(meta.subject_codes, ['MA1002', 'PH1001', 'CS1002', 'EC1001', 'OE']);
  assert.equal(meta.subjects.at(-1).name, 'OPEN ELECTIVE', '"OE" is matched to OPEN ELECTIVE by its initials');
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].grades, [
    { subject_code: 'MA1002', subject_name: 'ENGINEERING MATHEMATICS II', credits: '4.00', grade: 'F' }
  ]);
});

await check('the real title wording: "-24-25 ()" and a Roman "III SEMESTER"', async () => {
  const { meta, records } = await parseBacklogExport(enc(
    `<table id="kt_ViewTableHeader"><tr><td colspan="5"><b>RESULT OF END TERM EXAMNINATION -24-25 ()<br>BTECH-031 : B TECH COMPUTER SCIENCE &amp; ENGINEERING (IOT AND INTELLIGENT SYSTEM)- III SEMESTER</b></td></tr></table>
     <table id="kt_ViewTable">
       ${row(['S.No.', 'Registration No', 'Student Name', 'IIS2121', 'MEE2001'])}
       ${row(['1', '2428020003', 'A STUDENT', '', 'UFM'])}
     </table>
     <table id="kt_ViewTableCredit">
       ${row(['S.No.', 'Subject Code', 'Subject Description', 'Credit'])}
       ${row(['1', 'IIS2121', 'OBJECT-ORIENTED PROGRAMMING USING JAVA', '4.00'])}
       ${row(['2', 'MEE2001', 'ENGINEERING ECONOMICS', '3.00'])}
     </table>`
  ), 'Defaulter_Grade.xls');
  assert.equal(meta.semester, 3);
  assert.equal(meta.exam_session, 'END TERM EXAMNINATION 24-25');
  assert.equal(meta.programme, 'BTECH-031 : B TECH COMPUTER SCIENCE & ENGINEERING (IOT AND INTELLIGENT SYSTEM)');
  assert.equal(records.length, 1, 'the subject table is not read as students');
  assert.deepEqual(records[0].grades.map((g) => [g.subject_code, g.grade, g.credits]), [['MEE2001', 'UFM', '3.00']]);
});

await check('a hand-made backlog list still works, and no Cleared column means "say nothing"', async () => {
  const { meta, records } = await parseBacklogExport(enc('Reg No,Subject Code,Subject Name\n2428020223,MA1002,Maths II\n'), 'backlogs.csv');
  assert.equal(meta.layout, 'list');
  assert.equal(meta.subject_codes, null, 'no clearing pass for a hand-made list');
  assert.equal(records[0].subject_code, 'MA1002');
  assert.equal(records[0].is_cleared, '');
});

console.log('\nProctorial Board notice (black dots)');

await check('the .docx notice: case lines, merged dates, two-line Course/Branch', async () => {
  const { meta, records } = await parseBlackDotNotice(buildBlackDotNoticeDocx(), 'NOTICE_OF_PB_MEETING.docx');
  assert.deepEqual(meta.cases.map((c) => [c.case_number, c.students]), [['012/Odd Sem/2026', 1], ['07/CSO/2026-27', 2]]);
  assert.equal(meta.cases[1].case_details, 'Misconduct during the hostel night roll call');
  assert.equal(records.length, 3);
  const [john, jane, visitor] = records;
  assert.equal(john.identifier, '2428020221');
  assert.equal(john.case_details, 'The undermentioned students were found in possession of banned items.');
  assert.equal(john.incident_date, '2026-09-10', '10/09/26 is day-first');
  assert.equal(jane.course_branch, 'B Tech IoT & IS, Sec- B');
  assert.equal(jane.incident_date_text, '14TH August');
  assert.equal(jane.incident_date, '', 'no year, so no date is invented');
  assert.equal(visitor.incident_date_text, '14TH August', 'the merged-down date reaches every student in the case');
  assert.equal(visitor.where, 'Case 07/CSO/2026-27 · S/No 2');
});

await check('the notice as a CSV with a Case No column', async () => {
  const { records } = await parseBlackDotNotice(enc(
    'Case No,Regn No,Name,Date of Incidence,Block,Previous Record\n034/Even Sem/ 2026,2428020221,John Doe,10/09/26,B7,1 black dot\n'
  ), 'notice.csv');
  assert.equal(records[0].case_number, '034/Even Sem/2026');
  assert.equal(records[0].hostel_block, 'B7');
  assert.equal(records[0].previous_record, '1 black dot');
});

await check('notice dates are read day-first and never guessed', async () => {
  assert.equal(parseNoticeDate('10/09/26'), '2026-09-10');
  assert.equal(parseNoticeDate('10.09.2026'), '2026-09-10');
  assert.equal(parseNoticeDate('5 Sept 2026'), '2026-09-05');
  assert.equal(parseNoticeDate('14TH August'), null);
  assert.equal(parseNoticeDate('31/02/2026'), null);
});

console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
