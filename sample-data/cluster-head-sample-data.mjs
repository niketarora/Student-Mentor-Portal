/**
 * cluster-head-sample-data.mjs
 * =====================================================================
 * ONE PLACE for every piece of dummy data behind the Cluster Head,
 * at-risk and survey features. Attendance, GPA, backlogs, black dots, the
 * subject list, and the upload files a Cluster Head would actually drop
 * into the portal all live here rather than scattered across the seed
 * script, the tests and a folder of loose files.
 *
 * Two ways to use it:
 *
 *   1. As a module. `npm run db:seed` imports these arrays and loads them
 *      through the same RPCs the portal uses, so the seeded data goes
 *      through exactly the code path a real upload does.
 *
 *   2. As a CLI, to write upload-ready files you can drag into the portal
 *      by hand and watch the whole flow happen:
 *
 *          node sample-data/cluster-head-sample-data.mjs
 *
 *      That writes them into sample-data/generated/, in the same layouts
 *      the real sources use: attendance CSVs, the ERP's CGPA / GPA &
 *      Credits and Defaulter Grade exports (HTML tables saved as .xls, as
 *      the ERP does) and a Proctorial Board notice as .docx.
 *
 * HOW THE DATA IS SHAPED, AND WHY
 * ---------------------------------------------------------------------
 * The at-risk rule fires on ANY ONE of three conditions. Sample data that
 * only contained "one bad student" would demonstrate one of them. So each
 * of the four demo students trips a DIFFERENT condition, and the fourth
 * trips none:
 *
 *   John Doe      2428020221   attendance 59.67%        -> flagged (attendance)
 *   Jane Smith    2428020222   semester 2 GPA 5.40      -> flagged (GPA)
 *   Mike Davis    2428020223   Maths II still failed    -> flagged (backlog)
 *   Emily Wilson  2428020224   Physics failed, then
 *                              cleared at the make-up   -> NOT flagged
 *
 * Read down the At-Risk Students page after seeding and every branch of
 * the rule is visible at once, including the one that correctly does
 * nothing. John and Jane also each get a black dot, which shows on their
 * student record but is deliberately not part of the at-risk rule.
 *
 * Every name, registration number and phone number here is invented.
 */

// ---------------------------------------------------------------------
// The demo Cluster Head accounts
// ---------------------------------------------------------------------
export const SAMPLE_CLUSTER_HEADS = [
  {
    email: 'cluster.head1@jaipur.manipal.edu',
    full_name: 'Dr. Neha Sharma',
    login_id: 'CH1001',
    branch: 'IoT & IS'
  },
  {
    email: 'cluster.head2@jaipur.manipal.edu',
    full_name: 'Prof. Rakesh Menon',
    login_id: 'CH1002',
    branch: 'IoT & IS'
  }
];

/**
 * The setup form's answers for cluster.head1 — a name and a code each.
 * Sections are not declared here; SAMPLE_ATTENDANCE below is what puts
 * students into them, the same way a real ERP export does.
 */
export const SAMPLE_CLUSTER_HEAD_COURSES = [
  { course_name: 'Data Structures and Algorithms', course_code: 'CS2001' },
  { course_name: 'Database Management Systems', course_code: 'CS2003' },
  { course_name: 'Operating Systems', course_code: 'CS2005' },
  { course_name: 'Internet of Things', course_code: 'IOT2001' },
  { course_name: 'Machine Learning', course_code: 'AI3001' }
];

/** Second cluster head, so the "each cluster head sees only their own" rule is testable. */
export const SAMPLE_CLUSTER_HEAD_2_COURSES = [
  { course_name: 'Computer Networks', course_code: 'CS2007' },
  { course_name: 'Digital Electronics', course_code: 'EC2001' }
];

// ---------------------------------------------------------------------
// The mentor-HOD mapping (migration 0039)
// ---------------------------------------------------------------------
/**
 * Two HODs, so "each HOD sees only their own faculty" is visible after
 * seeding: Dr. Sarah Jenkins has Alice and Bob (and their mentees John,
 * Jane and Mike); Dr. Vikram Rao has Carol (and Emily). The administrator
 * sees all four students.
 *
 * The seed applies this through map_faculty_to_hods(), the RPC behind
 * the administrator's Upload page, and `npm run sample:files` writes it
 * out as the file that page takes.
 */
