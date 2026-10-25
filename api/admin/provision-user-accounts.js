/**
 * POST /api/admin/provision-user-accounts
 * HOD and administrator. Creates Supabase Auth accounts for students /
 * faculty / cluster heads (and, for the administrator, HODs) and returns
 * the temporary passwords so they can be handed out.
 *
 * Since migration 0039 a HOD works inside their own scope: a faculty
 * account they create reports to them (hod_id), a student they create can
 * only be given one of their own faculty as mentor, and only the
 * administrator creates HOD accounts. Administrator accounts are never
 * created here (supabase/scripts/create-admin-account.mjs).
 *
 * Why this needs the service role: creating an auth user and assigning a
 * non-student role are both privileged operations. Nothing else in the
 * app can mint an elevated account — see the handle_new_auth_user trigger,
 * which defaults every self-created user to 'student'.
 *
 * Body: { accounts: [{ email, full_name, role, login_id?, branch?, ... }] }
 */
import { withApiDefaults, sendSuccess, ApiError } from '../_lib/http-response.js';
import { requireAuthenticatedUser, requireRole, enforceRateLimit, recordAuditEntry } from '../_lib/request-guards.js';
import { parseOrThrow, provisionBatchSchema, assertBodySize } from '../_lib/input-validation.js';
import { env } from '../_lib/environment.js';

export default withApiDefaults(['POST'], async (req, res) => {
  assertBodySize(req, 2 * 1024 * 1024);

  const context = await requireAuthenticatedUser(req);
  requireRole(context, 'hod', 'admin');
  const isAdmin = context.profile.role === 'admin';
  await enforceRateLimit(context, { key: 'provision-accounts', max: 20, windowSeconds: 60 });

  const { accounts } = parseOrThrow(provisionBatchSchema, req.body ?? {});
  const { admin } = context;

  const created = [];
  const skipped = [];
  const failed = [];

  // A HOD's own faculty, for checking the mentor a student is given.
  let ownFaculty = null;
  if (!isAdmin && accounts.some((a) => a.role === 'student' && a.assigned_mentor_id)) {
    const { data } = await admin
      .from('user_profiles')
      .select('id')
      .eq('role', 'faculty')
      .eq('hod_id', context.profile.id);
    ownFaculty = new Set((data ?? []).map((f) => f.id));
  }

  for (const account of accounts) {
    try {
      if (account.role === 'hod' && !isAdmin) {
        failed.push({ email: account.email, reason: 'Only the administrator can create HOD accounts' });
        continue;
      }
      if (ownFaculty && account.role === 'student' && account.assigned_mentor_id && !ownFaculty.has(account.assigned_mentor_id)) {
        failed.push({ email: account.email, reason: 'That mentor does not report to you' });
        continue;
      }

      const { data: existingProfile } = await admin
        .from('user_profiles')
        .select('id, email, role')
        .ilike('email', account.email)
        .maybeSingle();

      if (existingProfile) {
        skipped.push({ email: account.email, reason: 'An account with this email already exists' });
        continue;
      }

      const temporaryPassword = env.TEMPORARY_PASSWORD;
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          role: account.role,
          full_name: account.full_name,
          login_id: account.login_id ?? null,
          branch: account.branch ?? null,
          section: account.section ?? null,
          semester_label: account.semester_label ?? null,
          department: account.department ?? 'IoT & IS',
          phone: account.phone ?? null,
          must_change_password: true
        },
        app_metadata: { role: account.role }
      });

      if (error) {
        failed.push({ email: account.email, reason: error.message });
        continue;
      }

      // A HOD's new faculty member reports to them.
      if (account.role === 'faculty' && !isAdmin) {
        const { error: mapError } = await admin
          .from('user_profiles')
          .update({ hod_id: context.profile.id, hod_email: context.profile.email })
          .eq('id', data.user.id);
        if (mapError) {
          failed.push({ email: account.email, reason: `Account created but not placed under you: ${mapError.message}` });
          continue;
        }
      }

      if (account.role === 'student' && account.assigned_mentor_id) {
        const { error: assignError } = await admin
          .from('user_profiles')
          .update({ assigned_mentor_id: account.assigned_mentor_id })
          .eq('id', data.user.id);
        if (assignError) {
          failed.push({ email: account.email, reason: `Account created but mentor assignment failed: ${assignError.message}` });
          continue;
        }
      }

      created.push({
        id: data.user.id,
        email: account.email,
        full_name: account.full_name,
        role: account.role,
        login_id: account.login_id ?? null,
        temporary_password: temporaryPassword
      });
    } catch (error) {
      failed.push({ email: account.email, reason: error.message });
    }
  }

  await recordAuditEntry(context, req, 'admin.provision_accounts', {
    type: 'user_profiles',
    metadata: { requested: accounts.length, created: created.length, skipped: skipped.length, failed: failed.length }
  });

  if (!created.length && failed.length && !skipped.length) {
    throw new ApiError(`No accounts could be created. First error: ${failed[0].reason}`, 400);
  }

  sendSuccess(
    res,
    `Created ${created.length} account(s). ${skipped.length} skipped, ${failed.length} failed.`,
    { created, skipped, failed },
    201
  );
});
