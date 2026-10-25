/**
 * report-document-builder.js
 * Turns the JSON returned by get_faculty_activity_report() and
 * get_student_dossier() into branded, analytical A4 PDFs.
 *
 * Both reports are chart-led: the numbers appear as KPI cards, bar/donut/
 * line charts and tables, not as walls of text.
 */

import pdfLib from 'pdf-lib';
import { UNIVERSITY_LOGO_PNG_BASE64, UNIVERSITY_LOGO_ASPECT } from './university-logo-asset.js';

const { PDFDocument, StandardFonts, rgb } = pdfLib;
import {
  PALETTE, drawStatCards, drawBarChart, drawGroupedBarChart,
  drawLineChart, drawDonutChart, drawLegend, drawTable, drawSectionHeading,
  drawHorizontalBars, truncate
} from './pdf-chart-primitives.js';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

const UNIVERSITY = 'MANIPAL UNIVERSITY JAIPUR';
const SUBTITLE = 'Department of IoT & Intelligent Systems  •  Mentor-Mentee Scheme';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(value)}, ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

// The query categories offered since migration 0026, and the three it
// retired. Old queries keep the retired ones, so a chart shows the five
// current categories and then any retired one that still has queries.
// Same rule as frontend/src/lib/queryCategoryChart.js.
const QUERY_CATEGORIES = ['Academics', 'Examination', 'Behavioural', 'Administrative', 'Others'];
const LEGACY_QUERY_CATEGORIES = ['Academic', 'ERP/Tech', 'Infrastructure'];

/** category -> count, from by_category rows ({category, total}) or query rows ({category}). */
function countByCategory(rows, valueOf = () => 1) {
  const counts = {};
  for (const row of rows ?? []) {
    if (row?.category) counts[row.category] = (counts[row.category] ?? 0) + (Number(valueOf(row)) || 0);
  }
  return counts;
}

/**
 * Each category's bar colour: the portal's (frontend/src/lib/queryCategoryChart.js,
 * CHART_COLORS.series in category order, then two more for the retired ones).
 */
const hex = (value) => rgb(...[1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255));
const CATEGORY_COLORS = Object.fromEntries(
  [...QUERY_CATEGORIES, ...LEGACY_QUERY_CATEGORIES].map((name, index) => [
    name,
    hex(['#c2410c', '#f97316', '#a8a29e', '#ea580c', '#d97706', '#16a34a', '#b45309', '#78716c'][index])
  ])
);

