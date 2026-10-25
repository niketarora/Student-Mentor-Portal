/**
 * AcademicOverview — the "Academic performance overview" block.
 *
 * One student's attendance per subject, GPA, backlogs (with their
 * subjects) and black dots, laid out as four headline tiles, a
 * subject-wise attendance chart with its table, a GPA trend, and the
 * backlog and black dot records.
 *
 * Mounted on three screens, so change it once and check all three:
 *   /student/academics        the student's own record (audience="student")
 *   /faculty/mentees/:id      the mentor's student page
 *   /hod/students/:id         the HOD's student page (same page as above)
 *
 * The pages fetch; this component only arranges. Its arithmetic lives in
 * lib/academicRecord.js so it can be tested without a browser.
 *
 * THE HEADER AND THE SEMESTER PICKER
 * The block brings its own header: the "Academic performance overview"
 * heading, a one-line description and the semester picker. The student's
 * Academics page passes showHeader={false} and uses the heading as its
 * page title instead, so the student gets no picker and always sees the
 * current semester. The mentor and the HOD keep the picker.
 *
 * "Sem N (Current)" is the live view: attendance from the latest uploads,
 * the latest graded GPA, every open backlog. Picking an earlier semester
 * shows that semester's GPA and the backlogs recorded against it.
 * Attendance is not tied to a semester in the portal (it is the latest
 * reporting period per subject), so it is only shown for the current one,
 * and black dots are always the whole record.
 *
 * COLOUR
 * Attendance bars are blue at or above the 75% target and red below it,
 * with a legend and the percentage printed on each bar, so the colour is
 * never the only signal. The pair was run through the dataviz palette
 * validator (colour-blind separation and contrast on white). The GPA line
 * is the portal's brand orange; it is the only series on its chart.
 */

