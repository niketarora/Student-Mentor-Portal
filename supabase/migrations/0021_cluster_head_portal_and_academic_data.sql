-- =====================================================================
-- 0021  Cluster Head portal — setup, courses, and the academic data feeds
-- =====================================================================
-- A Cluster Head uploads two things and nothing else:
--   * attendance          — every 15 days (but see the note on timing)
--   * backlogs + GPA      — every 6 months
--
-- TIMING IS DELIBERATELY UNCONSTRAINED
-- ---------------------------------------------------------------------
-- There is NO date gate anywhere in this file. A Cluster Head may upload
-- on the 3rd, the 15th, the 27th, twice in one day, or six weeks late.
-- The upload is always allowed. This is intentional and load-bearing:
-- the 15-day recurring jobs (survey generation, the at-risk meeting
-- dispatch) live in migration 0024 on their own schedule and are never
-- advanced, delayed or otherwise influenced by when an upload happens.
-- The only thing an upload does to that machinery is re-evaluate the
-- affected students' risk flags immediately, which is a data-freshness
-- concern rather than a scheduling one.
--
-- WHAT A CLUSTER HEAD CANNOT SEE
-- ---------------------------------------------------------------------
-- No RLS policy in this file grants a Cluster Head read access to
-- user_profiles, support_tickets, Form A or anything else. Matching an
-- uploaded row to a student happens inside resolve_students_for_upload(),
-- a SECURITY DEFINER function that returns a narrow projection (id,
-- registration number, name, section) and nothing more — the same
-- technique get_mentor_group_tickets() uses for the star mentee.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Profile columns for the one-time setup gate
-- ---------------------------------------------------------------------
alter table public.user_profiles
  add column if not exists cluster_head_setup_completed    boolean not null default false;
alter table public.user_profiles
  add column if not exists cluster_head_setup_completed_at timestamptz;

comment on column public.user_profiles.cluster_head_setup_completed is
  'Cluster Head one-time setup form. Mirrors form_a_completed for students: the portal is route-gated until this is true.';


-- ---------------------------------------------------------------------
-- 2. Role helper + the auth trigger must learn the new role
-- ---------------------------------------------------------------------
create or replace function public.is_cluster_head()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'cluster_head' and is_active
  );
$$;

revoke all on function public.is_cluster_head() from public, anon;
grant execute on function public.is_cluster_head() to authenticated, service_role;

-- handle_new_auth_user() previously accepted only student/faculty/hod and
-- silently downgraded anything else to 'student'. Without this replacement
-- a provisioned Cluster Head would come back as a student.
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
  if requested_role in ('student', 'faculty', 'hod', 'cluster_head') then
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

-- The privilege-escalation guard gains one more protected column, so a
-- Cluster Head cannot flip their own setup flag with a PATCH on
-- user_profiles and skip the setup form. Everything else is verbatim from
-- migration 0007 — this is a full CREATE OR REPLACE, so the whole body has
-- to be restated.
create or replace function public.guard_protected_profile_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  is_privileged boolean;
begin
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
  if new.cluster_head_setup_completed is distinct from old.cluster_head_setup_completed then
    raise exception 'Not permitted: setup status is set by submitting the cluster head setup form'
      using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Not permitted: identity fields are managed by Supabase Auth'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. The setup form's output: one row per subject the Cluster Head handles
-- ---------------------------------------------------------------------
-- The form shows 5 blank subject blocks by default and an "Add more"
-- button; there is no upper bound here because there is no upper bound in
-- the UI either. section_count is what the Section dropdown is built from
-- later: 2 sections -> A and B, 4 -> A..D.
create table if not exists public.cluster_head_courses (
  id                uuid primary key default extensions.gen_random_uuid(),
  cluster_head_id   uuid not null references public.user_profiles (id) on delete cascade,
  course_name       text    not null,
  course_code       text    not null,
  section_count     smallint not null,
  display_order     smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint cluster_head_courses_name_not_blank  check (public.is_non_blank(course_name)),
  constraint cluster_head_courses_code_not_blank  check (public.is_non_blank(course_code)),
  -- The setup form's dropdown offers 1 through 15; the database says the
  -- same thing so a hand-crafted PostgREST call cannot smuggle in 400.
  constraint cluster_head_courses_section_count_range check (section_count between 1 and 15)
);

create unique index if not exists cluster_head_courses_unique_code_idx
  on public.cluster_head_courses (cluster_head_id, lower(course_code));