/** Bars for drawBarChart, each in its category's colour. */
function categoryBars(counts) {
  const extra = Object.keys(counts)
    .filter((name) => !QUERY_CATEGORIES.includes(name) && counts[name] > 0)
    .sort((a, b) => {
      const rank = (name) => (LEGACY_QUERY_CATEGORIES.includes(name) ? LEGACY_QUERY_CATEGORIES.indexOf(name) : 99);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  return [...QUERY_CATEGORIES, ...extra].map((label) => ({
    label, value: counts[label] ?? 0, color: CATEGORY_COLORS[label] ?? PALETTE.slate
  }));
}

function hoursLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n >= 24 ? `${(n / 24).toFixed(1)} d` : `${n.toFixed(1)} h`;
}

class ReportDocument {
  constructor(pdf, fonts, meta, logoImage) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.meta = meta;
    this.logoImage = logoImage;
    this.pages = [];
    this.page = null;
    this.y = 0;
    this.addPage();
  }

  addPage() {
    this.page = this.pdf.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = this.drawHeader();
    return this.page;
  }

  /**
   * Branded header band with the university wordmark.
   *
   * The logo sits on a white plate rather than directly on the orange
   * band: the source artwork is flattened onto white, so placing it on a
   * coloured background would show a white rectangle around it.
   */
  drawHeader() {
    const bandHeight = 70;
    const top = A4.height;

    this.page.drawRectangle({
      x: 0, y: top - bandHeight, width: A4.width, height: bandHeight, color: PALETTE.primary
    });
    this.page.drawRectangle({
      x: 0, y: top - bandHeight - 3, width: A4.width, height: 3, color: PALETTE.secondary
    });

    const logoWidth = 132;
    const logoHeight = logoWidth / UNIVERSITY_LOGO_ASPECT;
    const plateX = MARGIN;
    const plateY = top - bandHeight / 2 - logoHeight / 2 - 5;

    this.page.drawRectangle({
      x: plateX - 6, y: plateY - 5, width: logoWidth + 12, height: logoHeight + 10,
      color: PALETTE.white
    });
    if (this.logoImage) {
      this.page.drawImage(this.logoImage, {
        x: plateX, y: plateY, width: logoWidth, height: logoHeight
      });
    }

    const textX = plateX + logoWidth + 18;
    this.page.drawText(UNIVERSITY, {
      x: textX, y: top - 30, size: 12, font: this.fonts.bold, color: PALETTE.white
    });
    this.page.drawText(SUBTITLE, {
      x: textX, y: top - 44, size: 7.5, font: this.fonts.regular, color: PALETTE.primarySoft
    });

    const stamp = `Generated ${formatDateTime(this.meta.generatedAt)}`;
    this.page.drawText(stamp, {
      x: A4.width - MARGIN - this.fonts.regular.widthOfTextAtSize(stamp, 7),
      y: top - 44, size: 7, font: this.fonts.regular, color: PALETTE.primarySoft
    });

    return top - bandHeight - 26;
  }

  /** Reserves vertical space, adding a page when the block will not fit. */
  reserve(height) {
    if (this.y - height < MARGIN + 26) this.addPage();
    return this.y;
  }

  /**
   * @param {number} [blockHeight] height of the content that follows.
   * Passing it keeps the heading and its block on the same page instead of
   * leaving an orphaned title at the bottom.
   */
  heading(text, blockHeight = 0) {
    this.reserve(34 + blockHeight);
    this.y = drawSectionHeading(this.page, this.fonts, {
      x: MARGIN, y: this.y, text, width: CONTENT_WIDTH
    });
    return this.y;
  }

  paragraph(text, { size = 8, color = PALETTE.muted } = {}) {
    const maxWidth = CONTENT_WIDTH;
    const words = String(text).split(/\s+/);
    let line = '';
    const lines = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.fonts.regular.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line); line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);

    this.reserve(lines.length * (size + 3) + 6);
    for (const l of lines) {
      this.page.drawText(l, { x: MARGIN, y: this.y, size, font: this.fonts.regular, color });
      this.y -= size + 3;
    }
    this.y -= 6;
    return this.y;
  }

  /** Title block under the header describing who/what the report covers. */
  titleBlock(title, subtitle, chips = []) {
    this.page.drawText(title, { x: MARGIN, y: this.y, size: 17, font: this.fonts.bold, color: PALETTE.ink });
    this.y -= 16;
    if (subtitle) {
      this.page.drawText(subtitle, { x: MARGIN, y: this.y, size: 9, font: this.fonts.regular, color: PALETTE.muted });
      this.y -= 16;
    }
    if (chips.length) {
      let chipX = MARGIN;
      for (const chip of chips) {
        const label = truncate(chip, this.fonts.regular, 7.5, 200);
        const chipWidth = this.fonts.regular.widthOfTextAtSize(label, 7.5) + 14;
        this.page.drawRectangle({
          x: chipX, y: this.y - 3, width: chipWidth, height: 15,
          color: PALETTE.surfaceAlt, borderColor: PALETTE.outline, borderWidth: 0.5
        });
        this.page.drawText(label, {
          x: chipX + 7, y: this.y + 1.5, size: 7.5, font: this.fonts.regular, color: PALETTE.muted
        });
        chipX += chipWidth + 6;
      }
      this.y -= 24;
    }
    this.y -= 4;
    return this.y;
  }

  /** Footer with page numbers, run once at the end when the count is known. */
  finalizeFooters(reportLabel) {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN, y: MARGIN + 14 }, end: { x: A4.width - MARGIN, y: MARGIN + 14 },
        thickness: 0.5, color: PALETTE.outline
      });
      page.drawText(reportLabel, {
        x: MARGIN, y: MARGIN + 4, size: 6.5, font: this.fonts.regular, color: PALETTE.slate
      });
      const confidential = 'Confidential — for internal academic use only';
      page.drawText(confidential, {
        x: A4.width / 2 - this.fonts.regular.widthOfTextAtSize(confidential, 6.5) / 2,
        y: MARGIN + 4, size: 6.5, font: this.fonts.regular, color: PALETTE.slate
      });
      const pageLabel = `Page ${index + 1} of ${total}`;
      page.drawText(pageLabel, {
        x: A4.width - MARGIN - this.fonts.regular.widthOfTextAtSize(pageLabel, 6.5),
        y: MARGIN + 4, size: 6.5, font: this.fonts.regular, color: PALETTE.slate
      });
    });
  }
}

