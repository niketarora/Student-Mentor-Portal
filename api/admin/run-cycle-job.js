/**
 * GET  /api/admin/run-cycle-job   -> current status of every recurring job
 * POST /api/admin/run-cycle-job   -> fire one (or all) of them right now
 *
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------
 * Three things normally happen on a 15-day cycle: the student survey
 * opens, risk flags are re-swept, and meetings/notifications go out for
 * flagged students. Waiting 15 days to find out whether any of that works
 * is not a testing strategy, so this endpoint fires each of them on
 * demand.
 *
 * TWO PROPERTIES WORTH KEEPING
 * ---------------------------------------------------------------------
 * 1. A manual run does the real work but does NOT advance the schedule
 *    (see run_cycle_job in migration 0024). Running the survey job ten
 *    times this afternoon leaves the 15-day rhythm where it was.
 * 2. None of this is coupled to Cluster Head uploads. An attendance file
 *    arriving early or late has no effect on when these jobs are due.
 *
 * Body: { job_type: 'survey_cycle' | 'survey_reminder_sweep' |
 *                   'at_risk_sweep' | 'at_risk_meeting_dispatch' | 'all',
 *         trigger_source?: 'manual' | 'scheduled',
 *         note?: string }
 */
import { withApiDefaults, sendSuccess, ApiError } from '../_lib/http-response.js';
import {
  requireAuthenticatedUser,
  requireRole,
  enforceRateLimit,
  recordAuditEntry
} from '../_lib/request-guards.js';
import { parseOrThrow, cycleJobSchema } from '../_lib/input-validation.js';

const JOB_LABELS = {
  survey_cycle: 'Survey cycle',
  survey_reminder_sweep: 'Survey reminders',
  at_risk_sweep: 'At-risk re-evaluation',
  at_risk_meeting_dispatch: 'At-risk meeting dispatch'
};

function toClientError(error, fallback) {
  const message = String(error?.message ?? '');
  if (/fetch failed|invalid header|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    console.error('[run-cycle-job] transport failure:', message);
    return new ApiError(
      'Could not reach the database. Check the Supabase configuration at /api/health.',
      502
    );
  }
  return new ApiError(message || fallback, 400);
}

export default withApiDefaults(['GET', 'POST'], async (req, res) => {
  const context = await requireAuthenticatedUser(req);
  requireRole(context, 'hod', 'admin');

  // ── Status ────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await context.asUser.rpc('get_cycle_job_status');
    if (error) throw toClientError(error, 'Could not load job status.');
    sendSuccess(res, 'Job status loaded.', data ?? {});
    return;
  }

  // ── Fire ──────────────────────────────────────────────────────────
  await enforceRateLimit(context, { key: 'cycle-job', max: 40, windowSeconds: 300 });
  const body = parseOrThrow(cycleJobSchema, req.body ?? {});

  if (body.job_type === 'all') {
    // Order matters: sweep the flags first so the meeting dispatch acts on
    // fresh data rather than last cycle's verdict.
    const { data, error } = await context.asUser.rpc('run_all_cycle_jobs_now', {
      p_note: body.note ?? 'manual test run'
    });
    if (error) throw toClientError(error, 'The jobs could not be run.');

    await recordAuditEntry(context, req, 'hod.run_cycle_job', {
      type: 'cycle_job_runs',
      metadata: { job_type: 'all', trigger_source: body.trigger_source }
    });

    sendSuccess(res, 'Ran the at-risk sweep, the meeting dispatch and a new survey cycle.', data ?? {});
    return;
  }

  const { data, error } = await context.asUser.rpc('run_cycle_job', {
    p_job_type: body.job_type,
    p_trigger: body.trigger_source,
    p_note: body.note ?? null
  });
  if (error) throw toClientError(error, 'The job could not be run.');

  await recordAuditEntry(context, req, 'hod.run_cycle_job', {
    type: 'cycle_job_runs',
    id: data?.run_id ?? null,
    metadata: { job_type: body.job_type, trigger_source: body.trigger_source }
  });

  sendSuccess(
    res,
    `${JOB_LABELS[body.job_type] ?? body.job_type} finished.` +
      (body.trigger_source === 'manual' ? ' The 15-day schedule was left unchanged.' : ''),
    data ?? {}
  );
});