create index if not exists cluster_head_courses_owner_idx
  on public.cluster_head_courses (cluster_head_id, display_order);

drop trigger if exists trg_cluster_head_courses_updated_at on public.cluster_head_courses;
create trigger trg_cluster_head_courses_updated_at
  before update on public.cluster_head_courses
  for each row execute function public.set_updated_at_timestamp();

comment on table public.cluster_head_courses is
  'Output of the Cluster Head one-time setup form: course name, course code and how many sections that course runs.';


-- ---------------------------------------------------------------------
-- 4. Which student sits in which section of which course
-- ---------------------------------------------------------------------
-- There is deliberately no separate screen for entering this. The FIRST
-- attendance upload for a (course, section) pair is what teaches the
-- portal the mapping, exactly as the brief describes; later uploads keep
-- it current.
create table if not exists public.student_course_sections (
  id              uuid primary key default extensions.gen_random_uuid(),
  student_id      uuid not null references public.user_profiles (id) on delete cascade,
  course_id       uuid not null references public.cluster_head_courses (id) on delete cascade,
  section_label   text not null,
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint student_course_sections_label_shape
    check (section_label ~ '^[A-O]$'),
  constraint student_course_sections_unique unique (student_id, course_id)
);

create index if not exists student_course_sections_course_idx
  on public.student_course_sections (course_id, section_label);

comment on table public.student_course_sections is
  'Student -> section mapping, learned from the first attendance upload for that course/section. No separate data-entry step exists by design.';


-- ---------------------------------------------------------------------
-- 5. Every upload, with its per-row failures (mirrors roster_import_batches)
-- ---------------------------------------------------------------------
create table if not exists public.academic_upload_batches (
  id                 uuid primary key default extensions.gen_random_uuid(),
  -- Nullable on purpose. A trusted server call (the seed script, a data
  -- fix from the SQL console) has no auth.uid(), and refusing to record
  -- the batch in that case would mean the seeded data had no audit row at
  -- all. For attendance the function falls back to the owner of the
  -- course, so in practice this is only null for a seeded GPA/backlog load.
  uploaded_by        uuid references public.user_profiles (id) on delete cascade,
  upload_type        public.academic_upload_type not null,
  course_id          uuid references public.cluster_head_courses (id) on delete set null,
  section_label      text,
  period_start       date,
  period_end         date,
  semester_number    smallint,
  original_filename  text not null,
  total_rows         integer not null default 0,
  matched_rows       integer not null default 0,
  skipped_rows       integer not null default 0,
  failed_rows        integer not null default 0,
  row_errors         jsonb   not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),

  constraint academic_upload_batches_semester_range
    check (semester_number is null or semester_number between 1 and 8)
);

create index if not exists academic_upload_batches_owner_idx
  on public.academic_upload_batches (uploaded_by, created_at desc);

comment on table public.academic_upload_batches is
  'One row per Cluster Head upload (attendance / GPA / backlog), including the rows that could not be matched to a student.';


-- ---------------------------------------------------------------------
-- 6. Attendance
-- ---------------------------------------------------------------------
-- attendance_percent is GENERATED so it can never disagree with the two
-- numbers it comes from — the at-risk rule reads it directly.
create table if not exists public.student_attendance_records (
  id                  uuid primary key default extensions.gen_random_uuid(),
  student_id          uuid not null references public.user_profiles (id) on delete cascade,
  course_id           uuid not null references public.cluster_head_courses (id) on delete cascade,
  section_label       text not null,
  period_start        date not null,
  period_end          date not null,
  classes_held        integer not null,
  classes_attended    integer not null,
  attendance_percent  numeric(5,2)
    generated always as (
      case when classes_held = 0 then 0
           else round((classes_attended::numeric * 100) / classes_held, 2)
      end
    ) stored,
  batch_id            uuid references public.academic_upload_batches (id) on delete set null,
  recorded_by         uuid references public.user_profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint attendance_classes_held_sane     check (classes_held between 0 and 2000),
  constraint attendance_attended_sane         check (classes_attended >= 0 and classes_attended <= classes_held),
  constraint attendance_period_ordered        check (period_end >= period_start),
  constraint attendance_one_row_per_period    unique (student_id, course_id, period_start)
);

create index if not exists student_attendance_student_idx
  on public.student_attendance_records (student_id, period_start desc);
create index if not exists student_attendance_course_idx
  on public.student_attendance_records (course_id, section_label);