export const SAMPLE_HODS = [
  { email: 'hod.iotis@jaipur.manipal.edu', full_name: 'Dr. Sarah Jenkins' },
  { email: 'hod2.iotis@jaipur.manipal.edu', full_name: 'Dr. Vikram Rao' }
];

export const SAMPLE_HOD_MAPPING = [
  { section: 'A 3', mentor_name: 'Dr. Alice Smith', designation: 'Mentor',
    mentor_email: 'alice.smith@jaipur.manipal.edu', hod_email: 'hod.iotis@jaipur.manipal.edu' },
  { section: 'B 3', mentor_name: 'Dr. Bob Johnson', designation: 'Mentor',
    mentor_email: 'bob.johnson@jaipur.manipal.edu', hod_email: 'hod.iotis@jaipur.manipal.edu' },
  { section: 'A 4', mentor_name: 'Prof. Carol Williams', designation: 'Class Coordinator (fallback)',
    mentor_email: 'carol.williams@jaipur.manipal.edu', hod_email: 'hod2.iotis@jaipur.manipal.edu' }
];

const hodNameOf = (email) => SAMPLE_HODS.find((hod) => hod.email === email)?.full_name ?? '';

/** The mapping as map_faculty_to_hods() takes it. */
export function sampleHodMappingRows(mapping = SAMPLE_HOD_MAPPING) {
  return mapping.map((entry, index) => ({
    row: index + 2,
    ...entry,
    hod_name: hodNameOf(entry.hod_email)
  }));
}

// ---------------------------------------------------------------------
// The students the sample data refers to
// ---------------------------------------------------------------------
// Matched on registration number, exactly as a real upload would be.
export const SAMPLE_STUDENTS = [
  { registration_no: '2428020221', full_name: 'John Doe', section: 'A' },
  { registration_no: '2428020222', full_name: 'Jane Smith', section: 'B' },
  { registration_no: '2428020223', full_name: 'Mike Davis', section: 'A' },
  { registration_no: '2428020224', full_name: 'Emily Wilson', section: 'A' }
];

// ---------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------
/** A 15-day reporting window ending today. Purely a label on the data. */
export function sampleAttendancePeriod(reference = new Date()) {
  const end = new Date(reference);
  const start = new Date(end);
  start.setDate(start.getDate() - 14);
  const iso = (date) => date.toISOString().slice(0, 10);
  return { period_start: iso(start), period_end: iso(end) };
}

/**
 * Per course, per section. The overall percentage the at-risk rule reads
 * is total attended / total held across every row for that student, so
 * these numbers are chosen to add up to the intended verdict rather than
 * each being individually below or above the line.
 *
 * Since migration 0025 the percentage is the source of truth (it is what
 * the ERP export gives us), and overall attendance is the MEAN of the
 * per-course percentages. attendance_percent below is therefore the value
 * that actually gets stored; classes_held / classes_attended ride along
 * for reference only, exactly as they do in a real upload.
 *
 * John:   mean(65, 58, 56) = 59.67%  -> flagged on attendance
 * Jane:   mean(85, 87, 86) = 86.00%  -> fine
 * Mike:   mean(88, 84, 83) = 85.00%  -> fine
 * Emily:  mean(90, 89, 92) = 90.33%  -> fine
 */