async function createDocument(meta) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique)
  };

  // A broken logo must never take a report down with it.
  let logoImage = null;
  try {
    logoImage = await pdf.embedPng(Buffer.from(UNIVERSITY_LOGO_PNG_BASE64, 'base64'));
  } catch (error) {
    console.error('[pdf] university logo could not be embedded:', error.message);
  }

  pdf.setTitle(meta.title);
  pdf.setAuthor('SSMP — Manipal University Jaipur');
  pdf.setSubject(meta.subject ?? meta.title);
  pdf.setProducer('SSMP Platform');
  pdf.setCreationDate(new Date());
  return { pdf, fonts, doc: new ReportDocument(pdf, fonts, meta, logoImage) };
}

/* ====================================================================
 * FEATURE 4 — Faculty activity report
 * ==================================================================== */
export async function buildFacultyActivityPdf(report) {
  const { faculty, period, summary } = report;
  const { pdf, doc } = await createDocument({
    title: `Faculty Activity Report — ${faculty.name}`,
    generatedAt: report.generated_at
  });

  doc.titleBlock(
    'Faculty Activity Report',
    `${faculty.name}  ·  ${faculty.email}`,
    [
      `Faculty ID: ${faculty.login_id ?? '—'}`,
      `Branch: ${faculty.branch ?? '—'}`,
      `Period: ${formatDate(period.from)} – ${formatDate(period.to)}`,
      `Status: ${faculty.employment_status}`
    ]
  );

  // ── KPI row ────────────────────────────────────────────────────────
  doc.y = drawStatCards(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH, perRow: 4,
    cards: [
      { label: 'Queries handled', value: summary.total_queries, accent: PALETTE.primary,
        caption: `${summary.resolved_queries} resolved` },
      { label: 'Resolution rate', value: `${summary.resolution_rate_percent}%`, accent: PALETTE.success,
        caption: `${summary.open_queries + summary.in_progress_queries} still active` },
      { label: 'Avg first response', value: hoursLabel(summary.avg_first_response_hours), accent: PALETTE.secondary,
        caption: 'time to first reply' },
      { label: 'Avg resolution', value: hoursLabel(summary.avg_resolution_hours), accent: PALETTE.slate,
        caption: 'raised to resolved' },
      { label: 'Satisfaction', value: summary.avg_satisfaction ? `${summary.avg_satisfaction}/5` : '—',
        accent: PALETTE.warning, caption: `${summary.rated_queries} ratings received` },
      { label: 'Open', value: summary.open_queries, accent: PALETTE.error },
      { label: 'In progress', value: summary.in_progress_queries, accent: PALETTE.warning },
      { label: 'Mentees', value: report.mentees.length, accent: PALETTE.primaryLight,
        caption: `${report.mentees.filter((m) => m.form_a_completed).length} onboarded` }
    ]
  });

  // ── Category + confirmation charts side by side ────────────────────
  doc.heading('Query mix and resolution quality', 190);

  const categoryData = categoryBars(countByCategory(report.by_category, (row) => row.total));

  const chartTop = doc.y;
  const halfWidth = (CONTENT_WIDTH - 24) / 2;

  drawBarChart(doc.page, doc.fonts, {
    x: MARGIN, y: chartTop - 12, width: halfWidth, height: 132,
    data: categoryData, title: 'Queries by category'
  });

  const confirmation = report.resolution_confirmation ?? {};
  const donutSlices = [
    { label: 'Confirmed fixed', value: confirmation.confirmed_yes ?? 0, color: PALETTE.success },
    { label: 'Reopened', value: confirmation.reopened_no ?? 0, color: PALETTE.error },
    { label: 'Awaiting reply', value: confirmation.awaiting_response ?? 0, color: PALETTE.warning },
    { label: 'Unresolved', value: confirmation.never_resolved ?? 0, color: PALETTE.slateLight }
  ];
  const donutCenterX = MARGIN + halfWidth + 24 + halfWidth / 2;
  drawDonutChart(doc.page, doc.fonts, {
    centerX: donutCenterX, centerY: chartTop - 84, radius: 46, thickness: 20,
    slices: donutSlices, title: 'Student confirmation outcome', titleY: chartTop - 6
  });
  drawLegend(doc.page, doc.fonts, {
    x: MARGIN + halfWidth + 24, y: chartTop - 152, maxWidth: halfWidth,
    items: donutSlices.filter((s) => s.value > 0).map((s) => ({ label: `${s.label} (${s.value})`, color: s.color })),
    gap: 8
  });

  doc.y = chartTop - 186;

  // ── Weekly trend ───────────────────────────────────────────────────
  doc.heading('Weekly volume — raised vs resolved', 150);
  const weekly = (report.weekly_trend ?? []).slice(-12);
  drawGroupedBarChart(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y - 8, width: CONTENT_WIDTH, height: 122,
    data: weekly.map((w) => ({
      label: formatDate(w.week_start).replace(/ \d{4}$/, ''),
      values: [w.created, w.resolved]
    })),
    series: [
      { name: 'Raised', color: PALETTE.primary },
      { name: 'Resolved', color: PALETTE.success }
    ]
  });
  doc.y -= 140;

  // ── Satisfaction distribution ──────────────────────────────────────
  doc.heading('Satisfaction ratings received', 110);
  const distribution = report.rating_distribution ?? {};
  drawHorizontalBars(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH,
    rows: [5, 4, 3, 2, 1].map((star) => ({
      label: `${star} star${star > 1 ? 's' : ''}`,
      value: Number(distribution[String(star)] ?? 0),
      color: star >= 4 ? PALETTE.success : star === 3 ? PALETTE.warning : PALETTE.error
    })),
    labelWidth: 60
  });
  doc.y -= 92;

  // ── Category breakdown table ───────────────────────────────────────
  doc.heading('Category breakdown');
  doc.y = drawTable(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH,
    columns: [
      { header: 'Category', key: 'category', width: 3 },
      { header: 'Total', key: 'total', width: 1, align: 'right' },
      { header: 'Resolved', key: 'resolved', width: 1, align: 'right' },
      { header: 'Still open', key: 'open_count', width: 1, align: 'right' },
      { header: 'Resolved %', key: 'rate', width: 1.2, align: 'right' }
    ],
    rows: (report.by_category ?? []).map((c) => ({
      ...c,
      rate: c.total ? `${Math.round((c.resolved / c.total) * 100)}%` : '—'
    })),
    emptyMessage: 'No queries in this period'
  });

  // ── Mentee roster ──────────────────────────────────────────────────
  doc.heading(`Assigned mentees (${report.mentees.length})`);
  doc.y = drawTable(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH,
    columns: [
      { header: 'Student', key: 'name', width: 2.6 },
      { header: 'Reg. no.', key: 'registration_no', width: 1.6 },
      { header: 'Sec', key: 'section', width: 0.6, align: 'center' },
      { header: 'Branch', key: 'branch', width: 1 },
      { header: 'Form A', key: 'onboarded', width: 1, align: 'center' },
      { header: 'Rep', key: 'star', width: 0.6, align: 'center' },
      { header: 'Queries', key: 'query_count', width: 0.9, align: 'right' }
    ],
    rows: report.mentees.map((m) => ({
      ...m,
      onboarded: m.form_a_completed ? 'Yes' : 'Pending',
      star: m.is_star_mentee ? 'Yes' : ''
    })),
    maxRows: 60,
    emptyMessage: 'No mentees assigned yet'
  });

  doc.finalizeFooters(`Faculty Activity Report — ${faculty.name}`);
  return Buffer.from(await pdf.save());
}

