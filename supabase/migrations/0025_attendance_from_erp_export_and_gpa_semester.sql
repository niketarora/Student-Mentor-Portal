-- =====================================================================
-- 0025  Attendance driven by the real ERP export, GPA carrying its own
--       semester, and both mapped to students by registration number
-- =====================================================================
-- WHAT CHANGED AND WHY
-- ---------------------------------------------------------------------
-- The attendance file the department actually produces is the ERP's
-- "Class Attendance" export. It is not a plain roster: the course code,
-- course name, section and reporting dates sit in a header block ABOVE the
-- table, and the table itself already carries a computed "%" column:
--
--     Course Code: IIS3120 | Course Name: DIGITAL IMAGE ... | Section: A
--     From Date: 23/07/2026 | To Date: 12/08/2026
--     S.No. | Registration No. | Name | Section | Total Class | Present | Absent | %
--
-- Three consequences, all handled here:
--
--   1. THE % COLUMN IS THE SOURCE OF TRUTH. attendance_percent used to be
--      a GENERATED column computed from classes_held/classes_attended.
--      It is now a plain column written straight from the file. The ERP
--      rounds its own way, and a portal that quietly disagreed with the
--      ERP by a decimal point would be worse than useless. Total class /
--      present / absent are still stored, but only for reference — nothing
--      reads them to decide anything.
--
--   2. COURSE AND SECTION COME FROM THE FILE, not from dropdowns. The
--      upload no longer asks the Cluster Head to pick anything.
--
--   3. course_code and course_name are SNAPSHOTTED onto each attendance
--      row rather than being read through the course table. Two reasons:
--      the student portal has to display them, and a student has no read
--      access to cluster_head_courses (nor should they) — a
--      security_invoker view joining to it would silently return nothing.
--      It also means a later rename or deletion of the course cannot
--      rewrite history.
--
-- The section in this file is the TEACHING section for that course. It is
-- unrelated to user_profiles.section / the Form A section, and the two are
-- expected to differ. Nothing here reconciles them, on purpose.
--
-- GPA: the export carries a "Semester" column ("4th Semester"), so a row
-- can now name its own semester instead of every row inheriting one
-- dropdown value.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Attendance table: percentage becomes real data, not a computation
-- ---------------------------------------------------------------------
alter table public.student_attendance_records
  add column if not exists course_code text;
alter table public.student_attendance_records
  add column if not exists course_name text;

-- Backfill the snapshot for anything already recorded under the old shape.
update public.student_attendance_records a
   set course_code = c.course_code,
       course_name = c.course_name
  from public.cluster_head_courses c
 where c.id = a.course_id
   and a.course_code is null;

-- Swap the GENERATED column for a writable one, preserving existing values.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'student_attendance_records'
       and column_name  = 'attendance_percent'
       and is_generated = 'ALWAYS'
  ) then
    alter table public.student_attendance_records rename column attendance_percent to attendance_percent_old;
    alter table public.student_attendance_records add column attendance_percent numeric(5,2);
    update public.student_attendance_records set attendance_percent = attendance_percent_old;
    alter table public.student_attendance_records drop column attendance_percent_old;
  end if;
end $$;

update public.student_attendance_records
   set attendance_percent = 0
 where attendance_percent is null;

alter table public.student_attendance_records
  alter column attendance_percent set not null;

-- Total class / present / absent are informational now, so they may be
-- absent entirely if a future export drops them.
alter table public.student_attendance_records alter column classes_held     drop not null;
alter table public.student_attendance_records alter column classes_attended drop not null;

alter table public.student_attendance_records drop constraint if exists attendance_classes_held_sane;
alter table public.student_attendance_records drop constraint if exists attendance_attended_sane;

alter table public.student_attendance_records
  add constraint attendance_classes_held_sane
  check (classes_held is null or classes_held between 0 and 2000);

alter table public.student_attendance_records
  add constraint attendance_attended_sane
  check (
    classes_attended is null
    or (classes_attended >= 0 and (classes_held is null or classes_attended <= classes_held))
  );