export const SAMPLE_ATTENDANCE = [
  {
    course_code: 'CS2001',
    course_name: 'Data Structures and Algorithms',
    section: 'A',
    rows: [
      { identifier: '2428020221', classes_held: '40', classes_attended: '26', attendance_percent: '65' },
      { identifier: '2428020223', classes_held: '40', classes_attended: '35', attendance_percent: '88' },
      { identifier: '2428020224', classes_held: '40', classes_attended: '36', attendance_percent: '90' }
    ]
  },
  {
    course_code: 'CS2001',
    course_name: 'Data Structures and Algorithms',
    section: 'B',
    rows: [{ identifier: '2428020222', classes_held: '40', classes_attended: '34', attendance_percent: '85' }]
  },
  {
    course_code: 'CS2003',
    course_name: 'Database Management Systems',
    section: 'A',
    rows: [
      { identifier: '2428020221', classes_held: '38', classes_attended: '22', attendance_percent: '58' },
      { identifier: '2428020223', classes_held: '38', classes_attended: '32', attendance_percent: '84' },
      { identifier: '2428020224', classes_held: '38', classes_attended: '34', attendance_percent: '89' }
    ]
  },
  {
    course_code: 'CS2003',
    course_name: 'Database Management Systems',
    section: 'B',
    rows: [{ identifier: '2428020222', classes_held: '38', classes_attended: '33', attendance_percent: '87' }]
  },
  {
    course_code: 'IOT2001',
    course_name: 'Internet of Things',
    // Deliberately a different teaching section from the students' Form A
    // section, so the "these two can differ" case is covered by the seed.
    section: 'C',
    rows: [
      { identifier: '2428020221', classes_held: '36', classes_attended: '20', attendance_percent: '56' },
      { identifier: '2428020223', classes_held: '36', classes_attended: '30', attendance_percent: '83' },
      { identifier: '2428020224', classes_held: '36', classes_attended: '33', attendance_percent: '92' }
    ]
  },
  {
    course_code: 'IOT2001',
    course_name: 'Internet of Things',
    section: 'B',
    rows: [{ identifier: '2428020222', classes_held: '36', classes_attended: '31', attendance_percent: '86' }]
  }
];

// ---------------------------------------------------------------------
// GPA: the ERP's "Student's CGPA / GPA & Credits" export
// ---------------------------------------------------------------------
/**
 * Semesters I and II are graded. III is in progress, so the export prints
 * "-" for its GPA and only fills in the credits it requires, exactly as
 * the real one does. Jane's latest graded semester (II) is 5.40, which is
 * what flags her. CGPA is credit-weighted, as the university computes it:
 * Jane's (6.10 x 20 + 5.40 x 17) / 37 = 5.78, not the plain mean 5.75.
 */
export const SAMPLE_GPA_EXPORT = {
  semester_columns: [1, 2, 3],
  in_progress: { semester: 3, required_credits: '24.00' },
  rows: [
    { identifier: '2428020221', cgpa: '7.00', total_earned_credits: '40.00',
      semesters: { 1: { gpa: '7.20', earned_credits: '20.00' }, 2: { gpa: '6.80', earned_credits: '20.00' } } },
    { identifier: '2428020222', cgpa: '5.78', total_earned_credits: '37.00',
      semesters: { 1: { gpa: '6.10', earned_credits: '20.00' }, 2: { gpa: '5.40', earned_credits: '17.00' } } },
    { identifier: '2428020223', cgpa: '7.25', total_earned_credits: '40.00',
      semesters: { 1: { gpa: '7.40', earned_credits: '20.00' }, 2: { gpa: '7.10', earned_credits: '20.00' } } },
    { identifier: '2428020224', cgpa: '8.10', total_earned_credits: '40.00',
      semesters: { 1: { gpa: '8.00', earned_credits: '20.00' }, 2: { gpa: '8.20', earned_credits: '20.00' } } }
  ]
};

/** The rows record_gpa_batch() takes: the same shape the upload parser produces. */
export function sampleGpaRpcRows(dataset = SAMPLE_GPA_EXPORT) {
  return dataset.rows.map((row) => ({
    identifier: row.identifier,
    cgpa: row.cgpa,
    total_earned_credits: row.total_earned_credits,
    total_required_credits: '-',
    semesters: Object.entries(row.semesters).map(([semester, value]) => ({
      semester_number: Number(semester),
      gpa: value.gpa,
      earned_credits: value.earned_credits,
      required_credits: '-'
    }))
  }));
}

