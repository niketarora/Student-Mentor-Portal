-- =====================================================================
-- 0002  User profiles  (mirrors auth.users, holds all app-level identity)
-- =====================================================================
-- auth.users is owned by Supabase Auth and must not be written to directly.
-- public.user_profiles is the application-facing identity table. One row per
-- auth user, created automatically by an AFTER INSERT trigger on auth.users.
-- =====================================================================

create table if not exists public.user_profiles (
  id                          uuid primary key references auth.users (id) on delete cascade,

  -- identity ---------------------------------------------------------
  role                        public.user_role   not null default 'student',
  full_name                   text               not null,
  email                       text               not null,
  login_id                    text,                       -- registration no. / faculty ID (display + roster matching)
  phone                       text,
  department                  text               not null default 'IoT & IS',
  branch                      text,
  section                     text,
  semester_label              text,                       -- e.g. '3rd Semester'
  avatar_url                  text,

  -- student <-> faculty relationship ---------------------------------
  assigned_mentor_id          uuid references public.user_profiles (id) on delete set null,

  -- Feature 7 — star mentee / student representative -----------------
  is_star_mentee              boolean            not null default false,
  star_mentee_assigned_by     uuid references public.user_profiles (id) on delete set null,
  star_mentee_assigned_at     timestamptz,

  -- Feature 8 — faculty employment + reserve pool --------------------
  employment_status           public.employment_status not null default 'active',
  available_for_reassignment  boolean            not null default true,
  mentee_capacity             integer            not null default 30,

  -- Feature 1 — onboarding gate --------------------------------------
  form_a_completed            boolean            not null default false,
  form_a_completed_at         timestamptz,

  -- account lifecycle -------------------------------------------------
  must_change_password        boolean            not null default true,
  is_active                   boolean            not null default true,
  last_login_at               timestamptz,

  created_at                  timestamptz        not null default now(),
  updated_at                  timestamptz        not null default now(),

  -- integrity rules ---------------------------------------------------
  constraint user_profiles_full_name_not_blank
    check (public.is_non_blank(full_name)),
  constraint user_profiles_email_shape
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint user_profiles_mentee_capacity_sane
    check (mentee_capacity between 1 and 200),
  -- only students may carry a mentor / star flag / onboarding state
  constraint user_profiles_student_only_fields
    check (
      role = 'student'
      or (assigned_mentor_id is null and is_star_mentee = false and form_a_completed = false)
    ),
  -- a user cannot mentor themselves
  constraint user_profiles_no_self_mentor
    check (assigned_mentor_id is null or assigned_mentor_id <> id)
);

comment on table  public.user_profiles is 'Application identity for every authenticated user. One row per auth.users row.';
comment on column public.user_profiles.login_id is 'Registration number (students) or faculty ID. Display + roster matching only — login is by email.';
comment on column public.user_profiles.assigned_mentor_id is 'Flat FK, not a join table. Bulk reassignment (Feature 8) is a single UPDATE.';

create unique index if not exists user_profiles_email_unique_idx
  on public.user_profiles (lower(email));
create unique index if not exists user_profiles_login_id_unique_idx
  on public.user_profiles (lower(login_id)) where login_id is not null;
create index if not exists user_profiles_role_idx              on public.user_profiles (role);
create index if not exists user_profiles_assigned_mentor_idx   on public.user_profiles (assigned_mentor_id) where assigned_mentor_id is not null;
create index if not exists user_profiles_employment_status_idx on public.user_profiles (employment_status) where role = 'faculty';
create index if not exists user_profiles_full_name_trgm_idx    on public.user_profiles using gin (full_name extensions.gin_trgm_ops);

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------
-- Auto-provision a profile whenever Supabase Auth creates a user.
-- Metadata is supplied by the admin provisioning API (service role) in
-- raw_user_meta_data; anything missing falls back to a safe default.
-- SECURITY: role always defaults to 'student'. A self-signed-up user can
-- never mint themselves a faculty/hod profile — only the service-role
-- provisioning endpoint sets a different role.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  meta            jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_role  text  := coalesce(meta ->> 'role', 'student');
  resolved_role   public.user_role;
begin
  -- Only accept a non-student role if it is one we recognise.
  if requested_role in ('student', 'faculty', 'hod') then
    resolved_role := requested_role::public.user_role;
  else
    resolved_role := 'student';
  end if;

  insert into public.user_profiles (
    id, role, full_name, email, login_id, phone,
    department, branch, section, semester_label, must_change_password
  )
  values (
    new.id,
    resolved_role,
    coalesce(nullif(btrim(meta ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(btrim(meta ->> 'login_id'), ''),
    nullif(btrim(meta ->> 'phone'), ''),
    coalesce(nullif(btrim(meta ->> 'department'), ''), 'IoT & IS'),
    nullif(btrim(meta ->> 'branch'), ''),
    nullif(btrim(meta ->> 'section'), ''),
    nullif(btrim(meta ->> 'semester_label'), ''),
    coalesce((meta ->> 'must_change_password')::boolean, true)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Keep the email column in sync if it is changed via Supabase Auth.
-- ---------------------------------------------------------------------
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.user_profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_email_changed on auth.users;
create trigger trg_on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();