drop trigger if exists trg_student_attendance_updated_at on public.student_attendance_records;
create trigger trg_student_attendance_updated_at
  before update on public.student_attendance_records
  for each row execute function public.set_updated_at_timestamp();

comment on table public.student_attendance_records is
  'Attendance per student, per course, per reporting period. Uploaded by a Cluster Head on any day — there is no date restriction on when an upload may happen.';


-- ---------------------------------------------------------------------
-- 7. Backlogs
-- ---------------------------------------------------------------------
-- The at-risk rule needs "at least one backlog on record" — a single
-- uncleared row is enough, which is why is_cleared exists rather than a
-- bare count column that could never be walked back.
create table if not exists public.student_backlogs (
  id               uuid primary key default extensions.gen_random_uuid(),
  student_id       uuid not null references public.user_profiles (id) on delete cascade,
  subject_code     text not null,
  subject_name     text,
  semester_number  smallint,
  exam_session     text,
  is_cleared       boolean not null default false,
  cleared_at       timestamptz,
  batch_id         uuid references public.academic_upload_batches (id) on delete set null,
  recorded_by      uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint student_backlogs_code_not_blank check (public.is_non_blank(subject_code)),
  constraint student_backlogs_semester_range check (semester_number is null or semester_number between 1 and 8),
  constraint student_backlogs_unique unique (student_id, subject_code, semester_number)
);

create index if not exists student_backlogs_student_idx
  on public.student_backlogs (student_id) where is_cleared = false;

drop trigger if exists trg_student_backlogs_updated_at on public.student_backlogs;
create trigger trg_student_backlogs_updated_at
  before update on public.student_backlogs
  for each row execute function public.set_updated_at_timestamp();

comment on table public.student_backlogs is
  'One row per backlog subject. A single row with is_cleared = false is enough to satisfy the at-risk backlog condition.';


-- ---------------------------------------------------------------------
-- 8. GPA gets a provenance column
-- ---------------------------------------------------------------------
-- Feature 2 lets a student self-report GPA. The Cluster Head upload is the
-- departmental record. Both land in the same table so every existing
-- reader (the academics page, the dossier PDF, the reports) keeps working
-- untouched; `source` is what tells them apart, and a student may no
-- longer overwrite a departmental figure.
alter table public.student_semester_gpas
  add column if not exists source public.gpa_source not null default 'student';
alter table public.student_semester_gpas
  add column if not exists recorded_by uuid references public.user_profiles (id) on delete set null;
alter table public.student_semester_gpas
  add column if not exists batch_id uuid references public.academic_upload_batches (id) on delete set null;

create or replace function public.upsert_semester_gpa(
  p_semester_number smallint,
  p_gpa             numeric
)
returns public.student_semester_gpas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      public.student_semester_gpas;
  v_existing public.student_semester_gpas;
begin
  if not public.is_student() then
    raise exception 'Only a student can record their own GPA' using errcode = '42501';
  end if;
  if p_semester_number is null or p_semester_number < 1 or p_semester_number > 8 then
    raise exception 'Semester must be between 1 and 8' using errcode = '22023';
  end if;
  if p_gpa is null or p_gpa < 0 or p_gpa > 10 then
    raise exception 'GPA must be between 0 and 10' using errcode = '22023';
  end if;

  select * into v_existing
    from public.student_semester_gpas
   where student_id = auth.uid() and semester_number = p_semester_number;

  -- A departmental figure outranks a self-reported one. Silently letting a
  -- student overwrite it would mean the at-risk rule could be edited away
  -- by the very person it applies to.
  if v_existing.id is not null and v_existing.source = 'cluster_head' then
    raise exception 'Semester % GPA was published by the department and cannot be edited here', p_semester_number
      using errcode = '42501';
  end if;

  insert into public.student_semester_gpas (student_id, semester_number, gpa, source)
  values (auth.uid(), p_semester_number, round(p_gpa, 2), 'student')
  on conflict (student_id, semester_number)
    do update set gpa = excluded.gpa, source = 'student', updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;


-- =====================================================================
-- 9. Row Level Security
-- =====================================================================
alter table public.cluster_head_courses        enable row level security;
alter table public.student_course_sections     enable row level security;
alter table public.academic_upload_batches     enable row level security;
alter table public.student_attendance_records  enable row level security;
alter table public.student_backlogs            enable row level security;