alter table public.student_attendance_records
  add constraint attendance_percent_range
  check (attendance_percent >= 0 and attendance_percent <= 100);

comment on column public.student_attendance_records.attendance_percent is
  'Taken verbatim from the "%" column of the ERP export. Never recomputed from classes_held/classes_attended — the portal must not disagree with the ERP.';
comment on column public.student_attendance_records.section_label is
  'The TEACHING section for this course, from the export header. Unrelated to the student''s Form A / profile section, and expected to differ.';


-- ---------------------------------------------------------------------
-- 2. What the student sees: latest row per course
-- ---------------------------------------------------------------------
-- security_invoker (§10.7). No join to cluster_head_courses — see the note
-- at the top: the student cannot read that table, and the snapshot columns
-- mean they do not need to.
drop view if exists public.student_attendance_overview cascade;
create view public.student_attendance_overview
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
order by a.student_id, a.course_id, a.period_start desc, a.created_at desc;

comment on view public.student_attendance_overview is
  'One row per student per course — the most recent reporting period. Powers the attendance table on the student Academics page.';

grant select on public.student_attendance_overview to authenticated;


-- ---------------------------------------------------------------------
-- 3. Re-evaluation now averages the percentages the ERP gave us
-- ---------------------------------------------------------------------
-- Previously this weighted by class count (sum attended / sum held), which
-- was the right call when we owned the arithmetic. We no longer do: the
-- export hands us a per-course percentage and that is what the student and
-- the mentor both see, so "overall attendance" is the mean of those. A
-- weighted figure computed from columns nobody displays would put a number
-- on the At-Risk page that the student could not reproduce from their own
-- Academics page.
create or replace function public.evaluate_student_risk(p_student_id uuid)
returns public.student_risk_flags
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row              public.student_risk_flags;
  v_attendance       numeric(5,2);
  v_courses          integer;
  v_gpa              numeric(4,2);
  v_gpa_semester     smallint;
  v_backlogs         integer;
  v_low_attendance   boolean := false;
  v_low_gpa          boolean := false;
  v_has_backlog      boolean := false;
  v_reasons          text[]  := array[]::text[];
  v_at_risk          boolean;
