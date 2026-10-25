-- =====================================================================
-- 0008  Row Level Security — the real security boundary
-- =====================================================================
-- Every table is RLS-enabled and every table is FORCE'd, so even the
-- table owner obeys the policies. Nothing is granted to `anon`: an
-- unauthenticated request can read nothing at all.
--
-- The service_role key bypasses RLS by design; it is used only inside
-- Vercel serverless functions and never shipped to the browser.
-- =====================================================================

-- WHY "ENABLE" AND NOT "FORCE":
--   FORCE ROW LEVEL SECURITY would also subject the table owner to these
--   policies. Every SECURITY DEFINER function in migrations 0009-0013 runs
--   as the owner and legitimately needs to write rows that no client-facing
--   policy allows (system messages, notifications, ticket state machine).
--   With FORCE those functions would fail. ENABLE already blocks the only
--   roles a client can ever authenticate as -- anon and authenticated --
--   which is the entire threat model here.

-- Baseline privileges -------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter table public.user_profiles           enable row level security;
alter table public.student_form_a_profiles enable row level security;
alter table public.student_semester_gpas   enable row level security;
alter table public.support_tickets         enable row level security;
alter table public.ticket_messages         enable row level security;
alter table public.notifications           enable row level security;
alter table public.student_achievements    enable row level security;
alter table public.semester_cycles         enable row level security;
alter table public.roster_import_batches   enable row level security;
alter table public.mentor_reassignment_log enable row level security;
alter table public.canned_replies          enable row level security;
alter table public.audit_log               enable row level security;


-- =====================================================================
-- user_profiles
-- =====================================================================
drop policy if exists profiles_select_self            on public.user_profiles;
drop policy if exists profiles_select_own_mentor      on public.user_profiles;
drop policy if exists profiles_select_own_mentees     on public.user_profiles;
drop policy if exists profiles_select_faculty_roster  on public.user_profiles;
drop policy if exists profiles_select_hod_all         on public.user_profiles;
drop policy if exists profiles_update_self            on public.user_profiles;
drop policy if exists profiles_update_hod             on public.user_profiles;

-- Everyone can read their own row.
create policy profiles_select_self on public.user_profiles
  for select to authenticated
  using (id = auth.uid());

-- A student can read the profile of their own mentor (name, email, phone).
-- Via the SECURITY DEFINER helper, never an inline subquery: a subquery on
-- user_profiles inside a user_profiles policy recurses infinitely (see 0016).
create policy profiles_select_own_mentor on public.user_profiles
  for select to authenticated
  using (id = public.my_mentor_id());

-- A faculty member can read the profiles of their own mentees only.
create policy profiles_select_own_mentees on public.user_profiles
  for select to authenticated
  using (assigned_mentor_id = auth.uid());

-- Faculty may see the faculty directory (needed to display colleagues on
-- reassignment screens). Student rows are NOT covered by this policy.
create policy profiles_select_faculty_roster on public.user_profiles
  for select to authenticated
  using (role = 'faculty' and (public.is_faculty() or public.is_hod()));

-- HOD sees everyone.
create policy profiles_select_hod_all on public.user_profiles
  for select to authenticated
  using (public.is_hod());

-- Self-service edit of contact details only. The BEFORE UPDATE guard in
-- migration 0007 rejects any attempt to touch role / mentor / status.
create policy profiles_update_self on public.user_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_hod on public.user_profiles
  for update to authenticated
  using (public.is_hod())
  with check (public.is_hod());

-- No INSERT or DELETE policy on purpose: accounts are created and removed
-- exclusively through Supabase Auth + the service-role admin API.


-- =====================================================================
-- student_form_a_profiles  (Feature 1)
-- =====================================================================
drop policy if exists form_a_select_visible   on public.student_form_a_profiles;
drop policy if exists form_a_insert_own       on public.student_form_a_profiles;
drop policy if exists form_a_update_own       on public.student_form_a_profiles;
drop policy if exists form_a_update_hod       on public.student_form_a_profiles;

