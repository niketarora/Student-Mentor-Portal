-- =====================================================================
-- 0007  Authorization helpers
-- =====================================================================
-- These are the database-level equivalents of the Express guards that the
-- old codebase had in ticket.controller.js:
--     isStudentOwner  ->  ticket.student_id = auth.uid()
--     isAssignedMentor->  public.is_mentor_of_ticket()
--     isHod           ->  public.is_hod()
-- The logic is unchanged; only its enforcement point moved from Node
-- middleware into Postgres, where it also covers Realtime subscriptions
-- and any direct PostgREST call.
--
-- All helpers are SECURITY DEFINER so they can read user_profiles without
-- tripping that table's own RLS (which would otherwise recurse), and all
-- pin search_path so a malicious schema on the path cannot hijack them.
-- =====================================================================

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.user_profiles where id = auth.uid();
$$;

create or replace function public.is_hod()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'hod' and is_active
  );
$$;

create or replace function public.is_faculty()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'faculty' and is_active
  );
$$;

create or replace function public.is_student()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'student' and is_active
  );
$$;

-- Is the caller the assigned mentor of this student?  (isAssignedMentor)
create or replace function public.is_mentor_of(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles s
    where s.id = p_student_id
      and s.assigned_mentor_id = auth.uid()
  );
$$;

-- The caller's assigned mentor.
-- MUST be SECURITY DEFINER: this is used inside a policy ON user_profiles,
-- and an inline subquery there would re-enter that same policy and recurse.
create or replace function public.my_mentor_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select assigned_mentor_id from public.user_profiles where id = auth.uid();
$$;

-- Caller may read this student's record: themselves, their mentor, or HOD.
create or replace function public.can_access_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_student_id = auth.uid()
      or public.is_mentor_of(p_student_id)
      or public.is_hod();
$$;

-- Caller may read this ticket: owner, assigned mentor, or HOD.
create or replace function public.can_access_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket_id
      and (
        t.student_id = auth.uid()          -- isStudentOwner
        or t.mentor_id = auth.uid()        -- isAssignedMentor
        or public.is_hod()                 -- isHod
      )
  );
$$;

-- Feature 2 gate: may the caller see this student's GPA rows?
-- Student always sees their own. HOD always sees them (institutional
-- oversight). Faculty see them only if the student has sharing enabled.
create or replace function public.can_view_student_gpa(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case
      when p_student_id = auth.uid() then true
      when public.is_hod() then true
      when public.is_mentor_of(p_student_id) then coalesce(
        (select f.gpa_sharing_enabled
           from public.student_form_a_profiles f
          where f.student_id = p_student_id),
        true)
      else false
    end;
$$;

comment on function public.can_view_student_gpa is
  'Feature 2 — faculty read of semester GPAs is gated on the student''s gpa_sharing_enabled flag. Enforced in RLS, so it cannot be bypassed by calling PostgREST directly.';

-- Lock these down: only authenticated sessions may call them.
revoke all on function public.current_user_role()               from public, anon;
revoke all on function public.is_hod()                          from public, anon;
revoke all on function public.is_faculty()                       from public, anon;
revoke all on function public.is_student()                       from public, anon;
revoke all on function public.my_mentor_id()                      from public, anon;
revoke all on function public.is_mentor_of(uuid)                 from public, anon;
revoke all on function public.can_access_student(uuid)           from public, anon;
revoke all on function public.can_access_ticket(uuid)            from public, anon;
revoke all on function public.can_view_student_gpa(uuid)         from public, anon;

grant execute on function public.current_user_role()             to authenticated, service_role;
grant execute on function public.is_hod()                        to authenticated, service_role;
grant execute on function public.is_faculty()                    to authenticated, service_role;
grant execute on function public.is_student()                    to authenticated, service_role;
grant execute on function public.my_mentor_id()                  to authenticated, service_role;
grant execute on function public.is_mentor_of(uuid)              to authenticated, service_role;
grant execute on function public.can_access_student(uuid)        to authenticated, service_role;
grant execute on function public.can_access_ticket(uuid)         to authenticated, service_role;
grant execute on function public.can_view_student_gpa(uuid)      to authenticated, service_role;

-- =====================================================================
-- Privilege-escalation guard on user_profiles
-- =====================================================================
-- RLS lets a user UPDATE their own profile row. Without this trigger they
-- could set role = 'hod' on themselves, or reassign their own mentor.
-- Protected columns may only change when the statement runs as the
-- service role (admin API) or as an HOD.
-- =====================================================================
create or replace function public.guard_protected_profile_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  is_privileged boolean;
begin
  -- Three ways a protected column may legitimately change:
  --   1. no end-user session at all  -> a trusted server / migration call
  --   2. the caller is the HOD       -> department administration
  --   3. ssmp.trusted_operation = on -> we are inside one of the audited
  --      SECURITY DEFINER RPCs (submit_student_form_a, set_star_mentee,
  --      reassign_mentees, ...) which have already done their own
  --      authorisation check. The flag is transaction-local and is always
  --      cleared by the function that set it, so it cannot leak.
  is_privileged := (auth.uid() is null)
                or coalesce(current_setting('ssmp.trusted_operation', true), 'off') = 'on'
                or public.is_hod();

  if is_privileged then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Not permitted: role cannot be changed by the account holder'
      using errcode = '42501';
  end if;
  if new.assigned_mentor_id is distinct from old.assigned_mentor_id then
    raise exception 'Not permitted: mentor assignment is managed by the HOD'
      using errcode = '42501';
  end if;
  if new.is_star_mentee is distinct from old.is_star_mentee
     or new.star_mentee_assigned_by is distinct from old.star_mentee_assigned_by then
    raise exception 'Not permitted: star mentee is set by the assigned mentor'
      using errcode = '42501';
  end if;
  if new.employment_status is distinct from old.employment_status
     or new.available_for_reassignment is distinct from old.available_for_reassignment then
    raise exception 'Not permitted: employment status is managed by the HOD'
      using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Not permitted: account activation is managed by the HOD'
      using errcode = '42501';
  end if;
  if new.form_a_completed is distinct from old.form_a_completed then
    raise exception 'Not permitted: onboarding status is set by submitting Form A'
      using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Not permitted: identity fields are managed by Supabase Auth'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_protected_profile_columns on public.user_profiles;
create trigger trg_guard_protected_profile_columns
  before update on public.user_profiles
  for each row execute function public.guard_protected_profile_columns();

comment on function public.guard_protected_profile_columns is
  'Blocks self-service privilege escalation. Role, mentor, star flag, employment status and activation can only be changed by an HOD or the service role.';
