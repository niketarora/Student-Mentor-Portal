/**
 * academicCycles.js
 * Naming and date arithmetic for academic cycles (migration 0036).
 *
 * A cycle is one academic year ("2026-27" in the database, shown as
 * "2026–27") with two semesters: the odd semester, from starts_on, and the
 * even semester, from even_starts_on to ends_on. They are called "Odd
 * semester 2026" and "Even semester 2027" so they can never be mistaken
 * for a student's programme semester (1 to 8).
 */

export const SEMESTERS = ['Odd', 'Even'];

export const SEMESTER_NAMES = { Odd: 'Odd semester', Even: 'Even semester' };

/** "2026-27" -> "2026–27" (an en dash, as the year range is written). */
export function cycleLabel(label) {
  return label ? String(label).replace('-', '–') : '—';
}

/** The calendar year a semester falls in: odd = the first year, even = the second. */
export function semesterYear(cycle, semester) {
  if (!cycle?.start_year) return null;
  return semester === 'Even' ? Number(cycle.start_year) + 1 : Number(cycle.start_year);
}

/** "Odd semester 2026" */
export function semesterTitle(cycle, semester) {
  const year = semesterYear(cycle, semester);
  return `${SEMESTER_NAMES[semester] ?? semester}${year ? ` ${year}` : ''}`;
}

/** Adds days to an ISO date without letting the time zone move it. */
function shiftDate(iso, days) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** The dates a semester covers: odd runs until the day before the even one starts. */
export function semesterRange(cycle, semester) {
  if (!cycle) return { from: null, to: null };
  return semester === 'Even'
    ? { from: cycle.even_starts_on, to: cycle.ends_on }
    : { from: cycle.starts_on, to: shiftDate(cycle.even_starts_on, -1) };
}

/** Today in India, as YYYY-MM-DD — the date the portal's users live by. */
export function todayInIndia(now = new Date()) {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** Which semester a date is in, by the cycle's even_starts_on. */
export function semesterOn(cycle, isoDate) {
  if (!cycle?.even_starts_on || !isoDate) return null;
  return String(isoDate).slice(0, 10) >= String(cycle.even_starts_on).slice(0, 10) ? 'Even' : 'Odd';
}

/** The academic year a date is in: July starts a new one. */
export function academicYearOf(isoDate) {
  const [y, m] = String(isoDate).slice(0, 10).split('-').map(Number);
  return m >= 7 ? y : y - 1;
}

/** The dates a new cycle starts with; every one can be changed. */
export function defaultCycleDates(startYear) {
  const y = Number(startYear);
  return {
    starts_on: `${y}-07-01`,
    even_starts_on: `${y + 1}-01-01`,
    ends_on: `${y + 1}-06-30`
  };
}

/** "2027-28" for 2027, the way the database labels it. */
export function labelForYear(startYear) {
  const y = Number(startYear);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/** The year the next cycle should start in: after the latest one. */
export function nextCycleYear(cycles, today = todayInIndia()) {
  const latest = Math.max(0, ...cycles.map((cycle) => Number(cycle.start_year) || 0));
  return latest ? latest + 1 : academicYearOf(today);
}

/**
 * What one upload covered, for the upload lists. The upload functions
 * write it for GPA, backlogs and black dots ("Semesters 1, 2 + CGPA",
 * "2 cases"); attendance is its subject and section ("IT2101 · Section A").
 */
export function uploadScope(row) {
  if (row?.scope_label) return row.scope_label;
  if (row?.upload_type === 'attendance') {
    return [row.course_code, row.section_label ? `Section ${row.section_label}` : null].filter(Boolean).join(' · ') || '—';
  }
  return row?.semester_number ? `Semester ${row.semester_number}` : '—';
}

/** Same checks as create_academic_cycle / update_academic_cycle_dates. */
export function validateCycleDates(startYear, { starts_on: start, even_starts_on: even, ends_on: end }) {
  if (!start || !even || !end) return 'Fill in all three dates.';
  if (!(start < even && even <= end)) {
    return 'The dates are out of order: the odd semester starts, then the even semester, then the cycle ends.';
  }
  const y = Number(startYear);
  if (start < `${y - 1}-01-01` || end >= `${y + 2}-01-01`) {
    return `The dates have to fall around ${cycleLabel(labelForYear(y))}.`;
  }
  return null;
}
