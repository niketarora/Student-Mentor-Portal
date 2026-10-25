/**
 * spreadsheet-parser.js
 * Reads HOD-uploaded roster files and Cluster Head academic-data files.
 * Uses ExcelJS for .xlsx and a small hand-rolled RFC-4180 reader for .csv.
 *
 * Note on the Phase 1 finding: the old code used SheetJS (xlsx) 0.18.5,
 * which carries prototype-pollution and ReDoS advisories. ExcelJS is the
 * replacement, and nothing in this file ever assigns a parsed key onto an
 * object literal without going through a null-prototype map first, so a
 * "__proto__" column header cannot poison anything.
 *
 * Many consumers, one reader: readSheetRows() does the file-format work
 * and parseRosterFile() (accounts), parseAttendanceExport() and
 * parseMentorMappingFile() map its output onto their own header
 * vocabulary. Keeping the CSV/XLSX handling in one place means a fix to
 * quoting or date coercion lands for all of them.
 *
 * The three exports added for the ERP's own layouts (the CGPA / GPA &
 * Credits export, the Defaulter Grade result and the Proctorial Board's
 * black dot notice) read through readSheetGrid() instead, which adds the
 * two things those files need: merged header cells filled in, and .docx.
 *
 * STUDENTS ARE MATCHED ON REGISTRATION NUMBER ONLY
 * Every Cluster Head upload identifies a student by the Registration No.
 * column and nothing else, not email and not roll number (Form A keeps
 * roll number as a separate field, so it is a different number).
 * REGISTRATION_ALIASES is the one list of spellings for that column.
 */

import ExcelJS from 'exceljs';
import { ApiError } from './http-response.js';
import { decodeEntities, readDocxGrid, readHtmlGrid } from './table-readers.js';

const MAX_ROWS = 5000;

/**
 * Every spelling of the registration number column seen in the ERP
 * exports and the PB notice, after cleanHeader(): "Registration No.",
 * "Registration No", "Reg No", "Regn No" ...
 */
export const REGISTRATION_ALIASES = [
  'registration no', 'registration number', 'registration', 'reg no', 'reg number',
  'regn no', 'regn number', 'regd no', 'enrolment no', 'enrollment no',
  'enrolment number', 'enrollment number'
];

/** Column header aliases, so the HOD's spreadsheet doesn't have to be exact. */
const HEADER_ALIASES = {
  email: ['email', 'e-mail', 'email id', 'e-mail id', 'mail', 'email address'],
  full_name: ['name', 'full name', 'student name', 'faculty name', 'staff name'],
  login_id: ['reg no', 'reg. no', 'reg no.', 'registration no', 'registration number',
             'roll no', 'roll number', 'faculty id', 'employee id', 'staff id', 'id'],
  branch: ['branch', 'dept', 'department', 'discipline',
           'program', 'program name', 'programme', 'programme name'],
  section: ['section', 'sec'],
  semester_label: ['semester', 'sem', 'semester label'],
  phone: ['phone', 'mobile', 'mobile no', 'mobile number', 'contact', 'contact no'],
  mentor_email: ['mentor email', 'faculty email', 'assigned mentor', 'mentor'],
  /**
   * Guardian contact, straight off the Registered Students export. The
   * At-Risk page has always had a Parent Contact column reading Form A,
   * which is blank until the student fills one in — this is what makes
   * that column useful from day one.
   */
  parent_name:   ["father's name", 'father name', 'parent name', 'guardian name'],
  parent_mobile: ["father's number", 'father number', "father's mobile", "father's contact",
                  'parent number', 'parent mobile', 'guardian number', 'guardian mobile'],
  parent_email:  ["father's email", 'father email', 'parent email', 'guardian email'],
  /**
   * Optional. When present, this becomes the account's initial password
   * instead of a generated one, so the HOD can hand out a password they
   * already know. The account is still forced to change it on first
   * sign-in — this replaces the *generation*, not the change-on-first-use
   * rule. Blank cells fall back to a generated password.
   */
  password: ['password', 'initial password', 'temporary password', 'temp password', 'default password'],
  /** Only used by a combined import: says whether the row is staff or a student. */
  role: ['role', 'type', 'user type', 'category', 'designation type']
};

/** Free-text role values the combined importer understands. */
const FACULTY_ROLE_WORDS = ['faculty', 'mentor', 'staff', 'teacher', 'professor', 'prof', 'teaching'];
const STUDENT_ROLE_WORDS = ['student', 'mentee', 'learner'];

export function classifyRole(value) {
  const cleaned = String(value ?? '').trim().toLowerCase();
  if (!cleaned) return null;
  if (FACULTY_ROLE_WORDS.some((word) => cleaned.includes(word))) return 'faculty';
  if (STUDENT_ROLE_WORDS.some((word) => cleaned.includes(word))) return 'student';
  return null;
}

/**
 * One header normaliser for all four column maps below.
 *
 * The trailing trim() matters: "Registration No." becomes "registration
 * no " once the dot is turned into a space, and without the second trim
 * it matches nothing — which is exactly how the real ERP and roster
 * exports spell that column.
 */
function cleanHeader(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseHeader(raw) {
  const cleaned = cleanHeader(raw);
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(cleaned)) return canonical;
  }
  return null;
}

/** RFC-4180-ish CSV reader: handles quoted fields and embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\n') {
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function rowsToRecords(rows) {
  if (rows.length < 2) {
    throw new ApiError('The spreadsheet needs a header row and at least one data row.', 400);
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw new ApiError(`Too many rows (${rows.length - 1}). Split the file into batches of ${MAX_ROWS}.`, 400);
  }

  const headerMap = rows[0].map(normaliseHeader);
  if (!headerMap.includes('email')) {
    throw new ApiError(
      'No "Email" column found. Required columns: Email, Name. Optional: Reg No / Faculty ID, Branch, Section, Semester, Phone, Mentor Email, Role.',
      400
    );
  }

  const records = [];
  for (let r = 1; r < rows.length; r += 1) {
    // Object.create(null) — a "__proto__" header cannot pollute anything.
    const record = Object.create(null);
    let hasValue = false;
    for (let c = 0; c < headerMap.length; c += 1) {
      const key = headerMap[c];
      if (!key) continue;
      const value = String(rows[r][c] ?? '').trim();
      if (value) { record[key] = value; hasValue = true; }
    }
    if (hasValue) records.push({ rowNumber: r + 1, ...record });
  }
  return records;
}

/**
 * The ERP's "export to Excel" produces an HTML <table> saved with a .xls
 * extension — not a spreadsheet at all. Neither ExcelJS nor the CSV reader
 * can touch it, so it gets its own reader.
 *
 * Deliberately a small tag-stripper rather than a DOM parser: the input is
 * one machine-generated table with no scripts, no attributes we care about
 * and no nesting beyond the header block, and adding an HTML parser to the
 * serverless bundle for it would be disproportionate. Everything is
 * entity-decoded and tags are discarded, so nothing from the file is ever
 * interpreted as markup.
 */