/* ====================================================================
 * FEATURE 5 — Per-student dossier (no parent-communication section)
 * ==================================================================== */
export async function buildStudentDossierPdf(report) {
  const { student, mentor, form_a: formA, query_summary: queries } = report;
  const { pdf, doc } = await createDocument({
    title: `Student Report — ${student.name}`,
    generatedAt: report.generated_at
  });

  doc.titleBlock(
    'Student Mentorship Report',
    `${student.name}  ·  ${student.email}`,
    [
      `Reg. no: ${student.registration_no ?? '—'}`,
      `Section: ${student.section ?? '—'}`,
      `Branch: ${student.branch ?? '—'}`,
      `Mentor: ${mentor?.name ?? 'Unassigned'}`,
      ...(student.is_star_mentee ? ['Student Representative'] : [])
    ]
  );

  const gpaStats = report.gpa_stats ?? {};
  doc.y = drawStatCards(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH, perRow: 4,
    cards: [
      { label: 'CGPA', value: report.gpa_shared ? (gpaStats.cgpa != null ? Number(gpaStats.cgpa).toFixed(2) : '—') : 'Hidden',
        accent: PALETTE.primary,
        caption: !report.gpa_shared
          ? 'not shared by student'
          : gpaStats.cgpa_official ? 'official' : `${gpaStats.semesters_recorded ?? 0} semesters` },
      { label: 'Queries raised', value: queries.total, accent: PALETTE.secondary,
        caption: `${queries.resolved} resolved` },
      { label: 'Achievements', value: report.achievements.length, accent: PALETTE.success,
        caption: `${report.achievements.filter((a) => a.verified).length} verified` },
      { label: 'Avg resolution', value: hoursLabel(queries.avg_resolution_hours), accent: PALETTE.slate,
        caption: 'on their queries' },
      { label: 'Onboarding', value: student.form_a_completed ? 'Complete' : 'Pending',
        accent: student.form_a_completed ? PALETTE.success : PALETTE.error, caption: 'Form A' },
      { label: 'Confirmed fixed', value: queries.confirmed_yes, accent: PALETTE.success },
      { label: 'Reopened', value: queries.reopened_no, accent: PALETTE.error },
      { label: 'Avg rating given', value: queries.avg_rating_given || '—', accent: PALETTE.warning }
    ]
  });

  // ── Academic performance ───────────────────────────────────────────
  doc.heading('Academic performance — semester GPA');
  if (!report.gpa_shared) {
    doc.paragraph(
      'This student has turned off GPA sharing. Semester grades are therefore not included in this report. ' +
      'The student can re-enable sharing at any time from their profile page.',
      { color: PALETTE.slate }
    );
  } else if (!report.semester_gpas.length) {
    doc.paragraph('No semester GPA has been recorded by the student yet.', { color: PALETTE.slate });
  } else {
    doc.reserve(160);
    drawLineChart(doc.page, doc.fonts, {
      x: MARGIN, y: doc.y - 8, width: CONTENT_WIDTH, height: 128, valueMax: 10,
      data: report.semester_gpas.map((g) => ({ label: `Sem ${g.semester}`, value: Number(g.gpa) })),
      title: `GPA trend — ${gpaStats.trend === 'improving' ? 'improving' : gpaStats.trend === 'declining' ? 'needs attention' : 'trend forming'}`
    });
    doc.y -= 148;
    // cgpa is the department's published figure when one was uploaded,
    // otherwise the mean of the semesters recorded so far.
    doc.paragraph(
      (gpaStats.cgpa_official
        ? `CGPA ${Number(gpaStats.cgpa).toFixed(2)} (official). ${gpaStats.semesters_recorded} semester(s) recorded. `
        : `CGPA ${Number(gpaStats.cgpa).toFixed(2)} across ${gpaStats.semesters_recorded} semester(s). `) +
      `Highest ${gpaStats.highest}, lowest ${gpaStats.lowest}.`
    );
  }

  // ── Support activity ───────────────────────────────────────────────
  doc.heading('Support activity', 190);
  const activityTop = doc.y;
  const halfWidth = (CONTENT_WIDTH - 24) / 2;

  drawBarChart(doc.page, doc.fonts, {
    x: MARGIN, y: activityTop - 12, width: halfWidth, height: 128,
    title: 'Queries by category',
    // From the full query list: query_summary counts only the retired categories.
    data: categoryBars(countByCategory(report.queries))
  });

  const statusSlices = [
    { label: 'Resolved', value: queries.resolved, color: PALETTE.success },
    { label: 'In progress', value: queries.in_progress, color: PALETTE.warning },
    { label: 'Open', value: queries.open, color: PALETTE.error }
  ];
  drawDonutChart(doc.page, doc.fonts, {
    centerX: MARGIN + halfWidth + 24 + halfWidth / 2, centerY: activityTop - 82,
    radius: 44, thickness: 19, slices: statusSlices,
    title: 'Current status mix', titleY: activityTop - 6
  });
  drawLegend(doc.page, doc.fonts, {
    x: MARGIN + halfWidth + 24, y: activityTop - 148,
    maxWidth: halfWidth,
    items: statusSlices.map((s) => ({ label: `${s.label} (${s.value})`, color: s.color })), gap: 8
  });
  doc.y = activityTop - 172;

  if ((report.monthly_query_trend ?? []).length > 1) {
    doc.reserve(150);
    drawLineChart(doc.page, doc.fonts, {
      x: MARGIN, y: doc.y - 8, width: CONTENT_WIDTH, height: 118,
      data: report.monthly_query_trend.map((m) => ({ label: m.month, value: m.count })),
      title: 'Queries raised per month', color: PALETTE.secondary
    });
    doc.y -= 138;
  }

  doc.heading('Query history');
  doc.y = drawTable(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH,
    columns: [
      { header: 'Ref', key: 'query_code', width: 1.1 },
      { header: 'Subject', key: 'subject', width: 3.4 },
      { header: 'Category', key: 'category', width: 1.3 },
      { header: 'Status', key: 'status', width: 1.1 },
      { header: 'Confirmed', key: 'confirmation_label', width: 1.1, align: 'center' },
      { header: 'Rating', key: 'rating_label', width: 0.8, align: 'center' },
      { header: 'Raised', key: 'raised_label', width: 1.3 }
    ],
    rows: (report.queries ?? []).map((t) => ({
      ...t,
      confirmation_label: t.confirmation === 'yes' ? 'Yes' : t.confirmation === 'no' ? 'Reopened' : '—',
      rating_label: t.satisfaction_rating ? `${t.satisfaction_rating}/5` : '—',
      raised_label: formatDate(t.created_at)
    })),
    maxRows: 30,
    emptyMessage: 'This student has not raised any queries'
  });

  // ── Achievements (Feature 6) ───────────────────────────────────────
  doc.heading(`Non-academic achievements (${report.achievements.length})`);
  const byCategory = report.achievements_by_category ?? {};
  if (Object.keys(byCategory).length) {
    doc.reserve(100);
    doc.y = drawHorizontalBars(doc.page, doc.fonts, {
      x: MARGIN, y: doc.y, width: CONTENT_WIDTH,
      rows: Object.entries(byCategory).map(([category, count]) => ({
        label: category.charAt(0).toUpperCase() + category.slice(1),
        value: Number(count)
      })),
      labelWidth: 90
    });
  }
  doc.y = drawTable(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH,
    columns: [
      { header: 'Achievement', key: 'title', width: 3 },
      { header: 'Category', key: 'category', width: 1.2 },
      { header: 'Date', key: 'date_label', width: 1.2 },
      { header: 'Verified', key: 'verified_label', width: 0.9, align: 'center' }
    ],
    rows: report.achievements.map((a) => ({
      ...a,
      date_label: formatDate(a.achieved_on),
      verified_label: a.verified ? 'Yes' : '—'
    })),
    maxRows: 25,
    emptyMessage: 'No achievements recorded yet'
  });

  // ── Form A summary (Feature 1) ─────────────────────────────────────
  doc.heading('Form A — student profile summary');
  if (!formA) {
    doc.paragraph('This student has not submitted Form A yet.', { color: PALETTE.slate });
  } else {
    doc.y = drawTable(doc.page, doc.fonts, {
      x: MARGIN, y: doc.y, width: CONTENT_WIDTH,
      columns: [
        { header: 'Field', key: 'field', width: 1.4 },
        { header: 'Value', key: 'value', width: 3 },
        { header: 'Field', key: 'field2', width: 1.4 },
        { header: 'Value', key: 'value2', width: 3 }
      ],
      rows: [
        { field: 'Registration no.', value: formA.registration_no, field2: 'Roll no.', value2: formA.roll_no },
        { field: 'Date of birth', value: formatDate(formA.date_of_birth), field2: 'Blood group', value2: formA.blood_group },
        { field: 'Mobile', value: formA.mobile_no, field2: 'Email', value2: formA.email },
        { field: 'Hostel block', value: formA.is_day_scholar ? 'Day scholar' : formA.hostel_block,
          field2: 'Room no.', value2: formA.is_day_scholar ? '—' : formA.room_no },
        { field: 'MUJ alumni in family', value: formA.has_muj_alumni_in_family ? 'Yes' : 'No',
          field2: 'Alumni detail', value2: formA.alumni ? `${formA.alumni.name} (${formA.alumni.relationship ?? '—'})` : '—' },
        { field: "Father's name", value: formA.father.name, field2: 'Occupation', value2: formA.father.occupation },
        { field: "Father's organisation", value: formA.father.organization, field2: 'Designation', value2: formA.father.designation },
        { field: "Mother's name", value: formA.mother.name, field2: 'Occupation', value2: formA.mother.occupation },
        { field: "Mother's organisation", value: formA.mother.organization, field2: 'Designation', value2: formA.mother.designation },
        { field: 'Submitted on', value: formatDate(formA.submitted_at), field2: 'Pin code', value2: formA.communication_pin_code }
      ]
    });
    doc.reserve(46);
    doc.paragraph(`Address for communication: ${formA.communication_address}, ${formA.communication_pin_code}`);
    doc.paragraph(`Permanent address: ${formA.permanent_address}, ${formA.permanent_pin_code}`);
  }

  doc.finalizeFooters(`Student Mentorship Report — ${student.name}`);
  return Buffer.from(await pdf.save());
}

