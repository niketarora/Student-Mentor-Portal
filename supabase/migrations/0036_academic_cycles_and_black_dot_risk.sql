-- =====================================================================
-- 0036  Academic cycles, and black dots join the at-risk rule
-- =====================================================================
-- ACADEMIC CYCLES
-- ---------------------------------------------------------------------
-- A cycle is one academic year ("2026-27") with two semesters: the odd
-- semester (July to December of the first year) and the even semester
-- (January to June of the second). It is deliberately NOT a semester:
--
--   Cycle     2026-27
--   Semester  Odd (2026) / Even (2027)       <- a date range inside the cycle
--   Semester  1..8                           <- a student's programme semester
--
-- The three never stand in for each other. A cycle's semesters are its
-- two halves; a student's programme semester (3rd, 5th ...) is theirs.
--
-- Exactly one cycle is active. Everything recorded from now on is filed
-- against it: uploads, roster imports, subjects, attendance, backlogs,
-- black dots and at-risk meetings carry a cycle_id. Starting the next
-- cycle closes the current one and leaves every row of it where it is,
-- so 2027-28 never overwrites 2026-27.
--
-- Which SEMESTER a row belongs to is not stored; it is worked out from
-- the row's own date against the cycle's even_starts_on, so correcting
-- the dates later re-files everything consistently:
--   attendance  the period's end date
--   backlogs    the programme semester's parity (3 -> odd, 4 -> even)
--   black dots  the incident date (the upload date when the notice has none)
--   other uploads and roster imports: the day they were uploaded
--
-- What a new cycle changes:
--   * subjects: each cluster head's list is copied into it, so the old
--     cycle's subjects (and the attendance hanging off them) are never
--     edited or deleted by next year's setup;
--   * attendance: every screen and the at-risk rule read the active
--     cycle's attendance only; last year's stays in the database;
--   * students: academic_cycle_students is each cycle's own list, with
--     the semester, section, branch and mentor the student had in it.
--     Rosters, the mentor mapping and new accounts fill it; students can
--     also be carried over from the previous cycle;
--   * black dots count towards the at-risk rule only in their own cycle.
--   GPA and open backlogs are not per cycle: an uncleared backlog from
--   last year is still owed this year.
--
-- BLACK DOTS IN THE AT-RISK RULE
-- ---------------------------------------------------------------------
-- A student is now at risk when ANY of four holds: attendance below 75%,
-- latest GPA below 6, an uncleared backlog, or at least one black dot in
-- the active cycle. A black dot cannot be cleared the way a backlog can,
-- so counting the whole history would flag a student for the rest of
-- their degree; the cycle is what lets the flag lift with the new year.
-- Uploading a PB notice now re-checks every student it names.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The cycle
-- ---------------------------------------------------------------------
create table if not exists public.academic_cycles (
  id              uuid primary key default extensions.gen_random_uuid(),
  start_year      smallint not null,
  -- "2026-27", derived so it can never disagree with start_year.
  label           text generated always as (
                    start_year::text || '-' || lpad(((start_year + 1) % 100)::text, 2, '0')
                  ) stored,
  starts_on       date not null,       -- the odd semester starts
  even_starts_on  date not null,       -- the even semester starts
  ends_on         date not null,
  is_active       boolean not null default false,
  activated_at    timestamptz,
  closed_at       timestamptz,
  created_by      uuid references public.user_profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint academic_cycles_one_per_year unique (start_year),
  constraint academic_cycles_year_range check (start_year between 2000 and 2098),
  constraint academic_cycles_dates_ordered check (starts_on < even_starts_on and even_starts_on <= ends_on),
  -- The dates may be moved a little either way, but a cycle is one year.
  constraint academic_cycles_dates_near_year check (
    starts_on >= make_date(start_year - 1, 1, 1) and ends_on < make_date(start_year + 2, 1, 1)
  )
);

create unique index if not exists academic_cycles_one_active
  on public.academic_cycles ((true)) where is_active;

drop trigger if exists trg_academic_cycles_updated_at on public.academic_cycles;
create trigger trg_academic_cycles_updated_at
  before update on public.academic_cycles
  for each row execute function public.set_updated_at_timestamp();

comment on table public.academic_cycles is
  'One academic year ("2026-27") with an odd and an even semester. Exactly one is active; uploads, rosters, subjects, attendance, backlogs and black dots are filed against it. Written only by create_academic_cycle / update_academic_cycle_dates / delete_academic_cycle.';
comment on column public.academic_cycles.even_starts_on is
  'The day the even semester starts. A row dated before it is in the odd semester, on or after it in the even one.';

alter table public.academic_cycles enable row level security;

drop policy if exists academic_cycles_select_all on public.academic_cycles;
-- Not sensitive: every signed-in user may see which year is running.
create policy academic_cycles_select_all on public.academic_cycles
  for select to authenticated
  using (true);

-- Supabase grants new tables to anon and authenticated by default; keep
-- exactly SELECT for signed-in users (RLS decides the rows).
revoke all on public.academic_cycles from anon, authenticated;
grant select on public.academic_cycles to authenticated;


-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
create or replace function public.active_cycle_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.academic_cycles where is_active limit 1
$$;

comment on function public.active_cycle_id() is
  'The id of the active academic cycle, or null when none is.';

-- Odd or even, for a date inside a cycle.
create or replace function public.cycle_semester_on(p_cycle_id uuid, p_date date)
returns public.semester_term
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_date >= c.even_starts_on then 'Even'::public.semester_term
              else 'Odd'::public.semester_term end
    from public.academic_cycles c
   where c.id = p_cycle_id
$$;

-- Odd programme semesters (1, 3, 5, 7) are taught in the odd half of the
-- year, even ones in the even half.
create or replace function public.semester_term_of_number(p_semester integer)
returns public.semester_term
language sql
immutable
as $$
  select case when p_semester is null then null
              when p_semester % 2 = 1 then 'Odd'::public.semester_term
              else 'Even'::public.semester_term end
$$;

-- The cycle a date falls in, preferring the active one if two overlap.
create or replace function public.cycle_containing(p_date date)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.academic_cycles
   where p_date between starts_on and ends_on
   order by is_active desc, start_year desc
   limit 1
$$;

revoke all on function public.active_cycle_id()                    from public, anon;
revoke all on function public.cycle_semester_on(uuid, date)         from public, anon;
revoke all on function public.semester_term_of_number(integer)      from public, anon;
revoke all on function public.cycle_containing(date)                from public, anon;
grant execute on function public.active_cycle_id()                  to authenticated, service_role;
grant execute on function public.cycle_semester_on(uuid, date)      to authenticated, service_role;
grant execute on function public.semester_term_of_number(integer)   to authenticated, service_role;
grant execute on function public.cycle_containing(date)             to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. The first cycle: the academic year we are in
-- ---------------------------------------------------------------------
-- Everything recorded before cycles existed is filed under it. July is
-- when the year turns over, so September 2026 is in 2026-27 and March
-- 2027 still is.
do $$
declare
  v_year integer := extract(year from current_date)::integer
                  - case when extract(month from current_date) < 7 then 1 else 0 end;
begin
  if not exists (select 1 from public.academic_cycles) then
    insert into public.academic_cycles (start_year, starts_on, even_starts_on, ends_on, is_active, activated_at)
    values (v_year, make_date(v_year, 7, 1), make_date(v_year + 1, 1, 1), make_date(v_year + 1, 6, 30), true, now());
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4. Every recorded row carries its cycle
-- ---------------------------------------------------------------------
alter table public.academic_upload_batches  add column if not exists cycle_id uuid references public.academic_cycles (id);
alter table public.roster_import_batches    add column if not exists cycle_id uuid references public.academic_cycles (id);
alter table public.cluster_head_courses     add column if not exists cycle_id uuid references public.academic_cycles (id) on delete cascade;
alter table public.student_attendance_records add column if not exists cycle_id uuid references public.academic_cycles (id);
alter table public.student_backlogs         add column if not exists cycle_id uuid references public.academic_cycles (id);
alter table public.student_black_dots       add column if not exists cycle_id uuid references public.academic_cycles (id);
alter table public.at_risk_meetings         add column if not exists cycle_id uuid references public.academic_cycles (id) on delete set null;

comment on column public.academic_upload_batches.cycle_id is 'The academic cycle the upload was filed under (the active one at the time).';
comment on column public.roster_import_batches.cycle_id is 'The academic cycle the roster was imported into. semester_cycle_id is the retired semester-setup wizard''s link and is no longer written.';
comment on column public.cluster_head_courses.cycle_id is 'Subjects are kept per cycle. A new cycle starts with a copy of the previous list, so editing it never touches last year''s subjects or their attendance.';
comment on column public.student_attendance_records.cycle_id is 'Always the cycle of the course the row belongs to.';
comment on column public.student_backlogs.cycle_id is 'The cycle the backlog was first recorded in. A backlog stays open across cycles until a result clears it.';
comment on column public.student_black_dots.cycle_id is 'The cycle the incident falls in (by incident date), or the active cycle when the notice gives no date. Only the active cycle''s black dots count towards the at-risk rule.';
comment on column public.at_risk_meetings.cycle_id is 'The cycle that was active when the meeting was raised.';

-- What existed before cycles goes into the first one.
do $$
declare
  v_first uuid;
begin
  select id into v_first from public.academic_cycles order by is_active desc, start_year desc limit 1;
  update public.academic_upload_batches    set cycle_id = v_first where cycle_id is null;
  update public.roster_import_batches      set cycle_id = v_first where cycle_id is null;
  update public.cluster_head_courses       set cycle_id = v_first where cycle_id is null;
  update public.student_attendance_records set cycle_id = v_first where cycle_id is null;
  update public.student_backlogs           set cycle_id = v_first where cycle_id is null;
  update public.student_black_dots         set cycle_id = v_first where cycle_id is null;
  update public.at_risk_meetings           set cycle_id = v_first where cycle_id is null;
end $$;

alter table public.academic_upload_batches    alter column cycle_id set not null;
alter table public.cluster_head_courses       alter column cycle_id set not null;
alter table public.student_attendance_records alter column cycle_id set not null;
alter table public.student_backlogs           alter column cycle_id set not null;
alter table public.student_black_dots         alter column cycle_id set not null;

