/**
 * make-administrator.mjs
 * ---------------------------------------------------------------------
 * Gives an account the administrator role. Shared by
 * create-admin-account.mjs (npm run db:admin) and seed-demo-accounts.mjs.
 *
 * Why the scripts need this: Supabase Auth's admin createUser() inserts
 * the auth user first and writes app_metadata in a second statement of
 * the same transaction. handle_new_auth_user (0039) runs on that insert,
 * before app_metadata.role is there, so it files the account as a student,
 * which is its safe default. The role is therefore set here, with the
 * service role, once the account exists.
 *
 * Not a module to run on its own.
 */

/**
 * Makes the account with this id the administrator.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db  service-role client
 * @param {string} userId  the auth user's id (= the profile's id)
 */
export async function makeAdministrator(db, userId) {
  // The service role has no auth.uid(), which the profile guard treats as a
  // trusted server call. The mentor-HOD mapping columns belong to faculty
  // only (0039), so they are cleared in the same update.
  const { data, error } = await db
    .from('user_profiles')
    .update({ role: 'admin', hod_id: null, mentor_section: null, mentor_designation: null })
    .eq('id', userId)
    .select('id');
  if (error) throw error;
  if (!data?.length) {
    throw new Error('The account has no profile. Apply every migration (npm run db:push), then run this again.');
  }

  // Filed as a student, the account was enrolled in the active academic
  // cycle (0036). Changing the role does not take it out again.
  const { error: enrolmentError } = await db.from('academic_cycle_students').delete().eq('student_id', userId);
  if (enrolmentError) throw enrolmentError;

  // Keep the auth record in step with the profile.
  const { error: authError } = await db.auth.admin.updateUserById(userId, { app_metadata: { role: 'admin' } });
  if (authError) throw authError;
}

/**
 * True for an account one of these scripts created as the administrator:
 * it asked for the role in user_metadata, which a portal-made student
 * account never does (the portal cannot create an administrator).
 *
 * @param {{ user_metadata?: Record<string, unknown> } | null | undefined} authUser
 */
export function wasCreatedAsAdministrator(authUser) {
  return authUser?.user_metadata?.role === 'admin';
}