// ---------------------------------------------------------------------
// Backlogs: the ERP's "Defaulter Grade" result export
// ---------------------------------------------------------------------
/**
 * Two results for the same semester, uploaded in order. The defaulter list
 * names only students who failed something, so the second one is also how
 * a backlog gets cleared: Emily passed Physics at the make-up, is no longer
 * listed, and her backlog is marked cleared. Mike still has Maths II, which
 * keeps him flagged. The "OE" column is matched to OPEN ELECTIVE in the
 * subject table, the way the real export abbreviates it.
 */
const SAMPLE_SEMESTER_2_SUBJECTS = [
  { code: 'MA1002', name: 'ENGINEERING MATHEMATICS II', credits: '4.00' },
  { code: 'PH1001', name: 'ENGINEERING PHYSICS', credits: '4.00' },
  { code: 'CS1002', name: 'PROGRAMMING IN C', credits: '3.00' },
  { code: 'EC1001', name: 'BASIC ELECTRONICS', credits: '3.00' },
  { code: 'OE', table_code: 'OPEN ELECTIVE', name: 'OPEN ELECTIVE', credits: '3.00' }
];

export const SAMPLE_BACKLOG_RESULTS = [
  {
    file: 'backlogs-defaulter-grade-semester-2-sample.xls',
    semester_number: 2,
    title: 'RESULT OF END TERM EXAMINATION -25-26 ()',
    exam_session: 'END TERM EXAMINATION 25-26',
    programme: 'BTECH-031 : B TECH COMPUTER SCIENCE & ENGINEERING (IOT AND INTELLIGENT SYSTEM)',
    subjects: SAMPLE_SEMESTER_2_SUBJECTS,
    rows: [
      { identifier: '2428020223', grades: { MA1002: 'F' } },
      { identifier: '2428020224', grades: { PH1001: 'F' } }
    ]
  },
  {
    file: 'backlogs-defaulter-grade-semester-2-makeup-sample.xls',
    semester_number: 2,
    title: 'RESULT OF MAKE-UP EXAMINATION -25-26 ()',
    exam_session: 'MAKE-UP EXAMINATION 25-26',
    programme: 'BTECH-031 : B TECH COMPUTER SCIENCE & ENGINEERING (IOT AND INTELLIGENT SYSTEM)',
    subjects: SAMPLE_SEMESTER_2_SUBJECTS,
    rows: [{ identifier: '2428020223', grades: { MA1002: 'F' } }]
  }
];

/** The arguments record_backlog_batch() takes for one result sheet. */
export function sampleBacklogRpcArgs(result) {
  const nameOf = (code) => result.subjects.find((subject) => subject.code === code);
  return {
    p_semester_number: result.semester_number,
    p_exam_session: result.exam_session,
    p_filename: result.file,
    p_subject_codes: result.subjects.map((subject) => subject.code),
    p_rows: result.rows.map((row) => ({
      identifier: row.identifier,
      grades: Object.entries(row.grades).map(([code, grade]) => ({
        subject_code: code,
        subject_name: nameOf(code)?.name ?? '',
        credits: nameOf(code)?.credits ?? '',
        grade
      }))
    }))
  };
}

// ---------------------------------------------------------------------
// Black dots: the Proctorial Board's "Notice of PB meeting"
// ---------------------------------------------------------------------
/**
 * Two cases, laid out like the real notice: a "Case No:" line over each
 * table, the date of incidence written once per case, Course/Branch on two
 * lines. The third student is not in the portal (a PB notice covers the
 * whole university), so the upload reports that row back rather than
 * failing the file.
 */
export const SAMPLE_BLACK_DOT_NOTICE = {
  file: 'black-dot-notice-sample.docx',
  heading: 'NOTICE OF PB MEETING',
  cases: [
    {
      line: 'Case No: 012/Odd Sem/ 2026.  The undermentioned students were found in possession of banned items.',
      case_number: '012/Odd Sem/2026',
      case_details: 'The undermentioned students were found in possession of banned items.',
      date: '10/09/26',
      students: [
        { identifier: '2428020221', name: 'John Doe', block: 'B7', room: '214',
          course_branch: ['B Tech IoT & IS', 'Sec- A'], mobile: '9000000001', previous: 'NIL' }
      ]
    },
    {
      line: 'Case No: - 07/CSO/2026-27, Misconduct during the hostel night roll call',
      case_number: '07/CSO/2026-27',
      case_details: 'Misconduct during the hostel night roll call',
      date: '14TH August',
      students: [
        { identifier: '2428020222', name: 'Jane Smith', block: 'Day scholar', room: '',
          course_branch: ['B Tech IoT & IS', 'Sec- B'], mobile: '9000000002', previous: '1 black dot' },
        { identifier: '2428099999', name: 'Visiting Student', block: 'B3', room: '101',
          course_branch: ['BBA'], mobile: '9000000003', previous: 'NIL' }
      ]
    }
  ]
};

