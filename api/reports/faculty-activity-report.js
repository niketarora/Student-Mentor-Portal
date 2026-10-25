/**
 * GET /api/reports/faculty-activity-report
 * FEATURE 4 — a faculty member's own mentoring + query activity.
 *
 *   ?format=json  -> the same JSON the on-screen charts render
 *   ?format=pdf   -> a branded, chart-led PDF of exactly those numbers
 *   ?faculty_id=  -> HOD (their own faculty) or administrator; faculty
 *                    always get their own data. 'all' is the all-faculty
 *                    report: the department for the administrator, the
 *                    HOD's own faculty for a HOD.
 *   ?from= &to=   -> YYYY-MM-DD window, defaults to the last 90 days
 *
 * Scoping is enforced inside get_faculty_activity_report(): a faculty
 * member passing someone else's id gets a 403 from the database, not from
 * this file, so there is no way around it.
 */
import { withApiDefaults, sendSuccess, ApiError } from '../_lib/http-response.js';
import { requireAuthenticatedUser, requireRole, enforceRateLimit, recordAuditEntry } from '../_lib/request-guards.js';
import { parseOrThrow, facultyReportQuerySchema } from '../_lib/input-validation.js';
import { buildFacultyActivityPdf, buildDepartmentReportPdf } from '../_lib/report-document-builder.js';

export default withApiDefaults(['GET'], async (req, res) => {
  const context = await requireAuthenticatedUser(req);
  requireRole(context, 'faculty', 'hod', 'admin');
  await enforceRateLimit(context, { key: 'faculty-report', max: 30, windowSeconds: 60 });

  const query = parseOrThrow(facultyReportQuerySchema, {
    faculty_id: req.query.faculty_id || undefined,
    from: req.query.from || undefined,
    to: req.query.to || undefined,
    format: req.query.format || 'json'
  });

  const isDepartmentWide = query.faculty_id === 'all';

  const { data: report, error } = isDepartmentWide
    ? await context.asUser.rpc('get_department_faculty_report', {
        p_from: query.from ?? null,
        p_to: query.to ?? null
      })
    : await context.asUser.rpc('get_faculty_activity_report', {
        p_faculty_id: query.faculty_id ?? null,
        p_from: query.from ?? null,
        p_to: query.to ?? null
      });

  if (error) throw new ApiError(error.message, error.code === '42501' ? 403 : 400);
  if (!report) throw new ApiError('No report data was returned', 404);

  if (query.format === 'json') {
    return sendSuccess(res, 'Faculty activity report generated', { report });
  }

  const pdfBytes = isDepartmentWide
    ? await buildDepartmentReportPdf(report)
    : await buildFacultyActivityPdf(report);

  const safeName = isDepartmentWide
    ? 'all-faculty'
    : String(report.faculty.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `${isDepartmentWide ? 'department' : 'faculty'}-activity-report-${safeName}-${report.period.from}-to-${report.period.to}.pdf`;

  await recordAuditEntry(context, req, isDepartmentWide ? 'report.department_pdf' : 'report.faculty_activity_pdf', {
    type: 'user_profiles', id: isDepartmentWide ? null : report.faculty.id,
    metadata: { from: report.period.from, to: report.period.to, scope: isDepartmentWide ? 'department' : 'faculty' }
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(pdfBytes.length));
  res.status(200).send(pdfBytes);
});
