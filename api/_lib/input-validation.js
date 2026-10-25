/**
 * input-validation.js
 * Zod schemas for every request body the API accepts. Validation happens
 * before anything touches the database, so malformed input produces a
 * clean 400 rather than a raw Postgres error.
 */

import { z } from 'zod';
import { ApiError } from './http-response.js';

const uuid = z.string().uuid('Must be a valid ID');

/** Institutional email. Domain allow-list is configurable via env. */
const allowedEmailDomains = (process.env.ALLOWED_EMAIL_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(255)
  .refine(
    (value) =>
      allowedEmailDomains.length === 0 ||
      allowedEmailDomains.some((domain) => value.endsWith(`@${domain}`)),
    {
      message: `Email must belong to one of: ${allowedEmailDomains.join(', ') || 'any domain'}`
    }
  );

export const provisionUserSchema = z.object({
  email: emailSchema,
  full_name: z.string().trim().min(2, 'Name is too short').max(120),
  role: z.enum(['student', 'faculty', 'hod', 'cluster_head']),
  login_id: z.string().trim().min(1).max(40).optional().nullable(),
  branch: z.string().trim().max(60).optional().nullable(),
  section: z.string().trim().max(10).optional().nullable(),
  semester_label: z.string().trim().max(40).optional().nullable(),
  department: z.string().trim().max(80).optional().nullable(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, 'Phone must be 10 digits')
    .optional()
    .nullable(),
  assigned_mentor_id: uuid.optional().nullable(),
  send_invite_email: z.boolean().optional().default(false)
});

export const provisionBatchSchema = z.object({
  accounts: z.array(provisionUserSchema).min(1).max(500)
});

export const rosterImportSchema = z.object({
  import_type: z.enum(['faculty', 'student', 'combined']),
  filename: z.string().trim().min(1).max(255),
  /** base64 of the .csv / .xlsx file, capped well under the Vercel body limit */
  file_base64: z.string().min(1).max(8_000_000),
  semester_cycle_id: uuid.optional().nullable(),
  default_mentor_id: uuid.optional().nullable(),
  create_accounts: z.boolean().optional().default(true),
  /**
   * Chunking. A 2,700-row roster is 2,700 round trips to Supabase Auth,
   * which does not fit in one 30s function, so the browser sends the same
   * file repeatedly and the server works through it from `offset`.
   * `batch_id` is the import-history row the first chunk created, so the
   * whole upload stays one line in the history instead of twenty.
   */
  offset: z.number().int().min(0).optional().default(0),
  batch_id: uuid.optional().nullable()
});

export const facultyStatusSchema = z.object({
  faculty_id: uuid,
  employment_status: z.enum(['active', 'on_leave', 'departed']),
  available_for_reassignment: z.boolean().optional()
});

export const reassignmentSchema = z.object({
  student_ids: z.array(uuid).min(1, 'Select at least one student').max(500),
  from_faculty_id: uuid.optional().nullable(),
  to_faculty_id: uuid,
  reason: z.string().trim().max(500).optional().nullable()
});

export const facultyReportQuerySchema = z.object({
  /** 'all' asks for the consolidated department report (HOD only). */
  faculty_id: z.union([uuid, z.literal('all')]).optional().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().nullable(),
  format: z.enum(['json', 'pdf']).optional().default('json')
});

export const studentReportQuerySchema = z.object({
  student_id: uuid,
  format: z.enum(['json', 'pdf']).optional().default('json')
});

/** The academic cycle report: a cycle (default: the active one), whole or one semester. */
export const cycleReportQuerySchema = z.object({
  cycle_id: uuid.optional().nullable(),
  semester: z.enum(['Odd', 'Even']).optional().nullable()
});

// ---------------------------------------------------------------------
// Cluster Head uploads
// ---------------------------------------------------------------------
/**
 * There is deliberately NO date constraint anywhere in these schemas. A
 * Cluster Head may upload attendance on any day — early, late, or twice in
 * one afternoon. The 15-day cadence belongs to cycle_job_schedule, not to
 * the upload.
 */
export const clusterHeadSetupSchema = z.object({
  courses: z
    .array(
      z.object({
        course_name: z.string().trim().min(2, 'Course name is too short').max(160),
        course_code: z.string().trim().min(1, 'Course code is required').max(40)
      })
    )
    .min(1, 'Add at least one subject')
    .max(60, 'That is more subjects than one cluster head can handle')
});

const uploadFileSchema = {
  filename: z.string().trim().min(1).max(255),
  file_base64: z.string().min(1).max(8_000_000)
};

/**
 * Attendance takes nothing but the file. Course code, course name, section
 * and the reporting window all live in the ERP export's header block, so
 * asking the Cluster Head to re-enter them would only create a way for the
 * two to disagree.
 */
export const attendanceUploadSchema = z.object({
  action: z.literal('attendance'),
  ...uploadFileSchema
});

export const gpaUploadSchema = z.object({
  action: z.literal('gpa'),
  /**
   * Optional fallback only. The ERP's CGPA / GPA & Credits export names
   * the semester above every GPA column; this is for a hand-made
   * one-semester sheet with no Semester column. The portal no longer
   * sends it.
   */
  semester_number: z.coerce.number().int().min(1).max(8).optional().nullable(),
  ...uploadFileSchema
});

/**
 * The Defaulter Grade export names its semester and exam in its title
 * lines, so both are optional here: they are only used when the file does
 * not say. The file wins when it does.
 */
export const backlogUploadSchema = z.object({
  action: z.literal('backlog'),
  semester_number: z.coerce.number().int().min(1).max(8).optional().nullable(),
  exam_session: z.string().trim().max(60).optional().nullable(),
  ...uploadFileSchema
});

/**
 * The Proctorial Board notice (.docx, or the same table as .xlsx/.csv).
 * Case numbers, dates and students are all read from the file.
 */
export const blackDotUploadSchema = z.object({
  action: z.literal('black-dot'),
  ...uploadFileSchema
});

/**
 * The departmental Mentor Mentee List: Registration No. -> Mentor Email.
 * Nothing else in that file is read — including the mentor phone column,
 * which is routinely blank or half filled.
 */
export const mentorMapUploadSchema = z.object({
  action: z.literal('mentor-map'),
  ...uploadFileSchema
});

/** The administrator's mentor-HOD mapping (migration 0039). */
export const hodMapUploadSchema = z.object({
  action: z.literal('hod-map'),
  ...uploadFileSchema
});

export const clusterHeadUploadSchema = z.discriminatedUnion('action', [
  attendanceUploadSchema,
  gpaUploadSchema,
  backlogUploadSchema,
  blackDotUploadSchema,
  mentorMapUploadSchema,
  hodMapUploadSchema
]);

/** On-demand trigger for anything that normally runs on the 15-day cycle. */
export const cycleJobSchema = z.object({
  job_type: z.enum([
    'survey_cycle',
    'survey_reminder_sweep',
    'at_risk_sweep',
    'at_risk_meeting_dispatch',
    'all'
  ]),
  /**
   * 'manual' does the work but leaves next_run_due_on alone, which is what
   * makes repeated testing safe. 'scheduled' is what a cron would send.
   */
  trigger_source: z.enum(['manual', 'scheduled']).optional().default('manual'),
  note: z.string().trim().max(300).optional().nullable()
});

/** Parses and throws a 400 with a readable list of problems. */
export function parseOrThrow(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`
    );
    throw new ApiError(`Invalid request — ${problems.join('; ')}`, 400);
  }
  return result.data;
}

/** Guards against oversized JSON bodies before parsing them. */
export function assertBodySize(req, maxBytes = 10 * 1024 * 1024) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxBytes) {
    throw new ApiError('Request body is too large', 413);
  }
}

/** Strips characters that could break a downstream CSV / header. */
export function sanitizeSingleLine(value, maxLength = 200) {
  return String(value ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