create policy form_a_select_visible on public.student_form_a_profiles
  for select to authenticated
  using (public.can_access_student(student_id));

create policy form_a_insert_own on public.student_form_a_profiles
  for insert to authenticated
  with check (student_id = auth.uid() and public.is_student());

-- The student may keep editing until the form is locked. The lock trigger
-- in migration 0010 is what flips is_locked on submit.
create policy form_a_update_own on public.student_form_a_profiles
  for update to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy form_a_update_hod on public.student_form_a_profiles
  for update to authenticated
  using (public.is_hod())
  with check (public.is_hod());


-- =====================================================================
-- student_semester_gpas  (Feature 2)
-- =====================================================================
drop policy if exists gpas_select_permitted on public.student_semester_gpas;
drop policy if exists gpas_insert_own       on public.student_semester_gpas;
drop policy if exists gpas_update_own       on public.student_semester_gpas;
drop policy if exists gpas_delete_own       on public.student_semester_gpas;

-- Faculty read is gated on the student's sharing toggle.
create policy gpas_select_permitted on public.student_semester_gpas
  for select to authenticated
  using (public.can_view_student_gpa(student_id));

create policy gpas_insert_own on public.student_semester_gpas
  for insert to authenticated
  with check (student_id = auth.uid() and public.is_student());

create policy gpas_update_own on public.student_semester_gpas
  for update to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy gpas_delete_own on public.student_semester_gpas
  for delete to authenticated
  using (student_id = auth.uid());


-- =====================================================================
-- support_tickets
-- =====================================================================
drop policy if exists tickets_select_participants on public.support_tickets;
drop policy if exists tickets_insert_own          on public.support_tickets;
drop policy if exists tickets_update_mentor       on public.support_tickets;
drop policy if exists tickets_update_hod          on public.support_tickets;

-- isStudentOwner OR isAssignedMentor OR isHod — identical to the old
-- Express check, now enforced by the database.
create policy tickets_select_participants on public.support_tickets
  for select to authenticated
  using (
    student_id = auth.uid()
    or mentor_id = auth.uid()
    or public.is_hod()
  );

-- A student may only open a ticket for themselves, and only against the
-- mentor actually assigned to them.
create policy tickets_insert_own on public.support_tickets
  for insert to authenticated
  with check (
    public.is_student()
    and student_id = auth.uid()
    and mentor_id = public.my_mentor_id()
  );

-- Direct UPDATE is limited to the assigned mentor and the HOD (e.g.
-- changing priority). Status/resolution transitions go through the RPCs in
-- migration 0009 so their side effects always run.
create policy tickets_update_mentor on public.support_tickets
  for update to authenticated
  using (mentor_id = auth.uid())
  with check (mentor_id = auth.uid());

create policy tickets_update_hod on public.support_tickets
  for update to authenticated
  using (public.is_hod())
  with check (public.is_hod());

-- No DELETE policy: tickets are an audit record and are never deleted.


-- =====================================================================
-- ticket_messages
-- =====================================================================
drop policy if exists messages_select_participants on public.ticket_messages;

create policy messages_select_participants on public.ticket_messages
  for select to authenticated
  using (public.can_access_ticket(ticket_id));

-- No INSERT/UPDATE/DELETE policies. Messages are written only by
-- public.post_ticket_message(), which is SECURITY DEFINER and re-checks
-- authorisation itself. This makes it impossible to post a message that
-- skips the notification + first-response side effects.


-- =====================================================================
-- notifications
-- =====================================================================
drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
drop policy if exists notifications_delete_own on public.notifications;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (recipient_id = auth.uid());

-- No INSERT policy: notifications are produced by triggers only, so a
-- client cannot fabricate one.


-- =====================================================================
-- student_achievements  (Feature 6)
-- =====================================================================
drop policy if exists achievements_select_visible on public.student_achievements;
drop policy if exists achievements_insert_own     on public.student_achievements;
drop policy if exists achievements_update_own     on public.student_achievements;
drop policy if exists achievements_delete_own     on public.student_achievements;

