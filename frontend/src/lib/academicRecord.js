/**
 * academicRecord.js
 * The arithmetic behind the Academic Performance Overview (the student's
 * Academics page and the mentor's / HOD's student page), kept apart from
 * the markup so it can be tested without a browser.
 *
 * Every function takes the rows as the pages already have them:
 *   attendance    student_attendance_overview rows (latest period per course)
 *   semesterGpas  [{ semester, gpa, earned_credits, source }]
 *   backlogs      [{ subject_code, subject_name, semester, grade, is_cleared, ... }]
 *   blackDots     [{ case_number, incident_date, incident_date_text, ... }]
 */

/** Below this, a subject's attendance is short (and the at-risk rule counts it). */
export const ATTENDANCE_TARGET = 75;
/** A latest-semester GPA below this is one of the three at-risk conditions. */
export const GPA_AT_RISK_BELOW = 6;
export const MAX_SEMESTER = 8;

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };

const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_SEMESTER;
const toNumber = (value) => (value == null || value === '' ? null : Number(value));

function semesterFromToken(token) {
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token);
    return inRange(n) ? n : null;
  }
  return ROMAN[token.toUpperCase()] ?? null;
}

/**
 * "3rd Semester", "Semester 3", "Sem III", "V Sem", "3" -> the number.
 * The label is typed by hand or comes from a roster sheet, so only a
 * number sitting next to "sem"/"semester" (or standing alone) counts.
 * Anything else gives null — including a year ("2nd Year"), which does
 * not say which half of it.
 */