/** The rows record_black_dot_batch() takes: the same shape the upload parser produces. */
export function sampleBlackDotRpcRows(notice = SAMPLE_BLACK_DOT_NOTICE) {
  return notice.cases.flatMap((entry) =>
    entry.students.map((student, index) => ({
      where: `Case ${entry.case_number} · S/No ${index + 1}`,
      identifier: student.identifier,
      name: student.name,
      case_number: entry.case_number,
      case_details: entry.case_details,
      incident_date: /^\d{2}\/\d{2}\/\d{2}$/.test(entry.date)
        ? `20${entry.date.slice(6)}-${entry.date.slice(3, 5)}-${entry.date.slice(0, 2)}`
        : '',
      incident_date_text: entry.date,
      hostel_block: student.block,
      room_no: student.room,
      course_branch: student.course_branch.join(', '),
      mobile_no: student.mobile,
      previous_record: student.previous
    }))
  );
}

// ---------------------------------------------------------------------
// Survey
// ---------------------------------------------------------------------
/**
 * Two of four students answer, so the completion tracking the star mentee
 * and the mentor see reads 2/4 rather than 0 or 100 — both of which hide
 * bugs in the counting.
 */
export const SAMPLE_SURVEY_RESPONSES = [
  { registration_no: '2428020221', ratings: [4, 4, 3, 5, 4, 4, 5, 3, 4, 4] },
  { registration_no: '2428020224', ratings: [5, 5, 4, 5, 5, 4, 5, 4, 5, 5] }
];

// =====================================================================
// CSV generation — the files a Cluster Head would actually upload
// =====================================================================
function toCsv(headers, rows) {
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n') + '\n';
}

/**
 * The mentor-HOD mapping file, with the department sheet's own columns.
 * The real sheet heads the HOD columns "Cluster Head"; either word works.
 */
export function buildHodMappingCsv(mapping = SAMPLE_HOD_MAPPING) {
  return toCsv(
    ['Section', 'Mentor / Class Coordinator Name', 'Role', 'Official Email', 'HOD', 'Official Email of HOD'],
    mapping.map((entry) => [
      entry.section, entry.mentor_name, entry.designation, entry.mentor_email,
      hodNameOf(entry.hod_email), entry.hod_email
    ])
  );
}

/**
 * Mirrors the shape of the real ERP export: metadata lines naming the
 * course, section and reporting window, then the table with a % column.
 * The parser finds the header row by looking for "Registration No." and
 * "%", so the leading lines can vary without breaking it.
 */