import { useId, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import Modal from '../ui/Modal.jsx';
import { formatDate } from '../../lib/formatters.js';
import {
  ATTENDANCE_TARGET, GPA_AT_RISK_BELOW, backlogsForView, formatGpa, formatPercent, gpaForView,
  gpaTrendPoints, gradedSemesters, listSemesters, resolveCurrentSemester, semesterChoices,
  sortBlackDots, summariseAttendance
} from '../../lib/academicRecord.js';

const ON_TRACK = '#2a78d6';
const BELOW_TARGET = '#e34948';
const GPA_LINE = '#c2410c';
const INK = '#44403c';
const INK_SOFT = '#57534e';
const MUTED = '#a8a29e';
const GRIDLINE = '#f0e4dc';
const BASELINE = '#e7ddd6';

const PREVIEW_ROWS = 5;

/** The line under the heading; the student's page uses it as its subtitle. */
export const OVERVIEW_DESCRIPTION = 'Attendance per subject, GPA, backlogs with their subjects, and black dots.';

const CHIP_TONES = {
  info: 'bg-info-container text-info',
  primary: 'bg-primary-fixed text-primary',
  error: 'bg-error-container text-error',
  ink: 'bg-inverse-surface text-inverse-on-surface'
};

const NOTE_TONES = {
  success: { icon: 'check_circle', className: 'text-on-success-container' },
  error: { icon: 'error', className: 'text-on-error-container' },
  warning: { icon: 'warning', className: 'text-on-warning-container' },
  up: { icon: 'trending_up', className: 'text-on-success-container' },
  down: { icon: 'trending_down', className: 'text-on-error-container' },
  flat: { icon: 'trending_flat', className: 'text-on-surface-variant' },
  neutral: { icon: 'event', className: 'text-on-surface-variant' },
  muted: { icon: null, className: 'text-tertiary' }
};

const COPY = {
  student: {
    subject: 'you',
    attendanceEmpty: 'Your attendance appears here as soon as the department uploads it.',
    gpaEmpty: 'Your GPA appears here once the department publishes it.',
    backlogsEmpty: 'No result uploaded so far lists you with a backlog.',
    blackDotsEmpty: 'No Proctorial Board notice uploaded so far lists you.',
    selfReported: 'You'
  },
  staff: {
    subject: 'this student',
    attendanceEmpty: 'Nothing has been uploaded for this student yet.',
    gpaEmpty: 'No GPA has been published for this student yet.',
    backlogsEmpty: 'No Defaulter Grade result uploaded so far lists this student.',
    blackDotsEmpty: 'No Proctorial Board notice uploaded so far lists this student.',
    selfReported: 'Self-reported'
  }
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function alignClass(align) {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

function incidentDate(dot) {
  if (dot.incident_date) return formatDate(dot.incident_date);
  return dot.incident_date_text || '—';
}

/** The same date over two short lines ("10 Sept" / "2026") for a narrow column. */
function IncidentDate({ dot }) {
  // A calendar date: build it locally so no time zone can shift the day.
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(dot.incident_date ?? '');
  const date = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
  if (!date || Number.isNaN(date.getTime())) return <span>{dot.incident_date_text || '—'}</span>;
  return (
    <span className="block whitespace-nowrap">
      {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
      <span className="block text-label-sm text-tertiary">{date.getFullYear()}</span>
    </span>
  );
}

/* ── Building blocks ─────────────────────────────────────────────────── */

function KpiTile({ icon, tone, label, value, note, footnote }) {
  const noteTone = note ? NOTE_TONES[note.tone] ?? NOTE_TONES.muted : null;
  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label-sm uppercase tracking-wide text-on-surface-variant">{label}</p>
          <p className="mt-2 text-headline-md leading-none text-on-surface">{value}</p>
        </div>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${CHIP_TONES[tone]}`}>
          <span className="material-symbols-outlined text-[22px]" aria-hidden="true">{icon}</span>
        </span>
      </div>
      {note && (
        <p className={`mt-3 flex items-start gap-1 text-label-sm ${noteTone.className}`}>
          {noteTone.icon && (
            <span className="material-symbols-outlined text-[16px] leading-4" aria-hidden="true">
              {noteTone.icon}
            </span>
          )}
          <span>{note.text}</span>
        </p>
      )}
      {footnote && <p className="mt-1 text-label-sm text-tertiary">{footnote}</p>}
    </div>
  );
}

const HEADER_TONES = {
  plain: 'bg-surface-container-lowest',
  danger: 'bg-error-container/45',
  muted: 'bg-surface-container-high/60'
};

function OverviewCard({ icon, iconClassName = 'text-primary', title, count, subtitle, tone = 'plain', actions, className = '', children }) {
  return (
    <section className={`panel flex min-w-0 flex-col ${className}`}>
      <header className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-topbar-border px-5 py-3.5 ${HEADER_TONES[tone]}`}>
        <span className={`material-symbols-outlined text-[20px] ${iconClassName}`} aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-label-md text-on-surface">
            {title}
            {count != null && <span className="ml-1 font-normal text-on-surface-variant">({count})</span>}
          </h3>
          {subtitle && <p className="text-label-sm font-normal text-tertiary">{subtitle}</p>}
        </div>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div>}
      </header>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function CardEmpty({ icon, title, description, tone = 'neutral' }) {
  const chip = tone === 'good' ? 'bg-success-container text-on-success-container' : 'bg-surface-container text-tertiary';
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${chip}`}>
        <span className="material-symbols-outlined text-[24px]" aria-hidden="true">{icon}</span>
      </span>
      <p className="mt-3 text-label-md text-on-surface">{title}</p>
      {description && <p className="mt-1 max-w-sm text-body-sm text-on-surface-variant">{description}</p>}
    </div>
  );
}

function ViewAllButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded text-label-md text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      View all
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
    </button>
  );
}

/** Compact table for the cards: tighter cells than DataTable, same look. */
function CompactTable({ columns, rows, rowKey, isHighlighted, caption }) {
  return (
    <div className="custom-scrollbar overflow-x-auto">
      <table className="w-full border-collapse text-body-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`${column.wrapHeader ? '' : 'whitespace-nowrap'} border-b border-topbar-border bg-surface-container-low px-2.5 py-2.5 text-label-sm uppercase tracking-wide text-on-surface-variant first:pl-5 last:pr-5 ${alignClass(column.align)}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {rows.map((row, index) => (
            <tr
              key={rowKey(row)}
              className={isHighlighted?.(row) ? 'bg-primary-fixed/50' : 'hover:bg-surface-container-low/70'}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`border-b border-surface-container px-2.5 py-2.5 align-middle first:pl-5 last:pr-5 ${alignClass(column.align)} ${column.className ?? ''}`}
                >
                  {column.render ? column.render(row, index) : (row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartTip({ children }) {
  return (
    <div className="max-w-[16rem] rounded-xl border border-topbar-border bg-surface-container-lowest px-3 py-2 text-label-sm text-on-surface-variant shadow-dropdown">
      {children}
    </div>
  );
}

function Swatch({ color, dashed }) {
  return dashed ? (
    <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: color }} />
  ) : (
    <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
  );
}

function Legend({ items }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label-sm text-on-surface-variant">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} dashed={item.dashed} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A value printed above a bar or a point. The white halo (a stroke painted
 * under the fill) keeps it legible where the dashed reference line runs
 * behind it. Recharts hands a bar its box and a point its position, both
 * as the label's viewBox.
 */
function ValueLabel({ viewBox, value, format, gap = 7 }) {
  if (value == null || !viewBox) return null;
  const { x, y, width = 0 } = viewBox;
  if (x == null || y == null) return null;
  return (
    <text
      x={x + width / 2}
      y={y - gap}
      textAnchor="middle"
      fill={INK}
      fontSize={11}
      fontWeight={600}
      stroke="#ffffff"
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {format(value)}
    </text>
  );
}

/* ── Attendance ──────────────────────────────────────────────────────── */

function AttendanceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const subject = payload[0].payload;
  const short = subject.percent < ATTENDANCE_TARGET;
  return (
    <ChartTip>
      <p className="text-label-md text-on-surface">{subject.code}</p>
      {subject.name && <p className="mb-1">{subject.name}</p>}
      <p className="flex items-center gap-1.5 text-on-surface">
        <Swatch color={short ? BELOW_TARGET : ON_TRACK} />
        {formatPercent(subject.percent)} · {subject.attended} of {subject.held} classes
      </p>
      <p className="mt-0.5">{short ? `Below the ${ATTENDANCE_TARGET}% target` : 'At or above the target'}</p>
      {subject.periodStart && (
        <p className="mt-0.5 text-tertiary">
          {formatDate(subject.periodStart)} – {formatDate(subject.periodEnd)}
        </p>
      )}
    </ChartTip>
  );
}

function AttendanceChart({ rows }) {
  const data = rows.map((row) => ({
    key: row.course_id ?? row.course_code,
    code: row.course_code,
    name: row.course_name,
    percent: Number(row.attendance_percent),
    attended: row.classes_attended,
    held: row.classes_held,
    periodStart: row.period_start,
    periodEnd: row.period_end
  }));
  const crowded = data.length > 7;
  const description = data.map((d) => `${d.code} ${formatPercent(d.percent)}`).join(', ');

  return (
    <div role="img" aria-label={`Attendance by subject against the ${ATTENDANCE_TARGET}% target: ${description}`} className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke={GRIDLINE} />
          <XAxis
            dataKey="code"
            interval={0}
            tickLine={false}
            axisLine={{ stroke: BASELINE }}
            tick={{ fontSize: 11, fill: INK_SOFT }}
            {...(crowded ? { angle: -35, textAnchor: 'end', height: 52 } : {})}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(value) => `${value}%`}
            tickLine={false}
            axisLine={false}
            width={40}
            tick={{ fontSize: 11, fill: MUTED }}
          />
          <Tooltip content={<AttendanceTooltip />} cursor={{ fill: 'rgba(28,25,23,0.04)' }} />
          <ReferenceLine y={ATTENDANCE_TARGET} stroke={INK_SOFT} strokeWidth={1.5} strokeDasharray="5 4" />
          <Bar dataKey="percent" radius={[4, 4, 0, 0]} maxBarSize={32}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.percent < ATTENDANCE_TARGET ? BELOW_TARGET : ON_TRACK} />
            ))}
            <LabelList dataKey="percent" content={<ValueLabel format={formatPercent} />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AttendanceMeter({ percent }) {
  const short = percent < ATTENDANCE_TARGET;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden="true" className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-surface-container-high sm:inline-block">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: short ? BELOW_TARGET : ON_TRACK }}
        />
      </span>
      <span className="tabular-nums text-on-surface">{formatPercent(percent)}</span>
      {short && <span className="sr-only">(below the {ATTENDANCE_TARGET}% target)</span>}
    </span>
  );
}

/* ── GPA ─────────────────────────────────────────────────────────────── */

function GpaTooltip({ active, payload, selfReported }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <ChartTip>
      <p className="text-label-md text-on-surface">Semester {point.semester}</p>
      {point.gpa == null ? (
        <p>No GPA recorded</p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-on-surface">
            <Swatch color={GPA_LINE} />
            GPA {formatGpa(point.gpa)}
          </p>
          {point.earnedCredits != null && <p>{Number(point.earnedCredits)} credits earned</p>}
          <p>{point.source === 'cluster_head' ? 'Published by the department' : `Recorded by: ${selfReported}`}</p>
          {point.gpa < GPA_AT_RISK_BELOW && <p className="mt-0.5">Below the at-risk line of {GPA_AT_RISK_BELOW}</p>}
        </>
      )}
    </ChartTip>
  );
}

function GpaTrendChart({ points, highlight, selfReported }) {
  const graded = points.filter((point) => point.gpa != null);
  const description = graded.map((point) => `${point.label} ${formatGpa(point.gpa)}`).join(', ');

  const renderDot = (props) => {
    const { cx, cy, payload, key } = props;
    if (payload?.gpa == null || cx == null || cy == null) return <g key={key} />;
    const selected = payload.semester === highlight;
    return <circle key={key} cx={cx} cy={cy} r={selected ? 6.5 : 4.5} fill={GPA_LINE} stroke="#ffffff" strokeWidth={2} />;
  };

  return (
    <div role="img" aria-label={`GPA by semester: ${description}`} className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 24, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRIDLINE} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: BASELINE }}
            tick={{ fontSize: 11, fill: INK_SOFT }}
            padding={{ left: 14, right: 14 }}
            interval={0}
          />
          <YAxis
            domain={[0, 10]}
            ticks={[0, 2, 4, 6, 8, 10]}
            tickLine={false}
            axisLine={false}
            width={36}
            tick={{ fontSize: 11, fill: MUTED }}
          />
          <Tooltip content={<GpaTooltip selfReported={selfReported} />} cursor={{ stroke: BASELINE, strokeWidth: 1 }} />
          <ReferenceLine y={GPA_AT_RISK_BELOW} stroke={INK_SOFT} strokeWidth={1.5} strokeDasharray="5 4" />
          <Area
            type="linear"
            dataKey="gpa"
            stroke={GPA_LINE}
            strokeWidth={2}
            fill={GPA_LINE}
            fillOpacity={0.1}
            connectNulls={false}
            dot={renderDot}
            activeDot={{ r: 6.5, fill: GPA_LINE, stroke: '#ffffff', strokeWidth: 2 }}
          >
            <LabelList dataKey="gpa" content={<ValueLabel format={formatGpa} gap={11} />} />
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── The overview ────────────────────────────────────────────────────── */