export function parseSemesterNumber(label) {
  if (label == null) return null;
  const text = String(label).trim();
  if (!text || /\b(year|yr)\b/i.test(text)) return null;

  const match =
    text.match(/\bsem(?:ester)?\.?\s*[-:#]?\s*(\d{1,2}|[ivx]{1,4})\b/i) ??
    text.match(/\b(\d{1,2}|[ivx]{1,4})(?:st|nd|rd|th)?\s*-?\s*sem(?:ester)?\b/i) ??
    text.match(/^(\d{1,2}|[ivx]{1,4})(?:st|nd|rd|th)?$/i);
  return match ? semesterFromToken(match[1]) : null;
}

/**
 * The semester the student is in now: the one on their profile, or else
 * the one after their last graded semester. Null when nothing says.
 */
export function resolveCurrentSemester(semesterLabel, semesterGpas = []) {
  const fromLabel = parseSemesterNumber(semesterLabel);
  if (fromLabel) return fromLabel;
  const graded = semesterGpas.map((row) => Number(row.semester)).filter(inRange);
  return graded.length ? Math.min(Math.max(...graded) + 1, MAX_SEMESTER) : null;
}

/**
 * The semester picker. "current" is the live view (this semester's
 * attendance, every open backlog); a number looks back at that semester.
 * Past semesters are offered even with no data, so "nothing recorded for
 * Sem 1" is something you can see rather than guess.
 */
export function semesterChoices({ currentSemester, semesterGpas = [], backlogs = [] }) {
  const withData = [...semesterGpas, ...backlogs].map((row) => Number(row.semester)).filter(inRange);
  const before = currentSemester ? Array.from({ length: currentSemester - 1 }, (_, i) => i + 1) : [];
  const past = [...new Set([...before, ...withData])].filter((n) => n !== currentSemester).sort((a, b) => a - b);

  const current = {
    value: 'current',
    label: currentSemester ? `Sem ${currentSemester} (Current)` : 'Current semester',
    semester: currentSemester
  };
  const earlier = past.filter((n) => !currentSemester || n < currentSemester);
  const later = past.filter((n) => currentSemester && n > currentSemester);
  const option = (n) => ({ value: String(n), label: `Sem ${n}`, semester: n });

  return currentSemester
    ? [...earlier.map(option), current, ...later.map(option)]
    : [current, ...earlier.map(option)];
}

/**
 * One decimal, but never rounded up across the target: 74.96 is shown as
 * 74.9, because a subject flagged as short must not read "75.0%".
 */
export function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const raw = Number(value);
  let shown = Math.round(raw * 10) / 10;
  if (raw < ATTENDANCE_TARGET && shown >= ATTENDANCE_TARGET) shown = Math.floor(raw * 10) / 10;
  return `${Number.isInteger(shown) ? shown : shown.toFixed(1)}%`;
}

export function formatGpa(value) {
  const n = toNumber(value);
  return n == null || Number.isNaN(n) ? '—' : n.toFixed(2);
}

/**
 * Overall attendance is the mean of the per-subject percentages — the
 * same figure evaluate_student_risk() uses, so this page and the At-Risk
 * list can never disagree.
 */
export function summariseAttendance(rows = []) {
  const courses = rows.filter((row) => row.attendance_percent != null);
  if (!courses.length) return null;

  const percents = courses.map((row) => Number(row.attendance_percent));
  const average = percents.reduce((sum, value) => sum + value, 0) / percents.length;
  const periodEnds = courses.map((row) => row.period_end).filter(Boolean).sort();

  return {
    average,
    subjects: courses.length,
    below: percents.filter((value) => value < ATTENDANCE_TARGET).length,
    asOf: periodEnds.length ? periodEnds[periodEnds.length - 1] : null
  };
}

/** Semester GPAs as numbers, oldest first, one per semester. */
export function gradedSemesters(semesterGpas = []) {
  const bySemester = new Map();
  for (const row of semesterGpas) {
    const semester = Number(row.semester);
    const gpa = toNumber(row.gpa);
    if (inRange(semester) && gpa != null && !Number.isNaN(gpa)) bySemester.set(semester, { ...row, semester, gpa });
  }
  return [...bySemester.values()].sort((a, b) => a.semester - b.semester);
}

/**
 * The GPA card for a view. For the live view that is the latest graded
 * semester; for a past one, that semester. Either way the change is
 * measured against the graded semester before it.
 */
export function gpaForView(semesterGpas, semester) {
  const graded = gradedSemesters(semesterGpas);
  if (!graded.length) return { entry: null, previous: null, change: null };

  const entry = semester == null
    ? graded[graded.length - 1]
    : graded.find((row) => row.semester === semester) ?? null;
  if (!entry) return { entry: null, previous: null, change: null };

  const earlier = graded.filter((row) => row.semester < entry.semester);
  const previous = earlier.length ? earlier[earlier.length - 1] : null;
  const change = previous ? Math.round((entry.gpa - previous.gpa) * 100) / 100 : null;
  return { entry, previous, change };
}

/**
 * The trend line's points: every semester up to the later of the current
 * one and the last graded one. A semester with no GPA gets no point (the
 * line breaks there) instead of a made-up value.
 */
export function gpaTrendPoints(semesterGpas, currentSemester) {
  const graded = gradedSemesters(semesterGpas);
  const last = Math.max(currentSemester ?? 0, ...graded.map((row) => row.semester), 0);
  const bySemester = new Map(graded.map((row) => [row.semester, row]));
  return Array.from({ length: last }, (_, i) => {
    const row = bySemester.get(i + 1);
    return {
      semester: i + 1,
      label: `Sem ${i + 1}`,
      gpa: row ? row.gpa : null,
      source: row?.source ?? null,
      earnedCredits: row?.earned_credits ?? null
    };
  });
}

/**
 * Backlogs for a view. The live view is every backlog, open ones first;
 * a past semester is only the subjects recorded against it.
 */
export function backlogsForView(backlogs = [], semester) {
  const rows = semester == null ? backlogs : backlogs.filter((row) => Number(row.semester) === semester);
  const sorted = [...rows].sort(
    (a, b) =>
      Number(a.is_cleared) - Number(b.is_cleared) ||
      (Number(b.semester) || 0) - (Number(a.semester) || 0) ||
      String(a.subject_code).localeCompare(String(b.subject_code))
  );
  const open = sorted.filter((row) => !row.is_cleared);
  const openSemesters = [...new Set(open.map((row) => Number(row.semester)).filter(inRange))].sort((a, b) => a - b);
  return { rows: sorted, open: open.length, cleared: sorted.length - open.length, openSemesters };
}

/** Most recent incident first; a notice without a full date sorts last. */
export function sortBlackDots(blackDots = []) {
  return [...blackDots].sort((a, b) => {
    const left = a.incident_date ?? '';
    const right = b.incident_date ?? '';
    if (left !== right) return left < right ? 1 : -1;
    return String(b.recorded_at ?? '').localeCompare(String(a.recorded_at ?? ''));
  });
}

/** "Sem 1, 2 and 4" */
export function listSemesters(numbers) {
  if (!numbers.length) return '';
  if (numbers.length === 1) return `Sem ${numbers[0]}`;
  return `Sem ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}