export function buildAttendanceCsv(courseCode, section) {
  const block = SAMPLE_ATTENDANCE.find((b) => b.course_code === courseCode && b.section === section);
  if (!block) throw new Error(`No sample attendance for ${courseCode} section ${section}`);
  const nameOf = (reg) => SAMPLE_STUDENTS.find((s) => s.registration_no === reg)?.full_name ?? '';
  const { period_start, period_end } = sampleAttendancePeriod();
  const dmy = (iso) => iso.split('-').reverse().join('/');

  const header = [
    ['Class Attendance', `Academic Year: 26-27`, ''],
    [`From Date: ${dmy(period_start)}`, `To Date: ${dmy(period_end)}`, ''],
    [`Course Code: ${block.course_code}`, `Course Name: ${block.course_name}`, `Section: ${block.section}`]
  ];

  const table = [
    ['S.No.', 'Registration No.', 'Name', 'Section', 'Total Class', 'Present', 'Absent', '%'],
    ...block.rows.map((row, index) => [
      index + 1,
      row.identifier,
      nameOf(row.identifier),
      block.section,
      row.classes_held,
      row.classes_attended,
      Number(row.classes_held) - Number(row.classes_attended),
      row.attendance_percent
    ])
  ];

  return toCsv(header[0], [...header.slice(1), ...table]);
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * The CGPA / GPA & Credits export as the ERP writes it: an HTML table
 * saved with an .xls extension, with the two-row header made of rowspan
 * and colspan.
 */
export function buildGpaExportHtml(dataset = SAMPLE_GPA_EXPORT) {
  const nameOf = (reg) => SAMPLE_STUDENTS.find((s) => s.registration_no === reg)?.full_name ?? '';
  const th = (text, attrs = '') => `<th${attrs}>${escapeHtml(text)}</th>`;
  const td = (text) => `<td>${escapeHtml(text)}</td>`;

  const top = [
    th('S. No.', ' rowspan="2"'),
    th('Registration No.', ' rowspan="2"'),
    th('Student Name', ' rowspan="2"'),
    th('CGPA', ' rowspan="2"'),
    th('Total Earned Credits', ' rowspan="2"'),
    th('Total Required Credits', ' rowspan="2"'),
    ...dataset.semester_columns.map((n) => th(`Semester ${ROMAN[n]}`, ' colspan="3"'))
  ].join('');
  const sub = dataset.semester_columns.map(() => th('GPA') + th('Earned Credits') + th('Req Credits')).join('');

  const body = dataset.rows
    .map((row, index) => {
      const cells = [index + 1, row.identifier, nameOf(row.identifier), row.cgpa, row.total_earned_credits, '-'];
      for (const n of dataset.semester_columns) {
        const graded = row.semesters[n];
        const required = dataset.in_progress?.semester === n ? dataset.in_progress.required_credits : '-';
        cells.push(graded?.gpa ?? '-', graded?.earned_credits ?? '-', graded ? '-' : required);
      }
      return `<tr>${cells.map(td).join('')}</tr>`;
    })
    .join('\n');

  return `<div class="col-lg-12">
  <h4><span id="spnHeaderTable"> Student's CGPA / GPA &amp; Credits</span></h4>
  <table border="1" id="kt_ViewTable">
    <thead><tr>${top}</tr><tr>${sub}</tr></thead>
    ${body}
  </table>
</div>
`;
}

/** The Defaulter Grade result as the ERP writes it: title, student grid, subject table. */
export function buildDefaulterGradeHtml(result) {
  const nameOf = (reg) => SAMPLE_STUDENTS.find((s) => s.registration_no === reg)?.full_name ?? 'VISITING STUDENT';
  const cell = (text) => `<td>${escapeHtml(text)}</td>`;
  const header = ['S.No.', 'Registration No', 'Student Name', ...result.subjects.map((s) => s.code)];
  const students = result.rows
    .map((row, index) =>
      `<tr>${[index + 1, row.identifier, nameOf(row.identifier).toUpperCase(), ...result.subjects.map((s) => row.grades[s.code] ?? '')]
        .map(cell)
        .join('')}</tr>`)
    .join('\n');
  const credits = result.subjects
    .map((s, index) => `<tr>${[index + 1, s.table_code ?? s.code, s.name, s.credits].map(cell).join('')}</tr>`)
    .join('\n');
  const semesterWord = `${ROMAN[result.semester_number]} SEMESTER`;

  return `<div class="col-lg-12"><div class="table-responsive">
<table id="kt_ViewTableHeader"><tr><td colspan="${header.length}"><b>${escapeHtml(result.title)}<br>${escapeHtml(result.programme)}- ${semesterWord}</b></td></tr></table>
<table border="1" id="kt_ViewTable"><tr>${header.map(cell).join('')}</tr>
${students}
</table>
<table border="1" id="kt_ViewTableCredit"><tr>${['S.No.', 'Subject Code', 'Subject Description', 'Credit'].map(cell).join('')}</tr>
${credits}
</table>
</div></div>
`;
}

// ── A .docx without a dependency ─────────────────────────────────────
// Enough of the format for Word, LibreOffice and the upload parser: the
// three parts a document needs, stored (not compressed) in a zip.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // 1 January 1980
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}