-- ── cluster_head_courses ─────────────────────────────────────────────
drop policy if exists ch_courses_select_own     on public.cluster_head_courses;
drop policy if exists ch_courses_select_hod     on public.cluster_head_courses;
drop policy if exists ch_courses_write_own      on public.cluster_head_courses;

create policy ch_courses_select_own on public.cluster_head_courses
  for select to authenticated
  using (cluster_head_id = auth.uid());

create policy ch_courses_select_hod on public.cluster_head_courses
  for select to authenticated
  using (public.is_hod());

-- Insert/update/delete all go through submit_cluster_head_setup(), but the
-- policy is written anyway so a direct PostgREST call is scoped rather
-- than merely unused.
create policy ch_courses_write_own on public.cluster_head_courses
  for all to authenticated
  using (cluster_head_id = auth.uid() and public.is_cluster_head())
  with check (cluster_head_id = auth.uid() and public.is_cluster_head());

-- ── student_course_sections ──────────────────────────────────────────
drop policy if exists student_sections_select_visible on public.student_course_sections;
drop policy if exists student_sections_select_owner   on public.student_course_sections;

-- Student, their mentor, or the HOD — the same rule as every other
-- student-scoped table, via the existing helper.
create policy student_sections_select_visible on public.student_course_sections
  for select to authenticated
  using (public.can_access_student(student_id));

-- The Cluster Head who owns the course can see the mapping for it. This is
-- the ONE piece of student-adjacent data they can read, and it is exactly
-- what "match the uploaded data to the right student" requires.
create policy student_sections_select_owner on public.student_course_sections
  for select to authenticated
  using (
    exists (
      select 1 from public.cluster_head_courses c
      where c.id = student_course_sections.course_id
        and c.cluster_head_id = auth.uid()
    )
  );

-- ── academic_upload_batches ──────────────────────────────────────────
drop policy if exists academic_batches_select_own on public.academic_upload_batches;
drop policy if exists academic_batches_select_hod on public.academic_upload_batches;

create policy academic_batches_select_own on public.academic_upload_batches
  for select to authenticated
  using (uploaded_by = auth.uid());

create policy academic_batches_select_hod on public.academic_upload_batches
  for select to authenticated
  using (public.is_hod());

-- No INSERT policy: batches are written only by the record_*_batch RPCs,
-- so a client cannot fabricate an upload record without the row work.

-- ── student_attendance_records ───────────────────────────────────────
drop policy if exists attendance_select_visible on public.student_attendance_records;
drop policy if exists attendance_select_owner   on public.student_attendance_records;

create policy attendance_select_visible on public.student_attendance_records
  for select to authenticated
  using (public.can_access_student(student_id));

create policy attendance_select_owner on public.student_attendance_records
  for select to authenticated
  using (
    exists (
      select 1 from public.cluster_head_courses c
      where c.id = student_attendance_records.course_id
        and c.cluster_head_id = auth.uid()
    )
  );

-- ── student_backlogs ─────────────────────────────────────────────────
drop policy if exists backlogs_select_visible on public.student_backlogs;
drop policy if exists backlogs_select_uploader on public.student_backlogs;

create policy backlogs_select_visible on public.student_backlogs
  for select to authenticated
  using (public.can_access_student(student_id));

create policy backlogs_select_uploader on public.student_backlogs
  for select to authenticated
  using (recorded_by = auth.uid() and public.is_cluster_head());


-- Grants — RLS filters rows, grants gate the verb.
grant select, insert, update, delete on public.cluster_head_courses       to authenticated;
grant select                         on public.student_course_sections    to authenticated;
grant select                         on public.academic_upload_batches    to authenticated;
grant select                         on public.student_attendance_records to authenticated;
grant select                         on public.student_backlogs           to authenticated;


-- =====================================================================
-- 10. The setup form
-- =====================================================================
-- p_courses is the array the form collected:
--   [{ "course_name": "...", "course_code": "...", "section_count": 3 }, ...]
-- Submitting again replaces the whole list, so the Cluster Head can fix a
-- typo without an extra endpoint.
create or replace function public.submit_cluster_head_setup(p_courses jsonb)
returns setof public.cluster_head_courses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item      jsonb;
  v_index     smallint := 0;
  v_name      text;
  v_code      text;
  v_sections  smallint;
  v_seen      text[] := array[]::text[];
