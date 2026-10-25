/**
 * GET /api/reports/academic-cycle-report
 * The "Generate report" step of an academic cycle: one Excel workbook for
 * a whole cycle or one of its semesters.
 *
 *   ?cycle_id=   the cycle (default: the active one)
 *   ?semester=   Odd | Even (default: the whole cycle)
 *
 * Cluster Head or HOD. The numbers come from get_cycle_overview(), run as
 * the caller, which decides who may ask and returns counts and averages
 * only: no student is named, and there are no GPA values or at-risk flags
 * in it, because a cluster head cannot read those.
 *
 * Sheets: Summary, Students, Mentors, Attendance, Backlogs, Black dots,
 * Uploads.
 */
import ExcelJS from 'exceljs';
import { withApiDefaults, ApiError } from '../_lib/http-response.js';
import { requireAuthenticatedUser, requireRole, enforceRateLimit, recordAuditEntry } from '../_lib/request-guards.js';
import { parseOrThrow, cycleReportQuerySchema } from '../_lib/input-validation.js';

const BRAND = 'FFC2410C';
const HEADER_TEXT = 'FFFFFFFF';
const BAND = 'FFFDF7F4';
const INK_SOFT = 'FF57534E';

const UPLOAD_LABELS = { attendance: 'Attendance', gpa: 'GPA', backlog: 'Backlogs', black_dot: 'Black dots' };
const VIA_LABELS = {
  existing: 'On the portal before cycles',
  account: 'New account',
  roster: 'Roster import',
  mentor_map: 'Mentor mapping',
  carried_over: 'Carried over',
  profile: 'Profile change'
};

const cycleLabel = (label) => (label ? String(label).replace('-', '–') : '—');
const semesterYear = (cycle, semester) => (semester === 'Even' ? Number(cycle.start_year) + 1 : Number(cycle.start_year));
const semesterTitle = (cycle, semester) =>
  semester ? `${semester === 'Even' ? 'Even' : 'Odd'} semester ${semesterYear(cycle, semester)}` : '—';

const INDIA_OFFSET_MS = 330 * 60 * 1000;

/**
 * A date or a timestamp as an Excel date. Excel cells have no time zone
 * and ExcelJS writes a Date's UTC fields, so a calendar date is built at
 * UTC midnight and a timestamp is moved to India time first: an upload
 * at 10:11 am in Jaipur reads 10:11, not 04:41.
 */
function asDate(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + INDIA_OFFSET_MS);
}

function dayBefore(iso) {
  const date = asDate(iso);
  if (!date) return null;
  return new Date(date.getTime() - 24 * 3600 * 1000);
}

const number = (value) => (value == null ? null : Number(value));

/** Writes a titled table and returns the next free row. */
function writeTable(sheet, startRow, { title, columns, rows, empty = 'Nothing recorded.' }) {
  let row = startRow;
  if (title) {
    const cell = sheet.getCell(row, 1);
    cell.value = title;
    cell.font = { bold: true, size: 12, color: { argb: BRAND } };
    row += 1;
  }

  const header = sheet.getRow(row);
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { vertical: 'middle', horizontal: column.align ?? 'left', wrapText: true };
  });
  row += 1;

  if (!rows.length) {
    const cell = sheet.getCell(row, 1);
    cell.value = empty;
    cell.font = { italic: true, color: { argb: INK_SOFT } };
    return row + 2;
  }

  rows.forEach((values, index) => {
    const line = sheet.getRow(row);
    columns.forEach((column, columnIndex) => {
      const cell = line.getCell(columnIndex + 1);
      const value = column.value(values);
      cell.value = value ?? '—';
      if (column.format && value != null) cell.numFmt = column.format;
      cell.alignment = { vertical: 'top', horizontal: column.align ?? 'left', wrapText: Boolean(column.wrap) };
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    });
    row += 1;
  });
  return row + 1;
}

function newSheet(workbook, name, widths) {
  const sheet = workbook.addWorksheet(name, { views: [{ showGridLines: false }] });
  sheet.columns = widths.map((width) => ({ width }));
  return sheet;
}