const xmlText = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A Word document from a heading and a list of tables. Each table is a
 * list of rows; each cell is a string, or { lines: [...] } for a cell with
 * several lines, with optional span (columns) and vMerge ('restart' |
 * 'continue') for merged cells, the way Word stores them.
 */
export function buildMinimalDocx({ heading = '', tables = [] }) {
  const paragraph = (text, bold = false) =>
    `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`;
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join('');
  const cellXml = (cell) => {
    const spec = typeof cell === 'string' ? { lines: [cell] } : cell;
    const props = [
      spec.span > 1 ? `<w:gridSpan w:val="${spec.span}"/>` : '',
      spec.vMerge === 'restart' ? '<w:vMerge w:val="restart"/>' : spec.vMerge === 'continue' ? '<w:vMerge/>' : ''
    ].join('');
    const lines = spec.lines?.length ? spec.lines : [''];
    return `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ''}${lines.map((line) => paragraph(line, spec.bold)).join('')}</w:tc>`;
  };
  const tableXml = (rows) =>
    `<w:tbl><w:tblPr><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${rows
      .map((row) => `<w:tr>${row.map(cellXml).join('')}</w:tr>`)
      .join('')}</w:tbl>${paragraph('')}`;

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    (heading ? paragraph(heading, true) : '') +
    tables.map(tableXml).join('') +
    '<w:sectPr/></w:body></w:document>';

  return zipStored([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      )
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '</Relationships>'
      )
    },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') }
  ]);
}

/** The PB notice as a .docx laid out like the real one. */
export function buildBlackDotNoticeDocx(notice = SAMPLE_BLACK_DOT_NOTICE) {
  const header = ['S/No', 'Regn No', 'Name', { lines: ['Date of ', 'Incidence'] }, 'Block', 'Room No', 'Course/Branch', 'Mob No', 'Previous Record'];
  const tables = notice.cases.map((entry) => [
    [{ lines: [entry.line], span: header.length, bold: true }],
    header,
    ...entry.students.map((student, index) => [
      String(index + 1),
      student.identifier,
      student.name,
      // Written once per case and merged down, as the notice does it.
      { lines: [index === 0 ? entry.date : ''], vMerge: index === 0 ? 'restart' : 'continue' },
      student.block,
      student.room,
      { lines: student.course_branch },
      student.mobile,
      student.previous
    ])
  ]);
  return buildMinimalDocx({ heading: notice.heading, tables });
}

/** Every upload-ready file, keyed by the filename it should be written as. */
export function buildAllSampleFiles() {
  const files = {
    'mentor-hod-mapping-sample.csv': buildHodMappingCsv(SAMPLE_HOD_MAPPING),
    'gpa-cgpa-credits-sample.xls': buildGpaExportHtml(SAMPLE_GPA_EXPORT),
    [SAMPLE_BLACK_DOT_NOTICE.file]: buildBlackDotNoticeDocx(SAMPLE_BLACK_DOT_NOTICE)
  };
  for (const result of SAMPLE_BACKLOG_RESULTS) {
    files[result.file] = buildDefaulterGradeHtml(result);
  }
  for (const block of SAMPLE_ATTENDANCE) {
    files[`attendance-${block.course_code}-section-${block.section}-sample.csv`] = buildAttendanceCsv(
      block.course_code,
      block.section
    );
  }
  return files;
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('cluster-head-sample-data.mjs');

if (isDirectRun) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), 'generated');
  mkdirSync(outputDir, { recursive: true });

  const files = buildAllSampleFiles();
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(resolve(outputDir, name), contents);
    console.log(`  + ${name}`);
  }
  console.log(`\n${Object.keys(files).length} sample file(s) written to sample-data/generated/`);
  console.log('Upload them from the HOD portal (Uploads) or the Cluster Head portal to watch the whole at-risk flow run;');
  console.log('mentor-hod-mapping-sample.csv goes to the administrator portal (Upload).\n');
}