begin
  if not public.is_cluster_head() then
    raise exception 'Only a cluster head can submit the cluster head setup form'
      using errcode = '42501';
  end if;
  if p_courses is null or jsonb_typeof(p_courses) <> 'array' or jsonb_array_length(p_courses) = 0 then
    raise exception 'Add at least one subject before submitting' using errcode = '22023';
  end if;
  if jsonb_array_length(p_courses) > 60 then
    raise exception 'That is more subjects than one cluster head can handle (limit 60)' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_courses)
  loop
    v_name     := btrim(coalesce(v_item ->> 'course_name', ''));
    v_code     := btrim(coalesce(v_item ->> 'course_code', ''));
    v_sections := nullif(v_item ->> 'section_count', '')::smallint;

    if v_name = '' or v_code = '' then
      raise exception 'Every subject needs both a course name and a course code' using errcode = '22023';
    end if;
    if v_sections is null or v_sections < 1 or v_sections > 15 then
      raise exception 'Number of sections for "%" must be between 1 and 15', v_name using errcode = '22023';
    end if;
    if lower(v_code) = any (v_seen) then
      raise exception 'Course code "%" appears more than once', v_code using errcode = '22023';
    end if;
    v_seen := v_seen || lower(v_code);
    v_index := v_index + 1;
  end loop;

  -- Replace the list wholesale. ON DELETE CASCADE would take the section
  -- mapping and attendance with it, so only codes that actually went away
  -- are removed.
  delete from public.cluster_head_courses
   where cluster_head_id = auth.uid()
     and lower(course_code) <> all (v_seen);

  v_index := 0;
  for v_item in select * from jsonb_array_elements(p_courses)
  loop
    v_index := v_index + 1;
    insert into public.cluster_head_courses (cluster_head_id, course_name, course_code, section_count, display_order)
    values (
      auth.uid(),
      btrim(v_item ->> 'course_name'),
      btrim(v_item ->> 'course_code'),
      (v_item ->> 'section_count')::smallint,
      v_index
    )
    on conflict (cluster_head_id, lower(course_code)) do update
      set course_name   = excluded.course_name,
          section_count = excluded.section_count,
          display_order = excluded.display_order,
          updated_at    = now();
  end loop;

  -- cluster_head_setup_completed is a protected column (see the guard
  -- above), so the trusted-operation flag has to be raised and cleared
  -- around the write. §10.3.
  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set cluster_head_setup_completed    = true,
         cluster_head_setup_completed_at = coalesce(cluster_head_setup_completed_at, now())
   where id = auth.uid();
  perform set_config('ssmp.trusted_operation', 'off', true);

  return query
    select * from public.cluster_head_courses
     where cluster_head_id = auth.uid()
     order by display_order;
end;
$$;


-- =====================================================================
-- 11. Narrow student lookup for upload matching
-- =====================================================================
-- The ONLY window a Cluster Head has onto the student body. Returns four
-- columns and no more: no email address is exposed unless it was the
-- identifier they already typed into their own spreadsheet, no mentor, no
-- phone, no Form A, no tickets.
create or replace function public.resolve_students_for_upload(p_identifiers text[])
returns table (
  student_id      uuid,
  registration_no text,
  full_name       text,
  section         text,
  matched_on      text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can resolve students for an upload'
      using errcode = '42501';
  end if;
  if p_identifiers is null or array_length(p_identifiers, 1) is null then
    return;
  end if;
  if array_length(p_identifiers, 1) > 5000 then
    raise exception 'Too many identifiers in one call (limit 5000)' using errcode = '22023';
  end if;

  return query
  select p.id,
         p.login_id,
         p.full_name,
         p.section,
         case when lower(p.login_id) = any (select lower(i) from unnest(p_identifiers) i)
              then 'registration_no' else 'email' end
    from public.user_profiles p
   where p.role = 'student'
     and p.is_active
     and (
       lower(coalesce(p.login_id, '')) = any (select lower(i) from unnest(p_identifiers) i)
       or lower(p.email) = any (select lower(i) from unnest(p_identifiers) i)
     );
end;
$$;

comment on function public.resolve_students_for_upload is
  'Narrow projection used to match uploaded rows to students. Deliberately returns no contact details, mentor, or academic history — a cluster head has no other read path into user_profiles.';


revoke all on function public.submit_cluster_head_setup(jsonb)      from public, anon;
revoke all on function public.resolve_students_for_upload(text[])   from public, anon;
grant execute on function public.submit_cluster_head_setup(jsonb)    to authenticated;
grant execute on function public.resolve_students_for_upload(text[]) to authenticated, service_role;