begin
  if not exists (select 1 from public.user_profiles where id = p_student_id and role = 'student') then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  -- Mean of the latest percentage for each course the student appears in.
  select count(*), round(avg(latest.attendance_percent), 2)
    into v_courses, v_attendance
    from (
      select distinct on (course_id) attendance_percent
        from public.student_attendance_records
       where student_id = p_student_id
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

  -- ANY of the three.
  v_at_risk := v_low_attendance or v_low_gpa or v_has_backlog;

  insert into public.student_risk_flags as f (
    student_id, is_at_risk, low_attendance, low_gpa, has_backlog,
    attendance_percent, latest_gpa, latest_gpa_semester, backlog_count, reasons,
    first_flagged_at, last_flagged_at, cleared_at, last_evaluated_at
  )
  values (
    p_student_id, v_at_risk, v_low_attendance, v_low_gpa, v_has_backlog,
    case when coalesce(v_courses, 0) > 0 then v_attendance end,
    v_gpa, v_gpa_semester, v_backlogs, v_reasons,
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
    attendance_percent  = excluded.attendance_percent,
    latest_gpa          = excluded.latest_gpa,
    latest_gpa_semester = excluded.latest_gpa_semester,
    backlog_count       = excluded.backlog_count,
    reasons             = excluded.reasons,
    first_flagged_at    = coalesce(f.first_flagged_at, excluded.first_flagged_at),
    last_flagged_at     = case when excluded.is_at_risk then now() else f.last_flagged_at end,
    cleared_at          = case when excluded.is_at_risk then null else coalesce(f.cleared_at, now()) end,
    last_evaluated_at   = now()
  returning * into v_row;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. The attendance upload, rewritten around the export
-- ---------------------------------------------------------------------
-- The old signature took a course_id and a section chosen from dropdowns.
-- Both now come out of the file, so that function is gone rather than
-- left behind to rot.
drop function if exists public.record_attendance_batch(uuid, text, date, date, text, jsonb);

create or replace function public.record_attendance_batch(
  p_course_code  text,
  p_course_name  text,
  p_section      text,
  p_period_start date,
  p_period_end   date,
  p_filename     text,
  p_rows         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_course    public.cluster_head_courses;
  v_batch_id  uuid;
  v_item      jsonb;
  v_ident     text;
  v_student   uuid;
  v_percent   numeric;
  v_held      integer;
  v_attended  integer;
  v_section   text;
  v_matched   integer := 0;
  v_failed    integer := 0;
  v_total     integer := 0;
  v_errors    jsonb   := '[]'::jsonb;
  v_touched   uuid[]  := array[]::uuid[];
  v_sid       uuid;
  v_actor     uuid;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload attendance' using errcode = '42501';
  end if;
  if p_course_code is null or btrim(p_course_code) = '' then
    raise exception 'No course code found in the file header' using errcode = '22023';
  end if;

  -- The course must already be one of theirs. An unrecognised code is a
  -- hard stop rather than an auto-registration: the subject list is what
  -- the department signed off, and silently inventing courses from a file
  -- would let a typo in the ERP export create a phantom subject that then
  -- shows up on a student's record.
  select * into v_course
    from public.cluster_head_courses
   where lower(course_code) = lower(btrim(p_course_code))
     and (cluster_head_id = auth.uid() or public.is_hod() or auth.uid() is null)
   limit 1;

  if v_course.id is null then
    raise exception
      'Course code "%" is not in your subject list. Add it under My Subjects, then upload this file again.',
      btrim(p_course_code)
      using errcode = '22023';
  end if;

  v_section := upper(btrim(coalesce(p_section, '')));
  if v_section !~ '^[A-O]$' then
    raise exception 'Could not read a valid section (A-O) from the file header, got "%"', p_section
      using errcode = '22023';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'The From/To dates in the file header are missing or out of order' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  v_actor := coalesce(auth.uid(), v_course.cluster_head_id);

  insert into public.academic_upload_batches (
    uploaded_by, upload_type, course_id, section_label,
    period_start, period_end, original_filename, total_rows
  )
  values (v_actor, 'attendance', v_course.id, v_section,
          p_period_start, p_period_end, coalesce(p_filename, 'upload'), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total   := v_total + 1;
    v_ident   := btrim(coalesce(v_item ->> 'identifier', ''));
    v_percent := nullif(v_item ->> 'attendance_percent', '')::numeric;
    v_held    := nullif(v_item ->> 'classes_held', '')::integer;
    v_attended:= nullif(v_item ->> 'classes_attended', '')::integer;

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

    -- Mapped on registration number, which is what the export carries.
    -- Email is accepted too so a hand-made file still works.
    select id into v_student
      from public.user_profiles
     where role = 'student' and is_active
       and (lower(coalesce(login_id, '')) = lower(v_ident) or lower(email) = lower(v_ident))
     limit 1;

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

    if not (v_student = any (v_touched)) then
      v_touched := v_touched || v_student;
    end if;
    v_matched := v_matched + 1;
  end loop;

  update public.academic_upload_batches
     set matched_rows = v_matched, failed_rows = v_failed, row_errors = v_errors
   where id = v_batch_id;

  foreach v_sid in array v_touched loop
    perform public.evaluate_student_risk(v_sid);
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'course_code', v_course.course_code,
    'course_name', coalesce(nullif(btrim(coalesce(p_course_name, '')), ''), v_course.course_name),
    'section', v_section,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'total_rows', v_total, 'matched', v_matched, 'failed', v_failed,
    'students_reevaluated', coalesce(array_length(v_touched, 1), 0),
    'row_errors', v_errors
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 5. GPA rows may now name their own semester
-- ---------------------------------------------------------------------
-- The export has a Semester column ("4th Semester"), parsed to 1-8 before
-- it gets here. p_semester_number stays as the fallback for a file that
-- has no such column, so the signature is unchanged and nothing that
-- called it breaks.
create or replace function public.record_gpa_batch(
  p_semester_number smallint,
  p_filename        text,
  p_rows            jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_id uuid;
  v_item     jsonb;
  v_ident    text;
  v_student  uuid;
  v_gpa      numeric;
  v_semester smallint;
  v_matched  integer := 0;
  v_failed   integer := 0;
  v_total    integer := 0;
  v_errors   jsonb   := '[]'::jsonb;
  v_touched  uuid[]  := array[]::uuid[];
  v_sid      uuid;
begin
  if not (public.is_cluster_head() or public.is_hod() or auth.uid() is null) then
    raise exception 'Only a cluster head or the HOD can upload GPA data' using errcode = '42501';
  end if;
  if p_semester_number is not null and (p_semester_number < 1 or p_semester_number > 8) then
    raise exception 'Semester must be between 1 and 8' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no usable rows' using errcode = '22023';
  end if;

  insert into public.academic_upload_batches (
    uploaded_by, upload_type, semester_number, original_filename, total_rows
  )
  values (auth.uid(), 'gpa', p_semester_number, coalesce(p_filename, 'upload'), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  for v_item in select * from jsonb_array_elements(p_rows)
  loop
    v_total    := v_total + 1;
    v_ident    := btrim(coalesce(v_item ->> 'identifier', ''));
    v_gpa      := nullif(v_item ->> 'gpa', '')::numeric;
    -- Row wins over the fallback.
    v_semester := coalesce(nullif(v_item ->> 'semester_number', '')::smallint, p_semester_number);

    if v_ident = '' then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'reason', 'No registration number in this row');
      continue;
    end if;
    if v_gpa is null or v_gpa < 0 or v_gpa > 10 then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'GPA must be between 0 and 10');
      continue;
    end if;
    if v_semester is null or v_semester < 1 or v_semester > 8 then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No semester on this row, and none chosen for the upload');
      continue;
    end if;

    select id into v_student
      from public.user_profiles
     where role = 'student' and is_active
       and (lower(coalesce(login_id, '')) = lower(v_ident) or lower(email) = lower(v_ident))
     limit 1;

    if v_student is null then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_total, 'identifier', v_ident,
                                                 'reason', 'No student matches this registration number');
      continue;
    end if;

    insert into public.student_semester_gpas (
      student_id, semester_number, gpa, source, recorded_by, batch_id
    )
    values (v_student, v_semester, round(v_gpa, 2), 'cluster_head', auth.uid(), v_batch_id)
    on conflict (student_id, semester_number) do update
      set gpa         = excluded.gpa,
          source      = 'cluster_head',
          recorded_by = excluded.recorded_by,
          batch_id    = excluded.batch_id,
          updated_at  = now();

    if not (v_student = any (v_touched)) then
      v_touched := v_touched || v_student;
    end if;
    v_matched := v_matched + 1;
  end loop;

  update public.academic_upload_batches
     set matched_rows = v_matched, failed_rows = v_failed, row_errors = v_errors
   where id = v_batch_id;

  foreach v_sid in array v_touched loop
    perform public.evaluate_student_risk(v_sid);
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id, 'total_rows', v_total,
    'matched', v_matched, 'failed', v_failed,
    'students_reevaluated', coalesce(array_length(v_touched, 1), 0),
    'row_errors', v_errors
  );
end;
$$;


revoke all on function public.record_attendance_batch(text, text, text, date, date, text, jsonb) from public, anon;
grant execute on function public.record_attendance_batch(text, text, text, date, date, text, jsonb) to authenticated, service_role;
grant execute on function public.record_gpa_batch(smallint, text, jsonb) to authenticated, service_role;
grant execute on function public.evaluate_student_risk(uuid) to authenticated, service_role;