function looksLikeHtml(buffer) {
  const head = buffer.subarray(0, 2048).toString('utf8').toLowerCase();
  return /<table|<html|<!doctype html|<tr[\s>]/.test(head);
}

function parseHtmlTable(text) {
  const rows = [];
  // Rows are delimited by </tr>, cells by </td> or </th>. Nested tables in
  // the header block flatten into the row that contains them, which is
  // exactly what we want: the metadata lines come through as plain cells.
  for (const rawRow of text.split(/<\/tr\s*>/i)) {
    if (!/<t[dh][\s>]/i.test(rawRow)) continue;
    const cells = rawRow
      .split(/<\/t[dh]\s*>/i)
      .slice(0, -1)
      .map((cell) =>
        decodeEntities(cell.replace(/<[^>]*>/g, ' '))
          .replace(/\s+/g, ' ')
          .trim()
      );
    if (cells.some((cell) => cell !== '')) rows.push(cells);
  }
  return rows;
}

/** Reads a .csv, .xlsx or HTML-table-masquerading-as-.xls buffer. */
async function readSheetRows(buffer, filename) {
  const lower = String(filename ?? '').toLowerCase();

  // Extension is a hint, not proof — check the bytes first.
  if (looksLikeHtml(buffer)) {
    return parseHtmlTable(buffer.toString('utf8'));
  }

  if (lower.endsWith('.csv')) {
    return parseCsv(buffer.toString('utf8'));
  }

  if (lower.endsWith('.xls')) {
    // A genuine binary .xls (BIFF, starts with D0 CF 11 E0). ExcelJS cannot
    // read those and adding a reader for a format Excel itself deprecated
    // is not worth it.
    throw new ApiError(
      'This is a legacy binary .xls file. Open it in Excel and save as .xlsx, then upload again.',
      400
    );
  }

  if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ApiError('The workbook has no sheets.', 400);

    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      // A merged range reports its text in every cell it covers.
      row.eachCell({ includeEmpty: true }, (cell) => values.push(cellText(cell.value)));
      rows.push(values);
    });
    return rows;
  }

  throw new ApiError('Only .csv, .xlsx and the ERP .xls export are supported.', 400);
}

/** One ExcelJS cell value as the text a person would see in it. */
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((part) => part.text ?? '').join('');
    if ('text' in v) return String(v.text ?? '');
    if ('result' in v) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result ?? '');
    if ('error' in v) return '';
  }
  return String(v);
}

/**
 * readSheetRows() plus merged cells and Word documents, for the ERP and
 * PB-notice parsers below. The ERP's HTML exports go through the span-aware
 * reader, because the CGPA / GPA & Credits header is built from rowspan
 * and colspan and the flat reader would shift every column after it.
 */
async function readSheetGrid(buffer, filename, { allowDocx = false } = {}) {
  const lower = String(filename ?? '').toLowerCase();
  if (looksLikeHtml(buffer)) return readHtmlGrid(buffer.toString('utf8'));
  if (lower.endsWith('.docx')) {
    if (!allowDocx) throw new ApiError('Only .csv, .xlsx and the ERP .xls export are supported.', 400);
    return readDocxGrid(buffer);
  }
  if (lower.endsWith('.doc')) {
    throw new ApiError('This is an old-style .doc file. Open it in Word, save it as .docx, then upload again.', 400);
  }
  if (allowDocx && !/\.(csv|xlsx|xls)$/.test(lower)) {
    throw new ApiError('Upload the notice as .docx, or the same table as .xlsx or .csv.', 400);
  }
  return readSheetRows(buffer, filename);
}

/** Row value by column index, trimmed; '' for a missing column. */
function cellAt(row, index) {
  return index == null ? '' : String(row?.[index] ?? '').trim();
}

/** Placeholders the ERP exports use for "nothing here". Same list as public.is_blank_mark(). */
function isBlankMark(value) {
  return ['', '-', '--', '—', '–', 'na', 'n/a', 'n.a.'].includes(String(value ?? '').trim().toLowerCase());
}

/** First alias group whose list contains the cleaned header, or null. */
function matchColumn(raw, aliasMap) {
  const cleaned = cleanHeader(raw);
  if (!cleaned) return null;
  for (const [canonical, aliases] of Object.entries(aliasMap)) {
    if (aliases.includes(cleaned)) return canonical;
  }
  return null;
}

function isRegistrationHeader(raw) {
  return REGISTRATION_ALIASES.includes(cleanHeader(raw));
}

export async function parseRosterFile(buffer, filename) {
  return rowsToRecords(await readSheetRows(buffer, filename));
}

// =====================================================================
// The ERP "Class Attendance" export
// =====================================================================
/**
 * Shape of the real "Consolidated Attendance" export:
 *
 *   Consolidated Attendance | Academic Year: 26-27 | Academic Session: JUL-NOV 2026
 *                           | From Date: 23/07/2026 | To Date:18/08/2026
 *   Course Code: DOA2099 | Course Name: PRINCIPLES OF MANAGEMENT | Section:
 *   S.No. | Registration No. | Name | Faculty Name | Course Code | Section | Total Class | Present | Absent | %
 *   1     | 2502050231       | ...  | Ritika Bhatia| DOA2099     | B       | 8           | 7       | 1      | 87.00
 *
 * Two things this file does that the earlier hand-made sample did not:
 *
 *   1. EVERY SECTION OF THE COURSE IS IN ONE FILE, and the header's
 *      "Section:" is blank. The section is a per-row column (B..N here,
 *      "R 3" in other exports). Reading it from the header put all 2,500
 *      students in whichever section happened to be listed first.
 *
 *   2. A STUDENT CAN APPEAR MORE THAN ONCE — same course, same section,
 *      different lecturer, different class count (187 of them do here).
 *      Their real attendance is the combined figure, so rows are summed
 *      per registration number rather than one silently overwriting the
 *      other via ON CONFLICT. 4/4 + 0/2 is 66.7%, not 100% and not 0%.
 *
 * The "%" column is still taken verbatim wherever a student has exactly
 * one row, so the portal never disagrees with the ERP.
 */