create index if not exists academic_upload_batches_cycle_idx    on public.academic_upload_batches (cycle_id, created_at desc);
create index if not exists roster_import_batches_cycle_idx      on public.roster_import_batches (cycle_id, created_at desc);
create index if not exists student_attendance_records_cycle_idx on public.student_attendance_records (cycle_id, student_id, course_id, period_start desc);
create index if not exists student_backlogs_cycle_idx           on public.student_backlogs (cycle_id);
create index if not exists student_black_dots_cycle_idx         on public.student_black_dots (cycle_id, student_id);

-- Filled in by triggers rather than by each writer, so every path (the
-- upload RPCs, the roster endpoint, the seed, the SQL console) files its
-- rows the same way without being told.
create or replace function public.tag_row_with_active_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.cycle_id is null then
    new.cycle_id := public.active_cycle_id();
  end if;
  if new.cycle_id is null and coalesce(tg_argv[0], '') = 'required' then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles in the Cluster Head portal, then try again.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Attendance belongs to the cycle of its course.
create or replace function public.tag_attendance_with_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.cycle_id is null then
    select cycle_id into new.cycle_id from public.cluster_head_courses where id = new.course_id;
  end if;
  if new.cycle_id is null then
    new.cycle_id := public.active_cycle_id();
  end if;
  if new.cycle_id is null then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles in the Cluster Head portal, then try again.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- A black dot belongs to the cycle its incident happened in: a notice
-- about May, uploaded in August, is last year's.
create or replace function public.tag_black_dot_with_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.cycle_id is null then
    new.cycle_id := coalesce(
      case when new.incident_date is not null then public.cycle_containing(new.incident_date) end,
      public.active_cycle_id()
    );
  end if;
  if new.cycle_id is null then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles in the Cluster Head portal, then try again.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.tag_row_with_active_cycle() from public, anon, authenticated;
revoke all on function public.tag_attendance_with_cycle() from public, anon, authenticated;
revoke all on function public.tag_black_dot_with_cycle()  from public, anon, authenticated;

drop trigger if exists trg_upload_batches_cycle on public.academic_upload_batches;
create trigger trg_upload_batches_cycle
  before insert on public.academic_upload_batches
  for each row execute function public.tag_row_with_active_cycle('required');

-- Optional: account creation must never be blocked by a missing cycle.
drop trigger if exists trg_roster_batches_cycle on public.roster_import_batches;
create trigger trg_roster_batches_cycle
  before insert on public.roster_import_batches
  for each row execute function public.tag_row_with_active_cycle('optional');

drop trigger if exists trg_courses_cycle on public.cluster_head_courses;
create trigger trg_courses_cycle
  before insert on public.cluster_head_courses
  for each row execute function public.tag_row_with_active_cycle('required');

drop trigger if exists trg_attendance_cycle on public.student_attendance_records;
create trigger trg_attendance_cycle
  before insert on public.student_attendance_records
  for each row execute function public.tag_attendance_with_cycle();

drop trigger if exists trg_backlogs_cycle on public.student_backlogs;
create trigger trg_backlogs_cycle
  before insert on public.student_backlogs
  for each row execute function public.tag_row_with_active_cycle('required');

drop trigger if exists trg_black_dots_cycle on public.student_black_dots;
create trigger trg_black_dots_cycle
  before insert on public.student_black_dots
  for each row execute function public.tag_black_dot_with_cycle();

drop trigger if exists trg_at_risk_meetings_cycle on public.at_risk_meetings;
create trigger trg_at_risk_meetings_cycle
  before insert on public.at_risk_meetings
  for each row execute function public.tag_row_with_active_cycle('optional');


-- ---------------------------------------------------------------------
-- 5. Subjects are kept per cycle
-- ---------------------------------------------------------------------
-- The same code may now exist once per cycle: 2026-27's IT2101 and
-- 2027-28's IT2101 are different rows with different attendance.
drop index if exists public.cluster_head_courses_unique_code_idx;
create unique index if not exists cluster_head_courses_unique_code_idx
  on public.cluster_head_courses (cluster_head_id, cycle_id, lower(course_code));
create index if not exists cluster_head_courses_cycle_idx
  on public.cluster_head_courses (cycle_id, cluster_head_id, display_order);

-- What every Cluster Head screen reads: this cycle's subjects. Invoker
-- rights, so the table's own policies still decide whose rows show.
create or replace view public.current_cycle_courses
with (security_invoker = true) as
select c.*
  from public.cluster_head_courses c
 where c.cycle_id = public.active_cycle_id();

comment on view public.current_cycle_courses is
  'The active cycle''s subjects. The Cluster Head screens read this rather than cluster_head_courses.';

revoke all on public.current_cycle_courses from anon, authenticated;
grant select on public.current_cycle_courses to authenticated;

-- The setup form's writer (0032), now confined to the active cycle: the
-- delete that makes "remove a subject" work can no longer reach a closed
-- cycle's subjects, which is what used to take their attendance with them.
create or replace function public.submit_cluster_head_setup(p_courses jsonb)
returns setof public.cluster_head_courses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item   jsonb;
  v_index  smallint := 0;
  v_name   text;
  v_code   text;
  v_seen   text[] := array[]::text[];
  v_cycle  uuid := public.active_cycle_id();
begin
  if not public.is_cluster_head() then
    raise exception 'Only a cluster head can submit the cluster head setup form'
      using errcode = '42501';
  end if;
  if v_cycle is null then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles, then add your subjects.'
      using errcode = '22023';
  end if;
  if p_courses is null or jsonb_typeof(p_courses) <> 'array' or jsonb_array_length(p_courses) = 0 then
    raise exception 'Add at least one subject before submitting' using errcode = '22023';
  end if;
  if jsonb_array_length(p_courses) > 60 then
    raise exception 'That is more subjects than one cluster head can handle (limit 60)' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_courses)
  loop
    v_name := btrim(coalesce(v_item ->> 'course_name', ''));
    v_code := btrim(coalesce(v_item ->> 'course_code', ''));

    if v_name = '' or v_code = '' then
      raise exception 'Every subject needs both a course name and a course code' using errcode = '22023';
    end if;
    if lower(v_code) = any (v_seen) then
      raise exception 'Course code "%" appears more than once', v_code using errcode = '22023';
    end if;
    v_seen := v_seen || lower(v_code);
  end loop;

  -- Replace this cycle's list wholesale. ON DELETE CASCADE would take the
  -- section mapping and attendance with it, so only codes that actually
  -- went away are removed, and only from this cycle.
  delete from public.cluster_head_courses
   where cluster_head_id = auth.uid()
     and cycle_id = v_cycle
     and lower(course_code) <> all (v_seen);

  for v_item in select * from jsonb_array_elements(p_courses)
  loop
    v_index := v_index + 1;
    insert into public.cluster_head_courses (cluster_head_id, cycle_id, course_name, course_code, display_order)
    values (
      auth.uid(),
      v_cycle,
      btrim(v_item ->> 'course_name'),
      btrim(v_item ->> 'course_code'),
      v_index
    )
    on conflict (cluster_head_id, cycle_id, lower(course_code)) do update
      set course_name   = excluded.course_name,
          display_order = excluded.display_order,
          updated_at    = now();
  end loop;

  -- cluster_head_setup_completed is a protected column, so the
  -- trusted-operation flag has to be raised and cleared around the write.
  perform set_config('ssmp.trusted_operation', 'on', true);
  update public.user_profiles
     set cluster_head_setup_completed    = true,
         cluster_head_setup_completed_at = coalesce(cluster_head_setup_completed_at, now())
   where id = auth.uid();
  perform set_config('ssmp.trusted_operation', 'off', true);

  return query
    select * from public.cluster_head_courses
     where cluster_head_id = auth.uid()
       and cycle_id = v_cycle
     order by display_order;
end;
$$;

revoke all on function public.submit_cluster_head_setup(jsonb) from public, anon;
grant execute on function public.submit_cluster_head_setup(jsonb) to authenticated;