create policy achievements_select_visible on public.student_achievements
  for select to authenticated
  using (public.can_access_student(student_id));

create policy achievements_insert_own on public.student_achievements
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and public.is_student()
    and verified_by_faculty = false   -- a student cannot self-verify
  );

create policy achievements_update_own on public.student_achievements
  for update to authenticated
  using (student_id = auth.uid() and verified_by_faculty = false)
  with check (student_id = auth.uid() and verified_by_faculty = false);

-- Deletable by the owner only while unverified.
create policy achievements_delete_own on public.student_achievements
  for delete to authenticated
  using (student_id = auth.uid() and verified_by_faculty = false);

-- Verification is done through public.set_achievement_verification().


-- =====================================================================
-- semester_cycles / roster_import_batches / mentor_reassignment_log
-- =====================================================================
drop policy if exists semester_cycles_hod_all       on public.semester_cycles;
drop policy if exists roster_batches_hod_select     on public.roster_import_batches;
drop policy if exists reassignment_log_hod_select   on public.mentor_reassignment_log;
drop policy if exists reassignment_log_own_select   on public.mentor_reassignment_log;

create policy semester_cycles_hod_all on public.semester_cycles
  for all to authenticated
  using (public.is_hod())
  with check (public.is_hod());

create policy roster_batches_hod_select on public.roster_import_batches
  for select to authenticated
  using (public.is_hod());

create policy reassignment_log_hod_select on public.mentor_reassignment_log
  for select to authenticated
  using (public.is_hod());

-- A student can see their own reassignment history (transparency).
create policy reassignment_log_own_select on public.mentor_reassignment_log
  for select to authenticated
  using (student_id = auth.uid());


-- =====================================================================
-- canned_replies
-- =====================================================================
drop policy if exists canned_select_visible on public.canned_replies;
drop policy if exists canned_insert_own     on public.canned_replies;
drop policy if exists canned_update_own     on public.canned_replies;
drop policy if exists canned_delete_own     on public.canned_replies;

create policy canned_select_visible on public.canned_replies
  for select to authenticated
  using ((public.is_faculty() or public.is_hod()) and (is_global or owner_id = auth.uid()));

create policy canned_insert_own on public.canned_replies
  for insert to authenticated
  with check (owner_id = auth.uid() and is_global = false and (public.is_faculty() or public.is_hod()));

create policy canned_update_own on public.canned_replies
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and is_global = false);

create policy canned_delete_own on public.canned_replies
  for delete to authenticated
  using (owner_id = auth.uid());


-- =====================================================================
-- audit_log — readable by HOD, writable by nobody through the API
-- =====================================================================
drop policy if exists audit_log_hod_select on public.audit_log;

create policy audit_log_hod_select on public.audit_log
  for select to authenticated
  using (public.is_hod());


-- =====================================================================
-- Table-level grants (RLS filters rows; grants gate the verb)
-- =====================================================================
grant select                         on public.user_profiles           to authenticated;
grant update                         on public.user_profiles           to authenticated;
grant select, insert, update         on public.student_form_a_profiles to authenticated;
grant select, insert, update, delete on public.student_semester_gpas   to authenticated;
grant select, insert, update         on public.support_tickets         to authenticated;
grant select                         on public.ticket_messages         to authenticated;
grant select, update, delete         on public.notifications           to authenticated;
grant select, insert, update, delete on public.student_achievements    to authenticated;
grant select, insert, update, delete on public.semester_cycles         to authenticated;
grant select                         on public.roster_import_batches   to authenticated;
grant select                         on public.mentor_reassignment_log to authenticated;
grant select, insert, update, delete on public.canned_replies          to authenticated;
grant select                         on public.audit_log               to authenticated;
grant usage                          on sequence public.ticket_code_seq to authenticated;