export function buildCycleWorkbook(overview, { generatedBy } = {}) {
  const cycle = overview.cycle;
  const semester = overview.semester;
  const scope = semester ? `${semesterTitle(cycle, semester)} only` : 'The whole cycle';
  const students = overview.students ?? {};
  const mentors = overview.mentors ?? {};
  const uploads = overview.uploads ?? {};
  const attendance = overview.attendance ?? {};
  const backlogs = overview.backlogs ?? {};
  const dots = overview.black_dots ?? {};
  const rosters = overview.roster_imports ?? {};
  const gpa = overview.gpa ?? {};

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SMP Portal';
  workbook.created = new Date();

  /* ── Summary ─────────────────────────────────────────────────────── */
  const summary = newSheet(workbook, 'Summary', [42, 18, 18, 18]);
  summary.getCell('A1').value = `Academic cycle report — ${cycleLabel(cycle.label)}`;
  summary.getCell('A1').font = { bold: true, size: 16 };
  summary.getCell('A2').value = scope;
  summary.getCell('A2').font = { bold: true, color: { argb: BRAND } };
  summary.getCell('A3').value =
    `${cycle.is_active ? 'Active cycle' : 'Closed cycle'} · generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` +
    (generatedBy ? ` by ${generatedBy}` : '');
  summary.getCell('A3').font = { color: { argb: INK_SOFT } };
  summary.getCell('A4').value =
    'Counts and averages only. No student is named, and GPA values and at-risk flags are not part of this report.';
  summary.getCell('A4').font = { italic: true, color: { argb: INK_SOFT } };

  let row = writeTable(summary, 6, {
    title: 'Semesters',
    columns: [
      { header: 'Semester', value: (r) => r.title },
      { header: 'From', value: (r) => r.from, format: 'dd mmm yyyy' },
      { header: 'To', value: (r) => r.to, format: 'dd mmm yyyy' }
    ],
    rows: [
      { title: semesterTitle(cycle, 'Odd'), from: asDate(cycle.starts_on), to: dayBefore(cycle.even_starts_on) },
      { title: semesterTitle(cycle, 'Even'), from: asDate(cycle.even_starts_on), to: asDate(cycle.ends_on) }
    ]
  });

  const attendanceBySemester = attendance.by_semester ?? [];
  const figures = [
    ['Students in the cycle', number(students.activated)],
    ['… with a mentor', number(students.with_mentor)],
    ['… without a mentor', number(students.without_mentor)],
    ['Mentors', number(mentors.count)],
    ...(students.not_activated != null ? [['Student accounts not activated in this cycle', number(students.not_activated)]] : []),
    ['Uploads', number(uploads.total)],
    ['Roster imports', number(rosters.count)],
    ['Accounts created by roster imports', number(rosters.accounts_created)],
    ...attendanceBySemester.flatMap((entry) => [
      [`Average attendance, ${semesterTitle(cycle, entry.semester)} (%)`, number(entry.average)],
      [`Students below 75%, ${semesterTitle(cycle, entry.semester)}`, number(entry.students_below_75)]
    ]),
    ['GPA uploads', number(gpa.uploads)],
    ['Backlogs first recorded in this cycle', number(backlogs.recorded)],
    ['… still open', number(backlogs.open)],
    ['… cleared', number(backlogs.cleared)],
    ['Black dots', number(dots.black_dots)],
    ['Students with a black dot', number(dots.students)],
    ['Proctorial Board cases', number(dots.cases)]
  ];
  row = writeTable(summary, row, {
    title: 'Key figures',
    columns: [
      { header: 'Figure', value: (r) => r[0] },
      { header: 'Value', value: (r) => r[1], align: 'right' }
    ],
    rows: figures
  });

  /* ── Students ────────────────────────────────────────────────────── */
  const studentSheet = newSheet(workbook, 'Students', [34, 14]);
  studentSheet.getCell('A1').value = `Students in ${cycleLabel(cycle.label)} (the whole cycle)`;
  studentSheet.getCell('A1').font = { bold: true, size: 14 };
  const labelTable = (title, rows) => ({
    title,
    columns: [
      { header: title.replace(/^By /, ''), value: (r) => r.label },
      { header: 'Students', value: (r) => number(r.students), align: 'right' }
    ],
    rows: rows ?? []
  });
  row = writeTable(studentSheet, 3, labelTable('By semester', students.by_semester));
  row = writeTable(studentSheet, row, labelTable('By section', students.by_section));
  row = writeTable(studentSheet, row, labelTable('By branch', students.by_branch));
  writeTable(studentSheet, row, {
    title: 'How they joined the cycle',
    columns: [
      { header: 'How', value: (r) => VIA_LABELS[r[0]] ?? r[0] },
      { header: 'Students', value: (r) => number(r[1]), align: 'right' }
    ],
    rows: Object.entries(students.by_via ?? {}).sort((a, b) => b[1] - a[1])
  });

  /* ── Mentors ─────────────────────────────────────────────────────── */
  const mentorSheet = newSheet(workbook, 'Mentors', [32, 40, 18]);
  mentorSheet.getCell('A1').value = `Mentors in ${cycleLabel(cycle.label)}`;
  mentorSheet.getCell('A1').font = { bold: true, size: 14 };
  writeTable(mentorSheet, 3, {
    columns: [
      { header: 'Mentor', value: (r) => r.name },
      { header: 'Email', value: (r) => r.email },
      { header: 'Mentees this cycle', value: (r) => number(r.mentees), align: 'right' }
    ],
    rows: mentors.list ?? [],
    empty: 'No mentors assigned in this cycle.'
  });

  /* ── Attendance ──────────────────────────────────────────────────── */
  const attendanceSheet = newSheet(workbook, 'Attendance', [14, 36, 22, 11, 11, 13, 12, 14]);
  attendanceSheet.getCell('A1').value = `Attendance — ${scope.toLowerCase()}`;
  attendanceSheet.getCell('A1').font = { bold: true, size: 14 };
  attendanceSheet.getCell('A2').value = 'The latest reporting period per student and subject in each semester.';
  attendanceSheet.getCell('A2').font = { color: { argb: INK_SOFT } };
  writeTable(attendanceSheet, 4, {
    columns: [
      { header: 'Code', value: (r) => r.course_code },
      { header: 'Subject', value: (r) => r.course_name, wrap: true },
      { header: 'Semester', value: (r) => semesterTitle(cycle, r.semester) },
      { header: 'Sections', value: (r) => number(r.sections), align: 'right' },
      { header: 'Students', value: (r) => number(r.students), align: 'right' },
      { header: 'Average %', value: (r) => number(r.average), align: 'right', format: '0.0' },
      { header: 'Below 75%', value: (r) => number(r.below_75), align: 'right' },
      { header: 'Up to', value: (r) => asDate(r.last_period_end), format: 'dd mmm yyyy' }
    ],
    rows: attendance.by_subject ?? [],
    empty: 'No attendance uploaded in this cycle.'
  });

  /* ── Backlogs ────────────────────────────────────────────────────── */
  const backlogSheet = newSheet(workbook, 'Backlogs', [16, 40, 12, 12]);
  backlogSheet.getCell('A1').value = `Backlogs first recorded in ${cycleLabel(cycle.label)} — ${scope.toLowerCase()}`;
  backlogSheet.getCell('A1').font = { bold: true, size: 14 };
  backlogSheet.getCell('A2').value = 'Odd programme semesters are filed under the odd semester, even ones under the even semester.';
  backlogSheet.getCell('A2').font = { color: { argb: INK_SOFT } };
  row = writeTable(backlogSheet, 4, {
    title: 'By programme semester',
    columns: [
      { header: 'Semester', value: (r) => (r.semester_number ? `Semester ${r.semester_number}` : 'Not given') },
      { header: 'Filed under', value: (r) => (r.semester_number ? semesterTitle(cycle, r.semester_number % 2 === 1 ? 'Odd' : 'Even') : '—') },
      { header: 'Open', value: (r) => number(r.open), align: 'right' },
      { header: 'Cleared', value: (r) => number(r.cleared), align: 'right' }
    ],
    rows: backlogs.by_programme_semester ?? []
  });
  writeTable(backlogSheet, row, {
    title: 'Subjects with the most open backlogs',
    columns: [
      { header: 'Code', value: (r) => r.subject_code },
      { header: 'Subject', value: (r) => r.subject_name, wrap: true },
      { header: 'Open', value: (r) => number(r.open), align: 'right' },
      { header: 'Cleared', value: (r) => number(r.cleared), align: 'right' }
    ],
    rows: backlogs.top_subjects ?? []
  });

  /* ── Black dots ──────────────────────────────────────────────────── */
  const dotSheet = newSheet(workbook, 'Black dots', [22, 60, 16, 22, 11]);
  dotSheet.getCell('A1').value = `Black dots — ${scope.toLowerCase()}`;
  dotSheet.getCell('A1').font = { bold: true, size: 14 };
  writeTable(dotSheet, 3, {
    columns: [
      { header: 'Case', value: (r) => r.case_number },
      { header: 'About', value: (r) => r.case_details, wrap: true },
      { header: 'Incident', value: (r) => asDate(r.incident_date) ?? r.incident_date_text ?? null, format: 'dd mmm yyyy' },
      { header: 'Semester', value: (r) => semesterTitle(cycle, r.semester) },
      { header: 'Students', value: (r) => number(r.students), align: 'right' }
    ],
    rows: dots.case_list ?? [],
    empty: 'No black dots in this cycle.'
  });

  /* ── Uploads ─────────────────────────────────────────────────────── */
  const uploadSheet = newSheet(workbook, 'Uploads', [20, 12, 22, 34, 34, 10, 11, 10, 24]);
  uploadSheet.getCell('A1').value = `Uploads — ${scope.toLowerCase()}`;
  uploadSheet.getCell('A1').font = { bold: true, size: 14 };
  writeTable(uploadSheet, 3, {
    columns: [
      { header: 'When', value: (r) => asDate(r.created_at), format: 'dd mmm yyyy hh:mm' },
      { header: 'Type', value: (r) => UPLOAD_LABELS[r.upload_type] ?? r.upload_type },
      { header: 'Semester', value: (r) => semesterTitle(cycle, r.semester) },
      {
        header: 'Scope',
        value: (r) =>
          r.scope_label ??
          (r.upload_type === 'attendance'
            ? [r.course_code, r.section_label ? `Section ${r.section_label}` : null].filter(Boolean).join(' · ') || null
            : r.semester_number
              ? `Semester ${r.semester_number}`
              : null),
        wrap: true
      },
      { header: 'File', value: (r) => r.original_filename, wrap: true },
      { header: 'Rows', value: (r) => number(r.total_rows), align: 'right' },
      { header: 'Recorded', value: (r) => number(r.matched_rows), align: 'right' },
      { header: 'Failed', value: (r) => number(r.failed_rows), align: 'right' },
      { header: 'By', value: (r) => r.uploaded_by_name }
    ],
    rows: uploads.list ?? [],
    empty: 'Nothing uploaded in this cycle.'
  });

  return workbook;
}