-- The attendance upload (0033), matching the file's course code against
-- the active cycle's subjects only. Everything else is verbatim.
CREATE OR REPLACE FUNCTION public.record_attendance_batch(p_course_code text, p_course_name text, p_section text, p_period_start date, p_period_end date, p_filename text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_course    public.cluster_head_courses;
  v_batch_id  uuid;
  v_item      jsonb;
  v_ident     text;
  v_idents   text[];
  v_lookup   jsonb;
  v_student   uuid;
  v_percent   numeric;
  v_held      integer;
  v_attended  integer;
  v_section   text;
  v_fallback  text;
  v_matched   integer := 0;
  v_failed    integer := 0;
  v_total     integer := 0;
  v_errors    jsonb   := '[]'::jsonb;
  v_sections  text[]  := array[]::text[];
  v_touched   uuid[]  := array[]::uuid[];
  v_sid       uuid;
  v_actor     uuid;
  v_cycle     public.academic_cycles;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload attendance' using errcode = '42501';
  end if;
  if p_course_code is null or btrim(p_course_code) = '' then
    raise exception 'No course code found in the file header' using errcode = '22023';
  end if;

  select * into v_cycle from public.academic_cycles where is_active;
  if v_cycle.id is null then
    raise exception 'There is no active academic cycle. Start one under Academic Cycles in the Cluster Head portal, then try again.'
      using errcode = '22023';
  end if;

  select * into v_course
    from public.cluster_head_courses
   where lower(course_code) = lower(btrim(p_course_code))
     and cycle_id = v_cycle.id
     and (cluster_head_id = auth.uid() or public.is_hod() or auth.uid() is null)
   limit 1;

  if v_course.id is null then
    raise exception
      'Course code "%" is not in your subject list for %. Add it under My Subjects, then upload this file again.',
      btrim(p_course_code), replace(v_cycle.label, '-', '–')
      using errcode = '22023';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'The From/To dates in the file header are missing or out of order' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  v_fallback := nullif(btrim(coalesce(p_section, '')), '');
  v_actor    := coalesce(auth.uid(), v_course.cluster_head_id);

  insert into public.academic_upload_batches (
    uploaded_by, upload_type, course_id, section_label,
    period_start, period_end, original_filename, total_rows
  )
  values (v_actor, 'attendance', v_course.id, v_fallback,
          p_period_start, p_period_end, coalesce(p_filename, 'upload'), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  -- Every registration number in the file, resolved in one pass (0033).
  select array_agg(distinct btrim(coalesce(value ->> 'identifier', '')))
    into v_idents
    from jsonb_array_elements(p_rows)
   where btrim(coalesce(value ->> 'identifier', '')) <> '';
  v_lookup := public.resolve_student_ids(coalesce(v_idents, array[]::text[]));

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total   := v_total + 1;
    v_ident   := btrim(coalesce(v_item ->> 'identifier', ''));
    v_percent := nullif(v_item ->> 'attendance_percent', '')::numeric;
    v_held    := nullif(v_item ->> 'classes_held', '')::integer;
    v_attended:= nullif(v_item ->> 'classes_attended', '')::integer;
    v_section := nullif(btrim(coalesce(v_item ->> 'section', '')), '');
    v_section := coalesce(v_section, v_fallback);

    if v_ident = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'reason', 'No registration number in this row');
      continue;
    end if;
    if v_percent is null or v_percent < 0 or v_percent > 100 then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'The % column is missing or outside 0-100');
      continue;
    end if;
    if v_section is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No section on this row and none in the file header');
      continue;
    end if;

    -- Registration number is the key. A student sits in different
    -- sections for different courses, so nothing here reads or writes
    -- their roster section.
    v_student := nullif(v_lookup ->> lower(v_ident), '')::uuid;

    if v_student is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No student matches this registration number');
      continue;
    end if;

    insert into public.student_course_sections (student_id, course_id, section_label)
    values (v_student, v_course.id, v_section)
    on conflict (student_id, course_id) do update
      set section_label = excluded.section_label, updated_at = now();

    insert into public.student_attendance_records (
      student_id, course_id, course_code, course_name, section_label,
      period_start, period_end, classes_held, classes_attended, attendance_percent,
      batch_id, recorded_by
    )
    values (
      v_student, v_course.id, v_course.course_code,
      coalesce(nullif(btrim(coalesce(p_course_name, '')), ''), v_course.course_name),
      v_section, p_period_start, p_period_end,
      v_held, v_attended, round(v_percent, 2), v_batch_id, v_actor
    )
    on conflict (student_id, course_id, period_start) do update
      set course_code        = excluded.course_code,
          course_name        = excluded.course_name,
          section_label      = excluded.section_label,
          period_end         = excluded.period_end,
          classes_held       = excluded.classes_held,
          classes_attended   = excluded.classes_attended,
          attendance_percent = excluded.attendance_percent,
          batch_id           = excluded.batch_id,
          recorded_by        = excluded.recorded_by,
          updated_at         = now();

    if not (v_section = any (v_sections)) then
      v_sections := v_sections || v_section;
    end if;
    if not (v_student = any (v_touched)) then
      v_touched := v_touched || v_student;
    end if;
    v_matched := v_matched + 1;
  end loop;

  update public.academic_upload_batches
     set matched_rows  = v_matched,
         failed_rows   = v_failed,
         row_errors    = v_errors,
         section_label = coalesce(v_fallback, array_to_string(v_sections, ', '))
   where id = v_batch_id;

  foreach v_sid in array v_touched loop
    perform public.evaluate_student_risk(v_sid);
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'cycle', v_cycle.label,
    'semester', public.cycle_semester_on(v_cycle.id, p_period_end),
    'course_code', v_course.course_code,
    'course_name', coalesce(nullif(btrim(coalesce(p_course_name, '')), ''), v_course.course_name),
    'section', coalesce(v_fallback, array_to_string(v_sections, ', ')),
    'sections', to_jsonb(v_sections),
    'period_start', p_period_start,
    'period_end', p_period_end,
    'total_rows', v_total, 'matched', v_matched, 'failed', v_failed,
    'students_reevaluated', coalesce(array_length(v_touched, 1), 0),
    'row_errors', v_errors
  );
end;
$function$;

