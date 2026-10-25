-- =====================================================================
-- 0016  Fix: infinite recursion in the user_profiles SELECT policies
-- =====================================================================
-- SYMPTOM
--   Every read of user_profiles returned HTTP 500 with:
--     "infinite recursion detected in policy for relation user_profiles"
--   which broke login, because the app loads the caller's profile
--   immediately after signInWithPassword().
--
-- CAUSE
--   profiles_select_own_mentor let a student read their mentor's row:
--
--     using ( id = (select assigned_mentor_id
--                     from public.user_profiles me
--                    where me.id = auth.uid()) )
--
--   That subquery reads user_profiles from inside a policy that is
--   itself being evaluated on user_profiles. A subquery in a policy runs
--   as the INVOKING user, so RLS applies to it too -- which re-evaluates
--   the same policy, forever. Postgres detects the cycle and aborts.
--
--   The other policies on this table are safe: profiles_select_self and
--   profiles_select_own_mentees compare columns directly, and
--   is_faculty() / is_hod() are SECURITY DEFINER, so they run as the
--   table owner and are not subject to RLS at all.
--
-- FIX
--   Move the lookup into a SECURITY DEFINER function. Same result, but
--   it executes as the owner, so reading user_profiles inside it does
--   not re-enter the policy.
--
-- Safe to run on an existing database, and safe to run more than once.
-- =====================================================================

create or replace function public.my_mentor_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select assigned_mentor_id
    from public.user_profiles
   where id = auth.uid();
$$;

comment on function public.my_mentor_id is
  'Returns the caller''s assigned mentor. SECURITY DEFINER so it can be used inside a user_profiles policy without recursing into that policy.';

revoke all on function public.my_mentor_id() from public, anon;
grant execute on function public.my_mentor_id() to authenticated, service_role;

-- ── Replace the recursive policy ─────────────────────────────────────
drop policy if exists profiles_select_own_mentor on public.user_profiles;

create policy profiles_select_own_mentor on public.user_profiles
  for select to authenticated
  using (id = public.my_mentor_id());

-- ── Same treatment for the ticket INSERT check ───────────────────────
-- Not recursive (different table), but its inline subquery still forced a
-- full RLS evaluation of user_profiles on every ticket insert. Routing it
-- through the same helper is both correct and faster.
drop policy if exists tickets_insert_own on public.support_tickets;

create policy tickets_insert_own on public.support_tickets
  for insert to authenticated
  with check (
    public.is_student()
    and student_id = auth.uid()
    and mentor_id = public.my_mentor_id()
  );