/** Pulls "Course Code: IIS3120" style pairs out of the header cells. */
function headerValue(cells, ...labels) {
  for (const cell of cells) {
    for (const label of labels) {
      // Tolerates "Label: value", "Label :-value", "Label:-value".
      //
      // The value must START with something that is not punctuation. With
      // a plain (.+) the optional colon backtracks on an EMPTY field and
      // the separator becomes the value: "Section:" returned ":".
      const match = new RegExp(`${label}\\s*:?\\s*-?\\s*([^\\s:-].*)$`, 'i').exec(cell);
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  return null;
}

/** "23/07/2026" -> "2026-07-23". The export is day-first. */
function parseErpDate(value) {
  if (!value) return null;
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(String(value).trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const ATTENDANCE_COLUMNS = {
  identifier: REGISTRATION_ALIASES,
  name: ['name', 'student name'],
  section: ['section', 'sec'],
  classes_held: ['total class', 'total classes', 'classes held', 'total'],
  classes_attended: ['present', 'classes attended', 'attended'],
  classes_absent: ['absent'],
  attendance_percent: ['%', 'percentage', 'attendance %', '% attendance', 'percent']
};

function matchAttendanceColumn(raw) {
  const cleaned = cleanHeader(raw);
  for (const [canonical, aliases] of Object.entries(ATTENDANCE_COLUMNS)) {
    if (aliases.includes(cleaned)) return canonical;
  }
  return null;
}

export async function parseAttendanceExport(buffer, filename) {
  const rows = await readSheetRows(buffer, filename);
  if (!rows.length) throw new ApiError('That attendance file appears to be empty.', 400);

  // Find the header row by looking for the two columns we cannot work
  // without, rather than assuming it is at a fixed offset — the number of
  // metadata lines above it varies between exports.
  let headerIndex = -1;
  let headerMap = null;
  for (let r = 0; r < Math.min(rows.length, 25); r += 1) {
    const mapped = rows[r].map(matchAttendanceColumn);
    if (mapped.includes('identifier') && mapped.includes('attendance_percent')) {
      headerIndex = r;
      headerMap = mapped;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new ApiError(
      'Could not find the attendance table. The file needs a header row with "Registration No." and a "%" column.',
      400
    );
  }

  const headerCells = rows.slice(0, headerIndex).flat();
  const meta = {
    course_code: headerValue(headerCells, 'course code'),
    course_name: headerValue(headerCells, 'course name'),
    section: headerValue(headerCells, 'section'),
    period_start: parseErpDate(headerValue(headerCells, 'from date')),
    period_end: parseErpDate(headerValue(headerCells, 'to date')),
    faculty_name: headerValue(headerCells, 'faculty name'),
    academic_year: headerValue(headerCells, 'academic year'),
    academic_session: headerValue(headerCells, 'academic session')
  };

  if (!meta.course_code) {
    throw new ApiError('No "Course Code:" line found in the file header.', 400);
  }

  // Registration number is the key, not the row number: a student can be
  // listed more than once for the same course.
  const byStudent = new Map();
  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const raw = Object.create(null);
    for (let c = 0; c < headerMap.length; c += 1) {
      const key = headerMap[c];
      if (!key) continue;
      const value = String(rows[r][c] ?? '').trim();
      if (value) raw[key] = value;
    }
    if (!raw.identifier) continue;

    const key = raw.identifier.toLowerCase();
    const percent = Number(String(raw.attendance_percent ?? '').replace('%', '').trim());
    const held = Number(raw.classes_held);
    const attended = Number(raw.classes_attended);
    const seen = byStudent.get(key);

    if (!seen) {
      byStudent.set(key, {
        rowNumber: r + 1,
        identifier: raw.identifier,
        section: raw.section ?? meta.section ?? '',
        heldSum: Number.isFinite(held) ? held : null,
        attendedSum: Number.isFinite(attended) ? attended : null,
        percent: Number.isFinite(percent) ? percent : null
      });
      continue;
    }

    // Second row for this student. Combining the raw counts is the only
    // honest answer — averaging two percentages taken over different
    // class counts is not the same number.
    if (Number.isFinite(held) && Number.isFinite(attended) && seen.heldSum != null) {
      seen.heldSum += held;
      seen.attendedSum += attended;
      seen.percent = seen.heldSum > 0
        ? Math.round((seen.attendedSum * 10000) / seen.heldSum) / 100
        : 0;
    } else if (Number.isFinite(percent) && seen.percent != null) {
      // No usable counts on one of the rows — fall back to the mean, and
      // stop pretending we still have a verbatim ERP figure.
      seen.percent = Math.round(((seen.percent + percent) / 2) * 100) / 100;
      seen.heldSum = null;
      seen.attendedSum = null;
    }
    if (!seen.section && raw.section) seen.section = raw.section;
  }

  const records = [...byStudent.values()].map((s) => ({
    rowNumber: s.rowNumber,
    identifier: s.identifier,
    section: s.section,
    classes_held: s.heldSum == null ? '' : String(s.heldSum),
    classes_attended: s.attendedSum == null ? '' : String(s.attendedSum),
    attendance_percent: s.percent == null ? '' : String(s.percent)
  }));

  if (!records.length) {
    throw new ApiError('The attendance table has a header but no student rows.', 400);
  }
  if (!meta.section && !records.some((r) => r.section)) {
    throw new ApiError(
      'No section found — the file header has no "Section:" line and the table has no Section column.',
      400
    );
  }
  meta.sections = [...new Set(records.map((r) => r.section).filter(Boolean))].sort();

  // A file with no dates still records fine; the window just defaults to
  // the day of upload rather than blocking a valid roll call.
  const today = new Date().toISOString().slice(0, 10);
  meta.period_start = meta.period_start ?? today;
  meta.period_end = meta.period_end ?? meta.period_start;

  return { meta, records };
}

// =====================================================================
// Mentor–mentee mapping
// =====================================================================
/**
 * The departmental "Mentor Mentee List" sheet:
 *
 *   S.No. | Registration No. | Name | Mentor Name | Mentor Phone No. | Mentor Email
 *
 * Only two columns matter. The mentor is identified by EMAIL, because
 * that is what matches a faculty account — "Dr Bagesh Kumar" spelled
 * three different ways across three files would not. Mentor Phone No. is
 * ignored on purpose: it is often blank or half filled, and the mentor's
 * own profile is where their number belongs.
 */
export async function parseMentorMappingFile(buffer, filename) {
  const rows = await readSheetRows(buffer, filename);
  if (rows.length < 2) {
    throw new ApiError('The file needs a header row and at least one data row.', 400);
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw new ApiError(`Too many rows (${rows.length - 1}). Split the file into batches of ${MAX_ROWS}.`, 400);
  }

  const headerMap = rows[0].map((cell) => {
    const cleaned = cleanHeader(cell);
    if (['mentor email', 'faculty email', 'mentor email id', 'mentor mail'].includes(cleaned)) return 'mentor_email';
    // Only the qualified spellings. A bare "Name" in this file is the
    // student's, and claiming it here would name every mentor account
    // after their first mentee.
    if (['mentor name', 'faculty name', 'mentor'].includes(cleaned)) return 'mentor_name';
    // Students by registration number only, never by email.
    if (REGISTRATION_ALIASES.includes(cleaned)) return 'identifier';
    return null;
  });

  if (!headerMap.includes('identifier') || !headerMap.includes('mentor_email')) {
    throw new ApiError(
      'The file needs a "Registration No." column and a "Mentor Email" column.',
      400
    );
  }

  const records = [];
  for (let r = 1; r < rows.length; r += 1) {
    const raw = Object.create(null);
    for (let c = 0; c < headerMap.length; c += 1) {
      const key = headerMap[c];
      if (!key || raw[key]) continue;
      const value = String(rows[r][c] ?? '').trim();
      if (value) raw[key] = value;
    }
    if (!raw.identifier && !raw.mentor_email) continue;
    records.push({
      rowNumber: r + 1,
      identifier: raw.identifier ?? '',
      mentor_email: raw.mentor_email ?? '',
      // Optional: only used when this upload has to create the mentor's
      // account. Blank falls back to the email's local part.
      mentor_name: raw.mentor_name ?? ''
    });
  }

  if (!records.length) throw new ApiError('No usable rows were found in that file.', 400);
  return records;
}

/**
 * The administrator's mentor-HOD mapping (migration 0039): one row per
 * mentor or class coordinator, naming their section and their HOD.
 *
 *   Section | Mentor / Class Coordinator Name | Role | Official Email |
 *   HOD | Official Email of HOD
 *
 * The department's own sheet calls the HOD "Cluster Head", so either
 * word is read as the HOD. Columns are recognised by what they say, not
 * by position: any header naming the HOD (HOD, Head of Department,
 * Cluster Head) and an email is the HOD's email; any other email column
 * is the mentor's.
 *
 * Sections are written the way the rest of the app writes them: "O3"
 * and "o 3" both become "O 3".
 */
export function normaliseMappingSection(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  const match = /^([A-Z]+)\s*-?\s*(\d+)$/.exec(text);
  return match ? `${match[1]} ${match[2]}` : text;
}

function classifyHodMappingHeader(raw) {
  const header = cleanHeader(raw).replace(/\s*\/\s*/g, '/');
  const namesHod = /\b(hod|cluster head|head of (the )?department)\b/.test(header);
  const namesEmail = /\b(e-?mail|mail)\b/.test(header);
  if (namesHod && namesEmail) return 'hod_email';
  if (namesHod) return 'hod_name';
  if (namesEmail) return 'mentor_email';
  if (['section', 'sec', 'class section', 'section name', 'class'].includes(header)) return 'section';
  if (['role', 'designation', 'mentor role', 'type', 'responsibility'].includes(header)) return 'designation';
  if (/\bname\b/.test(header) || ['mentor', 'class coordinator', 'mentor/class coordinator', 'faculty'].includes(header)) {
    return 'mentor_name';
  }
  return null;
}

export async function parseHodMappingFile(buffer, filename) {
  const rows = await readSheetRows(buffer, filename);
  if (rows.length < 2) {
    throw new ApiError('The file needs a header row and at least one data row.', 400);
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw new ApiError(`Too many rows (${rows.length - 1}). Split the file into batches of ${MAX_ROWS}.`, 400);
  }

  const headerMap = rows[0].map(classifyHodMappingHeader);
  if (!headerMap.includes('mentor_email') || !headerMap.includes('hod_email')) {
    throw new ApiError(
      'The file needs the mentor\'s email ("Official Email") and the HOD\'s email ("Official Email of HOD") columns.',
      400
    );
  }

  const tidy = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const records = [];
  for (let r = 1; r < rows.length; r += 1) {
    const raw = Object.create(null);
    for (let c = 0; c < headerMap.length; c += 1) {
      const key = headerMap[c];
      if (!key || raw[key]) continue;
      const value = tidy(rows[r][c]);
      if (value) raw[key] = value;
    }
    // Blank rows at the end of the sheet.
    if (!raw.mentor_email && !raw.hod_email && !raw.mentor_name) continue;
    records.push({
      row: r + 1,
      section: raw.section ? normaliseMappingSection(raw.section).slice(0, 40) : '',
      mentor_name: (raw.mentor_name ?? '').slice(0, 120),
      designation: (raw.designation ?? '').slice(0, 80),
      mentor_email: (raw.mentor_email ?? '').toLowerCase(),
      hod_name: (raw.hod_name ?? '').slice(0, 120),
      hod_email: (raw.hod_email ?? '').toLowerCase()
    });
  }

  if (!records.length) throw new ApiError('No usable rows were found in that file.', 400);
  return records;
}


// =====================================================================
// Semester numbers
// =====================================================================
const ROMAN_NUMERALS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** "3" or "iii" -> 3; anything else -> null. */
function numberFromToken(token) {
  const text = String(token ?? '').toLowerCase();
  if (/^\d{1,2}$/.test(text)) return Number(text);
  return ROMAN_NUMERALS[text] ?? null;
}

/**
 * "4th Semester" / "Sem 4" / "4" / "Semester IV" / "IV SEMESTER" -> 4.
 * Returns null if unreadable or outside 1-8.
 */
export function parseSemesterLabel(value) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value);
  const digits = /(\d+)/.exec(text);
  const number = digits ? Number(digits[1]) : numberFromToken(/\b([ivx]+)\b/i.exec(text)?.[1]);
  return number >= 1 && number <= 8 ? number : null;
}

/**
 * A heading that names exactly one semester: "Semester I", "Sem 3",
 * "3rd Semester", "Semester-II". Anything else (including a bare
 * "Semester" column) -> null.
 */
function semesterGroup(raw) {
  const text = cleanHeader(raw);
  const match =
    /^(?:sem|semester)\s*[-:]?\s*([ivx]+|\d{1,2})$/.exec(text) ||
    /^([ivx]+|\d{1,2})(?:st|nd|rd|th)?\s*(?:sem|semester)$/.exec(text);
  return match ? numberFromToken(match[1]) : null;
}

// =====================================================================
// The ERP "Student's CGPA / GPA & Credits" export
// =====================================================================
/**
 * Shape of the real export (.xls, really an HTML table):
 *
 *   S. No. | Registration No. | Student Name | CGPA | Total Earned Credits | Total Required Credits | Semester I           | Semester II          | Semester III
 *          |                  |              |      |                      |                        | GPA | Earned | Req    | GPA | Earned | Req    | GPA | Earned | Req
 *   1      | 2502050550       | ...          | 7.26 | 40.00                | -                      | 7.68 | 20.00 | -      | 6.84 | 20.00 | -      | -   | -      | 24.00
 *
 * The first six headings span both header rows and each semester spans
 * three columns, so which semester a GPA belongs to is only written in the
 * row above it. "-" is a semester not graded yet (III above) and is left
 * out. How many semester groups there are depends on the batch.
 *
 * A plain one-semester sheet (Registration No | GPA | Semester) still
 * works; its rows go to the database in the older flat shape.
 */
const GPA_COLUMNS = {
  identifier: REGISTRATION_ALIASES,
  name: ['student name', 'name', 'name of student', 'name of the student'],
  cgpa: ['cgpa', 'c gpa', 'cumulative gpa', 'cumulative grade point average'],
  total_earned_credits: ['total earned credits', 'total credits earned', 'earned credits total'],
  total_required_credits: ['total required credits', 'total credits required', 'total req credits', 'required credits total'],
  gpa: ['gpa', 'sgpa', 'semester gpa', 'grade point average'],
  semester: ['semester', 'sem', 'semester number', 'semester no']
};

/** The three headings under each "Semester N". */
const SEMESTER_GROUP_COLUMNS = {
  gpa: ['gpa', 'sgpa', 'semester gpa'],
  earned_credits: ['earned credits', 'credits earned', 'earned credit', 'earned'],
  required_credits: ['req credits', 'required credits', 'credits required', 'req credit', 'required']
};

export async function parseGpaExport(buffer, filename) {
  const rows = await readSheetGrid(buffer, filename);
  if (!rows.length) throw new ApiError('That GPA file appears to be empty.', 400);

  // The header row is the first that names the registration number and
  // some kind of grade. The ERP puts a title and blank lines above it.
  let headerIndex = -1;
  for (let r = 0; r < Math.min(rows.length, 30); r += 1) {
    if (!rows[r].some(isRegistrationHeader)) continue;
    if (rows[r].some((cell) => semesterGroup(cell) != null || ['cgpa', 'gpa'].includes(matchColumn(cell, GPA_COLUMNS)))) {
      headerIndex = r;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new ApiError(
      'Could not find the GPA table. The file needs a "Registration No." column and either the ERP\'s Semester I, Semester II ... columns or a GPA column.',
      400
    );
  }

  const top = rows[headerIndex];
  const width = Math.max(top.length, rows[headerIndex + 1]?.length ?? 0);

  // Which semester each column sits under. A CSV leaves the cells under a
  // merged "Semester I" blank, so a group runs on until the next heading.
  const groupOf = [];
  let group = null;
  for (let c = 0; c < width; c += 1) {
    const raw = String(top[c] ?? '').trim();
    const semester = semesterGroup(raw);
    if (semester != null) group = semester;
    else if (raw !== '') group = null;
    groupOf[c] = group;
  }
  const twoLevel = groupOf.some((value) => value != null);
  const sub = twoLevel ? rows[headerIndex + 1] ?? [] : [];

  const topColumns = Object.create(null);
  const semesterColumns = [];
  for (let c = 0; c < width; c += 1) {
    if (groupOf[c] != null) {
      const field = matchColumn(sub[c], SEMESTER_GROUP_COLUMNS);
      if (field) semesterColumns.push({ c, semester: groupOf[c], field });
    } else {
      const field = matchColumn(top[c], GPA_COLUMNS);
      if (field && topColumns[field] == null) topColumns[field] = c;
    }
  }

  if (twoLevel && !semesterColumns.some((col) => col.field === 'gpa')) {
    throw new ApiError(
      'Found the Semester columns but no GPA under them. The row under "Semester I" should read GPA, Earned Credits, Req Credits.',
      400
    );
  }

  // The database keeps semesters 1-8. A longer programme's extra columns
  // are reported back rather than silently dropped or failing every row.
  const ignoredSemesters = [...new Set(semesterColumns.map((col) => col.semester).filter((s) => s < 1 || s > 8))];
  const usable = semesterColumns.filter((col) => col.semester >= 1 && col.semester <= 8);
  const semestersInFile = [...new Set(usable.map((col) => col.semester))].sort((a, b) => a - b);

  const records = [];
  const graded = new Set();
  for (let r = headerIndex + (twoLevel ? 2 : 1); r < rows.length; r += 1) {
    const row = rows[r];
    const identifier = cellAt(row, topColumns.identifier).replace(/\s+/g, '');
    // Some exports repeat the header on every printed page.
    if (isRegistrationHeader(identifier)) continue;

    const record = {
      row: r + 1,
      identifier,
      name: cellAt(row, topColumns.name),
      cgpa: cellAt(row, topColumns.cgpa),
      total_earned_credits: cellAt(row, topColumns.total_earned_credits),
      total_required_credits: cellAt(row, topColumns.total_required_credits)
    };

    let hasGrade = false;
    if (twoLevel) {
      const bySemester = new Map();
      for (const col of usable) {
        const entry = bySemester.get(col.semester) ??
          { semester_number: col.semester, gpa: '', earned_credits: '', required_credits: '' };
        entry[col.field] = cellAt(row, col.c);
        bySemester.set(col.semester, entry);
      }
      record.semesters = [...bySemester.values()]
        .filter((entry) => !isBlankMark(entry.gpa))
        .sort((a, b) => a.semester_number - b.semester_number);
      record.semesters.forEach((entry) => graded.add(entry.semester_number));
      hasGrade = record.semesters.length > 0;
    } else {
      record.gpa = cellAt(row, topColumns.gpa);
      const semester = parseSemesterLabel(cellAt(row, topColumns.semester));
      record.semester_number = semester == null ? '' : String(semester);
      hasGrade = !isBlankMark(record.gpa);
      if (hasGrade && semester != null) graded.add(semester);
    }

    if (!identifier && !hasGrade && isBlankMark(record.cgpa)) continue;
    records.push(record);
  }

  if (!records.length) throw new ApiError('The GPA table has a header but no student rows.', 400);
  if (records.length > MAX_ROWS) {
    throw new ApiError(`Too many rows (${records.length}). Split the file into batches of ${MAX_ROWS}.`, 400);
  }

  return {
    meta: {
      layout: twoLevel ? 'erp' : 'flat',
      semesters_in_file: semestersInFile,
      graded_semesters: [...graded].sort((a, b) => a - b),
      ignored_semesters: ignoredSemesters,
      has_cgpa: topColumns.cgpa != null
    },
    records
  };
}

// =====================================================================
// The ERP "Defaulter Grade" result export (backlogs)
// =====================================================================
/**
 * Shape of the real export (.xls, really three HTML tables):
 *
 *   RESULT OF END TERM EXAMNINATION -24-25 ()
 *   BTECH-031 : B TECH COMPUTER SCIENCE & ENGINEERING (IOT AND INTELLIGENT SYSTEM)- III SEMESTER
 *
 *   S.No. | Registration No | Student Name | IIS2121 | IIS2130 | MEE2001 | ... | OE
 *   1     | 2428020003      | ...          |         |         | F       | ... |
 *
 *   S.No. | Subject Code  | Subject Description                    | Credit
 *   1     | IIS2121       | OBJECT-ORIENTED PROGRAMMING USING JAVA | 4.00
 *   11    | OPEN ELECTIVE | OPEN ELECTIVE                          | 3.00
 *
 * One column per subject and one row per student who failed something,
 * with the grade (F, UFM, DT ...) where they did. The semester and the
 * exam come from the title lines, subject names and credits from the
 * table underneath. "OE" is matched to "OPEN ELECTIVE" by its initials,
 * which is how the export abbreviates it.
 *
 * Every subject column is sent as p_subject_codes, which is what lets the
 * database clear a backlog that this list no longer marks.
 *
 * A hand-made list (Registration No | Subject Code | Subject Name |
 * Cleared) still works and goes to the database one subject per row.
 */
const NOT_SUBJECT_COLUMNS = [
  's no', 'sno', 's/no', 'sr no', 'sl no', 'serial no', 'serial number', '#',
  'name', 'student name', 'name of student', 'name of the student',
  'section', 'sec', 'branch', 'program', 'programme', 'semester', 'sem',
  'remarks', 'remark', 'result', 'total', 'sgpa', 'cgpa', 'gpa', 'email', 'mobile', 'mobile no',
  "father's name", 'father name', 'roll no', 'roll number'
];

const BACKLOG_LIST_COLUMNS = {
  identifier: REGISTRATION_ALIASES,
  name: ['name', 'student name'],
  subject_code: ['subject code', 'course code', 'paper code', 'backlog code', 'code'],
  subject_name: ['subject', 'subject name', 'course name', 'paper name', 'subject description'],
  grade: ['grade', 'grade obtained'],
  credits: ['credit', 'credits'],
  is_cleared: ['cleared', 'is cleared', 'status', 'result']
};

function semesterFromTitle(lines) {
  for (const line of lines) {
    const match =
      /\b([IVX]+|\d{1,2})(?:st|nd|rd|th)?\s*SEM(?:ESTER)?\b/i.exec(line) ||
      /\bSEM(?:ESTER)?\s*[-:.]?\s*([IVX]+|\d{1,2})\b/i.exec(line);
    const number = match ? numberFromToken(match[1]) : null;
    if (number >= 1 && number <= 8) return number;
  }
  return null;
}

/** "RESULT OF END TERM EXAMNINATION -24-25 ()" -> "END TERM EXAMNINATION 24-25". */
function examFromTitle(lines) {
  const tidy = (text) =>
    text
      .replace(/\s*-\s*(\d{2,4}\s*-\s*\d{2,4})\s*$/, ' $1')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || null;
  for (const line of lines) {
    const match = /RESULT\s+OF\s+(.+?)\s*(?:\(|$)/i.exec(line);
    if (match) return tidy(match[1]);
  }
  const exam = lines.find((line) => /EXAM/i.test(line));
  return exam ? tidy(exam) : null;
}

/** The programme line minus its "- III SEMESTER" tail. For display only. */
function programmeFromTitle(lines) {
  for (const line of lines) {
    if (/RESULT\s+OF/i.test(line)) continue;
    const match = /^(.*?)[\s\-–:]*\b(?:[IVX]+|\d{1,2})(?:st|nd|rd|th)?\s*SEM(?:ESTER)?\b/i.exec(line);
    if (match && match[1].trim()) return match[1].replace(/[\s\-–:]+$/, '').trim();
  }
  return null;
}

const initialsOf = (text) =>
  String(text ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

export async function parseBacklogExport(buffer, filename) {
  const rows = await readSheetGrid(buffer, filename);
  if (!rows.length) throw new ApiError('That backlog file appears to be empty.', 400);

  let headerIndex = -1;
  for (let r = 0; r < Math.min(rows.length, 40); r += 1) {
    if (rows[r].some(isRegistrationHeader)) {
      headerIndex = r;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new ApiError('Could not find the student table. The file needs a "Registration No" column.', 400);
  }

  // The title lines above the table. Merged cells repeat their text, so
  // each line is taken once.
  const titleLines = [
    ...new Set(
      rows
        .slice(0, headerIndex)
        .flat()
        .flatMap((cell) => String(cell ?? '').split('\n'))
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ];
  const title = {
    semester: semesterFromTitle(titleLines),
    exam_session: examFromTitle(titleLines),
    programme: programmeFromTitle(titleLines)
  };

  const header = rows[headerIndex];
  const listColumns = Object.create(null);
  header.forEach((cell, c) => {
    const field = matchColumn(cell, BACKLOG_LIST_COLUMNS);
    if (field && listColumns[field] == null) listColumns[field] = c;
  });

  // ── A hand-made list: one subject per row ─────────────────────────
  if (listColumns.subject_code != null) {
    const records = [];
    for (let r = headerIndex + 1; r < rows.length; r += 1) {
      const row = rows[r];
      const identifier = cellAt(row, listColumns.identifier).replace(/\s+/g, '');
      const subjectCode = cellAt(row, listColumns.subject_code);
      if (isRegistrationHeader(identifier) || (!identifier && !subjectCode)) continue;
      records.push({
        row: r + 1,
        identifier,
        subject_code: subjectCode,
        subject_name: cellAt(row, listColumns.subject_name),
        grade: cellAt(row, listColumns.grade),
        credits: cellAt(row, listColumns.credits),
        // No Cleared column means "say nothing", not "not cleared" (B6).
        is_cleared: cellAt(row, listColumns.is_cleared)
      });
    }
    if (!records.length) throw new ApiError('No usable data rows were found in that file.', 400);
    if (records.length > MAX_ROWS) {
      throw new ApiError(`Too many rows (${records.length}). Split the file into batches of ${MAX_ROWS}.`, 400);
    }
    return { meta: { ...title, layout: 'list', subject_codes: null, subjects: [] }, records };
  }

  // ── The ERP layout: one column per subject ────────────────────────
  const idColumn = header.findIndex(isRegistrationHeader);
  const nameColumn = header.findIndex((cell) => ['name', 'student name', 'name of student'].includes(cleanHeader(cell)));
  const subjectColumns = [];
  header.forEach((cell, c) => {
    const text = String(cell ?? '').replace(/\s+/g, ' ').trim();
    if (!text || c === idColumn || c === nameColumn) return;
    if (NOT_SUBJECT_COLUMNS.includes(cleanHeader(text)) || isRegistrationHeader(text)) return;
    subjectColumns.push({ c, code: text.toUpperCase() });
  });
  if (!subjectColumns.length) {
    throw new ApiError(
      'No subject columns found. After Registration No and Student Name the file should have one column per subject code.',
      400
    );
  }

  // The Subject Code / Description / Credit table under the students.
  let creditHeader = -1;
  for (let r = headerIndex + 1; r < rows.length; r += 1) {
    const cleaned = rows[r].map(cleanHeader);
    if (
      cleaned.includes('subject code') &&
      cleaned.some((cell) => ['subject description', 'subject name', 'description', 'credit', 'credits'].includes(cell))
    ) {
      creditHeader = r;
      break;
    }
  }
  const subjects = new Map();
  if (creditHeader !== -1) {
    const heads = rows[creditHeader].map(cleanHeader);
    const codeAt = heads.indexOf('subject code');
    const nameAt = heads.findIndex((cell) => ['subject description', 'subject name', 'description', 'subject'].includes(cell));
    const creditAt = heads.findIndex((cell) => ['credit', 'credits'].includes(cell));
    for (let r = creditHeader + 1; r < rows.length; r += 1) {
      const code = cellAt(rows[r], codeAt).replace(/\s+/g, ' ').toUpperCase();
      if (!code) continue;
      subjects.set(code, {
        name: nameAt === -1 ? '' : cellAt(rows[r], nameAt),
        credits: creditAt === -1 ? '' : cellAt(rows[r], creditAt)
      });
    }
  }
  const describe = (code) => {
    if (subjects.has(code)) return subjects.get(code);
    for (const [key, value] of subjects) {
      if (initialsOf(key) === code || initialsOf(value.name) === code) return value;
    }
    return { name: '', credits: '' };
  };
  const subjectInfo = subjectColumns.map((col) => ({ ...col, ...describe(col.code) }));

  const end = creditHeader === -1 ? rows.length : creditHeader;
  const records = [];
  for (let r = headerIndex + 1; r < end; r += 1) {
    const row = rows[r];
    const identifier = cellAt(row, idColumn).replace(/\s+/g, '');
    if (isRegistrationHeader(identifier)) continue;
    const grades = [];
    for (const subject of subjectInfo) {
      const grade = cellAt(row, subject.c);
      if (isBlankMark(grade)) continue;
      grades.push({ subject_code: subject.code, subject_name: subject.name, credits: subject.credits, grade });
    }
    if (!identifier && !grades.length) continue;
    records.push({ row: r + 1, identifier, name: cellAt(row, nameColumn), grades });
  }

  if (!records.length) throw new ApiError('The result table has a header but no student rows.', 400);
  if (records.length > MAX_ROWS) {
    throw new ApiError(`Too many rows (${records.length}). Split the file into batches of ${MAX_ROWS}.`, 400);
  }

  return {
    meta: {
      ...title,
      layout: 'erp',
      subject_codes: subjectInfo.map((subject) => subject.code),
      subjects: subjectInfo.map(({ code, name, credits }) => ({ code, name, credits }))
    },
    records
  };
}

// =====================================================================
// The Proctorial Board notice (black dots)
// =====================================================================
/**
 * Shape of the real notice (.docx), one table per case:
 *
 *   Case No: 034/Even Sem/ 2026.  The undermentioned students were involved in possession of banned items.
 *   S/No | Regn No | Name | Date of Incidence | Block | Room No | Course/Branch | Mob No | Previous Record
 *   1    | ...     | ...  | 10/09/26          | B7    | ...     | B Tech ECE     | ...    | 1 black dot
 *        |         |      |                   |       |         | Sec- F1        |        |
 *   2    | ...     | ...  |   (merged down)   | B7    | ...     | ...            | ...    | 8 black dot
 *
 * The case line spans the whole table. It carries the case number and,
 * after the first full stop or comma, what the case is about; every
 * student row below it belongs to that case until the next case line.
 * The date of incidence is usually written once per case (merged down,
 * or only on the first row), so a blank date takes the case's date.
 *
 * The same table as .xlsx or .csv works too, with the case lines between
 * the tables or with a Case No column on every row.
 */
const BLACK_DOT_COLUMNS = {
  identifier: REGISTRATION_ALIASES,
  serial: ['s/no', 's no', 'sno', 'sr no', 'sl no', 'serial no'],
  name: ['name', 'student name', 'name of student', 'name of the student'],
  incident: ['date of incidence', 'date of incident', 'incident date', 'date of the incident', 'date'],
  hostel_block: ['block', 'hostel block', 'hostel', 'block no', 'hostel/block', 'hostel / block'],
  room_no: ['room no', 'room', 'room number'],
  course_branch: ['course/branch', 'course / branch', 'course branch', 'course & branch', 'course', 'branch', 'program', 'programme'],
  mobile_no: ['mob no', 'mobile no', 'mobile', 'mobile number', 'contact no', 'contact number', 'phone', 'phone no'],
  previous_record: ['previous record', 'previous records', 'prev record', 'past record', 'previous black dots'],
  case_number: ['case no', 'case number', 'case'],
  case_details: ['case details', 'details', 'offence', 'offense', 'nature of offence', 'nature of offense', 'description', 'charge']
};

const oneLine = (text) =>
  String(text ?? '')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');

/** "034/Even Sem/ 2026. The students ..." -> { number: "034/Even Sem/2026", details: "The students ..." } */
function splitCase(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').replace(/^[\s:\-–—]+/, '').trim();
  const match = /^(.+?)(?:\s*[,;]\s+|\.\s+(?=[A-Za-z])|\s+[-–—]\s+|\s+(?=the\b))(.*)$/i.exec(flat);
  const number = (match ? match[1] : flat).replace(/\s*\/\s*/g, '/').replace(/[.,;:\s]+$/, '').trim();
  const details = (match ? match[2] : '').replace(/^[\s,.;:\-–—]+/, '').trim();
  return { number, details };
}

/** A "Case No: ..." line, or null. A bare "Case details" heading is not one. */
function parseCaseLine(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const match =
    /^case\s*(?:no\.?|number|#)?\s*[:\-–—]+\s*(.+)$/i.exec(flat) ||
    /^case\s*(?:no\.?|number|#)\s+(.+)$/i.exec(flat);
  if (!match) return null;
  const parsed = splitCase(match[1]);
  return parsed.number ? parsed : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A complete date in the notice -> "YYYY-MM-DD". Day first, as the notices
 * write it: "10/09/26" is 10 September 2026. "14TH August" has no year and
 * gives null; the text itself is still kept.
 */
export function parseNoticeDate(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/.exec(value);
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return isoDate(year, Number(match[2]), Number(match[1]));
  }
  match = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?,?\s+(\d{4})/i.exec(value);
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    if (month) return isoDate(Number(match[3]), month, Number(match[1]));
  }
  match = /([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(value);
  if (match) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
    if (month) return isoDate(Number(match[3]), month, Number(match[2]));
  }
  return null;
}

export async function parseBlackDotNotice(buffer, filename) {
  const rows = await readSheetGrid(buffer, filename, { allowDocx: true });
  if (!rows.length) throw new ApiError('That notice appears to be empty.', 400);

  let columns = null;
  let currentCase = null;
  const caseDates = new Map();
  const cases = new Map();
  const records = [];

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];

    // A header row: the registration number plus at least one other
    // column the notice has. Each case's table repeats it.
    if (row.some(isRegistrationHeader)) {
      const mapped = Object.create(null);
      row.forEach((cell, c) => {
        const field = matchColumn(cell, BLACK_DOT_COLUMNS);
        if (field && mapped[field] == null) mapped[field] = c;
      });
      if (Object.keys(mapped).length >= 2) {
        columns = mapped;
        continue;
      }
    }

    // One piece of text across the whole row is a merged cell: the case
    // line, or a note between tables that is not about any one student.
    const filled = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);
    const distinct = [...new Set(filled)];
    if (distinct.length === 1) {
      const parsed = parseCaseLine(distinct[0]);
      if (parsed) {
        currentCase = parsed;
        continue;
      }
      if (filled.length > 1) continue;
    }

    if (!columns) continue;

    const get = (field) => cellAt(row, columns[field]);
    const identifier = get('identifier').replace(/\s+/g, '');
    const fields = {
      name: oneLine(get('name')),
      incident: oneLine(get('incident')),
      hostel_block: oneLine(get('hostel_block')),
      room_no: oneLine(get('room_no')),
      // "B Tech ECE" / "Sec- F1" on two lines of one cell.
      course_branch: get('course_branch').split('\n').map((part) => part.trim()).filter(Boolean).join(', '),
      mobile_no: oneLine(get('mobile_no')),
      previous_record: oneLine(get('previous_record'))
    };
    const columnCase = oneLine(get('case_number'));
    if (!identifier && !columnCase && !Object.values(fields).some(Boolean)) continue;

    // A Case No column wins over the case line above the table.
    let caseNumber;
    let caseDetails;
    if (columnCase) {
      const parsed = parseCaseLine(columnCase) ?? splitCase(columnCase);
      caseNumber = parsed.number;
      caseDetails = oneLine(get('case_details')) || parsed.details;
    } else {
      caseNumber = currentCase?.number ?? '';
      caseDetails = oneLine(get('case_details')) || currentCase?.details || '';
    }

    const caseKey = caseNumber.toLowerCase();
    let incidentText = fields.incident;
    if (incidentText && caseKey) caseDates.set(caseKey, incidentText);
    else if (!incidentText && caseKey) incidentText = caseDates.get(caseKey) ?? '';

    const serial = oneLine(get('serial'));
    records.push({
      row: r + 1,
      // Word tables have no row numbers, so errors point at the case and S/No.
      where: [caseNumber && `Case ${caseNumber}`, serial && `S/No ${serial}`].filter(Boolean).join(' · '),
      identifier,
      name: fields.name,
      case_number: caseNumber,
      case_details: caseDetails,
      incident_date: parseNoticeDate(incidentText) ?? '',
      incident_date_text: incidentText,
      hostel_block: fields.hostel_block,
      room_no: fields.room_no,
      course_branch: fields.course_branch,
      mobile_no: fields.mobile_no,
      previous_record: fields.previous_record
    });

    if (caseKey) {
      const entry = cases.get(caseKey) ?? { case_number: caseNumber, case_details: caseDetails, students: 0 };
      entry.students += 1;
      cases.set(caseKey, entry);
    }
  }

  if (!columns) {
    throw new ApiError(
      'Could not find the student table in the notice. It needs a header row with "Regn No" (or "Registration No") and columns such as Name and Date of Incidence.',
      400
    );
  }
  if (!records.length) throw new ApiError('The notice has a table header but no student rows.', 400);
  if (records.length > MAX_ROWS) {
    throw new ApiError(`Too many rows (${records.length}). Split the file into batches of ${MAX_ROWS}.`, 400);
  }

  return { meta: { cases: [...cases.values()] }, records };
}