export default function AcademicOverview({
  attendance = [],
  semesterGpas = [],
  cgpa = null,
  gpaHidden = false,
  backlogs = [],
  blackDots = [],
  semesterLabel = null,
  audience = 'staff',
  showHeader = true,
  className = ''
}) {
  const headingId = useId();
  const copy = COPY[audience] ?? COPY.staff;
  const gpas = useMemo(() => (gpaHidden ? [] : semesterGpas), [gpaHidden, semesterGpas]);

  const currentSemester = useMemo(() => resolveCurrentSemester(semesterLabel, gpas), [semesterLabel, gpas]);
  const choices = useMemo(
    () => semesterChoices({ currentSemester, semesterGpas: gpas, backlogs }),
    [currentSemester, gpas, backlogs]
  );
  const [selected, setSelected] = useState('current');
  // Without the header there is no picker, so the view stays on the
  // current semester.
  const choice =
    (showHeader ? choices.find((option) => option.value === selected) : null) ??
    choices.find((option) => option.value === 'current');
  const isCurrent = choice.value === 'current';
  const viewSemester = isCurrent ? null : choice.semester;

  const [dialog, setDialog] = useState(null);

  const attendanceSummary = useMemo(() => summariseAttendance(attendance), [attendance]);
  const gpaView = useMemo(() => gpaForView(gpas, viewSemester), [gpas, viewSemester]);
  const trendPoints = useMemo(() => gpaTrendPoints(gpas, currentSemester), [gpas, currentSemester]);
  const gradedRows = useMemo(() => gradedSemesters(gpas), [gpas]);
  const backlogView = useMemo(() => backlogsForView(backlogs, viewSemester), [backlogs, viewSemester]);
  const dots = useMemo(() => sortBlackDots(blackDots), [blackDots]);

  const cgpaFootnote = cgpa?.value != null ? `CGPA ${formatGpa(cgpa.value)}${cgpa.official ? '' : ' (average)'}` : null;

  // Under the GPA trend: the CGPA, the credits behind it and the best
  // semester. Credits come from the official total when there is one, or
  // add up the semesters' earned credits from the same export.
  const gpaSummary = (() => {
    if (!gradedRows.length) return null;
    const semesterCredits = gradedRows.map((row) => row.earned_credits).filter((value) => value != null);
    const credits = cgpa?.earnedCredits ?? (semesterCredits.length ? semesterCredits.reduce((sum, value) => sum + Number(value), 0) : null);
    const best = gradedRows.reduce((top, row) => (row.gpa > top.gpa ? row : top), gradedRows[0]);
    return [
      ['CGPA', cgpa?.value != null ? formatGpa(cgpa.value) : '—', cgpa?.value != null ? (cgpa.official ? 'Official' : 'Average of semesters') : 'Not published yet'],
      ['Credits', credits != null ? String(Number(credits)) : '—', credits != null ? 'Earned' : 'Not in the uploads'],
      ['Highest', formatGpa(best.gpa), `Sem ${best.semester}`]
    ];
  })();

  /* ── Headline tiles ──────────────────────────────────────────────── */

  const attendanceTile = (() => {
    if (!isCurrent) {
      return { value: '—', note: { tone: 'muted', text: 'Shown for the current semester only' } };
    }
    if (!attendanceSummary) {
      return { value: '—', note: { tone: 'muted', text: 'Not uploaded yet' } };
    }
    const { average, subjects, below, asOf } = attendanceSummary;
    let note;
    if (average < ATTENDANCE_TARGET) note = { tone: 'error', text: `Below the ${ATTENDANCE_TARGET}% target overall` };
    else if (below) note = { tone: 'warning', text: `Below ${ATTENDANCE_TARGET}% in ${plural(below, 'subject')}` };
    else note = { tone: 'success', text: `${ATTENDANCE_TARGET}% or more in all ${plural(subjects, 'subject')}` };
    return {
      value: formatPercent(average),
      note,
      footnote: `${plural(subjects, 'subject')}${asOf ? ` · as of ${formatDate(asOf)}` : ''}`
    };
  })();

  const gpaTile = (() => {
    const label = isCurrent ? 'Current GPA' : `GPA · Sem ${viewSemester}`;
    if (gpaHidden) return { label, value: 'Not shared', note: { tone: 'muted', text: 'GPA sharing is turned off' } };
    const { entry, previous, change } = gpaView;
    if (!entry) {
      return {
        label,
        value: '—',
        note: { tone: 'muted', text: isCurrent ? 'No GPA recorded yet' : `No GPA recorded for Sem ${viewSemester}` },
        footnote: cgpaFootnote
      };
    }
    let note;
    if (!previous) note = { tone: 'muted', text: 'First graded semester' };
    else if (change > 0) note = { tone: 'up', text: `Up ${change.toFixed(2)} from Sem ${previous.semester}` };
    else if (change < 0) note = { tone: 'down', text: `Down ${Math.abs(change).toFixed(2)} from Sem ${previous.semester}` };
    else note = { tone: 'flat', text: `Same as Sem ${previous.semester}` };
    return {
      label,
      value: formatGpa(entry.gpa),
      note,
      footnote: [isCurrent ? `Sem ${entry.semester} result` : null, cgpaFootnote].filter(Boolean).join(' · ') || null
    };
  })();

  const backlogTile = (() => {
    const { rows, open, cleared, openSemesters } = backlogView;
    if (isCurrent) {
      let note;
      if (open) note = { tone: 'error', text: openSemesters.length ? `Open from ${listSemesters(openSemesters)}` : 'Still open' };
      else if (cleared) note = { tone: 'success', text: `None open · ${cleared} cleared` };
      else note = { tone: 'success', text: 'None on record' };
      return { label: 'Open backlogs', value: String(open), note };
    }
    let note;
    if (open) note = { tone: 'error', text: `${open} still open` };
    else if (rows.length) note = { tone: 'success', text: 'All cleared' };
    else note = { tone: 'success', text: 'None in this semester' };
    return { label: `Backlogs · Sem ${viewSemester}`, value: String(rows.length), note };
  })();

  const blackDotTile = {
    value: String(dots.length),
    note: dots.length
      ? { tone: 'neutral', text: `Latest: ${incidentDate(dots[0])}` }
      : { tone: 'success', text: 'None on record' },
    footnote: isCurrent ? null : 'The whole record, not just this semester'
  };

  /* ── Tables ──────────────────────────────────────────────────────── */

  const attendanceColumns = [
    {
      key: 'course_code',
      header: 'Subject',
      render: (row) => (
        <span className="block min-w-[9rem]">
          <span className="block text-label-md text-on-surface">{row.course_code}</span>
          <span className="block text-label-sm text-tertiary">
            {[row.course_name, row.section_label && `Sec ${row.section_label}`].filter(Boolean).join(' · ')}
          </span>
        </span>
      )
    },
    { key: 'attendance_percent', header: 'Attendance', align: 'right', render: (row) => <AttendanceMeter percent={Number(row.attendance_percent)} /> },
    { key: 'classes_attended', header: 'Attended', align: 'right', className: 'tabular-nums' },
    { key: 'classes_held', header: 'Total classes', align: 'right', className: 'tabular-nums' }
  ];

  const gpaColumns = [
    { key: 'semester', header: 'Semester', render: (row) => `Sem ${row.semester}` },
    { key: 'gpa', header: 'GPA', align: 'right', className: 'tabular-nums text-on-surface', render: (row) => formatGpa(row.gpa) },
    {
      key: 'earned_credits',
      header: 'Credits',
      align: 'right',
      className: 'tabular-nums',
      render: (row) => (row.earned_credits != null ? Number(row.earned_credits) : '—')
    },
    {
      key: 'source',
      header: 'Recorded by',
      render: (row) => (row.source === 'cluster_head' ? 'Department' : copy.selfReported)
    }
  ];

  const backlogStatus = (row) =>
    row.is_cleared ? (
      <span className="chip bg-success-container text-on-success-container">
        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
        Cleared
      </span>
    ) : (
      <span className="chip bg-error-container text-on-error-container">
        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">error</span>
        Backlog
      </span>
    );

  const backlogColumns = [
    { key: 'index', header: '#', className: 'text-tertiary tabular-nums', render: (_row, index) => index + 1 },
    { key: 'subject_code', header: 'Code', className: 'whitespace-nowrap text-label-md text-on-surface' },
    {
      key: 'subject_name',
      header: 'Subject name',
      render: (row) => <span className="block min-w-[8rem] text-on-surface-variant">{row.subject_name || '—'}</span>
    },
    { key: 'semester', header: 'Sem', align: 'center', render: (row) => row.semester ?? '—' },
    { key: 'grade', header: 'Grade', align: 'center', render: (row) => row.grade ?? '—' },
    { key: 'status', header: 'Status', render: backlogStatus }
  ];

  const blackDotColumns = [
    { key: 'index', header: '#', className: 'text-tertiary tabular-nums', render: (_row, index) => index + 1 },
    { key: 'date', header: 'Date', render: (row) => <IncidentDate dot={row} /> },
    {
      key: 'case_details',
      header: 'Reason / incident',
      render: (row) => (
        <span className="block min-w-[8rem] max-w-[22rem]">
          <span className="line-clamp-2 text-on-surface">{row.case_details || 'No details given'}</span>
          <span className="block text-label-sm text-tertiary">Case {row.case_number}</span>
        </span>
      )
    },
    {
      key: 'block',
      header: 'Block',
      className: 'whitespace-nowrap',
      render: (row) =>
        row.hostel_block || row.room_no ? (
          <span className="block">
            {row.hostel_block || '—'}
            {row.room_no && <span className="block text-label-sm text-tertiary">Room {row.room_no}</span>}
          </span>
        ) : (
          '—'
        )
    },
    {
      // The notice's "Previous Record" column. Course/branch and the rest
      // are in View all.
      key: 'previous_record',
      header: 'Previous record',
      // A long header over a short value: let the header wrap so the
      // incident column keeps the room.
      wrapHeader: true,
      render: (row) => row.previous_record || '—'
    }
  ];

  const backlogPreview = backlogView.rows.slice(0, PREVIEW_ROWS);
  const blackDotPreview = dots.slice(0, PREVIEW_ROWS);
  const moreNote = (shown, total) =>
    total > shown ? (
      <p className="border-t border-surface-container px-5 py-2.5 text-label-sm text-tertiary">
        Showing {shown} of {total}. View all for the rest.
      </p>
    ) : null;

  return (
    <section
      {...(showHeader ? { 'aria-labelledby': headingId } : { 'aria-label': 'Academic performance overview' })}
      className={className}
    >
      {showHeader && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id={headingId} className="text-headline-sm text-on-surface">Academic performance overview</h2>
            <p className="mt-0.5 text-body-sm text-on-surface-variant">{OVERVIEW_DESCRIPTION}</p>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-label-sm uppercase tracking-wide text-on-surface-variant">Semester</span>
            <select
              className="field-input w-auto min-w-[11rem] py-2"
              value={choice.value}
              onChange={(event) => setSelected(event.target.value)}
            >
              {choices.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!isCurrent && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-info-container bg-info-container/40 px-4 py-3 text-body-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-[20px] text-info" aria-hidden="true">history</span>
          <p className="min-w-0 flex-1">
            Showing <strong className="text-on-surface">Sem {viewSemester}</strong>: its GPA and the backlogs recorded
            against it. Attendance is kept for the current semester only, and black dots are the whole record.
          </p>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setSelected('current')}>
            Back to {currentSemester ? `Sem ${currentSemester}` : 'the current semester'}
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile icon="fact_check" tone="info" label="Average attendance" {...attendanceTile} />
        <KpiTile icon="school" tone="primary" {...gpaTile} />
        <KpiTile icon="assignment_late" tone="error" {...backlogTile} />
        <KpiTile icon="gavel" tone="ink" label="Black dots" {...blackDotTile} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <OverviewCard
          className="xl:col-span-7"
          icon="bar_chart"
          title="Subject-wise attendance"
          subtitle={
            isCurrent && attendanceSummary?.asOf
              ? `Latest upload, as of ${formatDate(attendanceSummary.asOf)}`
              : `Target ${ATTENDANCE_TARGET}% in every subject`
          }
          actions={
            isCurrent && attendance.length ? (
              <Legend
                items={[
                  { label: `${ATTENDANCE_TARGET}% or more`, color: ON_TRACK },
                  { label: `Below ${ATTENDANCE_TARGET}%`, color: BELOW_TARGET },
                  { label: `Target ${ATTENDANCE_TARGET}%`, color: INK_SOFT, dashed: true }
                ]}
              />
            ) : null
          }
        >
          {!isCurrent ? (
            <CardEmpty
              icon="event_busy"
              title={`No attendance for Sem ${viewSemester}`}
              description="Attendance is kept for the current semester only: each upload replaces the figures for its subjects."
            />
          ) : attendance.length === 0 ? (
            <CardEmpty icon="fact_check" title="No attendance uploaded yet" description={copy.attendanceEmpty} />
          ) : (
            <>
              <div className="px-4 pb-2 pt-4">
                <AttendanceChart rows={attendance} />
              </div>
              <CompactTable
                caption="Attendance by subject"
                columns={attendanceColumns}
                rows={attendance}
                rowKey={(row) => row.course_id ?? row.course_code}
              />
            </>
          )}
        </OverviewCard>

        <OverviewCard
          className="xl:col-span-5"
          icon="show_chart"
          title="GPA trend"
          subtitle={gpaHidden ? null : gradedRows.length ? plural(gradedRows.length, 'graded semester') : 'Semester by semester'}
          actions={
            !gpaHidden && gradedRows.length ? (
              <Legend
                items={[
                  { label: 'GPA', color: GPA_LINE },
                  { label: `At-risk below ${GPA_AT_RISK_BELOW}`, color: INK_SOFT, dashed: true }
                ]}
              />
            ) : null
          }
        >
          {gpaHidden ? (
            <CardEmpty
              icon="visibility_off"
              title="GPA not shared"
              description="This student has turned off GPA sharing. Everything else in the record is still shown."
            />
          ) : gradedRows.length === 0 ? (
            <CardEmpty icon="school" title="No GPA recorded yet" description={copy.gpaEmpty} />
          ) : (
            <>
              <div className="px-4 pb-2 pt-4">
                <GpaTrendChart points={trendPoints} highlight={viewSemester} selfReported={copy.selfReported} />
              </div>
              <CompactTable
                caption="GPA by semester"
                columns={gpaColumns}
                rows={gradedRows}
                rowKey={(row) => row.semester}
                isHighlighted={(row) => row.semester === viewSemester}
              />
              <dl className="mt-auto grid grid-cols-3 divide-x divide-surface-container border-t border-topbar-border bg-surface-container-low/60">
                {gpaSummary.map(([label, value, caption]) => (
                  <div key={label} className="min-w-0 px-4 py-3 first:pl-5">
                    <dt className="text-label-sm uppercase tracking-wide text-on-surface-variant">{label}</dt>
                    <dd className="mt-1 text-headline-sm text-on-surface">{value}</dd>
                    {caption && <dd className="text-label-sm text-tertiary">{caption}</dd>}
                  </div>
                ))}
              </dl>
            </>
          )}
        </OverviewCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <OverviewCard
          tone="danger"
          icon="assignment_late"
          iconClassName="text-error"
          title="Backlogs"
          count={isCurrent ? backlogView.open : backlogView.rows.length}
          subtitle={
            isCurrent
              ? backlogView.rows.length
                ? `${backlogView.open} open · ${backlogView.cleared} cleared`
                : 'Subjects from Defaulter Grade results'
              : `Recorded against Sem ${viewSemester}`
          }
          actions={
            backlogView.rows.length ? (
              <ViewAllButton label="View all backlogs" onClick={() => setDialog('backlogs')} />
            ) : null
          }
        >
          {backlogView.rows.length === 0 ? (
            <CardEmpty
              tone="good"
              icon="task_alt"
              title={isCurrent ? 'No backlogs' : `No backlogs in Sem ${viewSemester}`}
              description={isCurrent ? copy.backlogsEmpty : null}
            />
          ) : (
            <>
              <CompactTable
                caption="Backlogs"
                columns={backlogColumns}
                rows={backlogPreview}
                rowKey={(row) => `${row.semester ?? '-'}-${row.subject_code}`}
              />
              {moreNote(backlogPreview.length, backlogView.rows.length)}
            </>
          )}
        </OverviewCard>

        <OverviewCard
          tone="muted"
          icon="gavel"
          iconClassName="text-on-surface"
          title="Black dots"
          count={dots.length}
          subtitle="From Proctorial Board notices"
          actions={dots.length ? <ViewAllButton label="View all black dots" onClick={() => setDialog('black-dots')} /> : null}
        >
          {dots.length === 0 ? (
            <CardEmpty tone="good" icon="verified_user" title="No black dots" description={copy.blackDotsEmpty} />
          ) : (
            <>
              <CompactTable
                caption="Black dots"
                columns={blackDotColumns}
                rows={blackDotPreview}
                rowKey={(row) => row.case_number}
              />
              {moreNote(blackDotPreview.length, dots.length)}
            </>
          )}
        </OverviewCard>
      </div>

      <Modal
        open={dialog === 'backlogs'}
        onClose={() => setDialog(null)}
        size="lg"
        title={isCurrent ? 'All backlogs' : `Backlogs · Sem ${viewSemester}`}
        description={`${backlogView.open} open · ${backlogView.cleared} cleared. A backlog is cleared when a later result for its semester no longer lists the subject.`}
      >
        <div className="-mx-5 -my-4">
          <CompactTable
            caption="All backlogs"
            columns={[
              { key: 'index', header: '#', className: 'text-tertiary tabular-nums', render: (_row, index) => index + 1 },
              {
                key: 'subject',
                header: 'Subject',
                render: (row) => (
                  <span className="block min-w-[10rem]">
                    <span className="block text-label-md text-on-surface">{row.subject_code}</span>
                    {row.subject_name && <span className="block text-label-sm text-tertiary">{row.subject_name}</span>}
                  </span>
                )
              },
              { key: 'semester', header: 'Sem', align: 'center', render: (row) => row.semester ?? '—' },
              { key: 'grade', header: 'Grade', align: 'center', render: (row) => row.grade ?? '—' },
              {
                key: 'credits',
                header: 'Credits',
                align: 'right',
                className: 'tabular-nums',
                render: (row) => (row.credits != null ? Number(row.credits) : '—')
              },
              { key: 'exam_session', header: 'Exam', render: (row) => <span className="block min-w-[8rem]">{row.exam_session || '—'}</span> },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <span className="block whitespace-nowrap">
                    {backlogStatus(row)}
                    {row.is_cleared && row.cleared_at && (
                      <span className="mt-0.5 block text-label-sm text-tertiary">{formatDate(row.cleared_at)}</span>
                    )}
                  </span>
                )
              }
            ]}
            rows={backlogView.rows}
            rowKey={(row) => `${row.semester ?? '-'}-${row.subject_code}`}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'black-dots'}
        onClose={() => setDialog(null)}
        size="lg"
        title="All black dots"
        description={`Every Proctorial Board case that lists ${copy.subject}, most recent first.`}
      >
        <ol className="-mx-5 -my-4 divide-y divide-surface-container">
          {dots.map((dot, index) => (
            <li key={dot.case_number} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-label-md text-on-surface">
                  <span className="mr-2 text-tertiary">{index + 1}.</span>Case {dot.case_number}
                </span>
                <span className="text-label-sm text-on-surface-variant">{incidentDate(dot)}</span>
              </div>
              {dot.case_details && <p className="mt-1.5 break-anywhere text-body-sm text-on-surface">{dot.case_details}</p>}
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-label-sm sm:grid-cols-2">
                {[
                  ['Block', [dot.hostel_block, dot.room_no && `Room ${dot.room_no}`].filter(Boolean).join(' · ')],
                  ['Course / branch', dot.course_branch],
                  ['Previous record', dot.previous_record],
                  ['Recorded', dot.recorded_at ? formatDate(dot.recorded_at) : null]
                ]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label} className="flex gap-1.5">
                      <dt className="text-tertiary">{label}:</dt>
                      <dd className="break-anywhere text-on-surface-variant">{value}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          ))}
        </ol>
      </Modal>
    </section>
  );
}