revoke all on function public.record_attendance_batch(text, text, text, date, date, text, jsonb) from public, anon;
grant execute on function public.record_attendance_batch(text, text, text, date, date, text, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 6. Each cycle's own list of students
-- ---------------------------------------------------------------------
-- The semester, section, branch and mentor a student had IN THAT CYCLE.
-- user_profiles only ever holds today's values, so without this the
-- 2026-27 view would show 2027-28's mentors once next year's mapping is
-- uploaded.
create table if not exists public.academic_cycle_students (
  cycle_id        uuid not null references public.academic_cycles (id) on delete cascade,
  student_id      uuid not null references public.user_profiles (id) on delete cascade,
  semester_label  text,
  section         text,
  branch          text,
  mentor_id       uuid references public.user_profiles (id) on delete set null,
  -- How the student came to be in the cycle.
  activated_via   text not null default 'roster',
  activated_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (cycle_id, student_id),
  constraint academic_cycle_students_via check (
    activated_via in ('existing', 'account', 'roster', 'mentor_map', 'carried_over', 'profile')
  )
);

create index if not exists academic_cycle_students_student_idx on public.academic_cycle_students (student_id);
create index if not exists academic_cycle_students_mentor_idx  on public.academic_cycle_students (cycle_id, mentor_id);

comment on table public.academic_cycle_students is
  'Which students are active in which cycle, with the semester, section, branch and mentor they had in it. Filled by new accounts, the roster import, the mentor mapping and "carry over"; the active cycle''s rows follow the profile as it changes.';
comment on column public.academic_cycle_students.activated_via is
  'existing = on the portal before cycles; account = account created in the cycle; roster = listed in a roster imported into it; mentor_map = in a mentor mapping; carried_over = brought over from the previous cycle; profile = their mentor, section, semester or branch changed during it.';

alter table public.academic_cycle_students enable row level security;

drop policy if exists cycle_students_select_visible on public.academic_cycle_students;
-- Student, mentor or HOD, like every student record. Cluster heads get
-- counts through get_cycle_overview(), never the list.
create policy cycle_students_select_visible on public.academic_cycle_students
  for select to authenticated
  using (public.can_access_student(student_id));

revoke all on public.academic_cycle_students from anon, authenticated;
grant select on public.academic_cycle_students to authenticated;

-- Copy the student's current details into a cycle's list.
create or replace function public.enroll_student_in_cycle(p_cycle_id uuid, p_student_id uuid, p_via text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.academic_cycle_students as e (
    cycle_id, student_id, semester_label, section, branch, mentor_id, activated_via
  )
  select p_cycle_id, p.id, p.semester_label, p.section, p.branch, p.assigned_mentor_id, p_via
    from public.user_profiles p
   where p.id = p_student_id and p.role = 'student' and p_cycle_id is not null
  on conflict (cycle_id, student_id) do update
    set semester_label = excluded.semester_label,
        section        = excluded.section,
        branch         = excluded.branch,
        mentor_id      = excluded.mentor_id,
        updated_at     = now()
$$;

revoke all on function public.enroll_student_in_cycle(uuid, uuid, text) from public, anon, authenticated;

-- The active cycle's list follows the profile: a new account joins it,
-- and a change of mentor, section, semester or branch is written into it
-- (joining it, if the student was not in it yet). Closed cycles are never
-- touched, which is the point.
create or replace function public.sync_student_cycle_enrollment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle uuid;
begin
  if new.role <> 'student' then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.assigned_mentor_id is not distinct from old.assigned_mentor_id
     and new.section            is not distinct from old.section
     and new.semester_label     is not distinct from old.semester_label
     and new.branch             is not distinct from old.branch
     and new.role               is not distinct from old.role then
    return null;
  end if;

  v_cycle := public.active_cycle_id();
  if v_cycle is not null then
    perform public.enroll_student_in_cycle(v_cycle, new.id, case when tg_op = 'INSERT' then 'account' else 'profile' end);
  end if;
  return null;
end;
$$;

revoke all on function public.sync_student_cycle_enrollment() from public, anon, authenticated;

drop trigger if exists trg_sync_student_cycle_enrollment on public.user_profiles;
create trigger trg_sync_student_cycle_enrollment
  after insert or update of assigned_mentor_id, section, semester_label, branch, role
  on public.user_profiles
  for each row execute function public.sync_student_cycle_enrollment();

-- Everyone already on the portal is in the first cycle.
insert into public.academic_cycle_students (cycle_id, student_id, semester_label, section, branch, mentor_id, activated_via, activated_at)
select c.id, p.id, p.semester_label, p.section, p.branch, p.assigned_mentor_id, 'existing', p.created_at
  from public.user_profiles p
 cross join lateral (select id from public.academic_cycles where is_active limit 1) c
 where p.role = 'student'
on conflict (cycle_id, student_id) do nothing;


-- The roster import activates the students it lists who already have an
-- account: they join the active cycle, and the semester, section and
-- branch in the file become their current ones. A blank cell changes
-- nothing. Guardian details only fill gaps, because a student may have
-- corrected their own. Called by the roster endpoint (service role).
--   p_rows: [{ "student_id": uuid, "semester_label": "5th Semester",
--              "section": "B", "branch": "CSE",
--              "parent_name": ..., "parent_mobile": ..., "parent_email": ... }]
create or replace function public.activate_roster_students(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle     uuid := public.active_cycle_id();
  v_item      jsonb;
  v_student   uuid;
  v_activated integer := 0;
  v_updated   integer := 0;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can activate students' using errcode = '42501';
  end if;
  if v_cycle is null then
    return jsonb_build_object('activated', 0, 'updated', 0, 'cycle', null);
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('activated', 0, 'updated', 0);
  end if;

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    begin
      v_student := (v_item ->> 'student_id')::uuid;
    exception when others then
      continue;
    end;
    continue when v_student is null
             or not exists (select 1 from public.user_profiles where id = v_student and role = 'student');

    -- Joined as 'roster' first, so the profile update below only
    -- refreshes the row rather than labelling it a profile change.
    perform public.enroll_student_in_cycle(v_cycle, v_student, 'roster');
    v_activated := v_activated + 1;

    update public.user_profiles p
       set semester_label = coalesce(nullif(btrim(coalesce(v_item ->> 'semester_label', '')), ''), p.semester_label),
           section        = coalesce(nullif(btrim(coalesce(v_item ->> 'section', '')), ''), p.section),
           branch         = coalesce(nullif(btrim(coalesce(v_item ->> 'branch', '')), ''), p.branch),
           parent_name    = coalesce(p.parent_name, nullif(btrim(coalesce(v_item ->> 'parent_name', '')), '')),
           parent_mobile  = coalesce(p.parent_mobile, nullif(btrim(coalesce(v_item ->> 'parent_mobile', '')), '')),
           parent_email   = coalesce(p.parent_email, nullif(lower(btrim(coalesce(v_item ->> 'parent_email', ''))), ''))
     where p.id = v_student
       and (   p.semester_label is distinct from coalesce(nullif(btrim(coalesce(v_item ->> 'semester_label', '')), ''), p.semester_label)
            or p.section        is distinct from coalesce(nullif(btrim(coalesce(v_item ->> 'section', '')), ''), p.section)
            or p.branch         is distinct from coalesce(nullif(btrim(coalesce(v_item ->> 'branch', '')), ''), p.branch)
            or (p.parent_name   is null and nullif(btrim(coalesce(v_item ->> 'parent_name', '')), '') is not null)
            or (p.parent_mobile is null and nullif(btrim(coalesce(v_item ->> 'parent_mobile', '')), '') is not null)
            or (p.parent_email  is null and nullif(btrim(coalesce(v_item ->> 'parent_email', '')), '') is not null));
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('activated', v_activated, 'updated', v_updated,
                            'cycle', (select label from public.academic_cycles where id = v_cycle));
end;
$$;

revoke all on function public.activate_roster_students(jsonb) from public, anon;
grant execute on function public.activate_roster_students(jsonb) to authenticated, service_role;

-- Bring the previous cycle's students into the active one, as they are
-- now. For a year with no new roster file: everyone who was here last
-- year and still has an active account.
create or replace function public.carry_over_cycle_students(p_from_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle uuid := public.active_cycle_id();
  v_count integer;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can carry students over' using errcode = '42501';
  end if;
  if v_cycle is null then
    raise exception 'There is no active academic cycle to carry students into' using errcode = '22023';
  end if;
  if p_from_cycle_id is null or p_from_cycle_id = v_cycle
     or not exists (select 1 from public.academic_cycles where id = p_from_cycle_id) then
    raise exception 'Choose an earlier cycle to carry students over from' using errcode = '22023';
  end if;

  insert into public.academic_cycle_students (cycle_id, student_id, semester_label, section, branch, mentor_id, activated_via)
  select v_cycle, p.id, p.semester_label, p.section, p.branch, p.assigned_mentor_id, 'carried_over'
    from public.academic_cycle_students e
    join public.user_profiles p on p.id = e.student_id
   where e.cycle_id = p_from_cycle_id
     and p.role = 'student'
     and p.is_active
  on conflict (cycle_id, student_id) do nothing;
  get diagnostics v_count = row_count;

  return jsonb_build_object('carried_over', v_count);
end;
$$;

revoke all on function public.carry_over_cycle_students(uuid) from public, anon;
grant execute on function public.carry_over_cycle_students(uuid) to authenticated, service_role;


-- The mentor mapping (0033) also activates every student it matches in
-- the active cycle, including those whose mentor was already right.
-- Everything else is verbatim.
CREATE OR REPLACE FUNCTION public.map_students_to_mentors(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item     jsonb;
  v_ident    text;
  v_idents   text[];
  v_lookup   jsonb;
  v_email    text;
  v_student  uuid;
  v_mentor   uuid;
  v_status   public.employment_status;
  v_total    integer := 0;
  v_mapped   integer := 0;
  v_same     integer := 0;
  v_failed   integer := 0;
  v_errors   jsonb   := '[]'::jsonb;
  v_current  uuid;
  v_cycle    uuid := public.active_cycle_id();
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can map mentors' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  -- Every registration number in the file, resolved in one pass (0033).
  select array_agg(distinct btrim(coalesce(value ->> 'identifier', '')))
    into v_idents
    from jsonb_array_elements(p_rows)
   where btrim(coalesce(value ->> 'identifier', '')) <> '';
  v_lookup := public.resolve_student_ids(coalesce(v_idents, array[]::text[]));

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total := v_total + 1;
    v_ident := btrim(coalesce(v_item ->> 'identifier', ''));
    v_email := lower(btrim(coalesce(v_item ->> 'mentor_email', '')));

    if v_ident = '' or v_email = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total,
                                                 'reason', 'Each row needs a registration number and a mentor email');
      continue;
    end if;

    v_student := nullif(v_lookup ->> lower(v_ident), '')::uuid;

    if v_student is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No student matches this registration number. Import the student roster first.');
      continue;
    end if;

    select id, employment_status into v_mentor, v_status
      from public.user_profiles
     where role = 'faculty' and lower(email) = v_email
     limit 1;

    if v_mentor is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', format('No faculty account for "%s". Import the faculty roster first.', v_email));
      continue;
    end if;
    if v_status <> 'active' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', format('Mentor "%s" is marked %s', v_email, v_status));
      continue;
    end if;

    -- In the active cycle's list before the mentor moves, so the row is
    -- labelled as coming from the mapping and then picks the mentor up.
    perform public.enroll_student_in_cycle(v_cycle, v_student, 'mentor_map');

    select assigned_mentor_id into v_current from public.user_profiles where id = v_student;
    if v_current is not distinct from v_mentor then
      v_same := v_same + 1;
      continue;
    end if;

    -- assigned_mentor_id is a protected column (§10.3). This function has
    -- already established the caller is a cluster head or the HOD.
    perform set_config('ssmp.trusted_operation', 'on', true);
    update public.user_profiles set assigned_mentor_id = v_mentor where id = v_student;
    perform set_config('ssmp.trusted_operation', 'off', true);

    v_mapped := v_mapped + 1;
  end loop;

  return jsonb_build_object(
    'total_rows', v_total,
    'matched', v_mapped,
    'unchanged', v_same,
    'failed', v_failed,
    'row_errors', v_errors
  );
end;
$function$;

revoke all on function public.map_students_to_mentors(jsonb) from public, anon;
grant execute on function public.map_students_to_mentors(jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 7. Attendance is the active cycle's
-- ---------------------------------------------------------------------
-- Same columns as 0025; only the cycle filter is new. Last year's rows
-- stay in student_attendance_records and in the cycle report.
create or replace view public.student_attendance_overview
with (security_invoker = true) as
select distinct on (a.student_id, a.course_id)
  a.student_id,
  a.course_id,
  a.course_code,
  a.course_name,
  a.section_label,
  a.attendance_percent,
  a.classes_held,
  a.classes_attended,
  a.period_start,
  a.period_end,
  a.updated_at
from public.student_attendance_records a
where a.cycle_id = public.active_cycle_id()
order by a.student_id, a.course_id, a.period_start desc, a.created_at desc;

comment on view public.student_attendance_overview is
  'One row per student per course for the ACTIVE academic cycle — the most recent reporting period. Powers the attendance on the Academics page and the student record.';

-- The upload history with the cycle and the semester each upload was
-- filed under. Invoker rights: a cluster head still sees only their own.
create or replace view public.academic_upload_history
with (security_invoker = true) as
select
  b.id,
  b.cycle_id,
  c.label as cycle_label,
  case
    when b.upload_type = 'attendance' and b.period_end is not null
      then case when b.period_end >= c.even_starts_on then 'Even' else 'Odd' end
    when b.upload_type = 'backlog' and b.semester_number is not null
      then public.semester_term_of_number(b.semester_number)::text
    else case when (b.created_at at time zone 'Asia/Kolkata')::date >= c.even_starts_on then 'Even' else 'Odd' end
  end::public.semester_term as semester,
  b.upload_type,
  b.course_id,
  k.course_code,
  b.section_label,
  b.period_start,
  b.period_end,
  b.semester_number,
  b.scope_label,
  b.original_filename,
  b.total_rows,
  b.matched_rows,
  b.failed_rows,
  b.uploaded_by,
  b.created_at
from public.academic_upload_batches b
join public.academic_cycles c on c.id = b.cycle_id
left join public.cluster_head_courses k on k.id = b.course_id;

comment on view public.academic_upload_history is
  'academic_upload_batches with the cycle label and the semester each upload is filed under (attendance by period end, backlogs by semester parity, the rest by upload date).';

revoke all on public.academic_upload_history from anon, authenticated;
grant select on public.academic_upload_history to authenticated;


-- ---------------------------------------------------------------------
-- 8. Black dots join the at-risk rule
-- ---------------------------------------------------------------------
alter table public.student_risk_flags add column if not exists has_black_dot   boolean not null default false;
alter table public.student_risk_flags add column if not exists black_dot_count integer not null default 0;
alter table public.at_risk_meetings   add column if not exists black_dot_count integer not null default 0;

comment on table public.student_risk_flags is
  'At-risk state per student. ANY of low attendance (active cycle) / low GPA / an uncleared backlog / a black dot in the active cycle sets is_at_risk. Rewritten by evaluate_student_risk() whenever new academic data lands.';
comment on column public.student_risk_flags.black_dot_count is
  'Black dots in the active cycle when the student was last evaluated.';

-- 0025's evaluation, with the cycle: attendance is the active cycle's,
-- and a black dot in the active cycle is the fourth condition.
create or replace function public.evaluate_student_risk(p_student_id uuid)
returns public.student_risk_flags
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row              public.student_risk_flags;
  v_cycle            public.academic_cycles;
  v_attendance       numeric(5,2);
  v_courses          integer;
  v_gpa              numeric(4,2);
  v_gpa_semester     smallint;
  v_backlogs         integer;
  v_black_dots       integer := 0;
  v_low_attendance   boolean := false;
  v_low_gpa          boolean := false;
  v_has_backlog      boolean := false;
  v_has_black_dot    boolean := false;
  v_reasons          text[]  := array[]::text[];
  v_at_risk          boolean;
begin
  if not exists (select 1 from public.user_profiles where id = p_student_id and role = 'student') then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  select * into v_cycle from public.academic_cycles where is_active;

  -- Mean of the latest percentage for each course the student appears in
  -- this cycle.
  select count(*), round(avg(latest.attendance_percent), 2)
    into v_courses, v_attendance
    from (
      select distinct on (course_id) attendance_percent
        from public.student_attendance_records
       where student_id = p_student_id
         and cycle_id = v_cycle.id
       order by course_id, period_start desc, created_at desc
    ) latest;

  if coalesce(v_courses, 0) > 0 and v_attendance < 75 then
    v_low_attendance := true;
    v_reasons := v_reasons || format('Attendance %s%% (below 75%%)', v_attendance);
  end if;

  select gpa, semester_number into v_gpa, v_gpa_semester
    from public.student_semester_gpas
   where student_id = p_student_id
   order by semester_number desc
   limit 1;

  if v_gpa is not null and v_gpa < 6 then
    v_low_gpa := true;
    v_reasons := v_reasons || format('GPA %s in semester %s (below 6)', v_gpa, v_gpa_semester);
  end if;

  select count(*) into v_backlogs
    from public.student_backlogs
   where student_id = p_student_id and is_cleared = false;

  if v_backlogs >= 1 then
    v_has_backlog := true;
    v_reasons := v_reasons || format('%s uncleared backlog%s', v_backlogs, case when v_backlogs = 1 then '' else 's' end);
  end if;

  -- One is enough, as with backlogs. Only this cycle's: a black dot
  -- cannot be cleared, so the new cycle is what lifts it.
  if v_cycle.id is not null then
    select count(*) into v_black_dots
      from public.student_black_dots
     where student_id = p_student_id and cycle_id = v_cycle.id;
  end if;

  if v_black_dots >= 1 then
    v_has_black_dot := true;
    v_reasons := v_reasons || format('%s black dot%s in %s', v_black_dots,
                                     case when v_black_dots = 1 then '' else 's' end,
                                     replace(v_cycle.label, '-', '–'));
  end if;

  -- ANY of the four.
  v_at_risk := v_low_attendance or v_low_gpa or v_has_backlog or v_has_black_dot;

  insert into public.student_risk_flags as f (
    student_id, is_at_risk, low_attendance, low_gpa, has_backlog, has_black_dot,
    attendance_percent, latest_gpa, latest_gpa_semester, backlog_count, black_dot_count, reasons,
    first_flagged_at, last_flagged_at, cleared_at, last_evaluated_at
  )
  values (
    p_student_id, v_at_risk, v_low_attendance, v_low_gpa, v_has_backlog, v_has_black_dot,
    case when coalesce(v_courses, 0) > 0 then v_attendance end,
    v_gpa, v_gpa_semester, v_backlogs, v_black_dots, v_reasons,
    case when v_at_risk then now() end,
    case when v_at_risk then now() end,
    case when v_at_risk then null else now() end,
    now()
  )
  on conflict (student_id) do update set
    is_at_risk          = excluded.is_at_risk,
    low_attendance      = excluded.low_attendance,
    low_gpa             = excluded.low_gpa,
    has_backlog         = excluded.has_backlog,
    has_black_dot       = excluded.has_black_dot,
    attendance_percent  = excluded.attendance_percent,
    latest_gpa          = excluded.latest_gpa,
    latest_gpa_semester = excluded.latest_gpa_semester,
    backlog_count       = excluded.backlog_count,
    black_dot_count     = excluded.black_dot_count,
    reasons             = excluded.reasons,
    first_flagged_at    = coalesce(f.first_flagged_at, excluded.first_flagged_at),
    last_flagged_at     = case when excluded.is_at_risk then now() else f.last_flagged_at end,
    cleared_at          = case when excluded.is_at_risk then null else coalesce(f.cleared_at, now()) end,
    last_evaluated_at   = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- 0022's announcement, with two changes:
--   * a student's FIRST evaluation that finds nothing is not news, so it
--     no longer tells the mentor they are "no longer at-risk" (B2);
--   * a re-check run because the cycle changed is quiet about flags it
--     lifts: the new year clears last year's attendance and black dots for
--     everybody at once, which is bookkeeping, not an alert per student.
create or replace function public.notify_on_risk_flag_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.user_profiles;
begin
  if tg_op = 'UPDATE' and new.is_at_risk = old.is_at_risk then
    return new;
  end if;
  if tg_op = 'INSERT' and not new.is_at_risk then
    return new;
  end if;
  if not new.is_at_risk
     and coalesce(current_setting('ssmp.quiet_risk_notifications', true), 'off') = 'on' then
    return new;
  end if;

  select * into v_student from public.user_profiles where id = new.student_id;
  if v_student.id is null or v_student.assigned_mentor_id is null then
    return new;
  end if;

  if new.is_at_risk then
    perform public.enqueue_notification(
      v_student.assigned_mentor_id, null, 'student_at_risk',
      format('%s is now flagged as at-risk', v_student.full_name),
      array_to_string(new.reasons, ' · '),
      null, '/faculty/at-risk'
    );
  else
    perform public.enqueue_notification(
      v_student.assigned_mentor_id, null, 'at_risk_cleared',
      format('%s is no longer at-risk', v_student.full_name),
      'The latest academic data clears every at-risk condition.',
      null, '/faculty/at-risk'
    );
  end if;

  return new;
end;
$$;

-- 0022's meeting dispatch, with the black dot count in the snapshot.
create or replace function public.dispatch_at_risk_meetings(p_job_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_flag      public.student_risk_flags;
  v_mentor    uuid;
  v_created   integer := 0;
  v_skipped   integer := 0;
  v_no_mentor integer := 0;
  v_meeting   public.at_risk_meetings;
begin
  if not (public.is_hod() or auth.uid() is null) then
    raise exception 'Only the HOD can dispatch at-risk meetings' using errcode = '42501';
  end if;

  for v_flag in
    select * from public.student_risk_flags where is_at_risk = true
  loop
    select assigned_mentor_id into v_mentor
      from public.user_profiles where id = v_flag.student_id;

    -- The mentor owns the meeting. No mentor, no meeting.
    if v_mentor is null then
      v_no_mentor := v_no_mentor + 1;
      continue;
    end if;

    if exists (
      select 1 from public.at_risk_meetings
       where student_id = v_flag.student_id
         and status in ('awaiting_link', 'scheduled')
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.at_risk_meetings (
      student_id, mentor_id, status, reasons,
      attendance_percent, latest_gpa, backlog_count, black_dot_count, job_run_id
    )
    values (
      v_flag.student_id, v_mentor, 'awaiting_link', v_flag.reasons,
      v_flag.attendance_percent, v_flag.latest_gpa, v_flag.backlog_count, v_flag.black_dot_count, p_job_run_id
    )
    returning * into v_meeting;

    -- Ask for a join link. Today this is a no-op (see 0022).
    perform public.create_at_risk_meeting_link(v_meeting.id);

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'meetings_created', v_created,
    'already_open',     v_skipped,
    'without_mentor',   v_no_mentor
  );
end;
$$;

-- 0027's at-risk roster with the black dot columns added at the end.
create or replace view public.at_risk_student_overview
with (security_invoker = true) as
select
  s.id                              as student_id,
  s.full_name                       as student_name,
  s.login_id                        as registration_no,
  s.email,
  s.section,
  s.branch,
  s.semester_label,
  s.assigned_mentor_id,
  m.full_name                       as mentor_name,
  f.is_at_risk,
  f.low_attendance,
  f.low_gpa,
  f.has_backlog,
  f.attendance_percent,
  f.latest_gpa,
  f.latest_gpa_semester,
  f.backlog_count,
  f.reasons,
  f.first_flagged_at,
  f.last_evaluated_at,
  -- Form A is the student's own answer and wins; the roster fills the gap.
  coalesce(a.father_name,   s.parent_name)   as father_name,
  coalesce(a.father_mobile, s.parent_mobile) as father_mobile,
  a.mother_name,
  a.mother_mobile,
  coalesce(a.father_mobile, a.mother_mobile, s.parent_mobile) as primary_parent_mobile,
  coalesce(a.father_email,  s.parent_email)  as primary_parent_email,
  meet.id                           as open_meeting_id,
  meet.status                       as open_meeting_status,
  meet.meeting_join_url             as open_meeting_join_url,
  meet.created_at                   as open_meeting_created_at,
  f.has_black_dot,
  f.black_dot_count
from public.user_profiles s
join public.student_risk_flags f      on f.student_id = s.id
left join public.user_profiles m      on m.id = s.assigned_mentor_id
left join public.student_form_a_profiles a on a.student_id = s.id
left join lateral (
  select id, status, meeting_join_url, created_at
    from public.at_risk_meetings
   where student_id = s.id and status in ('awaiting_link', 'scheduled')
   order by created_at desc
   limit 1
) meet on true
where s.role = 'student';

comment on view public.at_risk_student_overview is
  'At-risk roster: attendance, GPA, backlog and black dot counts and guardian contact in one row. Parent contact prefers Form A and falls back to the student roster import.';

grant select on public.at_risk_student_overview to authenticated;

-- The PB notice upload (0035), now re-checking every student it names:
-- a black dot flags them. Everything else is verbatim.
create or replace function public.record_black_dot_batch(p_filename text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_batch_id     uuid;
  v_item         jsonb;
  v_row          integer;
  v_ident        text;
  v_idents       text[];
  v_lookup       jsonb;
  v_student      uuid;
  v_problem      text;
  v_case         text;
  v_name         text;
  v_account      text;
  v_date         date;
  v_previous     text;
  v_prev_count   integer;
  v_matched      integer := 0;
  v_failed       integer := 0;
  v_total        integer := 0;
  v_errors       jsonb   := '[]'::jsonb;
  v_cases        text[]  := array[]::text[];
  v_students     uuid[]  := array[]::uuid[];
  v_sid          uuid;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload black dots' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  insert into public.academic_upload_batches (
    uploaded_by, upload_type, original_filename, total_rows
  )
  values (auth.uid(), 'black_dot', coalesce(p_filename, 'upload'), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  select array_agg(distinct btrim(coalesce(value ->> 'identifier', '')))
    into v_idents
    from jsonb_array_elements(p_rows)
   where btrim(coalesce(value ->> 'identifier', '')) <> '';
  v_lookup := public.resolve_student_ids(coalesce(v_idents, array[]::text[]));

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total   := v_total + 1;
    v_row     := coalesce(public.try_numeric(v_item ->> 'row')::integer, v_total);
    v_ident   := btrim(coalesce(v_item ->> 'identifier', ''));
    v_case    := nullif(regexp_replace(btrim(coalesce(v_item ->> 'case_number', '')), '\s+', ' ', 'g'), '');
    v_name    := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    v_problem := null;

    if v_ident = '' then
      v_problem := 'No registration number in this row';
    elsif position('@' in v_ident) > 0 then
      v_problem := 'This is an email address. Rows are matched on registration number only';
    elsif v_case is null then
      v_problem := 'No case number for this row. The notice needs a "Case No: ..." line above each table, or a Case No column';
    end if;

    if v_problem is null then
      v_student := nullif(v_lookup ->> lower(v_ident), '')::uuid;
      if v_student is null then
        -- A PB notice covers the whole university; most of its students
        -- will not be in this portal at all.
        v_problem := 'No student in the portal has this registration number (they may be from another department)';
      end if;
    end if;

    -- The notice is typed by hand. A mistyped registration number would
    -- put a disciplinary record on the wrong student, so when the notice
    -- gives a name it must share at least one word with the account's.
    if v_problem is null and v_name is not null then
      select full_name into v_account from public.user_profiles where id = v_student;
      if not exists (
        select 1
          from regexp_split_to_table(lower(v_name), '[^a-z]+') as a(word)
          join regexp_split_to_table(lower(coalesce(v_account, '')), '[^a-z]+') as b(word)
            on a.word = b.word
         where length(a.word) >= 2
      ) then
        v_problem := format('The name in the notice ("%s") does not match the student with this registration number. Check the registration number', v_name);
      end if;
    end if;

    if v_problem is not null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row, 'identifier', nullif(v_ident, ''),
                                                 'where', nullif(btrim(coalesce(v_item ->> 'where', '')), ''),
                                                 'reason', v_problem);
      continue;
    end if;

    -- The parser only sends a date it could read completely.
    v_date := null;
    if coalesce(v_item ->> 'incident_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        v_date := (v_item ->> 'incident_date')::date;
      exception when others then
        v_date := null;
      end;
    end if;

    v_previous := nullif(btrim(coalesce(v_item ->> 'previous_record', '')), '');
    v_prev_count := case
      when v_previous is null then null
      when lower(v_previous) ~ '^(nil|none|no\M|-|—)' then 0
      when v_previous ~ '[0-9]' then least(substring(v_previous from '[0-9]+')::integer, 100)
    end;

    insert into public.student_black_dots as d (
      student_id, case_number, case_details, incident_date, incident_date_text,
      hostel_block, room_no, course_branch, mobile_no, previous_record, previous_black_dots,
      batch_id, recorded_by
    )
    values (
      v_student, v_case,
      nullif(btrim(coalesce(v_item ->> 'case_details', '')), ''),
      v_date,
      nullif(btrim(coalesce(v_item ->> 'incident_date_text', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'hostel_block', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'room_no', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'course_branch', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'mobile_no', '')), ''),
      v_previous, v_prev_count, v_batch_id, auth.uid()
    )
    on conflict (student_id, lower(case_number)) do update
      set case_details        = coalesce(excluded.case_details, d.case_details),
          incident_date       = coalesce(excluded.incident_date, d.incident_date),
          incident_date_text  = coalesce(excluded.incident_date_text, d.incident_date_text),
          hostel_block        = coalesce(excluded.hostel_block, d.hostel_block),
          room_no             = coalesce(excluded.room_no, d.room_no),
          course_branch       = coalesce(excluded.course_branch, d.course_branch),
          mobile_no           = coalesce(excluded.mobile_no, d.mobile_no),
          previous_record     = coalesce(excluded.previous_record, d.previous_record),
          previous_black_dots = coalesce(excluded.previous_black_dots, d.previous_black_dots),
          batch_id            = excluded.batch_id,
          recorded_by         = coalesce(excluded.recorded_by, d.recorded_by),
          updated_at          = now();

    if not (v_case = any (v_cases)) then
      v_cases := v_cases || v_case;
    end if;
    if not (v_student = any (v_students)) then
      v_students := v_students || v_student;
    end if;
    v_matched := v_matched + 1;
  end loop;

  update public.academic_upload_batches
     set matched_rows = v_matched,
         failed_rows  = v_failed,
         row_errors   = v_errors,
         scope_label  = case coalesce(array_length(v_cases, 1), 0)
                          when 0 then null
                          when 1 then 'Case ' || v_cases[1]
                          else array_length(v_cases, 1) || ' cases'
                        end
   where id = v_batch_id;

  -- A black dot in the active cycle flags the student.
  foreach v_sid in array v_students loop
    perform public.evaluate_student_risk(v_sid);
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'total_rows', v_total,
    'matched', v_matched,
    'failed', v_failed,
    'cases', coalesce(array_length(v_cases, 1), 0),
    'case_numbers', to_jsonb(v_cases),
    'students', coalesce(array_length(v_students, 1), 0),
    'students_reevaluated', coalesce(array_length(v_students, 1), 0),
    'row_errors', v_errors
  );
end;
$function$;

comment on function public.record_black_dot_batch(text, jsonb) is
  'One Proctorial Board notice: a black dot per student per case, matched on registration number, with a name check against the account. Re-uploading a notice updates its rows. Re-evaluates risk for every student recorded.';

revoke all on function public.record_black_dot_batch(text, jsonb) from public, anon;
grant execute on function public.record_black_dot_batch(text, jsonb) to authenticated, service_role;

-- Re-check a slice of the cohort. Starting or removing a cycle changes
-- which attendance and black dots count for everyone, so the new cycle's
-- screen runs this in slices (keyset on id) until next_after is null.
-- Statement timeouts rule out doing 2,700 students in one call. Quiet:
-- flags it lifts are not announced (see notify_on_risk_flag_change).
create or replace function public.reevaluate_students_batch(p_after uuid default null, p_limit integer default 300)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_last  uuid;
  v_done  integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
  v_total integer;
  v_seen  integer;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can re-check at-risk flags' using errcode = '42501';
  end if;

  perform set_config('ssmp.quiet_risk_notifications', 'on', true);
  for v_id in
    select id from public.user_profiles
     where role = 'student' and is_active and (p_after is null or id > p_after)
     order by id
     limit v_limit
  loop
    perform public.evaluate_student_risk(v_id);
    v_done := v_done + 1;
    v_last := v_id;
  end loop;
  perform set_config('ssmp.quiet_risk_notifications', 'off', true);

  select count(*) into v_total from public.user_profiles where role = 'student' and is_active;
  select count(*) into v_seen
    from public.user_profiles
   where role = 'student' and is_active and v_last is not null and id <= v_last;

  return jsonb_build_object(
    'evaluated', v_done,
    'done', case when v_done < v_limit then v_total else v_seen end,
    'total', v_total,
    'next_after', case when v_done < v_limit then null else v_last end
  );
end;
$$;

revoke all on function public.reevaluate_students_batch(uuid, integer) from public, anon;
grant execute on function public.reevaluate_students_batch(uuid, integer) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 9. Running the cycles
-- ---------------------------------------------------------------------
-- Start the next academic year. The current cycle is closed (kept, read
-- only), every cluster head's subject list is copied across, and the new
-- cycle becomes the one uploads go into. The screen then re-checks the
-- at-risk flags with reevaluate_students_batch().
create or replace function public.create_academic_cycle(
  p_start_year     integer,
  p_starts_on      date default null,
  p_even_starts_on date default null,
  p_ends_on        date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous  public.academic_cycles;
  v_cycle     public.academic_cycles;
  v_latest    integer;
  v_starts    date;
  v_even      date;
  v_ends      date;
  v_subjects  integer := 0;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can start an academic cycle' using errcode = '42501';
  end if;
  if p_start_year is null or p_start_year < 2000 or p_start_year > 2098 then
    raise exception 'Choose the year the cycle starts in (for 2027-28, 2027)' using errcode = '22023';
  end if;
  if exists (select 1 from public.academic_cycles where start_year = p_start_year) then
    raise exception 'The %-% cycle already exists', p_start_year, lpad(((p_start_year + 1) % 100)::text, 2, '0')
      using errcode = '23505';
  end if;

  select max(start_year) into v_latest from public.academic_cycles;
  if v_latest is not null and p_start_year < v_latest then
    raise exception 'A new cycle has to come after the latest one (%-%)', v_latest, lpad(((v_latest + 1) % 100)::text, 2, '0')
      using errcode = '22023';
  end if;

  v_starts := coalesce(p_starts_on, make_date(p_start_year, 7, 1));
  v_even   := coalesce(p_even_starts_on, make_date(p_start_year + 1, 1, 1));
  v_ends   := coalesce(p_ends_on, make_date(p_start_year + 1, 6, 30));
  if not (v_starts < v_even and v_even <= v_ends) then
    raise exception 'The dates are out of order: the odd semester starts, then the even semester, then the cycle ends'
      using errcode = '22023';
  end if;
  if v_starts < make_date(p_start_year - 1, 1, 1) or v_ends >= make_date(p_start_year + 2, 1, 1) then
    raise exception 'The dates have to fall around %-%', p_start_year, lpad(((p_start_year + 1) % 100)::text, 2, '0')
      using errcode = '22023';
  end if;

  select * into v_previous from public.academic_cycles where is_active;

  update public.academic_cycles
     set is_active = false, closed_at = now()
   where is_active;

  insert into public.academic_cycles (start_year, starts_on, even_starts_on, ends_on, is_active, activated_at, created_by)
  values (p_start_year, v_starts, v_even, v_ends, true, now(), auth.uid())
  returning * into v_cycle;

  -- Every cluster head keeps working from the same subjects; they can
  -- change this cycle's list without touching last year's.
  if v_previous.id is not null then
    insert into public.cluster_head_courses (cluster_head_id, cycle_id, course_name, course_code, display_order)
    select cluster_head_id, v_cycle.id, course_name, course_code, display_order
      from public.cluster_head_courses
     where cycle_id = v_previous.id
    on conflict do nothing;
    get diagnostics v_subjects = row_count;
  end if;

  perform public.write_audit_entry(
    auth.uid(), 'academic_cycle.create', 'academic_cycles', v_cycle.id::text,
    jsonb_build_object('cycle', v_cycle.label, 'previous', v_previous.label, 'subjects_copied', v_subjects)
  );

  return jsonb_build_object(
    'cycle', to_jsonb(v_cycle),
    'previous', case when v_previous.id is null then null
                     else jsonb_build_object('id', v_previous.id, 'label', v_previous.label) end,
    'subjects_copied', v_subjects
  );
end;
$$;

revoke all on function public.create_academic_cycle(integer, date, date, date) from public, anon;
grant execute on function public.create_academic_cycle(integer, date, date, date) to authenticated, service_role;

-- Correct a cycle's dates. Semesters are worked out from these dates on
-- every read, so nothing else has to be rewritten.
create or replace function public.update_academic_cycle_dates(
  p_cycle_id       uuid,
  p_starts_on      date,
  p_even_starts_on date,
  p_ends_on        date
)
returns public.academic_cycles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle public.academic_cycles;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can change a cycle''s dates' using errcode = '42501';
  end if;
  select * into v_cycle from public.academic_cycles where id = p_cycle_id;
  if v_cycle.id is null then
    raise exception 'Cycle not found' using errcode = 'P0002';
  end if;
  if p_starts_on is null or p_even_starts_on is null or p_ends_on is null
     or not (p_starts_on < p_even_starts_on and p_even_starts_on <= p_ends_on) then
    raise exception 'The dates are out of order: the odd semester starts, then the even semester, then the cycle ends'
      using errcode = '22023';
  end if;
  if p_starts_on < make_date(v_cycle.start_year - 1, 1, 1) or p_ends_on >= make_date(v_cycle.start_year + 2, 1, 1) then
    raise exception 'The dates have to fall around %', v_cycle.label using errcode = '22023';
  end if;

  update public.academic_cycles
     set starts_on = p_starts_on, even_starts_on = p_even_starts_on, ends_on = p_ends_on
   where id = p_cycle_id
  returning * into v_cycle;

  perform public.write_audit_entry(
    auth.uid(), 'academic_cycle.update_dates', 'academic_cycles', v_cycle.id::text,
    jsonb_build_object('cycle', v_cycle.label, 'starts_on', p_starts_on,
                       'even_starts_on', p_even_starts_on, 'ends_on', p_ends_on)
  );
  return v_cycle;
end;
$$;

revoke all on function public.update_academic_cycle_dates(uuid, date, date, date) from public, anon;
grant execute on function public.update_academic_cycle_dates(uuid, date, date, date) to authenticated, service_role;

-- Undo a cycle started by mistake. Only while nothing has been recorded
-- in it; its copied subjects and its student list go with it, and the
-- latest remaining cycle becomes active again.
create or replace function public.delete_academic_cycle(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle  public.academic_cycles;
  v_next   public.academic_cycles;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can remove a cycle' using errcode = '42501';
  end if;
  select * into v_cycle from public.academic_cycles where id = p_cycle_id;
  if v_cycle.id is null then
    raise exception 'Cycle not found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.academic_cycles) = 1 then
    raise exception 'This is the only cycle. The portal always needs one' using errcode = '22023';
  end if;
  if exists (select 1 from public.academic_upload_batches    where cycle_id = p_cycle_id)
     or exists (select 1 from public.roster_import_batches    where cycle_id = p_cycle_id)
     or exists (select 1 from public.student_attendance_records where cycle_id = p_cycle_id)
     or exists (select 1 from public.student_backlogs         where cycle_id = p_cycle_id)
     or exists (select 1 from public.student_black_dots       where cycle_id = p_cycle_id) then
    raise exception '% already has uploads or roster imports in it, so it cannot be removed', replace(v_cycle.label, '-', '–')
      using errcode = '22023';
  end if;

  update public.at_risk_meetings set cycle_id = null where cycle_id = p_cycle_id;
  delete from public.academic_cycles where id = p_cycle_id;

  if v_cycle.is_active then
    update public.academic_cycles
       set is_active = true, closed_at = null
     where id = (select id from public.academic_cycles order by start_year desc limit 1)
    returning * into v_next;
  else
    select * into v_next from public.academic_cycles where is_active;
  end if;

  perform public.write_audit_entry(
    auth.uid(), 'academic_cycle.delete', 'academic_cycles', p_cycle_id::text,
    jsonb_build_object('cycle', v_cycle.label, 'active_now', v_next.label)
  );

  return jsonb_build_object(
    'deleted', v_cycle.label,
    'active', case when v_next.id is null then null
                   else jsonb_build_object('id', v_next.id, 'label', v_next.label) end
  );
end;
$$;

revoke all on function public.delete_academic_cycle(uuid) from public, anon;
grant execute on function public.delete_academic_cycle(uuid) to authenticated, service_role;

-- Every cycle, newest first, with what is filed under it.
create or replace function public.list_academic_cycles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_count  integer;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can list academic cycles' using errcode = '42501';
  end if;
  select count(*) into v_count from public.academic_cycles;

  select coalesce(jsonb_agg(row_data order by start_year desc), '[]'::jsonb)
    into v_result
    from (
      select c.start_year,
             to_jsonb(c) || jsonb_build_object(
               'current_semester', case when c.is_active then public.cycle_semester_on(c.id, (now() at time zone 'Asia/Kolkata')::date) end,
               'students',       (select count(*) from public.academic_cycle_students e where e.cycle_id = c.id),
               'uploads',        (select count(*) from public.academic_upload_batches b where b.cycle_id = c.id),
               'roster_imports', (select count(*) from public.roster_import_batches r where r.cycle_id = c.id),
               'can_delete',     v_count > 1
                                 and not exists (select 1 from public.academic_upload_batches b where b.cycle_id = c.id)
                                 and not exists (select 1 from public.roster_import_batches r where r.cycle_id = c.id)
                                 and not exists (select 1 from public.student_attendance_records a where a.cycle_id = c.id)
                                 and not exists (select 1 from public.student_backlogs bl where bl.cycle_id = c.id)
                                 and not exists (select 1 from public.student_black_dots d where d.cycle_id = c.id)
             ) as row_data
        from public.academic_cycles c
    ) s;

  return v_result;
end;
$$;

revoke all on function public.list_academic_cycles() from public, anon;
grant execute on function public.list_academic_cycles() to authenticated, service_role;

-- One cycle, whole or one semester, as numbers. This is the Cluster
-- Head's view of the year and the source of the cycle report, so it
-- returns counts and averages only: no student is named, and nothing
-- about GPA values or at-risk flags, which cluster heads cannot read.
--   p_cycle_id  null = the active cycle
--   p_semester  null = the whole cycle; 'Odd' / 'Even' = that semester
-- Students and mentors are per cycle, so the semester does not filter them.
create or replace function public.get_cycle_overview(
  p_cycle_id uuid default null,
  p_semester public.semester_term default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle       public.academic_cycles;
  v_previous    public.academic_cycles;
  v_sem         text := p_semester::text;
  v_students    jsonb;
  v_mentors     jsonb;
  v_uploads     jsonb;
  v_rosters     jsonb;
  v_attendance  jsonb;
  v_gpa         jsonb;
  v_backlogs    jsonb;
  v_black_dots  jsonb;
  v_stale       integer := 0;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can view an academic cycle' using errcode = '42501';
  end if;

  if p_cycle_id is null then
    select * into v_cycle from public.academic_cycles where is_active;
  else
    select * into v_cycle from public.academic_cycles where id = p_cycle_id;
  end if;
  if v_cycle.id is null then
    raise exception 'Cycle not found' using errcode = 'P0002';
  end if;

  select * into v_previous
    from public.academic_cycles
   where start_year < v_cycle.start_year
   order by start_year desc
   limit 1;

  -- Students ---------------------------------------------------------
  select jsonb_build_object(
           'activated',      count(*),
           'with_mentor',    count(*) filter (where e.mentor_id is not null),
           'without_mentor', count(*) filter (where e.mentor_id is null),
           'by_via',         coalesce((select jsonb_object_agg(activated_via, n)
                                         from (select activated_via, count(*) as n
                                                 from public.academic_cycle_students
                                                where cycle_id = v_cycle.id
                                                group by activated_via) v), '{}'::jsonb),
           'by_semester',    coalesce((select jsonb_agg(jsonb_build_object('label', label, 'students', n)
                                                        order by nullif(substring(label from '[0-9]+'), '')::integer nulls last, label)
                                         from (select coalesce(nullif(btrim(semester_label), ''), 'Not given') as label, count(*) as n
                                                 from public.academic_cycle_students
                                                where cycle_id = v_cycle.id
                                                group by 1) s), '[]'::jsonb),
           'by_section',     coalesce((select jsonb_agg(jsonb_build_object('label', label, 'students', n) order by label)
                                         from (select coalesce(nullif(btrim(section), ''), 'Not given') as label, count(*) as n
                                                 from public.academic_cycle_students
                                                where cycle_id = v_cycle.id
                                                group by 1) s), '[]'::jsonb),
           'by_branch',      coalesce((select jsonb_agg(jsonb_build_object('label', label, 'students', n) order by n desc, label)
                                         from (select coalesce(nullif(btrim(branch), ''), 'Not given') as label, count(*) as n
                                                 from public.academic_cycle_students
                                                where cycle_id = v_cycle.id
                                                group by 1) s), '[]'::jsonb),
           -- Student accounts that are not in this cycle yet (the active
           -- cycle only: a closed cycle's list is what it was).
           'not_activated',  case when v_cycle.is_active then
                               (select count(*) from public.user_profiles p
                                 where p.role = 'student' and p.is_active
                                   and not exists (select 1 from public.academic_cycle_students x
                                                    where x.cycle_id = v_cycle.id and x.student_id = p.id))
                             end,
           'previous_not_here', case when v_previous.id is not null then
                               (select count(*) from public.academic_cycle_students x
                                  join public.user_profiles p on p.id = x.student_id
                                 where x.cycle_id = v_previous.id and p.is_active
                                   and not exists (select 1 from public.academic_cycle_students y
                                                    where y.cycle_id = v_cycle.id and y.student_id = x.student_id))
                             end
         )
    into v_students
    from public.academic_cycle_students e
   where e.cycle_id = v_cycle.id;

  -- Mentors: how many mentees each had in this cycle ------------------
  select jsonb_build_object(
           'count', count(*),
           'list',  coalesce(jsonb_agg(jsonb_build_object('mentor_id', mentor_id, 'name', name, 'email', email, 'mentees', mentees)
                                       order by mentees desc, name), '[]'::jsonb))
    into v_mentors
    from (select e.mentor_id, m.full_name as name, m.email, count(*) as mentees
            from public.academic_cycle_students e
            join public.user_profiles m on m.id = e.mentor_id
           where e.cycle_id = v_cycle.id
           group by e.mentor_id, m.full_name, m.email) t;

  -- Uploads, each filed under the semester it belongs to ------------
  with b as (
    select b.*,
           case
             when b.upload_type = 'attendance' and b.period_end is not null
               then case when b.period_end >= v_cycle.even_starts_on then 'Even' else 'Odd' end
             when b.upload_type = 'backlog' and b.semester_number is not null
               then public.semester_term_of_number(b.semester_number)::text
             else case when (b.created_at at time zone 'Asia/Kolkata')::date >= v_cycle.even_starts_on then 'Even' else 'Odd' end
           end as semester,
           u.full_name as uploaded_by_name,
           k.course_code
      from public.academic_upload_batches b
      left join public.user_profiles u on u.id = b.uploaded_by
      left join public.cluster_head_courses k on k.id = b.course_id
     where b.cycle_id = v_cycle.id
  ), f as (
    select * from b where v_sem is null or semester = v_sem
  )
  select jsonb_build_object(
           'total', (select count(*) from f),
           'by_type', coalesce((select jsonb_agg(jsonb_build_object(
                                   'upload_type', upload_type, 'semester', semester, 'uploads', n,
                                   'rows', rows, 'matched', matched, 'failed', failed, 'last_at', last_at)
                                   order by upload_type, semester)
                                  from (select upload_type::text as upload_type, semester, count(*) as n,
                                               sum(total_rows) as rows, sum(matched_rows) as matched,
                                               sum(failed_rows) as failed, max(created_at) as last_at
                                          from f group by 1, 2) t), '[]'::jsonb),
           'list', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', id, 'upload_type', upload_type, 'semester', semester,
                                'scope_label', scope_label, 'course_code', course_code, 'section_label', section_label,
                                'semester_number', semester_number, 'period_start', period_start,
                                'period_end', period_end, 'original_filename', original_filename,
                                'total_rows', total_rows, 'matched_rows', matched_rows,
                                'failed_rows', failed_rows, 'uploaded_by_name', uploaded_by_name,
                                'created_at', created_at)
                                order by created_at desc)
                               from f), '[]'::jsonb)
         )
    into v_uploads;

  -- GPA: upload counts only -------------------------------------------
  select jsonb_build_object(
           'uploads', count(*),
           'students_recorded', coalesce(sum(matched_rows), 0),
           'last_at', max(created_at),
           'scopes', coalesce(jsonb_agg(distinct scope_label) filter (where scope_label is not null), '[]'::jsonb)
         )
    into v_gpa
    from public.academic_upload_batches b
   where b.cycle_id = v_cycle.id
     and b.upload_type = 'gpa'
     and (v_sem is null
          or (case when (b.created_at at time zone 'Asia/Kolkata')::date >= v_cycle.even_starts_on then 'Even' else 'Odd' end) = v_sem);

  -- Roster imports ----------------------------------------------------
  select jsonb_build_object(
           'count', count(*),
           'accounts_created', coalesce(sum(created_count), 0),
           'rows', coalesce(sum(total_rows), 0),
           'last_at', max(created_at)
         )
    into v_rosters
    from public.roster_import_batches r
   where r.cycle_id = v_cycle.id
     and (v_sem is null
          or (case when (r.created_at at time zone 'Asia/Kolkata')::date >= v_cycle.even_starts_on then 'Even' else 'Odd' end) = v_sem);

  -- Attendance: the latest period per student and subject in each semester
  with a as (
    select a.*,
           case when a.period_end >= v_cycle.even_starts_on then 'Even' else 'Odd' end as semester
      from public.student_attendance_records a
     where a.cycle_id = v_cycle.id
  ), latest as (
    select distinct on (student_id, course_id, semester)
           student_id, course_id, course_code, course_name, section_label, attendance_percent, period_end, semester
      from a
     where v_sem is null or semester = v_sem
     order by student_id, course_id, semester, period_start desc, created_at desc
  ), per_student as (
    select semester, student_id, avg(attendance_percent) as mean
      from latest
     group by semester, student_id
  )
  select jsonb_build_object(
           'by_semester', coalesce((select jsonb_agg(jsonb_build_object(
                                       'semester', s.semester, 'subjects', s.subjects, 'sections', s.sections,
                                       'students', s.students, 'average', s.average,
                                       'students_below_75', coalesce(b.below, 0), 'last_period_end', s.last_period_end)
                                       order by s.semester desc)
                                      from (select semester,
                                                   count(distinct course_id) as subjects,
                                                   count(distinct (course_id, section_label)) as sections,
                                                   count(distinct student_id) as students,
                                                   round(avg(attendance_percent), 2) as average,
                                                   max(period_end) as last_period_end
                                              from latest group by semester) s
                                      left join (select semester, count(*) as below
                                                   from per_student where mean < 75 group by semester) b
                                        on b.semester = s.semester), '[]'::jsonb),
           'by_subject', coalesce((select jsonb_agg(jsonb_build_object(
                                      'course_code', course_code, 'course_name', course_name, 'semester', semester,
                                      'sections', sections, 'students', students, 'average', average,
                                      'below_75', below, 'last_period_end', last_period_end)
                                      order by semester desc, course_code)
                                     from (select course_code, max(course_name) as course_name, semester,
                                                  count(distinct section_label) as sections,
                                                  count(distinct student_id) as students,
                                                  round(avg(attendance_percent), 2) as average,
                                                  count(*) filter (where attendance_percent < 75) as below,
                                                  max(period_end) as last_period_end
                                             from latest
                                            group by course_code, semester) t), '[]'::jsonb)
         )
    into v_attendance;

  -- Backlogs first recorded in this cycle ------------------------------
  with bl as (
    select bl.*,
           case
             when bl.semester_number is not null
               then public.semester_term_of_number(bl.semester_number)::text
             else case when (bl.created_at at time zone 'Asia/Kolkata')::date >= v_cycle.even_starts_on then 'Even' else 'Odd' end
           end as semester
      from public.student_backlogs bl
     where bl.cycle_id = v_cycle.id
  ), f as (
    select * from bl where v_sem is null or semester = v_sem
  )
  select jsonb_build_object(
           'recorded', (select count(*) from f),
           'open',     (select count(*) from f where not is_cleared),
           'cleared',  (select count(*) from f where is_cleared),
           'students', (select count(distinct student_id) from f),
           'students_with_open', (select count(distinct student_id) from f where not is_cleared),
           'by_semester', coalesce((select jsonb_agg(jsonb_build_object(
                                       'semester', semester, 'recorded', n, 'open', open, 'cleared', cleared, 'students', students)
                                       order by semester desc)
                                      from (select semester, count(*) as n,
                                                   count(*) filter (where not is_cleared) as open,
                                                   count(*) filter (where is_cleared) as cleared,
                                                   count(distinct student_id) as students
                                              from f group by semester) t), '[]'::jsonb),
           'by_programme_semester', coalesce((select jsonb_agg(jsonb_build_object(
                                                 'semester_number', semester_number, 'open', open, 'cleared', cleared)
                                                 order by semester_number nulls last)
                                                from (select semester_number,
                                                             count(*) filter (where not is_cleared) as open,
                                                             count(*) filter (where is_cleared) as cleared
                                                        from f group by semester_number) t), '[]'::jsonb),
           'top_subjects', coalesce((select jsonb_agg(jsonb_build_object(
                                        'subject_code', code, 'subject_name', name, 'open', open, 'cleared', cleared)
                                        order by open desc, code)
                                       from (select upper(subject_code) as code, max(subject_name) as name,
                                                    count(*) filter (where not is_cleared) as open,
                                                    count(*) filter (where is_cleared) as cleared
                                               from f group by upper(subject_code)
                                              order by 3 desc, 1
                                              limit 15) t), '[]'::jsonb)
         )
    into v_backlogs;

  -- Black dots in this cycle -------------------------------------------
  with d as (
    select d.*,
           case when coalesce(d.incident_date, (d.created_at at time zone 'Asia/Kolkata')::date) >= v_cycle.even_starts_on
                then 'Even' else 'Odd' end as semester
      from public.student_black_dots d
     where d.cycle_id = v_cycle.id
  ), f as (
    select * from d where v_sem is null or semester = v_sem
  )
  select jsonb_build_object(
           'black_dots', (select count(*) from f),
           'students',   (select count(distinct student_id) from f),
           'cases',      (select count(distinct lower(case_number)) from f),
           'by_semester', coalesce((select jsonb_agg(jsonb_build_object(
                                       'semester', semester, 'cases', cases, 'students', students, 'black_dots', n)
                                       order by semester desc)
                                      from (select semester, count(distinct lower(case_number)) as cases,
                                                   count(distinct student_id) as students, count(*) as n
                                              from f group by semester) t), '[]'::jsonb),
           'case_list', coalesce((select jsonb_agg(jsonb_build_object(
                                     'case_number', case_number, 'case_details', case_details,
                                     'incident_date', incident_date, 'incident_date_text', incident_date_text,
                                     'semester', semester, 'students', students)
                                     order by incident_date desc nulls last, case_number)
                                    from (select max(case_number) as case_number, max(case_details) as case_details,
                                                 max(incident_date) as incident_date,
                                                 max(incident_date_text) as incident_date_text,
                                                 max(semester) as semester, count(distinct student_id) as students
                                            from f group by lower(case_number)) t), '[]'::jsonb)
         )
    into v_black_dots;

  -- At-risk flags that predate this cycle becoming active: the cycle's
  -- screen offers to re-check them. A count, never who.
  if v_cycle.is_active and v_cycle.activated_at is not null then
    select count(*) into v_stale
      from public.student_risk_flags f
      join public.user_profiles p on p.id = f.student_id
     where p.role = 'student' and p.is_active
       and f.last_evaluated_at < v_cycle.activated_at;
  end if;

  return jsonb_build_object(
    'cycle', to_jsonb(v_cycle) || jsonb_build_object(
               'current_semester', case when v_cycle.is_active then public.cycle_semester_on(v_cycle.id, (now() at time zone 'Asia/Kolkata')::date) end),
    'previous_cycle', case when v_previous.id is null then null
                           else jsonb_build_object('id', v_previous.id, 'label', v_previous.label) end,
    'semester', v_sem,
    'students', v_students,
    'mentors', v_mentors,
    'uploads', v_uploads,
    'roster_imports', v_rosters,
    'attendance', v_attendance,
    'gpa', v_gpa,
    'backlogs', v_backlogs,
    'black_dots', v_black_dots,
    'stale_risk_flags', v_stale,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.get_cycle_overview(uuid, public.semester_term) from public, anon;
grant execute on function public.get_cycle_overview(uuid, public.semester_term) to authenticated, service_role;