/* ====================================================================
 * DEPARTMENT-WIDE consolidated report (HOD → "All faculty members")
 *
 * Deliberately mixed: charts and KPI cards carry the story, then one
 * compact table row per faculty member. Running the full per-faculty
 * report for everyone would produce dozens of pages nobody reads.
 * ==================================================================== */
export async function buildDepartmentReportPdf(report) {
  const { summary, period } = report;
  // A HOD's copy covers the faculty mapped to them (migration 0039); the
  // administrator's covers the department.
  const isHodScope = report.coverage === 'hod';
  const { pdf, doc } = await createDocument({
    title: `Department Faculty Report — ${report.department}`,
    generatedAt: report.generated_at
  });

  doc.titleBlock(
    'Department Faculty Report',
    isHodScope
      ? `Faculty reporting to ${report.hod_name ?? 'the HOD'} · ${report.department}`
      : `All faculty members · ${report.department}`,
    [
      `Period: ${formatDate(period.from)} – ${formatDate(period.to)}`,
      `${summary.faculty_count} faculty (${summary.active_faculty} active)`,
      `${summary.student_count} students`
    ]
  );

  // ── Department KPIs ────────────────────────────────────────────────
  doc.y = drawStatCards(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH, perRow: 4,
    cards: [
      { label: 'Queries raised', value: summary.total_queries, accent: PALETTE.primary,
        caption: `${summary.resolved_queries} resolved` },
      { label: 'Resolution rate', value: `${summary.resolution_rate_percent}%`, accent: PALETTE.success,
        caption: `${summary.open_queries + summary.in_progress_queries} still active` },
      { label: 'Avg first response', value: hoursLabel(summary.avg_first_response_hours), accent: PALETTE.secondary },
      { label: 'Avg resolution', value: hoursLabel(summary.avg_resolution_hours), accent: PALETTE.slate },
      { label: 'Satisfaction', value: summary.avg_satisfaction ? `${summary.avg_satisfaction}/5` : '—',
        accent: PALETTE.warning },
      { label: 'Faculty', value: summary.faculty_count, accent: PALETTE.primaryLight,
        caption: `${summary.active_faculty} active` },
      // Every student in a HOD's scope has a mentor, so the HOD's copy
      // counts their students instead.
      isHodScope
        ? { label: 'Students', value: summary.student_count, accent: PALETTE.primaryLight }
        : { label: 'Unassigned students', value: summary.unassigned_students,
            accent: summary.unassigned_students ? PALETTE.error : PALETTE.success },
      { label: 'Referred to HOD', value: summary.escalated_queries,
        accent: summary.escalated_queries ? PALETTE.error : PALETTE.slate }
    ]
  });

  // ── Category and status mix side by side ───────────────────────────
  doc.heading('Department query mix', 190);
  const chartTop = doc.y;
  const halfWidth = (CONTENT_WIDTH - 24) / 2;

  drawBarChart(doc.page, doc.fonts, {
    x: MARGIN, y: chartTop - 12, width: halfWidth, height: 132,
    title: 'Queries by category',
    data: categoryBars(countByCategory(report.by_category, (row) => row.total))
  });

  const status = report.by_status ?? {};
  const statusSlices = [
    { label: 'Resolved', value: status.resolved ?? 0, color: PALETTE.success },
    { label: 'In progress', value: status.in_progress ?? 0, color: PALETTE.warning },
    { label: 'Open', value: status.open ?? 0, color: PALETTE.error }
  ];
  drawDonutChart(doc.page, doc.fonts, {
    centerX: MARGIN + halfWidth + 24 + halfWidth / 2, centerY: chartTop - 84,
    radius: 46, thickness: 20, slices: statusSlices,
    title: 'Current status mix', titleY: chartTop - 6
  });
  drawLegend(doc.page, doc.fonts, {
    x: MARGIN + halfWidth + 24, y: chartTop - 152, maxWidth: halfWidth,
    items: statusSlices.map((s) => ({ label: `${s.label} (${s.value})`, color: s.color })), gap: 8
  });
  doc.y = chartTop - 186;

  // ── Monthly volume ─────────────────────────────────────────────────
  doc.heading('Monthly volume — raised vs resolved', 150);
  drawGroupedBarChart(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y - 8, width: CONTENT_WIDTH, height: 122,
    data: (report.monthly_trend ?? []).slice(-12).map((m) => ({
      label: m.month, values: [m.created, m.resolved]
    })),
    series: [
      { name: 'Raised', color: PALETTE.primary },
      { name: 'Resolved', color: PALETTE.success }
    ]
  });
  doc.y -= 140;

  // ── Who is carrying the load ───────────────────────────────────────
  const faculty = report.faculty ?? [];
  const topByVolume = [...faculty].sort((a, b) => b.total_queries - a.total_queries).slice(0, 8);

  doc.heading('Query load by faculty member', topByVolume.length * 16 + 20);
  doc.y = drawHorizontalBars(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH, labelWidth: 130,
    rows: topByVolume.map((f) => ({
      label: f.name,
      value: f.total_queries,
      display: `${f.total_queries} (${f.resolved_queries} resolved)`
    }))
  });

  const responders = faculty
    .filter((f) => Number(f.avg_first_response_hours) > 0)
    .sort((a, b) => a.avg_first_response_hours - b.avg_first_response_hours)
    .slice(0, 8);

  if (responders.length) {
    doc.heading('Fastest first response', responders.length * 16 + 20);
    doc.y = drawHorizontalBars(doc.page, doc.fonts, {
      x: MARGIN, y: doc.y, width: CONTENT_WIDTH, labelWidth: 130,
      rows: responders.map((f) => ({
        label: f.name,
        value: Number(f.avg_first_response_hours),
        display: hoursLabel(f.avg_first_response_hours),
        color: PALETTE.secondary
      }))
    });
  }

  // ── The tabular half: one row per faculty member ───────────────────
  doc.heading(`All faculty (${faculty.length})`);
  doc.y = drawTable(doc.page, doc.fonts, {
    x: MARGIN, y: doc.y, width: CONTENT_WIDTH,
    columns: [
      { header: 'Faculty', key: 'name', width: 2.5 },
      { header: 'Branch', key: 'branch', width: 0.85 },
      { header: 'Status', key: 'employment_status', width: 1 },
      { header: 'Mentees', key: 'mentee_count', width: 1.05, align: 'right' },
      { header: 'Queries', key: 'total_queries', width: 1, align: 'right' },
      { header: 'Resolved', key: 'resolved_queries', width: 1.1, align: 'right' },
      { header: 'Reopened', key: 'reopened', width: 1.15, align: 'right' },
      { header: '1st resp.', key: 'first_response_label', width: 1.05, align: 'right' },
      { header: 'Resol.', key: 'resolution_label', width: 0.95, align: 'right' },
      { header: 'Rate', key: 'rate_label', width: 0.8, align: 'right' },
      { header: 'Rating', key: 'rating_label', width: 0.9, align: 'right' }
    ],
    rows: faculty.map((f) => ({
      ...f,
      first_response_label: hoursLabel(f.avg_first_response_hours),
      resolution_label: hoursLabel(f.avg_resolution_hours),
      rate_label: `${f.resolution_rate_percent}%`,
      rating_label: f.avg_satisfaction ? `${f.avg_satisfaction}/5` : '—'
    })),
    maxRows: 80,
    emptyMessage: 'No faculty on record'
  });

  doc.finalizeFooters(`Department Faculty Report — ${report.department}`);
  return Buffer.from(await pdf.save());
}