export default withApiDefaults(['GET'], async (req, res) => {
  const context = await requireAuthenticatedUser(req);
  requireRole(context, 'cluster_head', 'hod', 'admin');
  await enforceRateLimit(context, { key: 'cycle-report', max: 20, windowSeconds: 60 });

  const query = parseOrThrow(cycleReportQuerySchema, {
    cycle_id: req.query.cycle_id || undefined,
    semester: req.query.semester || undefined
  });

  const { data: overview, error } = await context.asUser.rpc('get_cycle_overview', {
    p_cycle_id: query.cycle_id ?? null,
    p_semester: query.semester ?? null
  });
  if (error) throw new ApiError(error.message, error.code === '42501' ? 403 : 400);
  if (!overview?.cycle) throw new ApiError('No academic cycle was found', 404);

  const workbook = buildCycleWorkbook(overview, { generatedBy: context.profile.full_name });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const suffix = query.semester ? `-${query.semester.toLowerCase()}-semester` : '';
  const filename = `cycle-report-${overview.cycle.label}${suffix}.xlsx`;

  await recordAuditEntry(context, req, 'report.academic_cycle_xlsx', {
    type: 'academic_cycles',
    id: overview.cycle.id,
    metadata: { cycle: overview.cycle.label, semester: query.semester ?? 'whole cycle' }
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.status(200).send(buffer);
});
